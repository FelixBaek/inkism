use inkism_engine::{
    segments::{self, Ancestor},
    Engine,
};
use rusqlite::Connection;
use serde_json::{json, Value};

struct Db {
    dir: std::path::PathBuf,
    path: String,
}
impl Db {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("inkism-segments-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Self {
            path: dir.join("notes.db").to_string_lossy().into(),
            dir,
        }
    }
    fn open(&self) -> Engine {
        Engine::open(&self.path).unwrap()
    }
}
impl Drop for Db {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn wait(e: &Engine) {
    assert_eq!(e.wait_index(60000).unwrap(), 0);
}
fn save(e: &Engine, source: &str) -> Value {
    ok(e.execute(json!({"op":"save","note":{"title":"내부 구간","content":source,"text":"한글"}})))
}
fn render(source: &str, start: &[Ancestor], end: &[Ancestor]) -> String {
    start
        .iter()
        .map(|a| a.open.clone() + &a.prelude)
        .collect::<String>()
        + source
        + &end
            .iter()
            .rev()
            .map(|a| format!("</{}>", a.tag))
            .collect::<String>()
}
fn collect(
    e: &Engine,
    id: &Value,
    revision: i64,
    ordinal: i64,
    byte_start: usize,
    source: &str,
) -> Vec<Value> {
    let mut offset = 0;
    let mut bytes = byte_start;
    let mut all = Vec::new();
    let mut actual = String::new();
    loop {
        let page = ok(e.execute(json!({"op":"document_segments","id":id,"revision":revision,"ordinal":ordinal,"offset":offset,"limit":3})));
        assert_eq!(page["ready"], true);
        assert_eq!(page["supported"], true);
        assert!(page.to_string().len() < 160000);
        for chunk in page["segments"].as_array().unwrap() {
            let raw = chunk["source"].as_str().unwrap();
            assert_eq!(chunk["byte_offset"], bytes);
            assert_eq!(chunk["ordinal"], all.len());
            assert!(raw.len() <= segments::MAX_SOURCE_BYTES);
            let start: Vec<Ancestor> =
                serde_json::from_value(chunk["start_context"].clone()).unwrap();
            let end: Vec<Ancestor> = serde_json::from_value(chunk["end_context"].clone()).unwrap();
            let wrapped = render(raw, &start, &end);
            assert!(
                segments::split(&wrapped).is_some(),
                "unbalanced rich fragment at {}",
                all.len()
            );
            actual.push_str(raw);
            bytes += raw.len();
            all.push(chunk.clone());
        }
        if page["next_offset"].is_null() {
            assert_eq!(page["total_segments"], all.len());
            break;
        }
        offset = page["next_offset"].as_u64().unwrap();
    }
    assert_eq!(actual, source);
    all
}

#[test]
fn chunks_preserve_unicode_references_quoted_tags_and_open_marks() {
    let unit = "한😀&amp;&#x1f642;&notit;&#65;z";
    let inner = unit.repeat(22000);
    let source = format!("<p title='a > b'><strong><em>{inner}</em></strong></p>");
    let split = segments::split(&source).unwrap();
    assert!(split.len() > 30);
    assert_eq!(
        split
            .iter()
            .map(|s| &source[s.range.clone()])
            .collect::<String>(),
        source
    );
    let actual = split
        .iter()
        .map(|s| {
            inkism_engine::plaintext::from_html(&render(
                &source[s.range.clone()],
                &s.start_context,
                &s.end_context,
            ))
            .unwrap()
        })
        .collect::<String>();
    assert_eq!(
        actual,
        inkism_engine::plaintext::from_html(&source).unwrap()
    );
    assert!(split[1]
        .start_context
        .iter()
        .any(|a| a.open == "<p title='a > b'>"));
    for chunk in split {
        assert!(chunk.range.len() <= segments::MAX_SOURCE_BYTES);
    }
    let cr = format!(
        "<p>{}\r\n{}</p>",
        "a".repeat(segments::TARGET_BYTES - 4),
        "b".repeat(40000)
    );
    for s in segments::split(&cr).unwrap() {
        assert!(!(cr[..s.range.end].ends_with('\r') && cr[s.range.end..].starts_with('\n')));
    }
    assert!(
        segments::split("<details open><summary>x</summary><div><p>y</p></div></details>")
            .is_some()
    );
}

#[test]
fn ambiguous_html_never_gets_guessed_offsets() {
    for source in [
        "<p><p>x</p></p>",
        "<p><strong>x</p></strong>",
        "<table><p>x</p></table>",
        "<table>&amp;</table>",
        "<table><tr><td><p>x</p></td></tr></table>",
        "<p a='1' A='2'>x</p>",
        "<p><a><a>x</a></a></p>",
        "<p><script>x</script></p>",
        "<p\0>x</p>",
        "<p/>x",
        "<p>\0</p>",
        "<p onclick='x'>a</p>",
        "<div data-type='block-math'>x</div>",
    ] {
        assert!(segments::split(source).is_none(), "{source}");
    }
    assert!(segments::split(&format!("<p>&#{};</p>", "1".repeat(40000))).is_none());
}

#[test]
fn cache_reads_are_bounded_without_primary_body_for_paragraph_table_and_list() {
    let db = Db::new();
    let e = db.open();
    let p = format!("<p><strong>{}</strong></p>", "한글😀&amp;".repeat(50000));
    let table = format!(
        "<table><colgroup><col style='width: 120px'><col style='width: 80px'></colgroup><tbody>{}</tbody></table>",
        "<tr><td><p>셀😀&amp;</p></td><td><p>옆</p></td></tr>".repeat(15000)
    );
    let list = format!(
        "<ol start='7'>{}</ol>",
        "<li><p>항목😀&amp;</p></li>".repeat(20000)
    );
    let source = format!("<p>앞</p>{p}{table}{list}<p>뒤</p>");
    let n = save(&e, &source);
    wait(&e);
    e.connection()
        .execute_batch("DROP TABLE notes_body")
        .unwrap();
    let mut at = "<p>앞</p>".len();
    for (index, block) in [&p, &table, &list].iter().enumerate() {
        assert!(block.len() > segments::LARGE_BLOCK_BYTES);
        let chunks = collect(&e, &n["id"], 1, index as i64 + 1, at, block);
        assert!(chunks.len() > 30);
        if index == 1 {
            assert!(chunks[1]["start_context"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["tag"] == "table"
                    && a["prelude"]
                        .as_str()
                        .is_some_and(|s| s.contains("width: 120px"))));
            assert!(
                !chunks[1]["start_context"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|a| a["tag"] == "tr"),
                "ordinary rows are not cut internally"
            );
        }
        at += block.len();
    }
    let small =
        ok(e.execute(json!({"op":"document_segments","id":n["id"],"revision":1,"ordinal":0})));
    assert_eq!(small["total_segments"], 1);
    assert_eq!(small["segments"][0]["source"], "<p>앞</p>");
    for args in [
        json!({"limit":0}),
        json!({"limit":9}),
        json!({"offset":-1}),
        json!({"offset":999999}),
        json!({"ordinal":-1}),
        json!({"revision":0}),
    ] {
        let mut req = json!({"op":"document_segments","id":n["id"],"revision":1,"ordinal":1});
        req.as_object_mut()
            .unwrap()
            .extend(args.as_object().unwrap().clone());
        assert_eq!(e.execute(req)["ok"], false);
    }
}

#[test]
fn cache_reuses_metadata_and_unchanged_blocks_tracks_resize_and_rolls_back() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    inkism_engine::schema::init_search(&conn).unwrap();
    let large = format!("<p><em>{}</em></p>", "ab😀&amp;".repeat(50000));
    inkism_engine::blocks::rebuild(&conn, "note", 1, &large).unwrap();
    conn.execute_batch("CREATE TABLE writes(x); CREATE TRIGGER segment_write AFTER INSERT ON document_segments BEGIN INSERT INTO writes VALUES(1); END;").unwrap();
    inkism_engine::blocks::rebuild(&conn, "note", 2, &large).unwrap();
    let appended = format!("{large}<p>tail</p>");
    inkism_engine::blocks::rebuild(&conn, "note", 3, &appended).unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM writes", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    let shifted = format!("<p>front</p>{appended}");
    inkism_engine::blocks::rebuild(&conn, "note", 4, &shifted).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT block_ordinal FROM document_segment_layout WHERE note_id='note'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM writes", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0,
        "shift reuses internal layout"
    );
    let before: i64 = conn
        .query_row("SELECT count(*) FROM document_segments", [], |r| r.get(0))
        .unwrap();
    conn.execute_batch("CREATE TRIGGER fail_segment BEFORE INSERT ON document_segments BEGIN SELECT RAISE(ABORT,'injected'); END; SAVEPOINT index_note;").unwrap();
    let changed = shifted.replacen("ab😀", "changed😀", 1);
    assert!(inkism_engine::blocks::rebuild(&conn, "note", 5, &changed).is_err());
    conn.execute_batch("ROLLBACK TO index_note; RELEASE index_note; DROP TRIGGER fail_segment;")
        .unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT revision FROM document_layout WHERE note_id='note'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        4
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM document_segments", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        before
    );
    inkism_engine::blocks::rebuild(&conn, "note", 5, &changed).unwrap();
    inkism_engine::blocks::rebuild(&conn, "fresh", 5, &changed).unwrap();
    let rows = |id: &str| {
        conn.prepare("SELECT block_ordinal,ordinal,byte_offset,byte_count,start_context,end_context FROM document_segments WHERE note_id=?1 ORDER BY block_ordinal,ordinal").unwrap().query_map([id],|r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,i64>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?))).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap()
    };
    assert_eq!(rows("note"), rows("fresh"));
    inkism_engine::blocks::rebuild(&conn, "note", 6, "<p>small</p>").unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM document_segments WHERE note_id='note'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn revision_conflict_pending_cache_and_v6_migration_preserve_source() {
    let db = Db::new();
    let e = db.open();
    let source = format!("<p>{}</p>", "한글😀&amp;".repeat(50000));
    let n = save(&e, &source);
    wait(&e);
    let search = Connection::open(format!("{}.search", db.path)).unwrap();
    search.execute_batch("BEGIN IMMEDIATE").unwrap();
    ok(e.execute(json!({"op":"patch","id":n["id"],"revision":1,"changes":{"title":"제목 수정"}})));
    assert_eq!(
        e.execute(json!({"op":"document_segments","id":n["id"],"revision":1,"ordinal":0}))["ok"],
        false
    );
    let pending =
        ok(e.execute(json!({"op":"document_segments","id":n["id"],"revision":2,"ordinal":0})));
    assert_eq!(pending["ready"], false);
    assert_eq!(pending["segments"], json!([]));
    search.execute_batch("COMMIT").unwrap();
    wait(&e);
    collect(&e, &n["id"], 2, 0, 0, &source);
    drop(e);
    search.execute_batch("DROP TABLE document_segments; DROP TABLE document_segment_layout; DROP TABLE document_segment_index; PRAGMA user_version=6;").unwrap();
    drop(search);
    let e = db.open();
    wait(&e);
    collect(&e, &n["id"], 2, 0, 0, &source);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":n["id"]})))["content"],
        source
    );
    let unsupported = save(
        &e,
        &format!("<p>{}</p>", "<script>x</script>".repeat(40000)),
    );
    wait(&e);
    let page = ok(e.execute(
        json!({"op":"document_segments","id":unsupported["id"],"revision":1,"ordinal":0}),
    ));
    assert_eq!(page["supported"], false);
    assert_eq!(page["segments"], json!([]));
}

