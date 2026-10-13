//! Test fixture engine (built by `cargo test`, used by `engine::fake::fixture_engine`).
//! As an RPC child it marks the library as running and answers `get` with the
//! library bytes; as a copy child it fails if the RPC child still owns the
//! library, then waits for a `.release` marker before copying.
use std::io::{BufRead, Write};
use std::path::Path;
use std::time::Duration;

/// Marks the library as owned by the RPC child.
const RUNNING_SUFFIX: &str = ".running";

fn marker(source: &str, suffix: &str) -> String {
    format!("{source}{suffix}")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let source = &args[2];
    if args.len() > 3 {
        if Path::new(&marker(source, RUNNING_SUFFIX)).exists() {
            std::process::exit(21);
        }
        let destination = Path::new(&args[4]);
        let _ = std::fs::write(marker(source, ".copying"), "started");
        while !Path::new(&marker(source, ".release")).exists() {
            std::thread::sleep(Duration::from_millis(10));
        }
        if destination.file_name().is_some_and(|name| name == "fail") {
            eprintln!("fixture copy failure");
            std::process::exit(22);
        }
        if std::fs::create_dir(destination).is_err() {
            std::process::exit(23);
        }
        let body = std::fs::read(source).unwrap_or_default();
        let _ = std::fs::write(destination.join("notes.db"), body);
        return;
    }
    let running = marker(source, RUNNING_SUFFIX);
    if std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&running)
        .is_err()
    {
        std::process::exit(24);
    }
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let op = serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .and_then(|request| request["op"].as_str().map(str::to_owned));
        let reply = if op.as_deref() == Some("get") {
            let body = std::fs::read(source).unwrap_or_default();
            serde_json::json!({"ok": true, "data": String::from_utf8_lossy(&body)}).to_string()
        } else {
            r#"{"ok":true,"data":{}}"#.to_owned()
        };
        if writeln!(out, "{reply}").and_then(|()| out.flush()).is_err() {
            break;
        }
    }
    let _ = std::fs::remove_file(&running);
}
