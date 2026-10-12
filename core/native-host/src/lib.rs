//! In-process host for mobile platforms where spawning the engine is unavailable.
//! Uses the same AppCore, SQLite library, sync worker and attachment store as desktop.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use inkism_runtime::local_key;
use inkism_runtime::{local_storage::LocalStorage, AppCore};
use local_api::engine::{AttachmentMetadata, Attachments, Engine};
use local_api::{Deadline, Handler, Result};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

#[cfg(any(target_os = "android", target_os = "ios", test))]
mod mobile_key;

pub struct NativeEngine {
    core: Mutex<AppCore>,
    database: PathBuf,
    storage: LocalStorage,
}
impl NativeEngine {
    pub fn open(database: &Path) -> Result<Self> {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        let path = database.to_str().ok_or("library path must be UTF-8")?;
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        let (storage, core) = (local_key::load(path)?, AppCore::open(path)?);
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let key = mobile_key::load(database)?;
            return Self::open_encrypted(database, key);
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        Ok(Self {
            core: Mutex::new(core),
            database: database.into(),
            storage,
        })
    }
    #[cfg(feature = "encrypted-storage")]
    pub fn open_encrypted(
        database: &Path,
        key: inkism_runtime::local_storage::StorageKey,
    ) -> Result<Self> {
        let path = database.to_str().ok_or("library path must be UTF-8")?;
        let storage = LocalStorage::encrypted(key.clone());
        let core = AppCore::open_encrypted(path, key)?;
        Ok(Self {
            core: Mutex::new(core),
            database: database.into(),
            storage,
        })
    }
    fn core(&self, deadline: Deadline) -> Result<MutexGuard<'_, AppCore>> {
        loop {
            expired(deadline)?;
            match self.core.try_lock() {
                Ok(core) => return Ok(core),
                Err(TryLockError::Poisoned(_)) => {
                    return Err("storage session failed; restart the app".into())
                }
                Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(2)),
            }
        }
    }
    fn assets(&self) -> Result<inkism_engine::attachments::AttachmentStore> {
        let mut path = self.database.as_os_str().to_os_string();
        path.push(".attachments");
        Ok(self.storage.attachments(Path::new(&path))?)
    }
}
fn expired(deadline: Deadline) -> Result<()> {
    if Instant::now() >= deadline {
        Err("request deadline exceeded".into())
    } else {
        Ok(())
    }
}
fn metadata(value: inkism_engine::attachments::AttachmentMetadata) -> AttachmentMetadata {
    AttachmentMetadata {
        id: value.id,
        name: value.name,
        media_type: value.media_type,
        size: value.size,
        sha256: value.sha256,
    }
}
impl Engine for NativeEngine {
    fn call(&self, deadline: Deadline, request: &[u8]) -> Result<Vec<u8>> {
        if request.len() > local_api::engine::MAX_MESSAGE {
            return Err("request is too large".into());
        }
        let request = serde_json::from_slice(request)?;
        let core = self.core(deadline)?;
        // Once execution starts, always return its actual result. Reporting a
        // timeout after a committed save would leave the client unsure of revision.
        Ok(serde_json::to_vec(&core.execute(request))?)
    }
    fn attachments(&self) -> Option<&dyn Attachments> {
        Some(self)
    }
    fn database(&self) -> Option<&Path> {
        Some(&self.database)
    }
}
struct DeadlineReader<'a> {
    input: &'a mut dyn Read,
    deadline: Deadline,
}
impl Read for DeadlineReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if Instant::now() >= self.deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "attachment deadline exceeded",
            ));
        }
        self.input.read(buffer)
    }
}
struct DeadlineWriter<'a> {
    output: &'a mut dyn Write,
    deadline: Deadline,
}
impl Write for DeadlineWriter<'_> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        if Instant::now() >= self.deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "attachment deadline exceeded",
            ));
        }
        self.output.write(buffer)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.output.flush()
    }
}
impl Attachments for NativeEngine {
    fn import(
        &self,
        deadline: Deadline,
        name: &str,
        media_type: &str,
        input: &mut dyn Read,
    ) -> Result<AttachmentMetadata> {
        expired(deadline)?;
        Ok(metadata(self.assets()?.import_reader(
            name,
            media_type,
            DeadlineReader { input, deadline },
        )?))
    }
    fn info(&self, deadline: Deadline, id: &str) -> Result<AttachmentMetadata> {
        expired(deadline)?;
        Ok(metadata(self.assets()?.metadata(id)?))
    }
    fn export(&self, deadline: Deadline, id: &str, output: &mut dyn Write) -> Result<()> {
        expired(deadline)?;
        self.assets()?
            .copy_to(id, &mut DeadlineWriter { output, deadline })?;
        Ok(())
    }
    fn walk(
        &self,
        deadline: Deadline,
        visit: &mut dyn FnMut(AttachmentMetadata) -> Result<()>,
    ) -> Result<()> {
        expired(deadline)?;
        let mut failure = None;
        let listed = self.assets()?.for_each_metadata(|value| {
            match expired(deadline).and_then(|_| visit(metadata(value))) {
                Ok(()) => Ok(()),
                Err(error) => {
                    failure = Some(error);
                    Err(inkism_engine::error::EngineError::internal(
                        "attachment walk stopped",
                    ))
                }
            }
        });
        if let Some(error) = failure {
            return Err(error);
        }
        listed?;
        Ok(())
    }
}
/// Native functionality absent on mobile remains explicitly unavailable through
/// Handler's capability responses. Ordinary notes, uploads, export, graph and
/// properties all use the real shared API.
pub fn open_handler(database: &Path, host: &str) -> Result<Handler> {
    let mut handler = Handler::default();
    handler.engine = Some(Arc::new(NativeEngine::open(database)?));
    handler.host = host.into();
    handler.windowed_editor = true;
    handler.lazy_editor = true;
    Ok(handler)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    fn call(engine: &NativeEngine, request: Value) -> Value {
        serde_json::from_slice(
            &engine
                .call(
                    Instant::now() + Duration::from_secs(10),
                    &serde_json::to_vec(&request).unwrap(),
                )
                .unwrap(),
        )
        .unwrap()
    }
    #[test]
    fn mobile_host_preserves_notes_revisions_and_attachments_on_reopen() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("notes.db");
        let (id, asset_id);
        {
            let engine = NativeEngine::open(&db).unwrap();
            let saved = call(
                &engine,
                json!({"op":"save","note":{"title":"Mobile","content":"# 원문\r\n","content_format":"markdown"}}),
            );
            assert_eq!(saved["ok"], true, "{saved}");
            id = saved["data"]["id"].as_str().unwrap().to_string();
            let conflict = call(
                &engine,
                json!({"op":"save","note":{"id":id,"revision":0,"title":"stale","content":"lost","content_format":"markdown"}}),
            );
            assert_eq!(conflict["ok"], false);
            let asset = engine
                .import(
                    Instant::now() + Duration::from_secs(5),
                    "image.bin",
                    "application/octet-stream",
                    &mut &b"\0\x01\xfforiginal"[..],
                )
                .unwrap();
            asset_id = asset.id;
        }
        let engine = NativeEngine::open(&db).unwrap();
        let loaded = call(&engine, json!({"op":"get","id":id}));
        assert_eq!(loaded["data"]["content"], "# 원문\r\n");
        let mut bytes = Vec::new();
        engine
            .export(
                Instant::now() + Duration::from_secs(5),
                &asset_id,
                &mut bytes,
            )
            .unwrap();
        assert_eq!(bytes, b"\0\x01\xfforiginal");
        let mut ids = vec![];
        engine
            .walk(Instant::now() + Duration::from_secs(5), &mut |asset| {
                ids.push(asset.id);
                Ok(())
            })
            .unwrap();
        assert_eq!(ids, [asset_id]);
        assert!(engine
            .call(Instant::now() - Duration::from_secs(1), b"{}")
            .is_err());
    }
    #[cfg(feature = "encrypted-storage")]
    #[test]
    fn encrypted_host_reopens_notes_and_attachments_without_plaintext_fallback() {
        use inkism_runtime::local_storage::StorageKey;
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("secure.db");
        let key = || StorageKey::from_bytes([71; 32]);
        let (id, asset);
        {
            let engine = NativeEngine::open_encrypted(&db, key()).unwrap();
            assert_eq!(
                call(&engine, json!({"op":"storage_status"}))["data"]["encrypted"],
                true
            );
            let saved = call(
                &engine,
                json!({"op":"save","note":{"title":"secret","content":"protected body"}}),
            );
            assert_eq!(saved["ok"], true);
            id = saved["data"]["id"].clone();
            asset = engine
                .import(
                    Instant::now() + Duration::from_secs(10),
                    "secret.bin",
                    "application/octet-stream",
                    &mut &b"protected attachment"[..],
                )
                .unwrap()
                .id;
        }
        assert!(!std::fs::read(&db).unwrap().starts_with(b"SQLite format 3"));
        assert!(!std::fs::read(root.path().join("secure.db.attachments"))
            .unwrap()
            .starts_with(b"SQLite format 3"));
        assert!(NativeEngine::open(&db).is_err());
        assert!(NativeEngine::open_encrypted(&db, StorageKey::from_bytes([72; 32])).is_err());
        let engine = NativeEngine::open_encrypted(&db, key()).unwrap();
        assert_eq!(
            call(&engine, json!({"op":"get","id":id}))["data"]["content"],
            "protected body"
        );
        let mut bytes = Vec::new();
        engine
            .export(Instant::now() + Duration::from_secs(10), &asset, &mut bytes)
            .unwrap();
        assert_eq!(bytes, b"protected attachment");
    }
    #[test]
    fn real_handler_enforces_origin_and_saves_through_mobile_transport() {
        let root = tempfile::tempdir().unwrap();
        let handler = open_handler(&root.path().join("notes.db"), "wails.localhost").unwrap();
        let mut request = local_api::Request {
            method: "POST".into(),
            path: "/api/rpc".into(),
            query: None,
            host: "wails.localhost".into(),
            headers: vec![
                ("content-type".into(), "application/json".into()),
                ("origin".into(), "http://wails.localhost".into()),
            ],
            body: serde_json::to_vec(
                &json!({"op":"save","note":{"title":"From UI","content":"<p>body</p>"}}),
            )
            .unwrap(),
        };
        let saved: Value = serde_json::from_slice(&handler.handle(&request).body).unwrap();
        assert_eq!(saved["ok"], true, "{saved}");
        request.headers[1].1 = "https://foreign.invalid".into();
        assert_eq!(handler.handle(&request).status, 403);
    }
}
