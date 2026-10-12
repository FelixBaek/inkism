// Package applock keeps two desktop processes from opening the same vault.
// The kernel releases the lock on process exit, including crashes. The small
// sidecar remains on disk; its existence alone never means the app is running.
package applock

import (
	"errors"
	"os"
)

var ErrBusy = errors.New("이 저장소는 다른 Inkism 창에서 사용 중입니다. 열려 있는 창을 확인해 주세요")

func Acquire(database string) (func(), error) {
	file, err := os.OpenFile(database+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := lock(file); err != nil {
		file.Close()
		return nil, err
	}
	return func() { _ = file.Close() }, nil
}
