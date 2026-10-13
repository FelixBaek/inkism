//! SQLite store that mirrors the Go relay's bbolt layout one to one: every
//! bucket is a set of byte keys and byte values (ordered by memcmp, like bbolt)
//! plus the bucket's sequence counter. Values are kept byte for byte, so
//! cursors, page caps and stored JSON match the Go relay exactly.
use fs2::FileExt;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const RECORDS: &str = "records";
pub const IDENTITIES: &str = "identities";
pub const BLOBS: &str = "blobs";
pub const PUBLICATIONS: &str = "public-note-snapshots";
pub const SHARES: &str = "publication-shares";
pub const SETTINGS: &str = "relay-settings";
pub const RECOVERY: &str = "owner-recovery-v1";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS buckets(name TEXT PRIMARY KEY, sequence INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS entries(
  bucket TEXT NOT NULL,
  key BLOB NOT NULL,
  value BLOB NOT NULL,
  PRIMARY KEY(bucket, key)
) WITHOUT ROWID;";

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Pairs = Vec<(Vec<u8>, Vec<u8>)>;

pub struct Store {
    conn: Connection,
    // Held for the process lifetime: like bbolt's flock, a second relay or the
    // offline key registration fails instead of sharing the database.
    _lock: File,
}

impl Store {
    pub fn open(path: &Path) -> Result<Store, Error> {
        // Create the database owner-only before SQLite touches it, but hold the
        // exclusive lock on a sidecar file: Windows locks are mandatory, so
        // locking the database itself makes SQLite's own reads fail (disk I/O error).
        OpenOptions::new().read(true).write(true).create(true).mode_0600().open(path)?;
        let mut lock_path = path.as_os_str().to_owned();
        lock_path.push(".lock");
        let lock = OpenOptions::new().read(true).write(true).create(true).mode_0600().open(PathBuf::from(lock_path))?;
        let started = Instant::now();
        while lock.try_lock_exclusive().is_err() {
            if started.elapsed() >= Duration::from_secs(1) {
                return Err("timeout".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;")?;
        conn.execute_batch(SCHEMA)?;
        let store = Store { conn, _lock: lock };
        for b in [RECORDS, IDENTITIES, BLOBS, PUBLICATIONS, SHARES, SETTINGS] {
            store.conn.execute("INSERT OR IGNORE INTO buckets(name) VALUES (?1)", [b])?;
        }
        Ok(store)
    }

    /// Runs f in one write transaction; an error rolls everything back.
    pub fn update<T>(&mut self, f: impl FnOnce(&Transaction) -> Result<T, Error>) -> Result<T, Error> {
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    pub fn view<T>(&mut self, f: impl FnOnce(&Transaction) -> Result<T, Error>) -> Result<T, Error> {
        let tx = self.conn.transaction()?;
        f(&tx)
    }

    /// Loads a JSON-lines dump written by desktop/cmd/relay-export into this
    /// (empty) database and checks it against the dump's trailer.
    pub fn import_bolt_dump(&mut self, dump: &Path) -> Result<(usize, usize), Error> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let lines = BufReader::new(File::open(dump)?).lines();
        self.update(|tx| {
            let existing: i64 = tx.query_row("SELECT count(*) FROM entries", [], |r| r.get(0))?;
            if existing != 0 {
                return Err("target database is not empty".into());
            }
            let (mut buckets, mut entries, mut end) = (0usize, 0usize, None);
            for line in lines {
                let line = line?;
                if end.is_some() {
                    return Err("data after the end marker".into());
                }
                let v: serde_json::Value = serde_json::from_str(&line)?;
                let field = |name: &str| -> Result<Vec<u8>, Error> {
                    Ok(STANDARD.decode(v[name].as_str().ok_or(format!("missing {name}"))?)?)
                };
                match v["type"].as_str() {
                    Some("bucket") => {
                        let name = String::from_utf8(field("name")?)?;
                        let seq = v["sequence"].as_u64().ok_or("missing sequence")?;
                        tx.execute(
                            "INSERT INTO buckets(name, sequence) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET sequence = excluded.sequence",
                            params![name, seq as i64],
                        )?;
                        buckets += 1;
                    }
                    Some("entry") => {
                        let bucket = String::from_utf8(field("bucket")?)?;
                        tx.execute(
                            "INSERT INTO entries(bucket, key, value) VALUES (?1, ?2, ?3)",
                            params![bucket, field("key")?, field("value")?],
                        )?;
                        entries += 1;
                    }
                    Some("end") => end = Some((v["buckets"].as_u64(), v["entries"].as_u64())),
                    _ => return Err(format!("unknown dump line: {line}").into()),
                }
            }
            if end != Some((Some(buckets as u64), Some(entries as u64))) {
                return Err("dump is truncated or its counts do not match".into());
            }
            // NextSequence must never hand out a seq that already has a record.
            let seq = sequence(tx, RECORDS)?;
            let last: Option<Vec<u8>> = tx
                .query_row("SELECT max(key) FROM entries WHERE bucket = ?1", [RECORDS], |r| r.get(0))
                .optional()?
                .flatten();
            if last.is_some_and(|k| k.len() == 8 && u64::from_be_bytes(k.try_into().unwrap()) > seq) {
                return Err("records sequence is behind the stored records".into());
            }
            Ok((buckets, entries))
        })
    }
}

trait Mode0600 {
    fn mode_0600(&mut self) -> &mut Self;
}
impl Mode0600 for OpenOptions {
    #[cfg(unix)]
    fn mode_0600(&mut self) -> &mut Self {
        std::os::unix::fs::OpenOptionsExt::mode(self, 0o600)
    }
    #[cfg(not(unix))]
    fn mode_0600(&mut self) -> &mut Self {
        self
    }
}

pub fn get(tx: &Transaction, bucket: &str, key: &[u8]) -> Result<Option<Vec<u8>>, Error> {
    Ok(tx
        .query_row("SELECT value FROM entries WHERE bucket = ?1 AND key = ?2", params![bucket, key], |r| r.get(0))
        .optional()?)
}

pub fn put(tx: &Transaction, bucket: &str, key: &[u8], value: &[u8]) -> Result<(), Error> {
    tx.execute("INSERT OR IGNORE INTO buckets(name) VALUES (?1)", [bucket])?;
    tx.execute(
        "INSERT INTO entries(bucket, key, value) VALUES (?1, ?2, ?3) ON CONFLICT(bucket, key) DO UPDATE SET value = excluded.value",
        params![bucket, key, value],
    )?;
    Ok(())
}

pub fn delete(tx: &Transaction, bucket: &str, key: &[u8]) -> Result<(), Error> {
    tx.execute("DELETE FROM entries WHERE bucket = ?1 AND key = ?2", params![bucket, key])?;
    Ok(())
}

/// All (key, value) pairs of a bucket from `from` on, in bbolt key order.
pub fn scan(tx: &Transaction, bucket: &str, from: &[u8], limit: usize) -> Result<Pairs, Error> {
    let mut q = tx.prepare_cached("SELECT key, value FROM entries WHERE bucket = ?1 AND key >= ?2 ORDER BY key LIMIT ?3")?;
    let rows = q.query_map(params![bucket, from, limit.min(i64::MAX as usize) as i64], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn sequence(tx: &Transaction, bucket: &str) -> Result<u64, Error> {
    let seq: Option<i64> =
        tx.query_row("SELECT sequence FROM buckets WHERE name = ?1", [bucket], |r| r.get(0)).optional()?;
    Ok(seq.unwrap_or(0) as u64)
}

/// bbolt Bucket.NextSequence.
pub fn next_sequence(tx: &Transaction, bucket: &str) -> Result<u64, Error> {
    let next = sequence(tx, bucket)?.checked_add(1).ok_or("sequence overflow")?;
    tx.execute(
        "INSERT INTO buckets(name, sequence) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET sequence = excluded.sequence",
        params![bucket, next as i64],
    )?;
    Ok(next)
}
