//! Real relay tests for durable failures that must not block unrelated notes.
mod common;

use common::{Relay, TOKEN};
use inkism_runtime::{AppCore, StoredConfig};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use sync_core::{Entity, EntityKind, Key, SyncConfig, SyncEngine};

fn call(app: &AppCore, request: Value) -> Value {
    let response = app.execute(request);
    assert_eq!(response["ok"], true, "{response}");
    response["data"].clone()
}

fn round(app: &AppCore) -> Value {
    call(app, json!({"op":"sync_now"}));
    assert!(app.wait_sync_idle(30_000));
    call(app, json!({"op":"sync_status"}))
}

fn resume(app: &AppCore) {
    call(app, json!({"op":"sync_pause", "paused":false}));
    assert!(app.wait_sync_idle(30_000));
}

fn open_paused(path: &Path, relay: &Relay, key: &Key) -> AppCore {
    prefetch(path, relay, key);
    StoredConfig {
        version: 1,
        server_url: relay.url.clone(),
        token: TOKEN.into(),
        key: key.to_base64(),
        paused: true,
        state_generation: None,
        scope: inkism_runtime::SyncScope::default(),
    }
    .save(&format!("{}.sync.json", path.display()))
    .unwrap();
    let app = AppCore::open(path.to_str().unwrap()).unwrap();
    assert!(app.wait_sync_idle(30_000));
    app
}

fn note(id: &str, title: Value) -> Entity {
    Entity::new(
        EntityKind::Note,
        id,
        json!({"id":id, "title":title,
        "content":"<p>정확한 본문</p>", "text":"정확한 본문"}),
    )
}

fn state_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.sync", path.display()))
}

fn writer(dir: &Path, relay: &Relay, key: &Key) -> SyncEngine {
    SyncEngine::open(SyncConfig::new(
        dir.join("writer.sync"),
        &relay.url,
        TOKEN,
        key.clone(),
    ))
    .unwrap()
}

