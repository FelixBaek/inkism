use inkism_engine::Engine;
use serde_json::{json, Value};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("inkism-named-{}.db", uuid::Uuid::new_v4())))
    }
    fn open(&self) -> Engine {
        Engine::open(self.0.to_str().unwrap()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm", ".search", ".search-wal", ".search-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}
#[test]
fn named_checkpoint_pruning_cas_body_rename_restore_delete() {
    let db = Fixture::new();
    let e = db.open();
    let mut note=ok(e.execute(json!({"op":"save","note":{"title":"A","content":"# exact original","content_format":"markdown"}})));
    let h=ok(e.execute(json!({"op":"history_name_current","id":note["id"],"revision":note["revision"],"label":"First"})));
    for i in 0..25 {
        note=ok(e.execute(json!({"op":"save","note":{"id":note["id"],"revision":note["revision"],"title":"A","content_format":"markdown","content":format!("# changed {i}")}})));
    }
    let history = ok(e.execute(json!({"op":"history","id":note["id"]})));
    assert_eq!(history.as_array().unwrap().len(), 21);
    assert_eq!(
        history
            .as_array()
            .unwrap()
            .iter()
            .filter(|h| h["label"] == "First")
            .count(),
        1
    );
    assert_eq!(
        ok(e.execute(json!({"op":"history_body","id":note["id"],"history_id":h["id"]})))["content"],
        "# exact original"
    );
    assert_eq!(
        e.execute(
            json!({"op":"history_name_current","id":note["id"],"revision":1,"label":"stale"})
        )["ok"],
        false
    );
    ok(e.execute(json!({"op":"history_rename","id":note["id"],"revision":note["revision"],"history_id":h["id"],"expected_label":"First","label":"Release"})));
    assert_eq!(e.execute(json!({"op":"history_delete_named","id":note["id"],"revision":note["revision"],"history_id":h["id"],"expected_label":"First"}))["ok"],false);
    note = ok(e.execute(
        json!({"op":"restore","id":note["id"],"revision":note["revision"],"history_id":h["id"]}),
    ));
    assert_eq!(note["content"], "# exact original");
    assert_eq!(note["content_format"], "markdown");
    drop(e);
    let e = db.open();
    assert_eq!(
        ok(e.execute(json!({"op":"history_body","id":note["id"],"history_id":h["id"]})))["content"],
        "# exact original"
    );
    ok(e.execute(json!({"op":"history_delete_named","id":note["id"],"revision":note["revision"],"history_id":h["id"],"expected_label":"Release"})));
    assert_eq!(
        e.execute(json!({"op":"history_body","id":note["id"],"history_id":h["id"]}))["ok"],
        false
    );
}
#[test]
fn named_backup_exact_body_new_ids_and_locked_guard() {
    let db = Fixture::new();
    let e = db.open();
    let n=ok(e.execute(json!({"op":"save","note":{"title":"Backup","content":"<p>original <img src=\"/api/attachments/11111111-1111-4111-8111-111111111111\"></p>"}})));
    ok(e.execute(
        json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"Kept"}),
    ));
    let lock=inkism_engine::vault::LockedBody{key_id:uuid::Uuid::new_v4().to_string(),ciphertext:"test ciphertext".into(),attachments:vec![]};
    assert!(inkism_engine::vault::store_locked(e.connection(),n["id"].as_str().unwrap(),&lock).is_err());
    assert_eq!(ok(e.execute(json!({"op":"get","id":n["id"]})))["content"],n["content"]);
    let backup = db.0.with_extension("json");
    ok(e.execute(json!({"op":"export","path":backup})));
    let other = Fixture::new();
    let dst = other.open();
    ok(dst.execute(json!({"op":"import","path":backup})));
    let items = ok(dst.execute(json!({"op":"list","view":"all"})));
    let id = &items["items"][0]["id"];
    assert_ne!(id, &n["id"]);
    let h = ok(dst.execute(json!({"op":"history","id":id})));
    assert_eq!(h[0]["label"], "Kept");
    assert!(h[0]["note_revision"].is_null());
    assert_eq!(
        ok(dst.execute(json!({"op":"history_body","id":id,"history_id":h[0]["id"]})))["content"],
        n["content"]
    );
    e.connection()
        .execute(
            "UPDATE notes_meta SET readonly=1 WHERE id=?1",
            [n["id"].as_str().unwrap()],
        )
        .unwrap();
    assert_eq!(
        e.execute(
            json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"No"})
        )["ok"],
        false
    );
    let mut payload: Value = serde_json::from_slice(&std::fs::read(&backup).unwrap()).unwrap();
    payload["notes"][0]["named_versions"][0]["label"] = json!("");
    std::fs::write(&backup, serde_json::to_vec(&payload).unwrap()).unwrap();
    assert_eq!(
        dst.execute(json!({"op":"import","path":backup}))["ok"],
        false
    );
    assert_eq!(
        ok(dst.execute(json!({"op":"list","view":"all"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    std::fs::remove_file(backup).unwrap();
}
#[test]
fn named_limit_does_not_evict_saved_versions() {
    let db = Fixture::new();
    let e = db.open();
    let n = ok(e.execute(json!({"op":"save","note":{"title":"limit"}})));
    for i in 0..100 {
        ok(e.execute(json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":format!("Version {i}")})));
    }
    assert_eq!(
        e.execute(
            json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"101"})
        )["ok"],
        false
    );
    assert_eq!(
        ok(e.execute(json!({"op":"history","id":n["id"]})))
            .as_array()
            .unwrap()
            .len(),
        100
    );
}
