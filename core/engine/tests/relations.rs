use inkism_engine::Engine;
use serde_json::{json, Value};
struct Db(std::path::PathBuf);
impl Drop for Db {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm", ".search", ".search-wal", ".search-shm", ".backup"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn note(e: &Engine, title: &str, content: &str) -> Value {
    ok(e.execute(json!({"op":"save","note":{"title":title,"content":content,"content_format":"markdown"}})))
}
fn relate(e: &Engine, n: &Value, name: &str, targets: &[&Value]) {
    let ids: Vec<&Value> = targets.iter().map(|t| &t["id"]).collect();
    ok(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":0,"aliases":[],"properties":[{"name":name,"type":"relation","value":ids}]})));
}
fn edges(e: &Engine, args: Value) -> Vec<(String, String, String, String, String, u64)> {
    let mut out: Vec<_> = ok(call(e, args))["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| (i["source_title"].as_str().unwrap().to_owned(), i["target_title"].as_str().unwrap().to_owned(), i["kind"].as_str().unwrap().to_owned(), i["direction"].as_str().unwrap().to_owned(), i["property"].as_str().unwrap_or("").to_owned(), i["hop"].as_u64().unwrap()))
        .collect();
    out.sort();
    out
}
fn call(e: &Engine, mut args: Value) -> Value {
    args["op"] = json!("relations");
    e.execute(args)
}
fn row(s: &str, t: &str, kind: &str, dir: &str, property: &str, hop: u64) -> (String, String, String, String, String, u64) {
    (s.into(), t.into(), kind.into(), dir.into(), property.into(), hop)
}

#[test]
fn typed_relations_respect_direction_property_depth_and_locks() {
    let path = std::env::temp_dir().join(format!("inkism-relations-{}.db", uuid::Uuid::new_v4()));
    let db = Db(path);
    let e = Engine::open(db.0.to_str().unwrap()).unwrap();
    let person = note(&e, "사람", "부산 출신");
    let city = note(&e, "부산", "항구");
    let secret = note(&e, "비밀", "잠긴 내용");
    let book = note(&e, "책", &format!("[작가](note://{}) 소개", person["id"].as_str().unwrap()));
    relate(&e, &book, "저자", &[&person, &secret]);
    let editor = note(&e, "편집", "[[책]] 메모");
    let person = ok(e.execute(json!({"op":"get","id":person["id"]})));
    relate(&e, &person, "고향", &[&city]);
    e.wait_index(5000).unwrap();

    let id = book["id"].clone();
    let one = edges(&e, json!({"id":id}));
    assert_eq!(one, vec![
        row("책", "비밀", "relation", "out", "저자", 1),
        row("책", "사람", "link", "out", "", 1),
        row("책", "사람", "relation", "out", "저자", 1),
        row("편집", "책", "title_link", "in", "", 1),
    ]);
    let full = ok(call(&e, json!({"id":id})));
    let link = full["items"].as_array().unwrap().iter().find(|i| i["kind"] == "link").unwrap();
    assert_eq!(link["evidence"]["label"], "작가");
    assert!(link["evidence"]["byte_end"].as_i64().unwrap() > link["evidence"]["byte_offset"].as_i64().unwrap());
    let rel = full["items"].as_array().unwrap().iter().find(|i| i["kind"] == "relation").unwrap();
    assert_eq!(rel["evidence"], json!({"property":"저자"}));

    // Locked notes vanish on both ends.
    let conn = rusqlite::Connection::open(&db.0).unwrap();
    conn.execute("UPDATE notes_meta SET locked=1 WHERE id=?1", [secret["id"].as_str().unwrap()]).unwrap();
    assert!(!edges(&e, json!({"id":id})).iter().any(|r| r.1 == "비밀"));
    assert_eq!(call(&e, json!({"id":secret["id"]}))["ok"], false);

    assert_eq!(edges(&e, json!({"id":id,"direction":"in"})), vec![row("편집", "책", "title_link", "in", "", 1)]);
    assert_eq!(edges(&e, json!({"id":person["id"],"direction":"in","kinds":["relation"]})), vec![row("책", "사람", "relation", "in", "저자", 1)]);
    assert_eq!(edges(&e, json!({"id":id,"property":"저자"})), vec![row("책", "사람", "relation", "out", "저자", 1)]);

    let two = edges(&e, json!({"id":id,"depth":2,"kinds":["relation"]}));
    assert_eq!(two, vec![row("사람", "부산", "relation", "out", "고향", 2), row("책", "사람", "relation", "out", "저자", 1)]);
    assert_eq!(edges(&e, json!({"id":id,"limit":1})).len(), 1);
    for bad in [json!({"id":id,"depth":3}), json!({"id":id,"kinds":["x"]}), json!({"id":id,"direction":"up"}), json!({"id":id,"limit":201}), json!({"id":"../x"})] {
        assert_eq!(call(&e, bad.clone())["ok"], false, "{bad}");
    }
    // Trash hides the note on both ends too.
    let editor = ok(e.execute(json!({"op":"get","id":editor["id"]})));
    ok(e.execute(json!({"op":"patch","id":editor["id"],"revision":editor["revision"],"changes":{"trashed":true}})));
    assert!(!edges(&e, json!({"id":id})).iter().any(|r| r.0 == "편집"));
}
