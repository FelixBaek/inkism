package bridge

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

type bundleFake struct {
	notes      []byte
	metas      []AttachmentMetadata
	blobs      map[string][]byte
	failExport string // ExportAttachment fails for this ID
	engineFail bool   // export RPC answers ok:false
	exported   []string
	exportPath string
}

func (f *bundleFake) Call(_ context.Context, request json.RawMessage) (json.RawMessage, error) {
	var req struct {
		Op   string `json:"op"`
		Path string `json:"path"`
	}
	if err := json.Unmarshal(request, &req); err != nil {
		return nil, err
	}
	if req.Op != "export" {
		return json.RawMessage(`{"ok":false,"error":"unexpected op"}`), nil
	}
	f.exportPath = req.Path
	if f.engineFail {
		return json.RawMessage(`{"ok":false,"error":"engine export failed"}`), nil
	}
	if err := os.WriteFile(req.Path, f.notes, 0600); err != nil {
		return nil, err
	}
	return json.RawMessage(`{"ok":true,"data":{"notes":1}}`), nil
}

func (f *bundleFake) WalkAttachments(_ context.Context, visit func(AttachmentMetadata) error) error {
	for _, meta := range f.metas {
		if err := visit(meta); err != nil {
			return err
		}
	}
	return nil
}

func (f *bundleFake) ExportAttachment(_ context.Context, id string, output io.Writer) error {
	f.exported = append(f.exported, id)
	if id == f.failExport {
		return errors.New("export interrupted")
	}
	_, err := output.Write(f.blobs[id])
	return err
}

func digestOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func metaFor(data []byte, id string) AttachmentMetadata {
	return AttachmentMetadata{ID: id, Name: id + ".bin", MediaType: "application/octet-stream", Size: uint64(len(data)), SHA256: digestOf(data)}
}

func runBundle(t *testing.T, fake *bundleFake) *httptest.ResponseRecorder {
	t.Helper()
	reply := httptest.NewRecorder()
	(&Handler{Engine: fake}).exportBundle(reply, httptest.NewRequest("GET", "/api/backup", nil))
	return reply
}

func assertNoZip(t *testing.T, reply *httptest.ResponseRecorder) {
	t.Helper()
	if !strings.Contains(reply.Body.String(), `"ok":false`) || strings.Contains(reply.Body.String(), "PK\x03\x04") {
		t.Fatalf("partial zip leaked to client: %d %q", reply.Code, reply.Body.String())
	}
}

