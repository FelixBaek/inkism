//! Blocking HTTP client for the Go relay contract.
//!
//! * `POST /v1/changes` with `Authorization: Bearer <token>` and body
//!   `{"id": string, "blob": string}` returns `{"seq": u64}`. The id is a UUID
//!   and is idempotent: re-POSTing the same id and blob returns the original
//!   seq, so retries after a crash or timeout are safe.
//! * `GET /v1/changes?after=N&limit=50` returns
//!   `{"items":[{"seq","id","blob"}],"cursor":u64}`. The server bounds the
//!   response size, so clients must page until a short page arrives.
//!
//! TLS is mandatory. The only exception is a literal loopback host
//! (`localhost`, `127.0.0.1`, `[::1]`), which exists so tests can run against a
//! local plaintext relay.

use std::io::Read;
use std::time::Duration;

use serde::Deserialize;
use url::{Host, Url};

use crate::error::{Result, SyncError};

/// One record as returned by `GET /v1/changes`.
#[derive(Clone, Debug, Deserialize)]
pub struct RemoteRecord {
    /// Relay-assigned monotonically increasing sequence number.
    pub seq: u64,
    /// Idempotency id (UUID).
    pub id: String,
    /// Base64 of the encrypted change payload.
    pub blob: String,
}

#[derive(Debug, Deserialize)]
struct Page {
    items: Vec<RemoteRecord>,
    cursor: u64,
}

/// A page of remote records plus the cursor to resume from.
#[derive(Clone, Debug)]
pub struct ChangePage {
    /// Records strictly after the requested `after` cursor.
    pub items: Vec<RemoteRecord>,
    /// Cursor to pass as `after` on the next request.
    pub cursor: u64,
}

/// Blocking relay client. Cheap to clone-by-reference; hold one per engine.
#[derive(Debug)]
pub struct RelayClient {
    http: reqwest::blocking::Client,
    base: Url,
    token: String,
}

impl RelayClient {
    /// Build a client, enforcing the TLS rule.
    ///
    /// `server_url` is the relay base URL (for example `https://relay.example`).
    /// A plaintext URL is accepted only when its host is exactly `localhost`,
    /// `127.0.0.1`, or `::1`.
    pub fn new(server_url: &str, token: &str) -> Result<Self> {
        let url = Url::parse(server_url)
            .map_err(|err| SyncError::Config(format!("invalid relay URL: {err}")))?;
        match url.scheme() {
            "https" => {}
            "http" => {
                if !is_loopback(&url) {
                    return Err(SyncError::Config(format!(
                        "refusing plaintext relay URL {url}: TLS is required except for loopback"
                    )));
                }
            }
            other => {
                return Err(SyncError::Config(format!(
                    "unsupported relay scheme {other:?}; use https"
                )));
            }
        }
        let http = reqwest::blocking::Client::builder()
            .use_rustls_tls()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(SyncError::from)?;
        Ok(RelayClient {
            http,
            base: url,
            token: token.to_string(),
        })
    }

    fn endpoint(&self, path: &str) -> Result<Url> {
        self.base
            .join(path)
            .map_err(|err| SyncError::Config(format!("invalid relay endpoint: {err}")))
    }

    /// Upload an immutable ciphertext chunk. Exact retries are safe.
    pub(crate) fn put_attachment_blob(&self, id: &str, bytes: &[u8]) -> Result<()> {
        crate::attachment::validate_blob_id(id)?;
        if !(40..=crate::attachment::MAX_SEALED_CHUNK_BYTES).contains(&bytes.len()) {
            return Err(SyncError::Protocol("invalid sealed attachment size".into()));
        }
        let response = self
            .http
            .put(self.endpoint(&format!("/v1/blobs/{id}"))?)
            .bearer_auth(&self.token)
            .header("Content-Type", "application/octet-stream")
            .body(bytes.to_vec())
            .send()?;
        if response.status() != reqwest::StatusCode::OK
            && response.status() != reqwest::StatusCode::CREATED
        {
            return Err(SyncError::Network(format!(
                "attachment upload rejected ({})",
                response.status()
            )));
        }
        Ok(())
    }

