package bridge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	_ "golang.org/x/image/webp"
)

// previewFake is independent of attachmentFake so the preview tests keep full
// control over the declared media type, stored bytes and reported size when
// exercising the ?preview=1 whitelist, sniffing and image dimension rules.
type previewFake struct {
	metadata    AttachmentMetadata
	data        []byte
	failExport  bool
	exportCalls int
}

func (f *previewFake) Call(context.Context, json.RawMessage) (json.RawMessage, error) {
	return nil, errors.New("unexpected note RPC")
}
func (f *previewFake) ImportAttachment(_ context.Context, name, mediaType string, input io.Reader) (AttachmentMetadata, error) {
	data, err := io.ReadAll(input)
	f.data = data
	f.metadata = AttachmentMetadata{ID: "preview-id", Name: name, MediaType: mediaType, Size: uint64(len(data))}
	return f.metadata, err
}
func (f *previewFake) AttachmentInfo(context.Context, string) (AttachmentMetadata, error) {
	return f.metadata, nil
}
func (f *previewFake) ExportAttachment(_ context.Context, _ string, output io.Writer) error {
	f.exportCalls++
	_, err := output.Write(f.data)
	if f.failExport {
		return errors.New("hash mismatch")
	}
	return err
}

func previewPNGBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.SetRGBA(0, 0, color.RGBA{R: 0x10, G: 0x80, B: 0xC0, A: 0xFF})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func previewJPEGBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.SetRGBA(0, 0, color.RGBA{R: 0x10, G: 0x80, B: 0xC0, A: 0xFF})
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, img, nil); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func previewGIFBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.SetRGBA(0, 0, color.RGBA{R: 0x10, G: 0x80, B: 0xC0, A: 0xFF})
	var buffer bytes.Buffer
	if err := gif.Encode(&buffer, img, nil); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

// Generated 1x1 RGB(16,128,192) lossless WebP fixture.
const previewWebPBase64 = "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQwEIUuP+BiOh/AAA="

func previewWebPBytes(t *testing.T) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(previewWebPBase64)
	if err != nil {
		t.Fatalf("embedded webp fixture must be valid base64: %v", err)
	}
	config, kind, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || kind != "webp" || config.Width != 1 || config.Height != 1 {
		t.Fatalf("embedded webp fixture invalid: config=%+v kind=%q err=%v", config, kind, err)
	}
	return data
}

// previewOversizedPNG rewrites only the IHDR width/height words plus their CRC
// on a real 1x1 PNG, so the preview dimension caps can be exercised without
// ever allocating a genuinely huge image. image.DecodeConfig only reads the
// IHDR, so the forged header is exactly what the handler would evaluate.
func previewOversizedPNG(t *testing.T, width, height uint32) []byte {
	t.Helper()
	forged := append([]byte(nil), previewPNGBytes(t)...)
	if len(forged) < 33 {
		t.Fatalf("png fixture too short to hold an IHDR: %d bytes", len(forged))
	}
	binary.BigEndian.PutUint32(forged[16:20], width)
	binary.BigEndian.PutUint32(forged[20:24], height)
	binary.BigEndian.PutUint32(forged[29:33], crc32.ChecksumIEEE(forged[12:29]))
	config, kind, err := image.DecodeConfig(bytes.NewReader(forged))
	if err != nil || kind != "png" || config.Width != int(width) || config.Height != int(height) {
		t.Fatalf("forged IHDR not decodable: config=%+v kind=%q err=%v", config, kind, err)
	}
	return forged
}

func newPreviewHandler(content []byte, mediaType string) *Handler {
	return &Handler{Engine: &previewFake{
		metadata: AttachmentMetadata{ID: "preview-id", Name: "photo.png", MediaType: mediaType, Size: uint64(len(content))},
		data:     content,
	}}
}

