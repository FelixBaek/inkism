//! Android/iOS host: real local storage in the app sandbox, no child process,
//! no remote server required to open or edit a note.
use local_api::{Handler, Request, Response};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

const HOST: &str = if cfg!(target_os = "android") {
    "wails.localhost"
} else {
    "localhost"
};
const ORIGIN: &str = if cfg!(target_os = "android") {
    "http://wails.localhost"
} else {
    "wails://localhost"
};
const MAX_BODY: usize = 64 * 1024 * 1024;
struct MobileState {
    session: Arc<OnceLock<Arc<Handler>>>,
    directory: PathBuf,
    retry: Mutex<()>,
}
fn open_storage(directory: &Path) -> local_api::Result<Arc<Handler>> {
    std::fs::create_dir_all(directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(target_os = "ios")]
    {
        use objc2_foundation::{NSNumber, NSString, NSURLIsExcludedFromBackupKey, NSURL};
        let path = NSString::from_str(directory.to_str().ok_or("invalid library path")?);
        let url = NSURL::fileURLWithPath_isDirectory(&path, true);
        let excluded = NSNumber::numberWithBool(true);
        unsafe { url.setResourceValue_forKey_error(Some(&excluded), NSURLIsExcludedFromBackupKey) }
            .map_err(|_| "Could not exclude device-bound storage from backup")?;
    }
    Ok(Arc::new(inkism_native_host::open_handler(
        &directory.join("notes.db"),
        HOST,
    )?))
}
#[tauri::command]
async fn mobile_retry_storage(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MobileState>,
) -> Result<(), String> {
    if window.label() != "main" || !local_url(&window.url().map_err(|e| e.to_string())?) {
        return Err("untrusted app window".into());
    }
    let _guard = state
        .retry
        .try_lock()
        .map_err(|_| "이미 다시 시도하고 있습니다.")?;
    if state.session.get().is_none() {
        let handler = open_storage(&state.directory).map_err(|_| "보관함을 열 수 없습니다. 기기 잠금을 해제한 뒤 다시 시도하거나 안전 복구 안내를 확인해 주세요.")?;
        let _ = state.session.set(handler);
    }
    window
        .navigate(
            format!("{ORIGIN}/")
                .parse()
                .map_err(|_| "invalid app URL")?,
        )
        .map_err(|e| e.to_string())
}
#[derive(Deserialize)]
struct WireRequest {
    method: String,
    path: String,
    query: Option<String>,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}
