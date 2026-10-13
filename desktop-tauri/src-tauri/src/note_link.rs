//! Transient, database-specific Windows note-link forwarding. The recipient
//! only raises the existing renderer's note-link event; it never opens storage.
use std::path::Path;

const MAX_LINK_BYTES: usize = 4096;

pub fn valid_link(link: &str) -> bool {
    if link.len() > MAX_LINK_BYTES
        || !link.starts_with("note://")
        || link.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return false;
    }
    let Ok(url) = url::Url::parse(link) else {
        return false;
    };
    url.scheme() == "note"
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.path().is_empty()
        && url.query().is_none()
}

fn endpoint_name(database: &Path) -> String {
    let path = database
        .canonicalize()
        .unwrap_or_else(|_| database.to_path_buf());
    let name = path.to_string_lossy();
    #[cfg(windows)]
    let name = name.to_lowercase();
    format!("Inkism note links: {name}")
}

#[cfg(windows)]
pub use windows::{forward, Server};

#[cfg(windows)]
mod windows {
    use super::{endpoint_name, valid_link, MAX_LINK_BYTES};
    use std::{io, path::Path, ptr, sync::mpsc, thread};
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_CLASS_ALREADY_EXISTS, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            DataExchange::COPYDATASTRUCT, LibraryLoader::GetModuleHandleW,
            Threading::GetCurrentThreadId,
        },
        UI::WindowsAndMessaging::{
            AllowSetForegroundWindow, CreateWindowExW, DefWindowProcW, DestroyWindow,
            DispatchMessageW, FindWindowExW, GetMessageW, GetWindowLongPtrW,
            GetWindowThreadProcessId, PostQuitMessage, PostThreadMessageW, RegisterClassW,
            SendMessageTimeoutW, SetWindowLongPtrW, TranslateMessage, UnregisterClassW,
            CREATESTRUCTW, GWLP_USERDATA, HWND_MESSAGE, MSG, SMTO_ABORTIFHUNG, SMTO_BLOCK,
            WM_CLOSE, WM_COPYDATA, WM_DESTROY, WM_NCCREATE, WM_NCDESTROY, WM_QUIT, WNDCLASSW,
        },
    };

    const CLASS: &str = "InkismNoteLinkEndpointV1";
    const MESSAGE_ID: usize = 0x494e4b31;
    struct Handler(Box<dyn Fn(&str) -> bool + Send + Sync>);
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    unsafe extern "system" fn receive(hwnd: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        match message {
            WM_NCCREATE => {
                let create = &*(l as *const CREATESTRUCTW);
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
            }
            WM_COPYDATA => {
                if l == 0 {
                    return 0;
                }
                let request = &*(l as *const COPYDATASTRUCT);
                if request.dwData != MESSAGE_ID
                    || request.cbData == 0
                    || request.cbData as usize > MAX_LINK_BYTES
                    || request.lpData.is_null()
                {
                    return 0;
                }
                let bytes = std::slice::from_raw_parts(
                    request.lpData as *const u8,
                    request.cbData as usize,
                );
                let Ok(link) = std::str::from_utf8(bytes) else {
                    return 0;
                };
                if !valid_link(link) {
                    return 0;
                }
                let handler = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const Handler;
                if handler.is_null() {
                    return 0;
                }
                return isize::from(((*handler).0)(link));
            }
            WM_CLOSE => {
                DestroyWindow(hwnd);
                return 0;
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                return 0;
            }
            WM_NCDESTROY => {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            }
            _ => {}
        }
        DefWindowProcW(hwnd, message, w, l)
    }

    /// False means no matching live window; a stale or unresponsive recipient
    /// never permits bypassing the normal library lock.
    pub fn forward(database: &Path, link: &str) -> io::Result<bool> {
        if !valid_link(link) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "올바르지 않은 노트 연결 주소입니다",
            ));
        }
        let class = wide(CLASS);
        let name = wide(&endpoint_name(database));
        unsafe {
            let hwnd = FindWindowExW(HWND_MESSAGE, ptr::null_mut(), class.as_ptr(), name.as_ptr());
            if hwnd.is_null() {
                return Ok(false);
            }
            let mut recipient = 0;
            GetWindowThreadProcessId(hwnd, &mut recipient);
            // An OS protocol launch may grant foreground activation to this new
            // process; transfer that permission to the existing window's process.
            AllowSetForegroundWindow(recipient);
            let request = COPYDATASTRUCT {
                dwData: MESSAGE_ID,
                cbData: link.len() as u32,
                lpData: link.as_ptr() as *mut _,
            };
            let mut accepted = 0;
            let sent = SendMessageTimeoutW(
                hwnd,
                WM_COPYDATA,
                0,
                &request as *const _ as isize,
                SMTO_BLOCK | SMTO_ABORTIFHUNG,
                500,
                &mut accepted,
            );
            Ok(sent != 0 && accepted == 1)
        }
    }

    pub struct Server {
        thread_id: u32,
        thread: Option<thread::JoinHandle<()>>,
    }
    impl Server {
        pub fn start(
            database: &Path,
            open: impl Fn(&str) -> bool + Send + Sync + 'static,
        ) -> io::Result<Self> {
            let name = wide(&endpoint_name(database));
            let (ready, receiver) = mpsc::sync_channel(1);
            let worker = thread::spawn(move || unsafe {
                let class = wide(CLASS);
                let instance = GetModuleHandleW(ptr::null());
                let definition = WNDCLASSW {
                    lpfnWndProc: Some(receive),
                    hInstance: instance,
                    lpszClassName: class.as_ptr(),
                    ..Default::default()
                };
                if RegisterClassW(&definition) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS
                {
                    let _ = ready.send(Err(io::Error::last_os_error()));
                    return;
                }
                // The thread owns the handler until the window and its loop stop.
                let mut handler = Box::new(Handler(Box::new(open)));
                let hwnd = CreateWindowExW(
                    0,
                    class.as_ptr(),
                    name.as_ptr(),
                    0,
                    0,
                    0,
                    0,
                    0,
                    HWND_MESSAGE,
                    ptr::null_mut(),
                    instance,
                    (&mut *handler as *mut Handler).cast(),
                );
                if hwnd.is_null() {
                    let _ = ready.send(Err(io::Error::last_os_error()));
                    UnregisterClassW(class.as_ptr(), instance);
                    return;
                }
                if ready.send(Ok(GetCurrentThreadId())).is_ok() {
                    let mut message = MSG::default();
                    while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
                        TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
                DestroyWindow(hwnd);
                UnregisterClassW(class.as_ptr(), instance);
            });
            match receiver.recv() {
                Ok(Ok(thread_id)) => Ok(Self {
                    thread_id,
                    thread: Some(worker),
                }),
                Ok(Err(error)) => {
                    let _ = worker.join();
                    Err(error)
                }
                Err(_) => {
                    let _ = worker.join();
                    Err(io::Error::other("노트 연결 창을 준비하지 못했습니다"))
                }
            }
        }
    }
    impl Drop for Server {
        fn drop(&mut self) {
            if let Some(worker) = self.thread.take() {
                if !worker.is_finished() {
                    // Stop the owning thread, so a recycled HWND is never closed.
                    unsafe {
                        PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
                    }
                }
                let _ = worker.join();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_bounded_note_routes() {
        for good in [
            "note://a21e9bde-483c-4ba5-8a0e-ea2b5521bf69",
            "note://a21e9bde-483c-4ba5-8a0e-ea2b5521bf69#%5Epart",
        ] {
            assert!(valid_link(good), "{good}");
        }
        for bad in [
            "https://example.com",
            "note://",
            "note://user@note",
            "note://id:123",
            "note://id/path",
            "note://id?command=delete",
            "note://id\n",
            "note://id a",
            "javascript:alert(1)",
        ] {
            assert!(!valid_link(bad), "{bad}");
        }
        assert!(!valid_link(&format!(
            "note://id#{}",
            "x".repeat(MAX_LINK_BYTES)
        )));
    }
    #[test]
    fn database_endpoint_normalizes_the_same_file() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("노트.db");
        std::fs::write(&db, b"fixture").unwrap();
        assert_eq!(
            endpoint_name(&db),
            endpoint_name(&dir.path().join(".").join("노트.db"))
        );
        assert_ne!(
            endpoint_name(&db),
            endpoint_name(&dir.path().join("other.db"))
        );
    }
    #[cfg(windows)]
    #[test]
    fn forwards_to_only_the_live_database_endpoint_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        std::fs::write(&db, b"fixture").unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let server = Server::start(&db, move |link| sender.send(link.to_owned()).is_ok()).unwrap();
        let link = "note://a21e9bde-483c-4ba5-8a0e-ea2b5521bf69#%5Epart";
        assert!(!forward(&dir.path().join("other.db"), link).unwrap());
        assert!(forward(&db, link).unwrap());
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            link
        );
        assert!(forward(&db, "note://id/path").is_err());
        assert!(receiver.try_recv().is_err());
        drop(server);
        assert!(!forward(&db, link).unwrap());
    }
}
