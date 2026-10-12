use std::ffi::{OsStr, OsString};
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::time::Duration;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, GetExitCodeProcess, ResumeThread, TerminateProcess, CREATE_NO_WINDOW,
    CREATE_SUSPENDED, PROCESS_INFORMATION, STARTF_USESHOWWINDOW, STARTUPINFOW,
};

use crate::escape::escape_arg;
use crate::{Error, Stop};

const SW_HIDE: u16 = 0;
const POLL: Duration = Duration::from_millis(50);

pub(crate) fn find_browser() -> Result<PathBuf, Error> {
    for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        let Some(root) = std::env::var_os(var).filter(|r| !r.is_empty()) else {
            continue;
        };
        let candidate = Path::new(&root).join(r"Microsoft\Edge\Application\msedge.exe");
        if std::fs::metadata(&candidate).is_ok_and(|info| !info.is_dir()) {
            return Ok(candidate);
        }
    }
    Err(Error::Failed(
        "Microsoft Edge가 없어 PDF를 만들 수 없습니다. Edge 설치 상태를 확인해 주세요",
    ))
}

/// Closes a Win32 handle on drop.
struct Owned(HANDLE);

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: the handle was returned open by Win32 and is closed exactly once.
        unsafe { CloseHandle(self.0) };
    }
}

fn check(ok: i32) -> io::Result<()> {
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().collect()
}

fn job_active(job: HANDLE) -> io::Result<u32> {
    let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
    // SAFETY: `info` is a correctly sized, writable accounting struct.
    check(unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation,
            (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
            size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            null_mut(),
        )
    })?;
    Ok(info.ActiveProcesses)
}

pub(crate) fn run_browser(binary: &Path, args: &[OsString], stop: &Stop) -> io::Result<()> {
    // SAFETY: plain Win32 calls; every pointer refers to a live local value and
    // every returned handle is owned by an `Owned` guard.
    unsafe {
        let job = CreateJobObjectW(null(), null());
        if job.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Owned(job);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        check(SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ))?;

        let mut executable = wide(binary.as_os_str());
        let mut command = escape_arg(&executable);
        for arg in args {
            command.push(u16::from(b' '));
            command.extend(escape_arg(&wide(arg)));
        }
        executable.push(0);
        command.push(0);

        let startup = STARTUPINFOW {
            cb: size_of::<STARTUPINFOW>() as u32,
            dwFlags: STARTF_USESHOWWINDOW,
            wShowWindow: SW_HIDE,
            ..Default::default()
        };
        let mut process = PROCESS_INFORMATION::default();
        // Assign the suspended process before it can spawn children. Every child
        // stays in this owned job; closing the job never targets another Edge.
        check(CreateProcessW(
            executable.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_SUSPENDED | CREATE_NO_WINDOW,
            null(),
            null(),
            &startup,
            &mut process,
        ))?;
        let (proc_handle, thread) = (Owned(process.hProcess), Owned(process.hThread));
        if let Err(e) = check(AssignProcessToJobObject(job.0, proc_handle.0)) {
            TerminateProcess(proc_handle.0, 1);
            return Err(e);
        }
        if ResumeThread(thread.0) == u32::MAX {
            return Err(io::Error::last_os_error());
        }
        wait_job(job.0, proc_handle.0, stop)
    }
}

/// Polls until every process in the job exits or `stop` fires.
fn wait_job(job: HANDLE, process: HANDLE, stop: &Stop) -> io::Result<()> {
    loop {
        if job_active(job)? == 0 {
            return exit_status(process);
        }
        if stop.reason().is_some() {
            // SAFETY: `job` is the open job handle owned by the caller.
            unsafe { TerminateJobObject(job, 1) };
            reap_job(job);
            return Err(io::Error::from(io::ErrorKind::TimedOut));
        }
        std::thread::sleep(POLL);
    }
}

fn exit_status(process: HANDLE) -> io::Result<()> {
    let mut code = 0u32;
    // SAFETY: `process` is open and `code` is writable.
    check(unsafe { GetExitCodeProcess(process, &mut code) })?;
    if code != 0 {
        return Err(io::Error::other("headless browser failed"));
    }
    Ok(())
}

/// Waits briefly for this job only before the caller removes its private files.
fn reap_job(job: HANDLE) {
    for _ in 0..40 {
        if job_active(job).map_or(true, |active| active == 0) {
            break;
        }
        std::thread::sleep(POLL);
    }
}