func TestAttachmentPreviewPNGServesExactBytesInline(t *testing.T) {
	content := previewPNGBytes(t)
	handler := newPreviewHandler(content, "image/png")
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
	if reply.Code != 200 {
		t.Fatalf("preview: %d %s", reply.Code, reply.Body.String())
	}
	if !bytes.Equal(reply.Body.Bytes(), content) {
		t.Fatal("preview body is not the exact stored PNG bytes")
	}
	if got := reply.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("preview content type: %q", got)
	}
	if disposition := reply.Header().Get("Content-Disposition"); !strings.HasPrefix(disposition, "inline") {
		t.Fatalf("preview disposition: %q", disposition)
	}
	if reply.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff on inline preview")
	}
}

func TestAttachmentPreviewHeadAndRangeStillWork(t *testing.T) {
	content := previewPNGBytes(t)
	handler := newPreviewHandler(content, "image/png")
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("HEAD", "/api/attachments/preview-id?preview=1", nil))
	if reply.Code != 200 || reply.Body.Len() != 0 {
		t.Fatalf("HEAD preview: %d %d", reply.Code, reply.Body.Len())
	}
	if reply.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("HEAD preview content type: %q", reply.Header().Get("Content-Type"))
	}
	request := httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil)
	request.Header.Set("Range", "bytes=0-7")
	reply = httptest.NewRecorder()
	handler.ServeHTTP(reply, request)
	if reply.Code != 206 || !bytes.Equal(reply.Body.Bytes(), content[:8]) {
		t.Fatalf("range preview: %d", reply.Code)
	}
	if reply.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("range preview content type: %q", reply.Header().Get("Content-Type"))
	}
}

// Each whitelisted type must survive with a real image: the sniffed content
// type has to match the declaration and image.DecodeConfig must read the
// header, so fake magic bytes alone no longer pass the preview gate.
func TestAttachmentPreviewAllowsWhitelistedImageTypesOnly(t *testing.T) {
	cases := []struct {
		mediaType string
		payload   func(t *testing.T) []byte
	}{
		{"image/png", previewPNGBytes},
		{"image/jpeg", previewJPEGBytes},
		{"image/gif", previewGIFBytes},
		{"image/webp", previewWebPBytes},
	}
	for _, tc := range cases {
		content := tc.payload(t)
		handler := newPreviewHandler(content, tc.mediaType)
		reply := httptest.NewRecorder()
		handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
		if reply.Code != 200 {
			t.Fatalf("%s preview: %d %s", tc.mediaType, reply.Code, reply.Body.String())
		}
		if !bytes.Equal(reply.Body.Bytes(), content) {
			t.Fatalf("%s preview body is not the exact stored bytes", tc.mediaType)
		}
		if reply.Header().Get("Content-Type") != tc.mediaType {
			t.Fatalf("%s preview content type: %q", tc.mediaType, reply.Header().Get("Content-Type"))
		}
	}
}

// Sniffing may recognize the raster signature, but when image.DecodeConfig
// still cannot read a header the preview must fail closed with 415.
func TestAttachmentPreviewRejectsUndecodableImageConfig(t *testing.T) {
	cases := []struct {
		mediaType string
		payload   []byte
	}{
		{"image/png", append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)},
		{"image/jpeg", append([]byte("\xff\xd8\xff\xe0"), bytes.Repeat([]byte{0}, 64)...)},
		{"image/gif", append([]byte("GIF89a"), bytes.Repeat([]byte{0}, 64)...)},
		{"image/webp", []byte("RIFF\x08\x00\x00\x00WEBPVP8 \x00\x00\x00\x00")},
	}
	for _, tc := range cases {
		handler := newPreviewHandler(tc.payload, tc.mediaType)
		reply := httptest.NewRecorder()
		handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
		if reply.Code != 415 {
			t.Fatalf("%s undecodable config: %d %s", tc.mediaType, reply.Code, reply.Body.String())
		}
		if bytes.Contains(reply.Body.Bytes(), tc.payload[:8]) {
			t.Fatalf("%s undecodable preview leaked file bytes", tc.mediaType)
		}
	}
}

