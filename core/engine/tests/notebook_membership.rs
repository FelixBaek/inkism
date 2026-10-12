//! Prepared regression checks. Compile-only while user note testing is paused.
use inkism_engine::Engine;
use serde_json::{json, Value};

fn ok(value: Value) -> Value {
    assert_eq!(value["ok"], true, "{value}");
    value["data"].clone()
}
fn patch(engine: &Engine, note: &Value, changes: Value) -> Value {
    ok(engine.execute(
        json!({"op":"patch","id":note["id"],"revision":note["revision"],"changes":changes}),
    ))
}
fn temp(tag: &str) -> (std::path::PathBuf, String) {
    let dir = std::env::temp_dir().join(format!(
        "inkism-memberships-{tag}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("notes.db").to_string_lossy().into_owned();
    (dir, path)
}

#[test]
fn memberships_follow_revision_legacy_save_listing_delete_and_reopen() {
    let (dir, path) = temp("relations");
    let engine = Engine::open(&path).unwrap();
    let a = ok(engine.execute(json!({"op":"save_notebook","name":"A"})))["id"].clone();
    let b = ok(engine.execute(json!({"op":"save_notebook","name":"B"})))["id"].clone();
    let c = ok(engine.execute(json!({"op":"save_notebook","name":"C"})))["id"].clone();
    let mut tail = vec![b.as_str().unwrap().to_string(), c.as_str().unwrap().to_string()];
    tail.sort();
    let parsed = inkism_engine::notebook_membership::parse_ids(&json!({"notebook_ids":[a,c,b]})).unwrap().unwrap();
    assert_eq!(parsed[0], a.as_str().unwrap());
    assert_eq!(&parsed[1..], &tail, "non-primary order cannot create duplicate crash recovery");
    let mut note = ok(engine.execute(
        json!({"op":"save","note":{"title":"multi","content":"<p>exact</p>","notebook_ids":[a,b]}}),
    ));
    assert_eq!(note["notebook_id"], a);
    assert_eq!(note["notebook_ids"], json!([a, b]));
    for notebook in [&a, &b] {
        let listed =
            ok(engine.execute(json!({"op":"list","view":"all","notebook_id":notebook,"limit":1})));
        assert_eq!(listed["items"][0]["id"], note["id"]);
        assert_eq!(listed["items"][0]["notebook_ids"], note["notebook_ids"]);
        assert!(listed["items"][0].get("content").is_none());
    }
    // The existing UI repeats its primary during autosave; secondary B stays.
    note = ok(engine.execute(json!({"op":"save","note":{"id":note["id"],"revision":note["revision"],"content":"<p>changed</p>","notebook_id":a}})));
    assert_eq!(note["notebook_ids"], json!([a, b]));
    let before = note.clone();
    for changes in [
        json!({"notebook_ids":null}),
        json!({"notebook_ids":[a,a]}),
        json!({"notebook_id":b,"notebook_ids":[a,b]}),
        json!({"notebook_ids":["bad"]}),
        json!({"notebook_ids":[uuid::Uuid::new_v4().to_string()]}),
    ] {
        let rejected = engine.execute(
            json!({"op":"patch","id":note["id"],"revision":note["revision"],"changes":changes}),
        );
        assert_eq!(rejected["ok"], false);
        assert_eq!(
            ok(engine.execute(json!({"op":"get","id":note["id"]}))),
            before
        );
    }
    assert_eq!(
        engine.execute(json!({"op":"patch","id":note["id"],"changes":{"notebook_ids":[]}}))["ok"],
        false
    );
    let spliced = ok(engine.execute(json!({"op":"document_splice_html","id":note["id"],"revision":note["revision"],
        "content":{"start":0,"expected":"","replacement":""},"metadata":{"title":note["title"],"notebook_id":c,"tags":[]}})));
    assert_eq!(
        spliced["notebook_ids"],
        json!([c, b]),
        "splice replies include the committed primary move"
    );
    note = ok(engine.execute(json!({"op":"get","id":note["id"]})));
    assert_eq!(note["notebook_ids"], json!([c, b]));
    let changed = patch(
        &engine,
        &note,
        json!({"readonly":true,"notebook_ids":[a,b]}),
    );
    assert_eq!(changed["content"], note["content"]);
    assert_eq!(changed["edited_at"], note["edited_at"]);
    assert_eq!(engine.execute(json!({"op":"patch","id":changed["id"],"revision":note["revision"],"changes":{"notebook_ids":[c]}}))["ok"], false);
    ok(engine.execute(json!({"op":"delete_notebook","id":a})));
    note = ok(engine.execute(json!({"op":"get","id":changed["id"]})));
    assert_eq!(note["notebook_id"], b);
    assert_eq!(note["notebook_ids"], json!([b]));
    assert_eq!(note["content"], changed["content"]);
    note = patch(&engine, &note, json!({"notebook_id":null}));
    assert_eq!(note["notebook_ids"], json!([]));
    assert!(note["notebook_id"].is_null());
    let id = note["id"].clone();
    drop(engine);
    let engine = Engine::open(&path).unwrap();
    assert_eq!(ok(engine.execute(json!({"op":"get","id":id}))), note);
    drop(engine);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn old_primary_migrates_and_legacy_crash_snapshot_keeps_all_memberships() {
    let (dir, path) = temp("migration-crash");
    let engine = Engine::open(&path).unwrap();
    let a = ok(engine.execute(json!({"op":"save_notebook","name":"A"})))["id"].clone();
    let b = ok(engine.execute(json!({"op":"save_notebook","name":"B"})))["id"].clone();
    let note = ok(engine.execute(json!({"op":"save","note":{"title":"original","content":"source\r\n","content_format":"markdown","notebook_id":a}})));
    drop(engine);
    let old = rusqlite::Connection::open(&path).unwrap();
    old.execute_batch("DROP TRIGGER note_notebooks_insert; DROP TRIGGER note_notebooks_primary; DROP TABLE note_notebooks; ALTER TABLE draft_journal DROP COLUMN notebook_ids; PRAGMA user_version=10;").unwrap();
    drop(old);
    let engine = Engine::open(&path).unwrap();
    assert_eq!(
        ok(engine.execute(json!({"op":"get","id":note["id"]})))["notebook_ids"],
        json!([a])
    );
    let note = patch(&engine, &note, json!({"notebook_ids":[a,b]}));
    ok(engine.execute(json!({"op":"draft_journal_put","token":uuid::Uuid::new_v4().to_string(),"draft":{
        "format":"mindbox-draft","version":1,"note":{"id":note["id"],"title":note["title"],"notebook_id":a,"tags":[],"content_format":"markdown"},
        "body":{"kind":"complete","revision":note["revision"],"content":"source\r\n미저장"}
    }})));
    let trashed = patch(&engine, &note, json!({"trashed":true}));
    ok(engine.execute(json!({"op":"delete","id":trashed["id"]})));
    drop(engine);
    let engine = Engine::open(&path).unwrap();
    let list = ok(engine.execute(json!({"op":"list","view":"all"})));
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    let recovered = ok(engine.execute(json!({"op":"get","id":list["items"][0]["id"]})));
    assert_ne!(recovered["id"], note["id"]);
    assert_eq!(recovered["notebook_ids"], json!([a, b]));
    assert_eq!(recovered["content"], "source\r\n미저장");
    drop(engine);
    std::fs::remove_dir_all(dir).unwrap();
}
