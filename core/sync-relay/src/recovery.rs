//! Optional, explicitly configured owner recovery: the relay keeps one vault
//! key sealed with an operator master key (AES-256-GCM) and releases it only to
//! the pinned Google account. Enabling it deliberately changes the trust
//! model: the server operator can decrypt this escrow.
use crate::{closing, ReqBody, empty, error, gojson, read_limited, respond, store, with_allow, Body, Relay};
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig, STANDARD};
use base64::engine::DecodePaddingMode;
use base64::Engine;
use hyper::header::AUTHORIZATION;
use hyper::{Method, Request, Response, StatusCode};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

const OWNER: &[u8] = b"owner";
const VAULT: &[u8] = b"vault";
const MAGIC: &[u8] = b"MINDBOX-SERVER-KEY-1\n";
const KEYS_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v3/certs";
pub const RECOVERY_CONFLICT: &str = "a different recovery key is already registered";

/// Fetches Google's JWKS document (raw JSON). Err means the provider failed.
pub type JwksFetch = Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Result<Vec<u8>, ()>> + Send>> + Send + Sync>;

pub struct OwnerRecovery {
    client_id: String,
    owner: String,
    key: LessSafeKey,
    aad: Vec<u8>,
    jwks: JwksFetch,
}

/// The production fetcher: HTTPS GET, 20 s timeout, no redirects, 200 only,
/// at most 1 MiB. Honors HTTPS_PROXY; trusts SSL_CERT_FILE or the system
/// bundle like Go does, falling back to the built-in web PKI roots.
pub fn google_jwks_fetcher() -> Result<JwksFetch, store::Error> {
    let mut b = reqwest::Client::builder().timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none());
    let bundle = std::env::var_os("SSL_CERT_FILE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| "/etc/ssl/certs/ca-certificates.crt".into());
    if let Ok(pem) = std::fs::read(&bundle) {
        b = b.tls_built_in_root_certs(false);
        for cert in reqwest::Certificate::from_pem_bundle(&pem)? {
            b = b.add_root_certificate(cert);
        }
    }
    let client = b.build()?;
    Ok(Arc::new(move || {
        let client = client.clone();
        Box::pin(async move {
            let mut res = client.get(KEYS_ENDPOINT).send().await.map_err(|_| ())?;
            if res.status() != reqwest::StatusCode::OK {
                return Err(());
            }
            let mut body = Vec::new();
            while let Some(chunk) = res.chunk().await.map_err(|_| ())? {
                body.extend_from_slice(&chunk);
                if body.len() > 1 << 20 {
                    return Err(());
                }
            }
            Ok(body)
        })
    }))
}

impl Relay {
    /// Must run before serving. Existing account/key bindings are never
    /// silently replaced: a different subject or master key fails.
    pub fn enable_owner_recovery(&mut self, client_id: &str, subject: &str, master: &[u8], jwks: JwksFetch) -> Result<(), store::Error> {
        if self.recovery.is_some() || subject.is_empty() || subject.len() > 255 || master.len() != 32 {
            return Err("invalid owner recovery configuration".into());
        }
        if !printable(subject) {
            return Err("invalid owner recovery subject".into());
        }
        if !valid_client_id(client_id) {
            return Err("invalid owner recovery client ID".into());
        }
        let key = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, master).map_err(|_| "invalid owner recovery encryption key")?);
        let mut aad = b"Mindbox owner recovery v1\x00https://accounts.google.com\x00".to_vec();
        aad.extend_from_slice(subject.as_bytes());
        let cfg = OwnerRecovery { client_id: client_id.into(), owner: subject.into(), key, aad, jwks };
        self.db_sync(|s| {
            s.update(|tx| {
                let owner = store::get(tx, store::RECOVERY, OWNER)?;
                if owner.as_ref().is_some_and(|o| o != cfg.owner.as_bytes()) {
                    return Err("recovery account binding differs".into());
                }
                if let Some(stored) = store::get(tx, store::RECOVERY, VAULT)? {
                    cfg.open(&stored).map_err(|_| "existing recovery key cannot be opened; preserve the database and original master key")?;
                }
                if owner.is_none() {
                    store::put(tx, store::RECOVERY, OWNER, cfg.owner.as_bytes())?;
                }
                Ok(())
            })
        })?;
        self.recovery = Some(Arc::new(cfg));
        Ok(())
    }

    /// Also used by the offline administrator command; remote callers must
    /// pass the Google check first. The DB lock blocks it while a relay runs.
    pub fn register_owner_key(&self, key: &[u8]) -> Result<(), store::Error> {
        let Some(c) = self.recovery.clone() else { return Err("invalid recovery registration".into()) };
        if key.len() != 32 {
            return Err("invalid recovery registration".into());
        }
        let key = Zeroizing::new(key.to_vec());
        self.db_sync(move |s| register(s, &c, &key))
    }
}

fn register(s: &mut store::Store, c: &OwnerRecovery, key: &[u8]) -> Result<(), store::Error> {
    s.update(|tx| {
        if let Some(stored) = store::get(tx, store::RECOVERY, VAULT)? {
            let old = c.open(&stored)?;
            if !bool::from(old.as_slice().ct_eq(key)) {
                return Err(RECOVERY_CONFLICT.into());
            }
            return Ok(());
        }
        store::put(tx, store::RECOVERY, VAULT, &c.seal(key)?)
    })
}