// One side over 8192, or more than 16M pixels overall, stays a forced download
// (413) even though the file itself is tiny.
func TestAttachmentPreviewRejectsOversizedImageDimensions(t *testing.T) {
	cases := []struct {
		name          string
		width, height uint32
	}{
		{"width over 8192", 32768, 1},
		{"pixel area over 16M", uint32(maxPreviewDimension), uint32(maxPreviewPixels/maxPreviewDimension + 1)},
	}
	for _, tc := range cases {
		content := previewOversizedPNG(t, tc.width, tc.height)
		fake := &previewFake{
			metadata: AttachmentMetadata{ID: "preview-id", Name: "photo.png", MediaType: "image/png", Size: uint64(len(content))},
			data:     content,
		}
		handler := &Handler{Engine: fake}
		reply := httptest.NewRecorder()
		handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
		if reply.Code != 413 {
			t.Fatalf("%s (%dx%d) preview: %d %s", tc.name, tc.width, tc.height, reply.Code, reply.Body.String())
		}
		if bytes.Contains(reply.Body.Bytes(), content[:8]) {
			t.Fatalf("%s preview leaked file bytes", tc.name)
		}
		if fake.exportCalls != 1 {
			t.Fatalf("%s: dimension gate must verify the exported bytes first, exportCalls=%d", tc.name, fake.exportCalls)
		}
	}
}

// The caps are inclusive: exactly 8192 on a side and just under 16M pixels
// still previews with the exact stored bytes.
func TestAttachmentPreviewAllowsImageAtExactLimits(t *testing.T) {
	content := previewOversizedPNG(t, uint32(maxPreviewDimension), uint32(maxPreviewPixels/maxPreviewDimension))
	handler := newPreviewHandler(content, "image/png")
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
	if reply.Code != 200 {
		t.Fatalf("limit boundary preview: %d %s", reply.Code, reply.Body.String())
	}
	if !bytes.Equal(reply.Body.Bytes(), content) {
		t.Fatal("limit boundary preview body is not the exact stored bytes")
	}
	if reply.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("limit boundary content type: %q", reply.Header().Get("Content-Type"))
	}
}

// The 32MiB preview cap is a metadata-only check: an over-cap attachment is
// rejected with 413 before storage is ever read, so Export never runs.
func TestAttachmentPreviewOversizeMetadataRejectedBeforeExport(t *testing.T) {
	content := previewPNGBytes(t)
	fake := &previewFake{
		metadata: AttachmentMetadata{ID: "preview-id", Name: "photo.png", MediaType: "image/png", Size: uint64(maxPreviewBytes) + 1},
		data:     content,
	}
	handler := &Handler{Engine: fake}
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
	if reply.Code != 413 {
		t.Fatalf("oversize metadata preview: %d %s", reply.Code, reply.Body.String())
	}
	if fake.exportCalls != 0 {
		t.Fatalf("oversize metadata preview must not touch storage, exportCalls=%d", fake.exportCalls)
	}
	reply = httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("HEAD", "/api/attachments/preview-id?preview=1", nil))
	if reply.Code != 413 || fake.exportCalls != 0 {
		t.Fatalf("oversize metadata HEAD preview: %d exportCalls=%d", reply.Code, fake.exportCalls)
	}
}

// HEAD and Range requests cannot slip past the preview caps either.
func TestAttachmentPreviewOversizeRejectionCoversHeadAndRange(t *testing.T) {
	content := previewOversizedPNG(t, 32768, 1)
	handler := newPreviewHandler(content, "image/png")
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("HEAD", "/api/attachments/preview-id?preview=1", nil))
	if reply.Code != 413 {
		t.Fatalf("oversize HEAD preview: %d %s", reply.Code, reply.Body.String())
	}
	request := httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil)
	request.Header.Set("Range", "bytes=0-7")
	reply = httptest.NewRecorder()
	handler.ServeHTTP(reply, request)
	if reply.Code != 413 {
		t.Fatalf("oversize range preview: %d %s", reply.Code, reply.Body.String())
	}
	if bytes.Contains(reply.Body.Bytes(), content[:8]) {
		t.Fatal("oversize range preview leaked file bytes")
	}
}

