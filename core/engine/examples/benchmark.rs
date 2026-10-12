//! Benchmark: N notes (default 100,000) + search/list latency + file size.
//!
//! Usage: cargo run --release --example benchmark -- --notes 100000 --db PATH
//! For encryption: enable encrypted-storage and pass --encrypted. The fixed public
//! key is ONLY for the synthetic data generated here; never use it for real notes.
//!
//! Safety: refuses to open an existing database file — benchmarks always
//! create their own fresh library so a user database can never be modified.
//!
//! Measured (see output for the exact environment note):
//!   * sequential save throughput (JSON-RPC path, background jobs coalesced)
//!   * time until the background index queue drains (wait_index)
//!   * list pagination: 20 single pages (50/page) + one full keyset walk
//!   * search: FTS trigram queries (3-char Korean substrings) and a
//!     short-query title search, p50/p95 over repeated runs
//!   * on-disk size of both SQLite files
//!
//! Honesty: numbers are for THIS machine and THIS synthetic corpus only; no
//! claim is made about unbounded scale.

use inkism_engine::Engine;
use serde_json::{json, Value};
use std::time::Instant;

fn main() {
    let (notes, db, encrypted) = parse_args();
    refuse_existing_db(&db);

    assert!(notes > 0, "benchmark requires at least one note");
    println!("inkism benchmark: notes={notes} encrypted={encrypted} db={db}");
    let engine = open_engine(&db, encrypted);

    bench_insert_and_index(&engine, notes);
    bench_list(&engine, notes);
    bench_search(&engine, notes);
    print_file_sizes(&engine, &db);
    println!(
        "environment: {} ({} cores) — numbers are local and synthetic; not a claim about unbounded scale",
        std::env::consts::OS,
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0)
    );
    // Engine::drop joins the worker; both files are closed cleanly.
}

/// Returns `(notes, db, encrypted)`; exits on bad arguments or `--help`.
fn parse_args() -> (usize, String, bool) {
    let mut notes: usize = 100_000;
    let mut db: Option<String> = None;
    let mut encrypted = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--notes" | "-n" => {
                notes = args.next().and_then(|v| v.parse().ok()).unwrap_or(notes);
            }
            "--db" => db = args.next(),
            "--encrypted" => encrypted = true,
            "--help" | "-h" => {
                println!(
                    "usage: benchmark --notes N --db PATH [--encrypted] (PATH must not exist)"
                );
                std::process::exit(0);
            }
            other => {
                eprintln!("unknown argument {other:?}");
                std::process::exit(2);
            }
        }
    }
    let db = db.unwrap_or_else(|| {
        eprintln!("--db PATH is required (refusing to guess: user DBs must not be touched)");
        std::process::exit(2);
    });
    (notes, db, encrypted)
}

fn refuse_existing_db(db: &str) {
    for suffix in ["", ".search", "-wal", "-shm", ".search-wal", ".search-shm"] {
        let p = format!("{db}{suffix}");
        if std::path::Path::new(&p).exists() {
            eprintln!("refusing: {p} already exists (benchmark requires a fresh file)");
            std::process::exit(2);
        }
    }
}

fn open_engine(db: &str, encrypted: bool) -> Engine {
    if encrypted {
        #[cfg(feature = "encrypted-storage")]
        {
            // PUBLIC synthetic benchmark key. Never use this example for real data.
            Engine::open_encrypted(
                db,
                inkism_engine::storage::StorageKey::from_bytes([0xB7; 32]),
            )
            .expect("open encrypted benchmark db")
        }
        #[cfg(not(feature = "encrypted-storage"))]
        panic!("rebuild with --features encrypted-storage; no database was created");
    } else {
        Engine::open(db).expect("open benchmark db")
    }
}

fn bench_insert_and_index(engine: &Engine, notes: usize) {
    // ---- bulk insert ------------------------------------------------------
    let started = Instant::now();
    let batch = 500;
    for b in 0..notes.div_ceil(batch) {
        let start = b * batch;
        let end = (start + batch).min(notes);
        for i in start..end {
            let req = make_note(i);
            let res = engine.execute(req);
            if res.get("ok").and_then(Value::as_bool) != Some(true) {
                eprintln!("save failed at {i}: {res}");
                std::process::exit(1);
            }
        }
        if (b + 1) % 20 == 0 {
            let done = end;
            let elapsed = started.elapsed().as_secs_f64();
            eprintln!(
                "  saved {done}/{notes} ({:.0} notes/s)",
                done as f64 / elapsed
            );
        }
    }
    let insert_s = started.elapsed().as_secs_f64();

    // ---- wait for the background index ------------------------------------
    let wait_started = Instant::now();
    let pending = loop {
        let response = engine.execute(json!({ "op": "wait_index" }));
        assert_eq!(response["ok"], true, "index wait failed: {response}");
        let pending = response["data"]["pending"].as_i64().expect("pending count");
        if pending == 0 {
            break pending;
        }
        assert!(
            wait_started.elapsed().as_secs() < 300,
            "index failed to drain: {pending}"
        );
    };
    let index_wait_s = wait_started.elapsed().as_secs_f64();
    println!(
        "insert: {notes} notes in {insert_s:.2}s ({:.0}/s)",
        notes as f64 / insert_s
    );
    println!("index drain (wait_index): {index_wait_s:.2}s, pending left: {pending}");
}

