package relay

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/FelixBaek/inkism/desktop/internal/webcontent"
	bolt "go.etcd.io/bbolt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var publicationsBucket = []byte("public-note-snapshots")
var capabilityPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Publication struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	HTML    string `json:"html,omitempty"`
	Created int64  `json:"created"`
	Expires int64  `json:"expires"`
}

// Public requests can retrieve exactly one bounded immutable snapshot, never
// sync records, attachments, a listing, owner tokens, or a private library.
func (r *Relay) servePublic(w http.ResponseWriter, q *http.Request) {
	if q.Method != "GET" && q.Method != "HEAD" {
		http.NotFound(w, q)
		return
	}
	id := strings.TrimPrefix(q.URL.Path, "/p/")
	if !capabilityPattern.MatchString(id) || q.URL.RawQuery != "" {
		http.NotFound(w, q)
		return
	}
	var value Publication
	e := r.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(publicationsBucket)
		if b == nil {
			return fmt.Errorf("not found")
		}
		data := b.Get([]byte(id))
		if data == nil {
			return fmt.Errorf("not found")
		}
		return json.Unmarshal(data, &value)
	})
	if e != nil || value.Expires <= time.Now().Unix() {
		http.NotFound(w, q)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
	if q.Method == "HEAD" {
		return
	}
	fmt.Fprintf(w, `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>%s</title><style>body{max-width:760px;margin:40px auto;padding:20px;font:17px/1.7 system-ui;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:6px}pre{white-space:pre-wrap}</style><h1>%s</h1><main>%s</main></html>`, html.EscapeString(value.Title), html.EscapeString(value.Title), value.HTML)
}

// Caller was authenticated by Relay.ServeHTTP before reaching owner routes.
func (r *Relay) servePublications(w http.ResponseWriter, q *http.Request) {
	if q.Header.Get("Origin") != "" || q.Header.Get("Sec-Fetch-Site") == "cross-site" {
		respond(w, 403, map[string]string{"error": "browser owner requests rejected"})
		return
	}
	if q.URL.RawQuery != "" {
		http.NotFound(w, q)
		return
	}
	switch {
	case q.URL.Path == "/v1/publications" && q.Method == "GET":
		r.listPublications(w)
	case q.URL.Path == "/v1/publications" && q.Method == "POST":
		r.createPublication(w, q)
	case strings.HasPrefix(q.URL.Path, "/v1/publications/") && q.Method == "DELETE":
		r.revokePublication(w, q)
	default:
		http.NotFound(w, q)
	}
}

func (r *Relay) listPublications(w http.ResponseWriter) {
	items := []Publication{}
	e := r.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(publicationsBucket)
		if b == nil {
			return nil
		}
		return b.ForEach(func(_, v []byte) error {
			var p Publication
			if e := json.Unmarshal(v, &p); e != nil {
				return e
			}
			if p.Expires > time.Now().Unix() {
				p.HTML = ""
				items = append(items, p)
			}
			return nil
		})
	})
	if e != nil {
		respond(w, 500, map[string]string{"error": "publication list failed"})
		return
	}
	respond(w, 200, items)
}

func (r *Relay) createPublication(w http.ResponseWriter, q *http.Request) {
	var input struct {
		Title string `json:"title"`
		HTML  string `json:"html"`
		Days  int    `json:"days"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, q.Body, webcontent.MaxBytes+8192))
	d.DisallowUnknownFields()
	if e := d.Decode(&input); e != nil || input.Days < 1 || input.Days > 30 || len(input.Title) > 1024 {
		respond(w, 400, map[string]string{"error": "invalid snapshot"})
		return
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		respond(w, 400, map[string]string{"error": "trailing data"})
		return
	}
	clean, _, e := webcontent.Clean(input.HTML)
	if e != nil {
		respond(w, 400, map[string]string{"error": e.Error()})
		return
	}
	var secret [32]byte
	if _, e = rand.Read(secret[:]); e != nil {
		respond(w, 500, map[string]string{"error": "capability generation failed"})
		return
	}
	p := Publication{ID: hex.EncodeToString(secret[:]), Title: input.Title, HTML: clean, Created: time.Now().Unix(), Expires: time.Now().Add(time.Duration(input.Days) * 24 * time.Hour).Unix()}
	e = r.db.Update(func(tx *bolt.Tx) error { return storePublication(tx, p) })
	if e != nil {
		respond(w, 409, map[string]string{"error": "snapshot limit or storage failure"})
		return
	}
	p.HTML = ""
	respond(w, 201, p)
}

// storePublication drops expired snapshots and stores p within the active cap.
func storePublication(tx *bolt.Tx, p Publication) error {
	b, e := tx.CreateBucketIfNotExists(publicationsBucket)
	if e != nil {
		return e
	}
	expired := [][]byte{}
	active := 0
	_ = b.ForEach(func(k, v []byte) error {
		var old Publication
		if json.Unmarshal(v, &old) == nil && old.Expires <= time.Now().Unix() {
			expired = append(expired, append([]byte(nil), k...))
		} else {
			active++
		}
		return nil
	})
	for _, k := range expired {
		if e := b.Delete(k); e != nil {
			return e
		}
	}
	if active >= 100 {
		return fmt.Errorf("at most 100 active snapshots")
	}
	data, e := json.Marshal(p)
	if e != nil {
		return e
	}
	return b.Put([]byte(p.ID), data)
}

func (r *Relay) revokePublication(w http.ResponseWriter, q *http.Request) {
	id := strings.TrimPrefix(q.URL.Path, "/v1/publications/")
	if !capabilityPattern.MatchString(id) {
		http.NotFound(w, q)
		return
	}
	e := r.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(publicationsBucket)
		if b == nil {
			return nil
		}
		return b.Delete([]byte(id))
	})
	if e != nil {
		respond(w, 500, map[string]string{"error": "revoke failed"})
		return
	}
	w.WriteHeader(204)
}
