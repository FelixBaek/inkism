//! Web clipper pairing server (Go `clipper.go`).
//!
//! A browser extension pairs through the app (`/api/clipper` `pair`), then
//! posts one capture at a time to its own loopback listener. The capture waits
//! as `pending` until the user accepts (saved as a note) or discards it.

use crate::attachments::UploadAccess;
use crate::gate::{self, SessionGate};
use crate::{Handler, Request, Response, Result};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// Capture body limit (Go `webcontent.MaxBytes + 8192`).
const CAPTURE_LIMIT: usize = inkism_web_content::MAX_BYTES + 8192;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Clip {
    #[serde(skip)]
    note_id: String,
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    html: String,
    #[serde(default)]
    url: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    text: String,
}

#[derive(Default)]
struct State {
    token: String,
    origin: String,
    expires: Option<Instant>,
    pending: Option<Clip>,
    seen: HashSet<String>,
}

pub struct Clipper {
    host: String,
    gate: Option<Arc<SessionGate>>,
    state: Mutex<State>,
    runtime: Mutex<Option<tokio::runtime::Runtime>>,
}

fn extension_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| (b'a'..=b'p').contains(&b))
}
fn capture_id(s: &str) -> bool {
    (16..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Go `html.EscapeString`.
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '\'' => out.push_str("&#39;"),
            '"' => out.push_str("&#34;"),
            _ => out.push(c),
        }
    }
    out
}

fn note_content(p: &Clip) -> String {
    format!("{}<p>출처: {}</p>", p.html, escape(&p.url))
}

