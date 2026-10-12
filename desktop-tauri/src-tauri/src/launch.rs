//! Launch flags, library choice, the encryption policy for new libraries and
//! the one-time move of the pre-rename app data. Pure file logic; no window.

use local_api::Result;
use std::ffi::OsString;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};

/// The parsed command line (Go `launchOptions`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchOptions {
    pub copy_encrypted_to: String,
    pub initialize_encrypted: bool,
    pub create_plaintext: bool,
    pub use_library: String,
    pub database: PathBuf,
    pub engine_path: PathBuf,
    /// Accepted for compatibility (the updater relaunches with the original
    /// arguments); the window never opens a TCP port.
    pub listen: String,
    pub windowed: bool,
    pub lazy: bool,
    /// A note:// URL supplied by an OS protocol association. It is consumed
    /// by the renderer after the window is ready and is never carried across
    /// a library-relaunch boundary.
    pub open: String,
    pub explicit_db: bool,
}

/// Go `flag` semantics: `-name` or `--name`, `=value` or a separate value for
/// strings, only `=value` for booleans; parsing stops at `--` or the first
/// non-flag; an unknown flag is an error.
pub fn parse_launch_options(args: &[String], default_db: &Path) -> Result<LaunchOptions> {
    let mut o = LaunchOptions {
        copy_encrypted_to: String::new(),
        initialize_encrypted: false,
        create_plaintext: false,
        use_library: String::new(),
        database: default_db.to_path_buf(),
        engine_path: PathBuf::new(),
        listen: "127.0.0.1:47831".into(),
        windowed: true,
        lazy: true,
        open: String::new(),
        explicit_db: false,
    };
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        i += 1;
        if arg == "--" {
            break;
        }
        let Some(flag) = arg.strip_prefix("--").or_else(|| arg.strip_prefix('-')).filter(|f| !f.is_empty() && !arg.starts_with("---")) else {
            break;
        };
        let (name, inline) = match flag.split_once('=') {
            Some((n, v)) => (n, Some(v.to_string())),
            None => (flag, None),
        };
        let boolean = |value: Option<String>| -> Result<bool> {
            match value.as_deref() {
                None => Ok(true),
                Some("1" | "t" | "T" | "TRUE" | "true" | "True") => Ok(true),
                Some("0" | "f" | "F" | "FALSE" | "false" | "False") => Ok(false),
                Some(v) => Err(format!("invalid boolean value {v:?} for -{name}").into()),
            }
        };
        let mut string = |value: Option<String>| -> Result<String> {
            if let Some(v) = value {
                return Ok(v);
            }
            let v = args.get(i).cloned().ok_or_else(|| format!("flag needs an argument: -{name}"))?;
            i += 1;
            Ok(v)
        };
        match name {
            "copy-encrypted-to" => o.copy_encrypted_to = string(inline)?,
            "use-library" => o.use_library = string(inline)?,
            "db" => {
                o.database = PathBuf::from(string(inline)?);
                o.explicit_db = true;
            }
            "engine" => o.engine_path = PathBuf::from(string(inline)?),
            "listen" => o.listen = string(inline)?,
            "initialize-encrypted" => o.initialize_encrypted = boolean(inline)?,
            "create-plaintext" => o.create_plaintext = boolean(inline)?,
            "experimental-windowed-editor" => o.windowed = boolean(inline)?,
            "experimental-lazy-editor" => o.lazy = boolean(inline)?,
            "open" => o.open = string(inline)?,
            _ => return Err(format!("flag provided but not defined: -{name}").into()),
        }
    }
    Ok(o)
}

impl LaunchOptions {
    /// Picks the library to open. `Ok(false)` means the user cancelled the
    /// recovery selection and the app should exit quietly.
    pub fn resolve_library(
        &mut self,
        preference: &Path,
        default_db: &Path,
        windows: bool,
        recover: impl FnOnce(&str) -> Result<Option<PathBuf>>,
    ) -> Result<bool> {
        if !self.use_library.is_empty() {
            if self.explicit_db || self.initialize_encrypted || self.create_plaintext || !self.copy_encrypted_to.is_empty() {
                return Err("저장소 열기와 생성·복사 옵션은 함께 사용할 수 없습니다".into());
            }
            self.database = existing_library(Path::new(&self.use_library))?;
            return Ok(true);
        }
        if !windows || self.explicit_db {
            return Ok(true);
        }
        let reason = match load_library_preference(preference, default_db) {
            Ok(path) => {
                self.database = path;
                return Ok(true);
            }
            Err(e) => e,
        };
        let Some(selected) = recover(&reason.to_string())? else {
            return Ok(false);
        };
        self.database = existing_library(&selected)?;
        self.use_library = selected.to_string_lossy().into_owned();
        Ok(true)
    }

