//! Ephemeral Google desktop OIDC login. Tokens are never persisted or returned
//! to the renderer. Trusted host callers may consume an ephemeral ID token for
//! explicitly enabled server recovery.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine as _;
use ring::rand::SecureRandom as _;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use url::form_urlencoded;

use crate::Context;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AuthError {
    #[error("Google desktop client ID is not configured")]
    NotConfigured,
    #[error("Google login is already in progress")]
    Busy,
    #[error("Google login was cancelled")]
    Cancelled,
    #[error("Google identity could not be verified")]
    InvalidToken,
    #[error("Google login provider request failed")]
    Provider,
    #[error("system browser could not be opened")]
    Browser,
    #[error("Google callback listener unavailable")]
    Listener,
    #[error("secure random source unavailable")]
    Random,
}

pub const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const KEYS_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUER: &str = "https://accounts.google.com";

/// Provider URLs. Production uses `Default`; tests point them at local mocks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub auth: String,
    pub token: String,
    pub keys: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            auth: AUTH_ENDPOINT.into(),
            token: TOKEN_ENDPOINT.into(),
            keys: KEYS_ENDPOINT.into(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Identity {
    pub issuer: String,
    pub subject: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub email: String,
    pub email_verified: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub name: String,
}

pub type BrowserOpener = Box<dyn Fn(&str) -> Result<(), crate::BoxError> + Send + Sync>;

pub struct Client {
    id: String,
    secret: String,
    open: BrowserOpener,
    http: reqwest::blocking::Client,
    endpoints: Endpoints,
    active: Mutex<Option<Context>>,
    timeout: Duration,
}

impl Client {
    pub fn new(client_id: &str, open_browser: BrowserOpener) -> Result<Self, AuthError> {
        Self::with_client_secret(client_id, "", open_browser)
    }

    /// Accepts a locally protected registration credential. It is sent only
    /// to the token endpoint, never to the browser or renderer.
    pub fn with_client_secret(
        client_id: &str,
        client_secret: &str,
        open_browser: BrowserOpener,
    ) -> Result<Self, AuthError> {
        if !valid_client_id(client_id)
            || client_secret.len() > 1024
            || !client_secret.bytes().all(|b| (0x21..=0x7e).contains(&b))
        {
            return Err(AuthError::NotConfigured);
        }
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| AuthError::Provider)?;
        Ok(Self {
            id: client_id.into(),
            secret: client_secret.into(),
            open: open_browser,
            http,
            endpoints: Endpoints::default(),
            active: Mutex::new(None),
            timeout: Duration::from_secs(180),
        })
    }

    pub fn with_endpoints(mut self, endpoints: Endpoints) -> Self {
        self.endpoints = endpoints;
        self
    }

    /// Bounds a whole browser login (default three minutes).
    pub fn with_login_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn client_id(&self) -> &str {
        &self.id
    }

    /// Cancels the login in progress, if any.
    pub fn cancel(&self) {
        if let Some(ctx) = self.active.lock().unwrap().as_ref() {
            ctx.cancel();
        }
    }

    pub fn login(&self, parent: &Context) -> Result<Identity, AuthError> {
        self.login_with_id_token(parent)
            .map(|(identity, _)| identity)
    }

    /// Host-only. The token must not enter RPC responses, policy files, logs
    /// or command lines; discard it after the recovery request.
    pub fn login_with_id_token(&self, parent: &Context) -> Result<(Identity, String), AuthError> {
        let ctx = {
            let mut active = self.active.lock().unwrap();
            if active.is_some() {
                return Err(AuthError::Busy);
            }
            let ctx = parent.with_timeout(self.timeout);
            *active = Some(ctx.clone());
            ctx
        };
        let result = self.run_login(&ctx);
        ctx.cancel();
        *self.active.lock().unwrap() = None;
        result
    }

    fn run_login(&self, ctx: &Context) -> Result<(Identity, String), AuthError> {
        if ctx.is_done() {
            return Err(AuthError::Cancelled);
        }
        let (state, nonce, verifier) = (random()?, random()?, random()?);
        let (server, result) = CallbackServer::start(state)?;
        let redirect = format!("http://{}/oauth2/callback", server.addr);
        let challenge = B64URL.encode(ring::digest::digest(
            &ring::digest::SHA256,
            verifier.as_bytes(),
        ));
        let query = form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &self.id)
            .append_pair("redirect_uri", &redirect)
            .append_pair("response_type", "code")
            .append_pair("scope", "openid")
            .append_pair("state", &server.state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("access_type", "online")
            .append_pair("prompt", "select_account")
            .finish();
        if (self.open)(&format!("{}?{}", self.endpoints.auth, query)).is_err() {
            return Err(AuthError::Browser);
        }
        let callback = ctx.recv(&result).ok_or(AuthError::Cancelled)?;
        drop(server);
        let code = match callback {
            Callback::Code(code) if !ctx.is_done() => code,
            _ => return Err(AuthError::Cancelled),
        };
        let mut form = form_urlencoded::Serializer::new(String::new());
        form.append_pair("client_id", &self.id)
            .append_pair("code", &code)
            .append_pair("redirect_uri", &redirect)
            .append_pair("grant_type", "authorization_code")
            .append_pair("code_verifier", &verifier);
        if !self.secret.is_empty() {
            form.append_pair("client_secret", &self.secret);
        }
        let request = self
            .http
            .post(&self.endpoints.token)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(form.finish());
        #[derive(Deserialize)]
        struct TokenResponse {
            #[serde(default)]
            id_token: String,
        }
        let response: TokenResponse = self.request(ctx, request)?;
        let identity = self.verify(ctx, &response.id_token, &nonce);
        if ctx.is_done() {
            return Err(AuthError::Cancelled);
        }
        Ok((identity?, response.id_token))
    }

    /// Bounded provider request: no redirects, status 200, at most 1 MiB of
    /// JSON. Provider error bodies never reach the caller.
    pub(crate) fn request<T: DeserializeOwned + Send + 'static>(
        &self,
        ctx: &Context,
        request: reqwest::blocking::RequestBuilder,
    ) -> Result<T, AuthError> {
        const LIMIT: u64 = 1 << 20;
        let result = ctx.run(move || {
            let response = request.send().map_err(|_| AuthError::Provider)?;
            if response.status() != reqwest::StatusCode::OK {
                return Err(AuthError::Provider);
            }
            let mut body = Vec::new();
            response
                .take(LIMIT + 1)
                .read_to_end(&mut body)
                .map_err(|_| AuthError::Provider)?;
            if body.len() as u64 > LIMIT {
                return Err(AuthError::Provider);
            }
            serde_json::from_slice(&body).map_err(|_| AuthError::Provider)
        });
        result.unwrap_or(Err(AuthError::Cancelled))
    }

    fn verify(&self, ctx: &Context, token: &str, nonce: &str) -> Result<Identity, AuthError> {
        self.verify_token(ctx, token, Some(nonce))
    }

    /// Authenticates a bearer ID token received by a trusted HTTPS backend.
    /// Browser login still requires its independently generated nonce. The
    /// returned subject is verified; caller-supplied IDs are not identities.
    pub fn verify_id_token(&self, ctx: &Context, token: &str) -> Result<Identity, AuthError> {
        self.verify_token(ctx, token, None)
    }

    fn verify_token(
        &self,
        ctx: &Context,
        token: &str,
        nonce: Option<&str>,
    ) -> Result<Identity, AuthError> {
        use AuthError::InvalidToken;
        if token.len() > 64 << 10 {
            return Err(InvalidToken);
        }
        let parts: Vec<&str> = token.split('.').collect();
        let [head, body, sig] = parts[..] else {
            return Err(InvalidToken);
        };
        let header: Header = decode_part(head).ok_or(InvalidToken)?;
        if header.alg != "RS256"
            || header.kid.is_empty()
            || header.kid.len() > 256
            || !header.crit.is_empty()
        {
            return Err(InvalidToken);
        }
        let signature = B64URL.decode(sig).map_err(|_| InvalidToken)?;
        let claims: Claims = decode_part(body).ok_or(InvalidToken)?;
        if !self.valid_claims(&claims, nonce) {
            return Err(InvalidToken);
        }
        let key = self.signing_key(ctx, &header.kid)?;
        key.verify(
            &ring::signature::RSA_PKCS1_2048_8192_SHA256,
            format!("{head}.{body}").as_bytes(),
            &signature,
        )
        .map_err(|_| InvalidToken)?;
        Ok(Identity {
            issuer: ISSUER.into(),
            subject: claims.sub,
            email: claims.email,
            email_verified: claims.email_verified,
            name: claims.name,
        })
    }

    /// Checks issuer, subject, timing, nonce and audience.
    fn valid_claims(&self, c: &Claims, nonce: Option<&str>) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        if (c.iss != ISSUER && c.iss != "accounts.google.com")
            || !valid_subject(&c.sub)
            || c.exp <= now
            || c.iat <= 0
            || c.iat > now + 60
            || c.nbf > now + 60
            || c.exp <= c.iat
        {
            return false;
        }
        if nonce.is_some_and(|n| !constant_time_eq(c.nonce.as_bytes(), n.as_bytes())) {
            return false;
        }
        let audiences: Vec<String> = match &c.aud {
            Some(serde_json::Value::String(a)) => vec![a.clone()],
            Some(v @ serde_json::Value::Array(_)) => match serde_json::from_value(v.clone()) {
                Ok(list) => list,
                Err(_) => return false,
            },
            _ => return false,
        };
        audiences.contains(&self.id)
            && !(audiences.len() > 1 && c.azp != self.id)
            && !(!c.azp.is_empty() && c.azp != self.id)
    }

    /// Fetches the provider keys and returns the single RS256 key for `kid`.
    /// Malformed or ambiguous keys yield `InvalidToken`.
    fn signing_key(
        &self,
        ctx: &Context,
        kid: &str,
    ) -> Result<ring::signature::RsaPublicKeyComponents<Vec<u8>>, AuthError> {
        #[derive(Deserialize)]
        struct Keys {
            #[serde(default)]
            keys: Vec<JsonWebKey>,
        }
        let keys: Keys = self.request(ctx, self.http.get(&self.endpoints.keys))?;
        let mut found = None;
        for k in keys.keys.iter().filter(|k| k.kid == kid) {
            if found.is_some() {
                return Err(AuthError::InvalidToken);
            }
            found = Some(rsa_key(k).ok_or(AuthError::InvalidToken)?);
        }
        found.ok_or(AuthError::InvalidToken)
    }
}

