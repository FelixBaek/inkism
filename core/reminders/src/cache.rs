//! Opaque background schedule cache. It holds only hashed note IDs and times,
//! so the background helper can deliver reminders without opening the library.

use crate::notify::Notifier;
use crate::{applock, hex, is_hex, Ctx, Error, Result};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

pub(crate) const MAX_TIMESTAMP: i64 = 8_640_000_000_000_000;
const MAX_CACHE_BYTES: usize = 16 << 20;
const HOUR_MS: i64 = 3_600_000;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(deny_unknown_fields, default)]
pub struct Schedule {
    pub id: String,
    pub at: i64,
    pub hours: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, default)]
pub struct Cache {
    pub version: i64,
    pub generation: u64,
    pub enabled: bool,
    pub updated_at: i64,
    #[serde(deserialize_with = "nullable")]
    pub schedules: Vec<Schedule>,
    #[serde(deserialize_with = "nullable")]
    pub delivered: HashMap<String, i64>,
}

/// Accepts JSON `null` as the default value (older writers emit null).
pub(crate) fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de> + Default>(
    d: D,
) -> std::result::Result<T, D::Error> {
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

/// Registers the OS task that runs the cache-only helper.
pub trait Scheduler: Send + Sync {
    fn enable(&self, ctx: &Ctx, id: &str) -> Result<()>;
    fn disable(&self, ctx: &Ctx, id: &str) -> Result<()>;
    /// Stable owner fingerprint written to the `.task` receipt; empty when the
    /// scheduler has no identity.
    fn ownership_id(&self) -> String {
        String::new()
    }
}

#[derive(Clone)]
pub struct Background {
    pub root: PathBuf,
    pub id: String,
    pub scheduler: Option<Arc<dyn Scheduler>>,
}

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct TaskReceipt {
    #[serde(default)]
    pub owner: String,
}

pub fn new_cache_id() -> Result<String> {
    let mut b = [0u8; 16];
    getrandom::getrandom(&mut b).map_err(|e| Error::msg(e.to_string()))?;
    Ok(hex(&b))
}

/// `<user config dir>/Inkism/ReminderCache`, following Go's `os.UserConfigDir`.
pub fn cache_root() -> Result<PathBuf> {
    Ok(user_config_dir()?.join("Inkism").join("ReminderCache"))
}

fn user_config_dir() -> Result<PathBuf> {
    let env = |k: &str| {
        std::env::var_os(k)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    if cfg!(windows) {
        return env("APPDATA").ok_or_else(|| Error::msg("%AppData% is not defined"));
    }
    if cfg!(target_os = "macos") {
        return env("HOME")
            .map(|h| h.join("Library/Application Support"))
            .ok_or_else(|| Error::msg("$HOME is not defined"));
    }
    if let Some(dir) = env("XDG_CONFIG_HOME") {
        return if dir.is_absolute() {
            Ok(dir)
        } else {
            Err(Error::msg("path in $XDG_CONFIG_HOME is relative"))
        };
    }
    env("HOME")
        .map(|h| h.join(".config"))
        .ok_or_else(|| Error::msg("neither $XDG_CONFIG_HOME nor $HOME are defined"))
}

pub(crate) fn create_private_dir(dir: &Path) -> Result<()> {
    let mut b = std::fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut b, 0o700);
    Ok(b.create(dir)?)
}

/// Atomically replaces `path` with the JSON of `value` (0600, fsynced).
pub(crate) fn write_private_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let raw = serde_json::to_vec(value)?;
    if raw.len() > MAX_CACHE_BYTES {
        return Err(Error::msg("reminder cache exceeds limit"));
    }
    let dir = path.parent().unwrap_or(Path::new("."));
    create_private_dir(dir)?;
    // tempfile creates the file 0600 and deletes it if anything below fails.
    let mut f = tempfile::Builder::new()
        .prefix(".reminder-cache-")
        .tempfile_in(dir)?;
    f.write_all(&raw)?;
    f.as_file().sync_all()?;
    f.persist(path).map_err(|e| e.error)?;
    Ok(())
}

