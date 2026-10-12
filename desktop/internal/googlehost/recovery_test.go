package googlehost

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type recoveryEngine struct {
	requests   []map[string]any
	configured bool
	url        string
}

func (e *recoveryEngine) Call(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var req map[string]any
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}
	e.requests = append(e.requests, req)
	switch req["op"] {
	case "sync_status":
		return json.Marshal(map[string]any{"ok": true, "data": map[string]any{"configured": e.configured, "server_url": e.url}})
	case "sync_recovery_export":
		return json.Marshal(map[string]any{"ok": true, "data": map[string]string{"key": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))}})
	case "sync_recovery_import":
		return json.RawMessage(`{"ok":true,"data":{"configured":true}}`), nil
	}
	return nil, errors.New("unexpected operation")
}

func TestServerRecoveryHostOnlyRegistrationAndRestore(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))
	var method string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/recovery/key" || r.Header.Get("Authorization") != "Bearer ephemeral" {
			t.Error("recovery request contract")
		}
		method = r.Method
		w.Header().Set("Content-Type", "application/json")
		if method == "PUT" {
			var body map[string]string
			if json.NewDecoder(r.Body).Decode(&body) != nil || body["key"] != key || len(body) != 1 {
				t.Error("registration payload")
			}
			w.Write([]byte(`{"registered":true}`))
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"key": key, "token": strings.Repeat("t", 32)})
	}))
	defer server.Close()
	cfg := &ServerRecovery{ServerURL: server.URL, Confirmed: true, http: server.Client()}
	engine := &recoveryEngine{configured: true, url: server.URL}
	warning, err := cfg.Connect(context.Background(), "ephemeral", engine)
	if warning != "" || err != nil || method != "PUT" || len(engine.requests) != 2 || engine.requests[1]["confirmed_server_recovery"] != true {
		t.Fatal("registration failed", warning, err)
	}
	method = ""
	engine = &recoveryEngine{}
	warning, err = cfg.Connect(context.Background(), "ephemeral", engine)
	if warning != "" || err != nil || method != "GET" || len(engine.requests) != 2 {
		t.Fatal("restore failed", warning, err)
	}
	req := engine.requests[1]
	if req["op"] != "sync_recovery_import" || req["key"] != key || req["migration"] != nil || req["confirmed_server_recovery"] != true {
		t.Fatal("restore crossed host boundary")
	}
	engine = &recoveryEngine{configured: true, url: "https://another.invalid"}
	method = ""
	warning, err = cfg.Connect(context.Background(), "ephemeral", engine)
	if warning == "" || err != nil || method != "" || len(engine.requests) != 1 {
		t.Fatal("sent secrets to changed server")
	}
	// Offline escrow cannot turn a local library into a failed Google login.
	cfg.http = &http.Client{Transport: recoveryOffline{}}
	engine = &recoveryEngine{configured: true, url: server.URL}
	warning, err = cfg.Connect(context.Background(), "ephemeral", engine)
	if warning == "" || err != nil {
		t.Fatal("local library blocked by escrow outage")
	}
	engine = &recoveryEngine{}
	if _, err = cfg.Connect(context.Background(), "ephemeral", engine); err == nil || len(engine.requests) != 1 {
		t.Fatal("failed restore configured a library")
	}
}

type recoveryOffline struct{}

func (recoveryOffline) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("offline")
}

type tokenProvider struct{ identity Identity }

func (p tokenProvider) Login(context.Context) (Identity, string, error) {
	return p.identity, "ephemeral", nil
}
func (tokenProvider) Cancel() {}

func TestRecoveryAfterBindingBeforeExposureAndCancellation(t *testing.T) {
	store := &memoryStore{identity: account, exists: true}
	controller := New(tokenProvider{account}, store)
	resumed, stopped := false, false
	controller.Attach(func() error { stopped = true; return nil }, func(context.Context) error { resumed = true; return nil })
	controller.SetRecovery(func(ctx context.Context, token string) (string, error) {
		if !resumed || token != "ephemeral" {
			t.Error("recovery ran before verified resume")
		}
		if !controller.Status().Pending || !controller.Status().Locked {
			t.Error("recovery exposed status or blocked cancellation")
		}
		controller.Cancel()
		return "", ctx.Err()
	})
	if err := controller.Login(context.Background()); !errors.Is(err, ErrCancelled) || !controller.Status().Locked || !stopped {
		t.Fatal("cancelled setup exposed engine", err)
	}
	controller = New(tokenProvider{Identity{account.Issuer, "other"}}, store)
	controller.Attach(func() error { return nil }, func(context.Context) error { t.Fatal("wrong account resumed"); return nil })
	controller.SetRecovery(func(context.Context, string) (string, error) { t.Fatal("wrong account sent token"); return "", nil })
	if err := controller.Login(context.Background()); !errors.Is(err, ErrAccount) {
		t.Fatal("wrong account accepted", err)
	}
}
