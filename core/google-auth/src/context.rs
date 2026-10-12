//! A minimal cancellation context: a cancel flag, an optional deadline and a
//! parent. Cancelling a parent cancels every child; children never cancel
//! parents.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
pub struct Context(Arc<Inner>);

#[derive(Default)]
struct Inner {
    cancelled: AtomicBool,
    deadline: Option<Instant>,
    parent: Option<Context>,
}

// ponytail: waiters poll at this interval; switch to a condvar fan-out if
// cancellation latency ever matters.
pub(crate) const POLL: Duration = Duration::from_millis(5);

impl Context {
    /// A root context that is never cancelled unless `cancel` is called.
    pub fn background() -> Self {
        Self::default()
    }

    /// A child that can be cancelled independently of `self`.
    pub fn child(&self) -> Self {
        Self(Arc::new(Inner {
            parent: Some(self.clone()),
            ..Inner::default()
        }))
    }

    /// A child that is done after `timeout` elapses.
    pub fn with_timeout(&self, timeout: Duration) -> Self {
        Self(Arc::new(Inner {
            deadline: Some(Instant::now() + timeout),
            parent: Some(self.clone()),
            ..Inner::default()
        }))
    }

    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::SeqCst);
    }

    /// True once this context or any ancestor is cancelled or past its deadline.
    pub fn is_done(&self) -> bool {
        self.0.cancelled.load(Ordering::SeqCst)
            || self.0.deadline.is_some_and(|d| Instant::now() >= d)
            || self.0.parent.as_ref().is_some_and(Context::is_done)
    }

    /// Waits for a value on `rx`; `None` when the context is done first or
    /// the sender disappears.
    pub(crate) fn recv<T>(&self, rx: &mpsc::Receiver<T>) -> Option<T> {
        loop {
            if self.is_done() {
                return None;
            }
            match rx.recv_timeout(POLL) {
                Ok(v) => return Some(v),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return None,
            }
        }
    }

    /// Runs blocking `work` on a helper thread and returns its result, or
    /// `None` as soon as the context is done. An abandoned call finishes in
    /// the background, bounded by its own client timeout.
    pub(crate) fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Option<T> {
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = tx.send(work());
        });
        self.recv(&rx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_cancel_and_deadline_propagate() {
        let root = Context::background();
        let child = root.child();
        let timed = child.with_timeout(Duration::from_millis(10));
        assert!(!timed.is_done());
        thread::sleep(Duration::from_millis(20));
        assert!(timed.is_done() && !child.is_done());
        child.cancel();
        assert!(child.is_done() && !root.is_done());
        let other = root.child();
        root.cancel();
        assert!(other.is_done());
    }
}
