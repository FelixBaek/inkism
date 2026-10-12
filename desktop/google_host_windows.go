//go:build windows

package main

import (
	"context"
	"github.com/FelixBaek/inkism/desktop/internal/googleauth"
	"github.com/FelixBaek/inkism/desktop/internal/googlehost"
	"github.com/pkg/browser"
	"path/filepath"
)

type googleProvider struct{ client *googleauth.Client }

func (p googleProvider) Login(ctx context.Context) (googlehost.Identity, string, error) {
	identity, token, err := p.client.LoginWithIDToken(ctx)
	return googlehost.Identity{Issuer: identity.Issuer, Subject: identity.Subject}, token, err
}
func (p googleProvider) Cancel() { p.client.Cancel() }
func newGoogleSecurity(root string) *googlehost.Controller {
	store := googlehost.WindowsStore(filepath.Join(root, "Inkism", "google-account.dpapi"))
	var provider googlehost.Provider
	if config, err := googlehost.ReadConfig(filepath.Join(root, "Inkism", "google-client.json")); err == nil {
		credentials := googlehost.WindowsStore(filepath.Join(root, "Inkism", "google-client-secret.dpapi"))
		if secret, err := credentials.LoadClientSecret(config.ClientID); err == nil {
			if client, err := googleauth.NewWithClientSecret(config.ClientID, secret, browser.OpenURL); err == nil {
				provider = googleProvider{client}
			}
		}
	}
	return googlehost.New(provider, store)
}
