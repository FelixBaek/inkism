package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
)

// Synthetic callbacks only: identity proof cannot supply a missing library key.
func TestVerifiedIdentityCannotBypassUnavailableLibraryKey(t *testing.T) {
	missingKey := errors.New("synthetic library key unavailable")
	var attempts atomic.Int32
	gate := NewSessionGate(true, nil, func(context.Context) error {
		attempts.Add(1)
		return missingKey
	})
	engine := &fakeEngine{}
	for i := 0; i < 2; i++ {
		err := gate.Unlock(context.Background(), func(context.Context) error { return nil })
		if !errors.Is(err, missingKey) || !gate.Status().Locked {
			t.Fatal("identity success bypassed missing-key startup failure")
		}
		if _, err := gate.Guard(engine).Call(context.Background(), json.RawMessage("{\"op\":\"get\"}")); err == nil {
			t.Fatal("failed key access exposed RPC")
		}
	}
	if attempts.Load() != 2 || len(engine.last) != 0 {
		t.Fatal("retry failed or reached protected runtime")
	}
}

// A browser response arriving after cancellation must not resume Rust.
func TestIdentityCallbackCancelledAfterVerificationCannotResume(t *testing.T) {
	var resumed atomic.Int32
	gate := NewSessionGate(true, nil, func(context.Context) error {
		resumed.Add(1)
		return nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	err := gate.Unlock(ctx, func(context.Context) error {
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) || resumed.Load() != 0 || !gate.Status().Locked {
		t.Fatal("late identity success ignored cancellation")
	}
	if err := gate.Unlock(context.Background(), func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := gate.Unlock(context.Background(), func(context.Context) error {
		t.Fatal("duplicate completion reauthenticated an active session")
		return nil
	}); err != nil || resumed.Load() != 1 {
		t.Fatal("duplicate callback resumed runtime twice")
	}
}
