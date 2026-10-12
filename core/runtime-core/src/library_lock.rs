//! Cooperative lifetime gate for runtime, attachment processes, and maintenance.
//! A persistent empty file is only the lock handle: never delete it on release.
use crate::{Result, RuntimeError};
use fs2::FileExt;
use std::fs::{File, OpenOptions};

pub struct LibraryLease {
    _file: File,
}
impl Drop for LibraryLease {
    fn drop(&mut self) {
        // A concurrent fork may retain this open file description until exec.
        // Release this lease explicitly; independently opened leases are unaffected.
        let _ = FileExt::unlock(&self._file);
    }
}
impl LibraryLease {
    /// Ordinary work may coexist, including the separate attachment process.
    pub fn shared(db: &str) -> Result<Self> {
        let lease = Self::acquire(db, false)?;
        if std::path::Path::new(&format!("{db}.migration-incomplete")).try_exists()? {
            return Err(RuntimeError::config(
                "library copy is incomplete; use the original library",
            ));
        }
        Ok(lease)
    }
    /// Maintenance must fail promptly while any runtime or transfer is alive.
    pub fn exclusive(db: &str) -> Result<Self> {
        Self::acquire(db, true)
    }
    fn acquire(db: &str, exclusive: bool) -> Result<Self> {
        if db.trim().is_empty() {
            return Err(RuntimeError::config("empty db path"));
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(format!("{db}.runtime-lock"))?;
        let result = if exclusive {
            FileExt::try_lock_exclusive(&file)
        } else {
            FileExt::try_lock_shared(&file)
        };
        if let Err(error) = result {
            if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() {
                return Err(RuntimeError::config(
                    "library is in use; close Inkism and wait for transfers before maintenance",
                ));
            }
            return Err(error.into());
        }
        Ok(Self { _file: file })
    }
}
