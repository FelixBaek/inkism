package googlehost

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type memoryStore struct {
	identity Identity
	exists   bool
	err      error
	saves    int
}

func TestEnrollmentCancelledDuringGateStopDoesNotPersist(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := &memoryStore{}
	c := New(provider(account, nil), store)
	resumed := false
	c.Attach(func() error { cancel(); return nil }, func(context.Context) error { resumed = true; return nil })
	if err := c.Login(ctx); !errors.Is(err, ErrCancelled) {
		t.Fatal("expected cancellation", err)
	}
	if store.saves != 0 || store.exists || resumed || !c.Status().Locked || c.Status().Configured {
		t.Fatal("cancelled enrollment persisted or exposed the library")
	}
}

func (s *memoryStore) Load() (Identity, bool, error) { return s.identity, s.exists, s.err }
func (s *memoryStore) Save(i Identity) error {
	if s.err != nil {
		return s.err
	}
	s.identity = i
	s.exists = true
	s.saves++
	return nil
}

type fakeProvider struct {
	call func(context.Context) (Identity, error)
}

func (p fakeProvider) Login(ctx context.Context) (Identity, string, error) {
	i, err := p.call(ctx)
	return i, "", err
}
func (p fakeProvider) Cancel() {}

var account = Identity{"https://accounts.google.com", "synthetic-user"}

func provider(i Identity, err error) Provider {
	return fakeProvider{func(context.Context) (Identity, error) { return i, err }}
}
func TestEnrollmentAndRestartBoundary(t *testing.T) {
	store := &memoryStore{}
	c := New(provider(account, nil), store)
	var stopped, resumed int
	gate := c.Attach(func() error { stopped++; return nil }, func(context.Context) error { resumed++; return nil })
	if c.InitiallyLocked() || c.Status().Configured || gate.Status().Locked {
		t.Fatal("unconfigured library blocked")
	}
	if err := c.Login(context.Background()); err != nil {
		t.Fatal(err)
	}
	if store.saves != 1 || stopped != 1 || resumed != 1 || !c.Status().Configured || c.Status().Locked {
		t.Fatal("enrollment did not bind and resume")
	}
	restarted := New(provider(account, nil), store)
	if !restarted.InitiallyLocked() {
		t.Fatal("restart not locked")
	}
	restarted.Attach(func() error { return nil }, func(context.Context) error { return errors.New("missing key") })
	if restarted.Login(context.Background()) == nil || !restarted.Status().Locked {
		t.Fatal("failed runtime resume unlocked")
	}
}
func TestUnavailableCorruptOfflineAndWrongAccountFailClosed(t *testing.T) {
	for _, scenario := range []string{"missing-client", "corrupt-binding", "offline", "wrong-account"} {
		t.Run(scenario, func(t *testing.T) {
			store := &memoryStore{identity: account, exists: true}
			p := provider(account, nil)
			switch scenario {
			case "missing-client":
				p = nil
			case "corrupt-binding":
				store.err = errors.New("bad DPAPI")
			case "offline":
				p = provider(Identity{}, errors.New("offline token secret must not escape"))
			case "wrong-account":
				p = provider(Identity{account.Issuer, "other"}, nil)
			}
			c := New(p, store)
			var resumed int
			c.Attach(func() error { return nil }, func(context.Context) error { resumed++; return nil })
			if !c.InitiallyLocked() || c.Login(context.Background()) == nil || resumed != 0 || !c.Status().Locked || store.saves != 0 {
				t.Fatal("fail closed boundary violated")
			}
		})
	}
}
func TestPendingStatusCancelAndLateLoginCannotUnlock(t *testing.T) {
	started := make(chan struct{})
	complete := make(chan struct{})
	store := &memoryStore{identity: account, exists: true}
	c := New(fakeProvider{func(context.Context) (Identity, error) { close(started); <-complete; return account, nil }}, store)
	var resumed atomic.Int32
	c.Attach(func() error { return nil }, func(context.Context) error { resumed.Add(1); return nil })
	done := make(chan error, 1)
	go func() { done <- c.Login(context.Background()) }()
	<-started
	statusDone := make(chan bool, 1)
	go func() { statusDone <- c.Status().Pending }()
	select {
	case pending := <-statusDone:
		if !pending {
			t.Fatal("pending missing")
		}
	case <-time.After(time.Second):
		t.Fatal("status blocked by OAuth")
	}
	if !errors.Is(c.Login(context.Background()), ErrBusy) {
		t.Fatal("duplicate login accepted")
	}
	c.Cancel()
	close(complete)
	if !errors.Is(<-done, ErrCancelled) || resumed.Load() != 0 || !c.Status().Locked {
		t.Fatal("cancelled attempt unlocked")
	}
}
func TestStrictConfigAndExclusivePolicyStorage(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "google-client.json")
	if _, err := ReadConfig(config); err == nil {
		t.Fatal("missing config accepted")
	}
	for _, raw := range []string{`{"client_id":"https://evil"}`, `{"client_id":"123-abc.apps.googleusercontent.com","client_secret":"forbidden"}`, `{"client_id":"123-abc.apps.googleusercontent.com"}{}`} {
		os.WriteFile(config, []byte(raw), 0600)
		if _, err := ReadConfig(config); err == nil {
			t.Fatal("unsafe config accepted")
		}
	}
	os.WriteFile(config, []byte(`{"client_id":"123-abc.apps.googleusercontent.com"}`), 0600)
	if _, err := ReadConfig(config); err != nil {
		t.Fatal(err)
	}
	store := FileStore{Path: filepath.Join(root, "policy"), Protect: func(b []byte) ([]byte, error) { return append([]byte("protected:"), b...), nil }, Unprotect: func(b []byte) ([]byte, error) {
		if len(b) < 10 {
			return nil, ErrPolicy
		}
		return b[10:], nil
	}}
	if err := store.Save(account); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(Identity{account.Issuer, "other"}); err == nil {
		t.Fatal("overwrote binding")
	}
	got, exists, err := store.Load()
	if err != nil || !exists || got != account {
		t.Fatal(got, exists, err)
	}
	os.WriteFile(store.Path, []byte("corrupt"), 0600)
	_, exists, err = store.Load()
	if err == nil || !exists {
		t.Fatal("corruption treated as missing opt-in")
	}
}

