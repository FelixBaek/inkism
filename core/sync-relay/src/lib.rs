//! Encrypted sync relay: opaque encrypted sync records, attachment ciphertext,
//! explicitly published sanitized snapshots and optional owner key recovery.
//! Wire-compatible with the original Go relay it replaced.
mod blobs;
mod gojson;
mod publications;
mod recovery;
mod sanitize;
pub mod store;
#[cfg(test)]
mod tests;

pub use recovery::{decode_std, google_jwks_fetcher, JwksFetch, RECOVERY_CONFLICT};

use bytes::Bytes;
use http_body::{Body as HttpBody, Frame, SizeHint};
use http_body_util::BodyExt;
use hyper::header::{HeaderValue, ALLOW, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE};
use hyper::{Method, Request, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::path::Path;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;
use store::{Error, Store, IDENTITIES, RECORDS};
use subtle::ConstantTimeEq;

pub const MAX_BLOB: usize = 32 << 20;
const PAGE_BYTES: usize = 40 << 20;
const BODY_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Serialize, Deserialize)]
pub struct Record {
    pub seq: u64,
    pub id: String,
    pub blob: String,
}

#[derive(Clone)]
pub struct Relay {
    store: Arc<Mutex<Store>>,
    token: Arc<str>,
    recovery: Option<Arc<recovery::OwnerRecovery>>,
}

impl Relay {
    pub fn open(path: impl AsRef<Path>, token: &str) -> Result<Relay, Error> {
        if token.len() < 32 {
            return Err("relay token must be at least 32 characters".into());
        }
        Ok(Relay { store: Arc::new(Mutex::new(Store::open(path.as_ref())?)), token: token.into(), recovery: None })
    }

