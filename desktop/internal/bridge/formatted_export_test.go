package bridge

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type exportCaller struct {
	response string
	calls    int
}

func (c *exportCaller) Call(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	c.calls++
	var req map[string]any
	_ = json.Unmarshal(raw, &req)
	if req["op"] != "document_render" {
		panic("wrong operation")
	}
	return json.RawMessage(c.response), nil
}
func exportRequest(h *Handler, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "http://localhost"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestHTMLExportRevisionSanitizationAndFilename(t *testing.T) {
	response, _ := json.Marshal(map[string]any{"ok": true, "data": map[string]any{"id": "note", "revision": 3, "title": "한글 </title>../노트", "html": `<p onclick="evil()">문서</p><script>alert(1)</script><p hidden>private</p><img alt="그림 설명" src="https://bad.example">`}})
	h := &Handler{Engine: &exportCaller{response: string(response)}}
	w := exportRequest(h, "/api/export/html", `{"id":"note","revision":3}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, "onclick") || strings.Contains(body, "<script") || strings.Contains(body, "bad.example") || strings.Contains(body, "private") {
		t.Fatal("active/private markup leaked")
	}
	if !strings.Contains(body, "Content-Security-Policy") || !strings.Contains(body, "그림 설명") || !strings.Contains(w.Header().Get("Content-Disposition"), "filename*=") {
		t.Fatal("export metadata", w.Header())
	}
	stale := exportRequest(h, "/api/export/html", `{"id":"note","revision":2}`)
	if stale.Code != 409 {
		t.Fatal(stale.Code)
	}
	missing := exportRequest(h, "/api/export/html", `{"id":"note"}`)
	if missing.Code != 400 {
		t.Fatal(missing.Code)
	}
}
func TestPDFCancellationAndConcurrentRequest(t *testing.T) {
	caller := &exportCaller{response: `{"ok":true,"data":{"id":"n","revision":1,"title":"n","html":"<p>body</p>"}}`}
	started := make(chan struct{})
	done := make(chan struct{})
	h := &Handler{Engine: caller, PDFRender: func(ctx context.Context, doc []byte) ([]byte, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := httptest.NewRequest("POST", "http://localhost/api/export/pdf", strings.NewReader(`{"id":"n","revision":1}`)).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	go func() { defer close(done); h.ServeHTTP(httptest.NewRecorder(), r) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("job didn't start")
	}
	repeated := exportRequest(h, "/api/export/html", `{"id":"n","revision":1}`)
	if repeated.Code != 429 {
		t.Fatal(repeated.Code)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancel hung")
	}
	if caller.calls != 1 {
		t.Fatal("duplicate engine request")
	}
}
func TestExportRejectsUnrepresentedVisualContent(t *testing.T) {
	h := &Handler{Engine: &exportCaller{response: `{"ok":true,"data":{"id":"n","revision":1,"html":"<img src='file:///private'>"}}`}}
	w := exportRequest(h, "/api/export/html", `{"id":"n","revision":1}`)
	if w.Code != 422 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestTableFormattingInHTMLAndPDF(t *testing.T) {
	caller := &exportCaller{response: `{"ok":true,"data":{"id":"n","revision":1,"title":"table","html":"<table data-table-style=\"striped\"><tr><td data-cell-tone=\"success\" style=\"vertical-align:middle\"><p style=\"text-align:right\">value</p></td></tr></table>"}}`}
	h := &Handler{Engine: caller, PDFRender: func(_ context.Context, doc []byte) ([]byte, error) {
		for _, keep := range []string{`data-table-style="striped"`, `data-cell-tone="success"`, `vertical-align:middle`, `text-align:right`, `print-color-adjust:exact`} {
			if !strings.Contains(string(doc), keep) {
				t.Fatalf("PDF lost %s", keep)
			}
		}
		return []byte("%PDF-test"), nil
	}}
	for _, path := range []string{"/api/export/html", "/api/export/pdf"} {
		w := exportRequest(h, path, `{"id":"n","revision":1}`)
		if w.Code != 200 {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
}
