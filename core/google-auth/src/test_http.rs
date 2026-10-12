//! Loopback HTTP mocks for tests. Every server binds 127.0.0.1:0.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn form(&self) -> HashMap<String, String> {
        url::form_urlencoded::parse(&self.body)
            .into_owned()
            .collect()
    }
}

pub type Handler = Arc<dyn Fn(Request) -> (u16, Vec<u8>) + Send + Sync>;

/// Starts a server on a random port and returns its `http://127.0.0.1:PORT` base.
pub fn serve(handler: impl Fn(Request) -> (u16, Vec<u8>) + Send + Sync + 'static) -> String {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handler: Handler = Arc::new(handler);
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let handler = handler.clone();
            thread::spawn(move || handle(stream, handler));
        }
    });
    base
}

pub fn json(status: u16, v: serde_json::Value) -> (u16, Vec<u8>) {
    (status, v.to_string().into_bytes())
}

fn handle(mut stream: TcpStream, handler: Handler) {
    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    let (head_len, request) = loop {
        let Ok(n) = stream.read(&mut buf) else { return };
        if n == 0 {
            return;
        }
        raw.extend_from_slice(&buf[..n]);
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut req = httparse::Request::new(&mut headers);
        if let Ok(httparse::Status::Complete(len)) = req.parse(&raw) {
            let headers: HashMap<String, String> = req
                .headers
                .iter()
                .map(|h| {
                    (
                        h.name.to_ascii_lowercase(),
                        String::from_utf8_lossy(h.value).into_owned(),
                    )
                })
                .collect();
            let request = Request {
                method: req.method.unwrap().into(),
                path: req.path.unwrap().into(),
                headers,
                body: Vec::new(),
            };
            break (len, request);
        }
    };
    let mut request = request;
    let length: usize = request
        .headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut body = raw[head_len..].to_vec();
    while body.len() < length {
        let Ok(n) = stream.read(&mut buf) else { return };
        if n == 0 {
            break;
        }
        body.extend_from_slice(&buf[..n]);
    }
    request.body = body;
    let (status, body) = handler(request);
    let _ = write!(
        stream,
        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(&body);
}

/// Sends one raw request; returns the status and lower-cased headers.
pub fn raw_request(
    base: &str,
    method: &str,
    target: &str,
    host: &str,
) -> (u16, HashMap<String, String>) {
    let addr = base.trim_start_matches("http://");
    let mut stream = TcpStream::connect(addr).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    write!(stream, "{method} {target} HTTP/1.1\r\nHost: {host}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).unwrap();
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut response = httparse::Response::new(&mut headers);
    response.parse(&raw).unwrap();
    let headers = response
        .headers
        .iter()
        .map(|h| {
            (
                h.name.to_ascii_lowercase(),
                String::from_utf8_lossy(h.value).into_owned(),
            )
        })
        .collect();
    (response.code.unwrap(), headers)
}

/// A closed loopback port: connections are refused.
pub fn closed_port() -> String {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    format!("http://{}", listener.local_addr().unwrap())
}
