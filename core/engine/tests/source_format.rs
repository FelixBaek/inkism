use inkism_engine::{source_format, Engine};
use serde_json::{json, Value};
struct Db {
    path: std::path::PathBuf,
}
impl Db {
    fn new() -> Self {
        Self {
            path: std::env::temp_dir().join(format!("inkism-source-{}.db", uuid::Uuid::new_v4())),
        }
    }
    fn open(&self) -> Engine {
        Engine::open(self.path.to_str().unwrap()).unwrap()
    }
}
impl Drop for Db {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm", ".search", ".search-wal", ".search-shm"] {
            let _ = std::fs::remove_file(format!("{}{}", self.path.display(), suffix));
        }
    }
}
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn create(e: &Engine, format: &str, content: &str) -> Value {
    ok(e.execute(
        json!({"op":"save","note":{"content_format":format,"content":content,"title":"source"}}),
    ))
}

#[test]
fn raw_formats_roundtrip_and_reject_legacy_writes_without_mutation() {
    for format in ["text", "markdown", "html"] {
        let db = Db::new();
        let e = db.open();
        let raw = "# title
<p>&amp; 한글 😀</p>
<script>literal</script>";
        let n = create(&e, format, raw);
        assert_eq!(n["content"], raw);
        assert_eq!(n["content_format"], format);
        if format != "html" {
            let rejected = e.execute(
                json!({"op":"save","note":{"id":n["id"],"revision":1,"content":"replacement"}}),
            );
            assert_eq!(rejected["ok"], false);
        }
        let unknown=e.execute(json!({"op":"save","note":{"id":n["id"],"revision":1,"content_format":"unknown","content":"replacement"}}));
        assert_eq!(unknown["ok"], false);
        drop(e);
        let e = db.open();
        let reopened = ok(e.execute(json!({"op":"get","id":n["id"]})));
        assert_eq!(reopened["content"], raw);
        assert_eq!(reopened["revision"], 1);
        assert_eq!(reopened["content_format"], format);
        let summary = ok(e.execute(json!({"op":"list","view":"all"})))["items"][0].clone();
        assert_eq!(summary["content_format"], format);
        assert_eq!(
            ok(e.execute(json!({"op":"document_info","id":n["id"]})))["content_format"],
            format
        );
    }
}
#[test]
fn explicit_reinterpretation_snapshots_original_format_and_bytes() {
    let db = Db::new();
    let e = db.open();
    let raw = "<p>original &amp; bytes</p>";
    let n = create(&e, "html", raw);
    assert_eq!(e.execute(json!({"op":"save","note":{"id":n["id"],"revision":1,"content_format":"text","content":raw}}))["ok"],false);
    let changed = ok(e.execute(
        json!({"op":"convert_content","id":n["id"],"revision":1,"content_format":"text"}),
    ));
    assert_eq!(changed["content"], raw);
    assert_eq!(changed["content_format"], "text");
    let old = ok(e.execute(json!({"op":"revision_body","id":n["id"],"revision":1})));
    assert_eq!(old["content"], raw);
    assert_eq!(old["content_format"], "html");
    assert_eq!(
        e.execute(
            json!({"op":"convert_content","id":n["id"],"revision":1,"content_format":"markdown"})
        )["ok"],
        false
    );
    let history = ok(e.execute(json!({"op":"history","id":n["id"]})));
    let restored=ok(e.execute(json!({"op":"restore","id":n["id"],"history_id":history[0]["id"],"revision":changed["revision"]})));
    assert_eq!(restored["content"], raw);
    assert_eq!(restored["content_format"], "html");
}

