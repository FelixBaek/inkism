package bridge

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const testUnsplashKey = "test-access-key-0123456789"

// fakeUnsplash answers search and download pings; the second and third hits
// point off images.unsplash.com / unsplash.com and must be filtered.
func fakeUnsplash(auth, hit *string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*auth, *hit = r.Header.Get("Authorization"), r.URL.Path
		if r.URL.Path == "/photos/abc_1/download" {
			w.Write([]byte(`{"url":"x"}`))
			return
		}
		if r.URL.Query().Get("query") == "boom" {
			http.Error(w, "bad key "+testUnsplashKey, 401)
			return
		}
		w.Write([]byte(`{"total_pages":3,"results":[
			{"id":"abc_1","alt_description":"desk","urls":{"regular":"https://images.unsplash.com/photo-1?w=1080","small":"https://images.unsplash.com/photo-1?w=400"},"user":{"name":"Kim","links":{"html":"https://unsplash.com/@kim"}}},
			{"id":"evil","urls":{"regular":"https://evil.example/p.jpg","small":"https://evil.example/p.jpg"},"user":{"name":"X","links":{"html":"https://unsplash.com/@x"}}},
			{"id":"evil2","urls":{"regular":"https://images.unsplash.com/p","small":"https://images.unsplash.com/p"},"user":{"name":"Y","links":{"html":"javascript:alert(1)"}}}]}`))
	}))
}

func unsplashCall(h *Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://127.0.0.1:1"+path, strings.NewReader(body))
	req.Header.Set("Origin", "http://127.0.0.1:1")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	out := httptest.NewRecorder()
	h.ServeHTTP(out, req)
	return out
}

func TestUnsplashProxyKeepsKeyPrivate(t *testing.T) {
	t.Setenv(unsplashEnv, "")
	var auth, hit string
	api := fakeUnsplash(&auth, &hit)
	defer api.Close()
	keyPath := filepath.Join(t.TempDir(), "notes.db.unsplash-key")
	h := &Handler{Engine: &fakeEngine{}, Host: "127.0.0.1:1", Unsplash: &Unsplash{KeyPath: keyPath, Base: api.URL}}

	// No key: search is refused with a recognizable code; status is false.
	if out := unsplashCall(h, "GET", "/api/unsplash/search?q=desk", ""); out.Code != 409 || !strings.Contains(out.Body.String(), "unsplash_key_missing") {
		t.Fatal("search without key", out.Code, out.Body.String())
	}
	if out := unsplashCall(h, "POST", "/api/unsplash/key", `{"key":"short"}`); out.Code != 400 {
		t.Fatal("malformed key accepted", out.Code)
	}
	// Saving the key answers only {configured}; the key is never echoed.
	out := unsplashCall(h, "POST", "/api/unsplash/key", `{"key":"`+testUnsplashKey+`"}`)
	if out.Code != 200 || strings.TrimSpace(out.Body.String()) != `{"data":{"configured":true},"ok":true}` {
		t.Fatal("set key", out.Code, out.Body.String())
	}
	if info, err := os.Stat(keyPath); err != nil || (runtime.GOOS != "windows" && info.Mode().Perm() != 0600) {
		t.Fatal("key file", info, err)
	}
	if out = unsplashCall(h, "GET", "/api/unsplash/key", ""); strings.Contains(out.Body.String(), testUnsplashKey) || !strings.Contains(out.Body.String(), `"configured":true`) {
		t.Fatal("status leaked or wrong", out.Body.String())
	}

	// Search sends Client-ID, filters foreign hosts, adds the referral tag.
	out = unsplashCall(h, "GET", "/api/unsplash/search?q=desk&page=2", "")
	var page struct {
		Data UnsplashPage `json:"data"`
	}
	if out.Code != 200 || json.Unmarshal(out.Body.Bytes(), &page) != nil || auth != "Client-ID "+testUnsplashKey || hit != "/search/photos" {
		t.Fatal("search", out.Code, out.Body.String(), hit)
	}
	if len(page.Data.Items) != 1 || page.Data.TotalPages != 3 || page.Data.Items[0].AuthorURL != "https://unsplash.com/@kim?"+UnsplashRef {
		t.Fatal("photos", page.Data)
	}
	if strings.Contains(out.Body.String(), testUnsplashKey) {
		t.Fatal("key leaked in search response")
	}
	// Upstream failures never forward the upstream body (which may quote the key).
	if out = unsplashCall(h, "GET", "/api/unsplash/search?q=boom", ""); out.Code != 502 || strings.Contains(out.Body.String(), testUnsplashKey) {
		t.Fatal("upstream error", out.Code, out.Body.String())
	}
	if out = unsplashCall(h, "GET", "/api/unsplash/search?q=%20", ""); out.Code != 400 {
		t.Fatal("empty query", out.Code)
	}

	// Picking pings the download endpoint; malformed ids never reach Unsplash.
	if out = unsplashCall(h, "POST", "/api/unsplash/use", `{"id":"abc_1"}`); out.Code != 200 || hit != "/photos/abc_1/download" {
		t.Fatal("use", out.Code, hit)
	}
	hit = ""
	for _, id := range []string{"../x", "a/b", "", strings.Repeat("a", 33)} {
		body, _ := json.Marshal(map[string]string{"id": id})
		if out = unsplashCall(h, "POST", "/api/unsplash/use", string(body)); out.Code != 400 || hit != "" {
			t.Fatal("bad id", id, out.Code, hit)
		}
	}
	// Cross-origin and non-JSON writes are refused.
	req := httptest.NewRequest("POST", "http://127.0.0.1:1/api/unsplash/key", strings.NewReader(`{"key":null}`))
	req.Header.Set("Origin", "http://evil.test")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatal("cross-origin key write", rec.Code)
	}
	req = httptest.NewRequest("POST", "http://127.0.0.1:1/api/unsplash/use", strings.NewReader(`{"id":"abc_1"}`))
	rec = httptest.NewRecorder()
	if h.ServeHTTP(rec, req); rec.Code != 415 {
		t.Fatal("non-JSON use", rec.Code)
	}

	// Removing the key deletes the file.
	if out = unsplashCall(h, "POST", "/api/unsplash/key", `{"key":null}`); !strings.Contains(out.Body.String(), `"configured":false`) {
		t.Fatal("remove", out.Body.String())
	}
	if _, err := os.Stat(keyPath); !os.IsNotExist(err) {
		t.Fatal("key file kept", err)
	}
	// The environment key wins and is never written to disk.
	t.Setenv(unsplashEnv, testUnsplashKey)
	if out = unsplashCall(h, "GET", "/api/unsplash/key", ""); !strings.Contains(out.Body.String(), `"configured":true`) {
		t.Fatal("env key", out.Body.String())
	}
}

func TestRestoreRemapsNotebookCoverAttachments(t *testing.T) {
	notes := map[string]json.RawMessage{"notebooks": json.RawMessage(`[
		{"id":"a","name":"A","cover":{"kind":"attachment","url":"/api/attachments/old-1"}},
		{"id":"b","name":"B","cover":{"kind":"attachment","url":"/api/attachments/missing"}},
		{"id":"c","name":"C","cover":{"kind":"unsplash","url":"https://images.unsplash.com/p"}}]`)}
	if err := remapNotebookCovers(notes, map[string]string{"old-1": "new-1"}); err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	_ = json.Unmarshal(notes["notebooks"], &rows)
	if rows[0]["cover"].(map[string]any)["url"] != "/api/attachments/new-1" || rows[1]["cover"] != nil || rows[2]["cover"].(map[string]any)["kind"] != "unsplash" {
		t.Fatal(rows)
	}
}
