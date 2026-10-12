//! `inkism-engine`: JSONL adapter over [`inkism_runtime::AppCore`].
//!
//! Same wire contract as the storage engine (.private/docs/protocol.md) plus the
//! runtime-owned sync ops. One request line in, one response line out; stdout
//! is protocol only, stderr is diagnostics.

mod attachment_cli;

use inkism_engine::{limits, protocol::read_line_capped};
use inkism_runtime::AppCore;
use serde_json::{json, Value};
use std::io::{BufReader, Write};

struct Args {
    db: Option<String>,
    initialize_encrypted: bool,
    check_library: bool,
    copy_encrypted_to: Option<String>,
    attachment_op: String,
    attachment_id: String,
    attachment_name: String,
    attachment_type: String,
}

fn main() {
    let Some(args) = parse_args() else {
        return;
    };
    let db = match &args.db {
        Some(d) if !d.trim().is_empty() => d.clone(),
        _ => {
            eprintln!("inkism-engine: --db PATH is required");
            std::process::exit(2);
        }
    };

    if args.check_library {
        check_library(&db, &args);
        return;
    }
    if let Some(destination) = &args.copy_encrypted_to {
        copy_encrypted(&db, destination, &args);
        return;
    }
    if args.initialize_encrypted {
        initialize_encrypted(&db, &args);
    }
    if !args.attachment_op.is_empty() {
        if let Err(error) = attachment_cli::run(
            &db,
            &args.attachment_op,
            &args.attachment_id,
            &args.attachment_name,
            &args.attachment_type,
        ) {
            eprintln!("attachment: {error}");
            std::process::exit(1);
        }
        return;
    }

    let core = match AppCore::open(&db) {
        Ok(core) => core,
        Err(e) => {
            eprintln!("inkism-engine: cannot open {db}: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("inkism-engine: ready db={db}");

    let mut reader = BufReader::with_capacity(256 * 1024, std::io::stdin().lock());
    let mut out = std::io::stdout().lock();
    let mut line: Vec<u8> = Vec::with_capacity(64 * 1024);
    loop {
        let over = match read_line_capped(&mut reader, &mut line, limits::MAX_REQUEST_LINE_BYTES) {
            Ok(Some(over)) => over,
            Ok(None) => break,
            Err(e) => {
                eprintln!("inkism-engine: stdin read error: {e}");
                return;
            }
        };
        let Some(response) = respond(&core, &line, over) else {
            continue;
        };
        if writeln!(out, "{response}").is_err() || out.flush().is_err() {
            return;
        }
    }
    // AppCore::drop stops the worker without blocking the foreground.
}

/// Command-line flags; None after `--version`/`--help` printed their output.
fn parse_args() -> Option<Args> {
    let mut parsed = Args {
        db: None,
        initialize_encrypted: false,
        check_library: false,
        copy_encrypted_to: None,
        attachment_op: String::new(),
        attachment_id: String::new(),
        attachment_name: String::new(),
        attachment_type: "application/octet-stream".to_string(),
    };
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--db" => parsed.db = args.next(),
            "--check-library" => parsed.check_library = true,
            "--initialize-encrypted" => parsed.initialize_encrypted = true,
            "--copy-encrypted-to" => {
                parsed.copy_encrypted_to = Some(args.next().unwrap_or_default());
            }
            "--attachment-list" => parsed.attachment_op = "list".into(),
            "--attachment-import" => parsed.attachment_op = "import".into(),
            "--attachment-info" | "--attachment-export" => {
                parsed.attachment_op = a.trim_start_matches("--attachment-").into();
                parsed.attachment_id = args.next().unwrap_or_default();
            }
            "--attachment-name" => parsed.attachment_name = args.next().unwrap_or_default(),
            "--attachment-type" => parsed.attachment_type = args.next().unwrap_or_default(),
            "--version" | "-V" => {
                println!("inkism-engine {}", env!("CARGO_PKG_VERSION"));
                return None;
            }
            "--help" | "-h" => {
                println!("usage: inkism-engine --db PATH [--initialize-encrypted]");
                println!(
                    "  --check-library: inspect an existing library without migration or sync"
                );
                println!(
                    "  --copy-encrypted-to NEW_DIRECTORY: copy a closed plaintext library and exit"
                );
                println!("  JSON lines on stdin, responses on stdout. See .private/docs/protocol.md.");
                return None;
            }
            other => {
                eprintln!("inkism-engine: unknown argument {other:?} (use --db PATH)");
                std::process::exit(2);
            }
        }
    }
    Some(parsed)
}

fn check_library(db: &str, args: &Args) {
    if args.initialize_encrypted
        || args.copy_encrypted_to.is_some()
        || !args.attachment_op.is_empty()
    {
        eprintln!("library check cannot be combined with mutations");
        std::process::exit(2);
    }
    match inkism_runtime::library_check::check(db) {
        Ok(()) => println!("{}", json!({"ok":true})),
        Err(error) => {
            eprintln!("library check: {error}");
            std::process::exit(1);
        }
    }
}

fn copy_encrypted(db: &str, destination: &str, args: &Args) {
    if destination.trim().is_empty() || args.initialize_encrypted || !args.attachment_op.is_empty()
    {
        eprintln!("copy requires a new directory and cannot be combined with initialization or attachments");
        std::process::exit(2);
    }
    match inkism_runtime::migration::copy_encrypted(db, std::path::Path::new(destination)) {
        Ok(path) => println!("{}", json!({"ok":true,"database":path})),
        Err(error) => {
            eprintln!("encrypted copy: {error}");
            std::process::exit(1);
        }
    }
}

fn initialize_encrypted(db: &str, args: &Args) {
    if !args.attachment_op.is_empty() {
        eprintln!("initialization cannot be combined with attachment operations");
        std::process::exit(2);
    }
    if let Err(error) = inkism_runtime::local_key::initialize(db) {
        eprintln!("encrypted initialization: {error}");
        std::process::exit(1);
    }
}

/// The response to one request line; None for a blank line.
fn respond(core: &AppCore, line: &[u8], over: bool) -> Option<Value> {
    if over {
        return Some(json!({
            "ok": false,
            "error": format!("request line exceeds {} bytes", limits::MAX_REQUEST_LINE_BYTES)
        }));
    }
    let trimmed = trim_ascii(line);
    if trimmed.is_empty() {
        return None;
    }
    Some(match serde_json::from_slice::<Value>(trimmed) {
        Ok(req) => core.execute(req),
        Err(e) => json!({ "ok": false, "error": format!("bad JSON: {e}") }),
    })
}

fn trim_ascii(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map(|p| p + 1)
        .unwrap_or(start);
    &bytes[start..end]
}
