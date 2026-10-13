//! Read-only Agent API (`docs/agent-api.md`): a loopback listener external AI
//! agents read notes through with per-agent bearer tokens. Off by default.
//! Tokens live only as SHA-256 hashes in `<library>.agent-api.json`. Trashed,
//! archived and locked notes, and notes outside a token's scope, are never
//! returned. Only GET is served, and only the read ops below reach the engine.

use crate::clipper::{accept, Receiver};
use crate::gate::{self, SessionGate};
use crate::{Engine, Handler, Request, Response, Result, REQUEST_TIMEOUT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

pub const DEFAULT_PORT: u16 = 47832;
const PREFIX: &str = "/agent/v1/";
const TOKEN_PREFIX: &str = "inkism_";
const MAX_TOKENS: usize = 50;
const MAX_BODY: u64 = 32 << 20;

/// Empty lists = every note. Otherwise a note matches by any notebook or any tag.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct Scope {
    pub notebooks: Vec<String>,
    pub tags: Vec<String>,
}

impl Scope {
    fn allows(&self, note: &Value) -> bool {
        let any = |field: &str, wanted: &[String]| {
            note[field].as_array().is_some_and(|v| v.iter().any(|x| x.as_str().is_some_and(|x| wanted.iter().any(|w| w == x))))
        };
        (self.notebooks.is_empty() && self.tags.is_empty()) || any("notebook_ids", &self.notebooks) || any("tags", &self.tags)
    }
    fn valid(&self) -> bool {
        let ok = |v: &[String]| v.len() <= 200 && v.iter().all(|s| !s.is_empty() && s.chars().count() <= 200);
        ok(&self.notebooks) && ok(&self.tags)
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Token {
    id: String,
    name: String,
    /// SHA-256 hex of the secret; the secret itself is shown once and never stored.
    hash: String,
    created_at: i64,
    scope: Scope,
}

#[derive(Serialize, Deserialize)]
#[serde(default)]
struct Config {
    enabled: bool,
    port: u16,
    tokens: Vec<Token>,
}

impl Default for Config {
    fn default() -> Self {
        Config { enabled: false, port: DEFAULT_PORT, tokens: Vec::new() }
    }
}

#[derive(Default)]
struct State {
    config: Config,
    runtime: Option<tokio::runtime::Runtime>,
    host: String,
    error: String,
}

pub struct AgentApi {
    path: Option<PathBuf>,
    engine: Arc<dyn Engine>,
    gate: Option<Arc<SessionGate>>,
    state: Mutex<State>,
}

fn hash(secret: &str) -> String {
    Sha256::digest(secret.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn random_hex(bytes: usize) -> Result<String> {
    let mut b = vec![0u8; bytes];
    getrandom::getrandom(&mut b).map_err(|e| e.to_string())?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// Engine cursors carry control characters; agents get URL-safe hex.
fn hex_cursor(c: &str) -> String {
    c.bytes().map(|b| format!("{b:02x}")).collect()
}
fn unhex_cursor(c: &str) -> Option<String> {
    if !c.len().is_multiple_of(2) || c.len() > 64 << 10 {
        return None;
    }
    let bytes = (0..c.len()).step_by(2).map(|i| u8::from_str_radix(c.get(i..i + 2)?, 16).ok()).collect::<Option<Vec<u8>>>()?;
    String::from_utf8(bytes).ok()
}

/// Atomic 0600 write, like the Unsplash key file.
fn write_private(path: &std::path::Path, data: &[u8]) -> Result<()> {
    let temp = path.with_file_name(format!(".agent-api-{}-{}", std::process::id(), now_ms()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let result = options.open(&temp).and_then(|mut f| {
        f.write_all(data)?;
        f.sync_all()
    });
    let result = result.and_then(|()| std::fs::rename(&temp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    Ok(result?)
}

impl AgentApi {
    /// Settings beside the library (`<db>.agent-api.json`); starts the listener if it was left on.
    pub fn start(engine: Arc<dyn Engine>, gate: Option<Arc<SessionGate>>) -> Arc<AgentApi> {
        let path = engine.database().map(|d| {
            let mut p = d.as_os_str().to_owned();
            p.push(".agent-api.json");
            PathBuf::from(p)
        });
        Self::with_path(engine, gate, path)
    }

    pub fn with_path(engine: Arc<dyn Engine>, gate: Option<Arc<SessionGate>>, path: Option<PathBuf>) -> Arc<AgentApi> {
        let mut state = State::default();
        match path.as_ref().map(std::fs::read) {
            None | Some(Err(_)) => {}
            Some(Ok(raw)) => match serde_json::from_slice(&raw) {
                Ok(config) => state.config = config,
                // Fail closed: an unreadable file never turns the API on.
                Err(_) => state.error = "Agent API 설정 파일을 읽지 못했습니다".into(),
            },
        }
        let api = Arc::new(AgentApi { path, engine, gate, state: Mutex::new(state) });
        if api.lock().config.enabled {
            api.listen(&mut api.lock());
        }
        api
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn listen(self: &Arc<Self>, s: &mut State) {
        let bound = (|| -> Result<(tokio::runtime::Runtime, String)> {
            // Loopback only, never 0.0.0.0.
            let listener = std::net::TcpListener::bind(("127.0.0.1", s.config.port))?;
            listener.set_nonblocking(true)?;
            let host = listener.local_addr()?.to_string();
            let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(1).thread_name("inkism-agent-api").enable_all().build()?;
            let listener = {
                let _enter = runtime.enter();
                tokio::net::TcpListener::from_std(listener)?
            };
            runtime.spawn(accept(listener, Arc::downgrade(self)));
            Ok((runtime, host))
        })();
        match bound {
            Ok((runtime, host)) => (s.runtime, s.host, s.error) = (Some(runtime), host, String::new()),
            Err(e) => s.error = format!("Agent API를 시작하지 못했습니다: {e}"),
        }
    }

    fn stop(s: &mut State) {
        if let Some(runtime) = s.runtime.take() {
            runtime.shutdown_background();
        }
        s.host.clear();
    }

    /// Stops the listener (app exit); settings stay as they are.
    pub fn close(&self) {
        Self::stop(&mut self.lock());
    }

    fn save(&self, s: &State) -> Result<()> {
        let Some(path) = &self.path else { return Err("설정을 저장할 위치가 없습니다".into()) };
        write_private(path, &serde_json::to_vec_pretty(&s.config)?)
    }

    fn status(&self) -> Value {
        let s = self.lock();
        let tokens: Vec<Value> = s.config.tokens.iter().map(|t| json!({"id": t.id, "name": t.name, "created_at": t.created_at, "scope": t.scope})).collect();
        json!({
            "enabled": s.config.enabled,
            "url": if s.host.is_empty() { String::new() } else { format!("http://{}{}", s.host, PREFIX.trim_end_matches('/')) },
            "error": s.error,
            "tokens": tokens,
        })
    }

    fn set_enabled(self: &Arc<Self>, on: bool) -> Result<()> {
        let mut s = self.lock();
        s.config.enabled = on;
        self.save(&s)?;
        Self::stop(&mut s);
        s.error.clear();
        if on {
            self.listen(&mut s);
        }
        Ok(())
    }

    /// Returns the secret; only its hash is kept.
    fn create(&self, name: &str, scope: Scope) -> Result<(String, Value)> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 || !scope.valid() {
            return Err("이름과 범위를 확인해 주세요".into());
        }
        let mut s = self.lock();
        if s.config.tokens.len() >= MAX_TOKENS {
            return Err("토큰은 50개까지 만들 수 있습니다".into());
        }
        let secret = format!("{TOKEN_PREFIX}{}", random_hex(32)?);
        let token = Token { id: random_hex(8)?, name: name.into(), hash: hash(&secret), created_at: now_ms(), scope };
        let item = json!({"id": token.id, "name": token.name, "created_at": token.created_at, "scope": token.scope});
        s.config.tokens.push(token);
        if let Err(e) = self.save(&s) {
            s.config.tokens.pop();
            return Err(e);
        }
        Ok((secret, item))
    }

    fn revoke(&self, id: &str) -> Result<()> {
        let mut s = self.lock();
        let before = s.config.tokens.clone();
        s.config.tokens.retain(|t| t.id != id);
        if s.config.tokens.len() == before.len() {
            return Err("토큰을 찾을 수 없습니다".into());
        }
        if let Err(e) = self.save(&s) {
            s.config.tokens = before;
            return Err(e);
        }
        Ok(())
    }

    /// The token's scope, comparing hashes in constant time.
    fn authorize(&self, r: &Request) -> Option<Scope> {
        let secret = r.header("authorization")?.strip_prefix("Bearer ")?.trim();
        if !secret.starts_with(TOKEN_PREFIX) {
            return None;
        }
        let presented = hash(secret);
        let s = self.lock();
        let mut found = None;
        for t in &s.config.tokens {
            if bool::from(subtle::ConstantTimeEq::ct_eq(t.hash.as_bytes(), presented.as_bytes())) {
                found = Some(t.scope.clone());
            }
        }
        found
    }

    fn serve(&self, r: &Request) -> Response {
        {
            let s = self.lock();
            // DNS rebinding: only our own loopback authority.
            let port = s.host.rsplit_once(':').map_or("", |(_, p)| p);
            if s.host.is_empty() || (r.host != s.host && r.host != format!("localhost:{port}")) {
                return Response::fail(403, "invalid host");
            }
        }
        // Agents are not browsers; any page request is refused outright.
        if r.header("origin").is_some() || r.header("sec-fetch-site").is_some() {
            return Response::fail(403, "browser requests are not accepted");
        }
        if r.method != "GET" {
            return Response::fail(405, "read-only API: GET only").with_header("allow", "GET");
        }
        let Some(scope) = self.authorize(r) else {
            return Response::fail(401, "invalid agent token").with_header("www-authenticate", "Bearer");
        };
        let Some(_admission) = gate::enter(self.gate.as_deref()) else {
            return Response::fail(423, "app is locked");
        };
        let query: std::collections::HashMap<String, String> = url::form_urlencoded::parse(r.query.as_deref().unwrap_or("").as_bytes()).into_owned().collect();
        let result = match r.path.strip_prefix(PREFIX) {
            Some("notes") => self.list(&scope, &query, None),
            Some("search") => match query.get("q").map(|q| q.trim()).filter(|q| !q.is_empty()) {
                Some(q) => self.list(&scope, &query, Some(q)),
                None => Err(Response::fail(400, "q required")),
            },
            Some("changes") => self.changes(&scope, &query),
            Some(p) if p.starts_with("notes/") && !p[6..].contains('/') => {
                let id = percent_encoding::percent_decode_str(&p[6..]).decode_utf8_lossy().into_owned();
                self.get(&scope, &id)
            }
            _ => Err(Response::fail(404, "not found")),
        };
        match result {
            Ok(data) => Response::json(200, &json!({"ok": true, "data": data})),
            Err(e) => e,
        }
    }

    /// One read op on the engine; failures become a response.
    fn call(&self, request: Value) -> std::result::Result<Value, Response> {
        let raw = self.engine.call(Instant::now() + REQUEST_TIMEOUT, request.to_string().as_bytes()).map_err(|e| Response::fail(500, e))?;
        let reply: Value = serde_json::from_slice(&raw).map_err(|_| Response::fail(500, "invalid engine reply"))?;
        if reply["ok"] == true {
            return Ok(reply["data"].clone());
        }
        let error = reply["error"].as_str().unwrap_or("request failed");
        // One answer for missing and hidden notes alike.
        Err(if error.starts_with("not_found") { Response::fail(404, "not found") } else { Response::fail(400, error) })
    }

    fn page_args(query: &std::collections::HashMap<String, String>, op: &str) -> std::result::Result<Value, Response> {
        let mut args = json!({"op": op});
        if let Some(limit) = query.get("limit") {
            args["limit"] = json!(limit.parse::<u32>().map_err(|_| Response::fail(400, "bad limit"))?);
        }
        if let Some(cursor) = query.get("cursor").filter(|c| !c.is_empty()) {
            args["cursor"] = json!(unhex_cursor(cursor).ok_or_else(|| Response::fail(400, "bad cursor"))?);
        }
        Ok(args)
    }

    /// A page can hold fewer than `limit` notes after filtering; continue while `next_cursor` is set.
    fn list(&self, scope: &Scope, query: &std::collections::HashMap<String, String>, q: Option<&str>) -> std::result::Result<Value, Response> {
        let mut args = Self::page_args(query, "list")?;
        args["view"] = json!("all");
        if let Some(q) = q {
            args["query"] = json!(q);
        }
        let data = self.call(args)?;
        let items: Vec<Value> = data["items"].as_array().into_iter().flatten().filter(|n| visible(scope, n)).map(summary).collect();
        Ok(json!({"items": items, "next_cursor": data["next_cursor"].as_str().map(hex_cursor)}))
    }

    fn get(&self, scope: &Scope, id: &str) -> std::result::Result<Value, Response> {
        // The bounded engine read also refuses locked and trashed notes itself.
        let note = self.call(json!({"op": "get", "id": id, "max_body_bytes": MAX_BODY}))?;
        if !visible(scope, &note) {
            return Err(Response::fail(404, "not found"));
        }
        let mut out = summary(&note);
        out["text"] = note["text"].clone();
        out["markdown"] = if note["content_format"] == "markdown" { note["content"].clone() } else { Value::Null };
        Ok(out)
    }

    /// Notes changed after the cursor in `(updated_at,id)` order. A note that left
    /// the token's view (trashed, archived, locked, out of scope) comes back as
    /// `{id, updated_at, removed:true}` so a synced copy can drop it.
    fn changes(&self, scope: &Scope, query: &std::collections::HashMap<String, String>) -> std::result::Result<Value, Response> {
        let data = self.call(Self::page_args(query, "changes")?)?;
        let items: Vec<Value> = data["items"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|n| if visible(scope, n) { summary(n) } else { json!({"id": n["id"], "updated_at": n["updated_at"], "removed": true}) })
            .collect();
        Ok(json!({"items": items, "next_cursor": hex_cursor(data["next_cursor"].as_str().unwrap_or("")), "has_more": data["has_more"]}))
    }
}

fn visible(scope: &Scope, note: &Value) -> bool {
    note["trashed"] == false && note["locked"] == false && note["archived"] == false && scope.allows(note)
}

/// Properties an agent sees; everything else stays in the app.
fn summary(n: &Value) -> Value {
    let mut out = json!({});
    for k in ["id", "title", "preview", "content_format", "notebook_ids", "tags", "created_at", "updated_at", "revision"] {
        if let Some(v) = n.get(k) {
            out[k] = v.clone();
        }
    }
    out["removed"] = json!(false);
    out
}

impl Receiver for AgentApi {
    const LIMIT: usize = 0; // GET only; any body is ignored
    fn respond(&self, r: &Request) -> Response {
        self.serve(r).with_header("cache-control", "no-store").with_header("x-content-type-options", "nosniff")
    }
}

impl Drop for AgentApi {
    fn drop(&mut self) {
        // Dropping a runtime inside async context panics; background shutdown never does.
        Self::stop(self.state.get_mut().unwrap_or_else(|e| e.into_inner()));
    }
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields, default)]
struct Command {
    action: String,
    name: String,
    id: String,
    scope: Scope,
}

/// `/api/agent`: settings through the same-origin, unlocked app handler.
pub(crate) fn settings(h: &Handler, r: &Request) -> Response {
    let Some(api) = &h.agent else { return Response::fail(503, "Agent API를 사용할 수 없습니다") };
    if r.method == "GET" {
        return Response::json(200, &json!({"ok": true, "data": api.status()}));
    }
    if r.method != "POST" {
        return Response::fail(405, "method not allowed");
    }
    if !r.header("content-type").unwrap_or("").starts_with("application/json") {
        return Response::fail(415, "JSON required");
    }
    let Ok(c) = serde_json::from_slice::<Command>(&r.body).map_err(|_| ()).and_then(|c| if r.body.len() <= 64 << 10 { Ok(c) } else { Err(()) }) else {
        return Response::fail(400, "invalid agent command");
    };
    let done = match c.action.as_str() {
        "enable" | "disable" => api.set_enabled(c.action == "enable").map(|()| Value::Null),
        "create" => api.create(&c.name, c.scope).map(|(token, item)| json!({"token": token, "item": item})),
        "revoke" => api.revoke(&c.id).map(|()| Value::Null),
        _ => return Response::fail(400, "invalid agent command"),
    };
    match done {
        Ok(data) => Response::json(200, &json!({"ok": true, "data": data, "status": api.status()})),
        Err(e) => Response::fail(400, e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::fake::request;
    use crate::Deadline;

    /// The real engine in-process.
    struct Real(Mutex<inkism_engine::Engine>);
    impl Engine for Real {
        fn call(&self, _: Deadline, request: &[u8]) -> Result<Vec<u8>> {
            let req: Value = serde_json::from_slice(request)?;
            Ok(serde_json::to_vec(&self.0.lock().unwrap().execute(req))?)
        }
    }

    struct Fixture {
        _dir: tempfile::TempDir,
        engine: Arc<Real>,
        api: Arc<AgentApi>,
        handler: Handler,
        config: PathBuf,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let engine = Arc::new(Real(Mutex::new(inkism_engine::Engine::open(dir.path().join("notes.db").to_str().unwrap()).unwrap())));
        let config = dir.path().join("notes.db.agent-api.json");
        std::fs::write(&config, r#"{"port":0}"#).unwrap();
        let api = AgentApi::with_path(engine.clone(), None, Some(config.clone()));
        let handler = Handler { agent: Some(api.clone()), ..Handler::default() };
        Fixture { _dir: dir, engine, api, handler, config }
    }

    impl Fixture {
        fn rpc(&self, req: Value) -> Value {
            let reply = self.engine.0.lock().unwrap().execute(req);
            assert_eq!(reply["ok"], true, "{reply}");
            reply["data"].clone()
        }
        fn note(&self, title: &str, extra: Value) -> String {
            let mut note = json!({"title": title, "content": format!("{title} body"), "content_format": "markdown"});
            note.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            let id = self.rpc(json!({"op": "save", "note": note}))["id"].as_str().unwrap().to_string();
            std::thread::sleep(std::time::Duration::from_millis(2)); // distinct updated_at
            id
        }
        fn command(&self, body: Value) -> Value {
            let out = self.handler.handle(&request("POST", "x", "/api/agent", &body.to_string(), &[("Content-Type", "application/json")]));
            let v: Value = serde_json::from_slice(&out.body).unwrap();
            assert_eq!(out.status, 200, "{v}");
            v
        }
        fn token(&self, scope: Value) -> String {
            self.command(json!({"action": "create", "name": "agent", "scope": scope}))["data"]["token"].as_str().unwrap().to_string()
        }
        fn host(&self) -> String {
            self.api.lock().host.clone()
        }
        fn raw(&self, method: &str, path_query: &str, headers: &[(&str, &str)]) -> Response {
            let (path, query) = path_query.split_once('?').map_or((path_query, None), |(p, q)| (p, Some(q.to_string())));
            let r = Request {
                method: method.into(),
                path: path.into(),
                query,
                headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
                host: self.host(),
                body: Vec::new(),
            };
            self.api.respond(&r)
        }
        fn get(&self, token: &str, path_query: &str) -> (u16, Value) {
            let bearer = format!("Bearer {token}");
            let out = self.raw("GET", path_query, &[("authorization", &bearer)]);
            (out.status, serde_json::from_slice(&out.body).unwrap())
        }
        fn ids(&self, token: &str, path_query: &str) -> Vec<String> {
            let (status, v) = self.get(token, path_query);
            assert_eq!(status, 200, "{v}");
            v["data"]["items"].as_array().unwrap().iter().map(|n| n["id"].as_str().unwrap().to_string()).collect()
        }
    }

    #[test]
    fn off_by_default_and_stores_only_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Arc::new(Real(Mutex::new(inkism_engine::Engine::open(dir.path().join("notes.db").to_str().unwrap()).unwrap())));
        let api = AgentApi::with_path(engine, None, Some(dir.path().join("x.json")));
        assert_eq!(api.status()["enabled"], false);
        assert_eq!(api.status()["url"], "");
        let f = fixture();
        let token = f.token(json!({}));
        let saved = std::fs::read_to_string(&f.config).unwrap();
        assert!(!saved.contains(&token) && saved.contains(&hash(&token)), "secret persisted");
        // Not enabled: no listener, nothing served.
        assert_eq!(f.host(), "");
        assert_eq!(f.raw("GET", "/agent/v1/notes", &[("authorization", &format!("Bearer {token}"))]).status, 403);
    }

    #[test]
    fn listener_binds_loopback_and_stops() {
        let f = fixture();
        f.command(json!({"action": "enable"}));
        let host = f.host();
        assert!(host.starts_with("127.0.0.1:"), "{host}");
        assert!(std::net::TcpStream::connect(&host).is_ok());
        assert!(f.api.status()["url"].as_str().unwrap().ends_with("/agent/v1"));
        f.command(json!({"action": "disable"}));
        assert_eq!(f.host(), "");
        // The setting persists and a restart honours it (off).
        assert!(std::fs::read_to_string(&f.config).unwrap().contains("\"enabled\": false"));
    }

    #[test]
    fn rejects_bad_auth_host_and_browsers() {
        let f = fixture();
        f.command(json!({"action": "enable"}));
        let token = f.token(json!({}));
        f.note("a", json!({}));
        assert_eq!(f.get(&token, "/agent/v1/notes").0, 200);
        for header in ["", "Bearer ", "Bearer inkism_00", "Basic x"] {
            let out = f.raw("GET", "/agent/v1/notes", &[("authorization", header)]);
            assert_eq!(out.status, 401, "{header}");
        }
        assert_eq!(f.raw("GET", "/agent/v1/notes", &[]).status, 401);
        let bearer = format!("Bearer {token}");
        assert_eq!(f.raw("GET", "/agent/v1/notes", &[("authorization", &bearer), ("origin", "https://evil.test")]).status, 403);
        let mut evil = Request { method: "GET".into(), path: "/agent/v1/notes".into(), query: None, headers: vec![("authorization".into(), bearer.clone())], host: "evil.test".into(), body: vec![] };
        assert_eq!(f.api.respond(&evil).status, 403, "rebinding host accepted");
        evil.host = format!("localhost:{}", f.host().rsplit_once(':').unwrap().1);
        assert_eq!(f.api.respond(&evil).status, 200);
        let id = f.command(json!({"action": "create", "name": "b", "scope": {}}))["status"]["tokens"][0]["id"].as_str().unwrap().to_string();
        f.command(json!({"action": "revoke", "id": id}));
        assert_eq!(f.get(&token, "/agent/v1/notes").0, 401, "revoked token still works");
        assert_eq!(f.get(&token, "/agent/v1/nope").0, 401);
    }

    #[test]
    fn write_operations_are_unreachable() {
        let f = fixture();
        f.command(json!({"action": "enable"}));
        let token = f.token(json!({}));
        let id = f.note("keep", json!({}));
        let before = f.rpc(json!({"op": "get", "id": id}));
        let bearer = format!("Bearer {token}");
        for method in ["POST", "PUT", "PATCH", "DELETE"] {
            for path in ["/agent/v1/notes", &format!("/agent/v1/notes/{id}"), "/api/rpc", "/agent/v1/rpc"] {
                assert_eq!(f.raw(method, path, &[("authorization", &bearer)]).status, 405, "{method} {path}");
            }
        }
        for path in ["/api/rpc", "/agent/v1/rpc", "/agent/v1/notes/x/delete", "/agent/v2/notes", "/api/agent"] {
            assert_eq!(f.get(&token, path).0, 404, "{path}");
        }
        assert_eq!(f.rpc(json!({"op": "get", "id": id})), before, "note changed");
    }

    #[test]
    fn hides_locked_trashed_archived_everywhere() {
        let f = fixture();
        f.command(json!({"action": "enable"}));
        let token = f.token(json!({}));
        let open = f.note("needle open", json!({}));
        let trashed = f.note("needle trashed", json!({}));
        let archived = f.note("needle archived", json!({}));
        let locked = f.note("needle locked", json!({}));
        f.rpc(json!({"op": "patch", "id": trashed, "changes": {"trashed": true}}));
        f.rpc(json!({"op": "patch", "id": archived, "changes": {"archived": true}}));
        f.engine.0.lock().unwrap().connection().execute("UPDATE notes_meta SET locked=1 WHERE id=?1", [&locked]).unwrap();
        assert_eq!(f.ids(&token, "/agent/v1/notes"), [open.as_str()]);
        f.rpc(json!({"op": "wait_index"}));
        assert_eq!(f.ids(&token, "/agent/v1/search?q=needle"), [open.as_str()]);
        for hidden in [&trashed, &archived, &locked] {
            let (status, body) = f.get(&token, &format!("/agent/v1/notes/{hidden}"));
            assert_eq!(status, 404, "{body}");
        }
        let (status, note) = f.get(&token, &format!("/agent/v1/notes/{open}"));
        assert_eq!(status, 200);
        assert_eq!(note["data"]["markdown"], "needle open body");
        assert_eq!(note["data"]["title"], "needle open");
        let (_, changes) = f.get(&token, "/agent/v1/changes");
        for item in changes["data"]["items"].as_array().unwrap() {
            let hidden = item["id"] != open.as_str();
            assert_eq!(item["removed"], hidden);
            assert_eq!(item.get("title").is_some(), !hidden, "hidden note leaked properties: {item}");
        }
    }

    #[test]
    fn scope_limits_notebooks_and_tags() {
        let f = fixture();
        f.command(json!({"action": "enable"}));
        let nb = f.rpc(json!({"op": "save_notebook", "name": "work"}))["id"].as_str().unwrap().to_string();
        let in_nb = f.note("in notebook", json!({"notebook_id": nb}));
        let tagged = f.note("tagged", json!({"tags": ["share"]}));
        let other = f.note("other", json!({"tags": ["private"]}));
        let by_nb = f.token(json!({"notebooks": [nb]}));
        let by_tag = f.token(json!({"tags": ["share"]}));
        let both = f.token(json!({"notebooks": [nb], "tags": ["share"]}));
        let all = f.token(json!({}));
        assert_eq!(f.ids(&by_nb, "/agent/v1/notes"), [in_nb.as_str()]);
        assert_eq!(f.ids(&by_tag, "/agent/v1/notes"), [tagged.as_str()]);
        assert_eq!(f.ids(&both, "/agent/v1/notes").len(), 2);
        assert_eq!(f.ids(&all, "/agent/v1/notes").len(), 3);
        assert_eq!(f.get(&by_nb, &format!("/agent/v1/notes/{other}")).0, 404);
        assert_eq!(f.get(&by_nb, &format!("/agent/v1/notes/{tagged}")).0, 404);
        assert_eq!(f.get(&by_tag, &format!("/agent/v1/notes/{tagged}")).0, 200);
        let bad = json!({"action": "create", "name": "x", "scope": {"tags": [""]}}).to_string();
        assert_eq!(f.handler.handle(&request("POST", "x", "/api/agent", &bad, &[("Content-Type", "application/json")])).status, 400);
    }

    #[test]
    fn pages_and_change_cursor() {
        let f = fixture();
        f.command(json!({"action": "enable"}));
        let token = f.token(json!({}));
        let made: Vec<String> = (0..5).map(|i| f.note(&format!("n{i}"), json!({}))).collect();
        let (mut seen, mut cursor) = (Vec::new(), String::new());
        loop {
            let (status, page) = f.get(&token, &format!("/agent/v1/notes?limit=2&cursor={cursor}"));
            assert_eq!(status, 200, "{page}");
            let items = page["data"]["items"].as_array().unwrap();
            assert!(items.len() <= 2);
            seen.extend(items.iter().map(|n| n["id"].as_str().unwrap().to_string()));
            match page["data"]["next_cursor"].as_str() {
                Some(c) => cursor = c.to_string(),
                None => break,
            }
        }
        let mut sorted = seen.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 5, "paging lost or repeated notes: {seen:?}");
        assert_eq!(f.get(&token, "/agent/v1/notes?cursor=zz").0, 400);

        let (_, first) = f.get(&token, "/agent/v1/changes?limit=3");
        assert_eq!(first["data"]["has_more"], true);
        let (_, rest) = f.get(&token, &format!("/agent/v1/changes?cursor={}", first["data"]["next_cursor"].as_str().unwrap()));
        let cursor = rest["data"]["next_cursor"].as_str().unwrap().to_string();
        assert_eq!(rest["data"]["items"].as_array().unwrap().len(), 2);
        let (_, idle) = f.get(&token, &format!("/agent/v1/changes?cursor={cursor}"));
        assert!(idle["data"]["items"].as_array().unwrap().is_empty());
        assert_eq!(idle["data"]["next_cursor"], cursor.as_str());
        let current = f.rpc(json!({"op": "get", "id": made[1]}));
        f.rpc(json!({"op": "patch", "id": made[1], "revision": current["revision"], "changes": {"title": "edited"}}));
        std::thread::sleep(std::time::Duration::from_millis(2));
        f.rpc(json!({"op": "patch", "id": made[2], "changes": {"trashed": true}}));
        let (_, delta) = f.get(&token, &format!("/agent/v1/changes?cursor={cursor}"));
        let items = delta["data"]["items"].as_array().unwrap();
        assert_eq!(items.len(), 2, "{delta}");
        assert_eq!((items[0]["id"].as_str().unwrap(), &items[0]["title"], &items[0]["removed"]), (made[1].as_str(), &json!("edited"), &json!(false)));
        assert_eq!((items[1]["id"].as_str().unwrap(), &items[1]["removed"]), (made[2].as_str(), &json!(true)));
    }
}
