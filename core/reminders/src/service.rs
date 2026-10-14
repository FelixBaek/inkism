//! Foreground reminder poller and the user's reminder settings.

use crate::cache::{
    latest_occurrence, now_millis, nullable, valid_repeat, write_private_json, MAX_TIMESTAMP,
};
use crate::notify::Notifier;
use crate::{hex, is_hex, Background, Ctx, Error, Result, Schedule, Scheduler};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

/// The storage engine's JSON request/response channel.
pub trait Caller: Send + Sync {
    fn call(&self, ctx: &Ctx, request: &str) -> Result<String>;
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct State {
    pub enabled: bool,
    pub background: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub cache_id: String,
    #[serde(deserialize_with = "nullable")]
    pub delivered: HashMap<String, i64>,
}

struct Inner {
    state: State,
    last_error: String,
    background_root: PathBuf,
    scheduler: Option<Arc<dyn Scheduler>>,
}

pub struct Service {
    inner: Mutex<Inner>,
    poll_mu: Mutex<()>,
    path: PathBuf,
    engine: Box<dyn Caller>,
    send: Box<dyn Notifier + Send + Sync>,
    wake: (Mutex<bool>, Condvar),
    bg: Mutex<Option<Arc<Background>>>,
    schedule_epoch: AtomicU64,
}

#[derive(Deserialize, Clone)]
struct ReminderItem {
    #[serde(default)]
    id: String,
    #[serde(default, rename = "reminder_at")]
    at: i64,
    #[serde(default, rename = "reminder_repeat_hours")]
    repeat: i64,
}

#[derive(Deserialize)]
struct PageResponse {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    error: String,
    #[serde(default, deserialize_with = "nullable")]
    data: Vec<ReminderItem>,
}

const PAGE: usize = 100;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Service {
    /// Loads `<path>` (missing = defaults). Corrupt state fails closed.
    pub fn new(
        path: impl Into<PathBuf>,
        engine: Box<dyn Caller>,
        send: Box<dyn Notifier + Send + Sync>,
    ) -> Result<Self> {
        let path = path.into();
        let state: State = match std::fs::read(&path) {
            Ok(raw) => serde_json::from_slice(&raw)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => State::default(),
            Err(e) => return Err(e.into()),
        };
        if !state.cache_id.is_empty() && !is_hex(&state.cache_id, 32) {
            return Err(Error::msg("invalid reminder cache ID"));
        }
        Ok(Service {
            inner: Mutex::new(Inner {
                state,
                last_error: String::new(),
                background_root: PathBuf::new(),
                scheduler: None,
            }),
            poll_mu: Mutex::new(()),
            path,
            engine,
            send,
            wake: (Mutex::new(false), Condvar::new()),
            bg: Mutex::new(None),
            schedule_epoch: AtomicU64::new(0),
        })
    }

    pub fn attach_background(
        &self,
        root: impl Into<PathBuf>,
        scheduler: Option<Arc<dyn Scheduler>>,
    ) {
        let mut inner = lock(&self.inner);
        inner.background_root = root.into();
        inner.scheduler = scheduler.clone();
        if !inner.state.cache_id.is_empty() {
            *lock(&self.bg) = Some(Arc::new(Background {
                root: inner.background_root.clone(),
                id: inner.state.cache_id.clone(),
                scheduler,
            }));
        }
    }

    pub fn last_error(&self) -> String {
        lock(&self.inner).last_error.clone()
    }
    pub fn enabled(&self) -> bool {
        lock(&self.inner).state.enabled
    }
    pub fn background_enabled(&self) -> bool {
        lock(&self.inner).state.background
    }
    pub fn background_available(&self) -> bool {
        lock(&self.inner).scheduler.is_some()
    }
    /// The attached background cache, if one was ever created.
    pub fn background(&self) -> Option<Arc<Background>> {
        lock(&self.bg).clone()
    }

    fn save(&self, state: &State) -> Result<()> {
        write_private_json(&self.path, state)
    }

    /// Makes [`Service::run`] poll now.
    pub fn wake(&self) {
        *lock(&self.wake.0) = true;
        self.wake.1.notify_all();
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<()> {
        let mut inner = lock(&self.inner);
        let mut cleanup = Ok(());
        if !enabled {
            if let Some(bg) = self.background() {
                let (delivered, err) =
                    bg.disable(&Ctx::new().with_timeout(Duration::from_secs(10)));
                if err.as_ref().is_err_and(Error::is_cache_still_active) {
                    return err;
                }
                cleanup = err;
                if let Some(d) = delivered {
                    inner.state.delivered = d;
                }
                inner.state.background = false;
            }
        }
        let old = inner.state.enabled;
        inner.state.enabled = enabled;
        if let Err(e) = self.save(&inner.state) {
            inner.state.enabled = old;
            return Err(e);
        }
        self.wake();
        cleanup
    }

    pub fn set_background(&self, ctx: &Ctx, enabled: bool) -> Result<()> {
        let mut inner = lock(&self.inner);
        if inner.scheduler.is_none() {
            return Err(Error::msg(
                "종료 중 알림은 Windows 앱에서 사용할 수 있습니다",
            ));
        }
        if enabled && !inner.state.enabled {
            return Err(Error::msg("먼저 시스템 알림을 켜 주세요"));
        }
        if inner.state.cache_id.is_empty() {
            if !enabled {
                return Ok(());
            }
            self.create_background_cache(&mut inner)?;
        }
        let bg = self
            .background()
            .ok_or_else(|| Error::msg("background reminder cache unavailable"))?;
        if enabled {
            self.enable_background(&mut inner, ctx, &bg)?;
        } else {
            self.disable_background(&mut inner, ctx, &bg)?;
        }
        self.wake();
        Ok(())
    }

    fn create_background_cache(&self, inner: &mut Inner) -> Result<()> {
        let id = crate::new_cache_id()?;
        inner.state.cache_id = id.clone();
        if let Err(e) = self.save(&inner.state) {
            inner.state.cache_id.clear();
            return Err(e);
        }
        *lock(&self.bg) = Some(Arc::new(Background {
            root: inner.background_root.clone(),
            id,
            scheduler: inner.scheduler.clone(),
        }));
        Ok(())
    }

    fn enable_background(&self, inner: &mut Inner, ctx: &Ctx, bg: &Background) -> Result<()> {
        if inner.state.background {
            return Ok(());
        }
        bg.enable(ctx)?;
        inner.state.background = true;
        if let Err(e) = self.save(&inner.state) {
            inner.state.background = false;
            let _ = bg.disable(ctx);
            return Err(e);
        }
        Ok(())
    }

    /// Turns off the background cache, keeping what it already delivered.
    fn disable_background(&self, inner: &mut Inner, ctx: &Ctx, bg: &Background) -> Result<()> {
        let (delivered, err) = bg.disable(ctx);
        if err.as_ref().is_err_and(Error::is_cache_still_active) {
            return err;
        }
        if let Some(d) = delivered {
            inner.state.delivered = d;
        }
        inner.state.background = false;
        self.save(&inner.state)?;
        err
    }

    /// Call before a schedule-changing mutation, never for source/body
    /// keystrokes. Does not take the service mutex or touch the engine.
    pub fn invalidate_cache(&self, ctx: &Ctx) -> Result<()> {
        self.schedule_epoch.fetch_add(1, Ordering::SeqCst);
        match self.background() {
            Some(bg) => bg.invalidate(ctx),
            None => Ok(()),
        }
    }

    fn fetch(&self, ctx: &Ctx, now: i64) -> Result<Vec<Schedule>> {
        let mut items = Vec::new();
        let mut after: Option<ReminderItem> = None;
        loop {
            ctx.err()?;
            let data = self.fetch_page(ctx, now, after.as_ref())?;
            append_schedules(&mut items, &data)?;
            if data.len() < PAGE {
                return Ok(items);
            }
            let last = data[data.len() - 1].clone();
            if let Some(a) = &after {
                if last.at < a.at || (last.at == a.at && last.id <= a.id) {
                    return Err(Error::msg("reminder cursor did not advance"));
                }
            }
            after = Some(last);
        }
    }

    /// Asks the engine for up to 100 due reminders after the cursor.
    fn fetch_page(
        &self,
        ctx: &Ctx,
        now: i64,
        after: Option<&ReminderItem>,
    ) -> Result<Vec<ReminderItem>> {
        let mut args = serde_json::json!({"op": "due_reminders", "now": now, "limit": PAGE});
        if let Some(a) = after {
            args["after_at"] = a.at.into();
            args["after_id"] = a.id.clone().into();
        }
        let raw = self.engine.call(ctx, &args.to_string())?;
        let response: PageResponse = serde_json::from_str(&raw)?;
        if !response.ok {
            return Err(Error::Msg(response.error));
        }
        Ok(response.data)
    }

    fn lock_poll(&self, ctx: &Ctx) -> Result<MutexGuard<'_, ()>> {
        loop {
            match self.poll_mu.try_lock() {
                Ok(g) => return Ok(g),
                Err(std::sync::TryLockError::Poisoned(p)) => return Ok(p.into_inner()),
                Err(std::sync::TryLockError::WouldBlock) => ctx.sleep(Duration::from_millis(20))?,
            }
        }
    }

    /// One poll at `now_ms` (unix milliseconds). Records the outcome for
    /// [`Service::last_error`].
    pub fn poll(&self, ctx: &Ctx, now_ms: i64) -> Result<()> {
        let _guard = self.lock_poll(ctx)?;
        let result = self.poll_locked(ctx, now_ms);
        lock(&self.inner).last_error = result
            .as_ref()
            .err()
            .map(ToString::to_string)
            .unwrap_or_default();
        result
    }

    fn poll_locked(&self, ctx: &Ctx, now_ms: i64) -> Result<()> {
        let (enabled, background) = {
            let inner = lock(&self.inner);
            (inner.state.enabled, inner.state.background)
        };
        let bg = self.background();
        if !enabled {
            return Ok(());
        }
        let epoch = self.schedule_epoch.load(Ordering::SeqCst);
        let generation = match (background, &bg) {
            (false, _) => 0,
            (true, None) => return Err(Error::msg("background reminder cache unavailable")),
            (true, Some(bg)) => bg.generation(ctx)?,
        };
        let bound = if background { MAX_TIMESTAMP } else { now_ms };
        // No service mutex is held while the engine is called.
        let items = self.fetch(ctx, bound)?;
        let mut inner = lock(&self.inner);
        if !inner.state.enabled {
            return Ok(());
        }
        if background != inner.state.background
            || epoch != self.schedule_epoch.load(Ordering::SeqCst)
        {
            self.wake();
            return Ok(());
        }
        if let (true, Some(bg)) = (background, bg) {
            bg.refresh(ctx, &items, Some(&inner.state.delivered), generation)?;
            return bg.fire(ctx, now_ms, &*self.send);
        }
        self.deliver_foreground(&mut inner, &items, now_ms)
    }

    /// Notifies once for due items and records them, dropping delivery marks
    /// for schedules that no longer exist.
    fn deliver_foreground(&self, inner: &mut Inner, items: &[Schedule], now_ms: i64) -> Result<()> {
        let mut pending = HashMap::new();
        let mut seen = HashSet::new();
        for entry in items.iter().filter(|e| e.at <= now_ms) {
            let at = latest_occurrence(entry, now_ms);
            seen.insert(entry.id.as_str());
            if inner.state.delivered.get(&entry.id).is_none_or(|&d| d < at) {
                pending.insert(entry.id.clone(), at);
            }
        }
        if pending.is_empty() {
            return Ok(());
        }
        self.send.notify()?;
        let mut next: HashMap<String, i64> = inner
            .state
            .delivered
            .iter()
            .filter(|(k, _)| seen.contains(k.as_str()))
            .map(|(k, v)| (k.clone(), *v))
            .collect();
        next.extend(pending);
        let old = std::mem::replace(&mut inner.state.delivered, next);
        if let Err(e) = self.save(&inner.state) {
            inner.state.delivered = old;
            return Err(e);
        }
        Ok(())
    }

    /// Polls every 15 seconds or on [`Service::wake`] until `ctx` ends.
    pub fn run(&self, ctx: &Ctx, report: impl Fn(Error)) {
        const TICK: Duration = Duration::from_secs(15);
        loop {
            if let Err(e) = self.poll(ctx, now_millis()) {
                report(e);
            }
            let started = std::time::Instant::now();
            let mut woken = lock(&self.wake.0);
            loop {
                if ctx.err().is_err() {
                    return;
                }
                if std::mem::take(&mut *woken) || started.elapsed() >= TICK {
                    break;
                }
                // ponytail: 100ms slices so cancellation is noticed; Ctx has no waker.
                woken = self
                    .wake
                    .1
                    .wait_timeout(woken, Duration::from_millis(100))
                    .unwrap_or_else(PoisonError::into_inner)
                    .0;
            }
        }
    }
}

/// Validates a page and adds it as opaque hashed schedules.
fn append_schedules(items: &mut Vec<Schedule>, data: &[ReminderItem]) -> Result<()> {
    for entry in data {
        if !(0..=MAX_TIMESTAMP).contains(&entry.at) || !valid_repeat(entry.repeat) {
            return Err(Error::msg("invalid reminder schedule"));
        }
        items.push(Schedule {
            id: hex(&Sha256::digest(entry.id.as_bytes())),
            at: entry.at,
            hours: entry.repeat,
        });
    }
    if items.len() > 100_000 {
        return Err(Error::msg("알림 예약은 최대 100000개까지 지원합니다"));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize};

    pub(crate) struct Fake {
        pub raw: Arc<Mutex<String>>,
        pub calls: Arc<AtomicUsize>,
    }
    impl Fake {
        pub fn new(raw: &str) -> Self {
            Fake {
                raw: Arc::new(Mutex::new(raw.into())),
                calls: Arc::default(),
            }
        }
    }
    impl Caller for Fake {
        fn call(&self, _: &Ctx, _: &str) -> Result<String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.raw.lock().unwrap().clone())
        }
    }
    struct Shared(Arc<Fake>);
    impl Caller for Shared {
        fn call(&self, ctx: &Ctx, req: &str) -> Result<String> {
            self.0.call(ctx, req)
        }
    }

    fn counter_send(
        sent: &Arc<AtomicUsize>,
        fail: &Arc<AtomicBool>,
    ) -> Box<dyn Notifier + Send + Sync> {
        let (sent, fail) = (sent.clone(), fail.clone());
        Box::new(move || {
            if fail.load(Ordering::SeqCst) {
                return Err(Error::msg("offline"));
            }
            sent.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    }

    const HOUR: i64 = 3_600_000;

    #[test]
    fn opt_in_retry_restart_and_changed_occurrence() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("state.json");
        let f = Arc::new(Fake::new(
            r#"{"ok":true,"data":[{"id":"secret-note","reminder_at":100}]}"#,
        ));
        let sent = Arc::new(AtomicUsize::new(0));
        let fail = Arc::new(AtomicBool::new(true));
        let ctx = Ctx::new();
        let s = Service::new(&p, Box::new(Shared(f.clone())), counter_send(&sent, &fail)).unwrap();
        s.poll(&ctx, now_millis()).unwrap();
        assert_eq!(f.calls.load(Ordering::SeqCst), 0, "disabled poll");
        s.set_enabled(true).unwrap();
        assert!(s.poll(&ctx, now_millis()).is_err(), "missing failure");
        assert_eq!(s.last_error(), "offline");
        fail.store(false, Ordering::SeqCst);
        for _ in 0..3 {
            s.poll(&ctx, now_millis()).unwrap();
        }
        assert_eq!(sent.load(Ordering::SeqCst), 1);
        assert_eq!(s.last_error(), "");
        let s = Service::new(&p, Box::new(Shared(f.clone())), counter_send(&sent, &fail)).unwrap();
        let _ = s.poll(&ctx, now_millis());
        assert_eq!(sent.load(Ordering::SeqCst), 1, "restart duplicate");
        assert!(
            !std::fs::read_to_string(&p).unwrap().contains("secret-note"),
            "metadata leaked"
        );
        *f.raw.lock().unwrap() =
            r#"{"ok":true,"data":[{"id":"secret-note","reminder_at":200}]}"#.into();
        let _ = s.poll(&ctx, now_millis());
        assert_eq!(sent.load(Ordering::SeqCst), 2, "reschedule suppressed");
        s.set_enabled(false).unwrap();
        let _ = s.poll(&ctx, now_millis());
        assert_eq!(sent.load(Ordering::SeqCst), 2, "disabled delivery");
    }

    #[test]
    fn corrupt_state_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("state.json");
        std::fs::write(&p, "bad").unwrap();
        assert!(
            Service::new(&p, Box::new(Fake::new("")), Box::new(|| Ok(()))).is_err(),
            "corruption ignored"
        );
    }

    #[test]
    fn repeat_sleep_and_cancellation() {
        let dir = tempfile::tempdir().unwrap();
        let f = Arc::new(Fake::new(
            r#"{"ok":true,"data":[{"id":"n","reminder_at":1000,"reminder_repeat_hours":24}]}"#,
        ));
        let sent = Arc::new(AtomicUsize::new(0));
        let s = Service::new(
            dir.path().join("state"),
            Box::new(Shared(f.clone())),
            counter_send(&sent, &Arc::default()),
        )
        .unwrap();
        s.set_enabled(true).unwrap();
        for hour in [0, 0, 1, 24, 24, 24 * 30, 24 * 30] {
            s.poll(&Ctx::new(), 1000 + hour * HOUR).unwrap();
        }
        assert_eq!(sent.load(Ordering::SeqCst), 3);
        *f.raw.lock().unwrap() = r#"{"ok":true,"data":[]}"#.into();
        let _ = s.poll(&Ctx::new(), 1000 + 31 * 24 * HOUR);
        assert_eq!(
            sent.load(Ordering::SeqCst),
            3,
            "cancelled reminder delivered"
        );
    }

    struct PageCaller {
        calls: AtomicUsize,
    }
    impl Caller for PageCaller {
        fn call(&self, _: &Ctx, raw: &str) -> Result<String> {
            let req: serde_json::Value = serde_json::from_str(raw).unwrap();
            self.calls.fetch_add(1, Ordering::SeqCst);
            let data: Vec<serde_json::Value> = match req.get("after_id") {
                None => (0..100)
                    .map(|i| serde_json::json!({"id": format!("n-{i:03}"), "reminder_at": 1000}))
                    .collect(),
                Some(id) if id == "n-099" => {
                    vec![serde_json::json!({"id": "n-100", "reminder_at": 1000})]
                }
                Some(_) => return Err(Error::msg("wrong cursor")),
            };
            Ok(serde_json::json!({"ok": true, "data": data}).to_string())
        }
    }
    struct SharedPage(Arc<PageCaller>);
    impl Caller for SharedPage {
        fn call(&self, ctx: &Ctx, req: &str) -> Result<String> {
            self.0.call(ctx, req)
        }
    }

    #[test]
    fn paged_due_list_coalesces_and_cancellation() {
        let dir = tempfile::tempdir().unwrap();
        let f = Arc::new(PageCaller {
            calls: AtomicUsize::new(0),
        });
        let sent = Arc::new(AtomicUsize::new(0));
        let s = Service::new(
            dir.path().join("state"),
            Box::new(SharedPage(f.clone())),
            counter_send(&sent, &Arc::default()),
        )
        .unwrap();
        s.set_enabled(true).unwrap();
        s.poll(&Ctx::new(), 2000).unwrap();
        let delivered = lock(&s.inner).state.delivered.len();
        assert_eq!(
            (
                sent.load(Ordering::SeqCst),
                f.calls.load(Ordering::SeqCst),
                delivered
            ),
            (1, 2, 101)
        );
        s.poll(&Ctx::new(), 2000).unwrap();
        assert_eq!(sent.load(Ordering::SeqCst), 1, "duplicate");
        let ctx = Ctx::new();
        ctx.cancel();
        let calls = f.calls.load(Ordering::SeqCst);
        assert!(matches!(s.poll(&ctx, now_millis()), Err(Error::Canceled)));
        assert_eq!(
            f.calls.load(Ordering::SeqCst),
            calls,
            "cancelled poll read engine"
        );
    }
}
