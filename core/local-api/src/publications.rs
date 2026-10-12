//! Public shared copies through the sync relay (Go `publications.go`).
//!
//! Transport is pinned to the library's already configured relay. Renderer
//! input cannot supply a host, path, redirect, proxy or local file URL.

use crate::{Handler, Request, Response};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;
use std::time::{Duration, Instant};

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
struct Input {
    action: String,
    note_id: String,
    id: String,
    token: String,
    days: i64,
    revision: i64,
    version: u64,
    page_id: String,
    markdown: Option<String>,
    publication_id: String,
    role: String,
    password: Option<String>,
    hosts: Vec<String>,
    pages: Option<Vec<PageInput>>,
    #[serde(skip)]
    wiki_ids: Vec<String>,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct PageInput {
    note_id: String,
    revision: i64,
}

fn publication_id(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'a'..=b'f' | b'0'..=b'9'))
}

fn decode(body: &[u8]) -> Result<Input, Response> {
    let bad = || Response::fail(400, "valid relay token required for this action");
    if body.len() > inkism_web_content::MAX_BYTES + 8192 {
        return Err(bad());
    }
    let mut values = serde_json::Deserializer::from_slice(body).into_iter::<Input>();
    let input = match values.next() {
        Some(Ok(i)) if (32..=1024).contains(&i.token.len()) && !i.token.contains(['\r', '\n']) => i,
        _ => return Err(bad()),
    };
    if values.next().is_some() {
        return Err(Response::fail(400, "trailing data"));
    }
    Ok(input)
}

fn call(h: &Handler, deadline: Instant, request: &Value) -> crate::Result<Value> {
    let raw = h.engine()?.call(deadline, &serde_json::to_vec(request)?)?;
    Ok(serde_json::from_slice(&raw)?)
}

/// The library's configured relay origin, without a trailing slash.
fn relay(h: &Handler, deadline: Instant) -> Result<String, Response> {
    let status = call(h, deadline, &json!({"op": "sync_status"}))
        .map_err(|_| Response::fail(503, "relay configuration unavailable"))?;
    let (data, url) = (&status["data"], status["data"]["server_url"].as_str());
    if status["ok"] != true || data["configured"] != true || url.is_none() {
        return Err(Response::fail(
            400,
            "configure your approved HTTPS relay first",
        ));
    }
    let base = url::Url::parse(url.unwrap_or("")).ok().filter(|u| {
        u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none_or(str::is_empty)
            && u.fragment().is_none_or(str::is_empty)
            && u.host_str().is_some_and(|h| !h.is_empty())
            && u.path() == "/"
    });
    let Some(base) = base else {
        return Err(Response::fail(400, "relay requires an origin URL"));
    };
    // Go net.ParseIP: only a literal IP counts as loopback, never "localhost".
    let loopback = match base.host() {
        Some(url::Host::Ipv4(a)) => a.is_loopback(),
        Some(url::Host::Ipv6(a)) => a.is_loopback(),
        _ => false,
    };
    if base.scheme() != "https" && !(base.scheme() == "http" && loopback) {
        return Err(Response::fail(
            400,
            "HTTPS relay required; HTTP allowed only for literal loopback tests",
        ));
    }
    Ok(base.as_str().trim_end_matches('/').to_string())
}

