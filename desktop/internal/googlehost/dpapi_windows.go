//go:build windows

package googlehost

import (
	"errors"
	"golang.org/x/sys/windows"
	"unsafe"
)

func protectDPAPI(raw []byte, encrypt bool) ([]byte, error) {
	if len(raw) == 0 {
		return nil, errors.New("empty account binding")
	}
	input := windows.DataBlob{Size: uint32(len(raw)), Data: &raw[0]}
	var output windows.DataBlob
	var err error
	if encrypt {
		err = windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
	} else {
		err = windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
	}
	if err != nil {
		return nil, ErrPolicy
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
	defer clear(unsafe.Slice(output.Data, output.Size))
	return append([]byte(nil), unsafe.Slice(output.Data, output.Size)...), nil
}
func WindowsStore(path string) FileStore {
	return FileStore{Path: path, Protect: func(b []byte) ([]byte, error) { return protectDPAPI(b, true) }, Unprotect: func(b []byte) ([]byte, error) { return protectDPAPI(b, false) }}
}
