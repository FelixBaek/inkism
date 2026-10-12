package relay

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestPublicSnapshotBoundariesPersistenceRevoke(t *testing.T) {
	path := filepath.Join(t.TempDir(), "relay.db")
	token := strings.Repeat("s", 32)
	r, e := Open(path, token)
	if e != nil {
		t.Fatal(e)
	}
	request := func(method, path, auth, origin, body string) *httptest.ResponseRecorder {
		q := httptest.NewRequest(method, path, strings.NewReader(body))
		if auth != "" {
			q.Header.Set("Authorization", "Bearer "+auth)
		}
		q.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, q)
		return w
	}
	payload := `{"title":"<script>title</script>","html":"<p onclick='x()'>public only</p><img src='http://127.0.0.1/secret'><script>private()</script>","days":7}`
	if w := request("POST", "/v1/publications", "", "", payload); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/v1/publications", token, "https://evil.test", payload); w.Code != 403 {
		t.Fatal(w.Code)
	}
	w := request("POST", "/v1/publications", token, "", payload)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	var p Publication
	if json.Unmarshal(w.Body.Bytes(), &p) != nil || len(p.ID) != 64 {
		t.Fatal(w.Body)
	}
	w = request("GET", "/p/"+p.ID, "", "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "<script>") || strings.Contains(w.Body.String(), "127.0.0.1") || !strings.Contains(w.Body.String(), "public only") || w.Header().Get("Content-Security-Policy") == "" {
		t.Fatal(w.Code, w.Body)
	}
	for _, path := range []string{"/p/", "/p/../../v1/changes", "/p/" + p.ID + "/extra", "/p/" + p.ID + "?x=1", "/v1/changes"} {
		if q := request("GET", path, "", "", ""); q.Code == 200 {
			t.Fatal(path)
		}
	}
	r.Close()
	r, e = Open(path, token)
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	if request("GET", "/p/"+p.ID, "", "", "").Code != 200 {
		t.Fatal("lost persisted snapshot")
	}
	if request("DELETE", "/v1/publications/"+p.ID, "bad", "", "").Code != 401 {
		t.Fatal("owner bypass")
	}
	for i := 0; i < 2; i++ {
		if request("DELETE", "/v1/publications/"+p.ID, token, "", "").Code != 204 {
			t.Fatal("revoke must be repeatable")
		}
	}
	if request("GET", "/p/"+p.ID, "", "", "").Code != 404 {
		t.Fatal("revoked data visible")
	}
	if request("POST", "/v1/publications", token, "", payload+` {}`).Code != 400 {
		t.Fatal("trailing JSON accepted")
	}
	huge := bytes.Repeat([]byte("x"), 3<<20)
	q := httptest.NewRequest(http.MethodPost, "/v1/publications", io.NopCloser(bytes.NewReader(huge)))
	q.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, q)
	if w.Code != 400 {
		t.Fatal("oversize", w.Code)
	}
}
