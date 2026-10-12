//! Google account lock wiring (Go `google_host_*.go` and the security half of
//! `main.go`), plus the small adapters between the library crates' traits.

use crate::integrate;
use google_auth::host::Controller;
use google_auth::Context;
use local_api::engine::Process;
use local_api::{Deadline, Engine, SecurityController, SecurityStatus, SessionGate, REQUEST_TIMEOUT};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

/// The account-lock controller. Windows only: the policy lives in DPAPI.
#[cfg(windows)]
pub fn new_google_security(root: &Path) -> Option<Arc<Controller>> {
    use google_auth::host::{read_config, windows_store, Provider, Store};
    let dir = root.join("Inkism");
    let store: Arc<dyn Store> = Arc::new(windows_store(dir.join("google-account.dpapi")));
    let provider = read_config(&dir.join("google-client.json")).ok().and_then(|config| {
        let secret = windows_store(dir.join("google-client-secret.dpapi")).load_client_secret(&config.client_id).ok()?;
        let client = google_auth::auth::Client::with_client_secret(&config.client_id, &secret, Box::new(open_browser)).ok()?;
        Some(Arc::new(client) as Arc<dyn Provider>)
    });
    Some(Arc::new(Controller::new(provider, Some(store))))
}

#[cfg(not(windows))]
pub fn new_google_security(_root: &Path) -> Option<Arc<Controller>> {
    None
}

/// Opens the sign-in page in the default browser. `ShellExecuteW` takes the
/// URL as one argument, so its `&` separators survive (unlike `cmd /c start`).
#[cfg(windows)]
fn open_browser(url: &str) -> Result<(), google_auth::BoxError> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let (verb, target) = (wide("open"), wide(url));
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    if result as usize <= 32 {
        return Err("브라우저를 열지 못했습니다".into());
    }
    Ok(())
}

/// Builds the gate on the started engine (Go `attachSecurity`). `remember`
/// runs after a successful resume of a library opened by choice; on failure
/// the engine is stopped again.
pub fn attach(
    controller: &Controller,
    process: &Arc<Process>,
    database: &Path,
    remember: Option<Box<dyn Fn() -> local_api::Result<()> + Send + Sync>>,
) -> local_api::Result<Arc<SessionGate>> {
    if let Some(recovery) = google_auth::host::read_server_recovery(database)? {
        let engine = EngineCaller(integrate::engine(process));
        controller.set_recovery(Arc::new(move |ctx, token| recovery.connect(ctx, token, &engine)));
    }
    let (stop_process, resume_process) = (process.clone(), process.clone());
    let mut local = None;
    controller.attach(|locked| {
        let gate = integrate::new_gate(
            locked,
            Box::new(move || integrate::close(&stop_process)),
            Box::new(move |ctx| {
                integrate::resume(&resume_process, ctx)?;
                if let Some(remember) = &remember {
                    if let Err(e) = remember() {
                        let _ = integrate::close(&resume_process);
                        return Err(e);
                    }
                }
                Ok(())
            }),
        );
        local = Some(gate.clone());
        integrate::google_gate(gate)
    });
    Ok(local.expect("attach runs make"))
}

/// The controller as the handler's `/api/security/*` backend.
pub struct Security(pub Arc<Controller>);

fn context(deadline: Deadline) -> Context {
    Context::background().with_timeout(deadline.saturating_duration_since(Instant::now()))
}

impl SecurityController for Security {
    fn status(&self) -> SecurityStatus {
        let s = self.0.status();
        SecurityStatus {
            available: s.available,
            configured: s.configured,
            locked: s.locked,
            provider: s.provider,
            setup_required: s.setup_required,
            pending: s.pending,
            recovery_error: s.recovery_error,
        }
    }
    fn login(&self, deadline: Deadline) -> local_api::Result<()> {
        Ok(self.0.login(&context(deadline))?)
    }
    fn cancel(&self) {
        self.0.cancel();
    }
    fn lock(&self) -> local_api::Result<()> {
        Ok(self.0.lock()?)
    }
}

/// The engine as server recovery's RPC channel.
struct EngineCaller(Arc<dyn Engine>);

impl google_auth::host::Caller for EngineCaller {
    fn call(&self, ctx: &Context, request: &[u8]) -> Result<Vec<u8>, google_auth::BoxError> {
        if ctx.is_done() {
            return Err("recovery cancelled".into());
        }
        // ponytail: Context exposes no deadline, so each call gets the
        // request timeout; the recovery client bounds its own HTTP calls.
        self.0.call(Instant::now() + REQUEST_TIMEOUT, request)
    }
}

/// Go `CancelForLockedClose` as a bool for the close decision.
pub fn cancel_for_locked_close(controller: Option<&Controller>) -> bool {
    controller.is_some_and(|c| c.cancel_for_locked_close())
}

