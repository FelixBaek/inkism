package bridge

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"time"
)

// WebView2's intercepted multipart requests can omit disk-backed File bytes.
// Use the browser's normal network stack for uploads, still streaming to Rust.
// The random capability is disclosed only through the in-process asset handler.
type UploadAccess struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}
type UploadServer struct {
	Access UploadAccess
	server *http.Server
}

func (s *UploadServer) Close() error { return s.server.Close() }

func StartUploadServer(engine Caller) (*UploadServer, error) {
	return StartUploadServerWithGate(engine, nil)
}

func StartUploadServerWithGate(engine Caller, gate *SessionGate) (*UploadServer, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	host := listener.Addr().String()
	access := UploadAccess{URL: "http://" + host, Token: hex.EncodeToString(secret[:])}
	handler := &Handler{Engine: engine, Host: host, Gate: gate}
	server := &http.Server{ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// No wildcard CORS, cookies, unauthenticated mutations or non-upload routes.
		if r.Host != host || r.Header.Get("Origin") != "http://wails.localhost" {
			fail(w, 403, fmt.Errorf("invalid upload origin"))
			return
		}
		if r.URL.Path != "/api/attachments" && r.URL.Path != "/api/import" && r.URL.Path != "/api/restore" {
			fail(w, 404, fmt.Errorf("unsupported upload route"))
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", "http://wails.localhost")
		w.Header().Set("Vary", "Origin")
		if r.Method == "OPTIONS" {
			if r.Header.Get("Access-Control-Request-Method") != "POST" {
				fail(w, 405, fmt.Errorf("POST required"))
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "POST")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != "POST" {
			fail(w, 405, fmt.Errorf("POST required"))
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+access.Token)) != 1 {
			fail(w, 403, fmt.Errorf("invalid upload token"))
			return
		}
		// Origin was authenticated above; the existing handler still checks Host,
		// request size and format, and cancellation stays attached to this request.
		forwarded := r.Clone(r.Context())
		forwarded.Header.Del("Origin")
		forwarded.Header.Del("Sec-Fetch-Site")
		handler.ServeHTTP(w, forwarded)
	})
	go func() { _ = server.Serve(listener) }()
	return &UploadServer{Access: access, server: server}, nil
}