    /// Runs a store operation off the async runtime under the single DB lock.
    // ponytail: one connection serializes readers too; bbolt allowed parallel reads.
    async fn db<T: Send + 'static>(&self, f: impl FnOnce(&mut Store) -> Result<T, Error> + Send + 'static) -> Result<T, Error> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || f(&mut store.lock().unwrap_or_else(|e| e.into_inner())))
            .await
            .map_err(|e| -> Error { e.to_string().into() })?
    }

    fn db_sync<T>(&self, f: impl FnOnce(&mut Store) -> Result<T, Error>) -> Result<T, Error> {
        f(&mut self.store.lock().unwrap_or_else(|e| e.into_inner()))
    }

    pub async fn handle<B>(&self, req: Request<B>) -> Response<Body>
    where
        B: ReqBody,
    {
        let Some(path) = unescape_path(req.uri().path()) else {
            // Go's server rejects a bad escape before any handler runs, with a
            // close-delimited body. hyper only writes that framing for HTTP/1.0,
            // so the status line says HTTP/1.0 here.
            let mut res = build(StatusCode::BAD_REQUEST, Some("text/plain; charset=utf-8"), Body::none());
            *res.body_mut() = Body { data: Some(Bytes::from_static(b"400 Bad Request")), sized: false };
            *res.version_mut() = hyper::Version::HTTP_10;
            res.headers_mut().insert(hyper::header::CONNECTION, HeaderValue::from_static("close"));
            return res;
        };
        let mut res = self.route(req, path).await;
        res.headers_mut().insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
        res
    }

    async fn route<B: ReqBody>(&self, req: Request<B>, path: String) -> Response<Body> {
        if path == "/v1/recovery/key" {
            return recovery::serve(self, req).await;
        }
        if path.starts_with("/s/") {
            return publications::serve_share(self, req).await;
        }
        if path.starts_with("/p/") {
            return publications::serve_public(self, &req, &path).await;
        }
        let header = req.headers().get(AUTHORIZATION).map(HeaderValue::as_bytes).unwrap_or_default();
        let supplied = header.strip_prefix(b"Bearer ").unwrap_or(header);
        if !bool::from(supplied.ct_eq(self.token.as_bytes())) {
            return respond(StatusCode::UNAUTHORIZED, &error("unauthorized"));
        }
        if path.starts_with("/v1/publications") || path.starts_with("/v1/shares") || path == "/v1/settings/domain" {
            return publications::serve_owner(self, req, &path).await;
        }
        if let Some(id) = path.strip_prefix(blobs::PREFIX) {
            return blobs::serve(self, req, id).await;
        }
        if path != "/v1/changes" {
            return not_found();
        }
        match *req.method() {
            Method::POST => self.post_change(req).await,
            Method::GET => self.get_changes(&req).await,
            _ => with_allow(empty(StatusCode::METHOD_NOT_ALLOWED), "GET, POST"),
        }
    }

    async fn post_change<B: ReqBody>(&self, req: Request<B>) -> Response<Body> {
        let (buf, broken, over) = read_limited(req.into_body(), MAX_BLOB + 1024).await;
        closing(self.store_posted_change(&buf, broken).await, over)
    }

    async fn store_posted_change(&self, buf: &[u8], broken: bool) -> Response<Body> {
        let invalid = || respond(StatusCode::BAD_REQUEST, &error("invalid change"));
        let Ok((obj, clean)) = gojson::decode_first(buf, Some(&["seq", "id", "blob"])) else { return invalid() };
        let (Ok(_), Ok(id), Ok(blob)) = (obj.u64("seq"), obj.string("id"), obj.string("blob")) else { return invalid() };
        if id.len() < 16 || id.len() > 128 || blob.is_empty() || blob.len() > MAX_BLOB {
            return invalid();
        }
        if !clean || broken {
            return respond(StatusCode::BAD_REQUEST, &error("trailing data"));
        }
        let item = Record { seq: 0, id, blob };
        match self.db(move |s| s.update(|tx| store_change(tx, item))).await {
            Ok(Ok(seq)) => respond(StatusCode::OK, &Seq { seq }),
            Ok(Err(conflict)) => respond(StatusCode::CONFLICT, &error(conflict)),
            Err(e) => respond(StatusCode::INTERNAL_SERVER_ERROR, &error(&e.to_string())),
        }
    }

    async fn get_changes<B>(&self, req: &Request<B>) -> Response<Body> {
        let query = req.uri().query().unwrap_or("");
        let after = match query_get(query, "after") {
            Some(raw) if !raw.is_empty() => match parse_uint(&raw) {
                Some(n) => n,
                None => return respond(StatusCode::BAD_REQUEST, &error("invalid cursor")),
            },
            _ => 0,
        };
        let mut limit = 50;
        if let Some(raw) = query_get(query, "limit").filter(|r| !r.is_empty()) {
            match parse_int(&raw) {
                Some(n) if (1..=100).contains(&n) => limit = n as usize,
                _ => return respond(StatusCode::BAD_REQUEST, &error("limit must be 1..100")),
            }
        }
        match self.db(move |s| s.view(|tx| read_changes(tx, after, limit))).await {
            Ok(page) => respond(StatusCode::OK, &page),
            Err(e) => respond(StatusCode::INTERNAL_SERVER_ERROR, &error(&e.to_string())),
        }
    }
}

#[derive(Serialize)]
struct Seq {
    seq: u64,
}

#[derive(Serialize)]
struct Page {
    cursor: u64,
    items: Vec<Record>,
}

/// Appends item once per ID; a replay with the same payload reuses the stored
/// sequence and a different payload is a conflict (inner Err).
fn store_change(tx: &rusqlite::Transaction, mut item: Record) -> Result<Result<u64, &'static str>, Error> {
    if let Some(existing) = store::get(tx, IDENTITIES, item.id.as_bytes())? {
        let stored = store::get(tx, RECORDS, &existing)?.unwrap_or_default();
        let old: Record = serde_json::from_slice(&stored)?;
        if old.blob != item.blob {
            return Ok(Err("id already has different payload"));
        }
        return Ok(Ok(old.seq));
    }
    item.seq = store::next_sequence(tx, RECORDS)?;
    let key = item.seq.to_be_bytes();
    store::put(tx, RECORDS, &key, &gojson::marshal(&item))?;
    store::put(tx, IDENTITIES, item.id.as_bytes(), &key)?;
    Ok(Ok(item.seq))
}

