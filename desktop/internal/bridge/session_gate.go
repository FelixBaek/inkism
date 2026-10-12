package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
)

// SessionGate coordinates every HTTP data path, including the separate upload
// server. Authentication policy is injected by the host, never by the renderer.
type SessionGate struct {
	mu     sync.RWMutex
	locked atomic.Bool
	stop   func() error
	resume func(context.Context) error
}

type SecurityStatus struct {
	Available     bool   `json:"available"`
	Configured    bool   `json:"configured"`
	Locked        bool   `json:"locked"`
	Provider      string `json:"provider,omitempty"`
	SetupRequired bool   `json:"setup_required,omitempty"`
	Pending       bool   `json:"pending,omitempty"`
	RecoveryError string `json:"recovery_error,omitempty"`
}

// A configured host must construct its engine suspended when initiallyLocked.
// No credential, policy file or existing library is changed by this constructor.
func NewSessionGate(initiallyLocked bool, stop func() error, resume func(context.Context) error) *SessionGate {
	g := &SessionGate{stop: stop, resume: resume}
	g.locked.Store(initiallyLocked)
	return g
}

func (g *SessionGate) Status() SecurityStatus {
	if g == nil {
		return SecurityStatus{}
	}
	return SecurityStatus{Available: true, Configured: true, Locked: g.locked.Load()}
}

func (g *SessionGate) enter() (func(), bool) {
	if g == nil {
		return func() {
			// Nothing to release: a nil gate holds no lock.
		}, true
	}
	g.mu.RLock()
	if g.locked.Load() {
		g.mu.RUnlock()
		return nil, false
	}
	return g.mu.RUnlock, true
}

// Lock waits for accepted saves/transfers, then closes the runtime. A failed
// shutdown remains locked; no later HTTP request may expose private content.
func (g *SessionGate) Lock() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.locked.Load() {
		return nil
	}
	g.locked.Store(true)
	if g.stop == nil {
		return errors.New("security shutdown is unavailable")
	}
	return g.stop()
}

// Unlock is callable only by a host authentication adapter. Failed/cancelled
// authentication or runtime startup leaves every data endpoint blocked.
func (g *SessionGate) Unlock(ctx context.Context, authenticate func(context.Context) error) error {
	return g.UnlockWithSetup(ctx, authenticate, nil)
}

// UnlockWithSetup keeps renderer data paths closed until trusted host setup
// finishes. Failed/cancelled recovery closes the resumed engine and stays locked.
func (g *SessionGate) UnlockWithSetup(ctx context.Context, authenticate, prepare func(context.Context) error) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.locked.Load() {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if authenticate == nil {
		return errors.New("authentication is unavailable")
	}
	if err := authenticate(ctx); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if g.resume == nil {
		return errors.New("security resume is unavailable")
	}
	if err := g.resume(ctx); err != nil {
		return err
	}
	var setupErr error
	if prepare != nil {
		setupErr = prepare(ctx)
	}
	if setupErr == nil {
		setupErr = ctx.Err()
	}
	if setupErr != nil {
		if g.stop != nil {
			_ = g.stop()
		}
		return setupErr
	}
	g.locked.Store(false)
	return nil
}

// StartSuspended does not launch Rust or touch a library before authentication.
func StartSuspended(binary, database string) *Engine {
	return &Engine{binary: binary, database: database, stopped: true, waited: true}
}

func StartSuspendedEncrypted(binary, database string) *Engine {
	e := StartSuspended(binary, database)
	e.initializeOnResume = true
	return e
}

func (e *Engine) Resume(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if !e.stopped {
		return nil
	}
	if !e.waited {
		return errors.New("engine shutdown has not completed")
	}
	resumed, err := start(e.binary, e.database, e.initializeOnResume)
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		_ = resumed.Close()
		return err
	}
	e.cmd, e.input, e.output = resumed.cmd, resumed.input, resumed.output
	e.stopped, e.waited = false, false
	e.initializeOnResume = false
	return nil
}

// Guard gives background pollers the same atomic admission check as HTTP.
// Checking Status().Locked before Call is insufficient because lock can race.
func (g *SessionGate) Guard(caller Caller) Caller {
	return sessionCaller{gate: g, next: caller}
}

type sessionCaller struct {
	gate *SessionGate
	next Caller
}

func (c sessionCaller) Call(ctx context.Context, request json.RawMessage) (json.RawMessage, error) {
	release, accepted := c.gate.enter()
	if !accepted {
		return nil, errors.New("app is locked")
	}
	defer release()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c.next == nil {
		return nil, errors.New("engine is unavailable")
	}
	return c.next.Call(ctx, request)
}
