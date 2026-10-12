package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestEncryptedCopyRestoresOriginalRuntime(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "fixture")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command("go", "build", "-o", binary, "testdata/copy_engine.go")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build fixture: %v %s", err, output)
	}
	for _, mode := range []string{"success", "fail", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			source := filepath.Join(t.TempDir(), "original.db")
			const body = "한글 원본 · exact content"
			if err := os.WriteFile(source, []byte(body), 0600); err != nil {
				t.Fatal(err)
			}
			e, err := Start(binary, source)
			if err != nil {
				t.Fatal(err)
			}
			defer e.Close()
			destination := filepath.Join(filepath.Dir(source), mode)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := e.CopyEncrypted(ctx, destination); done <- err }()
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, err := os.Stat(source + ".copying"); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("copy never started")
				}
				time.Sleep(10 * time.Millisecond)
			}
			// Requests arriving during the offline operation must wait, never reach a
			// closed child or accidentally start using the destination library.
			read := make(chan error, 1)
			go func() {
				data, err := e.Call(context.Background(), json.RawMessage(`{"op":"get"}`))
				if err == nil {
					var v struct {
						Data string `json:"data"`
					}
					err = json.Unmarshal(data, &v)
					if err == nil && v.Data != body {
						err = fmt.Errorf("original content mismatch: %q", v.Data)
					}
				}
				read <- err
			}()
			select {
			case err := <-read:
				t.Fatalf("RPC crossed offline gate: %v", err)
			case <-time.After(50 * time.Millisecond):
			}
			if mode == "cancel" {
				cancel()
			} else if err := os.WriteFile(source+".release", nil, 0600); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if (mode == "success") != (err == nil) {
					t.Fatalf("copy result: %v", err)
				}
				if mode == "fail" && !strings.Contains(err.Error(), "fixture copy failure") {
					t.Fatal(err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("copy hung")
			}
			select {
			case err := <-read:
				if err != nil {
					t.Fatalf("original did not resume: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("RPC did not resume")
			}
			original, err := os.ReadFile(source)
			if err != nil || string(original) != body {
				t.Fatal("source changed", err)
			}
			if mode == "success" {
				copied, err := os.ReadFile(filepath.Join(destination, "notes.db"))
				if err != nil || string(copied) != body {
					t.Fatal("copy mismatch", err)
				}
			}
			if err := e.Close(); err != nil {
				t.Fatal(err)
			}
			if err := e.Close(); err != nil {
				t.Fatal("second close", err)
			}
		})
	}
}
