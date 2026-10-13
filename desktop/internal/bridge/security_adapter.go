package bridge

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

type SecurityController interface {
	Status() SecurityStatus
	Login(context.Context) error
	Cancel()
	Lock() error
	Disable(context.Context) error
}

func (h *Handler) security(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/security/status" && r.Method == "GET" {
		writeJSON(w, 200, map[string]any{"ok": true, "data": h.Security.Status()})
		return
	}
	if r.Method != "POST" {
		fail(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	if !emptyHostRequest(w, r) {
		return
	}
	switch r.URL.Path {
	case "/api/security/login":
		if !h.Security.Status().Available {
			fail(w, 503, fmt.Errorf("Google 로그인 설정 또는 계정 보호 설정을 확인해 주세요"))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		if err := h.Security.Login(ctx); err != nil {
			fail(w, 409, err)
			return
		}
	case "/api/security/disable":
		if status := h.Security.Status(); !status.Available || !status.Configured || status.Locked {
			fail(w, 409, fmt.Errorf("잠금을 해제한 상태에서만 끌 수 있습니다"))
			return
		}
		// Always a full Google login inside; there is no body or flag to skip it.
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		if err := h.Security.Disable(ctx); err != nil {
			fail(w, 409, err)
			return
		}
	case "/api/security/cancel":
		h.Security.Cancel()
	case "/api/security/lock":
		if err := h.Security.Lock(); err != nil {
			fail(w, 400, err)
			return
		}
	default:
		fail(w, 404, fmt.Errorf("not found"))
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": h.Security.Status()})
}
