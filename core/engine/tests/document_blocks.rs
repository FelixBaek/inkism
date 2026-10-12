use inkism_engine::Engine;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
struct Db {
    path: String,
    dir: std::path::PathBuf,
}
impl Db {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("inkism-blocks-{}", uuid::Uuid::new_v4()));
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
    // wait_index deliberately returns after 10s with pending work. This is a
    // setup wait, not an assertion that a debug Windows index builds in 10s.
    let started = std::time::Instant::now();
    loop {
        let pending = ok(e.execute(json!({"op":"wait_index"})))["pending"]
            .as_i64()
            .unwrap();
        if pending == 0 {
            break;
        }
        assert!(
            started.elapsed() < std::time::Duration::from_secs(60),
            "background index still has {pending} jobs after {:?}",
            started.elapsed()
        );
    }
    eprintln!("background index preparation: {:?}", started.elapsed());
}
fn save(e: &Engine, html: &str) -> Value {
    ok(e.execute(json!({"op":"save","note":{"title":"블록 검사","content":html,"text":"한글"}})))
}

#[test]
fn bounded_pages_never_transfer_an_oversized_block_or_skip_its_ordinal() {
    let db = Db::new();
    let e = db.open();
    let giant = format!("<p>{}</p>", "한글😀&amp;".repeat(50000));
    let n = save(&e, &format!("<p>앞</p>{giant}<p>뒤</p>"));
    wait(&e);
    // Read paths must not depend on the primary body at all.
    e.connection()
        .execute_batch("DROP TABLE notes_body")
        .unwrap();
    let first =
        ok(e.execute(json!({"op":"document_blocks","id":n["id"],"revision":1,"bounded":true})));
    assert_eq!(first["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(first["blocks"][0]["html"], "<p>앞</p>");
    assert_eq!(first["next_offset"], 1);
    assert_eq!(first["oversized_block"], false);
    let blocked = ok(e.execute(
        json!({"op":"document_blocks","id":n["id"],"revision":1,"offset":1,"bounded":true}),
    ));
    assert_eq!(blocked["blocks"], json!([]));
    assert_eq!(
        blocked["next_offset"], 1,
        "blocked source must not be skipped"
    );
    assert_eq!(blocked["oversized_block"], true);
    assert_eq!(
        blocked["oversized"],
        json!({"ordinal":1,"byte_offset":"<p>앞</p>".len(),"byte_count":giant.len()})
    );
    assert!(blocked.to_string().len() < 1024);
    // Existing external callers retain the whole-first-block contract.
    let legacy =
        ok(e.execute(json!({"op":"document_blocks","id":n["id"],"revision":1,"offset":1})));
    assert_eq!(legacy["blocks"][0]["html"], giant);
    assert_eq!(legacy["next_offset"], 2);
    let tail = ok(e.execute(
        json!({"op":"document_blocks","id":n["id"],"revision":1,"offset":2,"bounded":true}),
    ));
    assert_eq!(tail["blocks"][0]["html"], "<p>뒤</p>");
    assert_eq!(tail["next_offset"], Value::Null);
    let bad = e.execute(json!({"op":"document_blocks","id":n["id"],"bounded":1}));
    assert_eq!(bad["ok"], false);
}

fn verify_block_windows(
    e: &Engine,
    id: &Value,
    ordinal: usize,
    source: &str,
    block_start: usize,
    limit: usize,
) {
    let mut offset = 0;
    let mut joined = String::new();
    loop {
        let chunk = ok(e.execute(json!({"op":"document_block_window","id":id,"revision":1,"ordinal":ordinal,"offset":offset,"limit":limit})));
        assert_eq!(chunk["ready"], true);
        assert_eq!(chunk["block_byte_offset"], block_start);
        assert_eq!(chunk["total_bytes"], source.len());
        assert_eq!(chunk["offset"], offset);
        let raw = chunk["source"].as_str().unwrap();
        assert!(raw.len() <= limit);
        assert_eq!(raw, &source[offset..offset + raw.len()]);
        joined.push_str(raw);
        match chunk["next_offset"].as_u64() {
            Some(next) => {
                assert!(next as usize > offset);
                offset = next as usize;
            }
            None => break,
        }
    }
    assert_eq!(joined, source);
}

#[test]
fn raw_block_windows_are_bounded_lossless_and_utf8_safe_without_primary_body() {
    let db = Db::new();
    let e = db.open();
    let prefix = "<p>앞</p>";
    let small = "<table><tbody><tr><td>한😀&amp;\"\\\n</td></tr></tbody></table>";
    let giant = format!("<p>{}</p>", "한😀&amp;\"\\\n".repeat(50000));
    let n = save(&e, &format!("{prefix}{small}{giant}"));
    wait(&e);
    e.connection()
        .execute_batch("DROP TABLE notes_body")
        .unwrap();
    for limit in [4, 5, 7, 17] {
        verify_block_windows(&e, &n["id"], 1, small, prefix.len(), limit);
    }
    verify_block_windows(&e, &n["id"], 2, &giant, prefix.len() + small.len(), 65536);
    let eof = ok(e.execute(json!({"op":"document_block_window","id":n["id"],"revision":1,"ordinal":2,"offset":giant.len()})));
    assert_eq!(eof["source"], "");
    assert_eq!(eof["next_offset"], Value::Null);
    for extra in [
        json!({"offset":4}),
        json!({"offset":giant.len()+1}),
        json!({"offset":-1}),
        json!({"offset":18446744073709551615u64}),
        json!({"limit":3}),
        json!({"limit":65537}),
        json!({"limit":false}),
        json!({"ordinal":-1}),
        json!({"ordinal":3}),
        json!({"revision":2}),
    ] {
        let mut req = json!({"op":"document_block_window","id":n["id"],"revision":1,"ordinal":2});
        req.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert_eq!(e.execute(req)["ok"], false, "{extra}");
    }
    let missing = e.execute(json!({"op":"document_block_window","id":n["id"],"ordinal":2}));
    assert_eq!(missing["ok"], false);
}

#[test]
fn raw_windows_reject_stale_revisions_and_wait_for_matching_index() {
    let db = Db::new();
    let e = db.open();
    let n = save(&e, "<p>한😀</p>");
    wait(&e);
    let lock = Connection::open(db.dir.join("notes.db.search")).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    ok(e.execute(json!({"op":"save","note":{"id":n["id"],"revision":1,"title":"새 제목","content":"<p>바뀜😀</p>","text":"바뀜😀"}})));
    let stale =
        e.execute(json!({"op":"document_block_window","id":n["id"],"revision":1,"ordinal":0}));
    assert_eq!(stale["ok"], false);
    assert!(stale["error"].as_str().unwrap().starts_with("conflict:"));
    let pending =
        ok(e.execute(json!({"op":"document_block_window","id":n["id"],"revision":2,"ordinal":0})));
    assert_eq!(pending["ready"], false);
    assert_eq!(pending["source"], Value::Null);
    lock.execute_batch("COMMIT").unwrap();
    wait(&e);
    let fresh =
        ok(e.execute(json!({"op":"document_block_window","id":n["id"],"revision":2,"ordinal":0})));
    assert_eq!(fresh["source"], "<p>바뀜😀</p>");
    let text = ok(e.execute(json!({"op":"save","note":{"title":"원문","content_format":"markdown","content":"한글","text":"한글"}})));
    assert_eq!(
        e.execute(json!({"op":"document_block_window","id":text["id"],"revision":1,"ordinal":0}))
            ["ok"],
        false
    );
}

#[cfg(feature = "encrypted-storage")]
#[test]
fn encrypted_block_windows_preserve_exact_source_across_reopen() {
    let db = Db::new();
    let key = || inkism_engine::storage::StorageKey::from_bytes([0x42; 32]);
    let e = Engine::open_encrypted(&db.path, key()).unwrap();
    let source = format!("<p>{}</p>", "한글😀&amp;".repeat(50000));
    let n = save(&e, &source);
    wait(&e);
    let blocked = ok(e.execute(json!({"op":"document_blocks","id":n["id"],"bounded":true})));
    assert_eq!(blocked["blocks"], json!([]));
    assert_eq!(blocked["oversized_block"], true);
    verify_block_windows(&e, &n["id"], 0, &source, 0, 65536);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":n["id"]})))["content"],
        source
    );
    drop(e);
    let e = Engine::open_encrypted(&db.path, key()).unwrap();
    verify_block_windows(&e, &n["id"], 0, &source, 0, 65536);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":n["id"]})))["content"],
        source
    );
}

