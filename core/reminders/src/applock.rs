//! Keeps two desktop processes from opening the same vault.
//! The kernel releases the lock on process exit, including crashes. The small
//! `<database>.lock` sidecar remains on disk; its existence alone never means
//! the app is running.

use crate::{Error, Result};
use std::ffi::OsString;
use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};

pub const BUSY_MESSAGE: &str =
    "이 저장소는 다른 Inkism 창에서 사용 중입니다. 열려 있는 창을 확인해 주세요";

/// Held lock; dropping it releases the lock (the sidecar file stays).
#[derive(Debug)]
pub struct Lock {
    _file: File,
}

pub fn lock_path(database: &Path) -> PathBuf {
    let mut raw = OsString::from(database.as_os_str());
    raw.push(".lock");
    PathBuf::from(raw)
}

/// Takes an exclusive, non-blocking lock on `<database>.lock`.
/// Returns [`Error::Busy`] when another handle or process holds it.
pub fn acquire(database: impl AsRef<Path>) -> Result<Lock> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let file = options.open(lock_path(database.as_ref()))?;
    match file.try_lock() {
        Ok(()) => Ok(Lock { _file: file }),
        Err(TryLockError::WouldBlock) => Err(Error::Busy),
        Err(TryLockError::Error(e)) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};

    #[test]
    fn exclusive_and_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("한글 노트.db");
        let release = acquire(&db).unwrap();
        assert!(
            acquire(&db).unwrap_err().is_busy(),
            "second open must be busy"
        );
        drop(release);
        drop(acquire(&db).unwrap());
        assert!(dir.path().join("한글 노트.db.lock").exists());
    }

    #[test]
    fn different_vaults() {
        let dir = tempfile::tempdir().unwrap();
        let _a = acquire(dir.path().join("a")).unwrap();
        let _b = acquire(dir.path().join("b")).unwrap();
    }

    const HELPER_ENV: &str = "INKISM_LOCK_HELPER_DB";

    #[test]
    fn lock_released_after_process_crash() {
        if let Some(db) = std::env::var_os(HELPER_ENV) {
            let Ok(_lock) = acquire(PathBuf::from(db)) else {
                std::process::exit(2)
            };
            println!("locked");
            std::io::stdout().flush().unwrap();
            let mut line = String::new();
            let _ = std::io::stdin().read_line(&mut line);
            std::process::exit(7); // Skips the destructor, like a crash.
        }
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("crash.db");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "applock::tests::lock_released_after_process_crash",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(HELPER_ENV, &db)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut out = BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        loop {
            line.clear();
            if out.read_line(&mut line).unwrap() == 0 {
                let _ = child.kill();
                panic!("helper never locked");
            }
            if line.trim_end().ends_with("locked") {
                break;
            }
        }
        if !acquire(&db).is_err_and(|e| e.is_busy()) {
            let _ = child.kill();
            panic!("second process must be rejected");
        }
        writeln!(child.stdin.take().unwrap(), "exit").unwrap();
        assert_eq!(child.wait().unwrap().code(), Some(7));
        acquire(&db).expect("kernel must release crashed process lock");
    }
}
