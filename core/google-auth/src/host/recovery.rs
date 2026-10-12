//! Opt-in server escrow of the sync recovery key. The opt-in belongs to one
//! library, not every library on the PC, and holds no key, relay token or
//! Google credential.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::store::{bounded_file, strict_json};
use super::{Caller, HostError};
use crate::Context;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryFile {
    server_url: String,
    confirmed_server_recovery: bool,
}

pub struct ServerRecovery {
    server_url: String,
    confirmed: bool,
    http: reqwest::blocking::Client,
}

fn fail(message: &'static str) -> HostError {
    HostError::Failed(message)
}

/// Reads `server-recovery.json` next to `database`. `Ok(None)` when absent.
pub fn read_server_recovery(database: &Path) -> Result<Option<ServerRecovery>, HostError> {
    let path = database
        .parent()
        .unwrap_or(Path::new(""))
        .join("server-recovery.json");
    let raw = match bounded_file(&path, 8192) {
        Err(HostError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(fail("서버 복구 설정을 읽지 못했습니다")),
        Ok(raw) => raw,
    };
    let cfg: RecoveryFile = match strict_json(&raw) {
        Some(
            cfg @ RecoveryFile {
                confirmed_server_recovery: true,
                ..
            },
        ) => cfg,
        _ => return Err(fail("서버 키 보관 승인이 필요합니다")),
    };
    if !valid_server_url(&cfg.server_url) {
        return Err(fail("서버 복구 주소는 HTTPS 서버 주소여야 합니다"));
    }
    ServerRecovery::new(cfg.server_url, true).map(Some)
}

/// An `https://host[:port]` origin: no credentials, path, query or fragment.
fn valid_server_url(raw: &str) -> bool {
    url::Url::parse(raw).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| !h.is_empty())
            && u.username().is_empty()
            && u.password().is_none()
            && u.path() == "/"
            && !raw.ends_with('/')
            && u.query().is_none()
            && u.fragment().is_none()
    })
}

/// Sends one engine RPC and returns `data` from an `{"ok":true}` response.
fn recovery_call<T: DeserializeOwned>(
    ctx: &Context,
    engine: &dyn Caller,
    request: Value,
) -> Result<T, HostError> {
    let raw = Zeroizing::new(
        serde_json::to_vec(&request).map_err(|_| fail("복구 요청을 준비하지 못했습니다"))?,
    );
    let response = Zeroizing::new(
        engine
            .call(ctx, &raw)
            .map_err(|_| fail("복구 저장 엔진에 연결하지 못했습니다"))?,
    );
    #[derive(Deserialize)]
    struct Envelope {
        #[serde(default)]
        ok: bool,
        #[serde(default)]
        data: Value,
    }
    let envelope: Envelope = serde_json::from_slice(&response)
        .ok()
        .filter(|e: &Envelope| e.ok)
        .ok_or(fail("기존 저장소를 보존하기 위해 복구 연결을 중단했습니다"))?;
    serde_json::from_value(envelope.data).map_err(|_| fail("복구 저장 엔진 응답을 읽지 못했습니다"))
}

