//! Info, library switching, encrypted copy, close (Go `info`/`openStorage` in `http.go`, `encrypted_copy_http.go`).

use crate::{empty_host_request, Handler, Request, Response};
use serde_json::json;
use std::time::{Duration, Instant};

const ENCRYPTED_COPY_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub(crate) fn info(h: &Handler) -> Response {
    let version = h.update.as_ref().map_or("0.1.0", |u| u.current());
    let n = &h.native;
    Response::json(
        200,
        &json!({
            "name": "Inkism", "version": version, "platform": "desktop", "draft_journal": true,
            "windowed_editor": h.windowed_editor, "lazy_editor": h.lazy_editor,
            "native_encrypted_copy": n.encrypted_copy.is_some(), "native_open_library": n.open_library.is_some(),
            "native_pdf_export": n.pdf_render.is_some(),
        }),
    )
}

/// The renderer cannot supply paths: the host picks the library in an OS dialog.
pub(crate) fn open(h: &Handler, r: &Request) -> Response {
    let Some(open_library) = &h.native.open_library else {
        return Response::fail(400, "저장소 선택은 Windows 앱에서 사용할 수 있습니다");
    };
    if let Some(rejected) = empty_host_request(r) {
        return rejected;
    }
    match open_library() {
        Ok(opened) => Response::json(200, &json!({"ok": true, "data": {"cancelled": !opened}})),
        Err(e) => Response::fail(500, e),
    }
}

/// The host chooses the destination; the copy runs to completion even if the
/// renderer's fetch ends.
pub(crate) fn encrypted_copy(h: &Handler, r: &Request) -> Response {
    let Some(copy) = &h.native.encrypted_copy else {
        return Response::fail(400, "암호화 복사는 Windows 앱에서 실행해 주세요");
    };
    if let Some(rejected) = empty_host_request(r) {
        return rejected;
    }
    match copy(Instant::now() + ENCRYPTED_COPY_TIMEOUT) {
        Ok(target) => Response::json(
            200,
            &json!({"ok": true, "data": {"cancelled": target.is_empty(), "path": target}}),
        ),
        Err(e) => Response::fail(500, e),
    }
}

pub(crate) fn close(h: &Handler) -> Response {
    if let Some(close) = &h.native.close {
        close();
    }
    Response::json(200, &json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use crate::engine::fake::request;
    use crate::{Handler, Native};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Instant;

    #[test]
    fn encrypted_copy_host_boundary() {
        for (name, body, content, origin, target, failure, want, calls) in [
            (
                "success",
                "{}",
                "application/json",
                "",
                r"C:\copy\notes.db",
                false,
                200,
                1,
            ),
            ("cancel", "{}", "application/json", "", "", false, 200, 1),
            ("failure", "{}", "application/json", "", "", true, 500, 1),
            (
                "path injection",
                r#"{"path":"C:\\existing"}"#,
                "application/json",
                "",
                "",
                false,
                400,
                0,
            ),
            (
                "cross origin",
                "{}",
                "application/json",
                "https://other.test",
                "",
                false,
                403,
                0,
            ),
            ("form", "{}", "text/plain", "", "", false, 415, 0),
            ("null", "null", "application/json", "", "", false, 400, 0),
            (
                "trailing",
                "{}{}",
                "application/json",
                "",
                "",
                false,
                400,
                0,
            ),
        ] {
            let count = Arc::new(AtomicUsize::new(0));
            let c = count.clone();
            let native = Native {
                encrypted_copy: Some(Box::new(move |deadline| {
                    c.fetch_add(1, Ordering::SeqCst);
                    assert!(
                        deadline > Instant::now(),
                        "request cancellation leaked into host operation"
                    );
                    if failure {
                        Err("copy failed".into())
                    } else {
                        Ok(target.to_string())
                    }
                })),
                ..Native::default()
            };
            let h = Handler {
                native,
                ..Handler::default()
            };
            let out = h.handle(&request(
                "POST",
                "localhost",
                "/api/storage/encrypted-copy",
                body,
                &[("Content-Type", content), ("Origin", origin)],
            ));
            let text = String::from_utf8_lossy(&out.body);
            assert!(
                out.status == want && count.load(Ordering::SeqCst) == calls,
                "{name}: {} {text}",
                out.status
            );
            if name == "cancel" {
                assert!(text.contains(r#""cancelled":true"#), "{text}");
            }
        }
        let out = Handler::default().handle(&request(
            "POST",
            "localhost",
            "/api/storage/encrypted-copy",
            "{}",
            &[],
        ));
        assert_eq!(out.status, 400, "unsupported host accepted copy");
    }

    #[test]
    fn open_library_cannot_receive_renderer_paths() {
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        let native = Native {
            open_library: Some(Box::new(move || {
                c.fetch_add(1, Ordering::SeqCst);
                Ok(false)
            })),
            ..Native::default()
        };
        let h = Handler {
            native,
            ..Handler::default()
        };
        for body in [r#"{"path":"C:\\other.db"}"#, "{}"] {
            let out = h.handle(&request(
                "POST",
                "localhost",
                "/api/storage/open",
                body,
                &[("Content-Type", "application/json")],
            ));
            if body == "{}" {
                assert!(
                    out.status == 200
                        && String::from_utf8_lossy(&out.body).contains(r#""cancelled":true"#)
                );
            } else {
                assert!(
                    out.status == 400 && count.load(Ordering::SeqCst) == 0,
                    "renderer selected a path"
                );
            }
        }
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn info_reports_native_capabilities() {
        let h = Handler {
            windowed_editor: true,
            native: Native {
                close: Some(Box::new(|| {})),
                ..Native::default()
            },
            ..Handler::default()
        };
        let out = h.handle(&request("GET", "x", "/api/info", "", &[]));
        let v: serde_json::Value = serde_json::from_slice(&out.body).unwrap();
        assert_eq!(v["version"], "0.1.0");
        assert!(
            v["windowed_editor"] == true
                && v["lazy_editor"] == false
                && v["native_open_library"] == false
        );
        let out = h.handle(&request("POST", "x", "/api/close", "", &[]));
        assert_eq!(
            (out.status, out.body.as_slice()),
            (200, b"{\"ok\":true}\n".as_slice())
        );
    }
}
