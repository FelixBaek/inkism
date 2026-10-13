//! Offline, non-destructive library copy. Never switch or delete the source.
use crate::{Result, RuntimeError};
use std::path::{Path, PathBuf};

/// Copy a closed plaintext library into a NEW directory using a Windows account key.
/// Returns the new database path. A failed destination is deliberately quarantined.
#[cfg(all(windows, feature = "encrypted-storage"))]
pub fn copy_encrypted(source: &str, destination: &Path) -> Result<PathBuf> {
    copy_with_key(source, destination, crate::local_key::provision_key)
}
#[cfg(not(all(windows, feature = "encrypted-storage")))]
pub fn copy_encrypted(_: &str, _: &Path) -> Result<PathBuf> {
    Err(RuntimeError::config(
        "encrypted library copy requires a Windows build with encrypted storage enabled",
    ))
}

#[cfg(all(feature = "encrypted-storage", any(windows, test)))]
fn copy_with_key(
    source: &str,
    destination: &Path,
    provision: impl FnOnce(&str) -> Result<crate::local_storage::StorageKey>,
) -> Result<PathBuf> {
    use crate::{library_lock::LibraryLease, StoredConfig};
    use std::io::Write;
    // Resolve spelling/case before discovering per-device sidecars on Windows.
    // A symlink may have a different set of sidecars in existing app versions.
    if std::fs::symlink_metadata(source)?.file_type().is_symlink() {
        return Err(RuntimeError::config(
            "copy requires the actual library path, not a symlink",
        ));
    }
    let canonical = Path::new(source).canonicalize()?;
    let source = canonical
        .to_str()
        .ok_or_else(|| RuntimeError::config("invalid source path"))?;
    let _source_lease = LibraryLease::exclusive(source)?;
    if !Path::new(source).is_file()
        || Path::new(&format!("{source}.storage-key")).try_exists()?
        || Path::new(&format!("{source}.migration-incomplete")).try_exists()?
    {
        return Err(RuntimeError::config(
            "copy requires a complete plaintext source library",
        ));
    }
    let source_path = Path::new(source);
    let parent = source_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = source_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| RuntimeError::config("invalid source filename"))?;
    let suffixes = copy_suffixes(source, parent, name)?;
    let config = StoredConfig::load_readonly(&format!("{source}.sync.json"))?;
    if let Some(config) = &config {
        config.decode_key()?;
        if config.state_generation.is_some() {
            crate::local_storage::LocalStorage::default()
                .validate_sync_state(&config.state_path(source)?)?;
        }
    }
    // create_dir fails for ANY existing destination, including an empty one.
    std::fs::create_dir(destination)?;
    let target = destination.join("notes.db");
    let target_str = target
        .to_str()
        .ok_or_else(|| RuntimeError::config("invalid destination path"))?;
    let _target_lease = LibraryLease::exclusive(target_str)?;
    let marker = format!("{target_str}.migration-incomplete");
    let mut incomplete = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)?;
    incomplete.write_all(
        b"MINDBOX-INCOMPLETE-COPY-1\nUse the original library; this copy is not ready.\n",
    )?;
    incomplete.sync_all()?;
    drop(incomplete);
    let key = provision(target_str)?;
    for suffix in suffixes {
        inkism_storage::migration::copy_plaintext(
            Path::new(&format!("{source}{suffix}")),
            Path::new(&format!("{target_str}{suffix}")),
            &key,
        )
        .map_err(|e| RuntimeError::Engine(e.to_string()))?;
    }
    // The source remains usable after copying. A clone must have its own
    // vector-clock component; otherwise later edits can share the same clock
    // and one branch is mistaken for an already observed change.
    let sync_path = match &config {
        Some(config) => config.state_path(target_str)?,
        None => format!("{target_str}.sync"),
    };
    if Path::new(&sync_path).try_exists()? {
        fork_device_identity(&sync_path, target_str, &key)?;
    }
    if let Some(config) = config {
        config.save(&format!("{target_str}.sync.json"))?;
    }
    // No worker or schema migration is started while validating the copy.
    // Pending events, cursors and clocks retain their original historical IDs.
    // Every SQLite file has already passed integrity, FK and keyed reopen checks.
    std::fs::remove_file(marker)?;
    Ok(target)
}

