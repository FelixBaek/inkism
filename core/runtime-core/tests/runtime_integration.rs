//! End-to-end runtime tests: real Rust relay process, real encryption, real
//! SQLite note + sync state databases, real background worker.
//!
//! Each test starts its own relay (see `common`); a relay that cannot be built
//! or started fails the test. `main` runs the full end-to-end flow.

mod common;

use common::{Relay, TOKEN};
use inkism_runtime::AppCore;
use serde_json::{json, Value};
use sync_core::Key;

fn call(app: &AppCore, req: Value) -> Value {
    let resp = app.execute(req);
    assert!(resp["ok"].as_bool().unwrap_or(false), "rpc failed: {resp}");
    resp["data"].clone()
}

fn raw(app: &AppCore, req: Value) -> Value {
    app.execute(req)
}

fn configure(app: &AppCore, url: &str, key: &str) {
    let data = call(
        app,
        json!({ "op": "sync_config", "server_url": url, "token": TOKEN, "key": key }),
    );
    assert_eq!(data["configured"], true);
}

/// Queue a sync and block until the worker has served it.
fn sync(app: &AppCore) {
    let data = call(app, json!({ "op": "sync_now" }));
    assert_eq!(data["queued"], true);
    assert!(app.wait_sync_idle(30_000), "sync round did not settle");
}

fn open_at(dir: &std::path::Path, name: &str) -> AppCore {
    let path = dir.join(name);
    AppCore::open(path.to_str().unwrap()).expect("open runtime")
}

fn save_note(app: &AppCore, note: Value) -> Value {
    call(app, json!({ "op": "save", "note": note }))
}

fn get_note(app: &AppCore, id: &str) -> Value {
    call(app, json!({ "op": "get", "id": id }))
}

fn all_notes(app: &AppCore) -> Vec<Value> {
    let page = call(app, json!({ "op": "list", "view": "all", "limit": 100 }));
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| get_note(app, item["id"].as_str().unwrap()))
        .collect()
}

// ---------------------------------------------------------------------------
// Direct engine delegation
// ---------------------------------------------------------------------------

#[test]
fn local_engine_apis_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let app = open_at(dir.path(), "local.db");

    let note = save_note(
        &app,
        json!({ "title": "제목", "content": "<p>본문</p>", "text": "본문", "tags": ["업무", "메모"] }),
    );
    let id = note["id"].as_str().unwrap().to_string();
    assert_eq!(note["revision"], 1);
    assert_eq!(note["text"], "본문");

    let notebook = call(
        &app,
        json!({ "op": "save_notebook", "name": "업무", "color": "#abc" }),
    );
    let nb_id = notebook["id"].as_str().unwrap().to_string();

    let patched = call(
        &app,
        json!({ "op": "patch", "id": id, "changes": { "favorite": true, "notebook_id": nb_id, "tags": ["x"] } }),
    );
    assert_eq!(patched["favorite"], true);
    assert_eq!(patched["notebook_id"], nb_id);
    assert_eq!(patched["tags"], json!(["x"]));
    assert_eq!(patched["revision"], 2);

    let listed = call(&app, json!({ "op": "list", "view": "all" }));
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);

    let stats = call(&app, json!({ "op": "stats" }));
    assert_eq!(stats["notes"], 1);
    assert_eq!(stats["favorites"], 1);

    // Status before configuration: not configured, no secrets.
    let status = call(&app, json!({ "op": "sync_status" }));
    assert_eq!(status["configured"], false);
    assert!(status["server_url"].is_null());
}

// ---------------------------------------------------------------------------
// Two-device scenarios over the real relay
// ---------------------------------------------------------------------------

#[test]
fn create_on_a_syncs_to_b_with_exact_id() {
    let relay =
        Relay::start().expect("actual Rust relay must build and start (or set INKISM_RELAY_BIN)");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate().to_base64();

    let a = open_at(dir.path(), "a.db");
    configure(&a, &relay.url, &key);
    let created = save_note(
        &a,
        json!({ "title": "Hello", "content": "<p>from A</p>", "text": "from-A" }),
    );
    let id = created["id"].as_str().unwrap().to_string();
    sync(&a);

    let b = open_at(dir.path(), "b.db");
    configure(&b, &relay.url, &key);
    sync(&b);

    let got = get_note(&b, &id);
    assert_eq!(got["id"], id);
    assert_eq!(got["title"], "Hello");
    assert_eq!(got["text"], "from-A");
    assert_eq!(got["content"], "<p>from A</p>");
}

