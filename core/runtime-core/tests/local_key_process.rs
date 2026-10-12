//! Exercise the real process adapter, including separate attachment processes.
use std::{
    io::Write,
    path::Path,
    process::{Command, Output, Stdio},
};
fn run(db: &Path, args: &[&str], input: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_inkism-engine"))
        .arg("--db")
        .arg(db)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}
#[cfg(not(all(windows, feature = "encrypted-storage")))]
#[test]
fn unsupported_initialization_is_explicit_and_creates_no_files() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(&dir.path().join("new.db"), &["--initialize-encrypted"], b"");
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}
#[cfg(all(windows, feature = "encrypted-storage"))]
#[test]
fn windows_processes_share_dpapi_key_and_refuse_missing_or_corrupt_key() {
    use serde_json::{json, Value};
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("한글.db");
    let envelope = dir.path().join("한글.db.storage-key");
    let attachments = dir.path().join("한글.db.attachments");
    let request = |value: Value| format!("{value}\n").into_bytes();
    let save = request(
        json!({"op":"save","note":{"title":"private-process-title","content":"<p>private-process-body</p>","text":"private-process-body"}}),
    );
    // Match the desktop launch order: its coordination file already exists.
    let lock = dir.path().join("한글.db.lock");
    std::fs::write(&lock, b"").unwrap();
    let first = run(&db, &["--initialize-encrypted"], &save);
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let reply: Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(reply["ok"], true);
    let id = reply["data"]["id"].clone();
    let get = request(json!({"op":"get","id":id}));
    let reopened = run(&db, &[], &get);
    assert!(reopened.status.success());
    let note: Value = serde_json::from_slice(&reopened.stdout).unwrap();
    assert_eq!(note["data"]["content"], "<p>private-process-body</p>");
    let payload = b"private-process-file";
    let imported = run(
        &db,
        &["--attachment-import", "--attachment-name", "fixture.bin"],
        payload,
    );
    assert!(imported.status.success());
    let meta: Value = serde_json::from_slice(&imported.stdout).unwrap();
    let exported = run(
        &db,
        &["--attachment-export", meta["id"].as_str().unwrap()],
        b"",
    );
    assert!(exported.status.success());
    assert_eq!(exported.stdout, payload);
    for path in [&db, &attachments] {
        let raw = std::fs::read(path).unwrap();
        assert!(!raw.starts_with(b"SQLite format 3\0"));
        for marker in [b"private-process-body".as_slice(), payload] {
            assert!(!raw.windows(marker.len()).any(|v| v == marker));
        }
    }
    let original_db = std::fs::read(&db).unwrap();
    let original_files = std::fs::read(&attachments).unwrap();
    let key = std::fs::read(&envelope).unwrap();
    assert!(key.starts_with(b"MINDBOX-LOCAL-KEY-1\n"));
    assert!(!run(&db, &["--initialize-encrypted"], b"").status.success());
    assert_eq!(std::fs::read(&db).unwrap(), original_db);
    assert_eq!(std::fs::read(&envelope).unwrap(), key);
    std::fs::remove_file(&envelope).unwrap();
    assert!(!run(&db, &[], &get).status.success());
    assert!(!run(
        &db,
        &["--attachment-import", "--attachment-name", "unsafe.bin"],
        b""
    )
    .status
    .success());
    assert_eq!(std::fs::read(&attachments).unwrap(), original_files);
    std::fs::write(&envelope, b"corrupt-key").unwrap();
    assert!(!run(&db, &[], &get).status.success());
    assert!(!run(&db, &["--attachment-list"], b"").status.success());
    assert_eq!(std::fs::read(&envelope).unwrap(), b"corrupt-key");
    std::fs::write(&envelope, key).unwrap();
    assert!(run(&db, &[], &get).status.success());
}

#[test]
fn migration_rejects_incompatible_flags_without_creating_destination() {
    let dir = tempfile::tempdir().unwrap();
    let destination = dir.path().join("copy");
    for extra in ["--initialize-encrypted", "--attachment-list"] {
        let out = run(
            &dir.path().join("source.db"),
            &["--copy-encrypted-to", destination.to_str().unwrap(), extra],
            b"",
        );
        assert!(!out.status.success());
        assert!(!destination.exists());
    }
}

#[cfg(all(windows, feature = "encrypted-storage"))]
#[test]
fn windows_migration_creates_reopenable_copy_with_protected_key() {
    use serde_json::{json, Value};
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.db");
    let saved = run(&source, &[], b"{\"op\":\"save\",\"note\":{\"title\":\"copy\",\"content\":\"<p>preserved</p>\",\"text\":\"preserved\"}}\n");
    assert!(saved.status.success());
    let reply: Value = serde_json::from_slice(&saved.stdout).unwrap();
    let original = std::fs::read(&source).unwrap();
    let destination = dir.path().join("암호화 복사");
    let copied = run(
        &source,
        &["--copy-encrypted-to", destination.to_str().unwrap()],
        b"",
    );
    assert!(
        copied.status.success(),
        "{}",
        String::from_utf8_lossy(&copied.stderr)
    );
    assert_eq!(std::fs::read(&source).unwrap(), original);
    let target = destination.join("notes.db");
    assert!(destination.join("notes.db.storage-key").exists());
    let get = format!("{}\n", json!({"op":"get","id":reply["data"]["id"]}));
    let reopened = run(&target, &[], get.as_bytes());
    assert!(
        reopened.status.success(),
        "{}",
        String::from_utf8_lossy(&reopened.stderr)
    );
    let note: Value = serde_json::from_slice(&reopened.stdout).unwrap();
    assert_eq!(note["data"]["content"], "<p>preserved</p>");
    assert!(!run(
        &source,
        &["--copy-encrypted-to", destination.to_str().unwrap()],
        b""
    )
    .status
    .success());
}
