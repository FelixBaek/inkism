//! Inkism reminders: the opaque background schedule cache, the foreground
//! reminder poller, the Task Scheduler wiring and the per-vault app lock.

pub mod applock;
mod cache;
mod notify;
mod service;
mod task;
#[cfg(windows)]
mod task_windows;

pub use cache::{cache_root, new_cache_id, Background, Cache, Schedule, Scheduler};
#[cfg(windows)]
pub use notify::WindowsToast;
pub use notify::{system_notifier, NoopNotifier, Notifier};
pub use service::{Caller, Service, State};
pub use task::{
    native_scheduler, remove_owned_tasks, task_xml, TaskScheduler, TaskStore, TASK_PREFIX,
};

use std::fmt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug)]
pub enum Error {
    /// Another process (or handle) holds the vault or cache lock.
    Busy,
    /// The cache could not be stopped; the cause is attached.
    CacheStillActive(Box<Error>),
    TaskNotFound,
    Canceled,
    DeadlineExceeded,
    Io(std::io::Error),
    Json(serde_json::Error),
    Msg(String),
    Multiple(Vec<Error>),
}

impl Error {
    pub(crate) fn msg(s: impl Into<String>) -> Self {
        Error::Msg(s.into())
    }
    pub fn is_busy(&self) -> bool {
        matches!(self, Error::Busy)
    }
    pub fn is_cache_still_active(&self) -> bool {
        matches!(self, Error::CacheStillActive(_))
    }
    pub fn is_not_found(&self) -> bool {
        matches!(self, Error::Io(e) if e.kind() == std::io::ErrorKind::NotFound)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Busy => f.write_str(applock::BUSY_MESSAGE),
            Error::CacheStillActive(cause) => {
                write!(f, "알림 캐시 중지를 완료하지 못했습니다\n{cause}")
            }
            Error::TaskNotFound => f.write_str("reminder task not found"),
            Error::Canceled => f.write_str("context canceled"),
            Error::DeadlineExceeded => f.write_str("context deadline exceeded"),
            Error::Io(e) => e.fmt(f),
            Error::Json(e) => e.fmt(f),
            Error::Msg(s) => f.write_str(s),
            Error::Multiple(list) => {
                let parts: Vec<String> = list.iter().map(ToString::to_string).collect();
                f.write_str(&parts.join("\n"))
            }
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Cancellation and deadline for blocking calls (the Go `context.Context`).
/// Clones share the cancel flag.
#[derive(Clone, Default, Debug)]
pub struct Ctx {
    deadline: Option<Instant>,
    cancelled: Arc<AtomicBool>,
}

impl Ctx {
    pub fn new() -> Self {
        Self::default()
    }
    /// Child context sharing the cancel flag, ending at the earlier deadline.
    pub fn with_timeout(&self, timeout: Duration) -> Self {
        let at = Instant::now() + timeout;
        Ctx {
            deadline: Some(self.deadline.map_or(at, |d| d.min(at))),
            cancelled: self.cancelled.clone(),
        }
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
    pub fn err(&self) -> Result<()> {
        if self.cancelled.load(Ordering::SeqCst) {
            return Err(Error::Canceled);
        }
        match self.deadline {
            Some(d) if Instant::now() >= d => Err(Error::DeadlineExceeded),
            _ => Ok(()),
        }
    }
    /// Sleeps up to `d` (less if the deadline is nearer), then reports `err()`.
    pub(crate) fn sleep(&self, d: Duration) -> Result<()> {
        self.err()?;
        let d = self.deadline.map_or(d, |end| {
            d.min(end.saturating_duration_since(Instant::now()))
        });
        std::thread::sleep(d);
        self.err()
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Lowercase hex of exactly `len` characters.
pub(crate) fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Lexical path cleanup like Go's `filepath.Clean` (no filesystem access).
pub(crate) fn clean_path(p: &Path) -> PathBuf {
    let mut out: Vec<Component> = Vec::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => match out.last() {
                Some(Component::Normal(_)) => {
                    out.pop();
                }
                Some(Component::RootDir) | Some(Component::Prefix(_)) => {}
                _ => out.push(c),
            },
            _ => out.push(c),
        }
    }
    if out.is_empty() {
        return PathBuf::from(".");
    }
    out.iter().collect()
}

/// UTC RFC 3339 with whole seconds, e.g. `2026-10-11T03:04:05Z`.
pub(crate) fn rfc3339_utc(unix_secs: i64) -> String {
    let (days, secs) = (unix_secs.div_euclid(86_400), unix_secs.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        secs / 3600,
        secs / 60 % 60,
        secs % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_known_dates() {
        assert_eq!(rfc3339_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_utc(1_791_687_845), "2026-10-11T03:04:05Z");
        assert_eq!(rfc3339_utc(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn clean_path_lexical() {
        assert_eq!(
            clean_path(Path::new("/a/./b/../c//d")),
            PathBuf::from("/a/c/d")
        );
        assert_eq!(clean_path(Path::new("/../x")), PathBuf::from("/x"));
    }
}
