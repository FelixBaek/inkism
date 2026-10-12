//! Session gate (Go `session_gate.go`): every data path enters it; lock waits
//! for in-flight requests, then stops the engine. Authentication policy is
//! injected by the host, never by the renderer.

use crate::engine::Engine;
use crate::{Deadline, Result, REQUEST_TIMEOUT};
use google_auth::{BoxError, Context};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock, RwLockReadGuard};
use std::time::Instant;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
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
}

pub type StopFn = Box<dyn Fn() -> Result<()> + Send + Sync>;
pub type ResumeFn = Box<dyn Fn(&Context) -> Result<()> + Send + Sync>;
/// Trusted host setup run after resume, before data paths open.
pub type SetupFn<'a> = &'a mut dyn FnMut(&Context) -> Result<()>;

pub struct SessionGate {
    mu: RwLock<()>,
    locked: AtomicBool,
    stop: Option<StopFn>,
    resume: Option<ResumeFn>,
}

/// Held while a request runs; dropping it releases the read side.
pub struct Admission<'a>(#[allow(dead_code)] Option<RwLockReadGuard<'a, ()>>);

/// `None` gate admits everything. `None` result = locked.
pub(crate) fn enter(gate: Option<&SessionGate>) -> Option<Admission<'_>> {
    match gate {
        None => Some(Admission(None)),
        Some(g) => g.enter(),
    }
}

const CANCELLED: &str = "context canceled";

impl SessionGate {
    /// A configured host must construct its engine suspended when
    /// `initially_locked`. No credential, policy or library is touched here.
    pub fn new(initially_locked: bool, stop: Option<StopFn>, resume: Option<ResumeFn>) -> Self {
        SessionGate {
            mu: RwLock::new(()),
            locked: AtomicBool::new(initially_locked),
            stop,
            resume,
        }
    }

    /// Never waits on the gate: it is read while an unlock is running.
    pub fn status(&self) -> SecurityStatus {
        SecurityStatus {
            available: true,
            configured: true,
            locked: self.is_locked(),
            ..Default::default()
        }
    }

    pub fn is_locked(&self) -> bool {
        self.locked.load(Ordering::SeqCst)
    }

    /// Admits one request unless locked. The lock flag is read after taking
    /// the read side, so `lock` can never cross an admitted request.
    pub fn enter(&self) -> Option<Admission<'_>> {
        let guard = self.mu.read().unwrap_or_else(|e| e.into_inner());
        if self.is_locked() {
            return None;
        }
        Some(Admission(Some(guard)))
    }

    /// Waits for accepted saves/transfers, then stops the runtime. A failed
    /// stop stays locked; no later request may expose private content.
    pub fn lock(&self) -> Result<()> {
        let _write = self.mu.write().unwrap_or_else(|e| e.into_inner());
        if self.locked.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        match &self.stop {
            Some(stop) => stop(),
            None => Err("security shutdown is unavailable".into()),
        }
    }

    pub fn unlock(
        &self,
        ctx: &Context,
        authenticate: impl FnOnce(&Context) -> Result<()>,
    ) -> Result<()> {
        self.unlock_with_setup(ctx, authenticate, None)
    }

    /// Keeps data paths closed until trusted host setup finishes. Failed or
    /// cancelled authentication, resume or setup stops the engine and stays locked.
    pub fn unlock_with_setup(
        &self,
        ctx: &Context,
        authenticate: impl FnOnce(&Context) -> Result<()>,
        prepare: Option<SetupFn<'_>>,
    ) -> Result<()> {
        let _write = self.mu.write().unwrap_or_else(|e| e.into_inner());
        if !self.is_locked() {
            return Ok(());
        }
        if ctx.is_done() {
            return Err(CANCELLED.into());
        }
        authenticate(ctx)?;
        if ctx.is_done() {
            return Err(CANCELLED.into());
        }
        let Some(resume) = &self.resume else {
            return Err("security resume is unavailable".into());
        };
        resume(ctx)?;
        let mut setup = prepare.map_or(Ok(()), |prepare| prepare(ctx));
        if setup.is_ok() && ctx.is_done() {
            setup = Err(CANCELLED.into());
        }
        if setup.is_err() {
            if let Some(stop) = &self.stop {
                let _ = stop();
            }
            return setup;
        }
        self.locked.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Gives background pollers the same atomic admission as HTTP. Checking
    /// `status().locked` before a call is not enough: lock can race.
    pub fn guard(self: &Arc<Self>, next: Arc<dyn Engine>) -> Guarded {
        Guarded {
            gate: self.clone(),
            next,
        }
    }
}

