//! Renderer RPC passthrough (Go `rendererRPC` and `rpc` in `http.go`).

use crate::{reminders, Deadline, Handler, Request, Response};
use std::time::{Duration, Instant};

/// File paths are trusted host operations, never arbitrary renderer RPC.
const RENDERER_OPS: &[&str] = &[
    "draft_journal_put",
    "draft_journal_clear",
    "draft_journal_status",
    "document_render",
    "document_splice_source",
    "convert_content",
    "due_reminders",
    "list",
    "get", "note_preview", "random_note",
    "document_blocks",
    "document_block_window",
    "document_segments",
    "document_locate",
    "document_info",
    "document_find",
    "document_splice",
    "document_splice_html",
    "save",
    "patch",
    "delete",
    "notebooks",
    "notebook_counts",
    "save_notebook",
    "delete_notebook",
    "trash_notebook",
    "restore_notebook",
    "trashed_notebooks",
    "knowledge_get", "knowledge_set", "knowledge_list", "knowledge_settings_get", "knowledge_settings_set", "merge_notes", "merge_preview", "merge_apply", "merge_undo", "merge_changes",
    "link_resolve", "graph_get", "daily_note", "template_create", "page_create",
    "defaults_get",
    "defaults_set",
    "vault_status",
    "vault_create",
    "vault_unlock",
    "vault_lock",
    "vault_change_password",
    "vault_lock_note",
    "vault_open", "vault_versions",
    "vault_save",
    "vault_unlock_note",
    "vault_clear",
    "vault_delete",
    "tags",
    "change_tag",
    "tag_change_preview",
    "tag_change_apply",
    "tag_change_undo",
    "tag_change_list",
    "stats",
    "trash_retention_get", "trash_retention_set", "trash_times", "trash_purge",
    "history", "history_name_current", "history_rename", "history_delete_named", "history_body", "history_changes",
    "history_sealed",
    "revision_body",
    "restore",
    "health",
    "backlinks", "reference_preview", "reference_candidates", "outgoing_references", "unlinked_mentions", "backlink_location", "backlink_blocks", "outgoing_links",
    "index_status",
    "wait_index",
    "workspace_tools_get", "workspace_tools_set", "font_resources", "font_resource_set",
    "workspace_get",
    "workspace_set",
    "split_get",
    "split_set",
    "editor_history_get",
    "editor_history_set",
    "storage_status",
    "remote_history_list",
    "remote_history_preview",
    "remote_history_restore",
    "sync_scope",
    "sync_status",
    "sync_config",
    "sync_now",
    "sync_pause",
    "sync_keygen",
];

pub(crate) fn renderer(h: &Handler, r: &Request, deadline: Deadline) -> Response {
    if !r
        .header("content-type")
        .unwrap_or("")
        .starts_with("application/json")
    {
        return Response::fail(415, "JSON required");
    }
    if r.body.len() > crate::engine::MAX_MESSAGE - 1 {
        return Response::fail(413, "http: request body too large");
    }
    // Go decodes into map[string]json.RawMessage: any object, or null.
    let Ok(request) =
        serde_json::from_slice::<Option<serde_json::Map<String, serde_json::Value>>>(&r.body)
    else {
        return Response::fail(400, "invalid JSON");
    };
    let op = request
        .as_ref()
        .and_then(|m| m.get("op")?.as_str())
        .unwrap_or("");
    if !RENDERER_OPS.contains(&op) {
        return Response::fail(400, "unsupported operation");
    }
    forward(h, &r.body, deadline)
}

/// Forwards one already-validated request to the engine (Go `Handler.rpc`).
pub(crate) fn forward(h: &Handler, raw: &[u8], deadline: Deadline) -> Response {
    let mut wake = None;
    if let Some(service) = h.reminders.as_ref().filter(|_| reminders::mutation(raw)) {
        let budget = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_secs(3));
        if service
            .invalidate_cache(&inkism_reminders::Ctx::new().with_timeout(budget))
            .is_err()
        {
            return Response::fail(503, "알림 캐시를 갱신하지 못했습니다. 다시 시도해 주세요");
        }
        wake = Some(service);
    }
    let response = match h.engine() {
        Ok(engine) => match engine.call(deadline, raw) {
            Ok(body) => {
                let status = if crate::success(&body) { 200 } else { 400 };
                Response {
                    status,
                    headers: vec![("content-type".into(), "application/json".into())],
                    body,
                }
            }
            Err(e) => Response::fail(500, e),
        },
        Err(e) => Response::fail(500, e),
    };
    if let Some(service) = wake {
        service.wake();
    }
    response
}

#[cfg(test)]
mod tests {
    use crate::engine::fake::{request, FakeEngine};
    use crate::Handler;
    use std::sync::Arc;

