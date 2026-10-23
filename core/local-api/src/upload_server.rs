//! Loopback upload server (Go `upload_server.go`).
//!
//! WebView2's intercepted multipart requests can omit disk-backed File bytes,
//! so uploads use the browser's normal network stack. The random capability
//! is disclosed only through the in-process `/api/upload-access`.

use crate::attachments::{random_hex, MAX_ATTACHMENT_BYTES};
use crate::{Engine, Handler, Request, Response, SessionGate, UploadAccess};
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioIo, TokioTimer};
use std::convert::Infallible;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;
use tokio::sync::oneshot;

const APP_ORIGIN: &str = "http://wails.localhost";

type Forward = Arc<dyn Fn(Request) -> Response + Send + Sync>;

pub struct UploadServer {
    pub access: UploadAccess,
    shutdown: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl UploadServer {
    /// Closes the listener and every open connection; idempotent.
    pub fn close(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for UploadServer {
    fn drop(&mut self) {
        self.close();
    }
}

/// Starts the upload server on `127.0.0.1:0`. Authenticated requests go to a
/// `Handler` of their own, which still checks Host, gate, size and format.
pub fn start_upload_server(engine: Arc<dyn Engine>, gate: Option<Arc<SessionGate>>) -> std::io::Result<UploadServer> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let host = listener.local_addr()?.to_string();
    let handler = Handler { engine: Some(engine), gate, host, ..Default::default() };
    start(listener, Arc::new(move |r| handler.handle(&r)))
}

fn start(listener: std::net::TcpListener, forward: Forward) -> std::io::Result<UploadServer> {
    let host = listener.local_addr()?.to_string();
    let access = UploadAccess { url: format!("http://{host}"), token: random_hex(32) };
    listener.set_nonblocking(true)?;
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let (shutdown, mut stop) = oneshot::channel();
    let token = access.token.clone();
    let thread = std::thread::spawn(move || {
        runtime.block_on(async move {
            let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
            loop {
                let stream = tokio::select! {
                    _ = &mut stop => return,
                    accepted = listener.accept() => match accepted {
                        Ok((stream, _)) => stream,
                        Err(_) => continue,
                    },
                };
                let (host, token, forward) = (host.clone(), token.clone(), forward.clone());
                tokio::spawn(async move {
                    let service = service_fn(move |req| {
                        let (host, token, forward) = (host.clone(), token.clone(), forward.clone());
                        async move { Ok::<_, Infallible>(to_hyper(serve(req, &host, &token, forward).await)) }
                    });
                    // ponytail: Go's 30 s idle timeout is not enforced; close() drops every connection.
                    let mut http = http1::Builder::new();
                    http.timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(10));
                    let _ = http.serve_connection(TokioIo::new(stream), service).await;
                });
            }
        });
        // Dropping the runtime closes the listener and all connection tasks
        // without waiting for an in-flight engine call.
        runtime.shutdown_background();
    });
    Ok(UploadServer { access, shutdown: Some(shutdown), thread: Some(thread) })
}

async fn serve(req: hyper::Request<Incoming>, host: &str, token: &str, forward: Forward) -> Response {
    let header = |name: &str| req.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("");
    let request_host = req.headers().get(hyper::header::HOST).and_then(|v| v.to_str().ok()).or(req.uri().authority().map(|a| a.as_str())).unwrap_or("");
    // No wildcard CORS, cookies, unauthenticated mutations or non-upload routes.
    if request_host != host || header("origin") != APP_ORIGIN {
        return Response::fail(403, "invalid upload origin");
    }
    let path = req.uri().path().to_string();
    // ponytail: buffered whole like every Request; a restore bundle near Go's 64 GiB cap won't fit in RAM.
    let limit = match path.as_str() {
        "/api/attachments" => MAX_ATTACHMENT_BYTES + (1 << 20),
        "/api/import" => 512 << 20,
        "/api/restore" => (64 << 30) + (1 << 20),
        _ => return Response::fail(404, "unsupported upload route"),
    };
    let cors = |r: Response| r.with_header("access-control-allow-origin", APP_ORIGIN).with_header("vary", "Origin");
    if req.method() == hyper::Method::OPTIONS {
        if header("access-control-request-method") != "POST" {
            return cors(Response::fail(405, "POST required"));
        }
        let preflight = Response { file: None, status: 204, headers: Vec::new(), body: Vec::new() };
        return cors(preflight).with_header("access-control-allow-methods", "POST").with_header("access-control-allow-headers", "Authorization, Content-Type");
    }
    if req.method() != hyper::Method::POST {
        return cors(Response::fail(405, "POST required"));
    }
    if !constant_time_eq(header("authorization").as_bytes(), format!("Bearer {token}").as_bytes()) {
        return cors(Response::fail(403, "invalid upload token"));
    }
    // Origin was authenticated above; the handler still checks Host, size and format.
    let headers = req
        .headers()
        .iter()
        .filter(|(k, _)| *k != "origin" && *k != "sec-fetch-site")
        .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
        .collect();
    let (method, query) = (req.method().to_string(), req.uri().query().map(str::to_string));
    let request_host = request_host.to_string();
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    let body = match Limited::new(req.into_body(), limit).collect().await {
        Ok(body) => body.to_bytes().to_vec(),
        Err(e) if e.is::<http_body_util::LengthLimitError>() => return cors(Response::fail(413, "http: request body too large")),
        Err(e) => return cors(Response::fail(400, e)),
    };
    let request = Request { method, path, query, headers, host: request_host, body };
    match tokio::task::spawn_blocking(move || forward(request)).await {
        Ok(response) => cors(response),
        Err(_) => cors(Response::fail(500, "upload handler failed")),
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn to_hyper(mut r: Response) -> hyper::Response<Full<Bytes>> {
    // The forwarded handler already adds these; keep one copy of each.
    r.headers.retain(|(k, _)| k != "cache-control" && k != "x-content-type-options");
    let mut out = hyper::Response::new(Full::new(Bytes::from(r.body)));
    *out.status_mut() = hyper::StatusCode::from_u16(r.status).unwrap_or(hyper::StatusCode::INTERNAL_SERVER_ERROR);
    let headers = out.headers_mut();
    headers.insert(hyper::header::CACHE_CONTROL, hyper::header::HeaderValue::from_static("no-store"));
    headers.insert(hyper::header::X_CONTENT_TYPE_OPTIONS, hyper::header::HeaderValue::from_static("nosniff"));
    for (k, v) in r.headers {
        if let (Ok(k), Ok(v)) = (hyper::header::HeaderName::from_bytes(k.as_bytes()), hyper::header::HeaderValue::from_bytes(v.as_bytes())) {
            headers.append(k, v);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachments::tests::{multipart, Fake};
    use std::io::{Read, Write};

    /// Same server, but forwarding straight to the upload handler (the gate is a stub elsewhere).
    fn start_fake(fake: &Arc<Fake>) -> UploadServer {
        let handler = Handler { engine: Some(fake.clone() as Arc<dyn Engine>), ..Default::default() };
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        start(listener, Arc::new(move |r| crate::attachments::upload(&handler, &r))).unwrap()
    }

    /// Raw HTTP/1.1 exchange; `Err` when the server is unreachable.
    fn send(server_url: &str, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> std::io::Result<(u16, String, Vec<u8>)> {
        let addr = server_url.trim_start_matches("http://");
        let mut stream = std::net::TcpStream::connect(addr)?;
        let mut raw = format!("{method} {path} HTTP/1.1\r\nconnection: close\r\ncontent-length: {}\r\n", body.len());
        if !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("host")) {
            raw.push_str(&format!("host: {addr}\r\n"));
        }
        for (k, v) in headers {
            raw.push_str(&format!("{k}: {v}\r\n"));
        }
        raw.push_str("\r\n");
        stream.write_all(raw.as_bytes())?;
        stream.write_all(body)?;
        let mut reply = Vec::new();
        stream.read_to_end(&mut reply)?;
        let split = reply.windows(4).position(|w| w == b"\r\n\r\n").ok_or(std::io::ErrorKind::UnexpectedEof)?;
        let head = String::from_utf8_lossy(&reply[..split]).to_ascii_lowercase();
        let status = head.get(9..12).and_then(|s| s.parse().ok()).unwrap_or(0);
        Ok((status, head, reply[split + 4..].to_vec()))
    }

    #[test]
    fn requires_app_origin_token_and_upload_route() {
        let fake = Arc::new(Fake::default());
        let server = start_fake(&fake);
        let token = server.access.token.clone();
        let cases = [
            ("POST", "/api/attachments", "https://example.com", token.as_str(), "", 403),
            ("POST", "/api/attachments", "", token.as_str(), "", 403),
            ("POST", "/api/attachments", APP_ORIGIN, "", "", 403),
            ("POST", "/api/attachments", APP_ORIGIN, "wrong", "", 403),
            ("POST", "/api/attachments", APP_ORIGIN, token.as_str(), "evil.local", 403),
            ("GET", "/api/attachments", APP_ORIGIN, token.as_str(), "", 405),
            ("POST", "/api/rpc", APP_ORIGIN, token.as_str(), "", 404),
            ("GET", "/api/upload-access", APP_ORIGIN, token.as_str(), "", 404),
        ];
        for (method, path, origin, token, host, want) in cases {
            let bearer = format!("Bearer {token}");
            let mut headers = vec![("origin", origin), ("authorization", bearer.as_str())];
            if !host.is_empty() {
                headers.push(("host", host));
            }
            let (status, head, body) = send(&server.access.url, method, path, &headers, b"must not read").unwrap();
            assert_eq!(status, want, "{method} {path} origin={origin:?} token={token:?} host={host:?}: {}", String::from_utf8_lossy(&body));
            assert!(!String::from_utf8_lossy(&body).contains(&server.access.token), "capability leaked");
            assert!(head.contains("cache-control: no-store") && head.contains("x-content-type-options: nosniff"));
        }
        assert!(fake.data().is_empty(), "unauthorized request reached storage");
        let preflight = [("origin", APP_ORIGIN), ("access-control-request-method", "POST"), ("access-control-request-headers", "authorization,content-type")];
        let (status, head, _) = send(&server.access.url, "OPTIONS", "/api/attachments", &preflight, b"").unwrap();
        assert_eq!(status, 204, "app preflight rejected");
        assert!(head.contains("access-control-allow-origin: http://wails.localhost"));
    }

    #[test]
    fn streams_multipart_without_changing_bytes() {
        let fake = Arc::new(Fake::default());
        let mut server = start_fake(&fake);
        let content = [0u8, 1, 255, 128, 13, 10].repeat(350_000);
        let size = content.len().to_string();
        let (content_type, body) = multipart("한글 파일.bin", &content, Some(&size));
        let bearer = format!("Bearer {}", server.access.token);
        let headers = [("origin", APP_ORIGIN), ("authorization", bearer.as_str()), ("content-type", content_type.as_str()), ("sec-fetch-site", "cross-site")];
        let (status, head, result) = send(&server.access.url, "POST", "/api/attachments", &headers, &body).unwrap();
        assert_eq!(status, 201, "{}", String::from_utf8_lossy(&result));
        assert!(fake.data() == content, "multipart binary bytes changed");
        assert!(head.contains("access-control-allow-origin: http://wails.localhost"), "missing upload CORS");
        server.close();
        assert!(send(&server.access.url, "POST", "/api/attachments", &headers, &body).is_err(), "upload listener still running");
    }

    #[test]
    fn rejects_missing_file_payload_before_storage() {
        let fake = Arc::new(Fake::default());
        let server = start_fake(&fake);
        // Reproduce WebView2's missing File bytes.
        let (content_type, body) = multipart("nonempty.bin", b"", Some("600017"));
        let bearer = format!("Bearer {}", server.access.token);
        let headers = [("origin", APP_ORIGIN), ("authorization", bearer.as_str()), ("content-type", content_type.as_str())];
        let (status, _, _) = send(&server.access.url, "POST", "/api/attachments", &headers, &body).unwrap();
        assert_eq!(status, 400, "missing bytes");
        assert!(!fake.imported(), "missing file committed to storage");
    }

    #[test]
    fn real_handler_is_bound_to_the_listener_host() {
        let fake = Arc::new(Fake::default());
        let server = start_upload_server(fake, None).unwrap();
        assert!(server.access.url.starts_with("http://127.0.0.1:"));
        assert_eq!(server.access.token.len(), 64);
    }
}
