package googlehost

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestProtectedRegistrationCredential(t *testing.T) {
	transform := func(raw []byte) ([]byte, error) {
		result := append([]byte(nil), raw...)
		for i := range result {
			result[i] ^= 0xff
		}
		return result, nil
	}
	store := FileStore{Path: filepath.Join(t.TempDir(), "credential"), Protect: transform, Unprotect: transform}
	id, secret := "123456-synthetic.apps.googleusercontent.com", "synthetic-credential"
	if got, err := store.LoadClientSecret(id); got != "" || err != nil {
		t.Fatal("missing optional credential failed")
	}
	if err := store.SaveClientSecret(id, secret); err != nil {
		t.Fatal("credential save failed")
	}
	raw, _ := os.ReadFile(store.Path)
	if bytes.Contains(raw, []byte(secret)) {
		t.Fatal("plaintext registration credential on disk")
	}
	if got, err := store.LoadClientSecret(id); got != secret || err != nil {
		t.Fatal("credential roundtrip failed")
	}
	if _, err := store.LoadClientSecret("123-other.apps.googleusercontent.com"); !errors.Is(err, ErrPolicy) {
		t.Fatal("credential accepted for a different registration")
	}
	if store.SaveClientSecret(id, "replacement") == nil {
		t.Fatal("existing credential overwritten")
	}
	after, _ := os.ReadFile(store.Path)
	if !bytes.Equal(raw, after) {
		t.Fatal("exclusive save changed existing credential")
	}
	for _, bad := range []string{`{"client_id":"123456-synthetic.apps.googleusercontent.com","client_secret":"synthetic-credential","extra":1}`, `{"client_id":"123456-synthetic.apps.googleusercontent.com","client_secret":"synthetic-credential"}{}`, `{"client_id":"123456-synthetic.apps.googleusercontent.com","client_secret":""}`, `not-json`} {
		cipher, _ := transform([]byte(bad))
		if os.WriteFile(store.Path, cipher, 0600) != nil {
			t.Fatal("fixture write failed")
		}
		if _, err := store.LoadClientSecret(id); !errors.Is(err, ErrPolicy) {
			t.Fatal("invalid protected registration credential accepted")
		}
	}
}
