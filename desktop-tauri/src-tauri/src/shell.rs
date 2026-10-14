//! The window (Go `main_windows.go`): one frameless webview on a custom
//! scheme that serves the renderer and answers `/api/*` in-process, the
//! close handshake, and the native pickers behind the storage actions.

use crate::{integrate, launch, security};
use google_auth::host::Controller;
use local_api::engine::Process;
use local_api::{start_upload_server, AgentApi, Clipper, Deadline, Engine, Handler, Native, Request, Response, SessionGate};
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::http;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// The scheme is `wails` on purpose: WebView2 serves a custom scheme as
/// `http://<scheme>.localhost`, so this keeps the previous page origin
/// `http://wails.localhost`. Together with [`profile_dir`] that keeps the
/// user's local UI preferences (theme, zoom, panel widths).
const SCHEME: &str = "wails";
const LABEL: &str = "main";

/// The host the page's `Origin` names. wry hands the handler the URI as
/// `wails://localhost/...` even on Windows, where the page origin is
/// `http://wails.localhost`, so the request URI cannot supply it. Only our
/// own window loads this scheme.
const PAGE_HOST: &str = if cfg!(windows) { "wails.localhost" } else { "localhost" };

fn start_url() -> &'static str {
    if cfg!(windows) {
        "http://wails.localhost/"
    } else {
        "wails://localhost/"
    }
}

/// The previous WebView2 profile folder: `%AppData%\<exe name>`, which the
/// legacy migration already moved to `Inkism.exe`.
fn profile_dir(root: &Path) -> PathBuf {
    root.join("Inkism.exe")
}

pub struct Session {
    pub process: Arc<Process>,
    pub engine: Arc<dyn Engine>,
    pub engine_path: PathBuf,
    pub database: PathBuf,
    pub config_root: PathBuf,
    pub security: Option<Arc<Controller>>,
    pub gate: Option<Arc<SessionGate>>,
    pub windowed: bool,
    pub lazy: bool,
    pub open: String,
}

/// Window state shared by the native callbacks.
#[derive(Default)]
struct CloseState {
    ready: AtomicBool,
    copying: AtomicBool,
    next_library: Mutex<Option<PathBuf>>,
}

#[derive(Debug, PartialEq, Eq)]
enum Close {
    Allow,
    Prevent,
    /// Prevent, and ask the renderer to save and call `/api/close`.
    AskRenderer,
}

/// Go `beforeClose`. `cancel_locked` is only consulted when it matters.
fn before_close(copying: bool, ready: bool, cancel_locked: impl FnOnce() -> bool) -> Close {
    if copying {
        Close::Prevent
    } else if ready || cancel_locked() {
        Close::Allow
    } else {
        Close::AskRenderer
    }
}

