//! One local storage policy for every database used by a runtime instance.
use crate::Result;
pub use inkism_engine::storage::StorageKey;
use inkism_engine::{attachments::AttachmentStore, Engine};
use std::path::Path;
use sync_core::{attachment_queue::AttachmentQueue, Key, SyncConfig, SyncEngine};

#[derive(Clone, Default)]
pub struct LocalStorage {
    #[cfg(feature = "encrypted-storage")]
    key: Option<StorageKey>,
}
impl LocalStorage {
    pub fn is_encrypted(&self) -> bool {
        #[cfg(feature = "encrypted-storage")]
        {
            self.key.is_some()
        }
        #[cfg(not(feature = "encrypted-storage"))]
        {
            false
        }
    }

    #[cfg(feature = "encrypted-storage")]
    pub fn encrypted(key: StorageKey) -> Self {
        Self { key: Some(key) }
    }
    pub(crate) fn readonly(&self, path: &Path) -> Result<rusqlite::Connection> {
        #[cfg(feature = "encrypted-storage")]
        let key = self.key.as_ref();
        #[cfg(not(feature = "encrypted-storage"))]
        let key = None;
        inkism_storage::open_readonly(path, key)
            .map_err(|e| crate::RuntimeError::Engine(e.to_string()))
    }
    pub(crate) fn engine(&self, path: &str) -> Result<Engine> {
        #[cfg(feature = "encrypted-storage")]
        if let Some(key) = &self.key {
            return Ok(Engine::open_encrypted(path, key.clone())?);
        }
        Ok(Engine::open(path)?)
    }
    pub(crate) fn sync(&self, config: SyncConfig) -> Result<SyncEngine> {
        #[cfg(feature = "encrypted-storage")]
        if let Some(key) = &self.key {
            return Ok(SyncEngine::open_encrypted(config, key)?);
        }
        Ok(SyncEngine::open(config)?)
    }
    pub(crate) fn validate_sync_state(&self, path: &str) -> Result<()> {
        let conn = self.readonly(Path::new(path))?;
        let device: String =
            conn.query_row("SELECT value FROM meta WHERE key='device_id'", [], |r| {
                r.get(0)
            })?;
        if uuid::Uuid::parse_str(&device).is_err() {
            return Err(crate::RuntimeError::config(
                "동기화 기록 파일이 올바르지 않습니다. 기존 파일을 보존해 주세요.",
            ));
        }
        Ok(())
    }
    /// Open attachment I/O without starting a note engine or network worker.
    pub fn attachments(&self, path: &Path) -> Result<AttachmentStore> {
        #[cfg(feature = "encrypted-storage")]
        if let Some(key) = &self.key {
            return Ok(AttachmentStore::open_encrypted(path, key)?);
        }
        Ok(AttachmentStore::open(path)?)
    }
    pub(crate) fn queue(&self, path: &Path, key: Key, relay: &str) -> Result<AttachmentQueue> {
        #[cfg(feature = "encrypted-storage")]
        if let Some(local) = &self.key {
            return Ok(AttachmentQueue::open_encrypted(path, key, relay, local)?);
        }
        Ok(AttachmentQueue::open(path, key, relay)?)
    }
}