impl OwnerRecovery {
    fn open(&self, envelope: &[u8]) -> Result<Zeroizing<Vec<u8>>, store::Error> {
        if envelope.len() != MAGIC.len() + NONCE_LEN + 32 + AES_256_GCM.tag_len() || !envelope.starts_with(MAGIC) {
            return Err("invalid recovery envelope".into());
        }
        let nonce = Nonce::try_assume_unique_for_key(&envelope[MAGIC.len()..MAGIC.len() + NONCE_LEN]).map_err(|_| "invalid nonce")?;
        let mut data = Zeroizing::new(envelope[MAGIC.len() + NONCE_LEN..].to_vec());
        let plain = self.key.open_in_place(nonce, Aad::from(&self.aad), &mut data).map_err(|_| "cipher: message authentication failed")?;
        Ok(Zeroizing::new(plain.to_vec()))
    }

    fn seal(&self, key: &[u8]) -> Result<Vec<u8>, store::Error> {
        let mut nonce = [0u8; NONCE_LEN];
        SystemRandom::new().fill(&mut nonce).map_err(|_| "random source failed")?;
        let mut data = key.to_vec();
        self.key
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(&self.aad), &mut data)
            .map_err(|_| "seal failed")?;
        Ok([MAGIC, &nonce, &data].concat())
    }
}

#[derive(Serialize)]
struct Recovered {
    key: String,
    token: String,
}

#[derive(Serialize)]
struct Registered {
    registered: bool,
}

pub async fn serve<B: ReqBody>(r: &Relay, req: Request<B>) -> Response<Body> {
    let Some(c) = r.recovery.clone() else { return crate::not_found() };
    if req.method() != Method::GET && req.method() != Method::PUT {
        return with_allow(empty(StatusCode::METHOD_NOT_ALLOWED), "GET, PUT");
    }
    let headers: Vec<&[u8]> = req.headers().get_all(AUTHORIZATION).iter().map(|v| v.as_bytes()).collect();
    if headers.len() != 1 || !headers[0].starts_with(b"Bearer ") || headers[0].len() > (64 << 10) + 7 {
        return respond(StatusCode::UNAUTHORIZED, &error("Google authentication required"));
    }
    let Ok(subject) = verify_id_token(&c, &headers[0][7..]).await else {
        return respond(StatusCode::UNAUTHORIZED, &error("Google authentication failed"));
    };
    if subject != c.owner {
        return respond(StatusCode::FORBIDDEN, &error("recovery account differs"));
    }
    if req.method() == Method::GET {
        let c2 = c.clone();
        let key = r
            .db(move |s| {
                s.view(|tx| match store::get(tx, store::RECOVERY, VAULT)? {
                    Some(stored) => c2.open(&stored).map(Some),
                    None => Ok(None),
                })
            })
            .await;
        return match key {
            Err(_) => respond(StatusCode::INTERNAL_SERVER_ERROR, &error("recovery key unavailable")),
            Ok(None) => respond(StatusCode::NOT_FOUND, &error("no recovery key registered")),
            Ok(Some(key)) => {
                let body = Recovered { key: STANDARD.encode(&key), token: r.token.to_string() };
                respond(StatusCode::OK, &body)
            }
        };
    }
    let (buf, broken, over) = read_limited(req.into_body(), 2048).await;
    closing(register_from(r, c, &buf, broken).await, over)
}

async fn register_from(r: &Relay, c: Arc<OwnerRecovery>, buf: &[u8], broken: bool) -> Response<Body> {
    let invalid = || respond(StatusCode::BAD_REQUEST, &error("invalid recovery registration"));
    let Ok((obj, clean)) = gojson::decode_first(buf, Some(&["key"])) else { return invalid() };
    let Ok(encoded) = obj.string("key") else { return invalid() };
    if encoded.len() != 44 || !clean || broken {
        return invalid();
    }
    let key = match decode_std(&encoded) {
        Some(k) if k.len() == 32 => Zeroizing::new(k),
        _ => return respond(StatusCode::BAD_REQUEST, &error("invalid recovery key")),
    };
    match r.db(move |s| register(s, &c, &key)).await {
        Ok(()) => respond(StatusCode::OK, &Registered { registered: true }),
        Err(e) if e.to_string() == RECOVERY_CONFLICT => respond(StatusCode::CONFLICT, &error("recovery registration failed")),
        Err(_) => respond(StatusCode::INTERNAL_SERVER_ERROR, &error("recovery registration failed")),
    }
}

/// base64.StdEncoding.Strict(): canonical padding and zero trailing bits;
/// like Go it skips CR and LF.
pub fn decode_std(s: &str) -> Option<Vec<u8>> {
    STANDARD.decode(s.replace(['\r', '\n'], "")).ok()
}

