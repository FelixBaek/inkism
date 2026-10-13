//! Explicitly published, sanitized, expiring snapshots. Public requests get
//! exactly one bounded publication by capability, never a listing or sync data.
use crate::{
    closing, empty, error, gojson, not_found, read_limited, respond, sanitize, store, Body, Relay,
    ReqBody,
};
use hyper::header::{HeaderValue, CONTENT_TYPE};
use hyper::{Method, Request, Response, StatusCode};
use ring::pbkdf2;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ACTIVE: usize = 100;

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Publication {
    id: String,
    title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    html: String,
    created: i64,
    expires: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    password_hash: String,
    invite_only: bool,
    version: u64,
    pages: Vec<Page>,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
struct Page {
    id: String,
    title: String,
    html: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Share {
    id: String,
    publication_id: String,
    role: String,
    password_hash: String,
    created: i64,
    expires: i64,
    revoked: bool,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn capability(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
async fn host_allowed<B>(r: &Relay, q: &Request<B>) -> bool {
    let configured = r
        .db(|s| s.view(|tx| store::get(tx, store::SETTINGS, b"allowed_hosts")))
        .await
        .ok()
        .flatten();
    let host = q
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    if let Some(raw) = configured {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&raw) {
            if let Some(hosts) = v["hosts"].as_array().filter(|h| !h.is_empty()) {
                if !hosts
                    .iter()
                    .any(|h| h.as_str().is_some_and(|h| h.eq_ignore_ascii_case(host)))
                {
                    return false;
                }
            }
        }
    }
    let Some(raw) = std::env::var_os("INKISM_RELAY_ALLOWED_HOSTS") else {
        return true;
    };
    let host = q
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    raw.to_string_lossy()
        .split(',')
        .map(str::trim)
        .any(|allowed| !allowed.is_empty() && allowed.eq_ignore_ascii_case(host))
}

/// html.EscapeString
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '\'' => out.push_str("&#39;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&#34;"),
            c => out.push(c),
        }
    }
    out
}

pub async fn serve_public<B>(r: &Relay, q: &Request<B>, path: &str) -> Response<Body> {
    if !host_allowed(r, q).await {
        return respond(StatusCode::FORBIDDEN, &error("host is not allowed"));
    }
    let head = q.method() == Method::HEAD;
    if q.method() != Method::GET && !head {
        return not_found();
    }
    let id = path["/p/".len()..].to_owned();
    if !capability(&id) || q.uri().query().is_some_and(|s| !s.is_empty()) {
        return not_found();
    }
    let found = r
        .db(move |s| s.view(|tx| store::get(tx, store::PUBLICATIONS, id.as_bytes())))
        .await;
    let Ok(Some(data)) = found else {
        return not_found();
    };
    let Ok(p) = serde_json::from_slice::<Publication>(&data) else {
        return not_found();
    };
    if p.expires <= now() {
        return not_found();
    }
    if p.invite_only {
        return respond(
            StatusCode::UNAUTHORIZED,
            &error("use an active invitation link"),
        );
    }
    if !password_ok(&p.password_hash, &request_password(q)) {
        return public_app(StatusCode::UNAUTHORIZED);
    }
    if wants_json(q) {
        return public_data(&p, "viewer");
    }
    if !p.pages.is_empty() {
        return public_app(StatusCode::OK);
    }
    let mut res = empty(StatusCode::OK);
    *res.body_mut() = if head {
        Body::none()
    } else {
        let title = escape(&p.title);
        Body::new(format!("<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title><style>body{{max-width:760px;margin:40px auto;padding:20px;font:17px/1.7 system-ui;overflow-wrap:anywhere}}table{{border-collapse:collapse}}td,th{{border:1px solid #aaa;padding:6px}}pre{{white-space:pre-wrap}}</style><h1>{title}</h1><main>{}</main></html>", p.html))
    };
    let h = res.headers_mut();
    h.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    h.insert("content-security-policy", HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox"));
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow, noarchive"),
    );
    res
}

