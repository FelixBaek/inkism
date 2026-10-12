//! Durable encrypted attachment outbox, separate from note state.
//!
//! Every nonce/ID/ciphertext is committed before HTTP. A failed request, or a
//! crash after the relay accepts bytes but before the local ack, replays exactly
//! the same immutable blob. Network calls never hold a SQLite transaction.
use crate::attachment::{AttachmentTransport, ChunkContext, SealedChunk, MAX_SEALED_CHUNK_BYTES};
use crate::{crypto, Key, Result, SyncError};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::path::Path;
use std::time::Duration;

const VERSION: i64 = 1;
const IDENTITY_AAD: &str = "mindbox:attachment-outbox:v1";
const SCHEMA: &str = "
CREATE TABLE vault_identity (id INTEGER PRIMARY KEY CHECK(id=1), sealed BLOB NOT NULL);
CREATE TABLE files (id TEXT PRIMARY KEY, total_size INTEGER NOT NULL);
CREATE TABLE chunks (
 file_id TEXT NOT NULL REFERENCES files(id), ordinal INTEGER NOT NULL,
 blob_id TEXT NOT NULL UNIQUE, ciphertext BLOB NOT NULL,
 uploaded INTEGER NOT NULL DEFAULT 0 CHECK(uploaded IN (0,1)),
 PRIMARY KEY(file_id, ordinal)
);
CREATE INDEX pending_chunks ON chunks(uploaded, file_id, ordinal);
PRAGMA user_version=1;
";

pub struct AttachmentQueue {
    conn: Connection,
    key: Key,
}

impl AttachmentQueue {
    /// A queue belongs to one vault key and relay identity. An existing queue
    /// cannot silently be reused after switching either.
    pub fn open(path: &Path, key: Key, relay_identity: &str) -> Result<Self> {
        Self::open_with_key(path, key, relay_identity, None)
    }

    #[cfg(feature = "encrypted-storage")]
    pub fn open_encrypted(
        path: &Path,
        key: Key,
        relay_identity: &str,
        storage_key: &crate::StorageKey,
    ) -> Result<Self> {
        Self::open_with_key(path, key, relay_identity, Some(storage_key))
    }

    fn open_with_key(
        path: &Path,
        key: Key,
        relay_identity: &str,
        storage_key: Option<&crate::StorageKey>,
    ) -> Result<Self> {
        if relay_identity.is_empty() || relay_identity.len() > 4096 {
            return Err(SyncError::Config(
                "invalid attachment relay identity".into(),
            ));
        }
        let mut conn = inkism_storage::open(path, storage_key)
            .map_err(|e| SyncError::Database(e.to_string()))?;
        conn.busy_timeout(Duration::from_secs(5))?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version != 0 && version != VERSION {
            return Err(SyncError::Config(
                "unsupported attachment queue version".into(),
            ));
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Re-read under the write lock: another process may have initialized it.
        let current: i64 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current == 0 {
            tx.execute_batch(SCHEMA)?;
            let sealed = crypto::seal(&key, IDENTITY_AAD, relay_identity.as_bytes())?;
            tx.execute("INSERT INTO vault_identity VALUES (1, ?1)", [sealed])?;
        } else if current != VERSION {
            return Err(SyncError::Config(
                "unsupported attachment queue version".into(),
            ));
        }
        let sealed: Vec<u8> = tx.query_row(
            "SELECT substr(sealed,1,4200) FROM vault_identity WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        if crypto::open(&key, IDENTITY_AAD, &sealed)? != relay_identity.as_bytes() {
            return Err(SyncError::Config(
                "attachment queue belongs to another relay".into(),
            ));
        }
        tx.commit()?;
        Ok(Self { conn, key })
    }

    /// Stage one immutable source chunk. Repeated staging preserves its random
    /// blob ID and nonce; changed source bytes or total size are rejected.
    pub fn stage(&mut self, context: &ChunkContext, plaintext: &[u8]) -> Result<SealedChunk> {
        if context.expected_len()? != plaintext.len() {
            return Err(SyncError::Protocol(
                "attachment chunk length mismatch".into(),
            ));
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let size: Option<u32> = tx
            .query_row(
                "SELECT total_size FROM files WHERE id=?1",
                [&context.attachment_id],
                |r| r.get(0),
            )
            .optional()?;
        match size {
            Some(size) if u64::from(size) != context.total_size => {
                return Err(SyncError::Protocol("attachment size changed".into()))
            }
            None => {
                tx.execute(
                    "INSERT INTO files VALUES (?1,?2)",
                    params![context.attachment_id, context.total_size as i64],
                )?;
            }
            _ => {}
        }
        let existing: Option<(String, Vec<u8>)> = tx.query_row(
            "SELECT blob_id, substr(ciphertext,1,?3) FROM chunks WHERE file_id=?1 AND ordinal=?2",
            params![context.attachment_id, context.index, (MAX_SEALED_CHUNK_BYTES+1) as i64],
            |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        let chunk = if let Some((id, ciphertext)) = existing {
            let chunk = SealedChunk { id, ciphertext };
            if chunk.decrypt(&self.key, context)? != plaintext {
                return Err(SyncError::Protocol("attachment bytes changed".into()));
            }
            chunk
        } else {
            let chunk = SealedChunk::encrypt(&self.key, context, plaintext)?;
            tx.execute(
                "INSERT INTO chunks(file_id,ordinal,blob_id,ciphertext) VALUES (?1,?2,?3,?4)",
                params![
                    context.attachment_id,
                    context.index,
                    chunk.id,
                    chunk.ciphertext
                ],
            )?;
            chunk
        };
        tx.commit()?;
        Ok(chunk)
    }

    /// Empty files have a manifest but no encrypted data chunks.
    pub fn register_empty(&mut self, file_id: &str) -> Result<()> {
        crate::attachment::validate_blob_id(file_id)?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT OR IGNORE INTO files VALUES (?1,0)", [file_id])?;
        let size: i64 =
            tx.query_row("SELECT total_size FROM files WHERE id=?1", [file_id], |r| {
                r.get(0)
            })?;
        if size != 0 {
            return Err(SyncError::Protocol("attachment size changed".into()));
        }
        tx.commit()?;
        Ok(())
    }

    pub fn pending_count(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM chunks WHERE uploaded=0", [], |r| {
                r.get(0)
            })?)
    }

