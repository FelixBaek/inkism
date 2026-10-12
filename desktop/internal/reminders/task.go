package reminders

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const TaskPrefix = "Inkism.Reminder."

type TaskStore interface {
	Get(context.Context, string) (string, error)
	Create(context.Context, string, string) error
	Delete(context.Context, string) error
}

var ErrTaskNotFound = errors.New("reminder task not found")

type TaskScheduler struct {
	Executable, SID string
	Store           TaskStore
}

func TaskXML(id, executable, sid string, at time.Time) (string, error) {
	if !cacheIDPattern.MatchString(id) || !filepath.IsAbs(executable) || strings.ContainsAny(executable, "\x00\r\n") || sid == "" {
		return "", errors.New("invalid reminder task identity")
	}
	escape := func(s string) string { var b strings.Builder; _ = xml.EscapeText(&b, []byte(s)); return b.String() }
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Inkism generic reminders from an opaque schedule cache. No library access.</Description></RegistrationInfo>
<Triggers><TimeTrigger><Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>%s</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
<Principals><Principal id="CurrentUser"><UserId>%s</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>true</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT45S</ExecutionTimeLimit><Priority>7</Priority></Settings>
<Actions Context="CurrentUser"><Exec><Command>%s</Command><Arguments>--reminder-cache %s</Arguments></Exec></Actions>
</Task>`, at.UTC().Format(time.RFC3339), escape(sid), escape(executable), id), nil
}
func (s TaskScheduler) verify(id, raw string) error {
	var task struct {
		Principals struct {
			Principal []struct {
				User  string `xml:"UserId"`
				Logon string `xml:"LogonType"`
				Level string `xml:"RunLevel"`
			} `xml:"Principal"`
		} `xml:"Principals"`
		Actions struct {
			Exec []struct {
				Command string `xml:"Command"`
				Args    string `xml:"Arguments"`
			} `xml:"Exec"`
		} `xml:"Actions"`
	}
	if len(raw) > 1<<20 || xml.Unmarshal([]byte(raw), &task) != nil {
		return errors.New("invalid existing reminder task")
	}
	if len(task.Principals.Principal) != 1 || len(task.Actions.Exec) != 1 {
		return errors.New("existing task is not owned by this Inkism")
	}
	p, a := task.Principals.Principal[0], task.Actions.Exec[0]
	if !strings.EqualFold(p.User, s.SID) || p.Logon != "InteractiveToken" || p.Level != "LeastPrivilege" || !strings.EqualFold(filepath.Clean(a.Command), filepath.Clean(s.Executable)) || a.Args != "--reminder-cache "+id {
		return errors.New("existing task is not owned by this Inkism")
	}
	return nil
}
func (s TaskScheduler) Enable(ctx context.Context, id string) error {
	raw, err := TaskXML(id, s.Executable, s.SID, time.Now().Add(time.Minute))
	if err != nil {
		return err
	}
	name := TaskPrefix + id
	existing, err := s.Store.Get(ctx, name)
	if err == nil {
		return s.verify(id, existing)
	}
	if !errors.Is(err, ErrTaskNotFound) {
		return err
	}
	return s.Store.Create(ctx, name, raw)
}
func (s TaskScheduler) Disable(ctx context.Context, id string) error {
	if !cacheIDPattern.MatchString(id) {
		return errors.New("invalid reminder task ID")
	}
	name := TaskPrefix + id
	raw, err := s.Store.Get(ctx, name)
	if errors.Is(err, ErrTaskNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = s.verify(id, raw); err != nil {
		return err
	}
	return s.Store.Delete(ctx, name)
}
func RemoveOwnedTasks(ctx context.Context, root string, scheduler Scheduler) error {
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var failures []error
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".task") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".task")
		if !cacheIDPattern.MatchString(id) {
			continue
		}
		receiptBytes, readErr := os.ReadFile(filepath.Join(root, entry.Name()))
		var receipt taskReceipt
		if readErr != nil || len(receiptBytes) > 1024 || json.Unmarshal(receiptBytes, &receipt) != nil || receipt.Owner == "" || receipt.Owner != receiptOwner(scheduler) {
			continue
		}
		bg := Background{Root: root, ID: id, Scheduler: scheduler}
		if _, err := bg.Disable(ctx); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s TaskScheduler) OwnershipID() string {
	value := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(s.Executable)) + "\x00" + strings.ToLower(s.SID)))
	return hex.EncodeToString(value[:])
}

type taskReceipt struct {
	Owner string `json:"owner"`
}

func receiptOwner(scheduler Scheduler) string {
	if owner, ok := scheduler.(interface{ OwnershipID() string }); ok {
		return owner.OwnershipID()
	}
	return ""
}
