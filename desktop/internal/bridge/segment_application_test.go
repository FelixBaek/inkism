package bridge

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Opt-in native fixture: the shipped React application uses the real Go HTTP
// boundary and Rust runtime. It never opens the personal desktop or profile.
type segmentApplicationFixture struct{ script, lazy string }

func TestDefaultPagedEditorApplication(t *testing.T) {
	runEditorApplication(t, []segmentApplicationFixture{{"e2e-default-paged-editor.ts", "1"}}, true)
}

func TestSegmentApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-segment-navigator.ts", "1"},
		{"e2e-cross-segment-selection.ts", "1"},
		{"e2e-bounded-selection-application.ts", "1"},
		{"e2e-bounded-selection-application.ts", "0"},
		{"e2e-large-selection-application.ts", "1"},
		{"e2e-large-selection-application.ts", "0"},
		{"e2e-pending-paste-application.ts", "1"},
		{"e2e-pending-paste-application.ts", "0"},
		{"e2e-native-clipboard-application.ts", "1"},
		{"e2e-native-clipboard-application.ts", "0"},
		{"e2e-selection-yield-application.ts", "1"},
		{"e2e-selection-yield-application.ts", "0"},
		{"e2e-source-scan-application.ts", "1"},
		{"e2e-source-scan-application.ts", "0"},
		{"e2e-boundary-application.ts", "1"},
		{"e2e-boundary-application.ts", "0"},
	})
}

func TestBlockFormatApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-document-selection.ts", "1"},
		{"e2e-block-format-application.ts", "1"},
		{"e2e-block-format-application.ts", "0"},
		{"e2e-pending-heading-application.ts", "1"},
		{"e2e-pending-heading-application.ts", "0"},
		{"e2e-block-format-input-application.ts", "1"},
		{"e2e-block-format-input-application.ts", "0"},
	})
}

func TestVerticalNavigationApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-vertical-navigation-application.ts", "1"},
		{"e2e-vertical-navigation-application.ts", "0"},
	})
}

func TestMouseSelectionApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-mouse-selection-application.ts", "1"},
		{"e2e-mouse-selection-application.ts", "0"},
	})
}

func TestMouseAutoScrollApplication(t *testing.T) {
	t.Setenv("INKISM_MOUSE_AUTOSCROLL", "1")
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-mouse-selection-application.ts", "1"},
		{"e2e-mouse-selection-application.ts", "0"},
	})
}

func TestInternalMouseSelectionApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-internal-mouse-selection-application.ts", "1"},
		{"e2e-internal-mouse-selection-application.ts", "0"},
	})
}

func TestMouseReselectionApplication(t *testing.T) {
	t.Setenv("INKISM_MOUSE_RESELECT", "1")
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-mouse-selection-application.ts", "1"},
		{"e2e-mouse-selection-application.ts", "0"},
	})
}

func TestVerticalSelectionApplication(t *testing.T) {
	t.Setenv("INKISM_VERTICAL_SHIFT", "1")
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-vertical-navigation-application.ts", "1"},
		{"e2e-vertical-navigation-application.ts", "0"},
	})
}

func TestVerticalQueueApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-vertical-queue-application.ts", "1"},
		{"e2e-vertical-queue-application.ts", "0"},
	})
}

func TestVerticalQueueSelectionApplication(t *testing.T) {
	t.Setenv("INKISM_VERTICAL_SHIFT", "1")
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-vertical-queue-application.ts", "1"},
		{"e2e-vertical-queue-application.ts", "0"},
	})
}

func TestInternalVerticalApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-internal-vertical-application.ts", "1"},
		{"e2e-internal-vertical-application.ts", "0"},
	})
}

func TestVerticalCompositionApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-cross-segment-selection.ts", "1"},
		{"e2e-cross-segment-selection.ts", "0"},
	})
}

func TestInternalWrapApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-internal-wrap-application.ts", "1"},
		{"e2e-internal-wrap-application.ts", "0"},
	})
}

func TestInternalWrapSelectionApplication(t *testing.T) {
	t.Setenv("INKISM_WRAP_SHIFT", "1")
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-internal-wrap-application.ts", "1"},
		{"e2e-internal-wrap-application.ts", "0"},
	})
}

func TestDocumentBlockActionsApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-document-block-actions.ts", "1"},
		{"e2e-document-block-actions.ts", "0"},
	})
}

func TestDocumentDragApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-document-drag.ts", "1"},
		{"e2e-document-drag.ts", "0"},
	})
}

func TestDocumentBlockStructuresApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-document-block-structures.ts", "1"},
		{"e2e-document-block-structures.ts", "0"},
	})
}

func TestStructureFormatApplication(t *testing.T) {
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-structure-format-application.ts", "1"},
		{"e2e-structure-format-application.ts", "0"},
	})
}

func TestStructureInputApplication(t *testing.T) {
	t.Setenv("INKISM_BLOCK_INPUT_CASES", "keys,paste-keys,composition")
	for _, command := range []string{"toggleBulletList", "toggleOrderedList", "toggleTaskList", "toggleBlockquote", "toggleCodeBlock"} {
		t.Run(command, func(t *testing.T) {
			t.Setenv("INKISM_BLOCK_FORMAT_COMMAND", command)
			runSegmentApplication(t, []segmentApplicationFixture{
				{"e2e-block-format-input-application.ts", "1"},
				{"e2e-block-format-input-application.ts", "0"},
			})
		})
	}
}

func TestStructureRangeApplication(t *testing.T) {
	t.Setenv("INKISM_STRUCTURE_SELECTION", "range")
	runSegmentApplication(t, []segmentApplicationFixture{
		{"e2e-structure-format-application.ts", "1"},
		{"e2e-structure-format-application.ts", "0"},
	})
}

func runSegmentApplication(t *testing.T, fixtures []segmentApplicationFixture) {
	t.Helper()
	runEditorApplication(t, fixtures, false)
}

func runEditorApplication(t *testing.T, fixtures []segmentApplicationFixture, boundedDefaults bool) {
	t.Helper()
	binary := os.Getenv("INKISM_SEGMENT_ENGINE")
	if binary == "" || os.Getenv("CHROMIUM_PATH") == "" {
		t.Skip("requires current Rust executable and isolated Chromium")
	}
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "frontend/dist/index.html")); err != nil {
		t.Fatal(err)
	}
	engine, err := Start(binary, filepath.Join(t.TempDir(), "notes.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	mux := http.NewServeMux()
	mux.Handle("/api/", &Handler{Engine: engine, WindowedEditor: boundedDefaults, LazyEditor: boundedDefaults})
	mux.Handle("/", http.FileServer(http.Dir(filepath.Join(root, "frontend/dist"))))
	server := httptest.NewServer(mux)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	for _, fixture := range fixtures {
		t.Run(fixture.script+"/lazy="+fixture.lazy, func(t *testing.T) {
			command := exec.CommandContext(ctx, "node", filepath.Join(root, "frontend/scripts", fixture.script))
			command.Dir = root
			command.Env = append(os.Environ(), "INKISM_URL="+server.URL, "INKISM_LAZY="+fixture.lazy)
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("application %s lazy=%s: %v\n%s", fixture.script, fixture.lazy, err, output)
			}
			t.Log(string(output))
		})
	}
}