#[derive(Serialize)]
struct WireResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}
impl From<Response> for WireResponse {
    fn from(response: Response) -> Self {
        let response = buffered_response(response);
        Self {
            status: response.status,
            headers: response.headers,
            body: response.body,
        }
    }
}
fn local_url(url: &tauri::Url) -> bool {
    url.scheme()
        == (if cfg!(target_os = "android") {
            "http"
        } else {
            "wails"
        })
        && url.host_str() == Some(HOST)
        && url.port().is_none()
}
#[tauri::command]
async fn mobile_api(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MobileState>,
    mut request: WireRequest,
) -> Result<WireResponse, String> {
    if window.label() != "main" || !local_url(&window.url().map_err(|e| e.to_string())?) {
        return Err("untrusted app window".into());
    }
    if !request.path.starts_with("/api/")
        || request.path.contains(['?', '#', '\0'])
        || request.body.len() > MAX_BODY
        || request.headers.len() > 128
    {
        return Err("invalid mobile request".into());
    }
    if !matches!(
        request.method.as_str(),
        "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH"
    ) {
        return Err("unsupported request method".into());
    }
    request.headers.retain(|(key, _)| {
        !matches!(
            key.to_ascii_lowercase().as_str(),
            "origin" | "host" | "sec-fetch-site"
        )
    });
    request
        .headers
        .iter_mut()
        .for_each(|(key, _)| *key = key.to_ascii_lowercase());
    request.headers.push(("origin".into(), ORIGIN.into()));
    let local = Request {
        method: request.method,
        path: request.path,
        query: request.query,
        headers: request.headers,
        host: HOST.into(),
        body: request.body,
    };
    let handler = state
        .session
        .get()
        .cloned()
        .ok_or("보관함이 잠겨 있습니다. 시작 화면에서 다시 시도해 주세요.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let response = handler.handle(&local);
        if response.body.len() > MAX_BODY {
            WireResponse::from(Response::fail(413, "모바일 응답은 64MB까지 지원합니다."))
        } else {
            response.into()
        }
    })
    .await
    .map_err(|e| e.to_string())
}
// Mobile IPC/custom protocols retain their existing 64 MiB response ceiling.
// A file spool must never become a successful empty ZIP on these adapters.
fn buffered_response(response: Response) -> Response {
    match response.into_buffered(MAX_BODY) {
        Ok(response)=>response,
        Err(e) if e.kind()==std::io::ErrorKind::InvalidData=>Response::fail(413,"모바일 응답은 64MB까지 지원합니다."),
        Err(e)=>Response::fail(500,e),
    }
}
fn response(response: Response) -> tauri::http::Response<Vec<u8>> {
    let response=buffered_response(response);
    let mut builder = tauri::http::Response::builder().status(response.status);
    for (name, value) in response.headers {
        builder = builder.header(name, value);
    }
    builder
        .body(response.body)
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}
pub fn run() {
    let session: Arc<OnceLock<Arc<Handler>>> = Arc::default();
    let protocol = session.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![mobile_api, mobile_retry_storage])
        .register_asynchronous_uri_scheme_protocol("wails", move |context, request, responder| {
            let handler = protocol.get().cloned();
            let app = context.app_handle().clone();
            std::thread::spawn(move || {
                let (parts, body) = request.into_parts();
                let path = parts.uri.path();
                let result = if path.starts_with("/api/") {
                    if !matches!(parts.method.as_str(), "GET" | "HEAD") {
                        Response::fail(405, "use mobile IPC for writes")
                    } else if let Some(handler) = handler {
                        handler.handle(&Request {
                            method: parts.method.to_string(),
                            path: path.into(),
                            query: parts.uri.query().map(str::to_owned),
                            headers: parts
                                .headers
                                .iter()
                                .filter_map(|(key, value)| {
                                    Some((key.as_str().into(), value.to_str().ok()?.into()))
                                })
                                .collect(),
                            host: HOST.into(),
                            body,
                        })
                    } else {
                        Response::fail(503, "storage is starting")
                    }
                } else if handler.is_none() {
                    Response { file: None, status: 200, headers: vec![("content-type".into(), "text/html; charset=utf-8".into()), ("cache-control".into(), "no-store".into())], body: include_bytes!("mobile-storage-recovery.html").to_vec() }
                } else {
                    match app.asset_resolver().get(path.to_owned()) {
                        Some(asset) => Response {
                            file: None,
                            status: 200,
                            headers: vec![("content-type".into(), asset.mime_type)],
                            body: asset.bytes,
                        },
                        None => Response::not_found(),
                    }
                };
                responder.respond(response(result));
            });
        })
        .setup(move |app| {
            let directory = app.path().app_data_dir()?;
            // Storage errors remain in the recovery screen; never panic or open plaintext.
            if let Ok(handler) = open_storage(&directory) { let _ = session.set(handler); }
            app.manage(MobileState { session: session.clone(), directory, retry: Mutex::new(()) });
            let start_link = app.deep_link().get_current()?.unwrap_or_default().into_iter().find(|url| url.scheme() == "note").map(|url| url.to_string());
            let script = format!("window.__inkismPendingNoteLink={};",serde_json::to_string(&start_link)?);
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::CustomProtocol(format!("{ORIGIN}/").parse()?),
            )
            .title("Inkism")
            .initialization_script(include_str!("mobile-bridge.js"))
            .initialization_script(&script)
            .on_navigation(local_url)
            .build()?;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(window) = handle.get_webview_window("main") {
                    for url in event.urls().into_iter().filter(|url| url.scheme() == "note") {
                        if let Ok(payload) = serde_json::to_string(url.as_str()) {
                            let _ = window.eval(&format!("window.__inkismPendingNoteLink={payload};window.dispatchEvent(new CustomEvent('inkism-open-link',{{detail:{payload}}}))"));
                        }
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Inkism mobile webview startup failed");
}