#[test]
fn large_task_list_segments_and_v8_cache_upgrade_preserve_source() {
    let db = Db::new();
    let items = (0..1000)
        .map(|index| {
            let checked = if index % 2 == 0 { "true" } else { "false" };
            let input_checked = if index % 2 == 0 { " checked=\"checked\"" } else { "" };
            format!("<li data-checked=\"{checked}\" data-type=\"taskItem\"><label><input type=\"checkbox\"{input_checked}><span></span></label><div><p>할 일 {index} <strong>{}</strong></p></div></li>", "한글😀&amp; ".repeat(30))
        })
        .collect::<String>();
    let source = format!("<ul data-type=\"taskList\">{items}</ul>");
    let id;
    {
        let e = db.open();
        id = save(&e, &source)["id"].clone();
        wait(&e);
        assert!(collect(&e, &id, 1, 0, 0, &source).len() > 1);
    }
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    cache.execute_batch("UPDATE document_segment_layout SET supported=0,segment_count=0; DELETE FROM document_segments; PRAGMA user_version=8;").unwrap();
    drop(cache);
    let e = db.open();
    wait(&e);
    assert!(collect(&e, &id, 1, 0, 0, &source).len() > 1);
    let note = ok(e.execute(json!({"op":"get","id":id})));
    assert_eq!(note["content"], source);
    assert_eq!(note["revision"], 1);
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    assert_eq!(
        inkism_engine::schema::search_user_version(&cache).unwrap(),
        inkism_engine::schema::SEARCH_USER_VERSION
    );
}