#[test]
fn offline_concurrent_edits_preserve_both_sides() {
    let relay =
        Relay::start().expect("actual Rust relay must build and start (or set INKISM_RELAY_BIN)");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate().to_base64();

    let a = open_at(dir.path(), "a.db");
    configure(&a, &relay.url, &key);
    let id = save_note(&a, json!({ "title": "Shared", "text": "base" }))["id"]
        .as_str()
        .unwrap()
        .to_string();
    sync(&a);
    let b = open_at(dir.path(), "b.db");
    configure(&b, &relay.url, &key);
    sync(&b);
    assert_eq!(get_note(&b, &id)["text"], "base");

    // Both edit while "offline" (no sync between the edits).
    save_note(&a, json!({ "id": id, "title": "A edit", "text": "A-text" }));
    save_note(&b, json!({ "id": id, "title": "B edit", "text": "B-text" }));

    // Alternate syncs so each side observes the other's concurrent edit.
    sync(&a);
    sync(&b);
    sync(&a);

    let collect = |app: &AppCore| -> Vec<String> {
        all_notes(app)
            .iter()
            .map(|n| n["text"].as_str().unwrap().to_string())
            .collect()
    };
    let texts_a = collect(&a);
    let texts_b = collect(&b);
    for texts in [&texts_a, &texts_b] {
        assert!(texts.contains(&"A-text".to_string()), "lost A: {texts:?}");
        assert!(texts.contains(&"B-text".to_string()), "lost B: {texts:?}");
    }
    // Both replicas converge on the same note ids, and a conflict copy exists.
    let mut ids_a: Vec<String> = all_notes(&a)
        .iter()
        .map(|n| n["id"].as_str().unwrap().to_string())
        .collect();
    let mut ids_b: Vec<String> = all_notes(&b)
        .iter()
        .map(|n| n["id"].as_str().unwrap().to_string())
        .collect();
    ids_a.sort();
    ids_b.sort();
    assert_eq!(ids_a, ids_b, "replicas diverged");
    assert!(
        all_notes(&a)
            .iter()
            .any(|n| n["title"].as_str().unwrap().contains("충돌 사본")),
        "no conflict copy materialized"
    );
}

#[test]
fn delete_then_restart_converges() {
    let relay =
        Relay::start().expect("actual Rust relay must build and start (or set INKISM_RELAY_BIN)");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate().to_base64();

    let a = open_at(dir.path(), "a.db");
    configure(&a, &relay.url, &key);
    let id = save_note(&a, json!({ "title": "Doomed", "text": "bye" }))["id"]
        .as_str()
        .unwrap()
        .to_string();
    sync(&a);

    let mut b = open_at(dir.path(), "b.db");
    configure(&b, &relay.url, &key);
    sync(&b);
    assert_eq!(get_note(&b, &id)["id"], id);

    // Trash then hard delete on A (delete requires trashed).
    call(
        &a,
        json!({ "op": "patch", "id": id, "changes": { "trashed": true } }),
    );
    let deleted = call(&a, json!({ "op": "delete", "id": id }));
    assert_eq!(deleted["deleted"], true);
    sync(&a);

    sync(&b);
    let gone = raw(&b, json!({ "op": "get", "id": id }));
    assert_eq!(gone["ok"], false, "note should be deleted on B: {gone}");

    // Restart B: the deletion must survive, and new work must still flow.
    drop(b);
    b = open_at(dir.path(), "b.db");
    sync(&b);
    let gone_again = raw(&b, json!({ "op": "get", "id": id }));
    assert_eq!(gone_again["ok"], false);

    let fresh = save_note(&b, json!({ "title": "After restart", "text": "new" }));
    let fresh_id = fresh["id"].as_str().unwrap().to_string();
    sync(&b);
    sync(&a);
    assert_eq!(get_note(&a, &fresh_id)["text"], "new");
}

