//go:build windows

package bridge

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/FelixBaek/inkism/desktop/internal/pdfexport"
)

func TestRealStyledTablePDF(t *testing.T) {
	if os.Getenv("INKISM_TEST_REAL_PDF") != "1" {
		t.Skip("explicit Windows PDF validation")
	}
	doc, err := standaloneDocument("표 서식 검증", `<table data-table-style="striped"><tr><th>항목</th><th>결과</th></tr><tr><td data-cell-tone="success" style="vertical-align:middle"><p style="text-align:right">초록 · 오른쪽</p></td><td><p>줄무늬</p><p>두 번째 줄</p></td></tr><tr><td data-cell-tone="warning">노랑</td><td data-cell-tone="soft">회색</td></tr></table>`)
	if err != nil {
		t.Fatal(err)
	}
	result, err := (pdfexport.Renderer{TempRoot: t.TempDir()}).Render(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	if len(result) < 1000 {
		t.Fatal("empty PDF")
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
