//! User-selected export destinations, outside the WebView download manager.
use std::path::Path;
use tauri::ipc::{InvokeBody, Request};
use tauri::WebviewWindow;

fn suggested_name(encoded: &str) -> Result<String, String> {
    let query = format!("name={encoded}");
    let name = url::form_urlencoded::parse(query.as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default();
    if name.is_empty() || name.len() > 512 || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) || name == "." || name == ".." {
        return Err("invalid export filename".into());
    }
    Ok(name)
}

// A failed write must leave an existing destination intact. The native picker
// asks about overwriting; the renderer never supplies a filesystem path.
fn write_export(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_export_from(path, &mut std::io::Cursor::new(bytes))
}

fn write_export_from(path: &Path, input: &mut impl std::io::Read) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| std::io::Error::other("missing export folder"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    std::io::copy(input, &mut temp)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[tauri::command]
pub async fn save_export(window: WebviewWindow, request: Request<'_>) -> Result<bool, String> {
    if !crate::window_trust::trusted(&window) {
        return Err("untrusted export caller".into());
    }
    let name = suggested_name(request.headers().get("x-inkism-filename").and_then(|v| v.to_str().ok()).ok_or("missing export filename")?)?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("export requires binary data".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_parent(&window).set_title("다른 이름으로 저장").set_file_name(&name);
        if let Some(extension) = Path::new(&name).extension().and_then(std::ffi::OsStr::to_str) {
            dialog = dialog.add_filter(extension.to_uppercase(), &[extension]);
        }
        let Some(path) = dialog.save_file() else { return Ok(false); };
        // Opt-in diagnostics for native picker automation and support logs.
        if std::env::var_os("INKISM_EXPORT_TRACE").as_deref() == Some(std::ffi::OsStr::new("1")) {
            eprintln!("inkism-export: selected {}", path.display());
        }
        write_export(&path, &bytes).map_err(|e| format!("파일을 저장하지 못했습니다: {e}"))?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

/// A backup never crosses the JS bridge as bytes. The trusted handler applies
/// the same library/session gates, then the verified spool is atomically copied.
#[tauri::command]
pub async fn save_backup(
    window: WebviewWindow,
    handler: tauri::State<'_, std::sync::Arc<local_api::Handler>>,
    name: String,
) -> Result<bool, String> {
    if !crate::window_trust::trusted(&window) { return Err("untrusted export caller".into()); }
    let encoded: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
    let name = suggested_name(&encoded)?;
    let handler = handler.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new().set_parent(&window).set_title("다른 이름으로 저장").set_file_name(&name).add_filter("ZIP", &["zip"]).save_file() else { return Ok(false); };
        let request = local_api::Request {method:"GET".into(),path:"/api/backup".into(),query:None,headers:vec![],host:handler.host.clone(),body:vec![]};
        let response = handler.handle(&request);
        if response.status != 200 {
            let message=serde_json::from_slice::<serde_json::Value>(&response.body).ok().and_then(|v| v["error"].as_str().map(String::from));
            return Err(message.unwrap_or_else(|| String::from_utf8_lossy(&response.body).into_owned()));
        }
        let mut file = response.file.ok_or("Backup file was not produced")?;
        write_export_from(&path, file.as_file_mut()).map_err(|e| format!("파일을 저장하지 못했습니다: {e}"))?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filename_is_a_suggestion_not_a_path() {
        assert_eq!(suggested_name("%ED%95%9C%EA%B8%80%20%2B%20note.pdf").unwrap(), "한글 + note.pdf");
        for name in ["", "..", "..%2Fsecret", "C%3A%5Csecret", "%00note", "a%0Ab"] {
            assert!(suggested_name(name).is_err(), "{name}");
        }
    }
    #[test]
    fn interrupted_copy_preserves_destination_and_cleans_temporary_file() {
        struct Broken(bool);
        impl std::io::Read for Broken {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                if self.0 { return Err(std::io::Error::other("synthetic read failure")); }
                self.0=true;output[..4].copy_from_slice(b"part");Ok(4)
            }
        }
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("backup.zip");
        std::fs::write(&path,b"previous backup").unwrap();
        assert!(write_export_from(&path,&mut Broken(false)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(),b"previous backup");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(),1);
    }
    #[test]
    fn exact_binary_bytes_replace_only_the_selected_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("한글.pdf");
        let other = dir.path().join("other");
        std::fs::write(&path, b"old").unwrap();
        std::fs::write(&other, b"keep").unwrap();
        let bytes = b"%PDF-\0\xff\r\n";
        write_export(&path, bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(std::fs::read(&other).unwrap(), b"keep");
        assert!(write_export(&dir.path().join("missing/file"), b"fail").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