/// Every library file to copy, as suffixes of the source path: the database,
/// search/attachment stores, sync states and per-device attachment queues.
#[cfg(all(feature = "encrypted-storage", any(windows, test)))]
fn copy_suffixes(source: &str, parent: &Path, name: &str) -> Result<Vec<String>> {
    let mut suffixes = vec![String::new()];
    for suffix in [".search", ".attachments"] {
        if Path::new(&format!("{source}{suffix}")).try_exists()? {
            suffixes.push(suffix.into());
        }
    }
    for state in crate::config::state_files(source)? {
        let filename = Path::new(&state)
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| RuntimeError::config("invalid sync state path"))?;
        suffixes.push(
            filename
                .get(name.len()..)
                .ok_or_else(|| RuntimeError::config("invalid sync state suffix"))?
                .to_owned(),
        );
    }
    let prefix = format!("{name}.attachment-outbox-");
    for entry in std::fs::read_dir(parent)? {
        let entry = entry?;
        let filename = entry.file_name();
        let filename = filename.to_string_lossy();
        if let Some(device) = filename.strip_prefix(&prefix) {
            // WAL/SHM are included by the SQLite snapshot, never copied as files.
            if uuid::Uuid::parse_str(device).is_ok() {
                if !entry.file_type()?.is_file() {
                    return Err(RuntimeError::config("invalid attachment queue file"));
                }
                suffixes.push(filename[name.len()..].to_owned());
            }
        }
    }
    suffixes.sort();
    Ok(suffixes)
}

/// Give the copied sync state a new device identity and rename its queue.
#[cfg(all(feature = "encrypted-storage", any(windows, test)))]
fn fork_device_identity(
    sync_path: &str,
    target_str: &str,
    key: &crate::local_storage::StorageKey,
) -> Result<()> {
    let sync = inkism_storage::open(Path::new(sync_path), Some(key))
        .map_err(|e| RuntimeError::Engine(e.to_string()))?;
    let old_device: String =
        sync.query_row("SELECT value FROM meta WHERE key='device_id'", [], |r| {
            r.get(0)
        })?;
    uuid::Uuid::parse_str(&old_device)
        .map_err(|_| RuntimeError::config("invalid source device identity"))?;
    let new_device = uuid::Uuid::new_v4().to_string();
    sync.execute(
        "UPDATE meta SET value=?1 WHERE key='device_id'",
        [&new_device],
    )?;
    drop(sync);
    let old_queue = format!("{target_str}.attachment-outbox-{old_device}");
    let new_queue = format!("{target_str}.attachment-outbox-{new_device}");
    if Path::new(&old_queue).try_exists()? {
        if Path::new(&new_queue).try_exists()? {
            return Err(RuntimeError::config("duplicate destination device queue"));
        }
        std::fs::rename(old_queue, new_queue)?;
    }
    Ok(())
}

#[cfg(all(test, feature = "encrypted-storage"))]
mod tests {
    use super::*;
    use crate::{library_lock::LibraryLease, local_storage::StorageKey, AppCore, StoredConfig};
    use serde_json::{json, Value};
    fn ok(v: Value) -> Value {
        assert_eq!(v["ok"], true, "{v}");
        v["data"].clone()
    }
    fn key() -> StorageKey {
        StorageKey::from_bytes([93; 32])
    }

