//! Local API for the renderer. Ported from the former Go implementation's bridge.
//!
//! `Handler::handle` takes one complete request and returns one complete
//! response. The Tauri shell calls it from its custom protocol, and the
//! development server (`bin/inkism-local-api`) calls it from plain HTTP.
//! Each route group lives in its own module; `route` below is the only
//! place that knows the URL table.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub mod engine;
pub mod gate;

mod attachments;
mod backup;
mod clipper;
mod reader;
mod export;
mod markdown_export;
mod fonts;
mod publications;
mod portable;
mod reminders;
mod rpc;
mod security;
mod storage;
mod unsplash;
mod update;
mod upload_server;

pub use engine::{AttachmentMetadata, Attachments, Engine};
pub use gate::{SecurityStatus, SessionGate};
pub use attachments::UploadAccess;
pub use upload_server::{start_upload_server, UploadServer};
pub use clipper::Clipper;

/// Request deadline. Go used a context with a 90 s timeout; engine calls that
/// pass it kill the child, so a late answer is never read as the next one.
pub type Deadline = Instant;
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T, E = Error> = std::result::Result<T, E>;

pub struct Request {
    pub method: String,
    /// Path without the query, still percent-encoded as received.
    pub path: String,
    pub query: Option<String>,
    /// Lower-case header names.
    pub headers: Vec<(String, String)>,
    /// The `Host` the request was addressed to.
    pub host: String,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

// ponytail: whole bodies in memory, as the Wails asset handler and Tauri's
// custom protocol both do. Stream file bodies if backups outgrow RAM.
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn json(status: u16, value: &serde_json::Value) -> Self {
        let mut body = serde_json::to_vec(value).unwrap_or_default();
        body.push(b'\n'); // json.Encoder adds a newline
        Response { status, headers: vec![("content-type".into(), "application/json".into())], body }
    }
    /// The Go `fail`: `{"ok":false,"error":...}`.
    pub fn fail(status: u16, message: impl std::fmt::Display) -> Self {
        Self::json(status, &serde_json::json!({"ok": false, "error": message.to_string()}))
    }
    pub fn not_found() -> Self {
        Response { status: 404, headers: vec![("content-type".into(), "text/plain; charset=utf-8".into())], body: b"404 page not found\n".to_vec() }
    }
    pub fn with_header(mut self, name: &str, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
}

/// Host-side Google sign-in lock (`core/google-auth` Controller implements this
/// through the shell).
pub trait SecurityController: Send + Sync {
    fn status(&self) -> SecurityStatus;
    fn login(&self, deadline: Deadline) -> Result<()>;
    fn cancel(&self);
    fn lock(&self) -> Result<()>;
    /// Turns the lock off after a fresh login proves the same account.
    /// Hosts without that flow refuse.
    fn disable(&self, _deadline: Deadline) -> Result<()> {
        Err("app lock cannot be turned off here".into())
    }
}

/// Native capabilities only the shell can provide. Each is optional; `None`
/// means the feature is reported unavailable, as in Go.
#[derive(Default)]
#[allow(clippy::type_complexity)]
pub struct Native {
    pub pdf_render: Option<Box<dyn Fn(&[u8], Deadline) -> Result<Vec<u8>> + Send + Sync>>,
    /// Opens a folder picker and writes an encrypted copy; returns the target path,
    /// or an empty string when the user cancelled.
    pub encrypted_copy: Option<Box<dyn Fn(Deadline) -> Result<String> + Send + Sync>>,
    /// Opens a file picker; `true` when a library was chosen and the app will relaunch.
    pub open_library: Option<Box<dyn Fn() -> Result<bool> + Send + Sync>>,
    /// Runs before the `/api/close` reply is sent, so it must only schedule
    /// the shutdown (Go ran it on a goroutine after replying).
    pub close: Option<Box<dyn Fn() + Send + Sync>>,
}

#[derive(Default)]
pub struct Handler {
    pub engine: Option<Arc<dyn Engine>>,
    pub gate: Option<Arc<SessionGate>>,
    pub security: Option<Arc<dyn SecurityController>>,
    pub native: Native,
    pub windowed_editor: bool,
    pub lazy_editor: bool,
    /// Expected `Host`; empty accepts any (the custom protocol has no port).
    pub host: String,
    pub upload: Option<attachments::UploadAccess>,
    pub clipper: Option<Arc<clipper::Clipper>>,
    pub reminders: Option<Arc<inkism_reminders::Service>>,
    pub update: Option<Arc<app_update::Updater>>,
    /// Unsplash key file; `None` = `<database>.unsplash-key`.
    pub unsplash_key_path: Option<PathBuf>,
    pub(crate) unsplash: std::sync::OnceLock<unsplash::Unsplash>,
}

impl Handler {
    pub fn handle(&self, r: &Request) -> Response {
        let mut response = self.serve(r);
        response.headers.push(("x-content-type-options".into(), "nosniff".into()));
        response.headers.push(("cache-control".into(), "no-store".into()));
        response
    }

