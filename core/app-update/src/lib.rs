//! Checks a signed update feed and swaps the portable Windows app files
//! (Inkism.exe, inkism-engine.exe and text files) in place. The profile/DB
//! folder is never touched: only the names in `PACKAGE_FILES` are.
//!
//! The feed format (`latest.json` + base64 ed25519 `latest.json.sig`, zip
//! layout, key files) is shared with already published builds and must not change.

use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::alphabet::STANDARD;
use base64::engine::{GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;
use ed25519_dalek::Signature;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

pub use ed25519_dalek::{SigningKey, VerifyingKey};

const EMBEDDED_PUBLIC_KEY: &str = include_str!("../pubkey.txt");

const MAX_MANIFEST: u64 = 64 << 10;
const MAX_SIGNATURE: u64 = 1 << 10;
const MAX_ZIP: u64 = 300 << 20;
const EXE_NAME: &str = "Inkism.exe";
const ENGINE_NAME: &str = "inkism-engine.exe";
const WORK_DIR_NAME: &str = ".update";
/// Windows can keep an exited image locked briefly (engine teardown, AV scan).
const RENAME_RETRY: Duration = Duration::from_secs(30);

/// Allowed package entries (inside the zip's "Inkism/" folder) and their size caps.
const PACKAGE_FILES: [(&str, u64); 5] = [
    (EXE_NAME, 256 << 20),
    (ENGINE_NAME, 256 << 20),
    // The windows-gnu shell links WebView2 dynamically.
    ("WebView2Loader.dll", 4 << 20),
    ("README.md", 1 << 20),
    ("BUILD.txt", 1 << 20),
];

/// Base64 the way Go's `encoding/base64.StdEncoding` decodes it: padded,
/// non-zero trailing bits tolerated, `\r`/`\n` anywhere ignored.
const B64: GeneralPurpose = GeneralPurpose::new(
    &STANDARD,
    GeneralPurposeConfig::new().with_decode_allow_trailing_bits(true),
);

pub fn b64_encode(data: &[u8]) -> String {
    B64.encode(data)
}

/// Decodes after trimming surrounding whitespace, like `DecodeString(TrimSpace(s))`.
pub fn b64_decode(text: &[u8]) -> Option<Vec<u8>> {
    let text = String::from_utf8_lossy(text);
    let cleaned: Vec<u8> = text
        .trim()
        .bytes()
        .filter(|b| *b != b'\r' && *b != b'\n')
        .collect();
    B64.decode(cleaned).ok()
}

#[derive(Debug)]
pub enum Error {
    /// Updates can only be installed on Windows.
    NotSupported,
    Msg(String),
    Io(io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NotSupported => f.write_str("이 환경에서는 업데이트를 설치할 수 없습니다"),
            Error::Msg(m) => f.write_str(m),
            Error::Io(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for Error {}

impl From<io::Error> for Error {
    fn from(e: io::Error) -> Self {
        Error::Io(e)
    }
}

fn msg(m: impl Into<String>) -> Error {
    Error::Msg(m.into())
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Manifest {
    pub version: String,
    pub commit: String,
    pub zip: String,
    pub sha256: String,
    pub notes: String,
    pub published_at: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Status {
    pub current: String,
    pub commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest: Option<Manifest>,
    pub available: bool,
    /// RFC 3339, UTC.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
    /// "" | downloading | verifying | restarting
    #[serde(skip_serializing_if = "String::is_empty")]
    pub phase: String,
}

pub struct Updater {
    current: String,
    feed: std::result::Result<Url, String>,
    pub(crate) public_key: Option<VerifyingKey>,
    client: reqwest::blocking::Client,
    app_dir: PathBuf,
    #[cfg_attr(not(windows), allow(dead_code))]
    args: Vec<String>,
    status: Mutex<Status>,
}

impl Updater {
    /// Builds an updater. `INKISM_UPDATE_FEED` overrides the built-in feed for
    /// tests and may only point at http://127.0.0.1 when it is not HTTPS.
    pub fn new(
        current: &str,
        commit: &str,
        feed: &str,
        app_dir: impl Into<PathBuf>,
        relaunch_args: Vec<String>,
    ) -> Self {
        let over = std::env::var("INKISM_UPDATE_FEED").unwrap_or_default();
        Self::with_override(current, commit, feed, &over, app_dir.into(), relaunch_args)
    }

    pub(crate) fn with_override(
        current: &str,
        commit: &str,
        feed: &str,
        over: &str,
        app_dir: PathBuf,
        args: Vec<String>,
    ) -> Self {
        let mut feed = feed_base(feed, over);
        let key = parse_public_key(EMBEDDED_PUBLIC_KEY);
        if let (Err(e), Ok(_)) = (&key, &feed) {
            feed = Err(e.to_string());
        }
        let local = feed.as_ref().is_ok_and(|u| u.scheme() == "http");
        let mut builder =
            reqwest::blocking::Client::builder().redirect(reqwest::redirect::Policy::custom(|a| {
                if a.previous().len() < 5 && redirect_allowed(a.url()) {
                    a.follow()
                } else {
                    a.error("redirect refused")
                }
            }));
        if local {
            builder = builder.no_proxy();
        }
        Updater {
            current: current.into(),
            feed,
            public_key: key.ok(),
            client: builder.build().expect("http client"),
            app_dir,
            args,
            status: Mutex::new(Status {
                current: current.into(),
                commit: commit.into(),
                ..Default::default()
            }),
        }
    }

    pub fn current(&self) -> &str {
        &self.current
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    pub fn check(&self) -> Status {
        let m = self.fetch_manifest();
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .ok();
        let mut s = self.status.lock().unwrap();
        if s.phase.is_empty() {
            // leftover helper copy from a finished update
            let _ = fs::remove_dir_all(self.app_dir.join(WORK_DIR_NAME));
        }
        s.checked_at = now;
        s.available = false;
        s.error.clear();
        match m {
            Ok(m) => {
                s.available = newer(&m.version, &self.current);
                s.latest = Some(m);
            }
            Err(e) => {
                s.latest = None;
                s.error = e.to_string();
            }
        }
        s.clone()
    }

    fn set_phase(&self, phase: &str) {
        self.status.lock().unwrap().phase = phase.into();
    }

    /// Downloads and verifies the new package, then starts a detached copy of
    /// the current executable that swaps files once this process has exited.
    /// The caller must then close the app through its normal save-and-close path.
    pub fn apply(&self) -> Result<()> {
        if !cfg!(windows) {
            return Err(Error::NotSupported);
        }
        {
            let mut s = self.status.lock().unwrap();
            if !s.phase.is_empty() {
                return Err(msg("업데이트가 이미 진행 중입니다"));
            }
            s.phase = "downloading".into();
        }
        let r = self.apply_inner();
        if r.is_err() {
            self.set_phase("");
        }
        r
    }

    #[cfg(not(windows))]
    fn apply_inner(&self) -> Result<()> {
        Err(Error::NotSupported)
    }

    #[cfg(windows)]
    fn apply_inner(&self) -> Result<()> {
        let staging = self.prepare()?;
        let me = std::env::current_exe()?;
        let helper = self.app_dir.join(WORK_DIR_NAME).join("inkism-updater.exe");
        fs::copy(&me, &helper)?;
        let pid = std::process::id().to_string();
        std::process::Command::new(&helper)
            .arg("--apply-update")
            .arg(&staging)
            .args([
                "--target".as_ref(),
                self.app_dir.as_os_str(),
                "--wait-pid".as_ref(),
                pid.as_ref(),
                "--".as_ref(),
            ])
            .args(&self.args)
            .current_dir(&self.app_dir)
            .spawn()
            .map_err(|e| msg(format!("업데이트 도우미를 시작하지 못했습니다: {e}")))?;
        self.set_phase("restarting");
        Ok(())
    }

    fn get(&self, name: &str, limit: u64, timeout: Duration, w: &mut dyn Write) -> Result<()> {
        let feed = self.feed.as_ref().map_err(|e| msg(e.clone()))?;
        let target = feed
            .join(&format!("./{}", escape_path(name)))
            .map_err(|_| msg("업데이트 주소가 올바르지 않습니다"))?;
        let resp = self
            .client
            .get(target)
            .timeout(timeout)
            .send()
            .map_err(|_| msg("업데이트 서버에 연결하지 못했습니다"))?;
        if resp.status().as_u16() != 200 {
            return Err(msg(format!(
                "업데이트 서버 응답 오류 (HTTP {})",
                resp.status().as_u16()
            )));
        }
        if resp.content_length().is_some_and(|n| n > limit) {
            return Err(msg("업데이트 파일이 너무 큽니다"));
        }
        let n = io::copy(&mut resp.take(limit + 1), w)
            .map_err(|_| msg("업데이트 파일을 내려받지 못했습니다"))?;
        if n > limit {
            return Err(msg("업데이트 파일이 너무 큽니다"));
        }
        Ok(())
    }

    fn fetch_manifest(&self) -> Result<Manifest> {
        if let Err(e) = &self.feed {
            return Err(msg(e.clone()));
        }
        let t = Duration::from_secs(30);
        let (mut data, mut sig) = (Vec::new(), Vec::new());
        self.get("latest.json", MAX_MANIFEST, t, &mut data)?;
        self.get("latest.json.sig", MAX_SIGNATURE, t, &mut sig)?;
        let key = self
            .public_key
            .as_ref()
            .ok_or_else(|| msg("업데이트 공개키가 올바르지 않습니다"))?;
        verify_manifest(key, &data, &sig)?;
        parse_manifest(&data)
    }

    #[cfg_attr(not(windows), allow(dead_code))] // Windows-only outside tests
    /// Downloads the manifest's zip into `<appDir>/.update`, checks its SHA-256
    /// and extracts the allowed files into `<appDir>/.update/staging`.
    pub(crate) fn prepare(&self) -> Result<PathBuf> {
        let m = self.fetch_manifest()?;
        if !newer(&m.version, &self.current) {
            return Err(msg("설치할 새 버전이 없습니다"));
        }
        let work = self.app_dir.join(WORK_DIR_NAME);
        match fs::remove_dir_all(&work) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
        create_dir_private(&work)?;
        let archive = work.join(&m.zip);
        let mut file = create_new(&archive, 0o600)?;
        let mut hashing = HashWriter {
            inner: &mut file,
            hash: Sha256::new(),
        };
        let r = self.get(&m.zip, MAX_ZIP, Duration::from_secs(600), &mut hashing);
        let sum = hex(&hashing.hash.finalize());
        let closed = file.sync_all();
        r?;
        closed?;
        self.set_phase("verifying");
        if sum != m.sha256 {
            return Err(msg("내려받은 파일이 손상되었습니다 (SHA-256 불일치)"));
        }
        let staging = work.join("staging");
        extract_package(&archive, &staging)?;
        Ok(staging)
    }
}

struct HashWriter<'a> {
    inner: &'a mut File,
    hash: Sha256,
}

impl Write for HashWriter<'_> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.hash.update(&buf[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Percent-escapes a relative path the way Go's `url.URL{Path: p}` does.
fn escape_path(p: &str) -> String {
    p.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~$&+,/:;=@".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// GitHub release downloads hop through github.com to its asset host. The
/// manifest signature and zip hash still gate what gets installed.
pub(crate) fn redirect_allowed(to: &Url) -> bool {
    to.scheme() == "https"
        && matches!(
            to.host_str(),
            Some("github.com" | "objects.githubusercontent.com" | "release-assets.githubusercontent.com")
        )
}

pub(crate) fn feed_base(built: &str, over: &str) -> std::result::Result<Url, String> {
    let raw = if over.is_empty() { built } else { over };
    if raw.is_empty() {
        return Err("업데이트 주소가 설정되지 않았습니다".into());
    }
    let mut base = match Url::parse(raw) {
        Ok(u)
            if u.host_str().is_some_and(|h| !h.is_empty())
                && u.username().is_empty()
                && u.password().is_none() =>
        {
            u
        }
        _ => return Err("업데이트 주소가 올바르지 않습니다".into()),
    };
    let local = !over.is_empty() && base.scheme() == "http" && base.host_str() == Some("127.0.0.1");
    if base.scheme() != "https" && !local {
        return Err("업데이트 주소는 HTTPS여야 합니다".into());
    }
    if !base.path().ends_with('/') {
        let p = format!("{}/", base.path());
        base.set_path(&p);
    }
    Ok(base)
}

pub fn parse_public_key(text: &str) -> Result<VerifyingKey> {
    b64_decode(text.as_bytes())
        .and_then(|raw| <[u8; 32]>::try_from(raw).ok())
        .and_then(|raw| VerifyingKey::from_bytes(&raw).ok())
        .ok_or_else(|| msg("업데이트 공개키가 올바르지 않습니다"))
}

/// Parses a private key file: base64 of the 64-byte seed||public key.
pub fn parse_private_key(text: &[u8]) -> Result<SigningKey> {
    b64_decode(text)
        .and_then(|raw| <[u8; 64]>::try_from(raw).ok())
        .and_then(|raw| SigningKey::from_keypair_bytes(&raw).ok())
        .ok_or_else(|| msg("invalid private key file"))
}

/// Returns the `.sig` file content for `data`: base64 signature plus newline.
pub fn sign(key: &SigningKey, data: &[u8]) -> String {
    use ed25519_dalek::Signer;
    b64_encode(&key.sign(data).to_bytes()) + "\n"
}

/// Checks the base64 ed25519 signature over the exact bytes.
pub fn verify_manifest(key: &VerifyingKey, data: &[u8], signature: &[u8]) -> Result<()> {
    b64_decode(signature)
        .and_then(|s| Signature::from_slice(&s).ok())
        // Cofactorless `verify` (not `verify_strict`) matches Go's ed25519.Verify.
        .filter(|s| ed25519_dalek::Verifier::verify(key, data, s).is_ok())
        .map(|_| ())
        .ok_or_else(|| msg("업데이트 정보의 서명이 올바르지 않습니다"))
}

pub(crate) fn parse_manifest(data: &[u8]) -> Result<Manifest> {
    let m: Manifest =
        serde_json::from_slice(data).map_err(|_| msg("업데이트 정보를 읽을 수 없습니다"))?;
    let sha_ok = m.sha256.len() == 64
        && m.sha256
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if parse_semver(&m.version).is_none()
        || m.zip != format!("Inkism-{}-windows-x64.zip", m.version)
        || !sha_ok
    {
        return Err(msg("업데이트 정보 형식이 올바르지 않습니다"));
    }
    Ok(m)
}

#[derive(Debug)]
pub(crate) struct Semver {
    n: [u64; 3],
    pre: Vec<String>,
}

fn digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

pub(crate) fn parse_semver(s: &str) -> Option<Semver> {
    let s = s.strip_prefix('v').unwrap_or(s);
    let s = s.split_once('+').map_or(s, |(a, _)| a);
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (s, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut v = Semver {
        n: [0; 3],
        pre: Vec::new(),
    };
    for (i, p) in parts.iter().enumerate() {
        // ponytail: Go's Atoi overflows at i64; u64 accepts a little more, harmless.
        v.n[i] = if digits(p) {
            p.parse().ok()?
        } else {
            return None;
        };
    }
    if let Some(pre) = pre {
        v.pre = pre.split('.').map(String::from).collect();
        if v.pre.iter().any(String::is_empty) {
            return None;
        }
    }
    Some(v)
}

fn compare_semver(a: &Semver, b: &Semver) -> std::cmp::Ordering {
    a.n.cmp(&b.n).then_with(|| {
        if a.pre.is_empty() || b.pre.is_empty() {
            // a release sorts after its pre-releases
            return b.pre.len().cmp(&a.pre.len());
        }
        a.pre
            .iter()
            .zip(&b.pre)
            .map(|(x, y)| compare_prerelease(x, y))
            .find(|c| c.is_ne())
            .unwrap_or_else(|| a.pre.len().cmp(&b.pre.len()))
    })
}

/// Numeric identifiers sort before alphanumeric ones.
fn compare_prerelease(x: &str, y: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering::*;
    match (digits(x), digits(y)) {
        (true, true) => x
            .parse::<u64>()
            .unwrap_or(u64::MAX)
            .cmp(&y.parse().unwrap_or(u64::MAX)),
        (true, false) => Less,
        (false, true) => Greater,
        _ => x.cmp(y),
    }
}

/// Whether candidate is a valid version above current. An unparsable current
/// version (local builds) treats every valid release as newer.
pub fn newer(candidate: &str, current: &str) -> bool {
    let Some(c) = parse_semver(candidate) else {
        return false;
    };
    parse_semver(current).is_none_or(|cur| compare_semver(&c, &cur).is_gt())
}

fn create_new(path: &Path, mode: u32) -> io::Result<File> {
    let mut o = OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, mode);
    #[cfg(not(unix))]
    let _ = mode;
    o.open(path)
}

fn create_dir_private(path: &Path) -> io::Result<()> {
    let mut b = fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut b, 0o700);
    b.create(path)
}

fn package_limit(base: &[u8]) -> Option<u64> {
    PACKAGE_FILES
        .iter()
        .find(|(n, _)| n.as_bytes() == base)
        .map(|(_, l)| *l)
}

/// Accepts only "Inkism/<allowed name>" regular files within their size caps;
/// both executables are required.
pub(crate) fn extract_package(archive: &Path, dest: &Path) -> Result<()> {
    let bad_archive = || msg("업데이트 파일을 열 수 없습니다");
    let mut zip = zip::ZipArchive::new(File::open(archive).map_err(|_| bad_archive())?)
        .map_err(|_| bad_archive())?;
    // The zip crate keys entries by name and silently drops duplicates; Go sees them.
    if central_entries(archive, zip.central_directory_start()).map_err(|_| bad_archive())?
        != zip.len()
    {
        return Err(msg(
            "업데이트 파일에 예상하지 못한 항목이 있습니다: 중복 항목",
        ));
    }
    create_dir_private(dest)?;
    let mut seen: Vec<Vec<u8>> = Vec::new();
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i).map_err(|_| bad_archive())?;
        let name = f.name_raw().to_vec();
        if name == b"Inkism/" && f.is_dir() {
            continue;
        }
        let regular = !f.is_dir()
            && f.unix_mode()
                .is_none_or(|m| matches!(m & 0o170000, 0 | 0o100000));
        let base = name.strip_prefix(b"Inkism/");
        let limit = base.and_then(package_limit);
        let (Some(base), Some(limit)) = (base, limit) else {
            return Err(unexpected(&name));
        };
        if seen.iter().any(|s| s == base) || !regular {
            return Err(unexpected(&name));
        }
        let base_str = String::from_utf8_lossy(base).into_owned();
        if f.size() > limit {
            return Err(msg(format!("업데이트 파일 항목이 너무 큽니다: {base_str}")));
        }
        seen.push(base.to_vec());
        drop(f);
        let f = zip.by_index(i).map_err(|_| bad_archive())?;
        let mut dst = create_new(&dest.join(&base_str), 0o755)?;
        let n = io::copy(&mut f.take(limit + 1), &mut dst)?;
        dst.sync_all()?;
        if n > limit {
            return Err(msg(format!(
                "업데이트 파일 항목이 너무 큽니다: Inkism/{base_str}"
            )));
        }
    }
    if !seen.iter().any(|s| s == EXE_NAME.as_bytes())
        || !seen.iter().any(|s| s == ENGINE_NAME.as_bytes())
    {
        return Err(msg("업데이트 파일에 실행 파일이 빠져 있습니다"));
    }
    Ok(())
}

/// Counts central directory records starting at `start`.
fn central_entries(archive: &Path, start: u64) -> io::Result<usize> {
    use std::io::{BufReader, Seek, SeekFrom};
    let mut r = BufReader::new(File::open(archive)?);
    r.seek(SeekFrom::Start(start))?;
    let mut count = 0;
    let mut h = [0u8; 46];
    while r.read_exact(&mut h).is_ok() && h[..4] == 0x0201_4b50u32.to_le_bytes() {
        let len = |o: usize| u16::from_le_bytes([h[o], h[o + 1]]) as i64;
        r.seek_relative(len(28) + len(30) + len(32))?;
        count += 1;
    }
    Ok(count)
}

fn unexpected(name: &[u8]) -> Error {
    msg(format!(
        "업데이트 파일에 예상하지 못한 항목이 있습니다: {:?}",
        String::from_utf8_lossy(name)
    ))
}

fn retry_rename(from: &Path, to: &Path, retry: Duration) -> io::Result<()> {
    let deadline = Instant::now() + retry;
    loop {
        match fs::rename(from, to) {
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(250)),
            r => return r,
        }
    }
}

/// Go's os.Remove: a file or an empty directory.
fn remove(p: &Path) {
    if fs::remove_file(p).is_err() {
        let _ = fs::remove_dir(p);
    }
}

static LOG: Mutex<Option<File>> = Mutex::new(None);

fn log(line: &str) {
    let mut sink = LOG.lock().unwrap();
    let stamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    match sink.as_mut() {
        Some(f) => {
            let _ = writeln!(f, "{stamp} {line}");
        }
        None => eprintln!("{stamp} {line}"),
    }
}

fn old_path(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".old");
    s.into()
}

/// Moves the staged files over target, keeping "<name>.old" backups, then
/// launches the new Inkism.exe. Any failure restores the backups (and
/// relaunches the restored app when the new one could not start).
pub fn apply_staged(
    staging: &Path,
    target: &Path,
    launch: impl FnMut(&Path) -> io::Result<()>,
) -> Result<()> {
    apply_staged_with(staging, target, launch, RENAME_RETRY)
}

pub(crate) fn apply_staged_with(
    staging: &Path,
    target: &Path,
    mut launch: impl FnMut(&Path) -> io::Result<()>,
    retry: Duration,
) -> Result<()> {
    let mut done: Vec<(&str, bool)> = Vec::new();
    for (name, _) in PACKAGE_FILES {
        if let Err(e) = install_staged(staging, target, name, retry, &mut done) {
            rollback(target, &done, retry);
            return Err(e);
        }
    }
    let exe = target.join(EXE_NAME);
    if let Err(e) = launch(&exe) {
        rollback(target, &done, retry);
        if let Err(re) = launch(&exe) {
            log(&format!("이전 버전 다시 시작 실패: {re}"));
        }
        return Err(e.into());
    }
    Ok(())
}

/// Moves one staged file over target; `done` records it once `dst` was moved aside.
fn install_staged<'a>(
    staging: &Path,
    target: &Path,
    name: &'a str,
    retry: Duration,
    done: &mut Vec<(&'a str, bool)>,
) -> Result<()> {
    let src = staging.join(name);
    if let Err(e) = fs::symlink_metadata(&src) {
        if name == EXE_NAME || name == ENGINE_NAME {
            return Err(msg(format!("staged {name} missing: {e}")));
        }
        return Ok(());
    }
    let dst = target.join(name);
    let old = old_path(&dst);
    remove(&old);
    let backed_up = fs::symlink_metadata(&dst).is_ok();
    if backed_up {
        retry_rename(&dst, &old, retry)?;
    }
    done.push((name, backed_up));
    retry_rename(&src, &dst, retry)?;
    Ok(())
}

fn rollback(target: &Path, done: &[(&str, bool)], retry: Duration) {
    for (name, backed_up) in done.iter().rev() {
        let dst = target.join(name);
        remove(&dst);
        if !*backed_up {
            continue;
        }
        if let Err(e) = retry_rename(&old_path(&dst), &dst, retry) {
            log(&format!("업데이트 되돌리기 실패: {e}"));
        }
    }
}

/// The hidden "--apply-update <staging> --target <dir> --wait-pid <pid> -- <args>"
/// mode run from a copy of the old executable. `args` starts after "--apply-update".
pub fn run_helper(args: &[String]) -> Result<()> {
    let (staging, target, pid, relaunch) = parse_helper_args(args)?;
    let target = Path::new(target);
    let expected = target.join(WORK_DIR_NAME).join("staging");
    // ponytail: lexical compare without resolving "..", stricter than Go's filepath.Clean.
    let pid = u32::try_from(pid)
        .ok()
        .filter(|p| *p > 0 && *p <= i32::MAX as u32);
    let (true, Some(pid)) = (
        !target.as_os_str().is_empty() && Path::new(staging).components().eq(expected.components()),
        pid,
    ) else {
        return Err(msg("invalid update helper arguments"));
    };
    let staging = Path::new(staging);
    if let Ok(f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(target.join("update.log"))
    {
        *LOG.lock().unwrap() = Some(f);
    }
    if let Err(e) = wait_pid(pid, Duration::from_secs(600)) {
        log(&format!("업데이트 취소: 앱이 닫히지 않았습니다: {e}"));
        return fs::remove_dir_all(staging).map_err(Error::from);
    }
    let r = apply_staged(staging, target, |exe| {
        std::process::Command::new(exe)
            .args(relaunch)
            .current_dir(target)
            .spawn()
            .map(drop)
    });
    match &r {
        Err(e) => log(&format!("업데이트 실패, 이전 버전으로 되돌림: {e}")),
        Ok(()) => log("업데이트 완료"),
    }
    let _ = fs::remove_dir_all(staging);
    remove_zips(&target.join(WORK_DIR_NAME));
    r
}

/// Splits helper arguments into (staging, target, pid, relaunch args).
fn parse_helper_args(args: &[String]) -> Result<(&str, &str, i64, &[String])> {
    let (mut staging, mut target, mut pid) = ("", "", -1i64);
    let mut relaunch: &[String] = &[];
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--" {
            relaunch = &args[i + 1..];
            break;
        } else if i == 0 {
            staging = a;
        } else if a == "--target" && i + 1 < args.len() {
            i += 1;
            target = &args[i];
        } else if a == "--wait-pid" && i + 1 < args.len() {
            i += 1;
            pid = args[i].parse().unwrap_or(0);
        } else {
            return Err(msg(format!("unexpected update argument {a:?}")));
        }
        i += 1;
    }
    Ok((staging, target, pid, relaunch))
}

fn remove_zips(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        if e.path().extension().is_some_and(|x| x == "zip") {
            let _ = fs::remove_file(e.path());
        }
    }
}

#[cfg(unix)]
fn wait_pid(pid: u32, timeout: Duration) -> io::Result<()> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        // SAFETY: kill with signal 0 only probes whether the process exists.
        if unsafe { libc::kill(pid as libc::pid_t, 0) } != 0
            && io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "timeout"))
}

#[cfg(windows)]
fn wait_pid(pid: u32, timeout: Duration) -> io::Result<()> {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    // SAFETY: plain Win32 calls on a handle we own and close.
    unsafe {
        let h = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if h.is_null() {
            return Ok(()); // already gone
        }
        let r = WaitForSingleObject(
            h,
            u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX - 1),
        );
        CloseHandle(h);
        if r == WAIT_OBJECT_0 {
            Ok(())
        } else {
            Err(io::Error::new(io::ErrorKind::TimedOut, "timeout"))
        }
    }
}

#[cfg(test)]
mod tests;
