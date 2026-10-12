//! Read-only traversal of the encrypted relay journal. Restores create a new
//! local note only after every referenced immutable attachment verifies.
use crate::{attachment_sync, lock_ok, scope_allows, Result, RuntimeError, Svc};
use serde_json::{json, Value};
use sync_core::{ChangePayload, EntityKind, RelayClient};

fn bad(message: &str) -> RuntimeError {
    RuntimeError::config(message)
}
fn decode(key: &sync_core::Key, id: &str, blob: &str) -> Result<ChangePayload> {
    let bytes = sync_core::open_record(key, id, &sync_core::decode_blob(blob)?)?;
    let payload = ChangePayload::decode(&bytes)?;
    if payload.version != sync_core::PAYLOAD_VERSION {
        return Err(bad("unsupported history version"));
    }
    Ok(payload)
}
fn allowed(payload: &ChangePayload, id: &str, scope: &crate::SyncScope) -> bool {
    let e = &payload.entity;
    e.kind == EntityKind::Note
        && e.id == id
        && !e.deleted
        && e.data.get("locked_body").is_none_or(Value::is_null)
        && e.data.get("locked").and_then(Value::as_bool) != Some(true)
        && scope_allows(Some(scope), e)
}
impl Svc {
    pub(crate) fn remote_history(&self, op: &str, req: &Value) -> Result<Value> {
        // Configuration changes and the worker cannot interleave this read/restore.
        let _round = lock_ok(&self.round);
        let cfg = self.config().ok_or_else(|| bad("sync is not configured"))?;
        let note_id = req
            .get("note_id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .ok_or_else(|| bad("note_id is required"))?;
        // Respect the current local exclusion and vault lock as well as the
        // historical payload's scope; older membership must not bypass either.
        self.with_host(|conn| {
            let note = crate::host::build_raw_entity(conn, "note", note_id)?;
            if note.deleted
                || !scope_allows(Some(&cfg.scope), &note)
                || note.data.get("locked_body").is_some_and(|v| !v.is_null())
            {
                return Err(bad("note is unavailable or excluded from sync"));
            }
            Ok(())
        })?;
        let key = cfg.decode_key()?;
        let relay = RelayClient::new(&cfg.server_url, &cfg.token)?;
        if op == "remote_history_list" {
            let after = req.get("after").and_then(Value::as_u64).unwrap_or(0);
            let page = relay.get_changes(after, 100)?;
            let mut items = Vec::new();
            for record in &page.items {
                if record.seq <= after || record.seq > page.cursor {
                    return Err(bad("invalid history cursor"));
                }
                let p = decode(&key, &record.id, &record.blob)?;
                if allowed(&p, note_id, &cfg.scope) {
                    items.push(json!({"seq":record.seq,"record_id":record.id,"title":p.entity.data.get("title"),"created_at":p.ts,"device_id":p.device_id,"content_format":p.entity.data.get("content_format")}));
                }
            }
            // An empty page is the only reliable end marker: relay byte limits
            // can return a short page even when more records exist.
            return Ok(json!({"items":items,"cursor":page.cursor,"done":page.items.is_empty()}));
        }
        let seq = req
            .get("seq")
            .and_then(Value::as_u64)
            .filter(|n| *n > 0)
            .ok_or_else(|| bad("history sequence is required"))?;
        let expected = req
            .get("record_id")
            .and_then(Value::as_str)
            .ok_or_else(|| bad("record_id is required"))?;
        let page = relay.get_changes(seq - 1, 1)?;
        let record = page
            .items
            .first()
            .filter(|r| r.seq == seq && r.id == expected)
            .ok_or_else(|| bad("history version not found"))?;
        let payload = decode(&key, &record.id, &record.blob)?;
        if !allowed(&payload, note_id, &cfg.scope) {
            return Err(bad("history version is unavailable"));
        }
        let e = payload.entity;
        let content = e
            .data
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| bad("history has no source"))?;
        let format = e
            .data
            .get("content_format")
            .and_then(Value::as_str)
            .unwrap_or("html");
        if !["html", "markdown", "text"].contains(&format) {
            return Err(bad("unsupported source format"));
        }
        if op == "remote_history_preview" {
            return Ok(json!({"content":content,"content_format":format}));
        }
        if req.get("confirmed").and_then(Value::as_bool) != Some(true) {
            return Err(bad("explicit restoration confirmation required"));
        }
        let dir = tempfile::Builder::new()
            .prefix("inkism-history-")
            .tempdir()?;
        let manifests = attachment_sync::receive(&self.path, dir.path(), &cfg, &e, &self.storage)?;
        self.with_host(|conn| {
            for m in &manifests {
                attachment_sync::cache(conn, m)?;
            }
            Ok(())
        })?;
        let id = uuid::Uuid::new_v4().to_string();
        let engine = lock_ok(&self.engine);
        let current = crate::host::build_raw_entity(engine.connection(), "note", note_id)?;
        if current.deleted
            || !scope_allows(Some(&cfg.scope), &current)
            || current
                .data
                .get("locked_body")
                .is_some_and(|v| !v.is_null())
        {
            return Err(bad("note became unavailable during restoration"));
        }
        let result = engine.execute(json!({"op":"save","note":{
            "id":id,"require_absent":true,"title":format!("{} (remote version)", e.data.get("title").and_then(Value::as_str).unwrap_or("")),
            "content":content,"content_format":format,"text":e.data.get("text").and_then(Value::as_str).unwrap_or(content)
        }}));
        if result.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(RuntimeError::Engine(
                result
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("restore failed")
                    .into(),
            ));
        }
        self.shared.cv.notify_all();
        Ok(json!({"id":id,"attachment_count":manifests.len()}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };
    #[test]
    fn relay_history_restores_verified_asset_and_never_overwrites_source() {
        let tmp = tempfile::tempdir().unwrap();
        let source = "history-source";
        let bytes = b"historical immutable attachment bytes";
        let mut assets =
            inkism_engine::attachments::AttachmentStore::open(&tmp.path().join("source-assets"))
                .unwrap();
        let meta = assets
            .import_reader("asset.pdf", "application/pdf", &bytes[..])
            .unwrap();
        let key = sync_core::Key::generate();
        let chunk = sync_core::attachment::SealedChunk::encrypt(
            &key,
            &sync_core::attachment::ChunkContext {
                attachment_id: meta.id.clone(),
                index: 0,
                total_size: meta.size,
            },
            bytes,
        )
        .unwrap();
        let content = format!("[PDF](/api/attachments/{})\nold source", meta.id);
        let entity = sync_core::Entity::new(
            EntityKind::Note,
            source,
            json!({"title":"old title","content":content,"text":content,"content_format":"markdown","tags":[],"notebook_ids":[],"attachments":[{"version":1,"metadata":meta,"chunks":[chunk.id]}]}),
        );
        let payload = ChangePayload {
            version: 1,
            entity,
            device_id: "peer".into(),
            counter: 1,
            ts: 12345,
            vclock: Default::default(),
        };
        let record_id = uuid::Uuid::new_v4().to_string();
        let blob = sync_core::encode_blob(
            &sync_core::seal_record(&key, &record_id, &payload.encode().unwrap()).unwrap(),
        );
        let record = json!({"seq":1,"id":record_id,"blob":blob});
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_server = stop.clone();
        let missing = Arc::new(AtomicBool::new(true));
        let missing_server = missing.clone();
        let thread = std::thread::spawn(move || {
            while !stop_server.load(Ordering::SeqCst) {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                };
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req.split_whitespace().nth(1).unwrap();
                let (status, body) = if !req
                    .to_ascii_lowercase()
                    .contains("authorization: bearer synthetic-token")
                {
                    (401, b"unauthorized".to_vec())
                } else if path.starts_with("/v1/blobs/") {
                    if missing_server.load(Ordering::SeqCst) {
                        (404, Vec::new())
                    } else {
                        (200, chunk.ciphertext.clone())
                    }
                } else {
                    let after = url::Url::parse(&format!("http://local{path}"))
                        .unwrap()
                        .query_pairs()
                        .find(|(k, _)| k == "after")
                        .unwrap()
                        .1
                        .parse::<u64>()
                        .unwrap();
                    (200,serde_json::to_vec(&json!({"items":if after==0 {vec![record.clone()]}else{vec![]},"cursor":1})).unwrap())
                };
                let head = format!(
                    "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(head.as_bytes()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        let path = tmp.path().join("notes.db");
        let path = path.to_str().unwrap();
        let cfg = crate::StoredConfig {
            version: 1,
            server_url: format!("http://{address}"),
            token: "synthetic-token".into(),
            key: key.to_base64(),
            paused: true,
            state_generation: None,
            scope: Default::default(),
        };
        cfg.save(&format!("{path}.sync.json")).unwrap();
        let app = crate::AppCore::open(path).unwrap();
        assert_eq!(app.execute(json!({"op":"save","note":{"id":source,"title":"current","content":"current source","content_format":"markdown"}}))["ok"],true);
        let list = app.execute(json!({"op":"remote_history_list","note_id":source}));
        assert_eq!(list["data"]["items"][0]["seq"], 1, "{list}");
        assert_eq!(
            app.execute(json!({"op":"remote_history_list","note_id":source,"after":1}))["data"]
                ["done"],
            true
        );
        let request = json!({"op":"remote_history_restore","note_id":source,"seq":1,"record_id":record_id,"confirmed":true});
        let failed = app.execute(request.clone());
        assert_eq!(failed["ok"], false, "{failed}");
        assert!(failed["error"].as_str().unwrap().contains("missing"));
        assert_eq!(
            app.execute(json!({"op":"get","id":source}))["data"]["content"],
            "current source"
        );
        missing.store(false, Ordering::SeqCst);
        let restored = app.execute(request.clone());
        assert_eq!(restored["ok"], true, "{restored}");
        let copy = app.execute(json!({"op":"get","id":restored["data"]["id"]}));
        assert_eq!(copy["data"]["content"], content);
        assert_eq!(copy["data"]["content_format"], "markdown");
        let assets = inkism_engine::attachments::AttachmentStore::open(std::path::Path::new(
            &format!("{path}.attachments"),
        ))
        .unwrap();
        let mut restored_bytes = Vec::new();
        assets.copy_to(&meta.id, &mut restored_bytes).unwrap();
        assert_eq!(restored_bytes, bytes);
        let mut wrong = request.clone();
        wrong["record_id"] = json!("wrong");
        assert_eq!(app.execute(wrong)["ok"], false);
        let mut no_confirmation = request;
        no_confirmation["confirmed"] = json!(false);
        assert_eq!(app.execute(no_confirmation)["ok"], false);
        {
            let mut config = lock_ok(&app.svc.config);
            config.as_mut().unwrap().scope.tags = vec!["excluded".into()];
        }
        assert_eq!(
            app.execute(json!({"op":"remote_history_list","note_id":source}))["ok"],
            false
        );
        stop.store(true, Ordering::SeqCst);
        thread.join().unwrap();
    }
    #[test]
    fn history_authentication_and_locked_scope_fail_closed() {
        let key = sync_core::Key::generate();
        let wrong = sync_core::Key::generate();
        let payload = ChangePayload {
            version: 1,
            entity: sync_core::Entity::new(
                EntityKind::Note,
                "n",
                json!({"locked_body":{"ciphertext":"private"}}),
            ),
            device_id: "d".into(),
            counter: 1,
            ts: 1,
            vclock: Default::default(),
        };
        let blob = sync_core::encode_blob(
            &sync_core::seal_record(&key, "record", &payload.encode().unwrap()).unwrap(),
        );
        assert!(decode(&wrong, "record", &blob).is_err());
        assert!(decode(&key, "tampered-id", &blob).is_err());
        assert!(!allowed(&payload, "n", &Default::default()));
    }
}
