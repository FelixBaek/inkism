//! Ports of the Go relay tests (desktop/internal/relay/*_test.go).
use super::*;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use http_body_util::Full;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{RsaKeyPair, RSA_PKCS1_SHA256};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> TempDir {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("relay-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
    fn db(&self) -> PathBuf {
        self.0.join("relay.db")
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Out {
    code: u16,
    headers: hyper::HeaderMap,
    body: Vec<u8>,
}
impl Out {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// httptest.NewRequest + ServeHTTP. Empty token means no Authorization; the
/// Origin header is only set when given.
async fn call(r: &Relay, method: &str, path: &str, token: &str, origin: Option<&str>, body: impl Into<Bytes>) -> Out {
    let mut req = Request::builder().method(method).uri(path);
    if !token.is_empty() {
        req = req.header("authorization", format!("Bearer {token}"));
    }
    if let Some(o) = origin {
        req = req.header("origin", o);
    }
    let res = r.handle(req.body(Full::new(body.into())).unwrap()).await;
    let (parts, body) = res.into_parts();
    Out { code: parts.status.as_u16(), headers: parts.headers, body: body.bytes().await.to_vec() }
}

fn random(n: usize) -> Vec<u8> {
    let mut b = vec![0; n];
    SystemRandom::new().fill(&mut b).unwrap();
    b
}

// ---- relay_test.go

#[tokio::test]
async fn replay_pagination_and_reopen() {
    let dir = TempDir::new();
    let token = "t".repeat(32);
    let r = Relay::open(dir.db(), &token).unwrap();
    assert_eq!(call(&r, "GET", "/v1/changes", "", None, "").await.code, 401);
    for i in 0..3 {
        let out = call(&r, "POST", "/v1/changes", &token, None, format!(r#"{{"id":"unique-record-{i:04}","blob":"encrypted-{i}"}}"#)).await;
        assert_eq!(out.code, 200, "{}", out.text());
    }
    let out = call(&r, "POST", "/v1/changes", &token, None, r#"{"id":"unique-record-0000","blob":"encrypted-0"}"#).await;
    assert!(out.code == 200 && out.text().contains(r#""seq":1"#), "{}", out.text());
    let out = call(&r, "POST", "/v1/changes", &token, None, r#"{"id":"unique-record-0000","blob":"changed"}"#).await;
    assert_eq!(out.code, 409, "overwrite allowed");
    drop(r);
    let r = Relay::open(dir.db(), &token).unwrap();
    let out = call(&r, "GET", "/v1/changes?after=1&limit=1", &token, None, "").await;
    let page = out.json();
    assert!(
        out.code == 200 && page["items"].as_array().map(Vec::len) == Some(1) && page["cursor"] == 2 && page["items"][0]["id"] == "unique-record-0001",
        "{}",
        out.text()
    );
}

// ---- publications_test.go

#[tokio::test]
async fn public_snapshot_boundaries_persistence_revoke() {
    let dir = TempDir::new();
    let token = "s".repeat(32);
    let r = Relay::open(dir.db(), &token).unwrap();
    let payload = r#"{"title":"<script>title</script>","html":"<p onclick='x()'>public only</p><img src='http://127.0.0.1/secret'><script>private()</script>","days":7}"#;
    assert_eq!(call(&r, "POST", "/v1/publications", "", Some(""), payload).await.code, 401);
    assert_eq!(call(&r, "POST", "/v1/publications", &token, Some("https://evil.test"), payload).await.code, 403);
    let out = call(&r, "POST", "/v1/publications", &token, Some(""), payload).await;
    assert_eq!(out.code, 201, "{}", out.text());
    let id = out.json()["id"].as_str().unwrap_or_default().to_owned();
    assert_eq!(id.len(), 64, "{}", out.text());
    let page = call(&r, "GET", &format!("/p/{id}"), "", None, "").await;
    let html = page.text();
    assert!(
        page.code == 200
            && !html.contains("<script>")
            && !html.contains("127.0.0.1")
            && html.contains("public only")
            && page.headers.get("content-security-policy").is_some(),
        "{} {html}",
        page.code
    );
    for path in ["/p/".to_owned(), "/p/../../v1/changes".into(), format!("/p/{id}/extra"), format!("/p/{id}?x=1"), "/v1/changes".into()] {
        assert_ne!(call(&r, "GET", &path, "", None, "").await.code, 200, "{path}");
    }
    drop(r);
    let r = Relay::open(dir.db(), &token).unwrap();
    assert_eq!(call(&r, "GET", &format!("/p/{id}"), "", None, "").await.code, 200, "lost persisted snapshot");
    assert_eq!(call(&r, "DELETE", &format!("/v1/publications/{id}"), "bad", None, "").await.code, 401, "owner bypass");
    for _ in 0..2 {
        assert_eq!(call(&r, "DELETE", &format!("/v1/publications/{id}"), &token, None, "").await.code, 204, "revoke must be repeatable");
    }
    assert_eq!(call(&r, "GET", &format!("/p/{id}"), "", None, "").await.code, 404, "revoked data visible");
    assert_eq!(call(&r, "POST", "/v1/publications", &token, None, format!("{payload} {{}}")).await.code, 400, "trailing JSON accepted");
    assert_eq!(call(&r, "POST", "/v1/publications", &token, None, vec![b'x'; 3 << 20]).await.code, 400, "oversize");
}

#[tokio::test]
async fn publication_share_roles_password_and_revoke() {
    let dir = TempDir::new(); let token = "q".repeat(32); let r = Relay::open(dir.db(), &token).unwrap();
    let published = call(&r, "POST", "/v1/publications", &token, None, r#"{"title":"shared","html":"<p>copy</p>","days":7}"#).await;
    let publication = published.json()["id"].as_str().unwrap().to_owned();
    assert_eq!(published.code, 201);
    let share = call(&r, "POST", "/v1/shares", &token, None, format!(r#"{{"publication_id":"{publication}","role":"editor","password":"secret"}}"#)).await;
    assert_eq!(share.code, 201, "{}", share.text()); let sid = share.json()["id"].as_str().unwrap().to_owned(); assert_eq!(share.json()["role"], "editor");
    assert_eq!(call(&r, "GET", &format!("/p/{publication}"), "", None, "").await.code, 401, "password-protected publication bypass");
    assert_eq!(call(&r, "GET", &format!("/s/{sid}"), "", None, "").await.code, 401);
    let req = Request::builder().method("GET").uri(format!("/s/{sid}")).header("x-share-password", "secret"); let response = r.handle(req.body(Full::new(Bytes::new())).unwrap()).await; assert_eq!(response.status(), 200);
    assert_eq!(call(&r, "DELETE", &format!("/v1/shares/{sid}"), "bad", None, "").await.code, 401);
    assert_eq!(call(&r, "DELETE", &format!("/v1/shares/{sid}"), &token, None, "").await.code, 204);
    assert_eq!(call(&r, "GET", &format!("/s/{sid}"), "", None, "").await.code, 404);
}

// ---- blobs_test.go

const BLOB_TEST_ID: &str = "3d8f6a2e-1b7c-4e5f-9a0b-8c7d6e5f4a3b";
const MIN_BLOB: usize = 40;
const MAX_BLOB_BYTES: usize = 256 * 1024 + 40;

fn blob_id(n: usize) -> String {
    format!("{n:08x}-0000-0000-0000-{n:012x}")
}

fn pattern(size: usize, seed: usize) -> Vec<u8> {
    (0..size).map(|i| (seed * 31 + i * 7 + (i >> 8)) as u8).collect()
}

fn blob_relay(dir: &TempDir) -> (Relay, String) {
    let token = "b".repeat(32);
    (Relay::open(dir.db(), &token).unwrap(), token)
}

#[tokio::test]
async fn blob_endpoints_require_bearer() {
    let dir = TempDir::new();
    let (r, token) = blob_relay(&dir);
    let target = format!("/v1/blobs/{BLOB_TEST_ID}");
    assert_eq!(call(&r, "PUT", &target, "", None, pattern(64, 1)).await.code, 401);
    assert_eq!(call(&r, "GET", &target, "", None, "").await.code, 401);
    assert_eq!(call(&r, "PUT", &target, &"x".repeat(32), None, pattern(64, 1)).await.code, 401);
    assert_eq!(call(&r, "GET", &target, &token, None, "").await.code, 404, "blob stored despite auth failures");
}

#[tokio::test]
async fn blob_size_boundaries() {
    let dir = TempDir::new();
    let (r, token) = blob_relay(&dir);
    let cases = [(0, 400), (39, 400), (MIN_BLOB, 201), (MAX_BLOB_BYTES, 201), (MAX_BLOB_BYTES + 1, 413), (1 << 20, 413)];
    for (i, (size, want)) in cases.iter().enumerate() {
        let out = call(&r, "PUT", &format!("/v1/blobs/{}", blob_id(i + 1)), &token, None, pattern(*size, i + 1)).await;
        assert_eq!(out.code, *want, "size {size}");
    }
    for i in [2, 3] {
        let out = call(&r, "GET", &format!("/v1/blobs/{}", blob_id(i + 1)), &token, None, "").await;
        assert!(out.code == 200 && out.body == pattern(cases[i].0, i + 1), "boundary blob {i} not exact");
    }
}

#[tokio::test]
async fn blob_put_get_exact_bytes_reopen_replay_conflict() {
    let dir = TempDir::new();
    let (r, token) = blob_relay(&dir);
    let target = format!("/v1/blobs/{BLOB_TEST_ID}");
    let payload = pattern(4096, 5);
    assert_eq!(call(&r, "PUT", &target, &token, None, payload.clone()).await.code, 201);
    let out = call(&r, "GET", &target, &token, None, "").await;
    assert_eq!(out.code, 200);
    assert_eq!(out.headers["content-type"], "application/octet-stream");
    // The Content-Length header is added by hyper from the exact size hint.
    assert_eq!(out.body, payload);
    assert_eq!(call(&r, "PUT", &target, &token, None, payload.clone()).await.code, 200, "replay");
    assert_eq!(call(&r, "PUT", &target, &token, None, pattern(4096, 6)).await.code, 409, "conflict");
    let out = call(&r, "GET", &target, &token, None, "").await;
    assert!(out.code == 200 && out.body == payload, "original not preserved");
    assert_eq!(call(&r, "GET", &format!("/v1/blobs/{}", blob_id(99)), &token, None, "").await.code, 404);
    drop(r);
    let (r, token) = blob_relay(&dir);
    let out = call(&r, "GET", &target, &token, None, "").await;
    assert!(out.code == 200 && out.body == payload, "blob lost after reopen");
    assert_eq!(call(&r, "PUT", &target, &token, None, payload).await.code, 200, "replay after reopen");
    assert_eq!(call(&r, "PUT", &target, &token, None, pattern(4096, 6)).await.code, 409, "conflict after reopen");
}

#[tokio::test]
async fn blob_rejects_malformed_ids() {
    let dir = TempDir::new();
    let (r, token) = blob_relay(&dir);
    let bad = [
        BLOB_TEST_ID.to_uppercase(),
        "3d8f6a2e1b7c4e5f9a0b8c7d6e5f4a3b".into(),
        format!("{{{BLOB_TEST_ID}}}"),
        format!("urn:uuid:{BLOB_TEST_ID}"),
        format!("{BLOB_TEST_ID}/payload.bin"),
        format!("{BLOB_TEST_ID}/"),
        format!("{}g", &BLOB_TEST_ID[..35]),
        "3d8f6a2e-1b7c-4e5f-9a0b+8c7d6e5f4a3b".into(),
        "3d8f6a2e-1b7c-4e5f-9a0b-8c7d6e5f4a3".into(),
    ];
    for id in &bad {
        // {} are not valid URI characters; send them escaped, as Go's client would.
        let target = format!("/v1/blobs/{}", id.replace('{', "%7B").replace('}', "%7D"));
        assert_eq!(call(&r, "PUT", &target, &token, None, pattern(64, 1)).await.code, 404, "PUT {id}");
        assert_eq!(call(&r, "GET", &target, &token, None, "").await.code, 404, "GET {id}");
    }
    let stored = r.db_sync(|s| s.view(|tx| Ok(store::scan(tx, store::BLOBS, b"", usize::MAX)?.len()))).unwrap();
    assert_eq!(stored, 0, "malformed IDs stored blobs");
}

#[tokio::test]
async fn blob_method_not_allowed() {
    let dir = TempDir::new();
    let (r, token) = blob_relay(&dir);
    for method in ["DELETE", "POST", "HEAD", "PATCH"] {
        let out = call(&r, method, &format!("/v1/blobs/{BLOB_TEST_ID}"), &token, None, "").await;
        assert_eq!(out.code, 405, "{method}");
        assert_eq!(out.headers["allow"], "GET, PUT", "{method}");
    }
}

#[tokio::test]
async fn blob_traffic_leaves_changes_cursor_untouched() {
    let dir = TempDir::new();
    let (r, token) = blob_relay(&dir);
    let post = |id: &'static str, blob: &'static str| {
        let (r, token) = (r.clone(), token.clone());
        async move { call(&r, "POST", "/v1/changes", &token, None, format!(r#"{{"id":"{id}","blob":"{blob}"}}"#)).await }
    };
    assert_eq!(post("change-a-00000001", "enc-a").await.code, 200);
    assert_eq!(post("change-b-00000001", "enc-b").await.code, 200);
    let snapshot = || async {
        let out = call(&r, "GET", "/v1/changes?limit=100", &token, None, "").await;
        assert_eq!(out.code, 200, "{}", out.text());
        let page = out.json();
        (page["cursor"].clone(), page["items"].clone())
    };
    let before = snapshot().await;
    let target = format!("/v1/blobs/{BLOB_TEST_ID}");
    assert_eq!(call(&r, "PUT", &target, &token, None, pattern(512, 3)).await.code, 201);
    assert_eq!(call(&r, "GET", &target, &token, None, "").await.code, 200);
    call(&r, "PUT", &target, &token, None, pattern(512, 3)).await;
    call(&r, "DELETE", &target, &token, None, "").await;
    assert_eq!(snapshot().await, before, "changes stream moved");
    let out = post("change-c-00000001", "enc-c").await;
    assert!(out.code == 200 && out.text().contains(r#""seq":3"#), "next change seq: {}", out.text());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn blob_concurrent_distinct_puts_single_winner() {
    let dir = TempDir::new();
    let (r, token) = blob_relay(&dir);
    let target = format!("/v1/blobs/{BLOB_TEST_ID}");
    let writers: Vec<_> = (0..8)
        .map(|i| {
            let (r, token, target) = (r.clone(), token.clone(), target.clone());
            tokio::spawn(async move { call(&r, "PUT", &target, &token, None, pattern(200, i + 1)).await.code })
        })
        .collect();
    let mut codes = Vec::new();
    for w in writers {
        codes.push(w.await.unwrap());
    }
    assert_eq!(codes.iter().filter(|c| **c == 201).count(), 1, "{codes:?}");
    assert_eq!(codes.iter().filter(|c| **c == 409).count(), 7, "{codes:?}");
    let winner = codes.iter().position(|c| *c == 201).unwrap();
    let out = call(&r, "GET", &target, &token, None, "").await;
    assert!(out.code == 200 && out.body == pattern(200, winner + 1), "stored bytes are not the winner's");
}

// ---- recovery_test.go

const CLIENT_ID: &str = "123456-synthetic.apps.googleusercontent.com";
const SUBJECT: &str = "synthetic-subject";
const AUTH_TOKEN: &str = "0123456789abcdef0123456789abcdef";
const OWNER_KEY: &[u8] = include_bytes!("../tests/fixtures/owner-rsa.der");
const FORGED_KEY: &[u8] = include_bytes!("../tests/fixtures/forged-rsa.der");

fn key_pair(der: &[u8]) -> RsaKeyPair {
    RsaKeyPair::from_der(der).unwrap()
}

/// Fake Google key set holding only `der`'s public key under kid "synthetic".
fn jwks(der: &[u8]) -> JwksFetch {
    let n = ring::signature::RsaPublicKeyComponents::<Vec<u8>>::from(key_pair(der).public()).n;
    let body = serde_json::to_vec(&json!({"keys": [{"kid": "synthetic", "alg": "RS256", "kty": "RSA", "use": "sig", "n": URL_SAFE_NO_PAD.encode(n), "e": "AQAB"}]})).unwrap();
    Arc::new(move || {
        let body = body.clone();
        Box::pin(async move { Ok(body) })
    })
}

fn bearer(der: &[u8], mutate: impl FnOnce(&mut Value)) -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let mut claims = json!({"iss": "https://accounts.google.com", "sub": SUBJECT, "aud": CLIENT_ID, "iat": now, "exp": now + 3600});
    mutate(&mut claims);
    let head = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"alg": "RS256", "kid": "synthetic"})).unwrap());
    let signed = format!("{head}.{}", URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap()));
    let kp = key_pair(der);
    let mut sig = vec![0; kp.public().modulus_len()];
    kp.sign(&RSA_PKCS1_SHA256, &SystemRandom::new(), signed.as_bytes(), &mut sig).unwrap();
    format!("{signed}.{}", URL_SAFE_NO_PAD.encode(sig))
}

fn owner_token() -> String {
    bearer(OWNER_KEY, |_| {})
}

fn recovery_relay(path: &Path, subject: &str, master: &[u8]) -> Result<Relay, Error> {
    let mut r = Relay::open(path, AUTH_TOKEN)?;
    r.enable_owner_recovery(CLIENT_ID, subject, master, jwks(OWNER_KEY))?;
    Ok(r)
}

async fn recovery(r: &Relay, method: &str, token: &str, body: &str) -> Out {
    call(r, method, "/v1/recovery/key", token, None, body.to_owned()).await
}

fn put_body(key: &str) -> String {
    format!(r#"{{"key":"{key}"}}"#)
}

fn vault_envelope(r: &Relay) -> Vec<u8> {
    r.db_sync(|s| s.view(|tx| store::get(tx, store::RECOVERY, b"vault"))).unwrap().unwrap_or_default()
}

#[tokio::test]
async fn recovery_owner_get_put_sealing_and_idempotence() {
    let dir = TempDir::new();
    let r = recovery_relay(&dir.db(), SUBJECT, &random(32)).unwrap();
    let vault_key = random(32);
    let encoded = STANDARD.encode(&vault_key);
    assert_eq!(recovery(&r, "GET", &owner_token(), "").await.code, 404, "unregistered key served");
    assert_eq!(recovery(&r, "POST", &owner_token(), r#"{"key":"x"}"#).await.code, 405, "method guard");
    assert_eq!(recovery(&r, "GET", "", "").await.code, 401, "anonymous request accepted");
    let out = recovery(&r, "PUT", &owner_token(), &put_body(&encoded)).await;
    assert_eq!(out.code, 200, "{}", out.text());
    let out = recovery(&r, "GET", &owner_token(), "").await;
    let got = out.json();
    assert!(out.code == 200 && got["token"] == AUTH_TOKEN, "{}", out.text());
    assert_eq!(STANDARD.decode(got["key"].as_str().unwrap()).unwrap(), vault_key, "recovered key differs");
    // Only the sealed envelope is stored (main file and WAL alike).
    for file in [dir.db(), dir.0.join("relay.db-wal")] {
        let data = std::fs::read(&file).unwrap_or_default();
        let has = |needle: &[u8]| data.windows(needle.len()).any(|w| w == needle);
        assert!(!has(&vault_key) && !has(encoded.as_bytes()), "plaintext recovery key persisted in {file:?}");
    }
    let envelope = vault_envelope(&r);
    assert!(envelope.starts_with(b"MINDBOX-SERVER-KEY-1\n") && !envelope.windows(32).any(|w| w == vault_key), "vault envelope leaks the key");
    assert_eq!(recovery(&r, "PUT", &owner_token(), &put_body(&encoded)).await.code, 200, "same key rejected");
    let other = STANDARD.encode([0x5a; 32]);
    assert_eq!(recovery(&r, "PUT", &owner_token(), &put_body(&other)).await.code, 409, "different key accepted");
    let out = recovery(&r, "GET", &owner_token(), "").await;
    assert!(out.code == 200 && out.json()["key"] == encoded.as_str(), "key replaced after conflict");
}

#[tokio::test]
async fn recovery_rejects_foreign_tokens_without_mutation() {
    let dir = TempDir::new();
    let r = recovery_relay(&dir.db(), SUBJECT, &random(32)).unwrap();
    let encoded = STANDARD.encode(random(32));
    assert_eq!(recovery(&r, "PUT", &owner_token(), &put_body(&encoded)).await.code, 200);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let cases = [
        ("wrong-owner", bearer(OWNER_KEY, |c| c["sub"] = "other-subject".into()), 403),
        ("forged", bearer(FORGED_KEY, |_| {}), 401),
        ("expired", bearer(OWNER_KEY, |c| c["exp"] = (now - 1).into()), 401),
        ("wrong-aud", bearer(OWNER_KEY, |c| c["aud"] = "999999-bad.apps.googleusercontent.com".into()), 401),
    ];
    for (name, token, status) in &cases {
        for method in ["GET", "PUT"] {
            assert_eq!(recovery(&r, method, token, &put_body(&encoded)).await.code, *status, "{name} {method}");
        }
    }
    let out = recovery(&r, "GET", &owner_token(), "").await;
    assert!(out.code == 200 && out.json()["key"] == encoded.as_str(), "recovery key mutated by rejected requests");
}

#[tokio::test]
async fn recovery_restarts_preserve_registered_key() {
    let dir = TempDir::new();
    let master = random(32);
    let r = recovery_relay(&dir.db(), SUBJECT, &master).unwrap();
    let encoded = STANDARD.encode(random(32));
    assert_eq!(recovery(&r, "PUT", &owner_token(), &put_body(&encoded)).await.code, 200);
    drop(r);
    let r = recovery_relay(&dir.db(), SUBJECT, &master).unwrap();
    let out = recovery(&r, "GET", &owner_token(), "").await;
    assert!(out.code == 200 && out.json()["key"] == encoded.as_str(), "registered key lost on restart: {}", out.text());
}

#[tokio::test]
async fn recovery_startup_rejections_leave_stored_data_intact() {
    let dir = TempDir::new();
    let (master, wrong_master) = (random(32), random(32));
    let r = recovery_relay(&dir.db(), SUBJECT, &master).unwrap();
    let encoded = STANDARD.encode(random(32));
    assert_eq!(recovery(&r, "PUT", &owner_token(), &put_body(&encoded)).await.code, 200);
    let envelope = vault_envelope(&r);
    drop(r);
    for (subject, key, what) in [("other-subject", &master[..], "conflicting subject"), (SUBJECT, &wrong_master[..], "wrong master key"), (SUBJECT, &master[..31], "short master key")] {
        let mut bad = Relay::open(dir.db(), AUTH_TOKEN).unwrap();
        assert!(bad.enable_owner_recovery(CLIENT_ID, subject, key, jwks(OWNER_KEY)).is_err(), "{what} accepted");
        assert_eq!(recovery(&bad, "GET", &owner_token(), "").await.code, 404, "recovery served after failed enable ({what})");
    }
    let good = recovery_relay(&dir.db(), SUBJECT, &master).unwrap();
    assert_eq!(vault_envelope(&good), envelope, "vault envelope changed");
    let out = recovery(&good, "GET", &owner_token(), "").await;
    assert!(out.code == 200 && out.json()["key"] == encoded.as_str(), "recovery key lost after rejected startups: {}", out.text());
}

// ---- migration: a bbolt dump imports byte for byte and keeps sequences

#[tokio::test]
async fn import_bolt_dump_keeps_values_and_sequences() {
    let dir = TempDir::new();
    let b = |s: &[u8]| STANDARD.encode(s);
    let record = br#"{"seq":7,"id":"imported-record-01","blob":"x"}"#;
    let dump = [
        json!({"type": "bucket", "name": b(b"records"), "sequence": 9}),
        json!({"type": "entry", "bucket": b(b"records"), "key": b(&7u64.to_be_bytes()), "value": b(record)}),
        json!({"type": "bucket", "name": b(b"identities"), "sequence": 0}),
        json!({"type": "entry", "bucket": b(b"identities"), "key": b(b"imported-record-01"), "value": b(&7u64.to_be_bytes())}),
        json!({"type": "end", "buckets": 2, "entries": 2}),
    ];
    let path = dir.0.join("dump.jsonl");
    std::fs::write(&path, dump.iter().map(|l| format!("{l}\n")).collect::<String>()).unwrap();
    let mut s = Store::open(&dir.db()).unwrap();
    assert_eq!(s.import_bolt_dump(&path).unwrap(), (2, 2));
    assert!(s.import_bolt_dump(&path).is_err(), "import into a non-empty database");
    drop(s);
    let token = "i".repeat(32);
    let r = Relay::open(dir.db(), &token).unwrap();
    let out = call(&r, "GET", "/v1/changes", &token, None, "").await;
    assert_eq!(out.json()["items"][0]["id"], "imported-record-01", "{}", out.text());
    let out = call(&r, "POST", "/v1/changes", &token, None, r#"{"id":"after-import-0001","blob":"y"}"#).await;
    assert!(out.text().contains(r#""seq":10"#), "sequence not continued: {}", out.text());

    // A truncated dump is rejected and leaves nothing behind.
    let dir2 = TempDir::new();
    let short = dir2.0.join("dump.jsonl");
    std::fs::write(&short, format!("{}\n", dump[0])).unwrap();
    let mut s = Store::open(&dir2.db()).unwrap();
    assert!(s.import_bolt_dump(&short).is_err());
    assert!(s.view(|tx| store::scan(tx, store::RECORDS, b"", 10)).unwrap().is_empty());
}

#[tokio::test]
async fn sharing_wiki_password_roles_versions_domain_boundaries(){
    async fn access(r:&Relay,method:&str,path:&str,password:&str,body:Value,host:&str)->Out{
        let req=Request::builder().method(method).uri(path).header("host",host).header("accept","application/json").header("x-share-password",password).body(Full::new(Bytes::from(body.to_string()))).unwrap();
        let res=r.handle(req).await;let(parts,body)=res.into_parts();Out{code:parts.status.as_u16(),headers:parts.headers,body:body.bytes().await.to_vec()}
    }
    let dir=TempDir::new();let token="a".repeat(32);let r=Relay::open(dir.db(),&token).unwrap();
    let made=call(&r,"POST","/v1/publications",&token,None,json!({"title":"Home","html":"<p>Private copy</p>","password":"public-password","days":7,"pages":[{"id":"page1","title":"Child","html":"<p onclick='bad()'>child</p>"}]}).to_string()).await;
    assert_eq!(made.code,201,"{}",made.text());assert!(made.json().get("password_hash").is_none());let id=made.json()["id"].as_str().unwrap().to_owned();let path=format!("/p/{id}");
    let locked=access(&r,"GET",&path,"",Value::Null,"localhost").await;assert_eq!(locked.code,401);assert!(locked.text().contains("id=\"password\""));assert!(!locked.text().contains("Private copy"));
    let opened=access(&r,"GET",&path,"public-password",Value::Null,"localhost").await;assert_eq!(opened.code,200);assert_eq!(opened.json()["pages"][0]["html"],"<p>child</p>");assert!(opened.json().get("password_hash").is_none());
    let viewer=call(&r,"POST","/v1/shares",&token,None,json!({"publication_id":id,"role":"viewer","password":"v"}).to_string()).await;let vid=viewer.json()["id"].as_str().unwrap().to_owned();
    assert_eq!(access(&r,"GET",&path,"public-password",Value::Null,"localhost").await.code,401,"old public link bypasses revocation");
    assert_eq!(access(&r,"PUT",&format!("/s/{vid}"),"v",json!({"title":"bad","html":"bad","version":1}),"localhost").await.code,403);
    let editor=call(&r,"POST","/v1/shares",&token,None,json!({"publication_id":id,"role":"editor","password":"e"}).to_string()).await;let eid=editor.json()["id"].as_str().unwrap().to_owned();let ep=format!("/s/{eid}");
    let edited=access(&r,"PUT",&ep,"e",json!({"title":"Edited","html":"<script>bad()</script><p>safe</p>","page_id":"page1","version":1}),"localhost").await;assert_eq!(edited.code,200,"{}",edited.text());
    assert_eq!(access(&r,"PUT",&ep,"e",json!({"title":"stale","html":"stale","version":1}),"localhost").await.code,409);
    assert_eq!(access(&r,"GET",&ep,"e",Value::Null,"localhost").await.json()["pages"][0]["html"],"<p>safe</p>");
    let owner_path=format!("/v1/publications/{id}");
    assert_eq!(call(&r,"GET",&owner_path,"bad",None,"").await.code,401);
    let snapshot=call(&r,"GET",&owner_path,&token,None,"").await;
    assert_eq!(snapshot.code,200);assert_eq!(snapshot.json()["version"],2);assert_eq!(snapshot.json()["pages"][0]["html"],"<p>safe</p>");assert!(snapshot.json().get("password_hash").is_none());
    assert_eq!(call(&r,"DELETE",&format!("/v1/shares/{eid}"),&token,None,"").await.code,204);
    assert_eq!(access(&r,"PUT",&ep,"e",json!({"title":"bad","html":"bad","version":2}),"localhost").await.code,404);
    assert_eq!(call(&r,"PUT","/v1/settings/domain",&token,None,r#"{"hosts":["wiki.example.com"]}"#).await.code,200);
    assert_eq!(access(&r,"GET",&format!("/s/{vid}"),"v",Value::Null,"evil.test").await.code,403);
    assert_eq!(access(&r,"GET",&format!("/s/{vid}"),"v",Value::Null,"wiki.example.com").await.code,200);
    assert_eq!(call(&r,"GET","/v1/settings/domain",&token,None,"").await.code,200,"owner locked out");
    assert_eq!(call(&r,"PUT","/v1/settings/domain",&token,None,r#"{"hosts":[]}"#).await.code,200);
    r.db_sync(|s|s.update(|tx|{let raw=store::get(tx,store::PUBLICATIONS,id.as_bytes())?.unwrap();let mut p:Value=serde_json::from_slice(&raw)?;p["expires"]=json!(0);store::put(tx,store::PUBLICATIONS,id.as_bytes(),&serde_json::to_vec(&p)?) })).unwrap();
    assert_eq!(access(&r,"GET",&format!("/s/{vid}"),"v",Value::Null,"localhost").await.code,404,"expired publication remains visible through invite");
    assert_eq!(call(&r,"GET",&owner_path,&token,None,"").await.code,404,"expired snapshot must not reconcile");
    assert_eq!(call(&r,"POST","/v1/shares",&token,None,json!({"publication_id":id,"role":"editor"}).to_string()).await.code,404,"expired publication accepts invites");
    assert_eq!(call(&r,"DELETE",&format!("/v1/publications/{id}"),&token,None,"").await.code,204);
    assert_eq!(access(&r,"GET",&format!("/s/{vid}"),"v",Value::Null,"localhost").await.code,404);
}

#[tokio::test]
async fn collaboration_metadata_presence_permissions_and_cas(){
 async fn access(r:&Relay,method:&str,path:&str,password:&str,v:Value,cross:bool)->Out{
  let mut q=Request::builder().method(method).uri(path).header("accept","application/json").header("x-share-password",password);
  if cross {q=q.header("sec-fetch-site","cross-site");}
  let res=r.handle(q.body(Full::new(Bytes::from(v.to_string()))).unwrap()).await;let(parts,body)=res.into_parts();Out{code:parts.status.as_u16(),headers:parts.headers,body:body.bytes().await.to_vec()}
 }
 let dir=TempDir::new();let token="a".repeat(32);let r=Relay::open(dir.db(),&token).unwrap();
 let p=call(&r,"POST","/v1/publications",&token,None,json!({"title":"Home","html":"<p>PRIVATEBODY</p>","days":7}).to_string()).await.json();
 let a=call(&r,"POST","/v1/shares",&token,None,json!({"publication_id":p["id"],"role":"editor","password":"secret"}).to_string()).await.json();
 let b=call(&r,"POST","/v1/shares",&token,None,json!({"publication_id":p["id"],"role":"viewer","password":"viewer"}).to_string()).await.json();
 let ap=format!("/s/{}",a["id"].as_str().unwrap());let bp=format!("/s/{}",b["id"].as_str().unwrap());
 let heartbeat=json!({"client_id":"client-aaaaaaaaaaaa","page_id":""});
 assert_eq!(access(&r,"POST",&format!("{ap}/session"),"wrong",heartbeat.clone(),false).await.code,401);
 assert_eq!(access(&r,"POST",&format!("{ap}/session"),"secret",heartbeat.clone(),true).await.code,403);
 let first=access(&r,"POST",&format!("{ap}/session"),"secret",heartbeat.clone(),false).await;assert_eq!(first.code,200);assert_eq!(first.json()["version"],1);assert!(!first.text().contains("PRIVATEBODY"));assert!(!first.text().contains(a["id"].as_str().unwrap()));
 let peer=access(&r,"POST",&format!("{bp}/session"),"viewer",json!({"client_id":"client-bbbbbbbbbbbb","page_id":""}),false).await;assert_eq!(peer.json()["sessions"].as_array().unwrap().len(),2);
 let write=json!({"title":"A","html":"<p>A edit</p>","version":1});assert_eq!(access(&r,"PUT",&ap,"secret",write.clone(),false).await.code,200);assert_eq!(access(&r,"PUT",&ap,"secret",write.clone(),false).await.code,409);assert_eq!(access(&r,"PUT",&bp,"viewer",write,false).await.code,403);
 assert_eq!(access(&r,"POST",&format!("{ap}/session"),"secret",heartbeat.clone(),false).await.json()["version"],2);
 assert_eq!(call(&r,"DELETE",&format!("/v1/shares/{}",a["id"].as_str().unwrap()),&token,None,"").await.code,204);
 assert_eq!(access(&r,"POST",&format!("{ap}/session"),"secret",heartbeat,false).await.code,404);
 assert_eq!(access(&r,"POST",&format!("{bp}/session"),"viewer",json!({"client_id":"client-bbbbbbbbbbbb","page_id":""}),false).await.json()["sessions"].as_array().unwrap().len(),1);
 r.presence.lock().unwrap().clear();
 for i in 0..64{assert_eq!(access(&r,"POST",&format!("{bp}/session"),"viewer",json!({"client_id":format!("client-{i:016}"),"page_id":""}),false).await.code,200);}
 // Slow password hashing (Windows runners) can take longer than the 40 s session TTL; keep all 64 alive for the cap check.
 for peer in r.presence.lock().unwrap().iter_mut(){peer.expires=i64::MAX;}
 assert_eq!(access(&r,"POST",&format!("{bp}/session"),"viewer",json!({"client_id":"client-overflow000000","page_id":""}),false).await.code,429);
 // Expired sessions disappear without waiting for wall-clock TTL in a test.
 for peer in r.presence.lock().unwrap().iter_mut(){peer.expires=0;}
 assert_eq!(access(&r,"POST",&format!("{bp}/session"),"viewer",json!({"client_id":"client-renewed000000","page_id":"missing"}),false).await.json()["sessions"].as_array().unwrap().len(),1);
 drop(r);let r=Relay::open(dir.db(),&token).unwrap();assert!(r.presence.lock().unwrap().is_empty());
 assert_eq!(access(&r,"GET",&bp,"viewer",Value::Null,false).await.json()["html"],"<p>A edit</p>");
}

#[tokio::test]
async fn authoritative_block_merge_history_restart_and_false_base(){
 async fn edit(r:&Relay,path:&str,v:Value)->Out{let req=Request::builder().method("PUT").uri(path).header("accept","application/json").body(Full::new(Bytes::from(v.to_string()))).unwrap();let res=r.handle(req).await;let(parts,body)=res.into_parts();Out{code:parts.status.as_u16(),headers:parts.headers,body:body.bytes().await.to_vec()}}
 let dir=TempDir::new();let token="a".repeat(32);let r=Relay::open(dir.db(),&token).unwrap();
 let p=call(&r,"POST","/v1/publications",&token,None,json!({"title":"Home","html":"<p>one</p><p>two🙂</p>","days":7}).to_string()).await.json();
 let invite=call(&r,"POST","/v1/shares",&token,None,json!({"publication_id":p["id"],"role":"editor"}).to_string()).await.json();let path=format!("/s/{}",invite["id"].as_str().unwrap());let owner=format!("/v1/publications/{}",p["id"].as_str().unwrap());
 let write=|html:&str,version|json!({"title":"Home","html":html,"version":version,"merge":"blocks-v1"});
 assert_eq!(edit(&r,&path,write("<p>first A</p><p>two🙂</p>",1)).await.code,200);
 // History survives process restart and is looked up only by server revision.
 drop(r);let r=Relay::open(dir.db(),&token).unwrap();let merged=edit(&r,&path,write("<p>one</p><p>second B🙂</p>",1)).await;assert_eq!(merged.code,200,"{}",merged.text());assert_eq!(merged.json()["merged"],true);
 assert_eq!(call(&r,"GET",&owner,&token,None,"").await.json()["html"],"<p>first A</p><p>second B🙂</p>");
 assert_eq!(edit(&r,&path,write("<p>first C</p><p>two🙂</p>",1)).await.code,409,"same paragraph conflict");
 assert_eq!(edit(&r,&path,write("<p>one</p><p>two🙂</p><p>new block</p>",1)).await.code,409,"structural edits conflict");
 let mut forged=write("<p>forged</p>",1);forged["base_html"]=json!("<p>pretend</p>");assert_eq!(edit(&r,&path,forged).await.code,400);
 assert_eq!(edit(&r,&path,write("<p>unknown base</p>",999)).await.code,409);
 assert_eq!(edit(&r,&path,write("<p>unknown base</p>",0)).await.code,409);
 // Owner updates also establish an authoritative merge base, not just shared PUTs.
 assert_eq!(call(&r,"PUT",&owner,&token,None,json!({"title":"Home","html":"<p>owner A</p><p>second B🙂</p>","days":7}).to_string()).await.code,200);
 assert_eq!(edit(&r,&path,write("<p>first A</p><p>client B🙂</p>",3)).await.code,200);
 assert_eq!(call(&r,"GET",&owner,&token,None,"").await.json()["html"],"<p>owner A</p><p>client B🙂</p>");
 let mut version=5;for i in 0..18{let out=edit(&r,&path,write(&format!("<p>owner A</p><p>{i}</p>"),version)).await;assert_eq!(out.code,200);version+=1;}
 assert_eq!(edit(&r,&path,write("<p>one</p><p>too old</p>",1)).await.code,409,"pruned base never guessed");
 assert_eq!(call(&r,"DELETE",&format!("/v1/shares/{}",invite["id"].as_str().unwrap()),&token,None,"").await.code,204);
 assert_eq!(edit(&r,&path,write("<p>revoked</p>",version)).await.code,404);
 assert_eq!(call(&r,"DELETE",&owner,&token,None,"").await.code,204);
 let history=r.db_sync(|s|s.view(|tx|store::scan(tx,"publication-merge-history-v1",b"",100))).unwrap();assert!(history.is_empty(),"revocation purges historical plaintext");
}