fn queued(path: &Path, event: &str) -> (String, Vec<u8>) {
    Connection::open(state_path(path))
        .unwrap()
        .query_row(
            "SELECT state, payload FROM incoming WHERE event_id = ?1",
            [event],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
}

fn get(app: &AppCore, id: &str) -> Value {
    call(app, json!({"op":"get", "id":id}))
}

fn prefetch(path: &Path, relay: &Relay, key: &Key) {
    let reader = SyncEngine::open(SyncConfig::new(
        state_path(path),
        &relay.url,
        TOKEN,
        key.clone(),
    ))
    .unwrap();
    reader.pull().unwrap();
}

#[test]
fn invalid_note_stays_pending_while_later_note_applies_across_restart() {
    let relay = Relay::start().expect("real Rust relay");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let writer = writer(dir.path(), &relay, &key);
    let bad = uuid::Uuid::new_v4().to_string();
    let good = uuid::Uuid::new_v4().to_string();
    let failed = writer
        .stage_local(note(&bad, json!(123)), 1)
        .unwrap()
        .event_id;
    writer.push().unwrap();
    writer
        .stage_local(note(&good, json!("정상 노트")), 2)
        .unwrap();
    writer.push().unwrap();
    let path = dir.path().join("receiver.db");
    let app = open_paused(&path, &relay, &key);
    let original = queued(&path, &failed);
    resume(&app);
    assert!(round(&app)["error"].is_string());
    assert_eq!(get(&app, &good)["text"], "정확한 본문");
    assert_eq!(app.execute(json!({"op":"get", "id":bad}))["ok"], false);
    assert_eq!(
        queued(&path, &failed),
        original,
        "failed bytes/state must survive"
    );
    drop(app);
    let app = AppCore::open(path.to_str().unwrap()).unwrap();
    assert!(round(&app)["error"].is_string());
    assert_eq!(queued(&path, &failed), original);
    assert_eq!(get(&app, &good)["title"], "정상 노트");

    // A valid, causally newer version is allowed through, and the obsolete
    // malformed note is acknowledged only after it resolves as stale.
    writer
        .stage_local(note(&bad, json!("수정된 노트")), 3)
        .unwrap();
    writer.push().unwrap();
    round(&app);
    assert_eq!(get(&app, &bad)["title"], "수정된 노트");
    assert!(round(&app)["error"].is_null());
    assert_eq!(queued(&path, &failed), ("applied".into(), Vec::new()));
}

#[test]
fn malformed_queue_json_does_not_hide_next_record_and_is_never_acknowledged() {
    let relay = Relay::start().expect("real Rust relay");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let writer = writer(dir.path(), &relay, &key);
    let bad = uuid::Uuid::new_v4().to_string();
    let good = uuid::Uuid::new_v4().to_string();
    let failed = writer
        .stage_local(note(&bad, json!("원본")), 1)
        .unwrap()
        .event_id;
    writer.push().unwrap();
    writer
        .stage_local(note(&good, json!("뒤의 정상 문서")), 2)
        .unwrap();
    writer.push().unwrap();
    let path = dir.path().join("receiver.db");
    let app = open_paused(&path, &relay, &key);
    Connection::open(state_path(&path))
        .unwrap()
        .execute(
            "UPDATE incoming SET payload = ?1 WHERE event_id = ?2",
            params![b"{broken JSON".as_slice(), failed],
        )
        .unwrap();
    let corrupt = queued(&path, &failed);
    resume(&app);
    assert!(round(&app)["error"].is_string());
    assert_eq!(get(&app, &good)["title"], "뒤의 정상 문서");
    assert_eq!(queued(&path, &failed), corrupt);
    drop(app);
    let app = AppCore::open(path.to_str().unwrap()).unwrap();
    assert!(round(&app)["error"].is_string());
    assert_eq!(queued(&path, &failed), corrupt);
    assert_eq!(get(&app, &good)["text"], "정확한 본문");
    let db = Connection::open(state_path(&path)).unwrap();
    let applied: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM applied_events WHERE event_id = ?1",
            [&failed],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(applied, 0);
}

#[test]
fn ack_failure_stops_before_next_note_and_replays_without_overwriting_local_edit() {
    let relay = Relay::start().expect("real Rust relay");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let writer = writer(dir.path(), &relay, &key);
    let first = uuid::Uuid::new_v4().to_string();
    let second = uuid::Uuid::new_v4().to_string();
    let event = writer
        .stage_local(note(&first, json!("첫 노트")), 1)
        .unwrap()
        .event_id;
    writer.push().unwrap();
    writer
        .stage_local(note(&second, json!("두 번째 노트")), 2)
        .unwrap();
    writer.push().unwrap();
    let path = dir.path().join("receiver.db");
    let app = open_paused(&path, &relay, &key);
    let db = Connection::open(state_path(&path)).unwrap();
    db.execute_batch(
        "CREATE TRIGGER fail_ack BEFORE UPDATE ON incoming
        WHEN NEW.state = 'applied' BEGIN SELECT RAISE(ABORT, 'injected ack failure'); END;",
    )
    .unwrap();
    resume(&app);
    assert!(round(&app)["error"].is_string());
    assert_eq!(get(&app, &first)["title"], "첫 노트");
    let revision = get(&app, &first)["revision"].clone();
    assert_eq!(app.execute(json!({"op":"get", "id":second}))["ok"], false);
    assert_eq!(queued(&path, &event).0, "pending");
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM entities", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(app);
    let app = AppCore::open(path.to_str().unwrap()).unwrap();
    assert!(round(&app)["error"].is_string());
    assert_eq!(
        get(&app, &first)["revision"],
        revision,
        "replay must not rewrite host"
    );
    call(
        &app,
        json!({"op":"patch", "id":first, "revision":revision, "changes":{"title":"로컬 편집 보존"}}),
    );
    db.execute_batch("DROP TRIGGER fail_ack;").unwrap();
    assert!(round(&app)["error"].is_null());
    assert_eq!(get(&app, &first)["title"], "로컬 편집 보존");
    assert_eq!(get(&app, &second)["title"], "두 번째 노트");
    assert_eq!(queued(&path, &event).0, "applied");
}

#[test]
fn host_write_failure_rolls_back_partial_note_then_allows_later_note_and_retry() {
    let relay = Relay::start().expect("real Rust relay");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let writer = writer(dir.path(), &relay, &key);
    let bad = uuid::Uuid::new_v4().to_string();
    let good = uuid::Uuid::new_v4().to_string();
    let failed = writer
        .stage_local(note(&bad, json!("재시도할 노트")), 1)
        .unwrap()
        .event_id;
    writer.push().unwrap();
    writer
        .stage_local(note(&good, json!("정상 노트")), 2)
        .unwrap();
    writer.push().unwrap();
    let path = dir.path().join("receiver.db");
    let app = open_paused(&path, &relay, &key);
    let host = Connection::open(&path).unwrap();
    // Abort the body insert, after the metadata insert in the same transaction.
    host.execute_batch(&format!(
        "CREATE TRIGGER fail_body BEFORE INSERT ON notes_body
        WHEN NEW.note_id = '{bad}' BEGIN SELECT RAISE(ABORT, 'injected host failure'); END;"
    ))
    .unwrap();
    let original = queued(&path, &failed);
    resume(&app);
    assert!(round(&app)["error"].is_string());
    assert_eq!(get(&app, &good)["text"], "정확한 본문");
    assert_eq!(queued(&path, &failed), original);
    assert_eq!(
        host.query_row(
            "SELECT COUNT(*) FROM notes_meta WHERE id = ?1",
            [&bad],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0,
        "partial metadata must roll back"
    );
    assert_eq!(
        host.query_row(
            "SELECT suppress FROM sync_host_control WHERE id = 1",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        host.query_row(
            "SELECT COUNT(*) FROM sync_applied WHERE event_id = ?1",
            [&failed],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    host.execute_batch("DROP TRIGGER fail_body;").unwrap();
    assert!(round(&app)["error"].is_null());
    assert_eq!(get(&app, &bad)["title"], "재시도할 노트");
}

#[test]
fn superseded_missing_attachment_is_acknowledged_without_downloading_it() {
    let relay = Relay::start().expect("real Rust relay");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let writer = writer(dir.path(), &relay, &key);
    let id = uuid::Uuid::new_v4().to_string();
    let file = uuid::Uuid::new_v4().to_string();
    let mut missing = note(&id, json!("누락 첨부"));
    missing.data["content"] = json!(format!("<a href=\"/api/attachments/{file}\">파일</a>"));
    let failed = writer.stage_local(missing, 1).unwrap().event_id;
    writer.push().unwrap();
    writer
        .stage_local(note(&id, json!("첨부 없는 최신 노트")), 2)
        .unwrap();
    writer.push().unwrap();
    let path = dir.path().join("receiver.db");
    let app = open_paused(&path, &relay, &key);
    resume(&app);
    assert_eq!(get(&app, &id)["title"], "첨부 없는 최신 노트");
    assert!(round(&app)["error"].is_null());
    assert_eq!(queued(&path, &failed), ("applied".into(), Vec::new()));
    assert_eq!(
        call(&app, json!({"op":"list", "view":"all"}))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
