//go:build windows

package pdfexport

import (
	"context"
	"errors"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

func findBrowser() (string, error) {
	for _, root := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		if root == "" {
			continue
		}
		candidate := filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("Microsoft Edge가 없어 PDF를 만들 수 없습니다. Edge 설치 상태를 확인해 주세요")
}

type jobAccounting struct {
	TotalUserTime, TotalKernelTime, PeriodUserTime, PeriodKernelTime int64
	PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses uint32
}

func jobActive(job windows.Handle) (uint32, error) {
	var info jobAccounting
	err := windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), nil)
	return info.ActiveProcesses, err
}
func runBrowser(ctx context.Context, binary string, args []string) error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(job)
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		return err
	}
	quoted := []string{syscall.EscapeArg(binary)}
	for _, arg := range args {
		quoted = append(quoted, syscall.EscapeArg(arg))
	}
	executable, err := windows.UTF16PtrFromString(binary)
	if err != nil {
		return err
	}
	command, err := windows.UTF16PtrFromString(strings.Join(quoted, " "))
	if err != nil {
		return err
	}
	startup := windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfo{})), Flags: windows.STARTF_USESHOWWINDOW, ShowWindow: windows.SW_HIDE}
	var process windows.ProcessInformation
	// Assign the suspended process before it can spawn children. Every child stays
	// in this owned job; closing the job never targets another Edge instance.
	err = windows.CreateProcess(executable, command, nil, nil, false, windows.CREATE_SUSPENDED|windows.CREATE_NO_WINDOW, nil, nil, &startup, &process)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(process.Process)
	defer windows.CloseHandle(process.Thread)
	if err = windows.AssignProcessToJobObject(job, process.Process); err != nil {
		_ = windows.TerminateProcess(process.Process, 1)
		return err
	}
	if _, err = windows.ResumeThread(process.Thread); err != nil {
		return err
	}
	return waitJob(ctx, job, process.Process)
}

// waitJob polls until every process in job exits or ctx ends.
func waitJob(ctx context.Context, job, process windows.Handle) error {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		active, err := jobActive(job)
		if err != nil {
			return err
		}
		if active == 0 {
			return exitStatus(process)
		}
		select {
		case <-ctx.Done():
			_ = windows.TerminateJobObject(job, 1)
			reapJob(job)
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func exitStatus(process windows.Handle) error {
	var code uint32
	if err := windows.GetExitCodeProcess(process, &code); err != nil {
		return err
	}
	if code != 0 {
		return errors.New("headless browser failed")
	}
	return nil
}

// reapJob waits briefly for this job only before the caller removes its
// private files.
func reapJob(job windows.Handle) {
	for i := 0; i < 40; i++ {
		active, _ := jobActive(job)
		if active == 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
}
