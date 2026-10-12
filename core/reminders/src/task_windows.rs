//! Windows Task Scheduler store (COM) and the current user's SID.

use crate::task::TaskStore;
use crate::{Ctx, Error, Result};
use windows::core::{BSTR, HRESULT, PWSTR};
use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL, RPC_E_CHANGED_MODE};
use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::TaskScheduler::{
    ITaskFolder, ITaskService, TaskScheduler, TASK_CREATE, TASK_LOGON_INTERACTIVE_TOKEN,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::Win32::System::Variant::VARIANT;

/// HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND).
const MISSING_TASK: HRESULT = HRESULT(0x8007_0002_u32 as i32);

fn win(e: windows::core::Error) -> Error {
    Error::msg(e.to_string())
}

pub(crate) struct NativeTaskStore;

/// Runs `f` with the root task folder on a COM-initialized thread.
fn with_task_folder<T>(
    ctx: &Ctx,
    f: impl FnOnce(&ITaskFolder) -> windows::core::Result<T>,
) -> Result<T> {
    ctx.err()?;
    // SAFETY: CoUninitialize only balances our own successful CoInitializeEx;
    // COM objects are dropped before it.
    unsafe {
        let init = CoInitializeEx(None, COINIT_MULTITHREADED);
        // An STA thread (e.g. a UI thread) already has COM; use it as is.
        let owned = init.is_ok();
        if !owned && init != RPC_E_CHANGED_MODE {
            return Err(win(init.into()));
        }
        let result = (|| {
            let service: ITaskService =
                CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER)?;
            let none = VARIANT::default();
            service.Connect(&none, &none, &none, &none)?;
            let folder = service.GetFolder(&BSTR::from("\\"))?;
            f(&folder)
        })();
        if owned {
            CoUninitialize();
        }
        result
    }
    .map_err(|e| {
        if e.code() == MISSING_TASK {
            Error::TaskNotFound
        } else {
            win(e)
        }
    })
}

impl TaskStore for NativeTaskStore {
    fn get(&self, ctx: &Ctx, name: &str) -> Result<String> {
        // SAFETY: COM calls on a live folder interface.
        with_task_folder(ctx, |folder| unsafe {
            Ok(folder.GetTask(&BSTR::from(name))?.Xml()?.to_string())
        })
    }

    fn create(&self, ctx: &Ctx, name: &str, raw: &str) -> Result<()> {
        // TASK_CREATE (never overwrite), TASK_LOGON_INTERACTIVE_TOKEN, no password.
        let none = VARIANT::default();
        // SAFETY: COM calls on a live folder interface.
        with_task_folder(ctx, |folder| unsafe {
            folder
                .RegisterTask(
                    &BSTR::from(name),
                    &BSTR::from(raw),
                    TASK_CREATE.0,
                    &none,
                    &none,
                    TASK_LOGON_INTERACTIVE_TOKEN,
                    &none,
                )
                .map(drop)
        })
    }

    fn delete(&self, ctx: &Ctx, name: &str) -> Result<()> {
        // SAFETY: COM call on a live folder interface.
        with_task_folder(ctx, |folder| unsafe {
            folder.DeleteTask(&BSTR::from(name), 0)
        })
    }
}

