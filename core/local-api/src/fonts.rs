//! Names only; fonts are never copied, installed or licensed by this endpoint.
use crate::{Request, Response};

pub(crate) fn installed(r: &Request) -> Response {
    if r.method != "GET" {
        return Response::fail(405, "GET required");
    }
    match names() {
        Ok(names) => Response::json(200, &serde_json::json!({"ok":true,"data":names})),
        Err(error) => Response::fail(501, error),
    }
}

#[cfg(not(windows))]
fn names() -> crate::Result<Vec<String>> {
    Err("이 환경에서는 설치된 폰트를 불러올 수 없습니다. 폰트명을 직접 등록해 주세요".into())
}

#[cfg(windows)]
fn names() -> crate::Result<Vec<String>> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let system = std::env::var_os("SystemRoot").ok_or("Windows 경로를 확인할 수 없습니다")?;
    let binary =
        std::path::PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    // Static script: no renderer string ever reaches a command or a path.
    let script="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Drawing; $fonts=[System.Drawing.Text.InstalledFontCollection]::new(); try { ConvertTo-Json -InputObject @($fonts.Families.Name | Sort-Object -Unique) -Compress } finally { $fonts.Dispose() }";
    let mut child = Command::new(binary)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child.stdout.take().ok_or("폰트 목록을 읽을 수 없습니다")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take((256 << 10) + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let end = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= end {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("폰트 목록을 불러오는 시간이 초과되었습니다".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let bytes = reader.join().map_err(|_| "폰트 목록을 읽지 못했습니다")??;
    if !status.success() || bytes.len() > 256 << 10 {
        return Err("폰트 목록을 불러오지 못했습니다".into());
    }
    let names: Vec<String> = serde_json::from_slice(&bytes)?;
    if names.len() > 5000 {
        return Err("폰트 목록이 너무 큽니다".into());
    }
    Ok(names)
}