#[test]
fn large_literal_paragraph_splice_preserves_text_history_and_unvisited_source() {
    let db = Db::new();
    let e = db.open();
    let count = 100_000;
    let html: String = (0..count).map(|i| format!("<p>한글 {i} 😀</p>")).collect();
    let original_text = (0..count)
        .map(|i| format!("한글 {i} 😀"))
        .collect::<Vec<_>>()
        .join("\n");
    let original = ok(e.execute(
        json!({"op":"save","note":{"title":"대형 문단","content":html,"text":original_text}}),
    ));
    wait(&e);
    let expected = "<p>한글 50000 😀</p>";
    let replacement = "<p>한글 바뀜 😀</p><p>새 문단</p>";
    let start = html.find(expected).unwrap();
    let reply = ok(e.execute(
        json!({"op":"document_splice_html","id":original["id"],"revision":1,
        "content":{"start":start,"expected":expected,"replacement":replacement}}),
    ));
    assert_eq!(reply["revision"], 2);
    let saved = ok(e.execute(json!({"op":"get","id":original["id"]})));
    assert_eq!(saved["content"], html.replacen(expected, replacement, 1));
    assert_eq!(
        saved["text"],
        original_text.replacen("한글 50000 😀", "한글 바뀜 😀\n새 문단", 1)
    );
    assert_eq!(
        reply["text_stats"]["chars"],
        saved["text"].as_str().unwrap().encode_utf16().count()
    );
    assert_eq!(
        ok(e.execute(json!({"op":"revision_body","id":original["id"],"revision":1})))["content"],
        html
    );
    wait(&e);
    let tail = ok(e.execute(
        json!({"op":"document_blocks","id":original["id"],"revision":2,"offset":100000,"limit":1}),
    ));
    assert_eq!(tail["total_blocks"], 100001);
    assert_eq!(tail["blocks"][0]["html"], "<p>한글 99999 😀</p>");
    let history = ok(e.execute(json!({"op":"history","id":original["id"]})));
    let restored =
        ok(e.execute(json!({"op":"restore","id":original["id"],"history_id":history[0]["id"]})));
    assert_eq!(restored["content"], original["content"]);
    assert_eq!(restored["text"], original["text"]);
    drop(e);
    let reopened = db.open();
    let again = ok(reopened.execute(json!({"op":"get","id":original["id"]})));
    assert_eq!(again["content"], html);
    assert_eq!(again["text"], original_text);
}

