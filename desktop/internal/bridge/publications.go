package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/FelixBaek/inkism/desktop/internal/webcontent"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var publicationID = regexp.MustCompile(`^[a-f0-9]{64}$`)

type publicationInput struct {
	Action   string `json:"action"`
	NoteID   string `json:"note_id"`
	ID       string `json:"id"`
	Token    string `json:"token"`
	Days     int    `json:"days"`
	Revision int64  `json:"revision"`
}

func decodePublicationInput(w http.ResponseWriter, r *http.Request) (publicationInput, bool) {
	var input publicationInput
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || len(input.Token) < 32 || len(input.Token) > 1024 || strings.ContainsAny(input.Token, "\r\n") {
		fail(w, 400, fmt.Errorf("valid relay token required for this action"))
		return input, false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, fmt.Errorf("trailing data"))
		return input, false
	}
	return input, true
}

// publicationRelay returns the library's configured relay origin.
func (h *Handler) publicationRelay(ctx context.Context, w http.ResponseWriter) (*url.URL, bool) {
	raw, e := h.Engine.Call(ctx, json.RawMessage(`{"op":"sync_status"}`))
	if e != nil {
		fail(w, 503, fmt.Errorf("relay configuration unavailable"))
		return nil, false
	}
	var status struct {
		OK   bool `json:"ok"`
		Data struct {
			Configured bool   `json:"configured"`
			URL        string `json:"server_url"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &status) != nil || !status.OK || !status.Data.Configured {
		fail(w, 400, fmt.Errorf("configure your approved HTTPS relay first"))
		return nil, false
	}
	base, e := url.Parse(status.Data.URL)
	if e != nil || base.User != nil || base.RawQuery != "" || base.Fragment != "" || base.Host == "" || (base.Path != "" && base.Path != "/") {
		fail(w, 400, fmt.Errorf("relay requires an origin URL"))
		return nil, false
	}
	local := net.ParseIP(base.Hostname())
	if base.Scheme != "https" && !(base.Scheme == "http" && local != nil && local.IsLoopback()) {
		fail(w, 400, fmt.Errorf("HTTPS relay required; HTTP allowed only for literal loopback tests"))
		return nil, false
	}
	return base, true
}

// publicationBody renders the saved note revision into a publish payload.
func (h *Handler) publicationBody(ctx context.Context, w http.ResponseWriter, input publicationInput) ([]byte, bool) {
	wire, _ := json.Marshal(map[string]any{"op": "document_render", "id": input.NoteID, "revision": input.Revision})
	raw, e := h.Engine.Call(ctx, wire)
	if e != nil {
		fail(w, 500, fmt.Errorf("saved note unavailable"))
		return nil, false
	}
	var note struct {
		OK   bool `json:"ok"`
		Data struct {
			ID       string `json:"id"`
			Revision int64  `json:"revision"`
			Title    string `json:"title"`
			HTML     string `json:"html"`
			Trashed  bool   `json:"trashed"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &note) != nil || !note.OK || note.Data.ID != input.NoteID || note.Data.Revision != input.Revision || note.Data.Trashed || len(note.Data.Title) > 1024 {
		fail(w, 400, fmt.Errorf("saved note unavailable"))
		return nil, false
	}
	clean, _, e := webcontent.Clean(note.Data.HTML)
	if e != nil {
		fail(w, 400, e)
		return nil, false
	}
	body, _ := json.Marshal(map[string]any{"title": note.Data.Title, "html": clean, "days": input.Days})
	return body, true
}

// publicationAction maps an action to the relay request method, endpoint and body.
func (h *Handler) publicationAction(ctx context.Context, w http.ResponseWriter, input publicationInput, endpoint string) (string, string, []byte, bool) {
	method := "GET"
	var body []byte
	switch input.Action {
	case "list":
	case "revoke":
		if !publicationID.MatchString(input.ID) {
			fail(w, 400, fmt.Errorf("invalid publication ID"))
			return "", "", nil, false
		}
		method = "DELETE"
		endpoint += "/" + input.ID
	case "publish":
		if input.NoteID == "" || len(input.NoteID) > 128 || input.Days < 1 || input.Days > 30 || input.Revision < 1 {
			fail(w, 400, fmt.Errorf("note and expiry (1–30 days) required"))
			return "", "", nil, false
		}
		var ok bool
		if body, ok = h.publicationBody(ctx, w, input); !ok {
			return "", "", nil, false
		}
		method = "POST"
	default:
		fail(w, 400, fmt.Errorf("unknown publication action"))
		return "", "", nil, false
	}
	return method, endpoint, body, true
}

// Publication transport is pinned to the library's already configured relay.
// Renderer input cannot supply a host, path, redirect, proxy or local file URL.
func (h *Handler) publications(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	input, ok := decodePublicationInput(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 30*time.Second)
	defer cancel()
	base, ok := h.publicationRelay(ctx, w)
	if !ok {
		return
	}
	method, endpoint, body, ok := h.publicationAction(ctx, w, input, strings.TrimRight(base.String(), "/")+"/v1/publications")
	if !ok {
		return
	}
	request, e := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if e != nil {
		fail(w, 400, fmt.Errorf("invalid relay endpoint"))
		return
	}
	request.Header.Set("Authorization", "Bearer "+input.Token)
	request.Header.Set(headerContentType, mediaTypeJSON)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 25 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, e := client.Do(request)
	if e != nil {
		fail(w, 502, fmt.Errorf("relay unavailable; check the published list before retrying"))
		return
	}
	defer response.Body.Close()
	data, e := io.ReadAll(io.LimitReader(response.Body, webcontent.MaxBytes+1))
	if e != nil || len(data) > webcontent.MaxBytes {
		fail(w, 502, fmt.Errorf("invalid relay response"))
		return
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		fail(w, 502, fmt.Errorf("relay rejected publication action (HTTP %d)", response.StatusCode))
		return
	}
	if method == "DELETE" {
		writeJSON(w, 200, map[string]bool{"ok": true})
		return
	}
	var parsed any
	if json.Unmarshal(data, &parsed) != nil {
		fail(w, 502, fmt.Errorf("invalid relay response"))
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": parsed, "public_origin": strings.TrimRight(base.String(), "/")})
}
