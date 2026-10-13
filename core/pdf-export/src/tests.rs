//! Port of the former Go implementation's PDF export tests.

use super::*;

fn fake_edge(root: &Path) -> PathBuf {
    let binary = root.join("fake-edge");
    std::fs::write(&binary, "fake").unwrap();
    binary
}

fn entries(root: &Path) -> Vec<OsString> {
    std::fs::read_dir(root)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect()
}

fn arg<'a>(args: &'a [OsString], prefix: &str) -> &'a str {
    args.iter()
        .filter_map(|a| a.to_str())
        .find_map(|a| a.strip_prefix(prefix))
        .unwrap_or_default()
}

#[test]
fn isolated_job_cleanup_and_arguments() {
    let root = tempfile::tempdir().unwrap();
    let renderer = Renderer {
        binary: Some(fake_edge(root.path())),
        temp_root: Some(root.path().to_path_buf()),
        timeout: None,
    };
    let data = renderer
        .render_with(
            "<p>한글 문서</p>".as_bytes(),
            &AtomicBool::new(false),
            &|_, args, _| {
                let output = Path::new(arg(args, "--print-to-pdf="));
                let profile = Path::new(arg(args, "--user-data-dir="));
                assert_eq!(output.parent(), profile.parent(), "{args:?}");
                assert!(
                    profile.to_str().unwrap().contains("inkism-pdf-"),
                    "{args:?}"
                );
                assert!(
                    args.last()
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .starts_with("file:///"),
                    "invalid file URI"
                );
                std::fs::write(output, "%PDF-1.7\nsynthetic")
            },
        )
        .unwrap();
    assert!(data.starts_with(b"%PDF-"));
    assert_eq!(
        entries(root.path()),
        vec![OsString::from("fake-edge")],
        "job files leaked"
    );
}

#[test]
fn cancelled_and_failed_job_clean_up() {
    let root = tempfile::tempdir().unwrap();
    let r = Renderer {
        binary: Some(fake_edge(root.path())),
        temp_root: Some(root.path().to_path_buf()),
        timeout: Some(Duration::from_millis(1)),
    };
    let never = AtomicBool::new(false);
    let err = r
        .render_with(b"note", &never, &|_, _, stop| {
            while stop.reason().is_none() {
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(io::ErrorKind::TimedOut.into())
        })
        .unwrap_err();
    assert_eq!(err, Error::Timeout);
    assert_eq!(entries(root.path()).len(), 1, "cancel left files");

    let r = Renderer { timeout: None, ..r };
    let err = r
        .render_with(b"note", &never, &|_, _, _| {
            Err(io::Error::other("SECRET NOTE"))
        })
        .unwrap_err();
    assert!(
        !err.to_string().contains("SECRET NOTE"),
        "sensitive child output leaked"
    );
    assert_eq!(entries(root.path()).len(), 1);

    let cancel = AtomicBool::new(false);
    let err = r
        .render_with(b"note", &cancel, &|_, _, stop| {
            cancel.store(true, Ordering::SeqCst);
            assert_eq!(stop.reason(), Some(Error::Cancelled));
            Err(io::ErrorKind::Interrupted.into())
        })
        .unwrap_err();
    assert_eq!(err, Error::Cancelled);
    assert_eq!(entries(root.path()).len(), 1);
}

#[test]
fn missing_browser_and_output_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let r = Renderer {
        binary: Some(dir.path().join("missing")),
        ..Renderer::default()
    };
    assert!(r.render(b"note").is_err(), "missing browser");
    assert!(remove_job(dir.path()).is_err(), "unsafe cleanup accepted");
}

#[test]
fn invalid_output_and_size_rejected() {
    let root = tempfile::tempdir().unwrap();
    let r = Renderer {
        binary: Some(fake_edge(root.path())),
        temp_root: Some(root.path().to_path_buf()),
        timeout: None,
    };
    let never = AtomicBool::new(false);
    assert!(r.render_with(b"", &never, &|_, _, _| Ok(())).is_err());
    let err = r
        .render_with(b"note", &never, &|_, _, _| Ok(()))
        .unwrap_err();
    assert_eq!(err, Error::Failed("PDF 결과 파일이 생성되지 않았습니다"));
    let err = r
        .render_with(b"note", &never, &|_, args, _| {
            std::fs::write(arg(args, "--print-to-pdf="), "<html>")
        })
        .unwrap_err();
    assert_eq!(err, Error::Failed("PDF 결과가 올바르지 않습니다"));
    let relative = Renderer {
        binary: Some("msedge.exe".into()),
        ..r
    };
    assert_eq!(
        relative.render(b"note").unwrap_err(),
        Error::Failed("PDF 브라우저 경로가 올바르지 않습니다")
    );
    assert_eq!(entries(root.path()).len(), 1);
}

#[cfg(unix)]
#[test]
fn real_child_process_is_killed_on_timeout() {
    let root = tempfile::tempdir().unwrap();
    let r = Renderer {
        binary: Some("/bin/sleep".into()),
        temp_root: Some(root.path().to_path_buf()),
        timeout: Some(Duration::from_millis(100)),
    };
    // `sleep` rejects Edge flags and exits non-zero: a generic failure.
    assert_eq!(
        r.render(b"note").unwrap_err(),
        Error::Failed("Microsoft Edge에서 PDF를 만들지 못했습니다")
    );
    let started = Instant::now();
    let never = AtomicBool::new(false);
    let err = r
        .render_with(b"note", &never, &|_, _, stop| {
            platform::run_browser(Path::new("/bin/sleep"), &["5".into()], stop)
        })
        .unwrap_err();
    assert_eq!(err, Error::Timeout);
    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(entries(root.path()).is_empty());
}
