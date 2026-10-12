//go:build windows

package pdfexport

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRealEdgeHeadlessPDF(t *testing.T) {
	if os.Getenv("INKISM_TEST_REAL_PDF") != "1" {
		t.Skip("explicit noninteractive Windows PDF validation")
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); w.WriteHeader(200) }))
	defer server.Close()
	document := `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'"><style>@page{size:A4;margin:18mm}body{font-family:'Malgun Gothic',sans-serif}table{border-collapse:collapse}td{border:1px solid;padding:8px}pre{white-space:pre-wrap}</style><h1>Inkism PDF 검증</h1><p>한글과 English, 수식 원문 x² + y² = z²</p><table><tr><td>항목</td><td>보존</td></tr></table>`
	document += fmt.Sprintf(`<img style="display:none" src="%s/image"><script>fetch('%s/script')</script>`, server.URL, server.URL)
	document += strings.Repeat("<p>페이지 분리 검증 - 원문과 읽기 순서를 확인합니다.</p>", 80)
	root := t.TempDir()
	result, err := (Renderer{TempRoot: root}).Render(context.Background(), []byte(document))
	if err != nil {
		t.Fatal(err)
	}
	if len(result) < 1000 {
		t.Fatal("empty PDF")
	}
	if requests.Load() != 0 {
		t.Fatal("blocked external request executed")
	}
	files, _ := os.ReadDir(root)
	if len(files) != 0 {
		t.Fatal("profile leaked")
	}
	if output := os.Getenv("INKISM_PDF_TEST_OUTPUT"); output != "" {
		if !filepath.IsAbs(output) {
			t.Fatal("absolute output path required")
		}
		if err := os.WriteFile(output, result, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRealEdgeCancellationCleansProcessJob(t *testing.T) {
	if os.Getenv("INKISM_TEST_REAL_PDF") != "1" {
		t.Skip("explicit noninteractive Windows PDF validation")
	}
	root := t.TempDir()
	_, err := (Renderer{TempRoot: root, Timeout: 50 * time.Millisecond}).Render(context.Background(), []byte("<!doctype html><h1>cancel synthetic job</h1>"))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected timeout, got %v", err)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 0 {
		t.Fatal("cancelled job leaked profile")
	}
}
