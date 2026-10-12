//go:build windows

package main

import (
	"context"
	"fmt"
	"github.com/FelixBaek/inkism/desktop/internal/applock"
	"github.com/FelixBaek/inkism/desktop/internal/bridge"
	"github.com/FelixBaek/inkism/desktop/internal/googlehost"
	"github.com/FelixBaek/inkism/desktop/internal/pdfexport"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"io/fs"
	"path/filepath"
	"sync/atomic"
	"time"
)

// appSession is the state shared by the native window callbacks. ctx is set
// once Wails starts.
type appSession struct {
	ctx         context.Context
	engine      *bridge.Engine
	security    *googlehost.Controller
	ready       atomic.Bool
	copying     atomic.Bool
	nextLibrary atomic.Value
}

func runApp(engine *bridge.Engine, assets fs.FS, _ string, windowed, lazy bool, security *googlehost.Controller) (string, error) {
	app := &appSession{engine: engine, security: security}
	handler := &bridge.Handler{WindowedEditor: windowed, LazyEditor: lazy, Engine: engine}
	handler.Security = security
	if security != nil {
		handler.Gate = security.Gate()
	}
	handler.PDFRender = (pdfexport.Renderer{}).Render
	handler.Update = newUpdater()
	stopReminders := startReminders(engine, handler)
	defer stopReminders()
	clipper, clipErr := bridge.StartClipper(handler.Gate)
	if clipErr != nil {
		return "", clipErr
	}
	defer clipper.Close()
	handler.Clipper = clipper
	uploads, err := bridge.StartUploadServerWithGate(engine, handler.Gate)
	if err != nil {
		return "", err
	}
	defer uploads.Close()
	handler.EncryptedCopy = app.encryptedCopy
	handler.OpenLibrary = app.openLibrary
	handler.Upload = uploads.Access
	handler.Close = func() { app.ready.Store(true); wruntime.Quit(app.ctx) }
	err = wails.Run(&options.App{
		Title: "Inkism", Width: 1360, Height: 900, MinWidth: 900, MinHeight: 600,
		Frameless:     true,
		AssetServer:   &assetserver.Options{Assets: assets, Handler: handler},
		OnStartup:     func(c context.Context) { app.ctx = c },
		OnBeforeClose: app.beforeClose,
		Windows:       &windows.Options{WebviewIsTransparent: false, WindowIsTranslucent: false},
	})
	if path, ok := app.nextLibrary.Load().(string); ok {
		return path, err
	}
	return "", err
}

func (a *appSession) encryptedCopy(operation context.Context) (string, error) {
	if !a.copying.CompareAndSwap(false, true) {
		return "", fmt.Errorf("암호화 복사가 이미 진행 중입니다")
	}
	defer a.copying.Store(false)
	parent, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{Title: "암호화 사본을 보관할 폴더 선택"})
	if err != nil || parent == "" {
		return "", err
	}
	destination := filepath.Join(parent, "Inkism-Encrypted-"+time.Now().Format("20060102-150405.000000000"))
	return a.engine.CopyEncrypted(operation, destination)
}

func (a *appSession) openLibrary() (bool, error) {
	if !a.copying.CompareAndSwap(false, true) {
		return false, fmt.Errorf("저장소 작업이 진행 중입니다")
	}
	defer a.copying.Store(false)
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{Title: "열 저장소 파일 선택", Filters: []wruntime.FileFilter{{DisplayName: "Inkism 저장소", Pattern: "*.db"}}})
	if err != nil || path == "" {
		return false, err
	}
	path, err = existingLibrary(path)
	if err != nil {
		return false, err
	}
	release, err := applock.Acquire(path)
	if err != nil {
		return false, err
	}
	checkCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	err = a.engine.CheckLibrary(checkCtx, path)
	cancel()
	release()
	if err != nil {
		return false, err
	}
	a.nextLibrary.Store(path)
	a.copying.Store(false)
	a.ready.Store(true)
	wruntime.Quit(a.ctx)
	return true, nil
}

func (a *appSession) beforeClose(c context.Context) bool {
	if a.copying.Load() {
		return true
	}
	if a.ready.Load() {
		return false
	}
	if a.security != nil && a.security.CancelForLockedClose() {
		return false
	}
	wruntime.WindowExecJS(c, "window.dispatchEvent(new Event('native-close-request'))")
	return true
}
