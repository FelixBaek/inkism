package reminders

import (
	"context"
	"errors"
	"github.com/FelixBaek/inkism/desktop/internal/applock"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeScheduler struct {
	enabled, disabled int
	err               error
}

func (s *fakeScheduler) Enable(context.Context, string) error  { s.enabled++; return s.err }
func (s *fakeScheduler) Disable(context.Context, string) error { s.disabled++; return s.err }
func fixtureCache(t *testing.T) (*Background, *fakeScheduler) {
	t.Helper()
	id, _ := NewCacheID()
	scheduler := &fakeScheduler{}
	bg := &Background{Root: t.TempDir(), ID: id, Scheduler: scheduler}
	if err := bg.Enable(context.Background()); err != nil {
		t.Fatal(err)
	}
	return bg, scheduler
}
func seedCache(t *testing.T, bg *Background, entries []Schedule) {
	t.Helper()
	generation, err := bg.Generation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err = bg.Refresh(context.Background(), entries, nil, generation); err != nil {
		t.Fatal(err)
	}
}
func TestClosedCacheRepeatSleepRetryAndRemoval(t *testing.T) {
	bg, scheduler := fixtureCache(t)
	id := strings.Repeat("a", 64)
	seedCache(t, bg, []Schedule{{ID: id, At: 1000, Hours: 24}})
	var sent int
	fail := true
	send := func() error {
		if fail {
			return errors.New("notify failed")
		}
		sent++
		return nil
	}
	if bg.Fire(context.Background(), time.UnixMilli(1000), send) == nil {
		t.Fatal("lost retry")
	}
	fail = false
	for _, hours := range []int64{0, 0, 24 * 30, 24 * 30} {
		if err := bg.Fire(context.Background(), time.UnixMilli(1000+hours*3600000), send); err != nil {
			t.Fatal(err)
		}
	}
	if sent != 2 {
		t.Fatal(sent)
	}
	receipts, err := bg.Disable(context.Background())
	if err != nil || len(receipts) != 1 || scheduler.disabled != 1 {
		t.Fatal(receipts, err)
	}
	if err := bg.Fire(context.Background(), time.Now(), send); err != nil || sent != 2 {
		t.Fatal("disabled delivery")
	}
	entries, _ := os.ReadDir(bg.Root)
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".json") || strings.HasSuffix(entry.Name(), ".task") {
			t.Fatal("schedule privacy data retained")
		}
	}
}
func TestCacheInvalidationRejectsStaleRefresh(t *testing.T) {
	bg, _ := fixtureCache(t)
	id := strings.Repeat("b", 64)
	seedCache(t, bg, []Schedule{{ID: id, At: 1000}})
	old, _ := bg.Generation(context.Background())
	if err := bg.Invalidate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := bg.Refresh(context.Background(), []Schedule{{ID: id, At: 1000}}, nil, old); err == nil {
		t.Fatal("stale refresh re-enabled")
	}
	count := 0
	if err := bg.Fire(context.Background(), time.Now(), func() error { count++; return nil }); err != nil || count != 0 {
		t.Fatal(err, count)
	}
	seedCache(t, bg, nil)
	if err := bg.Fire(context.Background(), time.Now(), func() error { count++; return nil }); err != nil || count != 0 {
		t.Fatal("removed note fired")
	}
}
func TestConcurrentHelpersOnlyDeliverOnce(t *testing.T) {
	bg, _ := fixtureCache(t)
	seedCache(t, bg, []Schedule{{ID: strings.Repeat("c", 64), At: 0}})
	var count atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := bg.Fire(ctx, time.Now(), func() error { count.Add(1); time.Sleep(30 * time.Millisecond); return nil }); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if count.Load() != 1 {
		t.Fatal(count.Load())
	}
}
func TestOpaqueCacheRejectsPathsCorruptionAndExtraFields(t *testing.T) {
	bg, _ := fixtureCache(t)
	path, _ := bg.path()
	for _, raw := range []string{`{"version":1,"library":"secret.db"}`, `{"version":1,"enabled":true,"schedules":[{"id":"not-opaque","at":0}]}`, `{"version":1}{}`} {
		_ = os.WriteFile(path, []byte(raw), 0600)
		if bg.Fire(context.Background(), time.Now(), func() error { t.Fatal("invalid cache delivered"); return nil }) == nil {
			t.Fatal("invalid cache accepted")
		}
	}
	bg.ID = "../../notes.db"
	if bg.Fire(context.Background(), time.Now(), func() error { return nil }) == nil {
		t.Fatal("path traversal")
	}
}
func TestServiceBackgroundOptInStoresNoNoteData(t *testing.T) {
	root := t.TempDir()
	f := &fake{raw: `{"ok":true,"data":[{"id":"private-note-id","title":"PRIVATE TITLE","preview":"PRIVATE BODY","reminder_at":2000,"reminder_repeat_hours":24}]}`}
	s, _ := New(filepath.Join(root, "state.json"), f, func() error { return nil })
	scheduler := &fakeScheduler{}
	s.AttachBackground(filepath.Join(root, "cache"), scheduler)
	if s.SetBackground(context.Background(), true) == nil {
		t.Fatal("master opt-in bypass")
	}
	_ = s.SetEnabled(true)
	if err := s.SetBackground(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if f.calls != 0 {
		t.Fatal("settings called engine while HTTP gate held")
	}
	if err := s.Poll(context.Background(), time.UnixMilli(1000)); err != nil {
		t.Fatal(err)
	}
	path, _ := s.bg.Load().path()
	raw, _ := os.ReadFile(path)
	for _, secret := range []string{"private-note-id", "PRIVATE TITLE", "PRIVATE BODY", "state.json"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("cache leak", secret)
		}
	}
	delivered := 0
	if err := s.bg.Load().Fire(context.Background(), time.UnixMilli(2000), func() error { delivered++; return nil }); err != nil || delivered != 1 {
		t.Fatal(err, delivered)
	}
	if err := s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if s.BackgroundEnabled() || scheduler.disabled != 1 {
		t.Fatal("master disable retained background")
	}
}
func TestDisableDoesNotClaimSuccessWhileCacheLocked(t *testing.T) {
	bg, _ := fixtureCache(t)
	seedCache(t, bg, []Schedule{{ID: strings.Repeat("d", 64), At: 1000}})
	path, _ := bg.path()
	release, err := applock.Acquire(path)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := bg.Disable(ctx); !errors.Is(err, ErrCacheStillActive) {
		t.Fatal("active cache not reported", err)
	}
}
func TestTaskCleanupFailureStillDisablesCacheAndCanRetry(t *testing.T) {
	root := t.TempDir()
	s, _ := New(filepath.Join(root, "state"), &fake{raw: `{"ok":true,"data":[]}`}, func() error { return nil })
	scheduler := &fakeScheduler{}
	s.AttachBackground(filepath.Join(root, "cache"), scheduler)
	_ = s.SetEnabled(true)
	if err := s.SetBackground(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	scheduler.err = errors.New("task temporarily unavailable")
	if s.SetEnabled(false) == nil {
		t.Fatal("cleanup failure hidden")
	}
	if s.Enabled() || s.BackgroundEnabled() {
		t.Fatal("cache disabled but state claims enabled")
	}
	called := false
	if err := s.bg.Load().Fire(context.Background(), time.Now(), func() error { called = true; return nil }); err != nil || called {
		t.Fatal("off still delivered")
	}
	scheduler.err = nil
	if err := s.SetEnabled(false); err != nil {
		t.Fatal("cleanup retry", err)
	}
}
