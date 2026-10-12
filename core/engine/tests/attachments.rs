//! Integration tests for `inkism_engine::attachments`. The attachment store
//! is a dedicated SQLite file, independent of the notes library: these tests
//! cover the chunked round-trip, durability across reopen, transactional
//! rollback on mid-read failure, input validation, corruption detection and
//! — crucially — that the notes DB and the attachment DB NEVER block each
//! other's SQLite write locks (separate files, separate connections).
//!
//! Temp directories use std + uuid with RAII cleanup; no tempfile dependency.

use inkism_engine::attachments::{
    AttachmentMetadata, AttachmentStore, CHUNK_SIZE, MAX_ATTACHMENT_BYTES,
};
use inkism_engine::Engine;
use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

// ---- test scaffolding -------------------------------------------------------

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(tag: &str) -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "inkism-attach-{}-{}",
            tag,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir { path: dir }
    }
    fn db_path(&self) -> PathBuf {
        self.path.join("attachments.db")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Deterministic pseudo-random payload (xorshift64) — exact bytes matter
/// because every test verifies SHA-256 over them.
fn deterministic_bytes(len: usize) -> Vec<u8> {
    let mut state = 0x9E37_79B9_7F4A_7C15u64;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state as u8
        })
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex(&h.finalize())
}

/// Committed row counts, read through a SEPARATE connection (i.e. what any
/// other connection would actually see, not our store's snapshot).
fn row_counts(path: &Path) -> (i64, i64) {
    let conn = Connection::open(path).unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    let attachments: i64 = conn
        .query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0))
        .unwrap();
    let chunks: i64 = conn
        .query_row("SELECT COUNT(*) FROM attachment_chunks", [], |r| r.get(0))
        .unwrap();
    (attachments, chunks)
}

// ---- validation -------------------------------------------------------------

#[test]
fn rejects_path_like_empty_and_oversized_names() {
    let t = TempDir::new("validate");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();

    let too_long = "x".repeat(256);
    let bad_names = [
        "",
        "foo/bar.txt",
        "a\\b.txt",
        "dir/with\\mixed.txt",
        "nul\0byte.bin",
        too_long.as_str(),
    ];
    for name in bad_names {
        let err = store
            .import_reader(name, "text/plain", Cursor::new(b"hi".to_vec()))
            .unwrap_err();
        assert!(
            err.to_string().contains("invalid"),
            "name {name:?} should be rejected, got: {err}"
        );
    }

    // MIME values end up in header-shaped contexts: line breaks and control
    // bytes (header smuggling) are rejected.
    for media_type in [
        "text/plain\r\nX-Injected: yes",
        "text/plain\n",
        "image/png\r",
        "text\tplain",
        "\0",
    ] {
        let err = store
            .import_reader("ok.bin", media_type, Cursor::new(b"hi".to_vec()))
            .unwrap_err();
        assert!(
            err.to_string().contains("invalid"),
            "media_type {media_type:?} should be rejected, got: {err}"
        );
    }

    // The documented boundary: a 255-character name is accepted.
    let max_name = "y".repeat(255);
    let meta = store
        .import_reader(&max_name, "text/plain", Cursor::new(b"hi".to_vec()))
        .unwrap();
    assert_eq!(meta.name, max_name);
}

// ---- chunked round-trip -------------------------------------------------------