/// Runs the window until it closes; returns the library to reopen, if the
/// user picked one in the app.
pub fn run(session: Session) -> local_api::Result<Option<PathBuf>> {
    let state = Arc::new(CloseState::default());
    let app_cell: Arc<OnceLock<AppHandle>> = Arc::default();

    let mut handler = Handler::default();
    handler.engine = Some(session.engine.clone());
    handler.gate = session.gate.clone();
    handler.security = session.security.clone().map(|c| Arc::new(security::Security(c)) as _);
    handler.windowed_editor = session.windowed;
    handler.lazy_editor = session.lazy;
    handler.update = Some(Arc::new(crate::new_updater()));
    handler.native = native(&session, &state, &app_cell);
    let reminders = crate::reminders::start(&session.engine, session.gate.clone(), &session.database);
    if let Some((service, _)) = &reminders {
        handler.reminders = Some(service.clone());
    }
    let clipper = Clipper::start(session.gate.clone())?;
    handler.clipper = Some(clipper.clone());
    let mut uploads = start_upload_server(session.engine.clone(), session.gate.clone())?;
    handler.upload = Some(uploads.access.clone());
    let agent = AgentApi::start(session.engine.clone(), session.gate.clone());
    handler.agent = Some(agent.clone());
    let handler = Arc::new(handler);

    #[cfg(windows)]
    let note_link_server = Arc::new(Mutex::new(None));
    let result = (|| {
        let app = tauri::Builder::default()
            .invoke_handler(tauri::generate_handler![crate::web_viewer::web_viewer])
            .register_asynchronous_uri_scheme_protocol(SCHEME, {
                let handler = handler.clone();
                move |ctx, request, responder| {
                    if !crate::web_viewer::allow_app_protocol(ctx.webview_label()) {
                        responder.respond(http::Response::builder().status(403).body(Vec::<u8>::new()).unwrap());
                        return;
                    }
                    let (handler, app) = (handler.clone(), ctx.app_handle().clone());
                    // ponytail: one thread per request, like net/http; pool if it ever shows.
                    std::thread::spawn(move || responder.respond(serve(&handler, &app, request)));
                }
            })
            .setup({
                let (app_cell, root, open) = (app_cell.clone(), session.config_root.clone(), session.open.clone());
                #[cfg(windows)]
                let (note_link_server, database) = (note_link_server.clone(), session.database.clone());
                move |app| {
                    let _ = app_cell.set(app.handle().clone());
                    let url = start_url().parse().expect("static URL");
                    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::CustomProtocol(url))
                        .title("inkism")
                        .initialization_script("window.__inkismNativeWebViewer=true;")
                        .inner_size(1360.0, 900.0)
                        .min_inner_size(900.0, 600.0)
                        .decorations(false);
                    let builder = if cfg!(windows) { builder.data_directory(profile_dir(&root)) } else { builder };
                    let window = builder.build()?;
                    #[cfg(windows)]
                    start_note_link_server(&window, &database, &note_link_server);
                    if !open.is_empty() {
                        let payload = serde_json::to_string(&open).unwrap_or_else(|_| "\"\"".into());
                        // The renderer may not have mounted its listeners yet;
                        // dispatch once now and once after the first paint.
                        let script = format!("window.__inkismPendingNoteLink={payload};window.dispatchEvent(new CustomEvent('inkism-open-link',{{detail:{payload}}}))");
                        let _ = window.eval(&script);
                        let _ = window.eval(&format!("setTimeout(()=>{{{script}}},250)"));
                    }
                    Ok(())
                }
            })
            .on_window_event({
                let (state, security) = (state.clone(), session.security.clone());
                move |window, event| on_window_event(window, event, &state, security.as_deref())
            })
            .build(tauri::generate_context!())?;
        app.run_return(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                if let Some(window) = app.get_webview_window(LABEL) {
                    for url in urls.into_iter().filter(|url| url.scheme() == "note") {
                        if let Ok(payload) = serde_json::to_string(url.as_str()) {
                            let _ = window.eval(&format!("window.__inkismPendingNoteLink={payload};window.dispatchEvent(new CustomEvent('inkism-open-link',{{detail:{payload}}}))"));
                            let _ = window.set_focus();
                        }
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
        Ok::<_, local_api::Error>(())
    })();

    #[cfg(windows)]
    drop(note_link_server);
    if let Some((_, stop)) = reminders {
        stop();
    }
    clipper.close();
    agent.close();
    uploads.close();
    result?;
    let next = state.next_library.lock().unwrap_or_else(|p| p.into_inner()).take();
    Ok(next)
}

#[cfg(windows)]
fn start_note_link_server(
    window: &tauri::WebviewWindow,
    database: &Path,
    server_slot: &Mutex<Option<crate::note_link::Server>>,
) {
    let receiver = window.clone();
    // Only forward a note URL to the existing renderer. Its normal
    // save, library and Google-lock checks still decide navigation.
    let server = crate::note_link::Server::start(database, move |link| {
        let Ok(payload) = serde_json::to_string(link) else { return false; };
        let script = format!("window.__inkismPendingNoteLink={payload};window.dispatchEvent(new CustomEvent('inkism-open-link',{{detail:{payload}}}))");
        let accepted = receiver.eval(&script).is_ok();
        if accepted { let _ = receiver.show(); let _ = receiver.unminimize(); let _ = receiver.set_focus(); }
        accepted
    });
    // IPC is optional: keep the normal app and exclusive lock if it fails.
    if let Ok(server) = server { *server_slot.lock().unwrap() = Some(server); }
}

fn on_window_event(window: &tauri::Window, event: &WindowEvent, state: &CloseState, security: Option<&Controller>) {
    if window.label() != LABEL { return; }
    if matches!(event, WindowEvent::Destroyed) {
        if let Some(viewer) = window.app_handle().get_webview_window("web-viewer") { let _ = viewer.close(); }
    }
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    let decision = before_close(state.copying.load(Ordering::SeqCst), state.ready.load(Ordering::SeqCst), || {
        security::cancel_for_locked_close(security)
    });
    if decision == Close::Allow {
        return;
    }
    api.prevent_close();
    if decision == Close::AskRenderer {
        if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
            let _ = webview.eval("window.dispatchEvent(new Event('native-close-request'))");
        }
    }
}

fn close_window(app_cell: &OnceLock<AppHandle>) {
    if let Some(window) = app_cell.get().and_then(|app| app.get_webview_window(LABEL)) {
        let _ = window.close();
    }
}

fn native(session: &Session, state: &Arc<CloseState>, app_cell: &Arc<OnceLock<AppHandle>>) -> Native {
    let pdf_render = Box::new(|document: &[u8], deadline: Deadline| -> local_api::Result<Vec<u8>> {
        let renderer = inkism_pdf_export::Renderer {
            timeout: Some(deadline.saturating_duration_since(Instant::now()).min(Duration::from_secs(60))),
            ..Default::default()
        };
        Ok(renderer.render(document)?)
    });

    let encrypted_copy = {
        let (state, app_cell, process) = (state.clone(), app_cell.clone(), session.process.clone());
        Box::new(move |deadline: Deadline| -> local_api::Result<String> {
            let _busy = Busy::take(&state.copying).ok_or("암호화 복사가 이미 진행 중입니다")?;
            let Some(parent) = with_parent(rfd::FileDialog::new(), &app_cell).set_title("암호화 사본을 보관할 폴더 선택").pick_folder() else {
                return Ok(String::new());
            };
            let destination = parent.join(format!("Inkism-Encrypted-{}", timestamp()));
            integrate::copy_encrypted(&process, deadline, &destination)
        })
    };

    let open_library = {
        let (state, app_cell, binary) = (state.clone(), app_cell.clone(), session.engine_path.clone());
        Box::new(move || -> local_api::Result<bool> {
            let busy = Busy::take(&state.copying).ok_or("저장소 작업이 진행 중입니다")?;
            let Some(path) = with_parent(rfd::FileDialog::new(), &app_cell)
                .set_title("열 저장소 파일 선택")
                .add_filter("inkism 저장소", &["db"])
                .pick_file()
            else {
                return Ok(false);
            };
            let path = launch::existing_library(&path)?;
            let lock = inkism_reminders::applock::acquire(&path)?;
            let checked = integrate::check_library(&binary, &path, Instant::now() + Duration::from_secs(90));
            drop(lock);
            checked?;
            *state.next_library.lock().unwrap_or_else(|p| p.into_inner()) = Some(path);
            drop(busy);
            state.ready.store(true, Ordering::SeqCst);
            close_window(&app_cell);
            Ok(true)
        })
    };

    let close = {
        let (state, app_cell) = (state.clone(), app_cell.clone());
        Box::new(move || {
            state.ready.store(true, Ordering::SeqCst);
            close_window(&app_cell);
        })
    };

    Native {
        pdf_render: Some(pdf_render),
        encrypted_copy: Some(encrypted_copy),
        open_library: Some(open_library),
        close: Some(close),
    }
}

/// Holds an `AtomicBool` set for the duration of one storage action.
struct Busy<'a>(&'a AtomicBool);

