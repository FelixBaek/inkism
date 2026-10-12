//go:build !windows

package main

import (
	"github.com/FelixBaek/inkism/desktop/internal/bridge"
	"github.com/FelixBaek/inkism/desktop/internal/googlehost"
	"io/fs"
	"log"
	"net"
	"net/http"
)

func runApp(engine *bridge.Engine, assets fs.FS, address string, windowed, lazy bool, security *googlehost.Controller) (string, error) {
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return "", err
	}
	defer listener.Close()
	api := &bridge.Handler{WindowedEditor: windowed, LazyEditor: lazy, Engine: engine, Host: listener.Addr().String()}
	if security != nil {
		api.Security = security
		api.Gate = security.Gate()
	}
	clipper, clipErr := bridge.StartClipper(api.Gate)
	if clipErr != nil {
		return "", clipErr
	}
	defer clipper.Close()
	api.Clipper = clipper
	api.Update = newUpdater()
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/", http.FileServer(http.FS(assets)))
	log.Printf("Development preview: http://%s", listener.Addr())
	return "", http.Serve(listener, mux)
}
