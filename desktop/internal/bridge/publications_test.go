package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type publicationCaller struct {
	url     string
	trashed bool
}

func (c publicationCaller) Call(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var q map[string]any
	_ = json.Unmarshal(raw, &q)
	var data any
	if q["op"] == "sync_status" {
		data = map[string]any{"configured": true, "server_url": c.url}
	} else {
		data = map[string]any{"id": "note-id", "revision": 1, "title": "note", "html": "<p>snapshot</p><script>bad()</script><img src='file:///vault'>", "trashed": c.trashed}
	}
	v, _ := json.Marshal(map[string]any{"ok": true, "data": data})
	return v, nil
}
func TestPublicationTransportPinnedSanitizedAndNoRedirect(t *testing.T) {
	token := strings.Repeat("owner", 8)
	seen := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen++
		if r.URL.Path != "/v1/publications" || r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("wrong endpoint/auth")
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["html"] != "<p>snapshot</p>" {
			t.Error(body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`))
	}))
	defer target.Close()
	request := func(c publicationCaller, body string) *httptest.ResponseRecorder {
		h := Handler{Engine: c}
		q := httptest.NewRequest("POST", "http://wails.localhost/api/publications", strings.NewReader(body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, q)
		return w
	}
	payload := `{"action":"publish","note_id":"note-id","token":"` + token + `","days":7,"revision":1}`
	if w := request(publicationCaller{url: target.URL}, payload); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	if w := request(publicationCaller{url: target.URL, trashed: true}, payload); w.Code != 400 {
		t.Fatal("trashed note shared", w.Code)
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer redirect.Close()
	if w := request(publicationCaller{url: redirect.URL}, payload); w.Code != 502 {
		t.Fatal("redirect accepted", w.Code)
	}
	if seen != 1 {
		t.Fatal("unexpected network delivery", seen)
	}
	for _, base := range []string{"http://example.com", "file:///secret", "https://user:password@example.com", "https://example.com/path", "https://example.com?token=secret"} {
		if request(publicationCaller{url: base}, payload).Code != 400 {
			t.Fatal(base)
		}
	}
	if request(publicationCaller{url: target.URL}, strings.TrimSuffix(payload, "}")+`,"server":"http://evil.test"}`).Code != 400 {
		t.Fatal("renderer URL accepted")
	}
}
