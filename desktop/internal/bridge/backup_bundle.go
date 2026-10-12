package bridge

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	bundleTimeout   = 30 * time.Minute
	maxMetadataLine = 4096
)

// ids::new_id() emits UUID strings. Only that shape may become a zip path or
// manifest ID, which rules out traversal, separators and forged names.
var (
	bundleIDShape   = bundleAssetID
	bundleHashShape = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
)

// bundleAssets is the optional attachment-store capability of a Caller.
type bundleAssets interface {
	WalkAttachments(context.Context, func(AttachmentMetadata) error) error
	ExportAttachment(context.Context, string, io.Writer) error
}

// verifiedWriter counts and hashes bytes while they stream into a zip entry.
type verifiedWriter struct {
	destination io.Writer
	hash        hash.Hash
	written     int64
}

func (v *verifiedWriter) Write(chunk []byte) (int, error) {
	n, err := v.destination.Write(chunk)
	v.written += int64(n)
	_, _ = v.hash.Write(chunk[:n])
	return n, err
}

// exportBundle assembles notes.json, attachments/<UUID> entries and an
// attachments.ndjson manifest into one zip. The bundle is built and verified
// in private temp files first: the client receives bytes only when the whole
// export succeeded, so a partial or corrupt backup never leaks.
func (h *Handler) exportBundle(w http.ResponseWriter, r *http.Request) {
	assets, ok := h.Engine.(bundleAssets)
	if !ok {
		fail(w, 501, fmt.Errorf("첨부파일 저장소가 없습니다"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), bundleTimeout)
	defer cancel()
	directory, err := os.MkdirTemp("", "inkism-backup-")
	if err != nil {
		fail(w, 500, err)
		return
	}
	defer os.RemoveAll(directory)
	// The export path is our own trusted temp file, never renderer input.
	notesPath := filepath.Join(directory, "notes.json")
	request, _ := json.Marshal(map[string]any{"op": "export", "path": notesPath})
	response, err := h.bundleNoteCall(r.Context(), request)
	if err != nil {
		fail(w, 500, err)
		return
	}
	if !success(response) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		_, _ = w.Write(response)
		return
	}
	bundlePath, err := buildBundle(ctx, assets, notesPath, directory)
	if err != nil {
		fail(w, 500, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "inkism-backup.zip"}))
	http.ServeFile(w, r, bundlePath)
}

// buildBundle streams the verified notes export, every attachment (stored
// uncompressed, byte-for-byte) and the streamed manifest into one zip file.
func buildBundle(ctx context.Context, assets bundleAssets, notesPath, directory string) (string, error) {
	notes, err := os.Open(notesPath)
	if err != nil {
		return "", err
	}
	defer notes.Close()
	info, err := notes.Stat()
	if err != nil {
		return "", err
	}
	if info.Size() > maxBackupNotesBytes {
		return "", fmt.Errorf("노트 백업 크기 초과")
	}
	// The manifest is never held in memory: metadata lines stream to this
	// temp file during the walk and join the zip last.
	manifest, err := os.CreateTemp(directory, "attachments-*.ndjson")
	if err != nil {
		return "", err
	}
	defer manifest.Close()
	bundle, err := os.CreateTemp(directory, "inkism-backup-*.zip")
	if err != nil {
		return "", err
	}
	defer bundle.Close()
	archive := zip.NewWriter(bundle)
	if err = copyZipEntry(archive, "notes.json", zip.Deflate, notes); err != nil {
		return "", err
	}
	seen := make(map[string]bool)
	var total uint64
	var manifestSize int
	err = assets.WalkAttachments(ctx, func(meta AttachmentMetadata) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		total += meta.Size
		if len(seen) >= 100000 || total > uint64(maxBundleBytes) {
			return fmt.Errorf("백업 크기 또는 항목 수 초과")
		}
		line, err := json.Marshal(meta)
		if err != nil {
			return err
		}
		if err = validateBundleMeta(meta, seen); err != nil {
			return err
		}
		manifestSize += len(line) + 1
		if len(line)+1 >= maxMetadataLine || manifestSize > 64<<20 {
			return fmt.Errorf("첨부파일 메타데이터가 너무 깁니다: %s", meta.ID)
		}
		seen[meta.ID] = true
		entry, err := archive.CreateHeader(&zip.FileHeader{Name: "attachments/" + meta.ID, Method: zip.Store})
		if err != nil {
			return err
		}
		counter := &verifiedWriter{destination: entry, hash: sha256.New()}
		if err = assets.ExportAttachment(ctx, meta.ID, counter); err != nil {
			return err
		}
		if err = verifyBundleBytes(meta, counter); err != nil {
			return err
		}
		_, err = manifest.Write(append(line, '\n'))
		return err
	})
	if err == nil {
		if _, err = manifest.Seek(0, io.SeekStart); err == nil {
			err = copyZipEntry(archive, "attachments.ndjson", zip.Deflate, manifest)
		}
	}
	if err == nil {
		err = archive.Close()
	}
	if err != nil {
		return "", err
	}
	if err = bundle.Close(); err != nil {
		return "", err
	}
	check, err := zip.OpenReader(bundle.Name())
	if err != nil {
		return "", err
	}
	defer check.Close()
	if _, err = verifyBundleContext(ctx, &check.Reader); err != nil {
		return "", err
	}
	info, err = os.Stat(bundle.Name())
	if err != nil {
		return "", err
	}
	if info.Size() > maxBundleBytes {
		return "", fmt.Errorf("백업 전체 크기 초과")
	}
	return bundle.Name(), nil
}

func validateBundleMeta(meta AttachmentMetadata, seen map[string]bool) error {
	if !bundleIDShape.MatchString(meta.ID) {
		return fmt.Errorf("첨부파일 ID가 UUID 형식이 아닙니다: %q", meta.ID)
	}
	if seen[meta.ID] {
		return fmt.Errorf("첨부파일 ID가 중복됩니다: %s", meta.ID)
	}
	if meta.Size > uint64(maxAttachmentBytes) {
		return fmt.Errorf("첨부파일은 1GiB 이하여야 합니다: %s", meta.ID)
	}
	if !bundleHashShape.MatchString(meta.SHA256) {
		return fmt.Errorf("첨부파일 해시 형식이 잘못되었습니다: %s", meta.ID)
	}
	return nil
}

func verifyBundleBytes(meta AttachmentMetadata, counter *verifiedWriter) error {
	if counter.written != int64(meta.Size) {
		return fmt.Errorf("첨부파일 크기가 일치하지 않습니다: %s", meta.ID)
	}
	if !strings.EqualFold(hex.EncodeToString(counter.hash.Sum(nil)), meta.SHA256) {
		return fmt.Errorf("첨부파일 해시가 일치하지 않습니다: %s", meta.ID)
	}
	return nil
}

func copyZipEntry(archive *zip.Writer, name string, method uint16, source io.Reader) error {
	entry, err := archive.CreateHeader(&zip.FileHeader{Name: name, Method: method})
	if err != nil {
		return err
	}
	_, err = io.Copy(entry, source)
	return err
}