/// Renders the saved note revision into a publish payload.
fn body(h: &Handler, deadline: Instant, input: &Input) -> Result<Vec<u8>, Response> {
    let metadata = call(h, deadline, &json!({"id":input.note_id,"op":"get"}))
        .map_err(|_| Response::fail(400, "note unavailable"))?;
    if metadata["ok"] != true
        || metadata["data"]["readonly"] == true
        || metadata["data"]["locked"] == true
        || metadata["data"]["trashed"] == true
    {
        return Err(Response::fail(
            400,
            "locked, readonly or trashed note cannot be published",
        ));
    }
    let note = call(
        h,
        deadline,
        &json!({"id": input.note_id, "op": "document_render", "revision": input.revision}),
    )
    .map_err(|_| Response::fail(500, "saved note unavailable"))?;
    let d = &note["data"];
    let title = d["title"].as_str().unwrap_or("");
    let valid = note["ok"] == true
        && d["id"].as_str() == Some(input.note_id.as_str())
        && d["revision"].as_i64() == Some(input.revision)
        && d["trashed"] != true
        && title.len() <= 1024;
    if !valid {
        return Err(Response::fail(400, "saved note unavailable"));
    }
    let mut clean = inkism_web_content::clean(d["html"].as_str().unwrap_or(""))
        .map_err(|e| Response::fail(400, e))?;
    let wiki_ids: Vec<String> = input
        .pages
        .as_ref()
        .map(|p| p.iter().map(|p| p.note_id.clone()).collect())
        .unwrap_or_else(|| input.wiki_ids.clone());
    let links = regex::Regex::new(
        r#"[hH][rR][eE][fF][ \t\r\n]*=[ \t\r\n]*["']note:(?://)?([a-zA-Z0-9_-]+)(?:#[^"']*)?["']"#,
    )
    .unwrap();
    let mut linked = std::collections::HashSet::new();
    for found in links.captures_iter(d["html"].as_str().unwrap_or("")) {
        let id = &found[1];
        if wiki_ids.iter().any(|target| target == id) && linked.insert(id.to_owned()) {
            clean
                .html
                .push_str(&format!("<p><a href=\"#{id}\">↗ {id}</a></p>"));
        }
    }
    let mut payload = json!({"days":input.days,"html":clean.html,"title":title,"password":input.password.as_deref().unwrap_or("")});
    if input.password.is_none() {
        payload.as_object_mut().unwrap().remove("password");
    }
    if let Some(pages) = &input.pages {
        if pages.len() > 50 {
            return Err(Response::fail(400, "at most 50 wiki pages"));
        }
        let mut out = Vec::new();
        let mut ids = std::collections::HashSet::new();
        let mut total = clean.html.len();
        for page in pages {
            if page.note_id == input.note_id || !ids.insert(&page.note_id) || page.revision < 1 {
                return Err(Response::fail(400, "duplicate or invalid wiki page"));
            }
            let nested = Input {
                note_id: page.note_id.clone(),
                revision: page.revision,
                days: input.days,
                wiki_ids: wiki_ids.clone(),
                ..Default::default()
            };
            let rendered: Value = serde_json::from_slice(&body(h, deadline, &nested)?)
                .map_err(|_| Response::fail(400, "wiki render failed"))?;
            total += rendered["html"].as_str().unwrap_or("").len();
            if total > inkism_web_content::MAX_BYTES {
                return Err(Response::fail(400, "wiki exceeds size limit"));
            }
            out.push(json!({"id":page.note_id,"title":rendered["title"],"html":rendered["html"]}));
        }
        payload["pages"] = json!(out);
    }
    Ok(serde_json::to_vec(&payload).unwrap_or_default())
}

/// Maps an action to the relay request method, endpoint and body.
fn action(
    h: &Handler,
    deadline: Instant,
    input: &Input,
    endpoint: String,
) -> Result<(reqwest::Method, String, Vec<u8>), Response> {
    match input.action.as_str() {
        "list" => Ok((reqwest::Method::GET, endpoint, Vec::new())),
        "snapshot" | "reconcile" if publication_id(&input.id) => Ok((
            reqwest::Method::GET,
            format!("{endpoint}/{}", input.id),
            Vec::new(),
        )),
        "revoke" if publication_id(&input.id) => Ok((
            reqwest::Method::DELETE,
            format!("{endpoint}/{}", input.id),
            Vec::new(),
        )),
        "revoke" => Err(Response::fail(400, "invalid publication ID")),
        "publish" => {
            if input.note_id.is_empty()
                || input.note_id.len() > 128
                || !(1..=30).contains(&input.days)
                || input.revision < 1
            {
                return Err(Response::fail(400, "note and expiry (1–30 days) required"));
            }
            Ok((reqwest::Method::POST, endpoint, body(h, deadline, input)?))
        }
        "share_list" => Ok((
            reqwest::Method::GET,
            format!(
                "{}/v1/shares",
                endpoint.trim_end_matches("/v1/publications")
            ),
            Vec::new(),
        )),
        "share_revoke" if publication_id(&input.id) => Ok((
            reqwest::Method::DELETE,
            format!(
                "{}/v1/shares/{}",
                endpoint.trim_end_matches("/v1/publications"),
                input.id
            ),
            Vec::new(),
        )),
        "share_create" => {
            if !publication_id(&input.publication_id)
                || !matches!(input.role.as_str(), "viewer" | "editor")
                || input.password.as_ref().is_some_and(|p| p.len() > 512)
            {
                return Err(Response::fail(
                    400,
                    "valid publication, role and password required",
                ));
            }
            Ok((reqwest::Method::POST, format!("{}/v1/shares", endpoint.trim_end_matches("/v1/publications")), serde_json::to_vec(&json!({"publication_id":input.publication_id,"role":input.role,"password":input.password.as_deref().unwrap_or("")})).unwrap_or_default()))
        }
        "update" if publication_id(&input.id) => {
            if input.note_id.is_empty() || input.revision < 1 || !(1..=30).contains(&input.days) {
                return Err(Response::fail(400, "note and expiry required"));
            }
            Ok((
                reqwest::Method::PUT,
                format!("{endpoint}/{}", input.id),
                body(h, deadline, input)?,
            ))
        }
        "domain_get" => Ok((
            reqwest::Method::GET,
            format!(
                "{}/v1/settings/domain",
                endpoint.trim_end_matches("/v1/publications")
            ),
            Vec::new(),
        )),
        "domain_set" => {
            if input.hosts.len() > 20 {
                return Err(Response::fail(400, "too many hosts"));
            }
            Ok((
                reqwest::Method::PUT,
                format!(
                    "{}/v1/settings/domain",
                    endpoint.trim_end_matches("/v1/publications")
                ),
                serde_json::to_vec(&json!({"hosts": input.hosts})).unwrap_or_default(),
            ))
        }
        _ => Err(Response::fail(400, "unknown publication action")),
    }
}

