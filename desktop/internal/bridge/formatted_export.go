package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/FelixBaek/inkism/desktop/internal/pdfexport"
	"github.com/FelixBaek/inkism/desktop/internal/webcontent"
	"html"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode"
)

var exportSlot = make(chan struct{}, 1)

const exportCSS = `@page{size:A4;margin:18mm}body{font-family:"Malgun Gothic","Segoe UI",sans-serif;line-height:1.6;color:#202624;overflow-wrap:anywhere}h1,h2,h3{break-after:avoid}pre{white-space:pre;overflow-x:auto;background:#f5f6f5;padding:12px}table{border-collapse:collapse;max-width:100%;width:100%;table-layout:fixed}th,td{border:1px solid #bfc7c1;padding:6px;vertical-align:top}blockquote{border-left:3px solid #087f5b;padding-left:12px}img{max-width:100%}pre[data-wrap="true"],pre[data-wrap="true"] code{white-space:pre-wrap;overflow-wrap:anywhere}table[data-table-style="striped"] tr:nth-child(even){background:#e9e7e2}table[data-table-style="plain"] :is(td,th){border-left:0;border-right:0}:is(td,th)[data-cell-tone="soft"]{background:#e9e7e2}:is(td,th)[data-cell-tone="success"]{background:#dde5da}:is(td,th)[data-cell-tone="warning"]{background:#f2ecdf}th{background:#efede9}hr{border:0;border-top:1px solid #dedbd5}@media print{*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`

func standaloneDocument(title, fragment string) ([]byte, error) {
	safe, _, err := webcontent.CleanExport(fragment, pdfexport.MaxDocumentBytes)
	if err != nil {
		return nil, err
	}
	var document bytes.Buffer
	document.WriteString(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>`)
	document.WriteString(html.EscapeString(title))
	document.WriteString("</title><style>" + exportCSS + "</style></head><body><h1>")
	document.WriteString(html.EscapeString(title))
	document.WriteString("</h1>")
	document.WriteString(safe)
	document.WriteString("</body></html>")
	if document.Len() > pdfexport.MaxDocumentBytes {
		return nil, errors.New("서식 문서가 64 MiB 한도를 넘었습니다")
	}
	return document.Bytes(), nil
}
func exportFilename(title, extension string) string {
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, title)
	cleaned = strings.Trim(cleaned, " .")
	runes := []rune(cleaned)
	if len(runes) > 100 {
		cleaned = string(runes[:100])
	}
	if cleaned == "" {
		cleaned = "Inkism"
	}
	return cleaned + extension
}

type formattedExportRequest struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

func decodeExportRequest(w http.ResponseWriter, r *http.Request) (formattedExportRequest, bool) {
	var req formattedExportRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil || req.ID == "" || len(req.ID) > 256 || req.Revision < 1 {
		fail(w, 400, errors.New("노트와 저장된 버전이 필요합니다"))
		return req, false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		fail(w, 400, errors.New("invalid request"))
		return req, false
	}
	return req, true
}

func (h *Handler) formattedExport(w http.ResponseWriter, r *http.Request, pdf bool) {
	if r.Method != "POST" {
		fail(w, 405, errors.New("POST required"))
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, errors.New("JSON required"))
		return
	}
	if pdf && h.PDFRender == nil {
		fail(w, 400, errors.New("PDF 내보내기는 Windows 앱에서 사용할 수 있습니다"))
		return
	}
	req, ok := decodeExportRequest(w, r)
	if !ok {
		return
	}
	select {
	case exportSlot <- struct{}{}:
		defer func() { <-exportSlot }()
	default:
		fail(w, 429, errors.New("다른 내보내기가 진행 중입니다. 완료 후 다시 시도해 주세요"))
		return
	}
	if r.Context().Err() != nil {
		return
	}
	// Finish the ordered Rust reply even if the browser cancels; cancellation of
	// printing below must never kill the shared storage engine or an autosave.
	renderCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 30*time.Second)
	raw, _ := json.Marshal(map[string]any{"op": "document_render", "id": req.ID, "revision": req.Revision})
	response, err := h.Engine.Call(renderCtx, raw)
	cancel()
	if err != nil {
		fail(w, 500, errors.New("문서를 준비하지 못했습니다"))
		return
	}
	var envelope struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
		Data  struct {
			ID       string `json:"id"`
			Title    string `json:"title"`
			Revision int64  `json:"revision"`
			HTML     string `json:"html"`
		} `json:"data"`
	}
	if json.Unmarshal(response, &envelope) != nil {
		fail(w, 500, errors.New("문서 응답이 올바르지 않습니다"))
		return
	}
	if !envelope.OK {
		fail(w, 409, errors.New(envelope.Error))
		return
	}
	if envelope.Data.Revision != req.Revision || envelope.Data.ID != req.ID {
		fail(w, 409, errors.New("노트 버전이 변경되었습니다. 다시 시도해 주세요"))
		return
	}
	if r.Context().Err() != nil {
		return
	}
	document, err := standaloneDocument(envelope.Data.Title, envelope.Data.HTML)
	if err != nil {
		fail(w, 422, err)
		return
	}
	result := document
	media := "text/html; charset=utf-8"
	extension := ".html"
	if pdf {
		printCtx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		result, err = h.PDFRender(printCtx, document)
		cancel()
		if err != nil {
			if r.Context().Err() == nil {
				fail(w, 500, err)
			}
			return
		}
		media = "application/pdf"
		extension = ".pdf"
	}
	w.Header().Set("Content-Type", media)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": exportFilename(envelope.Data.Title, extension)}))
	w.Header().Set("X-Inkism-Export-Policy", "static-text;images-as-alternative-text;latex-as-source;external-resources-blocked")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result)
}
