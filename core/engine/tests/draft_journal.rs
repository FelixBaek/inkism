//! Crash draft journal: put/clear/status protocol behaviour, exact recovery
//! of complete and partial drafts after a simulated crash (Engine::open),
//! token-conditional clears, limit rejections and rollback on failure.

use inkism_engine::Engine;
use serde_json::{json, Value};

struct TempDb {
    dir: std::path::PathBuf,
    path: String,
}

impl TempDb {
    fn new(tag: &str) -> TempDb {
        let dir = std::env::temp_dir().join(format!(
            "inkism-draft-journal-{}-{}-{}",
            tag,
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        TempDb {
            path: dir.join("library.db").to_string_lossy().into_owned(),
            dir,
        }
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

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn status(e: &Engine) -> i64 {
    ok(e.execute(json!({"op":"draft_journal_status"})))["pending"]
        .as_i64()
        .unwrap()
}

fn put_req(token: &str, note_id: &str, format: &str, body: Value) -> Value {
    json!({"op":"draft_journal_put","token":token,
        "draft":{"format":"inkism-draft","version":1,
            "note":{"id":note_id,"title":"제목","notebook_id":null,"tags":[],
                "content_format":format},
            "body":body}})
}

fn complete_body(revision: i64, content: &str) -> Value {
    json!({"kind":"complete","revision":revision,"content":content})
}

fn partial_body(revision: i64, edits: Value) -> Value {
    json!({"kind":"partial","revision":revision,"offset_encoding":"utf-8",
        "edit_order":"sequential","edits":edits})
}

fn find_by_title<'a>(items: &'a [Value], title: &str) -> &'a Value {
    items
        .iter()
        .find(|item| item["title"] == json!(title))
        .unwrap_or_else(|| panic!("missing note titled {title} in {items:?}"))
}

#[test]
fn current_and_legacy_envelopes_recover_exactly() {
    for format in ["inkism-draft", "mindbox-draft"] {
        let t = TempDb::new("format-compat");
        let content = "\u{feff}<p>복구😀</p>\r\n";
        {
            let e = t.open();
            let mut req = put_req(&uuid(), &uuid(), "html", complete_body(0, content));
            req["draft"]["format"] = json!(format);
            assert_eq!(ok(e.execute(req))["saved"], true);
            assert_eq!(status(&e), 1);
        }
        let e = t.open();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all"})));
        let items = items["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        let note = ok(e.execute(json!({"op":"get","id":items[0]["id"]})));
        assert_eq!(note["content"], content);
    }
}

// ---- complete drafts: exact recovery of never-saved notes -------------------

#[test]
fn complete_drafts_recover_new_notes_exactly_and_reopen_is_idempotent() {
    let t = TempDb::new("complete");
    let token = uuid();
    let samples = [
        (
            "html",
            "\u{feff}<p>한글 🎉 첫 줄</p>\r\n<p>두 번째 <b>줄</b></p>",
        ),
        ("text", "\u{feff}일반 텍스트 🎉\r\n두번째 줄 CRLF 유지"),
        (
            "markdown",
            "# 한글 제목 🎉\r\n\r\n- 목록 **굵게**\r\n- 이모지 ✅",
        ),
    ];
    let mut draft_ids = Vec::new();
    {
        let e = t.open();
        for (format, content) in samples {
            let id = uuid();
            draft_ids.push(id.clone());
            let mut req = put_req(&token, &id, format, complete_body(0, content));
            req["draft"]["note"]["title"] = json!(format!("원본 제목 {format}"));
            req["draft"]["note"]["tags"] = json!(["복구", "crash-🚨"]);
            assert_eq!(ok(e.execute(req))["saved"], true);
        }
        assert_eq!(status(&e), 3);
        // The never-saved original does not exist yet.
        assert!(err(e.execute(json!({"op":"get","id":draft_ids[0]}))).contains("not_found"));
    }
    {
        // Crash restart: recovery runs at open, before the index worker.
        let e = t.open();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all","limit":100})))["items"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(items.len(), 3);
        for (i, (format, content)) in samples.iter().enumerate() {
            let item = find_by_title(&items, &format!("원본 제목 {format} (자동 복구)"));
            assert_eq!(item["content_format"], *format);
            let note = ok(e.execute(json!({"op":"get","id":item["id"]})));
            assert_eq!(note["content"], *content, "byte-exact body for {format}");
            assert_eq!(note["revision"], 1);
            assert_eq!(note["tags"], json!(["crash-🚨", "복구"]));
            assert!(note["notebook_id"].is_null());
            // The original never-saved id stays absent; the copy is separate.
            assert!(err(e.execute(json!({"op":"get","id":draft_ids[i]}))).contains("not_found"));
        }
        drop(e);
        // Reopening again recovers nothing and duplicates nothing.
        let e = t.open();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all","limit":100})))["items"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(items.len(), 3);
    }
}

// ---- partial drafts: sequential UTF-8 edits + baseline preservation ---------

#[test]
fn partial_draft_replays_utf8_edits_after_history_expiry() {
    let t = TempDb::new("partial-history");
    let token = uuid();
    let note_id = uuid();
    let baseline = "<p>가나다 라바사 ABC 🎉</p>";
    let after1 = baseline.replacen("가나다", "가나다라마바사", 1);
    let final_content = after1.replacen("🎉", "🇰🇷🎯", 1);
    let notebook;
    {
        let e = t.open();
        notebook = ok(e.execute(json!({"op":"save_notebook","name":"노트북"})))["id"]
            .as_str()
            .unwrap()
            .to_string();
        ok(
            e.execute(json!({"op":"save","note":{"id":note_id,"title":"부분 편집",
            "notebook_id":notebook,"tags":["기준"],"content":baseline,
            "text":"가나다 라바사 ABC 🎉"}})),
        );
        // Move the note on so the draft baseline is a HISTORICAL revision.
        ok(
            e.execute(json!({"op":"save","note":{"id":note_id,"revision":1,
            "content":"<p>rev2 내용</p>","text":"rev2 내용"}})),
        );
        ok(e.execute(json!({"op":"wait_index","timeout_ms":10000})));
        let edits = json!([
            {"start":baseline.find("가나다").unwrap(),"expected":"가나다",
             "replacement":"가나다라마바사"},
            {"start":after1.find("🎉").unwrap(),"expected":"🎉","replacement":"🇰🇷🎯"},
        ]);
        let mut req = put_req(&token, &note_id, "html", partial_body(1, edits));
        req["draft"]["note"]["title"] = json!("부분 편집");
        req["draft"]["note"]["notebook_id"] = json!(notebook);
        req["draft"]["note"]["tags"] = json!(["기준"]);
        assert_eq!(ok(e.execute(req))["saved"], true);
        // put changed neither the note nor the index queue.
        let current = ok(e.execute(json!({"op":"get","id":note_id})));
        assert_eq!(current["content"], "<p>rev2 내용</p>");
        assert_eq!(current["revision"], 2);
        assert_eq!(ok(e.execute(json!({"op":"index_status"})))["pending"], 0);
        // Evict the revision-1 history entry with 20+ further saves.
        for i in 0..22 {
            ok(
                e.execute(json!({"op":"save","note":{"id":note_id,"revision":2+i,
                "content":format!("<p>쓰레기 {i}</p>"),"text":format!("쓰레기 {i}")}})),
            );
        }
        assert_eq!(
            e.execute(json!({"op":"revision_body","id":note_id,"revision":1}))["ok"],
            false
        );
        assert_eq!(status(&e), 1);
    }
    {
        let e = t.open();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all","limit":100})))["items"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(items.len(), 2);
        let copy = find_by_title(&items, "부분 편집 (자동 복구)");
        let note = ok(e.execute(json!({"op":"get","id":copy["id"]})));
        assert_eq!(note["content"], final_content);
        assert_eq!(note["content_format"], "html");
        assert_eq!(note["tags"], json!(["기준"]));
        assert_eq!(note["notebook_id"], notebook);
        // The original keeps its latest saved state, untouched.
        let original = ok(e.execute(json!({"op":"get","id":note_id})));
        assert_eq!(original["content"], "<p>쓰레기 21</p>");
        assert_eq!(original["revision"], 24);
    }
}

#[test]
fn partial_baseline_survives_original_delete_for_reput_and_recovery() {
    let t = TempDb::new("partial-delete");
    let token1 = uuid();
    let token2 = uuid();
    let note_id = uuid();
    let baseline = "<p>가나다 라바사 ABC 🎉</p>";
    let after_p2_edits = |source: &str| source.replacen("🎉", "🚀", 1);
    {
        let e = t.open();
        ok(
            e.execute(json!({"op":"save","note":{"id":note_id,"title":"삭제 대상",
            "content":baseline,"text":"가나다 라바사 ABC 🎉"}})),
        );
        let edits1 = json!([
            {"start":baseline.find("가나다 라바사").unwrap(),"expected":"가나다 라바사",
             "replacement":"가나다라"},
        ]);
        ok(e.execute(put_req(&token1, &note_id, "html", partial_body(1, edits1))));
        // Trash + hard delete: bodies AND history rows cascade away.
        ok(e.execute(json!({"op":"patch","id":note_id,"revision":1,"changes":{"trashed":true}})));
        ok(e.execute(json!({"op":"delete","id":note_id})));
        // Same revision+format re-put reuses the journal baseline: the
        // revision lookup is impossible now, yet the put succeeds.
        let edits2 = json!([
            {"start":baseline.find("라바사").unwrap(),"expected":"라바사","replacement":"라바"},
            {"start":baseline.replace("라바사", "라바").find("🎉").unwrap(),
             "expected":"🎉","replacement":"🚀"},
        ]);
        assert_eq!(
            ok(e.execute(put_req(&token2, &note_id, "html", partial_body(1, edits2))))["saved"],
            true
        );
        // The old token's clear must not delete the newer draft.
        assert_eq!(
            ok(e.execute(json!({"op":"draft_journal_clear","id":note_id,"token":token1})))
                ["cleared"],
            false
        );
        assert_eq!(status(&e), 1);
    }
    {
        let e = t.open();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all","limit":100})))["items"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(items.len(), 1);
        let note = ok(e.execute(json!({"op":"get","id":items[0]["id"]})));
        let expected = after_p2_edits(&baseline.replacen("라바사", "라바", 1));
        assert_eq!(note["content"], expected);
        assert!(err(e.execute(json!({"op":"get","id":note_id}))).contains("not_found"));
    }
}

// ---- token-conditional clears ----------------------------------------------

#[test]
fn clear_matches_only_the_current_token() {
    let t = TempDb::new("clear");
    let note_id = uuid();
    {
        let e = t.open();
        ok(e.execute(
            json!({"op":"save","note":{"id":note_id,"title":"clear 대상",
            "content":"<p>가나다</p>","text":"가나다"}}),
        ));
        let token1 = uuid();
        let token2 = uuid();
        let edits1 = json!([{"start":3,"expected":"가나다","replacement":"첫"}]);
        let edits2 = json!([{"start":3,"expected":"가나다","replacement":"둘"}]);
        ok(e.execute(put_req(&token1, &note_id, "html", partial_body(1, edits1))));
        ok(e.execute(put_req(&token2, &note_id, "html", partial_body(1, edits2))));
        // A late/old save ack must not clear the newer draft.
        assert_eq!(
            ok(e.execute(json!({"op":"draft_journal_clear","id":note_id,"token":token1})))
                ["cleared"],
            false
        );
        assert_eq!(status(&e), 1);
        assert!(
            err(e.execute(json!({"op":"draft_journal_clear","id":"../bad","token":token2})))
                .contains("invalid")
        );
        assert!(
            err(e.execute(json!({"op":"draft_journal_clear","id":note_id,"token":"x"})))
                .contains("invalid")
        );
        assert_eq!(
            ok(e.execute(json!({"op":"draft_journal_clear","id":note_id,"token":token2})))
                ["cleared"],
            true
        );
        assert_eq!(status(&e), 0);
        // Already cleared: reporting false, never an error.
        assert_eq!(
            ok(e.execute(json!({"op":"draft_journal_clear","id":note_id,"token":token2})))
                ["cleared"],
            false
        );
    }
}

// ---- already-committed snapshots must not duplicate -------------------------

#[test]
fn already_saved_snapshot_recover_without_duplicate() {
    let t = TempDb::new("saved");
    let token = uuid();
    let note_id = uuid();
    {
        let e = t.open();
        ok(
            e.execute(json!({"op":"save","note":{"id":note_id,"title":"원본 제목",
            "content":"<p>원본</p>","text":"원본"}})),
        );
        ok(e.execute(put_req(
            &token,
            &note_id,
            "html",
            complete_body(1, "<p>새 본문</p>"),
        )));
        // The save carrying the snapshot commits; the crash eats only the ack.
        ok(e.execute(
            json!({"op":"save","note":{"id":note_id,"revision":1,"title":"제목",
            "tags":[],"content":"<p>새 본문</p>","text":"새 본문"}}),
        ));
    }
    {
        let e = t.open();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all","limit":100})))["items"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(items.len(), 1, "no duplicate for a committed snapshot");
        assert_eq!(items[0]["id"], note_id);
        assert_eq!(items[0]["revision"], 2);
        assert_eq!(
            ok(e.execute(json!({"op":"get","id":note_id})))["content"],
            "<p>새 본문</p>"
        );
    }
}

#[test]
fn late_save_ack_keeps_newer_revision_draft() {
    let t = TempDb::new("late-ack");
    let token1 = uuid();
    let token2 = uuid();
    let note_id = uuid();
    let baseline = "<p>가나다</p>";
    let final1 = baseline.replacen("가나다", "가나다라", 1);
    let final2 = baseline.replacen("가나다", "가나다라마바사", 1);
    {
        let e = t.open();
        ok(
            e.execute(json!({"op":"save","note":{"id":note_id,"title":"늦은 응답",
            "content":baseline,"text":"가나다"}})),
        );
        ok(e.execute(put_req(
            &token1,
            &note_id,
            "html",
            partial_body(
                1,
                json!([{"start":3,"expected":"가나다","replacement":"가나다라"}]),
            ),
        )));
        let mut req2 = put_req(
            &token2,
            &note_id,
            "html",
            partial_body(
                1,
                json!([{"start":3,"expected":"가나다","replacement":"가나다라마바사"}]),
            ),
        );
        req2["draft"]["note"]["title"] = json!("늦은 응답");
        ok(e.execute(req2));
        // The older snapshot is saved while the newer draft stays pending.
        ok(
            e.execute(json!({"op":"save","note":{"id":note_id,"revision":1,
            "content":final1,"text":"가나다라"}})),
        );
        assert_eq!(
            ok(e.execute(json!({"op":"draft_journal_clear","id":note_id,"token":token1})))
                ["cleared"],
            false
        );
        assert_eq!(status(&e), 1);
    }
    {
        let e = t.open();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all","limit":100})))["items"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(items.len(), 2);
        let copy = find_by_title(&items, "늦은 응답 (자동 복구)");
        assert_eq!(
            ok(e.execute(json!({"op":"get","id":copy["id"]})))["content"],
            final2
        );
        // The original is never modified by recovery.
        let original = ok(e.execute(json!({"op":"get","id":note_id})));
        assert_eq!(original["content"], final1);
        assert_eq!(original["revision"], 2);
    }
}

// ---- malformed and oversize input changes nothing ---------------------------

#[test]
fn malformed_and_oversize_puts_change_nothing() {
    let t = TempDb::new("invalid");
    let e = t.open();
    let note_id = uuid();
    ok(
        e.execute(json!({"op":"save","note":{"id":note_id,"title":"검증 대상",
        "content":"<p>한글</p>","text":"한글"}})),
    );
    let token = uuid();
    let valid = put_req(
        &token,
        &note_id,
        "html",
        partial_body(
            1,
            json!([
        {"start":3,"expected":"한글","replacement":"한국 어"}]),
        ),
    );
    assert_eq!(ok(e.execute(valid))["saved"], true);
    let before = ok(e.execute(json!({"op":"get","id":note_id})));
    let pending = || status(&e);
    let reject = |req: &Value| {
        let res = e.execute(req.clone());
        assert_eq!(res["ok"], false, "expected rejection, got {res}");
        assert_eq!(pending(), 1, "journal changed by rejected put: {req}");
    };

    // Envelope and token.
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["token"] = json!("not-a-uuid");
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req.as_object_mut().unwrap().remove("token");
    reject(&req);

    // Draft envelope.
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["format"] = json!("mindbox-draft2");
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["version"] = json!(2);
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req.as_object_mut().unwrap().remove("draft");
    reject(&req);

    // Note metadata limits and engine-safe id shape.
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["note"]["id"] = json!("../custom-id");
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["note"]["title"] = json!("가".repeat(2001));
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["note"]["tags"] = json!(vec!["a"; 101]);
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["note"]["tags"] = json!([""]);
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["note"]["notebook_id"] = json!("../zzz");
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["note"]["content_format"] = json!("rtf");
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["note"]
        .as_object_mut()
        .unwrap()
        .remove("content_format");
    reject(&req);

    // Complete body: JS-safe revisions and the 20 MiB body limit.
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["body"]["revision"] = json!(-1);
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["body"]["revision"] = json!(1.5);
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["body"]["revision"] = json!(9_007_199_254_740_992i64);
    reject(&req);
    let mut req = put_req(&token, &note_id, "html", complete_body(0, "<p>x</p>"));
    req["draft"]["body"]
        .as_object_mut()
        .unwrap()
        .remove("content");
    reject(&req);
    let oversized = format!("<p>{}", "a".repeat(20 * 1024 * 1024));
    reject(&put_req(
        &token,
        &note_id,
        "html",
        complete_body(0, &oversized),
    ));

    // Partial body: encoding, order, edit count and exact sequential matches.
    let mut req = put_req(
        &token,
        &note_id,
        "html",
        partial_body(
            1,
            json!([
        {"start":3,"expected":"한글","replacement":"x"}]),
        ),
    );
    req["draft"]["body"]["revision"] = json!(0);
    reject(&req);
    let mut req = put_req(
        &token,
        &note_id,
        "html",
        partial_body(
            1,
            json!([
        {"start":3,"expected":"한글","replacement":"x"}]),
        ),
    );
    req["draft"]["body"]["offset_encoding"] = json!("utf-16");
    reject(&req);
    let mut req = put_req(
        &token,
        &note_id,
        "html",
        partial_body(
            1,
            json!([
        {"start":3,"expected":"한글","replacement":"x"}]),
        ),
    );
    req["draft"]["body"]["edit_order"] = json!("any");
    reject(&req);
    let many: Vec<Value> = (0..16_385)
        .map(|_| json!({"start":0,"expected":"","replacement":""}))
        .collect();
    reject(&put_req(
        &token,
        &note_id,
        "html",
        partial_body(1, json!(many)),
    ));
    reject(&put_req(
        &token,
        &note_id,
        "html",
        partial_body(
            1,
            json!([
        {"start":0,"expected":"no such text","replacement":"x"}]),
        ),
    ));
    // Byte 4 sits inside the multi-byte '한' at byte offset 3.
    reject(&put_req(
        &token,
        &note_id,
        "html",
        partial_body(
            1,
            json!([
        {"start":4,"expected":"글","replacement":"x"}]),
        ),
    ));
    reject(&put_req(
        &token,
        &note_id,
        "html",
        partial_body(
            1,
            json!([
        {"start":999,"expected":"","replacement":"x"}]),
        ),
    ));
    reject(&put_req(
        &token,
        &note_id,
        "html",
        partial_body(
            1,
            json!([
        {"start":0,"expected":"","replacement":"","extra":1}]),
        ),
    ));
    // A partial draft must not claim a format the baseline never had.
    reject(&put_req(
        &token,
        &note_id,
        "text",
        partial_body(
            1,
            json!([
        {"start":0,"expected":"","replacement":"x"}]),
        ),
    ));

    assert_eq!(ok(e.execute(json!({"op":"get","id":note_id}))), before);
}

#[test]
fn total_budget_rejects_without_evicting_existing_drafts() {
    let t = TempDb::new("budget");
    let e = t.open();
    let note_id = uuid();
    ok(
        e.execute(json!({"op":"save","note":{"id":note_id,"title":"한도",
        "content":"<p>한도</p>","text":"한도"}})),
    );
    let token = uuid();
    let edits = json!([{"start":3,"expected":"한도","replacement":"한도2"}]);
    ok(e.execute(put_req(&token, &note_id, "html", partial_body(1, edits))));
    assert_eq!(status(&e), 1);
    // Simulate a near-cap journal through a second raw connection (no reopen,
    // so recovery never sees this synthetic row).
    let synthetic = uuid();
    {
        let raw = rusqlite::Connection::open(&t.path).unwrap();
        raw.busy_timeout(std::time::Duration::from_secs(30))
            .unwrap();
        raw.execute(
            "INSERT INTO draft_journal(id,token,title,notebook_id,tags,content_format, \
                 body_kind,revision,baseline,edits,content,updated_at,byte_count) \
             VALUES(?1,?2,'','','[]','html','complete',0,NULL,NULL,?3,0,?4)",
            rusqlite::params![
                synthetic,
                uuid(),
                "x".repeat(110 * 1024 * 1024),
                110 * 1024 * 1024
            ],
        )
        .unwrap();
    }
    // ~110 MiB stored + a fresh ~19 MiB complete draft exceeds the 128 MiB
    // total budget: rejected, and NO existing row is evicted.
    let big = put_req(
        &uuid(),
        &uuid(),
        "html",
        complete_body(0, &"a".repeat(19 * 1024 * 1024)),
    );
    let res = e.execute(big);
    assert_eq!(res["ok"], false, "expected budget rejection, got {res}");
    assert!(res["error"].as_str().unwrap().contains("128 MiB"));
    assert_eq!(status(&e), 2);
    let kept: i64 = {
        let raw = rusqlite::Connection::open(&t.path).unwrap();
        raw.query_row(
            "SELECT COUNT(*) FROM draft_journal WHERE id = ?1 AND length(content) = ?2",
            rusqlite::params![synthetic, 110 * 1024 * 1024],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(kept, 1, "existing journal must survive a rejected put");
    // Cleanup so the drop-time reopen state stays ordinary.
    let raw = rusqlite::Connection::open(&t.path).unwrap();
    raw.execute(
        "DELETE FROM draft_journal WHERE id = ?1",
        rusqlite::params![synthetic],
    )
    .unwrap();
    assert_eq!(status(&e), 1);
}

// ---- rollback on recovery failure -------------------------------------------

#[test]
fn recovery_failure_rolls_back_and_fails_open_preserving_journal() {
    let t = TempDb::new("fail-open");
    let token = uuid();
    let note_id = uuid();
    {
        let e = t.open();
        ok(
            e.execute(json!({"op":"save","note":{"id":note_id,"title":"원본",
            "content":"원본 본문","content_format":"text"}})),
        );
        let mut req = put_req(&token, &note_id, "text", complete_body(1, "미저장 내용"));
        req["draft"]["note"]["title"] = json!("미저장");
        assert_eq!(ok(e.execute(req))["saved"], true);
    }
    {
        let raw = rusqlite::Connection::open(&t.path).unwrap();
        raw.execute_batch(
            "CREATE TRIGGER reject_recovery BEFORE INSERT ON notes_meta \
             BEGIN SELECT RAISE(ABORT,'injected recovery failure'); END;",
        )
        .unwrap();
    }
    // Recovery fails loudly: the open errors, nothing is dropped silently.
    assert!(Engine::open(&t.path).is_err());
    {
        let raw = rusqlite::Connection::open(&t.path).unwrap();
        let (title, content): (String, String) = raw
            .query_row(
                "SELECT title, content FROM draft_journal WHERE id = ?1",
                [&note_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            (title.as_str(), content.as_str()),
            ("미저장", "미저장 내용")
        );
        let original: String = raw
            .query_row(
                "SELECT b.content FROM notes_meta m JOIN notes_body b ON b.note_id = m.id \
                 WHERE m.id = ?1",
                [&note_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(original, "원본 본문");
        let notes: i64 = raw
            .query_row("SELECT COUNT(*) FROM notes_meta", [], |r| r.get(0))
            .unwrap();
        assert_eq!(notes, 1, "failed recovery must not leave a partial copy");
        raw.execute_batch("DROP TRIGGER reject_recovery;").unwrap();
    }
    {
        let e = t.open();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all","limit":100})))["items"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(items.len(), 2);
        let copy = find_by_title(&items, "미저장 (자동 복구)");
        assert_eq!(
            ok(e.execute(json!({"op":"get","id":copy["id"]})))["content"],
            "미저장 내용"
        );
    }
}

// ---- put never touches notes, index or export -------------------------------

#[test]
fn put_preserves_note_index_and_export_excludes_journal() {
    let t = TempDb::new("isolation");
    let e = t.open();
    let note_id = uuid();
    ok(
        e.execute(json!({"op":"save","note":{"id":note_id,"title":"분리",
        "content":"<p>분리</p>","text":"분리"}})),
    );
    ok(e.execute(json!({"op":"wait_index","timeout_ms":10000})));
    let token = uuid();
    let mut req = put_req(
        &token,
        &note_id,
        "html",
        complete_body(1, "<p>JOURNAL_ONLY_MARKER 🤫</p>"),
    );
    req["draft"]["note"]["title"] = json!("분리");
    assert_eq!(ok(e.execute(req))["saved"], true);
    let before = ok(e.execute(json!({"op":"get","id":note_id})));
    assert_eq!(before["content"], "<p>분리</p>");
    assert_eq!(before["revision"], 1);
    assert_eq!(ok(e.execute(json!({"op":"index_status"})))["pending"], 0);
    let export_path = t.dir.join("backup.json");
    ok(e.execute(json!({"op":"export","path":export_path.to_str().unwrap()})));
    let exported = std::fs::read_to_string(&export_path).unwrap();
    assert!(!exported.contains("JOURNAL_ONLY_MARKER"));
    assert_eq!(status(&e), 1);
}

// ---- encrypted storage uses the ordinary engine key boundary ----------------

#[cfg(feature = "encrypted-storage")]
#[test]
fn encrypted_journal_roundtrips_with_same_engine_key() {
    use inkism_engine::storage::StorageKey;
    let dir = std::env::temp_dir().join(format!("inkism-encrypted-draft-{}", uuid()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("notes.db");
    let secret = "암호화된 미저장 초안 🤫비밀";
    {
        let e = Engine::open_encrypted(path.to_str().unwrap(), StorageKey::from_bytes([0x73; 32]))
            .unwrap();
        let note = ok(e.execute(json!({"op":"save","note":{"title":"암호화 원본",
            "content":"<p>원본</p>","text":"원본"}})));
        let edits = json!([{"start":3,"expected":"원본","replacement":secret}]);
        let mut req = put_req(
            &uuid(),
            note["id"].as_str().unwrap(),
            "html",
            partial_body(1, edits),
        );
        req["draft"]["note"]["title"] = json!("암호화 원본");
        ok(e.execute(req));
    }
    for entry in std::fs::read_dir(&dir).unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap();
        assert!(!bytes.windows(secret.len()).any(|w| w == secret.as_bytes()));
    }
    assert!(
        Engine::open_encrypted(path.to_str().unwrap(), StorageKey::from_bytes([0x74; 32])).is_err()
    );
    {
        let e = Engine::open_encrypted(path.to_str().unwrap(), StorageKey::from_bytes([0x73; 32]))
            .unwrap();
        assert_eq!(status(&e), 0);
        let items = ok(e.execute(json!({"op":"list","view":"all","limit":100})))["items"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(items.len(), 2);
        let copy = find_by_title(&items, "암호화 원본 (자동 복구)");
        assert_eq!(
            ok(e.execute(json!({"op":"get","id":copy["id"]})))["content"],
            format!("<p>{secret}</p>")
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn more_than_one_save_batch_is_retained_exactly() {
    let t = TempDb::new("many-edits");
    let e = t.open();
    let id = "Imported_Note-ABC";
    let original = ok(e.execute(
        json!({"op":"save","note":{"id":id,"content":"<p>기준😀</p>","content_format":"html"}}),
    ));
    let edits: Vec<Value> = (0..257)
        .map(|_| json!({"start":0,"expected":"","replacement":"x"}))
        .collect();
    ok(e.execute(put_req(&uuid(), id, "html", partial_body(1, json!(edits)))));
    drop(e);
    let e = t.open();
    assert_eq!(ok(e.execute(json!({"op":"get","id":id}))), original);
    let list = ok(e.execute(json!({"op":"list","view":"all"})));
    let recovered = find_by_title(list["items"].as_array().unwrap(), "제목 (자동 복구)");
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":recovered["id"]})))["content"],
        "x".repeat(257) + "<p>기준😀</p>"
    );
}

#[test]
fn row_limit_rejects_without_evicting_and_allows_replacement() {
    let t = TempDb::new("row-limit");
    let e = t.open();
    let id = uuid();
    let first = uuid();
    ok(e.execute(put_req(&first, &id, "html", complete_body(0, "keep"))));
    for _ in 1..128 {
        ok(e.execute(put_req(
            &uuid(),
            &uuid(),
            "text",
            complete_body(0, "retained"),
        )));
    }
    assert_eq!(status(&e), 128);
    assert!(err(e.execute(put_req(
        &uuid(),
        &uuid(),
        "text",
        complete_body(0, "rejected")
    )))
    .contains("128 pending"));
    assert_eq!(status(&e), 128);
    let replacement = uuid();
    ok(e.execute(put_req(
        &replacement,
        &id,
        "html",
        complete_body(0, "newer"),
    )));
    assert_eq!(
        ok(e.execute(json!({"op":"draft_journal_clear","id":id,"token":first})))["cleared"],
        false
    );
    assert_eq!(
        ok(e.execute(json!({"op":"draft_journal_clear","id":id,"token":replacement})))["cleared"],
        true
    );
    assert_eq!(status(&e), 127);
}

#[test]
fn commit_failure_rolls_back_without_poisoning_next_request() {
    let t = TempDb::new("commit-failure");
    let e = t.open();
    let id = uuid();
    let token = uuid();
    ok(e.execute(put_req(&token, &id, "text", complete_body(0, "retained"))));
    e.connection().execute_batch("CREATE TABLE guard_parent(id INTEGER PRIMARY KEY); CREATE TABLE guard_child(id INTEGER REFERENCES guard_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fail_journal_commit AFTER UPDATE ON draft_journal BEGIN INSERT INTO guard_child VALUES(999); END;").unwrap();
    assert_eq!(
        e.execute(put_req(
            &uuid(),
            &id,
            "text",
            complete_body(0, "must rollback")
        ))["ok"],
        false
    );
    assert!(
        e.connection().is_autocommit(),
        "failed COMMIT left the writer transaction active"
    );
    e.connection()
        .execute_batch("DROP TRIGGER fail_journal_commit;")
        .unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"draft_journal_clear","id":id,"token":token})))["cleared"],
        true
    );
    ok(e.execute(put_req(
        &uuid(),
        &id,
        "text",
        complete_body(0, "successful retry"),
    )));
}

#[test]
fn two_editors_of_one_note_preserve_both_divergent_drafts() {
    let t = TempDb::new("two-editors");
    let e = t.open();
    let id = uuid();
    let original = ok(e.execute(
        json!({"op":"save","note":{"id":id,"content":"# 원본😀","content_format":"markdown"}}),
    ));
    let main_token = uuid();
    let split_token = uuid();
    ok(e.execute(put_req(
        &main_token,
        &id,
        "markdown",
        complete_body(1, "# 주 편집😀"),
    )));
    let mut secondary = put_req(
        &split_token,
        &id,
        "markdown",
        complete_body(1, "# 분할 편집😀"),
    );
    secondary["editor"] = json!("split");
    ok(e.execute(secondary));
    assert_eq!(status(&e), 2);
    assert_eq!(
        ok(e.execute(
            json!({"op":"draft_journal_clear","id":id,"token":split_token,"editor":"main"})
        ))["cleared"],
        false
    );
    assert_eq!(
        ok(e.execute(json!({"op":"draft_journal_clear","id":id,"token":main_token})))["cleared"],
        true
    );
    assert_eq!(status(&e), 1);
    ok(e.execute(put_req(
        &uuid(),
        &id,
        "markdown",
        complete_body(1, "# 주 편집 후속😀"),
    )));
    let mut invalid = put_req(&uuid(), &id, "markdown", complete_body(1, "must reject"));
    invalid["editor"] = json!("unknown");
    assert_eq!(e.execute(invalid)["ok"], false);
    assert_eq!(status(&e), 2);
    drop(e);
    let e = t.open();
    assert_eq!(status(&e), 0);
    assert_eq!(ok(e.execute(json!({"op":"get","id":id}))), original);
    let list = ok(e.execute(json!({"op":"list","view":"all"})));
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    for (title, body) in [
        ("제목 (자동 복구)", "# 주 편집 후속😀"),
        ("제목 (분할 자동 복구)", "# 분할 편집😀"),
    ] {
        let summary = find_by_title(items, title);
        let note = ok(e.execute(json!({"op":"get","id":summary["id"]})));
        assert_eq!(note["content"], body);
        assert_eq!(note["content_format"], "markdown");
    }
    drop(e);
    let e = t.open();
    assert_eq!(ok(e.execute(json!({"op":"stats"})))["notes"], 3);
}
