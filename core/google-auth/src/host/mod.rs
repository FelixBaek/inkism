//! App-lock controller. It never accepts account claims from the renderer:
//! the [`Provider`] supplies verified Google claims. Ephemeral tokens are
//! consumed only by the host recovery hook and never enter a policy file or
//! renderer response.

use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::{auth, BoxError, Context};

mod recovery;
mod store;

pub use recovery::{read_server_recovery, ServerRecovery};
#[cfg(windows)]
pub use store::windows_store;
pub use store::{read_config, ClientConfig, FileStore, ProtectFn};

#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("Google 로그인 설정이 필요합니다")]
    Unavailable,
    #[error("Google 로그인이 이미 진행 중입니다")]
    Busy,
    #[error("Google 로그인을 취소했습니다")]
    Cancelled,
    #[error("연결한 Google 계정으로 로그인해 주세요")]
    Account,
    #[error("Google 계정 보호 설정을 읽지 못했습니다. 기존 설정을 복구해 주세요")]
    Policy,
    /// A fixed, user-facing message that carries no provider or secret data.
    #[error("{0}")]
    Failed(&'static str),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    pub issuer: String,
    pub subject: String,
}

impl Identity {
    fn valid(&self) -> bool {
        self.issuer == "https://accounts.google.com"
            && !self.subject.is_empty()
            && self.subject.len() <= 255
    }
}

/// Masks a verified address for display: first character of the local part,
/// `***`, then the domain (`f***@example.com`). The full address is never kept.
/// Returns "" for anything that does not look like a single address.
pub fn mask_email(email: &str) -> String {
    let email = email.trim();
    let Some((local, domain)) = email.split_once('@') else {
        return String::new();
    };
    let Some(first) = local.chars().next() else {
        return String::new();
    };
    let hint = format!("{first}***@{}", domain.to_ascii_lowercase());
    if valid_hint(&hint) {
        hint
    } else {
        String::new()
    }
}

/// Only the masked form is accepted anywhere a hint is stored or shown.
pub fn valid_hint(hint: &str) -> bool {
    let Some((local, domain)) = hint.split_once('@') else {
        return false;
    };
    let mut chars = local.chars();
    let first = chars.next();
    hint.len() <= 254
        && first.is_some_and(|c| !c.is_whitespace() && !c.is_control() && c != '*')
        && chars.as_str() == "***"
        && !domain.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && domain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// Supplies verified Google claims plus the ephemeral ID token.
pub trait Provider: Send + Sync {
    fn login(&self, ctx: &Context) -> Result<(Identity, String), BoxError>;
    /// Like `login`, plus a masked address for display ("" when unknown).
    fn login_with_hint(&self, ctx: &Context) -> Result<(Identity, String, String), BoxError> {
        let (identity, token) = self.login(ctx)?;
        Ok((identity, token, String::new()))
    }
    fn cancel(&self);
}

impl Provider for auth::Client {
    fn login(&self, ctx: &Context) -> Result<(Identity, String), BoxError> {
        let (identity, token, _) = self.login_with_hint(ctx)?;
        Ok((identity, token))
    }
    fn login_with_hint(&self, ctx: &Context) -> Result<(Identity, String, String), BoxError> {
        let (identity, token) = self.login_with_id_token(ctx)?;
        // Only the masked form leaves this function; the claim is dropped here.
        let hint = if identity.email_verified { mask_email(&identity.email) } else { String::new() };
        Ok((
            Identity {
                issuer: identity.issuer,
                subject: identity.subject,
            },
            token,
            hint,
        ))
    }
    fn cancel(&self) {
        auth::Client::cancel(self);
    }
}

/// Persistent account binding. `Ok(None)` means no opt-in exists; any error
/// means a binding exists but cannot be trusted.
pub trait Store: Send + Sync {
    fn load(&self) -> Result<Option<Identity>, HostError>;
    fn save(&self, identity: &Identity) -> Result<(), HostError>;
    /// Masked address saved beside the binding; "" when absent or unreadable.
    fn load_hint(&self) -> String {
        String::new()
    }
    /// Best effort: the hint is display-only and never part of the policy.
    fn save_hint(&self, _hint: &str) -> Result<(), HostError> {
        Ok(())
    }
    /// Deletes the binding (and hint). Only `Controller::disable` calls it,
    /// after re-authenticating the bound account.
    fn remove(&self) -> Result<(), HostError> {
        Err(HostError::Unavailable)
    }
}

/// The part of the host bridge's session gate the controller drives. The
/// gate closes every renderer data path while locked.
pub trait SessionGate: Send + Sync {
    /// Current lock state. Must not wait on the gate's own lock: it is read
    /// while `unlock_with_setup` (and its `prepare`) is running.
    fn is_locked(&self) -> bool;
    /// Waits for accepted work, then stops the engine. Stays locked on failure.
    fn lock(&self) -> Result<(), BoxError>;
    /// Resumes the engine, then runs `prepare` while data paths stay closed.
    /// If `prepare` fails or `ctx` is done, stops the engine and stays locked.
    fn unlock_with_setup(
        &self,
        ctx: &Context,
        prepare: &mut dyn FnMut(&Context) -> Result<(), BoxError>,
    ) -> Result<(), BoxError>;
}

/// The engine RPC used by server recovery (JSON request in, JSON response out).
pub trait Caller {
    fn call(&self, ctx: &Context, request: &[u8]) -> Result<Vec<u8>, BoxError>;
}

/// Mirrors the bridge's security status JSON.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct SecurityStatus {
    pub available: bool,
    pub configured: bool,
    pub locked: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub provider: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub setup_required: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pending: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub recovery_error: String,
    /// Masked bound account (`f***@example.com`); never the full address.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub account_hint: String,
}

