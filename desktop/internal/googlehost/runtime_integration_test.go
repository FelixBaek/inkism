package googlehost

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FelixBaek/inkism/desktop/internal/bridge"
)

// Opt-in real Rust process coverage. The identity provider and account store are
// synthetic; this never contacts Google or accesses the Windows credential store.
func TestRealRuntimeIdentityGateRestartPreservesSource(t *testing.T) {
	binary := os.Getenv("INKISM_TEST_RUNTIME_BINARY")
	if binary == "" {
		t.Skip("set INKISM_TEST_RUNTIME_BINARY to an existing Rust runtime executable")
	}
	if !filepath.IsAbs(binary) {
		t.Fatal("runtime executable must be an absolute opt-in path")
	}
	info, err := os.Stat(binary)
	if err != nil || !info.Mode().IsRegular() {
		t.Fatalf("invalid runtime executable: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := filepath.Join(t.TempDir(), "synthetic.db")
	seed, err := bridge.Start(binary, db)
	if err != nil {
		t.Fatal(err)
	}
	defer seed.Close()
	call := func(c bridge.Caller, request any) map[string]any {
		t.Helper()
		wire, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := c.Call(ctx, wire)
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			OK    bool
			Data  map[string]any
			Error string
		}
		if err := json.Unmarshal(raw, &response); err != nil || !response.OK {
			t.Fatalf("RPC failed: %s (%v)", raw, err)
		}
		return response.Data
	}
	body := "# synthetic source\r\n<p>literal &amp; 한글 😀</p>"
	saved := call(seed, map[string]any{"op": "save", "note": map[string]any{
		"title": "Synthetic Google boundary", "content": body, "content_format": "markdown",
	}})
	id, ok := saved["id"].(string)
	if !ok || id == "" {
		t.Fatal("missing note id")
	}
	if err := seed.Close(); err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{identity: account, exists: true}
	request, _ := json.Marshal(map[string]any{"op": "get", "id": id})

	for cycle := 0; cycle < 2; cycle++ {
		engine := bridge.StartSuspended(binary, db)
		defer engine.Close()
		wrong := New(provider(Identity{account.Issuer, "wrong-synthetic-account"}, nil), store)
		wrong.Attach(engine.Close, engine.Resume)
		if err := wrong.Login(ctx); !errors.Is(err, ErrAccount) {
			t.Fatalf("wrong account: %v", err)
		}
		if _, err := wrong.Gate().Guard(engine).Call(ctx, request); err == nil {
			t.Fatal("wrong account reached protected RPC")
		}
		if _, err := engine.Call(ctx, request); err == nil {
			t.Fatal("suspended runtime started before authentication")
		}
		controller := New(provider(account, nil), store)
		controller.Attach(engine.Close, engine.Resume)
		if !controller.InitiallyLocked() {
			t.Fatal("restart lost account lock")
		}
		if err := controller.Login(ctx); err != nil {
			t.Fatal(err)
		}
		note := call(controller.Gate().Guard(engine), map[string]any{"op": "get", "id": id})
		if note["content"] != body || note["content_format"] != "markdown" || note["revision"] != saved["revision"] {
			t.Fatalf("restart changed source: %#v", note)
		}
		if err := controller.Lock(); err != nil {
			t.Fatal(err)
		}
		if _, err := controller.Gate().Guard(engine).Call(ctx, request); err == nil {
			t.Fatal("locked RPC reached runtime")
		}
		if _, err := engine.Call(ctx, request); err == nil {
			t.Fatal("lock did not stop actual Rust runtime")
		}
		controller.Cancel()
	}
	if store.saves != 0 {
		t.Fatal("existing identity binding was overwritten")
	}
}