#[test]
fn notebook_and_tag_metadata_replicate() {
    let relay =
        Relay::start().expect("actual Rust relay must build and start (or set INKISM_RELAY_BIN)");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate().to_base64();

    let a = open_at(dir.path(), "a.db");
    configure(&a, &relay.url, &key);
    let nb = call(
        &a,
        json!({ "op": "save_notebook", "name": "업무", "color": "#123456" }),
    );
    let nb_id = nb["id"].as_str().unwrap().to_string();
    let id = save_note(
        &a,
        json!({ "title": "Tagged", "text": "t", "notebook_id": nb_id, "tags": ["alpha", "beta"] }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    sync(&a);

    let b = open_at(dir.path(), "b.db");
    configure(&b, &relay.url, &key);
    sync(&b);

    let notebooks = call(&b, json!({ "op": "notebooks" }));
    let found = notebooks
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == nb_id)
        .expect("notebook replicated");
    assert_eq!(found["name"], "업무");
    assert_eq!(found["color"], "#123456");

    let note = get_note(&b, &id);
    assert_eq!(note["notebook_id"], nb_id);
    assert_eq!(note["tags"], json!(["alpha", "beta"]));

    // Deleting the notebook nulls the note's notebook_id on B without touching
    // the note itself.
    call(&a, json!({ "op": "delete_notebook", "id": nb_id }));
    sync(&a);
    sync(&b);
    let detach = get_note(&b, &id);
    assert!(detach["notebook_id"].is_null());
    let notebooks = call(&b, json!({ "op": "notebooks" }));
    assert!(notebooks
        .as_array()
        .unwrap()
        .iter()
        .all(|n| n["id"] != nb_id));
}

#[test]
fn remote_change_bumps_revision_and_rejects_stale_editor() {
    let relay =
        Relay::start().expect("actual Rust relay must build and start (or set INKISM_RELAY_BIN)");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate().to_base64();

    let a = open_at(dir.path(), "a.db");
    configure(&a, &relay.url, &key);
    let id = save_note(&a, json!({ "title": "Doc", "text": "v1" }))["id"]
        .as_str()
        .unwrap()
        .to_string();
    sync(&a);
    let b = open_at(dir.path(), "b.db");
    configure(&b, &relay.url, &key);
    sync(&b);
    assert_eq!(get_note(&b, &id)["revision"], 1);

    // B edits with the revision it holds and pushes.
    let edited = save_note(&b, json!({ "id": id, "text": "v2-from-b", "revision": 1 }));
    assert_eq!(edited["revision"], 2);
    sync(&b);

    // A receives the remote change: its local revision must advance so the
    // stale editor's save conflicts instead of clobbering.
    sync(&a);
    let after = get_note(&a, &id);
    assert_eq!(after["text"], "v2-from-b");
    assert!(
        after["revision"].as_i64().unwrap() > 1,
        "revision did not advance: {after}"
    );

    let stale = raw(
        &a,
        json!({ "op": "save", "note": { "id": id, "text": "clobber", "revision": 1 } }),
    );
    assert_eq!(stale["ok"], false, "stale save must conflict: {stale}");
    assert!(stale["error"].as_str().unwrap().contains("conflict"));

    let rev = after["revision"].as_i64().unwrap();
    let fresh = save_note(
        &a,
        json!({ "id": id, "text": "v3-from-a", "revision": rev }),
    );
    assert_eq!(fresh["revision"], rev + 1);
}

// ---------------------------------------------------------------------------
// Configuration contract
// ---------------------------------------------------------------------------

#[test]
fn changing_relays_keeps_old_state_and_syncs_latest_source_after_restart() {
    let old_relay = Relay::start().expect("real old relay");
    let new_relay = Relay::start().expect("real new relay");
    let dir = tempfile::tempdir().unwrap();
    let old_key = Key::generate().to_base64();
    let new_key = Key::generate().to_base64();
    let path = dir.path().join("switch.db");
    let path = path.to_str().unwrap();
    let app = AppCore::open(path).unwrap();
    assert!(app.wait_sync_idle(30_000));
    configure(&app, &old_relay.url, &old_key);
    let original = save_note(
        &app,
        json!({"content_format":"markdown","content":"\u{feff}# 원문😀\r\n\r\n**첫 버전**","title":"서버 전환"}),
    );
    sync(&app);
    let old_cfg = inkism_runtime::StoredConfig::load(&format!("{path}.sync.json"))
        .unwrap()
        .unwrap();
    let old_path = old_cfg.state_path(path).unwrap();
    let read_meta = || {
        let conn = rusqlite::Connection::open_with_flags(
            &old_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let mut stmt = conn
            .prepare("SELECT key,value FROM meta ORDER BY key")
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap();
        rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
    };
    let old_meta = read_meta();
    call(&app, json!({"op":"sync_pause","paused":true}));
    assert!(app.wait_sync_idle(30_000));
    let latest = save_note(
        &app,
        json!({"id":original["id"],"revision":original["revision"],
        "content_format":"markdown","content":"\u{feff}# 원문😀\r\n\r\n**오프라인 최신 변경**"}),
    );
    call(
        &app,
        json!({"op":"sync_config","server_url":new_relay.url,"token":TOKEN,"key":new_key,"migration":true}),
    );
    assert!(app.wait_sync_idle(30_000));
    let cfg = inkism_runtime::StoredConfig::load(&format!("{path}.sync.json"))
        .unwrap()
        .unwrap();
    assert_ne!(cfg.state_path(path).unwrap(), old_path);
    assert_eq!(
        read_meta(),
        old_meta,
        "old cursor/device identity changed during migration"
    );
    assert_eq!(get_note(&app, original["id"].as_str().unwrap()), latest);
    drop(app);
    let app = AppCore::open(path).unwrap();
    assert!(app.wait_sync_idle(30_000));
    call(&app, json!({"op":"sync_pause","paused":false}));
    sync(&app);
    let peer = open_at(dir.path(), "new-peer.db");
    assert!(peer.wait_sync_idle(30_000));
    configure(&peer, &new_relay.url, &new_key);
    sync(&peer);
    let copied = get_note(&peer, original["id"].as_str().unwrap());
    assert_eq!(copied["content"], latest["content"]);
    assert_eq!(copied["content_format"], "markdown");
    let old_peer = open_at(dir.path(), "old-peer.db");
    assert!(old_peer.wait_sync_idle(30_000));
    configure(&old_peer, &old_relay.url, &old_key);
    sync(&old_peer);
    assert_eq!(
        get_note(&old_peer, original["id"].as_str().unwrap())["content"],
        original["content"]
    );
    assert_eq!(read_meta(), old_meta);
}

#[test]
fn config_generates_key_hides_secrets_and_requires_migration() {
    let relay =
        Relay::start().expect("actual Rust relay must build and start (or set INKISM_RELAY_BIN)");
    let dir = tempfile::tempdir().unwrap();
    let app = open_at(dir.path(), "cfg.db");

    // Explicit key generation is the one op that returns secret material.
    let generated = call(&app, json!({ "op": "sync_keygen" }));
    let key = generated["key"].as_str().unwrap().to_string();
    assert_eq!(Key::from_base64(&key).unwrap().as_bytes().len(), 32);

    // Bad key is rejected with a clear error.
    let bad = raw(
        &app,
        json!({ "op": "sync_config", "server_url": relay.url, "token": TOKEN, "key": "not-a-key" }),
    );
    assert_eq!(bad["ok"], false);
    assert!(bad["error"].as_str().unwrap().contains("key"));

    configure(&app, &relay.url, &key);
    let status = call(&app, json!({ "op": "sync_status" }));
    assert_eq!(status["configured"], true);
    assert_eq!(status["server_url"], relay.url);

    // Status must never leak the token or key.
    let rendered = serde_json::to_string(&status).unwrap();
    assert!(!rendered.contains(&key), "status leaked key");
    assert!(!rendered.contains(TOKEN), "status leaked token");

    // Changing only the token is allowed without migration once the current round finishes.
    assert!(app.wait_sync_idle(30_000));
    let rotated = call(
        &app,
        json!({ "op": "sync_config", "server_url": relay.url, "token": format!("{TOKEN}x"), "key": key }),
    );
    assert_eq!(rotated["configured"], true);
    assert!(app.wait_sync_idle(30_000));

    // A non-loopback plaintext URL is rejected up front.
    let insecure = raw(
        &app,
        json!({ "op": "sync_config", "server_url": "http://relay.example.com", "token": TOKEN, "key": key }),
    );
    assert_eq!(insecure["ok"], false);
    assert!(insecure["error"].as_str().unwrap().contains("TLS"));

    // Changing the vault URL/key without migration is refused.
    let refused = raw(
        &app,
        json!({ "op": "sync_config", "server_url": "http://127.0.0.1:9", "token": TOKEN, "key": key }),
    );
    assert_eq!(refused["ok"], false);
    assert!(refused["error"].as_str().unwrap().contains("migration"));

    // The same key stays configured (no silent reset happened).
    assert_eq!(
        call(&app, json!({ "op": "sync_status" }))["configured"],
        true
    );
}

#[test]
fn invalid_configured_key_is_rejected_at_open() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("broken.db");
    let path_str = path.to_str().unwrap().to_string();

    {
        let app = AppCore::open(&path_str).unwrap();
        // A real config file beside the DB, then corrupt the key.
        call(
            &app,
            json!({ "op": "sync_config", "server_url": "http://127.0.0.1:47832", "token": TOKEN, "key": Key::generate().to_base64() }),
        );
    }
    let config_path = format!("{path_str}.sync.json");
    let mut cfg = inkism_runtime::StoredConfig::load(&config_path)
        .unwrap()
        .unwrap();
    cfg.key = "definitely-not-valid-base64!!".into();
    cfg.save(&config_path).unwrap();

    match AppCore::open(&path_str) {
        Ok(_) => panic!("open must reject a corrupt configured key"),
        Err(e) => assert!(
            e.to_string().contains("key"),
            "error should mention the key: {e}"
        ),
    }
}

#[test]
fn reminder_metadata_syncs_between_devices_and_clears_both_ways() {
    let relay =
        Relay::start().expect("actual Rust relay must build and start (or set INKISM_RELAY_BIN)");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate().to_base64();

    let a = open_at(dir.path(), "remind-a.db");
    configure(&a, &relay.url, &key);
    let created = save_note(
        &a,
        json!({ "title": "알림 노트", "text": "본문", "reminder_at": 1_735_689_600_000i64 }),
    );
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["reminder_at"], 1_735_689_600_000i64);
    sync(&a);

    let b = open_at(dir.path(), "remind-b.db");
    configure(&b, &relay.url, &key);
    sync(&b);

    // The scheduled reminder reached B, including the due list.
    let got = get_note(&b, &id);
    assert_eq!(got["reminder_at"], 1_735_689_600_000i64);
    let due = call(
        &b,
        json!({ "op": "due_reminders", "now": 1_735_689_600_000i64 }),
    );
    assert!(due
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["id"].as_str() == Some(id.as_str())));

    // Dismissal is the ordinary revision-guarded patch; it must converge on A.
    let dismissed = call(
        &b,
        json!({ "op": "patch", "id": id, "revision": got["revision"], "changes": { "reminder_at": null } }),
    );
    assert!(dismissed["reminder_at"].is_null());
    sync(&b);
    sync(&a);
    let on_a = get_note(&a, &id);
    assert!(on_a["reminder_at"].is_null());
    assert!(call(
        &a,
        json!({ "op": "due_reminders", "now": 1_735_689_600_000i64 })
    )
    .as_array()
    .unwrap()
    .iter()
    .all(|n| n["id"].as_str() != Some(id.as_str())));

    // Re-arming on A converges back to B (save keeps the reminder key).
    let armed = save_note(
        &a,
        json!({ "id": id, "reminder_at": 1_900_000_000_000i64, "revision": on_a["revision"] }),
    );
    assert_eq!(armed["reminder_at"], 1_900_000_000_000i64);
    sync(&a);
    sync(&b);
    assert_eq!(get_note(&b, &id)["reminder_at"], 1_900_000_000_000i64);
}

