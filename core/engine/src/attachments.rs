//! Attachment storage: binary blobs live in a DEDICATED SQLite database that
//! is completely separate from the notes library file, so importing or
//! exporting a large attachment can never block (or be blocked by) note
//! saves, and no reference to any original file path is ever persisted.
//!
//! Layout: one `attachments` metadata row (id / name / media_type / size /
//! sha256) plus fixed-size `attachment_chunks` BLOB rows ([`CHUNK_SIZE`]
//! bytes each, ordered by `ordinal`) referencing it by FK. Every import is
//! ONE transaction: a read error or the [`MAX_ATTACHMENT_BYTES`] cap rolls
//! back every chunk, and size + SHA-256 are only committed for a source that
//! was read to completion.
//!
//! This module is deliberately standalone: [`AttachmentStore`] owns its own
//! connection. Wiring it into the protocol, UI, sync and backup flows is a
//! separate integration step.
//!
//! The sync receive path uses [`AttachmentStore::import_verified`]: the
//! sender already fixed the attachment ID, so the row is stored under that
//! exact ID and an already-present ID is treated as an idempotent
//! retransmission — re-verified against the stored bytes, never overwritten.

use crate::error::{EngineError, Result};
use crate::ids;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

/// Chunk size for stored blobs (256 KiB) — also the fixed read buffer size
/// used while importing.
pub const CHUNK_SIZE: usize = 256 * 1024;
/// Hard cap for one attachment: 1 GiB. Larger sources are rejected and rolled
/// back, never truncated.
pub const MAX_ATTACHMENT_BYTES: u64 = 1024 * 1024 * 1024;
/// Attachment names are display names, never paths.
pub const MAX_NAME_CHARS: usize = 255;
/// Schema version stamped into the attachment database's `user_version`.
pub const ATTACHMENT_USER_VERSION: i32 = 1;
/// Attachment writes are user-initiated and rare; waiting is better than a
/// spurious `database is locked`.
const BUSY_TIMEOUT_MS: u64 = 5_000;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS attachments (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    media_type  TEXT NOT NULL,
    size        INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);

-- The bytes themselves. FK with CASCADE so removing a metadata row (future
-- garbage collection) removes its chunks automatically.
CREATE TABLE IF NOT EXISTS attachment_chunks (
    asset_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    ordinal  INTEGER NOT NULL,
    data     BLOB NOT NULL,
    PRIMARY KEY (asset_id, ordinal)
);
"#;

/// SQLite integers are signed; convert a stored size defensively so a
/// hand-tampered database surfaces as corruption instead of wrapping.
fn stored_size(v: i64) -> Result<u64> {
    u64::try_from(v).map_err(|_| EngineError::internal("stored attachment size is negative"))
}

/// User-visible attachment metadata. `sha256` is the lowercase hex digest of
/// the exact stored bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentMetadata {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub size: u64,
    pub sha256: String,
}

/// Owns the dedicated attachment SQLite connection (one store per file).
#[derive(Debug)]
pub struct AttachmentStore {
    conn: Connection,
}

