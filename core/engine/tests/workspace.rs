//! Workspace (open tabs) integration tests: run the engine exactly like the
//! Go bridge does — via `Engine::execute` JSON envelopes. Workspace state is
//! LOCAL only: persisted across reopen, excluded from logical backups, and
//! never derived from note bodies (workspace_get reads notes_meta titles).

use inkism_engine::Engine;
use serde_json::{json, Value};

struct TempDb {
    dir: std::path::PathBuf,
    path: String,
}

impl TempDb {
    fn new(tag: &str) -> TempDb {
        let dir = std::env::temp_dir().join(format!(
            "inkism-test-ws-{}-{}-{}",
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

fn save_note(e: &Engine, title: &str, text: &str) -> Value {
    ok(e.execute(json!({
        "op": "save",
        "note": { "title": title, "content": format!("<p>{text}</p>"), "text": text }
    })))
}

fn ws_get(e: &Engine) -> Value {
    ok(e.execute(json!({ "op": "workspace_get" })))
}

fn ws_set(e: &Engine, ids: Value, active: Value) -> Value {
    ok(e.execute(json!({ "op": "workspace_set", "ids": ids, "active": active })))
}

// ---- default empty state + set/get roundtrip --------------------------------

#[test]
fn default_empty_then_set_get_roundtrip() {
    let t = TempDb::new("ws-roundtrip");
    let e = t.open();
    // A fresh library has no workspace_state row: default empty state.
    assert_eq!(ws_get(&e), json!({ "tabs": [], "active": null }));

    let a = save_note(&e, "탭 A", "본문 A");
    let b = save_note(&e, "탭 B", "본문 B");
    let aid = a["id"].as_str().unwrap().to_string();
    let bid = b["id"].as_str().unwrap().to_string();

    assert_eq!(
        ws_set(&e, json!([aid, bid]), json!(bid)),
        json!({ "saved": true })
    );
    assert_eq!(
        ws_get(&e),
        json!({
            "tabs": [ {"id": aid, "title": "탭 A"}, {"id": bid, "title": "탭 B"} ],
            "active": bid
        })
    );
    // Tab order follows the ids order, not creation order.
    assert_eq!(
        ws_set(&e, json!([bid, aid]), json!(Value::Null)),
        json!({ "saved": true })
    );
    assert_eq!(ws_get(&e)["active"], Value::Null);
    let after = ws_get(&e);
    let tabs = after["tabs"].as_array().unwrap();
    assert_eq!(tabs[0]["id"].as_str().unwrap(), bid);
    assert_eq!(tabs[1]["id"].as_str().unwrap(), aid);
    // Empty ids + null active clears the workspace.
    ws_set(&e, json!([]), json!(Value::Null));
    assert_eq!(ws_get(&e), json!({ "tabs": [], "active": null }));
}

#[test]
fn workspace_persists_across_reopen_and_tracks_title_changes() {
    let t = TempDb::new("ws-reopen");
    let a = {
        let e = t.open();
        let a = save_note(&e, "재오픈 노트", "본문");
        ws_set(&e, json!([a["id"]]), json!(a["id"]));
        a
    };
    // Reopen: the id list and active tab survive (single-slot local row).
    {
        let e = t.open();
        let aid = a["id"].as_str().unwrap();
        assert_eq!(
            ws_get(&e),
            json!({ "tabs": [ {"id": aid, "title": "재오픈 노트"} ], "active": aid })
        );
        // Titles are read live from notes_meta, never cached in the row.
        ok(e.execute(json!({ "op": "save", "note": {
            "id": aid, "title": "바뀐 제목", "revision": a["revision"] } })));
        let got = ws_get(&e);
        assert_eq!(got["tabs"][0]["title"], "바뀐 제목");
    }
}

// ---- deleted ids are filtered at read time -----------------------------------

#[test]
fn get_filters_deleted_ids_and_drops_vanished_active() {
    let t = TempDb::new("ws-filter");
    let e = t.open();
    let a = save_note(&e, "삭제될 탭", "x");
    let b = save_note(&e, "살아남는 활성", "x");
    let c = save_note(&e, "살아남는 탭", "x");
    let (aid, bid, cid) = (
        a["id"].as_str().unwrap().to_string(),
        b["id"].as_str().unwrap().to_string(),
        c["id"].as_str().unwrap().to_string(),
    );
    ws_set(&e, json!([aid, bid, cid]), json!(bid));

    // Delete a NON-active tab: it disappears from tabs, active is untouched.
    ok(e.execute(json!({ "op": "patch", "id": aid, "changes": { "trashed": true } })));
    ok(e.execute(json!({ "op": "delete", "id": aid })));
    assert_eq!(
        ws_get(&e),
        json!({
            "tabs": [ {"id": bid, "title": "살아남는 활성"}, {"id": cid, "title": "살아남는 탭"} ],
            "active": bid
        })
    );

    // Delete the ACTIVE tab: it is filtered out and active degrades to null.
    ok(e.execute(json!({ "op": "patch", "id": bid, "changes": { "trashed": true } })));
    ok(e.execute(json!({ "op": "delete", "id": bid })));
    assert_eq!(
        ws_get(&e),
        json!({ "tabs": [ {"id": cid, "title": "살아남는 탭"} ], "active": null })
    );
    // Trash alone does NOT drop the tab: the note still exists in notes_meta
    // and remains openable (existence filter, not a trash filter).
    ok(e.execute(json!({ "op": "patch", "id": cid, "changes": { "trashed": true } })));
    let got = ws_get(&e);
    assert_eq!(got["tabs"].as_array().unwrap().len(), 1);
    // Hard delete the last tab too: empty tabs, null active.
    ok(e.execute(json!({ "op": "delete", "id": cid })));
    assert_eq!(ws_get(&e), json!({ "tabs": [], "active": null }));
}

// ---- validation: rejected input never disturbs the saved row ------------------

#[test]
fn invalid_set_preserves_previous_state() {
    let t = TempDb::new("ws-invalid");
    let e = t.open();
    let a = save_note(&e, "기존 탭", "x");
    let aid = a["id"].as_str().unwrap().to_string();
    ws_set(&e, json!([aid]), json!(aid));
    let before = ws_get(&e);

    let bad: Vec<Value> = vec![
        json!({ "ids": [aid, aid], "active": aid }), // duplicate id
        json!({ "ids": [aid, "나쁜 아이디!"], "active": aid }), // invalid id shape
        json!({ "ids": [aid], "active": "missing-id" }), // active not in ids
        json!({ "ids": [aid], "active": 42 }),       // active wrong type
        json!({ "ids": "not-an-array", "active": null }), // ids not an array
        json!({ "ids": [42], "active": null }),      // id element not a string
        json!({ "active": null }),                   // ids missing
        json!({ "ids": [aid], "active": aid, "extra": true }), // unknown extra is tolerated
    ];
    // The duplicate/shape/active/type cases must all fail; the state must
    // survive every one of them unchanged.
    for req in bad.iter().take(7) {
        let mut req = req.clone();
        req["op"] = json!("workspace_set");
        let msg = err(e.execute(req));
        assert!(msg.starts_with("invalid"), "expected invalid error: {msg}");
        assert_eq!(ws_get(&e), before, "state changed after rejected input");
    }
    // Unknown extra fields are ignored, so the last request SUCCEEDS and is
    // not part of the rejection matrix.
    let mut tolerant = bad[7].clone();
    tolerant["op"] = json!("workspace_set");
    assert_eq!(ok(e.execute(tolerant)), json!({ "saved": true }));

    // 256 ids is the accepted boundary; 257 is rejected.
    let notes: Vec<Value> = (0..256)
        .map(|i| save_note(&e, &format!("탭 노트 {i}"), "x"))
        .collect();
    let ids: Vec<String> = notes
        .iter()
        .map(|n| n["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        ws_set(&e, json!(ids.clone()), json!(ids[0])),
        json!({ "saved": true })
    );
    let got = ws_get(&e);
    assert_eq!(got["tabs"].as_array().unwrap().len(), 256);
    assert_eq!(got["active"], json!(ids[0]));

    let mut overflow = ids.clone();
    overflow.push("overflow-id".to_string());
    let req = json!({ "op": "workspace_set", "ids": overflow, "active": null });
    assert!(err(e.execute(req)).contains("max 256"));
    // ...and the rejection again left the previous (256-id) state intact.
    let got = ws_get(&e);
    assert_eq!(got["tabs"].as_array().unwrap().len(), 256);
}

// ---- local-only: logical backups never carry workspace state -------------------

#[test]
fn export_backup_omits_workspace_state() {
    let t = TempDb::new("ws-backup");
    let e = t.open();
    let a = save_note(&e, "백업 노트", "본문");
    ws_set(&e, json!([a["id"]]), json!(a["id"]));

    let out_path = t.dir.join("backup.json");
    ok(e.execute(json!({ "op": "export", "path": out_path.to_string_lossy() })));
    let backup: Value = serde_json::from_slice(&std::fs::read(&out_path).unwrap()).unwrap();
    let mut keys: Vec<&str> = backup
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["exported_at", "font_resources", "merge_redirects", "notebooks", "notes", "version", "workspace_tools"],
        "backup keys changed — ephemeral tabs must stay out; canvas/bookmarks/fonts are portable user data"
    );
    // Import into a fresh library: workspace starts empty there too.
    let t2 = TempDb::new("ws-backup-import");
    let e2 = t2.open();
    ok(e2.execute(json!({ "op": "import", "path": out_path.to_string_lossy() })));
    assert_eq!(ws_get(&e2), json!({ "tabs": [], "active": null }));
}

#[test]
fn positions_persist_but_stale_revisions_and_deleted_notes_are_filtered() {
    let t = TempDb::new("ws-positions");
    let a;
    let position = json!({"revision":1,"kind":"windowed","offset":4992,
        "selection":{"type":"text","anchor":7,"head":9}});
    {
        let e = t.open();
        a = save_note(&e, "구간 위치", "본문");
        ok(e.execute(
            json!({"op":"workspace_set","ids":[a["id"]],"active":a["id"],
            "locations":{a["id"].as_str().unwrap():position}}),
        ));
    }
    let e = t.open();
    let id = a["id"].as_str().unwrap();
    assert_eq!(ws_get(&e)["locations"][id], position);
    ok(e.execute(json!({"op":"save","note":{"id":id,"revision":1,"content":"<p>새 버전</p>"}})));
    assert!(ws_get(&e).get("locations").is_none());
    assert_eq!(ws_get(&e)["active"], id);
    ok(e.execute(json!({"op":"patch","id":id,"changes":{"trashed":true}})));
    ok(e.execute(json!({"op":"delete","id":id})));
    assert_eq!(ws_get(&e), json!({"tabs":[],"active":null}));
}

#[test]
fn invalid_position_payload_is_atomic_and_never_accepts_body_text() {
    let t = TempDb::new("ws-position-validation");
    let e = t.open();
    let a = save_note(&e, "원문", "본문");
    let id = a["id"].as_str().unwrap();
    let valid = json!({"revision":1,"kind":"source","offset":0,"scrollTop":1234.5,
        "selection":{"ranges":[{"anchor":2,"head":4}],"main":0}});
    ok(e.execute(json!({"op":"workspace_set","ids":[id],"active":id,"locations":{id:valid}})));
    let before = ws_get(&e);
    let mut bad = Vec::new();
    for (field, value) in [
        ("offset", json!(-1)),
        ("kind", json!("html")),
        ("revision", json!(0)),
        ("content", json!("본문은 위치 저장에 넣지 않는다")),
        ("scrollTop", json!(-1)),
        (
            "selection",
            json!({"ranges":[{"anchor":1,"head":"본문"}],"main":0}),
        ),
        (
            "selection",
            json!({"ranges":[{"anchor":1,"head":2}],"main":1}),
        ),
    ] {
        let mut p = valid.clone();
        p[field] = value;
        bad.push(json!({id:p}));
    }
    bad.push(json!({"not-open":valid}));
    for positions in bad {
        assert_eq!(
            e.execute(json!({"op":"workspace_set","ids":[id],"active":null,"locations":positions}))
                ["ok"],
            false
        );
        assert_eq!(ws_get(&e), before);
    }
    // Workspace positions remain local, just like tabs.
    let path = t.dir.join("positions-backup.json");
    ok(e.execute(json!({"op":"export","path":path})));
    let backup: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert!(backup.get("locations").is_none());
    assert!(backup["notes"][0].get("selection").is_none());
}

#[test]
fn v3_workspace_migration_keeps_existing_tabs() {
    let t = TempDb::new("ws-v3-migration");
    let a;
    {
        let e = t.open();
        a = save_note(&e, "이전 탭", "본문");
        ws_set(&e, json!([a["id"]]), a["id"].clone());
    }
    let c = rusqlite::Connection::open(&t.path).unwrap();
    c.execute_batch("ALTER TABLE workspace_state DROP COLUMN locations; PRAGMA user_version=3;")
        .unwrap();
    drop(c);
    let e = t.open();
    let saved = ws_get(&e);
    assert_eq!(saved["active"], a["id"]);
    assert_eq!(saved["tabs"][0]["title"], "이전 탭");
    assert!(saved.get("locations").is_none());
}

#[test]
fn markdown_positions_reopen_and_reject_malformed_selections_atomically() {
    let t = TempDb::new("ws-markdown");
    let id;
    let position = json!({"revision":1,"kind":"markdown","offset":0,"scrollTop":42.5,
        "selection":{"ranges":[{"anchor":3,"head":5},{"anchor":9,"head":9}],"main":1}});
    {
        let e = t.open();
        let note = save_note(&e, "Markdown", "original body");
        id = note["id"].as_str().unwrap().to_owned();
        ok(
            e.execute(json!({"op":"workspace_set","ids":[id],"active":id,
            "locations":{&id:position}})),
        );
    }
    let e = t.open();
    let before = ws_get(&e);
    assert_eq!(before["locations"][&id], position);
    for selection in [
        json!({"ranges":[],"main":0}),
        json!({"ranges":[{"anchor":0,"head":1}],"main":1}),
        json!({"ranges":[{"anchor":-1,"head":1}],"main":0}),
        json!({"ranges":[{"anchor":0,"head":2147483648_u64}],"main":0}),
        json!({"ranges":[{"anchor":0,"head":"body"}],"main":0}),
        json!({"ranges":[{"anchor":0,"head":1,"content":"body"}],"main":0}),
        json!({"ranges":[{"anchor":0,"head":1}],"main":0,"text":"body"}),
        json!({"type":"text","anchor":0,"head":1}),
        json!({"ranges":vec![json!({"anchor":0,"head":1});129],"main":0}),
    ] {
        let mut invalid = position.clone();
        invalid["selection"] = selection;
        assert_eq!(
            e.execute(json!({"op":"workspace_set","ids":[id],"active":null,
            "locations":{&id:invalid}}))["ok"],
            false
        );
        assert_eq!(ws_get(&e), before);
    }
    let note = ok(e.execute(json!({"op":"get","id":id})));
    assert_eq!(note["content"], "<p>original body</p>");
}

#[test]
fn windowed_source_byte_cursor_reopens_and_rejects_partial_pairs_atomically() {
    let db = TempDb::new("ws-segment-cursor");
    let id;
    let position = json!({"revision":1,"kind":"windowed","offset":0,
        "selection":{"type":"text","anchor":2,"head":5,"anchorByte":65536,"anchorWithin":0,"headByte":65542,"headWithin":1}});
    {
        let e = db.open();
        id = save_note(&e, "cursor", "body")["id"].clone();
        ok(e.execute(json!({"op":"workspace_set","ids":[id],"active":id,"locations":{id.as_str().unwrap():position}})));
    }
    let e = db.open();
    let before = ws_get(&e);
    assert_eq!(before["locations"][id.as_str().unwrap()], position);
    for field in ["anchorByte", "anchorWithin", "headByte", "headWithin"] {
        let mut bad = position.clone();
        bad["selection"].as_object_mut().unwrap().remove(field);
        assert_eq!(e.execute(json!({"op":"workspace_set","ids":[id],"active":null,"locations":{id.as_str().unwrap():bad}}))["ok"],false);
        assert_eq!(ws_get(&e), before);
    }
    for kind in ["rich", "source", "markdown"] {
        let mut bad = position.clone();
        bad["kind"] = json!(kind);
        assert_eq!(e.execute(json!({"op":"workspace_set","ids":[id],"active":null,"locations":{id.as_str().unwrap():bad}}))["ok"],false);
        assert_eq!(ws_get(&e), before);
    }
}
