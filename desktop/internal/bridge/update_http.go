package bridge

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// /api/update/{status,check,apply}: app self-update (portable Windows layout).
// Apply only downloads, verifies and stages; the renderer then closes the app
// through its normal save-and-close path and a helper swaps the files.
func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	if h.Update == nil {
		fail(w, 404, fmt.Errorf("업데이트를 쓸 수 없습니다"))
		return
	}
	if r.Method == "POST" && !emptyHostRequest(w, r) {
		return
	}
	ctx := context.WithoutCancel(r.Context())
	switch {
	case r.URL.Path == "/api/update/status" && r.Method == "GET":
		writeJSON(w, 200, map[string]any{"ok": true, "data": h.Update.Status()})
	case r.URL.Path == "/api/update/check" && r.Method == "POST":
		ctx, cancel := context.WithTimeout(ctx, time.Minute)
		defer cancel()
		writeJSON(w, 200, map[string]any{"ok": true, "data": h.Update.Check(ctx)})
	case r.URL.Path == "/api/update/apply" && r.Method == "POST":
		ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
		defer cancel()
		if err := h.Update.Apply(ctx); err != nil {
			fail(w, 409, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "data": h.Update.Status()})
	default:
		fail(w, 404, fmt.Errorf("not found"))
	}
}
