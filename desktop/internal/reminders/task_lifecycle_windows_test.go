//go:build windows

package reminders

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// This test MUTATES Task Scheduler only after an explicit approval guard.
// It never displays a toast. A real scheduler trigger inherits the OS user
// environment, not t.Setenv; this test therefore does NOT validate timed delivery.
func TestApprovedNativeTaskLifecycle(t *testing.T) {
	if os.Getenv("INKISM_TEST_REAL_TASK_LIFECYCLE") != "I_APPROVE_ISOLATED_TASK_CHANGES" {
		t.Skip("requires explicit approval for isolated real task registration/deletion")
	}
	source := os.Getenv("INKISM_TEST_HELPER_EXE")
	if source == "" {
		t.Fatal("INKISM_TEST_HELPER_EXE must name the built Inkism application")
	}
	raw, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	executable := filepath.Join(root, "Inkism.exe")
	if err = os.WriteFile(executable, raw, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APPDATA", filepath.Join(root, "roaming"))
	t.Setenv("LOCALAPPDATA", filepath.Join(root, "local"))
	cacheRoot, err := CacheRoot()
	if err != nil {
		t.Fatal(err)
	}
	scheduler, err := NativeScheduler(executable)
	if err != nil {
		t.Fatal(err)
	}
	id, err := NewCacheID()
	if err != nil {
		t.Fatal(err)
	}
	bg := &Background{Root: cacheRoot, ID: id, Scheduler: scheduler}
	ctx := context.Background()
	// Register cleanup before the first mutation. No wildcard or other ID is used.
	t.Cleanup(func() {
		if _, e := bg.Disable(context.Background()); e != nil {
			t.Errorf("CLEANUP REQUIRED: exact task %s%s, exe %s: %v", TaskPrefix, id, executable, e)
		}
	})
	if err = bg.Enable(ctx); err != nil {
		t.Fatal(err)
	}
	if err = bg.Enable(ctx); err != nil {
		t.Fatal("repeated enable", err)
	}
	task, err := (nativeTaskStore{}).Get(ctx, TaskPrefix+id)
	if err != nil {
		t.Fatal(err)
	}
	native := scheduler.(*TaskScheduler)
	if err = native.verify(id, task); err != nil {
		t.Fatal(err)
	}
	// Future-only cache makes both manual helper and any incidental OS trigger silent.
	seedCache(t, bg, []Schedule{{ID: strings.Repeat("a", 64), At: maxTimestamp, Hours: 24}})
	run := func(args ...string) {
		t.Helper()
		runCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		cmd := exec.CommandContext(runCtx, executable, args...)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if e := cmd.Run(); e != nil {
			t.Fatal("hidden cache-only helper", e)
		}
	}
	run("--reminder-cache", id)
	for _, name := range []string{"notes.db", "library.json", "keys.json"} {
		if _, e := os.Stat(filepath.Join(root, "roaming", "Inkism", name)); !os.IsNotExist(e) {
			t.Fatal("unexpected library initialization", name, e)
		}
	}
	// Recurrence behavior uses a synthetic clock and callback, never native toast.
	delivered := 0
	if err = bg.Fire(ctx, time.UnixMilli(maxTimestamp), func() error { delivered++; return nil }); err != nil {
		t.Fatal(err)
	}
	if err = bg.Fire(ctx, time.UnixMilli(maxTimestamp), func() error { delivered++; return nil }); err != nil || delivered != 1 {
		t.Fatal("repeat receipt", delivered, err)
	}
	if _, err = bg.Disable(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = (nativeTaskStore{}).Get(ctx, TaskPrefix+id); !errors.Is(err, ErrTaskNotFound) {
		t.Fatal("task remains after off", err)
	}
	if err = bg.Enable(ctx); err != nil {
		t.Fatal(err)
	}
	run("--remove-reminder-tasks")
	if _, err = (nativeTaskStore{}).Get(ctx, TaskPrefix+id); !errors.Is(err, ErrTaskNotFound) {
		t.Fatal("task remains after uninstall cleanup", err)
	}
	t.Log("registered/read/disabled/re-registered/uninstall-cleaned exact isolated task; timed trigger/toast NOT tested")
}
