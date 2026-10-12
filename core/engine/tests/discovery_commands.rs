use inkism_engine::Engine;
use serde_json::{json, Value};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
#[test]
fn random_filters_recent_fallback_and_protection() {
    let path = std::env::temp_dir().join(format!("inkism-random-{}.db", uuid::Uuid::new_v4()));
    let e = Engine::open(path.to_str().unwrap()).unwrap();
    let a = ok(e.execute(json!({"op":"save","note":{"title":"A","tags":["scope"]}})));
    let b = ok(e.execute(json!({"op":"save","note":{"title":"B","tags":["scope"]}})));
    let c = ok(e.execute(json!({"op":"save","note":{"title":"C","tags":["scope"]}})));
    ok(e.execute(json!({"op":"save","note":{"title":"outside"}})));
    let req = json!({"op":"random_note","tag":"scope","current_id":a["id"],"recent_ids":[a["id"],b["id"]]});
    assert_eq!(ok(e.execute(req))["id"], c["id"]);
    ok(e.execute(json!({"op":"patch","id":c["id"],"changes":{"trashed":true}})));
    assert_eq!(ok(e.execute(json!({"op":"random_note","tag":"scope","current_id":a["id"],"recent_ids":[a["id"],b["id"]]})))["id"],b["id"]);
    ok(e.execute(json!({"op":"patch","id":b["id"],"changes":{"archived":true}})));
    assert_eq!(
        ok(e.execute(
            json!({"op":"random_note","tag":"scope","current_id":a["id"],"recent_ids":[a["id"]]})
        ))["id"],
        a["id"]
    );
    assert_eq!(
        ok(e.execute(json!({"op":"random_note","view":"archive","tag":"scope"})))["id"],
        b["id"]
    );
    assert!(ok(e.execute(json!({"op":"random_note","view":"trash"})))["id"].is_null());
    assert!(ok(e.execute(json!({"op":"random_note","tag":"nonexistent"})))["id"].is_null());
    e.connection()
        .execute(
            "UPDATE notes_meta SET locked=1 WHERE id=?1",
            [a["id"].as_str().unwrap()],
        )
        .unwrap();
    assert!(ok(e.execute(json!({"op":"random_note","tag":"scope"})))["id"].is_null());
    e.connection()
        .execute(
            "UPDATE notes_meta SET locked=0 WHERE id=?1",
            [a["id"].as_str().unwrap()],
        )
        .unwrap();
    ok(e.execute(json!({"op":"wait_index"})));
    assert_eq!(
        ok(e.execute(json!({"op":"random_note","query":"title:A"})))["id"],
        a["id"]
    );
    assert_eq!(
        ok(e.execute(json!({"op":"random_note","query":"A"})))["id"],
        a["id"]
    );
    // Selection still works when canonical bodies are unavailable: metadata only.
    e.connection()
        .execute(
            "DELETE FROM notes_body WHERE note_id=?1",
            [a["id"].as_str().unwrap()],
        )
        .unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"random_note","tag":"scope"})))["id"],
        a["id"]
    );
    drop(e);
    for suffix in ["", "-wal", "-shm", ".search", ".search-wal", ".search-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}
#[test]
fn timestamp_create_transaction_unique_opt_in_and_rollback() {
    let path = std::env::temp_dir().join(format!("inkism-timestamp-{}.db", uuid::Uuid::new_v4()));
    let e = Engine::open(path.to_str().unwrap()).unwrap();
    let base = "20261013-120000";
    let a = ok(e.execute(json!({"op":"save","note":{"title":base,"content":"canonical A"}})));
    let b = ok(e.execute(
        json!({"op":"save","note":{"title":base,"timestamp_title":true,"content":"canonical B"}}),
    ));
    assert_eq!(b["title"], format!("{base}-2"));
    assert_eq!(b["content"], "canonical B");
    let ordinary = ok(e.execute(json!({"op":"save","note":{"title":base}})));
    assert_eq!(ordinary["title"], base);
    drop(e);
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                let e = Engine::open(path.to_str().unwrap()).unwrap();
                ok(e.execute(
                    json!({"op":"save","note":{"title":"20261013-120000","timestamp_title":true}}),
                ))["title"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
        })
        .collect();
    let mut titles: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    titles.sort();
    assert_eq!(
        titles,
        vec![
            format!("{base}-3"),
            format!("{base}-4"),
            format!("{base}-5"),
            format!("{base}-6")
        ]
    );
    let e = Engine::open(path.to_str().unwrap()).unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":a["id"]})))["content"],
        "canonical A"
    );
    assert_eq!(
        e.execute(json!({"op":"save","note":{"title":"invalid","timestamp_title":true}}))["ok"],
        false
    );
    drop(e);
    for suffix in ["", "-wal", "-shm", ".search", ".search-wal", ".search-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}
