package webcontent

import (
	"strings"
	"testing"
)

func TestActiveAndPrivateContentRemoved(t *testing.T) {
	got, text, e := Clean(`<h1 onclick="x()">Hello</h1><script>secret()</script><img src="http://private/x"><a href="javascript:x()">link</a><iframe>hidden</iframe><p style="background:url(x)">한글 &amp; ok</p><span data-attachment="vault">file</span>`)
	if e != nil || got != `<h1>Hello</h1>link<p>한글 &amp; ok</p>file` || !strings.Contains(text, "한글 & ok") {
		t.Fatalf("%q %q %v", got, text, e)
	}
	for _, bad := range []string{"file:///c:/secret", "javascript:alert(1)", "https://user:pass@host/x", "//host/x"} {
		if _, e := SourceURL(bad); e == nil {
			t.Fatal(bad)
		}
	}
	if u, e := SourceURL("https://example.com/page#secret"); e != nil || u != "https://example.com/page" {
		t.Fatal(u, e)
	}
	if _, _, e := Clean(strings.Repeat("x", MaxBytes+1)); e == nil {
		t.Fatal("unbounded input")
	}
}
func TestExportPreservesAlternativesAndRejectsLoss(t *testing.T) {
	got, _, err := CleanExport(`<p hidden>private</p><p style="display: none !important">secret</p><table><tr><td colspan="2">keep</td></tr></table><img alt="plot &amp; labels" src="https://secret"><input type="checkbox" checked>`, 64<<20)
	if err != nil || strings.Contains(got, "private") || strings.Contains(got, "secret") || !strings.Contains(got, `colspan="2"`) || !strings.Contains(got, "plot &amp; labels") || !strings.Contains(got, "[x]") {
		t.Fatal(got, err)
	}
	for _, raw := range []string{`<img src="secret">`, `<math><mi>x</mi></math>`, strings.Repeat("<div>", 130) + "lost" + strings.Repeat("</div>", 130)} {
		if _, _, err := CleanExport(raw, 64<<20); err == nil {
			t.Fatal("silently lost unsupported content")
		}
	}
	if _, _, err := CleanExport("<p>"+strings.Repeat("x", 3<<20)+"</p>", 64<<20); err != nil {
		t.Fatal(err)
	}
}

func TestExportPreservesOnlyKnownFormatting(t *testing.T) {
	raw := `<table data-table-style="striped" onclick="evil()"><tr><td data-cell-tone="success" style="vertical-align:middle;background:url(https://secret);position:fixed"><p dir="rtl" style="text-align:right;color:expression(evil())">cell</p></td></tr></table><ol start="8" style="list-style-type:lower-roman"><li>item</li></ol><pre data-wrap="true">code</pre><hr style="border-top-style:dotted">`
	got, _, err := CleanExport(raw, 64<<20)
	if err != nil {
		t.Fatal(err)
	}
	for _, keep := range []string{`data-table-style="striped"`, `data-cell-tone="success"`, `vertical-align:middle`, `dir="rtl"`, `text-align:right`, `start="8"`, `list-style-type:lower-roman`, `data-wrap="true"`, `border-top-style:dotted`} {
		if !strings.Contains(got, keep) {
			t.Fatalf("lost %s: %s", keep, got)
		}
	}
	for _, bad := range []string{"onclick", "evil", "url(", "position", "secret", "expression"} {
		if strings.Contains(got, bad) {
			t.Fatalf("unsafe %s: %s", bad, got)
		}
	}
	got, _, err = CleanExport(`<table data-table-style='url(evil)'><tr><td data-cell-tone='red' style='text-align:center!important;vertical-align:url(evil)'>x</td></tr></table><pre data-wrap='false'>x</pre>`, 64<<20)
	if err != nil || strings.Contains(got, "data-") || strings.Contains(got, "style=") {
		t.Fatal(got, err)
	}
	imported, _, err := Clean(raw)
	if err != nil || strings.Contains(imported, "style=") || strings.Contains(imported, "data-") {
		t.Fatal("import policy changed", imported, err)
	}
}
