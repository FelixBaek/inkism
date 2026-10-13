//! Port of googlehost's controller, storage, recovery, native-close, HTTP
//! boundary and runtime-integration tests. The bridge is replaced by
//! `TestGate`, a faithful copy of its session-gate semantics.

use super::*;
use crate::test_http::{closed_port, json, serve, Request};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json as j, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

type StopFn = Box<dyn Fn() -> Result<(), BoxError> + Send + Sync>;
type ResumeFn = Box<dyn Fn(&Context) -> Result<(), BoxError> + Send + Sync>;

/// Same contract as the bridge's SessionGate.
struct TestGate {
    mu: Mutex<()>,
    locked: AtomicBool,
    stop: StopFn,
    resume: ResumeFn,
}

impl SessionGate for TestGate {
    fn is_locked(&self) -> bool {
        self.locked.load(Ordering::SeqCst)
    }
    fn lock(&self) -> Result<(), BoxError> {
        let _g = self.mu.lock().unwrap();
        if self.locked.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        (self.stop)()
    }
    fn unlock_with_setup(
        &self,
        ctx: &Context,
        prepare: &mut dyn FnMut(&Context) -> Result<(), BoxError>,
    ) -> Result<(), BoxError> {
        let _g = self.mu.lock().unwrap();
        if !self.is_locked() {
            return Ok(());
        }
        if ctx.is_done() {
            return Err("cancelled".into());
        }
        (self.resume)(ctx)?;
        let setup = prepare(ctx).and_then(|_| {
            if ctx.is_done() {
                Err("cancelled".into())
            } else {
                Ok(())
            }
        });
        if setup.is_err() {
            let _ = (self.stop)();
            return setup;
        }
        self.locked.store(false, Ordering::SeqCst);
        Ok(())
    }
}

impl TestGate {
    /// The bridge's Guard: an atomic admission check before the engine.
    fn guard<'a>(&'a self, engine: &'a dyn Caller) -> impl Caller + 'a {
        struct Guarded<'a>(&'a TestGate, &'a dyn Caller);
        impl Caller for Guarded<'_> {
            fn call(&self, ctx: &Context, request: &[u8]) -> Result<Vec<u8>, BoxError> {
                let _g = self.0.mu.lock().unwrap();
                if self.0.is_locked() {
                    return Err("app is locked".into());
                }
                self.1.call(ctx, request)
            }
        }
        Guarded(self, engine)
    }
}

fn attach(
    c: &Controller,
    stop: impl Fn() -> Result<(), BoxError> + Send + Sync + 'static,
    resume: impl Fn(&Context) -> Result<(), BoxError> + Send + Sync + 'static,
) -> Arc<TestGate> {
    let mut made = None;
    c.attach(|locked| {
        let gate = Arc::new(TestGate {
            mu: Mutex::new(()),
            locked: AtomicBool::new(locked),
            stop: Box::new(stop),
            resume: Box::new(resume),
        });
        made = Some(gate.clone());
        gate
    });
    made.unwrap()
}

fn attach_ok(c: &Controller) -> Arc<TestGate> {
    attach(c, || Ok(()), |_| Ok(()))
}

#[derive(Default)]
struct MemoryStore {
    inner: Mutex<(Option<Identity>, bool)>, // (identity, fail)
    saves: AtomicUsize,
}

impl MemoryStore {
    fn bound() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new((Some(account()), false)),
            ..Self::default()
        })
    }
    fn saves(&self) -> usize {
        self.saves.load(Ordering::SeqCst)
    }
}