    /// Upload at most one chunk. The caller controls cancellation and round
    /// budgets between chunks. False means no pending work.
    pub fn upload_next(&mut self, transport: &AttachmentTransport) -> Result<bool> {
        let pending: Option<(ChunkContext, SealedChunk)> = self
            .conn
            .query_row(
                "SELECT c.file_id,c.ordinal,f.total_size,c.blob_id,substr(c.ciphertext,1,?1)
             FROM chunks c JOIN files f ON f.id=c.file_id
             WHERE c.uploaded=0 ORDER BY c.file_id,c.ordinal LIMIT 1",
                [(MAX_SEALED_CHUNK_BYTES + 1) as i64],
                |r| {
                    Ok((
                        ChunkContext {
                            attachment_id: r.get(0)?,
                            index: r.get(1)?,
                            total_size: u64::from(r.get::<_, u32>(2)?),
                        },
                        SealedChunk {
                            id: r.get(3)?,
                            ciphertext: r.get(4)?,
                        },
                    ))
                },
            )
            .optional()?;
        let Some((context, chunk)) = pending else {
            return Ok(false);
        };
        // Authenticate staged disk bytes before sending. Never ack corruption.
        chunk.decrypt(&self.key, &context)?;
        transport.upload(&chunk)?;
        self.conn
            .execute("UPDATE chunks SET uploaded=1 WHERE blob_id=?1", [&chunk.id])?;
        Ok(true)
    }

    /// A manifest can use these IDs only once every expected chunk is staged
    /// and acknowledged. Sparse or partially uploaded files return None.
    pub fn uploaded_ids(&self, file_id: &str) -> Result<Option<Vec<String>>> {
        crate::attachment::validate_blob_id(file_id)?;
        let size: Option<u32> = self
            .conn
            .query_row("SELECT total_size FROM files WHERE id=?1", [file_id], |r| {
                r.get(0)
            })
            .optional()?;
        let Some(size) = size else {
            return Ok(None);
        };
        let count = u64::from(size).div_ceil(crate::attachment::ATTACHMENT_CHUNK_BYTES as u64);
        if count > 4096 {
            return Err(SyncError::Protocol("invalid queued attachment size".into()));
        }
        let mut statement = self.conn.prepare(
            "SELECT ordinal,blob_id,uploaded FROM chunks WHERE file_id=?1 ORDER BY ordinal LIMIT 4097")?;
        let mut rows = statement.query([file_id])?;
        let mut ids = Vec::new();
        while let Some(row) = rows.next()? {
            let index = u64::from(row.get::<_, u32>(0)?);
            let id: String = row.get(1)?;
            let uploaded: i64 = row.get(2)?;
            if index != ids.len() as u64 || uploaded != 1 {
                return Ok(None);
            }
            crate::attachment::validate_blob_id(&id)?;
            ids.push(id);
        }
        Ok((ids.len() as u64 == count).then_some(ids))
    }
}