pub(crate) fn read_cache(path: &Path) -> Result<Cache> {
    let mut f = std::fs::File::open(path)?;
    let size = f
        .metadata()
        .map_err(|_| Error::msg("invalid reminder cache size"))?
        .len();
    if size > MAX_CACHE_BYTES as u64 {
        return Err(Error::msg("invalid reminder cache size"));
    }
    let mut raw = Vec::with_capacity(size as usize);
    f.read_to_end(&mut raw)?;
    let value: Cache = serde_json::from_slice(&raw)?; // rejects trailing data and unknown fields
    if value.version != 1 || value.schedules.len() > 100_000 {
        return Err(Error::msg("invalid reminder cache"));
    }
    if value.schedules.iter().any(|e| {
        !is_hex(&e.id, 64) || !(0..=MAX_TIMESTAMP).contains(&e.at) || !valid_repeat(e.hours)
    }) {
        return Err(Error::msg("invalid cached schedule"));
    }
    if value
        .delivered
        .iter()
        .any(|(id, at)| !is_hex(id, 64) || !(0..=MAX_TIMESTAMP).contains(at))
    {
        return Err(Error::msg("invalid delivery receipt"));
    }
    Ok(value)
}

pub(crate) fn valid_repeat(hours: i64) -> bool {
    matches!(hours, 0 | 24 | 168)
}

impl Background {
    pub(crate) fn path(&self) -> Result<PathBuf> {
        if !is_hex(&self.id, 32) || !self.root.is_absolute() {
            return Err(Error::msg("invalid reminder cache identifier"));
        }
        Ok(self.root.join(format!("{}.json", self.id)))
    }

    fn task_receipt_path(&self) -> PathBuf {
        self.root.join(format!("{}.task", self.id))
    }

    fn locked<T>(&self, ctx: &Ctx, f: impl FnOnce(&Path) -> Result<T>) -> Result<T> {
        let path = self.path()?;
        create_private_dir(&self.root)?;
        loop {
            match applock::acquire(&path) {
                Ok(_lock) => return f(&path),
                Err(Error::Busy) => ctx.sleep(Duration::from_millis(20))?,
                Err(e) => return Err(e),
            }
        }
    }

    /// Bumps the generation with delivery off; the unlocked worker turns it on
    /// via [`Background::refresh`]. Then registers the OS task.
    pub fn enable(&self, ctx: &Ctx) -> Result<()> {
        let Some(scheduler) = &self.scheduler else {
            return Err(Error::msg("background scheduling unavailable"));
        };
        self.locked(ctx, |path| {
            let mut value = match read_cache(path) {
                Ok(v) => v,
                Err(e) if e.is_not_found() => Cache::default(),
                Err(e) => return Err(e),
            };
            value.version = 1;
            value.enabled = false;
            value.generation += 1;
            write_private_json(path, &value)
        })?;
        write_private_json(
            &self.task_receipt_path(),
            &TaskReceipt {
                owner: scheduler.ownership_id(),
            },
        )?;
        if let Err(e) = scheduler.enable(ctx, &self.id) {
            let _ = self.invalidate(ctx);
            return Err(e);
        }
        Ok(())
    }

    pub fn invalidate(&self, ctx: &Ctx) -> Result<()> {
        self.locked(ctx, |path| {
            let mut value = match read_cache(path) {
                Ok(v) => v,
                Err(e) if e.is_not_found() => return Ok(()),
                Err(e) => return Err(e),
            };
            value.enabled = false;
            value.generation += 1;
            write_private_json(path, &value)
        })
    }

    /// Removes the cache and the OS task. Returns the delivery receipts (when a
    /// cache existed) together with the outcome: receipts are valid even when
    /// the task cleanup failed. A lock failure is [`Error::CacheStillActive`].
    pub fn disable(&self, ctx: &Ctx) -> (Option<HashMap<String, i64>>, Result<()>) {
        let delivered = self.locked(ctx, |path| {
            let delivered = match read_cache(path) {
                Ok(v) => Some(v.delivered),
                Err(e) if e.is_not_found() => None,
                // Corrupt cache cannot authorize notifications; remove only this strict ID.
                Err(_) => Some(HashMap::new()),
            };
            match std::fs::remove_file(path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
                _ => Ok(delivered),
            }
        });
        let delivered = match delivered {
            Ok(d) => d,
            Err(e) => return (None, Err(Error::CacheStillActive(Box::new(e)))),
        };
        let result = match &self.scheduler {
            Some(s) => s.disable(ctx, &self.id),
            None => Ok(()),
        };
        if result.is_ok() {
            let _ = std::fs::remove_file(self.task_receipt_path());
        }
        (delivered, result)
    }