// Older relays kept revision bodies here for shared editing; only removal of
// that legacy data remains.
const HISTORY: &str = "publication-merge-history-v1";
fn clear_history(tx:&rusqlite::Transaction,id:&str)->Result<(),store::Error>{
    let prefix=format!("{id}:");for(key,_)in store::scan(tx,HISTORY,prefix.as_bytes(),17)?{if !key.starts_with(prefix.as_bytes()){break;}store::delete(tx,HISTORY,&key)?;}Ok(())
}

/// Owner routes; the caller already checked the bearer token.
pub async fn serve_owner<B: ReqBody>(r: &Relay, q: Request<B>, path: &str) -> Response<Body> {
    let header = |name: &str| {
        q.headers()
            .get(name)
            .map(HeaderValue::as_bytes)
            .unwrap_or_default()
    };
    if !header("origin").is_empty() || header("sec-fetch-site") == b"cross-site" {
        return respond(
            StatusCode::FORBIDDEN,
            &error("browser owner requests rejected"),
        );
    }
    if q.uri().query().is_some_and(|s| !s.is_empty()) {
        return not_found();
    }
    match (path, q.method().clone()) {
        ("/v1/publications", Method::GET) => list(r).await,
        ("/v1/publications", Method::POST) => create(r, q).await,
        (p, Method::DELETE) if p.starts_with("/v1/publications/") => {
            revoke(r, p["/v1/publications/".len()..].to_owned()).await
        }
        (p, Method::PUT) if p.starts_with("/v1/publications/") => {
            update(r, q, p["/v1/publications/".len()..].to_owned()).await
        }
        ("/v1/shares", Method::POST) => create_share(r, q).await,
        ("/v1/shares", Method::GET) => list_shares(r).await,
        (p, Method::DELETE) if p.starts_with("/v1/shares/") => {
            revoke_share(r, p["/v1/shares/".len()..].to_owned()).await
        }
        ("/v1/settings/domain", Method::GET) => domain_get(r).await,
        ("/v1/settings/domain", Method::PUT) => domain_set(r, q).await,
        _ => not_found(),
    }
}

async fn domain_get(r: &Relay) -> Response<Body> {
    match r
        .db(|s| s.view(|tx| store::get(tx, store::SETTINGS, b"allowed_hosts")))
        .await
    {
        Ok(Some(v)) => respond(
            StatusCode::OK,
            &serde_json::from_slice::<serde_json::Value>(&v)
                .unwrap_or_else(|_| serde_json::json!({"hosts":[]})),
        ),
        Ok(None) => respond(StatusCode::OK, &serde_json::json!({"hosts":[]})),
        Err(_) => respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error("domain settings failed"),
        ),
    }
}
async fn domain_set<B: ReqBody>(r: &Relay, q: Request<B>) -> Response<Body> {
    let (buf, broken, over) = read_limited(q.into_body(), 8192).await;
    if broken || over {
        return respond(StatusCode::BAD_REQUEST, &error("invalid domain settings"));
    };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf) else {
        return respond(StatusCode::BAD_REQUEST, &error("invalid domain settings"));
    };
    let Some(hosts) = v["hosts"].as_array() else {
        return respond(StatusCode::BAD_REQUEST, &error("hosts must be an array"));
    };
    if hosts.len() > 20 {
        return respond(StatusCode::BAD_REQUEST, &error("too many hosts"));
    };
    let mut out = Vec::new();
    for h in hosts {
        let Some(h) = h.as_str() else {
            return respond(StatusCode::BAD_REQUEST, &error("invalid host"));
        };
        let h = h.trim().to_ascii_lowercase();
        if h.is_empty()
            || h.len() > 253
            || h.contains('/')
            || h.contains(':')
            || !h.split('.').all(|part| {
                !part.is_empty()
                    && part.len() <= 63
                    && !part.starts_with('-')
                    && !part.ends_with('-')
                    && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
            || h.parse::<std::net::IpAddr>().is_ok()
        {
            return respond(StatusCode::BAD_REQUEST, &error("invalid host"));
        };
        out.push(h);
    }
    out.sort();
    out.dedup();
    let data = serde_json::to_vec(&serde_json::json!({"hosts":out})).unwrap_or_default();
    match r
        .db(move |s| s.update(|tx| store::put(tx, store::SETTINGS, b"allowed_hosts", &data)))
        .await
    {
        Ok(()) => respond(
            StatusCode::OK,
            &serde_json::json!({"hosts":out,"restart_required":false}),
        ),
        Err(_) => respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error("domain settings failed"),
        ),
    }
}

