#![cfg(feature = "encrypted-storage")]
use inkism_storage::{migration::copy_plaintext, StorageKey};
use rusqlite::Connection;
use std::path::Path;
struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("inkism-copy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[test]
fn copy_preserves_wal_rows_blobs_triggers_and_schema_versions() {
    let f = Fixture::new();
    let from = f.0.join("원본 & % #.db");
    let to = f.0.join("암호화.db");
    let key = StorageKey::from_bytes([77; 32]);
    let conn = Connection::open(&from).unwrap();
    conn.execute_batch("PRAGMA auto_vacuum=1; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=4; PRAGMA application_id=1234; CREATE TABLE notes(id INTEGER PRIMARY KEY,body TEXT,data BLOB); CREATE TABLE audit(id); CREATE TRIGGER updated AFTER UPDATE ON notes BEGIN INSERT INTO audit VALUES(new.id); END; CREATE INDEX bodies ON notes(body);").unwrap();
    conn.execute(
        "INSERT INTO notes VALUES(1,?1,?2)",
        rusqlite::params!["private-copy-marker 한글", vec![0u8, 1, 2, 255]],
    )
    .unwrap();
    let before = std::fs::read(&from).unwrap();
    copy_plaintext(&from, &to, &key).unwrap();
    assert_eq!(std::fs::read(&from).unwrap(), before);
    let encrypted = std::fs::read(&to).unwrap();
    assert!(!encrypted.starts_with(b"SQLite format 3\0"));
    assert!(!encrypted.windows(19).any(|w| w == b"private-copy-marker"));
    let reopened = inkism_storage::open(&to, Some(&key)).unwrap();
    let row: (String, Vec<u8>) = reopened
        .query_row("SELECT body,data FROM notes WHERE id=1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(
        row,
        ("private-copy-marker 한글".into(), vec![0u8, 1, 2, 255])
    );
    assert_eq!(
        reopened
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
    assert_eq!(
        reopened
            .query_row("PRAGMA application_id", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1234
    );
    assert_eq!(
        reopened
            .query_row("PRAGMA auto_vacuum", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    reopened
        .execute("UPDATE notes SET body='changed'", [])
        .unwrap();
    assert_eq!(
        reopened
            .query_row("SELECT count(*) FROM audit", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(copy_plaintext(&from, &to, &key).is_err());
    assert_eq!(
        conn.query_row("SELECT body FROM notes", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "private-copy-marker 한글"
    );
}
#[test]
fn invalid_source_and_foreign_keys_never_publish_a_partial_copy() {
    let f = Fixture::new();
    let source = f.0.join("invalid.db");
    let dest = f.0.join("dest.db");
    let key = StorageKey::from_bytes([78; 32]);
    std::fs::write(&source, b"not SQLite").unwrap();
    assert!(copy_plaintext(&source, &dest, &key).is_err());
    assert!(!dest.exists());
    assert_eq!(std::fs::read_dir(&f.0).unwrap().count(), 1);
    std::fs::remove_file(&source).unwrap();
    let conn = Connection::open(&source).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=OFF; CREATE TABLE parent(id PRIMARY KEY);CREATE TABLE child(p REFERENCES parent(id));INSERT INTO child VALUES(99);").unwrap();
    drop(conn);
    assert!(copy_plaintext(&source, &dest, &key).is_err());
    assert!(!dest.exists());
    assert_eq!(std::fs::read_dir(&f.0).unwrap().count(), 1);
    assert!(copy_plaintext(&f.0.join("missing.db"), &dest, &key).is_err());
    assert!(!dest.exists());
}

#[test]
fn copied_note_and_fts_databases_preserve_ids_history_workspace_and_search() {
    use inkism_engine::Engine;
    use serde_json::{json, Value};
    fn ok(value: Value) -> Value {
        assert_eq!(value["ok"], true, "{value}");
        value["data"].clone()
    }
    let f = Fixture::new();
    let source = f.0.join("source.db");
    let dest = f.0.join("encrypted.db");
    let key = StorageKey::from_bytes([79; 32]);
    let id;
    let history;
    {
        let e = Engine::open(source.to_str().unwrap()).unwrap();
        let saved=ok(e.execute(json!({"op":"save","note":{"title":"보존 제목","content":"<p>원본검색어</p>","text":"원본검색어","tags":["보존태그"]}})));
        id = saved["id"].clone();
        ok(e.execute(json!({"op":"save","note":{"id":id,"revision":saved["revision"],"content":"<p><strong>수정검색어</strong></p>","text":"수정검색어"}})));
        ok(e.execute(json!({"op":"workspace_set","ids":[id],"active":id})));
        assert_eq!(e.wait_index(10000).unwrap(), 0);
        history = ok(e.execute(json!({"op":"history","id":id})));
    }
    copy_plaintext(&source, &dest, &key).unwrap();
    copy_plaintext(
        Path::new(&format!("{}.search", source.display())),
        Path::new(&format!("{}.search", dest.display())),
        &key,
    )
    .unwrap();
    let e = Engine::open_encrypted(dest.to_str().unwrap(), key).unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":id})))["content"],
        "<p><strong>수정검색어</strong></p>"
    );
    assert_eq!(ok(e.execute(json!({"op":"history","id":id}))), history);
    assert_eq!(ok(e.execute(json!({"op":"workspace_get"})))["active"], id);
    assert_eq!(e.wait_index(10000).unwrap(), 0);
    assert_eq!(
        ok(e.execute(json!({"op":"list","view":"all","query":"수정검색어"})))["items"][0]["id"],
        id
    );
    assert_eq!(ok(e.execute(json!({"op":"list","view":"all","sort_by":"title"})))["items"][0]["id"], id);
    let key: String = e.connection().query_row("SELECT title_order FROM notes_meta WHERE id=?1",
        [id.as_str().unwrap()], |row| row.get(0)).unwrap();
    assert_eq!(key, "보존 제목");
}