#[test]
fn multi_chunk_roundtrip_restores_exact_bytes_and_hash() {
    let t = TempDir::new("roundtrip");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();

    // More than two full chunks plus a partial tail: exercises chunk
    // boundaries, the last short chunk, and the hash over all of them.
    let payload = deterministic_bytes(2 * CHUNK_SIZE + 12_345);
    let meta = store
        .import_reader("big.bin", "application/octet-stream", Cursor::new(&payload))
        .unwrap();
    assert_eq!(meta.name, "big.bin");
    assert_eq!(meta.size, payload.len() as u64);
    assert_eq!(meta.sha256, sha256_hex(&payload));

    // Chunk reads: full, full, partial tail, then out-of-range -> NotFound.
    assert_eq!(
        store.read_chunk(&meta.id, 0).unwrap(),
        &payload[..CHUNK_SIZE]
    );
    assert_eq!(
        store.read_chunk(&meta.id, 1).unwrap(),
        &payload[CHUNK_SIZE..2 * CHUNK_SIZE]
    );
    assert_eq!(
        store.read_chunk(&meta.id, 2).unwrap(),
        &payload[2 * CHUNK_SIZE..]
    );
    let err = store.read_chunk(&meta.id, 3).unwrap_err();
    assert!(err.to_string().contains("not_found"), "got: {err}");

    // Streamed copy matches byte-for-byte.
    let mut out = Vec::new();
    store.copy_to(&meta.id, &mut out).unwrap();
    assert_eq!(out, payload);

    // Empty payload: zero chunks, valid SHA-256 of the empty string.
    let empty = store
        .import_reader("empty.txt", "text/plain", Cursor::new(Vec::new()))
        .unwrap();
    assert_eq!(empty.size, 0);
    assert_eq!(empty.sha256, sha256_hex(b""));
    let mut out = Vec::new();
    store.copy_to(&empty.id, &mut out).unwrap();
    assert!(out.is_empty());

    // Exactly one full chunk (boundary case).
    let exact = deterministic_bytes(CHUNK_SIZE);
    let exact_meta = store
        .import_reader("exact.bin", "application/octet-stream", Cursor::new(&exact))
        .unwrap();
    let mut out = Vec::new();
    store.copy_to(&exact_meta.id, &mut out).unwrap();
    assert_eq!(out, exact);
    assert_eq!(exact_meta.sha256, sha256_hex(&exact));
}

// ---- durability ---------------------------------------------------------------

#[test]
fn reopen_preserves_attachments() {
    let t = TempDir::new("reopen");
    let payload = deterministic_bytes(CHUNK_SIZE + 7);
    let meta = {
        let mut store = AttachmentStore::open(&t.db_path()).unwrap();
        store
            .import_reader("report.md", "text/markdown", Cursor::new(&payload))
            .unwrap()
    };

    // Read-only methods (&self): the reopened store needs no mutability.
    let store = AttachmentStore::open(&t.db_path()).unwrap();
    assert_eq!(store.metadata(&meta.id).unwrap(), meta);
    let mut out = Vec::new();
    store.copy_to(&meta.id, &mut out).unwrap();
    assert_eq!(out, payload);
    assert_eq!(
        store.read_chunk(&meta.id, 1).unwrap(),
        &payload[CHUNK_SIZE..]
    );
}

#[test]
fn rejects_database_from_a_newer_version() {
    let t = TempDir::new("future");
    {
        let _store = AttachmentStore::open(&t.db_path()).unwrap();
    }
    {
        let conn = Connection::open(t.db_path()).unwrap();
        conn.pragma_update(None, "user_version", 9_999).unwrap();
    }
    let err = AttachmentStore::open(&t.db_path()).unwrap_err();
    assert!(err.to_string().contains("newer"), "got: {err}");
}

// ---- transactional rollback -----------------------------------------------------

/// Reader that yields a prefix of `data` and then fails — simulates a disk or
/// network error in the middle of an import.
struct FailAfter {
    data: Cursor<Vec<u8>>,
    fail_at: u64,
}

impl Read for FailAfter {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.data.position() >= self.fail_at {
            return Err(std::io::Error::other("simulated mid-read failure"));
        }
        self.data.read(buf)
    }
}

#[test]
fn failed_import_rolls_back_atomically() {
    let t = TempDir::new("rollback");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();

    let payload = deterministic_bytes(3 * CHUNK_SIZE);
    let err = store
        .import_reader(
            "doomed.bin",
            "application/octet-stream",
            FailAfter {
                data: Cursor::new(payload.clone()),
                fail_at: CHUNK_SIZE as u64 + 100, // fails inside the second chunk
            },
        )
        .unwrap_err();
    assert!(err.to_string().contains("simulated"), "got: {err}");

    // Nothing survived the rollback: zero metadata rows, zero chunk rows,
    // verified through a separate connection (committed state).
    assert_eq!(row_counts(&t.db_path()), (0, 0));

    // The store is still usable afterwards.
    let good = store
        .import_reader("ok.bin", "application/octet-stream", Cursor::new(&payload))
        .unwrap();
    assert_eq!(good.size, payload.len() as u64);
    assert_eq!(row_counts(&t.db_path()), (1, 3));
}

