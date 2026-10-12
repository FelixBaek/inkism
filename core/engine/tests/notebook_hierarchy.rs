//! Notebook hierarchy acceptance tests — engine level only, driven exactly
//! like the Go bridge does (Engine::execute JSON envelopes, own temp DB per
//! test; helpers mirror integration.rs).
//!
//! Confirmed API under test (nested tree only; notebook_id / Notes membership
//! and the detach-not-delete contract are unchanged):
//!   * save_notebook: optional parent_id (null = root) and description
//!     (null = ""); renaming with both fields omitted keeps stored values; a
//!     local parent must be an existing valid id — direct self, indirect
//!     cycle, wrong type and missing parent are rejected and leave the
//!     original row untouched.
//!   * notebooks: rows carry parent_id + description.
//!   * delete_notebook: child notebooks are promoted to root.
//!   * export v2 / import: parent ids are remapped to fresh ids, child-before-
//!     parent entry order is accepted, missing-parent/cycle backups are
//!     rejected before anything is written; older backups without the fields
//!     import as root / empty.
//!
//! Not executed yet by instruction (user notes/UI testing is paused); run
//! later with `cargo test --test notebook_hierarchy`.

use inkism_engine::Engine;
use serde_json::{json, Value};

struct TempDb {
    dir: std::path::PathBuf,
    path: String,
}