func TestAttachmentPreviewRejectsUnsafeAndUnknownMediaTypes(t *testing.T) {
	payload := []byte(`<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"/>`)
	for _, mediaType := range []string{"image/svg+xml", "text/html", "application/pdf", ""} {
		handler := newPreviewHandler(payload, mediaType)
		reply := httptest.NewRecorder()
		handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
		if reply.Code != 415 {
			t.Fatalf("%q preview: %d", mediaType, reply.Code)
		}
		if strings.Contains(reply.Body.String(), string(payload)) {
			t.Fatalf("%q preview leaked file bytes", mediaType)
		}
	}
}

func TestAttachmentNormalDownloadStaysForcedOctetStream(t *testing.T) {
	content := previewPNGBytes(t)
	handler := newPreviewHandler(content, "image/png")
	for _, target := range []string{"/api/attachments/preview-id", "/api/attachments/preview-id?preview=0"} {
		reply := httptest.NewRecorder()
		handler.ServeHTTP(reply, httptest.NewRequest("GET", target, nil))
		if reply.Code != 200 || !bytes.Equal(reply.Body.Bytes(), content) {
			t.Fatalf("download %s: %d", target, reply.Code)
		}
		if reply.Header().Get("Content-Type") != "application/octet-stream" {
			t.Fatalf("download %s content type: %q", target, reply.Header().Get("Content-Type"))
		}
		if disposition := reply.Header().Get("Content-Disposition"); !strings.HasPrefix(disposition, "attachment") {
			t.Fatalf("download %s disposition: %q", target, disposition)
		}
	}
}

// The size and dimension caps only bind ?preview=1: the original download of
// an over-cap image still streams the byte-identical file as octet-stream.
func TestAttachmentNormalDownloadIgnoresPreviewLimits(t *testing.T) {
	content := previewOversizedPNG(t, 32768, 1)
	handler := newPreviewHandler(content, "image/png")
	for _, target := range []string{"/api/attachments/preview-id", "/api/attachments/preview-id?preview=0"} {
		reply := httptest.NewRecorder()
		handler.ServeHTTP(reply, httptest.NewRequest("GET", target, nil))
		if reply.Code != 200 || !bytes.Equal(reply.Body.Bytes(), content) {
			t.Fatalf("oversize download %s: %d", target, reply.Code)
		}
		if reply.Header().Get("Content-Type") != "application/octet-stream" {
			t.Fatalf("oversize download %s content type: %q", target, reply.Header().Get("Content-Type"))
		}
		if disposition := reply.Header().Get("Content-Disposition"); !strings.HasPrefix(disposition, "attachment") {
			t.Fatalf("oversize download %s disposition: %q", target, disposition)
		}
	}
}

func TestAttachmentPreviewRejectsSpoofedMediaType(t *testing.T) {
	html := []byte("<html><body><script>alert('x')</script></body></html>")
	handler := newPreviewHandler(html, "image/png")
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
	if reply.Code != 415 {
		t.Fatalf("spoofed preview: %d", reply.Code)
	}
	if strings.Contains(reply.Body.String(), string(html)) {
		t.Fatal("spoofed file bytes leaked")
	}
}

func TestAttachmentPreviewCorruptionDoesNotSendPartialFile(t *testing.T) {
	content := previewPNGBytes(t)
	fake := &previewFake{
		metadata:   AttachmentMetadata{ID: "preview-id", Name: "photo.png", MediaType: "image/png", Size: uint64(len(content))},
		data:       content,
		failExport: true,
	}
	handler := &Handler{Engine: fake}
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest("GET", "/api/attachments/preview-id?preview=1", nil))
	if reply.Code != 500 {
		t.Fatalf("corrupt preview: %d", reply.Code)
	}
	if bytes.Contains(reply.Body.Bytes(), content[:8]) {
		t.Fatal("corrupt preview leaked file bytes")
	}
}
