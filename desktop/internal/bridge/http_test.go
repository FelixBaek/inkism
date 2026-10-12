package bridge

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeEngine struct{ last json.RawMessage }

func (f *fakeEngine) Call(_ context.Context, r json.RawMessage) (json.RawMessage, error) {
	f.last = r
	return json.RawMessage(`{"ok":true,"data":{}}`), nil
}
func TestRPCRejectsCrossOriginAndPaths(t *testing.T) {
	engine := &fakeEngine{}
	h := &Handler{Engine: engine, Host: "127.0.0.1:47831"}
	for _, tc := range []struct {
		body, origin, host, content string
		code                        int
	}{
		{`{"op":"save","note":{"title":"a"}}`, "http://evil.test", "127.0.0.1:47831", "application/json", 403},
		{`{"op":"export","path":"/etc/password"}`, "", "127.0.0.1:47831", "application/json", 400},
		{`{"op":"get"}`, "", "attacker.test", "application/json", 403},
		{`{"op":"save"}`, "", "127.0.0.1:47831", "text/plain", 415},
		{`{"op":"document_find","id":"note-id","revision":1,"query":"한글"}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
		{`{"op":"document_blocks","id":"note-id","offset":128,"limit":32}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
		{`{"op":"document_info","id":"note-id"}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
		{`{"op":"document_block_window","id":"note-id","revision":1,"ordinal":0,"offset":4,"limit":64}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
		{`{"op":"document_block_window","id":"note-id","revision":1,"ordinal":0}`, "http://evil.test", "127.0.0.1:47831", "application/json", 403},
		{`{"op":"document_segments","id":"note-id","revision":1,"ordinal":0,"offset":2,"limit":1}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
		{`{"op":"document_segments","id":"note-id","revision":1,"ordinal":0}`, "http://evil.test", "127.0.0.1:47831", "application/json", 403},
		{`{"op":"document_locate","id":"note-id","revision":1,"byte_offset":16384,"bias":"before"}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
		{`{"op":"document_locate","id":"note-id","revision":1,"byte_offset":0}`, "http://evil.test", "127.0.0.1:47831", "application/json", 403},
		{`{"op":"document_splice_html","id":"note-id","revision":1}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
		{`{"op":"document_splice","id":"note-id","revision":1}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
		{`{"op":"list"}`, "http://127.0.0.1:47831", "127.0.0.1:47831", "application/json", 200},
	} {
		req := httptest.NewRequest("POST", "http://"+tc.host+"/api/rpc", strings.NewReader(tc.body))
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Content-Type", tc.content)
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		if out.Code != tc.code {
			t.Errorf("%s: got %d want %d", tc.body, out.Code, tc.code)
		}
	}
}
func TestFormattingCannotSplitJSONL(t *testing.T) {
	out := newBuffer([]byte("{\n\"op\": \"get\",\n\"id\":\"abc\\nxyz\"\n}"))
	if strings.Contains(string(out), "\n") || !json.Valid(out) {
		t.Fatalf("bad protocol line %q", out)
	}
}

func TestEngineCompactionDoesNotExpandHTML(t *testing.T) {
	raw := []byte(`{ "op": "save", "note": {"content":"<p><strong>한글 & 😀</strong></p>","revision":9007199254740993} }`)
	want := `{"op":"save","note":{"content":"<p><strong>한글 & 😀</strong></p>","revision":9007199254740993}}`
	if got := string(newBuffer(raw)); got != want {
		t.Fatalf("protocol compaction changed body or integer: %s", got)
	}
}
