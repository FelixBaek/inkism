//! Only the main note window may use the app protocol and native commands.
use tauri::WebviewWindow;
pub fn allow_app_protocol(label: &str) -> bool { label == "main" }
pub(crate) fn trusted(window: &WebviewWindow) -> bool {
    allow_app_protocol(window.label()) && window.url().ok().is_some_and(|url| {
        if cfg!(windows) { url.scheme() == "http" && url.host_str() == Some("wails.localhost") && url.port().is_none() }
        else { url.scheme() == "wails" && url.host_str() == Some("localhost") && url.port().is_none() }
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn only_main_window_uses_app_protocol() {
        assert!(allow_app_protocol("main"));
        assert!(!allow_app_protocol("popup"));
    }
}