    pub fn refresh(
        &self,
        ctx: &Ctx,
        schedules: &[Schedule],
        seed: Option<&HashMap<String, i64>>,
        generation: u64,
    ) -> Result<()> {
        self.locked(ctx, |path| {
            let value = read_cache(path)?;
            if value.generation != generation {
                return Err(Error::msg("reminder schedule changed during refresh"));
            }
            let mut next = Cache {
                version: 1,
                generation,
                enabled: true,
                updated_at: now_millis(),
                schedules: schedules.to_vec(),
                delivered: HashMap::new(),
            };
            for entry in schedules {
                let mut best = value.delivered.get(&entry.id).copied();
                if let Some(&at) = seed.and_then(|s| s.get(&entry.id)) {
                    best = Some(best.map_or(at, |prior| prior.max(at)));
                }
                if let Some(at) = best {
                    next.delivered.insert(entry.id.clone(), at);
                }
            }
            write_private_json(path, &next)
        })
    }

    /// Opens only the strict opaque cache path. There is no engine, DB path,
    /// token, title or body available to this function or its helper command.
    pub fn fire(&self, ctx: &Ctx, now_ms: i64, send: &dyn Notifier) -> Result<()> {
        self.locked(ctx, |path| {
            let mut value = match read_cache(path) {
                Ok(v) => v,
                Err(e) if e.is_not_found() => return Ok(()),
                Err(e) => return Err(e),
            };
            if !value.enabled {
                return Ok(());
            }
            let pending = due_pending(&value, now_ms);
            if pending.is_empty() {
                return Ok(());
            }
            ctx.err()?;
            send.notify()?;
            value.delivered.extend(pending);
            write_private_json(path, &value)
        })
    }

    pub fn generation(&self, ctx: &Ctx) -> Result<u64> {
        self.locked(ctx, |path| Ok(read_cache(path)?.generation))
    }
}

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// The most recent repeat of a due schedule.
pub(crate) fn latest_occurrence(entry: &Schedule, now_ms: i64) -> i64 {
    let mut at = entry.at;
    if entry.hours > 0 {
        let step = entry.hours * HOUR_MS;
        at += (now_ms - at) / step * step;
    }
    at
}