fn hex_bytes(v: &[u8]) -> String {
    v.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.is_ascii() || s.len() % 2 != 0 {
        return None;
    }
    Some(
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16))
            .collect::<Result<Vec<_>, _>>()
            .ok()?,
    )
}
fn hash_password(password: &str) -> String {
    if password.is_empty() {
        return String::new();
    }
    let mut salt = [0u8; 16];
    if SystemRandom::new().fill(&mut salt).is_err() {
        return "unavailable".into();
    }
    let mut out = [0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(120_000).unwrap(),
        &salt,
        password.as_bytes(),
        &mut out,
    );
    format!("v1${}${}", hex_bytes(&salt), hex_bytes(&out))
}
fn password_ok(stored: &str, password: &str) -> bool {
    if stored.is_empty() {
        return true;
    }
    let mut p = stored.split('$');
    if p.next() != Some("v1") {
        return false;
    }
    let Some(salt) = p.next().and_then(unhex) else {
        return false;
    };
    let Some(expected) = p.next().and_then(unhex) else {
        return false;
    };
    pbkdf2::verify(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(120_000).unwrap(),
        &salt,
        password.as_bytes(),
        &expected,
    )
    .is_ok()
}
fn valid_token(s: &str) -> bool {
    capability(s)
}

async fn create_share<B: ReqBody>(r: &Relay, q: Request<B>) -> Response<Body> {
    let (buf, broken, over) = read_limited(q.into_body(), 16 * 1024).await;
    if broken || over {
        return respond(StatusCode::BAD_REQUEST, &error("invalid share"));
    }
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf) else {
        return respond(StatusCode::BAD_REQUEST, &error("invalid share"));
    };
    let Some(publication_id) = v["publication_id"].as_str().filter(|s| capability(s)) else {
        return respond(StatusCode::BAD_REQUEST, &error("invalid publication"));
    };
    // Invitations are read-only; editing by other people is not offered.
    let role = v["role"].as_str().unwrap_or("viewer");
    if role != "viewer" {
        return respond(StatusCode::BAD_REQUEST, &error("invalid role"));
    }
    let password = v["password"].as_str().unwrap_or("");
    if password.len() > 512 {
        return respond(StatusCode::BAD_REQUEST, &error("invalid password"));
    }
    let exists = r
        .db({
            let id = publication_id.to_owned();
            move |s| s.view(|tx| store::get(tx, store::PUBLICATIONS, id.as_bytes()))
        })
        .await
        .ok()
        .flatten();
    if !exists
        .as_ref()
        .and_then(|v| serde_json::from_slice::<Publication>(v).ok())
        .is_some_and(|p| p.expires > now())
    {
        return not_found();
    }
    let mut secret = [0u8; 32];
    if SystemRandom::new().fill(&mut secret).is_err() {
        return respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error("token generation failed"),
        );
    }
    let id = secret
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let share = Share {
        id: id.clone(),
        publication_id: publication_id.into(),
        role: role.into(),
        password_hash: hash_password(password),
        created: now(),
        expires: now() + 30 * 24 * 3600,
        revoked: false,
    };
    let data = serde_json::to_vec(&share).unwrap_or_default();
    let pub_id = share.publication_id.clone();
    match r
        .db(move |s| {
            s.update(|tx| {
                store::put(tx, store::SHARES, id.as_bytes(), &data)?;
                if let Some(raw) = store::get(tx, store::PUBLICATIONS, pub_id.as_bytes())? {
                    let mut p: Publication = serde_json::from_slice(&raw)?;
                    p.invite_only = true;
                    store::put(
                        tx,
                        store::PUBLICATIONS,
                        p.id.as_bytes(),
                        &serde_json::to_vec(&p)?,
                    )?;
                }
                Ok(())
            })
        })
        .await
    {
        Ok(()) => respond(StatusCode::CREATED, &json_share(&share)),
        Err(_) => respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error("share storage failed"),
        ),
    }
}
fn json_share(s: &Share) -> serde_json::Value {
    serde_json::json!({"id":s.id,"publication_id":s.publication_id,"role":"viewer","created":s.created,"expires":s.expires})
}
async fn list_shares(r: &Relay) -> Response<Body> {
    match r
        .db(|s| {
            s.view(|tx| {
                let mut out = Vec::new();
                for (_, v) in store::scan(tx, store::SHARES, b"", usize::MAX)? {
                    if let Ok(x) = serde_json::from_slice::<Share>(&v) {
                        if !x.revoked && x.expires > now() {
                            out.push(json_share(&x));
                        }
                    }
                }
                Ok(out)
            })
        })
        .await
    {
        Ok(v) => respond(StatusCode::OK, &v),
        Err(_) => respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error("share list failed"),
        ),
    }
}
async fn revoke_share(r: &Relay, id: String) -> Response<Body> {
    if !valid_token(&id) {
        return not_found();
    }
    match r
        .db(move |s| {
            s.update(|tx| {
                let Some(raw) = store::get(tx, store::SHARES, id.as_bytes())? else {
                    return Ok(());
                };
                let mut x: Share = serde_json::from_slice(&raw)?;
                x.revoked = true;
                store::put(tx, store::SHARES, id.as_bytes(), &serde_json::to_vec(&x)?)
            })
        })
        .await
    {
        Ok(()) => crate::build(StatusCode::NO_CONTENT, None, Body::none()),
        Err(_) => respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error("share revoke failed"),
        ),
    }
}

