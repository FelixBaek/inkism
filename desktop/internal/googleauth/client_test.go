package googleauth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testID = "123456-synthetic.apps.googleusercontent.com"

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, v any) *http.Response {
	b, _ := json.Marshal(v)
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(string(b))), Header: make(http.Header)}
}
func key(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	k, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	return k
}
func signed(t *testing.T, k *rsa.PrivateKey, claims map[string]any, alg string) string {
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
func claims(nonce string) map[string]any {
	return map[string]any{"iss": "https://accounts.google.com", "sub": "synthetic-subject", "aud": testID, "nonce": nonce, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "email": "synthetic@example.invalid", "email_verified": true, "name": "Synthetic User"}
}
func jwks(k *rsa.PrivateKey) any {
	return map[string]any{"keys": []any{map[string]any{"kid": "synthetic", "alg": "RS256", "kty": "RSA", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(k.N.Bytes()), "e": "AQAB"}}}
}
func callback(t *testing.T, auth *url.URL, values url.Values) int {
	t.Helper()
	r, e := http.Get(auth.Query().Get("redirect_uri") + "?" + values.Encode())
	if e != nil {
		t.Fatal(e)
	}
	defer r.Body.Close()
	_, _ = io.Copy(io.Discard, r.Body)
	if r.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("callback cache policy")
	}
	return r.StatusCode
}
func TestLoginPKCEStateNonceAndReplay(t *testing.T) {
	k := key(t)
	var auth *url.URL
	var calls atomic.Int32
	c, _ := New(testID, func(raw string) error {
		auth, _ = url.Parse(raw)
		q := auth.Query()
		if auth.Scheme+"://"+auth.Host+auth.Path != authEndpoint || q.Get("scope") != "openid" || q.Get("access_type") != "online" || q.Get("code_challenge_method") != "S256" || q.Get("nonce") == q.Get("state") {
			t.Fatal("authorization contract")
		}
		if !strings.HasPrefix(q.Get("redirect_uri"), "http://127.0.0.1:") {
			t.Fatal("non-loopback redirect")
		}
		if callback(t, auth, url.Values{"state": {"wrong"}, "code": {"code"}}) != 400 {
			t.Fatal("wrong state accepted")
		}
		if callback(t, auth, url.Values{"state": {q.Get("state"), q.Get("state")}, "code": {"code"}}) != 400 {
			t.Fatal("duplicate state accepted")
		}
		values := url.Values{"state": {q.Get("state")}, "code": {"synthetic-code"}}
		if callback(t, auth, values) != 200 || callback(t, auth, values) != 409 {
			t.Fatal("callback replay")
		}
		return nil
	})
	c.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		switch r.URL.String() {
		case tokenEndpoint:
			_ = r.ParseForm()
			sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if base64.RawURLEncoding.EncodeToString(sum[:]) != auth.Query().Get("code_challenge") || r.Form.Get("redirect_uri") != auth.Query().Get("redirect_uri") || r.Form.Get("client_secret") != "" || r.Form.Get("code") != "synthetic-code" {
				t.Fatal("token form")
			}
			return response(200, map[string]any{"id_token": signed(t, k, claims(auth.Query().Get("nonce")), "RS256"), "access_token": "ignored", "refresh_token": "ignored"}), nil
		case keysEndpoint:
			return response(200, jwks(k)), nil
		default:
			t.Fatal("unexpected endpoint")
			return nil, nil
		}
	})
	id, e := c.Login(context.Background())
	if e != nil || id.Subject != "synthetic-subject" || !id.EmailVerified || calls.Load() != 2 {
		t.Fatal(id, e, calls.Load())
	}
	// Listener lifecycle ends with login; the response cannot be replayed later.
	hc := &http.Client{Timeout: time.Second}
	if r, e := hc.Get(auth.Query().Get("redirect_uri")); e == nil {
		r.Body.Close()
		t.Fatal("callback listener remains open")
	}
}
func TestClaimsAndSignatureFailures(t *testing.T) {
	k := key(t)
	wrong := key(t)
	cases := map[string]func(map[string]any){"issuer": func(c map[string]any) { c["iss"] = "https://attacker.invalid" }, "aud": func(c map[string]any) { c["aud"] = "other" }, "expired": func(c map[string]any) { c["exp"] = time.Now().Unix() - 1 }, "nonce": func(c map[string]any) { c["nonce"] = "other" }, "sub": func(c map[string]any) { c["sub"] = "" }, "future-issued": func(c map[string]any) { c["iat"] = time.Now().Unix() + 3600 }, "future-nbf": func(c map[string]any) { c["nbf"] = time.Now().Unix() + 3600 }, "azp": func(c map[string]any) { c["azp"] = "other" }, "multi-aud-no-azp": func(c map[string]any) { c["aud"] = []string{testID, "other"} }, "float-exp": func(c map[string]any) { c["exp"] = 1.5 }}
	c, _ := New(testID, func(string) error { return nil })
	c.http.Transport = transport(func(r *http.Request) (*http.Response, error) { return response(200, jwks(k)), nil })
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cl := claims("nonce")
			mutate(cl)
			if _, e := c.verify(context.Background(), signed(t, k, cl, "RS256"), "nonce"); !errors.Is(e, ErrInvalidToken) {
				t.Fatal(e)
			}
		})
	}
	for name, token := range map[string]string{"signature": signed(t, wrong, claims("nonce"), "RS256"), "none-alg": signed(t, k, claims("nonce"), "none"), "malformed": "bad.jwt", "oversize": strings.Repeat("x", 65537)} {
		t.Run(name, func(t *testing.T) {
			if _, e := c.verify(context.Background(), token, "nonce"); !errors.Is(e, ErrInvalidToken) {
				t.Fatal(e)
			}
		})
	}
	cl := claims("nonce")
	cl["aud"] = []string{testID, "other"}
	cl["azp"] = testID
	if _, e := c.verify(context.Background(), signed(t, k, cl, "RS256"), "nonce"); e != nil {
		t.Fatal(e)
	}
}
func TestCancelConcurrencyTimeoutAndRetry(t *testing.T) {
	opened := make(chan string, 2)
	c, _ := New(testID, func(s string) error { opened <- s; return nil })
	done := make(chan error, 1)
	go func() { _, e := c.Login(context.Background()); done <- e }()
	<-opened
	if _, e := c.Login(context.Background()); !errors.Is(e, ErrBusy) {
		t.Fatal(e)
	}
	c.Cancel()
	if e := <-done; !errors.Is(e, ErrCancelled) {
		t.Fatal(e)
	}
	c.timeout = 20 * time.Millisecond
	if _, e := c.Login(context.Background()); !errors.Is(e, ErrCancelled) {
		t.Fatal(e)
	}
}
func TestDeniedAndBrowserFailure(t *testing.T) {
	c, _ := New(testID, func(raw string) error {
		u, _ := url.Parse(raw)
		callback(t, u, url.Values{"state": {u.Query().Get("state")}, "error": {"access_denied"}})
		return nil
	})
	if _, e := c.Login(context.Background()); !errors.Is(e, ErrCancelled) {
		t.Fatal(e)
	}
	c.open = func(string) error { return errors.New("sensitive provider URL must not escape") }
	if _, e := c.Login(context.Background()); e == nil || strings.Contains(e.Error(), "sensitive") {
		t.Fatal(e)
	}
	if _, e := New("", func(string) error { return nil }); !errors.Is(e, ErrNotConfigured) {
		t.Fatal(e)
	}
}
func TestProviderErrorsAreBoundedAndRedacted(t *testing.T) {
	c, _ := New(testID, func(string) error { return nil })
	for _, status := range []int{302, 400, 401, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			c.http.Transport = transport(func(*http.Request) (*http.Response, error) {
				return response(status, map[string]string{"error": "secret-code-value"}), nil
			})
			req, _ := http.NewRequest("POST", tokenEndpoint, nil)
			var out any
			if e := c.request(req, &out); !errors.Is(e, ErrProvider) || strings.Contains(e.Error(), "secret") {
				t.Fatal(e)
			}
		})
	}
	c.http.Transport = transport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", (1<<20)+1)))}, nil
	})
	req, _ := http.NewRequest("GET", keysEndpoint, nil)
	var out any
	if e := c.request(req, &out); !errors.Is(e, ErrProvider) {
		t.Fatal(e)
	}
}

