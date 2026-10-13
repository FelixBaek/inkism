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
    publication_id: String,
    role: String,
    password: Option<String>,
    hosts: Vec<String>,
    pages: Option<Vec<PageInput>>,
    /// Use the library's saved sync relay token instead of a typed one.
    use_sync_token: bool,
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
        Some(Ok(i)) if i.use_sync_token && i.token.is_empty() => i,
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

/// The sync token saved with the configured relay. Host-only engine op; the
/// renderer never sees it, it only goes into this request's Authorization.
fn saved_token(h: &Handler, deadline: Instant) -> Result<String, Response> {
    let reply = call(h, deadline, &json!({"op": "sync_relay_token"}))
        .map_err(|_| Response::fail(503, "relay configuration unavailable"))?;
    match reply["data"]["token"].as_str() {
        Some(t) if reply["ok"] == true && (32..=1024).contains(&t.len()) && !t.contains(['\r', '\n']) => Ok(t.to_owned()),
        _ => Err(Response::fail(400, "no saved sync token; enter the relay token")),
    }
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
                // Invitations are read-only.
                || input.role != "viewer"
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

fn publication_response_body(response: reqwest::blocking::Response) -> Result<Vec<u8>, Response> {
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
    Ok(data)
}

fn publish(h: &Handler, r: &Request) -> Result<Response, Response> {
    let mut input = decode(&r.body)?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let base = relay(h, deadline)?;
    if input.use_sync_token {
        input.token = saved_token(h, deadline)?;
    }
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
    let data = publication_response_body(response)?;
    if delete {
        return Ok(Response::json(200, &json!({"ok": true})));
    }
    let parsed: Value =
        serde_json::from_slice(&data).map_err(|_| Response::fail(502, "invalid relay response"))?;
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
    fn saved_sync_token_authorizes_publish_without_reaching_renderer() {
        struct Saved(String);
        impl Engine for Saved {
            fn call(&self, _: Deadline, raw: &[u8]) -> crate::Result<Vec<u8>> {
                let q: Value = serde_json::from_slice(raw)?;
                let v = match q["op"].as_str() {
                    Some("sync_status") => json!({"ok":true,"data":{"configured":true,"server_url":self.0}}),
                    Some("sync_relay_token") => json!({"ok":true,"data":{"token":"saved".repeat(8)}}),
                    _ => json!({"ok":true,"data":{"id":"note-id","revision":1,"title":"note","html":"<p>snapshot</p>","trashed":false,"readonly":false,"locked":false}}),
                };
                Ok(serde_json::to_vec(&v)?)
            }
        }
        let auth = Arc::new(Mutex::new(String::new()));
        let log = Arc::clone(&auth);
        let target = mock::serve(move |hit| {
            if hit.path() == "/v1/publications" {
                *log.lock().unwrap() = hit.header("authorization").to_string();
            }
            mock::Reply {
                status: 200,
                headers: vec![("Content-Type".into(), "application/json".into())],
                body: format!(r#"{{"id":"{}","hosts":[]}}"#, "a".repeat(64)).into_bytes(),
            }
        });
        let h = Handler { engine: Some(Arc::new(Saved(target.clone()))), ..Default::default() };
        let post = |body: &str| serve(&h, &Request { method: "POST".into(), path: "/api/publications".into(), query: None, headers: vec![], host: "wails.localhost".into(), body: body.as_bytes().to_vec() });
        let out = post(r#"{"action":"publish","note_id":"note-id","token":"","use_sync_token":true,"days":7,"revision":1}"#);
        assert_eq!(out.status, 200, "{}", String::from_utf8_lossy(&out.body));
        assert_eq!(*auth.lock().unwrap(), format!("Bearer {}", "saved".repeat(8)));
        assert!(!String::from_utf8_lossy(&out.body).contains("savedsaved"), "token echoed to renderer");
        // An empty token without the saved-token choice is still rejected.
        assert_eq!(post(r#"{"action":"publish","note_id":"note-id","token":"","days":7,"revision":1}"#).status, 400);
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
