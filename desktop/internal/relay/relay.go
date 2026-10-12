// Package relay stores opaque encrypted sync records and explicitly published
// sanitized plaintext snapshots in separate buckets. Optional, explicitly
// configured owner recovery stores a server-encrypted vault key separately.
package relay

import (
	"crypto/subtle"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const MaxBlob = 32 << 20

var records = []byte("records")
var identities = []byte("identities")

type Record struct {
	Seq  uint64 `json:"seq"`
	ID   string `json:"id"`
	Blob string `json:"blob"`
}
type Relay struct {
	db       *bolt.DB
	token    string
	recovery *ownerRecovery
}

func Open(path, token string) (*Relay, error) {
	if len(token) < 32 {
		return nil, errors.New("relay token must be at least 32 characters")
	}
	db, err := bolt.Open(path, 0600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, err
	}
	err = db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists(records)
		if err != nil {
			return err
		}
		_, err = tx.CreateBucketIfNotExists(identities)
		if err != nil {
			return err
		}
		_, err = tx.CreateBucketIfNotExists(blobsBucket)
		return err
	})
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Relay{db: db, token: token}, nil
}
func (r *Relay) Close() error { return r.db.Close() }
func key(n uint64) []byte     { b := make([]byte, 8); binary.BigEndian.PutUint64(b, n); return b }
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if req.URL.Path == "/v1/recovery/key" {
		r.serveRecovery(w, req)
		return
	}
	if strings.HasPrefix(req.URL.Path, "/p/") {
		r.servePublic(w, req)
		return
	}
	supplied := strings.TrimPrefix(req.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(supplied), []byte(r.token)) != 1 {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	if strings.HasPrefix(req.URL.Path, "/v1/publications") {
		r.servePublications(w, req)
		return
	}
	if strings.HasPrefix(req.URL.Path, blobPrefix) {
		r.serveBlob(w, req)
		return
	}
	if req.URL.Path != "/v1/changes" {
		http.NotFound(w, req)
		return
	}
	switch req.Method {
	case "POST":
		r.postChange(w, req)
	case "GET":
		r.getChanges(w, req)
	default:
		w.Header().Set("Allow", "GET, POST")
		w.WriteHeader(405)
	}
}

func (r *Relay) postChange(w http.ResponseWriter, req *http.Request) {
	var item Record
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, MaxBlob+1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&item); err != nil || len(item.ID) < 16 || len(item.ID) > 128 || len(item.Blob) == 0 || len(item.Blob) > MaxBlob {
		respond(w, 400, map[string]string{"error": "invalid change"})
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		respond(w, 400, map[string]string{"error": "trailing data"})
		return
	}
	conflict := false
	err := r.db.Update(func(tx *bolt.Tx) error {
		var err error
		conflict, err = storeChange(tx, &item)
		return err
	})
	if err != nil {
		status := 500
		if conflict {
			status = 409
		}
		respond(w, status, map[string]string{"error": err.Error()})
		return
	}
	respond(w, 200, map[string]uint64{"seq": item.Seq})
}

// storeChange appends item once per ID; a replay with the same payload reuses
// the stored sequence and a different payload is a conflict.
func storeChange(tx *bolt.Tx, item *Record) (conflict bool, err error) {
	ids, b := tx.Bucket(identities), tx.Bucket(records)
	if existing := ids.Get([]byte(item.ID)); existing != nil {
		var old Record
		if err := json.Unmarshal(b.Get(existing), &old); err != nil {
			return false, err
		}
		if old.Blob != item.Blob {
			return true, errors.New("id already has different payload")
		}
		item.Seq = old.Seq
		return false, nil
	}
	seq, err := b.NextSequence()
	if err != nil {
		return false, err
	}
	item.Seq = seq
	data, err := json.Marshal(item)
	if err != nil {
		return false, err
	}
	if err = b.Put(key(seq), data); err != nil {
		return false, err
	}
	return false, ids.Put([]byte(item.ID), key(seq))
}

func (r *Relay) getChanges(w http.ResponseWriter, req *http.Request) {
	after, limit, ok := changesQuery(w, req)
	if !ok {
		return
	}
	items := make([]Record, 0, limit)
	cursor := after
	err := r.db.View(func(tx *bolt.Tx) error {
		var err error
		items, cursor, err = readChanges(tx, after, limit, items)
		return err
	})
	if err != nil {
		respond(w, 500, map[string]string{"error": fmt.Sprint(err)})
		return
	}
	respond(w, 200, map[string]any{"items": items, "cursor": cursor})
}

func changesQuery(w http.ResponseWriter, req *http.Request) (uint64, int, bool) {
	after := uint64(0)
	if raw := req.URL.Query().Get("after"); raw != "" {
		var err error
		after, err = strconv.ParseUint(raw, 10, 64)
		if err != nil {
			respond(w, 400, map[string]string{"error": "invalid cursor"})
			return 0, 0, false
		}
	}
	limit := 50
	if raw := req.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			respond(w, 400, map[string]string{"error": "limit must be 1..100"})
			return 0, 0, false
		}
		limit = n
	}
	return after, limit, true
}

// readChanges appends up to limit records after the cursor, capped near 40 MiB.
func readChanges(tx *bolt.Tx, after uint64, limit int, items []Record) ([]Record, uint64, error) {
	cursor := after
	c := tx.Bucket(records).Cursor()
	if after == ^uint64(0) {
		return items, cursor, nil
	}
	total := 0
	for k, v := c.Seek(key(after + 1)); k != nil && len(items) < limit; k, v = c.Next() {
		if len(items) > 0 && total+len(v) > 40<<20 {
			break
		}
		var item Record
		if err := json.Unmarshal(v, &item); err != nil {
			return items, cursor, err
		}
		items = append(items, item)
		cursor = item.Seq
		total += len(v)
	}
	return items, cursor, nil
}
