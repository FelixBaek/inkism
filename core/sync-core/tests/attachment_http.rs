// Untrusted relay responses must stay bounded before authentication.
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use sync_core::attachment::{AttachmentTransport, MAX_SEALED_CHUNK_BYTES};

fn reply(
    status: &str,
    declared_length: Option<usize>,
    body: Vec<u8>,
) -> Result<Option<sync_core::attachment::SealedChunk>, sync_core::SyncError> {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.local_addr().unwrap());
    let status = status.to_owned();
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        stream
            .set_write_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        let mut headers = format!("HTTP/1.1 {status}\r\nConnection: close\r\n");
        if let Some(len) = declared_length {
            headers.push_str(&format!("Content-Length: {len}\r\n"));
        }
        headers.push_str("\r\n");
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(&body);
    });
    let out = AttachmentTransport::new(&url, "test-token")
        .unwrap()
        .download("12345678-1234-4234-8234-123456789abc");
    worker.join().unwrap();
    out
}

#[test]
fn download_caps_declared_and_streamed_bytes() {
    assert!(reply("200 OK", Some(MAX_SEALED_CHUNK_BYTES + 1), vec![]).is_err());
    assert!(reply("200 OK", None, vec![1; MAX_SEALED_CHUNK_BYTES + 1]).is_err());
    assert!(reply("200 OK", Some(39), vec![1; 39]).is_err());
    assert!(reply("200 OK", Some(50), vec![1; 40]).is_err());
    assert_eq!(
        reply("200 OK", None, vec![1; MAX_SEALED_CHUNK_BYTES])
            .unwrap()
            .unwrap()
            .ciphertext
            .len(),
        MAX_SEALED_CHUNK_BYTES
    );
}

#[test]
fn only_not_found_means_missing_and_redirects_are_not_followed() {
    assert!(reply("404 Not Found", Some(0), vec![]).unwrap().is_none());
    for status in [
        "401 Unauthorized",
        "403 Forbidden",
        "500 Internal Server Error",
        "302 Found",
        "204 No Content",
    ] {
        assert!(reply(status, Some(0), vec![]).is_err());
    }
}