    /// Arguments that reopen this executable on `next` (Go `relaunch`).
    /// Explicit editor opt-outs survive the library change.
    pub fn relaunch_args(&self, next: &Path) -> Vec<OsString> {
        vec![
            "--use-library".into(),
            next.into(),
            "--engine".into(),
            self.engine_path.clone().into(),
            format!("--experimental-windowed-editor={}", self.windowed).into(),
            format!("--experimental-lazy-editor={}", self.lazy).into(),
        ]
    }

    pub fn bounded_editor(&self) -> bool {
        self.windowed || self.lazy
    }

    pub fn resolve_engine(&mut self) {
        if self.engine_path.as_os_str().is_empty() {
            self.engine_path = default_engine_path();
        }
    }

    /// Saves an unlocked library opened by choice as the default.
    pub fn remember_library(&self, preference: &Path, locked: bool) -> Result<()> {
        if self.use_library.is_empty() || locked {
            return Ok(());
        }
        save_library_preference(preference, &self.database).map_err(|e| format!("최근 저장소 설정 저장 실패: {e}").into())
    }
}

fn default_engine_path() -> PathBuf {
    let name = if cfg!(windows) { "inkism-engine.exe" } else { "inkism-engine" };
    let exe = std::env::current_exe().unwrap_or_default();
    let beside = exe.parent().unwrap_or(Path::new("")).join(name);
    if beside.exists() {
        return beside;
    }
    ["core", "runtime-core", "target", "release", name].iter().collect()
}

/// A selected library must already exist. Missing or malformed preferences
/// must not silently create an empty library that looks like data loss.
pub fn existing_library(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err("저장소 경로는 절대 경로여야 합니다".into());
    }
    let info = fs::metadata(path).map_err(|e| format!("선택한 저장소를 찾을 수 없습니다: {e}"))?;
    if !info.is_file() {
        return Err("저장소 파일을 선택해 주세요".into());
    }
    let mut marker = path.as_os_str().to_owned();
    marker.push(".migration-incomplete");
    match fs::metadata(PathBuf::from(marker)) {
        Ok(_) => return Err("완료되지 않은 암호화 사본은 열 수 없습니다".into()),
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(clean(path))
}

/// Lexical clean like Go `filepath.Clean`: drops `.`, folds `..`.
fn clean(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir if matches!(out.components().next_back(), Some(Component::Normal(_))) => {
                out.pop();
            }
            c => out.push(c),
        }
    }
    out
}

pub fn load_library_preference(path: &Path, fallback: &Path) -> Result<PathBuf> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(fallback.to_path_buf()),
        Err(e) => return Err(e.into()),
    };
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("최근 저장소 설정을 읽지 못했습니다: {e}"))?;
    let library = value.get("path").and_then(|p| p.as_str()).unwrap_or("");
    existing_library(Path::new(library))
}

/// Atomically replaces the preference; a bad library leaves the old one.
pub fn save_library_preference(path: &Path, library: &Path) -> Result<()> {
    let library = existing_library(library)?;
    let dir = path.parent().unwrap_or(Path::new("."));
    create_private_dir(dir)?;
    let bytes = serde_json::to_vec(&serde_json::json!({ "path": library }))?;
    let mut file = tempfile::Builder::new().prefix(".library-").suffix(".tmp").tempfile_in(dir)?;
    file.write_all(&bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|e| e.error)?;
    Ok(())
}

pub fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

/// A missing previously protected library must never become an empty
/// replacement merely because Google authentication succeeded.
pub fn validate_protected_library(path: &Path, configured: bool, explicit_new_encrypted: bool) -> Result<()> {
    if !configured || explicit_new_encrypted {
        return Ok(());
    }
    match fs::metadata(path) {
        Ok(info) if info.is_file() => Ok(()),
        _ => Err("Google 잠금이 설정된 저장소를 찾지 못했습니다. 기존 DB와 키 파일을 복구하거나 명시적으로 새 암호화 저장소를 선택해 주세요".into()),
    }
}

