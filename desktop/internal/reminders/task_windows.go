//go:build windows

package reminders

import (
	"context"
	"errors"
	ole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"os/user"
	"runtime"
)

type nativeTaskStore struct{}

func NativeScheduler(executable string) (Scheduler, error) {
	current, err := user.Current()
	if err != nil {
		return nil, err
	}
	return TaskScheduler{Executable: executable, SID: current.Uid, Store: nativeTaskStore{}}, nil
}
func withTaskFolder(ctx context.Context, fn func(*ole.IDispatch) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); err != nil {
		var e *ole.OleError
		if !errors.As(err, &e) || e.Code() != 1 {
			return err
		}
	}
	defer ole.CoUninitialize()
	unknown, err := oleutil.CreateObject("Schedule.Service")
	if err != nil {
		return err
	}
	defer unknown.Release()
	service, err := unknown.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return err
	}
	defer service.Release()
	connected, err := oleutil.CallMethod(service, "Connect")
	if err != nil {
		return err
	}
	connected.Clear()
	folderValue, err := oleutil.CallMethod(service, "GetFolder", `\`)
	if err != nil {
		return err
	}
	defer folderValue.Clear()
	return fn(folderValue.ToIDispatch())
}
func (nativeTaskStore) Get(ctx context.Context, name string) (string, error) {
	var result string
	err := withTaskFolder(ctx, func(folder *ole.IDispatch) error {
		task, err := oleutil.CallMethod(folder, "GetTask", name)
		if err != nil {
			var code *ole.OleError
			if errors.As(err, &code) && missingTaskCode(code) {
				return ErrTaskNotFound
			}
			return err
		}
		defer task.Clear()
		raw, err := oleutil.GetProperty(task.ToIDispatch(), "Xml")
		if err != nil {
			return err
		}
		defer raw.Clear()
		result = raw.ToString()
		return nil
	})
	return result, err
}
func (nativeTaskStore) Create(ctx context.Context, name, raw string) error {
	return withTaskFolder(ctx, func(folder *ole.IDispatch) error {
		// TASK_CREATE=2 (never overwrite), TASK_LOGON_INTERACTIVE_TOKEN=3, no password.
		value, err := oleutil.CallMethod(folder, "RegisterTask", name, raw, int32(2), nil, nil, int32(3), nil)
		if err == nil {
			value.Clear()
		}
		return err
	})
}
func (nativeTaskStore) Delete(ctx context.Context, name string) error {
	return withTaskFolder(ctx, func(folder *ole.IDispatch) error {
		value, err := oleutil.CallMethod(folder, "DeleteTask", name, int32(0))
		if err == nil {
			value.Clear()
		}
		return err
	})
}

func missingTaskCode(code *ole.OleError) bool {
	if code.Code() == 0x80070002 {
		return true
	}
	exception, ok := code.SubError().(ole.EXCEPINFO)
	return ok && exception.SCODE() == 0x80070002
}