pub async fn serve_share<B: ReqBody>(r: &Relay, q: Request<B>) -> Response<Body> {
    if !host_allowed(r, &q).await {
        return respond(StatusCode::FORBIDDEN, &error("host is not allowed"));
    }
    let id = q.uri().path().strip_prefix("/s/").unwrap_or("").to_owned();
    if !valid_token(&id) || q.uri().query().is_some() {
        return not_found();
    }
    let raw = r
        .db({
            let id = id.clone();
            move |s| s.view(|tx| store::get(tx, store::SHARES, id.as_bytes()))
        })
        .await
        .ok()
        .flatten();
    let Some(raw) = raw else { return not_found() };
    let Ok(share) = serde_json::from_slice::<Share>(&raw) else {
        return not_found();
    };
    if share.revoked || share.expires <= now() {
        return not_found();
    }
    let password = request_password(&q);
    if !password_ok(&share.password_hash, &password) {
        return public_app(StatusCode::UNAUTHORIZED);
    }
    if q.method() != Method::GET {
        return not_found();
    }
    let raw = r
        .db(move |s| {
            s.view(|tx| store::get(tx, store::PUBLICATIONS, share.publication_id.as_bytes()))
        })
        .await
        .ok()
        .flatten();
    let Some(raw) = raw else { return not_found() };
    let Ok(p) = serde_json::from_slice::<Publication>(&raw) else {
        return not_found();
    };
    if p.expires <= now() {
        return not_found();
    }
    if wants_json(&q) {
        // Invitations stored as "editor" by older versions read as viewers.
        public_data(&p, "viewer")
    } else {
        public_app(StatusCode::OK)
    }
}

async fn list(r: &Relay) -> Response<Body> {
    let listed = r
        .db(|s| {
            s.view(|tx| {
                let mut items = Vec::new();
                for (_, v) in store::scan(tx, store::PUBLICATIONS, b"", usize::MAX)? {
                    let mut p: Publication = serde_json::from_slice(&v)?;
                    if p.expires > now() {
                        p.html.clear();
                        p.password_hash.clear();
                        for page in &mut p.pages {
                            page.html.clear();
                        }
                        items.push(p);
                    }
                }
                Ok(items)
            })
        })
        .await;
    match listed {
        Ok(items) => respond(StatusCode::OK, &items),
        Err(_) => respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error("publication list failed"),
        ),
    }
}

async fn create<B: ReqBody>(r: &Relay, q: Request<B>) -> Response<Body> {
    let (buf, broken, over) = read_limited(q.into_body(), sanitize::MAX_BYTES + 8192).await;
    closing(create_from(r, &buf, broken).await, over)
}