#[test]
fn task_markup_admission_keeps_unknown_nodes_and_controls_unsupported() {
    let task = "<ul data-type='taskList'><li data-type='taskItem' data-checked='true'><label><input type='checkbox' checked><span></span></label><div><p>확인</p></div></li></ul>";
    assert!(segments::split(task).is_some());
    for source in [
        task.replace("taskList", "unknownList"),
        task.replace("taskItem", "attachment"),
        task.replace("type='checkbox'", "type='text'"),
        task.replace("type='checkbox'", ""),
        task.replace("type='checkbox'", "type='checkbox' onchange='bad()'"),
        "<p><label><input type='checkbox'></label></p>".into(),
        "<div><input type='checkbox'></div>".into(),
    ] {
        assert!(
            segments::split(&source).is_none(),
            "unexpected supported input: {source}"
        );
    }
}

#[cfg(feature = "encrypted-storage")]
#[test]
fn encrypted_internal_windows_reopen_and_splice_preserves_rest_of_source() {
    let db = Db::new();
    let key = || inkism_engine::storage::StorageKey::from_bytes([0x68; 32]);
    let e = Engine::open_encrypted(&db.path, key()).unwrap();
    let source = format!("<p><strong>{}</strong></p>", "한글😀&amp;".repeat(50000));
    let n = save(&e, &source);
    wait(&e);
    let parts = collect(&e, &n["id"], 1, 0, 0, &source);
    let part = &parts[parts.len() / 2];
    let raw = part["source"].as_str().unwrap();
    let replacement = raw.replacen("한글", "수정", 1);
    let reply=ok(e.execute(json!({"op":"document_splice_html","id":n["id"],"revision":1,"content":{"start":part["byte_offset"],"expected":raw,"replacement":replacement}})));
    assert_eq!(reply["revision"], 2);
    let at = part["byte_offset"].as_u64().unwrap() as usize;
    let expected = format!(
        "{}{}{}",
        &source[..at],
        replacement,
        &source[at + raw.len()..]
    );
    wait(&e);
    drop(e);
    let e = Engine::open_encrypted(&db.path, key()).unwrap();
    wait(&e);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":n["id"]})))["content"],
        expected
    );
    collect(&e, &n["id"], 2, 0, 0, &expected);
}