#[test]
fn pages_100000_blocks_without_reading_primary_body() {
    let db = Db::new();
    let e = db.open();
    let html = (0..100_000)
        .map(|i| format!("<p><strong>한글 {i}</strong></p>\n"))
        .collect::<String>();
    let n = save(&e, &html);
    wait(&e);
    let started = std::time::Instant::now();
    let page=ok(e.execute(json!({"op":"document_blocks","id":n["id"],"revision":n["revision"],"offset":99_900,"limit":64})));
    assert_eq!(page["ready"], true);
    assert_eq!(page["total_blocks"], 100_000);
    assert_eq!(page["total_bytes"], html.len());
    assert_eq!(page["blocks"].as_array().unwrap().len(), 64);
    assert!(page["blocks"][0]["html"]
        .as_str()
        .unwrap()
        .contains("한글 99900"));
    assert_eq!(page["next_offset"], 99_964);
    eprintln!(
        "100k-block page: {:?}, {} response bytes",
        started.elapsed(),
        page.to_string().len()
    );
    assert!(page.to_string().len() < 16_000);
    let found =
        ok(e.execute(json!({"op":"document_find","id":n["id"],"revision":1,"query":"한글 99999"})));
    assert_eq!(found["items"][0]["ordinal"], 99_999);
    // A dropped primary body table makes any accidental whole-body read fail.
    // This disposable test DB deliberately bypasses the public write API.
    e.connection()
        .execute_batch("DROP TABLE notes_body")
        .unwrap();
    let tail =
        ok(e.execute(json!({"op":"document_blocks","id":n["id"],"offset":99_999,"limit":64,"include_summary":true})));
    assert_eq!(tail["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(tail["next_offset"], Value::Null);
    assert_eq!(tail["summary"]["id"], n["id"]);
    assert_eq!(tail["summary"]["revision"], tail["revision"]);
    assert!(tail["summary"].get("content").is_none());
    assert!(tail["summary"].get("text").is_none());
    let start = tail["blocks"][0]["byte_offset"].as_u64().unwrap() as usize;
    assert_eq!(&html[start..], tail["blocks"][0]["html"].as_str().unwrap());
    assert!(tail["blocks"][0]["html"]
        .as_str()
        .unwrap()
        .contains("99999"));
}

#[test]
fn large_rich_paragraph_edit_preserves_entities_whitespace_search_history_and_restart() {
    let db = Db::new();
    let e = db.open();
    let count = 100_000;
    let html: String = (0..count).map(|n|
        format!("<p><strong>한글 {n} 😀</strong> &amp; <a href=\"https://example.invalid\">링크</a><br>끝 </p>")).collect();
    // The final document trim removes only the very last paragraph's space;
    // spaces before other paragraph boundaries must remain in derived text.
    let text = (0..count)
        .map(|n| format!("한글 {n} 😀 & 링크\n끝 "))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    let original = ok(
        e.execute(json!({"op":"save", "note":{"title":"대형 서식", "content":html,"text":text}}))
    );
    let expected = "<p><strong>한글 50000 😀</strong> &amp; <a href=\"https://example.invalid\">링크</a><br>끝 </p>";
    let replacement = "<p><em>서식바뀜 😀</em> &lt;끝&gt; </p><h2><span>새 문단</span></h2>";
    let reply = ok(e.execute(json!({"op":"document_splice_html","id":original["id"],"revision":1,
        "content":{"start":html.find(expected).unwrap(),"expected":expected,"replacement":replacement}})));
    let changed_html = html.replacen(expected, replacement, 1);
    let changed_text = text.replacen("한글 50000 😀 & 링크\n끝 ", "서식바뀜 😀 <끝> \n새 문단", 1);
    let saved = ok(e.execute(json!({"op":"get","id":original["id"]})));
    assert_eq!(saved["content"], changed_html);
    assert_eq!(saved["text"], changed_text);
    assert_eq!(
        reply["text_stats"]["chars"],
        changed_text.encode_utf16().count()
    );
    assert_eq!(
        reply["text_stats"]["words"],
        changed_text.split_whitespace().count()
    );
    assert_eq!(
        ok(e.execute(json!({"op":"revision_body","id":original["id"],"revision":1})))["content"],
        html
    );
    wait(&e);
    let page = ok(e.execute(
        json!({"op":"document_blocks","id":original["id"],"revision":2,"offset":100000,"limit":1}),
    ));
    assert_eq!(page["total_blocks"], 100001);
    assert!(page["blocks"][0]["html"]
        .as_str()
        .unwrap()
        .contains("한글 99999 😀"));
    let found = ok(e.execute(json!({"op":"list","view":"all","query":"서식바뀜"})));
    assert_eq!(found["items"][0]["id"], original["id"]);
    let history = ok(e.execute(json!({"op":"history","id":original["id"]})));
    let restored =
        ok(e.execute(json!({"op":"restore","id":original["id"],"history_id":history[0]["id"]})));
    assert_eq!(restored["content"], html);
    assert_eq!(restored["text"], text);
    drop(e);
    let reopened = db.open();
    let restored = ok(reopened.execute(json!({"op":"get","id":original["id"]})));
    assert_eq!(restored["content"], html);
    assert_eq!(restored["text"], text);
}

#[test]
fn old_revision_never_mixes_with_new_content_and_cache_is_rebuildable() {
    let db = Db::new();
    let e = db.open();
    let html = "<p>첫 문단</p>\n<details><summary>제목</summary><div><p>본문</p></div></details>\n";
    let n = save(&e, html);
    wait(&e);
    let first = ok(e.execute(json!({"op":"document_blocks","id":n["id"],"limit":1})));
    assert_eq!(first["blocks"][0]["html"], "<p>첫 문단</p>");
    let lock = Connection::open(format!("{}.search", db.path)).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let changed=ok(e.execute(json!({"op":"save","note":{"id":n["id"],"revision":n["revision"],"content":"<p>수정됨</p><p>새 본문</p>","text":"수정됨 새 본문"}})));
    let stale =
        e.execute(json!({"op":"document_blocks","id":n["id"],"revision":n["revision"],"offset":1}));
    assert_eq!(stale["ok"], false);
    assert!(stale["error"].as_str().unwrap().contains("conflict"));
    let pending = ok(e.execute(json!({"op":"document_blocks","id":n["id"]})));
    assert_eq!(pending["ready"], false);
    assert_eq!(pending["revision"], changed["revision"]);
    assert_eq!(pending["blocks"], json!([]));
    lock.execute_batch("ROLLBACK").unwrap();
    drop(lock);
    wait(&e);
    let now =
        ok(e.execute(json!({"op":"document_blocks","id":n["id"],"revision":changed["revision"]})));
    assert_eq!(now["blocks"][0]["html"], "<p>수정됨</p>");
    assert_eq!(now["total_blocks"], 2);
    drop(e);
    // Simulate the previous cache schema: opening upgrades and queues old notes.
    let old = Connection::open(format!("{}.search", db.path)).unwrap();
    old.execute_batch(
        "DROP TABLE document_blocks; DROP TABLE document_layout; PRAGMA user_version=1;",
    )
    .unwrap();
    drop(old);
    let e = db.open();
    wait(&e);
    let rebuilt = ok(e.execute(json!({"op":"document_blocks","id":n["id"]})));
    assert_eq!(rebuilt["ready"], true);
    assert_eq!(rebuilt["blocks"], now["blocks"]);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":n["id"]})))["content"],
        "<p>수정됨</p><p>새 본문</p>"
    );
    ok(e.execute(json!({"op":"patch","id":n["id"],"changes":{"trashed":true}})));
    ok(e.execute(json!({"op":"delete","id":n["id"]})));
    assert_eq!(
        e.execute(json!({"op":"document_blocks","id":n["id"]}))["ok"],
        false
    );
    wait(&e);
    let count: i64 = e
        .query_connection()
        .query_row(
            "SELECT COUNT(*) FROM searchidx.document_blocks WHERE note_id=?1",
            params![n["id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn page_limits_opaque_source_and_byte_budget_preserve_progress() {
    let db = Db::new();
    let e = db.open();
    let html = format!("<p>{}</p><p>끝</p>", "가".repeat(200_000));
    let n = save(&e, &html);
    wait(&e);
    let page = ok(e.execute(json!({"op":"document_blocks","id":n["id"]})));
    assert_eq!(page["oversized_block"], true);
    assert_eq!(page["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(page["next_offset"], 1);
    let tail = ok(e.execute(json!({"op":"document_blocks","id":n["id"],"offset":1})));
    assert_eq!(
        format!(
            "{}{}",
            page["blocks"][0]["html"].as_str().unwrap(),
            tail["blocks"][0]["html"].as_str().unwrap()
        ),
        html
    );
    for args in [
        json!({"limit":0}),
        json!({"limit":257}),
        json!({"offset":-1}),
        json!({"offset":1.5}),
        json!({"revision":null}),
        json!({"revision":-1}),
    ] {
        let mut req = args;
        req["op"] = json!("document_blocks");
        req["id"] = n["id"].clone();
        assert_eq!(e.execute(req)["ok"], false);
    }
    let raw = "before <p>한글<script>if(a<b){}</script></p> after";
    let opaque = save(&e, raw);
    wait(&e);
    let page = ok(e.execute(json!({"op":"document_blocks","id":opaque["id"]})));
    assert_eq!(page["total_blocks"], 1);
    assert_eq!(page["blocks"][0]["html"], raw);
}

#[test]
fn splice_missing_body_never_creates_a_false_history_or_commits_metadata() {
    let db = Db::new();
    let e = db.open();
    let n = save(&e, "<p>사라진 본문😀</p>");
    wait(&e);
    let id = n["id"].as_str().unwrap();
    e.connection()
        .execute("DELETE FROM notes_body WHERE note_id=?1", [id])
        .unwrap();
    let before = ok(e.execute(json!({"op":"get","id":id})));
    let reply = e.execute(
        json!({"op":"document_splice_html","id":id,"revision":n["revision"],
        "content":{"start":0,"expected":"","replacement":"<p>복구한 것처럼 저장하지 않음</p>"},
        "metadata":{"title":"덮어쓰기 금지","notebook_id":null,"tags":[]}}),
    );
    assert_eq!(
        reply["ok"], false,
        "missing body must not be treated as a valid empty baseline"
    );
    assert!(reply["error"]
        .as_str()
        .unwrap()
        .contains("missing note body"));
    assert_eq!(ok(e.execute(json!({"op":"get","id":id}))), before);
    assert_eq!(ok(e.execute(json!({"op":"history","id":id}))), json!([]));
    assert_eq!(ok(e.execute(json!({"op":"index_status"})))["pending"], 0);
    for table in ["notes_body", "history_seq"] {
        assert_eq!(
            e.connection()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn splice_is_atomic_revision_checked_and_preserves_history() {
    let db = Db::new();
    let e = db.open();
    let n = ok(e.execute(json!({"op":"save","note":{"title":"부분 저장","content":"<p>앞</p><p>한글</p><p>뒤</p>","text":"앞\n\n한글\n\n뒤"}})));
    let request = json!({"op":"document_splice","id":n["id"],"revision":1,
        "content":{"start":"<p>앞</p>".len(),"expected":"<p>한글</p>","replacement":"<p><strong>수정</strong></p>"},
        "text":{"start":"앞\n\n".len(),"expected":"한글","replacement":"수정"}});
    // A valid HTML change paired with a bad text range must change nothing.
    for bad_text in [
        json!({"start":1,"expected":"","replacement":"x"}),
        json!({"start":5,"expected":"다름","replacement":"x"}),
        json!({"start":999,"expected":"","replacement":"x"}),
        json!({"start":-1,"expected":"","replacement":"x"}),
    ] {
        let mut bad = request.clone();
        bad["text"] = bad_text;
        assert_eq!(e.execute(bad)["ok"], false);
        assert_eq!(ok(e.execute(json!({"op":"get","id":n["id"]}))), n);
        assert_eq!(
            ok(e.execute(json!({"op":"history","id":n["id"]})))
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }
    let saved = ok(e.execute(request.clone()));
    assert_eq!(saved["revision"], 2);
    assert!(saved.get("content").is_none());
    assert!(saved.get("text").is_none());
    assert_eq!(e.execute(request)["ok"], false);
    let fresh = ok(e.execute(json!({"op":"get","id":n["id"]})));
    assert_eq!(
        fresh["content"],
        "<p>앞</p><p><strong>수정</strong></p><p>뒤</p>"
    );
    assert_eq!(fresh["text"], "앞\n\n수정\n\n뒤");
    wait(&e);
    let page = ok(e.execute(json!({"op":"document_blocks","id":n["id"],"revision":2})));
    assert_eq!(page["total_blocks"], 3);
    assert_eq!(page["blocks"][1]["html"], "<p><strong>수정</strong></p>");
    let history = ok(e.execute(json!({"op":"history","id":n["id"]})));
    let restored =
        ok(e.execute(json!({"op":"restore","id":n["id"],"history_id":history[0]["id"]})));
    assert_eq!(restored["content"], n["content"]);
    assert_eq!(restored["text"], n["text"]);
    // Missing revisions cannot silently overwrite; no-ops don't add history.
    let noop = json!({"op":"document_splice","id":n["id"],"revision":3,
        "content":{"start":0,"expected":"","replacement":""},
        "text":{"start":0,"expected":"","replacement":""}});
    assert_eq!(ok(e.execute(noop.clone()))["revision"], 3);
    let mut missing = noop;
    missing.as_object_mut().unwrap().remove("revision");
    assert_eq!(e.execute(missing)["ok"], false);
    drop(e);
    let reopened = db.open();
    assert_eq!(
        ok(reopened.execute(json!({"op":"get","id":n["id"]})))["content"],
        n["content"]
    );
}

#[test]
fn v2_cache_upgrade_invalidates_offsets_and_rebuilds_losslessly() {
    let db = Db::new();
    let e = db.open();
    let html = "<!-- 앞 --> <p>한글😀</p>\n<p><em>둘째</em></p>\n<!-- 끝 -->";
    let n = save(&e, html);
    wait(&e);
    drop(e);
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    cache
        .execute_batch(
            "DROP INDEX idx_document_block_position; ALTER TABLE document_blocks DROP COLUMN byte_offset; PRAGMA user_version=2;",
        )
        .unwrap();
    inkism_engine::schema::init_search(&cache).unwrap();
    let count: i64 = cache
        .query_row("SELECT COUNT(*) FROM document_layout", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        count, 0,
        "old cache must not claim readiness with invalid offsets"
    );
    // Engine must also observe the old version and queue canonical notes.
    cache.execute_batch("PRAGMA user_version=2").unwrap();
    drop(cache);
    let e = db.open();
    wait(&e);
    let page = ok(e.execute(json!({"op":"document_blocks","id":n["id"],"include_summary":true})));
    assert_eq!(page["ready"], true);
    assert_eq!(page["summary"]["title"], n["title"]);
    let mut next_byte = 0;
    for block in page["blocks"].as_array().unwrap() {
        let start = block["byte_offset"].as_u64().unwrap() as usize;
        let fragment = block["html"].as_str().unwrap();
        assert_eq!(start, next_byte);
        assert_eq!(&html[start..start + fragment.len()], fragment);
        next_byte += fragment.len();
    }
    assert_eq!(next_byte, html.len());
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":n["id"]})))["content"],
        html
    );
    assert_eq!(
        e.execute(json!({"op":"document_blocks","id":n["id"],"include_summary":"yes"}))["ok"],
        false
    );
    let lock = Connection::open(format!("{}.search", db.path)).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let updated =
        ok(e.execute(json!({"op":"save","note":{"id":n["id"],"revision":1,"title":"새 제목"}})));
    let pending =
        ok(e.execute(json!({"op":"document_blocks","id":n["id"],"include_summary":true})));
    assert_eq!(pending["ready"], false);
    assert_eq!(pending["summary"]["title"], "새 제목");
    assert_eq!(pending["summary"]["revision"], updated["revision"]);
    assert_eq!(pending["blocks"], json!([]));
    lock.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn html_only_splice_derives_search_text_and_restores_original_history() {
    let db = Db::new();
    let e = db.open();
    let html = "<p>앞 &amp; 😀</p><details><summary>제목</summary><div><p>접힌본문</p></div></details><p>뒤</p>";
    let n = ok(e.execute(json!({"op":"save","note":{"title":"구간 편집","content":html,"text":"이전 가져오기 방식의 텍스트"}})));
    wait(&e);
    let page = ok(e.execute(json!({"op":"document_blocks","id":n["id"],"offset":1,"limit":1})));
    let block = &page["blocks"][0];
    let replacement =
        "<details><summary>제목</summary><div><p>새로운검색어 &lt;한글&gt;</p></div></details>";
    let req = json!({"op":"document_splice_html","id":n["id"],"revision":1,
        "content":{"start":block["byte_offset"],"expected":block["html"],"replacement":replacement}});
    let lock = Connection::open(format!("{}.search", db.path)).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let saved = ok(e.execute(req.clone()));
    assert_eq!(saved["revision"], 2);
    assert!(saved.get("content").is_none());
    assert!(saved.get("text").is_none());
    assert_eq!(e.execute(req)["ok"], false);
    lock.execute_batch("ROLLBACK").unwrap();
    let fresh = ok(e.execute(json!({"op":"get","id":n["id"]})));
    assert_eq!(
        fresh["content"],
        format!("<p>앞 &amp; 😀</p>{replacement}<p>뒤</p>")
    );
    assert_eq!(fresh["text"], "앞 & 😀\n제목\n새로운검색어 <한글>\n뒤");
    wait(&e);
    let found = ok(e.execute(json!({"op":"list","view":"all","query":"새로운검색어"})));
    assert_eq!(found["items"][0]["id"], n["id"]);
    let history = ok(e.execute(json!({"op":"history","id":n["id"]})));
    let restored =
        ok(e.execute(json!({"op":"restore","id":n["id"],"history_id":history[0]["id"]})));
    assert_eq!(restored["content"], html);
    assert_eq!(restored["text"], n["text"]);
}

#[test]
fn document_find_searches_derived_text_without_canonical_body() {
    let db = Db::new();
    let e = db.open();
    let html = "<p><strong>한글</strong>연결 &amp; 😀</p><details><summary>접기</summary><div><p>숨은검색 ÄBC</p></div></details><p>literal %_[]</p><p>둘째 숨은검색 äbc</p>";
    let n = save(&e, html);
    wait(&e);
    let query = |q: &str, extra: Value| {
        let mut request = json!({"op":"document_find","id":n["id"],"revision":1,"query":q});
        request
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        e.execute(request)
    };
    assert_eq!(
        ok(query("한글연결 & 😀", json!({})))["items"][0]["ordinal"],
        0
    );
    let first = ok(query("숨은검색", json!({"limit":1})));
    assert_eq!(first["items"][0]["ordinal"], 1);
    assert_eq!(first["next_offset"], 2);
    let last = ok(query("숨은검색", json!({"limit":1,"offset":2})));
    assert_eq!(last["items"][0]["ordinal"], 3);
    assert_eq!(last["next_offset"], Value::Null);
    assert_eq!(
        ok(query("äbc", json!({})))["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        ok(query("äbc", json!({"case_sensitive":true})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(ok(query("%_[]", json!({})))["items"][0]["ordinal"], 2);
    for extra in [
        json!({"limit":0}),
        json!({"limit":65}),
        json!({"offset":-1}),
        json!({"revision":0}),
        json!({"revision":2}),
        json!({"case_sensitive":"true"}),
    ] {
        assert_eq!(query("검색", extra)["ok"], false);
    }
    assert_eq!(query("", json!({}))["ok"], false);
    e.connection()
        .execute_batch("DROP TABLE notes_body")
        .unwrap();
    let cached = ok(query("숨은검색", json!({})));
    assert_eq!(cached["ready"], true);
    assert_eq!(cached["items"].as_array().unwrap().len(), 2);
}

#[test]
fn document_find_rejects_stale_cache_and_v3_upgrade_rebuilds_text() {
    let db = Db::new();
    let e = db.open();
    let n = save(&e, "<p>이전검색어</p>");
    wait(&e);
    drop(e);
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    cache.execute_batch("ALTER TABLE document_blocks DROP COLUMN search_text; ALTER TABLE document_blocks DROP COLUMN search_folded; PRAGMA user_version=3;").unwrap();
    drop(cache);
    let e = db.open();
    wait(&e);
    let request = json!({"op":"document_find","id":n["id"],"revision":1,"query":"이전검색어"});
    assert_eq!(ok(e.execute(request.clone()))["items"][0]["ordinal"], 0);
    let lock = Connection::open(format!("{}.search", db.path)).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    ok(e.execute(
        json!({"op":"save","note":{"id":n["id"],"revision":1,"content":"<p>새검색어</p>"}}),
    ));
    assert_eq!(e.execute(request)["ok"], false);
    let fresh = json!({"op":"document_find","id":n["id"],"revision":2,"query":"새검색어"});
    let pending = ok(e.execute(fresh.clone()));
    assert_eq!(pending["ready"], false);
    assert_eq!(pending["items"], json!([]));
    lock.execute_batch("ROLLBACK").unwrap();
    wait(&e);
    assert_eq!(ok(e.execute(fresh))["items"][0]["ordinal"], 0);
}

#[test]
fn metadata_patch_avoids_body_reads_and_checks_revision() {
    let db = Db::new();
    let e = db.open();
    let n = save(&e, "<p>보존할 본문</p>");
    wait(&e);
    let req = json!({"op":"patch","id":n["id"],"revision":1,"summary_only":true,
        "changes":{"favorite":true}});
    let result = ok(e.execute(req.clone()));
    assert_eq!(result["favorite"], true);
    assert_eq!(result["revision"], 2);
    assert!(result.get("content").is_none());
    assert!(result.get("text").is_none());
    assert_eq!(e.execute(req)["ok"], false);
    let fresh = ok(e.execute(json!({"op":"get","id":n["id"]})));
    assert_eq!(fresh["content"], n["content"]);
    assert_eq!(fresh["revision"], 2);
    for extra in [
        json!({"revision":0}),
        json!({"revision":"2"}),
        json!({"summary_only":"yes"}),
    ] {
        let mut bad = json!({"op":"patch","id":n["id"],"changes":{"pinned":true}});
        bad.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert_eq!(e.execute(bad)["ok"], false);
    }
    // Legacy clients still receive complete notes when not asking for a summary.
    let legacy = ok(e.execute(json!({"op":"patch","id":n["id"],"changes":{"pinned":true}})));
    assert_eq!(legacy["content"], n["content"]);
    wait(&e);
    // A missing body table makes any foreground body SELECT fail. Metadata-only
    // writes must still work; background reindex failures are unrelated here.
    e.connection()
        .execute_batch("DROP TABLE notes_body")
        .unwrap();
    let summary = ok(e.execute(json!({"op":"patch","id":n["id"],"revision":3,
        "summary_only":true,"changes":{"archived":true}})));
    assert_eq!(summary["archived"], true);
    assert_eq!(summary["revision"], 4);
}

#[test]
fn html_splice_returns_small_text_counts_including_noop() {
    let db = Db::new();
    let e = db.open();
    let n = save(&e, "<p>앞</p>");
    let reply = ok(e.execute(
        json!({"op":"document_splice_html","id":n["id"],"revision":1,
        "content":{"start":0,"expected":"<p>앞</p>","replacement":"<p>한글 😀 &amp; 끝</p>"}}),
    ));
    assert_eq!(reply["text_stats"], json!({"words":4,"chars":9}));
    assert!(reply.get("text").is_none());
    let no_op = ok(e.execute(
        json!({"op":"document_splice_html","id":n["id"],"revision":2,
        "content":{"start":0,"expected":"","replacement":""}}),
    ));
    assert_eq!(no_op["text_stats"], reply["text_stats"]);
    assert_eq!(no_op["revision"], 2);
}

#[test]
fn title_patch_preserves_body_history_preview_and_nullable_metadata() {
    let db = Db::new();
    let e = db.open();
    let nb = ok(e.execute(json!({"op":"save_notebook","name":"제목 변경"})));
    let n = ok(e.execute(json!({"op":"save","note":{"title":"이전 제목","content":"<p>정본</p>","text":"정본","notebook_id":nb["id"]}})));
    let reply = ok(e.execute(
        json!({"op":"patch","id":n["id"],"revision":1,"summary_only":true,
        "changes":{"title":"새 제목","notebook_id":null,"color":null,"tags":["태그"]}}),
    ));
    assert_eq!(reply["title"], "새 제목");
    assert_eq!(reply["preview"], "정본");
    assert_eq!(reply["notebook_id"], Value::Null);
    assert_eq!(reply["tags"], json!(["태그"]));
    let fresh = ok(e.execute(json!({"op":"get","id":n["id"]})));
    assert_eq!(fresh["content"], n["content"]);
    assert_eq!(fresh["text"], n["text"]);
    let history = ok(e.execute(json!({"op":"history","id":n["id"]})));
    let entries = history.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["title"], "이전 제목");
    let restored =
        ok(e.execute(json!({"op":"restore","id":n["id"],"history_id":entries[0]["id"]})));
    assert_eq!(restored["title"], "이전 제목");
    assert_eq!(restored["content"], n["content"]);
    let blank =
        ok(e.execute(json!({"op":"save","note":{"title":"제목만","content":"","text":""}})));
    let changed = ok(e.execute(json!({"op":"patch","id":blank["id"],"revision":1,"summary_only":true,"changes":{"title":"새 미리보기"}})));
    assert_eq!(changed["preview"], ""); // empty body: no title echo in the preview
    for request in [
        json!({"op":"patch","id":blank["id"],"changes":{"title":"버전 없음"}}),
        json!({"op":"patch","id":blank["id"],"revision":2,"changes":{"title":null}}),
        json!({"op":"patch","id":blank["id"],"revision":1,"changes":{"title":"이전 버전"}}),
    ] {
        assert_eq!(e.execute(request)["ok"], false);
    }
    let after = ok(e.execute(json!({"op":"get","id":blank["id"]})));
    assert_eq!(after["revision"], 2);
    assert_eq!(after["title"], "새 미리보기");
}

#[test]
fn html_splice_and_metadata_commit_or_rollback_together() {
    let db = Db::new();
    let e = db.open();
    let n = save(&e, "<p>이전 본문</p>");
    let request = json!({"op":"document_splice_html","id":n["id"],"revision":1,
        "content":{"start":0,"expected":"<p>이전 본문</p>","replacement":"<p>새 본문</p>"},
        "metadata":{"title":"새 제목","notebook_id":null,"tags":["b","a","b"]}});
    e.connection().execute_batch("CREATE TRIGGER reject_meta BEFORE UPDATE OF title ON notes_meta BEGIN SELECT RAISE(ABORT,'metadata failure'); END;").unwrap();
    assert_eq!(e.execute(request.clone())["ok"], false);
    let unchanged = ok(e.execute(json!({"op":"get","id":n["id"]})));
    assert_eq!(unchanged, n);
    assert_eq!(
        ok(e.execute(json!({"op":"history","id":n["id"]}))),
        json!([])
    );
    e.connection()
        .execute_batch("DROP TRIGGER reject_meta")
        .unwrap();
    let result = ok(e.execute(request.clone()));
    assert_eq!(result["revision"], 2);
    assert_eq!(result["title"], "새 제목");
    assert_eq!(result["tags"], json!(["a", "b"]));
    assert_eq!(e.execute(request)["ok"], false);
    let fresh = ok(e.execute(json!({"op":"get","id":n["id"]})));
    assert_eq!(fresh["content"], "<p>새 본문</p>");
    assert_eq!(fresh["text"], "새 본문");
    let history = ok(e.execute(json!({"op":"history","id":n["id"]})));
    assert_eq!(history.as_array().unwrap().len(), 1);
    let restored =
        ok(e.execute(json!({"op":"restore","id":n["id"],"history_id":history[0]["id"]})));
    assert_eq!(restored["title"], n["title"]);
    assert_eq!(restored["content"], n["content"]);
    for metadata in [
        json!({"title":"누락","tags":[]}),
        json!({"title":"잘못됨","tags":[],"notebook_id":null,"content":"금지"}),
    ] {
        assert_eq!(
            e.execute(
                json!({"op":"document_splice_html","id":n["id"],"revision":restored["revision"],
            "content":{"start":0,"expected":"","replacement":""},"metadata":metadata})
            )["ok"],
            false
        );
    }
}

#[test]
fn document_info_never_reads_body_or_derived_blocks() {
    let db = Db::new();
    let e = db.open();
    let html = format!("<p>{}</p><p>마지막😀</p>", "한글😀".repeat(100_000));
    let note = save(&e, &html);
    wait(&e);
    // No body or block table remains available. Only metadata/layout may be read.
    e.connection()
        .execute_batch("DROP TABLE notes_body")
        .unwrap();
    let search = Connection::open(format!("{}.search", db.path)).unwrap();
    search.execute_batch("DROP TABLE document_blocks").unwrap();
    let manifest =
        ok(e.execute(json!({"op":"document_info","id":note["id"],"revision":note["revision"]})));
    assert_eq!(manifest["ready"], true);
    assert_eq!(manifest["total_blocks"], 2);
    assert_eq!(manifest["total_bytes"], html.len());
    assert_eq!(manifest["summary"]["id"], note["id"]);
    assert_eq!(manifest["summary"]["revision"], note["revision"]);
    assert!(manifest.get("blocks").is_none());
    assert!(manifest["summary"].get("content").is_none());
    assert!(manifest["summary"].get("text").is_none());
    assert!(serde_json::to_vec(&manifest).unwrap().len() < 2048);
}

#[test]
fn document_info_hides_stale_counts_and_validates_revision() {
    let db = Db::new();
    let e = db.open();
    let note = save(&e, "<p>원문</p>");
    wait(&e);
    let request = || json!({"op":"document_info","id":note["id"]});
    assert_eq!(ok(e.execute(request()))["ready"], true);
    let search = Connection::open(format!("{}.search", db.path)).unwrap();
    search
        .execute(
            "UPDATE document_layout SET revision=0,block_count=999,byte_count=999",
            [],
        )
        .unwrap();
    let stale = ok(e.execute(request()));
    assert_eq!(stale["ready"], false);
    assert_eq!(stale["total_blocks"], Value::Null);
    assert_eq!(stale["total_bytes"], Value::Null);
    assert_eq!(stale["summary"]["title"], "블록 검사");
    search.execute("DELETE FROM document_layout", []).unwrap();
    assert_eq!(ok(e.execute(request())), stale);
    for revision in [json!(-1), json!(1.5), json!("1"), Value::Null] {
        let mut req = request();
        req["revision"] = revision;
        assert_eq!(e.execute(req)["ok"], false);
    }
    let mut req = request();
    req["revision"] = json!(99);
    assert!(e.execute(req)["error"]
        .as_str()
        .unwrap()
        .contains("conflict"));
    assert_eq!(
        e.execute(json!({"op":"document_info","id":"missing"}))["ok"],
        false
    );
    assert_eq!(
        e.execute(json!({"op":"document_info","id":"bad id"}))["ok"],
        false
    );
}

#[test]
fn html_batch_applies_sequential_utf8_edits_in_one_revision_and_history() {
    let db = Db::new();
    let e = db.open();
    let a = "<p>앞😀</p>";
    let b = "<p>뒤</p>";
    let next_a = "<p><strong>앞😀 수정</strong></p>";
    let next_b = "<p>둘째 &amp; 마지막</p>";
    let note = save(&e, &format!("{a}{b}"));
    let req = json!({"op":"document_splice_html","id":note["id"],"revision":1,
        "edits":[
            {"start":0,"expected":a,"replacement":next_a},
            {"start":next_a.len(),"expected":b,"replacement":next_b}],
        "metadata":{"title":"여러 구간","notebook_id":null,"tags":["완료"]}});
    let reply = ok(e.execute(req.clone()));
    assert_eq!(reply["revision"], 2);
    assert_eq!(reply["title"], "여러 구간");
    assert!(reply.get("content").is_none());
    let saved = ok(e.execute(json!({"op":"get","id":note["id"]})));
    assert_eq!(saved["content"], format!("{next_a}{next_b}"));
    assert_eq!(saved["text"], "앞😀 수정\n둘째 & 마지막");
    assert_eq!(
        reply["text_stats"]["chars"],
        saved["text"]
            .as_str()
            .unwrap()
            .trim()
            .encode_utf16()
            .count()
    );
    let history = ok(e.execute(json!({"op":"history","id":note["id"]})));
    assert_eq!(history.as_array().unwrap().len(), 1);
    assert_eq!(e.execute(req)["ok"], false);
    wait(&e);
    let page = ok(e.execute(json!({"op":"document_blocks","id":note["id"],"revision":2})));
    assert_eq!(page["total_blocks"], 2);
    assert_eq!(page["blocks"][1]["html"], next_b);
    let restored =
        ok(e.execute(json!({"op":"restore","id":note["id"],"history_id":history[0]["id"]})));
    assert_eq!(restored["content"], note["content"]);
    assert_eq!(restored["title"], note["title"]);
}

#[test]
fn html_batch_failure_or_net_zero_preserves_note_history_and_index_queue() {
    let db = Db::new();
    let e = db.open();
    let original = "<p>한글😀</p>";
    let next = "<p>변경</p>";
    let note = save(&e, original);
    wait(&e);
    let req = json!({"op":"document_splice_html","id":note["id"],"revision":1,
        "edits":[{"start":0,"expected":original,"replacement":next},
                 {"start":0,"expected":"wrong","replacement":"failed"}]});
    assert_eq!(e.execute(req.clone())["ok"], false);
    let mut no_op = req.clone();
    no_op["edits"][1] = json!({"start":0,"expected":next,"replacement":original});
    assert_eq!(ok(e.execute(no_op))["revision"], 1);
    let mut tx_failure = req.clone();
    tx_failure["edits"] = json!([{"start":0,"expected":original,"replacement":next},
                                {"start":0,"expected":next,"replacement":"<p>완료</p>"}]);
    e.connection().execute_batch("CREATE TRIGGER fail_batch BEFORE UPDATE ON notes_meta BEGIN SELECT RAISE(ABORT,'batch failure'); END;").unwrap();
    assert_eq!(e.execute(tx_failure)["ok"], false);
    assert_eq!(ok(e.execute(json!({"op":"get","id":note["id"]}))), note);
    assert_eq!(
        ok(e.execute(json!({"op":"history","id":note["id"]}))),
        json!([])
    );
    assert_eq!(ok(e.execute(json!({"op":"index_status"})))["pending"], 0);
}

#[test]
fn html_batch_rejects_ambiguous_unbounded_and_invalid_ranges() {
    let db = Db::new();
    let e = db.open();
    let note = save(&e, "<p>😀</p>");
    let edit = json!({"start":0,"expected":"","replacement":""});
    let base = json!({"op":"document_splice_html","id":note["id"],"revision":1,"edits":[edit]});
    for edits in [
        json!([]),
        Value::Null,
        json!({}),
        json!(vec![edit.clone(); 129]),
        json!([{"start":4,"expected":"","replacement":"x"}]),
        json!([{"start":999,"expected":"","replacement":"x"}]),
        json!([{"start":0,"expected":"","replacement":"","extra":true}]),
    ] {
        let mut req = base.clone();
        req["edits"] = edits;
        assert_eq!(e.execute(req)["ok"], false);
    }
    for field in ["content", "text"] {
        let mut req = base.clone();
        req[field] = edit.clone();
        assert_eq!(e.execute(req)["ok"], false);
    }
    let mut paired = base.clone();
    paired["op"] = json!("document_splice");
    paired["text"] = edit.clone();
    assert_eq!(e.execute(paired)["ok"], false);
    let mut boundary = base;
    boundary["edits"] = json!(vec![edit; 128]);
    assert_eq!(ok(e.execute(boundary))["revision"], 1);
    assert_eq!(ok(e.execute(json!({"op":"get","id":note["id"]}))), note);
}

#[test]
fn revision_body_is_exact_and_survives_legacy_migration() {
    let db = Db::new();
    let e = db.open();
    let n = save(&e, "<p>기준😀</p>");
    let id = n["id"].clone();
    let request = json!({"op":"revision_body","id":id,"revision":1});
    assert_eq!(ok(e.execute(request.clone()))["content"], "<p>기준😀</p>");
    ok(
        e.execute(json!({"op":"document_splice_html","id":id,"revision":1,
        "edits":[{"start":3,"expected":"기준😀","replacement":"원격"}]})),
    );
    assert_eq!(ok(e.execute(request.clone()))["content"], "<p>기준😀</p>");
    assert_eq!(
        e.execute(json!({"op":"revision_body","id":id,"revision":999}))["ok"],
        false
    );
    assert_eq!(
        e.execute(json!({"op":"revision_body","id":id,"revision":0}))["ok"],
        false
    );
    drop(e);
    let c = Connection::open(&db.path).unwrap();
    c.execute_batch("ALTER TABLE history DROP COLUMN note_revision; PRAGMA user_version=1;")
        .unwrap();
    drop(c);
    let e = db.open();
    // Old snapshots cannot be assigned a guessed revision.
    assert_eq!(e.execute(request)["ok"], false);
    assert_eq!(
        ok(e.execute(json!({"op":"revision_body","id":id,"revision":2})))["content"],
        "<p>원격</p>"
    );
    assert_eq!(
        ok(e.execute(json!({"op":"history","id":id})))
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn metadata_revisions_reuse_blocks_and_edits_update_only_changed_blocks() {
    let db = Db::new();
    let e = db.open();
    let html = (0..10000)
        .map(|i| format!("<p>한글 {i} 😀</p>"))
        .collect::<String>();
    let started = std::time::Instant::now();
    let note = save(&e, &html);
    wait(&e);
    let initial = started.elapsed();
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    cache.execute_batch("CREATE TABLE block_write_audit(n INTEGER); INSERT INTO block_write_audit VALUES(0);
      CREATE TRIGGER audit_insert AFTER INSERT ON document_blocks BEGIN UPDATE block_write_audit SET n=n+1; END;
      CREATE TRIGGER audit_delete AFTER DELETE ON document_blocks BEGIN UPDATE block_write_audit SET n=n+1; END;
      CREATE TRIGGER audit_update AFTER UPDATE ON document_blocks BEGIN UPDATE block_write_audit SET n=n+1; END;").unwrap();
    let started = std::time::Instant::now();
    let updated = ok(
        e.execute(json!({"op":"patch","id":note["id"],"revision":1,"changes":{"favorite":true}}))
    );
    wait(&e);
    let metadata = started.elapsed();
    let writes: i64 = cache
        .query_row("SELECT n FROM block_write_audit", [], |r| r.get(0))
        .unwrap();
    assert_eq!(writes, 0, "unchanged HTML must not rewrite any block");
    let info =
        ok(e.execute(json!({"op":"document_info","id":note["id"],"revision":updated["revision"]})));
    assert_eq!(info["ready"], true);
    assert_eq!(info["total_blocks"], 10000);
    let changed = html.replacen("한글 0", "한글 X", 1);
    assert_eq!(changed.len(), html.len());
    ok(e.execute(json!({"op":"save","note":{"id":note["id"],"revision":updated["revision"],"content":changed}})));
    wait(&e);
    let writes: i64 = cache
        .query_row("SELECT n FROM block_write_audit", [], |r| r.get(0))
        .unwrap();
    assert_eq!(writes, 1, "only the edited block should be written");
    let page =
        ok(e.execute(json!({"op":"document_blocks","id":note["id"],"revision":3,"limit":1})));
    assert_eq!(page["blocks"][0]["html"], "<p>한글 X 😀</p>");
    let found =
        ok(e.execute(json!({"op":"document_find","id":note["id"],"revision":3,"query":"한글 X"})));
    assert_eq!(found["items"].as_array().unwrap().len(), 1);
    let tail = ok(e.execute(
        json!({"op":"document_blocks","id":note["id"],"revision":3,"offset":9999,"limit":1}),
    ));
    assert_eq!(tail["blocks"][0]["html"], "<p>한글 9999 😀</p>");
    eprintln!("10000 blocks: initial build {initial:?}; metadata revision {metadata:?}; metadata block writes 0");
}

#[test]
fn v4_cache_gets_content_identity_without_changing_canonical_body() {
    let db = Db::new();
    let e = db.open();
    let note = save(&e, "<p>캐시 업그레이드😀</p>");
    wait(&e);
    drop(e);
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    cache
        .execute_batch(
            "ALTER TABLE document_layout DROP COLUMN content_hash; PRAGMA user_version=4;",
        )
        .unwrap();
    drop(cache);
    let e = db.open();
    wait(&e);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":note["id"]})))["content"],
        note["content"]
    );
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    let size: i64 = cache
        .query_row(
            "SELECT length(content_hash) FROM document_layout WHERE note_id=?1",
            [note["id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(size, 32);
}

#[test]
fn v5_cache_upgrades_search_identity_and_keeps_search_results() {
    let db = Db::new();
    let e = db.open();
    let note=ok(e.execute(json!({"op":"save","note":{"title":"검색업그레이드","content":"<p>검색본문</p>","text":"검색본문"}})));
    wait(&e);
    drop(e);
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    cache
        .execute_batch("ALTER TABLE fts_map DROP COLUMN index_hash; PRAGMA user_version=5;")
        .unwrap();
    drop(cache);
    let e = db.open();
    wait(&e);
    let result = ok(e.execute(json!({"op":"list","view":"all","query":"검색본문"})));
    assert_eq!(result["items"][0]["id"], note["id"]);
    let cache = Connection::open(format!("{}.search", db.path)).unwrap();
    let bytes: i64 = cache
        .query_row(
            "SELECT length(index_hash) FROM fts_map WHERE note_id=?1",
            [note["id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bytes, 32);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":note["id"]})))["content"],
        note["content"]
    );
}