func TestBundleExportBuildsVerifiedZip(t *testing.T) {
	notes := []byte(`{"version":1,"notes":[{"id":"n1"}]}`)
	large := bytes.Repeat([]byte("INKISM-attachment-"), 20000)
	var empty []byte
	largeID, emptyID := "11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
	fake := &bundleFake{
		notes: notes,
		metas: []AttachmentMetadata{metaFor(large, largeID), metaFor(empty, emptyID)},
		blobs: map[string][]byte{largeID: large, emptyID: empty},
	}
	reply := runBundle(t, fake)
	if reply.Code != 200 {
		t.Fatalf("status %d: %s", reply.Code, reply.Body.String())
	}
	if !strings.HasPrefix(fake.exportPath, os.TempDir()) {
		t.Fatalf("export path not a trusted temp file: %q", fake.exportPath)
	}
	if reply.Header().Get("Content-Type") != "application/zip" {
		t.Fatal("wrong content type")
	}
	if !strings.HasPrefix(reply.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("missing forced download")
	}
	archive, err := zip.NewReader(bytes.NewReader(reply.Body.Bytes()), int64(reply.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 4 {
		t.Fatalf("expected 4 entries, got %d", len(archive.File))
	}
	entries := map[string]*zip.File{}
	for _, file := range archive.File {
		entries[file.Name] = file
	}
	for name, want := range map[string][]byte{"attachments/" + largeID: large, "attachments/" + emptyID: empty} {
		file := entries[name]
		if file == nil {
			t.Fatalf("missing entry %s", name)
		}
		if file.Method != zip.Store {
			t.Fatalf("%s not stored uncompressed", name)
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(reader)
		reader.Close()
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("entry %s bytes mismatch (%v)", name, err)
		}
	}
	manifest := entries["attachments.ndjson"]
	if manifest == nil || manifest.Method != zip.Deflate {
		t.Fatal("missing manifest")
	}
	reader, err := manifest.Open()
	if err != nil {
		t.Fatal(err)
	}
	lines, err := io.ReadAll(reader)
	reader.Close()
	if err != nil {
		t.Fatal(err)
	}
	for i, raw := range bytes.Split(bytes.TrimRight(lines, "\n"), []byte("\n")) {
		var meta AttachmentMetadata
		if err = json.Unmarshal(raw, &meta); err != nil {
			t.Fatalf("manifest line %d: %v", i, err)
		}
		if meta != fake.metas[i] {
			t.Fatalf("manifest line %d mismatch: %+v", i, meta)
		}
	}
}

func TestBundleExportEmptyLibraryIsValid(t *testing.T) {
	reply := runBundle(t, &bundleFake{notes: []byte(`{"version":1,"notes":[]}`)})
	if reply.Code != 200 {
		t.Fatalf("status %d: %s", reply.Code, reply.Body.String())
	}
	archive, err := zip.NewReader(bytes.NewReader(reply.Body.Bytes()), int64(reply.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(archive.File))
	}
	manifest, err := archive.File[1].Open()
	if err != nil {
		t.Fatal(err)
	}
	empty, err := io.ReadAll(manifest)
	manifest.Close()
	if err != nil || len(empty) != 0 {
		t.Fatalf("manifest not empty: %d %v", len(empty), err)
	}
}

func TestBundleExportWithoutAttachmentStore(t *testing.T) {
	reply := httptest.NewRecorder()
	(&Handler{Engine: &attachmentFake{}}).exportBundle(reply, httptest.NewRequest("GET", "/api/backup", nil))
	if reply.Code != 501 {
		t.Fatalf("status %d", reply.Code)
	}
}

func TestBundleExportEngineFailureSendsNothing(t *testing.T) {
	reply := runBundle(t, &bundleFake{engineFail: true})
	if reply.Code != 400 || !strings.Contains(reply.Body.String(), "engine export failed") {
		t.Fatalf("engine failure not passed through: %d %s", reply.Code, reply.Body.String())
	}
	assertNoZip(t, reply)
}

func TestBundleExportCorruptHashSendsNothing(t *testing.T) {
	data := []byte("private-attachment-bytes")
	meta := metaFor(data, "11111111-2222-4333-8444-555555555555")
	meta.SHA256 = digestOf([]byte("different"))
	reply := runBundle(t, &bundleFake{notes: []byte(`{}`), metas: []AttachmentMetadata{meta}, blobs: map[string][]byte{meta.ID: data}})
	if reply.Code != 500 {
		t.Fatalf("status %d", reply.Code)
	}
	assertNoZip(t, reply)
	if strings.Contains(reply.Body.String(), string(data)) {
		t.Fatal("attachment bytes leaked")
	}
}

func TestBundleExportSizeMismatchSendsNothing(t *testing.T) {
	data := []byte("three")
	meta := metaFor(data, "22222222-2222-4333-8444-555555555555")
	meta.Size++
	reply := runBundle(t, &bundleFake{notes: []byte(`{}`), metas: []AttachmentMetadata{meta}, blobs: map[string][]byte{meta.ID: data}})
	if reply.Code != 500 {
		t.Fatalf("status %d", reply.Code)
	}
	assertNoZip(t, reply)
}

func TestBundleExportMidFailureSendsNothing(t *testing.T) {
	first, second, third := []byte("first-bytes"), []byte("second-bytes"), []byte("third-bytes")
	firstID, secondID, thirdID := "33333333-2222-4333-8444-555555555555", "44444444-2222-4333-8444-555555555555", "45444444-2222-4333-8444-555555555555"
	fake := &bundleFake{
		notes:      []byte(`{}`),
		metas:      []AttachmentMetadata{metaFor(first, firstID), metaFor(second, secondID), metaFor(third, thirdID)},
		blobs:      map[string][]byte{firstID: first, secondID: second, thirdID: third},
		failExport: secondID,
	}
	reply := runBundle(t, fake)
	if reply.Code != 500 {
		t.Fatalf("status %d", reply.Code)
	}
	if strings.Join(fake.exported, ",") != firstID+","+secondID {
		t.Fatalf("walk did not stop at failure: %v", fake.exported)
	}
	assertNoZip(t, reply)
}

func TestBundleExportRejectsUnsafeMetadata(t *testing.T) {
	data := []byte("payload")
	tests := map[string]func(*AttachmentMetadata){
		"traversal id":   func(m *AttachmentMetadata) { m.ID = "../engine.db" },
		"malformed id":   func(m *AttachmentMetadata) { m.ID = "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz" },
		"duplicate id":   func(m *AttachmentMetadata) {},
		"oversize":       func(m *AttachmentMetadata) { m.Size = uint64(maxAttachmentBytes) + 1 },
		"malformed hash": func(m *AttachmentMetadata) { m.SHA256 = "deadbeef" },
		"long metadata":  func(m *AttachmentMetadata) { m.Name = strings.Repeat("길", 2000) },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			id := "55555555-2222-4333-8444-555555555555"
			first := metaFor(data, id)
			second := metaFor(data, id)
			mutate(&second)
			metas := []AttachmentMetadata{first}
			if name == "duplicate id" {
				metas = append(metas, second)
			} else {
				metas[0] = second
			}
			fake := &bundleFake{notes: []byte(`{}`), metas: metas, blobs: map[string][]byte{id: data}}
			reply := runBundle(t, fake)
			if reply.Code != 500 {
				t.Fatalf("status %d: %s", reply.Code, reply.Body.String())
			}
			assertNoZip(t, reply)
		})
	}
}