/// An engine that enters the gate for every call (Go `sessionCaller`).
pub struct Guarded {
    gate: Arc<SessionGate>,
    next: Arc<dyn Engine>,
}

impl Engine for Guarded {
    fn call(&self, deadline: Deadline, request: &[u8]) -> Result<Vec<u8>> {
        let Some(_admission) = self.gate.enter() else {
            return Err("app is locked".into());
        };
        if Instant::now() >= deadline {
            return Err("context deadline exceeded".into());
        }
        self.next.call(deadline, request)
    }
    fn database(&self) -> Option<&Path> {
        self.next.database()
    }
}

/// The reminders service polls through the guard.
// ponytail: `Ctx` hides its deadline, so calls use REQUEST_TIMEOUT after a
// cancellation check; expose `Ctx::deadline` if pollers need tighter bounds.
impl inkism_reminders::Caller for Guarded {
    fn call(&self, ctx: &inkism_reminders::Ctx, request: &str) -> inkism_reminders::Result<String> {
        ctx.err()?;
        let raw = Engine::call(self, Instant::now() + REQUEST_TIMEOUT, request.as_bytes())
            .map_err(|e| inkism_reminders::Error::Msg(e.to_string()))?;
        String::from_utf8(raw).map_err(|e| inkism_reminders::Error::Msg(e.to_string()))
    }
}

