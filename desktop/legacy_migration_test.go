package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateLegacyAppDataMovesFolderAndPreference(t *testing.T) {
	root := t.TempDir()
	oldDir := filepath.Join(root, "Mindbox")
	if err := os.MkdirAll(oldDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldDir, "notes.db"), []byte("db"), 0o600); err != nil {
		t.Fatal(err)
	}
	pref, _ := json.Marshal(map[string]any{"path": filepath.Join(oldDir, "notes.db"), "version": 1})
	if err := os.WriteFile(filepath.Join(oldDir, "library.json"), pref, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "Mindbox.exe", "EBWebView"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyAppData(root); err != nil {
		t.Fatal(err)
	}
	newDir := filepath.Join(root, "Inkism")
	if data, err := os.ReadFile(filepath.Join(newDir, "notes.db")); err != nil || string(data) != "db" {
		t.Fatalf("notes.db not moved: %v %q", err, data)
	}
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Fatalf("old folder still present: %v", err)
	}
	var got map[string]any
	data, _ := os.ReadFile(filepath.Join(newDir, "library.json"))
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["path"] != filepath.Join(newDir, "notes.db") || got["version"] != float64(1) {
		t.Fatalf("preference not rewritten: %v", got)
	}
	if _, err := os.Stat(filepath.Join(root, "Inkism.exe", "EBWebView")); err != nil {
		t.Fatalf("webview profile not moved: %v", err)
	}
	if err := migrateLegacyAppData(root); err != nil {
		t.Fatalf("second run should be a no-op: %v", err)
	}
}

func TestMigrateLegacyAppDataKeepsExistingNewFolder(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"Mindbox", "Inkism"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name, "notes.db"), []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateLegacyAppData(root); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Mindbox", "Inkism"} {
		if data, _ := os.ReadFile(filepath.Join(root, name, "notes.db")); string(data) != name {
			t.Fatalf("%s changed: %q", name, data)
		}
	}
}

func TestMigrateLegacyAppDataLeavesForeignLibraryPath(t *testing.T) {
	root := t.TempDir()
	oldDir := filepath.Join(root, "Mindbox")
	if err := os.MkdirAll(oldDir, 0o700); err != nil {
		t.Fatal(err)
	}
	elsewhere := filepath.Join(root, "Encrypted-Library", "notes.db")
	pref, _ := json.Marshal(map[string]any{"path": elsewhere})
	if err := os.WriteFile(filepath.Join(oldDir, "library.json"), pref, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyAppData(root); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	data, _ := os.ReadFile(filepath.Join(root, "Inkism", "library.json"))
	_ = json.Unmarshal(data, &got)
	if got["path"] != elsewhere {
		t.Fatalf("foreign path rewritten: %v", got)
	}
}