/// base64.RawURLEncoding (non-strict trailing bits, no padding).
fn decode_raw_url(s: &[u8]) -> Option<Vec<u8>> {
    const RAW_URL: GeneralPurpose = GeneralPurpose::new(
        &base64::alphabet::URL_SAFE,
        GeneralPurposeConfig::new()
            .with_encode_padding(false)
            .with_decode_padding_mode(DecodePaddingMode::RequireNone)
            .with_decode_allow_trailing_bits(true),
    );
    let cleaned: Vec<u8> = s.iter().copied().filter(|b| *b != b'\r' && *b != b'\n').collect();
    RAW_URL.decode(cleaned).ok()
}

fn printable(s: &str) -> bool {
    s.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

/// `^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$`
fn valid_client_id(id: &str) -> bool {
    id.strip_suffix(".apps.googleusercontent.com")
        .is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
}

/// Verifies a Google RS256 ID token for this client (no nonce: trusted
/// backend use) and returns its subject.
async fn verify_id_token(c: &OwnerRecovery, token: &[u8]) -> Result<String, ()> {
    if token.len() > 64 << 10 {
        return Err(());
    }
    let parts: Vec<&[u8]> = token.split(|b| *b == b'.').collect();
    if parts.len() != 3 {
        return Err(());
    }
    let header = decode_raw_url(parts[0]).and_then(|b| gojson::unmarshal(&b).ok()).ok_or(())?;
    let (alg, kid, crit) = (header.string("alg")?, header.string("kid")?, header.strings("crit")?);
    if alg != "RS256" || kid.is_empty() || kid.len() > 256 || !crit.is_empty() {
        return Err(());
    }
    let signature = decode_raw_url(parts[2]).ok_or(())?;
    let claims = decode_raw_url(parts[1]).and_then(|b| gojson::unmarshal(&b).ok()).ok_or(())?;
    let subject = valid_claims(c, &claims)?;
    let (n, e) = signing_key(c, &kid).await?;
    let signed = &token[..parts[0].len() + 1 + parts[1].len()];
    ring::signature::RsaPublicKeyComponents { n: &n, e: &e }
        .verify(&ring::signature::RSA_PKCS1_2048_8192_SHA256, signed, &signature)
        .map_err(|_| ())?;
    Ok(subject)
}

fn valid_claims(c: &OwnerRecovery, claims: &gojson::Object) -> Result<String, ()> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    let (iss, sub, azp) = (claims.string("iss")?, claims.string("sub")?, claims.string("azp")?);
    let (exp, iat, nbf) = (claims.i64("exp")?, claims.i64("iat")?, claims.i64("nbf")?);
    // Remaining fields must still decode with their Go types.
    let (_, _, _, _) = (claims.string("nonce")?, claims.string("email")?, claims.bool("email_verified")?, claims.string("name")?);
    if (iss != "https://accounts.google.com" && iss != "accounts.google.com")
        || sub.is_empty()
        || sub.len() > 255
        || !printable(&sub)
        || exp <= now
        || iat <= 0
        || iat > now + 60
        || nbf > now + 60
        || exp <= iat
    {
        return Err(());
    }
    let audiences = match claims.raw("aud") {
        Some(serde_json::Value::String(a)) => vec![a.clone()],
        Some(serde_json::Value::Null) => vec![String::new()],
        Some(v) => gojson::strings(v).ok_or(())?,
        None => return Err(()),
    };
    let found = audiences.contains(&c.client_id);
    if !found || (audiences.len() > 1 && azp != c.client_id) || (!azp.is_empty() && azp != c.client_id) {
        return Err(());
    }
    Ok(sub)
}

/// The single RS256 key for kid from Google's key set (n without leading zeros, e).
async fn signing_key(c: &OwnerRecovery, kid: &str) -> Result<(Vec<u8>, Vec<u8>), ()> {
    let body = (c.jwks)().await?;
    let set = gojson::unmarshal(&body)?;
    let keys = set.objects("keys")?;
    // Every key must decode with Go's types, matching or not.
    let mut found = None;
    for k in &keys {
        let (kty, use_, alg, id, n, e) = (k.string("kty")?, k.string("use")?, k.string("alg")?, k.string("kid")?, k.string("n")?, k.string("e")?);
        if id != kid {
            continue;
        }
        if found.is_some() || kty != "RSA" || alg != "RS256" || (!use_.is_empty() && use_ != "sig") {
            return Err(());
        }
        let (n, e) = (decode_raw_url(n.as_bytes()).ok_or(())?, decode_raw_url(e.as_bytes()).ok_or(())?);
        if n.len() < 256 || n.len() > 1024 || e.is_empty() || e.len() > 4 {
            return Err(());
        }
        let exponent = e.iter().fold(0u64, |acc, b| acc * 256 + *b as u64);
        if !(3..=2147483647).contains(&exponent) || exponent % 2 == 0 {
            return Err(());
        }
        let n: Vec<u8> = n.into_iter().skip_while(|b| *b == 0).collect();
        if n.len() * 8 - (n[0].leading_zeros() as usize) < 2048 {
            return Err(());
        }
        let e: Vec<u8> = e.into_iter().skip_while(|b| *b == 0).collect();
        found = Some((n, e));
    }
    found.ok_or(())
}
