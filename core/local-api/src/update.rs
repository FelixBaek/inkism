//! App update endpoints (Go `update_http.go`): `/api/update/{status,check,apply}`.
//! Apply only downloads, verifies and stages; the renderer then closes the app
//! through its normal save-and-close path and a helper swaps the files.

use crate::{Handler, Request, Response};
use serde_json::json;

pub(crate) fn serve(h: &Handler, r: &Request) -> Response {
    let Some(update) = &h.update else {
        return Response::fail(404, "업데이트를 쓸 수 없습니다");
    };
    if r.method == "POST" {
        if let Some(rejected) = crate::empty_host_request(r) {
            return rejected;
        }
    }
    // ponytail: Updater has no deadline parameter, so Go's 1 min / 15 min
    // limits rest on its own HTTP client timeouts.
    match (r.method.as_str(), r.path.as_str()) {
        ("GET", "/api/update/status") => Response::json(200, &json!({"ok": true, "data": update.status()})),
        ("POST", "/api/update/check") => Response::json(200, &json!({"ok": true, "data": update.check()})),
        ("POST", "/api/update/apply") => match update.apply() {
            Ok(()) => Response::json(200, &json!({"ok": true, "data": update.status()})),
            Err(e) => Response::fail(409, e),
        },
        _ => Response::fail(404, "not found"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::REQUEST_TIMEOUT;
    use std::sync::Arc;
    use std::time::Instant;

    fn handler() -> Handler {
        let dir = std::env::temp_dir().join(format!("inkism-update-http-{}", std::process::id()));
        let updater = app_update::Updater::new("0.1.0", "abc1234", "https://127.0.0.1:1/", dir, Vec::new());
        Handler { update: Some(Arc::new(updater)), host: "app".into(), ..Default::default() }
    }

    fn call(h: &Handler, method: &str, path: &str, origin: &str, content_type: &str) -> (u16, String) {
        let mut headers = Vec::new();
        if !origin.is_empty() {
            headers.push(("origin".to_string(), origin.to_string()));
        }
        if !content_type.is_empty() {
            headers.push(("content-type".to_string(), content_type.to_string()));
        }
        let r = Request {
            method: method.into(),
            path: path.into(),
            query: None,
            headers,
            host: "app".into(),
            body: b"{}".to_vec(),
        };
        let w = h.same_origin(&r).unwrap_or_else(|| h.route(&r, Instant::now() + REQUEST_TIMEOUT));
        (w.status, String::from_utf8_lossy(&w.body).into_owned())
    }

    #[test]
    fn update_status_and_origin() {
        let h = handler();
        let (code, body) = call(&h, "GET", "/api/update/status", "", "");
        assert!(code == 200 && body.contains(r#""current":"0.1.0""#), "{code} {body}");
        assert_eq!(call(&h, "POST", "/api/update/apply", "http://evil.example", "application/json").0, 403);
        assert_eq!(call(&Handler::default(), "GET", "/api/update/status", "", "").0, 404);
    }

    // Needs `crate::empty_host_request`, owned by the storage port.
    #[test]
    fn update_apply_requires_json_and_reports_platform() {
        let h = handler();
        assert_eq!(call(&h, "POST", "/api/update/apply", "", "text/plain").0, 415, "non-JSON apply accepted");
        if !cfg!(windows) {
            let (code, body) = call(&h, "POST", "/api/update/apply", "http://app", "application/json");
            assert!(code == 409 && body.contains("설치할 수 없습니다"), "{code} {body}");
        }
    }
}
