package googlehost

import (
	"context"
	"errors"
	"github.com/FelixBaek/inkism/desktop/internal/bridge"
	"sync"
)

var ErrUnavailable = errors.New("Google 로그인 설정이 필요합니다")
var ErrBusy = errors.New("Google 로그인이 이미 진행 중입니다")
var ErrCancelled = errors.New("Google 로그인을 취소했습니다")
var ErrAccount = errors.New("연결한 Google 계정으로 로그인해 주세요")
var ErrPolicy = errors.New("Google 계정 보호 설정을 읽지 못했습니다. 기존 설정을 복구해 주세요")

type Identity struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
}
type Provider interface {
	Login(context.Context) (Identity, string, error)
	Cancel()
}
type Store interface {
	Load() (Identity, bool, error)
	Save(Identity) error
}

// remover deletes the binding. Only Disable calls it, after a fresh login
// proved the same account; stores without it cannot turn the lock off.
type remover interface {
	Remove() error
}

// Controller never accepts account claims from the renderer. Provider supplies
// verified Google claims. Ephemeral tokens are consumed only by the host
// recovery callback and never enter a policy file or renderer response.
type Controller struct {
	mu            sync.Mutex
	provider      Provider
	store         Store
	binding       Identity
	configured    bool
	policyErr     error
	pending       bool
	cancel        context.CancelFunc
	generation    uint64
	gate          *bridge.SessionGate
	recovery      func(context.Context, string) (string, error)
	recoveryError string
}

func New(provider Provider, store Store) *Controller {
	c := &Controller{provider: provider, store: store}
	if store != nil {
		c.binding, c.configured, c.policyErr = store.Load()
		if c.policyErr != nil {
			c.configured = true
		}
	}
	return c
}

// SetRecovery is called by the trusted host before serving UI requests.
func (c *Controller) SetRecovery(recovery func(context.Context, string) (string, error)) {
	c.recovery = recovery
}
func (c *Controller) InitiallyLocked() bool     { c.mu.Lock(); defer c.mu.Unlock(); return c.configured }
func (c *Controller) Gate() *bridge.SessionGate { c.mu.Lock(); defer c.mu.Unlock(); return c.gate }
func (c *Controller) Attach(stop func() error, resume func(context.Context) error) *bridge.SessionGate {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gate = bridge.NewSessionGate(c.configured, stop, resume)
	return c.gate
}
func (c *Controller) Status() bridge.SecurityStatus {
	c.mu.Lock()
	status := bridge.SecurityStatus{Available: c.provider != nil && c.store != nil && c.policyErr == nil,
		Configured: c.configured, Locked: c.configured, Provider: "google", Pending: c.pending, RecoveryError: c.recoveryError}
	gate := c.gate
	c.mu.Unlock()
	status.SetupRequired = !status.Available
	if gate != nil {
		status.Locked = gate.Status().Locked
	}
	return status
}

func (c *Controller) Cancel() {
	c.mu.Lock()
	c.generation++
	if c.cancel != nil {
		c.cancel()
	}
	c.mu.Unlock()
}

// A locked UI has no mounted editor to acknowledge native-close-request.
// Cancel any pending authentication before allowing native shutdown directly.
// Unlocked sessions still need the ordinary editor/workspace flush handshake.
func (c *Controller) CancelForLockedClose() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.gate == nil || !c.gate.Status().Locked {
		return false
	}
	c.generation++
	if c.cancel != nil {
		c.cancel()
	}
	return true
}
func (c *Controller) Lock() error {
	c.Cancel()
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.configured || c.gate == nil {
		return ErrUnavailable
	}
	if err := c.gate.Lock(); err != nil {
		return errors.New("앱을 안전하게 잠그지 못했습니다. 잠금 상태를 유지합니다")
	}
	return nil
}

