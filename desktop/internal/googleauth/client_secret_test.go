package googleauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestRegistrationSecretOnlyInTokenPost(t *testing.T) {
	secret := "synthetic-registration-credential"
	k := key(t)
	var auth *url.URL
	c, err := NewWithClientSecret(testID, secret, func(raw string) error {
		if strings.Contains(raw, secret) {
			t.Fatal("registration secret leaked to browser")
		}
		auth, _ = url.Parse(raw)
		if _, present := auth.Query()["client_secret"]; present {
			t.Fatal("registration secret field in authorization query")
		}
		if callback(t, auth, url.Values{"state": {auth.Query().Get("state")}, "code": {"synthetic-code"}}) != 200 {
			t.Fatal("callback failed")
		}
		return nil
	})
	if err != nil {
		t.Fatal("client construction failed")
	}
	c.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.String(), secret) || r.Header.Get("Authorization") != "" {
			t.Fatal("registration credential exposed in URL/header")
		}
		switch r.URL.String() {
		case tokenEndpoint:
			if r.Method != http.MethodPost || r.ParseForm() != nil || r.PostForm.Get("client_secret") != secret {
				t.Fatal("token POST lacks registration secret")
			}
			return response(200, map[string]any{"id_token": signed(t, k, claims(auth.Query().Get("nonce")), "RS256")}), nil
		case keysEndpoint:
			if r.Method != http.MethodGet {
				t.Fatal("invalid keys request")
			}
			return response(200, jwks(k)), nil
		default:
			t.Fatal("unexpected provider endpoint")
			return nil, ErrProvider
		}
	})
	if _, err = c.Login(context.Background()); err != nil {
		t.Fatal("credential-enabled login failed")
	}
}

func TestRegistrationCredentialValidation(t *testing.T) {
	for _, secret := range []string{"secret\n", " secret", "secret value", strings.Repeat("x", 1025), "비밀"} {
		if _, err := NewWithClientSecret(testID, secret, func(string) error { return nil }); !errors.Is(err, ErrNotConfigured) {
			t.Fatal("invalid registration credential accepted")
		}
	}
}
