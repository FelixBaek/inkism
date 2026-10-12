package bridge

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

const restoreOldID = "11111111-1111-4111-8111-111111111111"
const restoreNewID = "22222222-2222-4222-8222-222222222222"

type bundleRestoreFake struct {
	attachmentFake
	imported int
	calls    []string
	notes    []byte
}

func (f *bundleRestoreFake) Call(_ context.Context, request json.RawMessage) (json.RawMessage, error) {
	var args map[string]string
	_ = json.Unmarshal(request, &args)
	f.calls = append(f.calls, args["op"])
	data, err := os.ReadFile(args["path"])
	if err != nil {
		return nil, err
	}
	if args["op"] == "import" {
		f.notes = data
	}
	return json.RawMessage(`{"ok":true,"data":{"imported":1}}`), nil
}
func (f *bundleRestoreFake) ImportAttachment(ctx context.Context, name, kind string, r io.Reader) (AttachmentMetadata, error) {
	f.imported++
	metadata, err := f.attachmentFake.ImportAttachment(ctx, name, kind, r)
	hash := sha256.Sum256(f.data)
	metadata.ID = restoreNewID
	metadata.SHA256 = hex.EncodeToString(hash[:])
	return metadata, err
}
func restoreFixture(t *testing.T, broken bool, missing bool) []byte {
	t.Helper()
	payload := []byte("exact attachment bytes")
	hash := sha256.Sum256(payload)
	metadata := AttachmentMetadata{ID: restoreOldID, Name: "한글.bin", MediaType: "application/octet-stream", Size: uint64(len(payload)), SHA256: hex.EncodeToString(hash[:])}
	if broken {
		metadata.SHA256 = strings.Repeat("0", 64)
	}
	notes := `{"version":1,"notes":[{"id":"note-a","title":"with file","content":"<p><a href=\"/api/attachments/` + restoreOldID + `\">파일</a></p>","text":"file"}],"notebooks":[]}`
	var out bytes.Buffer
	z := zip.NewWriter(&out)
	entries := map[string][]byte{"notes.json": []byte(notes), "attachments/" + restoreOldID: payload}
	encoded, _ := json.Marshal(metadata)
	entries["attachments.ndjson"] = append(encoded, '\n')
	if missing {
		delete(entries, "attachments/"+restoreOldID)
	}
	for name, data := range entries {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
func restoreRequest(t *testing.T, data []byte, fake *bundleRestoreFake) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, _ := form.CreateFormFile("file", "backup.zip")
	_, _ = part.Write(data)
	_ = form.Close()
	request := httptest.NewRequest("POST", "/api/restore", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	reply := httptest.NewRecorder()
	(&Handler{Engine: fake}).restoreBundle(reply, request)
	return reply
}
func TestBundleRestoreRemapsFilesBeforeImportingNotes(t *testing.T) {
	fake := &bundleRestoreFake{}
	reply := restoreRequest(t, restoreFixture(t, false, false), fake)
	if reply.Code != 200 {
		t.Fatalf("%d %s", reply.Code, reply.Body.String())
	}
	if fake.imported != 1 || strings.Contains(string(fake.notes), restoreOldID) || !strings.Contains(string(fake.notes), restoreNewID) {
		t.Fatalf("references not remapped: %s", fake.notes)
	}
	if strings.Join(fake.calls, ",") != "validate_import,import" {
		t.Fatal(fake.calls)
	}
}
func TestBundleRestoreRejectsCorruptOrMissingFilesBeforeWrites(t *testing.T) {
	for _, tc := range []struct{ bad, missing bool }{{true, false}, {false, true}} {
		fake := &bundleRestoreFake{}
		reply := restoreRequest(t, restoreFixture(t, tc.bad, tc.missing), fake)
		if reply.Code != 400 || fake.imported != 0 || len(fake.calls) != 0 {
			t.Fatalf("partial restore: %d %s", reply.Code, reply.Body.String())
		}
	}
}
