package bridge

import (
	"archive/zip"
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const maxBundleBytes int64 = 64 << 30
const maxBackupNotesBytes int64 = 512 << 20

// Bundle entry names inside a backup zip.
const (
	bundleNotesEntry     = "notes.json"
	bundleAttachmentsDir = "attachments/"
)

var bundleAssetID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var localAssetURL = regexp.MustCompile(`(^|["'\s(])(/api/attachments/)([a-zA-Z0-9_-]+)`)

type bundleContents struct {
	notes    map[string]json.RawMessage
	noteRows []map[string]json.RawMessage
	assets   []AttachmentMetadata
	files    map[string]*zip.File
}

func readZipLimited(file *zip.File, limit int64) ([]byte, error) {
	if file.UncompressedSize64 > uint64(limit) {
		return nil, fmt.Errorf("백업 항목이 너무 큽니다: %s", file.Name)
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("백업 항목 크기 초과")
	}
	return data, nil
}

type bundleContextReader struct {
	ctx    context.Context
	source io.Reader
}

func (r bundleContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(p)
}

// Cancellation of the HTTP request must not interrupt the shared JSONL engine.
// A bounded independent deadline still protects against an unresponsive engine.
func (h *Handler) bundleNoteCall(parent context.Context, request json.RawMessage) (json.RawMessage, error) {
	if err := parent.Err(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 90*time.Second)
	defer cancel()
	return h.Engine.Call(ctx, request)
}

func verifyBundleContext(ctx context.Context, reader *zip.Reader) (*bundleContents, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	files, err := indexBundleFiles(ctx, reader)
	if err != nil {
		return nil, err
	}
	b := &bundleContents{files: files}
	notes, manifest := b.files[bundleNotesEntry], b.files["attachments.ndjson"]
	if notes == nil || manifest == nil {
		return nil, fmt.Errorf("노트 또는 첨부 목록이 없습니다")
	}
	data, err := readZipLimited(notes, maxBackupNotesBytes)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(data, &b.notes); err != nil {
		return nil, err
	}
	if err = json.Unmarshal(b.notes["notes"], &b.noteRows); err != nil {
		return nil, err
	}
	if manifest.UncompressedSize64 > 64<<20 {
		return nil, fmt.Errorf("첨부 목록 크기 초과")
	}
	seen, err := b.verifyManifest(ctx, manifest)
	if err != nil {
		return nil, err
	}
	if len(b.files) != len(b.assets)+2 {
		return nil, fmt.Errorf("목록에 없는 첨부파일")
	}
	// Reject dangling references before writing any attachment or note.
	if err = checkNoteReferences(b.noteRows, seen); err != nil {
		return nil, err
	}
	return b, nil
}

// indexBundleFiles maps every allowed bundle entry by name.
func indexBundleFiles(ctx context.Context, reader *zip.Reader) (map[string]*zip.File, error) {
	files := map[string]*zip.File{}
	if len(reader.File) > 100002 {
		return nil, fmt.Errorf("백업 항목 수 초과")
	}
	for _, file := range reader.File {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, exists := files[file.Name]; exists {
			return nil, fmt.Errorf("중복 백업 항목: %s", file.Name)
		}
		if !file.Mode().IsRegular() {
			return nil, fmt.Errorf("일반 파일이 아닌 백업 항목")
		}
		if !allowedBundleEntry(file.Name) {
			return nil, fmt.Errorf("알 수 없는 백업 항목: %s", file.Name)
		}
		files[file.Name] = file
	}
	return files, nil
}

func allowedBundleEntry(name string) bool {
	if name == bundleNotesEntry || name == "attachments.ndjson" {
		return true
	}
	id, ok := strings.CutPrefix(name, bundleAttachmentsDir)
	return ok && bundleAssetID.MatchString(id)
}

// verifyManifest checks every listed attachment against its bundle bytes and
// returns the set of verified ids.
func (b *bundleContents) verifyManifest(ctx context.Context, manifest *zip.File) (map[string]bool, error) {
	source, err := manifest.Open()
	if err != nil {
		return nil, err
	}
	defer source.Close()
	scanner := bufio.NewScanner(io.LimitReader(source, (64<<20)+1))
	scanner.Buffer(make([]byte, 4096), 4096)
	seen := map[string]bool{}
	var total uint64
	for scanner.Scan() {
		if err := b.verifyManifestLine(ctx, scanner.Bytes(), seen, &total); err != nil {
			return nil, err
		}
	}
	if err = scanner.Err(); err != nil {
		return nil, err
	}
	return seen, nil
}

func (b *bundleContents) verifyManifestLine(ctx context.Context, line []byte, seen map[string]bool, total *uint64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var m AttachmentMetadata
	if err := json.Unmarshal(line, &m); err != nil {
		return err
	}
	if !validBundleMetadata(m) || seen[m.ID] {
		return fmt.Errorf("잘못된 첨부 메타데이터")
	}
	file := b.files[bundleAttachmentsDir+m.ID]
	if file == nil || file.UncompressedSize64 != m.Size {
		return fmt.Errorf("첨부파일 누락 또는 크기 불일치: %s", m.Name)
	}
	*total += m.Size
	if *total > uint64(maxBundleBytes) {
		return fmt.Errorf("백업 전체 크기 초과")
	}
	stream, err := file.Open()
	if err != nil {
		return err
	}
	hash := sha256.New()
	count, copyErr := io.Copy(hash, io.LimitReader(bundleContextReader{ctx, stream}, int64(m.Size)+1))
	closeErr := stream.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if uint64(count) != m.Size || !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), m.SHA256) {
		return fmt.Errorf("첨부파일 해시 불일치: %s", m.Name)
	}
	seen[m.ID] = true
	b.assets = append(b.assets, m)
	return nil
}

