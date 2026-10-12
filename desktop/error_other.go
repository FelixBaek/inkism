//go:build !windows

package main

func showStartupError(err error) {
	// No-op: startup errors are only shown in a dialog on Windows.
}
