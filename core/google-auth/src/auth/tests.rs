//! Port of googleauth's client_test.go, client_secret_test.go and
//! backend_token_test.go. Provider endpoints are loopback mocks.

use super::*;
use crate::test_http::{json, raw_request, serve, Request};
use rsa::traits::PublicKeyParts;
use rsa::{
    pkcs1v15::SigningKey, signature::RandomizedSigner, signature::SignatureEncoding, RsaPrivateKey,
};
use serde_json::{json as j, Value};
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::OnceLock;
use std::time::Instant;

const TEST_ID: &str = "123456-synthetic.apps.googleusercontent.com";

fn keys() -> &'static (RsaPrivateKey, RsaPrivateKey) {
    static KEYS: OnceLock<(RsaPrivateKey, RsaPrivateKey)> = OnceLock::new();
    KEYS.get_or_init(|| {
        let mut rng = rand::thread_rng();
        (
            RsaPrivateKey::new(&mut rng, 2048).unwrap(),
            RsaPrivateKey::new(&mut rng, 2048).unwrap(),
        )
    })
}
fn key() -> &'static RsaPrivateKey {
    &keys().0
}
fn wrong_key() -> &'static RsaPrivateKey {
    &keys().1
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn signed(k: &RsaPrivateKey, claims: &Value, alg: &str) -> String {
    let head = B64URL.encode(j!({"alg": alg, "kid": "synthetic"}).to_string());
    let body = B64URL.encode(claims.to_string());
    let input = format!("{head}.{body}");
    let sig = SigningKey::<sha2::Sha256>::new(k.clone())
        .sign_with_rng(&mut rand::thread_rng(), input.as_bytes());
    format!("{input}.{}", B64URL.encode(sig.to_bytes()))
}

fn claims(nonce: &str) -> Value {
    j!({"iss": "https://accounts.google.com", "sub": "synthetic-subject", "aud": TEST_ID, "nonce": nonce,
        "iat": now(), "exp": now() + 3600, "email": "synthetic@example.invalid", "email_verified": true,
        "name": "Synthetic User"})
}

fn jwks(k: &RsaPrivateKey) -> Value {
    j!({"keys": [{"kid": "synthetic", "alg": "RS256", "kty": "RSA", "use": "sig",
        "n": B64URL.encode(k.n().to_bytes_be()), "e": "AQAB"}]})
}

fn opener(
    f: impl Fn(&str) -> Result<(), crate::BoxError> + Send + Sync + 'static,
) -> BrowserOpener {
    Box::new(f)
}

fn ok_opener() -> BrowserOpener {
    opener(|_| Ok(()))
}

/// Client whose provider endpoints all point at `base`.
fn client_at(base: &str, open: BrowserOpener) -> Client {
    Client::new(TEST_ID, open)
        .unwrap()
        .with_endpoints(endpoints(base))
}

fn endpoints(base: &str) -> Endpoints {
    Endpoints {
        auth: AUTH_ENDPOINT.into(),
        token: format!("{base}/token"),
        keys: format!("{base}/certs"),
    }
}

/// A key server that always returns `jwks(key())`.
fn key_server() -> String {
    serve(|_| json(200, jwks(key())))
}

fn query(raw: &str) -> HashMap<String, String> {
    url::Url::parse(raw)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect()
}

/// Sends a callback GET to the redirect URI in the authorization URL `auth`.
fn callback(auth: &str, values: &[(&str, &str)]) -> u16 {
    let redirect = url::Url::parse(&query(auth)["redirect_uri"]).unwrap();
    let base = format!("http://{}", redirect.authority());
    let encoded = form_urlencoded::Serializer::new(String::new())
        .extend_pairs(values)
        .finish();
    let (status, headers) = raw_request(
        &base,
        "GET",
        &format!("{}?{encoded}", redirect.path()),
        redirect.authority(),
    );
    assert_eq!(
        headers.get("cache-control").map(String::as_str),
        Some("no-store"),
        "callback cache policy"
    );
    status
}