async fn create_from(r: &Relay, buf: &[u8], broken: bool) -> Response<Body> {
    let invalid = || respond(StatusCode::BAD_REQUEST, &error("invalid snapshot"));
    let Ok((obj, clean)) =
        gojson::decode_first(buf, Some(&["title", "html", "days", "password", "pages"]))
    else {
        return invalid();
    };
    let (Ok(title), Ok(html), Ok(days)) =
        (obj.string("title"), obj.string("html"), obj.i64("days"))
    else {
        return invalid();
    };
    if !(1..=30).contains(&days) || title.len() > 1024 {
        return invalid();
    }
    if !clean || broken {
        return respond(StatusCode::BAD_REQUEST, &error("trailing data"));
    }
    let html = match sanitize::clean(&html) {
        Ok(h) => h,
        Err(e) => return respond(StatusCode::BAD_REQUEST, &error(&e)),
    };
    let mut secret = [0u8; 32];
    if SystemRandom::new().fill(&mut secret).is_err() {
        return respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error("capability generation failed"),
        );
    }
    let v: serde_json::Value = serde_json::from_slice(buf).unwrap_or_default();
    let Ok(pages) = pages_from(&v) else {
        return invalid();
    };
    let password = v["password"].as_str().unwrap_or("");
    if password.len() > 512 {
        return invalid();
    }
    let created = now();
    let mut p = Publication {
        id: secret.iter().map(|b| format!("{b:02x}")).collect(),
        title,
        html,
        created,
        expires: created + days * 24 * 3600,
        password_hash: hash_password(password),
        invite_only: false,
        version: 1,
        pages,
    };
    let data = gojson::marshal(&p);
    let id = p.id.clone();
    let stored = r
        .db(move |s| s.update(|tx| store_publication(tx, &id, &data)))
        .await;
    if stored.is_err() {
        return respond(
            StatusCode::CONFLICT,
            &error("snapshot limit or storage failure"),
        );
    }
    p.html.clear();
    p.password_hash.clear();
    for page in &mut p.pages {
        page.html.clear();
    }
    respond(StatusCode::CREATED, &p)
}

/// Drops expired snapshots and stores the new one within the active cap.
/// A failure rolls the expiry cleanup back too, like the bbolt transaction.
fn store_publication(
    tx: &rusqlite::Transaction,
    id: &str,
    data: &[u8],
) -> Result<(), store::Error> {
    let mut active = 0;
    for (k, v) in store::scan(tx, store::PUBLICATIONS, b"", usize::MAX)? {
        match serde_json::from_slice::<Publication>(&v) {
            Ok(old) if old.expires <= now() => {clear_history(tx,&old.id)?;store::delete(tx, store::PUBLICATIONS, &k)?;},
            _ => active += 1,
        }
    }
    if active >= MAX_ACTIVE {
        return Err("at most 100 active snapshots".into());
    }
    store::put(tx, store::PUBLICATIONS, id.as_bytes(), data)
}

async fn revoke(r: &Relay, id: String) -> Response<Body> {
    if !capability(&id) {
        return not_found();
    }
    match r
        .db(move |s| s.update(|tx| {clear_history(tx,&id)?;store::delete(tx, store::PUBLICATIONS, id.as_bytes())}))
        .await
    {
        Ok(()) => crate::build(StatusCode::NO_CONTENT, None, Body::none()),
        Err(_) => respond(StatusCode::INTERNAL_SERVER_ERROR, &error("revoke failed")),
    }
}