impl<'a> Busy<'a> {
    fn take(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).ok().map(|_| Busy(flag))
    }
}

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Makes the picker modal to the window.
fn with_parent(dialog: rfd::FileDialog, app_cell: &OnceLock<AppHandle>) -> rfd::FileDialog {
    match app_cell.get().and_then(|app| app.get_webview_window(LABEL)) {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    }
}

/// Local time as Go's `20060102-150405.000000000` (UTC where the local
/// offset is unavailable).
fn timestamp() -> String {
    let now = time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc());
    let format = time::macros::format_description!("[year][month][day]-[hour][minute][second].[subsecond digits:9]");
    now.format(&format).unwrap_or_default()
}

fn serve(handler: &Handler, app: &AppHandle, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let request = to_local(request);
    let response = if request.path == "/api" || request.path.starts_with("/api/") {
        std::panic::catch_unwind(AssertUnwindSafe(|| handler.handle(&request))).unwrap_or_else(|_| Response::fail(500, "internal error"))
    } else {
        asset(app, &request.path)
    };
    to_http(response)
}

fn asset(app: &AppHandle, path: &str) -> Response {
    match app.asset_resolver().get(path.to_string()) {
        Some(asset) => {
            let mut response = Response { status: 200, headers: vec![("content-type".into(), asset.mime_type)], body: asset.bytes };
            if let Some(csp) = asset.csp_header {
                response.headers.push(("content-security-policy".into(), csp));
            }
            response
        }
        None => Response::not_found(),
    }
}

