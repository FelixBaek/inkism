//go:build !windows

package pdfexport

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"time"
)

func findBrowser() (string, error) {
	return "", errors.New("PDF 내보내기는 Windows 앱에서 사용할 수 있습니다")
}
func stopProcess(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}

func runBrowser(ctx context.Context, binary string, args []string) error {
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 2 * time.Second
	return cmd.Run()
}
