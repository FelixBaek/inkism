use inkism_engine::Engine;
use serde_json::{json, Value};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
struct Fixture(std::path::PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm", ".search", ".search-wal", ".search-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}
#[test]
fn history_changes_counts_words_against_the_next_older_version() {
    let db = Fixture(std::env::temp_dir().join(format!("inkism-history-changes-{}.db", uuid::Uuid::new_v4())));
    let e = Engine::open(db.0.to_str().unwrap()).unwrap();
    let mut note = ok(e.execute(json!({"op":"save","note":{"title":"A","content":"one\ntwo","content_format":"text"}})));
    for body in ["one\ntwo\nthree", "one\nfour\nfive\nthree"] {
        note = ok(e.execute(json!({"op":"save","note":{"id":note["id"],"revision":note["revision"],"title":"A","content_format":"text","content":body}})));
    }
    let history = ok(e.execute(json!({"op":"history","id":note["id"]})));
    let history = history.as_array().unwrap();
    let changes = ok(e.execute(json!({"op":"history_changes","id":note["id"],"limit":20})));
    let items = changes["items"].as_array().unwrap();
    assert_eq!(items.len(), history.len());
    for (item, entry) in items.iter().zip(history) {
        assert_eq!(item["id"], entry["id"]);
    }
    // The oldest entry has nothing to compare with.
    assert_eq!(items.last().unwrap()["added"], Value::Null);
    if items.len() >= 2 {
        let a = items[0]["added"].as_u64().unwrap();
        let r = items[0]["removed"].as_u64().unwrap();
        assert!(a + r > 0, "{changes}");
    }
    assert_eq!(inkism_engine::history_changes::word_changes("one two\nthree", "one four five\nthree"), (2, 1));
    assert_eq!(inkism_engine::history_changes::word_changes("a b", "b a"), (0, 0));
    assert_eq!(e.execute(json!({"op":"history_changes","id":"not an id"}))["ok"], false);
}
