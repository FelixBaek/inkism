//go:build windows

package googlehost

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestSyntheticWindowsAccountBinding(t *testing.T) {
	path := filepath.Join(t.TempDir(), "google-account.dpapi")
	store := WindowsStore(path)
	if err := store.Save(account); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(account.Subject)) {
		t.Fatal("plaintext account binding")
	}
	got, exists, err := WindowsStore(path).Load()
	if err != nil || !exists || got != account {
		t.Fatal(got, exists, err)
	}
	raw[len(raw)-1] ^= 0xff
	os.WriteFile(path, raw, 0600)
	if _, _, err = store.Load(); err == nil {
		t.Fatal("corrupt DPAPI accepted")
	}
}

func TestSyntheticWindowsRegistrationCredential(t *testing.T) {
	store := WindowsStore(filepath.Join(t.TempDir(), "google-client-secret.dpapi"))
	id, secret := "123456-synthetic.apps.googleusercontent.com", "synthetic-only-client-credential"
	if store.SaveClientSecret(id, secret) != nil {
		t.Fatal("DPAPI credential save failed")
	}
	raw, err := os.ReadFile(store.Path)
	if err != nil || bytes.Contains(raw, []byte(secret)) {
		t.Fatal("DPAPI credential file absent or plaintext")
	}
	if got, err := store.LoadClientSecret(id); err != nil || got != secret {
		t.Fatal("DPAPI credential reopen failed")
	}
	raw[len(raw)-1] ^= 0xff
	if os.WriteFile(store.Path, raw, 0600) != nil {
		t.Fatal("corruption fixture write failed")
	}
	if _, err = store.LoadClientSecret(id); err == nil {
		t.Fatal("corrupt DPAPI registration credential accepted")
	}
}
