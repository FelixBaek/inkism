//! Error type shared by every sync-core operation.

use thiserror::Error;

/// Result alias used throughout the crate.
pub type Result<T> = std::result::Result<T, SyncError>;

/// Every fallible sync-core operation returns this error.
///
/// The variants are deliberately coarse so the host can map them to a small
/// number of user-visible states (no network, bad key, corrupt record, ...).
#[derive(Debug, Error)]
pub enum SyncError {
    /// Invalid configuration: bad key material, malformed server URL,
    /// or a plaintext (non-TLS) URL that is not a loopback test address.
    #[error("sync configuration error: {0}")]
    Config(String),

    /// The vault key, nonce, or authentication tag was wrong, or the
    /// ciphertext was modified in transit. The record is never trusted.
    #[error("sync crypto error: {0}")]
    Crypto(String),

    /// The local sync state database failed.
    #[error("sync database error: {0}")]
    Database(String),

    /// A transport-level failure talking to the relay.
    #[error("sync network error: {0}")]
    Network(String),

    /// The relay returned a response that violates the v1 contract.
    #[error("sync protocol error: {0}")]
    Protocol(String),

    /// An authenticated record uses a payload schema newer than this client.
    /// Keep its original bytes pending; do not resolve or acknowledge it.
    #[error("unsupported sync payload version {version} (supported through {supported})")]
    UnsupportedPayloadVersion { version: u32, supported: u32 },
}

impl From<rusqlite::Error> for SyncError {
    fn from(value: rusqlite::Error) -> Self {
        SyncError::Database(value.to_string())
    }
}

impl From<serde_json::Error> for SyncError {
    fn from(value: serde_json::Error) -> Self {
        SyncError::Protocol(value.to_string())
    }
}

impl From<reqwest::Error> for SyncError {
    fn from(value: reqwest::Error) -> Self {
        SyncError::Network(value.to_string())
    }
}