    #[test]
    fn rpc_rejects_cross_origin_and_paths() {
        let engine = Arc::new(FakeEngine::default());
        let h = Handler {
            engine: Some(engine),
            host: "127.0.0.1:47831".into(),
            ..Handler::default()
        };
        let local = "127.0.0.1:47831";
        let same = "http://127.0.0.1:47831";
        let evil = "http://evil.test";
        let json = "application/json";
        for (body, origin, host, content, code) in [
            (
                r#"{"op":"save","note":{"title":"a"}}"#,
                "http://evil.test",
                local,
                json,
                403,
            ),
            (
                r#"{"op":"export","path":"/etc/password"}"#,
                "",
                local,
                json,
                400,
            ),
            (r#"{"op":"get"}"#, "", "attacker.test", json, 403),
            (r#"{"op":"save"}"#, "", local, "text/plain", 415),
            (
                r#"{"op":"document_find","id":"note-id","revision":1,"query":"한글"}"#,
                same,
                local,
                json,
                200,
            ),
            (
                r#"{"op":"document_blocks","id":"note-id","offset":128,"limit":32}"#,
                same,
                local,
                json,
                200,
            ),
            (
                r#"{"op":"document_info","id":"note-id"}"#,
                same,
                local,
                json,
                200,
            ),
            (
                r#"{"op":"document_block_window","id":"note-id","revision":1,"ordinal":0,"offset":4,"limit":64}"#,
                same,
                local,
                json,
                200,
            ),
            (
                r#"{"op":"document_block_window","id":"note-id","revision":1,"ordinal":0}"#,
                evil,
                local,
                json,
                403,
            ),
            (
                r#"{"op":"document_segments","id":"note-id","revision":1,"ordinal":0,"offset":2,"limit":1}"#,
                same,
                local,
                json,
                200,
            ),
            (
                r#"{"op":"document_segments","id":"note-id","revision":1,"ordinal":0}"#,
                evil,
                local,
                json,
                403,
            ),
            (
                r#"{"op":"document_locate","id":"note-id","revision":1,"byte_offset":16384,"bias":"before"}"#,
                same,
                local,
                json,
                200,
            ),
            (
                r#"{"op":"document_locate","id":"note-id","revision":1,"byte_offset":0}"#,
                evil,
                local,
                json,
                403,
            ),
            (
                r#"{"op":"document_splice_html","id":"note-id","revision":1}"#,
                same,
                local,
                json,
                200,
            ),
            (
                r#"{"op":"document_splice","id":"note-id","revision":1}"#,
                same,
                local,
                json,
                200,
            ),
            (r#"{"op":"list"}"#, same, local, json, 200),
        ] {
            let out = h.handle(&request(
                "POST",
                host,
                "/api/rpc",
                body,
                &[("Origin", origin), ("Content-Type", content)],
            ));
            assert_eq!(out.status, code, "{body}");
        }
    }

    #[test]
    fn extended_workspace_operations_reach_renderer_engine() {
        let engine = Arc::new(FakeEngine::default());
        let h = Handler { engine: Some(engine.clone()), ..Handler::default() };
        for op in ["note_preview", "workspace_tools_get", "workspace_tools_set", "font_resources", "font_resource_set", "merge_notes", "merge_preview", "merge_apply", "merge_undo", "merge_changes", "remote_history_list", "remote_history_preview", "remote_history_restore", "sync_scope"] {
            let body = format!(r#"{{"op":"{op}"}}"#);
            let out = h.handle(&request("POST", "inkism.local", "/api/rpc", &body, &[("Content-Type", "application/json")]));
            assert_eq!(out.status, 200, "renderer rejected {op}");
            assert_eq!(engine.last().unwrap(), body.as_bytes(), "renderer did not forward {op}");
        }
    }

    #[test]
    fn trash_and_folder_count_operations_reach_renderer_engine() {
        let engine = Arc::new(FakeEngine::default());
        let h = Handler { engine: Some(engine.clone()), ..Handler::default() };
        for op in ["notebook_counts", "history_changes", "history_sealed", "trash_retention_get", "trash_retention_set", "trash_times", "trash_purge"] {
            let body = format!(r#"{{"op":"{op}"}}"#);
            let out = h.handle(&request("POST", "inkism.local", "/api/rpc", &body, &[("Content-Type", "application/json")]));
            assert_eq!(out.status, 200, "renderer rejected {op}");
            assert_eq!(engine.last().unwrap(), body.as_bytes(), "renderer did not forward {op}");
        }
        assert!(crate::reminders::mutation(br#"{"op":"trash_purge"}"#), "purge must refresh reminders");
    }

    #[test]
    fn recovery_operations_never_reach_renderer_engine() {
        let engine = Arc::new(FakeEngine::default());
        let h = Handler {
            engine: Some(engine.clone()),
            ..Handler::default()
        };
        for op in ["sync_recovery_export", "sync_recovery_import", "sync_relay_token"] {
            let body = format!(r#"{{"op":"{op}","confirmed_server_recovery":true}}"#);
            let out = h.handle(&request(
                "POST",
                "inkism.local",
                "/api/rpc",
                &body,
                &[("Content-Type", "application/json")],
            ));
            assert!(
                out.status == 400 && engine.last().is_none(),
                "renderer reached host recovery {op} {}",
                out.status
            );
        }
    }

    #[test]
    fn engine_reply_passes_through_unchanged() {
        let engine = Arc::new(FakeEngine::default());
        let h = Handler {
            engine: Some(engine.clone()),
            ..Handler::default()
        };
        let out = h.handle(&request(
            "POST",
            "x",
            "/api/rpc",
            "{ \"op\": \"get\" }",
            &[("Content-Type", "application/json")],
        ));
        assert_eq!(
            (out.status, out.body.as_slice()),
            (200, br#"{"ok":true,"data":{}}"#.as_slice())
        );
        assert_eq!(
            engine.last().unwrap(),
            b"{ \"op\": \"get\" }",
            "the engine compacts, the handler forwards"
        );
        for body in ["null", "[]", "{", r#"{"op":7}"#] {
            let out = h.handle(&request(
                "POST",
                "x",
                "/api/rpc",
                body,
                &[("Content-Type", "application/json")],
            ));
            assert_eq!(out.status, 400, "{body}");
        }
    }
}
