package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type securityHTTPFake struct {
	status   SecurityStatus
	calls    atomic.Int32
	started  chan struct{}
	canceled chan struct{}
	once     sync.Once
	loginErr error
	lockErr  error
}

func (f *securityHTTPFake) Status() SecurityStatus { return f.status }
func (f *securityHTTPFake) Login(ctx context.Context) error {
	f.calls.Add(1)
	if f.started != nil {
		close(f.started)
		select {
		case <-f.canceled:
			return context.Canceled
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return f.loginErr
}
func (f *securityHTTPFake) Cancel() {
	f.calls.Add(1)
	if f.canceled != nil {
		f.once.Do(func() { close(f.canceled) })
	}
}
func (f *securityHTTPFake) Lock() error                   { f.calls.Add(1); return f.lockErr }
func (f *securityHTTPFake) Disable(context.Context) error { f.calls.Add(1); return f.loginErr }
func securityHTTPCall(h *Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://inkism.local"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	out := httptest.NewRecorder()
	h.ServeHTTP(out, req)
	return out
}

func TestSecurityAdapterHTTPRejectsUntrustedRoutesBeforeController(t *testing.T) {
	for _, route := range []string{"status", "login", "cancel", "lock", "disable"} {
		method := "POST"
		if route == "status" {
			method = "GET"
		}
		for _, tc := range []struct{ name, host, origin, site string }{
			{"wrong-host", "attacker.invalid", "", ""},
			{"wrong-origin", "inkism.local", "https://attacker.invalid", ""},
			{"wrong-port", "inkism.local", "http://inkism.local:9999", ""},
			{"opaque-origin", "inkism.local", "null", ""},
			{"cross-site", "inkism.local", "", "cross-site"},
		} {
			t.Run(route+"/"+tc.name, func(t *testing.T) {
				fake := &securityHTTPFake{status: SecurityStatus{Available: true}}
				h := &Handler{Host: "inkism.local", Security: fake}
				req := httptest.NewRequest(method, "http://"+tc.host+"/api/security/"+route, strings.NewReader("{}"))
				req.Header.Set("Origin", tc.origin)
				req.Header.Set("Sec-Fetch-Site", tc.site)
				req.Header.Set("Content-Type", "application/json")
				out := httptest.NewRecorder()
				h.ServeHTTP(out, req)
				if out.Code != 403 || fake.calls.Load() != 0 {
					t.Fatalf("status=%d calls=%d body=%s", out.Code, fake.calls.Load(), out.Body)
				}
			})
		}
	}
}

func TestSecurityAdapterHTTPRejectsMethodsAndBodiesWithoutSideEffects(t *testing.T) {
	for _, route := range []string{"login", "cancel", "lock"} {
		for _, method := range []string{"GET", "PUT", "DELETE", "OPTIONS", "HEAD"} {
			t.Run(route+"/"+method, func(t *testing.T) {
				fake := &securityHTTPFake{status: SecurityStatus{Available: true}}
				out := securityHTTPCall(&Handler{Security: fake}, method, "/api/security/"+route, "{}")
				if out.Code != 405 || fake.calls.Load() != 0 {
					t.Fatalf("%d %s", out.Code, out.Body)
				}
			})
		}
		for _, tc := range []struct {
			name, body, content string
			code                int
		}{
			{"content-type", "{}", "text/plain", 415},
			{"empty", "", "application/json", 400},
			{"null", "null", "application/json", 400},
			{"array", "[]", "application/json", 400},
			{"invalid", "{", "application/json", 400},
			{"renderer-identity", `{"subject":"attacker","email":"secret@example.invalid"}`, "application/json", 400},
			{"trailing", "{}{}", "application/json", 400},
			{"oversize", strings.Repeat(" ", 129) + "{}", "application/json", 400},
		} {
			t.Run(route+"/"+tc.name, func(t *testing.T) {
				fake := &securityHTTPFake{status: SecurityStatus{Available: true}}
				req := httptest.NewRequest("POST", "http://inkism.local/api/security/"+route, strings.NewReader(tc.body))
				req.Header.Set("Content-Type", tc.content)
				out := httptest.NewRecorder()
				(&Handler{Security: fake}).ServeHTTP(out, req)
				if out.Code != tc.code || fake.calls.Load() != 0 {
					t.Fatalf("%d %s", out.Code, out.Body)
				}
			})
		}
	}
	fake := &securityHTTPFake{status: SecurityStatus{Available: true}}
	if out := securityHTTPCall(&Handler{Security: fake}, "POST", "/api/security/unknown", "{}"); out.Code != 404 || fake.calls.Load() != 0 {
		t.Fatalf("%d %s", out.Code, out.Body)
	}
}

func TestSecurityAdapterHTTPStatusContainsOnlyPublicState(t *testing.T) {
	fake := &securityHTTPFake{status: SecurityStatus{Available: true, Configured: true, Locked: true, Provider: "google", SetupRequired: true, Pending: true}}
	out := securityHTTPCall(&Handler{Security: fake, Gate: NewSessionGate(true, nil, nil)}, "GET", "/api/security/status", "")
	if out.Code != 200 || out.Header().Get("Cache-Control") != "no-store" || out.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("%d %v", out.Code, out.Header())
	}
	var response struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"available": true, "configured": true, "locked": true, "provider": true, "setup_required": true, "pending": true}
	if !response.OK || len(response.Data) != len(allowed) {
		t.Fatalf("%s", out.Body)
	}
	for key := range response.Data {
		if !allowed[key] {
			t.Fatalf("nonpublic status field %q", key)
		}
	}
}

