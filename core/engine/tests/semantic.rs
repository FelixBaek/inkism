use inkism_engine::Engine;
use serde_json::{json, Value};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn fixture() -> (std::path::PathBuf, Engine) {
    let root = std::env::temp_dir().join(format!("semantic-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let e = Engine::open(root.join("notes.db").to_str().unwrap()).unwrap();
    (root, e)
}
fn save(e: &Engine, title: &str, body: &str) -> Value {
    ok(e.execute(json!({"op":"save","note":{"title":title,"content":format!("<p>{body}</p>"),"content_format":"html"}})))
}
fn pending(e: &Engine) -> Vec<Value> {
    ok(e.execute(json!({"op":"semantic_pending","model":"m","limit":16})))["items"].as_array().unwrap().clone()
}
fn put(e: &Engine, id: &Value, revision: &Value, vectors: Value) -> Value {
    e.execute(json!({"op":"semantic_put","model":"m","note_id":id,"revision":revision,"vectors":vectors}))
}
fn search(e: &Engine, v: Value) -> Vec<Value> {
    ok(e.execute(json!({"op":"semantic_search","model":"m","vector":v,"limit":5})))["items"].as_array().unwrap().clone()
}
fn rows(e: &Engine) -> i64 {
    e.connection().query_row("SELECT count(*) FROM semantic_chunks", [], |r| r.get(0)).unwrap()
}

#[test]
fn index_search_and_revision_race() {
    let (root, e) = fixture();
    let a = save(&e, "Cats", "고양이는 낮잠을 많이 잔다");
    let b = save(&e, "Cars", "자동차 정비 기록");
    let items = pending(&e);
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["chunks"].as_array().unwrap().len(), 1);
    ok(put(&e, &a["id"], &a["revision"], json!([[1.0, 0.0]])));
    ok(put(&e, &b["id"], &b["revision"], json!([[0.0, 1.0]])));
    assert!(pending(&e).is_empty());
    assert_eq!(ok(e.execute(json!({"op":"semantic_status","model":"m"}))), json!({"indexed":2,"pending":0}));
    let hits = search(&e, json!([0.9, 0.1]));
    assert_eq!(hits[0]["note"]["id"], a["id"]);
    assert_eq!(hits[0]["snippet"], "고양이는 낮잠을 많이 잔다");
    assert_eq!(hits[0]["start"], 0);
    // A different model sees nothing.
    assert!(ok(e.execute(json!({"op":"semantic_search","model":"other","vector":[1.0,0.0]})))["items"].as_array().unwrap().is_empty());
    // Edit after pending was read: the stale put is refused and old vectors stop matching.
    let edited = ok(e.execute(json!({"op":"save","note":{"id":a["id"],"revision":a["revision"],"title":"Cats","content":"<p>개는 산책을 좋아한다</p>","content_format":"html"}})));
    assert_eq!(put(&e, &a["id"], &a["revision"], json!([[1.0, 0.0]]))["ok"], false);
    assert!(search(&e, json!([1.0, 0.0])).iter().all(|h| h["note"]["id"] != a["id"]));
    assert_eq!(pending(&e)[0]["id"], a["id"]);
    ok(put(&e, &a["id"], &edited["revision"], json!([[1.0, 0.0]])));
    assert_eq!(search(&e, json!([1.0, 0.0]))[0]["snippet"], "개는 산책을 좋아한다");
    drop(e);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn put_validates_vectors() {
    let (root, e) = fixture();
    let a = save(&e, "A", "본문");
    for bad in [json!([]), json!([[1.0], [2.0]]), json!([["x"]]), json!([[]]), json!([[1e40]]), json!("no")] {
        assert_eq!(put(&e, &a["id"], &a["revision"], bad.clone())["ok"], false, "{bad}");
    }
    let two = save(&e, "B", &"긴 문단입니다. ".repeat(150));
    let n = pending(&e).iter().find(|p| p["id"] == two["id"]).unwrap()["chunks"].as_array().unwrap().len();
    assert!(n >= 2);
    let mixed: Vec<Value> = (0..n).map(|i| if i == 0 { json!([1.0, 2.0]) } else { json!([1.0]) }).collect();
    assert_eq!(put(&e, &two["id"], &two["revision"], json!(mixed))["ok"], false);
    assert_eq!(e.execute(json!({"op":"semantic_search","model":"m","vector":[f64::NAN]}))["ok"], false);
    assert_eq!(e.execute(json!({"op":"semantic_pending","model":""}))["ok"], false);
    assert_eq!(put(&e, &json!("missing"), &json!(1), json!([]))["ok"], false);
    assert_eq!(rows(&e), 0);
    // Empty notes get a marker, never a search result.
    let empty = save(&e, "Empty", "");
    ok(put(&e, &empty["id"], &empty["revision"], json!([])));
    assert!(pending(&e).iter().all(|p| p["id"] != empty["id"]));
    drop(e);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn lock_trash_delete_purge_and_exclude() {
    let (root, e) = fixture();
    let notes: Vec<Value> = ["one", "two", "three"].iter().map(|t| save(&e, t, &format!("{t} 내용"))).collect();
    for n in &notes {
        ok(put(&e, &n["id"], &n["revision"], json!([[1.0, 0.0]])));
    }
    assert_eq!(rows(&e), 3);
    let id = |i: usize| notes[i]["id"].as_str().unwrap().to_string();
    e.connection().execute("UPDATE notes_meta SET locked=1 WHERE id=?1", [id(0)]).unwrap();
    ok(e.execute(json!({"op":"patch","id":id(1),"revision":notes[1]["revision"],"changes":{"trashed":true}})));
    // Direct row delete (as sync may do) purges without passing through trash.
    e.connection().execute("DELETE FROM notes_meta WHERE id=?1", [id(2)]).unwrap();
    assert_eq!(rows(&e), 0);
    assert!(search(&e, json!([1.0, 0.0])).is_empty());
    // Locked and trashed notes are never offered for embedding nor accepted.
    assert!(pending(&e).is_empty());
    let locked = ok(e.execute(json!({"op":"get","id":id(0)})));
    assert_eq!(put(&e, &json!(id(0)), &locked["revision"], json!([]))["ok"], false);
    assert_eq!(ok(e.execute(json!({"op":"semantic_status","model":"m"}))), json!({"indexed":0,"pending":0}));
    ok(e.execute(json!({"op":"semantic_reset"})));
    drop(e);
    std::fs::remove_dir_all(root).unwrap();
}
