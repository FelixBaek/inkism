package relay

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	recoveryClientID  = "123456-synthetic.apps.googleusercontent.com"
	recoverySubject   = "synthetic-subject"
	recoveryAuthToken = "0123456789abcdef0123456789abcdef"
	jwksEndpoint      = "https://www.googleapis.com/oauth2/v3/certs"
)

// The googleauth client's http field is not accessible from this package, so
// the JWKS endpoint is answered by temporarily replacing http.DefaultTransport.
type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func rsaKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	k, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	return k
}

func signToken(t *testing.T, k *rsa.PrivateKey, claims map[string]any, alg string) string {
	t.Helper()
	a, _ := json.Marshal(map[string]any{"alg": alg, "kid": "synthetic"})
	b, _ := json.Marshal(claims)
	s := base64.RawURLEncoding.EncodeToString(a) + "." + base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(s))
	sig, e := rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, sum[:])
	if e != nil {
		t.Fatal(e)
	}
	return s + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func bearerToken(t *testing.T, k *rsa.PrivateKey, mutate func(map[string]any)) string {
	t.Helper()
	cl := map[string]any{"iss": "https://accounts.google.com", "sub": recoverySubject, "aud": recoveryClientID, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix()}
	if mutate != nil {
		mutate(cl)
	}
	return signToken(t, k, cl, "RS256")
}

func installJWKS(t *testing.T, k *rsa.PrivateKey) {
	t.Helper()
	original := http.DefaultTransport
	http.DefaultTransport = transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != jwksEndpoint {
			return nil, errors.New("unexpected external request: " + r.URL.String())
		}
		body, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kid": "synthetic", "alg": "RS256", "kty": "RSA", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(k.N.Bytes()), "e": "AQAB"}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header)}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = original })
}

func openRelay(t *testing.T, path string) *Relay {
	t.Helper()
	r, err := Open(path, recoveryAuthToken)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return r
}

func enableRecovery(t *testing.T, r *Relay, subject string, master []byte) {
	t.Helper()
	if err := r.EnableOwnerRecovery(recoveryClientID, subject, master); err != nil {
		t.Fatal(err)
	}
}

func recoveryCall(t *testing.T, r *Relay, method, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var payload io.Reader
	if body != "" {
		payload = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, "/v1/recovery/key", payload)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	out := httptest.NewRecorder()
	r.ServeHTTP(out, req)
	return out
}

func vaultEnvelope(t *testing.T, r *Relay) []byte {
	t.Helper()
	var stored []byte
	if err := r.db.View(func(tx *bolt.Tx) error {
		stored = append([]byte(nil), tx.Bucket(recoveryBucket).Get(recoveryVault)...)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return stored
}

func randomBytes(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		t.Fatal(e)
	}
	return b
}

func TestRecoveryOwnerGetPutSealingAndIdempotence(t *testing.T) {
	k := rsaKey(t)
	installJWKS(t, k)
	r := openRelay(t, filepath.Join(t.TempDir(), "relay.db"))
	enableRecovery(t, r, recoverySubject, randomBytes(t, 32))
	vaultKey := randomBytes(t, 32)
	encoded := base64.StdEncoding.EncodeToString(vaultKey)
	put := func(key string) *httptest.ResponseRecorder {
		return recoveryCall(t, r, "PUT", bearerToken(t, k, nil), `{"key":"`+key+`"}`)
	}
	if out := recoveryCall(t, r, "GET", bearerToken(t, k, nil), ""); out.Code != 404 {
		t.Fatal("unregistered key served:", out.Code, out.Body.String())
	}
	if out := recoveryCall(t, r, "POST", bearerToken(t, k, nil), `{"key":"x"}`); out.Code != 405 {
		t.Fatal("method guard:", out.Code)
	}
	if out := recoveryCall(t, r, "GET", "", ""); out.Code != 401 {
		t.Fatal("anonymous request accepted:", out.Code)
	}
	if out := put(encoded); out.Code != 200 {
		t.Fatal(out.Code, out.Body.String())
	}
	var got struct {
		Key   string `json:"key"`
		Token string `json:"token"`
	}
	out := recoveryCall(t, r, "GET", bearerToken(t, k, nil), "")
	if out.Code != 200 || json.Unmarshal(out.Body.Bytes(), &got) != nil || got.Token != recoveryAuthToken {
		t.Fatal(out.Code, out.Body.String())
	}
	if decoded, e := base64.StdEncoding.DecodeString(got.Key); e != nil || !bytes.Equal(decoded, vaultKey) {
		t.Fatal("recovered key differs")
	}
	// The database stores only the sealed envelope, never the plaintext key.
	data, e := os.ReadFile(r.db.Path())
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(data, vaultKey) || bytes.Contains(data, []byte(encoded)) {
		t.Fatal("plaintext recovery key persisted")
	}
	if envelope := vaultEnvelope(t, r); !bytes.HasPrefix(envelope, escrowMagic) || bytes.Contains(envelope, vaultKey) {
		t.Fatal("vault envelope leaks the key")
	}
	// Re-registering the identical key is idempotent; a different key conflicts.
	if out := put(encoded); out.Code != 200 {
		t.Fatal("same key rejected:", out.Code, out.Body.String())
	}
	other := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x5a}, 32))
	if out := put(other); out.Code != 409 {
		t.Fatal("different key accepted:", out.Code, out.Body.String())
	}
	out = recoveryCall(t, r, "GET", bearerToken(t, k, nil), "")
	json.Unmarshal(out.Body.Bytes(), &got)
	if out.Code != 200 || got.Key != encoded {
		t.Fatal("key replaced after conflict")
	}
}