/// The latest due occurrence of each schedule that has not been delivered yet.
fn due_pending(value: &Cache, now_ms: i64) -> HashMap<String, i64> {
    let mut pending = HashMap::new();
    for entry in value.schedules.iter().filter(|e| e.at <= now_ms) {
        let at = latest_occurrence(entry, now_ms);
        if value.delivered.get(&entry.id).is_none_or(|&old| old < at) {
            pending.insert(entry.id.clone(), at);
        }
    }
    pending
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::service::tests::Fake;
    use crate::Service;
    use std::sync::atomic::{AtomicI32, AtomicUsize, Ordering};
    use std::sync::Mutex;

    #[derive(Default)]
    pub(crate) struct FakeScheduler {
        pub enabled: AtomicUsize,
        pub disabled: AtomicUsize,
        pub err: Mutex<Option<String>>,
    }
    impl FakeScheduler {
        fn result(&self) -> Result<()> {
            self.err
                .lock()
                .unwrap()
                .clone()
                .map_or(Ok(()), |e| Err(Error::msg(e)))
        }
    }
    impl Scheduler for FakeScheduler {
        fn enable(&self, _: &Ctx, _: &str) -> Result<()> {
            self.enabled.fetch_add(1, Ordering::SeqCst);
            self.result()
        }
        fn disable(&self, _: &Ctx, _: &str) -> Result<()> {
            self.disabled.fetch_add(1, Ordering::SeqCst);
            self.result()
        }
    }

    pub(crate) fn fixture_cache() -> (tempfile::TempDir, Background, Arc<FakeScheduler>) {
        let dir = tempfile::tempdir().unwrap();
        let scheduler = Arc::new(FakeScheduler::default());
        let bg = Background {
            root: dir.path().to_path_buf(),
            id: new_cache_id().unwrap(),
            scheduler: Some(scheduler.clone()),
        };
        bg.enable(&Ctx::new()).unwrap();
        (dir, bg, scheduler)
    }

    pub(crate) fn seed_cache(bg: &Background, entries: &[Schedule]) {
        let generation = bg.generation(&Ctx::new()).unwrap();
        bg.refresh(&Ctx::new(), entries, None, generation).unwrap();
    }

    fn sched(c: char, at: i64, hours: i64) -> Schedule {
        Schedule {
            id: c.to_string().repeat(64),
            at,
            hours,
        }
    }

    #[test]
    fn closed_cache_repeat_sleep_retry_and_removal() {
        let (_dir, bg, scheduler) = fixture_cache();
        seed_cache(&bg, &[sched('a', 1000, 24)]);
        let sent = AtomicUsize::new(0);
        let fail = std::sync::atomic::AtomicBool::new(true);
        let send = || {
            if fail.load(Ordering::SeqCst) {
                return Err(Error::msg("notify failed"));
            }
            sent.fetch_add(1, Ordering::SeqCst);
            Ok(())
        };
        assert!(bg.fire(&Ctx::new(), 1000, &send).is_err(), "lost retry");
        fail.store(false, Ordering::SeqCst);
        for hours in [0, 0, 24 * 30, 24 * 30] {
            bg.fire(&Ctx::new(), 1000 + hours * HOUR_MS, &send).unwrap();
        }
        assert_eq!(sent.load(Ordering::SeqCst), 2);
        let (receipts, err) = bg.disable(&Ctx::new());
        err.unwrap();
        assert_eq!(receipts.unwrap().len(), 1);
        assert_eq!(scheduler.disabled.load(Ordering::SeqCst), 1);
        bg.fire(&Ctx::new(), now_millis(), &send).unwrap();
        assert_eq!(sent.load(Ordering::SeqCst), 2, "disabled delivery");
        for entry in std::fs::read_dir(&bg.root).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            assert!(
                !name.ends_with(".json") && !name.ends_with(".task"),
                "schedule privacy data retained: {name}"
            );
        }
    }

    #[test]
    fn cache_invalidation_rejects_stale_refresh() {
        let (_dir, bg, _) = fixture_cache();
        let entry = sched('b', 1000, 0);
        seed_cache(&bg, std::slice::from_ref(&entry));
        let old = bg.generation(&Ctx::new()).unwrap();
        bg.invalidate(&Ctx::new()).unwrap();
        assert!(
            bg.refresh(&Ctx::new(), std::slice::from_ref(&entry), None, old)
                .is_err(),
            "stale refresh re-enabled"
        );
        let count = AtomicUsize::new(0);
        let send = || {
            count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        };
        bg.fire(&Ctx::new(), now_millis(), &send).unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 0);
        seed_cache(&bg, &[]);
        bg.fire(&Ctx::new(), now_millis(), &send).unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 0, "removed note fired");
    }

    #[test]
    fn concurrent_helpers_only_deliver_once() {
        let (_dir, bg, _) = fixture_cache();
        seed_cache(&bg, &[sched('c', 0, 0)]);
        let count = AtomicI32::new(0);
        std::thread::scope(|s| {
            for _ in 0..2 {
                s.spawn(|| {
                    let ctx = Ctx::new().with_timeout(Duration::from_secs(1));
                    let send = || {
                        count.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(30));
                        Ok(())
                    };
                    bg.fire(&ctx, now_millis(), &send).unwrap();
                });
            }
        });
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn opaque_cache_rejects_paths_corruption_and_extra_fields() {
        let (_dir, mut bg, _) = fixture_cache();
        let path = bg.path().unwrap();
        let never = || -> Result<()> { panic!("invalid cache delivered") };
        for raw in [
            r#"{"version":1,"library":"secret.db"}"#,
            r#"{"version":1,"enabled":true,"schedules":[{"id":"not-opaque","at":0}]}"#,
            r#"{"version":1}{}"#,
        ] {
            std::fs::write(&path, raw).unwrap();
            assert!(
                bg.fire(&Ctx::new(), now_millis(), &never).is_err(),
                "invalid cache accepted: {raw}"
            );
        }
        bg.id = "../../notes.db".into();
        assert!(
            bg.fire(&Ctx::new(), now_millis(), &|| Ok(())).is_err(),
            "path traversal"
        );
    }

    #[test]
    fn cache_written_with_null_collections_still_reads() {
        let (_dir, bg, _) = fixture_cache();
        std::fs::write(bg.path().unwrap(), r#"{"version":1,"generation":3,"enabled":false,"updated_at":0,"schedules":null,"delivered":null}"#).unwrap();
        assert_eq!(bg.generation(&Ctx::new()).unwrap(), 3);
    }

    #[test]
    fn service_background_opt_in_stores_no_note_data() {
        let root = tempfile::tempdir().unwrap();
        let f = Fake::new(
            r#"{"ok":true,"data":[{"id":"private-note-id","title":"PRIVATE TITLE","preview":"PRIVATE BODY","reminder_at":2000,"reminder_repeat_hours":24}]}"#,
        );
        let calls = f.calls.clone();
        let s = Service::new(
            root.path().join("state.json"),
            Box::new(f),
            Box::new(|| Ok(())),
        )
        .unwrap();
        let scheduler = Arc::new(FakeScheduler::default());
        s.attach_background(root.path().join("cache"), Some(scheduler.clone()));
        assert!(
            s.set_background(&Ctx::new(), true).is_err(),
            "master opt-in bypass"
        );
        s.set_enabled(true).unwrap();
        s.set_background(&Ctx::new(), true).unwrap();
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "settings called engine while HTTP gate held"
        );
        s.poll(&Ctx::new(), 1000).unwrap();
        let bg = s.background().unwrap();
        let raw = std::fs::read_to_string(bg.path().unwrap()).unwrap();
        for secret in [
            "private-note-id",
            "PRIVATE TITLE",
            "PRIVATE BODY",
            "state.json",
        ] {
            assert!(!raw.contains(secret), "cache leak {secret}");
        }
        let delivered = AtomicUsize::new(0);
        let send = || {
            delivered.fetch_add(1, Ordering::SeqCst);
            Ok(())
        };
        bg.fire(&Ctx::new(), 2000, &send).unwrap();
        assert_eq!(delivered.load(Ordering::SeqCst), 1);
        s.set_enabled(false).unwrap();
        assert!(
            !s.background_enabled() && scheduler.disabled.load(Ordering::SeqCst) == 1,
            "master disable retained background"
        );
    }

    #[test]
    fn disable_does_not_claim_success_while_cache_locked() {
        let (_dir, bg, _) = fixture_cache();
        seed_cache(&bg, &[sched('d', 1000, 0)]);
        let _held = applock::acquire(bg.path().unwrap()).unwrap();
        let ctx = Ctx::new().with_timeout(Duration::from_millis(30));
        let (_, err) = bg.disable(&ctx);
        assert!(
            err.as_ref().is_err_and(Error::is_cache_still_active),
            "active cache not reported: {err:?}"
        );
    }

    #[test]
    fn task_cleanup_failure_still_disables_cache_and_can_retry() {
        let root = tempfile::tempdir().unwrap();
        let s = Service::new(
            root.path().join("state"),
            Box::new(Fake::new(r#"{"ok":true,"data":[]}"#)),
            Box::new(|| Ok(())),
        )
        .unwrap();
        let scheduler = Arc::new(FakeScheduler::default());
        s.attach_background(root.path().join("cache"), Some(scheduler.clone()));
        s.set_enabled(true).unwrap();
        s.set_background(&Ctx::new(), true).unwrap();
        *scheduler.err.lock().unwrap() = Some("task temporarily unavailable".into());
        assert!(s.set_enabled(false).is_err(), "cleanup failure hidden");
        assert!(
            !s.enabled() && !s.background_enabled(),
            "cache disabled but state claims enabled"
        );
        let called = std::sync::atomic::AtomicBool::new(false);
        s.background()
            .unwrap()
            .fire(&Ctx::new(), now_millis(), &|| {
                called.store(true, Ordering::SeqCst);
                Ok(())
            })
            .unwrap();
        assert!(!called.load(Ordering::SeqCst), "off still delivered");
        *scheduler.err.lock().unwrap() = None;
        s.set_enabled(false).expect("cleanup retry");
    }
}