impl TempDb {
    fn new(tag: &str) -> TempDb {
        let dir = std::env::temp_dir().join(format!(
            "inkism-nbh-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("library.db").to_string_lossy().into_owned();
        TempDb { dir, path }
    }
    fn open(&self) -> Engine {
        Engine::open(&self.path).unwrap()
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn ok(res: Value) -> Value {
    assert_eq!(res["ok"], true, "expected ok response, got {res}");
    res["data"].clone()
}

fn err(res: Value) -> String {
    assert_eq!(res["ok"], false, "expected error response, got {res}");
    res["error"].as_str().unwrap().to_string()
}

fn nb<'a>(list: &'a Value, id: &str) -> &'a Value {
    list.as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"].as_str() == Some(id))
        .unwrap_or_else(|| panic!("notebook {id} missing from {list}"))
}

fn save_note(e: &Engine, title: &str, text: &str, notebook_id: &Value) -> Value {
    ok(e.execute(json!({"op":"save","note":{"title":title,
        "content":format!("<p>{text}</p>"),"text":text,"notebook_id":notebook_id}})))
}

// ---- save_notebook fields, rename-only preservation, parent rejection -------

#[test]
fn save_notebook_hierarchy_fields_preserved_on_rename_and_bad_parents_rejected() {
    let t = TempDb::new("nb-fields");
    let e = t.open();
    // Omitted parent/description create a root notebook with empty description.
    let root = ok(e.execute(json!({"op":"save_notebook","name":"상위"})));
    let root_id = root["id"].as_str().unwrap().to_string();
    assert!(root["parent_id"].is_null());
    assert_eq!(root["description"], "");
    let child = ok(e.execute(json!({"op":"save_notebook","name":"하위",
        "parent_id":root_id,"description":"메모"})));
    let child_id = child["id"].as_str().unwrap().to_string();
    assert_eq!(child["parent_id"], root_id.as_str());
    assert_eq!(child["description"], "메모");
    // The notebooks listing reports the tree fields.
    let listed = ok(e.execute(json!({"op":"notebooks"})));
    assert!(nb(&listed, &root_id)["parent_id"].is_null());
    assert_eq!(nb(&listed, &root_id)["description"], "");
    assert_eq!(nb(&listed, &child_id)["parent_id"], root_id.as_str());
    assert_eq!(nb(&listed, &child_id)["description"], "메모");

    // Every rejection must leave both rows exactly as they are.
    let before = listed.clone();
    let ghost = "ghost-parent-id";
    assert!(
        err(
            e.execute(json!({"op":"save_notebook","id":root_id,"name":"상위",
        "parent_id":root_id}))
        )
        .contains("cycle"),
        "direct self parent"
    );
    assert!(
        err(
            e.execute(json!({"op":"save_notebook","id":root_id,"name":"상위",
        "parent_id":child_id}))
        )
        .contains("cycle"),
        "indirect cycle via child"
    );
    assert!(
        err(e.execute(json!({"op":"save_notebook","name":"고아",
        "parent_id":ghost})))
        .contains("parent"),
        "create under missing parent"
    );
    assert!(
        err(
            e.execute(json!({"op":"save_notebook","id":child_id,"name":"하위",
        "parent_id":ghost}))
        )
        .contains("parent"),
        "reparent to missing parent"
    );
    assert!(
        err(
            e.execute(json!({"op":"save_notebook","id":child_id,"name":"하위",
        "parent_id":7}))
        )
        .contains("parent_id"),
        "wrong parent type"
    );
    assert!(
        err(
            e.execute(json!({"op":"save_notebook","id":child_id,"name":"하위",
        "description":7}))
        )
        .contains("description"),
        "wrong description type"
    );
    err(
        e.execute(json!({"op":"save_notebook","id":child_id,"name":"하위",
        "parent_id":"bad id!"})),
    ); // not even a valid id shape
    let after = ok(e.execute(json!({"op":"notebooks"})));
    assert_eq!(nb(&after, &root_id), nb(&before, &root_id));
    assert_eq!(nb(&after, &child_id), nb(&before, &child_id));
    assert_eq!(after.as_array().unwrap().len(), 2, "orphan was never added");

    // Rename without parent/description keys keeps the stored values.
    let renamed = ok(e.execute(json!({"op":"save_notebook","id":child_id,"name":"바꾼이름"})));
    assert_eq!(renamed["parent_id"], root_id.as_str());
    assert_eq!(renamed["description"], "메모");
    // Explicit null clears: parent -> root, description -> "".
    let cleared = ok(
        e.execute(json!({"op":"save_notebook","id":child_id,"name":"바꾼이름",
        "parent_id":null,"description":null})),
    );
    assert!(cleared["parent_id"].is_null());
    assert_eq!(cleared["description"], "");
    // New values persist across reopen (real columns, not in-memory state).
    ok(
        e.execute(json!({"op":"save_notebook","id":child_id,"name":"하위",
        "parent_id":root_id,"description":"최종"})),
    );
    drop(e);
    let e = t.open();
    let listed = ok(e.execute(json!({"op":"notebooks"})));
    assert_eq!(nb(&listed, &child_id)["parent_id"], root_id.as_str());
    assert_eq!(nb(&listed, &child_id)["description"], "최종");
    assert!(nb(&listed, &root_id)["parent_id"].is_null());
}

// ---- delete_notebook promotes children, notes detached (existing contract) --

#[test]
fn delete_notebook_promotes_children_to_root_and_detaches_notes() {
    let t = TempDb::new("nb-delete");
    let e = t.open();
    let a = ok(e.execute(json!({"op":"save_notebook","name":"A"})));
    let b = ok(e.execute(json!({"op":"save_notebook","name":"B","parent_id":a["id"]})));
    let c = ok(e.execute(json!({"op":"save_notebook","name":"C","parent_id":b["id"]})));
    let note_a = save_note(&e, "A노트", "a본문", &a["id"]);
    let note_b = save_note(&e, "B노트", "b본문", &b["id"]);

    let deleted = ok(e.execute(json!({"op":"delete_notebook","id":a["id"]})));
    assert_eq!(deleted["deleted"], true);
    assert_eq!(deleted["updated"], 1, "only A's own note is detached");
    let listed = ok(e.execute(json!({"op":"notebooks"})));
    assert_eq!(listed.as_array().unwrap().len(), 2);
    assert!(
        nb(&listed, b["id"].as_str().unwrap())["parent_id"].is_null(),
        "child promoted to root"
    );
    assert_eq!(
        nb(&listed, c["id"].as_str().unwrap())["parent_id"],
        b["id"],
        "grandchild stays under its parent"
    );
    // Notes are detached, never deleted (protocol): body kept, revision bump.
    let kept = ok(e.execute(json!({"op":"get","id":note_a["id"]})));
    assert!(kept["notebook_id"].is_null());
    assert_eq!(kept["content"], note_a["content"]);
    assert_eq!(kept["text"], note_a["text"]);
    assert_eq!(
        kept["revision"].as_i64().unwrap(),
        note_a["revision"].as_i64().unwrap() + 1
    );
    assert_eq!(ok(e.execute(json!({"op":"get","id":note_b["id"]}))), note_b);

    // Deleting the promoted child keeps its own subtree contract intact.
    ok(e.execute(json!({"op":"delete_notebook","id":b["id"]})));
    let listed = ok(e.execute(json!({"op":"notebooks"})));
    let rows = listed.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], c["id"]);
    assert!(rows[0]["parent_id"].is_null());
    assert!(ok(e.execute(json!({"op":"get","id":note_b["id"]})))["notebook_id"].is_null());
    assert!(err(e.execute(json!({"op":"delete_notebook","id":a["id"]}))).contains("not_found"));
}

