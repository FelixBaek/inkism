//! JSONL engine child process (Go `engine.go`, `attachments.go` engine half,
//! `encrypted_copy.go`, the suspended start/resume half of `session_gate.go`).

use crate::{Deadline, Result};
use google_auth::Context;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

pub const MAX_MESSAGE: usize = 64 << 20;

const STOPPED: &str = "저장 엔진이 종료되었습니다. 앱을 다시 실행해 주세요";
const DEADLINE: &str = "context deadline exceeded";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(3);
const POLL: Duration = Duration::from_millis(10);

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentMetadata {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub size: u64,
    pub sha256: String,
}

/// Attachment commands run as separate engine invocations (Go `attachmentCommand`).
pub trait Attachments: Send + Sync {
    fn import(
        &self,
        deadline: Deadline,
        name: &str,
        media_type: &str,
        input: &mut dyn Read,
    ) -> Result<AttachmentMetadata>;
    fn info(&self, deadline: Deadline, id: &str) -> Result<AttachmentMetadata>;
    fn export(&self, deadline: Deadline, id: &str, output: &mut dyn Write) -> Result<()>;
    fn walk(
        &self,
        deadline: Deadline,
        visit: &mut dyn FnMut(AttachmentMetadata) -> Result<()>,
    ) -> Result<()>;
}

/// What handlers need from the engine. Tests use fakes; `Process` is the real one.
pub trait Engine: Send + Sync {
    /// One ordered request/response pair on the JSONL stream.
    fn call(&self, deadline: Deadline, request: &[u8]) -> Result<Vec<u8>>;
    fn attachments(&self) -> Option<&dyn Attachments> {
        None
    }
    /// The library file; sidecar paths (`.reminders.json`, `.unsplash-key`) hang off it.
    fn database(&self) -> Option<&Path> {
        None
    }
}

/// The real child process. It serializes the ordered JSONL stream; a missed
/// deadline kills a wedged child so a late answer is never read as the next one.
pub struct Process {
    binary: PathBuf,
    database: PathBuf,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    child: Option<Child>,
    stopped: bool,
    waited: bool,
    initialize_on_resume: bool,
}

/// One running engine. Pump threads own the pipes, so a blocked write or
/// read is bounded by the caller's deadline, never by the child.
struct Child {
    process: std::process::Child,
    requests: Option<mpsc::Sender<Vec<u8>>>,
    responses: mpsc::Receiver<io::Result<Vec<u8>>>,
}

/// Every engine spawn: no console window on Windows.
fn command(binary: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn spawn(binary: &Path, database: &Path, initialize_encrypted: bool) -> io::Result<Child> {
    let mut cmd = command(binary);
    cmd.arg("--db").arg(database);
    if initialize_encrypted {
        cmd.arg("--initialize-encrypted");
    }
    let mut process = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;
    let mut stdin = process.stdin.take().expect("piped stdin");
    let stdout = process.stdout.take().expect("piped stdout");
    let (request_tx, request_rx) = mpsc::channel::<Vec<u8>>();
    let (response_tx, responses) = mpsc::channel();
    let write_failed = response_tx.clone();
    std::thread::spawn(move || {
        for line in request_rx {
            if let Err(e) = stdin.write_all(&line).and_then(|_| stdin.flush()) {
                let _ = write_failed.send(Err(e));
                return;
            }
        }
    });
    std::thread::spawn(move || {
        let mut reader = BufReader::with_capacity(65536, stdout);
        loop {
            let line = read_line(&mut reader, MAX_MESSAGE);
            let end = line.is_err();
            if response_tx.send(line).is_err() || end {
                return;
            }
        }
    });
    Ok(Child {
        process,
        requests: Some(request_tx),
        responses,
    })
}

/// One line without its `\n` (and a trailing `\r`, as `bufio.ScanLines` drops).
fn read_line(reader: &mut impl BufRead, max: usize) -> io::Result<Vec<u8>> {
    let mut line = Vec::new();
    reader.take(max as u64 + 1).read_until(b'\n', &mut line)?;
    if line.last() == Some(&b'\n') {
        line.pop();
    } else if line.len() > max {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "token too long"));
    } else if line.is_empty() {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "EOF"));
    }
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    Ok(line)
}