impl Store for MemoryStore {
    fn load(&self) -> Result<Option<Identity>, HostError> {
        let s = self.inner.lock().unwrap();
        if s.1 {
            return Err(HostError::Failed("bad DPAPI"));
        }
        Ok(s.0.clone())
    }
    fn save(&self, identity: &Identity) -> Result<(), HostError> {
        let mut s = self.inner.lock().unwrap();
        if s.1 {
            return Err(HostError::Failed("bad DPAPI"));
        }
        s.0 = Some(identity.clone());
        self.saves.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

type LoginFn = Box<dyn Fn(&Context) -> Result<Identity, BoxError> + Send + Sync>;

struct FakeProvider {
    call: LoginFn,
    token: &'static str,
}

impl Provider for FakeProvider {
    fn login(&self, ctx: &Context) -> Result<(Identity, String), BoxError> {
        (self.call)(ctx).map(|i| (i, self.token.to_string()))
    }
    fn cancel(&self) {}
}

fn account() -> Identity {
    Identity {
        issuer: "https://accounts.google.com".into(),
        subject: "synthetic-user".into(),
    }
}

fn other(subject: &str) -> Identity {
    Identity {
        subject: subject.into(),
        ..account()
    }
}

fn provider_fn(
    f: impl Fn(&Context) -> Result<Identity, BoxError> + Send + Sync + 'static,
) -> Option<Arc<dyn Provider>> {
    Some(Arc::new(FakeProvider {
        call: Box::new(f),
        token: "",
    }))
}

fn provider(i: Identity) -> Option<Arc<dyn Provider>> {
    provider_fn(move |_| Ok(i.clone()))
}

fn store(s: &Arc<MemoryStore>) -> Option<Arc<dyn Store>> {
    Some(s.clone())
}

fn bg() -> Context {
    Context::background()
}

#[test]
fn enrollment_cancelled_during_gate_stop_does_not_persist() {
    let ctx = bg().child();
    let s = Arc::new(MemoryStore::default());
    let c = Controller::new(provider(account()), store(&s));
    let resumed = Arc::new(AtomicBool::new(false));
    let (cancel, flag) = (ctx.clone(), resumed.clone());
    attach(
        &c,
        move || {
            cancel.cancel();
            Ok(())
        },
        move |_| {
            flag.store(true, Ordering::SeqCst);
            Ok(())
        },
    );
    assert!(matches!(c.login(&ctx), Err(HostError::Cancelled)));
    let status = c.status();
    assert!(s.saves() == 0 && s.load().unwrap().is_none() && !resumed.load(Ordering::SeqCst));
    assert!(
        status.locked && !status.configured,
        "cancelled enrollment persisted or exposed the library"
    );
}

#[test]
fn enrollment_and_restart_boundary() {
    let s = Arc::new(MemoryStore::default());
    let c = Controller::new(provider(account()), store(&s));
    let (stopped, resumed) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
    let (st, re) = (stopped.clone(), resumed.clone());
    let gate = attach(
        &c,
        move || {
            st.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        move |_| {
            re.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
    );
    assert!(
        !c.initially_locked() && !c.status().configured && !gate.is_locked(),
        "unconfigured library blocked"
    );
    c.login(&bg()).unwrap();
    assert!(
        s.saves() == 1
            && stopped.load(Ordering::SeqCst) == 1
            && resumed.load(Ordering::SeqCst) == 1
    );
    assert!(
        c.status().configured && !c.status().locked,
        "enrollment did not bind and resume"
    );
    let restarted = Controller::new(provider(account()), store(&s));
    assert!(restarted.initially_locked(), "restart not locked");
    attach(&restarted, || Ok(()), |_| Err("missing key".into()));
    assert!(
        restarted.login(&bg()).is_err() && restarted.status().locked,
        "failed runtime resume unlocked"
    );
}

#[test]
fn unavailable_corrupt_offline_and_wrong_account_fail_closed() {
    for scenario in [
        "missing-client",
        "corrupt-binding",
        "offline",
        "wrong-account",
    ] {
        let s = MemoryStore::bound();
        let p = match scenario {
            "missing-client" => None,
            "corrupt-binding" => {
                s.inner.lock().unwrap().1 = true;
                provider(account())
            }
            "offline" => provider_fn(|_| Err("offline token secret must not escape".into())),
            _ => provider(other("other")),
        };
        let c = Controller::new(p, store(&s));
        let resumed = Arc::new(AtomicUsize::new(0));
        let re = resumed.clone();
        attach(
            &c,
            || Ok(()),
            move |_| {
                re.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        );
        let result = c.login(&bg());
        assert!(c.initially_locked() && result.is_err(), "{scenario}");
        assert!(
            !result.unwrap_err().to_string().contains("secret"),
            "{scenario}"
        );
        assert!(
            resumed.load(Ordering::SeqCst) == 0 && c.status().locked && s.saves() == 0,
            "{scenario}"
        );
    }
}

#[test]
fn pending_status_cancel_and_late_login_cannot_unlock() {
    let (started_tx, started) = mpsc::channel::<()>();
    let (complete_tx, complete) = mpsc::channel::<()>();
    let (started_tx, complete) = (Mutex::new(started_tx), Mutex::new(complete));
    let s = MemoryStore::bound();
    let c = Arc::new(Controller::new(
        provider_fn(move |_| {
            started_tx.lock().unwrap().send(())?;
            let _ = complete.lock().unwrap().recv();
            Ok(account())
        }),
        store(&s),
    ));
    let resumed = Arc::new(AtomicUsize::new(0));
    let re = resumed.clone();
    attach(
        &c,
        || Ok(()),
        move |_| {
            re.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
    );
    let worker = c.clone();
    let done = thread::spawn(move || worker.login(&bg()));
    started.recv().unwrap();
    let (status_tx, status_rx) = mpsc::channel();
    let reader = c.clone();
    thread::spawn(move || status_tx.send(reader.status().pending));
    assert!(
        status_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("status blocked by OAuth"),
        "pending missing"
    );
    assert!(
        matches!(c.login(&bg()), Err(HostError::Busy)),
        "duplicate login accepted"
    );
    c.cancel();
    drop(complete_tx);
    assert!(matches!(done.join().unwrap(), Err(HostError::Cancelled)));
    assert!(
        resumed.load(Ordering::SeqCst) == 0 && c.status().locked,
        "cancelled attempt unlocked"
    );
}

fn prefix_store(path: std::path::PathBuf) -> FileStore {
    FileStore::new(
        path,
        Arc::new(|b| Ok([b"protected:".as_slice(), b].concat())),
        Arc::new(|b| {
            if b.len() < 10 {
                Err("short".into())
            } else {
                Ok(b[10..].to_vec())
            }
        }),
    )
}

#[test]
fn strict_config_and_exclusive_policy_storage() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("google-client.json");
    assert!(read_config(&config).is_err(), "missing config accepted");
    for raw in [
        r#"{"client_id":"https://evil"}"#,
        r#"{"client_id":"123-abc.apps.googleusercontent.com","client_secret":"forbidden"}"#,
        r#"{"client_id":"123-abc.apps.googleusercontent.com"}{}"#,
    ] {
        std::fs::write(&config, raw).unwrap();
        assert!(
            read_config(&config).is_err(),
            "unsafe config accepted: {raw}"
        );
    }
    std::fs::write(
        &config,
        r#"{"client_id":"123-abc.apps.googleusercontent.com"}"#,
    )
    .unwrap();
    read_config(&config).unwrap();
    let s = prefix_store(root.path().join("policy"));
    s.save(&account()).unwrap();
    assert!(s.save(&other("other")).is_err(), "overwrote binding");
    assert_eq!(s.load().unwrap(), Some(account()));
    std::fs::write(&s.path, "corrupt").unwrap();
    assert!(s.load().is_err(), "corruption treated as missing opt-in");
}

struct FailingStore {
    partial: AtomicBool,
    fail: AtomicBool,
}

impl Store for FailingStore {
    fn load(&self) -> Result<Option<Identity>, HostError> {
        if self.partial.load(Ordering::SeqCst) {
            return Err(HostError::Policy);
        }
        Ok(None)
    }
    fn save(&self, _: &Identity) -> Result<(), HostError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(HostError::Failed("write failed"));
        }
        Ok(())
    }
}

#[test]
fn enrollment_write_failure_retry_and_partial_file() {
    for partial in [false, true] {
        let s = Arc::new(FailingStore {
            partial: AtomicBool::new(false),
            fail: AtomicBool::new(true),
        });
        let c = Controller::new(provider(account()), Some(s.clone()));
        attach_ok(&c);
        s.partial.store(partial, Ordering::SeqCst);
        assert!(
            c.login(&bg()).is_err() && c.status().locked,
            "failed save exposed data"
        );
        s.fail.store(false, Ordering::SeqCst);
        let result = c.login(&bg());
        if partial {
            let status = c.status();
            assert!(
                matches!(result, Err(HostError::Policy)) && status.configured && !status.available,
                "partial binding not fail closed"
            );
        } else {
            assert!(
                result.is_ok() && !c.status().locked,
                "safe explicit retry failed"
            );
        }
    }
}

#[test]
fn protected_registration_credential() {
    let invert: ProtectFn = Arc::new(|b| Ok(b.iter().map(|x| x ^ 0xff).collect()));
    let dir = tempfile::tempdir().unwrap();
    let s = FileStore::new(
        dir.path().join("credential"),
        invert.clone(),
        invert.clone(),
    );
    let (id, secret) = (
        "123456-synthetic.apps.googleusercontent.com",
        "synthetic-credential",
    );
    assert_eq!(
        s.load_client_secret(id).unwrap(),
        "",
        "missing optional credential failed"
    );
    s.save_client_secret(id, secret).unwrap();
    let raw = std::fs::read(&s.path).unwrap();
    assert!(
        !raw.windows(secret.len()).any(|w| w == secret.as_bytes()),
        "plaintext registration credential on disk"
    );
    assert_eq!(s.load_client_secret(id).unwrap(), secret);
    assert!(matches!(
        s.load_client_secret("123-other.apps.googleusercontent.com"),
        Err(HostError::Policy)
    ));
    assert!(
        s.save_client_secret(id, "replacement").is_err(),
        "existing credential overwritten"
    );
    assert_eq!(
        std::fs::read(&s.path).unwrap(),
        raw,
        "exclusive save changed existing credential"
    );
    for bad in [
        r#"{"client_id":"123456-synthetic.apps.googleusercontent.com","client_secret":"synthetic-credential","extra":1}"#,
        r#"{"client_id":"123456-synthetic.apps.googleusercontent.com","client_secret":"synthetic-credential"}{}"#,
        r#"{"client_id":"123456-synthetic.apps.googleusercontent.com","client_secret":""}"#,
        "not-json",
    ] {
        std::fs::write(&s.path, invert(bad.as_bytes()).unwrap()).unwrap();
        assert!(
            matches!(s.load_client_secret(id), Err(HostError::Policy)),
            "accepted {bad}"
        );
    }
}

struct ForbiddenCaller;
impl Caller for ForbiddenCaller {
    fn call(&self, _: &Context, _: &[u8]) -> Result<Vec<u8>, BoxError> {
        panic!("locked request reached engine");
    }
}

/// http_test.go, minus the bridge's HTTP routing: a configured library with
/// no Google client stays locked, reports setup-required and never resumes.
#[test]
fn configured_missing_client_blocks_every_host_data_path() {
    let c = Controller::new(None, store(&MemoryStore::bound()));
    let gate = attach(&c, || Ok(()), |_| panic!("resume without Google"));
    assert!(gate.guard(&ForbiddenCaller).call(&bg(), b"{}").is_err());
    let status = serde_json::to_value(c.status()).unwrap();
    assert!(
        status["locked"] == true && status["setup_required"] == true,
        "{status}"
    );
    assert!(matches!(c.login(&bg()), Err(HostError::Unavailable)));
    c.cancel();
    assert!(gate.is_locked());
}

#[test]
fn locked_native_close_cancels_pending_login() {
    let (started_tx, started) = mpsc::channel::<()>();
    let started_tx = Mutex::new(started_tx);
    let c = Arc::new(Controller::new(
        provider_fn(move |ctx| {
            started_tx.lock().unwrap().send(())?;
            while !ctx.is_done() {
                thread::sleep(Duration::from_millis(2));
            }
            Ok(account()) // Late successful completion must not resume.
        }),
        store(&MemoryStore::bound()),
    ));
    let resumes = Arc::new(AtomicUsize::new(0));
    let re = resumes.clone();
    attach(
        &c,
        || Ok(()),
        move |_| {
            re.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
    );
    let worker = c.clone();
    let result = thread::spawn(move || worker.login(&bg()));
    started.recv().unwrap();
    assert!(
        c.cancel_for_locked_close(),
        "locked native close still depends on the missing editor"
    );
    assert!(matches!(result.join().unwrap(), Err(HostError::Cancelled)));
    assert!(
        resumes.load(Ordering::SeqCst) == 0 && c.status().locked,
        "native close allowed late authentication to resume"
    );
    let unconfigured = Controller::new(None, store(&Arc::new(MemoryStore::default())));
    attach_ok(&unconfigured);
    assert!(
        !unconfigured.cancel_for_locked_close(),
        "unlocked native close skipped the save handshake"
    );
}

#[derive(Default)]
struct RecoveryEngine {
    requests: Mutex<Vec<Value>>,
    configured: bool,
    url: String,
}

impl RecoveryEngine {
    fn requests(&self) -> Vec<Value> {
        self.requests.lock().unwrap().clone()
    }
}

impl Caller for RecoveryEngine {
    fn call(&self, _: &Context, raw: &[u8]) -> Result<Vec<u8>, BoxError> {
        let req: Value = serde_json::from_slice(raw)?;
        self.requests.lock().unwrap().push(req.clone());
        let key = STANDARD.encode([b'k'; 32]);
        let response = match req["op"].as_str() {
            Some("sync_status") => {
                j!({"ok": true, "data": {"configured": self.configured, "server_url": self.url}})
            }
            Some("sync_recovery_export") => j!({"ok": true, "data": {"key": key}}),
            Some("sync_recovery_import") => j!({"ok": true, "data": {"configured": true}}),
            _ => return Err("unexpected operation".into()),
        };
        Ok(response.to_string().into_bytes())
    }
}

#[test]
fn server_recovery_host_only_registration_and_restore() {
    let key = STANDARD.encode([b'k'; 32]);
    let method = Arc::new(Mutex::new(String::new()));
    let (seen, expected) = (method.clone(), key.clone());
    let base = serve(move |r: Request| {
        assert!(
            r.path == "/v1/recovery/key" && r.headers["authorization"] == "Bearer ephemeral",
            "recovery request contract"
        );
        *seen.lock().unwrap() = r.method.clone();
        if r.method == "PUT" {
            let body: HashMap<String, String> = serde_json::from_slice(&r.body).unwrap();
            assert!(
                body.len() == 1 && body["key"] == expected,
                "registration payload"
            );
            return json(200, j!({"registered": true}));
        }
        json(200, j!({"key": expected, "token": "t".repeat(32)}))
    });
    let cfg = ServerRecovery::for_test(&base);
    let ctx = bg();
    let take = || std::mem::take(&mut *method.lock().unwrap());

    let engine = RecoveryEngine {
        configured: true,
        url: base.clone(),
        ..Default::default()
    };
    assert_eq!(
        cfg.connect(&ctx, "ephemeral", &engine).unwrap(),
        "",
        "registration failed"
    );
    let requests = engine.requests();
    assert!(
        take() == "PUT" && requests.len() == 2 && requests[1]["confirmed_server_recovery"] == true
    );

    let engine = RecoveryEngine::default();
    assert_eq!(
        cfg.connect(&ctx, "ephemeral", &engine).unwrap(),
        "",
        "restore failed"
    );
    let requests = engine.requests();
    assert!(take() == "GET" && requests.len() == 2);
    let req = &requests[1];
    assert!(
        req["op"] == "sync_recovery_import"
            && req["key"] == key.as_str()
            && req.get("migration").is_none()
            && req["confirmed_server_recovery"] == true,
        "restore crossed host boundary"
    );

    let engine = RecoveryEngine {
        configured: true,
        url: "https://another.invalid".into(),
        ..Default::default()
    };
    let warning = cfg.connect(&ctx, "ephemeral", &engine).unwrap();
    assert!(
        !warning.is_empty() && take().is_empty() && engine.requests().len() == 1,
        "sent secrets to changed server"
    );

    // Offline escrow cannot turn a local library into a failed Google login.
    let offline = ServerRecovery::for_test(&closed_port());
    let engine = RecoveryEngine {
        configured: true,
        url: offline.server_url().into(),
        ..Default::default()
    };
    assert!(
        !offline
            .connect(&ctx, "ephemeral", &engine)
            .unwrap()
            .is_empty(),
        "local library blocked by escrow outage"
    );
    let engine = RecoveryEngine::default();
    assert!(
        offline.connect(&ctx, "ephemeral", &engine).is_err() && engine.requests().len() == 1,
        "failed restore configured a library"
    );
}

#[test]
fn recovery_after_binding_before_exposure_and_cancellation() {
    let s = MemoryStore::bound();
    let token_provider = |i: Identity| -> Option<Arc<dyn Provider>> {
        Some(Arc::new(FakeProvider {
            call: Box::new(move |_| Ok(i.clone())),
            token: "ephemeral",
        }))
    };
    let controller = Arc::new(Controller::new(token_provider(account()), store(&s)));
    let (resumed, stopped) = (
        Arc::new(AtomicBool::new(false)),
        Arc::new(AtomicBool::new(false)),
    );
    let (re, st) = (resumed.clone(), stopped.clone());
    attach(
        &controller,
        move || {
            st.store(true, Ordering::SeqCst);
            Ok(())
        },
        move |_| {
            re.store(true, Ordering::SeqCst);
            Ok(())
        },
    );
    let (inner, re) = (Arc::downgrade(&controller), resumed.clone());
    controller.set_recovery(Arc::new(move |ctx, token| {
        assert!(
            re.load(Ordering::SeqCst) && token == "ephemeral",
            "recovery ran before verified resume"
        );
        let controller = inner.upgrade().unwrap();
        let status = controller.status();
        assert!(
            status.pending && status.locked,
            "recovery exposed status or blocked cancellation"
        );
        controller.cancel();
        if ctx.is_done() {
            Err(HostError::Cancelled)
        } else {
            Ok(String::new())
        }
    }));
    assert!(matches!(controller.login(&bg()), Err(HostError::Cancelled)));
    assert!(
        controller.status().locked && stopped.load(Ordering::SeqCst),
        "cancelled setup exposed engine"
    );

    let controller = Controller::new(token_provider(other("other")), store(&s));
    attach(&controller, || Ok(()), |_| panic!("wrong account resumed"));
    controller.set_recovery(Arc::new(|_, _| panic!("wrong account sent token")));
    assert!(matches!(controller.login(&bg()), Err(HostError::Account)));
}

/// A suspended engine stand-in for runtime_integration_test.go: it answers
/// only while resumed, as the real runtime process does.
#[derive(Default)]
struct FakeEngine {
    running: AtomicBool,
    note: String,
}

impl Caller for FakeEngine {
    fn call(&self, _: &Context, _: &[u8]) -> Result<Vec<u8>, BoxError> {
        if !self.running.load(Ordering::SeqCst) {
            return Err("engine stopped".into());
        }
        Ok(j!({"ok": true, "data": {"content": self.note}})
            .to_string()
            .into_bytes())
    }
}

#[test]
fn runtime_identity_gate_restart_preserves_source() {
    let body = "# synthetic source\r\n<p>literal &amp; 한글 😀</p>";
    let s = MemoryStore::bound();
    let request = br#"{"op":"get","id":"synthetic"}"#;
    let ctx = bg();
    for _cycle in 0..2 {
        let engine = Arc::new(FakeEngine {
            note: body.into(),
            ..Default::default()
        });
        let wire = |c: &Controller| {
            let (stop, resume) = (engine.clone(), engine.clone());
            attach(
                c,
                move || {
                    stop.running.store(false, Ordering::SeqCst);
                    Ok(())
                },
                move |_| {
                    resume.running.store(true, Ordering::SeqCst);
                    Ok(())
                },
            )
        };
        let wrong = Controller::new(provider(other("wrong-synthetic-account")), store(&s));
        let gate = wire(&wrong);
        assert!(matches!(wrong.login(&ctx), Err(HostError::Account)));
        assert!(
            gate.guard(engine.as_ref()).call(&ctx, request).is_err(),
            "wrong account reached protected RPC"
        );
        assert!(
            engine.call(&ctx, request).is_err(),
            "suspended runtime started before authentication"
        );

        let controller = Controller::new(provider(account()), store(&s));
        let gate = wire(&controller);
        assert!(controller.initially_locked(), "restart lost account lock");
        controller.login(&ctx).unwrap();
        let note: Value =
            serde_json::from_slice(&gate.guard(engine.as_ref()).call(&ctx, request).unwrap())
                .unwrap();
        assert_eq!(note["data"]["content"], body, "restart changed source");
        controller.lock().unwrap();
        assert!(
            gate.guard(engine.as_ref()).call(&ctx, request).is_err(),
            "locked RPC reached runtime"
        );
        assert!(
            engine.call(&ctx, request).is_err(),
            "lock did not stop the runtime"
        );
        controller.cancel();
    }
    assert_eq!(s.saves(), 0, "existing identity binding was overwritten");
}

#[cfg(windows)]
mod dpapi {
    use super::*;

    #[test]
    fn synthetic_windows_account_binding() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("google-account.dpapi");
        let s = windows_store(&path);
        s.save(&account()).unwrap();
        let mut raw = std::fs::read(&path).unwrap();
        let subject = account().subject;
        assert!(
            !raw.windows(subject.len()).any(|w| w == subject.as_bytes()),
            "plaintext account binding"
        );
        assert_eq!(windows_store(&path).load().unwrap(), Some(account()));
        *raw.last_mut().unwrap() ^= 0xff;
        std::fs::write(&path, &raw).unwrap();
        assert!(s.load().is_err(), "corrupt DPAPI accepted");
    }

    #[test]
    fn synthetic_windows_registration_credential() {
        let dir = tempfile::tempdir().unwrap();
        let s = windows_store(dir.path().join("google-client-secret.dpapi"));
        let (id, secret) = (
            "123456-synthetic.apps.googleusercontent.com",
            "synthetic-only-client-credential",
        );
        s.save_client_secret(id, secret).unwrap();
        let mut raw = std::fs::read(&s.path).unwrap();
        assert!(
            !raw.windows(secret.len()).any(|w| w == secret.as_bytes()),
            "DPAPI credential plaintext"
        );
        assert_eq!(s.load_client_secret(id).unwrap(), secret);
        *raw.last_mut().unwrap() ^= 0xff;
        std::fs::write(&s.path, &raw).unwrap();
        assert!(
            s.load_client_secret(id).is_err(),
            "corrupt DPAPI registration credential accepted"
        );
    }
}

/// Provider that also reports a (claimed) e-mail; only its masked form may survive.
struct HintProvider(Identity, &'static str);
impl Provider for HintProvider {
    fn login(&self, _: &Context) -> Result<(Identity, String), BoxError> {
        Ok((self.0.clone(), String::new()))
    }
    fn login_with_hint(&self, _: &Context) -> Result<(Identity, String, String), BoxError> {
        Ok((self.0.clone(), String::new(), mask_email(self.1)))
    }
    fn cancel(&self) {}
}

#[test]
fn masked_email_only_is_stored_and_reported() {
    assert_eq!(mask_email("felix.baek@Example.com"), "f***@example.com");
    for bad in ["", "no-at", "@example.com", "a@b@c.com", "a@localhost", "a@exa mple.com"] {
        assert_eq!(mask_email(bad), "", "{bad}");
    }
    for bad in ["felix@example.com", "f**@example.com", "***@example.com", "f***@", "f***@ex ample.com"] {
        assert!(!valid_hint(bad), "{bad}");
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("google-account.bin");
    let fs_store: Arc<dyn Store> = Arc::new(prefix_store(path.clone()));
    let p: Option<Arc<dyn Provider>> = Some(Arc::new(HintProvider(account(), "secret.person@example.com")));
    let c = Controller::new(p.clone(), Some(fs_store.clone()));
    attach_ok(&c);
    c.login(&bg()).unwrap();
    let status = c.status();
    assert_eq!(status.account_hint, "s***@example.com");
    let json = serde_json::to_string(&status).unwrap();
    assert!(!json.contains("secret.person"), "full address in status: {json}");
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let raw = std::fs::read(entry.unwrap().path()).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("secret.person"), "full address on disk");
    }
    // Restart reads the hint back; a binding written before hints existed shows none.
    let again = Controller::new(p.clone(), Some(fs_store.clone()));
    assert_eq!(again.status().account_hint, "s***@example.com");
    std::fs::remove_file(dir.path().join("google-account.bin.hint")).unwrap();
    let old = Controller::new(p, Some(fs_store));
    assert!(old.status().configured && old.status().account_hint.is_empty());
}

#[test]
fn disable_requires_same_account_reauthentication() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("google-account.bin");
    let fs_store: Arc<dyn Store> = Arc::new(prefix_store(path.clone()));
    let enroll = Controller::new(provider(account()), Some(fs_store.clone()));
    attach_ok(&enroll);
    enroll.login(&bg()).unwrap();
    assert!(path.exists());

    // While locked, disabling is refused before any login is attempted.
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = calls.clone();
    let locked = Controller::new(
        provider_fn(move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(account())
        }),
        Some(fs_store.clone()),
    );
    attach_ok(&locked);
    assert!(locked.status().locked);
    assert!(locked.disable(&bg()).is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    // Another account, a failed login or a cancelled login never removes the binding.
    for p in [
        provider(other("someone-else")),
        provider_fn(|_| Err("network".into())),
        provider(Identity { issuer: "https://evil.example".into(), ..account() }),
    ] {
        let c = Controller::new(p, Some(fs_store.clone()));
        attach_ok(&c);
        c.lock_state().gate.as_ref().unwrap().unlock_with_setup(&bg(), &mut |_| Ok(())).unwrap();
        assert!(c.disable(&bg()).is_err());
        assert!(c.status().configured && path.exists(), "binding removed without matching re-login");
    }
    let cancelled = bg().child();
    cancelled.cancel();
    let c = Controller::new(provider(account()), Some(fs_store.clone()));
    attach_ok(&c);
    c.lock_state().gate.as_ref().unwrap().unlock_with_setup(&bg(), &mut |_| Ok(())).unwrap();
    assert!(c.disable(&cancelled).is_err());
    assert!(path.exists());

    // A store that cannot delete keeps the lock configured.
    let s = MemoryStore::bound();
    let m = Controller::new(provider(account()), store(&s));
    attach_ok(&m);
    m.lock_state().gate.as_ref().unwrap().unlock_with_setup(&bg(), &mut |_| Ok(())).unwrap();
    assert!(m.disable(&bg()).is_err());
    assert!(m.status().configured);

    // Only the same issuer+subject after a fresh login turns the lock off.
    let c = Controller::new(provider(account()), Some(fs_store));
    attach_ok(&c);
    c.lock_state().gate.as_ref().unwrap().unlock_with_setup(&bg(), &mut |_| Ok(())).unwrap();
    c.disable(&bg()).unwrap();
    let status = c.status();
    assert!(!status.configured && !status.locked && status.account_hint.is_empty());
    assert!(!path.exists());
    assert!(c.lock().is_err(), "nothing left to lock with");
}
