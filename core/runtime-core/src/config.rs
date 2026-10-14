//! User-private sync configuration, persisted *beside* the note database.
//!
//! The vault key lives in a Windows user-protected file or `0600` file (Unix).
//! Explicit host-only server recovery may escrow it separately from note data.
//! The runtime never changes credentials implicitly. Windows
//! upgrades legacy plaintext encoding on load; changing the
//! vault URL or key requires an explicit `migration` flag (see `AppCore`).

use serde::{Deserialize, Serialize};
use sync_core::Key;

use crate::error::{Result, RuntimeError};

pub const CONFIG_VERSION: u32 = 1;

/// Optional local sync filter. Empty lists mean "all". The filter is
/// evaluated against the committed note payload before it is encrypted and
/// staged, so excluded notes never leave this device.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncScope {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notebook_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

/// Plain payload of `<db>.sync.json` (DPAPI envelope on Windows).
#[derive(Clone, Serialize, Deserialize)]
pub struct StoredConfig {
    pub version: u32,
    pub server_url: String,
    pub token: String,
    #[serde(default)]
    pub paused: bool,
    /// Internal state identity; absent in legacy configurations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_generation: Option<String>,
    /// Base64-encoded 32-byte vault key.
    pub key: String,
    #[serde(default)]
    pub scope: SyncScope,
}

impl StoredConfig {
    /// Load a config if the file exists. A present-but-corrupt file is an
    /// error, never treated as "not configured".
    pub fn load(path: &str) -> Result<Option<StoredConfig>> {
        Self::load_inner(path, true)
    }

    /// Inspect without upgrading the source file during a library copy.
    pub(crate) fn load_readonly(path: &str) -> Result<Option<StoredConfig>> {
        Self::load_inner(path, false)
    }