fn valid_json(raw: &[u8]) -> bool {
    serde_json::from_slice::<serde::de::IgnoredAny>(raw).is_ok()
}

/// Go `json.Compact` on already-valid JSON: drops formatting whitespace and
/// keeps every string escape and number exactly as written.
pub(crate) fn compact(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len() + 1);
    let (mut in_string, mut escaped) = (false, false);
    for &b in raw {
        if in_string {
            out.push(b);
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
        } else if !matches!(b, b' ' | b'\t' | b'\n' | b'\r') {
            in_string = b == b'"';
            out.push(b);
        }
    }
    out
}

fn status_error(status: ExitStatus) -> Result<()> {
    if status.success() {
        return Ok(());
    }
    if let Some(code) = status.code() {
        return Err(format!("exit status {code}").into());
    }
    Err("signal: killed".into())
}

impl Process {
    pub fn start(binary: impl Into<PathBuf>, database: impl Into<PathBuf>) -> Result<Process> {
        Self::start_with(binary.into(), database.into(), false)
    }

    /// Provisions only a new library; keys never cross this bridge.
    pub fn start_new_encrypted(
        binary: impl Into<PathBuf>,
        database: impl Into<PathBuf>,
    ) -> Result<Process> {
        Self::start_with(binary.into(), database.into(), true)
    }

    /// Launches nothing and touches no library before authentication.
    pub fn start_suspended(binary: impl Into<PathBuf>, database: impl Into<PathBuf>) -> Process {
        let state = State {
            stopped: true,
            waited: true,
            ..State::default()
        };
        Process {
            binary: binary.into(),
            database: database.into(),
            state: Mutex::new(state),
        }
    }

    pub fn start_suspended_encrypted(
        binary: impl Into<PathBuf>,
        database: impl Into<PathBuf>,
    ) -> Process {
        let p = Self::start_suspended(binary, database);
        p.lock().initialize_on_resume = true;
        p
    }