func TestSecurityAdapterHTTPPendingLoginDoesNotBlockStatusOrCancel(t *testing.T) {
	fake := &securityHTTPFake{status: SecurityStatus{Available: true, Configured: true, Locked: true, Pending: true}, started: make(chan struct{}), canceled: make(chan struct{})}
	engine := &fakeEngine{}
	h := &Handler{Security: fake, Gate: NewSessionGate(true, nil, nil), Engine: engine}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- securityHTTPCall(h, "POST", "/api/security/login", "{}") }()
	defer fake.Cancel()
	select {
	case <-fake.started:
	case <-time.After(time.Second):
		t.Fatal("login not started")
	}
	if out := securityHTTPCall(h, "POST", "/api/rpc", `{"op":"get","id":"private"}`); out.Code != 423 || len(engine.last) != 0 {
		t.Fatalf("pending login exposed data: %d %s", out.Code, out.Body)
	}
	controls := make(chan error, 1)
	go func() {
		if out := securityHTTPCall(h, "GET", "/api/security/status", ""); out.Code != 200 {
			controls <- errors.New("status unavailable")
			return
		}
		for i := 0; i < 2; i++ {
			if out := securityHTTPCall(h, "POST", "/api/security/cancel", "{}"); out.Code != 200 {
				controls <- errors.New("cancel unavailable")
				return
			}
		}
		controls <- nil
	}()
	select {
	case err := <-controls:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("pending login blocked status/cancel")
	}
	select {
	case out := <-done:
		if out.Code != 409 {
			t.Fatalf("%d %s", out.Code, out.Body)
		}
	case <-time.After(time.Second):
		t.Fatal("cancel did not release login")
	}
	if !h.Gate.Status().Locked {
		t.Fatal("canceled login unlocked data")
	}
}

func TestSecurityAdapterHTTPHostErrorsRemainFailures(t *testing.T) {
	for _, tc := range []struct {
		name, route       string
		available         bool
		loginErr, lockErr error
		code              int
	}{
		{"unavailable", "login", false, nil, nil, 503},
		{"busy", "login", true, errors.New("login already pending"), nil, 409},
		{"auth-failed", "login", true, errors.New("authentication failed"), nil, 409},
		{"lock-failed", "lock", true, nil, errors.New("runtime stop failed"), 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := &securityHTTPFake{status: SecurityStatus{Available: tc.available, Locked: true}, loginErr: tc.loginErr, lockErr: tc.lockErr}
			out := securityHTTPCall(&Handler{Security: fake}, "POST", "/api/security/"+tc.route, "{}")
			if out.Code != tc.code {
				t.Fatalf("%d %s", out.Code, out.Body)
			}
			if !tc.available && fake.calls.Load() != 0 {
				t.Fatal("unavailable controller invoked")
			}
		})
	}
}

func TestSecurityAdapterHTTPClientCancellationReleasesLogin(t *testing.T) {
	fake := &securityHTTPFake{status: SecurityStatus{Available: true, Locked: true}, started: make(chan struct{}), canceled: make(chan struct{})}
	h := &Handler{Security: fake, Gate: NewSessionGate(true, nil, nil)}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest("POST", "http://inkism.local/api/security/login", strings.NewReader("{}")).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { out := httptest.NewRecorder(); h.ServeHTTP(out, req); done <- out }()
	select {
	case <-fake.started:
	case <-time.After(time.Second):
		t.Fatal("login not started")
	}
	cancel()
	select {
	case out := <-done:
		if out.Code != 409 {
			t.Fatalf("%d %s", out.Code, out.Body)
		}
	case <-time.After(time.Second):
		t.Fatal("client cancellation did not release login")
	}
	if !h.Gate.Status().Locked {
		t.Fatal("canceled request unlocked data")
	}
}

func TestSecurityAdapterHTTPDisableOnlyFromUnlockedConfiguredState(t *testing.T) {
	configured := SecurityStatus{Available: true, Configured: true}
	for _, tc := range []struct {
		name   string
		status SecurityStatus
		ok     bool
	}{
		{"unlocked", configured, true},
		{"locked", SecurityStatus{Available: true, Configured: true, Locked: true}, false},
		{"not-configured", SecurityStatus{Available: true}, false},
		{"unavailable", SecurityStatus{Configured: true}, false},
	} {
		fake := &securityHTTPFake{status: tc.status}
		out := securityHTTPCall(&Handler{Host: "inkism.local", Security: fake}, "POST", "/api/security/disable", "{}")
		if (out.Code == 200) != tc.ok || fake.calls.Load() != map[bool]int32{true: 1, false: 0}[tc.ok] {
			t.Fatalf("%s: status=%d calls=%d", tc.name, out.Code, fake.calls.Load())
		}
	}
	fake := &securityHTTPFake{status: configured}
	h := &Handler{Host: "inkism.local", Security: fake}
	if securityHTTPCall(h, "GET", "/api/security/disable", "").Code == 200 || securityHTTPCall(h, "POST", "/api/security/disable", `{"skip_login":true}`).Code == 200 || fake.calls.Load() != 0 {
		t.Fatal("disable reached the controller without an empty POST")
	}
	fake = &securityHTTPFake{status: configured, loginErr: errors.New("다른 계정")}
	if out := securityHTTPCall(&Handler{Host: "inkism.local", Security: fake}, "POST", "/api/security/disable", "{}"); out.Code != 409 {
		t.Fatalf("failed re-login: %d", out.Code)
	}
}
