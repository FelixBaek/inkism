//! One isolated, noninteractive browser print job.
//!
//! Port of the Go package `desktop/internal/pdfexport`.
//!
//! # How Windows produces the PDF
//!
//! Not WebView2 `PrintToPdf`. The renderer writes the document to a private
//! temp folder (`<temp>/inkism-pdf-XXXX/document.html`) and starts an
//! **external `msedge.exe` process** in headless Chromium mode:
//!
//! ```text
//! msedge.exe --headless --disable-gpu --no-first-run --no-default-browser-check
//!   --disable-extensions --disable-background-networking --disable-component-update
//!   --disable-sync --metrics-recording-only --no-pdf-header-footer
//!   --user-data-dir=<job>/profile --print-to-pdf=<job>/document.pdf file:///<job>/document.html
//! ```
//!
//! * Edge is looked up as `Microsoft\Edge\Application\msedge.exe` under
//!   `%ProgramFiles(x86)%`, `%ProgramFiles%`, then `%LOCALAPPDATA%`.
//! * The process is created suspended and hidden (`CREATE_SUSPENDED |
//!   CREATE_NO_WINDOW`, `SW_HIDE`), put into a fresh Job Object with
//!   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, then resumed, so every Edge child
//!   process lives in that job. Completion means "no active process left in
//!   the job"; the exit code of the first process decides success.
//!   Timeout/cancel terminates the job (never another Edge instance) and waits
//!   up to 2 s for it to drain before the folder is deleted.
//! * Edge's stdout/stderr are never read, so note text cannot leak into errors.
//! * The output must start with `%PDF-` and be at most 128 MiB; the whole job
//!   folder (profile included) is removed afterwards, and a failed cleanup turns
//!   a success into an error.
//! * The renderer adds no CSP or styles. The caller's document must carry them:
//!   the Go shell (`desktop/internal/bridge/formatted_export.go`) wraps the
//!   `clean_export` output in a page with a `default-src 'none'` CSP meta,
//!   `no-referrer`, an `@page{size:A4;margin:18mm}` stylesheet and Korean fonts.
//!
//! Other platforms have no browser lookup ([`Renderer::render`] fails unless
//! [`Renderer::binary`] is set) and run the binary as a plain child process.

use std::ffi::OsString;
use std::fmt;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[cfg(any(windows, test))]
mod escape;
#[cfg(not(windows))]
mod platform_other;
#[cfg(windows)]
mod platform_windows;

#[cfg(not(windows))]
use platform_other as platform;
#[cfg(windows)]
use platform_windows as platform;

pub const MAX_DOCUMENT_BYTES: usize = 64 << 20;
pub const MAX_PDF_BYTES: u64 = 128 << 20;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
const JOB_PREFIX: &str = "inkism-pdf-";

/// Export failure. Messages match the Go version; runner/browser output is
/// never included.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// The timeout passed (Go `context.DeadlineExceeded`).
    Timeout,
    /// The caller's cancel flag was set (Go `context.Canceled`).
    Cancelled,
    /// Any other failure, with a user-facing message.
    Failed(&'static str),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Timeout | Error::Cancelled => {
                f.write_str("PDF 내보내기를 취소했거나 제한 시간을 넘었습니다")
            }
            Error::Failed(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for Error {}

/// Deadline plus cancel flag handed to the process runner (Go `ctx`).
pub(crate) struct Stop<'a> {
    deadline: Instant,
    cancel: &'a AtomicBool,
}

impl Stop<'_> {
    /// Why the job must stop now, if it must.
    pub(crate) fn reason(&self) -> Option<Error> {
        if self.cancel.load(Ordering::SeqCst) {
            Some(Error::Cancelled)
        } else if Instant::now() >= self.deadline {
            Some(Error::Timeout)
        } else {
            None
        }
    }
}

/// Configuration for one print job. `Default` discovers Edge, uses the system
/// temp folder and a 60 s timeout.
#[derive(Clone, Debug, Default)]
pub struct Renderer {
    /// Absolute browser path; `None` discovers Edge (Windows only).
    pub binary: Option<PathBuf>,
    /// Parent of the private job folder; `None` uses the system temp folder.
    pub temp_root: Option<PathBuf>,
    /// `None` or zero means 60 s.
    pub timeout: Option<Duration>,
}

type Runner<'r> = &'r dyn Fn(&Path, &[OsString], &Stop) -> io::Result<()>;

impl Renderer {
    /// Prints `document` (a full HTML page) to PDF bytes.
    pub fn render(&self, document: &[u8]) -> Result<Vec<u8>, Error> {
        self.render_cancellable(document, &AtomicBool::new(false))
    }

