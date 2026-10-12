package bridge

import (
	"context"
	"encoding/json"
	"html"
	"net/http/httptest"
	"strings"
	"testing"
)

type committedClipCaller struct {
	clip      *Clip
	writes    int
	different bool
}

func (c *committedClipCaller) Call(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var request map[string]any
	_ = json.Unmarshal(raw, &request)
	if request["op"] == "save" {
		c.writes++
		note := request["note"].(map[string]any)
		if note["id"] != c.clip.noteID || note["revision"] != float64(0) || note["content_format"] != "html" {
			panic("capture must be create-only canonical HTML")
		}
		return json.RawMessage(`{"ok":false,"error":"revision conflict"}`), nil
	}
	body := c.clip.HTML + "<p>출처: " + html.EscapeString(c.clip.URL) + "</p>"
	if c.different {
		body = "changed by user"
	}
	value, _ := json.Marshal(map[string]any{"ok": true, "data": map[string]any{"id": c.clip.noteID, "title": c.clip.Title, "content": body}})
	return value, nil
}
func TestClipperUncertainSaveRetryNeverOverwritesOrDuplicates(t *testing.T) {
	c, e := StartClipper(nil)
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	for _, different := range []bool{false, true} {
		pending := &Clip{noteID: "server-random-note", ID: "capture-1234567890", Title: "clip", HTML: "<p>safe</p>", URL: "https://example.com"}
		c.pending = pending
		caller := &committedClipCaller{clip: pending, different: different}
		h := Handler{Clipper: c, Engine: caller}
		q := httptest.NewRequest("POST", "http://wails.localhost/api/clipper", strings.NewReader(`{"action":"accept","id":"capture-1234567890"}`))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, q)
		if !different && (w.Code != 200 || c.pending != nil) {
			t.Fatal("lost-response retry failed", w.Code)
		}
		if different && (w.Code != 500 || c.pending == nil) {
			t.Fatal("changed saved content must not be overwritten", w.Code)
		}
		if caller.writes != 1 {
			t.Fatal("unexpected save attempt count")
		}
	}
}
