package googlehost

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/FelixBaek/inkism/desktop/internal/bridge"
)

// This opt-in belongs to one library, not every local library on the PC.
// It contains no key, relay token or Google credential.
type ServerRecovery struct {
	ServerURL string `json:"server_url"`
	Confirmed bool   `json:"confirmed_server_recovery"`
	http      *http.Client
}

func ReadServerRecovery(database string) (*ServerRecovery, error) {
	raw, err := boundedFile(filepath.Join(filepath.Dir(database), "server-recovery.json"), 8192)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, errors.New("서버 복구 설정을 읽지 못했습니다")
	}
	var cfg ServerRecovery
	if strictJSON(raw, &cfg) != nil || !cfg.Confirmed {
		return nil, errors.New("서버 키 보관 승인이 필요합니다")
	}
	u, err := url.Parse(cfg.ServerURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("서버 복구 주소는 HTTPS 서버 주소여야 합니다")
	}
	cfg.http = &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &cfg, nil
}

func recoveryCall(ctx context.Context, engine bridge.Caller, request any, out any) error {
	raw, err := json.Marshal(request)
	if err != nil {
		return errors.New("복구 요청을 준비하지 못했습니다")
	}
	defer clear(raw)
	response, err := engine.Call(ctx, raw)
	if err != nil {
		return errors.New("복구 저장 엔진에 연결하지 못했습니다")
	}
	defer clear(response)
	var result struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(response, &result) != nil || !result.OK {
		return errors.New("기존 저장소를 보존하기 위해 복구 연결을 중단했습니다")
	}
	defer clear(result.Data)
	if out != nil && json.Unmarshal(result.Data, out) != nil {
		return errors.New("복구 저장 엔진 응답을 읽지 못했습니다")
	}
	return nil
}

// Connect runs only after verified account binding and engine resume, while
// renderer data paths remain closed. Existing local vaults remain usable when
// escrow is temporarily unavailable. New device restore must succeed first.
func (c *ServerRecovery) Connect(ctx context.Context, idToken string, engine bridge.Caller) (string, error) {
	if !c.Confirmed || idToken == "" {
		return "", errors.New("인증된 서버 복구 승인이 필요합니다")
	}
	var status struct {
		Configured bool   `json:"configured"`
		ServerURL  string `json:"server_url"`
	}
	if err := recoveryCall(ctx, engine, map[string]any{"op": "sync_status"}, &status); err != nil {
		return "", err
	}
	if status.Configured {
		warning := "로컬 노트는 열렸지만 서버 복구 키 보관을 확인하지 못했습니다"
		if status.ServerURL != c.ServerURL {
			return "기존 동기화 서버와 복구 서버가 달라 키를 보내지 않았습니다", nil
		}
		var vault struct {
			Key string `json:"key"`
		}
		if err := recoveryCall(ctx, engine, map[string]any{"op": "sync_recovery_export", "server_url": c.ServerURL, "confirmed_server_recovery": true}, &vault); err != nil {
			return warning, nil
		}
		if err := c.request(ctx, "PUT", idToken, map[string]string{"key": vault.Key}, nil); err != nil {
			return warning, nil
		}
		return "", nil
	}
	var vault struct {
		Key   string `json:"key"`
		Token string `json:"token"`
	}
	if err := c.request(ctx, "GET", idToken, nil, &vault); err != nil {
		return "", errors.New("서버에 보관된 복구 키를 가져오지 못했습니다")
	}
	key, err := base64.StdEncoding.Strict().DecodeString(vault.Key)
	defer clear(key)
	if err != nil || len(key) != 32 || len(vault.Token) < 32 || len(vault.Token) > 4096 {
		return "", errors.New("서버 복구 키 형식이 올바르지 않습니다")
	}
	err = recoveryCall(ctx, engine, map[string]any{"op": "sync_recovery_import", "server_url": c.ServerURL, "key": vault.Key, "token": vault.Token, "confirmed_server_recovery": true}, nil)
	return "", err
}

func (c *ServerRecovery) request(ctx context.Context, method, token string, body any, out any) error {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	defer clear(raw)
	req, err := http.NewRequestWithContext(ctx, method, c.ServerURL+"/v1/recovery/key", bytes.NewReader(raw))
	if err != nil {
		return errors.New("복구 서버 요청을 준비하지 못했습니다")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return errors.New("복구 서버에 연결하지 못했습니다")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return errors.New("복구 서버가 요청을 승인하지 않았습니다")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8193))
	defer clear(data)
	if err != nil || len(data) > 8192 {
		return errors.New("복구 서버 응답을 읽지 못했습니다")
	}
	if out != nil {
		return strictJSON(data, out)
	}
	var registered struct {
		Registered bool `json:"registered"`
	}
	if strictJSON(data, &registered) != nil || !registered.Registered {
		return errors.New("복구 키 보관을 확인하지 못했습니다")
	}
	return nil
}
