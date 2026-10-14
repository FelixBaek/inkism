//! External sites never share the note window's profile or custom protocol access.
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
const LABEL: &str = "web-viewer";
fn public_url(raw: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(raw).map_err(|_| "invalid web address")?;
    let host = url.host_str().unwrap_or("").trim_end_matches('.').to_ascii_lowercase();
    if !matches!(url.scheme(), "https" | "http") || !url.username().is_empty() || url.password().is_some()
        || host.is_empty() || !host.contains('.') || host.ends_with(".localhost") || host.ends_with(".local")
        || host.parse::<std::net::IpAddr>().is_ok() || host.starts_with('[')
    { return Err("only public website hostnames are allowed".into()); }
    Ok(url)
}
pub fn allow_app_protocol(label: &str) -> bool { label == "main" }
pub(crate) fn trusted(window: &WebviewWindow) -> bool {
    allow_app_protocol(window.label()) && window.url().ok().is_some_and(|url| {
        if cfg!(windows) { url.scheme() == "http" && url.host_str() == Some("wails.localhost") && url.port().is_none() }
        else { url.scheme() == "wails" && url.host_str() == Some("localhost") && url.port().is_none() }
    })
}
#[tauri::command]
pub fn web_viewer(window: WebviewWindow, action: String, url: Option<String>) -> Result<String, String> {
    if !trusted(&window) { return Err("untrusted viewer controller".into()); }
    let app = window.app_handle();
    if action == "external" {
        let target = public_url(url.as_deref().unwrap_or(""))?;
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
            let verb: Vec<u16> = "open\0".encode_utf16().collect();
            let value: Vec<u16> = target.as_str().encode_utf16().chain([0]).collect();
            let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), value.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
            if result as usize <= 32 { return Err("could not open browser".into()); }
        }
        #[cfg(not(windows))]
        std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" })
            .arg(target.as_str()).spawn().map_err(|e| e.to_string())?;
        return Ok(String::new());
    }
    if action == "open" {
        let target = public_url(url.as_deref().unwrap_or(""))?;
        if let Some(viewer) = app.get_webview_window(LABEL) {
            viewer.navigate(target).map_err(|e| e.to_string())?;
            viewer.set_focus().map_err(|e| e.to_string())?;
        } else {
            WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(target))
                .title("Inkism · Web Viewer").inner_size(1100.0, 760.0)
                .incognito(true)
                .on_navigation(|url| public_url(url.as_str()).is_ok())
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build().map_err(|e| e.to_string())?;
        }
        return Ok(String::new());
    }
    let Some(viewer) = app.get_webview_window(LABEL) else { return Ok(String::new()); };
    match action.as_str() {
        "back" => viewer.eval("history.back()").map_err(|e| e.to_string())?,
        "forward" => viewer.eval("history.forward()").map_err(|e| e.to_string())?,
        "reload" => viewer.reload().map_err(|e| e.to_string())?,
        "close" => { viewer.close().map_err(|e| e.to_string())?; return Ok(String::new()); },
        "status" => {},
        _ => return Err("unknown viewer action".into()),
    }
    Ok(viewer.url().map_err(|e| e.to_string())?.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn restrict_external_navigation() {
        assert!(allow_app_protocol("main"));
        assert!(!allow_app_protocol("web-viewer"));
        assert!(!allow_app_protocol("popup"));
        for url in ["http://localhost", "http://wails.localhost/api/rpc", "wails://localhost", "https://127.0.0.1", "https://[::1]", "http://10.0.0.1", "https://printer.local", "file:///tmp/a", "javascript:alert(1)", "https://user:pass@example.com"] { assert!(public_url(url).is_err(), "{url}"); }
        assert!(public_url("https://example.com/path?q=1").is_ok());
    }
}
