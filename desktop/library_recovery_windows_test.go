//go:build windows

package main

import (
	"testing"
	"unsafe"
)

func TestStartupPickerNativeLayout(t *testing.T) {
	var config openFileName
	want := uintptr(152)
	if unsafe.Sizeof(uintptr(0)) == 4 {
		want = 88
	}
	if unsafe.Sizeof(config) != want {
		t.Fatalf("OPENFILENAMEW size=%d expected=%d", unsafe.Sizeof(config), want)
	}
}