// ---- backup v2: parent remap, order tolerance, whole-file graph validation --

#[test]
fn backup_roundtrip_remaps_parents_and_rejects_broken_trees_before_writing() {
    let t = TempDb::new("nb-backup");
    let e = t.open();
    let a = ok(e.execute(json!({"op":"save_notebook","name":"상위","description":"반가워"})));
    let b = ok(e.execute(json!({"op":"save_notebook","name":"하위",
        "parent_id":a["id"],"description":"메모"})));
    save_note(&e, "노트", "본문", &b["id"]);
    let file = t.dir.join("tree.json");
    ok(e.execute(json!({"op":"export","path":file.to_string_lossy()})));
    let backup: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert_eq!(backup["version"], 2);
    let exported = backup["notebooks"].as_array().unwrap();
    let exported_parent = exported.iter().find(|n| n["id"] == a["id"]).unwrap();
    let exported_child = exported.iter().find(|n| n["id"] == b["id"]).unwrap();
    assert!(exported_parent["parent_id"].is_null());
    assert_eq!(exported_parent["description"], "반가워");
    assert_eq!(exported_child["parent_id"], a["id"]);

    // Import: fresh ids, parent references remapped to them.
    let dest = TempDb::new("nb-backup-in");
    let d = dest.open();
    assert_eq!(
        ok(d.execute(json!({"op":"import","path":file.to_string_lossy()})))["imported"],
        1
    );
    let listed = ok(d.execute(json!({"op":"notebooks"})));
    let rows = listed.as_array().unwrap();
    let new_a = rows.iter().find(|n| n["name"] == "상위").unwrap();
    let new_b = rows.iter().find(|n| n["name"] == "하위").unwrap();
    assert_ne!(new_a["id"], a["id"], "import must use fresh ids");
    assert!(new_a["parent_id"].is_null());
    assert_eq!(new_b["parent_id"], new_a["id"]);
    assert_eq!(new_b["description"], "메모");

    // Child-before-parent entry order must import; parents resolve by old id.
    let reorder = dest.dir.join("reorder.json");
    std::fs::write(
        &reorder,
        json!({"version":2,"notes":[],
        "notebooks":[{"id":"kid","name":"자식","parent_id":"mom","description":"설명"},
                     {"id":"mom","name":"부모"}]})
        .to_string(),
    )
    .unwrap();
    ok(d.execute(json!({"op":"import","path":reorder.to_string_lossy()})));
    let listed = ok(d.execute(json!({"op":"notebooks"})));
    let rows = listed.as_array().unwrap();
    let mom = rows.iter().find(|n| n["name"] == "부모").unwrap();
    let kid = rows.iter().find(|n| n["name"] == "자식").unwrap();
    assert!(mom["parent_id"].is_null());
    assert_eq!(mom["description"], "");
    assert_eq!(kid["parent_id"], mom["id"]);
    let count = rows.len();

    // Broken graphs are rejected before anything is written.
    let broken = dest.dir.join("broken.json");
    for tree in [
        json!({"version":2,"notes":[],
            "notebooks":[{"id":"x","name":"고아","parent_id":"ghost"}]}),
        json!({"version":2,"notes":[],
            "notebooks":[{"id":"p","parent_id":"q"},{"id":"q","parent_id":"p"}]}),
        json!({"version":2,"notes":[],
            "notebooks":[{"id":"x","parent_id":7}]}),
        json!({"version":2,"notes":[],
            "notebooks":[{"id":"x","description":7}]}),
    ] {
        std::fs::write(&broken, tree.to_string()).unwrap();
        err(d.execute(json!({"op":"import","path":broken.to_string_lossy()})));
        assert_eq!(
            ok(d.execute(json!({"op":"notebooks"})))
                .as_array()
                .unwrap()
                .len(),
            count
        );
    }

    // Older backups without the new fields import as root / empty description.
    let legacy = dest.dir.join("legacy.json");
    std::fs::write(
        &legacy,
        json!({"version":1,"notes":[],
        "notebooks":[{"id":"old","name":"옛노트북"}]})
        .to_string(),
    )
    .unwrap();
    ok(d.execute(json!({"op":"import","path":legacy.to_string_lossy()})));
    let listed = ok(d.execute(json!({"op":"notebooks"})));
    let old = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["name"] == "옛노트북")
        .unwrap();
    assert!(old["parent_id"].is_null());
    assert_eq!(old["description"], "");
}