#[test]
fn login_pkce_state_nonce_and_replay() {
    let auth = Arc::new(Mutex::new(String::new()));
    let calls = Arc::new(AtomicUsize::new(0));
    let (seen, counter) = (auth.clone(), calls.clone());
    let base = serve(move |r: Request| {
        counter.fetch_add(1, Ordering::SeqCst);
        let q = query(&seen.lock().unwrap());
        match r.path.as_str() {
            "/token" => {
                let form = r.form();
                let sum =
                    ring::digest::digest(&ring::digest::SHA256, form["code_verifier"].as_bytes());
                assert!(
                    r.method == "POST"
                        && B64URL.encode(sum) == q["code_challenge"]
                        && form["redirect_uri"] == q["redirect_uri"]
                        && !form.contains_key("client_secret")
                        && form["code"] == "synthetic-code",
                    "token form"
                );
                json(
                    200,
                    j!({"id_token": signed(key(), &claims(&q["nonce"]), "RS256"), "access_token": "ignored", "refresh_token": "ignored"}),
                )
            }
            "/certs" => json(200, jwks(key())),
            other => panic!("unexpected endpoint {other}"),
        }
    });
    let seen = auth.clone();
    let c = client_at(
        &base,
        opener(move |raw| {
            *seen.lock().unwrap() = raw.to_string();
            let q = query(raw);
            let u = url::Url::parse(raw).unwrap();
            assert_eq!(
                format!("{}://{}{}", u.scheme(), u.host_str().unwrap(), u.path()),
                AUTH_ENDPOINT
            );
            assert!(
                q["scope"] == "openid"
                    && q["access_type"] == "online"
                    && q["code_challenge_method"] == "S256"
            );
            assert_ne!(q["nonce"], q["state"]);
            assert!(
                q["redirect_uri"].starts_with("http://127.0.0.1:"),
                "non-loopback redirect"
            );
            assert_eq!(
                callback(raw, &[("state", "wrong"), ("code", "code")]),
                400,
                "wrong state accepted"
            );
            let state = q["state"].as_str();
            assert_eq!(
                callback(raw, &[("state", state), ("state", state), ("code", "code")]),
                400,
                "duplicate state"
            );
            let values = [("state", state), ("code", "synthetic-code")];
            assert_eq!(callback(raw, &values), 200);
            assert_eq!(callback(raw, &values), 409, "callback replay");
            Ok(())
        }),
    );
    let id = c.login(&Context::background()).unwrap();
    assert!(
        id.subject == "synthetic-subject" && id.email_verified && calls.load(Ordering::SeqCst) == 2
    );
    // Listener lifecycle ends with login; the response cannot be replayed later.
    let redirect = url::Url::parse(&query(&auth.lock().unwrap())["redirect_uri"]).unwrap();
    assert!(
        TcpStream::connect(redirect.authority()).is_err(),
        "callback listener remains open"
    );
}

#[test]
fn claims_and_signature_failures() {
    let c = client_at(&key_server(), ok_opener());
    let ctx = Context::background();
    type Mutate = Box<dyn Fn(&mut Value)>;
    let cases: Vec<(&str, Mutate)> = vec![
        (
            "issuer",
            Box::new(|c| c["iss"] = j!("https://attacker.invalid")),
        ),
        ("aud", Box::new(|c| c["aud"] = j!("other"))),
        ("expired", Box::new(|c| c["exp"] = j!(now() - 1))),
        ("nonce", Box::new(|c| c["nonce"] = j!("other"))),
        ("sub", Box::new(|c| c["sub"] = j!(""))),
        ("future-issued", Box::new(|c| c["iat"] = j!(now() + 3600))),
        ("future-nbf", Box::new(|c| c["nbf"] = j!(now() + 3600))),
        ("azp", Box::new(|c| c["azp"] = j!("other"))),
        (
            "multi-aud-no-azp",
            Box::new(|c| c["aud"] = j!([TEST_ID, "other"])),
        ),
        ("float-exp", Box::new(|c| c["exp"] = j!(1.5))),
    ];
    for (name, mutate) in cases {
        let mut cl = claims("nonce");
        mutate(&mut cl);
        assert_eq!(
            c.verify(&ctx, &signed(key(), &cl, "RS256"), "nonce"),
            Err(AuthError::InvalidToken),
            "{name}"
        );
    }
    for (name, token) in [
        ("signature", signed(wrong_key(), &claims("nonce"), "RS256")),
        ("none-alg", signed(key(), &claims("nonce"), "none")),
        ("malformed", "bad.jwt".to_string()),
        ("oversize", "x".repeat(65537)),
    ] {
        assert_eq!(
            c.verify(&ctx, &token, "nonce"),
            Err(AuthError::InvalidToken),
            "{name}"
        );
    }
    let mut cl = claims("nonce");
    cl["aud"] = j!([TEST_ID, "other"]);
    cl["azp"] = j!(TEST_ID);
    c.verify(&ctx, &signed(key(), &cl, "RS256"), "nonce")
        .unwrap();
}

