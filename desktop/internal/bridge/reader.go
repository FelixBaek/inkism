package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/FelixBaek/inkism/desktop/internal/webcontent"
	"golang.org/x/net/html"
)

const readerLimit = 2 * 1024 * 1024

var readerExcluded = func() []netip.Prefix {
	var out []netip.Prefix
	for _, raw := range strings.Fields("0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4 2001::/23 2001:db8::/32 2002::/16 3ffe::/16 3fff::/20") {
		out = append(out, netip.MustParsePrefix(raw))
	}
	return out
}()

func readerPublic(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.Zone() != "" {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, excluded := range readerExcluded {
		if excluded.Contains(ip) {
			return false
		}
	}
	return true
}
func readerURL(raw string) (*url.URL, error) {
	if len(raw) > 8192 {
		return nil, fmt.Errorf("page URL is too long")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") || (u.Port() != "" && u.Port() != "80" && u.Port() != "443") {
		return nil, fmt.Errorf("a public HTTP(S) page URL is required")
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !readerPublic(ip) {
		return nil, fmt.Errorf("private page addresses are not allowed")
	}
	u.Fragment = ""
	return u, nil
}

type readerLookup func(context.Context, string, string) ([]netip.Addr, error)
type readerDial func(context.Context, string, string) (net.Conn, error)

func readerTransport(lookup readerLookup, dial readerDial) *http.Transport {
	return &http.Transport{Proxy: nil, DisableKeepAlives: true, ResponseHeaderTimeout: 10 * time.Second, MaxResponseHeaderBytes: 32768, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := lookup(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("page host has no address")
		}
		for _, ip := range ips {
			if !readerPublic(ip) {
				return nil, fmt.Errorf("page host resolves to a private address")
			}
		}
		// Connect directly to an already checked address. No second DNS lookup.
		var last error
		for _, ip := range ips {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			connection, err := dial(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
			if err == nil {
				return connection, nil
			}
			last = err
		}
		return nil, last
	}}
}
func readerHTTPClient(transport *http.Transport) *http.Client {
	return &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		req.Header.Del("Referer")
		if len(via) > 0 && via[len(via)-1].URL.Scheme == "https" && req.URL.Scheme != "https" {
			return fmt.Errorf("HTTPS downgrade is not allowed")
		}
		if len(via) >= 5 {
			return fmt.Errorf("too many page redirects")
		}
		_, err := readerURL(req.URL.String())
		return err
	}}
}

type readerPage struct {
	URL   string `json:"url"`
	Title string `json:"title"`
	HTML  string `json:"html"`
	Text  string `json:"text"`
}

func readPage(ctx context.Context, client *http.Client, raw string) (readerPage, error) {
	var out readerPage
	u, err := readerURL(raw)
	if err != nil {
		return out, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("Accept", "text/html,application/xhtml+xml,text/plain")
	req.Header.Set("User-Agent", "Inkism-Reader/1.0")
	response, err := client.Do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return out, fmt.Errorf("page returned status %d", response.StatusCode)
	}
	kind := strings.ToLower(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if kind != "text/html" && kind != "application/xhtml+xml" && kind != "text/plain" {
		return out, fmt.Errorf("page is not HTML or plain text")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, readerLimit+1))
	if err != nil {
		return out, err
	}
	if len(body) > readerLimit {
		return out, fmt.Errorf("page exceeds 2 MiB")
	}
	out.URL = response.Request.URL.String()
	out.Title = response.Request.URL.Hostname()
	if kind == "text/plain" {
		out.HTML, out.Text, err = webcontent.Clean("<pre>" + html.EscapeString(string(body)) + "</pre>")
		return out, err
	}
	doc, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	var article, main, root *html.Node
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "article":
				if article == nil {
					article = n
				}
			case "main":
				if main == nil {
					main = n
				}
			case "body":
				root = n
			case "title":
				if n.FirstChild != nil && n.FirstChild.Type == html.TextNode {
					out.Title = n.FirstChild.Data
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	selected := article
	if selected == nil {
		selected = main
	}
	if selected == nil {
		selected = root
	}
	if selected == nil {
		selected = doc
	}
	var rendered bytes.Buffer
	if err = html.Render(&rendered, selected); err != nil {
		return out, err
	}
	out.HTML, out.Text, err = webcontent.Clean(rendered.String())
	if title := []rune(out.Title); len(title) > 240 {
		out.Title = string(title[:240])
	}
	return out, err
}
func (h *Handler) reader(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		fail(w, 405, fmt.Errorf("POST required"))
		return
	}
	var input struct {
		URL string `json:"url"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		fail(w, 400, fmt.Errorf("invalid reader request"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	transport := readerTransport(net.DefaultResolver.LookupNetIP, (&net.Dialer{Timeout: 10 * time.Second}).DialContext)
	defer transport.CloseIdleConnections()
	page, err := readPage(ctx, readerHTTPClient(transport), input.URL)
	if err != nil {
		fail(w, 400, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": page})
}
