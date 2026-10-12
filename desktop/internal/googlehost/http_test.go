package googlehost

import (
	"context"
	"encoding/json"
	"github.com/FelixBaek/inkism/desktop/internal/bridge"
	"net/http/httptest"
	"strings"
	"testing"
)

type forbiddenCaller struct{ t *testing.T }

func (c forbiddenCaller) Call(context.Context, json.RawMessage) (json.RawMessage, error) {
	c.t.Fatal("locked HTTP reached engine")
	return nil, nil
}
func TestConfiguredMissingClientBlocksEveryHostDataPath(t *testing.T) {
	c := New(nil, &memoryStore{identity: account, exists: true})
	gate := c.Attach(func() error { return nil }, func(context.Context) error { t.Fatal("resume without Google"); return nil })
	h := &bridge.Handler{Gate: gate, Security: c, Engine: forbiddenCaller{t}, Host: "inkism.local"}
	for _, path := range []string{"/api/rpc", "/api/attachments", "/api/upload-access", "/api/clipper", "/api/reminders/settings", "/api/publications", "/api/backup", "/api/export/html"} {
		r := httptest.NewRequest("POST", "http://inkism.local"+path, strings.NewReader(`{}`))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 423 {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
	r := httptest.NewRequest("GET", "http://inkism.local/api/security/status", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"locked":true`) || !strings.Contains(w.Body.String(), `"setup_required":true`) {
		t.Fatal(w.Code, w.Body.String())
	}
	r = httptest.NewRequest("POST", "http://inkism.local/api/security/login", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	r = httptest.NewRequest("POST", "http://inkism.local/api/security/cancel", nil)
	r.Header.Set("Origin", "https://evil.invalid")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin auth control accepted")
	}
}
