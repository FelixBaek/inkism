package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLibraryPreferencePreservesExistingSelection(t *testing.T) {
	root := t.TempDir()
	pref := filepath.Join(root, "settings", "library.json")
	fallback := filepath.Join(root, "default.db")
	got, err := loadLibraryPreference(pref, fallback)
	if err != nil || got != fallback {
		t.Fatal(got, err)
	}
	a := filepath.Join(root, "원본.db")
	b := filepath.Join(root, "사본.db")
	for _, path := range []string{a, b} {
		if err := os.WriteFile(path, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{a, b} {
		if err := saveLibraryPreference(pref, path); err != nil {
			t.Fatal(err)
		}
		got, err := loadLibraryPreference(pref, fallback)
		if err != nil || got != path {
			t.Fatal(got, err)
		}
	}
	before, _ := os.ReadFile(pref)
	for _, bad := range []string{"relative.db", root, filepath.Join(root, "missing.db")} {
		if err := saveLibraryPreference(pref, bad); err == nil {
			t.Fatal("accepted", bad)
		}
		after, _ := os.ReadFile(pref)
		if string(after) != string(before) {
			t.Fatal("lost previous selection")
		}
	}
	if err := os.WriteFile(a+".migration-incomplete", nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := existingLibrary(a); err == nil {
		t.Fatal("incomplete copy accepted")
	}
	if err := os.Remove(b); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLibraryPreference(pref, fallback); err == nil {
		t.Fatal("missing selected library silently replaced")
	}
	if err := os.WriteFile(pref, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLibraryPreference(pref, fallback); err == nil {
		t.Fatal("malformed preference silently replaced")
	}
}
