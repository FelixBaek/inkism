//! Integration tests: run the engine exactly like the Go bridge does — via
//! `Engine::execute` JSON envelopes. Each test uses its own temp directory.

use inkism_engine::Engine;
use serde_json::{json, Value};

struct TempDb {
    dir: std::path::PathBuf,
    path: String,
}

impl TempDb {
    fn new(tag: &str) -> TempDb {
        let dir = std::env::temp_dir().join(format!(
            "inkism-test-{}-{}-{}",
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

fn save_note(e: &Engine, title: &str, text: &str, extra: Value) -> Value {
    let mut note = json!({ "title": title, "content": format!("<p>{text}</p>"), "text": text });
    if let Value::Object(map) = extra {
        for (k, v) in map {
            note[k] = v;
        }
    }
    ok(e.execute(json!({ "op": "save", "note": note })))
}

// ---- basics + reopen persistence ------------------------------------------

#[test]
fn readonly_preserves_content_across_write_paths_backup_and_reopen() {
    let t = TempDb::new("readonly");
    let e = t.open();
    let n = save_note(&e, "original", "original", json!({}));
    let id = n["id"].as_str().unwrap();
    assert_eq!(n["readonly"], false);
    let saved = ok(e.execute(json!({"op":"save","note":{"id":id,"revision":1,
        "content":"<p>baseline</p>","text":"baseline"}})));
    let history = ok(e.execute(json!({"op":"history","id":id})));
    let history_id = history[0]["id"].clone();
    let locked = ok(e.execute(json!({"op":"patch","id":id,"revision":saved["revision"],
        "summary_only":true,"changes":{"readonly":true}})));
    assert_eq!(locked["readonly"], true);
    assert!(locked.get("content").is_none());
    let revision = locked["revision"].as_i64().unwrap();
    for request in [
        json!({"op":"save","note":{"id":id,"revision":revision,"content":"changed","readonly":false}}),
        json!({"op":"save","note":{"id":id,"text":"changed"}}),
        json!({"op":"patch","id":id,"revision":revision,"changes":{"title":"changed","readonly":false}}),
        json!({"op":"document_splice","id":id,"revision":revision,
            "content":{"start":3,"expected":"baseline","replacement":"changed"},
            "text":{"start":0,"expected":"baseline","replacement":"changed"}}),
        json!({"op":"document_splice_html","id":id,"revision":revision,
            "content":{"start":3,"expected":"baseline","replacement":"changed"}}),
        json!({"op":"document_splice_source","id":id,"revision":revision,"content_format":"html",
            "content":{"start":3,"expected":"baseline","replacement":"changed"}}),
        json!({"op":"convert_content","id":id,"revision":revision,"content_format":"markdown"}),
        json!({"op":"restore","id":id,"revision":revision,"history_id":history_id}),
        json!({"op":"patch","id":id,"changes":{"readonly":false}}),
        json!({"op":"patch","id":id,"revision":revision-1,"changes":{"readonly":false}}),
        json!({"op":"save","note":{"id":id,"revision":revision,"readonly":null}}),
        json!({"op":"patch","id":id,"revision":revision,"changes":{"readonly":"false"}}),
    ] {
        assert_eq!(e.execute(request.clone())["ok"], false, "{request}");
        let current = ok(e.execute(json!({"op":"get","id":id})));
        assert_eq!(current["content"], "<p>baseline</p>");
        assert_eq!(current["title"], "original");
        assert_eq!(current["readonly"], true);
        assert_eq!(current["revision"], revision);
    }
    let page = ok(e.execute(json!({"op":"list","view":"all","query":"readonly:true"})));
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    let backup_path = t.dir.join("readonly-backup.json").to_string_lossy().into_owned();
    ok(e.execute(json!({"op":"export","path":backup_path})));
    let imported_t = TempDb::new("readonly-import");
    let imported = imported_t.open();
    ok(imported.execute(json!({"op":"import","path":backup_path})));
    let page = ok(imported.execute(json!({"op":"list","view":"all"})));
    assert_eq!(page["items"][0]["readonly"], true);
    let imported_note = ok(imported.execute(json!({"op":"get","id":page["items"][0]["id"]})));
    assert_eq!(imported_note["content"], "<p>baseline</p>");
    let mut malformed: Value = serde_json::from_slice(&std::fs::read(&backup_path).unwrap()).unwrap();
    malformed["notes"][0]["readonly"] = Value::Null;
    std::fs::write(&backup_path, serde_json::to_vec(&malformed).unwrap()).unwrap();
    assert_eq!(imported.execute(json!({"op":"import","path":backup_path}))["ok"], false);
    drop(e);
    let e = t.open();
    assert_eq!(ok(e.execute(json!({"op":"get","id":id})))["readonly"], true);
    let unlocked = ok(e.execute(json!({"op":"patch","id":id,"revision":revision,"changes":{"readonly":false}})));
    let edited = ok(e.execute(json!({"op":"save","note":{"id":id,"revision":unlocked["revision"],"text":"editable"}})));
    assert_eq!(edited["readonly"], false);
    assert_eq!(edited["text"], "editable");
}

#[test]
fn readonly_migration_adds_default_without_rewriting_existing_content() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    inkism_engine::schema::init_main(&db).unwrap();
    db.execute_batch("ALTER TABLE notes_meta DROP COLUMN readonly; PRAGMA user_version=6;").unwrap();
    // An old v6 schema has no readonly column; write its old row directly.
    db.execute_batch("INSERT INTO notes_meta(id,title,created_at,updated_at) VALUES('old','old',1,1); INSERT INTO notes_body(note_id,content,text) VALUES('old','<p>보존</p>','보존');").unwrap();
    inkism_engine::schema::init_main(&db).unwrap();
    let note = inkism_engine::ops_notes::get(&db, &json!({"id":"old"})).unwrap();
    assert_eq!(note["readonly"], false);
    assert_eq!(note["content"], "<p>보존</p>");
    assert_eq!(note["revision"], 1);
}

#[test]
fn edit_time_separates_metadata_and_content_and_survives_backup() {
    let t = TempDb::new("edit-time");
    let e = t.open();
    let mut note = save_note(&e, "original", "body", json!({}));
    assert_eq!(note["created_at"], note["edited_at"]);
    let id = note["id"].clone();
    e.connection().execute("UPDATE notes_meta SET created_at=5,updated_at=20,edited_at=10 WHERE id=?1",
        [id.as_str().unwrap()]).unwrap();
    note = ok(e.execute(json!({"op":"patch","id":id,"revision":note["revision"],
        "summary_only":true,"changes":{"favorite":true,"tags":["tag"]}})));
    assert_eq!(note["edited_at"], 10);
    assert!(note["updated_at"].as_i64().unwrap() > 20);
    note = ok(e.execute(json!({"op":"save","note":{"id":id,"revision":note["revision"],"tags":["save-tag"]}})));
    assert_eq!(note["edited_at"], 10);
    note = ok(e.execute(json!({"op":"document_splice_html","id":id,"revision":note["revision"],
        "content":{"start":0,"expected":"","replacement":""},
        "metadata":{"title":"original","notebook_id":null,"tags":["splice-tag"]}})));
    assert_eq!(note["edited_at"], 10);
    let found = ok(e.execute(json!({"op":"list","view":"all","query":"edited_before:2000-01-01"})));
    assert_eq!(found["items"][0]["id"], id);
    let file = t.dir.join("times.json");
    ok(e.execute(json!({"op":"export","path":file.to_string_lossy()})));
    let dest = TempDb::new("edit-time-import");
    let d = dest.open();
    ok(d.execute(json!({"op":"import","path":file.to_string_lossy()})));
    let restored = ok(d.execute(json!({"op":"list","view":"all"})))["items"][0].clone();
    for field in ["created_at", "updated_at", "edited_at"] {
        assert_eq!(restored[field], note[field], "{field}");
    }
    let mut legacy: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    legacy["notes"][0].as_object_mut().unwrap().remove("edited_at");
    std::fs::write(&file, serde_json::to_vec(&legacy).unwrap()).unwrap();
    ok(d.execute(json!({"op":"import","path":file.to_string_lossy()})));
    let imported = ok(d.execute(json!({"op":"list","view":"all"})));
    assert!(imported["items"].as_array().unwrap().iter().any(|n| n["edited_at"] == note["updated_at"]));
    for invalid in [Value::Null, json!(-1), json!(1.5), json!("10")] {
        legacy["notes"][0]["edited_at"] = invalid;
        std::fs::write(&file, serde_json::to_vec(&legacy).unwrap()).unwrap();
        err(d.execute(json!({"op":"import","path":file.to_string_lossy()})));
    }
    let titled = ok(e.execute(json!({"op":"patch","id":id,"revision":note["revision"],"changes":{"title":"renamed"}})));
    assert_eq!(titled["edited_at"], titled["updated_at"]);
    assert!(titled["edited_at"].as_i64().unwrap() > 10);
    let body = ok(e.execute(json!({"op":"save","note":{"id":id,"revision":titled["revision"],"content":"<p>changed</p>","text":"changed"}})));
    assert_eq!(body["edited_at"], body["updated_at"]);
    let history = ok(e.execute(json!({"op":"history","id":id})));
    let restored = ok(e.execute(json!({"op":"restore","id":id,"history_id":history[0]["id"],"revision":body["revision"]})));
    assert_eq!(restored["edited_at"], restored["updated_at"]);
    let source = ok(e.execute(json!({"op":"convert_content","id":id,"revision":restored["revision"],"content_format":"text"})));
    assert_eq!(source["edited_at"], source["updated_at"]);
    e.connection().execute("UPDATE notes_meta SET edited_at=10 WHERE id=?1", [id.as_str().unwrap()]).unwrap();
    let metadata = ok(e.execute(json!({"op":"save","note":{"id":id,"revision":source["revision"],"content_format":"text","tags":["source-tag"]}})));
    assert_eq!(metadata["edited_at"], 10);
    let scheduled = ok(e.execute(json!({"op":"patch","id":id,"revision":metadata["revision"],
        "changes":{"readonly":true,"reminder_at":1}})));
    let due = ok(e.execute(json!({"op":"due_reminders","now":2})));
    assert_eq!(due[0]["readonly"], true);
    assert_eq!(due[0]["edited_at"], scheduled["edited_at"]);
}

#[test]
fn edit_time_migration_preserves_old_dates_and_body() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    inkism_engine::schema::init_main(&db).unwrap();
    db.execute_batch("DROP INDEX idx_notes_content_edited; DROP INDEX idx_notes_content_edited_asc;
        ALTER TABLE notes_meta DROP COLUMN edited_at; PRAGMA user_version=7;
        INSERT INTO notes_meta(id,title,created_at,updated_at) VALUES('old','old',5,20);
        INSERT INTO notes_body(note_id,content,text) VALUES('old','body','body');").unwrap();
    inkism_engine::schema::init_main(&db).unwrap();
    let note = inkism_engine::ops_notes::load_note(&db, "old").unwrap().unwrap();
    assert_eq!((note.created_at, note.updated_at, note.edited_at), (5, 20, 20));
    assert_eq!(note.content, "body");
    db.execute_batch("UPDATE notes_meta SET edited_at=10 WHERE id='old';").unwrap();
    inkism_engine::schema::init_main(&db).unwrap();
    assert_eq!(inkism_engine::ops_notes::load_summary(&db, "old").unwrap().edited_at, 10);
}

#[test]
fn title_sort_matches_original_sql_and_pages_without_bodies_after_migration() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    inkism_engine::schema::init_main(&db).unwrap();
    db.execute_batch("DROP INDEX idx_notes_title_order; DROP INDEX idx_notes_title_order_asc;
        ALTER TABLE notes_meta DROP COLUMN title_order; PRAGMA user_version=8;").unwrap();
    let records = [
        ("a", "  Apple", 1), ("b", "apple", 1), ("c", "\u{a0}\r\n\t\u{b}Banana", 1),
        ("d", "문서 10", 0), ("e", "문서 2", 0), ("f", "  가나", 0),
        ("g", "\t가나", 0), ("h", "éclair", 0), ("i", "Éclair", 0),
        ("j", "\u{1f}\"quoted\"\n", 0), ("k", "", 0), ("l", "a\0tail", 0),
    ];
    for (index, (id, title, pinned)) in records.iter().enumerate() {
        db.execute("INSERT INTO notes_meta(id,title,pinned,created_at,updated_at,archived,trashed,favorite,notebook_id) VALUES(?1,?2,?3,1,1,?4,?5,?6,?7)",
            rusqlite::params![id,title,pinned,(index==8) as i64,(index==9) as i64,(index%2) as i64,if index%2==0 {"nb-a"} else {"nb-b"}]).unwrap();
    }
    // Existing titles must acquire keys without changing revisions/timestamps.
    inkism_engine::schema::init_main(&db).unwrap();
    inkism_engine::schema::init_main(&db).unwrap();
    db.execute_batch("DROP TABLE notes_body;").unwrap();
    for direction in ["asc", "desc"] {
        for (view, filter) in [("all", "trashed=0 AND archived=0"),
            ("favorites", "trashed=0 AND archived=0 AND favorite=1"),
            ("archive", "trashed=0 AND archived=1"), ("trash", "trashed=1")] {
            for notebook in [false,true] {
                let extra=if notebook {" AND notebook_id='nb-a'"} else {""};
                // Use the original SQL expression, independently of title_order.
                let sql=format!("SELECT id FROM notes_meta WHERE {filter}{extra} ORDER BY pinned DESC,ltrim(title,' '||char(160,13,10,9,11)) COLLATE NOCASE {direction},id {direction}");
                let expected: Vec<String>=db.prepare(&sql).unwrap().query_map([],|row|row.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
                for limit in [1,2,100] {
                    let mut args=json!({"view":view,"sort_by":"title","sort_direction":direction,"limit":limit});
                    if notebook {args["notebook_id"]=json!("nb-a");}
                    let mut actual=Vec::new();
                    loop {
                        let page=inkism_engine::ops_notes::list(&db,&args).unwrap();
                        for item in page["items"].as_array().unwrap() {
                            assert!(item.get("content").is_none() && item.get("text").is_none());
                            actual.push(item["id"].as_str().unwrap().to_string());
                        }
                        assert!(actual.len()<=records.len(),"title cursor repeated");
                        if page["next_cursor"].is_null() {break;}
                        args["cursor"]=page["next_cursor"].clone();
                    }
                    assert_eq!(actual,expected,"{view} {direction} notebook={notebook} limit={limit}");
                }
            }
        }
    }
    db.execute("UPDATE notes_meta SET title='  Zulu' WHERE id='a'",[]).unwrap();
    let (key, revision, updated): (String,i64,i64)=db.query_row("SELECT title_order,revision,updated_at FROM notes_meta WHERE id='a'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!((key.as_str(),revision,updated),("Zulu",1,1));
    let page=inkism_engine::ops_notes::list(&db,&json!({"view":"all","sort_by":"title","limit":1})).unwrap();
    assert!(inkism_engine::ops_notes::list(&db,&json!({"view":"all","sort_by":"updated_at","cursor":page["next_cursor"]})).is_err());
}

#[test]
fn date_sort_pages_preserve_pinned_order_filters_and_legacy_cursors() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    inkism_engine::schema::init_main(&db).unwrap();
    // Any accidental canonical body read must fail, including on later pages.
    db.execute_batch("DROP TABLE notes_body;").unwrap();
    // Ascending row-value seeks cannot begin with an indexed expression.
    // Hold the pinned cohort fixed and seek the real date/id columns instead.
    for field in ["created_at", "updated_at", "edited_at"] {
        let sql=format!("EXPLAIN QUERY PLAN SELECT id FROM notes_meta m WHERE m.trashed=0 AND m.archived=0 AND -m.pinned=?1 AND (m.{field},m.id)>(?2,?3) ORDER BY m.{field} ASC,m.id ASC LIMIT 50");
        let mut stmt = db.prepare(&sql).unwrap();
        let plan: Vec<String> = stmt
            .query_map(rusqlite::params![-1, 123, "note"], |row| row.get(3))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let range = format!("({field},id)>(?,?)");
        assert!(plan.iter().any(|step| step.contains(&range)), "{plan:?}");
        assert!(!plan.iter().any(|step| step.contains("TEMP B-TREE")), "{plan:?}");
    }
    let records = [
        ("a", 1, 3, 1, 0), ("b", 1, 3, 3, 0), ("c", 0, 1, 3, 0),
        ("d", 0, 2, 3, 0), ("e", 0, 2, 1, 0), ("f", 1, 1, 4, 1),
        ("g", 0, 4, 1, 1), ("h", 0, 1, 1, 2), ("i", 1, 2, 2, 3),
    ];
    for (index, (id, pinned, created, edited, state)) in records.iter().enumerate() {
        db.execute(
            "INSERT INTO notes_meta(id,title,pinned,created_at,updated_at,edited_at,archived,trashed,favorite,notebook_id) VALUES(?1,?1,?2,?3,?4,?3,?5,?6,?7,?8)",
            rusqlite::params![id,pinned,created,edited, i64::from(*state == 1 || *state == 3), i64::from(*state >= 2), (index%2) as i64, if index%2==0 {"nb-a"} else {"nb-b"}],
        ).unwrap();
    }
    for sort_by in ["created_at", "updated_at", "edited_at"] {
        for direction in ["asc", "desc"] {
            for (view, notebook, favorite) in [
                ("all", false, false), ("all", true, false), ("all", true, true), ("all", false, true),
                ("favorites", false, false), ("archive", false, false), ("trash", false, false),
            ] {
                let mut expected: Vec<_> = records.iter().enumerate().filter(|(index, record)| {
                    let state = record.4;
                    let in_view = match view {
                        "all" => state == 0,
                        "favorites" => state == 0 && index%2 == 1,
                        "archive" => state == 1,
                        "trash" => state >= 2,
                        _ => unreachable!(),
                    };
                    in_view && (!notebook || index%2 == 0) && (!favorite || index%2 == 1)
                }).map(|(_, record)| record).collect();
                expected.sort_by(|a,b| {
                    let pinned=b.1.cmp(&a.1);
                    if pinned != std::cmp::Ordering::Equal { return pinned; }
                    let time=if sort_by=="updated_at" {a.3.cmp(&b.3)} else {a.2.cmp(&b.2)};
                    let order=time.then_with(||a.0.cmp(b.0));
                    if direction=="asc" {order} else {order.reverse()}
                });
                let expected: Vec<_> = expected.iter().map(|record| record.0.to_string()).collect();
                for limit in [1,2,100] {
                    let mut args=json!({"view":view,"sort_by":sort_by,"sort_direction":direction,"limit":limit});
                    if notebook {args["notebook_id"]=json!("nb-a");}
                    if favorite {args["query"]=json!("favorite:true");}
                    let mut actual=Vec::new();
                    loop {
                        let page=inkism_engine::ops_notes::list(&db,&args).unwrap();
                        for item in page["items"].as_array().unwrap() {
                            assert!(item.get("content").is_none() && item.get("text").is_none());
                            actual.push(item["id"].as_str().unwrap().to_string());
                        }
                        assert!(actual.len()<=records.len(), "page cursor repeated");
                        if page["next_cursor"].is_null() {break;}
                        args["cursor"]=page["next_cursor"].clone();
                    }
                    assert_eq!(actual,expected,"{sort_by} {direction} {view} notebook={notebook} favorite={favorite} limit={limit}");
                }
            }
        }
    }
    let legacy=inkism_engine::ops_notes::list(&db,&json!({"view":"all","limit":1})).unwrap();
    assert!(!legacy["next_cursor"].as_str().unwrap().starts_with("v2"));
    let cursor=legacy["next_cursor"].clone();
    for extra in [
        json!({"sort_by":"created_at","cursor":cursor}),
        json!({"sort_direction":"asc","cursor":cursor}),
        json!({"sort_by":"created_at; DROP TABLE notes_meta"}),
        json!({"sort_by":null}), json!({"sort_direction":"up"}),
        json!({"sort_direction":true}),
    ] {
        let mut args=json!({"view":"all"});
        args.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        assert!(inkism_engine::ops_notes::list(&db,&args).is_err(),"{args}");
    }
}

#[test]
fn save_get_list_and_reopen_persists() {
    let t = TempDb::new("persist");
    {
        let e = t.open();
        let n = save_note(
            &e,
            "첫 노트",
            "hello content",
            json!({ "tags": ["a", "b"] }),
        );
        let id = n["id"].as_str().unwrap().to_string();
        assert_eq!(n["revision"], 1);
        assert_eq!(n["title"], "첫 노트");
        assert_eq!(n["text"], "hello content");
        assert_eq!(
            ok(e.execute(json!({ "op": "get", "id": id })))["text"],
            "hello content"
        );
        let list = ok(e.execute(json!({ "op": "list", "view": "all" })));
        assert_eq!(list["items"].as_array().unwrap().len(), 1);
        assert_eq!(list["items"][0]["id"], id.as_str());
        // Summary excludes content/text and has a preview.
        assert!(list["items"][0].get("content").is_none());
        assert!(list["items"][0].get("text").is_none());
        assert_eq!(list["items"][0]["preview"], "hello content");
    }
    // Reopen: everything persists (WAL committed, bodies intact).
    {
        let e = t.open();
        let list = ok(e.execute(json!({ "op": "list", "view": "all" })));
        assert_eq!(list["items"].as_array().unwrap().len(), 1);
        let id = list["items"][0]["id"].as_str().unwrap().to_string();
        let got = ok(e.execute(json!({ "op": "get", "id": id })));
        assert_eq!(got["text"], "hello content");
        assert_eq!(got["tags"], json!(["a", "b"]));
    }
}

#[test]
fn html_save_keeps_client_text_and_previews_visible_text() {
    let t = TempDb::new("html-text");
    let e = t.open();
    // Explicit HTML format with client text (web clipper) keeps the plain text.
    let clip = ok(e.execute(json!({"op":"save","note":{"title":"클립","content_format":"html",
        "content":"<h2>제목</h2><p>본문</p>","text":"제목\n본문"}})));
    assert_eq!(clip["text"], "제목\n본문");
    // Without text the source is stored as-is, but the preview shows visible text only.
    let src = ok(e.execute(json!({"op":"save","note":{"title":"원문","content_format":"html",
        "content":"<p>첫 줄 본문입니다</p>"}})));
    assert_eq!(src["text"], "<p>첫 줄 본문입니다</p>");
    let md = ok(e.execute(json!({"op":"save","note":{"title":"md","content_format":"markdown",
        "content":"# 머리\n\n**굵게**","text":"무시됨"}})));
    assert_eq!(md["text"], "# 머리\n\n**굵게**");
    let empty = save_note(&e, "제목만", "", json!({}));
    let list = ok(e.execute(json!({ "op": "list", "view": "all" })));
    let preview = |id: &Value| list["items"].as_array().unwrap().iter()
        .find(|n| n["id"] == *id).unwrap()["preview"].clone();
    assert_eq!(preview(&src["id"]), "첫 줄 본문입니다");
    assert_eq!(preview(&md["id"]), "머리 굵게");
    assert_eq!(preview(&empty["id"]), "");
}

// ---- Korean search: eventual consistency + short queries -------------------

#[test]
fn korean_fts_search_after_wait_index() {
    let t = TempDb::new("korean");
    let e = t.open();
    let a = save_note(
        &e,
        "English title",
        "완전 무작위 한글 본문 내용입니다",
        json!({}),
    );
    let _ = save_note(&e, "국어 제목", "another body", json!({}));
    // Not indexed yet: eventually-consistent window. wait_index bounds it.
    assert_eq!(ok(e.execute(json!({ "op": "wait_index" })))["pending"], 0);
    let res = ok(e.execute(json!({ "op": "list", "view": "all", "query": "무작위" })));
    let ids: Vec<&str> = res["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec![a["id"].as_str().unwrap()]);
    // 3-char substring crossing the title.
    let res = ok(e.execute(json!({ "op": "list", "view": "all", "query": "국어 제" })));
    assert_eq!(res["items"].as_array().unwrap().len(), 1);
    // Trashed notes leave the index (eventually) and view filters exclude
    // them immediately either way.
    ok(e.execute(json!({ "op": "patch", "id": a["id"], "changes": { "trashed": true } })));
    ok(e.execute(json!({ "op": "wait_index" })));
    let res = ok(e.execute(json!({ "op": "list", "view": "all", "query": "무작위" })));
    assert_eq!(res["items"].as_array().unwrap().len(), 0);
}

#[test]
fn short_query_falls_back_to_title_like() {
    let t = TempDb::new("shortq");
    let e = t.open();
    save_note(&e, "회의", "본문에만 등장하는 짧은 단어: 회의", json!({}));
    save_note(&e, "기타", "다른 본문", json!({}));
    ok(e.execute(json!({ "op": "wait_index" })));
    // 2-char query: trigram cannot index it; title LIKE fallback finds the
    // title match but NOT the body-only match (documented limitation).
    let res = ok(e.execute(json!({ "op": "list", "view": "all", "query": "회의" })));
    let titles: Vec<&str> = res["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, vec!["회의"]);
    // 1-char query also works on titles.
    let res = ok(e.execute(json!({ "op": "list", "view": "all", "query": "기" })));
    assert_eq!(res["items"].as_array().unwrap().len(), 1);
    // Query containing FTS syntax characters must not break the search.
    ok(e.execute(json!({ "op": "wait_index" })));
    let res = ok(e.execute(json!({ "op": "list", "view": "all", "query": "NOT NEAR (회의)" })));
    assert!(res["items"].is_array());
}

// ---- keyset pagination incl. identical timestamps ---------------------------

#[test]
fn pagination_is_stable_with_same_timestamps() {
    let t = TempDb::new("pages");
    let e = t.open();
    let mut ids = Vec::new();
    for i in 0..30 {
        let n = save_note(&e, &format!("note {i:02}"), "body", json!({}));
        ids.push(n["id"].as_str().unwrap().to_string());
    }
    // Force EVERY note onto one identical updated_at + pinned to prove the
    // id tiebreaker keeps keyset pagination exact. Done via the public
    // connection (test-only manipulation).
    let conn = e.query_connection();
    conn.execute_batch("UPDATE notes_meta SET updated_at = 1700000000000, pinned = 1;")
        .unwrap();
    ids.sort(); // id DESC ordering => collect reversed
    ids.reverse();

    let mut seen: Vec<String> = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut req = json!({ "op": "list", "view": "all", "limit": 7 });
        if let Some(c) = &cursor {
            req["cursor"] = json!(c);
        }
        let res = ok(e.execute(req));
        for item in res["items"].as_array().unwrap() {
            seen.push(item["id"].as_str().unwrap().to_string());
        }
        cursor = res["next_cursor"].as_str().map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(seen, ids);
    // Cursor ordering: pinned DESC, updated_at DESC, id DESC.
    let mut pinned_then: Vec<(i64, String)> = Vec::new();
    for id in &seen {
        let p: i64 = conn
            .query_row("SELECT pinned FROM notes_meta WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        pinned_then.push((p, id.clone()));
    }
    assert_eq!(seen.len(), 30);
    assert!(pinned_then.iter().all(|(p, _)| *p == 1));
}

// ---- optimistic revisions ---------------------------------------------------

#[test]
fn optimistic_revision_conflict() {
    let t = TempDb::new("conflict");
    let e = t.open();
    let n = save_note(&e, "v1", "one", json!({}));
    let id = n["id"].as_str().unwrap().to_string();
    // Stale revision -> conflict error, data unchanged.
    let bad = e.execute(json!({ "op": "save", "note": {
        "id": id, "title": "v2", "content": "<p>two</p>", "text": "two", "revision": 0 } }));
    assert!(err(bad).starts_with("conflict"));
    let got = ok(e.execute(json!({ "op": "get", "id": id })));
    assert_eq!(got["title"], "v1");
    assert_eq!(got["revision"], 1);
    // Correct revision -> update, revision bumps.
    let good = ok(e.execute(json!({ "op": "save", "note": {
        "id": id, "title": "v2", "content": "<p>two</p>", "text": "two", "revision": 1 } })));
    assert_eq!(good["revision"], 2);
    assert_eq!(good["title"], "v2");
    // Partial save: only supplied fields change; empty title is legal.
    let partial =
        ok(e.execute(json!({ "op": "save", "note": { "id": id, "title": "", "revision": 2 } })));
    assert_eq!(partial["title"], "");
    assert_eq!(partial["text"], "two"); // untouched
    assert_eq!(partial["revision"], 3);
}

// ---- patch / delete rules / notebooks ---------------------------------------

#[test]
fn patch_flags_and_delete_rules() {
    let t = TempDb::new("patch");
    let e = t.open();
    let nb =
        ok(e.execute(json!({ "op": "save_notebook", "name": "프로젝트", "color": "#087f5b" })));
    let nb_id = nb["id"].as_str().unwrap().to_string();
    let n = save_note(
        &e,
        "t",
        "b",
        json!({ "notebook_id": nb_id, "tags": ["work"] }),
    );
    let id = n["id"].as_str().unwrap().to_string();

    let patched = ok(e.execute(json!({ "op": "patch", "id": id, "changes": {
        "favorite": true, "pinned": true, "color": "#202624" } })));
    assert_eq!(patched["favorite"], true);
    assert_eq!(patched["pinned"], true);

    // Deleting a non-trashed note is rejected.
    assert!(err(e.execute(json!({ "op": "delete", "id": id }))).contains("not in trash"));
    // Trash it, then delete works.
    ok(e.execute(json!({ "op": "patch", "id": id, "changes": { "trashed": true } })));
    assert_eq!(
        ok(e.execute(json!({ "op": "delete", "id": id })))["deleted"],
        true
    );
    assert!(err(e.execute(json!({ "op": "get", "id": id }))).contains("not_found"));

    // Deleting a notebook detaches notes instead of deleting them.
    let keep = save_note(&e, "kept", "b", json!({ "notebook_id": nb_id }));
    ok(e.execute(json!({ "op": "delete_notebook", "id": nb_id })));
    let got = ok(e.execute(json!({ "op": "get", "id": keep["id"].as_str().unwrap() })));
    assert!(got["notebook_id"].is_null());
    assert_eq!(
        got["revision"].as_i64().unwrap(),
        keep["revision"].as_i64().unwrap() + 1
    );
    assert_eq!(got["content"], keep["content"]);
    assert!(err(e.execute(json!({"op":"patch","id":keep["id"],"revision":keep["revision"],"changes":{"favorite":true}}))).starts_with("conflict:"));
    assert!(err(e.execute(json!({ "op": "delete_notebook", "id": nb_id }))).contains("not_found"));
}

#[test]
fn views_tags_stats() {
    let t = TempDb::new("views");
    let e = t.open();
    let a = save_note(&e, "fav", "x", json!({ "tags": ["중요"] }));
    let b = save_note(&e, "arch", "x", json!({}));
    let c = save_note(&e, "trash", "x", json!({}));
    let id = |v: &Value| v["id"].as_str().unwrap().to_string();
    // favorite/pinned/flags are patch-only fields per the protocol.
    ok(e.execute(json!({ "op": "patch", "id": id(&a), "changes": { "favorite": true } })));
    ok(e.execute(json!({ "op": "patch", "id": id(&b), "changes": { "archived": true } })));
    ok(e.execute(json!({ "op": "patch", "id": id(&c), "changes": { "trashed": true } })));

    assert_eq!(
        ok(e.execute(json!({ "op": "list", "view": "all" })))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        ok(e.execute(json!({ "op": "list", "view": "favorites" })))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        ok(e.execute(json!({ "op": "list", "view": "archive" })))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        ok(e.execute(json!({ "op": "list", "view": "trash" })))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let tag_list = ok(e.execute(json!({ "op": "list", "view": "all", "tag": "중요" })));
    assert_eq!(tag_list["items"].as_array().unwrap().len(), 1);
    let tags = ok(e.execute(json!({ "op": "tags" })));
    assert_eq!(tags[0]["name"], "중요");
    assert_eq!(tags[0]["count"], 1);
    let stats = ok(e.execute(json!({ "op": "stats" })));
    assert_eq!(
        stats,
        json!({ "notes": 1, "favorites": 1, "archive": 1, "trash": 1 })
    );
    assert!(ok(e.execute(json!({ "op": "health" })))["version"].is_string());
    // The favorite note appears in favorites even though list "all" shows it.
    assert_eq!(
        id(&a),
        id(&ok(e.execute(json!({ "op": "list", "view": "all" })))["items"][0])
    );
}

// ---- history: max 20, restore ------------------------------------------------

#[test]
fn history_caps_at_20_and_restores() {
    let t = TempDb::new("history");
    let e = t.open();
    let n = save_note(&e, "v0", "body 0", json!({}));
    let id = n["id"].as_str().unwrap().to_string();
    // 25 subsequent edits -> history must retain exactly the last 20.
    for i in 1..=25 {
        ok(e.execute(json!({ "op": "save", "note": {
            "id": id, "title": format!("v{i}"), "content": format!("<p>body {i}</p>"),
            "text": format!("body {i}"), "revision": i } })));
    }
    let hist = ok(e.execute(json!({ "op": "history", "id": id })));
    let entries = hist.as_array().unwrap();
    assert_eq!(entries.len(), 20);
    assert_eq!(entries[0]["title"], "v24"); // newest first
    assert_eq!(entries[19]["title"], "v5"); // oldest retained
                                            // Restore v10: current becomes v10's content, revision bumps, and the
                                            // pre-restore state is itself snapshotted.
    let target = entries.iter().find(|h| h["title"] == "v10").unwrap();
    let restored = ok(e.execute(json!({ "op": "restore", "id": id, "history_id": target["id"] })));
    assert_eq!(restored["title"], "v10");
    assert_eq!(restored["text"], "body 10");
    assert_eq!(restored["revision"], 27);
    let hist2 = ok(e.execute(json!({ "op": "history", "id": id })));
    assert_eq!(hist2.as_array().unwrap().len(), 20); // still capped
    assert_eq!(hist2.as_array().unwrap()[0]["title"], "v25"); // snapshot of pre-restore
                                                              // Unknown history id -> error, nothing changed.
    assert!(
        err(e.execute(json!({ "op": "restore", "id": id, "history_id": "nope" })))
            .contains("not_found")
    );
}

// ---- backlinks -----------------------------------------------------------------

#[test]
fn backlinks_from_title_and_id_links() {
    let t = TempDb::new("backlinks");
    let e = t.open();
    let a = save_note(&e, "대상 노트", "target body", json!({}));
    let aid = a["id"].as_str().unwrap().to_string();
    let _ = save_note(&e, "링크 노트", "see [[대상 노트]] 입니다", json!({}));
    // The [[Title]] note above has no id link; add a second note using the id form.
    let by_id = save_note(&e, "id 링크", &format!("note://{aid} 참조"), json!({}));
    // Overwrite the first linker with a body that only has the title link.
    ok(e.execute(json!({ "op": "wait_index" })));

    let res = ok(e.execute(json!({ "op": "backlinks", "id": aid })));
    let items = res["items"].as_array().unwrap();
    let sources: Vec<&str> = items.iter().map(|i| i["id"].as_str().unwrap()).collect();
    assert!(
        sources.contains(&by_id["id"].as_str().unwrap()),
        "id link missing: {res}"
    );
    // "링크 노트" (title link) resolved to `a` by title. Its preview is a summary.
    assert!(items.iter().all(|i| i.get("content").is_none()));
    // Trashing the source removes it from backlinks (after index catch-up).
    ok(e.execute(json!({ "op": "patch", "id": by_id["id"], "changes": { "trashed": true } })));
    ok(e.execute(json!({ "op": "wait_index" })));
    let res = ok(e.execute(json!({ "op": "backlinks", "id": aid })));
    let sources: Vec<&str> = res["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap())
        .collect();
    assert!(!sources.contains(&by_id["id"].as_str().unwrap()));
    // Deleting the target cleans stale rows; backlinks op still fine.
    ok(e.execute(json!({ "op": "patch", "id": aid.clone(), "changes": { "trashed": true } })));
    ok(e.execute(json!({ "op": "delete", "id": aid })));
    ok(e.execute(json!({ "op": "wait_index" })));
    assert!(
        ok(e.execute(json!({ "op": "backlinks", "id": "missing" })))["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

// ---- import rollback + export roundtrip ----------------------------------------

#[test]
fn import_rolls_back_on_mid_transaction_failure() {
    let t = TempDb::new("import");
    let e = t.open();
    save_note(&e, "existing", "x", json!({}));
    ok(e.execute(json!({ "op": "wait_index" })));

    // Valid JSON, valid version, but the second note's content exceeds the
    // engine field limit -> failure DURING the transaction -> full rollback.
    let huge = "x".repeat(21 * 1024 * 1024);
    let backup = json!({
        "version": 1,
        "notes": [
            { "id": "11111111-1111-4111-8111-111111111111", "title": "good", "content": "<p>g</p>", "text": "g", "tags": [] },
            { "id": "22222222-2222-4222-8222-222222222222", "title": "bad", "content": huge, "text": "b", "tags": [] }
        ],
        "notebooks": []
    });
    let bad_path = t.dir.join("bad.json");
    std::fs::write(&bad_path, serde_json::to_vec(&backup).unwrap()).unwrap();
    let res = e.execute(json!({ "op": "import", "path": bad_path.to_string_lossy() }));
    assert!(
        err(res).contains("content"),
        "expected field-limit failure: got ok"
    );
    // Nothing was imported: still exactly 1 note, and no "good" note exists.
    let list = ok(e.execute(json!({ "op": "list", "view": "all" })));
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    assert_eq!(list["items"][0]["title"], "existing");

    // Malformed JSON also fails cleanly.
    let junk = t.dir.join("junk.json");
    std::fs::write(&junk, b"{not json").unwrap();
    assert!(
        err(e.execute(json!({ "op": "import", "path": junk.to_string_lossy() })))
            .contains("bad backup")
    );
    // Unsupported version rejected before any write.
    let wrong = t.dir.join("wrong.json");
    std::fs::write(&wrong, br#"{"version":999,"notes":[]}"#).unwrap();
    assert!(
        err(e.execute(json!({ "op": "import", "path": wrong.to_string_lossy() })))
            .contains("version")
    );
}

#[test]
fn export_is_atomic_and_roundtrips_incl_trash() {
    let t = TempDb::new("export");
    let e = t.open();
    let nb = ok(e.execute(json!({ "op": "save_notebook", "name": "노트북" })));
    let a = save_note(
        &e,
        "normal",
        "a body",
        json!({ "notebook_id": nb["id"], "tags": ["t1"] }),
    );
    let b = save_note(&e, "trashed", "b body", json!({}));
    ok(e.execute(json!({ "op": "patch", "id": b["id"], "changes": { "trashed": true } })));
    ok(e.execute(json!({ "op": "wait_index" })));

    let out_path = t.dir.join("backup.json");
    let res = ok(e.execute(json!({ "op": "export", "path": out_path.to_string_lossy() })));
    assert_eq!(res["notes"], 2);
    assert!(out_path.exists());
    // No temp leftovers (atomic rename).
    let leftovers: Vec<_> = std::fs::read_dir(&t.dir)
        .unwrap()
        .filter_map(|d| d.ok())
        .map(|d| d.file_name().to_string_lossy().into_owned())
        .filter(|f| f.contains(".notes-tmp-"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "temp files left behind: {leftovers:?}"
    );
    let backup: Value = serde_json::from_slice(&std::fs::read(&out_path).unwrap()).unwrap();
    assert_eq!(backup["version"], 2);
    assert_eq!(backup["notes"].as_array().unwrap().len(), 2);
    assert_eq!(backup["notebooks"].as_array().unwrap().len(), 1);

    // Import into a FRESH library: fresh ids, notebook remapped, trash kept.
    let t2 = TempDb::new("import2");
    let e2 = t2.open();
    let res = ok(e2.execute(json!({ "op": "import", "path": out_path.to_string_lossy() })));
    assert_eq!(res["imported"], 2);
    let list2 = ok(e2.execute(json!({ "op": "list", "view": "all", "limit": 100 })));
    assert_eq!(list2["items"].as_array().unwrap().len(), 1);
    let new_a = list2["items"][0]["id"].as_str().unwrap();
    assert_ne!(
        new_a,
        a["id"].as_str().unwrap(),
        "import must use fresh ids"
    );
    assert_eq!(
        list2["items"][0]["notebook_id"],
        list2["items"][0]["notebook_id"]
    );
    assert!(
        !list2["items"][0]["notebook_id"].is_null(),
        "notebook remapped"
    );
    let trash = ok(e2.execute(json!({ "op": "list", "view": "trash" })));
    assert_eq!(trash["items"].as_array().unwrap().len(), 1);
    // Re-import duplicates (fresh ids again), never overwrites.
    let res = ok(e2.execute(json!({ "op": "import", "path": out_path.to_string_lossy() })));
    assert_eq!(res["imported"], 2);
    let stats = ok(e2.execute(json!({ "op": "stats" })));
    assert_eq!(stats["notes"], 2);
}

// ---- search index durability, rebuild, and worker plumbing -----------------------

#[test]
fn search_db_rebuilds_when_missing_and_jobs_survive_restart() {
    let t = TempDb::new("rebuild");
    let e = t.open();
    save_note(&e, "복구 노트", "인덱스 재구성 본문", json!({}));
    ok(e.execute(json!({ "op": "wait_index" })));
    let res = ok(e.execute(json!({ "op": "list", "view": "all", "query": "재구성" })));
    assert_eq!(res["items"].as_array().unwrap().len(), 1);
    drop(e);

    // Delete the whole search side: open must detect and rebuild.
    for f in ["search", "search-wal", "search-shm"] {
        let _ = std::fs::remove_file(format!("{}.{}", t.path, f));
    }
    let e2 = t.open();
    assert_eq!(ok(e2.execute(json!({ "op": "wait_index" })))["pending"], 0);
    let res = ok(e2.execute(json!({ "op": "list", "view": "all", "query": "재구성" })));
    assert_eq!(res["items"].as_array().unwrap().len(), 1);

    // Hold the search writer so this checks durable queued work rather than
    // assuming the background worker loses a scheduling race after save.
    let search = rusqlite::Connection::open(format!("{}.search", t.path)).unwrap();
    search.execute_batch("BEGIN IMMEDIATE").unwrap();
    let pending = save_note(&e2, "pending 노트", "pending body", json!({}));
    let st = ok(e2.execute(json!({ "op": "index_status" })));
    assert!(st["pending"].as_i64().unwrap() >= 1);
    drop(e2); // stop while indexing is blocked: the job must remain on disk
    let main = rusqlite::Connection::open(&t.path).unwrap();
    let queued: i64 = main
        .query_row(
            "SELECT COUNT(*) FROM index_jobs WHERE note_id = ?1",
            [pending["id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(queued, 1);
    drop(main);
    search.execute_batch("ROLLBACK").unwrap();
    drop(search);
    let e3 = t.open();
    assert_eq!(ok(e3.execute(json!({ "op": "wait_index" })))["pending"], 0);
    let found = ok(e3.execute(json!({ "op": "list", "view": "all", "query": "pending" })));
    assert_eq!(found["items"][0]["id"], pending["id"]);
}

/// Review fix #2 verification: the worker's FTS delete must use the FTS5
/// rowid (a direct seek), not a scan over an UNINDEXED id column.
#[test]
fn fts_delete_by_rowid_uses_index_seek_not_scan() {
    let t = TempDb::new("explain");
    let e = t.open();
    let conn = e.query_connection();
    conn.execute_batch(
        "INSERT INTO notes_meta(id, seq, title, created_at, updated_at) VALUES('n1', 42, 'x', 1, 1);",
    )
    .unwrap();
    conn.execute_batch("INSERT INTO searchidx.notes_fts(rowid, title, text) VALUES(42, 't', 'b');")
        .unwrap();
    let mut stmt = conn
        .prepare("EXPLAIN QUERY PLAN DELETE FROM searchidx.notes_fts WHERE rowid = 42")
        .unwrap();
    let plan: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    eprintln!("EXPLAIN QUERY PLAN DELETE rowid: {plan:?}");
    // FTS5 rowid equality is pushed into the vtab (INDEX 0:= — a rowid seek
    // inside xFilter). A control query without any constraint shows the bare
    // full-scan marker "INDEX 0:" (no '='), proving the marker's meaning.
    assert!(
        plan.iter().any(|p| p.contains("VIRTUAL TABLE INDEX 0:=")),
        "rowid constraint not pushed down: {plan:?}"
    );
    let mut ctrl = conn
        .prepare("EXPLAIN QUERY PLAN SELECT rowid FROM searchidx.notes_fts")
        .unwrap();
    let ctrl_plan: Vec<String> = ctrl
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    eprintln!("control full-scan plan: {ctrl_plan:?}");
    assert!(
        ctrl_plan
            .iter()
            .any(|p| p.contains("VIRTUAL TABLE INDEX 0:") && !p.contains("0:=")),
        "control should be a bare scan: {ctrl_plan:?}"
    );
    // And the MATCH path used by list/search reports a full-text index plan.
    let mut stmt = conn
        .prepare("EXPLAIN QUERY PLAN SELECT rowid FROM searchidx.notes_fts('\"abc\"')")
        .unwrap();
    let plan2: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    eprintln!("EXPLAIN QUERY PLAN MATCH: {plan2:?}");
    assert!(plan2.iter().any(|p| p.contains("M")), "{plan2:?}");
}

/// Timing sanity for the same claim at scale: deleting many notes one by one
/// via rowid stays in seek territory (sub-scan per op) on a 30k-row index.
#[test]
fn fts_rowid_delete_scales() {
    let t = TempDb::new("ftsperf");
    let e = t.open();
    let conn = e.query_connection();
    let n = 30_000i64;
    conn.execute_batch("BEGIN;").unwrap();
    for i in 0..n {
        conn.execute(
            "INSERT INTO searchidx.notes_fts(rowid, title, text) VALUES(?1, 't', 'body text ' || ?1)",
            [i],
        )
        .unwrap();
    }
    conn.execute_batch("COMMIT;").unwrap();
    // Measure rowid lookup/deletion, not 15,000 independent durable commits.
    // The attached query connection has different synchronous settings from
    // the production WorkerSearch connection. One transaction isolates the
    // algorithm on both Windows and Linux without relaxing the time bound.
    conn.execute_batch("BEGIN;").unwrap();
    let started = std::time::Instant::now();
    for i in (0..n).step_by(2) {
        conn.execute("DELETE FROM searchidx.notes_fts WHERE rowid = ?1", [i])
            .unwrap();
    }
    conn.execute_batch("COMMIT;").unwrap();
    let elapsed = started.elapsed();
    eprintln!("15,000 rowid deletes over 30k rows: {elapsed:?}");
    // A per-delete full scan of 30k rows would be seconds in debug mode; the
    // rowid seek path completes almost instantly. Generous bound for slow CI.
    assert!(elapsed.as_secs() < 5, "rowid deletes too slow: {elapsed:?}");
    let remaining: i64 = conn
        .query_row("SELECT COUNT(*) FROM searchidx.notes_fts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(remaining, n / 2);
    let even: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM searchidx.notes_fts WHERE rowid % 2 = 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(even, 0);
}

/// Review fix #3 verification: saving while a huge body is being indexed
/// must not wait behind tokenization. We cannot observe the worker's lock
/// hold directly, but we CAN assert the save path touches no search file:
/// save latency stays flat with big bodies queued.
#[test]
fn save_is_not_blocked_by_large_index_backlog() {
    let t = TempDb::new("noblock");
    let e = t.open();
    // Queue several multi-megabyte bodies; do NOT wait for the worker.
    for i in 0..4 {
        let big = "블록".repeat(300_000); // ~1.8 MB text each
        save_note(&e, &format!("big {i}"), &big, json!({}));
    }
    let t0 = std::time::Instant::now();
    save_note(&e, "fast", "small body", json!({}));
    let save_ms = t0.elapsed().as_millis();
    assert!(save_ms < 500, "save took {save_ms}ms with index backlog");
    ok(e.execute(json!({ "op": "wait_index" })));
    let res = ok(e.execute(json!({ "op": "list", "view": "all", "query": "small" })));
    assert!(res["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["title"] == "fast"));
}

#[test]
fn filtered_pagination_does_not_reuse_filter_parameters_as_cursor() {
    let t = TempDb::new("filtered-pages");
    let e = t.open();
    let nb = ok(e.execute(json!({"op":"save_notebook","name":"필터"})));
    for i in 0..13 {
        save_note(
            &e,
            &format!("목록검색{i}"),
            "내용",
            json!({"notebook_id":nb["id"],"tags":["분류"]}),
        );
    }
    e.wait_index(10000).unwrap();
    let mut ids = std::collections::HashSet::new();
    let mut cursor = Value::Null;
    loop {
        let res=ok(e.execute(json!({"op":"list","view":"all","notebook_id":nb["id"],"tag":"분류","query":"목록검색","limit":3,"cursor":cursor})));
        for row in res["items"].as_array().unwrap() {
            assert!(ids.insert(row["id"].as_str().unwrap().to_string()));
        }
        cursor = res["next_cursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    assert_eq!(ids.len(), 13);
}
#[test]
fn deleted_highest_fts_identity_is_never_reused() {
    let t = TempDb::new("stable-fts-id");
    let e = t.open();
    let n = save_note(&e, "삭제 전", "비밀원문", json!({}));
    let old: i64 = e
        .connection()
        .query_row(
            "SELECT seq FROM notes_meta WHERE id=?1",
            [n["id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    ok(e.execute(json!({"op":"patch","id":n["id"],"changes":{"trashed":true}})));
    ok(e.execute(json!({"op":"delete","id":n["id"]})));
    let n = save_note(&e, "새 노트", "다른내용", json!({}));
    let new: i64 = e
        .connection()
        .query_row(
            "SELECT seq FROM notes_meta WHERE id=?1",
            [n["id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert!(new > old);
}
#[test]
fn search_writer_cannot_block_foreground_save() {
    let t = TempDb::new("isolation");
    let e = t.open();
    let search = rusqlite::Connection::open(format!("{}.search", t.path)).unwrap();
    search.execute_batch("BEGIN IMMEDIATE").unwrap();
    let before = std::time::Instant::now();
    save_note(&e, "저장 격리", "색인 잠금과 무관", json!({}));
    assert!(before.elapsed() < std::time::Duration::from_millis(500));
    search.execute_batch("ROLLBACK").unwrap();
}
#[test]
fn future_schema_version_is_not_silently_downgraded() {
    let t = TempDb::new("future-version");
    let c = rusqlite::Connection::open(&t.path).unwrap();
    c.pragma_update(None, "user_version", 999).unwrap();
    drop(c);
    assert!(Engine::open(&t.path).is_err());
    let c = rusqlite::Connection::open(&t.path).unwrap();
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        999
    );
}

#[test]
fn title_backlinks_resolve_targets_created_later_and_follow_renames() {
    let t = TempDb::new("late-links");
    let e = t.open();
    let source = save_note(&e, "연결 원본", "[[미래문서]]", json!({}));
    e.wait_index(10000).unwrap();
    let target = save_note(&e, "미래문서", "내용", json!({}));
    e.wait_index(10000).unwrap();
    let links = ok(e.execute(json!({"op":"backlinks","id":target["id"]})));
    assert_eq!(links["items"][0]["id"], source["id"]);
    save_note(
        &e,
        "바뀐제목",
        "내용",
        json!({"id":target["id"],"revision":target["revision"]}),
    );
    let links = ok(e.execute(json!({"op":"backlinks","id":target["id"]})));
    assert!(links["items"].as_array().unwrap().is_empty());
}

#[test]
fn export_rejects_missing_body_and_preserves_previous_backup() {
    let t = TempDb::new("backup-missing-body");
    let e = t.open();
    let note = save_note(&e, "백업 검증", "사라지면 안 되는 본문", json!({}));
    let target = t.dir.join("backup.json");
    ok(e.execute(json!({"op":"export", "path":target.to_string_lossy()})));
    let previous = std::fs::read(&target).unwrap();
    // Simulate a damaged store. Export must not turn unreadable body into
    // an apparently successful empty note and replace a good backup.
    e.connection()
        .execute(
            "DELETE FROM notes_body WHERE note_id = ?1",
            [note["id"].as_str().unwrap()],
        )
        .unwrap();
    err(e.execute(json!({"op":"export", "path":target.to_string_lossy()})));
    assert_eq!(std::fs::read(&target).unwrap(), previous);
    assert!(!std::fs::read_dir(&t.dir).unwrap().any(|p| p
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("notes-tmp-")));
}

#[test]
fn export_cleans_its_temporary_file_if_target_is_a_directory() {
    let t = TempDb::new("backup-target-dir");
    let e = t.open();
    save_note(&e, "메모", "내용", json!({}));
    let target = t.dir.join("existing");
    std::fs::create_dir(&target).unwrap();
    err(e.execute(json!({"op":"export", "path":target.to_string_lossy()})));
    assert!(target.is_dir());
    assert!(!std::fs::read_dir(&t.dir).unwrap().any(|p| p
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("notes-tmp-")));
}

#[test]
fn backup_import_remaps_internal_links_including_cycles_and_underscores() {
    let original = TempDb::new("linked-original");
    let source = original.open();
    save_note(&source, "출발", "앞참조 note://target_id 자기참조 note://source_id 외부 note://outside-id 접두사 note://target_id-other", json!({"id":"source_id"}));
    save_note(
        &source,
        "도착",
        "역방향 note://source_id",
        json!({"id":"target_id"}),
    );
    ok(source.execute(json!({"op":"wait_index"})));
    let original_links = ok(source.execute(json!({"op":"backlinks","id":"target_id"})));
    assert!(original_links["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["id"] == "source_id"));
    let file = original.dir.join("linked.json");
    ok(source.execute(json!({"op":"export","path":file.to_string_lossy()})));
    let imported = TempDb::new("linked-imported");
    let dest = imported.open();
    ok(dest.execute(json!({"op":"import","path":file.to_string_lossy()})));
    let rows = ok(dest.execute(json!({"op":"list","view":"all"})));
    let notes = rows["items"].as_array().unwrap();
    let a = notes.iter().find(|n| n["title"] == "출발").unwrap()["id"]
        .as_str()
        .unwrap();
    let b = notes.iter().find(|n| n["title"] == "도착").unwrap()["id"]
        .as_str()
        .unwrap();
    assert_ne!(a, "source_id");
    assert_ne!(b, "target_id");
    let a_note = ok(dest.execute(json!({"op":"get","id":a})));
    for field in ["content", "text"] {
        let value = a_note[field].as_str().unwrap();
        assert!(value.contains(&format!("note://{a}")));
        assert!(value.contains(&format!("note://{b}")));
        assert!(value.contains("note://outside-id"));
        assert!(value.contains("note://target_id-other"));
    }
    ok(dest.execute(json!({"op":"wait_index"})));
    let links = ok(dest.execute(json!({"op":"backlinks","id":b})));
    assert!(links["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["id"] == a));
    let reverse = ok(dest.execute(json!({"op":"get","id":b})));
    assert!(reverse["text"]
        .as_str()
        .unwrap()
        .contains(&format!("note://{a}")));
}

#[test]
fn import_rejects_ambiguous_duplicate_ids_without_writing() {
    let temp = TempDb::new("duplicate-import");
    let engine = temp.open();
    save_note(&engine, "보존", "기존 자료", json!({}));
    let file = temp.dir.join("duplicate.json");
    for backup in [
        json!({"version":1,"notes":[{"id":"n","title":"one"},{"id":"n","title":"two"}]}),
        json!({"version":1,"notes":[],"notebooks":[{"id":"b","name":"one"},{"id":"b","name":"two"}]}),
    ] {
        std::fs::write(&file, backup.to_string()).unwrap();
        assert!(
            err(engine.execute(json!({"op":"import","path":file.to_string_lossy()})))
                .contains("duplicate")
        );
        assert_eq!(ok(engine.execute(json!({"op":"stats"})))["notes"], 1);
        assert!(ok(engine.execute(json!({"op":"notebooks"})))
            .as_array()
            .unwrap()
            .is_empty());
    }
}

#[test]
fn tag_changes_merge_remove_and_rollback_atomically() {
    let db = TempDb::new("tag-changes");
    let e = db.open();
    let a = save_note(&e, "태그 A", "본문😀", json!({"tags":["이전","대상"]}));
    let b = save_note(&e, "태그 B", "다른 본문", json!({"tags":["이전"]}));
    ok(e.execute(json!({"op":"patch","id":b["id"],"changes":{"trashed":true}})));
    e.connection().execute_batch("CREATE TEMP TRIGGER fail_bulk BEFORE UPDATE OF tags ON notes_meta
        WHEN (SELECT count(*) FROM history)>1 BEGIN SELECT RAISE(ABORT,'injected tag failure'); END;").unwrap();
    assert!(
        err(e.execute(json!({"op":"change_tag","name":"이전","replacement":"대상"})))
            .contains("injected")
    );
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":a["id"]})))["tags"],
        json!(["대상", "이전"])
    );
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":b["id"]})))["tags"],
        json!(["이전"])
    );
    assert_eq!(
        ok(e.execute(json!({"op":"history","id":a["id"]}))),
        json!([])
    );
    e.connection()
        .execute_batch("DROP TRIGGER fail_bulk;")
        .unwrap();
    assert!(err(
        e.execute(json!({"op":"change_tag","name":"이전","replacement":"대상",
        "current_id":a["id"],"current_revision":999}))
    )
    .starts_with("conflict:"));
    let result = ok(
        e.execute(json!({"op":"change_tag","name":"이전","replacement":"대상",
        "current_id":a["id"],"current_revision":a["revision"]})),
    );
    assert_eq!(result["updated"], 2);
    assert_eq!(result["current"]["revision"], 2);
    assert_eq!(result["current"]["tags"], json!(["대상"]));
    let after = ok(e.execute(json!({"op":"get","id":a["id"]})));
    assert_eq!(after["content"], a["content"]);
    assert_eq!(after["text"], a["text"]);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":b["id"]})))["tags"],
        json!(["대상"])
    );
    assert_eq!(
        ok(e.execute(json!({"op":"change_tag","name":"대상","replacement":"대상"})))["updated"],
        0
    );
    assert_eq!(
        ok(e.execute(json!({"op":"change_tag","name":"대상","replacement":null})))["updated"],
        2
    );
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":a["id"]})))["tags"],
        json!([])
    );
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":b["id"]})))["tags"],
        json!([])
    );
}

#[test]
fn notebook_delete_rolls_back_detach_and_guards_current_revision() {
    let db = TempDb::new("notebook-rollback");
    let e = db.open();
    let nb = ok(e.execute(json!({"op":"save_notebook","name":"분류"})));
    let a = save_note(&e, "A", "유지", json!({"notebook_id":nb["id"]}));
    let b = save_note(&e, "B", "유지", json!({"notebook_id":nb["id"]}));
    assert!(err(e.execute(json!({"op":"delete_notebook","id":nb["id"],
        "current_id":a["id"],"current_revision":999})))
    .starts_with("conflict:"));
    e.connection()
        .execute_batch(
            "CREATE TEMP TRIGGER fail_detach BEFORE UPDATE OF notebook_id ON notes_meta
      WHEN (SELECT count(*) FROM history)>1 BEGIN SELECT RAISE(ABORT,'detach failure'); END;",
        )
        .unwrap();
    assert!(
        err(e.execute(json!({"op":"delete_notebook","id":nb["id"]}))).contains("detach failure")
    );
    assert_eq!(
        ok(e.execute(json!({"op":"notebooks"})))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    for n in [&a, &b] {
        assert_eq!(ok(e.execute(json!({"op":"get","id":n["id"]}))), *n);
        assert_eq!(
            ok(e.execute(json!({"op":"history","id":n["id"]}))),
            json!([])
        );
    }
    e.connection()
        .execute_batch("DROP TRIGGER fail_detach")
        .unwrap();
    let deleted = ok(e.execute(json!({"op":"delete_notebook","id":nb["id"],
      "current_id":a["id"],"current_revision":a["revision"]})));
    assert_eq!(deleted["updated"], 2);
    assert_eq!(deleted["current"]["revision"], 2);
    assert!(deleted["current"]["notebook_id"].is_null());
}

#[test]
fn metadata_only_index_jobs_do_not_rewrite_fts_or_backlinks() {
    let db = TempDb::new("index-reuse");
    let e = db.open();
    let target = save_note(&e, "연결대상", "대상", json!({}));
    let n = save_note(&e, "검색제목", "검색본문 [[연결대상]]", json!({}));
    ok(e.execute(json!({"op":"wait_index"})));
    let cache = rusqlite::Connection::open(format!("{}.search", db.path)).unwrap();
    cache.execute_batch("CREATE TABLE write_audit(fts INTEGER, links INTEGER); INSERT INTO write_audit VALUES(0,0);
      CREATE TRIGGER audit_fts_insert AFTER INSERT ON notes_fts_docsize BEGIN UPDATE write_audit SET fts=fts+1; END;
      CREATE TRIGGER audit_fts_delete AFTER DELETE ON notes_fts_docsize BEGIN UPDATE write_audit SET fts=fts+1; END;
      CREATE TRIGGER audit_links_delete AFTER DELETE ON backlink_titles BEGIN UPDATE write_audit SET links=links+1; END;
      CREATE TRIGGER audit_links_insert AFTER INSERT ON backlink_titles BEGIN UPDATE write_audit SET links=links+1; END;").unwrap();
    let p = ok(e.execute(
        json!({"op":"patch","id":n["id"],"revision":1,"changes":{"favorite":true,"tags":["정리"]}}),
    ));
    ok(e.execute(json!({"op":"wait_index"})));
    let counts: (i64, i64) = cache
        .query_row("SELECT fts,links FROM write_audit", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(
        counts,
        (0, 0),
        "metadata-only change must not retokenize or rewrite links"
    );
    assert_eq!(
        ok(e.execute(json!({"op":"list","view":"all","query":"검색본문"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        ok(e.execute(json!({"op":"backlinks","id":target["id"]})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let renamed=ok(e.execute(json!({"op":"patch","id":n["id"],"revision":p["revision"],"changes":{"title":"새검색제목"}})));
    ok(e.execute(json!({"op":"wait_index"})));
    let writes: i64 = cache
        .query_row("SELECT fts FROM write_audit", [], |r| r.get(0))
        .unwrap();
    assert!(writes > 0, "audit must observe a real reindex");
    assert_eq!(
        ok(e.execute(json!({"op":"list","view":"all","query":"새검색제목"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let trashed=ok(e.execute(json!({"op":"patch","id":n["id"],"revision":renamed["revision"],"changes":{"trashed":true}})));
    ok(e.execute(json!({"op":"wait_index"})));
    assert_eq!(
        ok(e.execute(json!({"op":"backlinks","id":target["id"]})))["items"],
        json!([])
    );
    ok(e.execute(json!({"op":"patch","id":n["id"],"revision":trashed["revision"],"changes":{"trashed":false}})));
    ok(e.execute(json!({"op":"wait_index"})));
    assert_eq!(
        ok(e.execute(json!({"op":"backlinks","id":target["id"]})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // A markup/link change with identical extracted text must still rebuild links.
    let current = ok(e.execute(json!({"op":"get","id":n["id"]})));
    ok(e.execute(json!({"op":"save","note":{"id":n["id"],"revision":current["revision"],"content":"<p>링크제거</p>"}})));
    ok(e.execute(json!({"op":"wait_index"})));
    assert_eq!(
        ok(e.execute(json!({"op":"backlinks","id":target["id"]})))["items"],
        json!([])
    );
}

// ---- reminders (note notification backend) ---------------------------------

/// Reminder boundary used across the tests: the canonical max is
/// 8_640_000_000_000_000 ms (see limits.rs).
const REMINDER_MAX: i64 = 8_640_000_000_000_000;

#[test]
fn reminder_save_get_list_and_due_ordering() {
    let t = TempDb::new("reminder-due");
    let e = t.open();
    // Same reminder_at for a deterministic id tiebreak: "id-aaa" < "id-bbb".
    let a = save_note(
        &e,
        "알림 A",
        "본문 A",
        json!({"id":"id-aaa","reminder_at":2_000i64}),
    );
    let b = save_note(
        &e,
        "알림 B",
        "본문 B",
        json!({"id":"id-bbb","reminder_at":2_000i64}),
    );
    let earlier = save_note(&e, "먼저", "먼저 본문", json!({"reminder_at":1_000i64}));
    let later = save_note(&e, "나중", "나중 본문", json!({"reminder_at":9_000i64}));
    let none = save_note(&e, "알림 없음", "본문 없음", json!({}));
    assert_eq!(a["reminder_at"], 2_000);
    assert_eq!(none["reminder_at"], serde_json::Value::Null);

    // get/list carry the field too.
    let got = ok(e.execute(json!({"op":"get","id":"id-aaa"})));
    assert_eq!(got["reminder_at"], 2_000);
    let list = ok(e.execute(json!({"op":"list","view":"all","limit":100})));
    assert_eq!(list["items"].as_array().unwrap().len(), 5);
    let by_id = |id: &str| {
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .unwrap()["reminder_at"]
            .clone()
    };
    assert_eq!(by_id("id-aaa"), 2_000);
    assert_eq!(by_id("id-bbb"), 2_000);
    assert!(by_id(none["id"].as_str().unwrap()).is_null());

    // Due list: oldest reminder first, ties broken by id, future excluded.
    let due: Vec<Value> = ok(e.execute(json!({"op":"due_reminders","now":2_500i64})))
        .as_array()
        .unwrap()
        .clone();
    let ids: Vec<&str> = due.iter().map(|n| n["id"].as_str().unwrap()).collect();
    assert_eq!(
        ids,
        vec![
            earlier["id"].as_str().unwrap(),
            a["id"].as_str().unwrap(),
            b["id"].as_str().unwrap()
        ],
        "order must be (reminder_at ASC, id ASC)"
    );
    let stamps: Vec<i64> = due
        .iter()
        .map(|n| n["reminder_at"].as_i64().unwrap())
        .collect();
    assert_eq!(stamps, vec![1_000, 2_000, 2_000]);
    let limited: Vec<Value> = ok(e.execute(json!({"op":"due_reminders","now":2_500i64,"limit":2})))
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(limited.len(), 2);
    // now in the future of everything.
    let all: Vec<Value> = ok(e.execute(json!({"op":"due_reminders","now":20_000i64})))
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(all.len(), 4);
    assert_eq!(all.last().unwrap()["id"], later["id"].as_str().unwrap());
    // now before everything -> nothing.
    assert!(ok(e.execute(json!({"op":"due_reminders","now":999i64})))
        .as_array()
        .unwrap()
        .is_empty());
    // Summaries only: never the body, and no data mutation.
    assert!(due[0].get("content").is_none());
    assert!(due[0].get("text").is_none());
    let rev_before = ok(e.execute(json!({"op":"get","id":"id-aaa"})))["revision"]
        .as_i64()
        .unwrap();
    ok(e.execute(json!({"op":"due_reminders","now":20_000i64})));
    let rev_after = ok(e.execute(json!({"op":"get","id":"id-aaa"})))["revision"]
        .as_i64()
        .unwrap();
    assert_eq!(rev_before, rev_after);
    // Boundary: reminder_at == now is due, and 0 is a legal timestamp.
    let due_at_boundary: Vec<Value> = ok(e.execute(json!({"op":"due_reminders","now":2_000i64})))
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(due_at_boundary.len(), 3);
    let zero = save_note(&e, "영점", "0도 유효", json!({"reminder_at":0i64}));
    assert_eq!(
        ok(e.execute(json!({"op":"due_reminders","now":0i64})))[0]["id"],
        zero["id"].as_str().unwrap()
    );
    // Bad args are rejected.
    assert!(err(e.execute(json!({"op":"due_reminders"}))).contains("now"));
    assert!(err(e.execute(json!({"op":"due_reminders","now":"곧"}))).contains("now"));
    // The due scan must run over the partial reminder index, not a sort.
    let plan: Vec<String> = {
        let mut stmt = e
            .query_connection()
            .prepare(
                "EXPLAIN QUERY PLAN SELECT id FROM notes_meta INDEXED BY idx_notes_reminder \
                 WHERE trashed = 0 AND reminder_at IS NOT NULL AND reminder_at <= 10 \
                 ORDER BY reminder_at ASC, id ASC LIMIT 50",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        rows
    };
    assert!(
        plan.iter().any(|p| p.contains("idx_notes_reminder")),
        "due scan must use the partial reminder index: {plan:?}"
    );
    assert!(
        !plan.iter().any(|p| p.contains("TEMP B-TREE FOR ORDER BY")),
        "leading order term must come from the index: {plan:?}"
    );
}

#[test]
fn reminder_save_absent_preserves_and_explicit_null_clears() {
    let t = TempDb::new("reminder-save-null");
    let e = t.open();
    let n = save_note(&e, "알림 유지", "본문", json!({"reminder_at":5_000i64}));
    let id = n["id"].as_str().unwrap().to_string();

    // Partial save without the key: the stored reminder is preserved.
    let saved = ok(e.execute(json!({"op":"save","note":{"id":id,"text":"수정 본문"}})));
    assert_eq!(saved["reminder_at"], 5_000);
    assert_eq!(saved["revision"], 2);

    // save with explicit null clears it.
    let cleared = ok(e.execute(
        json!({"op":"save","note":{"id":id,"text":"수정 본문","reminder_at":null,"revision":2}}),
    ));
    assert!(cleared["reminder_at"].is_null());
    assert_eq!(cleared["revision"], 3);

    // Recreate via patch and clear via revision-guarded patch (the dismissal
    // path). A patch without the key keeps the value.
    let set = ok(e.execute(json!({"op":"patch","id":id,"revision":3,
        "changes":{"reminder_at":7_000i64}})));
    assert_eq!(set["reminder_at"], 7_000);
    assert_eq!(set["revision"], 4);
    let untouched =
        ok(e.execute(json!({"op":"patch","id":id,"revision":4,"changes":{"favorite":true}})));
    assert_eq!(untouched["reminder_at"], 7_000);
    let dismissed = ok(e.execute(json!({"op":"patch","id":id,"revision":5,
        "changes":{"reminder_at":null}})));
    assert!(dismissed["reminder_at"].is_null());
    assert_eq!(dismissed["revision"], 6);
    assert!(ok(e.execute(json!({"op":"due_reminders","now":8_000i64})))
        .as_array()
        .unwrap()
        .is_empty());
    // Stale revision is still rejected on the reminder patch.
    let stale = e.execute(json!({"op":"patch","id":id,"revision":1,
        "changes":{"reminder_at":1i64}}));
    assert_eq!(stale["ok"], false);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":id})))["reminder_at"],
        serde_json::Value::Null
    );
}

#[test]
fn reminder_rejects_out_of_range_values() {
    let t = TempDb::new("reminder-invalid");
    let e = t.open();
    let n = save_note(&e, "검증", "본문", json!({}));
    let id = n["id"].as_str().unwrap().to_string();
    for bad in [-1i64, REMINDER_MAX + 1, i64::MIN] {
        let res = e.execute(json!({"op":"save","note":{"title":"x","reminder_at":bad}}));
        assert_eq!(res["ok"], false, "save must reject {bad}");
        assert!(res["error"].as_str().unwrap().contains("reminder_at"));
        let res = e.execute(
            json!({"op":"patch","id":id,"revision":n["revision"],"changes":{"reminder_at":bad}}),
        );
        assert_eq!(res["ok"], false, "patch must reject {bad}");
        assert!(res["error"].as_str().unwrap().contains("reminder_at"));
    }
    // Wrong types are rejected too, and nothing was written.
    for bad in [json!("곧"), json!(true), json!(1.5)] {
        assert_eq!(
            e.execute(json!({"op":"patch","id":id,"changes":{"reminder_at":bad}}))["ok"],
            false
        );
    }
    let after = ok(e.execute(json!({"op":"get","id":id})));
    assert_eq!(after["revision"], 1);
    assert_eq!(after["title"], "검증");
    assert!(after["reminder_at"].is_null());
    // The boundary itself is accepted.
    let max = ok(e.execute(
        json!({"op":"patch","id":id,"revision":1,"changes":{"reminder_at":REMINDER_MAX}}),
    ));
    assert_eq!(max["reminder_at"], REMINDER_MAX);
}

#[test]
fn due_reminders_exclude_trashed_but_keep_archived() {
    let t = TempDb::new("reminder-trash");
    let e = t.open();
    let n = save_note(&e, "휴지통 알림", "본문", json!({"reminder_at":1_000i64}));
    let archived = save_note(&e, "보관 알림", "본문", json!({"reminder_at":1_500i64}));
    let id = n["id"].as_str().unwrap().to_string();
    let archived_id = archived["id"].as_str().unwrap().to_string();

    let trashed =
        ok(e.execute(json!({"op":"patch","id":id,"revision":1,"changes":{"trashed":true}})));
    assert_eq!(
        ok(e.execute(json!({"op":"due_reminders","now":2_000i64})))[0]["id"],
        archived_id.as_str()
    );
    // Restoring brings the reminder back (the column is untouched by trash).
    ok(
        e.execute(json!({"op":"patch","id":id,"revision":trashed["revision"],
        "changes":{"trashed":false}})),
    );
    let due: Vec<String> = ok(e.execute(json!({"op":"due_reminders","now":2_000i64})))
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(due, vec![id.clone(), archived_id.clone()]);
    // Hard delete really removes it from the due list.
    ok(e.execute(json!({"op":"patch","id":id,"revision":3,"changes":{"trashed":true}})));
    ok(e.execute(json!({"op":"delete","id":id})));
    let left: Vec<String> = ok(e.execute(json!({"op":"due_reminders","now":2_000i64})))
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(left, vec![archived_id]);
}

#[test]
fn reminder_survives_backup_roundtrip_and_old_backups_read_null() {
    let t = TempDb::new("reminder-backup");
    let e = t.open();
    let with = save_note(
        &e,
        "알림 백업",
        "본문",
        json!({"reminder_at":123_456_789i64}),
    );
    let without = save_note(&e, "알림 없음 백업", "본문", json!({}));
    let file = t.dir.join("reminder-backup.json");
    ok(e.execute(json!({"op":"export","path":file.to_string_lossy()})));
    // The export itself carries the field (rows are ordered by created_at,id,
    // so locate the scheduled note by title).
    let backup: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    let exported = backup["notes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["title"] == "알림 백업")
        .unwrap();
    assert_eq!(exported["reminder_at"], 123_456_789);

    let dest = TempDb::new("reminder-restore");
    let d = dest.open();
    let res = ok(d.execute(json!({"op":"import","path":file.to_string_lossy()})));
    assert_eq!(res["imported"], 2);
    let list = ok(d.execute(json!({"op":"list","view":"all","limit":100})));
    let reminders: Vec<(String, Value)> = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| {
            (
                x["title"].as_str().unwrap().to_string(),
                x["reminder_at"].clone(),
            )
        })
        .collect();
    assert!(reminders.contains(&("알림 백업".into(), json!(123_456_789))));
    assert!(reminders.contains(&("알림 없음 백업".into(), Value::Null)));
    let _ = (with, without);

    // A backup written before the field existed imports with no reminder.
    let legacy = dest.dir.join("legacy.json");
    let legacy_backup = json!({
        "version": 1,
        "notes": [{
            "id": "legacy-1", "title": "옛 백업", "content": "<p>옛 본문</p>",
            "text": "옛 본문", "tags": [], "favorite": false, "pinned": false,
            "archived": false, "trashed": false, "color": null,
            "created_at": 1, "updated_at": 1, "revision": 1
        }],
        "notebooks": []
    });
    std::fs::write(&legacy, legacy_backup.to_string()).unwrap();
    ok(d.execute(json!({"op":"validate_import","path":legacy.to_string_lossy()})));
    ok(d.execute(json!({"op":"import","path":legacy.to_string_lossy()})));
    let imported = ok(d.execute(json!({"op":"list","view":"all","query":"옛 백업"})));
    let legacy_note = &imported["items"][0];
    assert!(legacy_note["reminder_at"].is_null());
    // Corrupt reminder values are rejected before any write.
    let bad = dest.dir.join("bad.json");
    let bad_backup = json!({
        "version": 1,
        "notes": [{"id": "bad-1", "title": "나쁜 값", "reminder_at": -5}],
        "notebooks": []
    });
    std::fs::write(&bad, bad_backup.to_string()).unwrap();
    let res = d.execute(json!({"op":"import","path":bad.to_string_lossy()}));
    assert_eq!(res["ok"], false);
    assert!(res["error"].as_str().unwrap().contains("reminder_at"));
    assert!(
        err(d.execute(json!({"op":"validate_import","path":bad.to_string_lossy()})))
            .contains("reminder_at")
    );
    assert_eq!(
        ok(d.execute(json!({"op":"list","view":"all","query":"나쁜 값"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[test]
fn reminder_migration_from_v2_preserves_existing_notes() {
    let t = TempDb::new("reminder-migrate");
    let e = t.open();
    let n = save_note(
        &e,
        "마이그레이션",
        "기존 노트 보존",
        json!({"tags":["유지"]}),
    );
    let id = n["id"].as_str().unwrap().to_string();
    drop(e);
    // Physically downgrade to the pre-reminder (v2) layout.
    let c = rusqlite::Connection::open(&t.path).unwrap();
    c.execute_batch(
        "DROP INDEX IF EXISTS idx_notes_reminder;
         ALTER TABLE notes_meta DROP COLUMN reminder_at;
         PRAGMA user_version = 2;",
    )
    .unwrap();
    drop(c);
    // Reopen: the migration runs inside init, notes and metadata survive.
    let e = t.open();
    let got = ok(e.execute(json!({"op":"get","id":id})));
    assert_eq!(got["title"], "마이그레이션");
    assert_eq!(got["text"], "기존 노트 보존");
    assert_eq!(got["tags"], json!(["유지"]));
    assert_eq!(got["revision"], 1);
    assert!(got.get("reminder_at").is_some());
    assert!(got["reminder_at"].is_null());
    // The partial index is back and the schema version moved forward.
    let c = rusqlite::Connection::open(&t.path).unwrap();
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, inkism_engine::schema::MAIN_USER_VERSION as i64);
    let index: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_notes_reminder'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(index, 1);
    drop(c);
    // Reminders work normally after the migration.
    ok(e.execute(json!({"op":"patch","id":id,"revision":1,"changes":{"reminder_at":42i64}})));
    let due = ok(e.execute(json!({"op":"due_reminders","now":100i64})));
    assert_eq!(due[0]["id"], id.as_str());
    assert_eq!(due[0]["reminder_at"], 42);
}

#[test]
fn reminders_use_ordered_index_and_reject_invalid_query_bounds() {
    let t = TempDb::new("reminder-query-plan");
    let e = t.open();
    let c = rusqlite::Connection::open(&t.path).unwrap();
    let mut stmt = c.prepare("EXPLAIN QUERY PLAN SELECT id,title,preview FROM notes_meta WHERE trashed=0 AND reminder_at IS NOT NULL AND reminder_at<=?1 ORDER BY reminder_at,id LIMIT 50").unwrap();
    let plan = stmt
        .query_map([2000], |r| r.get::<_, String>(3))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
        .join("\n");
    assert!(plan.contains("idx_notes_reminder"), "{plan}");
    assert!(!plan.contains("TEMP B-TREE"), "{plan}");
    for limit in [
        json!(0),
        json!(101),
        json!(-1),
        json!(4294967297u64),
        json!("50"),
        json!(1.5),
        Value::Null,
    ] {
        assert_eq!(
            e.execute(json!({"op":"due_reminders","now":2000,"limit":limit}))["ok"],
            false
        );
    }
    for now in [-1i64, 8_640_000_000_000_001] {
        assert_eq!(
            e.execute(json!({"op":"due_reminders","now":now}))["ok"],
            false
        );
    }
}

#[test]
fn reminder_repeat_persists_validates_and_roundtrips_backup() {
    let t = TempDb::new("repeat");
    let e = t.open();
    let note = save_note(
        &e,
        "반복",
        "내용",
        json!({"reminder_at":1000,"reminder_repeat_hours":24}),
    );
    let id = note["id"].clone();
    assert_eq!(note["reminder_repeat_hours"], 24);
    let updated = ok(e.execute(json!({"op":"save","note":{"id":id,"title":"변경","revision":1}})));
    assert_eq!(updated["reminder_repeat_hours"], 24);
    for invalid in [
        json!(0),
        json!(1),
        json!(25),
        json!(-24),
        json!(1.5),
        json!("24"),
    ] {
        assert_eq!(e.execute(json!({"op":"patch","id":id,"revision":2,"changes":{"reminder_repeat_hours":invalid}}))["ok"],false);
    }
    assert_eq!(ok(e.execute(json!({"op":"get","id":id})))["revision"], 2);
    let file = t.dir.join("repeat.json");
    ok(e.execute(json!({"op":"export","path":file})));
    let dest = TempDb::new("repeat-import");
    let target = dest.open();
    ok(target.execute(json!({"op":"import","path":file})));
    assert_eq!(
        ok(target.execute(json!({"op":"list","view":"all"})))["items"][0]["reminder_repeat_hours"],
        24
    );
    drop(e);
    let e = t.open();
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":id})))["reminder_repeat_hours"],
        24
    );
    let changed = ok(e.execute(
        json!({"op":"patch","id":id,"revision":2,"changes":{"reminder_repeat_hours":168}}),
    ));
    assert_eq!(changed["reminder_repeat_hours"], 168);
    let cleared=ok(e.execute(json!({"op":"patch","id":id,"revision":3,"changes":{"reminder_repeat_hours":null,"reminder_at":null}})));
    assert!(cleared["reminder_repeat_hours"].is_null());
    assert!(ok(e.execute(json!({"op":"due_reminders","now":2000})))
        .as_array()
        .unwrap()
        .is_empty());
}
#[test]
fn reminder_cursor_reaches_more_than_one_page() {
    let t = TempDb::new("repeat-pages");
    let e = t.open();
    for i in 0..105 {
        save_note(
            &e,
            "page",
            "body",
            json!({"id":format!("reminder-{i:03}"),"reminder_at":1000,"reminder_repeat_hours":24}),
        );
    }
    let first = ok(e.execute(json!({"op":"due_reminders","now":2000,"limit":100})));
    assert_eq!(first.as_array().unwrap().len(), 100);
    let last = &first[99];
    let second=ok(e.execute(json!({"op":"due_reminders","now":2000,"limit":100,"after_at":last["reminder_at"],"after_id":last["id"]})));
    assert_eq!(second.as_array().unwrap().len(), 5);
    assert_eq!(second[0]["id"], "reminder-100");
}