func TestCancelDuringTokenExchange(t *testing.T) {
	entered := make(chan struct{})
	done := make(chan error, 1)
	c, _ := New(testID, func(raw string) error {
		u, _ := url.Parse(raw)
		callback(t, u, url.Values{"state": {u.Query().Get("state")}, "code": {"synthetic"}})
		return nil
	})
	c.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
		close(entered)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	go func() { _, e := c.Login(context.Background()); done <- e }()
	<-entered
	c.Cancel()
	if e := <-done; !errors.Is(e, ErrCancelled) {
		t.Fatal(e)
	}
}
func TestCallbackRejectsWrongHostMethodAndAmbiguousCode(t *testing.T) {
	c, _ := New(testID, func(raw string) error {
		u, _ := url.Parse(raw)
		state := u.Query().Get("state")
		target := u.Query().Get("redirect_uri")
		for _, values := range []url.Values{{"state": {state}, "error": {"one", "two"}}, {"state": {state}, "code": {"one", "two"}, "error": {"denied"}}, {"state": {state}, "code": {"one", "two"}}, {"state": {state}, "code": {"one"}, "error": {"denied"}}, {"state": {state}}} {
			if callback(t, u, values) != 400 {
				t.Fatal("ambiguous callback")
			}
		}
		req, _ := http.NewRequest("GET", target+"?state="+state+"&code=one", nil)
		req.Host = "attacker.invalid"
		r, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		r.Body.Close()
		if r.StatusCode != 400 {
			t.Fatal("wrong host")
		}
		req, _ = http.NewRequest("POST", target, nil)
		r, e = http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		r.Body.Close()
		if r.StatusCode != 400 {
			t.Fatal("wrong method")
		}
		callback(t, u, url.Values{"state": {state}, "error": {"access_denied"}})
		return nil
	})
	if _, e := c.Login(context.Background()); !errors.Is(e, ErrCancelled) {
		t.Fatal(e)
	}
}

func TestSubjectRejectsSignedControlAndUnicode(t *testing.T) {
	k := key(t)
	c, _ := New(testID, func(string) error { return nil })
	c.http.Transport = transport(func(*http.Request) (*http.Response, error) { return response(200, jwks(k)), nil })
	for name, sub := range map[string]string{"nul": "subject\x00tail", "newline": "subject\ntail", "delete": "subject\x7ftail", "unicode": "계정-subject", "space": "subject tail", "too-long": strings.Repeat("a", 256)} {
		t.Run(name, func(t *testing.T) {
			cl := claims("nonce")
			cl["sub"] = sub
			if _, err := c.verify(context.Background(), signed(t, k, cl, "RS256"), "nonce"); !errors.Is(err, ErrInvalidToken) {
				t.Fatal(err)
			}
		})
	}
	cl := claims("nonce")
	cl["sub"] = strings.Repeat("a", 255)
	if _, err := c.verify(context.Background(), signed(t, k, cl, "RS256"), "nonce"); err != nil {
		t.Fatal(err)
	}
}
