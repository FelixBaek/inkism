package reminders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fake struct {
	raw   string
	calls int
}

func (f *fake) Call(context.Context, json.RawMessage) (json.RawMessage, error) {
	f.calls++
	return json.RawMessage(f.raw), nil
}
func TestOptInRetryRestartAndChangedOccurrence(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.json")
	f := &fake{raw: `{"ok":true,"data":[{"id":"secret-note","reminder_at":100}]}`}
	sent := 0
	fail := true
	send := func() error {
		if fail {
			return errors.New("offline")
		}
		sent++
		return nil
	}
	s, err := New(p, f, send)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Poll(context.Background(), time.Now()); err != nil || f.calls != 0 {
		t.Fatal("disabled poll")
	}
	if err = s.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if s.Poll(context.Background(), time.Now()) == nil {
		t.Fatal("missing failure")
	}
	fail = false
	for i := 0; i < 3; i++ {
		if err = s.Poll(context.Background(), time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if sent != 1 {
		t.Fatal(sent)
	}
	s, err = New(p, f, send)
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Poll(context.Background(), time.Now())
	if sent != 1 {
		t.Fatal("restart duplicate")
	}
	raw, _ := os.ReadFile(p)
	if strings.Contains(string(raw), "secret-note") {
		t.Fatal("metadata leaked")
	}
	f.raw = `{"ok":true,"data":[{"id":"secret-note","reminder_at":200}]}`
	_ = s.Poll(context.Background(), time.Now())
	if sent != 2 {
		t.Fatal("reschedule suppressed")
	}
	if err = s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	_ = s.Poll(context.Background(), time.Now())
	if sent != 2 {
		t.Fatal("disabled delivery")
	}
}
func TestCorruptStateFailsClosed(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.json")
	_ = os.WriteFile(p, []byte("bad"), 0600)
	if _, err := New(p, &fake{}, func() error { return nil }); err == nil {
		t.Fatal("corruption ignored")
	}
}
func TestRepeatSleepAndCancellation(t *testing.T) {
	f := &fake{raw: `{"ok":true,"data":[{"id":"n","reminder_at":1000,"reminder_repeat_hours":24}]}`}
	count := 0
	s, _ := New(filepath.Join(t.TempDir(), "state"), f, func() error { count++; return nil })
	_ = s.SetEnabled(true)
	for _, hour := range []int64{0, 0, 1, 24, 24, 24 * 30, 24 * 30} {
		if err := s.Poll(context.Background(), time.UnixMilli(1000+hour*3600000)); err != nil {
			t.Fatal(err)
		}
	}
	if count != 3 {
		t.Fatal(count)
	}
	f.raw = `{"ok":true,"data":[]}`
	_ = s.Poll(context.Background(), time.UnixMilli(1000+31*24*3600000))
	if count != 3 {
		t.Fatal("cancelled reminder delivered")
	}

}

type pageCaller struct{ calls int }

func (f *pageCaller) Call(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var req map[string]any
	_ = json.Unmarshal(raw, &req)
	f.calls++
	data := []map[string]any{}
	if _, has := req["after_id"]; !has {
		for i := 0; i < 100; i++ {
			data = append(data, map[string]any{"id": fmt.Sprintf("n-%03d", i), "reminder_at": 1000})
		}
	} else {
		if req["after_id"] != "n-099" {
			return nil, errors.New("wrong cursor")
		}
		data = append(data, map[string]any{"id": "n-100", "reminder_at": 1000})
	}
	return json.Marshal(map[string]any{"ok": true, "data": data})
}
func TestPagedDueListCoalescesAndCancellation(t *testing.T) {
	f := &pageCaller{}
	sent := 0
	s, _ := New(filepath.Join(t.TempDir(), "state"), f, func() error { sent++; return nil })
	_ = s.SetEnabled(true)
	if err := s.Poll(context.Background(), time.UnixMilli(2000)); err != nil {
		t.Fatal(err)
	}
	if sent != 1 || f.calls != 2 || len(s.state.Delivered) != 101 {
		t.Fatal(sent, f.calls, len(s.state.Delivered))
	}
	if err := s.Poll(context.Background(), time.UnixMilli(2000)); err != nil {
		t.Fatal(err)
	}
	if sent != 1 {
		t.Fatal("duplicate")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := f.calls
	if !errors.Is(s.Poll(ctx, time.Now()), context.Canceled) || f.calls != calls {
		t.Fatal("cancelled poll read engine")
	}
}