impl ServerRecovery {
    fn new(server_url: String, confirmed: bool) -> Result<Self, HostError> {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| fail("복구 서버 요청을 준비하지 못했습니다"))?;
        Ok(Self {
            server_url,
            confirmed,
            http,
        })
    }

    pub fn server_url(&self) -> &str {
        &self.server_url
    }

    /// Runs only after verified account binding and engine resume, while
    /// renderer data paths stay closed. Existing local vaults stay usable when
    /// escrow is unavailable (returns a warning); new-device restore must
    /// succeed first.
    pub fn connect(
        &self,
        ctx: &Context,
        id_token: &str,
        engine: &dyn Caller,
    ) -> Result<String, HostError> {
        if !self.confirmed || id_token.is_empty() {
            return Err(fail("인증된 서버 복구 승인이 필요합니다"));
        }
        #[derive(Deserialize)]
        struct Status {
            #[serde(default)]
            configured: bool,
            #[serde(default)]
            server_url: String,
        }
        let status: Status = recovery_call(ctx, engine, json!({"op": "sync_status"}))?;
        if status.configured {
            let warning = "로컬 노트는 열렸지만 서버 복구 키 보관을 확인하지 못했습니다";
            if status.server_url != self.server_url {
                return Ok("기존 동기화 서버와 복구 서버가 달라 키를 보내지 않았습니다".into());
            }
            #[derive(Deserialize)]
            struct Exported {
                #[serde(default)]
                key: String,
            }
            let request = json!({"op": "sync_recovery_export", "server_url": self.server_url, "confirmed_server_recovery": true});
            let Ok(vault) = recovery_call::<Exported>(ctx, engine, request) else {
                return Ok(warning.into());
            };
            let key = Zeroizing::new(vault.key);
            let registered = self.request(
                ctx,
                reqwest::Method::PUT,
                id_token,
                Some(json!({"key": *key})),
            );
            return Ok(if registered.is_ok() {
                String::new()
            } else {
                warning.into()
            });
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Vault {
            #[serde(default)]
            key: String,
            #[serde(default)]
            token: String,
        }
        let body = self
            .request(ctx, reqwest::Method::GET, id_token, None)
            .map_err(|_| fail("서버에 보관된 복구 키를 가져오지 못했습니다"))?;
        let vault: Vault =
            strict_json(&body).ok_or(fail("서버에 보관된 복구 키를 가져오지 못했습니다"))?;
        let (key, token) = (Zeroizing::new(vault.key), Zeroizing::new(vault.token));
        let decoded = Zeroizing::new(STANDARD.decode(key.as_bytes()).unwrap_or_default());
        if decoded.len() != 32 || token.len() < 32 || token.len() > 4096 {
            return Err(fail("서버 복구 키 형식이 올바르지 않습니다"));
        }
        let request = json!({"op": "sync_recovery_import", "server_url": self.server_url, "key": *key, "token": *token, "confirmed_server_recovery": true});
        recovery_call::<Value>(ctx, engine, request).map(|_| String::new())
    }

    /// Calls `/v1/recovery/key`. A PUT must answer `{"registered":true}`; a
    /// GET returns its (at most 8 KiB) body for the caller to parse.
    fn request(
        &self,
        ctx: &Context,
        method: reqwest::Method,
        token: &str,
        body: Option<Value>,
    ) -> Result<Zeroizing<Vec<u8>>, HostError> {
        let is_put = body.is_some();
        let raw = body.map(|b| b.to_string()).unwrap_or_default();
        let request = self
            .http
            .request(method, format!("{}/v1/recovery/key", self.server_url))
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .body(raw);
        let data = ctx
            .run(move || -> Result<Zeroizing<Vec<u8>>, HostError> {
                let response = request
                    .send()
                    .map_err(|_| fail("복구 서버에 연결하지 못했습니다"))?;
                if response.status() != reqwest::StatusCode::OK {
                    return Err(fail("복구 서버가 요청을 승인하지 않았습니다"));
                }
                let mut data = Zeroizing::new(Vec::new());
                response
                    .take(8193)
                    .read_to_end(&mut data)
                    .ok()
                    .filter(|_| data.len() <= 8192)
                    .ok_or(fail("복구 서버 응답을 읽지 못했습니다"))?;
                Ok(data)
            })
            .unwrap_or(Err(HostError::Cancelled))?;
        if is_put {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Registered {
                registered: bool,
            }
            if !strict_json::<Registered>(&data).is_some_and(|r| r.registered) {
                return Err(fail("복구 키 보관을 확인하지 못했습니다"));
            }
        }
        Ok(data)
    }
}

#[cfg(test)]
impl ServerRecovery {
    pub(crate) fn for_test(server_url: &str) -> Self {
        Self::new(server_url.into(), true).unwrap()
    }
}