fn bench_list(engine: &Engine, notes: usize) {
    // ---- list latency ------------------------------------------------------
    let mut page_lat: Vec<f64> = Vec::with_capacity(21);
    for _ in 0..20 {
        let t = Instant::now();
        let response = engine.execute(json!({ "op": "list", "view": "all", "limit": 50 }));
        assert_eq!(response["ok"], true, "list failed: {response}");
        assert_eq!(
            response["data"]["items"].as_array().unwrap().len(),
            notes.min(50)
        );
        for item in response["data"]["items"].as_array().unwrap() {
            assert!(
                item.get("content").is_none() && item.get("text").is_none(),
                "list returned full bodies"
            );
        }
        page_lat.push(t.elapsed().as_secs_f64() * 1e3);
    }
    let walk_started = Instant::now();
    let mut total = 0usize;
    let mut cursor: Option<String> = None;
    loop {
        let mut req = json!({ "op": "list", "view": "all", "limit": 100 });
        if let Some(c) = &cursor {
            req["cursor"] = json!(c);
        }
        let res = engine.execute(req);
        assert_eq!(res["ok"], true, "page failed: {res}");
        let data = res.get("data").cloned().unwrap_or(Value::Null);
        let items = data
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        total += items.len();
        cursor = data
            .get("next_cursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(total, notes, "pagination did not visit every note");
    let walk_s = walk_started.elapsed().as_secs_f64();
    page_lat.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p = |q: f64| {
        page_lat[((page_lat.len() as f64) * q)
            .min(page_lat.len() as f64 - 1.0)
            .round() as usize]
    };
    println!(
        "list page(50): p50 {:.2}ms p95 {:.2}ms | full walk {} notes in {:.2}s ({:.0} notes/s)",
        p(0.5),
        p(0.95),
        total,
        walk_s,
        total as f64 / walk_s
    );
}

fn bench_search(engine: &Engine, notes: usize) {
    // ---- search latency ----------------------------------------------------
    let mut searches: Vec<String> = Vec::new();
    for i in 0..10 {
        // Existing 7-char Korean+digit substrings ("제001000" style serials).
        searches.push(format!("제{:06}", (1000 + i * 977) % notes.max(1)));
    }
    searches.push("회의 메모".into()); // common Korean phrase: hits everything
    searches.push("회의".into()); // 2 chars: explicit short-query (title LIKE) path
    let mut lat: Vec<f64> = Vec::with_capacity(searches.len() * 5);
    for q in &searches {
        for _ in 0..5 {
            let t = Instant::now();
            let res =
                engine.execute(json!({ "op": "list", "view": "all", "limit": 50, "query": q }));
            assert_eq!(res["ok"], true, "search failed: {res}");
            let hits = res
                .pointer("/data/items")
                .and_then(Value::as_array)
                .map(|a| a.len())
                .unwrap_or(0);
            assert!(hits > 0, "expected matching notes for {q}");
            if q == &searches[0] {
                println!("  sample search {:?} (limit 50) -> {hits} hits", q);
            }
            lat.push(t.elapsed().as_secs_f64() * 1e3);
        }
    }
    lat.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p = |q: f64| lat[((lat.len() as f64) * q).min(lat.len() as f64 - 1.0).round() as usize];
    println!(
        "search: p50 {:.2}ms p95 {:.2}ms ({} queries x5)",
        p(0.5),
        p(0.95),
        searches.len()
    );
}

fn print_file_sizes(engine: &Engine, db: &str) {
    // ---- file sizes ---------------------------------------------------------
    // Fold WAL back into the main file first so the size is steady-state.
    let _ = engine
        .connection()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    for (name, path) in [("main", db.to_string()), ("search", format!("{db}.search"))] {
        let mut size = 0u64;
        for suffix in ["", "-wal", "-shm"] {
            if let Ok(md) = std::fs::metadata(format!("{path}{suffix}")) {
                size += md.len();
            }
        }
        println!(
            "size {name}: {size} bytes ({:.1} MiB)",
            size as f64 / 1048576.0
        );
    }
}

// Keep compatibility with the declared Rust 1.75 baseline.
#[allow(clippy::manual_is_multiple_of)]
fn make_note(i: usize) -> Value {
    let korean = format!("제목 회의 메모 제{i:06} — 팀 주간 회의 내용을 정리한 노트입니다");
    let body = format!(
        "본문 내용 제{i:06}입니다. [[회의 메모 제{:06}]] 참고. note:///no-id-here. {}",
        i ^ 7,
        "The quick brown fox jumps over the lazy dog. ".repeat(30)
    );
    json!({
        "op": "save",
        "note": {
            "title": korean,
            "content": format!("<p>{body}</p>"),
            "text": body,
            "tags": ["bench", if i % 3 == 0 { "korean" } else { "english" }],
        }
    })
}
