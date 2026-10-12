package relay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestReplayPaginationAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "relay.db")
	token := strings.Repeat("t", 32)
	r, err := Open(path, token)
	if err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string, authorized bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if authorized {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		return out
	}
	if out := call("GET", "/v1/changes", "", false); out.Code != 401 {
		t.Fatal(out.Code)
	}
	for i := 0; i < 3; i++ {
		out := call("POST", "/v1/changes", fmt.Sprintf(`{"id":"unique-record-%04d","blob":"encrypted-%d"}`, i, i), true)
		if out.Code != 200 {
			t.Fatal(out.Body.String())
		}
	}
	out := call("POST", "/v1/changes", `{"id":"unique-record-0000","blob":"encrypted-0"}`, true)
	if out.Code != 200 || !strings.Contains(out.Body.String(), `"seq":1`) {
		t.Fatal(out.Body.String())
	}
	out = call("POST", "/v1/changes", `{"id":"unique-record-0000","blob":"changed"}`, true)
	if out.Code != 409 {
		t.Fatal("overwrite allowed")
	}
	r.Close()
	r, err = Open(path, token)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	out = call("GET", "/v1/changes?after=1&limit=1", "", true)
	var page struct {
		Items  []Record
		Cursor uint64
	}
	json.Unmarshal(out.Body.Bytes(), &page)
	if out.Code != http.StatusOK || len(page.Items) != 1 || page.Cursor != 2 || page.Items[0].ID != "unique-record-0001" {
		t.Fatal(out.Body.String())
	}
}
