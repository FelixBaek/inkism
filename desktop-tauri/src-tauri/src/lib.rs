//! Mobile entry point. Desktop keeps its existing tested process-based host.
#[cfg(any(target_os = "android", target_os = "ios"))]
mod mobile;

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::mobile_entry_point]
pub fn run() {
    mobile::run();
}
