//! Create a verified encrypted copy. Never rewrite or rename the source library.
use crate::{Error, Result, StorageKey};
use std::path::Path;

/// Copy a plaintext SQLite snapshot to a NEW encrypted database atomically.
/// The caller coordinates a consistent multi-database library snapshot.
pub fn copy_plaintext(source: &Path, destination: &Path, key: &StorageKey) -> Result<()> {
    if destination.try_exists().map_err(io_error)? {
        return Err(Error::new("encrypted destination already exists"));
    }
    let source = source.canonicalize().map_err(io_error)?;
    let mut uri = url::Url::from_file_path(&source)
        .map_err(|_| Error::new("invalid source database path"))?;
    uri.query_pairs_mut().append_pair("mode", "ro");
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    // Do not create user directories on an invalid destination. Host provisioning
    // decides where the new library belongs before calling this primitive.
    let temp = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    {
        let conn = crate::open(temp.path(), Some(key))?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.execute("ATTACH DATABASE ?1 AS source_plain KEY ''", [uri.as_str()])?;
        conn.execute_batch("BEGIN")?;
        let copied = (|| -> Result<()> {
            // This read pins the source WAL snapshot until COMMIT.
            let version: i64 =
                conn.query_row("PRAGMA source_plain.user_version", [], |r| r.get(0))?;
            let app_id: i64 =
                conn.query_row("PRAGMA source_plain.application_id", [], |r| r.get(0))?;
            let vacuum: i64 =
                conn.query_row("PRAGMA source_plain.auto_vacuum", [], |r| r.get(0))?;
            conn.pragma_update(None, "auto_vacuum", vacuum)?;
            conn.query_row("SELECT sqlcipher_export('main','source_plain')", [], |_| {
                Ok(())
            })?;
            conn.pragma_update(None, "user_version", version)?;
            conn.pragma_update(None, "application_id", app_id)?;
            let integrity: String =
                conn.query_row("PRAGMA main.integrity_check", [], |r| r.get(0))?;
            if integrity != "ok" {
                return Err(Error::new("encrypted copy failed integrity check"));
            }
            let mut fk = conn.prepare("PRAGMA main.foreign_key_check")?;
            if fk.query([])?.next()?.is_some() {
                return Err(Error::new("encrypted copy failed foreign key check"));
            }
            Ok(())
        })();
        match copied {
            Ok(()) => conn.execute_batch("COMMIT")?,
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(error);
            }
        }
        conn.execute_batch("DETACH DATABASE source_plain")?;
    }
    // Reopen through the key boundary before publishing; destination cannot
    // accidentally contain an unkeyed SQLite database or remain only in WAL.
    let check = crate::open(temp.path(), Some(key))?;
    let integrity: String = check.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        return Err(Error::new("encrypted copy reopen check failed"));
    }
    drop(check);
    temp.as_file().sync_all().map_err(io_error)?;
    temp.persist_noclobber(destination)
        .map_err(|_| Error::new("encrypted destination already exists or cannot be published"))?;
    Ok(())
}
fn io_error(error: std::io::Error) -> Error {
    Error::new(format!("database copy: {error}"))
}
