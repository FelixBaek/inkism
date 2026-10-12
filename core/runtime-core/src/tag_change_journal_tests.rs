use serde_json::{json, Value};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
#[test]
fn tag_change_receipts_do_not_sync_but_committed_metadata_does() {
    let dir = tempfile::tempdir().unwrap();
    let e = inkism_engine::Engine::open(dir.path().join("notes.db").to_str().unwrap()).unwrap();
    crate::host::ensure_schema(e.connection()).unwrap();
    ok(e.execute(json!({"op":"save","note":{"title":"target","content":"<p>unchanged</p>","tags":["old","new"]}})));
    ok(e.execute(json!({"op":"defaults_set","tag":"old"})));
    e.connection()
        .execute("DELETE FROM sync_journal", [])
        .unwrap();
    let p = ok(e.execute(json!({"op":"tag_change_preview","name":"old","replacement":"new"})));
    assert!(crate::host::journal_batch(e.connection(), 0, 100)
        .unwrap()
        .is_empty());
    ok(e.execute(json!({"op":"tag_change_apply","preview_id":p["id"]})));
    let rows = crate::host::journal_batch(e.connection(), 0, 100).unwrap();
    assert_eq!(
        rows.len(),
        2,
        "one note and default; local receipt is not a sync entity"
    );
    ok(e.execute(json!({"op":"tag_change_undo","id":p["id"]})));
    assert_eq!(
        crate::host::journal_batch(e.connection(), 0, 100)
            .unwrap()
            .len(),
        4
    );
    // A later write failure rolls back the earlier note and its real host trigger.
    let n = ok(e.execute(
        json!({"op":"save","note":{"title":"other","content":"<p>unchanged</p>","tags":["old"]}}),
    ));
    let p = ok(e.execute(json!({"op":"tag_change_preview","name":"old","replacement":null})));
    let last = p["items"][1]["id"].as_str().unwrap();
    e.connection()
        .execute("DELETE FROM notes_body WHERE note_id=?1", [last])
        .unwrap();
    e.connection()
        .execute("DELETE FROM sync_journal", [])
        .unwrap();
    assert_eq!(
        e.execute(json!({"op":"tag_change_apply","preview_id":p["id"]}))["ok"],
        false
    );
    assert!(crate::host::journal_batch(e.connection(), 0, 100)
        .unwrap()
        .is_empty());
    assert!(n["id"].is_string());
}
