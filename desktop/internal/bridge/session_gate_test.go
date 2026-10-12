package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSessionGateFailsClosedAndWaitsForAcceptedWork(t *testing.T) {
	var stopped, resumed atomic.Int32
	gate := NewSessionGate(false, func() error { stopped.Add(1); return errors.New("stop failed") },
		func(context.Context) error { resumed.Add(1); return nil })
	release, ok := gate.enter()
	if !ok {
		t.Fatal("new gate unexpectedly locked")
	}
	done := make(chan error, 1)
	go func() { done <- gate.Lock() }()
	select {
	case <-done:
		t.Fatal("lock crossed active save")
	case <-time.After(20 * time.Millisecond):
	}
	release()
	if err := <-done; err == nil {
		t.Fatal("shutdown error hidden")
	}
	if !gate.Status().Locked || stopped.Load() != 1 {
		t.Fatal("not fail closed")
	}
	if err := gate.Lock(); err != nil || stopped.Load() != 1 {
		t.Fatal("repeated lock stopped twice")
	}
	if err := gate.Unlock(context.Background(), func(context.Context) error { return errors.New("wrong credential") }); err == nil {
		t.Fatal("bad credential accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := gate.Unlock(ctx, func(context.Context) error { return nil }); err == nil {
		t.Fatal("cancelled unlock accepted")
	}
	if resumed.Load() != 0 || !gate.Status().Locked {
		t.Fatal("failed auth resumed runtime")
	}
	if err := gate.Unlock(context.Background(), func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if gate.Status().Locked || resumed.Load() != 1 {
		t.Fatal("successful auth not resumed")
	}
}

func TestSessionGateFailedResumeStaysLocked(t *testing.T) {
	gate := NewSessionGate(true, nil, func(context.Context) error { return errors.New("missing library") })
	if err := gate.Unlock(context.Background(), func(context.Context) error { return nil }); err == nil {
		t.Fatal("startup error hidden")
	}
	if !gate.Status().Locked {
		t.Fatal("startup failure exposed data")
	}
}

func TestLockedHandlerBlocksAllDataAndPreservesSecurityOriginChecks(t *testing.T) {
	engine := &fakeEngine{}
	gate := NewSessionGate(true, nil, nil)
	h := &Handler{Engine: engine, Gate: gate}
	for _, path := range []string{"/api/rpc", "/api/attachments", "/api/attachments/id", "/api/backup", "/api/restore", "/api/export", "/api/import", "/api/upload-access", "/api/storage/open", "/api/storage/encrypted-copy"} {
		req := httptest.NewRequest("POST", path, strings.NewReader(`{"op":"get"}`))
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		if out.Code != 423 {
			t.Fatalf("%s: %d", path, out.Code)
		}
	}
	if len(engine.last) != 0 {
		t.Fatal("locked request reached engine")
	}
	req := httptest.NewRequest("GET", "/api/security/status", nil)
	out := httptest.NewRecorder()
	h.ServeHTTP(out, req)
	if out.Code != 200 || !strings.Contains(out.Body.String(), `"locked":true`) {
		t.Fatal(out.Body.String())
	}
	req = httptest.NewRequest("POST", "/api/security/lock", strings.NewReader("{}"))
	req.Header.Set("Origin", "https://evil.example")
	out = httptest.NewRecorder()
	h.ServeHTTP(out, req)
	if out.Code != 403 {
		t.Fatal("security route skipped origin check")
	}
}

func TestLockedUploadServerRejectsValidCapability(t *testing.T) {
	fake := &attachmentFake{}
	server, err := StartUploadServerWithGate(fake, NewSessionGate(true, nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	for _, path := range []string{"/api/attachments", "/api/import", "/api/restore"} {
		req, _ := http.NewRequest("POST", server.Access.URL+path, strings.NewReader("must not read"))
		req.Header.Set("Origin", "http://wails.localhost")
		req.Header.Set("Authorization", "Bearer "+server.Access.Token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 423 {
			t.Fatalf("%s: %d %s", path, res.StatusCode, body)
		}
	}
	if len(fake.data) != 0 {
		t.Fatal("locked upload reached storage")
	}
}

func TestSuspendedEngineStartsOnlyAfterAuthenticationAndPreservesData(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "fixture")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	if out, err := exec.Command("go", "build", "-o", binary, "testdata/copy_engine.go").CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	db := filepath.Join(t.TempDir(), "notes.db")
	const body = "synthetic unchanged body"
	if err := os.WriteFile(db, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	engine := StartSuspended(binary, db)
	defer engine.Close()
	gate := NewSessionGate(true, engine.Close, engine.Resume)
	if _, err := os.Stat(db + ".running"); !os.IsNotExist(err) {
		t.Fatal("runtime started before authentication")
	}
	if err := gate.Unlock(context.Background(), func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 2; n++ {
		out, err := engine.Call(context.Background(), json.RawMessage(`{"op":"get"}`))
		if err != nil || !strings.Contains(string(out), body) {
			t.Fatalf("%v %s", err, out)
		}
		if err := gate.Lock(); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(db + ".running"); !os.IsNotExist(err) {
			t.Fatal("runtime remained alive")
		}
		if err := gate.Unlock(context.Background(), func(context.Context) error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(db)
	if err != nil || string(data) != body {
		t.Fatal("library changed", err)
	}
}

type gateBlockingCaller struct{ entered, release chan struct{} }

func (c gateBlockingCaller) Call(context.Context, json.RawMessage) (json.RawMessage, error) {
	close(c.entered)
	<-c.release
	return json.RawMessage(`{"ok":true}`), nil
}
func TestSessionGateBackgroundRPCAdmissionIsAtomic(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	gate := NewSessionGate(false, func() error { return nil }, nil)
	caller := gate.Guard(gateBlockingCaller{entered, release})
	callDone := make(chan error, 1)
	go func() {
		_, err := caller.Call(context.Background(), json.RawMessage(`{"op":"due_reminders"}`))
		callDone <- err
	}()
	<-entered
	lockDone := make(chan error, 1)
	go func() { lockDone <- gate.Lock() }()
	select {
	case <-lockDone:
		t.Fatal("lock crossed background RPC")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := <-callDone; err != nil {
		t.Fatal(err)
	}
	if err := <-lockDone; err != nil {
		t.Fatal(err)
	}
	if _, err := caller.Call(context.Background(), json.RawMessage(`{"op":"due_reminders"}`)); err == nil {
		t.Fatal("locked background request admitted")
	}
}