    pub(crate) fn get_attachment_blob(&self, id: &str) -> Result<Option<Vec<u8>>> {
        crate::attachment::validate_blob_id(id)?;
        let response = self
            .http
            .get(self.endpoint(&format!("/v1/blobs/{id}"))?)
            .bearer_auth(&self.token)
            .send()?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if response.status() != reqwest::StatusCode::OK {
            return Err(SyncError::Network(format!(
                "attachment download rejected ({})",
                response.status()
            )));
        }
        let limit = crate::attachment::MAX_SEALED_CHUNK_BYTES;
        if response.content_length().is_some_and(|n| n > limit as u64) {
            return Err(SyncError::Protocol("oversized attachment response".into()));
        }
        let mut bytes = Vec::new();
        response
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| SyncError::Network(format!("attachment read failed: {e}")))?;
        if !(40..=limit).contains(&bytes.len()) {
            return Err(SyncError::Protocol(
                "invalid attachment response size".into(),
            ));
        }
        Ok(Some(bytes))
    }

    /// `POST /v1/changes`. Idempotent by `id`; returns the relay sequence.
    pub fn post_change(&self, id: &str, blob: &str) -> Result<u64> {
        #[derive(serde::Serialize)]
        struct Body<'a> {
            id: &'a str,
            blob: &'a str,
        }
        #[derive(Deserialize)]
        struct Ack {
            seq: u64,
        }
        let url = self.endpoint("/v1/changes")?;
        let response = self
            .http
            .post(url)
            .bearer_auth(&self.token)
            .json(&Body { id, blob })
            .send()
            .map_err(SyncError::from)?;
        let status = response.status();
        if !status.is_success() {
            let mut detail = String::new();
            let _ = response.take(4096).read_to_string(&mut detail);
            return Err(SyncError::Network(format!(
                "relay rejected change ({status}): {detail}"
            )));
        }
        let ack: Ack = serde_json::from_reader(response.take(4096))?;
        Ok(ack.seq)
    }

    /// `GET /v1/changes?after=N&limit=L`.
    pub fn get_changes(&self, after: u64, limit: u32) -> Result<ChangePage> {
        let mut url = self.endpoint("/v1/changes")?;
        url.query_pairs_mut()
            .append_pair("after", &after.to_string())
            .append_pair("limit", &limit.to_string());
        let response = self
            .http
            .get(url)
            .bearer_auth(&self.token)
            .send()
            .map_err(SyncError::from)?;
        let status = response.status();
        if !status.is_success() {
            let mut detail = String::new();
            let _ = response.take(4096).read_to_string(&mut detail);
            return Err(SyncError::Network(format!(
                "relay rejected pull ({status}): {detail}"
            )));
        }
        // serde_json reads a `Read` one byte at a time; unbuffered, every
        // byte of a multi-megabyte page was a separate blocking body poll.
        let page: Page = serde_json::from_reader(std::io::BufReader::with_capacity(
            256 << 10,
            response.take(48 << 20),
        ))?;
        Ok(ChangePage {
            items: page.items,
            cursor: page.cursor,
        })
    }
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain("localhost")) => true,
        Some(Host::Ipv4(addr)) => addr.is_loopback(),
        Some(Host::Ipv6(addr)) => addr.is_loopback(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_plaintext_non_loopback() {
        let err = RelayClient::new("http://relay.example.com", "x").unwrap_err();
        assert!(matches!(err, SyncError::Config(_)));
    }

    #[test]
    fn accepts_loopback_plaintext_for_tests() {
        assert!(RelayClient::new("http://127.0.0.1:1234", "x").is_ok());
        assert!(RelayClient::new("http://localhost:1234", "x").is_ok());
        assert!(RelayClient::new("http://[::1]:1234", "x").is_ok());
    }

    #[test]
    fn accepts_https() {
        assert!(RelayClient::new("https://relay.example.com", "x").is_ok());
    }
}
