//! Port of the former Go implementation's real-Edge test: drives the real
//! Edge. Runs only on Windows with INKISM_TEST_REAL_PDF=1.
#![cfg(windows)]

use std::io::Read;
use std::net::TcpListener;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use inkism_pdf_export::{Error, Renderer};

fn enabled() -> bool {
    std::env::var("INKISM_TEST_REAL_PDF").as_deref() == Ok("1")
}

#[test]
fn real_edge_headless_pdf() {
    if !enabled() {
        eprintln!("skipped: explicit noninteractive Windows PDF validation");
        return;
    }
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let requests = Arc::new(AtomicU32::new(0));
    let counter = Arc::clone(&requests);
    std::thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.read(&mut [0u8; 1024]);
                counter.fetch_add(1, Ordering::SeqCst);
            }
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    });
    let mut document = String::from(
        r#"<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'"><style>@page{size:A4;margin:18mm}body{font-family:'Malgun Gothic',sans-serif}table{border-collapse:collapse}td{border:1px solid;padding:8px}pre{white-space:pre-wrap}</style><h1>Inkism PDF 검증</h1><p>한글과 English, 수식 원문 x² + y² = z²</p><table><tr><td>항목</td><td>보존</td></tr></table>"#,
    );
    document += &format!(
        r#"<img style="display:none" src="{server}/image"><script>fetch('{server}/script')</script>"#
    );
    document += &"<p>페이지 분리 검증 - 원문과 읽기 순서를 확인합니다.</p>".repeat(80);
    let root = tempfile::tempdir().unwrap();
    let renderer = Renderer {
        temp_root: Some(root.path().to_path_buf()),
        ..Renderer::default()
    };
    let result = renderer.render(document.as_bytes()).unwrap();
    assert!(result.len() >= 1000, "empty PDF");
    assert_eq!(
        requests.load(Ordering::SeqCst),
        0,
        "blocked external request executed"
    );
    assert_eq!(
        std::fs::read_dir(root.path()).unwrap().count(),
        0,
        "profile leaked"
    );
    if let Some(output) = std::env::var_os("INKISM_PDF_TEST_OUTPUT") {
        let output = std::path::PathBuf::from(output);
        assert!(output.is_absolute(), "absolute output path required");
        std::fs::write(output, result).unwrap();
    }
}

#[test]
fn real_edge_cancellation_cleans_process_job() {
    if !enabled() {
        eprintln!("skipped: explicit noninteractive Windows PDF validation");
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let renderer = Renderer {
        temp_root: Some(root.path().to_path_buf()),
        timeout: Some(Duration::from_millis(50)),
        ..Renderer::default()
    };
    let err = renderer
        .render(b"<!doctype html><h1>cancel synthetic job</h1>")
        .unwrap_err();
    assert_eq!(err, Error::Timeout);
    assert_eq!(
        std::fs::read_dir(root.path()).unwrap().count(),
        0,
        "cancelled job leaked profile"
    );
}
