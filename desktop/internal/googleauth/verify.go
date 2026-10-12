package googleauth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"strings"
	"time"
)

func (c *Client) verify(ctx context.Context, token, nonce string) (Identity, error) {
	return c.verifyToken(ctx, token, &nonce)
}

// VerifyIDToken authenticates a bearer ID token received by a trusted HTTPS
// backend. Browser login still requires its independently generated nonce.
// The returned subject is verified; caller-supplied IDs are not identities.
func (c *Client) VerifyIDToken(ctx context.Context, token string) (Identity, error) {
	return c.verifyToken(ctx, token, nil)
}

type idTokenHeader struct {
	Alg  string   `json:"alg"`
	Kid  string   `json:"kid"`
	Crit []string `json:"crit"`
}

type idTokenClaims struct {
	Issuer          string          `json:"iss"`
	Subject         string          `json:"sub"`
	Audience        json.RawMessage `json:"aud"`
	AuthorizedParty string          `json:"azp"`
	Expires         int64           `json:"exp"`
	Issued          int64           `json:"iat"`
	NotBefore       int64           `json:"nbf"`
	Nonce           string          `json:"nonce"`
	Email           string          `json:"email"`
	EmailVerified   bool            `json:"email_verified"`
	Name            string          `json:"name"`
}

type jsonWebKey struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func decodeTokenPart(s string, out any) bool {
	b, e := base64.RawURLEncoding.DecodeString(s)
	return e == nil && json.Unmarshal(b, out) == nil
}

func (c *Client) verifyToken(ctx context.Context, token string, nonce *string) (Identity, error) {
	invalid := func() (Identity, error) { return Identity{}, ErrInvalidToken }
	if len(token) > 64<<10 {
		return invalid()
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return invalid()
	}
	var header idTokenHeader
	if !decodeTokenPart(parts[0], &header) || header.Alg != "RS256" || header.Kid == "" || len(header.Kid) > 256 || len(header.Crit) > 0 {
		return invalid()
	}
	signature, e := base64.RawURLEncoding.DecodeString(parts[2])
	if e != nil {
		return invalid()
	}
	var claims idTokenClaims
	if !decodeTokenPart(parts[1], &claims) || !c.validClaims(claims, nonce) {
		return invalid()
	}
	public, e := c.signingKey(ctx, header.Kid)
	if e != nil {
		return Identity{}, e
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if rsa.VerifyPKCS1v15(public, crypto.SHA256, digest[:], signature) != nil {
		return invalid()
	}
	return Identity{Issuer: "https://accounts.google.com", Subject: claims.Subject, Email: claims.Email, EmailVerified: claims.EmailVerified, Name: claims.Name}, nil
}

// validClaims checks issuer, subject, timing, nonce and audience.
func (c *Client) validClaims(claims idTokenClaims, nonce *string) bool {
	now := time.Now().Unix()
	if (claims.Issuer != "https://accounts.google.com" && claims.Issuer != "accounts.google.com") || !validSubject(claims.Subject) || claims.Expires <= now || claims.Issued <= 0 || claims.Issued > now+60 || claims.NotBefore > now+60 || claims.Expires <= claims.Issued {
		return false
	}
	if nonce != nil && subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(*nonce)) != 1 {
		return false
	}
	var aud string
	var audiences []string
	if json.Unmarshal(claims.Audience, &aud) == nil {
		audiences = []string{aud}
	} else if json.Unmarshal(claims.Audience, &audiences) != nil {
		return false
	}
	found := false
	for _, a := range audiences {
		if a == c.id {
			found = true
		}
	}
	return found && !(len(audiences) > 1 && claims.AuthorizedParty != c.id) && !(claims.AuthorizedParty != "" && claims.AuthorizedParty != c.id)
}

// signingKey fetches Google's keys and returns the single RS256 key for kid.
// Malformed or ambiguous keys yield ErrInvalidToken.
func (c *Client) signingKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	var keys struct {
		Keys []jsonWebKey `json:"keys"`
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", keysEndpoint, nil)
	if e := c.request(req, &keys); e != nil {
		return nil, e
	}
	var public *rsa.PublicKey
	for _, k := range keys.Keys {
		if k.Kid != kid {
			continue
		}
		if public != nil {
			return nil, ErrInvalidToken
		}
		var ok bool
		if public, ok = rsaKey(k); !ok {
			return nil, ErrInvalidToken
		}
	}
	if public == nil {
		return nil, ErrInvalidToken
	}
	return public, nil
}

func rsaKey(k jsonWebKey) (*rsa.PublicKey, bool) {
	if k.Kty != "RSA" || k.Alg != "RS256" || (k.Use != "" && k.Use != "sig") {
		return nil, false
	}
	n, ne := base64.RawURLEncoding.DecodeString(k.N)
	eb, ee := base64.RawURLEncoding.DecodeString(k.E)
	if ne != nil || ee != nil || len(n) < 256 || len(n) > 1024 || len(eb) == 0 || len(eb) > 4 {
		return nil, false
	}
	exponent := 0
	for _, b := range eb {
		exponent = exponent*256 + int(b)
	}
	if exponent < 3 || exponent > 2147483647 || exponent%2 == 0 {
		return nil, false
	}
	public := &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exponent}
	if public.N.BitLen() < 2048 {
		return nil, false
	}
	return public, true
}

// Google subject identifiers are nonempty printable ASCII, at most 255 bytes.
func validSubject(subject string) bool {
	if len(subject) == 0 || len(subject) > 255 {
		return false
	}
	for _, b := range []byte(subject) {
		if b < 0x21 || b > 0x7e {
			return false
		}
	}
	return true
}
