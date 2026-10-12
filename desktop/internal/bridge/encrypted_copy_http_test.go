package bridge

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEncryptedCopyHostBoundary(t *testing.T) {
	for _, tc := range []struct {
		name, body, content, origin, target string
		failure                             bool
		want, calls                         int
	}{
		{"success", "{}", "application/json", "", "C:\\copy\\notes.db", false, 200, 1},
		{"cancel", "{}", "application/json", "", "", false, 200, 1},
		{"failure", "{}", "application/json", "", "", true, 500, 1},
		{"path injection", `{"path":"C:\\existing"}`, "application/json", "", "", false, 400, 0},
		{"cross origin", "{}", "application/json", "https://other.test", "", false, 403, 0},
		{"form", "{}", "text/plain", "", "", false, 415, 0},
		{"null", "null", "application/json", "", "", false, 400, 0},
		{"trailing", "{}{}", "application/json", "", "", false, 400, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			h := &Handler{EncryptedCopy: func(ctx context.Context) (string, error) {
				calls++
				if ctx.Err() != nil {
					t.Fatal("request cancellation leaked into host operation")
				}
				if tc.failure {
					return "", fmt.Errorf("copy failed")
				}
				return tc.target, nil
			}}
			req := httptest.NewRequest("POST", "http://localhost/api/storage/encrypted-copy", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", tc.content)
			req.Header.Set("Origin", tc.origin)
			ctx, cancel := context.WithCancel(req.Context())
			cancel()
			req = req.WithContext(ctx)
			out := httptest.NewRecorder()
			h.ServeHTTP(out, req)
			if out.Code != tc.want || calls != tc.calls {
				t.Fatalf("code=%d calls=%d body=%s", out.Code, calls, out.Body)
			}
			if tc.name == "cancel" && !strings.Contains(out.Body.String(), `"cancelled":true`) {
				t.Fatal(out.Body)
			}
		})
	}
	h := &Handler{}
	out := httptest.NewRecorder()
	h.ServeHTTP(out, httptest.NewRequest("POST", "http://localhost/api/storage/encrypted-copy", strings.NewReader("{}")))
	if out.Code != 400 {
		t.Fatal("unsupported host accepted copy")
	}
}

func TestOpenLibraryCannotReceiveRendererPaths(t *testing.T) {
	calls := 0
	h := &Handler{OpenLibrary: func() (bool, error) { calls++; return false, nil }}
	for _, body := range []string{`{"path":"C:\\other.db"}`, `{}`} {
		req := httptest.NewRequest("POST", "http://localhost/api/storage/open", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		if body == `{}` {
			if out.Code != 200 || !strings.Contains(out.Body.String(), `"cancelled":true`) {
				t.Fatal(out.Code, out.Body)
			}
		} else if out.Code != 400 || calls != 0 {
			t.Fatal("renderer selected a path", out.Code, calls)
		}
	}
	if calls != 1 {
		t.Fatal(calls)
	}
}
