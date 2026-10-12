//! inkism-engine: thin JSONL adapter. Protocol on stdout only, diagnostics
//! on stderr. One request line -> one response line, flushed immediately.
//! Lines larger than MAX_REQUEST_LINE_BYTES are drained and rejected without
//! being parsed (field limits live in limits.rs / the engine).

use inkism_engine::{limits, protocol::read_line_capped, Engine};
use serde_json::{json, Value};
use std::io::{BufReader, Write};

fn main() {
    let Some(db) = parse_args() else { return };

    let engine = match Engine::open(&db) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("inkism-engine: cannot open {db}: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("inkism-engine: ready db={db}");

    let mut reader = BufReader::with_capacity(256 * 1024, std::io::stdin().lock());
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let mut line: Vec<u8> = Vec::with_capacity(64 * 1024);
    loop {
        let got = match read_line_capped(&mut reader, &mut line, limits::MAX_REQUEST_LINE_BYTES) {
            Ok(g) => g,
            Err(e) => {
                eprintln!("inkism-engine: stdin read error: {e}");
                return;
            }
        };
        let Some(over) = got else { break };
        let Some(response) = respond(&engine, &line, over) else {
            continue; // blank line: no response
        };
        if writeln!(out, "{response}").is_err() || out.flush().is_err() {
            return; // parent closed the pipe
        }
    }
}

/// Returns the database path, or `None` after `--version`/`--help`.
/// Exits with status 2 on bad arguments.
fn parse_args() -> Option<String> {
    let mut db: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--db" => db = args.next(),
            "--version" | "-V" => {
                println!("inkism-engine {}", env!("CARGO_PKG_VERSION"));
                return None;
            }
            "--help" | "-h" => {
                println!("usage: inkism-engine --db PATH");
                println!("  JSON lines on stdin, responses on stdout. See .private/docs/protocol.md.");
                return None;
            }
            other => {
                eprintln!("inkism-engine: unknown argument {other:?} (use --db PATH)");
                std::process::exit(2);
            }
        }
    }
    match db {
        Some(d) if !d.trim().is_empty() => Some(d),
        _ => {
            eprintln!("inkism-engine: --db PATH is required");
            std::process::exit(2);
        }
    }
}

/// Response for one request line; `None` for a blank line.
fn respond(engine: &Engine, line: &[u8], over: bool) -> Option<Value> {
    if over {
        return Some(json!({
            "ok": false,
            "error": format!(
                "request line exceeds {} bytes",
                limits::MAX_REQUEST_LINE_BYTES
            )
        }));
    }
    let start = line
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(line.len());
    let end = line
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map(|p| p + 1)
        .unwrap_or(start);
    let trimmed = &line[start..end];
    if trimmed.is_empty() {
        return None;
    }
    Some(match serde_json::from_slice::<Value>(trimmed) {
        Ok(req) => engine.execute(req),
        Err(e) => json!({ "ok": false, "error": format!("bad JSON: {e}") }),
    })
}
