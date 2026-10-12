package relay

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/FelixBaek/inkism/desktop/internal/googleauth"
	bolt "go.etcd.io/bbolt"
)

var recoveryBucket = []byte("owner-recovery-v1")
var recoveryOwner = []byte("owner")
var recoveryVault = []byte("vault")
var escrowMagic = []byte("MINDBOX-SERVER-KEY-1\n")

type ownerRecovery struct {
	google *googleauth.Client
	owner  string
	aead   cipher.AEAD
	aad    []byte
}

// EnableOwnerRecovery must run before serving requests. The server operator
// can decrypt this escrow; enabling it deliberately changes the trust model.
// Existing account/key bindings cannot be silently replaced on restart.
func (r *Relay) EnableOwnerRecovery(clientID, subject string, masterKey []byte) error {
	if r.recovery != nil || len(subject) == 0 || len(subject) > 255 || len(masterKey) != 32 {
		return errors.New("invalid owner recovery configuration")
	}
	for _, b := range []byte(subject) {
		if b < 0x21 || b > 0x7e {
			return errors.New("invalid owner recovery subject")
		}
	}
	google, err := googleauth.New(clientID, func(string) error { return googleauth.ErrNotConfigured })
	if err != nil {
		return errors.New("invalid owner recovery client ID")
	}
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return errors.New("invalid owner recovery encryption key")
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	cfg := &ownerRecovery{google: google, owner: subject, aead: aead,
		aad: []byte("Mindbox owner recovery v1\x00https://accounts.google.com\x00" + subject)}
	err = r.db.Update(cfg.bindStore)
	if err != nil {
		return err
	}
	r.recovery = cfg
	return nil
}

// bindStore checks or records the owner binding and verifies that any stored
// escrow opens with this configuration.
func (c *ownerRecovery) bindStore(tx *bolt.Tx) error {
	b, err := tx.CreateBucketIfNotExists(recoveryBucket)
	if err != nil {
		return err
	}
	owner := b.Get(recoveryOwner)
	if owner != nil && string(owner) != c.owner {
		return errors.New("recovery account binding differs")
	}
	if stored := b.Get(recoveryVault); stored != nil {
		key, err := c.open(stored)
		if err != nil {
			return errors.New("existing recovery key cannot be opened; preserve the database and original master key")
		}
		clear(key)
	}
	if owner == nil {
		return b.Put(recoveryOwner, []byte(c.owner))
	}
	return nil
}

func (c *ownerRecovery) open(envelope []byte) ([]byte, error) {
	size := len(escrowMagic) + c.aead.NonceSize() + 32 + c.aead.Overhead()
	if len(envelope) != size || !bytes.HasPrefix(envelope, escrowMagic) {
		return nil, errors.New("invalid recovery envelope")
	}
	nonce := envelope[len(escrowMagic) : len(escrowMagic)+c.aead.NonceSize()]
	return c.aead.Open(nil, nonce, envelope[len(escrowMagic)+c.aead.NonceSize():], c.aad)
}

func (c *ownerRecovery) seal(key []byte) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	result := append(append([]byte(nil), escrowMagic...), nonce...)
	return c.aead.Seal(result, nonce, key, c.aad), nil
}

func (r *Relay) serveRecovery(w http.ResponseWriter, req *http.Request) {
	c := r.recovery
	if c == nil {
		http.NotFound(w, req)
		return
	}
	if req.Method != "GET" && req.Method != "PUT" {
		w.Header().Set("Allow", "GET, PUT")
		w.WriteHeader(405)
		return
	}
	headers := req.Header.Values("Authorization")
	if len(headers) != 1 || !strings.HasPrefix(headers[0], "Bearer ") || len(headers[0]) > (64<<10)+7 {
		respond(w, 401, map[string]string{"error": "Google authentication required"})
		return
	}
	identity, err := c.google.VerifyIDToken(req.Context(), strings.TrimPrefix(headers[0], "Bearer "))
	if err != nil {
		respond(w, 401, map[string]string{"error": "Google authentication failed"})
		return
	}
	if identity.Issuer != "https://accounts.google.com" || identity.Subject != c.owner {
		respond(w, 403, map[string]string{"error": "recovery account differs"})
		return
	}
	if req.Method == "GET" {
		r.sendRecoveryKey(w, c)
		return
	}
	r.registerRecoveryKey(w, req)
}

func (r *Relay) sendRecoveryKey(w http.ResponseWriter, c *ownerRecovery) {
	var key []byte
	err := r.db.View(func(tx *bolt.Tx) error {
		stored := tx.Bucket(recoveryBucket).Get(recoveryVault)
		if stored == nil {
			return nil
		}
		var err error
		key, err = c.open(stored)
		return err
	})
	defer clear(key)
	if err != nil {
		respond(w, 500, map[string]string{"error": "recovery key unavailable"})
		return
	}
	if key == nil {
		respond(w, 404, map[string]string{"error": "no recovery key registered"})
		return
	}
	respond(w, 200, map[string]string{"key": base64.StdEncoding.EncodeToString(key), "token": r.token})
}

func (r *Relay) registerRecoveryKey(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Key string `json:"key"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, 2048))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || len(body.Key) != 44 || decoder.Decode(new(any)) != io.EOF {
		respond(w, 400, map[string]string{"error": "invalid recovery registration"})
		return
	}
	key, err := base64.StdEncoding.Strict().DecodeString(body.Key)
	defer clear(key)
	if err != nil || len(key) != 32 {
		respond(w, 400, map[string]string{"error": "invalid recovery key"})
		return
	}
	err = r.RegisterOwnerKey(key)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrRecoveryConflict) {
			status = http.StatusConflict
		}
		respond(w, status, map[string]string{"error": "recovery registration failed"})
		return
	}
	respond(w, 200, map[string]bool{"registered": true})
}

var ErrRecoveryConflict = errors.New("a different recovery key is already registered")

// RegisterOwnerKey is also used by the offline server administrator command.
// Remote callers must always pass the Google authentication check above.
// The bbolt lock prevents offline provisioning while the relay is running.
func (r *Relay) RegisterOwnerKey(key []byte) error {
	c := r.recovery
	if c == nil || len(key) != 32 {
		return errors.New("invalid recovery registration")
	}
	return r.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(recoveryBucket)
		if stored := b.Get(recoveryVault); stored != nil {
			old, err := c.open(stored)
			defer clear(old)
			if err != nil {
				return err
			}
			if subtle.ConstantTimeCompare(old, key) != 1 {
				return ErrRecoveryConflict
			}
			return nil
		}
		sealed, err := c.seal(key)
		if err != nil {
			return err
		}
		return b.Put(recoveryVault, sealed)
	})
}
