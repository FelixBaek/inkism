package bridge

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/FelixBaek/inkism/desktop/internal/webcontent"
	"github.com/google/uuid"
	"html"
	"io"
	"net"
	"net/http"
	"regexp"
	"sync"
	"time"
)

type Clip struct {
	noteID string
	ID     string `json:"id"`
	Title  string `json:"title"`
	HTML   string `json:"html"`
	URL    string `json:"url"`
	Text   string `json:"text,omitempty"`
}
type Clipper struct {
	mu                  sync.Mutex
	server              *http.Server
	host, token, origin string
	expires             time.Time
	pending             *Clip
	seen                map[string]bool
	gate                *SessionGate
}

var extensionID = regexp.MustCompile(`^[a-p]{32}$`)
var captureID = regexp.MustCompile(`^[a-zA-Z0-9-]{16,64}$`)

func StartClipper(gate *SessionGate) (*Clipper, error) {
	l, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		return nil, e
	}
	c := &Clipper{host: l.Addr().String(), gate: gate}
	c.server = &http.Server{Handler: http.HandlerFunc(c.receive), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 15 * time.Second}
	go func() { _ = c.server.Serve(l) }()
	return c, nil
}
func (c *Clipper) Close() error {
	c.mu.Lock()
	c.token = ""
	c.pending = nil
	c.mu.Unlock()
	return c.server.Close()
}
func (c *Clipper) pair(id string) (UploadAccess, error) {
	if !extensionID.MatchString(id) {
		return UploadAccess{}, fmt.Errorf("32-character Chrome/Edge extension ID required")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pending != nil {
		return UploadAccess{}, fmt.Errorf("accept or discard the pending capture first")
	}
	var secret [32]byte
	if _, e := rand.Read(secret[:]); e != nil {
		return UploadAccess{}, e
	}
	c.token = hex.EncodeToString(secret[:])
	c.origin = "chrome-extension://" + id
	c.expires = time.Now().Add(15 * time.Minute)
	c.seen = map[string]bool{}
	return UploadAccess{URL: "http://" + c.host + "/capture", Token: c.token}, nil
}
func (c *Clipper) receive(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	release, ok := c.gate.enter()
	if !ok {
		fail(w, 423, fmt.Errorf("app is locked"))
		return
	}
	defer release()
	c.mu.Lock()
	defer c.mu.Unlock()
	if r.Host != c.host || r.URL.Path != "/capture" || r.URL.RawQuery != "" || c.token == "" || time.Now().After(c.expires) || r.Header.Get("Origin") != c.origin {
		fail(w, 403, fmt.Errorf("capture session unavailable"))
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", c.origin)
	w.Header().Set("Vary", "Origin")
	if r.Method == "OPTIONS" {
		if r.Header.Get("Access-Control-Request-Method") != "POST" {
			w.WriteHeader(405)
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "POST")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.WriteHeader(204)
		return
	}
	if r.Method != "POST" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+c.token)) != 1 {
		fail(w, 403, fmt.Errorf("capture authorization failed"))
		return
	}
	var clip Clip
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, webcontent.MaxBytes+8192))
	d.DisallowUnknownFields()
	if e := d.Decode(&clip); e != nil || !captureID.MatchString(clip.ID) || len(clip.Title) > 1024 {
		fail(w, 400, fmt.Errorf("invalid capture"))
		return
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, fmt.Errorf("trailing capture data"))
		return
	}
	if c.seen[clip.ID] {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	if c.pending != nil {
		fail(w, 409, fmt.Errorf("review the pending capture in Inkism first"))
		return
	}
	if len(c.seen) >= 100 {
		fail(w, 429, fmt.Errorf("start a new capture session"))
		return
	}
	var e error
	clip.URL, e = webcontent.SourceURL(clip.URL)
	if e != nil {
		fail(w, 400, e)
		return
	}
	clip.HTML, clip.Text, e = webcontent.Clean(clip.HTML)
	if e != nil {
		fail(w, 400, e)
		return
	}
	clip.noteID = uuid.NewString()
	c.pending = &clip
	c.seen[clip.ID] = true
	writeJSON(w, 202, map[string]any{"ok": true})
}

