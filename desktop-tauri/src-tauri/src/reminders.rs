//! Reminder helper modes and the foreground poller (Go `reminder_command.go`,
//! `reminders_windows.go`).

use crate::integrate;
use inkism_reminders::{Background, Ctx, Error, Service};
use local_api::{Engine, SessionGate};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// `--reminder-cache <id>` and `--remove-reminder-tasks`. Runs before any
/// flag parsing, library lookup, engine or window: the helper only has an
/// opaque cache ID. `None` = not a reminder command.
pub fn command(args: &[String]) -> Option<inkism_reminders::Result<()>> {
    let mode = args.first().map(String::as_str).filter(|a| *a == "--reminder-cache" || *a == "--remove-reminder-tasks")?;
    Some((|| {
        let root = inkism_reminders::cache_root()?;
        let ctx = Ctx::new().with_timeout(Duration::from_secs(30));
        if mode == "--reminder-cache" {
            let [_, id] = args else {
                return Err(Error::Msg("opaque reminder cache ID required".into()));
            };
            let cache = Background { root, id: id.clone(), scheduler: None };
            return cache.fire(&ctx, now_ms(), &*inkism_reminders::system_notifier());
        }
        if args.len() != 1 {
            return Err(Error::Msg("unexpected reminder cleanup arguments".into()));
        }
        let scheduler = inkism_reminders::native_scheduler(std::env::current_exe()?)?;
        inkism_reminders::remove_owned_tasks(&ctx, &root, scheduler)
    })())
}

/// Background engine calls take the same admission as renderer requests;
/// checking the lock state first would race with a lock.
struct GatedEngine {
    engine: Arc<dyn Engine>,
    gate: Option<Arc<SessionGate>>,
}

impl inkism_reminders::Caller for GatedEngine {
    fn call(&self, ctx: &Ctx, request: &str) -> inkism_reminders::Result<String> {
        let _admission = match &self.gate {
            Some(gate) => Some(integrate::enter(gate).ok_or_else(|| Error::Msg("app is locked".into()))?),
            None => None,
        };
        ctx.err()?;
        // ponytail: Ctx exposes no deadline; the poller's calls are small.
        let raw = self.engine.call(Instant::now() + Duration::from_secs(30), request.as_bytes()).map_err(|e| Error::Msg(e.to_string()))?;
        String::from_utf8(raw).map_err(|e| Error::Msg(e.to_string()))
    }
}

/// Flushes and stops the poller.
pub type Stop = Box<dyn FnOnce()>;

/// Starts the poller; the returned stop flushes the background cache, then
/// waits for the poller to end. `None` when the settings cannot be read.
pub fn start(engine: &Arc<dyn Engine>, gate: Option<Arc<SessionGate>>, database: &Path) -> Option<(Arc<Service>, Stop)> {
    let mut state = database.as_os_str().to_owned();
    state.push(".reminders.json");
    let caller = GatedEngine { engine: engine.clone(), gate };
    let service = match Service::new(state, Box::new(caller), inkism_reminders::system_notifier()) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            eprintln!("알림 설정을 읽지 못했습니다: {e}");
            return None;
        }
    };
    if let (Ok(root), Ok(exe)) = (inkism_reminders::cache_root(), std::env::current_exe()) {
        if let Ok(scheduler) = inkism_reminders::native_scheduler(exe) {
            service.attach_background(root, Some(scheduler));
        }
    }
    let ctx = Ctx::new();
    let poller = {
        let (service, ctx) = (service.clone(), ctx.clone());
        std::thread::spawn(move || service.run(&ctx, |e| eprintln!("알림 확인 실패: {e}")))
    };
    let stop = {
        let service = service.clone();
        Box::new(move || {
            if let Err(e) = service.poll(&Ctx::new().with_timeout(Duration::from_secs(3)), now_ms()) {
                eprintln!("종료 전 알림 캐시 갱신 실패: {e}");
            }
            ctx.cancel();
            let _ = poller.join();
        }) as Stop
    };
    Some((service, stop))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_reminder_modes_are_claimed() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(command(&[]).is_none());
        assert!(command(&args(&["--db", "/x"])).is_none());
        assert!(command(&args(&["--use-library", "--reminder-cache"])).is_none());
        // Malformed helper invocations are claimed and rejected.
        assert!(command(&args(&["--reminder-cache"])).unwrap().is_err());
        assert!(command(&args(&["--reminder-cache", "a", "b"])).unwrap().is_err());
        assert!(command(&args(&["--remove-reminder-tasks", "x"])).unwrap().is_err());
    }
}
