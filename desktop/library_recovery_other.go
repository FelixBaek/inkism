//go:build !windows

package main

func recoverLibrarySelection(reason error) (string, error) { return "", reason }
