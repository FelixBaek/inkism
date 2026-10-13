//! Reminder settings and cache invalidation (Go `reminders.go`).

use crate::{Handler, Request, Response};
use inkism_reminders::Ctx;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::time::Duration;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SettingsRequest {
    enabled: Option<bool>,
    background: Option<bool>,
}

pub(crate) fn settings(h: &Handler, r: &Request) -> Response {
    if r.method == "GET" {
        return Response::json(
            200,
            &match &h.reminders {
                None => json!({"available": false}),
                Some(s) => json!({
                    "available": true,
                    "enabled": s.enabled(),
                    "delivery_error": s.last_error(),
                    "background": s.background_enabled(),
                    "background_available": s.background_available(),
                }),
            },
        );
    }
    if r.method != "POST" {
        return Response::fail(405, "method not allowed");
    }
    let Some(service) = &h.reminders else {
        return Response::fail(400, "Windows 앱에서 사용할 수 있습니다");
    };
    if !r.header("content-type").unwrap_or("").starts_with("application/json") {
        return Response::fail(415, "JSON required");
    }
    if r.body.len() > 1024 {
        return Response::fail(400, "invalid settings");
    }
    let mut de = serde_json::Deserializer::from_slice(&r.body);
    let Ok(req) = SettingsRequest::deserialize(&mut de) else {
        return Response::fail(400, "invalid settings");
    };
    if de.end().is_err() || req.enabled.is_none() == req.background.is_none() {
        return Response::fail(400, "one settings operation required");
    }
    let result = match (req.enabled, req.background) {
        (Some(enabled), _) => service.set_enabled(enabled),
        (_, Some(background)) => service.set_background(&Ctx::new().with_timeout(Duration::from_secs(15)), background),
        _ => unreachable!(),
    };
    match result {
        Ok(()) => Response::json(200, &json!({"ok": true})),
        Err(e) => Response::fail(400, e),
    }
}

/// Whether an RPC changes reminders, so the cache must be invalidated first.
/// Ordinary source/body/title edits never trigger it.
pub(crate) fn mutation(raw: &[u8]) -> bool {
    #[derive(Deserialize)]
    struct Rpc {
        #[serde(default)]
        op: String,
        note: Option<Map<String, Value>>,
        changes: Option<Map<String, Value>>,
    }
    let Ok(req) = serde_json::from_slice::<Rpc>(raw) else {
        return false;
    };
    let fields = match req.op.as_str() {
        "delete" | "trash_purge" | "restore" | "import" | "sync_now" | "delete_notebook" | "trash_notebook" | "restore_notebook" | "merge_notes" | "merge_apply" | "merge_undo" => return true,
        "save" => req.note,
        "patch" => req.changes,
        _ => return false,
    };
    fields.is_some_and(|f| ["reminder_at", "reminder_repeat_hours", "trashed"].iter().any(|k| f.contains_key(*k)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::REQUEST_TIMEOUT;
    use std::sync::Arc;
    use std::time::Instant;

    struct NoEngine;
    impl inkism_reminders::Caller for NoEngine {
        fn call(&self, _: &Ctx, _: &str) -> inkism_reminders::Result<String> {
            Err(inkism_reminders::Error::Msg("no engine".into()))
        }
    }

    #[test]
    fn reminder_settings_boundaries() {
        let dir = std::env::temp_dir().join(format!("inkism-reminder-settings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let service = Arc::new(
            inkism_reminders::Service::new(dir.join("state"), Box::new(NoEngine), Box::new(inkism_reminders::NoopNotifier))
                .unwrap(),
        );
        let h = Handler { reminders: Some(service.clone()), ..Default::default() };
        for (body, origin, status) in [
            (r#"{"enabled":true}"#, "", 200),
            (r#"{"enabled":false,"surprise":1}"#, "", 400),
            (r#"{"enabled":false}{}"#, "", 400),
            (r#"{"enabled":false}"#, "https://evil.example", 403),
            ("{}", "", 400),
        ] {
            let mut headers = vec![("content-type".to_string(), "application/json".to_string())];
            if !origin.is_empty() {
                headers.push(("origin".into(), origin.into()));
            }
            let r = Request {
                method: "POST".into(),
                path: "/api/reminders/settings".into(),
                query: None,
                headers,
                host: "localhost".into(),
                body: body.as_bytes().to_vec(),
            };
            let w = h.same_origin(&r).unwrap_or_else(|| h.route(&r, Instant::now() + REQUEST_TIMEOUT));
            assert_eq!(w.status, status, "{body}: {}", String::from_utf8_lossy(&w.body));
        }
        let enabled = service.enabled();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(enabled, "rejected writes changed opt-in");
    }

    #[test]
    fn reminder_mutation_does_not_scan_for_typing() {
        for raw in [
            r#"{"op":"source_splice","replacement":"x"}"#,
            r#"{"op":"save","note":{"content":"typing","content_format":"text"}}"#,
            r#"{"op":"patch","changes":{"title":"name"}}"#,
            r#"{"op":"document_splice_html","edits":[]}"#,
        ] {
            assert!(!mutation(raw.as_bytes()), "ordinary editing invalidated schedule cache: {raw}");
        }
        for raw in [
            r#"{"op":"patch","changes":{"reminder_at":null}}"#,
            r#"{"op":"save","note":{"reminder_repeat_hours":24}}"#,
            r#"{"op":"patch","changes":{"trashed":true}}"#,
            r#"{"op":"import"}"#,
            r#"{"op":"delete"}"#,
            r#"{"op":"sync_now"}"#,
            r#"{"op":"merge_notes"}"#,
            r#"{"op":"merge_apply"}"#,
            r#"{"op":"merge_undo"}"#,
            r#"{"op":"restore_notebook"}"#,
        ] {
            assert!(mutation(raw.as_bytes()), "missed schedule mutation: {raw}");
        }
    }
}
