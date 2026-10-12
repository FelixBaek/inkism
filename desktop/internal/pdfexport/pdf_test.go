package pdfexport

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestIsolatedJobCleanupAndArguments(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, "fake-edge")
	_ = os.WriteFile(binary, []byte("fake"), 0600)
	renderer := Renderer{Binary: binary, TempRoot: root}
	data, err := renderer.render(context.Background(), []byte("<p>한글 문서</p>"), func(_ context.Context, _ string, args []string) error {
		var output, profile string
		for _, arg := range args {
			if strings.HasPrefix(arg, "--print-to-pdf=") {
				output = strings.TrimPrefix(arg, "--print-to-pdf=")
			}
			if strings.HasPrefix(arg, "--user-data-dir=") {
				profile = strings.TrimPrefix(arg, "--user-data-dir=")
			}
		}
		if filepath.Dir(output) != filepath.Dir(profile) || !strings.Contains(profile, "inkism-pdf-") {
			t.Fatal(args)
		}
		if !strings.HasPrefix(args[len(args)-1], "file:///") {
			t.Fatal("invalid file URI")
		}
		return os.WriteFile(output, []byte("%PDF-1.7\nsynthetic"), 0600)
	})
	if err != nil || !strings.HasPrefix(string(data), "%PDF-") {
		t.Fatal(err)
	}
	files, _ := os.ReadDir(root)
	if len(files) != 1 || files[0].Name() != "fake-edge" {
		t.Fatal("job files leaked", files)
	}
}
func TestCancelledAndFailedJobCleanUp(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, "fake-edge")
	_ = os.WriteFile(binary, []byte("fake"), 0600)
	r := Renderer{Binary: binary, TempRoot: root, Timeout: time.Millisecond}
	_, err := r.render(context.Background(), []byte("note"), func(ctx context.Context, _ string, _ []string) error { <-ctx.Done(); return ctx.Err() })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	files, _ := os.ReadDir(root)
	if len(files) != 1 {
		t.Fatal("cancel left files")
	}
	_, err = r.render(context.Background(), []byte("note"), func(context.Context, string, []string) error { return errors.New("SECRET NOTE") })
	if err == nil || strings.Contains(err.Error(), "SECRET NOTE") {
		t.Fatal("sensitive child output leaked")
	}
}
func TestMissingBrowserAndOutputRejected(t *testing.T) {
	r := Renderer{Binary: filepath.Join(t.TempDir(), "missing")}
	if _, err := r.Render(context.Background(), []byte("note")); err == nil {
		t.Fatal("missing browser")
	}
	if err := removeJob(t.TempDir()); err == nil {
		t.Fatal("unsafe cleanup accepted")
	}
}