    #[test]
    fn encrypted_copy_follows_active_generation_and_preserves_retained_states() {
        use sync_core::{Entity, EntityKind, SyncConfig, SyncEngine};
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("한글 원본.db");
        let source = source.to_str().unwrap();
        let vault = sync_core::Key::generate();
        let app = AppCore::open(source).unwrap();
        assert!(app.wait_sync_idle(30_000));
        let note = ok(app.execute(json!({"op":"save","note":{"title":"세대 복사","content":"<p>한글😀</p>","text":"정확한 본문"}})));
        ok(app.execute(json!({"op":"sync_config","server_url":"http://127.0.0.1:9","token":"copy-fixture-token","key":vault.to_base64()})));
        assert!(app.wait_sync_idle(30_000));
        ok(app.execute(json!({"op":"sync_pause","paused":true})));
        assert!(app.wait_sync_idle(30_000));
        let cfg = StoredConfig::load(&format!("{source}.sync.json"))
            .unwrap()
            .unwrap();
        assert!(cfg.state_generation.is_some());
        drop(app);
        let active = cfg.state_path(source).unwrap();
        let archived = format!("{source}.sync-{}", uuid::Uuid::new_v4());
        let legacy = format!("{source}.sync");
        for state in [&archived, &legacy] {
            let sync = SyncEngine::open(SyncConfig::new(
                state,
                &cfg.server_url,
                &cfg.token,
                vault.clone(),
            ))
            .unwrap();
            sync.stage_local(
                Entity::new(
                    EntityKind::Note,
                    "retained",
                    json!({"body":"未送信 한글😀"}),
                ),
                1,
            )
            .unwrap();
        }
        let states = [active, archived, legacy];
        let before: Vec<_> = states.iter().map(|p| std::fs::read(p).unwrap()).collect();
        let source_config = std::fs::read(format!("{source}.sync.json")).unwrap();
        let device = SyncEngine::open(SyncConfig::new(
            &states[0],
            &cfg.server_url,
            &cfg.token,
            vault.clone(),
        ))
        .unwrap()
        .device_id()
        .to_owned();
        let destination = dir.path().join("암호화 사본");
        let target = copy_with_key(source, &destination, |_| Ok(key())).unwrap();
        let target = target.to_str().unwrap();
        let copied_cfg = StoredConfig::load(&format!("{target}.sync.json"))
            .unwrap()
            .unwrap();
        assert_eq!(copied_cfg.state_generation, cfg.state_generation);
        for (index, state) in states.iter().enumerate() {
            let suffix = state.strip_prefix(source).unwrap();
            let copied = format!("{target}{suffix}");
            assert!(!std::fs::read(&copied)
                .unwrap()
                .starts_with(b"SQLite format 3\0"));
            let db = inkism_storage::open(Path::new(&copied), Some(&key())).unwrap();
            assert_eq!(
                db.query_row("SELECT count(*) FROM outbox", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                1
            );
            if index == 0 {
                assert_ne!(
                    db.query_row("SELECT value FROM meta WHERE key='device_id'", [], |r| {
                        r.get::<_, String>(0)
                    })
                    .unwrap(),
                    device
                );
            }
            assert_eq!(std::fs::read(state).unwrap(), before[index]);
        }
        assert_eq!(
            std::fs::read(format!("{source}.sync.json")).unwrap(),
            source_config
        );
        let reopened = AppCore::open_encrypted(target, key()).unwrap();
        assert!(reopened.wait_sync_idle(30_000));
        assert_eq!(
            ok(reopened.execute(json!({"op":"get","id":note["id"]}))),
            note
        );
        drop(reopened);
        // A broken active generation must not be advertised as a complete copy.
        std::fs::rename(&states[0], format!("{}.preserved", states[0])).unwrap();
        let missing_destination = dir.path().join("missing-state-copy");
        assert!(copy_with_key(source, &missing_destination, |_| Ok(key())).is_err());
        assert!(!missing_destination.exists());
        std::fs::write(&states[0], []).unwrap();
        let empty_destination = dir.path().join("empty-state-copy");
        assert!(copy_with_key(source, &empty_destination, |_| Ok(key())).is_err());
        assert!(!empty_destination.exists());
        assert_eq!(std::fs::metadata(&states[0]).unwrap().len(), 0);
    }

    #[test]
    fn copy_keeps_notes_files_sync_state_and_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("원본.db");
        let source = source.to_str().unwrap();
        let id;
        {
            let app = AppCore::open(source).unwrap();
            id = ok(app.execute(json!({"op":"save","note":{"title":"이전","content":"<p><strong>보존본문</strong></p>","text":"보존본문"}})))["id"].clone();
        }
        let mut attachments = inkism_engine::attachments::AttachmentStore::open(Path::new(
            &format!("{source}.attachments"),
        ))
        .unwrap();
        let file = attachments
            .import_reader(
                "test.bin",
                "application/octet-stream",
                b"attachment-copy".as_slice(),
            )
            .unwrap();
        drop(attachments);
        let vault_key = sync_core::Key::generate();
        let cfg = StoredConfig {
            version: 1,
            paused: false,
            state_generation: None,
            server_url: "http://127.0.0.1:1".into(),
            token: "token".into(),
            key: vault_key.to_base64(),
            scope: crate::SyncScope::default(),
        };
        cfg.save(&format!("{source}.sync.json")).unwrap();
        let sync = sync_core::SyncEngine::open(sync_core::SyncConfig::new(
            format!("{source}.sync"),
            cfg.server_url.clone(),
            cfg.token.clone(),
            vault_key.clone(),
        ))
        .unwrap();
        let device = sync.device_id().to_owned();
        let queue_suffix = format!(".attachment-outbox-{device}");
        let mut queue = sync_core::attachment_queue::AttachmentQueue::open(
            Path::new(&format!("{source}{queue_suffix}")),
            vault_key,
            &cfg.server_url,
        )
        .unwrap();
        let staged_chunk = queue
            .stage(
                &sync_core::attachment::ChunkContext {
                    attachment_id: file.id.clone(),
                    index: 0,
                    total_size: 15,
                },
                b"attachment-copy",
            )
            .unwrap();
        sync.stage_local(
            sync_core::Entity::new(
                sync_core::EntityKind::Note,
                "queued",
                json!({"v":"pending"}),
            ),
            42,
        )
        .unwrap();
        drop(queue);
        drop(sync);
        let original = std::fs::read(source).unwrap();
        let original_sync = std::fs::read(format!("{source}.sync")).unwrap();
        let config_bytes = std::fs::read(format!("{source}.sync.json")).unwrap();
        let destination = dir.path().join("encrypted");
        let target = copy_with_key(source, &destination, |_| Ok(key())).unwrap();
        assert_eq!(std::fs::read(source).unwrap(), original);
        assert_eq!(
            std::fs::read(format!("{source}.sync.json")).unwrap(),
            config_bytes
        );
        assert!(copy_with_key(source, &destination, |_| Ok(key())).is_err());
        let target_str = target.to_str().unwrap();
        let e = inkism_engine::Engine::open_encrypted(target_str, key()).unwrap();
        assert_eq!(
            ok(e.execute(json!({"op":"get","id":id})))["content"],
            "<p><strong>보존본문</strong></p>"
        );
        drop(e);
        let files = inkism_engine::attachments::AttachmentStore::open_encrypted(
            Path::new(&format!("{target_str}.attachments")),
            &key(),
        )
        .unwrap();
        let mut bytes = Vec::new();
        files.copy_to(&file.id, &mut bytes).unwrap();
        assert_eq!(bytes, b"attachment-copy");
        for suffix in ["", ".search", ".attachments", ".sync"] {
            assert!(!std::fs::read(format!("{target_str}{suffix}"))
                .unwrap()
                .starts_with(b"SQLite format 3\0"));
        }
        let copied_cfg = StoredConfig::load_readonly(&format!("{target_str}.sync.json"))
            .unwrap()
            .unwrap();
        assert_eq!(copied_cfg.key, cfg.key);
        let copied_sync = sync_core::SyncEngine::open_encrypted(
            sync_core::SyncConfig::new(
                format!("{target_str}.sync"),
                cfg.server_url.clone(),
                cfg.token.clone(),
                cfg.decode_key().unwrap(),
            ),
            &key(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(format!("{source}.sync")).unwrap(),
            original_sync
        );
        assert_ne!(copied_sync.device_id(), device);
        assert_eq!(copied_sync.pending_outbox_count().unwrap(), 1);
        assert_eq!(copied_sync.journal_checkpoint().unwrap(), 42);
        let new_queue = format!("{target_str}.attachment-outbox-{}", copied_sync.device_id());
        assert!(!Path::new(&format!("{target_str}{queue_suffix}")).exists());
        assert!(!std::fs::read(&new_queue)
            .unwrap()
            .starts_with(b"SQLite format 3\0"));
        let mut copied_queue = sync_core::attachment_queue::AttachmentQueue::open_encrypted(
            Path::new(&new_queue),
            cfg.decode_key().unwrap(),
            &cfg.server_url,
            &key(),
        )
        .unwrap();
        assert_eq!(copied_queue.pending_count().unwrap(), 1);
        let same_chunk = copied_queue
            .stage(
                &sync_core::attachment::ChunkContext {
                    attachment_id: file.id.clone(),
                    index: 0,
                    total_size: 15,
                },
                b"attachment-copy",
            )
            .unwrap();
        assert_eq!(same_chunk.id, staged_chunk.id);
        assert_eq!(same_chunk.ciphertext, staged_chunk.ciphertext);
    }

    #[test]
    fn busy_source_and_failed_copy_cannot_publish_a_working_library() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.db");
        let source = source.to_str().unwrap();
        let app = AppCore::open(source).unwrap();
        let dest = dir.path().join("copy");
        assert!(copy_with_key(source, &dest, |_| Ok(key())).is_err());
        assert!(!dest.exists());
        drop(app);
        std::fs::write(format!("{source}.attachments"), b"corrupt").unwrap();
        assert!(copy_with_key(source, &dest, |_| Ok(key())).is_err());
        let target = dest.join("notes.db");
        let target = target.to_str().unwrap();
        assert!(LibraryLease::shared(target).is_err());
        assert!(AppCore::open_encrypted(target, key()).is_err());
        assert!(Path::new(&format!("{target}.migration-incomplete")).exists());
        assert_eq!(
            std::fs::read(format!("{source}.attachments")).unwrap(),
            b"corrupt"
        );
        assert!(inkism_engine::Engine::open(source).is_ok());
    }
    #[test]
    fn key_provision_failure_quarantines_copy_and_source_can_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.db");
        let source = source.to_str().unwrap();
        drop(AppCore::open(source).unwrap());
        let original = std::fs::read(source).unwrap();
        let dest = dir.path().join("copy");
        assert!(copy_with_key(source, &dest, |_| Err(RuntimeError::config(
            "key provisioning failed"
        )))
        .is_err());
        assert_eq!(std::fs::read(source).unwrap(), original);
        assert!(AppCore::open(source).is_ok());
        assert!(LibraryLease::shared(dest.join("notes.db").to_str().unwrap()).is_err());
    }
    #[test]
    fn original_and_encrypted_copy_keep_both_concurrent_edits() {
        use sync_core::{Entity, EntityKind, SyncConfig, SyncEngine};
        let relay = crate::test_relay::Relay::start().expect("real Rust relay");
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("original.db");
        let source = source.to_str().unwrap();
        drop(AppCore::open(source).unwrap());
        let vault = sync_core::Key::generate();
        let config = StoredConfig {
            version: 1,
            paused: false,
            state_generation: None,
            server_url: relay.url.clone(),
            token: crate::test_relay::TOKEN.into(),
            key: vault.to_base64(),
            scope: crate::SyncScope::default(),
        };
        config.save(&format!("{source}.sync.json")).unwrap();
        let make_config = |path: &str| {
            SyncConfig::new(
                format!("{path}.sync"),
                relay.url.clone(),
                crate::test_relay::TOKEN,
                vault.clone(),
            )
        };
        let entity = |value: &str| Entity::new(EntityKind::Note, "shared", json!({"body":value}));
        let original = SyncEngine::open(make_config(source)).unwrap();
        original.stage_local(entity("base"), 1).unwrap();
        original.sync_once().unwrap();
        let device = original.device_id().to_owned();
        drop(original);
        let target = copy_with_key(source, &dir.path().join("encrypted"), |_| Ok(key())).unwrap();
        let original = SyncEngine::open(make_config(source)).unwrap();
        let copied =
            SyncEngine::open_encrypted(make_config(target.to_str().unwrap()), &key()).unwrap();
        assert_eq!(original.device_id(), device);
        assert_ne!(copied.device_id(), device);
        original.stage_local(entity("source branch"), 2).unwrap();
        copied.stage_local(entity("copy branch"), 2).unwrap();
        original.push().unwrap();
        copied.push().unwrap();
        let a = original.sync_once().unwrap();
        let b = copied.sync_once().unwrap();
        assert_eq!(a.conflicts, 1, "source lost the copied branch");
        assert_eq!(b.conflicts, 1, "copy lost the original branch");
        let left = a
            .incoming
            .iter()
            .find_map(|item| item.conflict.as_ref())
            .unwrap();
        let right = b
            .incoming
            .iter()
            .find_map(|item| item.conflict.as_ref())
            .unwrap();
        assert_eq!(left.copy_id, right.copy_id);
        assert_eq!(left.winner.data, right.winner.data);
        let mut bodies = vec![
            left.winner.data["body"].as_str().unwrap(),
            left.loser.data["body"].as_str().unwrap(),
        ];
        bodies.sort();
        assert_eq!(bodies, vec!["copy branch", "source branch"]);
    }
}
