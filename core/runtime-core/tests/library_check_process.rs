use inkism_runtime::AppCore;
use std::process::Command;
#[test]
fn check_cli_is_readonly_and_rejects_mutation_flags() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    drop(AppCore::open(path.to_str().unwrap()).unwrap());
    let before = std::fs::read(&path).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_inkism-engine"))
        .args(["--db", path.to_str().unwrap(), "--check-library"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["ok"], true);
    for args in [
        vec!["--initialize-encrypted"],
        vec!["--copy-encrypted-to", "unused"],
        vec!["--attachment-import"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_inkism-engine"))
            .args(["--db", path.to_str().unwrap(), "--check-library"])
            .args(args)
            .output()
            .unwrap();
        assert!(!output.status.success());
    }
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(!dir.path().join("notes.db.storage-key").exists());
    let foreign = dir.path().join("foreign.db");
    let conn = rusqlite::Connection::open(&foreign).unwrap();
    conn.execute_batch("CREATE TABLE foreign_data(value TEXT)")
        .unwrap();
    drop(conn);
    let before = std::fs::read(&foreign).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_inkism-engine"))
        .args(["--db", foreign.to_str().unwrap(), "--check-library"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(std::fs::read(&foreign).unwrap(), before);
}
