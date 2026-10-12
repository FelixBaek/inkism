package bridge

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// CopyEncrypted holds the ordered RPC gate while the runtime is offline. It
// always reopens the ORIGINAL library, including after a failed/cancelled copy.
// The destination is new; Rust owns key provisioning and copy validation.
// The host must flush editor drafts before calling this operation.
func (e *Engine) CopyEncrypted(ctx context.Context, destination string) (target string, err error) {
	if !filepath.IsAbs(destination) {
		return "", errors.New("암호화 복사 위치는 절대 경로여야 합니다")
	}
	if _, statErr := os.Lstat(destination); !os.IsNotExist(statErr) {
		if statErr != nil {
			return "", statErr
		}
		return "", errors.New("암호화 복사는 새 폴더에만 만들 수 있습니다")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if e.stopped {
		return "", errors.New("저장 엔진이 종료되었습니다. 앱을 다시 실행해 주세요")
	}
	// Reopening does not use the copy's context: a timeout must not prevent
	// recovery of the original library. Start has its own health-check deadline.
	defer func() {
		resumed, resumeErr := Start(e.binary, e.database)
		if resumeErr != nil {
			err = errors.Join(err, fmt.Errorf("원래 저장소를 다시 열지 못했습니다. 앱을 다시 실행해 주세요: %w", resumeErr))
			return
		}
		e.cmd, e.input, e.output = resumed.cmd, resumed.input, resumed.output
		e.stopped, e.waited = false, false
	}()
	if closeErr := e.closeLocked(); closeErr != nil {
		return "", fmt.Errorf("저장 엔진 종료를 확인하지 못해 복사를 중단했습니다: %w", closeErr)
	}
	command := exec.CommandContext(ctx, e.binary, "--db", e.database, "--copy-encrypted-to", destination)
	hideWindow(command)
	output, copyErr := command.CombinedOutput()
	if copyErr != nil {
		return "", fmt.Errorf("암호화 복사 실패: %w\n%s", copyErr, output)
	}
	return filepath.Join(destination, "notes.db"), nil
}

// CheckLibrary starts no workers and makes no schema changes. The current
// runtime remains live if a selected file cannot be opened or decrypted.
func (e *Engine) CheckLibrary(ctx context.Context, path string) error {
	return CheckLibrary(ctx, e.binary, path)
}

func CheckLibrary(ctx context.Context, binary, path string) error {
	command := exec.CommandContext(ctx, binary, "--db", path, "--check-library")
	hideWindow(command)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("선택한 저장소를 열 수 없습니다: %w\n%s", err, output)
	}
	return nil
}
