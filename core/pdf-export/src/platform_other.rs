use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::{Error, Stop};

pub(crate) fn find_browser() -> Result<PathBuf, Error> {
    Err(Error::Failed(
        "PDF 내보내기는 Windows 앱에서 사용할 수 있습니다",
    ))
}

/// Runs the browser with discarded output; kills it when `stop` fires.
pub(crate) fn run_browser(binary: &Path, args: &[OsString], stop: &Stop) -> io::Result<()> {
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    loop {
        if let Some(status) = child.try_wait()? {
            return if status.success() {
                Ok(())
            } else {
                Err(io::Error::other("headless browser failed"))
            };
        }
        if stop.reason().is_some() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::from(io::ErrorKind::TimedOut));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
