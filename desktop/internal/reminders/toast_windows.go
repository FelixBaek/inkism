//go:build windows

package reminders

import "git.sr.ht/~jackmordaunt/go-toast/v2/wintoast"

// Registration and native delivery occur only after explicit user opt-in.
// No PowerShell fallback or execution-policy change is permitted.
func Notify() error {
	if err := wintoast.SetAppData(wintoast.AppData{AppID: "Inkism.Reminders", GUID: "{5E2C64C8-CA3F-456E-884C-6CECC3F377AA}"}); err != nil {
		return err
	}
	return wintoast.Push("Inkism.Reminders", `<toast><visual><binding template="ToastGeneric"><text>Inkism</text><text>예약한 노트 알림이 있습니다. Inkism에서 확인해 주세요.</text></binding></visual></toast>`)
}