#[test]
fn cancel_concurrency_timeout_and_retry() {
    let (tx, rx) = mpsc::channel::<()>();
    let tx = Mutex::new(tx);
    let c =
        Arc::new(Client::new(TEST_ID, opener(move |_| Ok(tx.lock().unwrap().send(())?))).unwrap());
    let worker = c.clone();
    let done = thread::spawn(move || worker.login(&Context::background()));
    rx.recv().unwrap();
    assert_eq!(c.login(&Context::background()), Err(AuthError::Busy));
    c.cancel();
    assert_eq!(done.join().unwrap(), Err(AuthError::Cancelled));
    // The same client retries; the overall deadline (here the caller's) ends it.
    let started = Instant::now();
    assert_eq!(
        c.login(&Context::background().with_timeout(Duration::from_millis(20))),
        Err(AuthError::Cancelled)
    );
    assert!(started.elapsed() < Duration::from_secs(5));
    let short = Client::new(TEST_ID, ok_opener())
        .unwrap()
        .with_login_timeout(Duration::from_millis(20));
    assert_eq!(
        short.login(&Context::background()),
        Err(AuthError::Cancelled)
    );
}

#[test]
fn denied_and_browser_failure() {
    let c = Client::new(
        TEST_ID,
        opener(|raw| {
            let state = query(raw)["state"].clone();
            callback(raw, &[("state", &state), ("error", "access_denied")]);
            Ok(())
        }),
    )
    .unwrap();
    assert_eq!(c.login(&Context::background()), Err(AuthError::Cancelled));
    let c = Client::new(
        TEST_ID,
        opener(|_| Err("sensitive provider URL must not escape".into())),
    )
    .unwrap();
    let e = c.login(&Context::background()).unwrap_err();
    assert!(!e.to_string().contains("sensitive"));
    assert!(matches!(
        Client::new("", ok_opener()),
        Err(AuthError::NotConfigured)
    ));
}

#[test]
fn provider_errors_are_bounded_and_redacted() {
    let c = Client::new(TEST_ID, ok_opener()).unwrap();
    let ctx = Context::background();
    for status in [302u16, 400, 401, 500] {
        let base = serve(move |_| json(status, j!({"error": "secret-code-value"})));
        let e = c
            .request::<Value>(&ctx, c.http.post(format!("{base}/token")))
            .unwrap_err();
        assert!(
            e == AuthError::Provider && !e.to_string().contains("secret"),
            "{status}"
        );
    }
    let base = serve(|_| (200, vec![b'x'; (1 << 20) + 1]));
    assert_eq!(
        c.request::<Value>(&ctx, c.http.get(format!("{base}/certs"))),
        Err(AuthError::Provider)
    );
}

#[test]
fn cancel_during_token_exchange() {
    let (entered_tx, entered) = mpsc::channel::<()>();
    let entered_tx = Mutex::new(entered_tx);
    let (release, released) = mpsc::channel::<()>();
    let released = Mutex::new(released);
    // The provider holds the token request until the test ends.
    let base = serve(move |_| {
        let _ = entered_tx.lock().unwrap().send(());
        let _ = released
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(30));
        json(500, j!({}))
    });
    let c = Arc::new(client_at(
        &base,
        opener(|raw| {
            let state = query(raw)["state"].clone();
            callback(raw, &[("state", &state), ("code", "synthetic")]);
            Ok(())
        }),
    ));
    let worker = c.clone();
    let done = thread::spawn(move || worker.login(&Context::background()));
    entered.recv().unwrap();
    c.cancel();
    assert_eq!(done.join().unwrap(), Err(AuthError::Cancelled));
    drop(release);
}

#[test]
fn callback_rejects_wrong_host_method_and_ambiguous_code() {
    let c = Client::new(
        TEST_ID,
        opener(|raw| {
            let q = query(raw);
            let state = q["state"].as_str();
            let cases: [&[(&str, &str)]; 5] = [
                &[("state", state), ("error", "one"), ("error", "two")],
                &[
                    ("state", state),
                    ("code", "one"),
                    ("code", "two"),
                    ("error", "denied"),
                ],
                &[("state", state), ("code", "one"), ("code", "two")],
                &[("state", state), ("code", "one"), ("error", "denied")],
                &[("state", state)],
            ];
            for values in cases {
                assert_eq!(callback(raw, values), 400, "ambiguous callback");
            }
            let redirect = url::Url::parse(&q["redirect_uri"]).unwrap();
            let base = format!("http://{}", redirect.authority());
            let target = format!("/oauth2/callback?state={state}&code=one");
            assert_eq!(
                raw_request(&base, "GET", &target, "attacker.invalid").0,
                400,
                "wrong host"
            );
            assert_eq!(
                raw_request(&base, "POST", "/oauth2/callback", redirect.authority()).0,
                400,
                "wrong method"
            );
            callback(raw, &[("state", state), ("error", "access_denied")]);
            Ok(())
        }),
    )
    .unwrap();
    assert_eq!(c.login(&Context::background()), Err(AuthError::Cancelled));
}

