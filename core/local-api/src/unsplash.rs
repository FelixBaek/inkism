//! Unsplash cover search (Go `unsplash.go`).
//!
//! The access key never reaches the renderer: it comes from
//! `INKISM_UNSPLASH_ACCESS_KEY` or a user-private file beside the library
//! (`<db>.unsplash-key`, 0600), and the renderer only learns `{configured}`.
// ponytail: plain 0600 file; Windows relies on the user-profile ACL, add DPAPI
// if the key must be encrypted at rest.

use crate::{Deadline, Handler, Request, Response};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::json;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

const ENV: &str = "INKISM_UNSPLASH_ACCESS_KEY";
const DEFAULT_BASE: &str = "https://api.unsplash.com";
/// The referral tag Unsplash asks for on every author and Unsplash link.
pub(crate) const UNSPLASH_REF: &str = "utm_source=inkism&utm_medium=referral";
const NO_KEY: &str = "unsplash_key_missing";
const FAILED: &str = "사진 검색에 실패했습니다";

pub(crate) struct Unsplash {
    pub(crate) key_path: Option<PathBuf>,
    pub(crate) base: String,
    mu: Mutex<()>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct UnsplashPhoto {
    pub id: String,
    pub url: String,
    pub thumb: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub alt: String,
    pub author: String,
    pub author_url: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct UnsplashPage {
    pub items: Vec<UnsplashPhoto>,
    pub total_pages: i64,
}

enum Error {
    NoKey,
    Failed,
    Bad(String),
}

impl<E: std::fmt::Display> From<E> for Error {
    fn from(e: E) -> Self {
        Error::Bad(e.to_string())
    }
}

fn id_ok(s: &str) -> bool {
    (1..=32).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn key_ok(s: &str) -> bool {
    (16..=128).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn unsafe_url(u: &str) -> bool {
    u.chars().any(|c| "\"'<> \\".contains(c) || (c as u32) < 0x20 || c as u32 == 0x7f)
}
fn image(u: &str) -> bool {
    u.len() <= 600 && !unsafe_url(u) && u.starts_with("https://images.unsplash.com/")
}

/// Go `ValidUnsplashPhoto`: mirrors the engine's notebook cover check.
pub(crate) fn valid_unsplash_photo(p: &UnsplashPhoto) -> bool {
    let author = p.author.trim();
    id_ok(&p.id)
        && image(&p.url)
        && image(&p.thumb)
        && !author.is_empty()
        && author.chars().count() <= 80
        && p.author_url.len() <= 300
        && !unsafe_url(&p.author_url)
        && p.author_url.starts_with("https://unsplash.com/")
}

/// JSON `null` decodes to the zero value, as in Go.
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de> + Default>(d: D) -> Result<T, D::Error> {
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

#[derive(Default, Deserialize)]
struct RawPage {
    #[serde(default, deserialize_with = "nullable")]
    total_pages: i64,
    #[serde(default, deserialize_with = "nullable")]
    results: Vec<RawPhoto>,
}
#[derive(Default, Deserialize)]
struct RawPhoto {
    #[serde(default, deserialize_with = "nullable")]
    id: String,
    #[serde(default, deserialize_with = "nullable")]
    alt_description: String,
    #[serde(default, deserialize_with = "nullable")]
    urls: RawUrls,
    #[serde(default, deserialize_with = "nullable")]
    user: RawUser,
}
#[derive(Default, Deserialize)]
struct RawUrls {
    #[serde(default, deserialize_with = "nullable")]
    regular: String,
    #[serde(default, deserialize_with = "nullable")]
    small: String,
}
#[derive(Default, Deserialize)]
struct RawUser {
    #[serde(default, deserialize_with = "nullable")]
    name: String,
    #[serde(default, deserialize_with = "nullable")]
    links: RawLinks,
}
#[derive(Default, Deserialize)]
struct RawLinks {
    #[serde(default, deserialize_with = "nullable")]
    html: String,
}

impl Unsplash {
    pub(crate) fn new(key_path: Option<PathBuf>, base: impl Into<String>) -> Self {
        Unsplash { key_path, base: base.into(), mu: Mutex::new(()) }
    }

    fn key(&self) -> String {
        let env = std::env::var(ENV).unwrap_or_default();
        if !env.trim().is_empty() {
            return env.trim().to_string();
        }
        let Some(path) = &self.key_path else { return String::new() };
        let _guard = self.mu.lock().unwrap_or_else(PoisonError::into_inner);
        match std::fs::read(path) {
            Ok(raw) if raw.len() <= 256 => String::from_utf8_lossy(&raw).trim().to_string(),
            _ => String::new(),
        }
    }

    pub(crate) fn configured(&self) -> bool {
        !self.key().is_empty()
    }

    /// Stores (or, when empty, removes) the private key file.
    fn set_key(&self, key: &str) -> Result<(), Error> {
        let key = key.trim();
        let Some(path) = &self.key_path else { return Err(Error::Bad("키를 저장할 위치가 없습니다".into())) };
        let _guard = self.mu.lock().unwrap_or_else(PoisonError::into_inner);
        if key.is_empty() {
            return match std::fs::remove_file(path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
                _ => Ok(()),
            };
        }
        if !key_ok(key) {
            return Err(Error::Bad("Unsplash Access Key 형식이 아닙니다".into()));
        }
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let temp = path.with_file_name(format!(".unsplash-key-{}-{nanos}", std::process::id()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let written = options.open(&temp).and_then(|mut f| {
            f.write_all(key.as_bytes())?;
            f.sync_all()
        });
        let result = written.and_then(|()| std::fs::rename(&temp, path));
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        Ok(result?)
    }

    fn get(&self, deadline: Deadline, path: &str, query: &str) -> Result<Vec<u8>, Error> {
        let key = self.key();
        if key.is_empty() {
            return Err(Error::NoKey);
        }
        let timeout = Duration::from_secs(10).min(deadline.saturating_duration_since(Instant::now()));
        let client = reqwest::blocking::Client::builder().timeout(timeout).build().map_err(|_| Error::Failed)?;
        // Never echo transport details or the upstream body (it may quote the key).
        let res = client
            .get(format!("{}{path}?{query}", self.base))
            .header("Authorization", format!("Client-ID {key}"))
            .header("Accept-Version", "v1")
            .send()
            .map_err(|_| Error::Failed)?;
        if res.status() != 200 {
            return Err(Error::Failed);
        }
        let mut body = Vec::new();
        res.take(4 << 20).read_to_end(&mut body).map_err(|_| Error::Failed)?;
        Ok(body)
    }

    /// One page (24) of landscape, safe-search photos.
    fn search(&self, deadline: Deadline, query: &str, page: i64) -> Result<UnsplashPage, Error> {
        let query = query.trim();
        if query.is_empty() || query.chars().count() > 100 || !(1..=50).contains(&page) {
            return Err(Error::Bad("검색어를 확인해 주세요".into()));
        }
        let q = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("content_filter", "high")
            .append_pair("orientation", "landscape")
            .append_pair("page", &page.to_string())
            .append_pair("per_page", "24")
            .append_pair("query", query)
            .finish();
        let raw: RawPage = serde_json::from_slice(&self.get(deadline, "/search/photos", &q)?).map_err(|_| Error::Failed)?;
        let mut out = UnsplashPage { items: Vec::new(), total_pages: raw.total_pages };
        for r in raw.results {
            let sep = if r.user.links.html.contains('?') { '&' } else { '?' };
            let p = UnsplashPhoto {
                id: r.id,
                url: r.urls.regular,
                thumb: r.urls.small,
                alt: r.alt_description.chars().take(200).collect(),
                author: r.user.name.trim().to_string(),
                author_url: format!("{}{sep}{UNSPLASH_REF}", r.user.links.html),
            };
            if valid_unsplash_photo(&p) {
                out.items.push(p);
            }
        }
        Ok(out)
    }

    /// Pings `/photos/{id}/download`, which the Unsplash API guidelines
    /// require when a photo is picked.
    fn use_photo(&self, deadline: Deadline, id: &str) -> Result<(), Error> {
        if !id_ok(id) {
            return Err(Error::Bad("잘못된 사진 id".into()));
        }
        self.get(deadline, &format!("/photos/{id}/download"), "").map(|_| ())
    }
}

fn service(h: &Handler) -> &Unsplash {
    h.unsplash.get_or_init(|| {
        let path = h.unsplash_key_path.clone().or_else(|| {
            let mut p = h.engine.as_ref()?.database()?.as_os_str().to_owned();
            p.push(".unsplash-key");
            Some(p.into())
        });
        Unsplash::new(path, DEFAULT_BASE)
    })
}

fn reply(result: Result<serde_json::Value, Error>) -> Response {
    match result {
        Ok(data) => Response::json(200, &json!({"data": data, "ok": true})),
        Err(Error::NoKey) => Response::fail(409, NO_KEY),
        Err(Error::Failed) => Response::fail(502, FAILED),
        Err(Error::Bad(m)) => Response::fail(400, m),
    }
}

/// One JSON value, at most 1 KiB, no unknown fields, nothing after it.
fn decode<T: serde::de::DeserializeOwned>(body: &[u8]) -> Result<T, Response> {
    let bad = || Response::fail(400, "invalid request");
    if body.len() > 1024 {
        return Err(bad());
    }
    let mut values = serde_json::Deserializer::from_slice(body).into_iter::<T>();
    match (values.next(), values.next()) {
        (Some(Ok(v)), None) => Ok(v),
        _ => Err(bad()),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyInput {
    #[serde(default)]
    key: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UseInput {
    #[serde(default)]
    id: String,
}

pub(crate) fn serve(h: &Handler, r: &Request, deadline: Deadline) -> Response {
    let u = service(h);
    let post = r.method == "POST";
    if post && !r.header("content-type").unwrap_or("").starts_with("application/json") {
        return Response::fail(415, "JSON required");
    }
    match (r.path.as_str(), r.method.as_str()) {
        ("/api/unsplash/key", "GET") => reply(Ok(json!({"configured": u.configured()}))),
        ("/api/unsplash/key", "POST") => {
            let input: KeyInput = match decode(&r.body) {
                Ok(v) => v,
                Err(e) => return e,
            };
            reply(u.set_key(input.key.as_deref().unwrap_or("")).map(|()| json!({"configured": u.configured()})))
        }
        ("/api/unsplash/search", "GET") => {
            // url.Values.Get: the first value, or empty.
            let first = |name: &str| {
                url::form_urlencoded::parse(r.query.as_deref().unwrap_or("").as_bytes()).find(|(k, _)| k == name).map(|(_, v)| v.into_owned()).unwrap_or_default()
            };
            let page = match first("page").parse::<i64>().unwrap_or(0) {
                0 => 1,
                n => n,
            };
            reply(u.search(deadline, &first("q"), page).map(|p| serde_json::to_value(p).unwrap_or_default()))
        }
        ("/api/unsplash/use", "POST") => {
            let input: UseInput = match decode(&r.body) {
                Ok(v) => v,
                Err(e) => return e,
            };
            reply(u.use_photo(deadline, &input.id).map(|()| json!({"used": true})))
        }
        _ => Response::fail(404, "not found"),
    }
}


/// Tiny HTTP/1.1 server on a random loopback port for tests (never the real API).
#[cfg(test)]
pub(crate) mod mock {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};

    pub struct Hit {
        pub method: String,
        /// Path plus query, as sent.
        pub target: String,
        pub headers: Vec<(String, String)>,
        pub body: Vec<u8>,
    }
    impl Hit {
        pub fn header(&self, name: &str) -> &str {
            self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str()).unwrap_or("")
        }
        pub fn path(&self) -> &str {
            self.target.split('?').next().unwrap_or("")
        }
        pub fn query(&self, name: &str) -> Option<String> {
            let q = self.target.split_once('?')?.1;
            url::form_urlencoded::parse(q.as_bytes()).find(|(k, _)| k == name).map(|(_, v)| v.into_owned())
        }
    }
    pub struct Reply {
        pub status: u16,
        pub headers: Vec<(String, String)>,
        pub body: Vec<u8>,
    }
    pub fn ok(body: &str) -> Reply {
        Reply { status: 200, headers: vec![], body: body.as_bytes().to_vec() }
    }

    /// Returns `http://127.0.0.1:<port>`. The thread lives until the test process exits.
    pub fn serve(handler: impl Fn(&Hit) -> Reply + Send + 'static) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let Some(hit) = read_hit(&stream) else { continue };
                write_reply(&mut stream, &handler(&hit));
            }
        });
        base
    }

    fn read_hit(stream: &TcpStream) -> Option<Hit> {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        let mut parts = line.split_whitespace();
        let (method, target) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
        let mut headers = Vec::new();
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h).unwrap_or(0) == 0 || h.trim().is_empty() {
                break;
            }
            if let Some((k, v)) = h.split_once(':') {
                headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
            }
        }
        let length = headers.iter().find(|(k, _)| k == "content-length").and_then(|(_, v)| v.parse().ok()).unwrap_or(0);
        let mut body = vec![0; length];
        let _ = reader.read_exact(&mut body);
        Some(Hit { method, target, headers, body })
    }

    fn write_reply(stream: &mut TcpStream, reply: &Reply) {
        let mut head = format!("HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n", reply.status, reply.body.len());
        for (k, v) in &reply.headers {
            head.push_str(&format!("{k}: {v}\r\n"));
        }
        head.push_str("\r\n");
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(&reply.body);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    const KEY: &str = "test-access-key-0123456789";

    fn call(h: &Handler, method: &str, target: &str, body: &str) -> Response {
        let (path, query) = match target.split_once('?') {
            Some((p, q)) => (p, Some(q.to_string())),
            None => (target, None),
        };
        let mut headers = vec![("origin".to_string(), "http://127.0.0.1:1".to_string())];
        if !body.is_empty() {
            headers.push(("content-type".into(), "application/json".into()));
        }
        let r = Request { method: method.into(), path: path.into(), query, headers, host: "127.0.0.1:1".into(), body: body.as_bytes().to_vec() };
        serve(h, &r, Instant::now() + crate::REQUEST_TIMEOUT)
    }
    fn text(r: &Response) -> String {
        String::from_utf8_lossy(&r.body).into_owned()
    }

    #[test]
    fn proxy_keeps_key_private() {
        std::env::remove_var(ENV);
        // The second and third hits point off images.unsplash.com / unsplash.com and must be filtered.
        let seen = Arc::new(Mutex::new((String::new(), String::new())));
        let record = Arc::clone(&seen);
        let base = mock::serve(move |hit| {
            *record.lock().unwrap() = (hit.header("authorization").to_string(), hit.path().to_string());
            if hit.path() == "/photos/abc_1/download" {
                return mock::ok(r#"{"url":"x"}"#);
            }
            if hit.query("query").as_deref() == Some("boom") {
                return mock::Reply { status: 401, headers: vec![], body: format!("bad key {KEY}").into_bytes() };
            }
            mock::ok(
                r#"{"total_pages":3,"results":[
                {"id":"abc_1","alt_description":"desk","urls":{"regular":"https://images.unsplash.com/photo-1?w=1080","small":"https://images.unsplash.com/photo-1?w=400"},"user":{"name":"Kim","links":{"html":"https://unsplash.com/@kim"}}},
                {"id":"evil","urls":{"regular":"https://evil.example/p.jpg","small":"https://evil.example/p.jpg"},"user":{"name":"X","links":{"html":"https://unsplash.com/@x"}}},
                {"id":"evil2","urls":{"regular":"https://images.unsplash.com/p","small":"https://images.unsplash.com/p"},"user":{"name":"Y","links":{"html":"javascript:alert(1)"}}}]}"#,
            )
        });
        let hit = || seen.lock().unwrap().1.clone();
        let dir = std::env::temp_dir().join(format!("inkism-unsplash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let key_path = dir.join("notes.db.unsplash-key");
        let h = Handler { host: "127.0.0.1:1".into(), ..Default::default() };
        let _ = h.unsplash.set(Unsplash::new(Some(key_path.clone()), base));

        // No key: search is refused with a recognizable code.
        let out = call(&h, "GET", "/api/unsplash/search?q=desk", "");
        assert!(out.status == 409 && text(&out).contains(NO_KEY), "{} {}", out.status, text(&out));
        assert_eq!(call(&h, "POST", "/api/unsplash/key", r#"{"key":"short"}"#).status, 400);
        // Saving the key answers only {configured}; the key is never echoed.
        let out = call(&h, "POST", "/api/unsplash/key", &format!(r#"{{"key":"{KEY}"}}"#));
        assert_eq!((out.status, text(&out).trim()), (200, r#"{"data":{"configured":true},"ok":true}"#));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&key_path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let out = call(&h, "GET", "/api/unsplash/key", "");
        assert!(!text(&out).contains(KEY) && text(&out).contains(r#""configured":true"#));

        // Search sends Client-ID, filters foreign hosts, adds the referral tag.
        let out = call(&h, "GET", "/api/unsplash/search?q=desk&page=2", "");
        assert_eq!(out.status, 200, "{}", text(&out));
        assert_eq!(*seen.lock().unwrap(), (format!("Client-ID {KEY}"), "/search/photos".to_string()));
        let page: UnsplashPage = serde_json::from_value(serde_json::from_slice::<serde_json::Value>(&out.body).unwrap()["data"].clone()).unwrap();
        assert_eq!((page.items.len(), page.total_pages), (1, 3));
        assert_eq!(page.items[0].author_url, format!("https://unsplash.com/@kim?{UNSPLASH_REF}"));
        assert!(!text(&out).contains(KEY));
        // Upstream failures never forward the upstream body (which may quote the key).
        let out = call(&h, "GET", "/api/unsplash/search?q=boom", "");
        assert!(out.status == 502 && !text(&out).contains(KEY));
        assert_eq!(call(&h, "GET", "/api/unsplash/search?q=%20", "").status, 400);

        // Picking pings the download endpoint; malformed ids never reach Unsplash.
        assert_eq!(call(&h, "POST", "/api/unsplash/use", r#"{"id":"abc_1"}"#).status, 200);
        assert_eq!(hit(), "/photos/abc_1/download");
        seen.lock().unwrap().1.clear();
        for id in ["../x", "a/b", "", &"a".repeat(33)] {
            let body = serde_json::to_string(&json!({"id": id})).unwrap();
            assert_eq!(call(&h, "POST", "/api/unsplash/use", &body).status, 400, "{id}");
            assert_eq!(hit(), "");
        }
        // Cross-origin writes are refused (same-origin check runs before the gate).
        let r = Request {
            method: "POST".into(),
            path: "/api/unsplash/key".into(),
            query: None,
            headers: vec![("origin".into(), "http://evil.test".into()), ("content-type".into(), "application/json".into())],
            host: "127.0.0.1:1".into(),
            body: br#"{"key":null}"#.to_vec(),
        };
        assert_eq!(h.handle(&r).status, 403);
        // Non-JSON writes are refused.
        let r = Request { headers: vec![], path: "/api/unsplash/use".into(), body: br#"{"id":"abc_1"}"#.to_vec(), ..r };
        assert_eq!(serve(&h, &r, Instant::now() + crate::REQUEST_TIMEOUT).status, 415);

        // Removing the key deletes the file.
        assert!(text(&call(&h, "POST", "/api/unsplash/key", r#"{"key":null}"#)).contains(r#""configured":false"#));
        assert!(!key_path.exists());
        // The environment key wins and is never written to disk.
        std::env::set_var(ENV, KEY);
        let out = call(&h, "GET", "/api/unsplash/key", "");
        std::env::remove_var(ENV);
        assert!(text(&out).contains(r#""configured":true"#));
        assert!(!key_path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn key_path_defaults_beside_library() {
        struct Db;
        impl crate::Engine for Db {
            fn call(&self, _: Deadline, _: &[u8]) -> crate::Result<Vec<u8>> {
                Err("unused".into())
            }
            fn database(&self) -> Option<&std::path::Path> {
                Some(std::path::Path::new("/lib/notes.db"))
            }
        }
        let h = Handler { engine: Some(Arc::new(Db)), ..Default::default() };
        assert_eq!(service(&h).key_path.as_deref(), Some(std::path::Path::new("/lib/notes.db.unsplash-key")));
    }
}
