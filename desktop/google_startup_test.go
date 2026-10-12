package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfiguredMissingLibraryNeverCreatesReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing", "notes.db")
	if validateProtectedLibrary(path, true, false) == nil {
		t.Fatal("configured missing library accepted")
	}
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatal("validation touched missing library")
	}
	if err := validateProtectedLibrary(path, true, true); err != nil {
		t.Fatal("explicit encrypted creation refused", err)
	}
	if err := validateProtectedLibrary(path, false, false); err != nil {
		t.Fatal("unconfigured first-run changed", err)
	}
	existing := filepath.Join(t.TempDir(), "notes.db")
	os.WriteFile(existing, []byte("preserved synthetic bytes"), 0600)
	if err := validateProtectedLibrary(existing, true, false); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(existing)
	if string(raw) != "preserved synthetic bytes" {
		t.Fatal("changed existing data")
	}
}