// All management requests arrive through the same-origin, unlocked app handler.
func (h *Handler) clipper(w http.ResponseWriter, r *http.Request) {
	if h.Clipper == nil {
		fail(w, 503, fmt.Errorf("clipper unavailable"))
		return
	}
	c := h.Clipper
	if r.Method == "GET" {
		c.mu.Lock()
		defer c.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true, "data": c.pending})
		return
	}
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	var input struct {
		Action    string `json:"action"`
		Extension string `json:"extension"`
		ID        string `json:"id"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil {
		fail(w, 400, fmt.Errorf("invalid clipper command"))
		return
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, fmt.Errorf("trailing data"))
		return
	}
	if input.Action == "pair" {
		access, e := c.pair(input.Extension)
		if e != nil {
			fail(w, 400, e)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "data": access})
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	switch input.Action {
	case "stop":
		c.token = ""
		c.origin = ""
		c.pending = nil
		c.seen = nil
		writeJSON(w, 200, map[string]bool{"ok": true})
	case "discard":
		if c.pending == nil || c.pending.ID != input.ID {
			fail(w, 409, fmt.Errorf("capture changed"))
			return
		}
		c.pending = nil
		writeJSON(w, 200, map[string]bool{"ok": true})
	case "accept":
		h.acceptClip(w, r, c, input.ID)
	default:
		fail(w, 400, fmt.Errorf("unknown clipper command"))
	}
}

// acceptClip saves the pending capture as a note. The caller holds c.mu.
func (h *Handler) acceptClip(w http.ResponseWriter, r *http.Request, c *Clipper, id string) {
	if c.pending == nil || c.pending.ID != id {
		fail(w, 409, fmt.Errorf("capture changed"))
		return
	}
	p := c.pending
	wire, _ := json.Marshal(map[string]any{"op": "save", "note": map[string]any{"id": p.noteID, "revision": 0, "content_format": "html", "title": p.Title, "content": p.HTML + "<p>출처: " + html.EscapeString(p.URL) + "</p>", "text": p.Text + "\n출처: " + p.URL, "tags": []string{"웹 클리핑"}}})
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 30*time.Second)
	defer cancel()
	data, e := h.Engine.Call(ctx, wire)
	if e != nil {
		fail(w, 500, fmt.Errorf("capture save failed; pending capture retained"))
		return
	}
	var result struct {
		OK bool `json:"ok"`
	}
	if json.Unmarshal(data, &result) != nil || !result.OK {
		existing, ok := h.recoverClipSave(ctx, p)
		if !ok {
			fail(w, 500, fmt.Errorf("capture save failed; pending capture retained"))
			return
		}
		data = existing
	}
	c.pending = nil
	w.Header().Set(headerContentType, mediaTypeJSON)
	_, _ = w.Write(data)
}

// recoverClipSave checks whether a failed-looking save actually landed. A
// previous save response may have been lost. Revision zero forbids an
// overwrite; verify this server-generated ID before accepting a retry.
func (h *Handler) recoverClipSave(ctx context.Context, p *Clip) (json.RawMessage, bool) {
	lookup, _ := json.Marshal(map[string]string{"op": "get", "id": p.noteID})
	existing, lookupErr := h.Engine.Call(ctx, lookup)
	var recovered struct {
		OK   bool `json:"ok"`
		Data struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			Content string `json:"content"`
		} `json:"data"`
	}
	if lookupErr != nil || json.Unmarshal(existing, &recovered) != nil || !recovered.OK || recovered.Data.ID != p.noteID || recovered.Data.Title != p.Title || recovered.Data.Content != p.HTML+"<p>출처: "+html.EscapeString(p.URL)+"</p>" {
		return nil, false
	}
	return existing, true
}
