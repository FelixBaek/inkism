//! Default notebook/tag: local set/delete/rename, backup export and remapped import that
//! never replaces a live choice, and rejection of dangling backup references.
use inkism_engine::Engine;
use serde_json::{json, Value};

struct Dir(std::path::PathBuf);
impl Dir {
    fn path(&self) -> &std::path::Path {
        &self.0
    }
}
impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn ok(res: Value) -> Value {
    assert_eq!(res["ok"], true, "expected ok response, got {res}");
    res["data"].clone()
}

#[test]
fn default_notebook_backup_remaps_and_keeps_live_choice() {
    let root = std::env::temp_dir().join(format!("inkism-default-notebook-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let dir = Dir(root);
    let e = Engine::open(dir.path().join("a.db").to_str().unwrap()).unwrap();
    let nb = ok(e.execute(json!({"op":"save_notebook","name":"기본"})))["id"].clone();
    assert_eq!(e.execute(json!({"op":"defaults_set","notebook_id":"missing"}))["ok"], false);
    ok(e.execute(json!({"op":"defaults_set","notebook_id":nb,"tag":"업무"})));
    let path = dir.path().join("backup.json");
    ok(e.execute(json!({"op":"export","path":path.to_string_lossy()})));
    let backup: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(backup["default_notebook"]["notebook_id"], nb);
    assert_eq!(backup["default_tag"]["tag"], "업무");

    // Into an empty library: the remapped copy becomes the default.
    let fresh = Engine::open(dir.path().join("b.db").to_str().unwrap()).unwrap();
    ok(fresh.execute(json!({"op":"import","path":path.to_string_lossy()})));
    let remapped = ok(fresh.execute(json!({"op":"defaults_get"})))["notebook_id"].clone();
    assert!(remapped.is_string() && remapped != nb);
    assert_eq!(ok(fresh.execute(json!({"op":"defaults_get"})))["tag"], "업무");

    // Into the original library: the live choice is kept.
    ok(e.execute(json!({"op":"import","path":path.to_string_lossy()})));
    assert_eq!(ok(e.execute(json!({"op":"defaults_get"})))["notebook_id"], nb);

    // Rename follows, removal clears.
    ok(e.execute(json!({"op":"change_tag","name":"업무","replacement":"일"})));
    assert_eq!(ok(e.execute(json!({"op":"defaults_get"})))["tag"], "일");
    ok(e.execute(json!({"op":"change_tag","name":"일","replacement":null})));
    assert!(ok(e.execute(json!({"op":"defaults_get"})))["tag"].is_null());

    // Deleting the default clears it; a dangling backup reference is rejected.
    ok(e.execute(json!({"op":"delete_notebook","id":nb})));
    assert!(ok(e.execute(json!({"op":"defaults_get"})))["notebook_id"].is_null());
    let bad = dir.path().join("bad.json");
    std::fs::write(&bad, serde_json::to_vec(&json!({"version":2,"notes":[],"notebooks":[],
        "default_notebook":{"notebook_id":"gone","updated_at":1}})).unwrap()).unwrap();
    assert_eq!(e.execute(json!({"op":"import","path":bad.to_string_lossy()}))["ok"], false);
}