// ---- corruption detection ---------------------------------------------------------

#[test]
fn corrupted_chunk_fails_copy_to() {
    let t = TempDir::new("corrupt");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let payload = deterministic_bytes(2 * CHUNK_SIZE + 11);
    let meta = store
        .import_reader("doc.bin", "application/octet-stream", Cursor::new(&payload))
        .unwrap();

    // Tamper INSIDE chunk 0 keeping the length identical: pure hash mismatch.
    let mut corrupted = payload[..CHUNK_SIZE].to_vec();
    corrupted[0] ^= 0xff;
    corrupted[CHUNK_SIZE - 1] ^= 0xff;
    {
        let conn = Connection::open(t.db_path()).unwrap();
        conn.execute(
            "UPDATE attachment_chunks SET data = ?2 WHERE asset_id = ?1 AND ordinal = 0",
            params![meta.id, corrupted],
        )
        .unwrap();
    }
    let mut out = Vec::new();
    let err = store.copy_to(&meta.id, &mut out).unwrap_err();
    assert!(err.to_string().contains("sha256"), "got: {err}");

    // Length tampering is caught by the size checks instead.
    let conn = Connection::open(t.db_path()).unwrap();
    conn.execute(
        "UPDATE attachment_chunks SET data = ?2 WHERE asset_id = ?1 AND ordinal = 1",
        params![meta.id, b"tiny"],
    )
    .unwrap();
    let err = store.copy_to(&meta.id, &mut out).unwrap_err();
    assert!(err.to_string().contains("chunk 1"), "got: {err}");

    // Detection, never silent repair: metadata is untouched.
    assert_eq!(store.metadata(&meta.id).unwrap().sha256, meta.sha256);
}

// ---- notes DB / attachment DB independence -------------------------------------------

#[test]
fn attachment_db_and_note_db_do_not_block_each_other() {
    let t = TempDir::new("independent");
    let engine = Engine::open(t.path.join("library.db").to_str().unwrap()).unwrap();
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let payload = deterministic_bytes(CHUNK_SIZE + 5);

    // Direction 1: hold the WRITE lock on the notes DB (BEGIN IMMEDIATE);
    // attachment writes go to their own file and must proceed unaffected.
    engine
        .connection()
        .execute_batch("BEGIN IMMEDIATE;")
        .unwrap();
    let meta = store
        .import_reader(
            "locked.bin",
            "application/octet-stream",
            Cursor::new(&payload),
        )
        .expect("attachment import must not be blocked by a notes-DB write lock");
    engine.connection().execute_batch("ROLLBACK;").unwrap();

    // Direction 2: hold the WRITE lock on the attachments DB through a
    // separate connection; a note save on the notes DB must proceed.
    let attachment_lock = Connection::open(t.db_path()).unwrap();
    attachment_lock.execute_batch("BEGIN IMMEDIATE;").unwrap();
    let res = engine.execute(json!({
        "op": "save",
        "note": { "title": "locked note", "content": "body", "text": "body" }
    }));
    assert_eq!(
        res["ok"], true,
        "note save must not be blocked by an attachment-DB write lock: {res}"
    );
    attachment_lock.execute_batch("ROLLBACK;").unwrap();

    // Both stores remain fully functional afterwards.
    let mut out = Vec::new();
    store.copy_to(&meta.id, &mut out).unwrap();
    assert_eq!(out, payload);
    let list = engine.execute(json!({ "op": "list", "view": "all" }));
    assert_eq!(list["ok"], true, "{list}");
}