/// The Google account controller drives the gate through this trait; it
/// authenticates before calling `unlock_with_setup`.
impl google_auth::host::SessionGate for SessionGate {
    fn is_locked(&self) -> bool {
        SessionGate::is_locked(self)
    }
    fn lock(&self) -> std::result::Result<(), BoxError> {
        SessionGate::lock(self)
    }
    fn unlock_with_setup(
        &self,
        ctx: &Context,
        prepare: &mut dyn FnMut(&Context) -> std::result::Result<(), BoxError>,
    ) -> std::result::Result<(), BoxError> {
        SessionGate::unlock_with_setup(self, ctx, |_| Ok(()), Some(prepare))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::fake::FakeEngine;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc;
    use std::time::Duration;

    fn bg() -> Context {
        Context::background()
    }

    #[test]
    fn fails_closed_and_waits_for_accepted_work() {
        let (stopped, resumed) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let (st, re) = (stopped.clone(), resumed.clone());
        let gate = SessionGate::new(
            false,
            Some(Box::new(move || {
                st.fetch_add(1, Ordering::SeqCst);
                Err("stop failed".into())
            })),
            Some(Box::new(move |_: &Context| {
                re.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })),
        );
        let admission = gate.enter().expect("new gate unexpectedly locked");
        std::thread::scope(|scope| {
            let lock = scope.spawn(|| gate.lock());
            std::thread::sleep(Duration::from_millis(20));
            assert!(!lock.is_finished(), "lock crossed active save");
            drop(admission);
            assert!(lock.join().unwrap().is_err(), "shutdown error hidden");
        });
        assert!(
            gate.status().locked && stopped.load(Ordering::SeqCst) == 1,
            "not fail closed"
        );
        assert!(
            gate.lock().is_ok() && stopped.load(Ordering::SeqCst) == 1,
            "repeated lock stopped twice"
        );
        assert!(
            gate.unlock(&bg(), |_| Err("wrong credential".into()))
                .is_err(),
            "bad credential accepted"
        );
        let cancelled = bg().child();
        cancelled.cancel();
        assert!(
            gate.unlock(&cancelled, |_| Ok(())).is_err(),
            "cancelled unlock accepted"
        );
        assert!(
            resumed.load(Ordering::SeqCst) == 0 && gate.status().locked,
            "failed auth resumed runtime"
        );
        gate.unlock(&bg(), |_| Ok(())).unwrap();
        assert!(
            !gate.status().locked && resumed.load(Ordering::SeqCst) == 1,
            "successful auth not resumed"
        );
    }

    #[test]
    fn failed_resume_stays_locked() {
        let gate = SessionGate::new(
            true,
            None,
            Some(Box::new(|_: &Context| Err("missing library".into()))),
        );
        assert!(
            gate.unlock(&bg(), |_| Ok(())).is_err(),
            "startup error hidden"
        );
        assert!(gate.status().locked, "startup failure exposed data");
    }

    #[test]
    fn failed_setup_stops_resumed_engine() {
        let stopped = Arc::new(AtomicUsize::new(0));
        let st = stopped.clone();
        let stop: StopFn = Box::new(move || {
            st.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        let gate = SessionGate::new(true, Some(stop), Some(Box::new(|_: &Context| Ok(()))));
        let mut prepare = |_: &Context| -> Result<()> { Err("recovery failed".into()) };
        assert!(gate
            .unlock_with_setup(&bg(), |_| Ok(()), Some(&mut prepare))
            .is_err());
        assert!(gate.is_locked() && stopped.load(Ordering::SeqCst) == 1);
    }

    struct Blocking {
        entered: Mutex<Option<mpsc::Sender<()>>>,
        release: Mutex<mpsc::Receiver<()>>,
    }
    use std::sync::Mutex;
    impl Engine for Blocking {
        fn call(&self, _: Deadline, _: &[u8]) -> Result<Vec<u8>> {
            self.entered.lock().unwrap().take().map(|tx| tx.send(()));
            let _ = self.release.lock().unwrap().recv();
            Ok(br#"{"ok":true}"#.to_vec())
        }
    }

    fn soon() -> Deadline {
        Instant::now() + REQUEST_TIMEOUT
    }

    #[test]
    fn background_rpc_admission_is_atomic() {
        let (entered_tx, entered) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        let gate = Arc::new(SessionGate::new(false, Some(Box::new(|| Ok(()))), None));
        let caller = gate.guard(Arc::new(Blocking {
            entered: Mutex::new(Some(entered_tx)),
            release: Mutex::new(release_rx),
        }));
        std::thread::scope(|scope| {
            let call = scope.spawn(|| caller.call(soon(), br#"{"op":"due_reminders"}"#));
            entered.recv().unwrap();
            let lock = scope.spawn(|| gate.lock());
            std::thread::sleep(Duration::from_millis(20));
            assert!(!lock.is_finished(), "lock crossed background RPC");
            release.send(()).unwrap();
            call.join().unwrap().unwrap();
            lock.join().unwrap().unwrap();
        });
        assert!(
            caller.call(soon(), br#"{"op":"due_reminders"}"#).is_err(),
            "locked background request admitted"
        );
        let ctx = inkism_reminders::Ctx::new();
        assert!(
            inkism_reminders::Caller::call(&caller, &ctx, r#"{"op":"due_reminders"}"#).is_err()
        );
    }

    /// Synthetic callbacks only: identity proof cannot supply a missing library key.
    #[test]
    fn verified_identity_cannot_bypass_unavailable_library_key() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let a = attempts.clone();
        let gate = Arc::new(SessionGate::new(
            true,
            None,
            Some(Box::new(move |_: &Context| {
                a.fetch_add(1, Ordering::SeqCst);
                Err("synthetic library key unavailable".into())
            })),
        ));
        let engine = Arc::new(FakeEngine::default());
        for _ in 0..2 {
            let err = gate.unlock(&bg(), |_| Ok(())).unwrap_err();
            assert!(err.to_string() == "synthetic library key unavailable" && gate.status().locked);
            assert!(
                gate.guard(engine.clone())
                    .call(soon(), br#"{"op":"get"}"#)
                    .is_err(),
                "failed key access exposed RPC"
            );
        }
        assert!(attempts.load(Ordering::SeqCst) == 2 && engine.last().is_none());
    }

    /// A browser response arriving after cancellation must not resume the engine.
    #[test]
    fn identity_callback_cancelled_after_verification_cannot_resume() {
        let resumed = Arc::new(AtomicUsize::new(0));
        let re = resumed.clone();
        let gate = SessionGate::new(
            true,
            None,
            Some(Box::new(move |_: &Context| {
                re.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })),
        );
        let ctx = bg().child();
        let err = gate
            .unlock(&ctx, |c| {
                c.cancel();
                Ok(())
            })
            .unwrap_err();
        assert!(
            err.to_string() == CANCELLED
                && resumed.load(Ordering::SeqCst) == 0
                && gate.status().locked
        );
        gate.unlock(&bg(), |_| Ok(())).unwrap();
        gate.unlock(&bg(), |_| {
            panic!("duplicate completion reauthenticated an active session")
        })
        .unwrap();
        assert_eq!(
            resumed.load(Ordering::SeqCst),
            1,
            "duplicate callback resumed runtime twice"
        );
    }

    #[test]
    fn google_controller_trait_drives_the_gate() {
        let gate = SessionGate::new(
            true,
            Some(Box::new(|| Ok(()))),
            Some(Box::new(|_: &Context| Ok(()))),
        );
        let host: &dyn google_auth::host::SessionGate = &gate;
        let mut prepared = 0;
        host.unlock_with_setup(&bg(), &mut |_| {
            prepared += 1;
            Ok(())
        })
        .unwrap();
        assert!(!host.is_locked() && prepared == 1);
        host.lock().unwrap();
        assert!(host.is_locked());
    }
}