// Compare canonical sanitized markup, normalizing only insignificant gaps at
// block boundaries. Inline spaces and pre/code whitespace stay byte-exact.
fn canonical_blocks(html: &str) -> String {
    let closing = regex::Regex::new(
        r"(</(?:p|h[1-6]|ul|ol|li|blockquote|pre|table|thead|tbody|tr|td|th)>)[ \t\r\n]+<",
    )
    .unwrap();
    let opening =
        regex::Regex::new(r"(<(?:ul|ol|blockquote|table|thead|tbody|tr)(?: [^>]*)?>)[ \t\r\n]+<")
            .unwrap();
    let html = closing.replace_all(html.trim(), "${1}<");
    opening.replace_all(&html, "${1}<").into_owned()
}
fn lossless_markdown(markdown: &str, html: &str) -> bool {
    if markdown.len() > inkism_web_content::MAX_BYTES {
        return false;
    }
    let parser = pulldown_cmark::Parser::new_ext(markdown, pulldown_cmark::Options::all());
    // Markdown sources should not become opaque HTML fallbacks.
    let events: Vec<_> = parser.collect();
    if events.iter().any(|event| {
        matches!(
            event,
            pulldown_cmark::Event::Html(_) | pulldown_cmark::Event::InlineHtml(_)
        )
    }) {
        return false;
    }
    let mut rendered = String::new();
    pulldown_cmark::html::push_html(&mut rendered, events.into_iter());
    inkism_web_content::clean(&rendered)
        .is_ok_and(|clean| canonical_blocks(&clean.html) == canonical_blocks(html))
}

pub(crate) fn serve(h: &Handler, r: &Request) -> Response {
    if r.method != "POST" {
        return Response {
            status: 405,
            headers: vec![],
            body: vec![],
        };
    }
    match publish(h, r) {
        Ok(response) | Err(response) => response,
    }
}

