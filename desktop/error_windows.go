//go:build windows

package main

import "golang.org/x/sys/windows"

func showStartupError(err error) {
	text, _ := windows.UTF16PtrFromString("Inkism를 시작하지 못했습니다.\n\n" + err.Error())
	title, _ := windows.UTF16PtrFromString("Inkism")
	_, _ = windows.MessageBox(0, text, title, windows.MB_OK|windows.MB_ICONERROR)
}
