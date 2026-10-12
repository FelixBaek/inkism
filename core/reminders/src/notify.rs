//! System notification delivery. The toast carries a fixed, generic text and
//! never any note title or body.

use crate::Result;

pub trait Notifier {
    fn notify(&self) -> Result<()>;
}

impl<F: Fn() -> Result<()>> Notifier for F {
    fn notify(&self) -> Result<()> {
        self()
    }
}

/// Does nothing and reports success (non-Windows builds).
#[derive(Clone, Copy, Debug, Default)]
pub struct NoopNotifier;

impl Notifier for NoopNotifier {
    fn notify(&self) -> Result<()> {
        Ok(())
    }
}

/// The platform notifier: Windows toast on Windows, no-op elsewhere.
pub fn system_notifier() -> Box<dyn Notifier + Send + Sync> {
    #[cfg(windows)]
    return Box::new(WindowsToast);
    #[cfg(not(windows))]
    Box::new(NoopNotifier)
}

#[cfg(windows)]
pub use windows_toast::WindowsToast;

#[cfg(windows)]
mod windows_toast {
    use super::Notifier;
    use crate::{Error, Result};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    const APP_ID: &str = "Inkism.Reminders";
    const ACTIVATOR_GUID: &str = "{5E2C64C8-CA3F-456E-884C-6CECC3F377AA}";
    const TOAST: &str = r#"<toast><visual><binding template="ToastGeneric"><text>Inkism</text><text>예약한 노트 알림이 있습니다. Inkism에서 확인해 주세요.</text></binding></visual></toast>"#;

    /// Native toast. Registration and delivery happen only after explicit
    /// user opt-in. No PowerShell fallback or execution-policy change.
    #[derive(Clone, Copy, Debug, Default)]
    pub struct WindowsToast;

    impl Notifier for WindowsToast {
        fn notify(&self) -> Result<()> {
            register_app()?;
            let win = |e: windows::core::Error| Error::msg(e.to_string());
            let doc = XmlDocument::new().map_err(win)?;
            doc.LoadXml(&HSTRING::from(TOAST)).map_err(win)?;
            let toast = ToastNotification::CreateToastNotification(&doc).map_err(win)?;
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))
                .map_err(win)?
                .Show(&toast)
                .map_err(win)
        }
    }

    /// HKCU\SOFTWARE\Classes\AppUserModelId\<AppID>: DisplayName and
    /// CustomActivator, each written only when missing.
    fn register_app() -> Result<()> {
        let key_path = HSTRING::from(format!(r"SOFTWARE\Classes\AppUserModelId\{APP_ID}"));
        let mut key = HKEY::default();
        // SAFETY: valid NUL-terminated strings and an out pointer we own.
        unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(key_path.as_ptr()),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE | KEY_QUERY_VALUE,
                None,
                &mut key,
                None,
            )
            .ok()
            .map_err(|e| Error::msg(format!("opening registry key: {e}")))?;
        }
        let result = set_if_missing(key, "DisplayName", APP_ID)
            .and_then(|_| set_if_missing(key, "CustomActivator", ACTIVATOR_GUID));
        // SAFETY: key was opened above.
        let _ = unsafe { RegCloseKey(key) };
        result
    }

    fn set_if_missing(key: HKEY, name: &str, value: &str) -> Result<()> {
        let name_w = HSTRING::from(name);
        let mut size = 0u32;
        // SAFETY: size query only.
        let exists = unsafe {
            RegQueryValueExW(
                key,
                PCWSTR(name_w.as_ptr()),
                None,
                None,
                None,
                Some(&mut size),
            )
        }
        .is_ok()
            && size > 2;
        if exists {
            return Ok(());
        }
        let data: Vec<u8> = value
            .encode_utf16()
            .chain(Some(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        // SAFETY: data is a NUL-terminated UTF-16 buffer.
        unsafe { RegSetValueExW(key, PCWSTR(name_w.as_ptr()), None, REG_SZ, Some(&data)) }
            .ok()
            .map_err(|e| Error::msg(format!("setting string value: {name}: {e}")))
    }
}
