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

// Kills both real renderer and Rust processes after a journal acknowledgement.
// All profiles and input are synthetic; this never controls the user's PC.
func TestCrashDraftApplication(t *testing.T) {
	binary := os.Getenv("INKISM_TEST_ENGINE")
	if binary == "" || os.Getenv("CHROMIUM_PATH") == "" {
		t.Skip("requires current Rust runtime and isolated Chromium")
	}
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	modes := []bool{false}
	if os.Getenv("INKISM_RECOVERY_ENCRYPTED") == "1" {
		modes = append(modes, true)
	}
	for _, encrypted := range modes {
		mode := "plain"
		if encrypted {
			mode = "encrypted"
		}
		for _, scenario := range []string{"new", "existing", "paged", "saved", "retry", "stalled", "split"} {
			t.Run(mode+"/"+scenario, func(t *testing.T) {
				directory := t.TempDir()
				path := filepath.Join(directory, "notes.db")
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
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
				defer cancel()
				manifestPath := filepath.Join(directory, "manifest.json")
				command := exec.CommandContext(ctx, "node", filepath.Join(root, "frontend/scripts/e2e-crash-draft.ts"))
				command.Dir = root
				command.Env = append(os.Environ(), "INKISM_URL="+server.URL, "INKISM_CRASH_SCENARIO="+scenario, "INKISM_CRASH_MANIFEST="+manifestPath)
				output, err := command.CombinedOutput()
				if err != nil {
					t.Fatalf("renderer crash fixture: %v\n%s", err, output)
				}
				t.Log(string(output))
				var manifest struct {
					Original        map[string]any `json:"original"`
					ExpectedContent string         `json:"expectedContent"`
					Title           string         `json:"title"`
					Format          string         `json:"format"`
					Tags            []any          `json:"tags"`
					NotebookID      string         `json:"notebook_id"`
					ExpectRecovered bool           `json:"expectRecovered"`
					SourceID        string         `json:"source_id"`
					RecoverySuffix  string         `json:"recoverySuffix"`
				}
				data, err := os.ReadFile(manifestPath)
				if err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal(data, &manifest); err != nil {
					t.Fatal(err)
				}
				server.Close()
				if err := engine.cmd.Process.Kill(); err != nil {
					t.Fatal(err)
				}
				_ = engine.Close() // SIGKILL/TerminateProcess is expected, not a clean save.
				engine, err = Start(binary, path)
				if err != nil {
					t.Fatal(err)
				}
				call := func(op string, args map[string]any) any {
					t.Helper()
					if args == nil {
						args = map[string]any{}
					}
					args["op"] = op
					raw, err := json.Marshal(args)
					if err != nil {
						t.Fatal(err)
					}
					response, err := engine.Call(ctx, raw)
					if err != nil {
						t.Fatal(err)
					}
					var result struct {
						OK   bool `json:"ok"`
						Data any  `json:"data"`
					}
					if err := json.Unmarshal(response, &result); err != nil || !result.OK {
						t.Fatalf("RPC %s: %s %v", op, response, err)
					}
					return result.Data
				}
				inspect := func() map[string]any {
					t.Helper()
					if call("draft_journal_status", nil).(map[string]any)["pending"] != float64(0) {
						t.Fatal("journal not atomically consumed")
					}
					if call("storage_status", nil).(map[string]any)["encrypted"] != encrypted {
						t.Fatal("encryption mode changed")
					}
					items := call("list", map[string]any{"view": "all"}).(map[string]any)["items"].([]any)
					want := 1
					if manifest.ExpectRecovered && manifest.Original != nil {
						want = 2
					}
					if len(items) != want {
						t.Fatalf("unexpected notes or duplicate recovery: %d want %d", len(items), want)
					}
					notes := map[string]any{}
					var recovered map[string]any
					for _, item := range items {
						id := item.(map[string]any)["id"].(string)
						note := call("get", map[string]any{"id": id}).(map[string]any)
						notes[id] = note
						if note["title"] == manifest.Title+manifest.RecoverySuffix {
							recovered = note
						}
					}
					if manifest.Original != nil && !reflect.DeepEqual(notes[manifest.Original["id"].(string)], manifest.Original) {
						t.Fatal("original body or metadata changed")
					}
					if manifest.ExpectRecovered {
						if recovered == nil || recovered["id"] == manifest.SourceID || recovered["content"] != manifest.ExpectedContent || recovered["content_format"] != manifest.Format || recovered["notebook_id"] != manifest.NotebookID || !reflect.DeepEqual(recovered["tags"], manifest.Tags) {
							t.Fatal("recovered body, format or metadata mismatch")
						}
					} else if recovered != nil {
						t.Fatal("already saved draft created a duplicate")
					}
					return notes
				}
				before := inspect()
				if err := engine.Close(); err != nil {
					t.Fatal(err)
				}
				engine, err = Start(binary, path)
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(inspect(), before) {
					t.Fatal("recovery changed on second reopen")
				}
				t.Log("PASS: abrupt renderer/Rust death; exact separate recovery, original/metadata/encryption and idempotent reopen")
			})
		}
	}
}
