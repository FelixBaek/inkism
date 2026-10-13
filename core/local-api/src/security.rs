//! Security endpoints that bypass the gate (Go `security_adapter.go`, `serveSecurity` in `http.go`).

use crate::{empty_host_request, Handler, Request, Response};
use serde_json::json;
use std::time::{Duration, Instant};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);

fn ok(status: impl serde::Serialize) -> Response {
    Response::json(200, &json!({"ok": true, "data": status}))
}

/// `Some` when the request was a security endpoint.
pub(crate) fn serve(h: &Handler, r: &Request) -> Option<Response> {
    if let Some(security) = &h.security {
        if r.path.starts_with("/api/security/") {
            return Some(controller(security.as_ref(), r));
        }
    }
    if r.path == "/api/security/status" && r.method == "GET" {
        return Some(ok(h.gate.as_ref().map(|g| g.status()).unwrap_or_default()));
    }
    if r.path != "/api/security/lock" || r.method != "POST" {
        return None;
    }
    if let Some(rejected) = empty_host_request(r) {
        return Some(rejected);
    }
    let Some(gate) = &h.gate else {
        return Some(Response::fail(400, "app lock is not configured"));
    };
    Some(match gate.lock() {
        Ok(()) => ok(gate.status()),
        Err(e) => Response::fail(500, e),
    })
}

fn controller(security: &dyn crate::SecurityController, r: &Request) -> Response {
    if r.path == "/api/security/status" && r.method == "GET" {
        return ok(security.status());
    }
    if r.method != "POST" {
        return Response::fail(405, "method not allowed");
    }
    if let Some(rejected) = empty_host_request(r) {
        return rejected;
    }
    match r.path.as_str() {
        "/api/security/login" => {
            if !security.status().available {
                return Response::fail(
                    503,
                    "Google 로그인 설정 또는 계정 보호 설정을 확인해 주세요",
                );
            }
            if let Err(e) = security.login(Instant::now() + LOGIN_TIMEOUT) {
                return Response::fail(409, e);
            }
        }
        "/api/security/disable" => {
            let status = security.status();
            if !status.available || !status.configured || status.locked {
                return Response::fail(409, "잠금을 해제한 상태에서만 끌 수 있습니다");
            }
            // Always a full Google login inside; there is no body or flag to skip it.
            if let Err(e) = security.disable(Instant::now() + LOGIN_TIMEOUT) {
                return Response::fail(409, e);
            }
        }
        "/api/security/cancel" => security.cancel(),
        "/api/security/lock" => {
            if let Err(e) = security.lock() {
                return Response::fail(400, e);
            }
        }
        _ => return Response::fail(404, "not found"),
    }
    ok(security.status())
}