/// Up to limit records after the cursor, capped near 40 MiB of stored JSON.
fn read_changes(tx: &rusqlite::Transaction, after: u64, limit: usize) -> Result<Page, Error> {
    let mut page = Page { cursor: after, items: Vec::new() };
    if after == u64::MAX {
        return Ok(page);
    }
    let mut total = 0;
    for (_, v) in store::scan(tx, RECORDS, &(after + 1).to_be_bytes(), limit)? {
        if !page.items.is_empty() && total + v.len() > PAGE_BYTES {
            break;
        }
        let item: Record = serde_json::from_slice(&v)?;
        page.cursor = item.seq;
        page.items.push(item);
        total += v.len();
    }
    Ok(page)
}

// ---- HTTP helpers shared by all routes (Go net/http behaviour)

/// Response body that frames like Go's ResponseWriter: bodies up to 2048 bytes
/// get a Content-Length, larger ones without an explicit length are chunked.
pub struct Body {
    data: Option<Bytes>,
    sized: bool,
}

impl Body {
    fn new(data: impl Into<Bytes>) -> Body {
        let data = data.into();
        Body { sized: data.len() <= 2048, data: Some(data) }
    }
    fn sized(data: Vec<u8>) -> Body {
        Body { data: Some(data.into()), sized: true }
    }
    /// Nothing written at all: Go then omits Content-Length on HEAD.
    fn none() -> Body {
        Body { data: None, sized: false }
    }
    pub async fn bytes(self) -> Bytes {
        self.data.unwrap_or_default()
    }
}

impl HttpBody for Body {
    type Data = Bytes;
    type Error = Infallible;
    fn poll_frame(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
        Poll::Ready(self.data.take().filter(|d| !d.is_empty()).map(|d| Ok(Frame::data(d))))
    }
    fn is_end_stream(&self) -> bool {
        self.sized && self.data.as_ref().is_none_or(|d| d.is_empty())
    }
    fn size_hint(&self) -> SizeHint {
        match (&self.data, self.sized) {
            (Some(d), true) => SizeHint::with_exact(d.len() as u64),
            (None, true) => SizeHint::with_exact(0),
            _ => SizeHint::default(),
        }
    }
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
}
fn error(message: &str) -> ErrorBody<'_> {
    ErrorBody { error: message }
}

fn build(status: StatusCode, content_type: Option<&'static str>, body: Body) -> Response<Body> {
    let mut res = Response::new(body);
    *res.status_mut() = status;
    if let Some(ct) = content_type {
        res.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static(ct));
    }
    res
}

/// Go respond(): JSON with a trailing newline (json.Encoder).
fn respond<T: Serialize>(status: StatusCode, v: &T) -> Response<Body> {
    let mut data = gojson::marshal(v);
    data.push(b'\n');
    build(status, Some("application/json"), Body::new(data))
}

/// http.Error
fn http_error(status: StatusCode, message: &str) -> Response<Body> {
    let mut res = build(status, Some("text/plain; charset=utf-8"), Body::new(format!("{message}\n")));
    res.headers_mut().insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    res
}

fn not_found() -> Response<Body> {
    http_error(StatusCode::NOT_FOUND, "404 page not found")
}

/// WriteHeader(status) with no body.
fn empty(status: StatusCode) -> Response<Body> {
    build(status, None, Body::sized(Vec::new()))
}

fn with_allow(mut res: Response<Body>, allow: &'static str) -> Response<Body> {
    res.headers_mut().insert(ALLOW, HeaderValue::from_static(allow));
    res
}

