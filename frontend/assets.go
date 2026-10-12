// Package frontend embeds the built web UI (vite output in dist/) for the desktop app.
package frontend

import "embed"

//go:embed all:dist
var Dist embed.FS