#[test]
fn explicit_transformation_updates_body_format_and_preview_atomically() {
    let db=Db::new();let e=db.open();
    let raw="\u{feff}**한글 & 글**\r\n";
    let n=create(&e,"markdown",raw);
    let html="<p><strong>한글 &amp; 글</strong></p>";
    let changed=ok(e.execute(json!({"op":"convert_content","id":n["id"],"revision":1,
        "content_format":"html","content":html})));
    assert_eq!(changed["content"],html);assert_eq!(changed["content_format"],"html");
    assert!(changed["text"].as_str().unwrap().contains("한글 & 글"));
    assert!(!changed["text"].as_str().unwrap().contains("<strong>"));
    let old=ok(e.execute(json!({"op":"revision_body","id":n["id"],"revision":1})));
    assert_eq!(old["content"],raw);assert_eq!(old["content_format"],"markdown");
    for revision in [1,changed["revision"].as_i64().unwrap()] {
        let bad_content=if revision==1 {json!("stale")}else{json!(123)};
        assert_eq!(e.execute(json!({"op":"convert_content","id":n["id"],"revision":revision,
            "content_format":"markdown","content":bad_content}))["ok"],false);
        assert_eq!(ok(e.execute(json!({"op":"get","id":n["id"]}))),changed);
    }
    let readonly=ok(e.execute(json!({"op":"patch","id":n["id"],"revision":changed["revision"],"changes":{"readonly":true}})));
    assert_eq!(e.execute(json!({"op":"convert_content","id":n["id"],"revision":readonly["revision"],
        "content_format":"markdown","content":"**새 본문**"}))["ok"],false);
    assert_eq!(ok(e.execute(json!({"op":"get","id":n["id"]}))),readonly);
}
#[test]
fn splice_snapshots_keep_exact_formats_and_retention_on_failed_writes() {
    for format in ["html", "text", "markdown"] {
        let db = Db::new();
        let e = db.open();
        let raw = "\u{feff}<p><strong>한글 0 😀 &amp;</strong></p>\r\n";
        let mut current = create(&e, format, raw);
        let mut originals = Vec::new();
        for number in 1..=25 {
            originals.push(current.clone());
            let replacement = format!("\u{feff}<p><strong>한글 {number} 😀 &amp;</strong></p>\r\n");
            ok(e.execute(json!({
                "op":if format == "html" {"document_splice_html"} else {"document_splice_source"},
                "id":current["id"],"revision":current["revision"],"content_format":format,
                "content":{"start":0,"expected":current["content"],"replacement":replacement},
                "metadata":{"title":format!("제목 {number}"),"notebook_id":null,"tags":[]}
            })));
            current = ok(e.execute(json!({"op":"get","id":current["id"]})));
        }
        let id = current["id"].as_str().unwrap();
        let snapshot_rows = || {
            let mut stmt = e.connection().prepare(
                "SELECT note_revision,title,content,text,content_format FROM history WHERE note_id=?1 ORDER BY row_seq"
            ).unwrap();
            stmt.query_map([id], |r| {
                Ok(json!({
                    "revision":r.get::<_,i64>(0)?,"title":r.get::<_,String>(1)?,
                    "content":r.get::<_,String>(2)?,"text":r.get::<_,String>(3)?,
                    "content_format":r.get::<_,String>(4)?
                }))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>()
        };
        let expected: Vec<_> = originals[5..]
            .iter()
            .map(|n| {
                json!({
                    "revision":n["revision"],"title":n["title"],"content":n["content"],
                    "text":n["text"],"content_format":n["content_format"]
                })
            })
            .collect();
        assert_eq!(
            snapshot_rows(),
            expected,
            "{format} retention changed the baseline"
        );
        let sequence: i64 = e
            .connection()
            .query_row("SELECT count(*) FROM history_seq", [], |r| r.get(0))
            .unwrap();
        let mut request = json!({
            "op":if format == "html" {"document_splice_html"} else {"document_splice_source"},
            "id":id,"revision":current["revision"],"content_format":format,
            "content":{"start":0,"expected":"","replacement":""}
        });
        let noop = ok(e.execute(request.clone()));
        assert_eq!(noop["revision"], current["revision"]);
        assert_eq!(snapshot_rows(), expected);
        request["content"] =
            json!({"start":0,"expected":current["content"],"replacement":"<p>次の 한글😀</p>"});
        for trigger in [
            "CREATE TRIGGER fail_snapshot BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT,'history insert failed'); END;",
            "CREATE TRIGGER fail_snapshot BEFORE UPDATE ON notes_body BEGIN SELECT RAISE(ABORT,'body update failed'); END;",
        ] {
            e.connection().execute_batch(trigger).unwrap();
            assert_eq!(e.execute(request.clone())["ok"], false);
            assert_eq!(ok(e.execute(json!({"op":"get","id":id}))), current);
            assert_eq!(snapshot_rows(), expected, "failed {format} splice pruned history");
            assert_eq!(e.connection().query_row("SELECT count(*) FROM history_seq", [], |r|r.get::<_,i64>(0)).unwrap(), sequence);
            e.connection().execute_batch("DROP TRIGGER fail_snapshot").unwrap();
        }
        let reply = ok(e.execute(request));
        assert_eq!(reply["revision"], current["revision"].as_i64().unwrap() + 1);
        let rows = snapshot_rows();
        assert_eq!(rows.len(), 20);
        assert_eq!(rows.last().unwrap()["content"], current["content"]);
        assert_eq!(rows.last().unwrap()["text"], current["text"]);
        assert_eq!(rows.last().unwrap()["title"], current["title"]);
        assert_eq!(rows.last().unwrap()["content_format"], format);
    }
}

#[test]
fn raw_splice_validates_revision_slice_format_and_preserves_history() {
    let db = Db::new();
    let e = db.open();
    let n = create(&e, "text", "앞 <p>literal</p> 뒤");
    let req = json!({"op":"document_splice_source","id":n["id"],"revision":1,"content_format":"text","content":{"start":0,"expected":"앞","replacement":"변경"}});
    let changed = ok(e.execute(req.clone()));
    assert_eq!(changed["revision"], 2);
    assert_eq!(e.execute(req)["ok"], false);
    let current = ok(e.execute(json!({"op":"get","id":n["id"]})));
    assert_eq!(current["content"], "변경 <p>literal</p> 뒤");
    assert_eq!(current["text"], current["content"]);
    let bad = json!({"op":"document_splice_source","id":n["id"],"revision":2,"content_format":"html","content":{"start":0,"expected":"변경","replacement":"wrong"}});
    assert_eq!(e.execute(bad)["ok"], false);
    let htmlop = json!({"op":"document_splice_html","id":n["id"],"revision":2,"content":{"start":0,"expected":"변경","replacement":"wrong"}});
    assert_eq!(e.execute(htmlop)["ok"], false);
    assert_eq!(
        e.execute(json!({"op":"document_blocks","id":n["id"]}))["ok"],
        false
    );
    assert_eq!(
        ok(e.execute(json!({"op":"revision_body","id":n["id"],"revision":1})))["content_format"],
        "text"
    );
}
#[test]
fn explicit_render_is_revision_guarded_and_never_changes_source() {
    let db = Db::new();
    let e = db.open();
    for (format, raw, needle) in [
        ("text", "<script>alert('x')</script>", "&lt;script&gt;"),
        (
            "markdown",
            "# Heading

**strong**",
            "<h1>Heading</h1>",
        ),
        ("html", "<p>unchanged</p>", "<p>unchanged</p>"),
    ] {
        let n = create(&e, format, raw);
        let render = ok(e.execute(json!({"op":"document_render","id":n["id"],"revision":1})));
        assert!(render["html"].as_str().unwrap().contains(needle));
        assert_eq!(render["content_format"], format);
        assert_eq!(
            e.execute(json!({"op":"document_render","id":n["id"],"revision":2}))["ok"],
            false
        );
        assert_eq!(
            ok(e.execute(json!({"op":"get","id":n["id"]})))["content"],
            raw
        );
    }
}
#[test]
fn backup_v2_preserves_format_and_import_rejects_unknown_atomically() {
    let db = Db::new();
    let e = db.open();
    create(&e, "text", "<p>raw bytes</p>");
    create(&e, "markdown", "# raw");
    let path = std::env::temp_dir().join(format!("source-backup-{}.json", uuid::Uuid::new_v4()));
    ok(e.execute(json!({"op":"export","path":path})));
    let mut backup: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(backup["version"], 2);
    let other = Db::new();
    let target = other.open();
    ok(target.execute(json!({"op":"import","path":path})));
    let items = ok(target.execute(json!({"op":"list","view":"all"})))["items"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(items.len(), 2);
    assert!(items.iter().any(|n| n["content_format"] == "text"));
    assert!(items.iter().any(|n| n["content_format"] == "markdown"));
    backup["notes"][0]["content_format"] = json!("unknown");
    std::fs::write(&path, serde_json::to_vec(&backup).unwrap()).unwrap();
    assert_eq!(
        target.execute(json!({"op":"import","path":path}))["ok"],
        false
    );
    assert_eq!(
        ok(target.execute(json!({"op":"list","view":"all"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    std::fs::remove_file(path).unwrap();
}
#[test]
fn background_search_uses_source_format_without_touching_source() {
    let db = Db::new();
    let e = db.open();
    for format in ["text", "markdown", "html"] {
        let raw = match format {
            "text" => "literal <tag>찾을문구</tag>",
            "markdown" => "**찾을문구**",
            _ => "<p>찾을문구</p>",
        };
        create(&e, format, raw);
    }
    assert_eq!(ok(e.execute(json!({"op":"wait_index"})))["pending"], 0);
    let results = ok(e.execute(json!({"op":"list","view":"all","query":"찾을문구"})));
    assert_eq!(results["items"].as_array().unwrap().len(), 3);
}
#[test]
fn render_expansion_is_bounded_separately_from_editing() {
    assert!(source_format::render("text", &"&".repeat(8 * 1024 * 1024)).is_err());
}

#[test]
fn existing_v4_note_defaults_to_html_without_rewriting_source() {
    let db = Db::new();
    let conn = rusqlite::Connection::open(&db.path).unwrap();
    conn.execute_batch(inkism_engine::schema::MAIN_SCHEMA_SQL)
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let raw = "<p data-custom='keep'>legacy
&amp; 😀</p>";
    conn.execute(
        "INSERT INTO notes_meta(id,title,created_at,updated_at) VALUES(?1,'legacy',1,2)",
        [&id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO notes_body(note_id,content,text) VALUES(?1,?2,'old cache')",
        rusqlite::params![id, raw],
    )
    .unwrap();
    conn.pragma_update(None, "user_version", 4).unwrap();
    drop(conn);
    let e = db.open();
    let note = ok(e.execute(json!({"op":"get","id":id})));
    assert_eq!(note["content"], raw);
    assert_eq!(note["text"], "old cache");
    assert_eq!(note["content_format"], "html");
    assert_eq!(
        e.connection()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        inkism_engine::schema::MAIN_USER_VERSION as i64
    );
}
#[cfg(feature = "encrypted-storage")]
#[test]
fn encrypted_source_and_format_reopen_with_correct_key_only() {
    use inkism_engine::storage::StorageKey;
    let db = Db::new();
    let key = StorageKey::from_bytes([63; 32]);
    let id;
    {
        let e = Engine::open_encrypted(db.path.to_str().unwrap(), key.clone()).unwrap();
        let n = create(&e, "text", "encrypted-source-marker <tag>literal</tag>");
        id = n["id"].clone();
        ok(e.execute(
            json!({"op":"convert_content","id":id,"revision":1,"content_format":"markdown"}),
        ));
    }
    assert!(
        Engine::open_encrypted(db.path.to_str().unwrap(), StorageKey::from_bytes([64; 32]))
            .is_err()
    );
    let e = Engine::open_encrypted(db.path.to_str().unwrap(), key).unwrap();
    let note = ok(e.execute(json!({"op":"get","id":id})));
    assert_eq!(note["content_format"], "markdown");
    assert_eq!(
        note["content"],
        "encrypted-source-marker <tag>literal</tag>"
    );
    assert_eq!(
        ok(e.execute(json!({"op":"revision_body","id":id,"revision":1})))["content_format"],
        "text"
    );
    let bytes = std::fs::read(&db.path).unwrap();
    assert!(!bytes
        .windows(b"encrypted-source-marker".len())
        .any(|w| w == b"encrypted-source-marker"));
}

#[test]
fn source_format_and_repeating_reminder_keep_distinct_metadata_columns() {
    let db = Db::new();
    let e = db.open();
    let n = ok(e.execute(json!({"op":"save","note":{
        "content_format":"markdown","content":"# reminder source",
        "reminder_at":1000,"reminder_repeat_hours":24
    }})));
    for value in [
        n.clone(),
        ok(e.execute(json!({"op":"get","id":n["id"]}))),
        ok(e.execute(json!({"op":"list","view":"all"})))["items"][0].clone(),
        ok(e.execute(json!({"op":"due_reminders","now":2000})))[0].clone(),
        ok(e.execute(json!({"op":"document_info","id":n["id"]})))["summary"].clone(),
    ] {
        assert_eq!(value["content_format"], "markdown", "{value}");
        assert_eq!(value["reminder_repeat_hours"], 24, "{value}");
    }
}