async fn update<B: ReqBody>(r: &Relay, q: Request<B>, id: String) -> Response<Body> {
    if !capability(&id) {
        return not_found();
    }
    let (buf, broken, over) = read_limited(q.into_body(), sanitize::MAX_BYTES + 8192).await;
    if broken || over {
        return respond(StatusCode::BAD_REQUEST, &error("invalid snapshot"));
    }
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf) else {
        return respond(StatusCode::BAD_REQUEST, &error("invalid snapshot"));
    };
    if v.as_object().map_or(true, |o| {
        o.keys()
            .any(|k| !matches!(k.as_str(), "title" | "html" | "days" | "pages" | "password"))
    }) {
        return respond(StatusCode::BAD_REQUEST, &error("invalid snapshot"));
    }
    let Some(title) = v["title"].as_str().filter(|x| x.len() <= 1024) else {
        return respond(StatusCode::BAD_REQUEST, &error("invalid snapshot"));
    };
    let Some(html) = v["html"].as_str() else {
        return respond(StatusCode::BAD_REQUEST, &error("invalid snapshot"));
    };
    let days = v["days"].as_i64().unwrap_or(30);
    if !(1..=30).contains(&days) {
        return respond(StatusCode::BAD_REQUEST, &error("invalid snapshot"));
    }
    let Ok(html) = sanitize::clean(html) else {
        return respond(StatusCode::BAD_REQUEST, &error("invalid snapshot"));
    };
    let pages = match pages_from(&v) {
        Ok(p) => p,
        Err(_) => return respond(StatusCode::BAD_REQUEST, &error("invalid wiki pages")),
    };
    let has_pages = v.get("pages").is_some();
    let password = v
        .get("password")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    if password.as_ref().is_some_and(|p| p.len() > 512) {
        return respond(StatusCode::BAD_REQUEST, &error("invalid password"));
    }
    let result = r
        .db({
            let id = id.clone();
            let title = title.to_owned();
            let clean = html;
            move |s| {
                s.update(|tx| {
                    let Some(raw) = store::get(tx, store::PUBLICATIONS, id.as_bytes())? else {
                        return Err("publication not found".into());
                    };
                    let mut p: Publication = serde_json::from_slice(&raw)?;
                    if p.expires <= now() {
                        return Err("publication expired".into());
                    };
                    p.title = title;
                    p.html = clean;
                    p.version += 1;
                    if has_pages {
                        p.pages = pages;
                    }
                    if let Some(password) = password {
                        p.password_hash = hash_password(&password);
                    }
                    p.expires = now() + days * 86400;
                    store::put(
                        tx,
                        store::PUBLICATIONS,
                        id.as_bytes(),
                        &serde_json::to_vec(&p)?,
                    )?;
                    p.html.clear();
                    p.password_hash.clear();
                    for page in &mut p.pages {
                        page.html.clear();
                    }
                    Ok(p)
                })
            }
        })
        .await;
    match result {
        Ok(p) => respond(StatusCode::OK, &p),
        Err(_) => not_found(),
    }
}

fn wants_json<B>(q: &Request<B>) -> bool {
    q.headers()
        .get("accept")
        .is_some_and(|h| h == "application/json")
}
fn public_data(p: &Publication, role: &str) -> Response<Body> {
    respond(
        StatusCode::OK,
        &serde_json::json!({"title":p.title,"html":p.html,"pages":p.pages,"version":p.version,"role":role}),
    )
}
fn public_app(status: StatusCode) -> Response<Body> {
    let mut res = empty(status);
    *res.body_mut() = Body::new(include_str!("publication-app.html").to_owned());
    let h = res.headers_mut();
    h.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    h.insert("content-security-policy",HeaderValue::from_static("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"));
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow, noarchive"),
    );
    res
}

fn pages_from(v: &serde_json::Value) -> Result<Vec<Page>, String> {
    let Some(v) = v.get("pages") else {
        return Ok(Vec::new());
    };
    let mut pages: Vec<Page> = serde_json::from_value(v.clone()).map_err(|_| "invalid pages")?;
    if pages.len() > 50 {
        return Err("at most 50 wiki pages".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut total = 0;
    for p in &mut pages {
        if p.id.is_empty()
            || p.id.len() > 128
            || !p
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            || !ids.insert(p.id.clone())
            || p.title.len() > 1024
        {
            return Err("invalid page ID or title".into());
        }
        p.html = sanitize::clean(&p.html)?;
        total += p.html.len();
    }
    if total > sanitize::MAX_BYTES {
        return Err("wiki exceeds size limit".into());
    }
    Ok(pages)
}

fn request_password<B>(q: &Request<B>) -> String {
    use base64::Engine;
    if let Some(h) = q.headers().get("x-share-password-b64") {
        return h
            .to_str()
            .ok()
            .filter(|v| v.len() <= 1024)
            .and_then(|v| base64::engine::general_purpose::STANDARD.decode(v).ok())
            .and_then(|v| String::from_utf8(v).ok())
            .unwrap_or_default();
    }
    q.headers()
        .get("x-share-password")
        .and_then(|h| h.to_str().ok())
        .filter(|v| v.len() <= 512)
        .unwrap_or("")
        .to_owned()
}