    fn start_with(
        binary: PathBuf,
        database: PathBuf,
        initialize_encrypted: bool,
    ) -> Result<Process> {
        let child = spawn(&binary, &database, initialize_encrypted)?;
        let p = Process {
            binary,
            database,
            state: Mutex::new(State {
                child: Some(child),
                ..State::default()
            }),
        };
        let health = {
            let mut s = p.lock();
            call_locked(
                &mut s,
                Instant::now() + HEALTH_TIMEOUT,
                br#"{"op":"health"}"#,
            )
        };
        match health {
            Ok(response) if crate::success(&response) => Ok(p),
            Ok(response) => {
                let _ = p.close();
                Err(format!(
                    "engine initialization failed: {}",
                    String::from_utf8_lossy(&response)
                )
                .into())
            }
            Err(e) => {
                let _ = p.close();
                Err(e)
            }
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Starts the engine after a lock or a suspended start. Refuses while a
    /// stopped child has not been reaped by `close`.
    pub fn resume(&self, ctx: &Context) -> Result<()> {
        let mut s = self.lock();
        if ctx.is_done() {
            return Err("context canceled".into());
        }
        if !s.stopped {
            return Ok(());
        }
        if !s.waited {
            return Err("engine shutdown has not completed".into());
        }
        let resumed = Self::start_with(
            self.binary.clone(),
            self.database.clone(),
            s.initialize_on_resume,
        )?;
        if ctx.is_done() {
            let _ = resumed.close();
            return Err("context canceled".into());
        }
        s.child = resumed.lock().child.take();
        s.stopped = false;
        s.waited = false;
        s.initialize_on_resume = false;
        Ok(())
    }

    /// Closes stdin, waits up to 3 s, then kills. Every child is reaped once.
    pub fn close(&self) -> Result<()> {
        close_locked(&mut self.lock())
    }

    /// Kills the child without a clean shutdown, as a crash would. `close`
    /// still reaps it.
    pub fn kill(&self) {
        let mut s = self.lock();
        s.stopped = true;
        if let Some(child) = s.child.as_mut() {
            let _ = child.process.kill();
        }
    }

    /// Copies the closed library into a new encrypted directory and returns
    /// `<destination>/notes.db`. Holds the RPC order while offline and always
    /// reopens the ORIGINAL library, also after a failed or cancelled copy.
    /// The host must flush editor drafts first.
    pub fn copy_encrypted(&self, ctx: &Context, destination: &Path) -> Result<PathBuf> {
        if !destination.is_absolute() {
            return Err("암호화 복사 위치는 절대 경로여야 합니다".into());
        }
        match std::fs::symlink_metadata(destination) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
            Ok(_) => return Err("암호화 복사는 새 폴더에만 만들 수 있습니다".into()),
        }
        let mut s = self.lock();
        if ctx.is_done() {
            return Err("context canceled".into());
        }
        if s.stopped {
            return Err(STOPPED.into());
        }
        let copied = match close_locked(&mut s) {
            Err(e) => Err(format!(
                "저장 엔진 종료를 확인하지 못해 복사를 중단했습니다: {e}"
            )),
            Ok(()) => {
                let mut cmd = command(&self.binary);
                cmd.arg("--db")
                    .arg(&self.database)
                    .arg("--copy-encrypted-to")
                    .arg(destination);
                let mut output = Vec::new();
                match run(
                    cmd,
                    &|| ctx.is_done(),
                    None,
                    &mut |chunk| {
                        output.extend_from_slice(chunk);
                        Ok(())
                    },
                    true,
                ) {
                    Ok(()) => Ok(destination.join("notes.db")),
                    Err(e) => Err(format!(
                        "암호화 복사 실패: {e}\n{}",
                        String::from_utf8_lossy(&output)
                    )),
                }
            }
        };
        // Reopening never uses the copy's context: a timeout must not prevent
        // recovery of the original library. Start has its own health deadline.
        match Self::start_with(self.binary.clone(), self.database.clone(), false) {
            Ok(resumed) => {
                s.child = resumed.lock().child.take();
                s.stopped = false;
                s.waited = false;
                Ok(copied?)
            }
            Err(e) => {
                let reopen =
                    format!("원래 저장소를 다시 열지 못했습니다. 앱을 다시 실행해 주세요: {e}");
                Err(match copied {
                    Ok(_) => reopen,
                    Err(c) => format!("{c}\n{reopen}"),
                }
                .into())
            }
        }
    }

    /// Starts no workers and changes no schema; the current runtime stays live.
    pub fn check_library(&self, ctx: &Context, path: &Path) -> Result<()> {
        check_library(ctx, &self.binary, path)
    }

    fn attachment_command(
        &self,
        deadline: Deadline,
        input: Option<&mut dyn Read>,
        output: &mut dyn Write,
        args: &[&str],
    ) -> Result<()> {
        let mut cmd = command(&self.binary);
        cmd.arg("--db").arg(&self.database).args(args);
        run(
            cmd,
            &|| Instant::now() >= deadline,
            input,
            &mut |chunk| Ok(output.write_all(chunk)?),
            false,
        )
        .map_err(|e| format!("첨부파일 처리 실패: {e}").into())
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

/// Opens a library only to check that it can be read and decrypted.
pub fn check_library(ctx: &Context, binary: &Path, path: &Path) -> Result<()> {
    let mut cmd = command(binary);
    cmd.arg("--db").arg(path).arg("--check-library");
    let mut output = Vec::new();
    run(
        cmd,
        &|| ctx.is_done(),
        None,
        &mut |chunk| {
            output.extend_from_slice(chunk);
            Ok(())
        },
        true,
    )
    .map_err(|e| {
        format!(
            "선택한 저장소를 열 수 없습니다: {e}\n{}",
            String::from_utf8_lossy(&output)
        )
        .into()
    })
}

fn call_locked(s: &mut State, deadline: Deadline, request: &[u8]) -> Result<Vec<u8>> {
    if request.len() > MAX_MESSAGE - 1 || !valid_json(request) {
        return Err("invalid or oversized request".into());
    }
    if s.stopped {
        return Err(STOPPED.into());
    }
    let Some(child) = s.child.as_mut() else {
        return Err(STOPPED.into());
    };
    let now = Instant::now();
    if now >= deadline {
        return Err(DEADLINE.into());
    }
    let mut line = compact(request);
    line.push(b'\n');
    let sent = child
        .requests
        .as_ref()
        .is_some_and(|tx| tx.send(line).is_ok());
    let outcome: Result<Vec<u8>> = if !sent {
        Err("broken pipe".into())
    } else {
        match child.responses.recv_timeout(deadline - now) {
            Ok(Ok(data)) if valid_json(&data) => return Ok(data),
            Ok(Ok(_)) => Err("invalid engine response".into()),
            Ok(Err(e)) => Err(e.into()),
            Err(mpsc::RecvTimeoutError::Timeout) => Err(DEADLINE.into()),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err("EOF".into()),
        }
    };
    s.stopped = true;
    let _ = child.process.kill();
    outcome
}

fn close_locked(s: &mut State) -> Result<()> {
    if s.waited {
        return Ok(());
    }
    s.waited = true;
    s.stopped = true;
    let Some(mut child) = s.child.take() else {
        return Ok(());
    };
    child.requests = None; // the writer thread drops stdin
    let end = Instant::now() + CLOSE_TIMEOUT;
    loop {
        if let Some(status) = child.process.try_wait()? {
            return status_error(status);
        }
        if Instant::now() >= end {
            let _ = child.process.kill();
            return status_error(child.process.wait()?);
        }
        std::thread::sleep(POLL);
    }
}

/// Runs one engine command to completion. `stop` (deadline or cancellation)
/// kills it. Stdout chunks go to `output` as they arrive; an error from
/// `output` kills the child. `combined` also sends stderr to `output`
/// (`CombinedOutput`); otherwise stderr is attached to the error.
fn run(
    mut cmd: Command,
    stop: &(dyn Fn() -> bool + Sync),
    input: Option<&mut dyn Read>,
    output: &mut dyn FnMut(&[u8]) -> Result<()>,
    combined: bool,
) -> Result<()> {
    let stdin = if input.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    };
    let mut process = cmd
        .stdin(stdin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let child_stdin = process.stdin.take();
    let stdout = process.stdout.take().expect("piped stdout");
    let stderr = process.stderr.take().expect("piped stderr");
    let process = Mutex::new(process);
    let kill = || {
        let _ = process.lock().unwrap_or_else(|e| e.into_inner()).kill();
    };
    let (chunks_tx, chunks) = mpsc::channel::<(bool, Vec<u8>)>();
    let err_tx = chunks_tx.clone();
    let finished = AtomicBool::new(false);
    std::thread::scope(|scope| -> Result<()> {
        scope.spawn(move || pump(stdout, false, &chunks_tx));
        scope.spawn(move || pump(stderr, true, &err_tx));
        let watchdog = scope.spawn(|| watch(&finished, stop, kill));
        if let (Some(input), Some(mut stdin)) = (input, child_stdin) {
            // A write error means the child exited; its status explains why.
            let _ = io::copy(input, &mut stdin);
        }
        let (failure, diagnostic) = drain(chunks, combined, &mut *output, kill);
        let status = process.lock().unwrap_or_else(|e| e.into_inner()).wait();
        finished.store(true, Ordering::SeqCst);
        let _ = watchdog.join();
        if let Some(e) = failure {
            return Err(e);
        }
        status_error(status?).map_err(|e| {
            if diagnostic.is_empty() {
                e
            } else {
                format!("{e}: {}", String::from_utf8_lossy(&diagnostic)).into()
            }
        })
    })
}

fn watch(finished: &AtomicBool, stop: &(dyn Fn() -> bool + Sync), kill: impl Fn()) {
    while !finished.load(Ordering::SeqCst) {
        if stop() {
            kill();
            return;
        }
        std::thread::sleep(POLL);
    }
}

/// Feeds stdout (and stderr when `combined`) to `output`; returns the first
/// `output` error and the stderr kept back for the error message.
fn drain(
    chunks: mpsc::Receiver<(bool, Vec<u8>)>,
    combined: bool,
    output: &mut dyn FnMut(&[u8]) -> Result<()>,
    kill: impl Fn(),
) -> (Option<crate::Error>, Vec<u8>) {
    let mut failure: Option<crate::Error> = None;
    let mut diagnostic = Vec::new();
    for (is_stderr, chunk) in chunks {
        if is_stderr && !combined {
            diagnostic.extend_from_slice(&chunk);
        } else if failure.is_none() {
            if let Err(e) = output(&chunk) {
                failure = Some(e);
                kill();
            }
        }
    }
    (failure, diagnostic)
}

fn pump(mut from: impl Read, is_stderr: bool, to: &mpsc::Sender<(bool, Vec<u8>)>) {
    let mut buffer = vec![0; 65536];
    while let Ok(n) = from.read(&mut buffer) {
        if n == 0 || to.send((is_stderr, buffer[..n].to_vec())).is_err() {
            return;
        }
    }
}

impl Engine for Process {
    fn call(&self, deadline: Deadline, request: &[u8]) -> Result<Vec<u8>> {
        call_locked(&mut self.lock(), deadline, request)
    }
    fn attachments(&self) -> Option<&dyn Attachments> {
        Some(self)
    }
    fn database(&self) -> Option<&Path> {
        Some(&self.database)
    }
}

impl Attachments for Process {
    fn import(
        &self,
        deadline: Deadline,
        name: &str,
        media_type: &str,
        input: &mut dyn Read,
    ) -> Result<AttachmentMetadata> {
        let mut output = Vec::new();
        let args = [
            "--attachment-import",
            "--attachment-name",
            name,
            "--attachment-type",
            media_type,
        ];
        self.attachment_command(deadline, Some(input), &mut output, &args)?;
        Ok(serde_json::from_slice(&output)?)
    }
    fn info(&self, deadline: Deadline, id: &str) -> Result<AttachmentMetadata> {
        let mut output = Vec::new();
        self.attachment_command(deadline, None, &mut output, &["--attachment-info", id])?;
        Ok(serde_json::from_slice(&output)?)
    }
    fn export(&self, deadline: Deadline, id: &str, output: &mut dyn Write) -> Result<()> {
        self.attachment_command(deadline, None, output, &["--attachment-export", id])
    }
    /// Streams the list while individual exports run independently.
    fn walk(
        &self,
        deadline: Deadline,
        visit: &mut dyn FnMut(AttachmentMetadata) -> Result<()>,
    ) -> Result<()> {
        const MAX_LINE: usize = 4096;
        let mut cmd = command(&self.binary);
        cmd.arg("--db").arg(&self.database).arg("--attachment-list");
        let mut pending = Vec::new();
        let mut rejected: Option<crate::Error> = None;
        let mut on_chunk = |chunk: &[u8]| -> Result<()> {
            pending.extend_from_slice(chunk);
            while let Some(end) = pending.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = pending.drain(..=end).collect();
                let line = line.strip_suffix(b"\n").unwrap_or(&line);
                let line = line.strip_suffix(b"\r").unwrap_or(line);
                if line.len() > MAX_LINE {
                    return Err("bufio.Scanner: token too long".into());
                }
                let visited = serde_json::from_slice(line)
                    .map_err(Into::into)
                    .and_then(&mut *visit);
                if let Err(e) = visited {
                    rejected = Some(e);
                    return Err("rejected".into());
                }
            }
            if pending.len() > MAX_LINE {
                return Err("bufio.Scanner: token too long".into());
            }
            Ok(())
        };
        let listed = run(
            cmd,
            &|| Instant::now() >= deadline,
            None,
            &mut on_chunk,
            false,
        );
        if let Some(e) = rejected {
            return Err(e);
        }
        listed
            .map_err(|e| -> crate::Error { format!("첨부 목록 읽기 실패: {e}").into() })?;
        if !pending.is_empty() {
            visit(serde_json::from_slice(&pending)?)?;
        }
        Ok(())
    }
}

/// Fakes and request builders shared by this crate's tests.
#[cfg(test)]
pub(crate) mod fake {
    use super::*;
    use crate::Request;

    /// Records the last request and answers `{"ok":true,"data":{}}` (Go `fakeEngine`).
    #[derive(Default)]
    pub(crate) struct FakeEngine {
        pub(crate) last: Mutex<Option<Vec<u8>>>,
    }

    impl FakeEngine {
        pub(crate) fn last(&self) -> Option<Vec<u8>> {
            self.last.lock().unwrap().clone()
        }
    }

    impl Engine for FakeEngine {
        fn call(&self, _: Deadline, request: &[u8]) -> Result<Vec<u8>> {
            *self.last.lock().unwrap() = Some(request.to_vec());
            Ok(br#"{"ok":true,"data":{}}"#.to_vec())
        }
    }

    /// Go `httptest.NewRequest`: the default host is `example.com`.
    pub(crate) fn request(
        method: &str,
        host: &str,
        path: &str,
        body: &str,
        headers: &[(&str, &str)],
    ) -> Request {
        Request {
            method: method.into(),
            path: path.into(),
            query: None,
            headers: headers
                .iter()
                .filter(|(_, v)| !v.is_empty())
                .map(|(k, v)| (k.to_lowercase(), v.to_string()))
                .collect(),
            host: host.into(),
            body: body.as_bytes().to_vec(),
        }
    }

    /// `testdata/copy_engine.go`, built once with `go build`; `None` without Go.
    pub(crate) fn fixture_engine() -> Option<PathBuf> {
        static BUILT: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
        BUILT
            .get_or_init(|| {
                let source = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../desktop/internal/bridge/testdata/copy_engine.go");
                let out = std::env::temp_dir().join(format!(
                    "inkism-copy-engine-{}{}",
                    std::process::id(),
                    std::env::consts::EXE_SUFFIX
                ));
                let built = Command::new("go")
                    .arg("build")
                    .arg("-o")
                    .arg(&out)
                    .arg(&source)
                    .status();
                match built {
                    Ok(s) if s.success() => Some(out),
                    _ => {
                        eprintln!("skipping: go is required to build the fixture engine");
                        None
                    }
                }
            })
            .clone()
    }

    /// The real runtime for tests that need it: `INKISM_TEST_ENGINE`, else the
    /// repository's release build.
    pub(crate) fn real_engine() -> Option<PathBuf> {
        let path = std::env::var_os("INKISM_TEST_ENGINE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../runtime-core/target/release")
                    .join(format!("inkism-engine{}", std::env::consts::EXE_SUFFIX))
            });
        if path.exists() {
            Some(path)
        } else {
            eprintln!("skipping: build core/runtime-core --release or set INKISM_TEST_ENGINE");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::*;
    use super::*;
    use std::sync::Arc;

    #[test]
    fn formatting_cannot_split_jsonl() {
        let out = compact(b"{\n\"op\": \"get\",\n\"id\":\"abc\\nxyz\"\n}");
        assert!(
            !out.contains(&b'\n') && valid_json(&out),
            "bad protocol line {:?}",
            String::from_utf8_lossy(&out)
        );
    }

    #[test]
    fn engine_compaction_does_not_expand_html() {
        let raw = r#"{ "op": "save", "note": {"content":"<p><strong>한글 & 😀</strong></p>","revision":9007199254740993} }"#;
        let want = r#"{"op":"save","note":{"content":"<p><strong>한글 & 😀</strong></p>","revision":9007199254740993}}"#;
        assert_eq!(String::from_utf8(compact(raw.as_bytes())).unwrap(), want);
    }

    fn wait_for(path: &Path) {
        let end = Instant::now() + Duration::from_secs(5);
        while !path.exists() {
            assert!(Instant::now() < end, "copy never started");
            std::thread::sleep(POLL);
        }
    }

    fn data(raw: &[u8]) -> serde_json::Value {
        serde_json::from_slice::<serde_json::Value>(raw).unwrap()["data"].clone()
    }

    #[test]
    fn encrypted_copy_restores_original_runtime() {
        let Some(binary) = fixture_engine() else {
            return;
        };
        for mode in ["success", "fail", "cancel"] {
            let dir = tempfile::tempdir().unwrap();
            let source = dir.path().join("original.db");
            const BODY: &str = "한글 원본 · exact content";
            std::fs::write(&source, BODY).unwrap();
            let e = Arc::new(Process::start(&binary, &source).unwrap());
            let destination = dir.path().join(mode);
            let ctx = Context::background().with_timeout(Duration::from_secs(10));
            let marker = |suffix: &str| PathBuf::from(format!("{}{suffix}", source.display()));
            std::thread::scope(|scope| {
                let copy = scope.spawn(|| e.copy_encrypted(&ctx, &destination));
                wait_for(&marker(".copying"));
                // Requests during the offline copy must wait, never reach a
                // closed child or the destination library.
                let (tx, read) = mpsc::channel();
                let reader = e.clone();
                scope.spawn(move || {
                    let _ = tx.send(
                        reader.call(Instant::now() + Duration::from_secs(30), br#"{"op":"get"}"#),
                    );
                });
                assert!(
                    read.recv_timeout(Duration::from_millis(50)).is_err(),
                    "{mode}: RPC crossed offline gate"
                );
                if mode == "cancel" {
                    ctx.cancel();
                } else {
                    std::fs::write(marker(".release"), "").unwrap();
                }
                let copied = copy.join().unwrap();
                assert_eq!(mode == "success", copied.is_ok(), "{mode}: {copied:?}");
                if mode == "fail" {
                    assert!(
                        copied
                            .as_ref()
                            .unwrap_err()
                            .to_string()
                            .contains("fixture copy failure"),
                        "{copied:?}"
                    );
                }
                let resumed = read
                    .recv_timeout(Duration::from_secs(5))
                    .expect("RPC did not resume")
                    .unwrap();
                assert_eq!(data(&resumed), BODY, "{mode}: original content mismatch");
            });
            assert_eq!(
                std::fs::read_to_string(&source).unwrap(),
                BODY,
                "{mode}: source changed"
            );
            if mode == "success" {
                assert_eq!(
                    std::fs::read_to_string(destination.join("notes.db")).unwrap(),
                    BODY
                );
            }
            e.close().unwrap();
            e.close().expect("second close");
        }
    }

    #[test]
    fn copy_rejects_relative_or_existing_destination() {
        let p = Process::start_suspended("unused", "unused.db");
        let ctx = Context::background();
        assert!(p.copy_encrypted(&ctx, Path::new("relative")).is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(p
            .copy_encrypted(&ctx, dir.path())
            .unwrap_err()
            .to_string()
            .contains("새 폴더"));
    }

    #[test]
    fn suspended_engine_starts_only_after_authentication_and_preserves_data() {
        let Some(binary) = fixture_engine() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        const BODY: &str = "synthetic unchanged body";
        std::fs::write(&db, BODY).unwrap();
        let running = dir.path().join("notes.db.running");
        let engine = Arc::new(Process::start_suspended(&binary, &db));
        let (stop, resume) = (engine.clone(), engine.clone());
        let gate = crate::SessionGate::new(
            true,
            Some(Box::new(move || stop.close())),
            Some(Box::new(move |ctx| resume.resume(ctx))),
        );
        assert!(!running.exists(), "runtime started before authentication");
        let ctx = Context::background();
        gate.unlock(&ctx, |_| Ok(())).unwrap();
        for _ in 0..2 {
            let out = engine
                .call(Instant::now() + Duration::from_secs(10), br#"{"op":"get"}"#)
                .unwrap();
            assert_eq!(data(&out), BODY);
            gate.lock().unwrap();
            assert!(!running.exists(), "runtime remained alive");
            gate.unlock(&ctx, |_| Ok(())).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(&db).unwrap(),
            BODY,
            "library changed"
        );
    }

    /// A child that answers the health check, then never again.
    #[cfg(unix)]
    #[test]
    fn deadline_kills_wedged_child() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("wedged");
        std::fs::write(
            &script,
            "#!/bin/sh\nread line\necho '{\"ok\":true}'\nexec sleep 30\n",
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let e = Process::start(&script, dir.path().join("notes.db")).unwrap();
        let begun = Instant::now();
        let err = e
            .call(
                Instant::now() + Duration::from_millis(200),
                br#"{"op":"get"}"#,
            )
            .unwrap_err();
        assert_eq!(err.to_string(), DEADLINE);
        assert!(begun.elapsed() < Duration::from_secs(2));
        assert_eq!(
            e.call(Instant::now() + Duration::from_secs(1), b"{}")
                .unwrap_err()
                .to_string(),
            STOPPED
        );
        assert!(e.close().is_err(), "a killed child reports its signal");
    }

    #[test]
    fn stopped_child_must_be_reaped_before_resume() {
        let Some(binary) = fixture_engine() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        std::fs::write(&db, "x").unwrap();
        let e = Process::start(&binary, &db).unwrap();
        assert_eq!(
            e.call(Instant::now(), b"{}").unwrap_err().to_string(),
            DEADLINE
        );
        e.kill();
        assert_eq!(
            e.call(Instant::now() + Duration::from_secs(1), b"{}")
                .unwrap_err()
                .to_string(),
            STOPPED
        );
        let ctx = Context::background();
        assert!(e.resume(&ctx).is_err(), "resume before reaping");
        let _ = e.close();
        std::fs::remove_file(dir.path().join("notes.db.running")).unwrap(); // SIGKILL skipped the fixture's cleanup
        e.resume(&ctx).unwrap();
        assert!(e
            .call(Instant::now() + Duration::from_secs(5), br#"{"op":"get"}"#)
            .is_ok());
    }

    #[test]
    fn real_engine_attachment_commands() {
        let Some(binary) = real_engine() else { return };
        let dir = tempfile::tempdir().unwrap();
        let e = Process::start(&binary, dir.path().join("notes.db")).unwrap();
        let deadline = Instant::now() + Duration::from_secs(60);
        let content = b"attachment bytes \xed\x95\x9c".repeat(5000);
        let meta = e
            .import(deadline, "한글.txt", "text/plain", &mut content.as_slice())
            .unwrap();
        assert_eq!(
            (meta.name.as_str(), meta.size),
            ("한글.txt", content.len() as u64)
        );
        assert_eq!(e.info(deadline, &meta.id).unwrap(), meta);
        let mut out = Vec::new();
        e.export(deadline, &meta.id, &mut out).unwrap();
        assert_eq!(out, content);
        let mut seen = Vec::new();
        e.walk(deadline, &mut |m| {
            seen.push(m);
            Ok(())
        })
        .unwrap();
        assert_eq!(seen, vec![meta.clone()]);
        let stop = e
            .walk(deadline, &mut |_| Err("visitor stop".into()))
            .unwrap_err();
        assert_eq!(stop.to_string(), "visitor stop");
        assert!(e.info(deadline, "missing").is_err());
        let garbage = dir.path().join("garbage.db");
        std::fs::write(&garbage, "not a library").unwrap();
        assert!(
            check_library(&Context::background(), &binary, &garbage).is_err(),
            "invalid library accepted"
        );
    }

    /// Port of `encrypted_copy_windows_test.go`: the packaged SQLCipher runtime.
    #[cfg(windows)]
    #[test]
    fn packaged_encrypted_copy_while_app_open() {
        let Some(binary) = std::env::var_os("INKISM_TEST_ENGINE").map(PathBuf::from) else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("원본.db");
        let e = Process::start(&binary, &source).unwrap();
        let ctx = Context::background().with_timeout(Duration::from_secs(120));
        let call = |engine: &Process, request: &str| -> serde_json::Value {
            let raw = engine
                .call(
                    Instant::now() + Duration::from_secs(120),
                    request.as_bytes(),
                )
                .unwrap();
            let v: serde_json::Value = serde_json::from_slice(&raw).unwrap();
            assert_eq!(v["ok"], true, "{v}");
            v["data"].clone()
        };
        let note = call(
            &e,
            r#"{"op":"save","note":{"title":"암호화 복사","content":"<p>원본 <strong>그대로</strong></p>","text":"원본 그대로"}}"#,
        );
        let destination = dir.path().join("암호화 사본");
        let target = e.copy_encrypted(&ctx, &destination).unwrap();
        e.check_library(&ctx, &target).unwrap();
        let invalid = dir.path().join("invalid.db");
        std::fs::write(&invalid, "not a library").unwrap();
        assert!(
            e.check_library(&ctx, &invalid).is_err(),
            "invalid selection accepted"
        );
        let request = serde_json::json!({"op": "get", "id": note["id"]}).to_string();
        assert_eq!(
            call(&e, &request)["content"],
            note["content"],
            "original body changed"
        );
        assert_eq!(
            call(&e, r#"{"op":"storage_status"}"#)["encrypted"],
            false,
            "original library was switched"
        );
        let copied = Process::start(&binary, &target).unwrap();
        assert_eq!(
            call(&copied, &request)["content"],
            note["content"],
            "copied body changed"
        );
        assert_eq!(
            call(&copied, r#"{"op":"storage_status"}"#)["encrypted"],
            true,
            "destination is not encrypted"
        );
        assert!(
            e.copy_encrypted(&ctx, &destination).is_err(),
            "existing destination accepted"
        );
        call(
            &e,
            r#"{"op":"save","note":{"title":"복귀","content":"<p>복사 후에도 저장</p>","text":"복사 후에도 저장"}}"#,
        );
    }
}