func validBundleMetadata(m AttachmentMetadata) bool {
	digest, hashErr := hex.DecodeString(m.SHA256)
	badName := m.Name == "" || utf8.RuneCountInString(m.Name) > 255 || strings.ContainsAny(m.Name, "/\\") || strings.IndexFunc(m.Name, unicode.IsControl) >= 0
	badType := m.MediaType == "" || len(m.MediaType) > 255 || strings.IndexFunc(m.MediaType, unicode.IsControl) >= 0
	return bundleAssetID.MatchString(m.ID) && m.Size <= uint64(maxAttachmentBytes) && hashErr == nil && len(digest) == sha256.Size && !badName && !badType
}

func namedVersionRows(note map[string]json.RawMessage) ([]map[string]json.RawMessage, error) {
	return versionRows(note, "named_versions")
}
func versionRows(note map[string]json.RawMessage, field string) ([]map[string]json.RawMessage, error) {
	raw, ok := note[field]
	if !ok {
		return nil, nil
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	if len(rows) > 100 {
		return nil, fmt.Errorf("too many named versions")
	}
	for _, row := range rows {
		if _, ok := row["named_versions"]; ok {
			return nil, fmt.Errorf("nested named versions")
		}
		if _, ok := row["encrypted_named_versions"]; ok {
			return nil, fmt.Errorf("nested encrypted versions")
		}
	}
	return rows, nil
}

// checkNoteReferences rejects notes that point at attachments outside seen.
func checkNoteReferences(rows []map[string]json.RawMessage, seen map[string]bool) error {
	for _, note := range rows {
		for _, field := range []string{"named_versions", "encrypted_named_versions"} {
			versions, err := versionRows(note, field)
			if err != nil {
				return err
			}
			if err := checkNoteReferences(versions, seen); err != nil {
				return err
			}
		}

		for _, field := range []string{"content", "text"} {
			if err := checkNoteFieldReferences(note, field, seen); err != nil {
				return err
			}
		}
		body, err := lockedBody(note)
		if err != nil {
			return err
		}
		for _, item := range body.attachments() {
			if !seen[item["id"].(string)] {
				return fmt.Errorf("잠긴 노트가 참조하는 첨부파일 누락: %s", item["id"])
			}
		}
	}
	return nil
}

func checkNoteFieldReferences(note map[string]json.RawMessage, field string, seen map[string]bool) error {
	var value string
	if raw, ok := note[field]; ok {
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
	}
	for _, match := range localAssetURL.FindAllStringSubmatch(value, -1) {
		if !seen[match[3]] {
			return fmt.Errorf("노트가 참조하는 첨부파일 누락: %s", match[3])
		}
	}
	return nil
}

// lockedNote is a vault note's ciphertext record. Its plaintext attachment
// list is the only part restore may rewrite; the engine maps old links
// inside the ciphertext through each {id, ref} pair after decrypting.
type lockedNote map[string]any

func lockedBody(note map[string]json.RawMessage) (lockedNote, error) {
	raw, ok := note["locked_body"]
	if !ok {
		return nil, nil
	}
	var body lockedNote
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("잠긴 노트 형식 오류: %w", err)
	}
	for _, item := range body.attachments() {
		if _, ok := item["id"].(string); !ok {
			return nil, fmt.Errorf("잠긴 노트 첨부 형식 오류")
		}
	}
	return body, nil
}

func (body lockedNote) attachments() []map[string]any {
	list, _ := body["attachments"].([]any)
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if entry, ok := item.(map[string]any); ok {
			out = append(out, entry)
		} else {
			out = append(out, map[string]any{"id": nil})
		}
	}
	return out
}

func (b *bundleContents) writeNotes(path string, ids map[string]string) error {
	if ids != nil {
		for _, note := range b.noteRows {
			if err := remapNoteAssets(note, ids); err != nil {
				return err
			}
		}
		if err := remapNotebookCovers(b.notes, ids); err != nil {
			return err
		}
	}
	rows, err := json.Marshal(b.noteRows)
	if err != nil {
		return err
	}
	b.notes["notes"] = rows
	output, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	err = json.NewEncoder(output).Encode(b.notes)
	closeErr := output.Close()
	if err != nil {
		return err
	}
	return closeErr
}

