//go:build !windows

package reminders

import "errors"

func NativeScheduler(string) (Scheduler, error) {
	return nil, errors.New("background reminders require Windows")
}
