package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// The renderer cannot supply filesystem paths. The native host chooses the
// destination with an OS dialog. Keep the operation alive if the fetch ends.
func (h *Handler) copyEncrypted(w http.ResponseWriter, r *http.Request) {
	if h.EncryptedCopy == nil {
		fail(w, 400, fmt.Errorf("암호화 복사는 Windows 앱에서 실행해 주세요"))
		return
	}
	if !emptyHostRequest(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 30*time.Minute)
	defer cancel()
	target, err := h.EncryptedCopy(ctx)
	if err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"cancelled": target == "", "path": target}})
}

func emptyHostRequest(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, fmt.Errorf("JSON required"))
		return false
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 128))
	var args map[string]json.RawMessage
	if err != nil || json.Unmarshal(raw, &args) != nil || args == nil || len(args) != 0 {
		fail(w, 400, fmt.Errorf("저장소 위치는 Windows 선택창에서 지정해 주세요"))
		return false
	}
	return true
}
