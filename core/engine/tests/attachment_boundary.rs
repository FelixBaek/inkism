//! Opt-in real-size boundary acceptance with bounded synthetic I/O.
use inkism_engine::attachments::{AttachmentStore, CHUNK_SIZE, MAX_ATTACHMENT_BYTES};
use inkism_engine::storage::StorageKey;
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("inkism-boundary-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&p).unwrap();
        Self(p)
    }
    fn bytes(&self) -> u64 {
        std::fs::read_dir(&self.0)
            .unwrap()
            .map(|e| e.unwrap().metadata().unwrap().len())
            .sum()
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
struct Synthetic {
    length: u64,
    position: u64,
    pattern: Vec<u8>,
    fail_at: Option<u64>,
}
impl Synthetic {
    fn new(length: u64) -> Self {
        // Prime period crosses storage chunks at different offsets.
        let pattern = (0..65521)
            .map(|i| ((i * 73 + i / 251) % 256) as u8)
            .collect();
        Self {
            length,
            position: 0,
            pattern,
            fail_at: None,
        }
    }
}
impl Read for Synthetic {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.fail_at.is_some_and(|at| self.position >= at) {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "injected cancelled source",
            ));
        }
        let end = self.fail_at.unwrap_or(self.length).min(self.length);
        let amount = (end - self.position).min(output.len() as u64) as usize;
        let mut done = 0;
        while done < amount {
            let offset = (self.position as usize + done) % self.pattern.len();
            let n = (self.pattern.len() - offset).min(amount - done);
            output[done..done + n].copy_from_slice(&self.pattern[offset..offset + n]);
            done += n;
        }
        self.position += amount as u64;
        Ok(amount)
    }
}
#[derive(Default)]
struct HashSink {
    digest: Sha256,
    bytes: u64,
}
impl Write for HashSink {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.digest.update(data);
        self.bytes += data.len() as u64;
        Ok(data.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl HashSink {
    fn hex(self) -> String {
        format!("{:x}", self.digest.finalize())
    }
}
fn counts(path: &Path, key: Option<&StorageKey>) -> (i64, i64) {
    let db = inkism_storage::open(path, key).unwrap();
    (
        db.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0))
            .unwrap(),
        db.query_row("SELECT COUNT(*) FROM attachment_chunks", [], |r| r.get(0))
            .unwrap(),
    )
}
fn phase(start: Instant, scratch: &Scratch, label: &str) {
    eprintln!(
        "{label}: elapsed={:.3}s observed_files_bytes={}",
        start.elapsed().as_secs_f64(),
        scratch.bytes()
    );
}

#[test]
#[ignore = "real 1GiB acceptance: several GiB transient disk I/O; run explicitly"]
fn actual_one_gib_reopen_overflow_rollback_and_cancel_retry() {
    boundary(None);
}

#[cfg(feature = "encrypted-storage")]
#[test]
#[ignore = "real encrypted 1GiB acceptance: several GiB transient disk I/O"]
fn encrypted_one_gib_reopen_overflow_rollback_and_cancel_retry() {
    boundary(Some(&StorageKey::from_bytes([0x6a; 32])));
}

fn open_store(path: &Path, key: Option<&StorageKey>) -> AttachmentStore {
    #[cfg(feature = "encrypted-storage")]
    if let Some(key) = key {
        return AttachmentStore::open_encrypted(path, key).unwrap();
    }
    assert!(key.is_none());
    AttachmentStore::open(path).unwrap()
}

fn boundary(key: Option<&StorageKey>) {
    let start = Instant::now();
    let scratch = Scratch::new();
    let path = scratch.0.join("attachments.db");
    let mut expected = HashSink::default();
    io::copy(&mut Synthetic::new(MAX_ATTACHMENT_BYTES), &mut expected).unwrap();
    assert_eq!(expected.bytes, MAX_ATTACHMENT_BYTES);
    let expected_hash = expected.hex();
    let mut store = open_store(&path, key);
    let original = store
        .import_reader(
            "one-gib.bin",
            "application/octet-stream",
            Synthetic::new(MAX_ATTACHMENT_BYTES),
        )
        .unwrap();
    assert_eq!(original.size, MAX_ATTACHMENT_BYTES);
    assert_eq!(original.sha256, expected_hash);
    let baseline = (1, MAX_ATTACHMENT_BYTES.div_ceil(CHUNK_SIZE as u64) as i64);
    assert_eq!(counts(&path, key), baseline);
    phase(start, &scratch, "exact limit imported");
    drop(store);
    if key.is_some() {
        assert!(AttachmentStore::open(&path).is_err());
        #[cfg(feature = "encrypted-storage")]
        assert!(
            AttachmentStore::open_encrypted(&path, &StorageKey::from_bytes([0x6b; 32])).is_err()
        );
    }
    let mut store = open_store(&path, key);
    let mut exported = HashSink::default();
    store.copy_to(&original.id, &mut exported).unwrap();
    assert_eq!(exported.bytes, MAX_ATTACHMENT_BYTES);
    assert_eq!(exported.hex(), expected_hash);
    phase(start, &scratch, "reopened exact limit exported and hashed");
    let error = store
        .import_reader(
            "overflow.bin",
            "application/octet-stream",
            Synthetic::new(MAX_ATTACHMENT_BYTES + 1),
        )
        .unwrap_err();
    assert!(error.to_string().contains("limit"), "{error}");
    assert_eq!(counts(&path, key), baseline);
    phase(start, &scratch, "one byte over limit rolled back");
    let mut cancelled = Synthetic::new(MAX_ATTACHMENT_BYTES);
    cancelled.fail_at = Some(2 * CHUNK_SIZE as u64 + 17);
    let error = store
        .import_reader("cancelled.bin", "application/octet-stream", cancelled)
        .unwrap_err();
    assert!(
        error.to_string().contains("injected cancelled source"),
        "{error}"
    );
    assert_eq!(counts(&path, key), baseline);
    let retry_bytes = 2 * CHUNK_SIZE as u64 + 17;
    let retry = store
        .import_reader(
            "retry.bin",
            "application/octet-stream",
            Synthetic::new(retry_bytes),
        )
        .unwrap();
    assert_eq!(retry.size, retry_bytes);
    assert_eq!(counts(&path, key), (2, baseline.1 + 3));
    drop(store);
    let store = open_store(&path, key);
    let mut preserved = HashSink::default();
    store.copy_to(&original.id, &mut preserved).unwrap();
    assert_eq!(preserved.bytes, MAX_ATTACHMENT_BYTES);
    assert_eq!(preserved.hex(), expected_hash);
    let mut retried = HashSink::default();
    store.copy_to(&retry.id, &mut retried).unwrap();
    let mut retry_expected = HashSink::default();
    io::copy(&mut Synthetic::new(retry_bytes), &mut retry_expected).unwrap();
    assert_eq!(retried.bytes, retry_bytes);
    assert_eq!(retried.hex(), retry_expected.hex());
    phase(
        start,
        &scratch,
        "cancel rollback retry and final reopen verified",
    );
}
