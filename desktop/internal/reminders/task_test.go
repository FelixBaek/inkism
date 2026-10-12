package reminders

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeTaskStore struct {
	tasks            map[string]string
	creates, deletes int
}

func (s *fakeTaskStore) Get(_ context.Context, name string) (string, error) {
	if raw, ok := s.tasks[name]; ok {
		return raw, nil
	}
	return "", ErrTaskNotFound
}
func (s *fakeTaskStore) Create(_ context.Context, name, raw string) error {
	if _, ok := s.tasks[name]; ok {
		return errors.New("exists")
	}
	s.creates++
	s.tasks[name] = raw
	return nil
}
func (s *fakeTaskStore) Delete(_ context.Context, name string) error {
	s.deletes++
	delete(s.tasks, name)
	return nil
}
func TestTaskLifecycleIdentityAndNoSecrets(t *testing.T) {
	store := &fakeTaskStore{tasks: map[string]string{}}
	id := strings.Repeat("a", 32)
	scheduler := TaskScheduler{Executable: filepath.Join(t.TempDir(), "Inkism & 한글.exe"), SID: "S-1-5-21-123", Store: store}
	ctx := context.Background()
	if err := scheduler.Enable(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := scheduler.Enable(ctx, id); err != nil {
		t.Fatal(err)
	}
	if store.creates != 1 {
		t.Fatal("repeated registration")
	}
	raw := store.tasks[TaskPrefix+id]
	for _, field := range []string{"--db", "--engine", "Password", "HighestAvailable"} {
		if strings.Contains(raw, field) {
			t.Fatal("task carries forbidden setting", field)
		}
	}
	if !strings.Contains(raw, "&amp;") || !strings.Contains(raw, "PT1M") {
		t.Fatal(raw)
	}
	if err := scheduler.Disable(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := scheduler.Disable(ctx, id); err != nil || store.deletes != 1 {
		t.Fatal(err, store.deletes)
	}
}
func TestForeignTaskNeverReplacedOrDeleted(t *testing.T) {
	id := strings.Repeat("b", 32)
	exe := filepath.Join(t.TempDir(), "Inkism.exe")
	raw, _ := TaskXML(id, exe, "S-1-5-21-999", time.Now())
	store := &fakeTaskStore{tasks: map[string]string{TaskPrefix + id: raw}}
	scheduler := TaskScheduler{Executable: exe, SID: "S-1-5-21-123", Store: store}
	if scheduler.Enable(context.Background(), id) == nil || scheduler.Disable(context.Background(), id) == nil {
		t.Fatal("foreign task accepted")
	}
	if store.creates != 0 || store.deletes != 0 {
		t.Fatal("foreign task changed")
	}
	if _, err := TaskXML("../../other", exe, scheduler.SID, time.Now()); err == nil {
		t.Fatal("invalid ID accepted")
	}
}
func TestUninstallOnlyOwnedReceipts(t *testing.T) {
	root := t.TempDir()
	id := strings.Repeat("c", 32)
	exe := filepath.Join(root, "Inkism.exe")
	raw, _ := TaskXML(id, exe, "S-1-5-21-123", time.Now())
	store := &fakeTaskStore{tasks: map[string]string{TaskPrefix + id: raw, "Unrelated": "untouched"}}
	scheduler := TaskScheduler{Executable: exe, SID: "S-1-5-21-123", Store: store}
	_ = writePrivateJSON(filepath.Join(root, id+".task"), taskReceipt{Owner: scheduler.OwnershipID()})
	_ = os.WriteFile(filepath.Join(root, "not-a-cache.task"), nil, 0600)
	otherID := strings.Repeat("d", 32)
	otherRaw, _ := TaskXML(otherID, filepath.Join(root, "other-install", "Inkism.exe"), scheduler.SID, time.Now())
	store.tasks[TaskPrefix+otherID] = otherRaw
	_ = writePrivateJSON(filepath.Join(root, otherID+".task"), taskReceipt{Owner: strings.Repeat("e", 64)})
	_ = os.WriteFile(filepath.Join(root, otherID+".json"), []byte("preserve-other-cache"), 0600)
	if err := RemoveOwnedTasks(context.Background(), root, scheduler); err != nil {
		t.Fatal(err)
	}
	if content, err := os.ReadFile(filepath.Join(root, otherID+".json")); err != nil || string(content) != "preserve-other-cache" {
		t.Fatal("other installation cache changed")
	}
	if store.deletes != 1 || store.tasks["Unrelated"] != "untouched" {
		t.Fatal("unrelated task changed")
	}
}
