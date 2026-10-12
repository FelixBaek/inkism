package bridge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
)

const maxAttachmentBytes int64 = 1 << 30

// Bound individual inline decodes; original files remain downloadable.
const maxPreviewBytes = 32 << 20
const maxPreviewDimension = 8192
const maxPreviewPixels = 16_000_000

// previewInlineMediaTypes is the strict whitelist for ?preview=1: only raster
// image types may ever render inline. SVG/HTML and everything else stays a
// forced download, so stored markup can never execute in the app origin.
var previewInlineMediaTypes = map[string]struct{}{
	"image/png":  {},
	"image/jpeg": {},
	"image/gif":  {},
	"image/webp": {},
}

type AttachmentMetadata struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Size      uint64 `json:"size"`
	SHA256    string `json:"sha256"`
}

type attachmentCaller interface {
	ImportAttachment(context.Context, string, string, io.Reader) (AttachmentMetadata, error)
	AttachmentInfo(context.Context, string) (AttachmentMetadata, error)
	ExportAttachment(context.Context, string, io.Writer) error
}

// A separate Rust process/database keeps large transfers off the ordered note RPC stream.
func (e *Engine) attachmentCommand(ctx context.Context, input io.Reader, output io.Writer, args ...string) error {
	cmd := exec.CommandContext(ctx, e.binary, append([]string{"--db", e.database}, args...)...)
	hideWindow(cmd)
	cmd.Stdin, cmd.Stdout = input, output
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("첨부파일 처리 실패: %w: %s", err, diagnostic.String())
	}
	return nil
}

func (e *Engine) ImportAttachment(ctx context.Context, name, mediaType string, input io.Reader) (AttachmentMetadata, error) {
	var result AttachmentMetadata
	var output bytes.Buffer
	err := e.attachmentCommand(ctx, input, &output, "--attachment-import", "--attachment-name", name, "--attachment-type", mediaType)
	if err == nil {
		err = json.Unmarshal(output.Bytes(), &result)
	}
	return result, err
}
func (e *Engine) AttachmentInfo(ctx context.Context, id string) (AttachmentMetadata, error) {
	var result AttachmentMetadata
	var output bytes.Buffer
	err := e.attachmentCommand(ctx, nil, &output, "--attachment-info", id)
	if err == nil {
		err = json.Unmarshal(output.Bytes(), &result)
	}
	return result, err
}
func (e *Engine) ExportAttachment(ctx context.Context, id string, output io.Writer) error {
	return e.attachmentCommand(ctx, nil, output, "--attachment-export", id)
}

