package applock

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestExclusiveAndReopen(t *testing.T) {
	db := filepath.Join(t.TempDir(), "한글 노트.db")
	release, err := Acquire(db)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if second, err := Acquire(db); !errors.Is(err, ErrBusy) {
		if second != nil {
			second()
		}
		t.Fatalf("second open: %v", err)
	}
	release()
	reopen, err := Acquire(db)
	if err != nil {
		t.Fatal(err)
	}
	reopen()
}

func TestDifferentVaults(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"a", "b"} {
		release, err := Acquire(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		defer release()
	}
}

func TestLockReleasedAfterProcessCrash(t *testing.T) {
	if db := os.Getenv("INKISM_LOCK_HELPER_DB"); db != "" {
		release, err := Acquire(db)
		if err != nil {
			os.Exit(2)
		}
		defer release() // os.Exit deliberately bypasses release, like a crash.
		fmt.Println("locked")
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		os.Exit(7)
	}
	db := filepath.Join(t.TempDir(), "crash.db")
	cmd := exec.Command(os.Args[0], "-test.run=^TestLockReleasedAfterProcessCrash$")
	cmd.Env = append(os.Environ(), "INKISM_LOCK_HELPER_DB="+db)
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = input.Close() })
	line, err := bufio.NewReader(output).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "locked" {
		t.Fatalf("helper: %q %v", line, err)
	}
	if release, err := Acquire(db); !errors.Is(err, ErrBusy) {
		if release != nil {
			release()
		}
		t.Fatalf("second process must be rejected: %v", err)
	}
	_, _ = fmt.Fprintln(input, "exit")
	err = cmd.Wait()
	var exited *exec.ExitError
	if !errors.As(err, &exited) || exited.ExitCode() != 7 {
		t.Fatalf("helper exit: %v", err)
	}
	release, err := Acquire(db)
	if err != nil {
		t.Fatalf("kernel must release crashed process lock: %v", err)
	}
	release()
}
