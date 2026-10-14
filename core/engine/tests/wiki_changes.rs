use inkism_engine::Engine;
use serde_json::{json, Value};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn fixture() -> (std::path::PathBuf, Engine) {
    let root = std::env::temp_dir().join(format!("wiki-receipt-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let e = Engine::open(root.join("notes.db").to_str().unwrap()).unwrap();
    (root, e)
}
fn save(e: &Engine, note: Value) -> Value {
    ok(e.execute(json!({"op":"save","note":note})))
}
fn get(e: &Engine, n: &Value) -> Value {
    ok(e.execute(json!({"op":"get","id":n["id"]})))
}
fn setup(e: &Engine) -> (Value, Value) {
    let wiki = save(e, json!({"title":"Wiki","content":"# Wiki\r\n\nold line\n","content_format":"markdown"}));
    let src = save(e, json!({"title":"Source","content":"<p>fact</p>","content_format":"html"}));
    (wiki, src)
}
fn propose(e: &Engine, wiki: &Value, src: &Value, after: &str) -> Value {
    e.execute(json!({"op":"wiki_propose_record","note_id":wiki["id"],"revision":wiki["revision"],"sources":[{"id":src["id"],"revision":src["revision"]}],"model":"m","after":after}))
}
fn items(e: &Engine, wiki: &Value) -> Value {
    ok(e.execute(json!({"op":"wiki_changes","note_id":wiki["id"]})))["items"].clone()
}

#[test]
fn apply_undo_restores_exact_bytes_and_refuses_races() {
    let (_root, e) = fixture();
    let (wiki, src) = setup(&e);
    let p = ok(propose(&e, &wiki, &src, "# Wiki\n\nnew fact [1]\n"));
    assert_eq!(p["status"], "proposed");
    assert_eq!(get(&e, &wiki)["content"], wiki["content"], "proposal never edits the note");
    ok(e.execute(json!({"op":"wiki_apply","id":p["id"]})));
    assert_eq!(get(&e, &wiki)["content"], "# Wiki\n\nnew fact [1]\n");
    assert_eq!(items(&e, &wiki)[0]["can_undo"], true);
    ok(e.execute(json!({"op":"wiki_undo","id":p["id"]})));
    let restored = get(&e, &wiki);
    assert_eq!(restored["content"], wiki["content"]);
    assert_eq!(restored["text"], wiki["text"]);
    // Concurrent edit between proposal and approval: refused, note untouched.
    let p2 = ok(propose(&e, &restored, &src, "# Wiki\n\nother\n"));
    let edited = save(&e, json!({"id":wiki["id"],"content":"# Wiki\n\nuser edit\n","content_format":"markdown","revision":restored["revision"]}));
    assert_eq!(e.execute(json!({"op":"wiki_apply","id":p2["id"]}))["ok"], false);
    assert_eq!(get(&e, &wiki)["content"], edited["content"]);
}

#[test]
fn undo_only_while_note_holds_applied_body() {
    let (_root, e) = fixture();
    let (wiki, src) = setup(&e);
    let p = ok(propose(&e, &wiki, &src, "# Wiki\n\nnew\n"));
    let applied = ok(e.execute(json!({"op":"wiki_apply","id":p["id"]})));
    assert_eq!(applied["status"], "applied");
    let now = get(&e, &wiki);
    save(&e, json!({"id":wiki["id"],"content":"# Wiki\n\nnew\nmore\n","content_format":"markdown","revision":now["revision"]}));
    assert_eq!(items(&e, &wiki)[0]["can_undo"], false);
    assert_eq!(e.execute(json!({"op":"wiki_undo","id":p["id"]}))["ok"], false);
    assert_eq!(get(&e, &wiki)["content"], "# Wiki\n\nnew\nmore\n");
}

#[test]
fn dedup_by_body_sources_and_model() {
    let (_root, e) = fixture();
    let (wiki, src) = setup(&e);
    let check = |w: &Value, s: &Value, model: &str| ok(e.execute(json!({"op":"wiki_check","note_id":w["id"],"sources":[{"id":s["id"],"revision":s["revision"]}],"model":model})))["existing"].clone();
    assert!(check(&wiki, &src, "m").is_null());
    let p = ok(propose(&e, &wiki, &src, "# Wiki\n\nnew\n"));
    assert_eq!(check(&wiki, &src, "m")["id"], p["id"]);
    assert!(check(&wiki, &src, "other").is_null(), "model is part of the key");
    let again = ok(propose(&e, &wiki, &src, "# Wiki\n\ndifferent\n"));
    assert_eq!(again["id"], p["id"], "duplicate key returns the stored proposal");
    ok(e.execute(json!({"op":"wiki_reject","id":p["id"]})));
    assert_eq!(check(&wiki, &src, "m")["status"], "rejected");
    // Applied result with the same sources: nothing new either.
    let p2 = ok(propose(&e, &wiki, &src, "# Wiki\n\nnew\n"));
    assert_eq!(p2["id"], p["id"]);
    let other = ok(e.execute(json!({"op":"wiki_propose_record","note_id":wiki["id"],"revision":wiki["revision"],"sources":[{"id":src["id"],"revision":src["revision"]}],"model":"m2","after":"# Wiki\n\nx\n"})));
    ok(e.execute(json!({"op":"wiki_apply","id":other["id"]})));
    let now = get(&e, &wiki);
    let existing = ok(e.execute(json!({"op":"wiki_check","note_id":now["id"],"sources":[{"id":src["id"],"revision":src["revision"]}],"model":"m2"})))["existing"].clone();
    assert_eq!(existing["status"], "applied");
    // Same body is no change.
    let src2 = save(&e, json!({"id":src["id"],"content":"<p>fact 2</p>","revision":src["revision"]}));
    assert_eq!(propose(&e, &now, &src2, "# Wiki\n\nx\n")["ok"], false);
}

#[test]
fn stale_sources_and_lock_purge() {
    let (_root, e) = fixture();
    let (wiki, src) = setup(&e);
    let p = ok(propose(&e, &wiki, &src, "# Wiki\n\nnew\n"));
    ok(e.execute(json!({"op":"wiki_apply","id":p["id"]})));
    assert_eq!(items(&e, &wiki)[0]["stale"], false);
    let src2 = save(&e, json!({"id":src["id"],"content":"<p>changed</p>","revision":src["revision"]}));
    assert_eq!(items(&e, &wiki)[0]["stale"], true);
    // Old source revision is refused; the new one is a new proposal.
    let now = get(&e, &wiki);
    assert_eq!(propose(&e, &now, &src, "# Wiki\n\nnewer\n")["ok"], false);
    let fresh = ok(propose(&e, &now, &src2, "# Wiki\n\nnewer\n"));
    assert_ne!(fresh["id"], p["id"]);
    // Locking a source or the wiki purges every receipt that holds its bodies.
    e.connection().execute("UPDATE notes_meta SET locked=1 WHERE id=?1", [src["id"].as_str().unwrap()]).unwrap();
    assert_eq!(items(&e, &wiki).as_array().unwrap().len(), 0);
    let locked_src = e.execute(json!({"op":"wiki_check","note_id":wiki["id"],"sources":[{"id":src["id"],"revision":src2["revision"]}],"model":"m"}));
    assert_eq!(locked_src["ok"], false, "locked notes are never accepted as sources");
    let other = save(&e, json!({"title":"Other","content":"<p>x</p>","content_format":"html"}));
    let q = ok(propose(&e, &now, &other, "# Wiki\n\nz\n"));
    assert!(!q["id"].is_null());
    e.connection().execute("UPDATE notes_meta SET locked=1 WHERE id=?1", [wiki["id"].as_str().unwrap()]).unwrap();
    let left: i64 = e.connection().query_row("SELECT count(*) FROM local_wiki_changes", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
}

#[test]
fn sources_are_linked_unlocked_notes() {
    let (_root, e) = fixture();
    let wiki = save(&e, json!({"title":"Topic","content":"see [[Out]]\n","content_format":"markdown"}));
    let out = save(&e, json!({"title":"Out","content":"<p>out</p>","content_format":"html"}));
    let back = save(&e, json!({"title":"Back","content":format!("<p><a href=\"note://{}\">Topic</a></p>",wiki["id"].as_str().unwrap()),"content_format":"html"}));
    save(&e, json!({"title":"Unrelated","content":"<p>no</p>","content_format":"html"}));
    ok(e.execute(json!({"op":"wait_index"})));
    let ids: Vec<String> = ok(e.execute(json!({"op":"wiki_sources","note_id":wiki["id"]})))["items"].as_array().unwrap().iter().map(|v| v["id"].as_str().unwrap().to_string()).collect();
    assert!(ids.contains(&out["id"].as_str().unwrap().to_string()), "{ids:?}");
    assert!(ids.contains(&back["id"].as_str().unwrap().to_string()), "{ids:?}");
    assert_eq!(ids.len(), 2);
}
