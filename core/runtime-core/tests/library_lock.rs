use inkism_runtime::{library_lock::LibraryLease, AppCore};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn spawn(db: &str, args: &[&str]) -> Process {
    Process(
        Command::new(env!("CARGO_BIN_EXE_inkism-engine"))
            .args(["--db", db])
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    )
}

#[test]
fn maintenance_excludes_runtime_and_attachment_without_creating_databases() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    let db = path.to_str().unwrap();
    let maintenance = LibraryLease::exclusive(db).unwrap();
    assert!(LibraryLease::exclusive(db).is_err());
    assert!(AppCore::open(db).is_err());
    for args in [vec![], vec!["--attachment-list"]] {
        let result = Command::new(env!("CARGO_BIN_EXE_inkism-engine"))
            .args(["--db", db])
            .args(args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(!result.status.success());
        assert!(String::from_utf8_lossy(&result.stderr).contains("library is in use"));
    }
    assert!(!path.exists());
    assert!(!dir.path().join("notes.db.attachments").exists());
    drop(maintenance);
    let app = AppCore::open(db).unwrap();
    let transfer = LibraryLease::shared(db).unwrap();
    assert!(LibraryLease::exclusive(db).is_err());
    drop(app);
    assert!(LibraryLease::exclusive(db).is_err());
    drop(transfer);
    assert!(LibraryLease::exclusive(db).is_ok());
    assert!(dir.path().join("notes.db.runtime-lock").exists());
}

#[test]
fn separate_runtime_and_attachment_hold_gate_until_each_process_exits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    let db = path.to_str().unwrap();
    let mut runtime = spawn(db, &[]);
    runtime
        .0
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"{\"op\":\"health\"}\n")
        .unwrap();
    let mut line = String::new();
    BufReader::new(runtime.0.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&line).unwrap()["ok"],
        true
    );
    assert!(LibraryLease::exclusive(db).is_err());
    // Import keeps stdin open, so it holds its lease independently of the runtime.
    let mut attachment = spawn(
        db,
        &["--attachment-import", "--attachment-name", "pending.bin"],
    );
    let started = Instant::now();
    while !dir.path().join("notes.db.attachments").exists() {
        assert!(
            attachment.0.try_wait().unwrap().is_none(),
            "attachment exited early"
        );
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "attachment did not open storage"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    drop(runtime);
    assert!(LibraryLease::exclusive(db).is_err());
    drop(attachment);
    // Process death releases kernel locks even though the lock file persists.
    let exclusive = LibraryLease::exclusive(db).unwrap();
    assert!(LibraryLease::shared(db).is_err());
    drop(exclusive);
    assert!(AppCore::open(db).is_ok());
}

#[test]
fn incomplete_copy_blocks_both_process_adapters_after_maintenance_exits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    let db = path.to_str().unwrap();
    {
        let _maintenance = LibraryLease::exclusive(db).unwrap();
        std::fs::write(format!("{db}.migration-incomplete"), b"unfinished").unwrap();
    }
    for args in [vec![], vec!["--attachment-list"]] {
        let result = Command::new(env!("CARGO_BIN_EXE_inkism-engine"))
            .args(["--db", db])
            .args(args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(!result.status.success());
        assert!(String::from_utf8_lossy(&result.stderr).contains("copy is incomplete"));
    }
    assert!(!path.exists());
    assert!(!dir.path().join("notes.db.attachments").exists());
    assert_eq!(
        std::fs::read(format!("{db}.migration-incomplete")).unwrap(),
        b"unfinished"
    );
}

// CLOEXEC closes inherited leases at exec, not at fork.
#[cfg(unix)]
#[test]
fn lease_release_does_not_wait_for_unrelated_child_exec() {
    use std::io::Read;
    use std::os::fd::AsRawFd;
    use std::os::unix::{net::UnixStream, process::CommandExt};
    extern "C" {
        fn read(fd: i32, buf: *mut u8, count: usize) -> isize;
        fn write(fd: i32, buf: *const u8, count: usize) -> isize;
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    let db = path.to_str().unwrap();
    let lease = LibraryLease::shared(db).unwrap();
    let (mut parent, child) = UnixStream::pair().unwrap();
    parent
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let executable = std::env::current_exe().unwrap();
    let thread = std::thread::spawn(move || {
        let mut command = Command::new(executable);
        command.arg("--list").stdout(Stdio::null());
        // Only async-signal-safe syscalls run in the forked child.
        unsafe {
            command.pre_exec(move || {
                let mut byte = 1u8;
                if write(child.as_raw_fd(), &byte, 1) != 1
                    || read(child.as_raw_fd(), &mut byte, 1) != 1
                {
                    return Err(std::io::Error::from_raw_os_error(5));
                }
                Ok(())
            });
        }
        command.status().unwrap()
    });
    let mut byte = [0u8];
    parent.read_exact(&mut byte).unwrap();
    drop(lease);
    let result = LibraryLease::exclusive(db);
    // Release and join before asserting so a failing test leaves no child.
    parent.write_all(&[1]).unwrap();
    assert!(thread.join().unwrap().success());
    assert!(
        result.is_ok(),
        "owner released, unrelated child retained gate"
    );
}
