// Package googleauth implements an ephemeral Google desktop OIDC login.
// Tokens are never persisted or returned to the renderer. Trusted host callers
// may consume an ephemeral ID token for explicitly enabled server recovery.
package googleauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotConfigured = errors.New("Google desktop client ID is not configured")
	ErrBusy          = errors.New("Google login is already in progress")
	ErrCancelled     = errors.New("Google login was cancelled")
	ErrInvalidToken  = errors.New("Google identity could not be verified")
	ErrProvider      = errors.New("Google login provider request failed")
)

const authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
const tokenEndpoint = "https://oauth2.googleapis.com/token"
const keysEndpoint = "https://www.googleapis.com/oauth2/v3/certs"

var clientPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$`)

type Identity struct {
	Issuer        string `json:"issuer"`
	Subject       string `json:"subject"`
	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name,omitempty"`
}
type Client struct {
	id      string
	secret  string
	open    func(string) error
	http    *http.Client
	mu      sync.Mutex
	cancel  context.CancelFunc
	timeout time.Duration
}

func New(clientID string, openBrowser func(string) error) (*Client, error) {
	return NewWithClientSecret(clientID, "", openBrowser)
}

// NewWithClientSecret accepts a locally protected registration credential.
// It is sent only to Google's token endpoint, never to the browser or renderer.
func NewWithClientSecret(clientID, clientSecret string, openBrowser func(string) error) (*Client, error) {
	if !clientPattern.MatchString(clientID) {
		return nil, ErrNotConfigured
	}
	if len(clientSecret) > 1024 {
		return nil, ErrNotConfigured
	}
	for _, ch := range clientSecret {
		if ch < 0x21 || ch > 0x7e {
			return nil, ErrNotConfigured
		}
	}
	if openBrowser == nil {
		return nil, errors.New("system browser opener required")
	}
	return &Client{id: clientID, secret: clientSecret, open: openBrowser, timeout: 3 * time.Minute, http: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) Cancel() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
	}
}
func random() (string, error) {
	b := make([]byte, 32)
	_, e := rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b), e
}

const invalidCallback = "Invalid callback"

type oauthCallback struct {
	code   string
	denied bool
}

// callbackHandler accepts exactly one well-formed redirect for state.
func callbackHandler(host, state string, result chan<- oauthCallback) http.HandlerFunc {
	var once sync.Once
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		if r.Method != "GET" || r.URL.Path != "/oauth2/callback" || r.Host != host || len(r.URL.RawQuery) > 8192 {
			http.Error(w, invalidCallback, 400)
			return
		}
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(q["state"]) != 1 || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(state)) != 1 {
			http.Error(w, invalidCallback, 400)
			return
		}
		if !validCallbackQuery(q) {
			http.Error(w, invalidCallback, 400)
			return
		}
		accepted := false
		once.Do(func() { accepted = true; result <- oauthCallback{q.Get("code"), q.Get("error") != ""} })
		if !accepted {
			http.Error(w, "Callback already consumed", 409)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, "Inkism received the sign-in response. You can close this tab.")
	}
}

// validCallbackQuery requires exactly one nonempty code or error.
func validCallbackQuery(q url.Values) bool {
	codeValues, hasCode := q["code"]
	errorValues, hasError := q["error"]
	if hasCode == hasError {
		return false
	}
	if hasCode {
		return len(codeValues) == 1 && codeValues[0] != ""
	}
	return len(errorValues) == 1 && errorValues[0] != ""
}

// loginSecrets returns fresh state, nonce and PKCE verifier values.
func loginSecrets() (state, nonce, verifier string, err error) {
	if state, err = random(); err != nil {
		return
	}
	if nonce, err = random(); err != nil {
		return
	}
	verifier, err = random()
	return
}

func (c *Client) Login(parent context.Context) (Identity, error) {
	identity, _, err := c.LoginWithIDToken(parent)
	return identity, err
}

// LoginWithIDToken is host-only. The token must not enter RPC responses,
// policy files, logs or command lines; discard it after the recovery request.
func (c *Client) LoginWithIDToken(parent context.Context) (Identity, string, error) {
	c.mu.Lock()
	if c.cancel != nil {
		c.mu.Unlock()
		return Identity{}, "", ErrBusy
	}
	ctx, cancel := context.WithTimeout(parent, c.timeout)
	c.cancel = cancel
	c.mu.Unlock()
	defer func() { cancel(); c.mu.Lock(); c.cancel = nil; c.mu.Unlock() }()
	if ctx.Err() != nil {
		return Identity{}, "", ErrCancelled
	}
	state, nonce, verifier, e := loginSecrets()
	if e != nil {
		return Identity{}, "", e
	}
	listener, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		return Identity{}, "", errors.New("Google callback listener unavailable")
	}
	redirect := "http://" + listener.Addr().String() + "/oauth2/callback"
	result := make(chan oauthCallback, 1)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 16 << 10, ErrorLog: log.New(io.Discard, "", 0)}
	server.Handler = callbackHandler(listener.Addr().String(), state, result)
	go func() { _ = server.Serve(listener) }()
	defer server.Close()
	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{"client_id": {c.id}, "redirect_uri": {redirect}, "response_type": {"code"}, "scope": {"openid"}, "state": {state}, "nonce": {nonce}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"}, "access_type": {"online"}, "prompt": {"select_account"}}
	if e = c.open(authEndpoint + "?" + q.Encode()); e != nil {
		return Identity{}, "", errors.New("system browser could not be opened")
	}
	var cb oauthCallback
	select {
	case <-ctx.Done():
		return Identity{}, "", ErrCancelled
	case cb = <-result:
	}
	if cb.denied {
		return Identity{}, "", ErrCancelled
	}
	if ctx.Err() != nil {
		return Identity{}, "", ErrCancelled
	}
	form := url.Values{"client_id": {c.id}, "code": {cb.code}, "redirect_uri": {redirect}, "grant_type": {"authorization_code"}, "code_verifier": {verifier}}
	if c.secret != "" {
		form.Set("client_secret", c.secret)
	}
	req, _ := http.NewRequestWithContext(ctx, "POST", tokenEndpoint, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var response struct {
		IDToken string `json:"id_token"`
	}
	if e = c.request(req, &response); e != nil {
		return Identity{}, "", e
	}
	identity, e := c.verify(ctx, response.IDToken, nonce)
	if ctx.Err() != nil {
		return Identity{}, "", ErrCancelled
	}
	if e != nil {
		return Identity{}, "", e
	}
	return identity, response.IDToken, nil
}
func (c *Client) request(req *http.Request, out any) error {
	response, e := c.http.Do(req)
	if e != nil {
		if req.Context().Err() != nil {
			return ErrCancelled
		}
		return ErrProvider
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return ErrProvider
	}
	b, e := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if e != nil || len(b) > 1<<20 {
		return ErrProvider
	}
	if json.Unmarshal(b, out) != nil {
		return ErrProvider
	}
	return nil
}