func (h *Handler) uploadAttachment(w http.ResponseWriter, r *http.Request) {
	assets, ok := h.Engine.(attachmentCaller)
	if !ok {
		fail(w, 501, fmt.Errorf("첨부파일 저장소가 없습니다"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentBytes+(1<<20))
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
	if expected := r.FormValue("size"); expected != "" {
		size, parseErr := strconv.ParseUint(expected, 10, 64)
		if parseErr != nil || size != uint64(header.Size) {
			fail(w, 400, fmt.Errorf("첨부파일 전송 크기가 일치하지 않습니다 (예상 %s, 수신 %d 바이트)", expected, header.Size))
			return
		}
	}
	if header.Size > maxAttachmentBytes {
		fail(w, 413, fmt.Errorf("첨부파일은 1GiB 이하여야 합니다"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	mediaType := header.Header.Get(headerContentType)
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	metadata, err := assets.ImportAttachment(ctx, header.Filename, mediaType, source)
	if err != nil {
		fail(w, 400, err)
		return
	}
	if metadata.Size != uint64(header.Size) {
		fail(w, 500, fmt.Errorf("첨부파일 저장 크기가 일치하지 않습니다 (수신 %d, 저장 %d 바이트)", header.Size, metadata.Size))
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "data": metadata})
}

func (h *Handler) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	assets, ok := h.Engine.(attachmentCaller)
	if !ok {
		fail(w, 501, fmt.Errorf("첨부파일 저장소가 없습니다"))
		return
	}
	id := strings.TrimPrefix(r.URL.Path, attachmentsPathPrefix)
	if id == "" || strings.ContainsAny(id, "/\\\x00") {
		fail(w, 400, fmt.Errorf("invalid attachment id"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	metadata, err := assets.AttachmentInfo(ctx, id)
	if err != nil {
		fail(w, 404, err)
		return
	}
	previewType, ok := attachmentPreviewType(w, r, metadata)
	if !ok {
		return
	}
	// Verify every byte/hash before sending anything to the client.
	output, err := os.CreateTemp("", "inkism-attachment-*")
	if err != nil {
		fail(w, 500, err)
		return
	}
	defer os.Remove(output.Name())
	defer output.Close()
	if err = assets.ExportAttachment(ctx, id, output); err != nil {
		fail(w, 500, err)
		return
	}
	info, err := output.Stat()
	if err != nil {
		fail(w, 500, err)
		return
	}
	if uint64(info.Size()) != metadata.Size {
		fail(w, 500, fmt.Errorf("첨부파일 크기가 일치하지 않습니다"))
		return
	}
	if _, err = output.Seek(0, io.SeekStart); err != nil {
		fail(w, 500, err)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if previewType != "" {
		if !checkInlinePreview(w, output, previewType) {
			return
		}
		w.Header().Set(headerContentType, previewType)
		w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": metadata.Name}))
	} else {
		w.Header().Set(headerContentType, "application/octet-stream")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": metadata.Name}))
	}
	http.ServeContent(w, r, metadata.Name, time.Time{}, output)
}

// attachmentPreviewType validates a ?preview=1 request. ?preview=1 is the only
// inline path. The declared type must be on the strict image whitelist before
// any storage read or byte leaves the host; SVG/HTML/other/empty MIME is
// rejected outright. It returns "" for a plain download.
func attachmentPreviewType(w http.ResponseWriter, r *http.Request, metadata AttachmentMetadata) (string, bool) {
	if r.URL.Query().Get("preview") != "1" {
		return "", true
	}
	declared, _, err := mime.ParseMediaType(metadata.MediaType)
	if err != nil {
		fail(w, 415, fmt.Errorf("이 첨부파일은 인라인 미리보기를 지원하지 않습니다"))
		return "", false
	}
	if _, allowed := previewInlineMediaTypes[declared]; !allowed {
		fail(w, 415, fmt.Errorf("이 첨부파일은 인라인 미리보기를 지원하지 않습니다"))
		return "", false
	}
	if metadata.Size > maxPreviewBytes {
		fail(w, 413, fmt.Errorf("큰 이미지는 미리보기 대신 원본을 다운로드해 주세요"))
		return "", false
	}
	return declared, true
}

// checkInlinePreview verifies the stored bytes before an inline response and
// leaves output rewound to the start.
func checkInlinePreview(w http.ResponseWriter, output *os.File, previewType string) bool {
	// A whitelisted declaration must also match the actual bytes: sniff the
	// leading 512 bytes so a renamed HTML/attachment blob can never render
	// inline. Nothing is served until this content check passes.
	head := make([]byte, 512)
	n, readErr := io.ReadFull(output, head)
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		fail(w, 500, readErr)
		return false
	}
	sniffed, _, sniffErr := mime.ParseMediaType(http.DetectContentType(head[:n]))
	if sniffErr != nil || sniffed != previewType {
		fail(w, 415, fmt.Errorf("첨부파일 내용이 선언된 형식과 일치하지 않습니다"))
		return false
	}
	if _, err := output.Seek(0, io.SeekStart); err != nil {
		fail(w, 500, err)
		return false
	}
	// Read only a bounded header, never allocate the decoded image here.
	config, _, configErr := image.DecodeConfig(io.LimitReader(output, 1<<20))
	if configErr != nil || config.Width <= 0 || config.Height <= 0 {
		fail(w, 415, fmt.Errorf("이미지 크기를 확인할 수 없어 미리보기를 표시하지 않습니다"))
		return false
	}
	if config.Width > maxPreviewDimension || config.Height > maxPreviewDimension ||
		int64(config.Width)*int64(config.Height) > maxPreviewPixels {
		fail(w, 413, fmt.Errorf("큰 이미지는 미리보기 대신 원본을 다운로드해 주세요"))
		return false
	}
	if _, err := output.Seek(0, io.SeekStart); err != nil {
		fail(w, 500, err)
		return false
	}
	return true
}

// WalkAttachments streams the list while individual exports run independently.
func (e *Engine) WalkAttachments(ctx context.Context, visit func(AttachmentMetadata) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(ctx, e.binary, "--db", e.database, "--attachment-list")
	hideWindow(cmd)
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	output, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err = cmd.Start(); err != nil {
		return err
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 4096)
	for scanner.Scan() {
		var metadata AttachmentMetadata
		if err = json.Unmarshal(scanner.Bytes(), &metadata); err == nil {
			err = visit(metadata)
		}
		if err != nil {
			cancel()
			_ = cmd.Wait()
			return err
		}
	}
	if err = scanner.Err(); err != nil {
		cancel()
		_ = cmd.Wait()
		return err
	}
	if err = cmd.Wait(); err != nil {
		return fmt.Errorf("첨부 목록 읽기 실패: %w: %s", err, diagnostic.String())
	}
	return nil
}
