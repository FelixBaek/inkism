//go:build windows

package appupdate

import (
	"errors"
	"os"
	"time"
)

func waitPID(pid int, timeout time.Duration) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return nil // already gone
	}
	done := make(chan struct{})
	go func() { _, _ = p.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-time.After(timeout):
		return errors.New("timeout")
	}
}
