use inkism_engine::Engine;
use serde_json::{json, Value};
struct Db(std::path::PathBuf);
impl Db {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("inkism-tags-{}.db", uuid::Uuid::new_v4())))
    }
    fn open(&self) -> Engine {
        Engine::open(self.0.to_str().unwrap()).unwrap()
    }
}
impl Drop for Db {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm", ".search", ".search-wal", ".search-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn note(e: &Engine, title: &str, tags: Value) -> Value {
    ok(e.execute(
        json!({"op":"save","note":{"title":title,"content":"<p>body unchanged</p>","tags":tags}}),
    ))
}
fn preview(e: &Engine) -> Value {
    ok(e.execute(json!({"op":"tag_change_preview","name":"old","replacement":"new","limit":2})))
}
fn apply(e: &Engine, p: &Value) -> Value {
    ok(e.execute(json!({"op":"tag_change_apply","preview_id":p["id"]})))
}
fn get(e: &Engine, n: &Value) -> Value {
    ok(e.execute(json!({"op":"get","id":n["id"]})))
}
#[test]
fn preview_merge_exact_undo_restart_exclusions_and_default() {
    let db = Db::new();
    let e = db.open();
    let a = note(&e, "A", json!(["old", "new", "keep"]));
    let b = note(&e, "B", json!(["old"]));
    let ro = note(&e, "readonly", json!(["old"]));
    let locked = note(&e, "locked", json!(["old"]));
    let archived = note(&e, "archive trash", json!(["old"]));
    e.connection()
        .execute(
            "UPDATE notes_meta SET readonly=1 WHERE id=?1",
            [ro["id"].as_str().unwrap()],
        )
        .unwrap();
    e.connection()
        .execute(
            "UPDATE notes_meta SET locked=1 WHERE id=?1",
            [locked["id"].as_str().unwrap()],
        )
        .unwrap();
    e.connection()
        .execute(
            "UPDATE notes_meta SET archived=1,trashed=1 WHERE id=?1",
            [archived["id"].as_str().unwrap()],
        )
        .unwrap();
    ok(e.execute(json!({"op":"defaults_set","tag":"old"})));
    let p = preview(&e);
    assert_eq!(p["total"], 5);
    assert_eq!(p["eligible_count"], 3);
    assert_eq!(p["excluded_count"], 2);
    assert_eq!(p["items"].as_array().unwrap().len(), 2);
    assert_eq!(p["next_offset"], 2);
    assert_eq!(p["default_tag"]["changes"], true);
    assert_eq!(get(&e, &a)["tags"], a["tags"]);
    let rest = ok(
        e.execute(json!({"op":"tag_change_preview","preview_id":p["id"],"offset":2,"limit":100}))
    );
    assert_eq!(rest["items"].as_array().unwrap().len(), 3);
    let result = apply(&e, &p);
    assert_eq!(result["updated"], 3);
    assert_eq!(get(&e, &a)["tags"], json!(["keep", "new"]));
    assert_eq!(get(&e, &b)["tags"], json!(["new"]));
    assert_eq!(get(&e, &archived)["tags"], json!(["new"]));
    assert_eq!(get(&e, &ro)["tags"], json!(["old"]));
    assert_eq!(result["default_tag"], "new");
    assert_eq!(apply(&e, &p), result, "apply retry is idempotent");
    drop(e);
    let e = db.open();
    let receipts = ok(e.execute(json!({"op":"tag_change_list"})));
    assert_eq!(receipts["items"][0]["id"], p["id"]);
    let undone = ok(e.execute(json!({"op":"tag_change_undo","id":p["id"]})));
    assert_eq!(undone["default_tag"], "old");
    assert_eq!(
        get(&e, &a)["tags"],
        a["tags"],
        "merged preexisting destination restored exactly"
    );
    assert_eq!(get(&e, &b)["tags"], b["tags"]);
    assert_eq!(get(&e, &a)["content"], "<p>body unchanged</p>");
    assert_eq!(
        get(&e, &a)["revision"].as_i64().unwrap(),
        a["revision"].as_i64().unwrap() + 2
    );
    assert_eq!(
        ok(e.execute(json!({"op":"tag_change_undo","id":p["id"]}))),
        undone,
        "undo retry is idempotent"
    );
}
#[test]
fn apply_rejects_new_deleted_changed_protection_and_default_targets() {
    for mutation in ["new", "delete", "revision", "readonly", "locked", "default"] {
        let db = Db::new();
        let e = db.open();
        let a = note(&e, "A", json!(["old"]));
        let b = note(&e, "B", json!(["old"]));
        let p = preview(&e);
        match mutation {
            "new" => {
                note(&e, "new target", json!(["old"]));
            }
            "delete" => {
                e.connection()
                    .execute(
                        "DELETE FROM notes_meta WHERE id=?1",
                        [b["id"].as_str().unwrap()],
                    )
                    .unwrap();
            }
            "revision" => {
                e.connection()
                    .execute(
                        "UPDATE notes_meta SET revision=revision+1 WHERE id=?1",
                        [b["id"].as_str().unwrap()],
                    )
                    .unwrap();
            }
            "readonly" | "locked" => {
                e.connection()
                    .execute(
                        &format!("UPDATE notes_meta SET {mutation}=1 WHERE id=?1"),
                        [b["id"].as_str().unwrap()],
                    )
                    .unwrap();
            }
            _ => {
                ok(e.execute(json!({"op":"defaults_set","tag":"old"})));
            }
        }
        let result = e.execute(json!({"op":"tag_change_apply","preview_id":p["id"]}));
        assert_eq!(result["ok"], false, "{mutation}: {result}");
        assert_eq!(get(&e, &a)["tags"], json!(["old"]));
        assert_eq!(get(&e, &a)["revision"], a["revision"]);
    }
}
#[test]
fn undo_conflicts_are_atomic_and_default_aba_is_not_ignored() {
    for mutation in ["note", "default"] {
        let db = Db::new();
        let e = db.open();
        let a = note(&e, "A", json!(["old"]));
        let b = note(&e, "B", json!(["old", "new"]));
        ok(e.execute(json!({"op":"defaults_set","tag":"old"})));
        let p = preview(&e);
        apply(&e, &p);
        if mutation == "note" {
            e.connection()
                .execute(
                    "UPDATE notes_meta SET revision=revision+1 WHERE id=?1",
                    [b["id"].as_str().unwrap()],
                )
                .unwrap();
        } else {
            ok(e.execute(json!({"op":"defaults_set","tag":"other"})));
            ok(e.execute(json!({"op":"defaults_set","tag":"new"})));
        }
        assert_eq!(
            e.execute(json!({"op":"tag_change_undo","id":p["id"]}))["ok"],
            false
        );
        assert_eq!(get(&e, &a)["tags"], json!(["new"]));
        assert_eq!(
            get(&e, &a)["revision"].as_i64().unwrap(),
            a["revision"].as_i64().unwrap() + 1
        );
    }
}
#[test]
fn mid_apply_failure_rolls_back_note_history_index_and_receipt() {
    let db = Db::new();
    let e = db.open();
    let a = note(&e, "A", json!(["old"]));
    let b = note(&e, "B", json!(["old"]));
    let p = preview(&e);
    let items = ok(e.execute(json!({"op":"tag_change_preview","preview_id":p["id"],"limit":100})));
    let last = items["items"][1]["id"].as_str().unwrap();
    e.connection()
        .execute("DELETE FROM notes_body WHERE note_id=?1", [last])
        .unwrap();
    let histories: i64 = e
        .connection()
        .query_row("SELECT count(*) FROM history", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        e.execute(json!({"op":"tag_change_apply","preview_id":p["id"]}))["ok"],
        false
    );
    for n in [a, b] {
        let revision: i64 = e
            .connection()
            .query_row(
                "SELECT revision FROM notes_meta WHERE id=?1",
                [n["id"].as_str().unwrap()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(revision, n["revision"].as_i64().unwrap());
    }
    assert_eq!(
        e.connection()
            .query_row("SELECT count(*) FROM history", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        histories
    );
    assert_eq!(
        ok(e.execute(json!({"op":"tag_change_preview","preview_id":p["id"]})))["status"],
        "preview"
    );
}
#[test]
fn optional_current_revision_guards_and_returns_metadata_only() {
    let db = Db::new();
    let e = db.open();
    let target = note(&e, "target", json!(["old"]));
    let other = note(&e, "current", json!([]));
    let p = preview(&e);
    assert_eq!(e.execute(json!({"op":"tag_change_apply","preview_id":p["id"],"current_id":other["id"],"current_revision":99}))["ok"],false);
    let applied=ok(e.execute(json!({"op":"tag_change_apply","preview_id":p["id"],"current_id":target["id"],"current_revision":target["revision"]})));
    assert_eq!(applied["current"]["tags"], json!(["new"]));
    assert!(applied["current"].get("content").is_none());
    assert_eq!(e.execute(json!({"op":"tag_change_undo","id":p["id"],"current_id":target["id"],"current_revision":target["revision"]}))["ok"],false);
    let undone=ok(e.execute(json!({"op":"tag_change_undo","id":p["id"],"current_id":target["id"],"current_revision":applied["current"]["revision"]})));
    assert_eq!(undone["current"]["tags"], json!(["old"]));
}
#[test]
fn removal_restores_exact_tags_and_retains_twenty_receipts() {
    let db = Db::new();
    let e = db.open();
    let a = note(&e, "A", json!(["old", "other"]));
    ok(e.execute(json!({"op":"defaults_set","tag":"old"})));
    let p = ok(e.execute(json!({"op":"tag_change_preview","name":"old","replacement":null})));
    assert_eq!(apply(&e, &p)["default_tag"], Value::Null);
    assert_eq!(get(&e, &a)["tags"], json!(["other"]));
    ok(e.execute(json!({"op":"tag_change_undo","id":p["id"]})));
    assert_eq!(get(&e, &a)["tags"], a["tags"]);
    for _ in 0..22 {
        let p = preview(&e);
        apply(&e, &p);
        ok(e.execute(json!({"op":"tag_change_undo","id":p["id"]})));
    }
    assert_eq!(
        ok(e.execute(json!({"op":"tag_change_list"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        20
    );
}

#[test]
fn preview_is_bounded_and_index_jobs_share_the_note_transaction() {
    let db = Db::new();
    let e = db.open();
    for i in 0..101 {
        note(&e, &format!("note {i}"), json!(["old"]));
    }
    e.wait_index(10000).unwrap();
    drop(e);
    let c = rusqlite::Connection::open(&db.0).unwrap();
    let p = inkism_engine::tag_changes::preview(
        &c,
        &json!({"name":"old","replacement":"new","limit":999}),
    )
    .unwrap();
    assert_eq!(p["items"].as_array().unwrap().len(), 100);
    assert_eq!(p["total"], 101);
    assert_eq!(p["next_offset"], 100);
    assert_eq!(
        c.query_row("SELECT count(*) FROM index_jobs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    inkism_engine::tag_changes::apply(&c, &json!({"preview_id":p["id"]})).unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM index_jobs WHERE version=2", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        101
    );
    inkism_engine::tag_changes::undo(&c, &json!({"id":p["id"]})).unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM index_jobs WHERE version=3", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        101
    );
    let p =
        inkism_engine::tag_changes::preview(&c, &json!({"name":"old","replacement":null})).unwrap();
    let last: String = c
        .query_row(
            "SELECT id FROM notes_meta ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    c.execute("DELETE FROM notes_body WHERE note_id=?1", [&last])
        .unwrap();
    assert!(inkism_engine::tag_changes::apply(&c, &json!({"preview_id":p["id"]})).is_err());
    assert_eq!(
        c.query_row("SELECT count(*) FROM index_jobs WHERE version=3", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        101
    );
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM notes_meta WHERE revision=3",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        101
    );
}

fn tag_color(e: &Engine, name: &str) -> Value {
    let tags = ok(e.execute(json!({"op":"tags"})));
    tags.as_array().unwrap().iter().find(|t| t["name"] == name).map(|t| t["color"].clone()).unwrap_or(Value::Null)
}
#[test]
fn tag_color_follows_rename_undo_and_removal_and_notebook_icon() {
    let db = Db::new();
    let e = db.open();
    note(&e, "A", json!(["old", "other"]));
    assert_eq!(e.execute(json!({"op":"tag_color_set","name":"old","color":"red"}))["ok"], false);
    ok(e.execute(json!({"op":"tag_color_set","name":"old","color":"#e91e63"})));
    assert_eq!(tag_color(&e, "old"), "#e91e63");
    let p = preview(&e);
    apply(&e, &p);
    assert_eq!(tag_color(&e, "new"), "#e91e63", "rename keeps the color");
    ok(e.execute(json!({"op":"tag_change_undo","id":p["id"]})));
    assert_eq!(tag_color(&e, "old"), "#e91e63");
    assert_eq!(tag_color(&e, "new"), Value::Null);
    // Merging into a colored tag keeps the target's color.
    ok(e.execute(json!({"op":"tag_color_set","name":"other","color":"#2196f3"})));
    ok(e.execute(json!({"op":"change_tag","name":"old","replacement":"other"})));
    assert_eq!(tag_color(&e, "other"), "#2196f3");
    let removed = ok(e.execute(json!({"op":"tag_change_preview","name":"other","replacement":null})));
    apply(&e, &removed);
    note(&e, "B", json!(["other"]));
    assert_eq!(tag_color(&e, "other"), Value::Null, "removal drops the color");

    let nb = ok(e.execute(json!({"op":"save_notebook","name":"N"})))["id"].clone();
    assert_eq!(e.execute(json!({"op":"notebook_icon_set","id":nb,"icon":"Bad Icon"}))["ok"], false);
    ok(e.execute(json!({"op":"notebook_icon_set","id":nb,"icon":"briefcase"})));
    let icon = |e: &Engine| ok(e.execute(json!({"op":"notebooks"})))[0]["icon"].clone();
    assert_eq!(icon(&e), "briefcase");
    ok(e.execute(json!({"op":"notebook_icon_set","id":nb,"icon":null})));
    assert_eq!(icon(&e), Value::Null);
}
