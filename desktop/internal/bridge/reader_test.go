package bridge

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

func TestReaderAddressBoundaries(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.1.2.3", "100.74.118.25", "169.254.169.254", "192.168.1.1", "198.18.0.1", "203.0.113.5", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "2002:7f00:1::", "2001:db8::1", "64:ff9b::7f00:1", "3fff::1"} {
		if readerPublic(netip.MustParseAddr(raw)) {
			t.Errorf("allowed %s", raw)
		}
	}
	for _, raw := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if !readerPublic(netip.MustParseAddr(raw)) {
			t.Errorf("denied %s", raw)
		}
	}
	for _, raw := range []string{"file:///etc/passwd", "https://user:pass@example.com", "http://127.0.0.1", "http://example.com:8080", "https://[::ffff:127.0.0.1]/"} {
		if _, err := readerURL(raw); err == nil {
			t.Errorf("allowed URL %s", raw)
		}
	}
}
func TestReaderPinnedFetchSanitizationAndRedirects(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" || r.Header.Get("Referer") != "" {
			t.Error("credentials forwarded")
		}
		switch r.URL.Path {
		case "/public-redirect":
			http.Redirect(w, r, "http://other.test/article", 302)
		case "/private":
			http.Redirect(w, r, "http://127.0.0.1/secret", 302)
		case "/rebind":
			http.Redirect(w, r, "http://private.test/secret", 302)
		case "/large":
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, strings.Repeat("x", readerLimit+1))
		case "/binary":
			w.Header().Set("Content-Type", "application/octet-stream")
			fmt.Fprint(w, "no")
		default:
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, `<title>Page title</title><nav>Exclude navigation</nav><article><h1>Read me</h1><p>Body<script>alert(1)</script></p><img src=x onerror=alert(1)></article>`)
		}
	}))
	defer server.Close()
	calls := 0
	lookup := func(_ context.Context, _, host string) ([]netip.Addr, error) {
		if host == "private.test" {
			return []netip.Addr{netip.MustParseAddr("10.0.0.1")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
	}
	dial := func(ctx context.Context, network, address string) (net.Conn, error) {
		calls++
		if address != "8.8.8.8:80" {
			t.Fatalf("unvalidated dial %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	transport := readerTransport(lookup, dial)
	defer transport.CloseIdleConnections()
	client := readerHTTPClient(transport)
	page, err := readPage(context.Background(), client, "http://public.test/article")
	if err != nil {
		t.Fatal(err)
	}
	if page.Title != "Page title" || !strings.Contains(page.Text, "Read me") || strings.Contains(page.HTML, "script") || strings.Contains(page.HTML, "onerror") || strings.Contains(page.Text, "navigation") {
		t.Fatalf("bad extraction %#v", page)
	}
	if _, err := readPage(context.Background(), client, "http://public.test/public-redirect?token=private-query"); err != nil {
		t.Fatal(err)
	}
	secure, _ := http.NewRequest("GET", "https://public.test/start", nil)
	insecure, _ := http.NewRequest("GET", "http://other.test/", nil)
	if err := client.CheckRedirect(insecure, []*http.Request{secure}); err == nil {
		t.Fatal("HTTPS downgrade accepted")
	}
	for _, path := range []string{"/private", "/rebind", "/large", "/binary"} {
		before := calls
		if _, err := readPage(context.Background(), client, "http://public.test"+path); err == nil {
			t.Errorf("accepted %s", path)
		}
		if (path == "/private" || path == "/rebind") && calls != before+1 {
			t.Errorf("private redirect reached dial: %s", path)
		}
	}
}
func TestReaderMixedDNSDeniedBeforeDial(t *testing.T) {
	lookup := func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("127.0.0.1")}, nil
	}
	dial := func(context.Context, string, string) (net.Conn, error) {
		t.Fatal("dial with mixed private DNS")
		return nil, nil
	}
	transport := readerTransport(lookup, dial)
	defer transport.CloseIdleConnections()
	if _, err := readPage(context.Background(), readerHTTPClient(transport), "http://mixed.test"); err == nil {
		t.Fatal("mixed DNS accepted")
	}
}

func TestReaderFallsBackOnlyToValidatedAddresses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, "<p>fallback</p>")
	}))
	defer server.Close()
	lookup := func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("1.1.1.1")}, nil
	}
	var calls []string
	dial := func(ctx context.Context, network, address string) (net.Conn, error) {
		calls = append(calls, address)
		if address == "8.8.8.8:80" {
			return nil, fmt.Errorf("first address unavailable")
		}
		if address != "1.1.1.1:80" {
			t.Fatalf("unchecked destination %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	transport := readerTransport(lookup, dial)
	defer transport.CloseIdleConnections()
	page, err := readPage(context.Background(), readerHTTPClient(transport), "http://public.test/")
	if err != nil || !strings.Contains(page.Text, "fallback") || len(calls) != 2 {
		t.Fatalf("fallback failed: %#v %v %v", page, err, calls)
	}
}