#[test]
fn empty_attachment_is_valid_and_oversized_stored_chunk_is_rejected() {
    let t = TempDir::new("empty-and-corrupt");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let empty = store
        .import_reader("empty.txt", "text/plain", Cursor::new([]))
        .unwrap();
    let mut output = Vec::new();
    store.copy_to(&empty.id, &mut output).unwrap();
    assert!(output.is_empty());
    assert_eq!(empty.sha256, sha256_hex(&[]));
    let file = store
        .import_reader(
            "small.bin",
            "application/octet-stream",
            Cursor::new(b"small"),
        )
        .unwrap();
    let raw = Connection::open(t.db_path()).unwrap();
    raw.execute(
        "UPDATE attachment_chunks SET data=zeroblob(?2) WHERE asset_id=?1",
        params![file.id, CHUNK_SIZE as i64 + 1],
    )
    .unwrap();
    assert!(store.read_chunk(&file.id, 0).is_err());
    assert!(store.copy_to(&file.id, &mut output).is_err());
    assert!(output.is_empty());
}

// ---- verified import (sync receive path) -------------------------------------
//
// `import_verified` stores under the SENDER's ID (canonical lowercase UUID)
// and treats an already-present ID as an idempotent retransmission: it may
// return the existing verified object without consuming the input, but only
// after the stored bytes re-verify. Conflicts and corruption never overwrite.

/// A canonical lowercase UUID, as the sync side spells attachment IDs.
fn canonical_id() -> String {
    uuid::Uuid::new_v4().hyphenated().to_string()
}

/// Build a manifest matching `payload` exactly.
fn manifest(id: &str, name: &str, media_type: &str, payload: &[u8]) -> AttachmentMetadata {
    AttachmentMetadata {
        id: id.to_string(),
        name: name.to_string(),
        media_type: media_type.to_string(),
        size: payload.len() as u64,
        sha256: sha256_hex(payload),
    }
}

/// Reader that counts how often it was polled — the idempotent-retransmission
/// shortcut must leave the input untouched.
struct CountingReader {
    data: Cursor<Vec<u8>>,
    reads: usize,
}

impl Read for CountingReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.reads += 1;
        self.data.read(buf)
    }
}