type failingStore struct {
	partial bool
	fail    bool
}

func (s *failingStore) Load() (Identity, bool, error) {
	if s.partial {
		return Identity{}, true, ErrPolicy
	}
	return Identity{}, false, nil
}
func (s *failingStore) Save(Identity) error {
	if s.fail {
		return errors.New("write failed")
	}
	return nil
}
func TestEnrollmentWriteFailureRetryAndPartialFile(t *testing.T) {
	for _, partial := range []bool{false, true} {
		t.Run(map[bool]string{false: "no-file-retry", true: "partial-fail-closed"}[partial], func(t *testing.T) {
			s := &failingStore{fail: true}
			c := New(provider(account, nil), s)
			c.Attach(func() error { return nil }, func(context.Context) error { return nil })
			s.partial = partial
			if c.Login(context.Background()) == nil || !c.Status().Locked {
				t.Fatal("failed save exposed data")
			}
			s.fail = false
			err := c.Login(context.Background())
			if partial {
				if !errors.Is(err, ErrPolicy) || !c.Status().Configured || c.Status().Available {
					t.Fatal("partial binding not fail closed")
				}
			} else if err != nil || c.Status().Locked {
				t.Fatal("safe explicit retry failed", err)
			}
		})
	}
}

type removableStore struct {
	memoryStore
	removeErr error
	removed   int
}

func (s *removableStore) Remove() error {
	if s.removeErr != nil {
		return s.removeErr
	}
	s.removed++
	s.exists = false
	s.identity = Identity{}
	return nil
}

func unlockedController(t *testing.T, p Provider, store Store) *Controller {
	t.Helper()
	c := New(p, store)
	gate := c.Attach(func() error { return nil }, func(context.Context) error { return nil })
	if err := gate.UnlockWithSetup(context.Background(), func(context.Context) error { return nil }, func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestDisableRequiresSameAccountReauthentication(t *testing.T) {
	bound := func() *removableStore {
		return &removableStore{memoryStore: memoryStore{identity: account, exists: true}}
	}
	// Locked: refused before any login.
	var calls atomic.Int32
	counted := fakeProvider{func(context.Context) (Identity, error) { calls.Add(1); return account, nil }}
	store := bound()
	locked := New(counted, store)
	locked.Attach(func() error { return nil }, func(context.Context) error { return nil })
	if err := locked.Disable(context.Background()); err == nil || calls.Load() != 0 || store.removed != 0 {
		t.Fatal("locked app disabled or logged in", err)
	}
	// Other account, other issuer, failed login: binding stays.
	for _, p := range []Provider{
		provider(Identity{"https://accounts.google.com", "someone-else"}, nil),
		provider(Identity{"https://evil.example", account.Subject}, nil),
		provider(Identity{}, errors.New("network")),
	} {
		store := bound()
		c := unlockedController(t, p, store)
		if err := c.Disable(context.Background()); err == nil || store.removed != 0 || !c.Status().Configured {
			t.Fatal("binding removed without matching re-login", err)
		}
	}
	// Cancelled login.
	store = bound()
	c := unlockedController(t, provider(account, nil), store)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := c.Disable(ctx); err == nil || store.removed != 0 {
		t.Fatal("cancelled disable removed binding", err)
	}
	// Store without Remove, or a failing Remove, keeps the lock.
	plain := &memoryStore{identity: account, exists: true}
	if err := unlockedController(t, provider(account, nil), plain).Disable(context.Background()); err == nil {
		t.Fatal("store without Remove disabled the lock")
	}
	failing := bound()
	failing.removeErr = errors.New("disk")
	c = unlockedController(t, provider(account, nil), failing)
	if err := c.Disable(context.Background()); err == nil || !c.Status().Configured {
		t.Fatal("failed removal reported success", err)
	}
	// Same issuer+subject after a fresh login turns it off.
	store = bound()
	c = unlockedController(t, provider(account, nil), store)
	if err := c.Disable(context.Background()); err != nil || store.removed != 1 {
		t.Fatal(err)
	}
	if s := c.Status(); s.Configured || s.Locked || c.Lock() == nil {
		t.Fatal("lock still active after disable", s)
	}
}

func TestFileStoreRemoveDeletesBindingAndHint(t *testing.T) {
	root := t.TempDir()
	store := FileStore{Path: filepath.Join(root, "policy"), Protect: func(b []byte) ([]byte, error) { return b, nil }, Unprotect: func(b []byte) ([]byte, error) { return b, nil }}
	if err := store.Save(account); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.Path+".hint", []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(); err != nil {
		t.Fatal(err)
	}
	if _, exists, err := store.Load(); exists || err != nil {
		t.Fatal("binding survived Remove", exists, err)
	}
	if _, err := os.Stat(store.Path + ".hint"); !os.IsNotExist(err) {
		t.Fatal("hint survived Remove")
	}
	if err := store.Remove(); err != nil {
		t.Fatal("second Remove", err)
	}
}