impl Clipper {
    /// Binds `127.0.0.1:0` and serves `/capture` on a private runtime thread.
    pub fn start(gate: Option<Arc<SessionGate>>) -> Result<Arc<Clipper>> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let host = listener.local_addr()?.to_string();
        let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(1).thread_name("inkism-clipper").enable_all().build()?;
        let c = Arc::new(Clipper { host, gate, state: Mutex::default(), runtime: Mutex::new(None) });
        let listener = {
            let _enter = runtime.enter();
            tokio::net::TcpListener::from_std(listener)?
        };
        // Weak: the accept loop must not keep the clipper alive.
        runtime.spawn(accept(listener, Arc::downgrade(&c)));
        *c.runtime.lock().unwrap_or_else(PoisonError::into_inner) = Some(runtime);
        Ok(c)
    }

    /// Forgets the session and pending capture and stops the listener.
    pub fn close(&self) {
        {
            let mut s = self.lock();
            s.token.clear();
            s.pending = None;
        }
        if let Some(runtime) = self.runtime.lock().unwrap_or_else(PoisonError::into_inner).take() {
            runtime.shutdown_background();
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn pair(&self, id: &str) -> Result<UploadAccess> {
        if !extension_id(id) {
            return Err("32-character Chrome/Edge extension ID required".into());
        }
        let mut s = self.lock();
        if s.pending.is_some() {
            return Err("accept or discard the pending capture first".into());
        }
        let mut secret = [0u8; 32];
        getrandom::getrandom(&mut secret).map_err(|e| e.to_string())?;
        s.token = secret.iter().map(|b| format!("{b:02x}")).collect();
        s.origin = format!("chrome-extension://{id}");
        s.expires = Some(Instant::now() + Duration::from_secs(15 * 60));
        s.seen.clear();
        Ok(UploadAccess { url: format!("http://{}/capture", self.host), token: s.token.clone() })
    }

    /// The listener's request handler (Go `receive`).
    fn receive(&self, r: &Request) -> Response {
        let mut out = self.capture(r);
        out.headers.push(("cache-control".into(), "no-store".into()));
        out.headers.push(("x-content-type-options".into(), "nosniff".into()));
        out
    }

    fn capture(&self, r: &Request) -> Response {
        // A `None` gate admits everything (Go nil gate).
        let Some(_admission) = gate::enter(self.gate.as_deref()) else {
            return Response::fail(423, "app is locked");
        };
        let mut s = self.lock();
        let expired = s.expires.is_none_or(|e| Instant::now() > e);
        if r.host != self.host || r.path != "/capture" || r.query.as_deref().is_some_and(|q| !q.is_empty()) || s.token.is_empty() || expired || r.header("origin").unwrap_or("") != s.origin {
            return Response::fail(403, "capture session unavailable");
        }
        let origin = s.origin.clone();
        let cors = |resp: Response| resp.with_header("access-control-allow-origin", origin.clone()).with_header("vary", "Origin");
        if r.method == "OPTIONS" {
            return cors(preflight(r));
        }
        let expected = format!("Bearer {}", s.token);
        let authorized: bool = subtle::ConstantTimeEq::ct_eq(r.header("authorization").unwrap_or("").as_bytes(), expected.as_bytes()).into();
        if r.method != "POST" || !authorized {
            return cors(Response::fail(403, "capture authorization failed"));
        }
        let mut clip = match parse_clip(&r.body) {
            Ok(c) => c,
            Err(rejected) => return cors(rejected),
        };
        if s.seen.contains(&clip.id) {
            return cors(Response::json(200, &json!({"ok": true})));
        }
        if s.pending.is_some() {
            return cors(Response::fail(409, "review the pending capture in Inkism first"));
        }
        if s.seen.len() >= 100 {
            return cors(Response::fail(429, "start a new capture session"));
        }
        clip.url = match inkism_web_content::source_url(&clip.url) {
            Ok(u) => u,
            Err(e) => return cors(Response::fail(400, e)),
        };
        match inkism_web_content::clean(&clip.html) {
            Ok(c) => (clip.html, clip.text) = (c.html, c.text),
            Err(e) => return cors(Response::fail(400, e)),
        }
        clip.note_id = uuid::Uuid::new_v4().to_string();
        s.seen.insert(clip.id.clone());
        s.pending = Some(clip);
        cors(Response::json(202, &json!({"ok": true})))
    }
}

fn preflight(r: &Request) -> Response {
    if r.header("access-control-request-method") != Some("POST") {
        return Response { status: 405, headers: vec![], body: vec![] };
    }
    Response { status: 204, headers: vec![], body: vec![] }
        .with_header("access-control-allow-methods", "POST")
        .with_header("access-control-allow-headers", "Authorization, Content-Type")
}

fn parse_clip(body: &[u8]) -> std::result::Result<Clip, Response> {
    if body.len() > CAPTURE_LIMIT {
        return Err(Response::fail(400, "invalid capture"));
    }
    let mut values = serde_json::Deserializer::from_slice(body).into_iter::<Clip>();
    let clip = match values.next() {
        Some(Ok(c)) if capture_id(&c.id) && c.title.len() <= 1024 => c,
        _ => return Err(Response::fail(400, "invalid capture")),
    };
    if values.next().is_some() {
        return Err(Response::fail(400, "trailing capture data"));
    }
    Ok(clip)
}

impl Drop for Clipper {
    fn drop(&mut self) {
        // Dropping a runtime inside async context panics; background shutdown never does.
        if let Some(runtime) = self.runtime.get_mut().unwrap_or_else(PoisonError::into_inner).take() {
            runtime.shutdown_background();
        }
    }
}

/// A loopback listener's request handler (the clipper, the agent API).
pub(crate) trait Receiver: Send + Sync + 'static {
    /// Body bytes read before the handler rejects the request.
    const LIMIT: usize;
    fn respond(&self, r: &Request) -> Response;
}

impl Receiver for Clipper {
    const LIMIT: usize = CAPTURE_LIMIT;
    fn respond(&self, r: &Request) -> Response {
        self.receive(r)
    }
}

// ponytail: receive runs inline on the one worker; a slow sanitize delays the
// next capture, which is fine for one paired extension.
pub(crate) async fn accept<T: Receiver>(listener: tokio::net::TcpListener, clipper: std::sync::Weak<T>) {
    loop {
        let stream = match listener.accept().await {
            Ok((stream, _)) => stream,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let clipper = clipper.clone();
        tokio::spawn(async move {
            let service = service_fn(move |req| {
                let clipper = clipper.clone();
                async move { Ok::<_, std::convert::Infallible>(http(clipper, req).await) }
            });
            let mut builder = http1::Builder::new();
            builder.timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(5)).keep_alive(false);
            let _ = tokio::time::timeout(Duration::from_secs(30), builder.serve_connection(TokioIo::new(stream), service)).await;
        });
    }
}