    /// Like [`Renderer::render`]; setting `cancel` stops the job and cleans up.
    pub fn render_cancellable(
        &self,
        document: &[u8],
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>, Error> {
        self.render_with(document, cancel, &platform::run_browser)
    }

    /// Resolves and checks the configured or discovered browser.
    fn browser_binary(&self) -> Result<PathBuf, Error> {
        let binary = match &self.binary {
            Some(b) => b.clone(),
            None => platform::find_browser()?,
        };
        if !binary.is_absolute() {
            return Err(Error::Failed("PDF 브라우저 경로가 올바르지 않습니다"));
        }
        match std::fs::metadata(&binary) {
            Ok(info) if !info.is_dir() => Ok(binary),
            _ => Err(Error::Failed(
                "Microsoft Edge가 없어 PDF를 만들 수 없습니다",
            )),
        }
    }

    fn render_with(
        &self,
        document: &[u8],
        cancel: &AtomicBool,
        run: Runner,
    ) -> Result<Vec<u8>, Error> {
        if document.is_empty() || document.len() > MAX_DOCUMENT_BYTES {
            return Err(Error::Failed("PDF 문서 크기는 64 MiB 이하여야 합니다"));
        }
        let binary = self.browser_binary()?;
        let timeout = self
            .timeout
            .filter(|t| !t.is_zero())
            .unwrap_or(DEFAULT_TIMEOUT);
        let stop = Stop {
            deadline: Instant::now() + timeout,
            cancel,
        };
        if let Some(e) = stop.reason() {
            return Err(e);
        }
        let root = self.temp_root.clone().unwrap_or_else(std::env::temp_dir);
        let directory = tempfile::Builder::new()
            .prefix(JOB_PREFIX)
            .tempdir_in(root)
            .map_err(|_| Error::Failed("PDF 임시 폴더를 만들지 못했습니다"))?
            .keep();
        // Never canonicalize: Windows would return a \\?\ path that Edge rejects.
        let result = match std::path::absolute(&directory) {
            Ok(directory) => run_job(&directory, document, &binary, &stop, run),
            Err(_) => Err(Error::Failed("PDF 임시 폴더를 만들지 못했습니다")),
        };
        // Only the exact directory created above is removed. Never use caller paths.
        let cleaned =
            std::path::absolute(&directory).map_or(Err(()), |d| remove_job(&d).map_err(|_| ()));
        match (cleaned, result) {
            (Err(()), Ok(_)) => Err(Error::Failed("PDF 임시 파일 정리가 완료되지 않았습니다")),
            (_, result) => result,
        }
    }
}

fn run_job(
    directory: &Path,
    document: &[u8],
    binary: &Path,
    stop: &Stop,
    run: Runner,
) -> Result<Vec<u8>, Error> {
    let source = directory.join("document.html");
    let output = directory.join("document.pdf");
    write_private(&source, document)
        .map_err(|_| Error::Failed("PDF 임시 문서를 저장하지 못했습니다"))?;
    let source_url = url::Url::from_file_path(&source)
        .map_err(|_| Error::Failed("PDF 임시 문서를 저장하지 못했습니다"))?;
    let mut args: Vec<OsString> = [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-pdf-header-footer",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    args.push(flag("--user-data-dir=", &directory.join("profile")));
    args.push(flag("--print-to-pdf=", &output));
    args.push(source_url.as_str().into());
    if run(binary, &args, stop).is_err() {
        return Err(stop
            .reason()
            .unwrap_or(Error::Failed("Microsoft Edge에서 PDF를 만들지 못했습니다")));
    }
    // The handle is dropped before the caller removes the folder (Windows locks open files).
    let file =
        File::open(&output).map_err(|_| Error::Failed("PDF 결과 파일이 생성되지 않았습니다"))?;
    match file.metadata() {
        Ok(info) if info.len() <= MAX_PDF_BYTES => {}
        _ => return Err(Error::Failed("PDF 결과가 128 MiB 한도를 넘었습니다")),
    }
    let mut data = Vec::new();
    file.take(MAX_PDF_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| Error::Failed("PDF 결과를 읽지 못했습니다"))?;
    if data.len() as u64 > MAX_PDF_BYTES || !data.starts_with(b"%PDF-") {
        return Err(Error::Failed("PDF 결과가 올바르지 않습니다"));
    }
    Ok(data)
}

fn flag(name: &str, path: &Path) -> OsString {
    let mut arg = OsString::from(name);
    arg.push(path);
    arg
}

fn write_private(path: &Path, data: &[u8]) -> io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    io::Write::write_all(&mut options.open(path)?, data)
}

/// Removes a job folder, refusing anything that is not an absolute
/// `inkism-pdf-*` path. Retries while Edge releases its files.
fn remove_job(directory: &Path) -> io::Result<()> {
    let named = directory
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with(JOB_PREFIX));
    if !directory.is_absolute() || !named {
        return Err(io::Error::other("unsafe cleanup target"));
    }
    let mut result = Ok(());
    for _ in 0..20 {
        result = match std::fs::remove_dir_all(directory) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        };
        if result.is_ok() {
            return result;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    result
}

#[cfg(test)]
mod tests;
