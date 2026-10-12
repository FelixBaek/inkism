// Package pdfexport runs one isolated, noninteractive browser print job.
package pdfexport

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const MaxDocumentBytes = 64 << 20
const MaxPDFBytes = 128 << 20

type Renderer struct {
	Binary   string
	TempRoot string
	Timeout  time.Duration
}

func (r Renderer) Render(ctx context.Context, document []byte) ([]byte, error) {
	return r.render(ctx, document, runBrowser)
}

type runner func(context.Context, string, []string) error

// browserBinary resolves and checks the configured or discovered browser.
func (r Renderer) browserBinary() (string, error) {
	binary := r.Binary
	if binary == "" {
		var err error
		binary, err = findBrowser()
		if err != nil {
			return "", err
		}
	}
	if !filepath.IsAbs(binary) {
		return "", errors.New("PDF 브라우저 경로가 올바르지 않습니다")
	}
	if info, err := os.Stat(binary); err != nil || info.IsDir() {
		return "", errors.New("Microsoft Edge가 없어 PDF를 만들 수 없습니다")
	}
	return binary, nil
}

func (r Renderer) render(ctx context.Context, document []byte, run runner) (result []byte, resultErr error) {
	if len(document) == 0 || len(document) > MaxDocumentBytes {
		return nil, errors.New("PDF 문서 크기는 64 MiB 이하여야 합니다")
	}
	binary, err := r.browserBinary()
	if err != nil {
		return nil, err
	}
	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp(r.TempRoot, "inkism-pdf-")
	if err != nil {
		return nil, errors.New("PDF 임시 폴더를 만들지 못했습니다")
	}
	directory, err = filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	defer func() {
		// Only the exact directory created above is removed. Never use caller paths.
		if err := removeJob(directory); err != nil && resultErr == nil {
			result = nil
			resultErr = errors.New("PDF 임시 파일 정리가 완료되지 않았습니다")
		}
	}()
	source := filepath.Join(directory, "document.html")
	output := filepath.Join(directory, "document.pdf")
	if err := os.WriteFile(source, document, 0600); err != nil {
		return nil, errors.New("PDF 임시 문서를 저장하지 못했습니다")
	}
	path := filepath.ToSlash(source)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	sourceURL := (&url.URL{Scheme: "file", Path: path}).String()
	args := []string{"--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--metrics-recording-only", "--no-pdf-header-footer", "--user-data-dir=" + filepath.Join(directory, "profile"), "--print-to-pdf=" + output, sourceURL}
	if err := run(ctx, binary, args); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("PDF 내보내기를 취소했거나 제한 시간을 넘었습니다: %w", ctx.Err())
		}
		return nil, errors.New("Microsoft Edge에서 PDF를 만들지 못했습니다")
	}
	file, err := os.Open(output)
	if err != nil {
		return nil, errors.New("PDF 결과 파일이 생성되지 않았습니다")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() > MaxPDFBytes {
		return nil, errors.New("PDF 결과가 128 MiB 한도를 넘었습니다")
	}
	data, err := io.ReadAll(io.LimitReader(file, MaxPDFBytes+1))
	if err != nil {
		return nil, errors.New("PDF 결과를 읽지 못했습니다")
	}
	if len(data) > MaxPDFBytes || !bytes.HasPrefix(data, []byte("%PDF-")) {
		return nil, errors.New("PDF 결과가 올바르지 않습니다")
	}
	return data, nil
}
func removeJob(directory string) error {
	if !filepath.IsAbs(directory) || !strings.HasPrefix(filepath.Base(directory), "inkism-pdf-") {
		return errors.New("unsafe cleanup target")
	}
	var err error
	for i := 0; i < 20; i++ {
		err = os.RemoveAll(directory)
		if err == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return err
}
