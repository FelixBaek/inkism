//go:build windows

package bridge

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The Windows workflow points this at the packaged SQLCipher-enabled runtime.
func TestPackagedEncryptedCopyWhileAppOpen(t *testing.T) {
	binary := os.Getenv("INKISM_TEST_ENGINE")
	if binary == "" {
		t.Skip("requires packaged encrypted Windows runtime")
	}
	source := filepath.Join(t.TempDir(), "원본.db")
	e, err := Start(binary, source)
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	call := func(engine *Engine, request string) map[string]any {
		t.Helper()
		raw, err := engine.Call(ctx, json.RawMessage(request))
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			OK   bool           `json:"ok"`
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(raw, &result); err != nil || !result.OK {
			t.Fatalf("RPC failed: %s %v", raw, err)
		}
		return result.Data
	}
	note := call(e, `{"op":"save","note":{"title":"암호화 복사","content":"<p>원본 <strong>그대로</strong></p>","text":"원본 그대로"}}`)
	destination := filepath.Join(filepath.Dir(source), "암호화 사본")
	target, err := e.CopyEncrypted(ctx, destination)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.CheckLibrary(ctx, target); err != nil {
		t.Fatal(err)
	}
	invalid := filepath.Join(filepath.Dir(source), "invalid.db")
	if err := os.WriteFile(invalid, []byte("not a library"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := e.CheckLibrary(ctx, invalid); err == nil {
		t.Fatal("invalid selection accepted")
	}
	request, _ := json.Marshal(map[string]any{"op": "get", "id": note["id"]})
	if got := call(e, string(request)); got["content"] != note["content"] {
		t.Fatal("original body changed")
	}
	if call(e, `{"op":"storage_status"}`)["encrypted"] != false {
		t.Fatal("original library was switched")
	}
	copied, err := Start(binary, target)
	if err != nil {
		t.Fatal(err)
	}
	defer copied.Close()
	if got := call(copied, string(request)); got["content"] != note["content"] {
		t.Fatal("copied body changed")
	}
	if call(copied, `{"op":"storage_status"}`)["encrypted"] != true {
		t.Fatal("destination is not encrypted")
	}
	if _, err := e.CopyEncrypted(ctx, destination); err == nil {
		t.Fatal("existing destination accepted")
	}
	call(e, `{"op":"save","note":{"title":"복귀","content":"<p>복사 후에도 저장</p>","text":"복사 후에도 저장"}}`)
}
