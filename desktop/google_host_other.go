//go:build !windows

package main

import "github.com/FelixBaek/inkism/desktop/internal/googlehost"

func newGoogleSecurity(string) *googlehost.Controller { return nil }
