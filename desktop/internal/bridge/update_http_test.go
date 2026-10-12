package bridge

import (
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/FelixBaek/inkism/desktop/internal/appupdate"
)

func TestUpdateEndpoints(t *testing.T) {
	h := &Handler{Update: appupdate.New("0.1.0", "abc1234", "https://127.0.0.1:1/", t.TempDir(), nil)}
	do := func(method, path, origin, contentType string) (int, string) {
		req := httptest.NewRequest(method, "http://app"+path, strings.NewReader("{}"))
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}
	if code, body := do("GET", "/api/update/status", "", ""); code != 200 || !strings.Contains(body, `"current":"0.1.0"`) {
		t.Fatal(code, body)
	}
	if code, body := do("GET", "/api/info", "", ""); code != 200 || !strings.Contains(body, `"version":"0.1.0"`) {
		t.Fatal(code, body)
	}
	if code, _ := do("POST", "/api/update/apply", "http://evil.example", "application/json"); code != 403 {
		t.Fatal("cross-origin apply accepted", code)
	}
	if code, _ := do("POST", "/api/update/apply", "", "text/plain"); code != 415 {
		t.Fatal("non-JSON apply accepted", code)
	}
	if runtime.GOOS != "windows" {
		if code, body := do("POST", "/api/update/apply", "http://app", "application/json"); code != 409 || !strings.Contains(body, "설치할 수 없습니다") {
			t.Fatal(code, body)
		}
	}
}