/// Converts hyper's request to `Request`, runs `respond`, converts back.
async fn http<T: Receiver>(clipper: std::sync::Weak<T>, req: hyper::Request<Incoming>) -> hyper::Response<Full<Bytes>> {
    let (parts, mut body) = req.into_parts();
    let mut data = Vec::new();
    // Read at most one byte past the limit; `receive` rejects anything longer.
    let read = async {
        while let Some(Ok(frame)) = body.frame().await {
            if let Ok(chunk) = frame.into_data() {
                data.extend_from_slice(&chunk);
                if data.len() > T::LIMIT {
                    break;
                }
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(15), read).await;
    let headers = parts.headers.iter().map(|(k, v)| (k.as_str().to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect::<Vec<_>>();
    let request = Request {
        method: parts.method.as_str().to_string(),
        path: parts.uri.path().to_string(),
        query: parts.uri.query().map(str::to_string),
        host: headers.iter().find(|(k, _)| k == "host").map(|(_, v)| v.clone()).unwrap_or_default(),
        headers,
        body: data,
    };
    let response = match clipper.upgrade() {
        Some(c) => c.respond(&request),
        None => Response::fail(503, "listener unavailable"),
    };
    let mut out = hyper::Response::new(Full::new(Bytes::from(response.body)));
    *out.status_mut() = hyper::StatusCode::from_u16(response.status).unwrap_or(hyper::StatusCode::INTERNAL_SERVER_ERROR);
    for (k, v) in response.headers {
        if let (Ok(k), Ok(v)) = (hyper::header::HeaderName::from_bytes(k.as_bytes()), hyper::header::HeaderValue::from_str(&v)) {
            out.headers_mut().append(k, v);
        }
    }
    out
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, default)]
#[derive(Default)]
struct Command {
    action: String,
    extension: String,
    id: String,
}

/// `/api/clipper`: management requests arrive through the same-origin,
/// unlocked app handler.
pub(crate) fn serve(h: &Handler, r: &Request) -> Response {
    let Some(c) = &h.clipper else { return Response::fail(503, "clipper unavailable") };
    if r.method == "GET" {
        return Response::json(200, &json!({"data": c.lock().pending, "ok": true}));
    }
    if r.method != "POST" {
        return Response { status: 405, headers: vec![], body: vec![] };
    }
    let mut values = serde_json::Deserializer::from_slice(&r.body).into_iter::<Command>();
    let input = match values.next() {
        Some(Ok(i)) if r.body.len() <= 4096 => i,
        _ => return Response::fail(400, "invalid clipper command"),
    };
    if values.next().is_some() {
        return Response::fail(400, "trailing data");
    }
    if input.action == "pair" {
        return match c.pair(&input.extension) {
            Ok(access) => Response::json(200, &json!({"data": access, "ok": true})),
            Err(e) => Response::fail(400, e),
        };
    }
    let mut s = c.lock();
    match input.action.as_str() {
        "stop" => {
            *s = State::default();
            Response::json(200, &json!({"ok": true}))
        }
        "discard" if s.pending.as_ref().is_some_and(|p| p.id == input.id) => {
            s.pending = None;
            Response::json(200, &json!({"ok": true}))
        }
        "discard" => Response::fail(409, "capture changed"),
        "accept" => accept_clip(h, &mut s, &input.id),
        _ => Response::fail(400, "unknown clipper command"),
    }
}

/// Saves the pending capture as a note. The caller holds the clipper lock.
fn accept_clip(h: &Handler, s: &mut State, id: &str) -> Response {
    let Some(p) = s.pending.as_ref().filter(|p| p.id == id) else { return Response::fail(409, "capture changed") };
    let retained = || Response::fail(500, "capture save failed; pending capture retained");
    let Ok(engine) = h.engine() else { return retained() };
    let wire = json!({"note": {
        "content": note_content(p), "content_format": "html", "id": p.note_id, "revision": 0,
        "tags": ["웹 클리핑"], "text": format!("{}\n출처: {}", p.text, p.url), "title": p.title,
    }, "op": "save"});
    let deadline = Instant::now() + Duration::from_secs(30);
    let Ok(mut data) = engine.call(deadline, wire.to_string().as_bytes()) else { return retained() };
    if !crate::success(&data) {
        match recover_save(engine.as_ref(), deadline, p) {
            Some(existing) => data = existing,
            None => return retained(),
        }
    }
    s.pending = None;
    Response { status: 200, headers: vec![("content-type".into(), "application/json".into())], body: data }
}

/// Checks whether a failed-looking save actually landed: a previous save
/// response may have been lost. Revision zero forbids an overwrite, so only
/// this server-generated id with the same title and content counts.
fn recover_save(engine: &dyn crate::Engine, deadline: Instant, p: &Clip) -> Option<Vec<u8>> {
    let existing = engine.call(deadline, json!({"id": p.note_id, "op": "get"}).to_string().as_bytes()).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&existing).ok()?;
    let d = &v["data"];
    let same = v["ok"] == true && d["id"].as_str() == Some(&p.note_id) && d["title"].as_str() == Some(&p.title) && d["content"].as_str() == Some(&note_content(p));
    same.then_some(existing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Deadline, Engine};
    use std::io::{Read, Write};

    #[derive(Default)]
    struct ClipCaller {
        fail: Mutex<bool>,
        calls: Mutex<usize>,
        last: Mutex<String>,
    }
    impl Engine for ClipCaller {
        fn call(&self, _: Deadline, raw: &[u8]) -> Result<Vec<u8>> {
            *self.calls.lock().unwrap() += 1;
            *self.last.lock().unwrap() = String::from_utf8_lossy(raw).into_owned();
            if *self.fail.lock().unwrap() {
                return Err("fail".into());
            }
            Ok(br#"{"ok":true,"data":{"id":"saved"}}"#.to_vec())
        }
    }

    fn command(h: &Handler, body: &str) -> Response {
        let r = Request { method: "POST".into(), path: "/api/clipper".into(), query: None, headers: vec![], host: "wails.localhost".into(), body: body.as_bytes().to_vec() };
        serve(h, &r)
    }
    fn pending(c: &Clipper) -> Option<Clip> {
        c.lock().pending.clone()
    }

    #[test]
    fn session_boundary_and_save_recovery() {
        let c = Clipper::start(None).unwrap();
        let access = c.pair(&"a".repeat(32)).unwrap();
        let origin = c.lock().origin.clone();
        let receive = |origin: &str, token: &str, path: &str, body: &str| {
            let headers = vec![("origin".into(), origin.into()), ("authorization".into(), format!("Bearer {token}"))];
            c.receive(&Request { method: "POST".into(), path: path.into(), query: None, headers, host: c.host.clone(), body: body.as_bytes().to_vec() }).status
        };
        let body = r#"{"id":"capture-1234567890","title":"captured","url":"https://example.com/page#fragment","html":"<p>safe</p><script>bad()</script><img src='file:///secret'>"}"#;
        let other = format!("chrome-extension://{}", "b".repeat(32));
        for (o, t, p) in [("https://evil.test", access.token.as_str(), "/capture"), (other.as_str(), &access.token, "/capture"), (&origin, "bad", "/capture"), (&origin, &access.token, "/api/rpc")] {
            assert_eq!(receive(o, t, p, body), 403, "{o} {t} {p}");
        }
        assert_eq!(receive(&origin, &access.token, "/capture", body), 202, "capture failed");
        assert_eq!(receive(&origin, &access.token, "/capture", body), 200, "repeated capture not deduplicated");
        assert_eq!(receive(&origin, &access.token, "/capture", &body.replace("1234567890", "9999999999")), 409, "overwrote pending");
        assert_eq!(receive(&origin, &access.token, "/capture", &format!("{body}{{}}")), 400, "trailing data");

        let caller = Arc::new(ClipCaller { fail: Mutex::new(true), ..Default::default() });
        let h = Handler { clipper: Some(Arc::clone(&c)), engine: Some(caller.clone()), ..Default::default() };
        let accept = r#"{"action":"accept","id":"capture-1234567890"}"#;
        assert!(command(&h, accept).status == 500 && pending(&c).is_some(), "save failure lost pending");
        *caller.fail.lock().unwrap() = false;
        assert!(command(&h, accept).status == 200 && pending(&c).is_none(), "save failed");
        let last = caller.last.lock().unwrap().clone();
        assert!(!last.contains("bad()") && !last.contains("file://") && !last.contains("#fragment"), "{last}");
        assert!(command(&h, accept).status == 409 && *caller.calls.lock().unwrap() == 2, "repeat accept duplicated note");
        // ponytail: the Go test also checks 423 for capture and management after
        // gate.Lock(); add it once SessionGate has a constructor.
        c.close();
    }

    #[test]
    fn management_commands() {
        let c = Clipper::start(None).unwrap();
        let h = Handler { clipper: Some(Arc::clone(&c)), ..Default::default() };
        assert_eq!(command(&h, r#"{"action":"pair","extension":"short"}"#).status, 400);
        assert_eq!(command(&h, r#"{"action":"pair","extension":"x","server":"y"}"#).status, 400);
        let out = command(&h, &format!(r#"{{"action":"pair","extension":"{}"}}"#, "p".repeat(32)));
        let v: serde_json::Value = serde_json::from_slice(&out.body).unwrap();
        assert_eq!(v["data"]["url"], format!("http://{}/capture", c.host));
        assert_eq!(v["data"]["token"].as_str().map(str::len), Some(64));
        assert_eq!(command(&h, r#"{"action":"discard","id":"x"}"#).status, 409);
        assert_eq!(command(&h, r#"{"action":"stop"}"#).status, 200);
        assert!(c.lock().token.is_empty());
        let get = serve(&h, &Request { method: "GET".into(), path: "/api/clipper".into(), query: None, headers: vec![], host: String::new(), body: vec![] });
        assert_eq!(String::from_utf8_lossy(&get.body).trim(), r#"{"data":null,"ok":true}"#);
        assert_eq!(serve(&Handler::default(), &get_request()).status, 503);
        c.close();
    }
    fn get_request() -> Request {
        Request { method: "GET".into(), path: "/api/clipper".into(), query: None, headers: vec![], host: String::new(), body: vec![] }
    }

    struct Committed {
        clip: Clip,
        writes: Mutex<usize>,
        different: bool,
    }
    impl Engine for Committed {
        fn call(&self, _: Deadline, raw: &[u8]) -> Result<Vec<u8>> {
            let request: serde_json::Value = serde_json::from_slice(raw)?;
            if request["op"] == "save" {
                *self.writes.lock().unwrap() += 1;
                let note = &request["note"];
                assert!(note["id"] == self.clip.note_id.as_str() && note["revision"] == 0 && note["content_format"] == "html", "capture must be create-only canonical HTML");
                return Ok(br#"{"ok":false,"error":"revision conflict"}"#.to_vec());
            }
            let content = if self.different { "changed by user".to_string() } else { format!("{}<p>출처: {}</p>", self.clip.html, escape(&self.clip.url)) };
            Ok(json!({"ok": true, "data": {"id": self.clip.note_id, "title": self.clip.title, "content": content}}).to_string().into_bytes())
        }
    }

    #[test]
    fn uncertain_save_retry_never_overwrites_or_duplicates() {
        let c = Clipper::start(None).unwrap();
        for different in [false, true] {
            let clip = Clip { note_id: "server-random-note".into(), id: "capture-1234567890".into(), title: "clip".into(), html: "<p>safe</p>".into(), url: "https://example.com?a=1&b='2'".into(), text: String::new() };
            c.lock().pending = Some(clip.clone());
            let caller = Arc::new(Committed { clip, writes: Mutex::new(0), different });
            let h = Handler { clipper: Some(Arc::clone(&c)), engine: Some(caller.clone()), ..Default::default() };
            let status = command(&h, r#"{"action":"accept","id":"capture-1234567890"}"#).status;
            if different {
                assert!(status == 500 && pending(&c).is_some(), "changed saved content must not be overwritten: {status}");
            } else {
                assert!(status == 200 && pending(&c).is_none(), "lost-response retry failed: {status}");
            }
            assert_eq!(*caller.writes.lock().unwrap(), 1, "unexpected save attempt count");
        }
        c.close();
    }

    #[test]
    fn listener_serves_preflight_over_tcp() {
        let c = Clipper::start(None).unwrap();
        let ext = "c".repeat(32);
        c.pair(&ext).unwrap();
        let mut stream = std::net::TcpStream::connect(&c.host).unwrap();
        write!(stream, "OPTIONS /capture HTTP/1.1\r\nHost: {}\r\nOrigin: chrome-extension://{ext}\r\nAccess-Control-Request-Method: POST\r\n\r\n", c.host).unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        assert!(reply.starts_with("HTTP/1.1 204"), "{reply}");
        assert!(reply.contains(&format!("access-control-allow-origin: chrome-extension://{ext}")), "{reply}");
        let token = c.lock().token.clone();
        let body = r#"{"id":"capture-1234567890","title":"t","url":"https://example.com","html":"<p>x</p>"}"#;
        let mut stream = std::net::TcpStream::connect(&c.host).unwrap();
        write!(stream, "POST /capture HTTP/1.1\r\nHost: {}\r\nOrigin: chrome-extension://{ext}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", c.host, body.len()).unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        assert!(reply.starts_with("HTTP/1.1 202") && reply.contains("access-control-allow-origin"), "{reply}");
        assert_eq!(pending(&c).map(|p| p.html), Some("<p>x</p>".to_string()));
        c.close();
        assert!(std::net::TcpStream::connect(&c.host).and_then(|mut s| s.read(&mut [0; 1])).map_or(true, |n| n == 0), "listener still serving");
    }
}
