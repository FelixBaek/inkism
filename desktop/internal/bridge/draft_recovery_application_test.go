package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// Shipped React + real Go boundary + Rust process in a disposable library.
// This is a Chromium fixture, not personal desktop or WebView2 automation.
func TestDraftRecoveryApplication(t *testing.T) {
	binary := os.Getenv("INKISM_TEST_ENGINE")
	if binary == "" || os.Getenv("CHROMIUM_PATH") == "" {
		t.Skip("requires current Rust runtime and isolated Chromium")
	}
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "frontend/dist/index.html")); err != nil {
		t.Fatal(err)
	}
	modes := []bool{false}
	if os.Getenv("INKISM_RECOVERY_ENCRYPTED") == "1" {
		modes = append(modes, true)
	}
	for _, encrypted := range modes {
		name := "plain"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "notes.db")
			var engine *Engine
			var err error
			if encrypted {
				engine, err = StartNewEncrypted(binary, path)
			} else {
				engine, err = Start(binary, path)
			}
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = engine.Close() }()
			mux := http.NewServeMux()
			mux.Handle("/api/", &Handler{Engine: engine})
			mux.Handle("/", http.FileServer(http.Dir(filepath.Join(root, "frontend/dist"))))
			server := httptest.NewServer(mux)
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			command := exec.CommandContext(ctx, "node", filepath.Join(root, "frontend/scripts/e2e-recovery-import.ts"))
			command.Dir = root
			command.Env = append(os.Environ(), "INKISM_URL="+server.URL)
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("%s recovery: %v\n%s", name, err, output)
			}
			t.Log(string(output))
			call := func(request map[string]any) any {
				t.Helper()
				encoded, err := json.Marshal(request)
				if err != nil {
					t.Fatal(err)
				}
				body, err := engine.Call(ctx, encoded)
				if err != nil {
					t.Fatal(err)
				}
				var result struct {
					OK   bool `json:"ok"`
					Data any  `json:"data"`
				}
				if err := json.Unmarshal(body, &result); err != nil || !result.OK {
					t.Fatalf("recovery verification RPC failed: %s %v", body, err)
				}
				return result.Data
			}
			check := func() map[string]any {
				t.Helper()
				status := call(map[string]any{"op": "storage_status"}).(map[string]any)
				if status["encrypted"] != encrypted {
					t.Fatal("storage encryption mode changed")
				}
				list := call(map[string]any{"op": "list", "view": "all"}).(map[string]any)
				items := list["items"].([]any)
				if len(items) != 6 { // original + complete/partial/missing + rescued and finally saved new draft
					t.Fatalf("unexpected recovered note count: %d", len(items))
				}
				notes := make(map[string]any, len(items))
				for _, item := range items {
					id := item.(map[string]any)["id"].(string)
					notes[id] = call(map[string]any{"op": "get", "id": id})
				}
				return notes
			}
			before := check()
			server.Close()
			if err := engine.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, err := Start(binary, path)
			if err != nil {
				t.Fatal(err)
			}
			engine = reopened
			if !reflect.DeepEqual(check(), before) {
				t.Fatal("recovered/original body, metadata or revision changed on runtime restart")
			}
			t.Log("PASS exact recovered/original notes after Rust process restart; " + name)
		})
	}
}
