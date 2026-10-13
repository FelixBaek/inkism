package googlehost

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

type ClientConfig struct {
	ClientID string `json:"client_id"`
}

var clientIDPattern = regexp.MustCompile(`^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$`)

func ReadConfig(path string) (ClientConfig, error) {
	var c ClientConfig
	raw, err := boundedFile(path, 8192)
	if err != nil {
		return c, err
	}
	if err = strictJSON(raw, &c); err != nil {
		return c, err
	}
	if !clientIDPattern.MatchString(c.ClientID) {
		return c, errors.New("invalid Google desktop client ID")
	}
	return c, nil
}

type FileStore struct {
	Path               string
	Protect, Unprotect func([]byte) ([]byte, error)
}

func (s FileStore) Load() (Identity, bool, error) {
	var identity Identity
	raw, err := boundedFile(s.Path, 16384)
	if os.IsNotExist(err) {
		return identity, false, nil
	}
	if err != nil {
		return identity, true, err
	}
	if s.Unprotect == nil {
		return identity, true, ErrUnavailable
	}
	plain, err := s.Unprotect(raw)
	if err != nil {
		return identity, true, ErrPolicy
	}
	defer func() {
		for i := range plain {
			plain[i] = 0
		}
	}()
	if strictJSON(plain, &identity) != nil || identity.Issuer != "https://accounts.google.com" || identity.Subject == "" || len(identity.Subject) > 255 {
		return Identity{}, true, ErrPolicy
	}
	return identity, true, nil
}

// Remove deletes the binding file (and the Rust host's masked-account hint).
func (s FileStore) Remove() error {
	for _, path := range []string{s.Path + ".hint", s.Path} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (s FileStore) Save(identity Identity) error {
	raw, err := json.Marshal(identity)
	if err != nil {
		return err
	}
	defer clear(raw)
	return s.saveProtected(raw)
}

func (s FileStore) saveProtected(raw []byte) error {
	if s.Protect == nil {
		return ErrUnavailable
	}
	if _, err := os.Lstat(s.Path); err == nil || !os.IsNotExist(err) {
		return errors.New("account binding already exists or is unreadable")
	}
	encrypted, err := s.Protect(raw)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(s.Path), 0700); err != nil {
		return err
	}
	// Exclusive creation never replaces an existing account. Interrupted writes
	// deliberately remain fail-closed instead of silently enabling a new account.
	f, err := os.OpenFile(s.Path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(encrypted)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	return err
}
func boundedFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errors.New("invalid configuration file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if int64(len(raw)) > limit {
		return nil, errors.New("oversized configuration")
	}
	return raw, err
}
func strictJSON(raw []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}
