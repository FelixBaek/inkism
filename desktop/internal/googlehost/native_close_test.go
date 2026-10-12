package googlehost

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
)

func TestLockedNativeCloseCancelsPendingLogin(t *testing.T) {
	started := make(chan struct{})
	var resumes atomic.Int32
	c := New(fakeProvider{func(ctx context.Context) (Identity, error) {
		close(started)
		<-ctx.Done()
		return account, nil // Late successful completion must not resume.
	}}, &memoryStore{identity: account, exists: true})
	c.Attach(func() error { return nil }, func(context.Context) error { resumes.Add(1); return nil })
	result := make(chan error, 1)
	go func() { result <- c.Login(context.Background()) }()
	<-started
	if !c.CancelForLockedClose() {
		t.Fatal("locked native close still depends on the missing editor")
	}
	if err := <-result; !errors.Is(err, ErrCancelled) || resumes.Load() != 0 || !c.Status().Locked {
		t.Fatal("native close allowed late authentication to resume")
	}
	unconfigured := New(nil, &memoryStore{})
	unconfigured.Attach(func() error { return nil }, func(context.Context) error { return nil })
	if unconfigured.CancelForLockedClose() {
		t.Fatal("unlocked native close skipped the save handshake")
	}
}
