//! Notebook trash: chosen notebook 'user', live sub-notebooks 'app', optional
//! note trash, restore and permanent delete of the trashed subtree, live reads
//! hide trash, backups keep the state.
use inkism_engine::Engine;
use serde_json::{json, Value};

struct Dir(std::path::PathBuf);
impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn ok(res: Value) -> Value {
    assert_eq!(res["ok"], true, "expected ok response, got {res}");
    res["data"].clone()
}

fn live_ids(e: &Engine) -> Vec<String> {
    ok(e.execute(json!({"op":"notebooks"}))).as_array().unwrap().iter()
        .map(|nb| nb["id"].as_str().unwrap().to_string()).collect()
}

#[test]
fn notebook_trash_moves_subtree_and_restores_together() {
    let dir = Dir(std::env::temp_dir().join(format!("inkism-notebook-trash-{}", std::process::id())));
    std::fs::create_dir_all(&dir.0).unwrap();
    let e = Engine::open(dir.0.join("a.db").to_str().unwrap()).unwrap();
    let root = ok(e.execute(json!({"op":"save_notebook","name":"상위"})))["id"].clone();
    let child = ok(e.execute(json!({"op":"save_notebook","name":"하위","parent_id":root})))["id"].clone();
    let other = ok(e.execute(json!({"op":"save_notebook","name":"다른"})))["id"].clone();
    let note = ok(e.execute(json!({"op":"save","note":{"title":"t","content":"<p>x</p>","text":"x","notebook_id":child}})));
    ok(e.execute(json!({"op":"defaults_set","notebook_id":child})));

    let trashed = ok(e.execute(json!({"op":"trash_notebook","id":root,"trash_notes":true})));
    assert_eq!(trashed["trashed"].as_array().unwrap().len(), 2);
    assert_eq!(trashed["notes"], 1);
    assert_eq!(live_ids(&e), vec![other.as_str().unwrap().to_string()]);
    let listed = ok(e.execute(json!({"op":"trashed_notebooks"})));
    assert_eq!(listed.as_array().unwrap().len(), 1, "sub-notebooks are listed through the parent");
    assert!(ok(e.execute(json!({"op":"defaults_get"})))["notebook_id"].is_null());
    let saved = ok(e.execute(json!({"op":"get","id":note["id"]})));
    assert_eq!(saved["trashed"], true);
    assert_eq!(saved["notebook_ids"], json!([child]), "membership is kept");

    // Backup keeps trash state.
    let path = dir.0.join("backup.json");
    ok(e.execute(json!({"op":"export","path":path.to_string_lossy()})));
    let fresh = Engine::open(dir.0.join("b.db").to_str().unwrap()).unwrap();
    ok(fresh.execute(json!({"op":"import","path":path.to_string_lossy()})));
    assert_eq!(live_ids(&fresh).len(), 1);
    assert_eq!(ok(fresh.execute(json!({"op":"trashed_notebooks"}))).as_array().unwrap().len(), 1);

    ok(e.execute(json!({"op":"restore_notebook","id":root})));
    assert_eq!(live_ids(&e).len(), 3);
    assert_eq!(ok(e.execute(json!({"op":"defaults_get"})))["notebook_id"], child);

    // Permanent delete from trash removes the trashed subtree only.
    ok(e.execute(json!({"op":"trash_notebook","id":root})));
    let removed = ok(e.execute(json!({"op":"delete_notebook","id":root})));
    assert_eq!(removed["removed"].as_array().unwrap().len(), 2);
    assert_eq!(live_ids(&e), vec![other.as_str().unwrap().to_string()]);
    assert_eq!(ok(e.execute(json!({"op":"get","id":note["id"]})))["notebook_ids"], json!([]));
    assert_eq!(e.execute(json!({"op":"restore_notebook","id":other}))["ok"], false);
}
