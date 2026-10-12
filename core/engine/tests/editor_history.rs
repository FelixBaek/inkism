use inkism_engine::Engine;
use serde_json::{json, Value};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
#[test]
fn history_reopen_revision_and_invalid_request_preserve_notes() {
    let dir = std::env::temp_dir().join(format!("inkism-durable-history-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("notes.db");
    let note;
    {
        let e = Engine::open(path.to_str().unwrap()).unwrap();
        note=ok(e.execute(json!({"op":"save","note":{"title":"history","content":"<p>current</p>","text":"current"}})));
        let set = json!({"op":"editor_history_set","id":note["id"],"revision":note["revision"],"values":{"rich":{"done":["synthetic old text"],"undone":[]}}});
        ok(e.execute(set.clone()));
        ok(e.execute(set.clone()));
        let mut invalid = set.clone();
        invalid["values"]["bad"] = json!({});
        assert_eq!(e.execute(invalid)["ok"], false);
        let mut oversized = set.clone();
        oversized["values"]["source"] = json!({"content":"x".repeat(8*1024*1024)});
        assert_eq!(e.execute(oversized)["ok"], false);
        let mut malformed = set.clone();
        malformed["values"]["rich"] = json!("wrong");
        assert_eq!(e.execute(malformed)["ok"], false);
        let mut stale = set.clone();
        stale["revision"] = json!(999);
        assert_eq!(ok(e.execute(stale))["stale"], true);
        assert_eq!(
            ok(e.execute(json!({"op":"editor_history_get"})))
                .as_array()
                .unwrap()
                .len(),
            1
        );
        ok(e.execute(json!({"op":"export","path":dir.join("backup.json")})));
        assert!(!std::fs::read_to_string(dir.join("backup.json"))
            .unwrap()
            .contains("synthetic old text"));
    }
    {
        let e = Engine::open(path.to_str().unwrap()).unwrap();
        assert_eq!(
            ok(e.execute(json!({"op":"editor_history_get"})))[0]["revision"],
            note["revision"]
        );
        ok(e.execute(json!({"op":"save","note":{"id":note["id"],"revision":note["revision"],"content":"<p>remote</p>","text":"remote"}})));
        assert!(ok(e.execute(json!({"op":"editor_history_get"})))
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(
            ok(e.execute(json!({"op":"get","id":note["id"]})))["content"],
            "<p>remote</p>"
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(feature = "encrypted-storage")]
#[test]
fn encrypted_history_is_not_plaintext_and_reopens() {
    use inkism_engine::storage::StorageKey;
    let dir = std::env::temp_dir().join(format!(
        "inkism-encrypted-history-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("notes.db");
    let secret = "PRIVATE_UNDO_MARKER_안전한과거내용";
    {
        let e = Engine::open_encrypted(path.to_str().unwrap(), StorageKey::from_bytes([0x73; 32]))
            .unwrap();
        let n=ok(e.execute(json!({"op":"save","note":{"title":"encrypted","content":"<p>current</p>","text":"current"}})));
        ok(e.execute(json!({"op":"editor_history_set","id":n["id"],"revision":n["revision"],"values":{"source":{"old":secret}}})));
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
        assert_eq!(
            ok(e.execute(json!({"op":"editor_history_get"})))[0]["value"]["old"],
            secret
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn history_save_waits_for_concurrent_writer_before_reading_revision() {
    use std::{sync::mpsc, time::Duration};
    let dir = std::env::temp_dir().join(format!("inkism-history-writer-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("notes.db");
    let engine = Engine::open(path.to_str().unwrap()).unwrap();
    let note = ok(engine.execute(json!({"op":"save","note":{"title":"concurrent","content":"canonical","content_format":"text"}})));
    ok(engine.execute(json!({"op":"wait_index","timeout_ms":10000})));
    let (ready_tx, ready_rx) = mpsc::channel();
    let writer_path = path.clone();
    let writer = std::thread::spawn(move || {
        let conn = rusqlite::Connection::open(writer_path).unwrap();
        conn.busy_timeout(Duration::from_secs(5)).unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        ready_tx.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        conn.execute_batch("COMMIT").unwrap();
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let result = engine.execute(json!({"op":"editor_history_set","id":note["id"],"revision":note["revision"],"format":"text","values":{"source":{"history":"synthetic"}}}));
    writer.join().unwrap();
    assert_eq!(ok(result)["saved"], true);
    assert_eq!(
        ok(engine.execute(json!({"op":"get","id":note["id"]})))["content"],
        "canonical"
    );
    drop(engine);
    std::fs::remove_dir_all(dir).unwrap();
}
