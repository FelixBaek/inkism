//! Protected, exclusive-create policy files and the public client config.

use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{HostError, Identity, Store};
use crate::BoxError;

/// Encrypts or decrypts a policy blob (DPAPI on Windows).
pub type ProtectFn = Arc<dyn Fn(&[u8]) -> Result<Vec<u8>, BoxError> + Send + Sync>;

/// The public client config. It remains ID-only; registration credentials
/// are held separately in a protected store bound to that ID.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClientConfig {
    pub client_id: String,
}

/// `^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$`
fn valid_client_id(id: &str) -> bool {
    let Some((number, rest)) = id.split_once('-') else {
        return false;
    };
    !number.is_empty()
        && number.bytes().all(|b| b.is_ascii_digit())
        && rest
            .strip_suffix(".apps.googleusercontent.com")
            .is_some_and(|p| {
                !p.is_empty()
                    && p.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })
}

fn valid_client_secret(secret: &str) -> bool {
    !secret.is_empty() && secret.len() <= 1024 && secret.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

pub fn read_config(path: &Path) -> Result<ClientConfig, HostError> {
    let raw = bounded_file(path, 8192)?;
    let config: ClientConfig = strict_json(&raw).ok_or(HostError::Failed(
        "Google 데스크톱 클라이언트 설정 형식이 올바르지 않습니다",
    ))?;
    if !valid_client_id(&config.client_id) {
        return Err(HostError::Failed("invalid Google desktop client ID"));
    }
    Ok(config)
}

#[derive(Clone)]
pub struct FileStore {
    pub path: PathBuf,
    pub protect: Option<ProtectFn>,
    pub unprotect: Option<ProtectFn>,
}

/// Registration credential, bound to one client ID.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClientCredentials {
    client_id: String,
    client_secret: String,
}

impl FileStore {
    pub fn new(path: impl Into<PathBuf>, protect: ProtectFn, unprotect: ProtectFn) -> Self {
        Self {
            path: path.into(),
            protect: Some(protect),
            unprotect: Some(unprotect),
        }
    }

    /// Returns the plaintext of an existing file; `Ok(None)` when absent.
    fn load_plain(&self, limit: u64) -> Result<Option<Zeroizing<Vec<u8>>>, HostError> {
        let raw = match bounded_file(&self.path, limit) {
            Err(HostError::Io(e)) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            other => other?,
        };
        let unprotect = self.unprotect.as_ref().ok_or(HostError::Unavailable)?;
        unprotect(&raw)
            .map(|p| Some(Zeroizing::new(p)))
            .map_err(|_| HostError::Policy)
    }

    pub fn save_client_secret(&self, client_id: &str, secret: &str) -> Result<(), HostError> {
        if !valid_client_id(client_id) || !valid_client_secret(secret) {
            return Err(HostError::Policy);
        }
        let credentials = ClientCredentials {
            client_id: client_id.into(),
            client_secret: secret.into(),
        };
        let raw = Zeroizing::new(serde_json::to_vec(&credentials).map_err(|_| HostError::Policy)?);
        self.save_protected(&raw)
    }

    /// `Ok("")` when no credential exists: registrations may need no secret.
    pub fn load_client_secret(&self, client_id: &str) -> Result<String, HostError> {
        let Some(plain) = self.load_plain(16384).map_err(|_| HostError::Policy)? else {
            return Ok(String::new());
        };
        match strict_json::<ClientCredentials>(&plain) {
            Some(c) if c.client_id == client_id && valid_client_secret(&c.client_secret) => {
                Ok(c.client_secret)
            }
            _ => Err(HostError::Policy),
        }
    }

    fn save_protected(&self, raw: &[u8]) -> Result<(), HostError> {
        let protect = self.protect.as_ref().ok_or(HostError::Unavailable)?;
        match fs::symlink_metadata(&self.path) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            _ => {
                return Err(HostError::Failed(
                    "account binding already exists or is unreadable",
                ))
            }
        }
        let encrypted = protect(raw).map_err(|_| HostError::Policy)?;
        if let Some(dir) = self.path.parent() {
            create_private_dir(dir)?;
        }
        // Exclusive creation never replaces an existing account. Interrupted
        // writes deliberately remain fail-closed instead of enabling a new one.
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = options.open(&self.path)?;
        file.write_all(&encrypted)?;
        file.sync_all()?;
        Ok(())
    }
}

fn create_private_dir(dir: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

impl Store for FileStore {
    fn load(&self) -> Result<Option<Identity>, HostError> {
        let Some(plain) = self.load_plain(16384)? else {
            return Ok(None);
        };
        match strict_json::<Identity>(&plain) {
            Some(identity) if identity.valid() => Ok(Some(identity)),
            _ => Err(HostError::Policy),
        }
    }

    fn save(&self, identity: &Identity) -> Result<(), HostError> {
        let raw = Zeroizing::new(serde_json::to_vec(identity).map_err(|_| HostError::Policy)?);
        self.save_protected(&raw)
    }
}

/// A store protected by the current Windows user's DPAPI key.
#[cfg(windows)]
pub fn windows_store(path: impl Into<PathBuf>) -> FileStore {
    let protect: ProtectFn = Arc::new(|b| Ok(inkism_windows_secrets::protect(b)?));
    let unprotect: ProtectFn = Arc::new(|b| Ok(inkism_windows_secrets::unprotect(b)?));
    FileStore::new(path, protect, unprotect)
}

/// Reads a regular (non-symlink) file of at most `limit` bytes.
pub(crate) fn bounded_file(path: &Path, limit: u64) -> Result<Vec<u8>, HostError> {
    let info = fs::symlink_metadata(path)?;
    if !info.file_type().is_file() || info.len() > limit {
        return Err(HostError::Failed("invalid configuration file"));
    }
    let mut raw = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut raw)?;
    if raw.len() as u64 > limit {
        return Err(HostError::Failed("oversized configuration"));
    }
    Ok(raw)
}

/// One JSON value, no unknown fields (via `deny_unknown_fields`), no trailing data.
pub(crate) fn strict_json<T: DeserializeOwned>(raw: &[u8]) -> Option<T> {
    serde_json::from_slice(raw).ok()
}
