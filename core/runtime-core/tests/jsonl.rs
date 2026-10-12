//! Exercises the deployed process adapter, not just the library API.
use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn blank_lines_and_unterminated_final_request_preserve_protocol() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_inkism-engine"))
        .arg("--db")
        .arg(dir.path().join("한글 노트.db"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    input
        .write_all(b"\n\r\n{\"op\":\"health\"}\n\n{\"op\":\"sync_status\"}")
        .unwrap();
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    let responses: Vec<Value> = stdout
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(responses.len(), 2, "{stdout}");
    assert_eq!(responses[0]["ok"], true);
    assert_eq!(responses[1]["data"]["configured"], false);
}
