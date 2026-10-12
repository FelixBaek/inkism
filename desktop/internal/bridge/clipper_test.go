package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

type clipCaller struct {
	fail  bool
	calls int
	last  string
}

func (c *clipCaller) Call(_ context.Context, p json.RawMessage) (json.RawMessage, error) {
	c.calls++
	c.last = string(p)
	if c.fail {
		return nil, errors.New("fail")
	}
	return json.RawMessage(`{"ok":true,"data":{"id":"saved"}}`), nil
}
func TestClipperSessionBoundaryAndSaveRecovery(t *testing.T) {
	gate := NewSessionGate(false, func() error { return nil }, func(context.Context) error { return nil })
	c, e := StartClipper(gate)
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	access, e := c.pair(strings.Repeat("a", 32))
	if e != nil {
		t.Fatal(e)
	}
	receive := func(origin, token, path, body string) *httptest.ResponseRecorder {
		q := httptest.NewRequest("POST", "http://"+c.host+path, strings.NewReader(body))
		q.Header.Set("Origin", origin)
		q.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		c.receive(w, q)
		return w
	}
	body := `{"id":"capture-1234567890","title":"captured","url":"https://example.com/page#fragment","html":"<p>safe</p><script>bad()</script><img src='file:///secret'>"}`
	for _, v := range []struct{ origin, token, path string }{{"https://evil.test", access.Token, "/capture"}, {"chrome-extension://" + strings.Repeat("b", 32), access.Token, "/capture"}, {c.origin, "bad", "/capture"}, {c.origin, access.Token, "/api/rpc"}} {
		if receive(v.origin, v.token, v.path, body).Code != 403 {
			t.Fatal(v)
		}
	}
	if receive(c.origin, access.Token, "/capture", body).Code != 202 {
		t.Fatal("capture failed")
	}
	if receive(c.origin, access.Token, "/capture", body).Code != 200 {
		t.Fatal("repeated capture not deduplicated")
	}
	if receive(c.origin, access.Token, "/capture", strings.Replace(body, "1234567890", "9999999999", 1)).Code != 409 {
		t.Fatal("overwrote pending")
	}
	caller := &clipCaller{fail: true}
	h := &Handler{Clipper: c, Engine: caller, Gate: gate}
	command := func(body string) *httptest.ResponseRecorder {
		q := httptest.NewRequest("POST", "http://wails.localhost/api/clipper", strings.NewReader(body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, q)
		return w
	}
	accept := `{"action":"accept","id":"capture-1234567890"}`
	if command(accept).Code != 500 || c.pending == nil {
		t.Fatal("save failure lost pending")
	}
	caller.fail = false
	if command(accept).Code != 200 || c.pending != nil {
		t.Fatal("save failed")
	}
	if strings.Contains(caller.last, "bad()") || strings.Contains(caller.last, "file://") || strings.Contains(caller.last, "#fragment") {
		t.Fatal(caller.last)
	}
	if command(accept).Code != 409 || caller.calls != 2 {
		t.Fatal("repeat accept duplicated note")
	}
	if e = gate.Lock(); e != nil {
		t.Fatal(e)
	}
	if receive(c.origin, access.Token, "/capture", body).Code != 423 {
		t.Fatal("locked capture allowed")
	}
	if command(`{"action":"pair","extension":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`).Code != 423 {
		t.Fatal("locked management allowed")
	}
}
