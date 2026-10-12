//go:build !windows

package reminders

import "errors"

func Notify() error {
	return errors.New("Windows 시스템 알림은 Windows 앱에서 사용할 수 있습니다")
}