/// Existing libraries keep their storage policy. A new Windows library uses
/// the engine's encrypted initializer and never falls back to plaintext.
pub fn initialize_encrypted_for_path(path: &Path, windows: bool, explicit: bool, plaintext: bool) -> Result<bool> {
    if explicit && plaintext {
        return Err("암호화 생성과 평문 생성은 함께 선택할 수 없습니다".into());
    }
    if explicit {
        return Ok(true);
    }
    if plaintext || !windows {
        return Ok(false);
    }
    match fs::metadata(path) {
        Ok(_) => Ok(false),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(true),
        Err(e) => Err(format!("저장소 상태 확인 실패: {e}").into()),
    }
}

/// Before the rename the app kept its data in `<config>/Mindbox` and its
/// WebView2 profile in `<config>/Mindbox.exe`. Moves both to the Inkism names
/// once and rewrites the remembered library path. Never overwrites a folder
/// that already exists under the new name.
pub fn migrate_legacy_app_data(root: &Path) -> Result<()> {
    let old_dir = root.join("Mindbox");
    let new_dir = root.join("Inkism");
    let moved = move_if_only_old(&old_dir, &new_dir).map_err(|e| format!("이전 Mindbox 저장 폴더를 Inkism으로 옮기지 못했습니다: {e}"))?;
    if moved {
        rewrite_library_preference(&new_dir.join("library.json"), &old_dir, &new_dir).map_err(|e| format!("저장소 위치 기록을 고치지 못했습니다: {e}"))?;
        eprintln!("이전 저장 폴더를 옮겼습니다: {} -> {}", old_dir.display(), new_dir.display());
    }
    if let Err(e) = move_if_only_old(&root.join("Mindbox.exe"), &root.join("Inkism.exe")) {
        // The WebView2 profile only holds UI preferences; losing it is not fatal.
        eprintln!("이전 화면 설정 폴더를 옮기지 못했습니다: {e}");
    }
    Ok(())
}

