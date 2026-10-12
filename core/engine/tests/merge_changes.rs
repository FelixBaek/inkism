use inkism_engine::{settings, Engine};
use serde_json::{json, Value};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn create(e: &Engine, title: &str) -> Value {
    ok(e.execute(json!({"op":"save","note":{"title":title,"content":format!("<p>{title} &amp; exact\r\n</p><img src=\"attachment://abc\">"),"content_format":"html","tags":["keep"]}})))
}
fn get(e: &Engine, n: &Value) -> Value {
    ok(e.execute(json!({"op":"get","id":n["id"]})))
}
fn preview(e: &Engine, s: &Value, t: &Value) -> Value {
    ok(e.execute(json!({"op":"merge_preview","source_id":s["id"],"target_id":t["id"],"source_revision":s["revision"],"target_revision":t["revision"],"redirect":true})))
}
fn fixture() -> (std::path::PathBuf, Engine) {
    let root = std::env::temp_dir().join(format!("merge-receipt-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let e = Engine::open(root.join("notes.db").to_str().unwrap()).unwrap();
    (root, e)
}
#[test]
fn preview_apply_restart_undo_preserves_content_meta_settings_and_refs() {
    let (root, e) = fixture();
    let s = create(&e, "Source");
    let t = create(&e, "Target");
    let key = format!("knowledge_note:{}", t["id"].as_str().unwrap());
    settings::write_local(
        e.connection(),
        &key,
        Some(r#"{"aliases":["old"],"properties":[]}"#),
    )
    .unwrap();
    let before = settings::stored(e.connection(), &key).unwrap().unwrap();
    let p = preview(&e, &s, &t);
    assert_eq!(get(&e, &s), s);
    assert_eq!(get(&e, &t), t);
    assert_eq!(
        settings::stored(e.connection(), &key).unwrap().unwrap(),
        before
    );
    ok(e.execute(json!({"op":"merge_apply","id":p["id"]})));
    assert_eq!(get(&e, &s)["trashed"], true);
    drop(e);
    let e = Engine::open(root.join("notes.db").to_str().unwrap()).unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"merge_changes"})))["items"][0]["can_undo"],
        true
    );
    ok(e.execute(json!({"op":"merge_undo","id":p["id"]})));
    for old in [&s, &t] {
        let now = get(&e, old);
        for field in [
            "content",
            "text",
            "title",
            "tags",
            "notebook_ids",
            "favorite",
            "pinned",
            "archived",
            "trashed",
            "color",
            "reminder_at",
            "content_format",
        ] {
            assert_eq!(now[field], old[field], "{field}");
        }
        assert!(now["revision"].as_i64().unwrap() > old["revision"].as_i64().unwrap());
    }
    assert_eq!(
        settings::stored(e.connection(), &key).unwrap().unwrap().0,
        before.0
    );
    assert_eq!(
        settings::stored(
            e.connection(),
            &format!("knowledge_redirect:{}", s["id"].as_str().unwrap())
        )
        .unwrap()
        .unwrap()
        .0,
        None
    );
    assert_eq!(
        e.execute(json!({"op":"merge_undo","id":p["id"]}))["ok"],
        false
    );
    drop(e);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn stale_preview_and_undo_reject_all_and_transaction_failure_rolls_back() {
    let (root, e) = fixture();
    let s = create(&e, "Source");
    let t = create(&e, "Target");
    let p = preview(&e, &s, &t);
    let key = format!("knowledge_note:{}", t["id"].as_str().unwrap());
    settings::write_local(
        e.connection(),
        &key,
        Some(r#"{"aliases":["new"],"properties":[]}"#),
    )
    .unwrap();
    assert_eq!(
        e.execute(json!({"op":"merge_apply","id":p["id"]}))["ok"],
        false
    );
    assert_eq!(get(&e, &s), s);
    assert_eq!(get(&e, &t), t);
    let p = preview(&e, &s, &t);
    e.connection().execute_batch("CREATE TEMP TRIGGER fail_trash BEFORE UPDATE OF trashed ON notes_meta WHEN NEW.trashed=1 BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert_eq!(
        e.execute(json!({"op":"merge_apply","id":p["id"]}))["ok"],
        false
    );
    assert_eq!(get(&e, &s), s);
    assert_eq!(get(&e, &t), t);
    e.connection()
        .execute_batch("DROP TRIGGER fail_trash")
        .unwrap();
    ok(e.execute(json!({"op":"merge_apply","id":p["id"]})));
    let after = get(&e, &s);
    let target = get(&e, &t);
    ok(e.execute(json!({"op":"patch","id":t["id"],"revision":target["revision"],"changes":{"favorite":true}})));
    let changed = get(&e, &t);
    assert_eq!(
        e.execute(json!({"op":"merge_undo","id":p["id"]}))["ok"],
        false
    );
    assert_eq!(get(&e, &s), after);
    assert_eq!(get(&e, &t), changed);
    drop(e);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn protection_purges_receipts_and_metadata_undo_conflicts() {
    let (root, e) = fixture();
    let s = create(&e, "Source");
    let t = create(&e, "Target");
    let p = preview(&e, &s, &t);
    ok(e.execute(json!({"op":"merge_apply","id":p["id"]})));
    let key = format!("knowledge_note:{}", s["id"].as_str().unwrap());
    settings::write_local(
        e.connection(),
        &key,
        Some(r#"{"aliases":["later"],"properties":[]}"#),
    )
    .unwrap();
    let a = get(&e, &s);
    let b = get(&e, &t);
    assert_eq!(
        e.execute(json!({"op":"merge_undo","id":p["id"]}))["ok"],
        false
    );
    assert_eq!(get(&e, &s), a);
    assert_eq!(get(&e, &t), b);
    e.connection()
        .execute(
            "UPDATE notes_meta SET locked=1 WHERE id=?1",
            [t["id"].as_str().unwrap()],
        )
        .unwrap();
    assert!(ok(e.execute(json!({"op":"merge_changes"})))["items"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(e.execute(json!({"op":"merge_preview","source_id":s["id"],"target_id":t["id"],"source_revision":a["revision"],"target_revision":b["revision"]}))["ok"],false);
    drop(e);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn undo_failure_rolls_back_both_notes_and_receipt() {
    let (root, e) = fixture();
    let s = create(&e, "Source");
    let t = create(&e, "Target");
    let p = preview(&e, &s, &t);
    ok(e.execute(json!({"op":"merge_apply","id":p["id"]})));
    let a = get(&e, &s);
    let b = get(&e, &t);
    e.connection().execute_batch("CREATE TEMP TRIGGER fail_restore BEFORE UPDATE OF trashed ON notes_meta WHEN NEW.trashed=0 BEGIN SELECT RAISE(ABORT,'undo injected'); END;").unwrap();
    assert_eq!(
        e.execute(json!({"op":"merge_undo","id":p["id"]}))["ok"],
        false
    );
    assert_eq!(get(&e, &s), a);
    assert_eq!(get(&e, &t), b);
    assert_eq!(
        ok(e.execute(json!({"op":"merge_changes"})))["items"][0]["can_undo"],
        true
    );
    e.connection()
        .execute_batch("DROP TRIGGER fail_restore")
        .unwrap();
    ok(e.execute(
        json!({"op":"patch","id":t["id"],"revision":b["revision"],"changes":{"readonly":true}}),
    ));
    assert_eq!(
        e.execute(json!({"op":"merge_undo","id":p["id"]}))["ok"],
        false
    );
    assert_eq!(get(&e, &s), a);
    drop(e);
    std::fs::remove_dir_all(root).unwrap();
}
