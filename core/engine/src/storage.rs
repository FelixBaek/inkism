//! Shared encrypted connection boundary used by storage and sync.
use crate::error::{EngineError, Result};
pub use inkism_storage::StorageKey;
use rusqlite::Connection;
use std::path::Path;
pub(crate) fn open(path: &Path, key: Option<&StorageKey>) -> Result<Connection> {
    inkism_storage::open(path, key).map_err(|e| EngineError::internal(e.to_string()))
}
pub(crate) fn attach_search(conn: &Connection, path: &str, key: Option<&StorageKey>) -> Result<()> {
    inkism_storage::attach(conn, path, "searchidx", key)
        .map_err(|e| EngineError::internal(e.to_string()))
}