// remapNoteAssets rewrites one note's attachment links to the restored ids.
func remapNoteAssets(note map[string]json.RawMessage, ids map[string]string) error {
	for _, field := range []string{"named_versions", "encrypted_named_versions"} {
		versions, err := versionRows(note, field)
		if err != nil {
			return err
		}
		for _, version := range versions {
			if err := remapNoteAssets(version, ids); err != nil {
				return err
			}
		}
		if _, ok := note[field]; ok {
			encoded, err := json.Marshal(versions)
			if err != nil {
				return err
			}
			note[field] = encoded
		}
	}

	for _, field := range []string{"content", "text"} {
		raw, ok := note[field]
		if !ok {
			continue
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
		value = localAssetURL.ReplaceAllStringFunc(value, func(match string) string {
			parts := localAssetURL.FindStringSubmatch(match)
			return parts[1] + parts[2] + ids[parts[3]]
		})
		encoded, err := json.Marshal(value)
		if err != nil {
			return err
		}
		note[field] = encoded
	}
	body, err := lockedBody(note)
	if err != nil {
		return err
	}
	if body == nil {
		return nil
	}
	for _, item := range body.attachments() {
		item["id"] = ids[item["id"].(string)]
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	note["locked_body"] = encoded
	return nil
}

func (h *Handler) restoreBundle(w http.ResponseWriter, r *http.Request) {
	assets, ok := h.Engine.(attachmentCaller)
	if !ok {
		fail(w, 501, fmt.Errorf("첨부파일 저장소가 없습니다"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBundleBytes+(1<<20))
	err := r.ParseMultipartForm(1 << 20)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if err != nil {
		fail(w, 400, err)
		return
	}
	source, header, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, err)
		return
	}
	defer source.Close()
	archive, err := zip.NewReader(source, header.Size)
	if err != nil {
		fail(w, 400, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	bundle, err := verifyBundleContext(ctx, archive)
	if err != nil {
		fail(w, 400, err)
		return
	}
	directory, err := os.MkdirTemp("", "inkism-restore-")
	if err != nil {
		fail(w, 500, err)
		return
	}
	defer os.RemoveAll(directory)
	path := filepath.Join(directory, "notes.json")
	if err = bundle.writeNotes(path, nil); err != nil {
		fail(w, 500, err)
		return
	}
	validate, _ := json.Marshal(map[string]string{"op": "validate_import", "path": path})
	response, err := h.bundleNoteCall(ctx, validate)
	if err != nil {
		fail(w, 500, err)
		return
	}
	if !success(response) {
		w.Header().Set(headerContentType, mediaTypeJSON)
		w.WriteHeader(400)
		_, _ = w.Write(response)
		return
	}
	ids := map[string]string{}
	// Publish immutable assets before the single notes transaction. A crash can
	// leave unreferenced assets, but can never commit notes pointing at missing bytes.
	for _, old := range bundle.assets {
		stream, err := bundle.files[bundleAttachmentsDir+old.ID].Open()
		if err != nil {
			fail(w, 400, err)
			return
		}
		metadata, importErr := assets.ImportAttachment(ctx, old.Name, old.MediaType, stream)
		_ = stream.Close()
		if importErr != nil {
			fail(w, 500, importErr)
			return
		}
		if metadata.Size != old.Size || !strings.EqualFold(metadata.SHA256, old.SHA256) || !bundleAssetID.MatchString(metadata.ID) {
			fail(w, 500, fmt.Errorf("복원한 첨부파일 검증 실패"))
			return
		}
		ids[old.ID] = metadata.ID
	}
	if err = bundle.writeNotes(path, ids); err != nil {
		fail(w, 500, err)
		return
	}
	request, _ := json.Marshal(map[string]string{"op": "import", "path": path})
	response, err = h.bundleNoteCall(ctx, request)
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

// remapNotebookCovers points local-file notebook covers at the renumbered
// attachments; a cover whose file is not in the bundle is dropped instead of
// failing the restore (the notebook itself still imports).
func remapNotebookCovers(notes map[string]json.RawMessage, ids map[string]string) error {
	raw, ok := notes["notebooks"]
	if !ok {
		return nil
	}
	var notebooks []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &notebooks); err != nil {
		return err
	}
	for _, notebook := range notebooks {
		var cover struct {
			Kind string `json:"kind"`
			URL  string `json:"url"`
		}
		if c, ok := notebook["cover"]; !ok || json.Unmarshal(c, &cover) != nil || cover.Kind != "attachment" {
			continue
		}
		next, found := ids[strings.TrimPrefix(cover.URL, attachmentsPathPrefix)]
		if !found || !strings.HasPrefix(cover.URL, attachmentsPathPrefix) {
			delete(notebook, "cover")
			continue
		}
		notebook["cover"], _ = json.Marshal(map[string]string{"kind": "attachment", "url": attachmentsPathPrefix + next})
	}
	encoded, err := json.Marshal(notebooks)
	if err != nil {
		return err
	}
	notes["notebooks"] = encoded
	return nil
}
