//! In-process test double for the Go relay contract.
//!
//! This is a test fixture, not a product stub: it implements exactly the
//! documented v1 wire contract (bearer auth, idempotent POST by id, byte-bounded
//! paged GET) so the Rust client can be exercised end-to-end without a running
//! Go process.

#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Clone, Debug, serde::Serialize)]
pub struct Record {
    pub seq: u64,
    pub id: String,
    pub blob: String,
}

struct State {
    token: String,
    records: Vec<Record>,
    by_id: HashMap<String, u64>,
}

/// A running relay bound to an ephemeral loopback port.
pub struct TestRelay {
    addr: String,
    shutdown: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
    state: Arc<Mutex<State>>,
}

impl TestRelay {
    /// Start a relay for `token`.
    pub fn start(token: &str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test relay");
        let addr = listener.local_addr().unwrap().to_string();
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        let state = Arc::new(Mutex::new(State {
            token: token.to_string(),
            records: Vec::new(),
            by_id: HashMap::new(),
        }));
        let shutdown = Arc::new(AtomicBool::new(false));
        let thread_state = Arc::clone(&state);
        let thread_shutdown = Arc::clone(&shutdown);
        let handle = thread::spawn(move || {
            while !thread_shutdown.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        // Winsock inherits the listener's nonblocking mode.
                        // The fixture reads complete HTTP messages, so accepted
                        // connections must explicitly return to blocking mode.
                        stream
                            .set_nonblocking(false)
                            .expect("blocking relay connection");
                        stream
                            .set_read_timeout(Some(Duration::from_secs(5)))
                            .unwrap();
                        stream
                            .set_write_timeout(Some(Duration::from_secs(5)))
                            .unwrap();
                        if let Err(error) = handle_connection(stream, &thread_state) {
                            eprintln!("test relay connection failed: {error}");
                        }
                    }
                    Err(ref err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });
        TestRelay {
            addr,
            shutdown,
            handle: Some(handle),
            state,
        }
    }

    /// Base URL to hand to the sync engine.
    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Snapshot of stored records (used to tamper with or inspect ciphertext).
    pub fn records(&self) -> Vec<Record> {
        self.state.lock().unwrap().records.clone()
    }

    /// Overwrite a stored blob, simulating a malicious or corrupt relay.
    pub fn tamper_blob(&self, seq: u64, new_blob: &str) {
        let mut state = self.state.lock().unwrap();
        for record in state.records.iter_mut() {
            if record.seq == seq {
                record.blob = new_blob.to_string();
            }
        }
    }
}

impl Drop for TestRelay {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // Wake the blocking accept loop.
        let _ = TcpStream::connect(&self.addr);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn handle_connection(mut stream: TcpStream, state: &Arc<Mutex<State>>) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let mut auth = String::new();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or(0);
        }
        if lower.starts_with("authorization:") {
            auth = line[line.find(':').unwrap() + 1..].trim().to_string();
        }
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path.to_string(), query.to_string()),
        None => (target.clone(), String::new()),
    };
    let expected = format!("Bearer {}", state.lock().unwrap().token);
    if auth != expected {
        return write_json(&mut stream, 401, "{\"error\":\"unauthorized\"}");
    }
    if path != "/v1/changes" {
        return write_json(&mut stream, 404, "{\"error\":\"not found\"}");
    }
    match method.as_str() {
        "POST" => handle_post(&mut stream, state, &body),
        "GET" => handle_get(&mut stream, state, &query),
        _ => write_json(&mut stream, 405, "{\"error\":\"method not allowed\"}"),
    }
}

fn handle_post(
    stream: &mut TcpStream,
    state: &Arc<Mutex<State>>,
    body: &[u8],
) -> std::io::Result<()> {
    let value: serde_json::Value = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(_) => return write_json(stream, 400, "{\"error\":\"invalid change\"}"),
    };
    let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let blob = value.get("blob").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() || blob.is_empty() {
        return write_json(stream, 400, "{\"error\":\"invalid change\"}");
    }
    let mut state = state.lock().unwrap();
    if let Some(&seq) = state.by_id.get(id) {
        let existing = state
            .records
            .iter()
            .find(|record| record.seq == seq)
            .unwrap();
        if existing.blob != blob {
            return write_json(
                stream,
                409,
                "{\"error\":\"id already has different payload\"}",
            );
        }
        let body = format!("{{\"seq\":{seq}}}");
        return write_json(stream, 200, &body);
    }
    let seq = state.records.len() as u64 + 1;
    state.records.push(Record {
        seq,
        id: id.to_string(),
        blob: blob.to_string(),
    });
    state.by_id.insert(id.to_string(), seq);
    write_json(stream, 200, &format!("{{\"seq\":{seq}}}"))
}

fn handle_get(
    stream: &mut TcpStream,
    state: &Arc<Mutex<State>>,
    query: &str,
) -> std::io::Result<()> {
    let mut after = 0u64;
    let mut limit = 50usize;
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            match key {
                "after" => after = value.parse().unwrap_or(0),
                "limit" => limit = value.parse().unwrap_or(50).clamp(1, 100),
                _ => {}
            }
        }
    }
    let state = state.lock().unwrap();
    let mut items = Vec::new();
    let mut cursor = after;
    let mut bytes = 0usize;
    for record in state.records.iter().filter(|record| record.seq > after) {
        if items.len() >= limit {
            break;
        }
        if !items.is_empty() && bytes + record.blob.len() > 40 << 20 {
            break;
        }
        bytes += record.blob.len();
        cursor = record.seq;
        items.push(record.clone());
    }
    let body = serde_json::json!({ "items": items, "cursor": cursor }).to_string();
    write_json(stream, 200, &body)
}

fn write_json(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}
