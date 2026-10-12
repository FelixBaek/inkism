use inkism_engine::Engine;
use serde_json::{json, Value};

struct Db(std::path::PathBuf);
impl Db {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("inkism-locate-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir.join("notes.db"))
    }
    fn open(&self) -> Engine {
        Engine::open(self.0.to_str().unwrap()).unwrap()
    }
}
impl Drop for Db {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
    }
}
fn ok(value: Value) -> Value {
    assert_eq!(value["ok"], true, "{value}");
    value["data"].clone()
}
fn save(e: &Engine, source: &str) -> Value {
    let note = ok(e.execute(json!({"op":"save","note":{"title":"locate","content":source}})));
    assert_eq!(e.wait_index(60000).unwrap(), 0);
    note
}
fn locate(e: &Engine, id: &Value, byte: usize, bias: &str) -> Value {
    ok(e.execute(
        json!({"op":"document_locate","id":id,"revision":1,"byte_offset":byte,"bias":bias}),
    ))
}

#[test]
fn locate_observes_block_segment_edges_and_utf8_without_primary_body_reads() {
    let db = Db::new();
    let e = db.open();
    let prefix = "<p>앞😀</p>";
    let giant = format!("<p><strong>{}</strong></p>", "한😀&amp;".repeat(12000));
    let source = format!("{prefix}{giant}<p>끝</p>");
    let n = save(&e, &source);
    let id = &n["id"];
    let page = ok(
        e.execute(json!({"op":"document_segments","id":id,"revision":1,"ordinal":1,"offset":1}))
    );
    let byte = page["segments"][0]["byte_offset"].as_u64().unwrap() as usize;
    assert_eq!(locate(&e, id, byte, "before")["offset"], 0);
    assert_eq!(locate(&e, id, byte, "after")["offset"], 1);
    assert_eq!(locate(&e, id, prefix.len(), "before")["ordinal"], 0);
    assert_eq!(locate(&e, id, prefix.len(), "after")["ordinal"], 1);
    for bias in ["before", "after"] {
        assert_eq!(locate(&e, id, 0, bias)["ordinal"], 0);
        assert_eq!(locate(&e, id, source.len(), bias)["ordinal"], 2);
        assert_eq!(
            e.execute(
                json!({"op":"document_locate","id":id,"revision":1,"byte_offset":4,"bias":bias})
            )["ok"],
            false,
            "inside Korean scalar"
        );
    }
    for args in [
        json!({"revision":2,"byte_offset":0}),
        json!({"revision":1,"byte_offset":source.len()+1}),
        json!({"revision":1,"byte_offset":-1}),
        json!({"revision":1,"byte_offset":0,"bias":"invalid"}),
    ] {
        let mut request = args;
        request["op"] = json!("document_locate");
        request["id"] = id.clone();
        assert_eq!(e.execute(request)["ok"], false);
    }
    // A stale canonical body must not be opened by a current metadata lookup.
    let main = rusqlite::Connection::open(&db.0).unwrap();
    main.execute(
        "UPDATE notes_body SET content='unavailable primary body' WHERE note_id=?1",
        [id.as_str().unwrap()],
    )
    .unwrap();
    assert_eq!(locate(&e, id, byte, "after")["offset"], 1);
}

#[test]
fn bounded_admission_stops_before_64k_block_and_preserves_legacy_page() {
    let db = Db::new();
    let e = db.open();
    let giant = format!("<p>{}</p>", "x".repeat(100000));
    let n = save(&e, &format!("<p>before</p>{giant}<p>after</p>"));
    let id = &n["id"];
    let first=ok(e.execute(json!({"op":"document_blocks","id":id,"revision":1,"limit":32,"bounded":true,"max_block_bytes":65536})));
    assert_eq!(first["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(first["next_offset"], 1);
    assert_ne!(first["oversized_block"], true);
    let marker=ok(e.execute(json!({"op":"document_blocks","id":id,"revision":1,"offset":1,"limit":32,"bounded":true,"max_block_bytes":65536})));
    assert_eq!(marker["oversized_block"], true);
    assert_eq!(marker["oversized"]["byte_count"], giant.len());
    assert!(marker["blocks"].as_array().unwrap().is_empty());
    assert!(marker.to_string().len() < 2048);
    let inner = ok(e.execute(json!({"op":"document_segments","id":id,"revision":1,"ordinal":1})));
    assert!(inner["total_segments"].as_u64().unwrap() > 1);
    assert!(inner["segments"][0]["source"].as_str().unwrap().len() <= 32768);
    let tail=ok(e.execute(json!({"op":"document_blocks","id":id,"revision":1,"offset":2,"limit":1,"bounded":true,"max_block_bytes":65536})));
    assert_eq!(tail["blocks"][0]["html"], "<p>after</p>");
    let legacy = ok(
        e.execute(json!({"op":"document_blocks","id":id,"revision":1,"limit":32,"bounded":true}))
    );
    assert_eq!(legacy["blocks"].as_array().unwrap().len(), 3);
    assert_eq!(legacy["blocks"][1]["html"], giant);
    for cap in [json!(3), json!(524289), json!(null), json!("65536")] {
        assert_eq!(
            e.execute(json!({"op":"document_blocks","id":id,"max_block_bytes":cap}))["ok"],
            false
        );
    }
}

#[test]
fn v7_migration_rebuilds_smaller_segments_without_changing_source() {
    let db = Db::new();
    let source = format!("<p>{}</p>", "한글😀".repeat(12000));
    let id;
    {
        let e = db.open();
        id = save(&e, &source)["id"].clone();
    }
    let cache = rusqlite::Connection::open(format!("{}.search", db.0.display())).unwrap();
    cache
        .execute_batch("DELETE FROM document_segment_layout; PRAGMA user_version=7;")
        .unwrap();
    drop(cache);
    let e = db.open();
    assert_eq!(e.wait_index(60000).unwrap(), 0);
    let page = ok(e.execute(json!({"op":"document_segments","id":id,"revision":1,"ordinal":0})));
    assert_eq!(page["ready"], true);
    assert_eq!(page["supported"], true);
    assert!(page["total_segments"].as_u64().unwrap() > 1);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":id})))["content"],
        source
    );
}
