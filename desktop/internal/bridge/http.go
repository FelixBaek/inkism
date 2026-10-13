package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/FelixBaek/inkism/desktop/internal/appupdate"
	"github.com/FelixBaek/inkism/desktop/internal/reminders"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Caller interface {
	Call(context.Context, json.RawMessage) (json.RawMessage, error)
}
type Handler struct {
	Clipper        *Clipper
	Gate           *SessionGate
	Security       SecurityController
	PDFRender      func(context.Context, []byte) ([]byte, error)
	Reminders      *reminders.Service
	WindowedEditor bool
	LazyEditor     bool
	Engine         Caller
	Close          func()
	Host           string
	Upload         UploadAccess
	EncryptedCopy  func(context.Context) (string, error)
	OpenLibrary    func() (bool, error)
	Unsplash       *Unsplash // nil = key path beside the engine's library
	Update         *appupdate.Updater
	unsplashOnce   sync.Once
}

const (
	headerContentType     = "Content-Type"
	mediaTypeJSON         = "application/json"
	attachmentsPathPrefix = "/api/attachments/"
)

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set(headerContentType, mediaTypeJSON)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"ok": false, "error": err.Error()})
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if !h.sameOrigin(w, r) {
		return
	}
	if h.serveSecurity(w, r) {
		return
	}
	if r.URL.Path != "/api/close" {
		release, accepted := h.Gate.enter()
		if !accepted {
			fail(w, http.StatusLocked, fmt.Errorf("app is locked"))
			return
		}
		defer release()
	}
	// A renderer may abort an obsolete search. Finish its ordered protocol
	// response anyway; killing the storage process here would also lose a
	// concurrent autosave. Only a real engine timeout terminates the child.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 90*time.Second)
	defer cancel()
	h.route(w, r, ctx)
}

// sameOrigin rejects requests for another host or from another origin.
func (h *Handler) sameOrigin(w http.ResponseWriter, r *http.Request) bool {
	if h.Host != "" && r.Host != h.Host {
		fail(w, 403, fmt.Errorf("invalid host"))
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Host != r.Host {
			fail(w, 403, fmt.Errorf("cross-origin request rejected"))
			return false
		}
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		fail(w, 403, fmt.Errorf("cross-site request rejected"))
		return false
	}
	return true
}

// serveSecurity answers the security endpoints that bypass the session gate
// and reports whether it handled the request.
func (h *Handler) serveSecurity(w http.ResponseWriter, r *http.Request) bool {
	if h.Security != nil && strings.HasPrefix(r.URL.Path, "/api/security/") {
		h.security(w, r)
		return true
	}
	if r.URL.Path == "/api/security/status" && r.Method == "GET" {
		writeJSON(w, 200, map[string]any{"ok": true, "data": h.Gate.Status()})
		return true
	}
	if r.URL.Path != "/api/security/lock" || r.Method != "POST" {
		return false
	}
	if !emptyHostRequest(w, r) {
		return true
	}
	if h.Gate == nil {
		fail(w, 400, fmt.Errorf("app lock is not configured"))
		return true
	}
	if err := h.Gate.Lock(); err != nil {
		fail(w, 500, err)
		return true
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": h.Gate.Status()})
	return true
}

func (h *Handler) route(w http.ResponseWriter, r *http.Request, ctx context.Context) {
	switch {
	case r.URL.Path == "/api/export/html" || r.URL.Path == "/api/export/pdf":
		h.formattedExport(w, r, r.URL.Path == "/api/export/pdf")
	case r.URL.Path == "/api/reminders/settings":
		h.reminderSettings(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/unsplash/"):
		h.unsplash(w, r, ctx)
	case r.URL.Path == "/api/reader":
		h.reader(w, r)
	case r.URL.Path == "/api/clipper":
		h.clipper(w, r)
	case r.URL.Path == "/api/publications":
		h.publications(w, r)
	case strings.HasPrefix(r.URL.Path, attachmentsPathPrefix) && (r.Method == "GET" || r.Method == "HEAD"):
		h.downloadAttachment(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/update/"):
		h.update(w, r)
	default:
		h.routeExact(w, r, ctx)
	}
}

// routeExact dispatches endpoints bound to one method and path.
func (h *Handler) routeExact(w http.ResponseWriter, r *http.Request, ctx context.Context) {
	switch r.Method + " " + r.URL.Path {
	case "GET /api/upload-access":
		writeJSON(w, 200, h.Upload)
	case "GET /api/backup":
		h.exportBundle(w, r)
	case "POST /api/restore":
		h.restoreBundle(w, r)
	case "POST /api/attachments":
		h.uploadAttachment(w, r)
	case "GET /api/info":
		h.info(w)
	case "POST /api/storage/open":
		h.openStorage(w, r)
	case "POST /api/storage/encrypted-copy":
		h.copyEncrypted(w, r)
	case "POST /api/rpc":
		h.rendererRPC(w, r, ctx)
	case "GET /api/export":
		h.exportJSON(w, r, ctx)
	case "POST /api/import":
		h.importJSON(w, r, ctx)
	case "POST /api/close":
		writeJSON(w, 200, map[string]bool{"ok": true})
		if h.Close != nil {
			go h.Close()
		}
	default:
		http.NotFound(w, r)
	}
}

func (h *Handler) info(w http.ResponseWriter) {
	version := "0.1.0"
	if h.Update != nil {
		version = h.Update.Current()
	}
	writeJSON(w, 200, map[string]any{"name": "Inkism", "version": version, "platform": "desktop", "draft_journal": true, "windowed_editor": h.WindowedEditor, "lazy_editor": h.LazyEditor, "native_encrypted_copy": h.EncryptedCopy != nil, "native_open_library": h.OpenLibrary != nil, "native_pdf_export": h.PDFRender != nil})
}

func (h *Handler) openStorage(w http.ResponseWriter, r *http.Request) {
	if h.OpenLibrary == nil {
		fail(w, 400, fmt.Errorf("저장소 선택은 Windows 앱에서 사용할 수 있습니다"))
		return
	}
	if !emptyHostRequest(w, r) {
		return
	}
	opened, err := h.OpenLibrary()
	if err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"cancelled": !opened}})
}

