//! The AI provider API key, kept DPAPI-protected (current Windows user) in
//! the app data folder so it survives a restart. The sealed text is
//! `v1\n<origin>\n<key>`: a key is only handed back for the server origin it
//! was entered for. Without a secure store (non-Windows) nothing is written
//! and the renderer keeps the key in memory only.

use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use tauri::{State, WebviewWindow};
use zeroize::Zeroizing;

type ProtectFn = fn(&[u8]) -> io::Result<Vec<u8>>;

pub struct KeyStore {
    path: PathBuf,
    /// `(protect, unprotect)`; `None` when this platform has no secure store.
    seal: Option<(ProtectFn, ProtectFn)>,
}

const LIMIT: u64 = 16 * 1024;

fn printable(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| (0x21..=0x7e).contains(&b))
}
fn valid_origin(origin: &str) -> bool {
    printable(origin, 512) && (origin.starts_with("https://") || origin.starts_with("http://"))
}

impl KeyStore {
    pub fn new(path: PathBuf) -> Self {
        #[cfg(windows)]
        let seal = Some((inkism_windows_secrets::protect as ProtectFn, inkism_windows_secrets::unprotect as ProtectFn));
        #[cfg(not(windows))]
        let seal = None;
        Self { path, seal }
    }

    fn seal(&self) -> Result<(ProtectFn, ProtectFn), String> {
        self.seal.ok_or_else(|| "secure key storage is unavailable".into())
    }

    /// The key saved for `origin`; empty when none is, or it belongs to another server.
    pub fn load(&self, origin: &str) -> Result<Zeroizing<String>, String> {
        let (_, unprotect) = self.seal()?;
        let plain = match read_bounded(&self.path) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Zeroizing::default()),
            Err(e) if e.kind() != io::ErrorKind::InvalidData => return Err("saved key is unreadable".into()),
            raw => Zeroizing::new(raw.and_then(|raw| unprotect(&raw)).unwrap_or_default()),
        };
        match std::str::from_utf8(&plain).ok().and_then(|text| text.strip_prefix("v1\n")).and_then(|rest| rest.split_once('\n')) {
            Some((saved, key)) if saved == origin && printable(key, 4096) => Ok(Zeroizing::new(key.to_owned())),
            Some(_) => Ok(Zeroizing::default()),
            // Corrupt, or sealed for another Windows user or machine: drop it so a new key can be saved.
            None => self.clear().map(|_| Zeroizing::default()),
        }
    }

    /// Replaces the saved key: sealed into a private temp file, then renamed over.
    pub fn save(&self, origin: &str, key: &str) -> Result<(), String> {
        let (protect, _) = self.seal()?;
        if !valid_origin(origin) || !printable(key, 4096) {
            return Err("invalid API key or server".into());
        }
        let plain = Zeroizing::new(format!("v1\n{origin}\n{key}"));
        let sealed = protect(plain.as_bytes()).map_err(|_| "could not protect the API key")?;
        self.write(&sealed).map_err(|_| "could not save the API key".into())
    }

    fn write(&self, sealed: &[u8]) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            let mut builder = fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
            builder.create(dir)?;
        }
        let temp = self.path.with_extension("tmp");
        remove(&temp)?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = options.open(&temp)?;
        file.write_all(sealed)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, &self.path)
    }

    pub fn clear(&self) -> Result<(), String> {
        remove(&self.path).map_err(|_| "could not delete the API key".into())
    }
}

fn remove(path: &std::path::Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// A regular (non-symlink) file of at most [`LIMIT`] bytes.
fn read_bounded(path: &std::path::Path) -> io::Result<Vec<u8>> {
    let info = fs::symlink_metadata(path)?;
    if !info.file_type().is_file() || info.len() > LIMIT {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "not a key file"));
    }
    let mut raw = Vec::new();
    fs::File::open(path)?.take(LIMIT).read_to_end(&mut raw)?;
    Ok(raw)
}

/// `load` returns the key (or ""), `save`/`clear` return "". Errors when the
/// store is unavailable; the renderer then keeps the key in memory only.
#[tauri::command]
pub fn ai_key(window: WebviewWindow, store: State<KeyStore>, action: String, origin: String, key: String) -> Result<String, String> {
    let key = Zeroizing::new(key);
    if !crate::web_viewer::trusted(&window) {
        return Err("untrusted key caller".into());
    }
    match action.as_str() {
        "load" => store.load(&origin).map(|k| k.as_str().to_owned()),
        "save" => store.save(&origin, &key).map(|_| String::new()),
        "clear" => store.clear().map(|_| String::new()),
        _ => Err("unknown key action".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flip(b: &[u8]) -> io::Result<Vec<u8>> {
        Ok(b.iter().map(|x| x ^ 0x5a).collect())
    }
    fn store(dir: &tempfile::TempDir) -> KeyStore {
        KeyStore { path: dir.path().join("Inkism").join("ai-key.dpapi"), seal: Some((flip, flip)) }
    }

    #[test]
    fn save_load_clear() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        assert_eq!(s.load("https://api.example.test").unwrap().as_str(), "", "absent file is no key");
        s.save("https://api.example.test", "sk-one").unwrap();
        s.save("https://api.example.test", "sk-two").unwrap();
        assert_eq!(s.load("https://api.example.test").unwrap().as_str(), "sk-two", "save replaces");
        let raw = fs::read(&s.path).unwrap();
        assert!(!raw.windows(6).any(|w| w == b"sk-two"), "never plain text on disk");
        assert!(!s.path.with_extension("tmp").exists());
        assert_eq!(s.load("https://other.example.test").unwrap().as_str(), "", "never handed to another server");
        s.clear().unwrap();
        s.clear().unwrap();
        assert!(!s.path.exists());
        assert_eq!(s.load("https://api.example.test").unwrap().as_str(), "");
    }

    #[test]
    fn rejects_bad_input_and_files() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        for (origin, key) in [("https://a.test", ""), ("https://a.test", "sk x"), ("https://a.test", "sk\nx"), ("file:///x", "sk"), ("", "sk")] {
            assert!(s.save(origin, key).is_err(), "{origin:?} {key:?}");
        }
        assert!(!s.path.exists());
        fs::create_dir_all(s.path.parent().unwrap()).unwrap();
        fs::write(&s.path, flip(b"garbage").unwrap()).unwrap();
        assert_eq!(s.load("https://a.test").unwrap().as_str(), "", "unreadable file gives no key");
        assert!(!s.path.exists(), "unreadable file is dropped so a new key can be saved");
        fs::write(&s.path, vec![0; LIMIT as usize + 1]).unwrap();
        assert_eq!(s.load("https://a.test").unwrap().as_str(), "", "oversized file");
        assert!(!s.path.exists());
        s.save("https://a.test", "sk-new").unwrap();
        assert_eq!(s.load("https://a.test").unwrap().as_str(), "sk-new", "store stays usable");
        let none = KeyStore { path: s.path.clone(), seal: None };
        assert!(none.load("https://a.test").is_err() && none.save("https://a.test", "sk").is_err(), "no secure store: memory only");
    }
}
