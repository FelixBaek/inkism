// Package webcontent defines the trusted boundary for imported/published HTML.
// It never fetches URLs and excludes active content; exports retain a small set of static styles.
package webcontent

import (
	"errors"
	"fmt"
	xhtml "golang.org/x/net/html"
	"html"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const MaxBytes = 2 << 20

func SourceURL(raw string) (string, error) {
	u, e := url.Parse(raw)
	if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || len(raw) > 4096 {
		return "", errors.New("HTTP(S) source URL required")
	}
	u.Fragment = ""
	return u.String(), nil
}

func Clean(raw string) (string, string, error) { return clean(raw, MaxBytes, false) }

// CleanExport preserves text alternatives and rejects unsupported visual-only
// content instead of producing a silently incomplete exported document.
func CleanExport(raw string, limit int) (string, string, error) { return clean(raw, limit, true) }
func clean(raw string, limit int, export bool) (string, string, error) {
	if limit <= 0 || limit > 64<<20 || len(raw) > limit {
		return "", "", fmt.Errorf("HTML exceeds %d byte limit", limit)
	}

	root, e := xhtml.Parse(strings.NewReader(raw))
	if e != nil {
		return "", "", e
	}
	s := &sanitizer{limit: limit, export: export}
	s.visit(root, 0)
	if s.failure != nil {
		return "", "", s.failure
	}
	if s.out.Len() > limit || s.text.Len() > limit {
		return "", "", errors.New("sanitized HTML exceeds limit")
	}
	return s.out.String(), strings.TrimSpace(s.text.String()), nil
}

var allowedTags = map[string]bool{"p": true, "br": true, "h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "strong": true, "b": true, "em": true, "i": true, "u": true, "s": true, "blockquote": true, "pre": true, "code": true, "ul": true, "ol": true, "li": true, "table": true, "thead": true, "tbody": true, "tr": true, "th": true, "td": true, "hr": true}
var blockedTags = map[string]bool{"script": true, "style": true, "iframe": true, "object": true, "embed": true, "svg": true, "math": true, "form": true, "input": true, "textarea": true, "button": true, "select": true, "head": true, "template": true, "noscript": true}

// sanitizer walks a parsed tree once, writing escaped HTML and plain text.
// The first failure stops the walk.
type sanitizer struct {
	out, text strings.Builder
	limit     int
	export    bool
	failure   error
}

func (s *sanitizer) visit(n *xhtml.Node, depth int) {
	if !s.proceed(depth) {
		return
	}
	if n.Type == xhtml.ElementNode && s.replaceElement(n) {
		return
	}
	if n.Type == xhtml.TextNode {
		s.out.WriteString(html.EscapeString(n.Data))
		s.text.WriteString(n.Data)
		return
	}
	if n.Type == xhtml.ElementNode && blockedTags[n.Data] {
		return
	}
	tag := ""
	if n.Type == xhtml.ElementNode && allowedTags[n.Data] {
		tag = n.Data
		if !s.openTag(n) {
			return
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		s.visit(c, depth+1)
	}
	s.closeTag(tag)
}

// proceed reports whether the walk may continue at depth.
func (s *sanitizer) proceed(depth int) bool {
	if s.failure != nil {
		return false
	}
	if depth > 128 {
		s.failure = errors.New("HTML nesting exceeds 128 levels")
		return false
	}
	if s.out.Len() > s.limit || s.text.Len() > s.limit {
		s.failure = errors.New("sanitized HTML exceeds limit")
		return false
	}
	return true
}

// replaceElement drops hidden/attachment elements and, for export, writes a
// text placeholder or fails. It reports whether the element was consumed.
func (s *sanitizer) replaceElement(n *xhtml.Node) bool {
	attributes := map[string]string{}
	for _, a := range n.Attr {
		attributes[strings.ToLower(a.Key)] = a.Val
	}
	if skippedElement(attributes, s.export) {
		return true
	}
	if !s.export {
		return false
	}
	return s.exportPlaceholder(n, attributes)
}

func skippedElement(attributes map[string]string, export bool) bool {
	if !export && (attributes["data-type"] == "mindbox-attachment" || attributes["data-attachment-url"] != "") {
		return true
	}
	_, hidden := attributes["hidden"]
	return hidden || strings.EqualFold(attributes["aria-hidden"], "true") || hiddenStyle.MatchString(attributes["style"])
}

func (s *sanitizer) exportPlaceholder(n *xhtml.Node, attributes map[string]string) bool {
	switch {
	case n.Data == "svg" || n.Data == "math" || n.Data == "canvas" || n.Data == "video" || n.Data == "audio":
		s.failure = fmt.Errorf("%s visual content cannot be exported without a text alternative", n.Data)
		return true
	case n.Data == "img":
		alt := strings.TrimSpace(attributes["alt"])
		if alt == "" {
			s.failure = errors.New("image has no description; add alternative text before export")
			return true
		}
		s.writeLabel(html.EscapeString("[이미지: "+alt+"]"), "[이미지: "+alt+"]")
		return true
	case n.Data == "input" && strings.EqualFold(attributes["type"], "checkbox"):
		label := "[ ] "
		if _, checked := attributes["checked"]; checked {
			label = "[x] "
		}
		s.writeLabel(label, label)
		return true
	}
	return false
}

func (s *sanitizer) writeLabel(markup, plain string) {
	s.out.WriteString(markup)
	s.text.WriteString(plain)
}

// openTag writes an allowed start tag; it fails on an invalid table span.
func (s *sanitizer) openTag(n *xhtml.Node) bool {
	tag := n.Data
	s.out.WriteString("<" + tag)
	if s.export {
		s.out.WriteString(exportAttributes(n))
	}
	if s.export && (tag == "td" || tag == "th") && !s.writeSpans(n) {
		return false
	}
	s.out.WriteString(">")
	return true
}

func (s *sanitizer) writeSpans(n *xhtml.Node) bool {
	for _, a := range n.Attr {
		if a.Key != "colspan" && a.Key != "rowspan" {
			continue
		}
		v, e := strconv.Atoi(a.Val)
		if e != nil || v < 1 || v > 1000 {
			s.failure = errors.New("invalid table span")
			return false
		}
		s.out.WriteString(fmt.Sprintf(" %s=\"%d\"", a.Key, v))
	}
	return true
}

func (s *sanitizer) closeTag(tag string) {
	if tag != "" && tag != "br" && tag != "hr" {
		s.out.WriteString("</" + tag + ">")
	}
	if tag == "p" || tag == "br" || tag == "li" || tag == "tr" || strings.HasPrefix(tag, "h") {
		s.text.WriteByte('\n')
	}
}

var hiddenStyle = regexp.MustCompile(`(?i)(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*(!important)?\s*(;|$)`)

// Export accepts exact formatting values, never URLs, arbitrary CSS, or event handlers.
func exportAttributes(n *xhtml.Node) string {
	var out strings.Builder
	for _, a := range n.Attr {
		value := strings.ToLower(strings.TrimSpace(a.Val))
		allowed := false
		switch a.Key {
		case "data-table-style":
			allowed = n.Data == "table" && (value == "striped" || value == "plain")
		case "data-cell-tone":
			allowed = (n.Data == "td" || n.Data == "th") && (value == "soft" || value == "success" || value == "warning")
		case "data-wrap":
			allowed = n.Data == "pre" && value == "true"
		case "dir":
			allowed = value == "ltr" || value == "rtl"
		case "start":
			out.WriteString(exportStart(n.Data, value))
		case "style":
			out.WriteString(exportStyle(n.Data, value))
		}
		if allowed {
			out.WriteString(" " + a.Key + `="` + value + `"`)
		}
	}
	return out.String()
}

func exportStart(tag, value string) string {
	number, err := strconv.Atoi(value)
	if tag == "ol" && err == nil && number >= 1 && number <= 999999 {
		return fmt.Sprintf(` start="%d"`, number)
	}
	return ""
}

// exportStyle keeps only the whitelisted declarations of a style attribute.
func exportStyle(tag, value string) string {
	var styles []string
	for _, declaration := range strings.Split(value, ";") {
		pair := strings.SplitN(declaration, ":", 2)
		if len(pair) != 2 {
			continue
		}
		key, v := strings.TrimSpace(pair[0]), strings.TrimSpace(pair[1])
		if styleAllowed(tag, key, v) {
			styles = append(styles, key+":"+v)
		}
	}
	if len(styles) == 0 {
		return ""
	}
	return ` style="` + strings.Join(styles, ";") + `"`
}

func styleAllowed(tag, key, v string) bool {
	switch key {
	case "text-align":
		return v == "left" || v == "center" || v == "right" || v == "justify"
	case "vertical-align":
		return (tag == "td" || tag == "th") && (v == "top" || v == "middle" || v == "bottom")
	case "border-top-style":
		return tag == "hr" && (v == "solid" || v == "dashed" || v == "dotted")
	case "list-style-type":
		return (tag == "ol" || tag == "ul") && (v == "disc" || v == "circle" || v == "square" || v == "decimal" || v == "lower-alpha" || v == "upper-alpha" || v == "lower-roman" || v == "upper-roman")
	}
	return false
}