/// Request bodies the relay reads (hyper's Incoming in production).
pub trait ReqBody: HttpBody<Data = Bytes> + Send + Unpin + 'static {}
impl<B: HttpBody<Data = Bytes> + Send + Unpin + 'static> ReqBody for B {}

/// http.MaxBytesReader + read until EOF (bounded by Go's 90 s ReadTimeout).
/// Returns at most `limit` bytes, whether reading stopped on an error (limit
/// exceeded or connection failure) instead of a clean EOF, and whether the
/// limit was the cause (Go then answers with Connection: close).
async fn read_limited<B: ReqBody>(mut body: B, limit: usize) -> (Vec<u8>, bool, bool) {
    let mut buf = Vec::new();
    let broken = tokio::time::timeout(BODY_TIMEOUT, read_frames(&mut body, &mut buf, limit)).await.unwrap_or(true);
    let over = buf.len() > limit;
    if over {
        // Keep reading what the client is still sending while the answer goes
        // out, so closing does not reset the connection under the response
        // (Go lingers for the same reason).
        drain_in_background(body);
    }
    buf.truncate(limit);
    (buf, broken, over)
}

/// True when reading stopped on an error or the limit instead of a clean EOF.
async fn read_frames<B: ReqBody>(body: &mut B, buf: &mut Vec<u8>, limit: usize) -> bool {
    loop {
        match body.frame().await {
            None => return false,
            Some(Err(_)) => return true,
            Some(Ok(frame)) => {
                if let Ok(data) = frame.into_data() {
                    buf.extend_from_slice(&data);
                    if buf.len() > limit {
                        return true;
                    }
                }
            }
        }
    }
}

fn drain_in_background<B: ReqBody>(mut body: B) {
    tokio::spawn(async move {
        let mut left: usize = 64 << 20;
        let drain = async {
            while let Some(Ok(frame)) = body.frame().await {
                left = left.saturating_sub(frame.data_ref().map_or(0, |d| d.len()));
                if left == 0 {
                    break;
                }
            }
        };
        let _ = tokio::time::timeout(Duration::from_secs(5), drain).await;
    });
}

/// Go marks a response after a body over its limit with Connection: close.
fn closing(mut res: Response<Body>, over: bool) -> Response<Body> {
    if over {
        res.headers_mut().insert(hyper::header::CONNECTION, HeaderValue::from_static("close"));
    }
    res
}

fn unhex(c: u8) -> Option<u8> {
    (c as char).to_digit(16).map(|d| d as u8)
}

/// url.PathUnescape as Go's server applies it to the request path; a bad
/// escape is rejected before the handler runs.
fn unescape_path(raw: &str) -> Option<String> {
    unescape(raw, false)
}

fn unescape(raw: &str, plus_is_space: bool) -> Option<String> {
    let b = raw.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                out.push(unhex(*b.get(i + 1)?)? << 4 | unhex(*b.get(i + 2)?)?);
                i += 2;
            }
            b'+' if plus_is_space => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    Some(String::from_utf8_lossy(&out).into_owned())
}

/// url.Values.Get after url.ParseQuery: first value, malformed pairs skipped.
fn query_get(query: &str, name: &str) -> Option<String> {
    query.split('&').filter(|p| !p.is_empty() && !p.contains(';')).find_map(|pair| {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let (k, v) = (unescape(k, true)?, unescape(v, true)?);
        (k == name).then_some(v)
    })
}

/// strconv.ParseUint(s, 10, 64): digits only.
fn parse_uint(s: &str) -> Option<u64> {
    s.bytes().all(|c| c.is_ascii_digit()).then(|| s.parse().ok()).flatten()
}

/// strconv.Atoi: optional sign, then digits.
fn parse_int(s: &str) -> Option<i64> {
    let digits = s.strip_prefix(['+', '-']).unwrap_or(s);
    (!digits.is_empty() && digits.bytes().all(|c| c.is_ascii_digit())).then(|| s.parse().ok()).flatten()
}
