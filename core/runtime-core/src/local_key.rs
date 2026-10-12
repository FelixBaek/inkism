//! Windows current-user key envelope. Presence is authoritative: never fall back.
use crate::{local_storage::LocalStorage, Result, RuntimeError};
use std::io::Read;
#[cfg(any(test, all(windows, feature = "encrypted-storage")))]
use std::path::Path;
#[cfg(all(windows, feature = "encrypted-storage"))]
const HEADER: &[u8] = b"MINDBOX-LOCAL-KEY-1\n";
fn read_envelope(db: &str) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(key_path(db))?
        .take(65537)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 65536 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "local key envelope is too large",
        ));
    }
    Ok(bytes)
}
fn key_path(db: &str) -> String {
    format!("{db}.storage-key")
}

pub fn load(db: &str) -> Result<LocalStorage> {
    if db.trim().is_empty() {
        return Err(RuntimeError::config("empty db path"));
    }
    match read_envelope(db) {
        Ok(bytes) => decode(&bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Also protect attachment-only subprocesses from creating plaintext
            // files next to an encrypted library whose key envelope is missing.
            let mut paths = vec![
                db.to_owned(),
                format!("{db}.search"),
                format!("{db}.attachments"),
            ];
            paths.extend(crate::config::state_files(db)?);
            for path in paths {
                match std::fs::File::open(&path) {
                    Ok(file) => {
                        let mut header = Vec::with_capacity(16);
                        file.take(16).read_to_end(&mut header)?;
                        if !header.is_empty() && header != b"SQLite format 3\0" {
                            return Err(RuntimeError::config(
                                "local storage key is missing or database header is invalid",
                            ));
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
            Ok(LocalStorage::default())
        }
        Err(e) => Err(e.into()),
    }
}

#[cfg(all(windows, feature = "encrypted-storage"))]
fn decode(bytes: &[u8]) -> Result<LocalStorage> {
    use crate::local_storage::StorageKey;
    use zeroize::Zeroizing;
    let cipher = bytes
        .strip_prefix(HEADER)
        .ok_or_else(|| RuntimeError::config("invalid local storage key envelope"))?;
    let plain =
        Zeroizing::new(inkism_windows_secrets::unprotect(cipher).map_err(|_| {
            RuntimeError::config("Windows account cannot open the local storage key")
        })?);
    let key: [u8; 32] = plain
        .as_slice()
        .try_into()
        .map_err(|_| RuntimeError::config("invalid local storage key length"))?;
    Ok(LocalStorage::encrypted(StorageKey::from_bytes(key)))
}
#[cfg(not(all(windows, feature = "encrypted-storage")))]
fn decode(_: &[u8]) -> Result<LocalStorage> {
    Err(RuntimeError::config(
        "this library requires a Windows build with encrypted storage enabled",
    ))
}

/// Explicitly provision a NEW library only. Existing files are never converted.
#[cfg(all(windows, feature = "encrypted-storage"))]
pub fn initialize(db: &str) -> Result<()> {
    let parent = Path::new(db)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    let _lease = crate::library_lock::LibraryLease::exclusive(db)?;
    ensure_new(db)?;
    provision_key(db)?;
    Ok(())
}

/// Caller owns the exclusive library gate and a new destination.
#[cfg(all(windows, feature = "encrypted-storage"))]
pub(crate) fn provision_key(db: &str) -> Result<crate::local_storage::StorageKey> {
    use std::io::Write;
    let key = sync_core::Key::generate();
    let encrypted = inkism_windows_secrets::protect(key.as_bytes())
        .map_err(|_| RuntimeError::config("Windows could not protect the local storage key"))?;
    let target = key_path(db);
    let parent = Path::new(&target)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    tmp.write_all(HEADER)?;
    tmp.write_all(&encrypted)?;
    tmp.as_file().sync_all()?;
    tmp.persist_noclobber(&target).map_err(|_| {
        RuntimeError::config("local storage key already exists or could not be saved")
    })?;
    Ok(crate::local_storage::StorageKey::from_bytes(
        *key.as_bytes(),
    ))
}

#[cfg(not(all(windows, feature = "encrypted-storage")))]
pub fn initialize(_: &str) -> Result<()> {
    Err(RuntimeError::config(
        "creating an encrypted library requires a Windows build with encrypted storage enabled",
    ))
}

#[cfg(any(test, all(windows, feature = "encrypted-storage")))]
fn ensure_new(db: &str) -> Result<()> {
    let path = Path::new(db);
    if path.try_exists()? {
        return Err(RuntimeError::config(
            "encrypted initialization requires a new library path",
        ));
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| RuntimeError::config("invalid library path"))?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    match std::fs::read_dir(parent) {
        Ok(entries) => {
            for entry in entries {
                check_unrelated(&entry?, name)?;
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

/// Rejects a directory entry that belongs to the library named `name`.
#[cfg(any(test, all(windows, feature = "encrypted-storage")))]
fn check_unrelated(entry: &std::fs::DirEntry, name: &str) -> Result<()> {
    let file = entry.file_name();
    let text = file.to_string_lossy();
    let (text, name) = if cfg!(windows) {
        (text.to_lowercase(), name.to_lowercase())
    } else {
        (text.into_owned(), name.to_owned())
    };
    // The desktop shell holds this kernel lock before spawning us.
    // Its persistent file contains no library data.
    if [format!("{name}.lock"), format!("{name}.runtime-lock")].contains(&text)
        && entry.file_type()?.is_file()
    {
        return Ok(());
    }
    if text == name
        || text.starts_with(&format!("{name}."))
        || ["-wal", "-shm", "-journal"]
            .iter()
            .any(|suffix| text == format!("{name}{suffix}"))
    {
        return Err(RuntimeError::config(
            "encrypted initialization requires a new library path; existing files are preserved",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initialization_rejects_existing_library_and_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        let db = db.to_str().unwrap();
        for suffix in [
            "",
            ".search",
            ".attachments",
            ".sync",
            ".storage-key",
            ".attachment-outbox-device",
            "-wal",
            "-shm",
            "-journal",
        ] {
            let p = format!("{db}{suffix}");
            std::fs::write(&p, b"preserve").unwrap();
            assert!(ensure_new(db).is_err());
            assert_eq!(std::fs::read(&p).unwrap(), b"preserve");
            std::fs::remove_file(p).unwrap();
        }
        assert!(ensure_new(db).is_ok());
    }
    #[test]
    fn initialization_allows_the_desktop_coordination_lock_only() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        let db = db.to_str().unwrap();
        // The Go shell acquires this before starting the Rust process.
        let lock = format!("{db}.lock");
        std::fs::write(&lock, b"").unwrap();
        assert!(ensure_new(db).is_ok());
        assert!(Path::new(&lock).exists());
        let other = format!("{db}.lock.backup");
        std::fs::write(&other, b"preserve").unwrap();
        assert!(ensure_new(db).is_err());
        assert_eq!(std::fs::read(other).unwrap(), b"preserve");
    }
    #[test]
    fn missing_or_corrupt_envelope_never_creates_plaintext_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        let db = db.to_str().unwrap();
        std::fs::write(db, b"encrypted-file-header").unwrap();
        assert!(load(db).is_err());
        std::fs::write(key_path(db), b"invalid-key-file").unwrap();
        assert!(load(db).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
        assert_eq!(std::fs::read(db).unwrap(), b"encrypted-file-header");
        std::fs::write(key_path(db), vec![0u8; 65537]).unwrap();
        assert!(load(db).is_err());
        assert_eq!(std::fs::metadata(key_path(db)).unwrap().len(), 65537);
    }
    #[cfg(all(windows, feature = "encrypted-storage"))]
    #[test]
    fn windows_key_survives_reopen_and_cannot_be_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("한글.db");
        let db = db.to_str().unwrap();
        initialize(db).unwrap();
        let envelope = std::fs::read(key_path(db)).unwrap();
        assert!(envelope.starts_with(HEADER));
        {
            let store = load(db).unwrap();
            let engine = store.engine(db).unwrap();
            assert_eq!(
                engine.execute(serde_json::json!({"op":"health"}))["ok"],
                true
            );
        }
        assert!(initialize(db).is_err());
        assert_eq!(std::fs::read(key_path(db)).unwrap(), envelope);
        assert!(load(db).unwrap().engine(db).is_ok());
        let mut bad = envelope.clone();
        let last = bad.len() - 1;
        bad[last] ^= 1;
        std::fs::write(key_path(db), &bad).unwrap();
        assert!(load(db).is_err());
        assert_eq!(std::fs::read(key_path(db)).unwrap(), bad);
    }
}