fn publish(h: &Handler, r: &Request) -> Result<Response, Response> {
    let input = decode(&r.body)?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let base = relay(h, deadline)?;
    let (method, endpoint, body) = action(h, deadline, &input, format!("{base}/v1/publications"))?;
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|_| Response::fail(400, "invalid relay endpoint"))?;
    let delete = method == reqwest::Method::DELETE;
    let response = client
        .request(method, &endpoint)
        .header("Authorization", format!("Bearer {}", input.token))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .map_err(|_| {
            Response::fail(
                502,
                "relay unavailable; check the published list before retrying",
            )
        })?;
    let status = response.status().as_u16();
    let mut data = Vec::new();
    let limit = inkism_web_content::MAX_BYTES;
    if response
        .take(limit as u64 + 1)
        .read_to_end(&mut data)
        .is_err()
        || data.len() > limit
    {
        return Err(Response::fail(502, "invalid relay response"));
    }
    if !(200..=299).contains(&status) {
        return Err(Response::fail(
            502,
            format!("relay rejected publication action (HTTP {status})"),
        ));
    }
    if delete {
        return Ok(Response::json(200, &json!({"ok": true})));
    }
    let parsed: Value =
        serde_json::from_slice(&data).map_err(|_| Response::fail(502, "invalid relay response"))?;
    if input.action == "reconcile" {
        if input.revision < 1
            || input.version == 0
            || parsed["version"].as_u64() != Some(input.version)
        {
            return Err(Response::fail(
                409,
                "publication changed; reload before applying",
            ));
        }
        let original = call(h, deadline, &json!({"op":"get","id":input.note_id}))
            .map_err(|_| Response::fail(400, "source unavailable"))?;
        let note = &original["data"];
        if original["ok"] != true
            || note["readonly"] == true
            || note["locked"] == true
            || note["trashed"] == true
        {
            return Err(Response::fail(400, "source is unavailable or protected"));
        }
        if note["revision"].as_i64() != Some(input.revision) {
            return Err(Response::fail(
                409,
                "source changed; preserve both versions",
            ));
        }
        let page = if input.page_id.is_empty() {
            &parsed
        } else {
            parsed["pages"]
                .as_array()
                .and_then(|pages| {
                    pages
                        .iter()
                        .find(|p| p["id"].as_str() == Some(input.page_id.as_str()))
                })
                .ok_or_else(|| {
                    Response::fail(409, "shared page was removed; preserve the source")
                })?
        };
        let html = page["html"]
            .as_str()
            .ok_or_else(|| Response::fail(502, "invalid publication"))?;
        let clean = inkism_web_content::clean(html).map_err(|e| Response::fail(502, e))?;
        let format = note["content_format"].as_str().unwrap_or("html");
        let content=match format {
            "html"=>clean.html.clone(),
            "markdown"=>{
                let markdown=input.markdown.as_deref().ok_or_else(||Response::fail(409,"lossless Markdown conversion required"))?;
                if !lossless_markdown(markdown,&clean.html) {return Err(Response::fail(409,"format cannot be preserved; save a separate copy"));}
                markdown.to_owned()
            },
            _=>return Err(Response::fail(409,"rich publication requires an HTML or lossless Markdown source; save a separate copy")),
        };
        let saved = call(h, deadline, &json!({"op":"save","note":{"id":input.note_id,"title":note["title"],"content":content,"text":if format=="html" {&clean.text} else {&content},"content_format":format,"revision":input.revision,"require_existing":true}}))
            .map_err(|_|Response::fail(500,"source save failed"))?;
        if saved["ok"] != true {
            return Err(Response::fail(
                409,
                "source changed; preserve both versions",
            ));
        }
        return Ok(Response::json(
            200,
            &json!({"ok":true,"data":{"note":saved["data"],"version":input.version}}),
        ));
    }
    let domain = if input.action.starts_with("domain_") {
        Some(parsed.clone())
    } else {
        client
            .get(format!("{base}/v1/settings/domain"))
            .header("Authorization", format!("Bearer {}", input.token))
            .send()
            .ok()
            .filter(|r| r.status().is_success())
            .and_then(|r| {
                let mut bytes = Vec::new();
                r.take(8193).read_to_end(&mut bytes).ok()?;
                if bytes.len() > 8192 {
                    return None;
                }
                serde_json::from_slice::<Value>(&bytes).ok()
            })
    };
    let public_origin = domain
        .as_ref()
        .and_then(|d| d["hosts"].as_array())
        .and_then(|h| h.first())
        .and_then(Value::as_str)
        .filter(|h| {
            !h.is_empty()
                && h.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
        })
        .map(|h| format!("https://{h}"))
        .unwrap_or(base);
    Ok(Response::json(
        200,
        &json!({"data": parsed, "ok": true, "public_origin": public_origin}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unsplash::mock;
    use crate::{Deadline, Engine};
    use std::sync::{Arc, Mutex};

    struct Caller {
        url: String,
        trashed: bool,
        readonly: bool,
        locked: bool,
    }
    impl Engine for Caller {
        fn call(&self, _: Deadline, raw: &[u8]) -> crate::Result<Vec<u8>> {
            let q: Value = serde_json::from_slice(raw)?;
            let data = if q["op"] == "sync_status" {
                json!({"configured": true, "server_url": self.url})
            } else {
                json!({"id": "note-id", "revision": 1, "title": "note", "html": "<p>snapshot</p><script>bad()</script><img src='file:///vault'>", "trashed": self.trashed,"readonly":self.readonly,"locked":self.locked})
            };
            Ok(serde_json::to_vec(&json!({"ok": true, "data": data}))?)
        }
    }

    fn request(url: &str, trashed: bool, body: &str) -> Response {
        let h = Handler {
            engine: Some(Arc::new(Caller {
                url: url.into(),
                trashed,
                readonly: false,
                locked: false,
            })),
            ..Default::default()
        };
        let r = Request {
            method: "POST".into(),
            path: "/api/publications".into(),
            query: None,
            headers: vec![],
            host: "wails.localhost".into(),
            body: body.as_bytes().to_vec(),
        };
        serve(&h, &r)
    }

    #[test]
    fn reconcile_updates_real_markdown_database_and_preserves_conflicts() {
        struct RealSource {
            db: Mutex<inkism_engine::Engine>,
            url: String,
        }
        impl Engine for RealSource {
            fn call(&self, _: Deadline, raw: &[u8]) -> crate::Result<Vec<u8>> {
                let q: Value = serde_json::from_slice(raw)?;
                let v = if q["op"] == "sync_status" {
                    json!({"ok":true,"data":{"configured":true,"server_url":self.url}})
                } else {
                    self.db.lock().unwrap().execute(q)
                };
                Ok(serde_json::to_vec(&v)?)
            }
        }
        use std::sync::atomic::{AtomicBool, Ordering};
        let revoked = Arc::new(AtomicBool::new(false));
        let server_revoked = revoked.clone();
        let url = mock::serve(move |_| {
            if server_revoked.load(Ordering::SeqCst) {
                mock::Reply {
                    status: 404,
                    headers: vec![],
                    body: vec![],
                }
            } else {
                mock::Reply{status:200,headers:vec![],body:br#"{"version":2,"title":"Root","html":"<p>root</p>","pages":[{"id":"child","title":"Child","html":"<h1>Collaborative</h1>"}]}"#.to_vec()}
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let db =
            inkism_engine::Engine::open(dir.path().join("library.db").to_str().unwrap()).unwrap();
        let made=db.execute(json!({"op":"save","note":{"id":"original","title":"My original title","content":"# Original\n","content_format":"markdown","tags":["keep"]}}));
        assert_eq!(made["ok"], true, "{made}");
        let revision = made["data"]["revision"].as_i64().unwrap();
        let source = Arc::new(RealSource {
            db: Mutex::new(db),
            url,
        });
        let h = Handler {
            engine: Some(source.clone()),
            ..Default::default()
        };
        let binding_request=Request{method:"POST".into(),path:"/api/rpc".into(),query:None,headers:vec![("content-type".into(),"application/json".into())],host:"localhost".into(),body:serde_json::to_vec(&json!({"op":"collaboration_binding_set","publication_id":"a".repeat(64),"page_id":"child","expected_updated_at":0,"binding":{"id":"original","revision":revision,"version":1,"format":"markdown"}})).unwrap()};
        let connected = crate::rpc::renderer(
            &h,
            &binding_request,
            Instant::now() + Duration::from_secs(5),
        );
        assert_eq!(
            connected.status,
            200,
            "{}",
            String::from_utf8_lossy(&connected.body)
        );
        let request = |revision| {
            Request{method:"POST".into(),path:"/api/publications".into(),query:None,headers:vec![],host:"localhost".into(),body:serde_json::to_vec(&json!({"action":"reconcile","id":"a".repeat(64),"token":"a".repeat(32),"note_id":"original","revision":revision,"version":2,"page_id":"child","markdown":"# Collaborative\n"})).unwrap()}
        };
        let out = serve(&h, &request(revision));
        assert_eq!(out.status, 200, "{}", String::from_utf8_lossy(&out.body));
        let saved = source
            .db
            .lock()
            .unwrap()
            .execute(json!({"op":"get","id":"original"}));
        assert_eq!(saved["data"]["content"], "# Collaborative\n");
        assert_eq!(saved["data"]["content_format"], "markdown");
        assert_eq!(saved["data"]["title"], "My original title");
        assert_eq!(saved["data"]["tags"], json!(["keep"]));
        assert_eq!(
            serve(&h, &request(revision)).status,
            409,
            "stale source overwrote DB"
        );
        revoked.store(true, Ordering::SeqCst);
        assert_eq!(
            serve(&h, &request(saved["data"]["revision"].as_i64().unwrap())).status,
            502,
            "revoked publication imported"
        );
        let after = source
            .db
            .lock()
            .unwrap()
            .execute(json!({"op":"get","id":"original"}));
        assert_eq!(after["data"]["revision"], saved["data"]["revision"]);
        assert_eq!(after["data"]["content"], saved["data"]["content"]);
    }

    #[test]
    fn markdown_comparison_preserves_structure_and_pre_whitespace() {
        assert!(lossless_markdown(
            "# Heading\n\nOne **bold** paragraph.\n\nSecond.",
            "<h1>Heading</h1><p>One <strong>bold</strong> paragraph.</p><p>Second.</p>"
        ));
        assert!(!lossless_markdown("one two", "<p>one  two</p>"));
        assert!(!lossless_markdown(
            "```\na b\n```",
            "<pre><code>a  b\n</code></pre>"
        ));
        assert!(!lossless_markdown("<p>opaque</p>", "<p>opaque</p>"));
        assert!(!lossless_markdown("plain", "<h2>plain</h2>"));
    }

    #[test]
    fn reconcile_checks_versions_protection_and_engine_cas() {
        struct Source {
            url: String,
            revision: i64,
            protected: bool,
            race: bool,
            format: &'static str,
            saves: Arc<Mutex<Vec<Value>>>,
        }
        impl Engine for Source {
            fn call(&self, _: Deadline, raw: &[u8]) -> crate::Result<Vec<u8>> {
                let q: Value = serde_json::from_slice(raw)?;
                let response = match q["op"].as_str().unwrap() {
                    "sync_status" => {
                        json!({"ok":true,"data":{"configured":true,"server_url":self.url}})
                    }
                    "get" => {
                        json!({"ok":true,"data":{"id":"source","revision":self.revision,"title":"Local title","content_format":self.format,"readonly":self.protected}})
                    }
                    "save" => {
                        self.saves.lock().unwrap().push(q.clone());
                        if self.race {
                            json!({"ok":false,"error":"revision conflict"})
                        } else {
                            json!({"ok":true,"data":{"id":"source","revision":5}})
                        }
                    }
                    _ => panic!("unexpected operation"),
                };
                Ok(serde_json::to_vec(&response)?)
            }
        }
        let target = mock::serve(|hit| {
            assert!(hit.path().starts_with("/v1/publications/"));
            mock::Reply{status:200,headers:vec![],body:br#"{"version":2,"title":"Remote","html":"<p>edited</p><script>bad()</script>","pages":[{"id":"child","title":"Child","html":"<h1>child</h1>"}]}"#.to_vec()}
        });
        for (
            revision,
            protected,
            race,
            version,
            status,
            count,
            format,
            page,
            markdown,
            expected_content,
        ) in [
            (
                4,
                false,
                false,
                2,
                200,
                1,
                "html",
                "",
                None,
                "<p>edited</p>",
            ),
            (5, false, false, 2, 409, 0, "html", "", None, ""),
            (4, true, false, 2, 400, 0, "html", "", None, ""),
            (4, false, true, 2, 409, 1, "html", "", None, "<p>edited</p>"),
            (4, false, false, 1, 409, 0, "html", "", None, ""),
            (
                4,
                false,
                false,
                2,
                200,
                1,
                "html",
                "child",
                None,
                "<h1>child</h1>",
            ),
            (4, false, false, 2, 409, 0, "html", "removed", None, ""),
            (
                4,
                false,
                false,
                2,
                200,
                1,
                "markdown",
                "child",
                Some("# child\n"),
                "# child\n",
            ),
            (
                4,
                false,
                false,
                2,
                409,
                0,
                "markdown",
                "child",
                Some("child\n"),
                "",
            ),
            (
                4,
                false,
                false,
                2,
                409,
                0,
                "markdown",
                "child",
                Some("<h1>child</h1>"),
                "",
            ),
        ] {
            let saves = Arc::new(Mutex::new(vec![]));
            let h = Handler {
                engine: Some(Arc::new(Source {
                    url: target.clone(),
                    revision,
                    protected,
                    race,
                    format,
                    saves: saves.clone(),
                })),
                ..Default::default()
            };
            let r=Request{method:"POST".into(),path:"/api/publications".into(),query:None,headers:vec![],host:"localhost".into(),body:serde_json::to_vec(&json!({"action":"reconcile","id":"a".repeat(64),"token":"a".repeat(32),"note_id":"source","revision":4,"version":version,"page_id":page,"markdown":markdown})).unwrap()};
            let out = serve(&h, &r);
            assert_eq!(out.status, status, "{}", String::from_utf8_lossy(&out.body));
            let saved = saves.lock().unwrap();
            assert_eq!(saved.len(), count);
            if let Some(q) = saved.first() {
                assert_eq!(q["note"]["revision"], 4);
                assert_eq!(q["note"]["require_existing"], true);
                assert_eq!(q["note"]["content"], expected_content);
                assert_eq!(q["note"]["content_format"], format);
                assert_eq!(q["note"]["title"], "Local title");
            }
        }
    }

    #[test]
    fn locked_readonly_publications_never_reach_relay() {
        for (locked, readonly) in [(true, false), (false, true)] {
            let h = Handler {
                engine: Some(Arc::new(Caller {
                    url: "http://127.0.0.1:1".into(),
                    trashed: false,
                    readonly,
                    locked,
                })),
                ..Default::default()
            };
            let input = Input {
                note_id: "note-id".into(),
                revision: 1,
                days: 7,
                ..Default::default()
            };
            assert_eq!(
                body(&h, Instant::now() + Duration::from_secs(5), &input)
                    .unwrap_err()
                    .status,
                400
            );
        }
    }

    #[test]
    fn transport_pinned_sanitized_and_no_redirect() {
        let token = "owner".repeat(8);
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let (log, expected) = (Arc::clone(&seen), token.clone());
        let target = mock::serve(move |hit| {
            if hit.path() == "/v1/settings/domain" {
                return mock::Reply {
                    status: 200,
                    headers: vec![],
                    body: br#"{"hosts":[]}"#.to_vec(),
                };
            }
            let body: Value = serde_json::from_slice(&hit.body).unwrap_or_default();
            let mut problems = String::new();
            if hit.method != "POST"
                || hit.path() != "/v1/publications"
                || hit.header("authorization") != format!("Bearer {expected}")
            {
                problems.push_str("wrong endpoint/auth;");
            }
            if body["html"] != "<p>snapshot</p>" {
                problems.push_str(&body.to_string());
            }
            log.lock().unwrap().push(problems);
            mock::Reply {
                status: 200,
                headers: vec![("Content-Type".into(), "application/json".into())],
                body: format!(r#"{{"id":"{}"}}"#, "a".repeat(64)).into_bytes(),
            }
        });
        let payload = format!(
            r#"{{"action":"publish","note_id":"note-id","token":"{token}","days":7,"revision":1}}"#
        );
        let out = request(&target, false, &payload);
        assert_eq!(out.status, 200, "{}", String::from_utf8_lossy(&out.body));
        let reply: Value = serde_json::from_slice(&out.body).unwrap();
        assert_eq!(reply["public_origin"], target.as_str());
        assert_eq!(
            request(&target, true, &payload).status,
            400,
            "trashed note shared"
        );

        let redirect_to = target.clone();
        let redirect = mock::serve(move |_| mock::Reply {
            status: 307,
            headers: vec![("Location".into(), redirect_to.clone())],
            body: vec![],
        });
        assert_eq!(
            request(&redirect, false, &payload).status,
            502,
            "redirect accepted"
        );
        assert_eq!(
            *seen.lock().unwrap(),
            vec![String::new()],
            "unexpected network delivery"
        );

        for base in [
            "http://example.com",
            "file:///secret",
            "https://user:password@example.com",
            "https://example.com/path",
            "https://example.com?token=secret",
            "http://localhost:1",
        ] {
            assert_eq!(request(base, false, &payload).status, 400, "{base}");
        }
        let extra = format!(
            "{},\"server\":\"http://evil.test\"}}",
            payload.trim_end_matches('}')
        );
        assert_eq!(
            request(&target, false, &extra).status,
            400,
            "renderer URL accepted"
        );
        assert_eq!(
            request(&target, false, &format!("{payload} {{}}")).status,
            400,
            "trailing data"
        );
    }
}
