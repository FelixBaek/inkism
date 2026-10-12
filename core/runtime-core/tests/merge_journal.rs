use inkism_runtime::AppCore;
use serde_json::{json, Value};
fn call(app: &AppCore, v: Value) -> Value {
    let r = app.execute(v);
    assert_eq!(r["ok"], true, "{r}");
    r["data"].clone()
}
#[test]
fn merge_receipts_are_local_and_preview_and_rollback_leave_no_sync_events() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    let app = AppCore::open(path.to_str().unwrap()).unwrap();
    let s = call(
        &app,
        json!({"op":"save","note":{"title":"source","content":"source"}}),
    );
    let t = call(
        &app,
        json!({"op":"save","note":{"title":"target","content":"target"}}),
    );
    let db = rusqlite::Connection::open(&path).unwrap();
    db.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
    db.execute_batch("UPDATE sync_host_control SET suppress=0; DELETE FROM sync_journal;")
        .unwrap();
    let count = || {
        db.query_row("SELECT count(*) FROM sync_journal", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap()
    };
    let p = call(
        &app,
        json!({"op":"merge_preview","source_id":s["id"],"target_id":t["id"],"source_revision":s["revision"],"target_revision":t["revision"]}),
    );
    assert_eq!(count(), 0);
    db.execute_batch("CREATE TRIGGER merge_journal_fail BEFORE UPDATE OF trashed ON notes_meta WHEN NEW.trashed=1 BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert_eq!(
        app.execute(json!({"op":"merge_apply","id":p["id"]}))["ok"],
        false
    );
    assert_eq!(count(), 0);
    db.execute_batch("DROP TRIGGER merge_journal_fail").unwrap();
    call(&app, json!({"op":"merge_apply","id":p["id"]}));
    assert!(count() >= 4);
    let mut q = db
        .prepare("SELECT DISTINCT kind,id FROM sync_journal")
        .unwrap();
    let rows = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(rows
        .iter()
        .all(|(kind, _)| kind == "note" || kind == "setting"));
    assert!(!rows.iter().any(|(_, id)| id == p["id"].as_str().unwrap()));
    db.execute_batch("DELETE FROM sync_journal").unwrap();
    call(&app, json!({"op":"merge_undo","id":p["id"]}));
    assert!(count() >= 4);
    assert_eq!(
        call(&app, json!({"op":"get","id":t["id"]}))["content"],
        t["content"]
    );
    assert_eq!(
        call(&app, json!({"op":"get","id":s["id"]}))["trashed"],
        false
    );
}
