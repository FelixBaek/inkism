// Go half of the Rust crate's cross_compat_with_go test. It is not part of
// any Go package on disk: the Rust test mounts it into desktop/internal/bridge
// with `go test -overlay`, so it can drive the real Go handlers.
package bridge

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"testing"
)

type xcompatImport struct {
	Meta AttachmentMetadata `json:"meta"`
	Data string             `json:"data"`
}

// xcompatRestoreFake records engine ops and imports; each import gets a fresh UUID.
type xcompatRestoreFake struct {
	calls   []string
	notes   []byte
	imports []xcompatImport
}

func (f *xcompatRestoreFake) Call(_ context.Context, request json.RawMessage) (json.RawMessage, error) {
	var args map[string]string
	if err := json.Unmarshal(request, &args); err != nil {
		return nil, err
	}
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

func (f *xcompatRestoreFake) ImportAttachment(_ context.Context, name, kind string, r io.Reader) (AttachmentMetadata, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return AttachmentMetadata{}, err
	}
	sum := sha256.Sum256(data)
	meta := AttachmentMetadata{ID: fmt.Sprintf("%08x-3333-4333-8333-333333333333", len(f.imports)+1), Name: name, MediaType: kind, Size: uint64(len(data)), SHA256: hex.EncodeToString(sum[:])}
	f.imports = append(f.imports, xcompatImport{meta, hex.EncodeToString(data)})
	return meta, nil
}

func (f *xcompatRestoreFake) AttachmentInfo(context.Context, string) (AttachmentMetadata, error) {
	return AttachmentMetadata{}, fmt.Errorf("unexpected info")
}

func (f *xcompatRestoreFake) ExportAttachment(context.Context, string, io.Writer) error {
	return fmt.Errorf("unexpected export")
}

func TestXCompat(t *testing.T) {
	if out := os.Getenv("XCOMPAT_GO_BUNDLE"); out != "" {
		raw, err := os.ReadFile(os.Getenv("XCOMPAT_FIXTURE"))
		if err != nil {
			t.Fatal(err)
		}
		var fixture struct {
			Notes       string          `json:"notes"`
			Attachments []xcompatImport `json:"attachments"`
		}
		if err = json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		fake := &bundleFake{notes: []byte(fixture.Notes), blobs: map[string][]byte{}}
		for _, a := range fixture.Attachments {
			data, err := hex.DecodeString(a.Data)
			if err != nil {
				t.Fatal(err)
			}
			fake.metas = append(fake.metas, a.Meta)
			fake.blobs[a.Meta.ID] = data
		}
		reply := runBundle(t, fake)
		if reply.Code != 200 {
			t.Fatalf("go export: %d %s", reply.Code, reply.Body.String())
		}
		if err = os.WriteFile(out, reply.Body.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if in := os.Getenv("XCOMPAT_RUST_BUNDLE"); in != "" {
		data, err := os.ReadFile(in)
		if err != nil {
			t.Fatal(err)
		}
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, _ := form.CreateFormFile("file", "backup.zip")
		_, _ = part.Write(data)
		_ = form.Close()
		request := httptest.NewRequest("POST", "/api/restore", &body)
		request.Header.Set("Content-Type", form.FormDataContentType())
		reply := httptest.NewRecorder()
		fake := &xcompatRestoreFake{}
		(&Handler{Engine: fake}).restoreBundle(reply, request)
		report, _ := json.Marshal(map[string]any{"status": reply.Code, "body": reply.Body.String(), "calls": fake.calls, "notes": string(fake.notes), "imports": fake.imports})
		if err = os.WriteFile(os.Getenv("XCOMPAT_REPORT"), report, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
