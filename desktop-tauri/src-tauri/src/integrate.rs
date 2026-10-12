//! Thin adapters between the shell's deadline-based calls and the
//! `core/local-api` engine process and session gate, which take a
//! `google_auth::Context`.

use google_auth::Context;
use local_api::engine::{self, Process};
use local_api::gate::{ResumeFn, StopFn};
use local_api::{Deadline, Engine, Result, SessionGate};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

fn context(deadline: Deadline) -> Context {
    Context::background().with_timeout(deadline.saturating_duration_since(Instant::now()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Start {
    Plain,
    NewEncrypted,
    Suspended,
    SuspendedEncrypted,
}

pub fn start(binary: &Path, database: &Path, how: Start) -> Result<Arc<Process>> {
    Ok(Arc::new(match how {
        Start::Plain => Process::start(binary, database)?,
        Start::NewEncrypted => Process::start_new_encrypted(binary, database)?,
        Start::Suspended => Process::start_suspended(binary, database),
        Start::SuspendedEncrypted => Process::start_suspended_encrypted(binary, database),
    }))
}

/// The process as the handler's engine.
pub fn engine(process: &Arc<Process>) -> Arc<dyn Engine> {
    process.clone()
}

pub fn resume(process: &Process, ctx: &Context) -> Result<()> {
    process.resume(ctx)
}

pub fn close(process: &Process) -> Result<()> {
    process.close()
}

/// Opens `library` with a short-lived engine to prove it is readable.
pub fn check_library(binary: &Path, library: &Path, deadline: Deadline) -> Result<()> {
    engine::check_library(&context(deadline), binary, library)
}

/// Returns the created library path.
pub fn copy_encrypted(process: &Process, deadline: Deadline, destination: &Path) -> Result<String> {
    Ok(process.copy_encrypted(&context(deadline), destination)?.to_string_lossy().into_owned())
}

/// `stop` closes the engine; `resume` restarts it (Go `NewSessionGate`).
pub fn new_gate(
    initially_locked: bool,
    stop: StopFn,
    resume: ResumeFn,
) -> Arc<SessionGate> {
    Arc::new(SessionGate::new(initially_locked, Some(stop), Some(resume)))
}

pub type Admission<'a> = local_api::gate::Admission<'a>;

/// Held while background work runs; `None` = locked (Go `gate.enter`).
pub fn enter(gate: &SessionGate) -> Option<Admission<'_>> {
    gate.enter()
}

/// The local gate as the Google controller's gate.
pub fn google_gate(gate: Arc<SessionGate>) -> Arc<dyn google_auth::host::SessionGate> {
    gate
}
