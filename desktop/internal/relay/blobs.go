package relay

// Blob endpoints relay opaque attachment ciphertext for the Windows client.
// The relay never sees vault keys, file names, or plaintext: bodies are
// stored byte-for-byte under a canonical lowercase UUID, exactly as received.

import (
	"bytes"
	"errors"
	bolt "go.etcd.io/bbolt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

const (
	// blobPrefix routes every /v1/blobs/{id} request.
	blobPrefix = "/v1/blobs/"
	// minBlobBytes is the smallest possible ciphertext: a 24-byte XChaCha20
	// nonce plus a 16-byte Poly1305 tag over an empty plaintext.
	minBlobBytes = 40
	// maxBlobBytes caps one encrypted chunk: 256 KiB plaintext plus the
	// 24-byte nonce and 16-byte tag overhead.
	maxBlobBytes = 256<<10 + 24 + 16
)

var (
	blobsBucket     = []byte("blobs")
	errBlobConflict = errors.New("blob id already stored with different bytes")
	errBlobMissing  = errors.New("blob not found")
)

// validBlobID accepts only the canonical normalized form: 36 lowercase hex
// characters with hyphens at the 8-4-4-4-12 groups. Uppercase, braced,
// urn-prefixed, or suffixed variants are rejected so one ID can never alias
// another record's bytes.
func validBlobID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				return false
			}
		}
	}
	return true
}

// serveBlob handles PUT/GET for one blob after Bearer authentication.
func (r *Relay) serveBlob(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, blobPrefix)
	if !validBlobID(id) {
		http.NotFound(w, req)
		return
	}
	switch req.Method {
	case http.MethodPut:
		r.putBlob(w, req, id)
	case http.MethodGet:
		r.getBlob(w, req, id)
	default:
		w.Header().Set("Allow", "GET, PUT")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// putBlob stores an immutable blob atomically. The first upload of an ID
// returns 201, an identical replay returns 200, and any different payload
// returns 409 while leaving the original bytes untouched.
func (r *Relay) putBlob(w http.ResponseWriter, req *http.Request, id string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxBlobBytes+1))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) || len(body) > maxBlobBytes {
			respond(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "blob exceeds maximum size"})
			return
		}
		respond(w, http.StatusBadRequest, map[string]string{"error": "failed to read blob body"})
		return
	}
	if len(body) > maxBlobBytes {
		respond(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "blob exceeds maximum size"})
		return
	}
	if len(body) < minBlobBytes {
		respond(w, http.StatusBadRequest, map[string]string{"error": "blob below minimum ciphertext size"})
		return
	}
	created := false
	err = r.db.Update(func(tx *bolt.Tx) error {
		existing := tx.Bucket(blobsBucket).Get([]byte(id))
		if existing != nil {
			if !bytes.Equal(existing, body) {
				return errBlobConflict
			}
			return nil
		}
		created = true
		return tx.Bucket(blobsBucket).Put([]byte(id), body)
	})
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errBlobConflict) {
			status = http.StatusConflict
		}
		respond(w, status, map[string]string{"error": err.Error()})
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	respond(w, status, map[string]int{"size": len(body)})
}

// getBlob copies the stored bytes inside the read transaction and writes them
// to the client afterwards, so a slow reader never pins the bbolt read lock
// or blocks writers.
func (r *Relay) getBlob(w http.ResponseWriter, req *http.Request, id string) {
	var payload []byte
	err := r.db.View(func(tx *bolt.Tx) error {
		stored := tx.Bucket(blobsBucket).Get([]byte(id))
		if stored == nil {
			return errBlobMissing
		}
		payload = append(make([]byte, 0, len(stored)), stored...)
		return nil
	})
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errBlobMissing) {
			status = http.StatusNotFound
		}
		respond(w, status, map[string]string{"error": err.Error()})
		return
	}
	// The view transaction is already closed here.
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}
