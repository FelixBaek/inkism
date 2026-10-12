//! Runtime error type. Every protocol failure is mapped to a string envelope
//! by `AppCore::execute`; startup/config failures are returned from
//! `AppCore::open` so a broken vault configuration is never silently ignored.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum RuntimeError {
    /// Bad runtime/sync configuration (missing key, wrong key length, no
    /// migration flag when the vault URL/key changes, ...).
    #[error("runtime config: {0}")]
    Config(String),
    /// The storage engine failed to open or run.
    #[error("storage engine: {0}")]
    Engine(String),
    /// The sync core reported an error while staging/applying.
    #[error("sync: {0}")]
    Sync(String),
    /// Filesystem failure reading/writing config or the sync state DB.
    #[error("io: {0}")]
    Io(String),
    /// A remote change needs a vault key this device has not unlocked (the
    /// note id). The record stays pending and is retried after unlock; it is
    /// reported as `vault_key_required` in sync status, not as an error.
    #[error("vault key required for note {0}")]
    VaultKeyRequired(String),
    /// Internal invariant violation (should never reach the UI).
    #[error("internal: {0}")]
    Internal(String),
}

impl RuntimeError {
    pub fn config(msg: impl Into<String>) -> Self {
        RuntimeError::Config(msg.into())
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        RuntimeError::Internal(msg.into())
    }
}

impl From<inkism_engine::EngineError> for RuntimeError {
    fn from(value: inkism_engine::EngineError) -> Self {
        RuntimeError::Engine(value.to_string())
    }
}

impl From<sync_core::SyncError> for RuntimeError {
    fn from(value: sync_core::SyncError) -> Self {
        RuntimeError::Sync(value.to_string())
    }
}

impl From<rusqlite::Error> for RuntimeError {
    fn from(value: rusqlite::Error) -> Self {
        RuntimeError::Engine(format!("sqlite: {value}"))
    }
}

impl From<serde_json::Error> for RuntimeError {
    fn from(value: serde_json::Error) -> Self {
        RuntimeError::Internal(format!("json: {value}"))
    }
}

impl From<std::io::Error> for RuntimeError {
    fn from(value: std::io::Error) -> Self {
        RuntimeError::Io(value.to_string())
    }
}

pub type Result<T> = std::result::Result<T, RuntimeError>;
