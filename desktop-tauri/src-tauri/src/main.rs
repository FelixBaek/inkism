//! Inkism desktop entry point (Go `desktop/main.go`): helper modes, launch
//! flags, library choice, the library lock, the engine and the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_key;
mod integrate;
mod launch;
#[cfg(any(windows, test))]
mod note_link;
mod reminders;
mod security;
mod shell;
mod window_trust;

use launch::LaunchOptions;
use local_api::Result;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

// Compiled in by tools/scripts/build-windows-tauri.sh. An empty feed leaves
// in-app updates unconfigured. (`INKISM_UPDATE_FEED` at run time is the
// updater's own test override.)
const APP_VERSION: &str = match option_env!("INKISM_APP_VERSION") {
    Some(v) => v,
    None => "0.0.0-dev",
};
const APP_COMMIT: &str = match option_env!("INKISM_APP_COMMIT") {
    Some(v) => v,
    None => "",
};
const UPDATE_FEED: &str = match option_env!("INKISM_APP_UPDATE_FEED") {
    Some(v) => v,
    None => "",
};

fn args() -> Vec<String> {
    std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned()).collect()
}

pub fn new_updater() -> app_update::Updater {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    app_update::Updater::new(APP_VERSION, APP_COMMIT, UPDATE_FEED, dir, args())
}

fn main() {
    let args = args();
    if args.first().map(String::as_str) == Some("--apply-update") {
        if let Err(e) = app_update::run_helper(&args[1..]) {
            eprintln!("{e}");
            std::process::exit(1);
        }
        return;
    }
    if let Some(result) = reminders::command(&args) {
        if let Err(e) = result {
            eprintln!("종료 중 알림 작업 실패: {e}");
            std::process::exit(1);
        }
        return;
    }
    if let Err(e) = run(&args) {
        eprintln!("{e}");
        show_startup_error(&e.to_string());
        std::process::exit(1);
    }
}

/// Go `os.UserConfigDir`.
fn user_config_dir() -> Result<PathBuf> {
    let env = |name| std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    let dir = if cfg!(windows) {
        env("APPDATA")
    } else if cfg!(target_os = "macos") {
        env("HOME").map(|h| h.join("Library").join("Application Support"))
    } else {
        env("XDG_CONFIG_HOME").filter(|p| p.is_absolute()).or_else(|| env("HOME").map(|h| h.join(".config")))
    };
    dir.ok_or_else(|| "사용자 저장 폴더 확인 실패: 설정 폴더를 찾지 못했습니다".into())
}

fn run(args: &[String]) -> Result<()> {
    let root = user_config_dir()?;
    launch::migrate_legacy_app_data(&root)?;
    let default_db = root.join("Inkism").join("notes.db");
    let mut opts = launch::parse_launch_options(args, &default_db)?;
    let security = security::new_google_security(&root);
    let result = run_with(&root, &mut opts, &default_db, security.clone());
    if let Some(security) = security {
        security.cancel();
    }
    result
}

fn run_with(root: &Path, opts: &mut LaunchOptions, default_db: &Path, security: Option<Arc<google_auth::host::Controller>>) -> Result<()> {
    let locked = security.as_ref().is_some_and(|s| s.initially_locked());
    let preference = root.join("Inkism").join("library.json");
    if !opts.resolve_library(&preference, default_db, cfg!(windows), recover_library_selection)? {
        return Ok(());
    }
    #[cfg(windows)]
    if !opts.open.is_empty() && note_link::forward(&opts.database, &opts.open)? {
        return Ok(());
    }
    launch::validate_protected_library(&opts.database, locked, opts.initialize_encrypted)?;
    launch::create_private_dir(opts.database.parent().unwrap_or(Path::new(".")))?;
    let library_lock = match inkism_reminders::applock::acquire(&opts.database) {
        Ok(lock) => lock,
        Err(error) => {
            #[cfg(windows)]
            if error.is_busy() && !opts.open.is_empty() {
                // A first process may still be starting its window after taking the lock.
                let deadline = Instant::now() + Duration::from_secs(2);
                while Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(50));
                    if note_link::forward(&opts.database, &opts.open)? { return Ok(()); }
                }
            }
            return Err(error.into());
        }
    };
    opts.resolve_engine();
    if !opts.copy_encrypted_to.is_empty() {
        return copy_encrypted(opts, locked);
    }
    let process = start_engine(opts, locked)?;
    let next = (|| {
        let gate = match &security {
            Some(controller) => {
                let remember = (!opts.use_library.is_empty()).then(|| {
                    let (preference, database) = (preference.clone(), opts.database.clone());
                    Box::new(move || launch::save_library_preference(&preference, &database)) as Box<dyn Fn() -> Result<()> + Send + Sync>
                });
                Some(security::attach(controller, &process, &opts.database, remember)?)
            }
            None => None,
        };
        opts.remember_library(&preference, locked)?;
        shell::run(shell::Session {
            engine: integrate::engine(&process),
            process: process.clone(),
            engine_path: opts.engine_path.clone(),
            database: opts.database.clone(),
            config_root: root.to_path_buf(),
            security: security.clone(),
            gate,
            windowed: opts.bounded_editor(),
            lazy: opts.lazy,
            open: opts.open.clone(),
        })
    })();
    // Engine, then lock, then relaunch: the next instance must find both free.
    if let Err(e) = integrate::close(&process) {
        eprintln!("저장 엔진 종료 실패: {e}");
    }
    drop(library_lock);
    match next? {
        Some(library) => relaunch(opts, &library),
        None => Ok(()),
    }
}