func TestRecoveryRejectsForeignTokensWithoutMutation(t *testing.T) {
	k, forged := rsaKey(t), rsaKey(t)
	installJWKS(t, k)
	r := openRelay(t, filepath.Join(t.TempDir(), "relay.db"))
	enableRecovery(t, r, recoverySubject, randomBytes(t, 32))
	encoded := base64.StdEncoding.EncodeToString(randomBytes(t, 32))
	if out := recoveryCall(t, r, "PUT", bearerToken(t, k, nil), `{"key":"`+encoded+`"}`); out.Code != 200 {
		t.Fatal(out.Code, out.Body.String())
	}
	cases := []struct {
		name   string
		token  string
		status int
	}{
		{"wrong-owner", bearerToken(t, k, func(c map[string]any) { c["sub"] = "other-subject" }), 403},
		{"forged", bearerToken(t, forged, nil), 401},
		{"expired", bearerToken(t, k, func(c map[string]any) { c["exp"] = time.Now().Unix() - 1 }), 401},
		{"wrong-aud", bearerToken(t, k, func(c map[string]any) { c["aud"] = "999999-bad.apps.googleusercontent.com" }), 401},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, method := range []string{"GET", "PUT"} {
				if out := recoveryCall(t, r, method, tc.token, `{"key":"`+encoded+`"}`); out.Code != tc.status {
					t.Fatal(method, out.Code, out.Body.String())
				}
			}
		})
	}
	var got struct {
		Key string `json:"key"`
	}
	out := recoveryCall(t, r, "GET", bearerToken(t, k, nil), "")
	json.Unmarshal(out.Body.Bytes(), &got)
	if out.Code != 200 || got.Key != encoded {
		t.Fatal("recovery key mutated by rejected requests")
	}
}

func TestRecoveryRestartsPreserveRegisteredKey(t *testing.T) {
	k := rsaKey(t)
	installJWKS(t, k)
	master := randomBytes(t, 32)
	path := filepath.Join(t.TempDir(), "relay.db")
	r := openRelay(t, path)
	enableRecovery(t, r, recoverySubject, master)
	encoded := base64.StdEncoding.EncodeToString(randomBytes(t, 32))
	if out := recoveryCall(t, r, "PUT", bearerToken(t, k, nil), `{"key":"`+encoded+`"}`); out.Code != 200 {
		t.Fatal(out.Code, out.Body.String())
	}
	r.Close()
	reopened := openRelay(t, path)
	enableRecovery(t, reopened, recoverySubject, master)
	var got struct {
		Key string `json:"key"`
	}
	out := recoveryCall(t, reopened, "GET", bearerToken(t, k, nil), "")
	if out.Code != 200 || json.Unmarshal(out.Body.Bytes(), &got) != nil || got.Key != encoded {
		t.Fatal("registered key lost on restart:", out.Code, out.Body.String())
	}
}

func TestRecoveryStartupRejectionsLeaveStoredDataIntact(t *testing.T) {
	k := rsaKey(t)
	installJWKS(t, k)
	master, wrongMaster := randomBytes(t, 32), randomBytes(t, 32)
	path := filepath.Join(t.TempDir(), "relay.db")
	r := openRelay(t, path)
	enableRecovery(t, r, recoverySubject, master)
	encoded := base64.StdEncoding.EncodeToString(randomBytes(t, 32))
	if out := recoveryCall(t, r, "PUT", bearerToken(t, k, nil), `{"key":"`+encoded+`"}`); out.Code != 200 {
		t.Fatal(out.Code, out.Body.String())
	}
	envelope := vaultEnvelope(t, r)
	r.Close()
	// A different subject must not silently replace the account binding.
	bad := openRelay(t, path)
	if err := bad.EnableOwnerRecovery(recoveryClientID, "other-subject", master); err == nil {
		t.Fatal("conflicting subject accepted")
	}
	if out := recoveryCall(t, bad, "GET", bearerToken(t, k, nil), ""); out.Code != 404 {
		t.Fatal("recovery served after failed enable:", out.Code)
	}
	bad.Close()
	// A wrong master key cannot open the existing escrow.
	bad = openRelay(t, path)
	if err := bad.EnableOwnerRecovery(recoveryClientID, recoverySubject, wrongMaster); err == nil {
		t.Fatal("wrong master key accepted")
	}
	if out := recoveryCall(t, bad, "GET", bearerToken(t, k, nil), ""); out.Code != 404 {
		t.Fatal("recovery served after failed enable:", out.Code)
	}
	bad.Close()
	// Invalid configuration lengths are rejected outright.
	bad = openRelay(t, path)
	if err := bad.EnableOwnerRecovery(recoveryClientID, recoverySubject, master[:31]); err == nil {
		t.Fatal("short master key accepted")
	}
	bad.Close()
	// Nothing above mutated the stored envelope; the original key still works.
	good := openRelay(t, path)
	enableRecovery(t, good, recoverySubject, master)
	if after := vaultEnvelope(t, good); !bytes.Equal(envelope, after) {
		t.Fatal("vault envelope changed")
	}
	var got struct {
		Key string `json:"key"`
	}
	out := recoveryCall(t, good, "GET", bearerToken(t, k, nil), "")
	if out.Code != 200 || json.Unmarshal(out.Body.Bytes(), &got) != nil || got.Key != encoded {
		t.Fatal("recovery key lost after rejected startups:", out.Code, out.Body.String())
	}
}