#[cfg(test)]
mod tests {
    use crate::engine::fake::{request, FakeEngine};
    use crate::{
        Deadline, Handler, Response, Result, SecurityController, SecurityStatus, SessionGate,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct Fake {
        status: SecurityStatus,
        calls: AtomicUsize,
        /// Set: login reports start and blocks until `cancel`.
        started: Mutex<Option<mpsc::Sender<()>>>,
        cancelled: Mutex<Option<mpsc::Sender<()>>>,
        waiting: Mutex<Option<mpsc::Receiver<()>>>,
        login_err: Option<&'static str>,
        lock_err: Option<&'static str>,
    }

    impl Fake {
        fn new(status: SecurityStatus) -> Arc<Fake> {
            Arc::new(Fake {
                status,
                ..Fake::default()
            })
        }
        fn blocking(status: SecurityStatus) -> (Arc<Fake>, mpsc::Receiver<()>) {
            let (started, on_start) = mpsc::channel();
            let (cancelled, waiting) = mpsc::channel();
            let fake = Fake {
                status,
                started: Mutex::new(Some(started)),
                cancelled: Mutex::new(Some(cancelled)),
                waiting: Mutex::new(Some(waiting)),
                ..Fake::default()
            };
            (Arc::new(fake), on_start)
        }
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl SecurityController for Fake {
        fn status(&self) -> SecurityStatus {
            self.status.clone()
        }
        fn login(&self, deadline: Deadline) -> Result<()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(started) = self.started.lock().unwrap().take() {
                let waiting = self.waiting.lock().unwrap().take().unwrap();
                started.send(()).unwrap();
                let _ = waiting.recv_timeout(deadline.saturating_duration_since(Instant::now()));
                return Err("context canceled".into());
            }
            self.login_err.map_or(Ok(()), |e| Err(e.into()))
        }
        fn cancel(&self) {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.cancelled.lock().unwrap().take();
        }
        fn lock(&self) -> Result<()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.lock_err.map_or(Ok(()), |e| Err(e.into()))
        }
        fn disable(&self, _deadline: Deadline) -> Result<()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.login_err.map_or(Ok(()), |e| Err(e.into()))
        }
    }

    fn handler(security: &Arc<Fake>) -> Handler {
        Handler {
            security: Some(security.clone()),
            ..Handler::default()
        }
    }

    /// Go `securityHTTPCall`.
    fn call(h: &Handler, method: &str, path: &str, body: &str) -> Response {
        h.handle(&request(
            method,
            "inkism.local",
            path,
            body,
            &[("Content-Type", "application/json")],
        ))
    }

    fn available() -> SecurityStatus {
        SecurityStatus {
            available: true,
            ..Default::default()
        }
    }

    fn text(r: &Response) -> String {
        String::from_utf8_lossy(&r.body).into_owned()
    }

    #[test]
    fn rejects_untrusted_routes_before_controller() {
        for route in ["status", "login", "cancel", "lock"] {
            let method = if route == "status" { "GET" } else { "POST" };
            for (name, host, origin, site) in [
                ("wrong-host", "attacker.invalid", "", ""),
                (
                    "wrong-origin",
                    "inkism.local",
                    "https://attacker.invalid",
                    "",
                ),
                ("wrong-port", "inkism.local", "http://inkism.local:9999", ""),
                ("opaque-origin", "inkism.local", "null", ""),
                ("cross-site", "inkism.local", "", "cross-site"),
            ] {
                let fake = Fake::new(available());
                let h = Handler {
                    host: "inkism.local".into(),
                    ..handler(&fake)
                };
                let headers = [
                    ("Origin", origin),
                    ("Sec-Fetch-Site", site),
                    ("Content-Type", "application/json"),
                ];
                let out = h.handle(&request(
                    method,
                    host,
                    &format!("/api/security/{route}"),
                    "{}",
                    &headers,
                ));
                assert!(
                    out.status == 403 && fake.calls() == 0,
                    "{route}/{name}: {} calls={}",
                    out.status,
                    fake.calls()
                );
            }
        }
    }

    #[test]
    fn rejects_methods_and_bodies_without_side_effects() {
        for route in ["login", "cancel", "lock"] {
            let path = format!("/api/security/{route}");
            for method in ["GET", "PUT", "DELETE", "OPTIONS", "HEAD"] {
                let fake = Fake::new(available());
                let out = call(&handler(&fake), method, &path, "{}");
                assert!(
                    out.status == 405 && fake.calls() == 0,
                    "{route}/{method}: {}",
                    out.status
                );
            }
            let oversize = " ".repeat(129) + "{}";
            for (name, body, content, code) in [
                ("content-type", "{}", "text/plain", 415),
                ("empty", "", "application/json", 400),
                ("null", "null", "application/json", 400),
                ("array", "[]", "application/json", 400),
                ("invalid", "{", "application/json", 400),
                (
                    "renderer-identity",
                    r#"{"subject":"attacker","email":"secret@example.invalid"}"#,
                    "application/json",
                    400,
                ),
                ("trailing", "{}{}", "application/json", 400),
                ("oversize", oversize.as_str(), "application/json", 400),
            ] {
                let fake = Fake::new(available());
                let out = handler(&fake).handle(&request(
                    "POST",
                    "inkism.local",
                    &path,
                    body,
                    &[("Content-Type", content)],
                ));
                assert!(
                    out.status == code && fake.calls() == 0,
                    "{route}/{name}: {} {}",
                    out.status,
                    text(&out)
                );
            }
        }
        let fake = Fake::new(available());
        let out = call(&handler(&fake), "POST", "/api/security/unknown", "{}");
        assert!(out.status == 404 && fake.calls() == 0, "{}", out.status);
    }

    #[test]
    fn status_contains_only_public_state() {
        let status = SecurityStatus {
            available: true,
            configured: true,
            locked: true,
            provider: "google".into(),
            setup_required: true,
            pending: true,
            account_hint: "s***@example.com".into(),
            ..Default::default()
        };
        let fake = Fake::new(status);
        let h = Handler {
            gate: Some(Arc::new(SessionGate::new(true, None, None))),
            ..handler(&fake)
        };
        let out = call(&h, "GET", "/api/security/status", "");
        let header = |n: &str| {
            out.headers
                .iter()
                .find(|(k, _)| k == n)
                .map(|(_, v)| v.as_str())
        };
        assert!(
            out.status == 200
                && header("cache-control") == Some("no-store")
                && header("x-content-type-options") == Some("nosniff")
        );
        let v: serde_json::Value = serde_json::from_slice(&out.body).unwrap();
        let data = v["data"].as_object().unwrap();
        let allowed = [
            "available",
            "configured",
            "locked",
            "provider",
            "setup_required",
            "pending",
            "account_hint",
        ];
        assert!(v["ok"] == true && data.len() == allowed.len(), "{v}");
        assert!(
            data.keys().all(|k| allowed.contains(&k.as_str())),
            "nonpublic status field: {v}"
        );
        // Only a masked account: one visible character before `***@`.
        let hint = data["account_hint"].as_str().unwrap();
        let (local, _) = hint.split_once('@').unwrap();
        assert!(local.chars().count() == 4 && local.ends_with("***"), "unmasked account: {hint}");
    }

    #[test]
    fn pending_login_does_not_block_status_or_cancel() {
        let status = SecurityStatus {
            configured: true,
            locked: true,
            pending: true,
            ..available()
        };
        let (fake, started) = Fake::blocking(status);
        let engine = Arc::new(FakeEngine::default());
        let h = Handler {
            gate: Some(Arc::new(SessionGate::new(true, None, None))),
            engine: Some(engine.clone()),
            ..handler(&fake)
        };
        std::thread::scope(|scope| {
            let login = scope.spawn(|| call(&h, "POST", "/api/security/login", "{}"));
            started
                .recv_timeout(Duration::from_secs(1))
                .expect("login not started");
            let out = call(&h, "POST", "/api/rpc", r#"{"op":"get","id":"private"}"#);
            assert!(
                out.status == 423 && engine.last().is_none(),
                "pending login exposed data: {}",
                out.status
            );
            assert_eq!(
                call(&h, "GET", "/api/security/status", "").status,
                200,
                "status unavailable"
            );
            for _ in 0..2 {
                assert_eq!(
                    call(&h, "POST", "/api/security/cancel", "{}").status,
                    200,
                    "cancel unavailable"
                );
            }
            let out = login.join().unwrap();
            assert_eq!(out.status, 409, "{}", text(&out));
        });
        assert!(
            h.gate.as_ref().unwrap().status().locked,
            "canceled login unlocked data"
        );
    }

    #[test]
    fn host_errors_remain_failures() {
        for (name, route, available, login_err, lock_err, code) in [
            ("unavailable", "login", false, None, None, 503),
            (
                "busy",
                "login",
                true,
                Some("login already pending"),
                None,
                409,
            ),
            (
                "auth-failed",
                "login",
                true,
                Some("authentication failed"),
                None,
                409,
            ),
            (
                "lock-failed",
                "lock",
                true,
                None,
                Some("runtime stop failed"),
                400,
            ),
        ] {
            let status = SecurityStatus {
                available,
                locked: true,
                ..Default::default()
            };
            let fake = Arc::new(Fake {
                status,
                login_err,
                lock_err,
                ..Fake::default()
            });
            let out = call(
                &handler(&fake),
                "POST",
                &format!("/api/security/{route}"),
                "{}",
            );
            assert_eq!(out.status, code, "{name}: {}", text(&out));
            assert!(
                available || fake.calls() == 0,
                "{name}: unavailable controller invoked"
            );
        }
    }

    #[test]
    fn locked_handler_blocks_all_data_and_preserves_security_origin_checks() {
        let engine = Arc::new(FakeEngine::default());
        let h = Handler {
            engine: Some(engine.clone()),
            gate: Some(Arc::new(SessionGate::new(true, None, None))),
            ..Handler::default()
        };
        for path in [
            "/api/rpc",
            "/api/attachments",
            "/api/attachments/id",
            "/api/backup",
            "/api/restore",
            "/api/export",
            "/api/import",
            "/api/upload-access",
            "/api/storage/open",
            "/api/storage/encrypted-copy",
        ] {
            let out = h.handle(&request(
                "POST",
                "example.com",
                path,
                r#"{"op":"get"}"#,
                &[],
            ));
            assert_eq!(out.status, 423, "{path}");
        }
        assert!(engine.last().is_none(), "locked request reached engine");
        let out = h.handle(&request(
            "GET",
            "example.com",
            "/api/security/status",
            "",
            &[],
        ));
        assert!(
            out.status == 200 && text(&out).contains(r#""locked":true"#),
            "{}",
            text(&out)
        );
        let out = h.handle(&request(
            "POST",
            "example.com",
            "/api/security/lock",
            "{}",
            &[("Origin", "https://evil.example")],
        ));
        assert_eq!(out.status, 403, "security route skipped origin check");
    }

    #[test]
    fn gate_lock_without_controller() {
        let lock = |h: &Handler| call(h, "POST", "/api/security/lock", "{}").status;
        assert_eq!(lock(&Handler::default()), 400, "no gate");
        let failing = Handler {
            gate: Some(Arc::new(SessionGate::new(false, None, None))),
            ..Handler::default()
        };
        assert_eq!(lock(&failing), 500, "stop unavailable");
        let gate = Arc::new(SessionGate::new(false, Some(Box::new(|| Ok(()))), None));
        let h = Handler {
            gate: Some(gate.clone()),
            ..Handler::default()
        };
        assert!(lock(&h) == 200 && gate.is_locked());
        let out = call(&Handler::default(), "GET", "/api/security/status", "");
        assert!(
            text(&out).contains(r#""data":{"available":false,"configured":false,"locked":false}"#),
            "{}",
            text(&out)
        );
    }

    #[test]
    fn disable_only_from_unlocked_configured_state_through_controller() {
        let configured = SecurityStatus {
            available: true,
            configured: true,
            ..Default::default()
        };
        for (status, ok_expected) in [
            (configured.clone(), true),
            (SecurityStatus { locked: true, ..configured.clone() }, false),
            (SecurityStatus { configured: false, ..configured.clone() }, false),
            (SecurityStatus { available: false, ..configured.clone() }, false),
        ] {
            let fake = Fake::new(status);
            let out = call(&handler(&fake), "POST", "/api/security/disable", "{}");
            assert_eq!(out.status == 200, ok_expected, "{}", text(&out));
            assert_eq!(fake.calls(), usize::from(ok_expected));
        }
        // GET or a non-empty body never reaches the controller.
        let fake = Fake::new(configured.clone());
        assert_ne!(call(&handler(&fake), "GET", "/api/security/disable", "").status, 200);
        assert_ne!(call(&handler(&fake), "POST", "/api/security/disable", r#"{"skip_login":true}"#).status, 200);
        assert_eq!(fake.calls(), 0);
        // A failed re-login is reported and nothing else happens.
        let fake = Arc::new(Fake {
            status: configured,
            login_err: Some("다른 계정"),
            ..Fake::default()
        });
        assert_eq!(call(&handler(&fake), "POST", "/api/security/disable", "{}").status, 409);
    }
}
