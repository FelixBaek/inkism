#![cfg(feature = "encrypted-storage")]
use inkism_engine::{attachments::AttachmentStore, storage::StorageKey, Engine};
use serde_json::{json, Value};
use std::{io::Cursor, path::PathBuf};
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("inkism-encrypted-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&p).unwrap();
        Self(p)
    }
    fn db(&self) -> String {
        self.0.join("한글.db").to_str().unwrap().to_owned()
    }
    fn no_plaintext(&self) {
        for file in std::fs::read_dir(&self.0).unwrap() {
            let bytes = std::fs::read(file.unwrap().path()).unwrap();
            for needle in [
                b"private-body-marker".as_slice(),
                b"private-file-marker".as_slice(),
                b"private-title-marker".as_slice(),
            ] {
                assert!(
                    !bytes.windows(needle.len()).any(|x| x == needle),
                    "plaintext found on disk"
                );
            }
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn key() -> StorageKey {
    StorageKey::from_bytes([0x42; 32])
}
#[test]
fn encrypted_main_search_history_wal_and_attachments_reopen() {
    let f = Fixture::new();
    let path = f.db();
    let note;
    {
        let e = Engine::open_encrypted(&path, key()).unwrap();
        note=ok(e.execute(json!({"op":"save","note":{"title":"private-title-marker","reminder_at":1000,"reminder_repeat_hours":24,"content":"<p>private-body-marker 한글검색</p>","text":"private-body-marker 한글검색"}})));
        assert_eq!(e.wait_index(10000).unwrap(), 0); // Populate the old encrypted block cache first.
        ok(e.execute(json!({"op":"save","note":{"id":note["id"],"revision":note["revision"],"content":"<p>private-body-marker 수정내용</p>","text":"private-body-marker 수정내용"}})));
        assert_eq!(e.wait_index(10000).unwrap(), 0);
        let list = ok(e.execute(json!({"op":"list","view":"all","query":"private-body-marker"})));
        assert_eq!(list["items"][0]["id"], note["id"]);
        assert!(!ok(e.execute(json!({"op":"history","id":note["id"]})))
            .as_array()
            .unwrap()
            .is_empty());
        f.no_plaintext(); // Includes live main/search WAL and shared-memory files.
    }
    assert!(Engine::open(&path).is_err());
    assert!(Engine::open_encrypted(&path, StorageKey::from_bytes([0x43; 32])).is_err());
    let e = Engine::open_encrypted(&path, key()).unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":note["id"]})))["reminder_repeat_hours"],
        24
    );
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":note["id"]})))["content"],
        "<p>private-body-marker 수정내용</p>"
    );
    assert_eq!(e.wait_index(10000).unwrap(), 0);
    assert_eq!(
        ok(e.execute(json!({"op":"list","view":"all","query":"수정내용"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let page =
        ok(e.execute(json!({"op":"document_blocks","id":note["id"],"revision":2,"limit":1})));
    assert_eq!(page["ready"], true);
    assert_eq!(
        page["blocks"][0]["html"],
        "<p>private-body-marker 수정내용</p>"
    );
    let inserted = "<p>private-body-marker 앞에 추가😀</p>";
    ok(e.execute(
        json!({"op":"document_splice_html","id":note["id"],"revision":2,
        "edits":[{"start":0,"expected":"","replacement":inserted}]}),
    ));
    assert_eq!(e.wait_index(10000).unwrap(), 0);
    drop(e);
    let e = Engine::open_encrypted(&path, key()).unwrap();
    let moved =
        ok(e.execute(json!({"op":"document_blocks","id":note["id"],"revision":3,"limit":2})));
    assert_eq!(moved["total_blocks"], 2);
    assert_eq!(moved["blocks"][0]["html"], inserted);
    assert_eq!(moved["blocks"][1]["byte_offset"], inserted.len());
    assert_eq!(
        moved["blocks"][1]["html"],
        "<p>private-body-marker 수정내용</p>"
    );
    let attachment_path = f.0.join("첨부.db");
    let id;
    {
        let mut store = AttachmentStore::open_encrypted(&attachment_path, &key()).unwrap();
        id = store
            .import_reader(
                "private-title-marker.txt",
                "text/plain",
                Cursor::new(b"private-file-marker"),
            )
            .unwrap()
            .id;
        f.no_plaintext();
    }
    assert!(AttachmentStore::open(&attachment_path).is_err());
    assert!(
        AttachmentStore::open_encrypted(&attachment_path, &StorageKey::from_bytes([0x43; 32]))
            .is_err()
    );
    let store = AttachmentStore::open_encrypted(&attachment_path, &key()).unwrap();
    let mut bytes = vec![];
    store.copy_to(&id, &mut bytes).unwrap();
    assert_eq!(bytes, b"private-file-marker");
    assert_eq!(format!("{:?}", key()), "StorageKey([REDACTED])");
}
#[test]
fn applying_key_to_plaintext_fails_without_rewriting_it() {
    let f = Fixture::new();
    let path = f.db();
    let id;
    {
        let e = Engine::open(&path).unwrap();
        id=ok(e.execute(json!({"op":"save","note":{"title":"keep","content":"<p>original</p>","text":"original"}})))["id"].clone();
    }
    let original = std::fs::read(&path).unwrap();
    assert!(Engine::open_encrypted(&path, key()).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    let e = Engine::open(&path).unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":id})))["content"],
        "<p>original</p>"
    );
}