/// Starts this executable on the library chosen in the app.
fn relaunch(opts: &LaunchOptions, library: &Path) -> Result<()> {
    let exe = std::env::current_exe()?;
    std::process::Command::new(exe)
        .args(opts.relaunch_args(library))
        .spawn()
        .map_err(|e| format!("선택한 저장소를 열지 못했습니다: {e}"))?;
    Ok(())
}

fn copy_encrypted(opts: &LaunchOptions, locked: bool) -> Result<()> {
    if locked {
        return Err("Google 잠금이 설정된 저장소는 앱에서 인증한 뒤 복사해 주세요".into());
    }
    if opts.initialize_encrypted || opts.create_plaintext {
        return Err("암호화 복사와 새 저장소 초기화 옵션은 함께 사용할 수 없습니다".into());
    }
    let output = std::process::Command::new(&opts.engine_path)
        .arg("--db")
        .arg(&opts.database)
        .arg("--copy-encrypted-to")
        .arg(&opts.copy_encrypted_to)
        .output()?;
    let mut text = output.stdout;
    text.extend_from_slice(&output.stderr);
    let text = String::from_utf8_lossy(&text);
    if !output.status.success() {
        return Err(format!("암호화 복사 실패: {}\n{text}", output.status).into());
    }
    print!("{text}");
    Ok(())
}

/// Checks a newly selected library, then starts the engine suspended while
/// the Google lock is closed.
fn start_engine(opts: &LaunchOptions, locked: bool) -> Result<Arc<local_api::engine::Process>> {
    if !opts.use_library.is_empty() && !locked {
        integrate::check_library(&opts.engine_path, &opts.database, Instant::now() + Duration::from_secs(90))?;
    }
    let initialize = launch::initialize_encrypted_for_path(&opts.database, cfg!(windows), opts.initialize_encrypted, opts.create_plaintext)?;
    let how = match (locked, initialize) {
        (true, true) => integrate::Start::SuspendedEncrypted,
        (true, false) => integrate::Start::Suspended,
        (false, true) => integrate::Start::NewEncrypted,
        (false, false) => integrate::Start::Plain,
    };
    integrate::start(&opts.engine_path, &opts.database, how).map_err(|e| {
        format!("저장 엔진 시작 실패: {e}\nInkism.exe와 inkism-engine.exe가 같은 폴더에 있는지 확인해 주세요").into()
    })
}

#[cfg(windows)]
fn message_box(text: &str, title: &str, style: u32) -> i32 {
    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let (text, title) = (wide(text), wide(title));
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), style) }
}

/// Startup errors get a dialog on Windows (there is no console).
fn show_startup_error(message: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK};
        message_box(&format!("inkism을 시작하지 못했습니다.\n\n{message}"), "inkism", MB_OK | MB_ICONERROR);
    }
    #[cfg(not(windows))]
    let _ = message;
}

/// Asks before re-selecting a library whose remembered path broke. `No`
/// (the default button) exits without touching anything.
#[cfg(windows)]
fn recover_library_selection(reason: &str) -> Result<Option<PathBuf>> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_YESNO};
    let text = format!("최근 저장소를 열 수 없습니다.\n\n{reason}\n\n기존 저장소 파일을 다시 선택하시겠습니까?\n아니요를 누르면 파일을 변경하지 않고 종료합니다.");
    if message_box(&text, "inkism 저장소 복구", MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) != IDYES {
        return Ok(None);
    }
    Ok(rfd::FileDialog::new().set_title("복구할 저장소 파일 선택").add_filter("inkism 저장소 (*.db)", &["db"]).pick_file())
}

#[cfg(not(windows))]
fn recover_library_selection(reason: &str) -> Result<Option<PathBuf>> {
    Err(reason.into())
}