/// String SID (`S-1-5-21-...`) of the user running this process.
pub(crate) fn current_user_sid() -> Result<String> {
    // SAFETY: token handle is closed below; buffer sized by the first call.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(win)?;
        let mut size = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut size);
        let mut buf = vec![0u64; (size as usize).div_ceil(8)];
        let info = GetTokenInformation(
            token,
            TokenUser,
            Some(buf.as_mut_ptr().cast()),
            size,
            &mut size,
        );
        let _ = CloseHandle(token);
        info.map_err(win)?;
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut sid = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid).map_err(win)?;
        let text = sid.to_string().map_err(|e| Error::msg(e.to_string()));
        let _ = LocalFree(Some(HLOCAL(sid.0.cast())));
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::MAX_TIMESTAMP;
    use crate::{
        cache_root, native_scheduler, new_cache_id, Background, Schedule, TaskScheduler,
        TASK_PREFIX,
    };
    use std::os::windows::process::CommandExt;
    use std::sync::Arc;

    /// Read-only native COM probe. Never creates/deletes or pushes a toast.
    #[test]
    fn native_task_missing_read_only() {
        if std::env::var("INKISM_TEST_TASK_READ").as_deref() != Ok("1") {
            eprintln!("skip: explicit read-only Task Scheduler COM check");
            return;
        }
        let id = new_cache_id().unwrap();
        let err = NativeTaskStore
            .get(&Ctx::new(), &format!("{TASK_PREFIX}{id}"))
            .unwrap_err();
        assert!(
            matches!(err, Error::TaskNotFound),
            "missing task lookup: {err}"
        );
    }

    /// MUTATES Task Scheduler only after an explicit approval guard. Never
    /// displays a toast and does not validate timed delivery.
    #[test]
    fn approved_native_task_lifecycle() {
        if std::env::var("INKISM_TEST_REAL_TASK_LIFECYCLE").as_deref()
            != Ok("I_APPROVE_ISOLATED_TASK_CHANGES")
        {
            eprintln!(
                "skip: requires explicit approval for isolated real task registration/deletion"
            );
            return;
        }
        let source = std::env::var("INKISM_TEST_HELPER_EXE")
            .expect("INKISM_TEST_HELPER_EXE must name the built Inkism application");
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let executable = root.join("Inkism.exe");
        std::fs::copy(source, &executable).unwrap();
        // The helper inherits these; this test runs alone behind its guard.
        std::env::set_var("APPDATA", root.join("roaming"));
        std::env::set_var("LOCALAPPDATA", root.join("local"));
        let cache = cache_root().unwrap();
        let scheduler = native_scheduler(&executable).unwrap();
        let id = new_cache_id().unwrap();
        let bg = Background {
            root: cache,
            id: id.clone(),
            scheduler: Some(scheduler),
        };
        let ctx = Ctx::new();
        struct Cleanup<'a>(&'a Background, String);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                if let (_, Err(e)) = self.0.disable(&Ctx::new()) {
                    eprintln!("CLEANUP REQUIRED: exact task {TASK_PREFIX}{}: {e}", self.1);
                }
            }
        }
        let _cleanup = Cleanup(&bg, id.clone());
        bg.enable(&ctx).unwrap();
        bg.enable(&ctx).expect("repeated enable");
        let task = NativeTaskStore
            .get(&ctx, &format!("{TASK_PREFIX}{id}"))
            .unwrap();
        let verifier = TaskScheduler {
            executable: executable.clone(),
            sid: current_user_sid().unwrap(),
            store: Arc::new(NativeTaskStore),
        };
        verifier.verify(&id, &task).unwrap();
        // Future-only cache keeps the helper and any incidental OS trigger silent.
        let generation = bg.generation(&ctx).unwrap();
        bg.refresh(
            &ctx,
            &[Schedule {
                id: "a".repeat(64),
                at: MAX_TIMESTAMP,
                hours: 24,
            }],
            None,
            generation,
        )
        .unwrap();
        let run = |args: &[&str]| {
            let status = std::process::Command::new(&executable)
                .args(args)
                .creation_flags(0x0800_0000)
                .status()
                .unwrap();
            assert!(status.success(), "hidden cache-only helper {args:?}");
        };
        run(&["--reminder-cache", &id]);
        for name in ["notes.db", "library.json", "keys.json"] {
            assert!(
                !root.join("roaming").join("Inkism").join(name).exists(),
                "unexpected library initialization {name}"
            );
        }
        let delivered = std::sync::atomic::AtomicUsize::new(0);
        let send = || {
            delivered.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        };
        bg.fire(&ctx, MAX_TIMESTAMP, &send).unwrap();
        bg.fire(&ctx, MAX_TIMESTAMP, &send).unwrap();
        assert_eq!(
            delivered.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "repeat receipt"
        );
        bg.disable(&ctx).1.unwrap();
        assert!(
            matches!(
                NativeTaskStore.get(&ctx, &format!("{TASK_PREFIX}{id}")),
                Err(Error::TaskNotFound)
            ),
            "task remains after off"
        );
        bg.enable(&ctx).unwrap();
        run(&["--remove-reminder-tasks"]);
        assert!(
            matches!(
                NativeTaskStore.get(&ctx, &format!("{TASK_PREFIX}{id}")),
                Err(Error::TaskNotFound)
            ),
            "task remains after uninstall cleanup"
        );
    }
}