fn move_if_only_old(old: &Path, new: &Path) -> std::io::Result<bool> {
    match fs::metadata(new) {
        Ok(_) => return Ok(false),
        Err(e) if e.kind() != ErrorKind::NotFound => return Err(e),
        Err(_) => {}
    }
    match fs::metadata(old) {
        Ok(info) if info.is_dir() => fs::rename(old, new).map(|_| true),
        Ok(_) => Ok(false),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

fn rewrite_library_preference(path: &Path, old_dir: &Path, new_dir: &Path) -> Result<()> {
    let data = match fs::read(path) {
        Ok(d) => d,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    // An unreadable preference is left to the normal recovery flow.
    let Ok(serde_json::Value::Object(mut preference)) = serde_json::from_slice(&data) else {
        return Ok(());
    };
    let current = preference.get("path").and_then(|p| p.as_str()).unwrap_or("");
    let Ok(rest) = Path::new(current).strip_prefix(old_dir) else {
        return Ok(());
    };
    if current.is_empty() {
        return Ok(());
    }
    let moved = if rest.as_os_str().is_empty() { new_dir.to_path_buf() } else { new_dir.join(rest) };
    preference.insert("path".into(), moved.to_string_lossy().into_owned().into());
    let mut updated = serde_json::to_vec_pretty(&preference)?;
    updated.push(b'\n');
    let permissions = fs::metadata(path)?.permissions();
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    fs::write(&tmp, updated)?;
    fs::set_permissions(&tmp, permissions)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_go_style_flags() {
        let def = Path::new("/cfg/Inkism/notes.db");
        let o = parse_launch_options(&[], def).unwrap();
        assert_eq!((o.database.as_path(), o.windowed, o.lazy, o.explicit_db), (def, true, true, false));
        let o = parse_launch_options(
            &strings(&["-db", "/x.db", "--engine=/e", "--experimental-lazy-editor=false", "-initialize-encrypted", "--listen", "127.0.0.1:1"]),
            def,
        )
        .unwrap();
        assert_eq!(o.database, Path::new("/x.db"));
        assert!(o.explicit_db && o.initialize_encrypted && o.windowed && !o.lazy);
        assert_eq!((o.engine_path.as_path(), o.listen.as_str()), (Path::new("/e"), "127.0.0.1:1"));
        // A bool flag never consumes the next argument; parsing stops at a non-flag.
        let o = parse_launch_options(&strings(&["-create-plaintext", "false", "-db", "/y"]), def).unwrap();
        assert!(o.create_plaintext && !o.explicit_db);
        let o = parse_launch_options(&strings(&["--open", "note://abc#^part"]), def).unwrap();
        assert_eq!(o.open, "note://abc#^part");
        assert!(parse_launch_options(&strings(&["--nope"]), def).is_err());
        assert!(parse_launch_options(&strings(&["--db"]), def).is_err());
        assert!(parse_launch_options(&strings(&["--create-plaintext=maybe"]), def).is_err());
    }

    #[test]
    fn relaunch_keeps_editor_opt_outs() {
        let mut o = parse_launch_options(&strings(&["--experimental-windowed-editor=false", "--engine", "/e"]), Path::new("/d")).unwrap();
        o.resolve_engine();
        let args: Vec<String> = o.relaunch_args(Path::new("/lib/next.db")).iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(
            args,
            strings(&["--use-library", "/lib/next.db", "--engine", "/e", "--experimental-windowed-editor=false", "--experimental-lazy-editor=true"])
        );
        // The relaunch arguments parse back to the same choice.
        let back = parse_launch_options(&args, Path::new("/d")).unwrap();
        assert_eq!((back.use_library.as_str(), back.windowed, back.lazy), ("/lib/next.db", false, true));
    }

    #[test]
    fn use_library_conflicts_and_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("a.db");
        fs::write(&lib, b"x").unwrap();
        let pref = dir.path().join("library.json");
        let def = dir.path().join("default.db");
        let mut o = parse_launch_options(&strings(&["--use-library", lib.to_str().unwrap(), "--create-plaintext"]), &def).unwrap();
        assert!(o.resolve_library(&pref, &def, true, |_| unreachable!()).is_err());
        let mut o = parse_launch_options(&strings(&["--use-library", lib.to_str().unwrap()]), &def).unwrap();
        assert!(o.resolve_library(&pref, &def, true, |_| unreachable!()).unwrap());
        assert_eq!(o.database, lib);
        // Broken preference: the user cancels recovery, or picks a library.
        fs::write(&pref, b"invalid").unwrap();
        let mut o = parse_launch_options(&[], &def).unwrap();
        assert!(!o.resolve_library(&pref, &def, true, |_| Ok(None)).unwrap());
        let mut o = parse_launch_options(&[], &def).unwrap();
        assert!(o.resolve_library(&pref, &def, true, |_| Ok(Some(lib.clone()))).unwrap());
        assert_eq!((o.database.as_path(), o.use_library.as_str()), (lib.as_path(), lib.to_str().unwrap()));
        // Elsewhere the preference is not consulted.
        let mut o = parse_launch_options(&[], &def).unwrap();
        assert!(o.resolve_library(&pref, &def, false, |_| unreachable!()).unwrap());
        assert_eq!(o.database, def);
    }

    #[test]
    fn library_preference_preserves_existing_selection() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        let pref = root.join("settings").join("library.json");
        let fallback = root.join("default.db");
        assert_eq!(load_library_preference(&pref, &fallback).unwrap(), fallback);
        let a = root.join("원본.db");
        let b = root.join("사본.db");
        for p in [&a, &b] {
            fs::write(p, b"fixture").unwrap();
        }
        for p in [&a, &b] {
            save_library_preference(&pref, p).unwrap();
            assert_eq!(&load_library_preference(&pref, &fallback).unwrap(), p);
        }
        let before = fs::read(&pref).unwrap();
        for bad in [Path::new("relative.db"), root, &root.join("missing.db")] {
            assert!(save_library_preference(&pref, bad).is_err(), "accepted {bad:?}");
            assert_eq!(fs::read(&pref).unwrap(), before, "lost previous selection");
        }
        fs::write(root.join("원본.db.migration-incomplete"), b"").unwrap();
        assert!(existing_library(&a).is_err(), "incomplete copy accepted");
        fs::remove_file(&b).unwrap();
        assert!(load_library_preference(&pref, &fallback).is_err(), "missing selected library silently replaced");
        fs::write(&pref, b"invalid").unwrap();
        assert!(load_library_preference(&pref, &fallback).is_err(), "malformed preference silently replaced");
    }

    #[test]
    fn configured_missing_library_never_creates_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("notes.db");
        assert!(validate_protected_library(&path, true, false).is_err());
        assert!(!path.parent().unwrap().exists(), "validation touched missing library");
        validate_protected_library(&path, true, true).unwrap();
        validate_protected_library(&path, false, false).unwrap();
        let existing = dir.path().join("notes.db");
        fs::write(&existing, b"preserved synthetic bytes").unwrap();
        validate_protected_library(&existing, true, false).unwrap();
        assert_eq!(fs::read(&existing).unwrap(), b"preserved synthetic bytes");
    }

    #[test]
    fn new_library_encryption_policy() {
        let dir = tempfile::tempdir().unwrap();
        let existing = dir.path().join("existing.db");
        fs::write(&existing, b"existing library must never be converted here").unwrap();
        let fresh = dir.path().join("new.db");
        #[rustfmt::skip]
        let cases = [
            ("Windows new defaults encrypted", &fresh, true, false, false, Some(true)),
            ("Windows existing unchanged", &existing, true, false, false, Some(false)),
            ("new plaintext opt out", &fresh, true, false, true, Some(false)),
            ("existing plaintext flag unchanged", &existing, true, false, true, Some(false)),
            ("Linux preview unchanged", &fresh, false, false, false, Some(false)),
            ("explicit uses initializer even on existing path", &existing, true, true, false, Some(true)),
            ("conflicting choices rejected", &fresh, true, true, true, None),
        ];
        for (name, path, windows, explicit, plaintext, want) in cases {
            assert_eq!(initialize_encrypted_for_path(path, windows, explicit, plaintext).ok(), want, "{name}");
        }
        assert_eq!(fs::read(&existing).unwrap(), b"existing library must never be converted here");
        assert!(!fresh.exists(), "policy must not create files");
    }

    #[test]
    fn migrate_legacy_moves_folder_and_preference() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        let old_dir = root.join("Mindbox");
        fs::create_dir_all(&old_dir).unwrap();
        fs::write(old_dir.join("notes.db"), b"db").unwrap();
        fs::write(old_dir.join("library.json"), serde_json::to_vec(&json!({"path": old_dir.join("notes.db"), "version": 1})).unwrap()).unwrap();
        fs::create_dir_all(root.join("Mindbox.exe").join("EBWebView")).unwrap();
        migrate_legacy_app_data(root).unwrap();
        let new_dir = root.join("Inkism");
        assert_eq!(fs::read(new_dir.join("notes.db")).unwrap(), b"db");
        assert!(!old_dir.exists(), "old folder still present");
        let got: serde_json::Value = serde_json::from_slice(&fs::read(new_dir.join("library.json")).unwrap()).unwrap();
        assert_eq!(got, json!({"path": new_dir.join("notes.db"), "version": 1}));
        assert!(root.join("Inkism.exe").join("EBWebView").is_dir(), "webview profile not moved");
        migrate_legacy_app_data(root).unwrap();
    }

    #[test]
    fn migrate_legacy_keeps_existing_new_folder() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        for name in ["Mindbox", "Inkism"] {
            fs::create_dir_all(root.join(name)).unwrap();
            fs::write(root.join(name).join("notes.db"), name).unwrap();
        }
        migrate_legacy_app_data(root).unwrap();
        for name in ["Mindbox", "Inkism"] {
            assert_eq!(fs::read_to_string(root.join(name).join("notes.db")).unwrap(), name);
        }
    }

    #[test]
    fn migrate_legacy_leaves_foreign_library_path() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        let old_dir = root.join("Mindbox");
        fs::create_dir_all(&old_dir).unwrap();
        let elsewhere = root.join("Encrypted-Library").join("notes.db");
        // A sibling whose name merely starts with the old folder name is foreign too.
        let sibling = root.join("Mindbox2").join("notes.db");
        for (i, foreign) in [&elsewhere, &sibling].into_iter().enumerate() {
            if i == 1 {
                fs::remove_dir_all(root.join("Inkism")).unwrap();
                fs::create_dir_all(&old_dir).unwrap();
            }
            fs::write(old_dir.join("library.json"), serde_json::to_vec(&json!({"path": foreign})).unwrap()).unwrap();
            migrate_legacy_app_data(root).unwrap();
            let got: serde_json::Value = serde_json::from_slice(&fs::read(root.join("Inkism").join("library.json")).unwrap()).unwrap();
            assert_eq!(got["path"], json!(foreign), "foreign path rewritten");
        }
    }
}