#[test]
fn bulk_tag_rename_and_removal_sync_without_body_changes() {
    let relay = Relay::start().expect("actual Rust relay required");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate().to_base64();
    let a = open_at(dir.path(), "tags-a.db");
    let b = open_at(dir.path(), "tags-b.db");
    configure(&a, &relay.url, &key);
    configure(&b, &relay.url, &key);
    let note = save_note(
        &a,
        json!({"title":"태그 동기화","content":"<p>본문😀</p>","text":"본문😀","tags":["이전","대상"]}),
    );
    sync(&a);
    sync(&b);
    call(
        &a,
        json!({"op":"change_tag","name":"이전","replacement":"대상"}),
    );
    sync(&a);
    sync(&b);
    let remote = get_note(&b, note["id"].as_str().unwrap());
    assert_eq!(remote["tags"], json!(["대상"]));
    assert_eq!(remote["content"], note["content"]);
    call(
        &a,
        json!({"op":"change_tag","name":"대상","replacement":null}),
    );
    sync(&a);
    sync(&b);
    assert_eq!(
        get_note(&b, note["id"].as_str().unwrap())["tags"],
        json!([])
    );
}

#[test]
fn paused_sync_survives_restart_and_preserves_both_directions() {
    pause_scenario(false);
}
#[cfg(feature = "encrypted-storage")]
#[test]
fn encrypted_paused_sync_survives_restart_and_preserves_both_directions() {
    pause_scenario(true);
}
fn pause_scenario(encrypted: bool) {
    let relay = Relay::start().expect("actual Rust relay must start");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate().to_base64();
    let open = |name: &str| {
        if encrypted {
            #[cfg(feature = "encrypted-storage")]
            return AppCore::open_encrypted(
                dir.path().join(name).to_str().unwrap(),
                inkism_runtime::local_storage::StorageKey::from_bytes([29; 32]),
            )
            .unwrap();
            #[cfg(not(feature = "encrypted-storage"))]
            panic!("encrypted fixture requires feature");
        }
        open_at(dir.path(), name)
    };
    let a = open("pause-a.db");
    let b = open("pause-b.db");
    configure(&a, &relay.url, &key);
    configure(&b, &relay.url, &key);
    sync(&a);
    sync(&b);
    let last = call(&a, json!({"op":"sync_status"}))["last_sync"].clone();
    assert_eq!(
        call(&a, json!({"op":"sync_pause","paused":true}))["paused"],
        true
    );
    let local = save_note(
        &a,
        json!({"title":"중지 중 작성","content":"<p>보존</p>","text":"보존"}),
    );
    assert!(a.wait_sync_idle(30000));
    let status = call(&a, json!({"op":"sync_status"}));
    assert_eq!(status["paused"], true);
    assert_eq!(status["last_sync"], last);
    assert!(status["pending"].as_u64().unwrap() > 0);
    assert_eq!(raw(&a, json!({"op":"sync_now"}))["ok"], false);
    sync(&b);
    assert!(all_notes(&b).is_empty());
    let remote = save_note(
        &b,
        json!({"title":"다른 기기","content":"<p>수신 대기</p>","text":"수신 대기"}),
    );
    sync(&b);
    drop(a);
    let a = open("pause-a.db");
    assert!(a.wait_sync_idle(30000));
    assert_eq!(call(&a, json!({"op":"sync_status"}))["paused"], true);
    assert_eq!(all_notes(&a).len(), 1);
    assert_eq!(
        get_note(&a, local["id"].as_str().unwrap())["content"],
        "<p>보존</p>"
    );
    assert_eq!(
        call(&a, json!({"op":"sync_pause","paused":false}))["paused"],
        false
    );
    assert!(a.wait_sync_idle(30000));
    sync(&a);
    sync(&b);
    assert_eq!(all_notes(&a).len(), 2);
    assert_eq!(all_notes(&b).len(), 2);
    assert_eq!(
        get_note(&a, remote["id"].as_str().unwrap())["content"],
        "<p>수신 대기</p>"
    );
    assert_eq!(
        get_note(&b, local["id"].as_str().unwrap())["content"],
        "<p>보존</p>"
    );
}
