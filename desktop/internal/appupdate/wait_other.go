//go:build !windows

package appupdate

import (
	"errors"
	"syscall"
	"time"
)

func waitPID(pid int, timeout time.Duration) error {
	for deadline := time.Now().Add(timeout); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if syscall.Kill(pid, 0) == syscall.ESRCH {
			return nil
		}
	}
	return errors.New("timeout")
}