/// Committed `created_at` of one row, read through a separate connection: a
/// retransmission must never rewrite the row (delete + re-insert would move it).
fn created_at(path: &Path, id: &str) -> i64 {
    Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT created_at FROM attachments WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn verified_import_keeps_sender_id_across_reopen_and_chunk_boundaries() {
    let t = TempDir::new("verified-reopen");
    let id = canonical_id();
    let payload = deterministic_bytes(3 * CHUNK_SIZE + 12_345);
    let expected = manifest(&id, "synced.bin", "application/octet-stream", &payload);

    let meta = {
        let mut store = AttachmentStore::open(&t.db_path()).unwrap();
        let meta = store
            .import_verified(&expected, Cursor::new(&payload))
            .unwrap();
        assert_eq!(
            meta, expected,
            "the sender's manifest must come back verbatim"
        );
        meta
    };
    assert_eq!(meta.id, id);
    // 3 full chunks + one partial tail.
    assert_eq!(row_counts(&t.db_path()), (1, 4));

    // Reopen: the file is reachable under the SENDER's ID, byte-exact, and
    // the chunk boundaries line up.
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    assert_eq!(store.metadata(&id).unwrap(), expected);
    let mut out = Vec::new();
    store.copy_to(&id, &mut out).unwrap();
    assert_eq!(out, payload);
    assert_eq!(
        store.read_chunk(&id, 2).unwrap(),
        &payload[2 * CHUNK_SIZE..3 * CHUNK_SIZE]
    );
    assert_eq!(
        store.read_chunk(&id, 3).unwrap(),
        &payload[3 * CHUNK_SIZE..]
    );

    // Retransmission against the reopened store: idempotent, same object,
    // and the row is not rewritten.
    let created = created_at(&t.db_path(), &id);
    let again = store
        .import_verified(&expected, Cursor::new(&payload))
        .unwrap();
    assert_eq!(again, expected);
    assert_eq!(row_counts(&t.db_path()), (1, 4));
    assert_eq!(
        created_at(&t.db_path(), &id),
        created,
        "retransmission must never rewrite the existing row"
    );
}

#[test]
fn verified_retransmission_of_identical_file_returns_existing_without_reading_input() {
    let t = TempDir::new("verified-duplicate");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let payload = deterministic_bytes(CHUNK_SIZE + 999);
    let id = canonical_id();
    let expected = manifest(&id, "same.bin", "application/octet-stream", &payload);
    store
        .import_verified(&expected, Cursor::new(&payload))
        .unwrap();

    // The already-stored object is returned without consuming the input.
    let mut reader = CountingReader {
        data: Cursor::new(payload.clone()),
        reads: 0,
    };
    let again = store.import_verified(&expected, &mut reader).unwrap();
    assert_eq!(again, expected);
    assert_eq!(
        reader.reads, 0,
        "an identical retransmission must not re-read the bytes"
    );
    assert_eq!(row_counts(&t.db_path()), (1, 2));

    // The stored bytes still verify end-to-end afterwards.
    let mut out = Vec::new();
    store.copy_to(&id, &mut out).unwrap();
    assert_eq!(out, payload);
}

#[test]
fn verified_conflicts_never_touch_the_existing_object() {
    let t = TempDir::new("verified-conflict");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let payload = deterministic_bytes(2 * CHUNK_SIZE + 5);
    let id = canonical_id();
    let original = manifest(&id, "report.md", "text/markdown", &payload);
    store
        .import_verified(&original, Cursor::new(&payload))
        .unwrap();
    let created = created_at(&t.db_path(), &id);

    // Metadata conflict under the same ID: rejected, nothing changes.
    let mut renamed = original.clone();
    renamed.name = "other.md".into();
    let err = store
        .import_verified(&renamed, Cursor::new(&payload))
        .unwrap_err();
    assert!(err.to_string().contains("conflict"), "got: {err}");

    // Content conflict: the SAME ID declaring DIFFERENT content (the digest
    // of other bytes) is refused — the stored object is never replaced.
    let mut tampered = payload.clone();
    tampered[0] ^= 0xff;
    let mut conflicting = original.clone();
    conflicting.sha256 = sha256_hex(&tampered);
    let err = store
        .import_verified(&conflicting, Cursor::new(&tampered))
        .unwrap_err();
    assert!(err.to_string().contains("conflict"), "got: {err}");

    // Same manifest but DIFFERENT bytes on the wire: the stored object is
    // authoritative — the identical retransmission shortcut returns the
    // existing verified object and leaves the diverging input unconsumed.
    let mut reader = CountingReader {
        data: Cursor::new(tampered.clone()),
        reads: 0,
    };
    let again = store.import_verified(&original, &mut reader).unwrap();
    assert_eq!(again, original);
    assert_eq!(reader.reads, 0, "stored object wins, input stays untouched");

    // All of the above left the original row (and only it) in place.
    assert_eq!(row_counts(&t.db_path()), (1, 3));
    assert_eq!(created_at(&t.db_path(), &id), created);
    assert_eq!(store.metadata(&id).unwrap(), original);
    let mut out = Vec::new();
    store.copy_to(&id, &mut out).unwrap();
    assert_eq!(out, payload);

    // A DIFFERENT ID with the same bytes is a separate object, not a conflict.
    let twin = manifest(&canonical_id(), "report.md", "text/markdown", &payload);
    let twin_meta = store.import_verified(&twin, Cursor::new(&payload)).unwrap();
    assert_eq!(twin_meta, twin);
    assert_eq!(row_counts(&t.db_path()), (2, 6));
    assert_eq!(store.metadata(&id).unwrap(), original);
}

#[test]
fn verified_manifest_hash_or_size_mismatch_rolls_back_everything() {
    let t = TempDir::new("verified-manifest-mismatch");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let payload = deterministic_bytes(2 * CHUNK_SIZE + 40);

    // Declared hash does not match the bytes on the wire.
    let mut bad_hash = manifest(
        &canonical_id(),
        "a.bin",
        "application/octet-stream",
        &payload,
    );
    bad_hash.sha256 = sha256_hex(b"different bytes");
    let err = store
        .import_verified(&bad_hash, Cursor::new(&payload))
        .unwrap_err();
    assert!(err.to_string().contains("conflict"), "got: {err}");
    assert_eq!(
        row_counts(&t.db_path()),
        (0, 0),
        "failed verification must roll back every chunk"
    );

    // Declared size does not match the bytes on the wire.
    let mut bad_size = manifest(
        &canonical_id(),
        "b.bin",
        "application/octet-stream",
        &payload,
    );
    bad_size.size += 1;
    let err = store
        .import_verified(&bad_size, Cursor::new(&payload))
        .unwrap_err();
    assert!(err.to_string().contains("conflict"), "got: {err}");
    assert_eq!(row_counts(&t.db_path()), (0, 0));

    // Over-limit manifest: rejected up front, before a byte is read.
    let mut too_big = manifest(
        &canonical_id(),
        "c.bin",
        "application/octet-stream",
        &payload,
    );
    too_big.size = MAX_ATTACHMENT_BYTES + 1;
    let err = store
        .import_verified(&too_big, Cursor::new(&payload))
        .unwrap_err();
    assert!(err.to_string().contains("invalid"), "got: {err}");
    assert_eq!(row_counts(&t.db_path()), (0, 0));

    // Mid-read I/O failure under a verified ID rolls back just the same.
    let good = manifest(
        &canonical_id(),
        "d.bin",
        "application/octet-stream",
        &payload,
    );
    let err = store
        .import_verified(
            &good,
            FailAfter {
                data: Cursor::new(payload.clone()),
                fail_at: CHUNK_SIZE as u64 + 10,
            },
        )
        .unwrap_err();
    assert!(err.to_string().contains("simulated"), "got: {err}");
    assert_eq!(row_counts(&t.db_path()), (0, 0));

    // The store is still fully usable afterwards, including the empty-file
    // boundary (0 bytes -> 0 chunks, digest of the empty string).
    let empty = manifest(&canonical_id(), "empty.txt", "text/plain", b"");
    let meta = store
        .import_verified(&empty, Cursor::new(Vec::new()))
        .unwrap();
    assert_eq!(meta, empty);
    assert_eq!(row_counts(&t.db_path()), (1, 0));
    let again = store
        .import_verified(&empty, Cursor::new(Vec::new()))
        .unwrap();
    assert_eq!(again, empty);
    assert_eq!(row_counts(&t.db_path()), (1, 0));
}

#[test]
fn verified_import_rejects_malformed_manifests_before_touching_the_database() {
    let t = TempDir::new("verified-validation");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let payload = b"payload".to_vec();

    // The ID must be a CANONICAL LOWERCASE UUID: unparseable text, the
    // unhyphenated form, uppercase, and the braced form are all rejected.
    let bad_ids: [String; 6] = [
        String::new(),
        "not-a-uuid".to_string(),
        "../../etc/passwd".to_string(),
        uuid::Uuid::new_v4().simple().to_string(),
        uuid::Uuid::new_v4().to_string().to_uppercase(),
        uuid::Uuid::new_v4().braced().to_string(),
    ];
    for id in &bad_ids {
        let err = store
            .import_verified(
                &manifest(id, "f.bin", "application/octet-stream", &payload),
                Cursor::new(&payload),
            )
            .unwrap_err();
        assert!(
            err.to_string().contains("invalid"),
            "id {id:?} should be rejected, got: {err}"
        );
    }

    // The digest must be exactly 64 LOWERCASE hex characters.
    let good_hash = sha256_hex(&payload);
    let bad_hashes: [String; 5] = [
        String::new(),
        good_hash.to_uppercase(),
        "z".repeat(64),
        good_hash[..63].to_string(),
        format!("{good_hash}0"),
    ];
    for hash in &bad_hashes {
        let mut m = manifest(
            &canonical_id(),
            "f.bin",
            "application/octet-stream",
            &payload,
        );
        m.sha256 = hash.clone();
        let err = store
            .import_verified(&m, Cursor::new(&payload))
            .unwrap_err();
        assert!(
            err.to_string().contains("invalid"),
            "hash {hash:?} should be rejected, got: {err}"
        );
    }

    // Names go through the usual rules (display name, never a path).
    for name in ["", "a/b", "c\\d"] {
        let err = store
            .import_verified(
                &manifest(&canonical_id(), name, "application/octet-stream", &payload),
                Cursor::new(&payload),
            )
            .unwrap_err();
        assert!(
            err.to_string().contains("invalid"),
            "name {name:?} should be rejected, got: {err}"
        );
    }

    // Nothing above was allowed to touch the database.
    assert_eq!(row_counts(&t.db_path()), (0, 0));

    // A well-formed manifest still works afterwards.
    let ok = manifest(
        &canonical_id(),
        "fine.bin",
        "application/octet-stream",
        &payload,
    );
    assert_eq!(
        store.import_verified(&ok, Cursor::new(&payload)).unwrap(),
        ok
    );
}

#[test]
fn verified_retransmission_refuses_a_corrupted_store_instead_of_trusting_the_row() {
    let t = TempDir::new("verified-corrupt-redelivery");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let payload = deterministic_bytes(2 * CHUNK_SIZE + 21);
    let id = canonical_id();
    let expected = manifest(&id, "doc.bin", "application/octet-stream", &payload);
    store
        .import_verified(&expected, Cursor::new(&payload))
        .unwrap();

    // Flip bytes inside chunk 0 keeping every length intact: only the hash
    // is wrong, so only the re-verification can catch it.
    let mut corrupted = payload[..CHUNK_SIZE].to_vec();
    corrupted[0] ^= 0xff;
    corrupted[CHUNK_SIZE - 1] ^= 0xff;
    let raw = Connection::open(t.db_path()).unwrap();
    raw.execute(
        "UPDATE attachment_chunks SET data = ?2 WHERE asset_id = ?1 AND ordinal = 0",
        params![id, corrupted],
    )
    .unwrap();

    // The metadata row still claims `expected`, but the stored bytes fail
    // copy_to verification: the retransmission is refused, not trusted.
    let mut reader = CountingReader {
        data: Cursor::new(payload.clone()),
        reads: 0,
    };
    let err = store.import_verified(&expected, &mut reader).unwrap_err();
    assert!(err.to_string().contains("sha256"), "got: {err}");
    assert_eq!(
        reader.reads, 0,
        "the shortcut must re-verify stored bytes, not stream the new input"
    );

    // Nothing was silently overwritten or "repaired".
    assert_eq!(store.metadata(&id).unwrap(), expected);
    assert_eq!(row_counts(&t.db_path()), (1, 3));

    // Once the bytes are whole again, the same retransmission succeeds.
    raw.execute(
        "UPDATE attachment_chunks SET data = ?2 WHERE asset_id = ?1 AND ordinal = 0",
        params![id, &payload[..CHUNK_SIZE]],
    )
    .unwrap();
    let ok = store
        .import_verified(&expected, Cursor::new(&payload))
        .unwrap();
    assert_eq!(ok, expected);
    assert_eq!(row_counts(&t.db_path()), (1, 3));
}

#[test]
fn verified_import_stops_after_manifest_size_plus_one() {
    let t = TempDir::new("verified-bounded");
    let mut store = AttachmentStore::open(&t.db_path()).unwrap();
    let expected = manifest(
        &canonical_id(),
        "small.bin",
        "application/octet-stream",
        b"x",
    );
    let mut source = Cursor::new(vec![1; CHUNK_SIZE * 3]);
    assert!(store.import_verified(&expected, &mut source).is_err());
    assert_eq!(source.position(), 2);
    assert_eq!(row_counts(&t.db_path()), (0, 0));
}