    fn load_inner(path: &str, _upgrade: bool) -> Result<Option<StoredConfig>> {
        match std::fs::read(path) {
            Ok(bytes) => {
                let protected = bytes.starts_with(PROTECTED_HEADER);
                let plain = if protected {
                    unprotect(&bytes[PROTECTED_HEADER.len()..])?
                } else {
                    bytes
                };
                let cfg: StoredConfig = serde_json::from_slice(&plain).map_err(|_| {
                    // Serde errors can quote invalid values. Never echo a secret.
                    RuntimeError::config(format!("sync config {path} is corrupt"))
                })?;
                if cfg.version != CONFIG_VERSION {
                    return Err(RuntimeError::config(format!(
                        "sync config {path} has unsupported version {}",
                        cfg.version
                    )));
                }
                cfg.validate_generation()?;
                #[cfg(windows)]
                if _upgrade && !protected {
                    // Upgrade only a valid legacy key. Atomic replacement leaves
                    // the original file intact if encryption or writing fails.
                    cfg.decode_key()?;
                    cfg.save(path)?;
                }
                Ok(Some(cfg))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(RuntimeError::Io(format!("reading {path}: {e}"))),
        }
    }

    /// Decode the configured vault key, with a clear error for bad material.
    pub fn decode_key(&self) -> Result<Key> {
        Key::from_base64(&self.key)
            .map_err(|e| RuntimeError::config(format!("invalid sync key: {e}")))
    }

    fn validate_generation(&self) -> Result<()> {
        if let Some(id) = &self.state_generation {
            if uuid::Uuid::parse_str(id)
                .ok()
                .map_or(true, |value| value.to_string() != *id)
            {
                return Err(RuntimeError::config("invalid sync state generation"));
            }
        }
        Ok(())
    }

    pub fn state_path(&self, db_path: &str) -> Result<String> {
        self.validate_generation()?;
        Ok(match &self.state_generation {
            Some(id) => format!("{db_path}.sync-{id}"),
            None => format!("{db_path}.sync"),
        })
    }

    pub(crate) fn generation(&self) -> &str {
        self.state_generation.as_deref().unwrap_or("")
    }

    /// Atomically write DPAPI ciphertext on Windows, owner-only JSON on Unix.
    pub fn save(&self, path: &str) -> Result<()> {
        self.validate_generation()?;
        if let Some(parent) = std::path::Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let tmp = format!("{path}.tmp{}", uuid::Uuid::new_v4());
        let bytes = protect(&serde_json::to_vec_pretty(self)?)?;
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| -> Result<()> {
            let mut file = options.open(&tmp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&tmp, path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result
    }
}

const PROTECTED_HEADER: &[u8] = b"MINDBOX-DPAPI-1\n";

/// Existing state databases owned by this library, including retained generations.
/// WAL/SHM files are handled by SQLite; unrelated names are never selected.
pub(crate) fn state_files(db_path: &str) -> Result<Vec<String>> {
    let db = std::path::Path::new(db_path);
    let parent = db
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let name = db
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .ok_or_else(|| RuntimeError::config("invalid library path"))?;
    let mut files = Vec::new();
    let legacy = format!("{db_path}.sync");
    if std::path::Path::new(&legacy).try_exists()? {
        files.push(legacy);
    }
    let entries = match std::fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(e) => return Err(e.into()),
    };
    let prefix = format!("{name}.sync-");
    for entry in entries {
        let entry = entry?;
        let filename = entry.file_name();
        let Some(filename) = filename.to_str() else {
            continue;
        };
        let Some(head) = filename.get(..prefix.len()) else {
            continue;
        };
        #[cfg(windows)]
        let matches = head.eq_ignore_ascii_case(&prefix);
        #[cfg(not(windows))]
        let matches = head == prefix;
        if !matches {
            continue;
        }
        let id = &filename[prefix.len()..];
        if uuid::Uuid::parse_str(id)
            .ok()
            .map_or(true, |value| value.to_string() != id)
        {
            continue;
        }
        if !entry.file_type()?.is_file() {
            return Err(RuntimeError::config("invalid sync state file"));
        }
        files.push(
            entry
                .path()
                .to_str()
                .ok_or_else(|| RuntimeError::config("invalid sync state path"))?
                .to_owned(),
        );
    }
    files.sort();
    Ok(files)
}

#[cfg(windows)]
fn protect(plain: &[u8]) -> Result<Vec<u8>> {
    let encrypted = inkism_windows_secrets::protect(plain)
        .map_err(|e| RuntimeError::config(format!("Windows secret protection failed: {e}")))?;
    let mut bytes = PROTECTED_HEADER.to_vec();
    bytes.extend_from_slice(&encrypted);
    Ok(bytes)
}
#[cfg(not(windows))]
fn protect(plain: &[u8]) -> Result<Vec<u8>> {
    Ok(plain.to_vec())
}

#[cfg(windows)]
fn unprotect(encrypted: &[u8]) -> Result<Vec<u8>> {
    inkism_windows_secrets::unprotect(encrypted).map_err(|e| {
        RuntimeError::config(format!(
            "Windows account cannot open the protected sync config: {e}"
        ))
    })
}
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> Result<Vec<u8>> {
    Err(RuntimeError::config(
        "Windows-protected sync config must be opened by its Windows account",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readonly_load_does_not_upgrade_legacy_source_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.json");
        let bytes = serde_json::to_vec(&fixture()).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        assert!(StoredConfig::load_readonly(path.to_str().unwrap())
            .unwrap()
            .is_some());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }

    fn fixture() -> StoredConfig {
        StoredConfig {
            version: CONFIG_VERSION,
            paused: false,
            state_generation: None,
            server_url: "https://sync.example.test".into(),
            token: "fixture-private-token".into(),
            key: Key::generate().to_base64(),
            scope: SyncScope::default(),
        }
    }
    #[test]
    fn state_generations_are_canonical_and_discovery_ignores_unrelated_files() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("한글 노트.db");
        let db = db.to_str().unwrap();
        let mut cfg = fixture();
        let id = "05e856db-4ab7-4f24-a087-195b92ac66e2".to_owned();
        cfg.state_generation = Some(id.clone());
        let path = cfg.state_path(db).unwrap();
        std::fs::write(&path, b"state").unwrap();
        std::fs::write(format!("{path}-wal"), b"sqlite-sidecar").unwrap();
        std::fs::write(format!("{db}.sync-unowned"), b"unowned").unwrap();
        assert_eq!(state_files(db).unwrap(), vec![path]);
        for bad in [
            "../../private".to_owned(),
            format!("{{{id}}}"),
            id.to_uppercase(),
        ] {
            cfg.state_generation = Some(bad);
            assert!(cfg.state_path(db).is_err());
            let config = dir.path().join("invalid.json");
            assert!(cfg.save(config.to_str().unwrap()).is_err());
            assert!(!config.exists());
        }
        assert_eq!(
            std::fs::read(format!("{db}.sync-unowned")).unwrap(),
            b"unowned"
        );
    }
    #[test]
    fn private_config_roundtrip_and_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.sync.json");
        let path = path.to_str().unwrap();
        let mut cfg = fixture();
        cfg.save(path).unwrap();
        let bytes = std::fs::read(path).unwrap();
        #[cfg(windows)]
        {
            assert!(bytes.starts_with(PROTECTED_HEADER));
            assert!(!bytes
                .windows(cfg.key.len())
                .any(|s| s == cfg.key.as_bytes()));
            assert!(!bytes
                .windows(cfg.token.len())
                .any(|s| s == cfg.token.as_bytes()));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert!(serde_json::from_slice::<StoredConfig>(&bytes).is_ok());
        }
        let reopened = StoredConfig::load(path).unwrap().unwrap();
        assert_eq!(reopened.token, cfg.token);
        assert_eq!(reopened.key, cfg.key);
        assert_eq!(
            std::fs::read(path).unwrap(),
            bytes,
            "protected reads must not rewrite the file"
        );
        cfg.token = "replacement-private-token".into();
        cfg.paused = true;
        cfg.save(path).unwrap();
        assert_eq!(StoredConfig::load(path).unwrap().unwrap().token, cfg.token);
        assert!(StoredConfig::load(path).unwrap().unwrap().paused);
    }
    #[test]
    fn legacy_config_preserves_credentials_and_migrates_on_windows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.sync.json");
        let path = path.to_str().unwrap();
        let cfg = fixture();
        let mut legacy = serde_json::to_value(&cfg).unwrap();
        legacy.as_object_mut().unwrap().remove("paused");
        let original = serde_json::to_vec(&legacy).unwrap();
        std::fs::write(path, &original).unwrap();
        let loaded = StoredConfig::load(path).unwrap().unwrap();
        assert_eq!(loaded.key, cfg.key);
        assert_eq!(loaded.token, cfg.token);
        assert!(!loaded.paused);
        assert_eq!(loaded.server_url, cfg.server_url);
        #[cfg(windows)]
        assert!(std::fs::read(path).unwrap().starts_with(PROTECTED_HEADER));
        #[cfg(not(windows))]
        assert_eq!(std::fs::read(path).unwrap(), original);
        assert_eq!(StoredConfig::load(path).unwrap().unwrap().key, cfg.key);
    }
    #[test]
    fn corrupt_and_protected_invalid_configs_fail_without_rewriting_or_echoing_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("corrupt.sync.json");
        let path = path.to_str().unwrap();
        let original =
            br#"{"version":"DO_NOT_ECHO_SECRET","server_url":"x","token":"t","key":"k"}"#;
        std::fs::write(path, original).unwrap();
        let err = StoredConfig::load(path).err().unwrap().to_string();
        assert!(!err.contains("DO_NOT_ECHO_SECRET"));
        assert_eq!(std::fs::read(path).unwrap(), original);
        let broken = [PROTECTED_HEADER, b"not-a-dpapi-blob"].concat();
        std::fs::write(path, &broken).unwrap();
        assert!(StoredConfig::load(path).is_err());
        assert_eq!(std::fs::read(path).unwrap(), broken);
    }
    #[test]
    fn failed_replace_preserves_target_and_cleans_temporary_config() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing-directory");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("keep"), b"untouched").unwrap();
        assert!(fixture().save(path.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read(path.join("keep")).unwrap(), b"untouched");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[cfg(windows)]
    #[test]
    fn dpapi_tampering_never_falls_back_to_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tampered.sync.json");
        let path = path.to_str().unwrap();
        fixture().save(path).unwrap();
        let mut bytes = std::fs::read(path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        std::fs::write(path, &bytes).unwrap();
        assert!(StoredConfig::load(path).is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
    #[cfg(windows)]
    #[test]
    fn failed_legacy_migration_keeps_original_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blocked.sync.json");
        let path = path.to_str().unwrap();
        let bytes = serde_json::to_vec(&fixture()).unwrap();
        std::fs::write(path, &bytes).unwrap();
        // Permit reads but deny replacement while this handle is open.
        let hold = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(path)
            .unwrap();
        assert!(StoredConfig::load(path).is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        drop(hold);
        StoredConfig::load(path).unwrap().unwrap();
        assert!(std::fs::read(path).unwrap().starts_with(PROTECTED_HEADER));
    }
}
