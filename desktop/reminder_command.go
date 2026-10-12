package main

import (
	"context"
	"errors"
	"github.com/FelixBaek/inkism/desktop/internal/reminders"
	"os"
	"time"
)

// Runs before any normal flags, remembered-library lookup, Rust startup, or UI.
// Helpers have only an opaque cache ID; no command opens a note library.
func reminderCommand(args []string) (bool, error) {
	if len(args) == 0 || (args[0] != "--reminder-cache" && args[0] != "--remove-reminder-tasks") {
		return false, nil
	}
	root, err := reminders.CacheRoot()
	if err != nil {
		return true, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if args[0] == "--reminder-cache" {
		if len(args) != 2 {
			return true, errors.New("opaque reminder cache ID required")
		}
		cache := reminders.Background{Root: root, ID: args[1]}
		return true, cache.Fire(ctx, time.Now(), reminders.Notify)
	}
	if len(args) != 1 {
		return true, errors.New("unexpected reminder cleanup arguments")
	}
	executable, err := os.Executable()
	if err != nil {
		return true, err
	}
	scheduler, err := reminders.NativeScheduler(executable)
	if err != nil {
		return true, err
	}
	return true, reminders.RemoveOwnedTasks(ctx, root, scheduler)
}
