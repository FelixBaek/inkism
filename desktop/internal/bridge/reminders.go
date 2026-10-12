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

func (e *Engine) ReminderStatePath() string { return e.database + ".reminders.json" }
func (h *Handler) reminderSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		if h.Reminders == nil {
			writeJSON(w, 200, map[string]any{"available": false})
			return
		}
		writeJSON(w, 200, map[string]any{"available": true, "enabled": h.Reminders.Enabled(), "delivery_error": h.Reminders.LastError(), "background": h.Reminders.BackgroundEnabled(), "background_available": h.Reminders.BackgroundAvailable()})
		return
	}
	if r.Method != "POST" {
		fail(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	if h.Reminders == nil {
		fail(w, 400, fmt.Errorf("Windows 앱에서 사용할 수 있습니다"))
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, fmt.Errorf("JSON required"))
		return
	}
	var req struct {
		Enabled    *bool `json:"enabled"`
		Background *bool `json:"background"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		fail(w, 400, fmt.Errorf("invalid settings"))
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF || (req.Enabled == nil) == (req.Background == nil) {
		fail(w, 400, fmt.Errorf("one settings operation required"))
		return
	}
	var err error
	if req.Enabled != nil {
		err = h.Reminders.SetEnabled(*req.Enabled)
	} else {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		err = h.Reminders.SetBackground(ctx, *req.Background)
	}
	if err != nil {
		fail(w, 400, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// Reminder cache invalidation never runs for ordinary source/body/title edits.
func reminderMutation(raw json.RawMessage) bool {
	var req struct {
		Op      string                     `json:"op"`
		Note    map[string]json.RawMessage `json:"note"`
		Changes map[string]json.RawMessage `json:"changes"`
	}
	if json.Unmarshal(raw, &req) != nil {
		return false
	}
	switch req.Op {
	case "delete", "restore", "import", "sync_now", "delete_notebook", "trash_notebook", "restore_notebook", "merge_notes", "merge_apply", "merge_undo":
		return true
	case "save", "patch":
		fields := req.Note
		if req.Op == "patch" {
			fields = req.Changes
		}
		for _, key := range []string{"reminder_at", "reminder_repeat_hours", "trashed"} {
			if _, ok := fields[key]; ok {
				return true
			}
		}
	}
	return false
}
