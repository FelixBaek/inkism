package bridge

import (
	"encoding/json"
	"github.com/FelixBaek/inkism/desktop/internal/reminders"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestReminderSettingsBoundaries(t *testing.T) {
	service, err := reminders.New(filepath.Join(t.TempDir(), "state"), nil, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	h := &Handler{Reminders: service}
	for _, tc := range []struct {
		body, origin string
		status       int
	}{
		{`{"enabled":true}`, "", 200},
		{`{"enabled":false,"surprise":1}`, "", 400},
		{`{"enabled":false}{}`, "", 400},
		{`{"enabled":false}`, "https://evil.example", 403},
		{`{}`, "", 400},
	} {
		r := httptest.NewRequest("POST", "http://localhost/api/reminders/settings", strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.body, w.Code, w.Body.String())
		}
	}
	if !service.Enabled() {
		t.Fatal("rejected writes changed opt-in")
	}
}

func TestReminderMutationDoesNotScanForTyping(t *testing.T) {
	for _, raw := range []string{`{"op":"source_splice","replacement":"x"}`, `{"op":"save","note":{"content":"typing","content_format":"text"}}`, `{"op":"patch","changes":{"title":"name"}}`, `{"op":"document_splice_html","edits":[]}`} {
		if reminderMutation(json.RawMessage(raw)) {
			t.Fatal("ordinary editing invalidated schedule cache", raw)
		}
	}
	for _, raw := range []string{`{"op":"patch","changes":{"reminder_at":null}}`, `{"op":"save","note":{"reminder_repeat_hours":24}}`, `{"op":"patch","changes":{"trashed":true}}`, `{"op":"import"}`, `{"op":"delete"}`, `{"op":"sync_now"}`, `{"op":"merge_notes"}`, `{"op":"merge_apply"}`, `{"op":"merge_undo"}`, `{"op":"restore_notebook"}`} {
		if !reminderMutation(json.RawMessage(raw)) {
			t.Fatal("missed schedule mutation", raw)
		}
	}
}
