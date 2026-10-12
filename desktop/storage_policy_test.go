package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewLibraryEncryptionPolicy(t *testing.T) {
	root := t.TempDir()
	existing := filepath.Join(root, "existing.db")
	original := []byte("existing library must never be converted here")
	if err := os.WriteFile(existing, original, 0600); err != nil {
		t.Fatal(err)
	}
	fresh := filepath.Join(root, "new.db")
	for _, tt := range []struct {
		name, path, platform               string
		explicit, plaintext, want, wantErr bool
	}{
		{"Windows new defaults encrypted", fresh, "windows", false, false, true, false},
		{"Windows existing unchanged", existing, "windows", false, false, false, false},
		{"new plaintext opt out", fresh, "windows", false, true, false, false},
		{"existing plaintext flag unchanged", existing, "windows", false, true, false, false},
		{"Linux preview unchanged", fresh, "linux", false, false, false, false},
		{"explicit uses initializer even on existing path", existing, "windows", true, false, true, false},
		{"conflicting choices rejected", fresh, "windows", true, true, false, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, err := initializeEncryptedForPath(tt.path, tt.platform, tt.explicit, tt.plaintext)
			if (err != nil) != tt.wantErr || got != tt.want {
				t.Fatalf("got %v, %v", got, err)
			}
		})
	}
	if got, err := os.ReadFile(existing); err != nil || string(got) != string(original) {
		t.Fatalf("existing file changed: %v", err)
	}
	if _, err := os.Stat(fresh); !os.IsNotExist(err) {
		t.Fatalf("policy must not create files: %v", err)
	}
}
