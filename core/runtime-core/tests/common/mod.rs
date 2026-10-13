//! Test helper: launches the *actual* Rust sync-relay binary
//! (`core/sync-relay`) once per test process, then a fresh relay instance per
//! test (isolated SQLite DB + port).
//!
//! Set `INKISM_RELAY_BIN` to reuse a prebuilt relay, otherwise the helper
//! builds `core/sync-relay` with cargo on first use. This is a real
//! end-to-end path (HTTP relay, real ciphertext), not an in-process test double.

#![allow(dead_code)]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub const TOKEN: &str = "inkism-runtime-test-token-0123456789";

fn relay_crate() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate lives in <repo>/core/<crate>")
        .join("sync-relay")
}

fn relay_binary() -> Option<PathBuf> {
    static BIN: OnceLock<Option<PathBuf>> = OnceLock::new();
    BIN.get_or_init(|| {
        if let Ok(path) = std::env::var("INKISM_RELAY_BIN") {
            let path = PathBuf::from(path);
            if path.exists() {
                return Some(path);
            }
        }
        let krate = relay_crate();
        // A fixed target dir keeps the binary path predictable regardless of
        // CARGO_TARGET_DIR and lets repeated test runs reuse the build.
        let target = krate.join("target");
        let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
        let status = Command::new(cargo)
            .arg("build")
            .arg("--locked")
            .arg("--quiet")
            .arg("--bin")
            .arg("inkism-sync-relay")
            .arg("--manifest-path")
            .arg(krate.join("Cargo.toml"))
            .arg("--target-dir")
            .arg(&target)
            .status()
            .ok()?;
        let out = target
            .join("debug")
            .join(format!("inkism-sync-relay{}", std::env::consts::EXE_SUFFIX));
        if status.success() && out.exists() {
            Some(out)
        } else {
            None
        }
    })
    .clone()
}

fn free_port() -> Option<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").ok()?;
    Some(listener.local_addr().ok()?.port())
}

/// A running relay process on a private loopback port.
pub struct Relay {
    child: Child,
    pub url: String,
    _dir: tempfile::TempDir,
}

impl Relay {
    pub fn start() -> Option<Relay> {
        let binary = relay_binary()?;
        let dir = tempfile::tempdir().ok()?;
        let db = dir.path().join("relay.db");
        let port = free_port()?;
        let addr = format!("127.0.0.1:{port}");
        let mut child = Command::new(&binary)
            .arg("--listen")
            .arg(&addr)
            .arg("--db")
            .arg(&db)
            .env("INKISM_RELAY_TOKEN", TOKEN)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if std::net::TcpStream::connect(&addr).is_ok() {
                break;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Some(Relay {
            child,
            url: format!("http://{addr}"),
            _dir: dir,
        })
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
