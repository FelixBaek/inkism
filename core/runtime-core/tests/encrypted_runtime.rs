#![cfg(feature = "encrypted-storage")]
mod common;
use common::{Relay, TOKEN};
use inkism_runtime::{
    local_storage::{LocalStorage, StorageKey},
    AppCore,
};
use serde_json::{json, Value};
use std::path::Path;
fn call(app: &AppCore, request: Value) -> Value {
    let r = app.execute(request);
    assert_eq!(r["ok"], true, "{r}");
    r["data"].clone()
}
fn sync(app: &AppCore) {
    call(app, json!({"op":"sync_now"}));
    assert!(app.wait_sync_idle(30000));
    let s = call(app, json!({"op":"sync_status"}));
    assert!(s["error"].is_null(), "{s}");
}
fn scan(dir: &Path) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            scan(&path);
            continue;
        }
        // Windows byte-range locks can briefly cover the SHM/checkpoint data.
        // Keep scanning every live file (including WAL), retry only this OS
        // error, and report the exact path if the lock does not clear.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let bytes = loop {
            match std::fs::read(&path) {
                Ok(bytes) => break bytes,
                Err(error)
                    if cfg!(windows)
                        && error.raw_os_error() == Some(33)
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(error) => panic!("cannot scan {}: {error}", path.display()),
            }
        };
        for marker in [
            b"private-runtime-title".as_slice(),
            b"private-runtime-body",
            b"private-runtime-file",
        ] {
            assert!(
                !bytes.windows(marker.len()).any(|v| v == marker),
                "plaintext note/attachment on disk"
            );
        }
    }
}
#[test]
fn encrypted_runtime_syncs_notes_files_and_reopens_all_databases() {
    let relay = Relay::start().expect("real Rust relay");
    let dir = tempfile::tempdir().unwrap();
    let ap = dir.path().join("a.db");
    let bp = dir.path().join("b.db");
    let ka = StorageKey::from_bytes([11; 32]);
    let kb = StorageKey::from_bytes([12; 32]);
    let a = AppCore::open_encrypted(ap.to_str().unwrap(), ka.clone()).unwrap();
    let b = AppCore::open_encrypted(bp.to_str().unwrap(), kb.clone()).unwrap();
    let source = b"private-runtime-file".repeat(40000);
    let file = {
        let mut store = LocalStorage::encrypted(ka.clone())
            .attachments(Path::new(&format!("{}.attachments", ap.display())))
            .unwrap();
        store
            .import_reader(
                "private-runtime-title.bin",
                "application/octet-stream",
                source.as_slice(),
            )
            .unwrap()
    };
    let html = format!(
        "<p>private-runtime-body <a href=\"/api/attachments/{}\">file</a></p>",
        file.id
    );
    let note = call(
        &a,
        json!({"op":"save","note":{"title":"private-runtime-title","content":html,"text":"private-runtime-body"}}),
    );
    let vault = sync_core::Key::generate().to_base64();
    for app in [&a, &b] {
        assert!(app.wait_sync_idle(30000));
        call(
            app,
            json!({"op":"sync_config","server_url":relay.url,"token":TOKEN,"key":vault}),
        );
        sync(app);
    }
    let received = call(&b, json!({"op":"get","id":note["id"]}));
    assert_eq!(received["content"], html);
    let assets = LocalStorage::encrypted(kb.clone())
        .attachments(Path::new(&format!("{}.attachments", bp.display())))
        .unwrap();
    let mut bytes = vec![];
    assets.copy_to(&file.id, &mut bytes).unwrap();
    assert_eq!(bytes, source);
    drop(assets);
    scan(dir.path());
    drop(b);
    assert!(AppCore::open(bp.to_str().unwrap()).is_err());
    assert!(AppCore::open_encrypted(bp.to_str().unwrap(), ka.clone()).is_err());
    let b = AppCore::open_encrypted(bp.to_str().unwrap(), kb).unwrap();
    let mut edited = call(&b, json!({"op":"get","id":note["id"]}));
    edited["title"] = json!("private-runtime-title edited");
    call(&b, json!({"op":"save","note":edited}));
    sync(&b);
    sync(&a);
    assert_eq!(
        call(&a, json!({"op":"get","id":note["id"]}))["title"],
        "private-runtime-title edited"
    );
    call(&a, json!({"op":"wait_index"}));
    assert_eq!(
        call(
            &a,
            json!({"op":"list","view":"all","query":"private-runtime-body"})
        )["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    scan(dir.path());
}

#[test]
fn encrypted_incoming_failure_preserves_bytes_and_allows_later_note_after_restart() {
    use sync_core::{Entity, EntityKind, Key, SyncConfig, SyncEngine};
    let relay = Relay::start().expect("real Rust relay");
    let dir = tempfile::tempdir().unwrap();
    let vault = Key::generate();
    let writer = SyncEngine::open(SyncConfig::new(
        dir.path().join("writer.sync"),
        &relay.url,
        TOKEN,
        vault.clone(),
    ))
    .unwrap();
    let bad = uuid::Uuid::new_v4().to_string();
    let good = uuid::Uuid::new_v4().to_string();
    let failed = writer
        .stage_local(
            Entity::new(
                EntityKind::Note,
                &bad,
                json!({"title":123,"text":"private-runtime-body"}),
            ),
            1,
        )
        .unwrap()
        .event_id;
    writer.push().unwrap();
    writer
        .stage_local(
            Entity::new(
                EntityKind::Note,
                &good,
                json!({"title":"private-runtime-title","text":"private-runtime-body"}),
            ),
            2,
        )
        .unwrap();
    writer.push().unwrap();
    let path = dir.path().join("encrypted/receiver.db");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let key = StorageKey::from_bytes([27; 32]);
    let app = AppCore::open_encrypted(path.to_str().unwrap(), key.clone()).unwrap();
    assert!(app.wait_sync_idle(30000));
    call(
        &app,
        json!({"op":"sync_config","server_url":relay.url,"token":TOKEN,"key":vault.to_base64()}),
    );
    call(&app, json!({"op":"sync_now"}));
    assert!(app.wait_sync_idle(30000));
    assert!(call(&app, json!({"op":"sync_status"}))["error"].is_string());
    assert_eq!(
        call(&app, json!({"op":"get","id":good}))["text"],
        "private-runtime-body"
    );
    let queued = || {
        let db = inkism_storage::open(
            std::path::Path::new(
                &inkism_runtime::StoredConfig::load(&format!("{}.sync.json", path.display()))
                    .unwrap()
                    .unwrap()
                    .state_path(path.to_str().unwrap())
                    .unwrap(),
            ),
            Some(&key),
        )
        .unwrap();
        db.query_row(
            "SELECT state, payload FROM incoming WHERE event_id = ?1",
            [&failed],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)),
        )
        .unwrap()
    };
    let original = queued();
    assert_eq!(original.0, "pending");
    assert!(!original.1.is_empty());
    drop(app);
    let app = AppCore::open_encrypted(path.to_str().unwrap(), key.clone()).unwrap();
    call(&app, json!({"op":"sync_now"}));
    assert!(app.wait_sync_idle(30000));
    assert_eq!(queued(), original);
    assert_eq!(
        call(&app, json!({"op":"get","id":good}))["title"],
        "private-runtime-title"
    );
    assert_eq!(app.execute(json!({"op":"get","id":bad}))["ok"], false);
    scan(path.parent().unwrap());
}
