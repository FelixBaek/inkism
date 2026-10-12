//go:build windows

package main

import (
	"fmt"
	"golang.org/x/sys/windows"
	"runtime"
	"unicode/utf16"
	"unsafe"
)

// OPENFILENAMEW uses native pointer alignment on both supported Windows ABIs.
// The startup recovery picker runs before Wails has created an application.
type openFileName struct {
	Size                         uint32
	Owner, Instance              uintptr
	Filter, CustomFilter         *uint16
	MaxCustomFilter, FilterIndex uint32
	File                         *uint16
	MaxFile                      uint32
	FileTitle                    *uint16
	MaxFileTitle                 uint32
	InitialDir, Title            *uint16
	Flags                        uint32
	FileOffset, FileExtension    uint16
	DefaultExtension             *uint16
	CustomData, Hook             uintptr
	TemplateName                 *uint16
	Reserved                     uintptr
	ReservedWord, FlagsEx        uint32
}

func recoverLibrarySelection(reason error) (string, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	title, _ := windows.UTF16PtrFromString("Inkism 저장소 복구")
	message, _ := windows.UTF16PtrFromString("최근 저장소를 열 수 없습니다.\n\n" + reason.Error() + "\n\n기존 저장소 파일을 다시 선택하시겠습니까?\n아니요를 누르면 파일을 변경하지 않고 종료합니다.")
	answer, err := windows.MessageBox(0, message, title, windows.MB_YESNO|windows.MB_ICONWARNING|windows.MB_DEFBUTTON2)
	if err != nil {
		return "", err
	}
	const dialogYes = 6
	if answer != dialogYes {
		return "", nil
	}
	buffer := make([]uint16, 32768)
	filter := utf16.Encode([]rune("Inkism 저장소 (*.db)\x00*.db\x00\x00"))
	pickerTitle, _ := windows.UTF16PtrFromString("복구할 저장소 파일 선택")
	config := openFileName{File: &buffer[0], MaxFile: uint32(len(buffer)), Filter: &filter[0], FilterIndex: 1, Title: pickerTitle,
		Flags: 0x00080000 | 0x00001000 | 0x00000800 | 0x00000008 | 0x02000000} // Explorer, existing file/path, unchanged cwd, no recent list
	config.Size = uint32(unsafe.Sizeof(config))
	dll := windows.NewLazySystemDLL("comdlg32.dll")
	result, _, _ := dll.NewProc("GetOpenFileNameW").Call(uintptr(unsafe.Pointer(&config)))
	runtime.KeepAlive(config)
	runtime.KeepAlive(filter)
	runtime.KeepAlive(buffer)
	if result == 0 {
		code, _, _ := dll.NewProc("CommDlgExtendedError").Call()
		if code != 0 {
			return "", fmt.Errorf("저장소 선택창을 열지 못했습니다 (Windows 오류 %d)", code)
		}
		return "", nil
	}
	return windows.UTF16ToString(buffer), nil
}