// bindAccount checks identity against the existing binding, or persists it
// on first opt-in. The caller holds c.mu.
func (c *Controller) bindAccount(ctx context.Context, generation uint64, identity Identity) error {
	if identity.Issuer != "https://accounts.google.com" || identity.Subject == "" || len(identity.Subject) > 255 {
		return ErrAccount
	}
	if c.configured {
		if identity != c.binding {
			return ErrAccount
		}
		return nil
	}
	// Close data paths before persisting opt-in. A failed write cannot expose a
	// newly protected session; retry is explicit and never replaces a binding.
	if err := c.gate.Lock(); err != nil {
		return errors.New("저장 엔진을 안전하게 잠그지 못했습니다")
	}
	// Lock can wait for an accepted upload/save. Honour cancellation that
	// arrived during that wait before creating a persistent account binding.
	if ctx.Err() != nil || generation != c.generation {
		return ErrCancelled
	}
	if err := c.store.Save(identity); err != nil {
		// A partial/existing file is a protected but unreadable policy, not
		// permission to bind another account. No-file failures remain retryable.
		_, exists, loadErr := c.store.Load()
		if exists || loadErr != nil {
			c.configured = true
			c.policyErr = ErrPolicy
		}
		return errors.New("Google 계정 보호 설정을 저장하지 못했습니다")
	}
	c.binding = identity
	c.configured = true
	return nil
}

// acceptIdentity binds identity under c.mu unless this login was superseded,
// returning the gate and recovery hook to use after the lock is released.
func (c *Controller) acceptIdentity(ctx context.Context, generation uint64, identity Identity) (*bridge.SessionGate, func(context.Context, string) (string, error), error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ctx.Err() != nil || generation != c.generation {
		return nil, nil, ErrCancelled
	}
	if err := c.bindAccount(ctx, generation, identity); err != nil {
		return nil, nil, err
	}
	return c.gate, c.recovery, nil
}

// Disable turns the lock off. There is no path without a fresh Google login:
// the re-authenticated issuer and subject must match the binding and the app
// must already be unlocked. Any failure keeps the lock configured.
func (c *Controller) Disable(ctx context.Context) error {
	c.mu.Lock()
	if c.pending {
		c.mu.Unlock()
		return ErrBusy
	}
	if c.policyErr != nil {
		c.mu.Unlock()
		return ErrPolicy
	}
	if !c.configured || c.gate == nil || c.gate.Status().Locked || c.provider == nil || c.store == nil {
		c.mu.Unlock()
		return ErrUnavailable
	}
	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.pending = true
	c.generation++
	generation := c.generation
	p := c.provider
	c.mu.Unlock()
	defer func() { cancel(); c.mu.Lock(); c.pending = false; c.cancel = nil; c.mu.Unlock() }()
	identity, _, err := p.Login(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return ErrCancelled
		}
		return errors.New("Google 인증을 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if ctx.Err() != nil || generation != c.generation {
		return ErrCancelled
	}
	if identity.Issuer != "https://accounts.google.com" || identity.Subject == "" || !c.configured || identity != c.binding {
		return ErrAccount
	}
	if c.gate.Status().Locked {
		return ErrUnavailable
	}
	r, ok := c.store.(remover)
	if !ok {
		return ErrUnavailable
	}
	if err := r.Remove(); err != nil {
		return errors.New("Google 계정 보호 설정을 지우지 못했습니다. 잠금은 그대로 유지됩니다")
	}
	c.binding = Identity{}
	c.configured = false
	c.recoveryError = ""
	return nil
}

func (c *Controller) Login(ctx context.Context) error {
	c.mu.Lock()
	if c.pending {
		c.mu.Unlock()
		return ErrBusy
	}
	if c.policyErr != nil {
		c.mu.Unlock()
		return ErrPolicy
	}
	if c.provider == nil || c.store == nil || c.gate == nil {
		c.mu.Unlock()
		return ErrUnavailable
	}
	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.pending = true
	c.generation++
	generation := c.generation
	p := c.provider
	c.mu.Unlock()
	defer func() { cancel(); c.mu.Lock(); c.pending = false; c.cancel = nil; c.mu.Unlock() }()
	identity, token, err := p.Login(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return ErrCancelled
		}
		return errors.New("Google 인증을 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요")
	}
	gate, recovery, err := c.acceptIdentity(ctx, generation, identity)
	if err != nil {
		return err
	}
	var warning string
	prepare := func(ctx context.Context) error {
		if recovery == nil {
			return nil
		}
		var err error
		warning, err = recovery(ctx, token)
		return err
	}
	if err := gate.UnlockWithSetup(ctx, func(context.Context) error { return nil }, prepare); err != nil {
		if ctx.Err() != nil {
			return ErrCancelled
		}
		return errors.New("저장소 또는 서버 복구 연결을 열지 못했습니다. 기존 자료는 보존되며 잠금은 유지됩니다")
	}
	c.mu.Lock()
	c.recoveryError = warning
	c.mu.Unlock()
	return nil
}