    fn serve(&self, r: &Request) -> Response {
        if let Some(rejected) = self.same_origin(r) {
            return rejected;
        }
        if let Some(response) = security::serve(self, r) {
            return response;
        }
        let _admission = if r.path != "/api/close" {
            match gate::enter(self.gate.as_deref()) {
                Some(guard) => Some(guard),
                None => return Response::fail(423, "app is locked"),
            }
        } else {
            None
        };
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        self.route(r, deadline)
    }

    /// Rejects requests for another host or from another origin.
    fn same_origin(&self, r: &Request) -> Option<Response> {
        if !self.host.is_empty() && r.host != self.host {
            return Some(Response::fail(403, "invalid host"));
        }
        if let Some(origin) = r.header("origin").filter(|o| !o.is_empty()) {
            let same = url::Url::parse(origin).ok().is_some_and(|u| {
                let host = u.host_str().unwrap_or("");
                let authority = match u.port() {
                    Some(p) => format!("{host}:{p}"),
                    None => host.to_string(),
                };
                authority == r.host
            });
            if !same {
                return Some(Response::fail(403, "cross-origin request rejected"));
            }
        }
        if r.header("sec-fetch-site") == Some("cross-site") {
            return Some(Response::fail(403, "cross-site request rejected"));
        }
        None
    }

    fn route(&self, r: &Request, deadline: Deadline) -> Response {
        let p = r.path.as_str();
        let m = r.method.as_str();
        match (m, p) {
            (_, "/api/portable/export") => portable::export(self, r, deadline),
            (_, "/api/editor/fonts") => fonts::installed(r),
            (_, "/api/export/markdown") => markdown_export::serve(self, r, deadline),
            (_, "/api/export/html") => export::formatted(self, r, false),
            (_, "/api/export/pdf") => export::formatted(self, r, true),
            (_, "/api/reminders/settings") => reminders::settings(self, r),
            (_, p) if p.starts_with("/api/unsplash/") => unsplash::serve(self, r, deadline),
            (_, "/api/reader") => reader::serve(r),
            (_, "/api/clipper") => clipper::serve(self, r),
            (_, "/api/publications") => publications::serve(self, r),
            ("GET" | "HEAD", p) if p.starts_with(attachments::PATH_PREFIX) => attachments::download(self, r),
            (_, p) if p.starts_with("/api/update/") => update::serve(self, r),
            ("GET", "/api/upload-access") => attachments::upload_access(self),
            ("GET", "/api/backup") => backup::export_bundle(self, r),
            ("POST", "/api/restore") => backup::restore_bundle(self, r),
            ("POST", "/api/attachments") => attachments::upload(self, r),
            ("GET", "/api/info") => storage::info(self),
            ("POST", "/api/storage/open") => storage::open(self, r),
            ("POST", "/api/storage/encrypted-copy") => storage::encrypted_copy(self, r),
            ("POST", "/api/rpc") => rpc::renderer(self, r, deadline),
            ("GET", "/api/export") => backup::export_json(self, r, deadline),
            ("POST", "/api/import") => backup::import_json(self, r, deadline),
            ("POST", "/api/close") => storage::close(self),
            _ => Response::not_found(),
        }
    }

    pub(crate) fn engine(&self) -> Result<&Arc<dyn Engine>> {
        self.engine.as_ref().ok_or_else(|| "engine is unavailable".into())
    }
}

/// `{"ok":true}` check on an engine reply.
pub(crate) fn success(raw: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(raw).ok().and_then(|v| v.get("ok")?.as_bool()) == Some(true)
}

/// The Go `emptyHostRequest`: host actions take no body and need a JSON or empty content type.
/// `Some` carries the rejection.
pub(crate) fn empty_host_request(r: &Request) -> Option<Response> {
    if !r.header("content-type").unwrap_or("").starts_with("application/json") {
        return Some(Response::fail(415, "JSON required"));
    }
    let empty = r.body.len() <= 128
        && serde_json::from_slice::<serde_json::Map<String, serde_json::Value>>(&r.body).is_ok_and(|m| m.is_empty());
    if !empty {
        return Some(Response::fail(400, "저장소 위치는 Windows 선택창에서 지정해 주세요"));
    }
    None
}
