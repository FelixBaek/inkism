//go:build !windows

package bridge

import "os/exec"

func hideWindow(cmd *exec.Cmd) {
	// No-op: child processes open no console window outside Windows.
}
