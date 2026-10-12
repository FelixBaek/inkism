//! Durable local sync state.
//!
//! This is a *separate* SQLite database from the host note database. Keeping it
//! separate means sync bookkeeping never contends with note reads/writes and
//! can be reasoned about independently. The trade-off is that a host write and
//! a sync-state write cannot share one physical transaction; the engine buys
//! crash safety with *idempotent, replayable* operations instead (see
//! `.private/docs/sync-integration.md`).
//!
//! Tables:
//! * `meta`          - device id, cursors, journal checkpoint.
//! * `outbox`        - durable queue of locally authored changes awaiting push.
//! * `incoming`      - durable queue of pulled changes awaiting host apply+ack.
//! * `entities`      - latest known clock + data snapshot per entity, so
//!   conflict detection is O(1) instead of a vault scan.
//! * `local_events`  - event ids we authored (remote echo suppression).
//! * `applied_events`- event ids we already delivered to the host (dedup).

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{Result, SyncError};
use crate::record::ChangePayload;
use crate::vclock::VClock;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
    event_id        TEXT PRIMARY KEY,
    entity_kind     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    source_revision INTEGER NOT NULL,
    state           TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    payload         BLOB NOT NULL,
    UNIQUE(entity_id, source_revision)
);
CREATE TABLE IF NOT EXISTS incoming (
    event_id    TEXT PRIMARY KEY,
    seq         INTEGER NOT NULL,
    state       TEXT NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    payload     BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
    entity_kind TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    vclock      TEXT NOT NULL,
    device_id   TEXT NOT NULL,
    counter     INTEGER NOT NULL,
    ts          INTEGER NOT NULL,
    deleted     INTEGER NOT NULL,
    data        TEXT NOT NULL,
    PRIMARY KEY(entity_kind, entity_id)
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(state, created_at, event_id);
CREATE INDEX IF NOT EXISTS incoming_pending ON incoming(state, seq, event_id);
CREATE TABLE IF NOT EXISTS local_events (
    event_id   TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS applied_events (
    event_id   TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
"#;

/// Latest known state of one entity, as tracked by the sync engine.
#[derive(Clone, Debug)]
pub struct Snapshot {
    /// Merged vector clock.
    pub vclock: VClock,
    /// Device that authored the winning (current) change.
    pub device_id: String,
    /// That device's counter for this entity.
    pub counter: u64,
    /// That change's wall clock.
    pub ts: u64,
    /// Tombstone flag of the current version.
    pub deleted: bool,
    /// Current data payload.
    pub data: String,
}

/// A queued outbox row.
pub struct OutboxRow {
    /// Idempotency id sent to the relay.
    pub event_id: String,
    /// Sealed ciphertext.
    pub payload: Vec<u8>,
}

/// A queued incoming row.
pub struct IncomingRow {
    /// Relay event id.
    pub event_id: String,
    /// Relay sequence.
    pub seq: u64,
    /// Decrypted payload.
    pub payload: ChangePayload,
}

/// Position of a pending record in relay order, without decoding its payload.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IncomingCursor {
    pub seq: u64,
    pub event_id: String,
}

/// Owns the sync-state SQLite connection.
pub struct Store {
    conn: Connection,
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn encode_clock(clock: &VClock) -> String {
    serde_json::to_string(clock).unwrap_or_else(|_| "{}".to_string())
}

fn decode_clock(raw: &str) -> VClock {
    serde_json::from_str(raw).unwrap_or_else(|_| BTreeMap::new())
}

impl Store {
    /// Open (creating if needed) the sync-state database.
    pub(crate) fn open_with_key(
        path: &std::path::Path,
        key: Option<&crate::StorageKey>,
    ) -> Result<Self> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|err| {
                    SyncError::Database(format!("cannot create state dir: {err}"))
                })?;
            }
        }
        let conn =
            inkism_storage::open(path, key).map_err(|e| SyncError::Database(e.to_string()))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    // ---- meta -----------------------------------------------------------

    /// Read a meta value.
    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?)
    }

    /// Write a meta value.
    pub fn set_meta(&mut self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Cursor of the highest relay sequence fetched into `incoming`.
    pub fn pull_cursor(&self) -> Result<u64> {
        Ok(self
            .meta("pull_cursor")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    /// Cursor of the highest relay sequence acknowledged by the host.
    pub fn ack_cursor(&self) -> Result<u64> {
        Ok(self
            .meta("ack_cursor")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    /// Highest host journal revision already staged into the outbox.
    pub fn journal_checkpoint(&self) -> Result<u64> {
        Ok(self
            .meta("journal_checkpoint")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    /// Persist the host journal checkpoint.
    pub fn set_journal_checkpoint(&mut self, value: u64) -> Result<()> {
        self.set_meta("journal_checkpoint", &value.to_string())
    }

    // ---- entities snapshot ---------------------------------------------

    /// Read the latest known snapshot for an entity.
    pub fn snapshot(&self, kind: &str, id: &str) -> Result<Option<Snapshot>> {
        Ok(self
            .conn
            .query_row(
                "SELECT vclock, device_id, counter, ts, deleted, data FROM entities
                 WHERE entity_kind = ?1 AND entity_id = ?2",
                params![kind, id],
                |row| {
                    let clock: String = row.get(0)?;
                    Ok(Snapshot {
                        vclock: decode_clock(&clock),
                        device_id: row.get(1)?,
                        counter: row.get::<_, i64>(2)? as u64,
                        ts: row.get::<_, i64>(3)? as u64,
                        deleted: row.get::<_, i64>(4)? != 0,
                        data: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    // ---- outbox ---------------------------------------------------------

    /// Find the event id already staged for a host revision (idempotence key).
    pub fn outbox_event_for_revision(
        &self,
        entity_id: &str,
        source_revision: u64,
    ) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT event_id FROM outbox WHERE entity_id = ?1 AND source_revision = ?2",
                params![entity_id, source_revision as i64],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// Insert an outbox row plus its local-event marker and entity snapshot.
    ///
    /// All of it happens in one transaction so a crash cannot leave a
    /// half-staged change.
    pub fn stage_outbox(
        &mut self,
        event_id: &str,
        kind: &str,
        entity_id: &str,
        source_revision: u64,
        payload: &[u8],
        snap: &Snapshot,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO outbox(event_id, entity_kind, entity_id, source_revision, state, created_at, payload)
             VALUES(?1, ?2, ?3, ?4, 'pending', ?5, ?6)",
            params![event_id, kind, entity_id, source_revision as i64, now_ms(), payload],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO local_events(event_id, created_at) VALUES(?1, ?2)",
            params![event_id, now_ms()],
        )?;
        tx.execute(
            "INSERT INTO entities(entity_kind, entity_id, vclock, device_id, counter, ts, deleted, data)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
                vclock = excluded.vclock, device_id = excluded.device_id,
                counter = excluded.counter, ts = excluded.ts,
                deleted = excluded.deleted, data = excluded.data",
            params![
                kind,
                entity_id,
                encode_clock(&snap.vclock),
                snap.device_id,
                snap.counter as i64,
                snap.ts as i64,
                snap.deleted as i64,
                snap.data,
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Re-evaluate retained unsent rows when a device changes its scope.
    pub fn filter_outbox(&self, allow: impl Fn(&str, &str, &str, bool) -> bool) -> Result<()> {
        let mut stmt = self.conn.prepare("SELECT o.event_id,o.entity_kind,o.entity_id,e.data,e.deleted FROM outbox o JOIN entities e ON e.entity_kind=o.entity_kind AND e.entity_id=o.entity_id WHERE o.state IN ('pending','held')")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,bool>(4)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
        for (event,kind,id,data,deleted) in rows { self.conn.execute("UPDATE outbox SET state=?1 WHERE event_id=?2",params![if allow(&kind,&id,&data,deleted) {"pending"} else {"held"},event])?; }
        Ok(())
    }

    /// Pending outbox rows, oldest first.
    pub fn pending_outbox(&self) -> Result<Vec<OutboxRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT event_id, payload FROM outbox WHERE state = 'pending' ORDER BY created_at, source_revision, event_id LIMIT 1",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OutboxRow {
                event_id: row.get(0)?,
                payload: row.get(1)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Number of outbox rows not yet delivered.
    pub fn pending_incoming_count(&self) -> Result<usize> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM incoming WHERE state='pending'",
            [],
            |r| r.get::<_, i64>(0),
        )? as usize)
    }

    pub fn pending_outbox_count(&self) -> Result<usize> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM outbox WHERE state = 'pending'",
            [],
            |row| row.get::<_, i64>(0),
        )? as usize)
    }

    /// Mark an outbox row delivered. Idempotent.
    pub fn mark_outbox_sent(&mut self, event_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE outbox SET state = 'sent', payload = x'' WHERE event_id = ?1",
            params![event_id],
        )?;
        Ok(())
    }

    /// Record a failed delivery attempt.
    pub fn mark_outbox_attempt(&mut self, event_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE outbox SET attempts = attempts + 1 WHERE event_id = ?1",
            params![event_id],
        )?;
        Ok(())
    }

    /// True when we authored this event id (used to drop our own echo).
    pub fn is_local_event(&self, event_id: &str) -> Result<bool> {
        let found: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM local_events WHERE event_id = ?1",
                params![event_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }

    // ---- incoming -------------------------------------------------------

    /// Read only a queue key so corrupt payloads cannot hide subsequent rows.
    /// The cursor belongs to one traversal; failed rows remain pending and are
    /// visited again when the next traversal starts without a cursor.
    pub fn next_pending_incoming(
        &self,
        after: Option<&IncomingCursor>,
    ) -> Result<Option<IncomingCursor>> {
        let (seq, id) = after.map_or((-1, ""), |key| (key.seq as i64, key.event_id.as_str()));
        Ok(self
            .conn
            .query_row(
                "SELECT seq, event_id FROM incoming
             WHERE state = 'pending' AND (seq, event_id) > (?1, ?2)
             ORDER BY seq, event_id LIMIT 1",
                params![seq, id],
                |row| {
                    Ok(IncomingCursor {
                        seq: row.get::<_, i64>(0)? as u64,
                        event_id: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }

    /// True when this event was already delivered to the host.
    pub fn is_applied_event(&self, event_id: &str) -> Result<bool> {
        let found: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM applied_events WHERE event_id = ?1",
                params![event_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }

    /// Pending incoming rows in relay order.
    pub fn pending_incoming(&self, limit: usize) -> Result<Vec<IncomingRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT event_id, seq, payload FROM incoming WHERE state = 'pending' ORDER BY seq, event_id LIMIT ?1")?;
        let rows = stmt.query_map([limit.clamp(1, 50) as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)? as u64,
                row.get::<_, Vec<u8>>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (event_id, seq, payload_bytes) = row?;
            let payload = ChangePayload::decode(&payload_bytes)?;
            out.push(IncomingRow {
                event_id,
                seq,
                payload,
            });
        }
        Ok(out)
    }

    /// Mark an incoming event applied and record its snapshot/ack cursor.
    ///
    /// The whole thing is one transaction so a crash after the host applied but
    /// before ack simply replays cleanly.
    pub fn ack_incoming(
        &mut self,
        event_id: &str,
        seq: u64,
        kind: &str,
        entity_id: &str,
        snap: &Snapshot,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE incoming SET state = 'applied', payload = x'' WHERE event_id = ?1",
            params![event_id],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO applied_events(event_id, applied_at) VALUES(?1, ?2)",
            params![event_id, now_ms()],
        )?;
        tx.execute(
            "INSERT INTO entities(entity_kind, entity_id, vclock, device_id, counter, ts, deleted, data)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
                vclock = excluded.vclock, device_id = excluded.device_id,
                counter = excluded.counter, ts = excluded.ts,
                deleted = excluded.deleted, data = excluded.data",
            params![
                kind,
                entity_id,
                encode_clock(&snap.vclock),
                snap.device_id,
                snap.counter as i64,
                snap.ts as i64,
                snap.deleted as i64,
                snap.data,
            ],
        )?;
        // Ack cursor only moves to a sequence we actually consumed.
        let current: i64 = tx.query_row(
            "SELECT COALESCE(MAX(CAST(value AS INTEGER)), 0) FROM meta WHERE key = 'ack_cursor'",
            [],
            |row| row.get(0),
        )?;
        if (seq as i64) > current {
            tx.execute(
                "INSERT INTO meta(key, value) VALUES('ack_cursor', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![seq.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Fetch a single incoming row (used by `ack_applied`).
    pub fn get_incoming(&self, event_id: &str) -> Result<Option<IncomingRow>> {
        let row = self
            .conn
            .query_row(
                "SELECT event_id, seq, payload FROM incoming WHERE event_id = ?1 AND state = 'pending'",
                params![event_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? as u64,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                },
            )
            .optional()?;
        match row {
            None => Ok(None),
            Some((event_id, seq, bytes)) => Ok(Some(IncomingRow {
                event_id,
                seq,
                payload: ChangePayload::decode(&bytes)?,
            })),
        }
    }

    /// Persist a whole decrypted pull page and advance the pull cursor in one
    /// transaction.
    ///
    /// Either the entire page (including the cursor bump) is durable, or none
    /// of it is. Duplicate event ids are ignored, which makes re-pulling after
    /// a crash harmless. Returns how many rows were newly stored.
    pub fn commit_pull_page(
        &mut self,
        records: &[(String, u64, Vec<u8>)],
        cursor: u64,
    ) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let mut stored = 0;
        for (event_id, seq, payload) in records {
            let changed = tx.execute(
                "INSERT OR IGNORE INTO incoming(event_id, seq, state, created_at, payload)
                 VALUES(?1, ?2, 'pending', ?3, ?4)",
                params![event_id, *seq as i64, now_ms(), payload],
            )?;
            if changed > 0 {
                stored += 1;
            }
        }
        let current: i64 = tx.query_row(
            "SELECT COALESCE(MAX(CAST(value AS INTEGER)), 0) FROM meta WHERE key = 'pull_cursor'",
            [],
            |row| row.get(0),
        )?;
        if (cursor as i64) > current {
            tx.execute(
                "INSERT INTO meta(key, value) VALUES('pull_cursor', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![cursor.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(stored)
    }
}

#[cfg(test)]
mod incoming_cursor_tests {
    use super::*;

    #[test]
    fn excluded_outbox_is_retained_and_reactivated() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_with_key(&dir.path().join("state.db"), None).unwrap();
        store.conn.execute("INSERT INTO entities VALUES('note','n','{}','d',1,0,0,'{}')", []).unwrap();
        store.conn.execute("INSERT INTO outbox(event_id,entity_kind,entity_id,source_revision,created_at,payload) VALUES('e','note','n',1,0,x'01')", []).unwrap();
        assert_eq!(store.pending_outbox_count().unwrap(),1);
        store.filter_outbox(|_,_,_,_|false).unwrap();
        assert_eq!(store.pending_outbox_count().unwrap(),0);
        assert!(store.pending_outbox().unwrap().is_empty());
        store.filter_outbox(|_,_,_,_|true).unwrap();
        assert_eq!(store.pending_outbox_count().unwrap(),1);
        assert_eq!(store.pending_outbox().unwrap()[0].payload,vec![1]);
    }

    #[test]
    fn cursor_visits_equal_sequences_and_corrupt_bodies_without_consuming_them() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_with_key(&dir.path().join("state.db"), None).unwrap();
        for (seq, id) in [(1, "c"), (0, "b"), (0, "a")] {
            store.conn.execute(
                "INSERT INTO incoming(event_id, seq, created_at, payload) VALUES(?1, ?2, 0, ?3)",
                params![id, seq, b"{broken JSON".as_slice()],
            ).unwrap();
        }
        assert!(store.pending_incoming(1).is_err());
        let mut cursor = None;
        let mut visited = Vec::new();
        while let Some(key) = store.next_pending_incoming(cursor.as_ref()).unwrap() {
            visited.push((key.seq, key.event_id.clone()));
            cursor = Some(key);
        }
        assert_eq!(
            visited,
            vec![(0, "a".into()), (0, "b".into()), (1, "c".into())]
        );
        assert_eq!(store.pending_incoming_count().unwrap(), 3);
        assert_eq!(
            store.next_pending_incoming(None).unwrap().unwrap().event_id,
            "a"
        );
        let bytes: Vec<u8> = store
            .conn
            .query_row("SELECT payload FROM incoming LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(bytes, b"{broken JSON");
    }
}