#[test]
fn subject_rejects_signed_control_and_unicode() {
    let c = client_at(&key_server(), ok_opener());
    let ctx = Context::background();
    let long = "a".repeat(256);
    for (name, sub) in [
        ("nul", "subject\0tail"),
        ("newline", "subject\ntail"),
        ("delete", "subject\x7ftail"),
        ("unicode", "계정-subject"),
        ("space", "subject tail"),
        ("too-long", long.as_str()),
    ] {
        let mut cl = claims("nonce");
        cl["sub"] = j!(sub);
        assert_eq!(
            c.verify(&ctx, &signed(key(), &cl, "RS256"), "nonce"),
            Err(AuthError::InvalidToken),
            "{name}"
        );
    }
    let mut cl = claims("nonce");
    cl["sub"] = j!("a".repeat(255));
    c.verify(&ctx, &signed(key(), &cl, "RS256"), "nonce")
        .unwrap();
}

// client_secret_test.go

#[test]
fn registration_secret_only_in_token_post() {
    const SECRET: &str = "synthetic-registration-credential";
    let auth = Arc::new(Mutex::new(String::new()));
    let seen = auth.clone();
    let base = serve(move |r: Request| {
        assert!(
            !r.path.contains(SECRET) && !r.headers.contains_key("authorization"),
            "credential in URL/header"
        );
        match r.path.as_str() {
            "/token" => {
                assert!(
                    r.method == "POST"
                        && r.form().get("client_secret").map(String::as_str) == Some(SECRET)
                );
                let nonce = query(&seen.lock().unwrap())["nonce"].clone();
                json(
                    200,
                    j!({"id_token": signed(key(), &claims(&nonce), "RS256")}),
                )
            }
            "/certs" => {
                assert_eq!(r.method, "GET", "invalid keys request");
                json(200, jwks(key()))
            }
            other => panic!("unexpected provider endpoint {other}"),
        }
    });
    let seen = auth.clone();
    let c = Client::with_client_secret(
        TEST_ID,
        SECRET,
        opener(move |raw| {
            assert!(
                !raw.contains(SECRET),
                "registration secret leaked to browser"
            );
            let q = query(raw);
            assert!(!q.contains_key("client_secret"));
            *seen.lock().unwrap() = raw.to_string();
            assert_eq!(
                callback(raw, &[("state", &q["state"]), ("code", "synthetic-code")]),
                200
            );
            Ok(())
        }),
    )
    .unwrap()
    .with_endpoints(endpoints(&base));
    c.login(&Context::background())
        .expect("credential-enabled login failed");
}

#[test]
fn registration_credential_validation() {
    for secret in [
        "secret\n",
        " secret",
        "secret value",
        &"x".repeat(1025),
        "비밀",
    ] {
        assert!(matches!(
            Client::with_client_secret(TEST_ID, secret, ok_opener()),
            Err(AuthError::NotConfigured)
        ));
    }
}

// backend_token_test.go

/// Backends receive bearer ID tokens with no browser nonce, so the nonce
/// claim is neither required nor checked.
#[test]
fn backend_verify_id_token_without_nonce() {
    let c = client_at(&key_server(), ok_opener());
    let ctx = Context::background();
    let mut cl = claims("browser-nonce");
    cl.as_object_mut().unwrap().remove("nonce");
    let token = signed(key(), &cl, "RS256");
    let id = c.verify_id_token(&ctx, &token).unwrap();
    assert!(
        id.issuer == "https://accounts.google.com"
            && id.subject == "synthetic-subject"
            && id.email_verified
    );
    // A nonce-less backend token must never satisfy the browser login flow.
    assert_eq!(
        c.verify(&ctx, &token, "browser-nonce"),
        Err(AuthError::InvalidToken)
    );
    // The browser flow still rejects a mismatching nonce claim.
    assert_eq!(
        c.verify(
            &ctx,
            &signed(key(), &claims("other"), "RS256"),
            "browser-nonce"
        ),
        Err(AuthError::InvalidToken)
    );
}

#[test]
fn backend_verify_id_token_rejects_wrong_aud_expired_and_forged() {
    let c = client_at(&key_server(), ok_opener());
    let ctx = Context::background();
    let mut wrong_aud = claims("");
    wrong_aud["aud"] = j!("other-client");
    let mut expired = claims("");
    expired["exp"] = j!(now() - 1);
    for (name, token) in [
        ("wrong-aud", signed(key(), &wrong_aud, "RS256")),
        ("expired", signed(key(), &expired, "RS256")),
        ("forged", signed(wrong_key(), &claims(""), "RS256")),
    ] {
        assert_eq!(
            c.verify_id_token(&ctx, &token),
            Err(AuthError::InvalidToken),
            "{name}"
        );
    }
}