fn to_local(request: http::Request<Vec<u8>>) -> Request {
    let (parts, body) = request.into_parts();
    let headers: Vec<(String, String)> = parts
        .headers
        .iter()
        .filter_map(|(name, value)| Some((name.as_str().to_string(), value.to_str().ok()?.to_string())))
        .collect();
    Request {
        method: parts.method.as_str().to_string(),
        path: parts.uri.path().to_string(),
        query: parts.uri.query().map(str::to_string),
        headers,
        host: PAGE_HOST.into(),
        body,
    }
}

fn to_http(response: Response) -> http::Response<Vec<u8>> {
    let mut builder = http::Response::builder().status(response.status);
    for (name, value) in &response.headers {
        builder = builder.header(name, value);
    }
    builder.body(response.body).unwrap_or_else(|_| {
        let mut fallback = http::Response::new(b"invalid response".to_vec());
        *fallback.status_mut() = http::StatusCode::INTERNAL_SERVER_ERROR;
        fallback
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_decision_follows_the_go_order() {
        // A running copy keeps the window, without asking anything.
        assert_eq!(before_close(true, true, || unreachable!()), Close::Prevent);
        // The renderer already saved (or a relaunch is pending).
        assert_eq!(before_close(false, true, || unreachable!()), Close::Allow);
        // A locked app has no editor to flush.
        assert_eq!(before_close(false, false, || true), Close::Allow);
        // Otherwise the renderer saves first and calls /api/close.
        assert_eq!(before_close(false, false, || false), Close::AskRenderer);
    }

    #[test]
    fn busy_flag_is_exclusive_and_released() {
        let flag = AtomicBool::new(false);
        let first = Busy::take(&flag).unwrap();
        assert!(Busy::take(&flag).is_none());
        drop(first);
        assert!(Busy::take(&flag).is_some());
    }

    #[test]
    fn request_conversion_keeps_what_the_handler_checks() {
        // The page origin, and the URI as wry delivers it (rewritten on Windows too).
        let origin = start_url().trim_end_matches('/');
        let request = http::Request::builder()
            .method("POST")
            .uri("wails://localhost/api/rpc?x=1%202")
            .header("Origin", origin)
            .header("Content-Type", "application/json")
            .body(b"{}".to_vec())
            .unwrap();
        let local = to_local(request);
        assert_eq!((local.method.as_str(), local.path.as_str(), local.query.as_deref()), ("POST", "/api/rpc", Some("x=1%202")));
        assert_eq!(local.header("content-type"), Some("application/json"));
        assert_eq!(local.body, b"{}");
        // `Handler::same_origin` compares the Origin's host with `host`.
        let parsed = url::Url::parse(local.header("origin").unwrap()).unwrap();
        assert_eq!(parsed.host_str(), Some(local.host.as_str()));
    }

    #[test]
    fn response_conversion() {
        let response = to_http(Response::fail(423, "app is locked").with_header("x-test", "1"));
        assert_eq!(response.status(), 423);
        assert_eq!(response.headers()["content-type"], "application/json");
        assert_eq!(response.headers()["x-test"], "1");
        let body: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(body, serde_json::json!({"ok": false, "error": "app is locked"}));
    }

    #[test]
    fn timestamp_has_go_layout() {
        let t = timestamp();
        assert_eq!(t.len(), "20060102-150405.000000000".len(), "{t}");
        assert_eq!((&t[8..9], &t[15..16]), ("-", "."));
    }
}