#[derive(Deserialize)]
struct Header {
    #[serde(default)]
    alg: String,
    #[serde(default)]
    kid: String,
    #[serde(default)]
    crit: Vec<String>,
}

#[derive(Deserialize)]
#[serde(default)]
#[derive(Default)]
struct Claims {
    iss: String,
    sub: String,
    aud: Option<serde_json::Value>,
    azp: String,
    exp: i64,
    iat: i64,
    nbf: i64,
    nonce: String,
    email: String,
    email_verified: bool,
    name: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct JsonWebKey {
    kty: String,
    #[serde(rename = "use")]
    use_: String,
    alg: String,
    kid: String,
    n: String,
    e: String,
}

fn decode_part<T: DeserializeOwned>(part: &str) -> Option<T> {
    serde_json::from_slice(&B64URL.decode(part).ok()?).ok()
}

fn rsa_key(k: &JsonWebKey) -> Option<ring::signature::RsaPublicKeyComponents<Vec<u8>>> {
    if k.kty != "RSA" || k.alg != "RS256" || !(k.use_.is_empty() || k.use_ == "sig") {
        return None;
    }
    let n = B64URL.decode(&k.n).ok()?;
    let e = B64URL.decode(&k.e).ok()?;
    if n.len() < 256 || n.len() > 1024 || e.is_empty() || e.len() > 4 {
        return None;
    }
    let exponent = e.iter().fold(0u64, |acc, b| acc * 256 + u64::from(*b));
    if !(3..=2147483647).contains(&exponent) || exponent % 2 == 0 {
        return None;
    }
    let first = n.iter().position(|b| *b != 0)?;
    let bits = (n.len() - first) * 8 - n[first].leading_zeros() as usize;
    (bits >= 2048).then_some(ring::signature::RsaPublicKeyComponents { n, e })
}

/// Google subject identifiers are nonempty printable ASCII, at most 255 bytes.
pub fn valid_subject(subject: &str) -> bool {
    !subject.is_empty()
        && subject.len() <= 255
        && subject.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

/// `^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$`
fn valid_client_id(id: &str) -> bool {
    id.strip_suffix(".apps.googleusercontent.com")
        .is_some_and(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
}

pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn random() -> Result<String, AuthError> {
    let mut b = [0u8; 32];
    ring::rand::SystemRandom::new()
        .fill(&mut b)
        .map_err(|_| AuthError::Random)?;
    Ok(B64URL.encode(b))
}

enum Callback {
    Code(String),
    Denied,
}

/// Loopback redirect listener. It accepts exactly one well-formed redirect
/// for `state` and closes when dropped.
struct CallbackServer {
    addr: SocketAddr,
    state: String,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl CallbackServer {
    fn start(state: String) -> Result<(Self, mpsc::Receiver<Callback>), AuthError> {
        let listener =
            TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| AuthError::Listener)?;
        let addr = listener.local_addr().map_err(|_| AuthError::Listener)?;
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::sync_channel(1);
        let (host, expected, stopped) = (addr.to_string(), state.clone(), stop.clone());
        let thread = thread::spawn(move || {
            let mut sender = Some(tx);
            for stream in listener.incoming() {
                if stopped.load(Ordering::SeqCst) {
                    break;
                }
                // ponytail: one connection at a time; loopback-only, 5 s bound.
                if let Ok(stream) = stream {
                    serve_callback(stream, &host, &expected, &mut sender);
                }
            }
        });
        Ok((
            Self {
                addr,
                state,
                stop,
                thread: Some(thread),
            },
            rx,
        ))
    }
}

impl Drop for CallbackServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect_timeout(&self.addr, Duration::from_secs(1));
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

const INVALID_CALLBACK: (u16, &str) = (400, "Invalid callback\n");

fn serve_callback(
    mut stream: TcpStream,
    host: &str,
    state: &str,
    sender: &mut Option<mpsc::SyncSender<Callback>>,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let Some(head) = read_head(&mut stream) else {
        return;
    };
    let (status, body) = route_callback(&head, host, state, sender);
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Conflict",
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\
         Content-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\n\
         X-Content-Type-Options: nosniff\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    );
}

/// Reads the request head (at most 16 KiB).
fn read_head(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut head = Vec::new();
    let mut buf = [0u8; 2048];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        if head.len() > 16 << 10 {
            return None;
        }
        let n = stream.read(&mut buf).ok().filter(|n| *n > 0)?;
        head.extend_from_slice(&buf[..n]);
    }
    Some(head)
}

fn route_callback(
    head: &[u8],
    host: &str,
    state: &str,
    sender: &mut Option<mpsc::SyncSender<Callback>>,
) -> (u16, &'static str) {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut req = httparse::Request::new(&mut headers);
    if !matches!(req.parse(head), Ok(httparse::Status::Complete(_))) {
        return INVALID_CALLBACK;
    }
    let target = req.path.unwrap_or_default();
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let hosts: Vec<&[u8]> = req
        .headers
        .iter()
        .filter(|h| h.name.eq_ignore_ascii_case("host"))
        .map(|h| h.value)
        .collect();
    if req.method != Some("GET")
        || path != "/oauth2/callback"
        || hosts != [host.as_bytes()]
        || query.len() > 8192
    {
        return INVALID_CALLBACK;
    }
    let pairs: Vec<(String, String)> = form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    let values = |key: &str| {
        pairs
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
            .collect::<Vec<_>>()
    };
    let (states, codes, errors) = (values("state"), values("code"), values("error"));
    if states.len() != 1 || !constant_time_eq(states[0].as_bytes(), state.as_bytes()) {
        return INVALID_CALLBACK;
    }
    // Exactly one nonempty code or error.
    let callback = match (&codes[..], &errors[..]) {
        ([code], []) if !code.is_empty() => Callback::Code((*code).to_string()),
        ([], [error]) if !error.is_empty() => Callback::Denied,
        _ => return INVALID_CALLBACK,
    };
    match sender.take() {
        Some(tx) => {
            let _ = tx.try_send(callback);
            (
                200,
                "Inkism received the sign-in response. You can close this tab.",
            )
        }
        None => (409, "Callback already consumed\n"),
    }
}

#[cfg(test)]
mod tests;