impl AttachmentStore {
    /// Open (or create) the attachment database at `path`.
    ///
    /// Pragmas: WAL, `foreign_keys=ON`, 5 s busy timeout. A database stamped
    /// with a `user_version` newer than [`ATTACHMENT_USER_VERSION`] is
    /// rejected instead of being opened (forward-compatibility guard, same
    /// policy as the main library schema).
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_with_key(path, None)
    }

    #[cfg(feature = "encrypted-storage")]
    pub fn open_encrypted(path: &Path, key: &crate::storage::StorageKey) -> Result<Self> {
        Self::open_with_key(path, Some(key))
    }

    fn open_with_key(path: &Path, key: Option<&crate::storage::StorageKey>) -> Result<Self> {
        let conn = crate::storage::open(path, key)?;
        conn.busy_timeout(Duration::from_millis(BUSY_TIMEOUT_MS))?;
        let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > ATTACHMENT_USER_VERSION {
            return Err(EngineError::invalid(
                "attachment database was created by a newer Inkism version",
            ));
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        if version == ATTACHMENT_USER_VERSION {
            return Ok(AttachmentStore { conn });
        }
        conn.execute_batch("BEGIN IMMEDIATE;")?;
        let result = conn
            .execute_batch(SCHEMA_SQL)
            .and_then(|_| conn.pragma_update(None, "user_version", ATTACHMENT_USER_VERSION));
        match result {
            Ok(()) => conn.execute_batch("COMMIT;")?,
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(e.into());
            }
        }
        Ok(AttachmentStore { conn })
    }

    /// Import one attachment, reading `source` to completion with a fixed
    /// [`CHUNK_SIZE`] buffer.
    ///
    /// The whole import is a single transaction: on a read error, an I/O
    /// failure, or a source larger than [`MAX_ATTACHMENT_BYTES`], every
    /// inserted chunk is rolled back and nothing becomes visible. The
    /// returned metadata carries the committed size and SHA-256. No path or
    /// provenance of the source is recorded — only `name` and `media_type`.
    pub fn import_reader<R: Read>(
        &mut self,
        name: &str,
        media_type: &str,
        source: R,
    ) -> Result<AttachmentMetadata> {
        Self::validate_name(name)?;
        Self::validate_media_type(media_type)?;
        let id = ids::new_id();
        let mut source = source;
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut hasher = Sha256::new();

        self.conn.execute_batch("BEGIN IMMEDIATE;")?;
        let result = self.do_import(&id, name, media_type, &mut source, &mut buf, &mut hasher);
        match result {
            Ok(meta) => {
                if let Err(error) = self.conn.execute_batch("COMMIT;") {
                    let _ = self.conn.execute_batch("ROLLBACK;");
                    return Err(error.into());
                }
                Ok(meta)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK;");
                Err(e)
            }
        }
    }

    /// Import one attachment under the CALLER-SUPPLIED ID carried by
    /// `expected` — the sync receive path. The sender already fixed the ID,
    /// so a retransmission must land on the same immutable object instead of
    /// minting a new one the way [`Self::import_reader`] would.
    ///
    /// The manifest is fully validated up front: canonical lowercase UUID,
    /// the usual name/media_type rules, `size <= [`MAX_ATTACHMENT_BYTES`]`,
    /// and a 64-character lowercase hex `sha256`.
    ///
    /// Everything happens in ONE `BEGIN IMMEDIATE` transaction, so the
    /// existence check is race-free against a concurrent import of the same ID:
    ///
    /// * ID absent — the stream is stored chunk-wise through the same
    ///   transaction body as [`Self::import_reader`]; the resulting size and
    ///   SHA-256 must match `expected` exactly, or every inserted chunk is
    ///   rolled back (mismatched manifest, mid-read I/O error, over-limit
    ///   source — nothing becomes visible).
    /// * ID present — success only if the stored metadata equals `expected`
    ///   AND the stored bytes re-verify through [`Self::copy_to`] (chunk
    ///   lengths, total size, digest). The already-verified immutable object
    ///   is then returned WITHOUT consuming `source`. A metadata mismatch or
    ///   a corrupted store is an error: the same ID is NEVER overwritten.
    pub fn import_verified<R: Read>(
        &mut self,
        expected: &AttachmentMetadata,
        source: R,
    ) -> Result<AttachmentMetadata> {
        Self::validate_name(&expected.name)?;
        Self::validate_media_type(&expected.media_type)?;
        Self::validate_canonical_uuid(&expected.id)?;
        Self::validate_sha256_hex(&expected.sha256)?;
        if expected.size > MAX_ATTACHMENT_BYTES {
            return Err(EngineError::invalid(format!(
                "attachment exceeds the {MAX_ATTACHMENT_BYTES} byte limit"
            )));
        }

        // Read at most one byte beyond the declared length. A hostile or
        // mistaken source cannot force a 1GiB write for a 1-byte manifest.
        let mut source = source.take(expected.size + 1);
        let mut buf = vec![0u8; CHUNK_SIZE];
        self.conn.execute_batch("BEGIN IMMEDIATE;")?;
        let result = self.do_import_verified(expected, &mut source, &mut buf);
        match result {
            Ok(meta) => {
                if let Err(error) = self.conn.execute_batch("COMMIT;") {
                    let _ = self.conn.execute_batch("ROLLBACK;");
                    return Err(error.into());
                }
                Ok(meta)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK;");
                Err(e)
            }
        }
    }

    /// Transaction body of [`Self::import_verified`]; any `Err` aborts the
    /// enclosing transaction. Runs strictly inside `BEGIN IMMEDIATE` so the
    /// existence check cannot race a concurrent import of the same ID.
    fn do_import_verified<R: Read>(
        &mut self,
        expected: &AttachmentMetadata,
        source: &mut R,
        buf: &mut [u8],
    ) -> Result<AttachmentMetadata> {
        match self.metadata(&expected.id) {
            Ok(existing) => {
                if &existing != expected {
                    return Err(EngineError::Conflict(format!(
                        "attachment {} already exists with different metadata",
                        expected.id
                    )));
                }
                // The row claims to match, but the bytes live in a mutable
                // database: re-verify chunk lengths, total size and digest
                // before trusting the shortcut. Copying to a sink re-checks
                // everything without buffering the blob in memory — and the
                // input is left untouched for the next retry.
                self.copy_to(&expected.id, &mut std::io::sink())?;
                return Ok(existing);
            }
            Err(EngineError::NotFound(_)) => {}
            Err(e) => return Err(e),
        }

        let mut hasher = Sha256::new();
        let imported = self.do_import(
            &expected.id,
            &expected.name,
            &expected.media_type,
            source,
            buf,
            &mut hasher,
        )?;
        if imported.size != expected.size {
            return Err(EngineError::Conflict(format!(
                "attachment {}: received {} bytes but the manifest declares {}",
                expected.id, imported.size, expected.size
            )));
        }
        if imported.sha256 != expected.sha256 {
            return Err(EngineError::Conflict(format!(
                "attachment {}: received sha256 {} but the manifest declares {}",
                expected.id, imported.sha256, expected.sha256
            )));
        }
        Ok(imported)
    }

    /// Transaction body of [`Self::import_reader`]; any `Err` aborts the
    /// enclosing transaction.
    fn do_import<R: Read>(
        &mut self,
        id: &str,
        name: &str,
        media_type: &str,
        source: &mut R,
        buf: &mut [u8],
        hasher: &mut Sha256,
    ) -> Result<AttachmentMetadata> {
        // Parent row first: chunks reference it by FK.
        self.conn.execute(
            "INSERT INTO attachments (id, name, media_type, size, sha256, chunk_count, created_at)
             VALUES (?1, ?2, ?3, 0, '', 0, ?4)",
            params![id, name, media_type, ids::now_ms()],
        )?;
        let mut insert = self.conn.prepare(
            "INSERT INTO attachment_chunks (asset_id, ordinal, data) VALUES (?1, ?2, ?3)",
        )?;
        let mut total: u64 = 0;
        let mut ordinal: i64 = 0;
        let mut eof = false;
        while !eof {
            let mut filled = 0;
            while filled < buf.len() {
                match source.read(&mut buf[filled..]) {
                    Ok(0) => {
                        eof = true;
                        break;
                    }
                    Ok(n) => filled += n,
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(e) => return Err(e.into()),
                }
            }
            if filled == 0 {
                break;
            }
            hasher.update(&buf[..filled]);
            total += filled as u64;
            if total > MAX_ATTACHMENT_BYTES {
                return Err(EngineError::invalid(format!(
                    "attachment exceeds the {MAX_ATTACHMENT_BYTES} byte limit"
                )));
            }
            insert.execute(params![id, ordinal, &buf[..filled]])?;
            ordinal += 1;
        }
        let sha256 = to_hex(&hasher.clone().finalize());
        self.conn.execute(
            "UPDATE attachments SET size = ?2, sha256 = ?3, chunk_count = ?4 WHERE id = ?1",
            // `total` is capped at MAX_ATTACHMENT_BYTES << i64::MAX.
            params![id, total as i64, sha256, ordinal],
        )?;
        Ok(AttachmentMetadata {
            id: id.to_string(),
            name: name.to_string(),
            media_type: media_type.to_string(),
            size: total,
            sha256,
        })
    }

    /// Stream immutable metadata rows without collecting a large asset library.
    pub fn for_each_metadata<F>(&self, mut visit: F) -> Result<()>
    where
        F: FnMut(AttachmentMetadata) -> Result<()>,
    {
        let mut statement = self
            .conn
            .prepare("SELECT id, name, media_type, size, sha256 FROM attachments ORDER BY id")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            visit(AttachmentMetadata {
                id: row.get(0)?,
                name: row.get(1)?,
                media_type: row.get(2)?,
                size: stored_size(row.get(3)?)?,
                sha256: row.get(4)?,
            })?;
        }
        Ok(())
    }

    /// Fetch metadata for one attachment.
    pub fn metadata(&self, id: &str) -> Result<AttachmentMetadata> {
        let (id, name, media_type, size, sha256): (String, String, String, i64, String) = self
            .conn
            .query_row(
                "SELECT id, name, media_type, size, sha256 FROM attachments WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?
            .ok_or_else(|| EngineError::NotFound(format!("attachment {id}")))?;
        Ok(AttachmentMetadata {
            id,
            name,
            media_type,
            size: stored_size(size)?,
            sha256,
        })
    }

    /// Read exactly one stored chunk (at most [`CHUNK_SIZE`] bytes). Every
    /// chunk except the last is exactly [`CHUNK_SIZE`]; an out-of-range or
    /// absent chunk is `NotFound`.
    pub fn read_chunk(&self, id: &str, ordinal: usize) -> Result<Vec<u8>> {
        let chunk_count: i64 = self
            .conn
            .query_row(
                "SELECT chunk_count FROM attachments WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| EngineError::NotFound(format!("attachment {id}")))?;
        if ordinal as i64 >= chunk_count {
            return Err(EngineError::NotFound(format!(
                "attachment {id} has no chunk {ordinal}"
            )));
        }
        let data: Vec<u8> = self
            .conn
            .query_row(
                "SELECT CASE WHEN length(data) <= ?3 THEN data ELSE NULL END FROM attachment_chunks WHERE asset_id = ?1 AND ordinal = ?2",
                params![id, ordinal as i64, CHUNK_SIZE as i64],
                |r| r.get::<_, Option<Vec<u8>>>(0),
            )
            .optional()?
            .ok_or_else(|| EngineError::NotFound(format!(
                "attachment {id} has no chunk {ordinal}"
            )))?
            .ok_or_else(|| EngineError::internal("stored chunk exceeds CHUNK_SIZE"))?;
        if data.len() > CHUNK_SIZE {
            return Err(EngineError::internal(
                "stored chunk exceeds CHUNK_SIZE (database corrupted)",
            ));
        }
        Ok(data)
    }

    /// Stream every chunk of `id` into `writer` in order, verifying each
    /// chunk length, the total size, and the SHA-256 digest while copying.
    ///
    /// On ANY failure the error is returned immediately and the writer may
    /// already have received a partial prefix of the bytes — a stream cannot
    /// be un-written. The STORE itself is never modified by this call; the
    /// failure always reflects a real mismatch (corrupted database) or an
    /// I/O error. Callers needing all-or-nothing output must write to a temp
    /// file and rename.
    pub fn copy_to<W: Write>(&self, id: &str, writer: &mut W) -> Result<()> {
        let (raw_size, sha256, chunk_count): (i64, String, i64) = self
            .conn
            .query_row(
                "SELECT size, sha256, chunk_count FROM attachments WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?
            .ok_or_else(|| EngineError::NotFound(format!("attachment {id}")))?;
        let size = stored_size(raw_size)?;
        let expected_chunks = chunk_count_for(size) as i64;
        if chunk_count != expected_chunks {
            return Err(EngineError::internal(format!(
                "attachment {id}: chunk count {chunk_count} does not match size {size}"
            )));
        }
        let mut hasher = Sha256::new();
        let mut total: u64 = 0;
        let mut next_ordinal: i64 = 0;
        let mut stmt = self.conn.prepare(
            "SELECT ordinal, length(data), substr(data, 1, ?2) FROM attachment_chunks WHERE asset_id = ?1 ORDER BY ordinal",
        )?;
        let mut rows = stmt.query(params![id, CHUNK_SIZE as i64])?;
        while let Some(row) = rows.next()? {
            let ordinal: i64 = row.get(0)?;
            if ordinal != next_ordinal {
                return Err(EngineError::internal(format!(
                    "attachment {id}: chunk {next_ordinal} is missing (found {ordinal})"
                )));
            }
            let stored_length: i64 = row.get(1)?;
            let data: Vec<u8> = row.get(2)?;
            let expected_len = std::cmp::min(CHUNK_SIZE as u64, size - total) as usize;
            if stored_length != expected_len as i64 || data.len() != expected_len {
                return Err(EngineError::internal(format!(
                    "attachment {id}: chunk {ordinal} has {} bytes, expected {expected_len}",
                    data.len()
                )));
            }
            hasher.update(&data);
            total += data.len() as u64;
            writer.write_all(&data)?;
            next_ordinal += 1;
        }
        if total != size || next_ordinal != expected_chunks {
            return Err(EngineError::internal(format!(
                "attachment {id}: read {total} bytes in {next_ordinal} chunks, expected {size} in {expected_chunks}"
            )));
        }
        let actual = to_hex(&hasher.finalize());
        if actual != sha256 {
            return Err(EngineError::internal(format!(
                "attachment {id}: sha256 mismatch (stored {sha256}, computed {actual})"
            )));
        }
        writer.flush()?;
        Ok(())
    }

    fn validate_name(name: &str) -> Result<()> {
        if name.is_empty() {
            return Err(EngineError::invalid("attachment name must not be empty"));
        }
        if name.chars().count() > MAX_NAME_CHARS {
            return Err(EngineError::invalid(format!(
                "attachment name longer than {MAX_NAME_CHARS} characters"
            )));
        }
        if name.contains('/') || name.contains('\\') {
            return Err(EngineError::invalid(
                "attachment name must not contain path separators",
            ));
        }
        if name.chars().any(|c| c == '\0' || c.is_control()) {
            return Err(EngineError::invalid(
                "attachment name contains NUL or control characters",
            ));
        }
        Ok(())
    }

    /// Sync manifests address attachments by ID: require the canonical
    /// lowercase hyphenated spelling so both peers compare exact strings.
    fn validate_canonical_uuid(id: &str) -> Result<()> {
        match uuid::Uuid::parse_str(id) {
            Ok(parsed) if parsed.hyphenated().to_string() == id => Ok(()),
            _ => Err(EngineError::invalid(
                "attachment id must be a canonical lowercase UUID",
            )),
        }
    }

    /// Digests are compared as strings end-to-end; require the exact
    /// canonical spelling (64 lowercase hex characters).
    fn validate_sha256_hex(sha256: &str) -> Result<()> {
        let is_lowercase_hex = sha256.len() == 64
            && sha256
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
        if is_lowercase_hex {
            Ok(())
        } else {
            Err(EngineError::invalid(
                "attachment sha256 must be 64 lowercase hex characters",
            ))
        }
    }

    fn validate_media_type(media_type: &str) -> Result<()> {
        if media_type.is_empty() {
            return Err(EngineError::invalid("media_type must not be empty"));
        }
        if media_type.len() > 255 {
            return Err(EngineError::invalid(
                "media_type longer than 255 characters",
            ));
        }
        // Media types end up in header-shaped contexts: any byte that could
        // smuggle a line break or control character is rejected outright.
        if media_type
            .chars()
            .any(|c| c == '\r' || c == '\n' || c == '\0' || c.is_control())
        {
            return Err(EngineError::invalid(
                "media_type must not contain line breaks or control characters",
            ));
        }
        Ok(())
    }
}

/// Number of chunks a payload of `size` bytes occupies (0 for empty).
fn chunk_count_for(size: u64) -> usize {
    size.div_ceil(CHUNK_SIZE as u64) as usize
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

#[cfg(test)]
mod write_failure_tests {
    use super::*;
    use std::io::Cursor;

    fn disk_full_rollback(key: Option<&crate::storage::StorageKey>) {
        let path = std::env::temp_dir().join(format!("inkism-full-{}.db", uuid::Uuid::new_v4()));
        let mut store = AttachmentStore::open_with_key(&path, key).unwrap();
        let original = store
            .import_reader(
                "original.bin",
                "application/octet-stream",
                Cursor::new(b"original bytes"),
            )
            .unwrap();
        let pages: i64 = store
            .conn
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .unwrap();
        store
            .conn
            .pragma_update(None, "max_page_count", pages + 8)
            .unwrap();
        let error = store
            .import_reader(
                "too-large.bin",
                "application/octet-stream",
                Cursor::new(vec![0x53; CHUNK_SIZE * 2]),
            )
            .unwrap_err();
        assert!(error.to_string().contains("full"), "{error}");
        let count: i64 = store
            .conn
            .query_row("SELECT count(*) FROM attachments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let chunks: i64 = store
            .conn
            .query_row("SELECT count(*) FROM attachment_chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(chunks, 1);
        assert!(store.conn.is_autocommit());
        let mut bytes = Vec::new();
        store.copy_to(&original.id, &mut bytes).unwrap();
        assert_eq!(bytes, b"original bytes");
        store
            .conn
            .pragma_update(None, "max_page_count", pages + 1024)
            .unwrap();
        let retry = store
            .import_reader(
                "retry.bin",
                "application/octet-stream",
                Cursor::new(vec![0x53; CHUNK_SIZE * 2]),
            )
            .unwrap();
        drop(store);
        let store = AttachmentStore::open_with_key(&path, key).unwrap();
        let mut bytes = Vec::new();
        store.copy_to(&retry.id, &mut bytes).unwrap();
        assert_eq!(bytes, vec![0x53; CHUNK_SIZE * 2]);
        drop(store);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn sqlite_full_rolls_back_and_retry_preserves_existing_attachment() {
        disk_full_rollback(None);
    }

    #[cfg(feature = "encrypted-storage")]
    #[test]
    fn encrypted_sqlite_full_rolls_back_and_retry_preserves_existing_attachment() {
        disk_full_rollback(Some(&crate::storage::StorageKey::from_bytes([0x78; 32])));
    }
}