func (h *Handler) rendererRPC(w http.ResponseWriter, r *http.Request, ctx context.Context) {
	if !strings.HasPrefix(r.Header.Get(headerContentType), mediaTypeJSON) {
		fail(w, 415, fmt.Errorf("JSON required"))
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxMessage-1))
	if err != nil {
		fail(w, 413, err)
		return
	}
	var req map[string]json.RawMessage
	if json.Unmarshal(raw, &req) != nil {
		fail(w, 400, fmt.Errorf("invalid JSON"))
		return
	}
	var op string
	_ = json.Unmarshal(req["op"], &op)
	// File paths are trusted host operations, never arbitrary renderer RPC.
	switch op {
	case "draft_journal_put", "draft_journal_clear", "draft_journal_status", "document_render", "document_splice_source", "convert_content", "due_reminders", "list", "get", "note_preview", "random_note", "collaboration_binding_get", "collaboration_binding_set", "document_blocks", "document_block_window", "document_segments", "document_locate", "document_info", "document_find", "document_splice", "document_splice_html", "save", "patch", "delete", "notebooks", "notebook_counts", "save_notebook", "delete_notebook", "trash_notebook", "restore_notebook", "trashed_notebooks", "defaults_get", "defaults_set", "vault_status", "vault_create", "vault_unlock", "vault_lock", "vault_change_password", "vault_lock_note", "vault_open", "vault_versions", "vault_save", "vault_unlock_note", "vault_clear", "vault_delete", "tags", "change_tag", "tag_change_preview", "tag_change_apply", "tag_change_undo", "tag_change_list", "stats", "trash_retention_get", "trash_retention_set", "trash_times", "trash_purge", "history", "history_changes", "history_name_current", "history_rename", "history_delete_named", "history_body", "revision_body", "restore", "health", "backlinks", "reference_preview", "reference_candidates", "outgoing_references", "unlinked_mentions", "backlink_location", "backlink_blocks", "outgoing_links", "index_status", "wait_index", "workspace_get", "workspace_set", "workspace_tools_get", "workspace_tools_set", "font_resources", "font_resource_set", "knowledge_get", "knowledge_set", "knowledge_list", "knowledge_settings_get", "knowledge_settings_set", "link_resolve", "graph_get", "merge_notes", "merge_preview", "merge_apply", "merge_undo", "merge_changes", "page_create", "daily_note", "template_create", "split_get", "split_set", "editor_history_get", "editor_history_set", "storage_status", "remote_history_list", "remote_history_preview", "remote_history_restore", "sync_scope", "sync_status", "sync_config", "sync_now", "sync_pause", "sync_keygen":
	default:
		fail(w, 400, fmt.Errorf("unsupported operation"))
		return
	}
	h.rpc(w, ctx, raw)
}

func (h *Handler) exportJSON(w http.ResponseWriter, r *http.Request, ctx context.Context) {
	directory, err := os.MkdirTemp("", "inkism-backup-")
	if err != nil {
		fail(w, 500, err)
		return
	}
	defer os.RemoveAll(directory)
	path := filepath.Join(directory, "inkism-backup.json")
	req, _ := json.Marshal(map[string]any{"op": "export", "path": path})
	response, err := h.Engine.Call(ctx, req)
	if err != nil {
		fail(w, 500, err)
		return
	}
	if !success(response) {
		w.Header().Set(headerContentType, mediaTypeJSON)
		w.WriteHeader(400)
		w.Write(response)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="inkism-backup.json"`)
	w.Header().Set(headerContentType, mediaTypeJSON)
	http.ServeFile(w, r, path)
}

func (h *Handler) importJSON(w http.ResponseWriter, r *http.Request, ctx context.Context) {
	r.Body = http.MaxBytesReader(w, r.Body, 512<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		fail(w, 400, err)
		return
	}
	defer r.MultipartForm.RemoveAll()
	source, _, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, err)
		return
	}
	defer source.Close()
	file, err := os.CreateTemp("", "nook-import-*.json")
	if err != nil {
		fail(w, 500, err)
		return
	}
	path := file.Name()
	defer os.Remove(path)
	_, err = io.Copy(file, source)
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		fail(w, 500, err)
		return
	}
	req, _ := json.Marshal(map[string]any{"op": "import", "path": path})
	h.rpc(w, ctx, req)
}
func success(raw []byte) bool {
	var v struct {
		OK bool `json:"ok"`
	}
	return json.Unmarshal(raw, &v) == nil && v.OK
}
func (h *Handler) rpc(w http.ResponseWriter, ctx context.Context, raw json.RawMessage) {
	if h.Reminders != nil && reminderMutation(raw) {
		invalidationCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err := h.Reminders.InvalidateCache(invalidationCtx)
		cancel()
		if err != nil {
			fail(w, 503, fmt.Errorf("알림 캐시를 갱신하지 못했습니다. 다시 시도해 주세요"))
			return
		}
		defer h.Reminders.Wake()
	}
	response, err := h.Engine.Call(ctx, raw)
	if err != nil {
		fail(w, 500, err)
		return
	}
	w.Header().Set(headerContentType, mediaTypeJSON)
	if !success(response) {
		w.WriteHeader(400)
	}
	_, _ = w.Write(response)
}