/// Host recovery hook: receives the ephemeral ID token, returns a warning.
pub type RecoveryFn = Arc<dyn Fn(&Context, &str) -> Result<String, HostError> + Send + Sync>;

pub struct Controller {
    provider: Option<Arc<dyn Provider>>,
    store: Option<Arc<dyn Store>>,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    binding: Identity,
    configured: bool,
    policy_failed: bool,
    pending: bool,
    cancel: Option<Context>,
    generation: u64,
    gate: Option<Arc<dyn SessionGate>>,
    recovery: Option<RecoveryFn>,
    recovery_error: String,
    email_hint: String,
}

impl Controller {
    pub fn new(provider: Option<Arc<dyn Provider>>, store: Option<Arc<dyn Store>>) -> Self {
        let mut state = State::default();
        if let Some(store) = &store {
            match store.load() {
                Ok(Some(binding)) => {
                    (state.binding, state.configured) = (binding, true);
                    state.email_hint = Some(store.load_hint()).filter(|h| valid_hint(h)).unwrap_or_default();
                }
                Ok(None) => {}
                Err(_) => (state.configured, state.policy_failed) = (true, true),
            }
        }
        Self {
            provider,
            store,
            state: Mutex::new(state),
        }
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Called by the trusted host before serving UI requests.
    pub fn set_recovery(&self, recovery: RecoveryFn) {
        self.lock_state().recovery = Some(recovery);
    }

    pub fn initially_locked(&self) -> bool {
        self.lock_state().configured
    }

    pub fn gate(&self) -> Option<Arc<dyn SessionGate>> {
        self.lock_state().gate.clone()
    }

    /// Builds the session gate. `make` receives the initial lock state; a
    /// configured host must construct its engine suspended when it is true.
    pub fn attach(&self, make: impl FnOnce(bool) -> Arc<dyn SessionGate>) -> Arc<dyn SessionGate> {
        let mut s = self.lock_state();
        let gate = make(s.configured);
        s.gate = Some(gate.clone());
        gate
    }

    pub fn status(&self) -> SecurityStatus {
        let s = self.lock_state();
        let available = self.provider.is_some() && self.store.is_some() && !s.policy_failed;
        let mut status = SecurityStatus {
            available,
            configured: s.configured,
            locked: s.configured,
            provider: "google".into(),
            setup_required: !available,
            pending: s.pending,
            recovery_error: s.recovery_error.clone(),
            account_hint: if s.configured { s.email_hint.clone() } else { String::new() },
        };
        let gate = s.gate.clone();
        drop(s);
        if let Some(gate) = gate {
            status.locked = gate.is_locked();
        }
        status
    }

    pub fn cancel(&self) {
        Self::cancel_locked(&mut self.lock_state());
    }

    fn cancel_locked(s: &mut State) {
        s.generation += 1;
        if let Some(ctx) = &s.cancel {
            ctx.cancel();
        }
    }

    /// A locked UI has no mounted editor to acknowledge a native close
    /// request: cancel pending authentication and allow shutdown directly.
    /// Unlocked sessions still need the ordinary editor flush handshake.
    pub fn cancel_for_locked_close(&self) -> bool {
        let mut s = self.lock_state();
        if !s.gate.as_ref().is_some_and(|g| g.is_locked()) {
            return false;
        }
        Self::cancel_locked(&mut s);
        true
    }

    pub fn lock(&self) -> Result<(), HostError> {
        self.cancel();
        let s = self.lock_state();
        let gate = match &s.gate {
            Some(gate) if s.configured => gate,
            _ => return Err(HostError::Unavailable),
        };
        gate.lock().map_err(|_| {
            HostError::Failed("앱을 안전하게 잠그지 못했습니다. 잠금 상태를 유지합니다")
        })
    }

    /// Checks `identity` against the existing binding, or persists it on
    /// first opt-in.
    fn bind_account(
        &self,
        s: &mut State,
        ctx: &Context,
        generation: u64,
        identity: Identity,
        hint: &str,
    ) -> Result<(), HostError> {
        if !identity.valid() {
            return Err(HostError::Account);
        }
        if s.configured {
            return if identity == s.binding {
                Ok(())
            } else {
                Err(HostError::Account)
            };
        }
        let (Some(gate), Some(store)) = (&s.gate, &self.store) else {
            return Err(HostError::Unavailable);
        };
        // Close data paths before persisting opt-in. A failed write cannot
        // expose a newly protected session; retry never replaces a binding.
        if gate.lock().is_err() {
            return Err(HostError::Failed("저장 엔진을 안전하게 잠그지 못했습니다"));
        }
        // Lock can wait for an accepted save. Honour cancellation that arrived
        // meanwhile before creating a persistent account binding.
        if ctx.is_done() || generation != s.generation {
            return Err(HostError::Cancelled);
        }
        if store.save(&identity).is_err() {
            // A partial/existing file is a protected but unreadable policy, not
            // permission to bind another account. No-file failures stay retryable.
            if !matches!(store.load(), Ok(None)) {
                s.configured = true;
                s.policy_failed = true;
            }
            return Err(HostError::Failed(
                "Google 계정 보호 설정을 저장하지 못했습니다",
            ));
        }
        s.binding = identity;
        s.configured = true;
        if valid_hint(hint) && store.save_hint(hint).is_ok() {
            s.email_hint = hint.to_owned();
        }
        Ok(())
    }

    /// Binds `identity` unless this login was superseded and returns the gate
    /// and recovery hook to use after the state lock is released.
    fn accept_identity(
        &self,
        ctx: &Context,
        generation: u64,
        identity: Identity,
        hint: &str,
    ) -> Result<(Arc<dyn SessionGate>, Option<RecoveryFn>), HostError> {
        let mut s = self.lock_state();
        if ctx.is_done() || generation != s.generation {
            return Err(HostError::Cancelled);
        }
        self.bind_account(&mut s, ctx, generation, identity, hint)?;
        let gate = s.gate.clone().ok_or(HostError::Unavailable)?;
        Ok((gate, s.recovery.clone()))
    }

    /// Turns the lock off. There is no path without a fresh Google login: the
    /// re-authenticated issuer and subject must match the stored binding, and
    /// the app must already be unlocked. Any failure keeps the lock configured.
    pub fn disable(&self, parent: &Context) -> Result<(), HostError> {
        let (ctx, generation, provider) = {
            let mut s = self.lock_state();
            if s.pending {
                return Err(HostError::Busy);
            }
            if s.policy_failed {
                return Err(HostError::Policy);
            }
            if !s.configured || !s.gate.as_ref().is_some_and(|g| !g.is_locked()) {
                return Err(HostError::Unavailable);
            }
            let provider = match (&self.provider, &self.store) {
                (Some(p), Some(_)) => p.clone(),
                _ => return Err(HostError::Unavailable),
            };
            let ctx = parent.child();
            s.cancel = Some(ctx.clone());
            s.pending = true;
            s.generation += 1;
            (ctx, s.generation, provider)
        };
        let result = self.run_disable(&ctx, generation, provider.as_ref());
        ctx.cancel();
        let mut s = self.lock_state();
        s.pending = false;
        s.cancel = None;
        result
    }

    fn run_disable(&self, ctx: &Context, generation: u64, provider: &dyn Provider) -> Result<(), HostError> {
        let identity = match provider.login_with_hint(ctx) {
            Ok((identity, token, _)) => {
                drop(zeroize::Zeroizing::new(token));
                identity
            }
            Err(_) if ctx.is_done() => return Err(HostError::Cancelled),
            Err(_) => {
                return Err(HostError::Failed(
                    "Google 인증을 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요",
                ))
            }
        };
        let mut s = self.lock_state();
        if ctx.is_done() || generation != s.generation {
            return Err(HostError::Cancelled);
        }
        if !identity.valid() || !s.configured || identity != s.binding {
            return Err(HostError::Account);
        }
        if !s.gate.as_ref().is_some_and(|g| !g.is_locked()) {
            return Err(HostError::Unavailable);
        }
        let store = self.store.as_ref().ok_or(HostError::Unavailable)?;
        if store.remove().is_err() {
            // Whatever is left on disk still protects the app on next start.
            return Err(HostError::Failed("Google 계정 보호 설정을 지우지 못했습니다. 잠금은 그대로 유지됩니다"));
        }
        s.binding = Identity::default();
        s.configured = false;
        s.email_hint.clear();
        s.recovery_error.clear();
        Ok(())
    }

    pub fn login(&self, parent: &Context) -> Result<(), HostError> {
        let (ctx, generation, provider) = {
            let mut s = self.lock_state();
            if s.pending {
                return Err(HostError::Busy);
            }
            if s.policy_failed {
                return Err(HostError::Policy);
            }
            let provider = match (&self.provider, &self.store, &s.gate) {
                (Some(p), Some(_), Some(_)) => p.clone(),
                _ => return Err(HostError::Unavailable),
            };
            let ctx = parent.child();
            s.cancel = Some(ctx.clone());
            s.pending = true;
            s.generation += 1;
            (ctx, s.generation, provider)
        };
        let result = self.run_login(&ctx, generation, provider.as_ref());
        ctx.cancel();
        let mut s = self.lock_state();
        s.pending = false;
        s.cancel = None;
        result
    }

    fn run_login(
        &self,
        ctx: &Context,
        generation: u64,
        provider: &dyn Provider,
    ) -> Result<(), HostError> {
        let (identity, token, hint) = match provider.login_with_hint(ctx) {
            Ok(v) => v,
            Err(_) if ctx.is_done() => return Err(HostError::Cancelled),
            Err(_) => {
                return Err(HostError::Failed(
                    "Google 인증을 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요",
                ))
            }
        };
        let token = zeroize::Zeroizing::new(token);
        let (gate, recovery) = self.accept_identity(ctx, generation, identity, &hint)?;
        let mut warning = String::new();
        let mut prepare = |ctx: &Context| -> Result<(), BoxError> {
            if let Some(recovery) = &recovery {
                warning = recovery(ctx, &token)?;
            }
            Ok(())
        };
        if gate.unlock_with_setup(ctx, &mut prepare).is_err() {
            if ctx.is_done() {
                return Err(HostError::Cancelled);
            }
            return Err(HostError::Failed(
                "저장소 또는 서버 복구 연결을 열지 못했습니다. 기존 자료는 보존되며 잠금은 유지됩니다",
            ));
        }
        self.lock_state().recovery_error = warning;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
