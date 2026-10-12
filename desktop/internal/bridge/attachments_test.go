package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
)

type attachmentFake struct {
	data       []byte
	failExport bool
}

func (a *attachmentFake) Call(context.Context, json.RawMessage) (json.RawMessage, error) {
	return nil, errors.New("unexpected note RPC")
}
func (a *attachmentFake) ImportAttachment(_ context.Context, name, mime string, input io.Reader) (AttachmentMetadata, error) {
	var err error
	a.data, err = io.ReadAll(input)
	return AttachmentMetadata{ID: "asset-id", Name: name, MediaType: mime, Size: uint64(len(a.data))}, err
}
func (a *attachmentFake) AttachmentInfo(context.Context, string) (AttachmentMetadata, error) {
	return AttachmentMetadata{ID: "asset-id", Name: "한글.txt", Size: uint64(len(a.data))}, nil
}
func (a *attachmentFake) ExportAttachment(_ context.Context, _ string, output io.Writer) error {
	_, err := output.Write(a.data)
	if a.failExport {
		return errors.New("hash mismatch")
	}
	return err
}
func TestAttachmentHTTPUploadDownloadAndRange(t *testing.T) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "한글.txt")
	if err != nil {
		t.Fatal(err)
	}
	content := bytes.Repeat([]byte("attachment"), 220000)
	if _, err = part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	fake := &attachmentFake{}
	handler := &Handler{Engine: fake}
	request := httptest.NewRequest("POST", "/api/attachments", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, request)
	if reply.Code != 201 {
		t.Fatalf("upload: %d %s", reply.Code, reply.Body.String())
	}
	if !bytes.Equal(content, fake.data) {
		t.Fatal("upload changed bytes")
	}
	request = httptest.NewRequest("GET", "/api/attachments/asset-id", nil)
	request.Header.Set("Range", "bytes=5-14")
	reply = httptest.NewRecorder()
	handler.ServeHTTP(reply, request)
	if reply.Code != 206 || !bytes.Equal(reply.Body.Bytes(), content[5:15]) {
		t.Fatalf("range: %d", reply.Code)
	}
	if !strings.HasPrefix(reply.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("missing forced download")
	}
	if reply.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatal("unsafe content type")
	}
}
func TestAttachmentCorruptionDoesNotSendPartialFile(t *testing.T) {
	handler := &Handler{Engine: &attachmentFake{data: []byte("corrupt-private-content"), failExport: true}}
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/asset-id", nil))
	if reply.Code != 500 || strings.Contains(reply.Body.String(), "corrupt-private-content") {
		t.Fatalf("corrupt export leaked content: %s", reply.Body.String())
	}
}
func TestAttachmentCrossOriginUploadRejectedBeforeReading(t *testing.T) {
	fake := &attachmentFake{}
	handler := &Handler{Engine: fake, Host: "127.0.0.1:47831"}
	request := httptest.NewRequest("POST", "http://127.0.0.1:47831/api/attachments", strings.NewReader("untrusted"))
	request.Header.Set("Origin", "https://example.com")
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, request)
	if reply.Code != 403 || len(fake.data) != 0 {
		t.Fatal("cross-origin upload was accepted")
	}
}
