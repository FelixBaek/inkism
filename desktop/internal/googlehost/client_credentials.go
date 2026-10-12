package googlehost

import (
	"encoding/json"
	"os"
)

// The public client config remains ID-only. Registration credentials are held
// separately in the Windows user's DPAPI store, bound to that specific ID.
type clientCredentials struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

func validClientSecret(secret string) bool {
	if len(secret) == 0 || len(secret) > 1024 {
		return false
	}
	for _, ch := range secret {
		if ch < 0x21 || ch > 0x7e {
			return false
		}
	}
	return true
}

func (s FileStore) SaveClientSecret(clientID, secret string) error {
	if !clientIDPattern.MatchString(clientID) || !validClientSecret(secret) {
		return ErrPolicy
	}
	raw, err := json.Marshal(clientCredentials{clientID, secret})
	if err != nil {
		return ErrPolicy
	}
	defer clear(raw)
	return s.saveProtected(raw)
}

func (s FileStore) LoadClientSecret(clientID string) (string, error) {
	raw, err := boundedFile(s.Path, 16384)
	if os.IsNotExist(err) {
		return "", nil // Keep compatibility with registrations needing no secret.
	}
	if err != nil || s.Unprotect == nil {
		return "", ErrPolicy
	}
	plain, err := s.Unprotect(raw)
	if err != nil {
		return "", ErrPolicy
	}
	defer clear(plain)
	var credential clientCredentials
	if strictJSON(plain, &credential) != nil || credential.ClientID != clientID || !validClientSecret(credential.ClientSecret) {
		return "", ErrPolicy
	}
	return credential.ClientSecret, nil
}
