package googleauth

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

// VerifyIDToken serves trusted HTTPS backends that receive bearer ID tokens:
// no browser nonce exists, so the nonce claim is neither required nor checked.
func TestBackendVerifyIDTokenWithoutNonce(t *testing.T) {
	k := key(t)
	c, _ := New(testID, func(string) error { return nil })
	c.http.Transport = transport(func(*http.Request) (*http.Response, error) { return response(200, jwks(k)), nil })
	cl := claims("browser-nonce")
	delete(cl, "nonce")
	token := signed(t, k, cl, "RS256")
	id, e := c.VerifyIDToken(context.Background(), token)
	if e != nil || id.Issuer != "https://accounts.google.com" || id.Subject != "synthetic-subject" || !id.EmailVerified {
		t.Fatal(id, e)
	}
	// A nonce-less backend token must never satisfy the browser login flow.
	if _, e := c.verify(context.Background(), token, "browser-nonce"); !errors.Is(e, ErrInvalidToken) {
		t.Fatal(e)
	}
	// The browser flow still rejects a mismatching nonce claim.
	if _, e := c.verify(context.Background(), signed(t, k, claims("other"), "RS256"), "browser-nonce"); !errors.Is(e, ErrInvalidToken) {
		t.Fatal(e)
	}
}

func TestBackendVerifyIDTokenRejectsWrongAudExpiredAndForged(t *testing.T) {
	k, forged := key(t), key(t)
	c, _ := New(testID, func(string) error { return nil })
	c.http.Transport = transport(func(*http.Request) (*http.Response, error) { return response(200, jwks(k)), nil })
	cases := map[string]func(map[string]any){
		"wrong-aud": func(cl map[string]any) { cl["aud"] = "other-client" },
		"expired":   func(cl map[string]any) { cl["exp"] = time.Now().Unix() - 1 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cl := claims("")
			mutate(cl)
			if _, e := c.VerifyIDToken(context.Background(), signed(t, k, cl, "RS256")); !errors.Is(e, ErrInvalidToken) {
				t.Fatal(e)
			}
		})
	}
	t.Run("forged", func(t *testing.T) {
		if _, e := c.VerifyIDToken(context.Background(), signed(t, forged, claims(""), "RS256")); !errors.Is(e, ErrInvalidToken) {
			t.Fatal(e)
		}
	})
}
