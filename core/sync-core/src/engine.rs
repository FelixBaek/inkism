//! The public sync engine.
//!
//! # Crash-consistency model
//!
//! The engine keeps its own SQLite state database, separate from the host's
//! note database. Because two SQLite files cannot share a transaction, sync
//! safety comes from *durable, replayable, idempotent* steps rather than one
//! physical transaction:
//!
//! * Local edits: the host commits its note change **and** a row in its own
//!   monotonic change journal, then calls [`SyncEngine::stage_local`] (or lets
//!   [`SyncEngine::observe_local`] drain the journal). Both files now hold a
//!   record of the change; a crash in between is recovered by re-running the
//!   observation from [`SyncEngine::journal_checkpoint`]. `source_revision` is
//!   the idempotence key, so re-staging never duplicates.
//! * Outbox: ciphertext is sealed once and stored *before* any network call, so
//!   a crash during push (or a timeout whose response was lost) can be retried
//!   with the same event id. The relay deduplicates by id.
//! * Incoming: a pulled page is decrypted and stored in one local transaction
//!   together with the pull cursor bump. The host then applies changes
//!   idempotently (keyed by event id) inside *its* transaction and finally
//!   calls [`SyncEngine::ack_applied`]. A crash between apply and ack replays
//!   the pending queue; because the host apply is keyed by event id, replay is
//!   a no-op. A crash during the network write of a push simply leaves the row
//!   pending.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use crate::client::RelayClient;
use crate::crypto::{self, Key};
use crate::entity::{Entity, EntityKind};
use crate::error::{Result, SyncError};
use crate::record::{ChangePayload, PAYLOAD_VERSION};
use crate::store::{IncomingCursor, Snapshot, Store};
use crate::vclock::{self, VClock};

/// Configuration for [`SyncEngine::open`].
pub struct SyncConfig {
    /// Path to the sync-state SQLite database (created if missing). This is a
    /// *separate* file from the host note database.
    pub state_db_path: PathBuf,
    /// Relay base URL, for example `https://relay.example`. Plaintext is only
    /// allowed for loopback hosts.
    pub server_url: String,
    /// Bearer token shared by every device of the same private vault.
    pub token: String,
    /// 32-byte vault key. Never derived from the bearer token.
    pub key: Key,
    /// Stable device id. If `None`, one is generated and persisted in the
    /// state database on first open.
    pub device_id: Option<String>,
    /// Page size passed to the relay (server caps this at 100).
    pub page_limit: u32,
}

impl SyncConfig {
    /// Build a config with the default page size (50).
    pub fn new(
        state_db_path: impl Into<PathBuf>,
        server_url: impl Into<String>,
        token: impl Into<String>,
        key: Key,
    ) -> Self {
        SyncConfig {
            state_db_path: state_db_path.into(),
            server_url: server_url.into(),
            token: token.into(),
            key,
            device_id: None,
            page_limit: 50,
        }
    }

    /// Override the device id (used by tests and multi-instance hosts).
    pub fn with_device_id(mut self, device_id: impl Into<String>) -> Self {
        self.device_id = Some(device_id.into());
        self
    }

    /// Override the pull page size.
    pub fn with_page_limit(mut self, page_limit: u32) -> Self {
        self.page_limit = page_limit.clamp(1, 100);
        self
    }
}

/// Result of staging one local change.
#[derive(Clone, Debug)]
pub struct StageOutcome {
    /// Event id assigned to the change (stable across retries).
    pub event_id: String,
    /// False when the same `(entity, source_revision)` was already staged.
    pub newly_staged: bool,
}

/// Result of a push.
#[derive(Clone, Debug)]
pub struct PushOutcome {
    /// Records delivered in this call.
    pub sent: usize,
    /// Records still pending.
    pub remaining: usize,
}

/// Result of a pull.
#[derive(Clone, Debug)]
pub struct PullOutcome {
    /// Remote records examined.
    pub fetched: usize,
    /// New records durably queued for the host.
    pub stored: usize,
    /// Our own echoes / already-handled records that were skipped.
    pub skipped: usize,
}

/// A change that the host must apply (or skip) and then acknowledge.
#[derive(Clone, Debug)]
pub struct Incoming {
    /// Relay event id; the host applies idempotently keyed by this.
    pub event_id: String,
    /// Relay sequence.
    pub seq: u64,
    /// The canonical version after resolution. Applying this is always safe:
    /// if the local version won the conflict it equals the local version.
    pub entity: Entity,
    /// Present when the change was concurrent with a local edit. Both sides are
    /// exposed so nothing is lost.
    pub conflict: Option<Conflict>,
    /// True when we already knew this version (re-delivery). Host may skip it
    /// but must still acknowledge the event id.
    pub stale: bool,
}

/// Describes a concurrent edit and the deterministic conflict copy to create.
#[derive(Clone, Debug)]
pub struct Conflict {
    /// Deterministic id for the conflict copy. Every peer that observes the
    /// same conflict computes the same id, so copies converge instead of
    /// multiplying.
    pub copy_id: String,
    /// The version that won the deterministic ordering.
    pub winner: Entity,
    /// The version that lost; never discarded.
    pub loser: Entity,
    /// `loser` with its id replaced by [`Conflict::copy_id`]; insert as-is.
    pub copy: Entity,
}

/// Aggregated result of [`SyncEngine::sync_once`].
#[derive(Clone, Debug)]
pub struct SyncOutcome {
    /// Changes delivered to the relay.
    pub pushed: usize,
    /// Incoming changes ready for the host (already durable).
    pub incoming: Vec<Incoming>,
    /// Number of `incoming` entries that carry a conflict copy.
    pub conflicts: usize,
    /// Set when the push leg failed (for example offline). Rows stay pending.
    pub push_error: Option<String>,
    /// Set when the pull leg failed. The pull cursor was not advanced.
    pub pull_error: Option<String>,
}

/// Encrypted, incremental, offline-tolerant sync engine.
///
/// One instance owns one sync-state database and one device identity. Methods
/// take `&self` and serialize access to the state database internally, so a
/// host may share an engine behind a lock or call it from one thread.
pub struct SyncEngine {
    store: Mutex<Store>,
    client: RelayClient,
    key: Key,
    device_id: String,
    page_limit: u32,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl SyncEngine {
    /// Open the engine, creating the state database and device identity if
    /// needed.
    pub fn open(config: SyncConfig) -> Result<Self> {
        Self::open_with_key(config, None)
    }

    /// Local storage key is independent of the shared relay vault key.
    #[cfg(feature = "encrypted-storage")]
    pub fn open_encrypted(config: SyncConfig, storage_key: &crate::StorageKey) -> Result<Self> {
        Self::open_with_key(config, Some(storage_key))
    }

    fn open_with_key(config: SyncConfig, storage_key: Option<&crate::StorageKey>) -> Result<Self> {
        if config.token.trim().is_empty() {
            return Err(SyncError::Config("relay token must not be empty".into()));
        }
        let client = RelayClient::new(&config.server_url, &config.token)?;
        let mut store = Store::open_with_key(&config.state_db_path, storage_key)?;
        let device_id = match (config.device_id, store.meta("device_id")?) {
            (Some(explicit), _) => {
                store.set_meta("device_id", &explicit)?;
                explicit
            }
            (None, Some(existing)) => existing,
            (None, None) => {
                let generated = Uuid::new_v4().to_string();
                store.set_meta("device_id", &generated)?;
                generated
            }
        };
        Ok(SyncEngine {
            store: Mutex::new(store),
            client,
            key: config.key,
            device_id,
            page_limit: config.page_limit.clamp(1, 100),
        })
    }

    /// Device id used in vector clocks.
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// Last host journal revision already staged into the outbox.
    pub fn journal_checkpoint(&self) -> Result<u64> {
        self.store().journal_checkpoint()
    }

    /// Highest relay sequence fetched into the durable incoming queue.
    pub fn pull_cursor(&self) -> Result<u64> {
        self.store().pull_cursor()
    }

    /// Highest relay sequence the host has acknowledged.
    pub fn ack_cursor(&self) -> Result<u64> {
        self.store().ack_cursor()
    }

    /// Number of locally authored changes not yet delivered to the relay.
    pub fn pending_incoming_count(&self) -> Result<usize> {
        self.store().pending_incoming_count()
    }

    pub fn pending_outbox_count(&self) -> Result<usize> {
        self.store().pending_outbox_count()
    }

    /// Whether this replica already holds a sync snapshot (sent or applied)
    /// of the entity. Hosts use it to stage entities skipped while excluded.
    pub fn has_snapshot(&self, kind: EntityKind, id: &str) -> Result<bool> {
        Ok(self.store().snapshot(kind.as_str(), id)?.is_some())
    }

    /// Hold excluded unsent changes without losing them on scope expansion.
    pub fn filter_outbox(&self, allow: impl Fn(&str, &str, &str, bool) -> bool) -> Result<()> {
        self.store().filter_outbox(allow)
    }

    fn store(&self) -> std::sync::MutexGuard<'_, Store> {
        self.store.lock().expect("sync state mutex poisoned")
    }

    /// Stage a local change for eventual delivery.
    ///
    /// `source_revision` is the host's monotonic change-journal sequence and
    /// doubles as the idempotence key: calling this twice with the same
    /// `(entity.id, source_revision)` returns the original event id and does
    /// nothing else. The payload is encrypted and persisted before returning,
    /// so the change survives a crash or restart.
    pub fn stage_local(&self, entity: Entity, source_revision: u64) -> Result<StageOutcome> {
        if entity.id.trim().is_empty() {
            return Err(SyncError::Config("entity id must not be empty".into()));
        }
        let kind = entity.kind.as_str().to_string();
        let mut store = self.store();

        if let Some(existing) = store.outbox_event_for_revision(&entity.id, source_revision)? {
            let checkpoint = store.journal_checkpoint()?;
            store.set_journal_checkpoint(source_revision.max(checkpoint))?;
            return Ok(StageOutcome {
                event_id: existing,
                newly_staged: false,
            });
        }

        let mut clock: VClock = store
            .snapshot(&kind, &entity.id)?
            .map(|snapshot| snapshot.vclock)
            .unwrap_or_default();
        let counter = clock.get(&self.device_id).copied().unwrap_or(0) + 1;
        clock.insert(self.device_id.clone(), counter);
        let ts = now_ms();
        let payload = ChangePayload {
            version: PAYLOAD_VERSION,
            entity: entity.clone(),
            device_id: self.device_id.clone(),
            counter,
            ts,
            vclock: clock.clone(),
        };
        let event_id = Uuid::new_v4().to_string();
        let sealed = crypto::seal(&self.key, &event_id, &payload.encode()?)?;

        let snapshot = Snapshot {
            vclock: clock,
            device_id: self.device_id.clone(),
            counter,
            ts,
            deleted: entity.deleted,
            data: serde_json::to_string(&entity.data)?,
        };
        store.stage_outbox(
            &event_id,
            &kind,
            &entity.id,
            source_revision,
            &sealed,
            &snapshot,
        )?;
        let checkpoint = store.journal_checkpoint()?;
        store.set_journal_checkpoint(source_revision.max(checkpoint))?;
        Ok(StageOutcome {
            event_id,
            newly_staged: true,
        })
    }

    /// Drain the host's durable change journal.
    ///
    /// `fetch` is called once with the current [`SyncEngine::journal_checkpoint`]
    /// and must return `(source_revision, entity)` rows with a revision greater
    /// than that checkpoint, in ascending order. The host typically implements
    /// it as a `SELECT ... WHERE seq > ?1 ORDER BY seq` against its own journal
    /// table. This observes real committed changes and never relies on a
    /// volatile in-memory hook. Returns the number of newly staged changes.
    pub fn observe_local<F>(&self, fetch: F) -> Result<usize>
    where
        F: FnOnce(u64) -> Result<Vec<(u64, Entity)>>,
    {
        let checkpoint = self.journal_checkpoint()?;
        let rows = fetch(checkpoint)?;
        let mut staged = 0;
        for (revision, entity) in rows {
            if revision <= checkpoint {
                continue;
            }
            if self.stage_local(entity, revision)?.newly_staged {
                staged += 1;
            }
        }
        Ok(staged)
    }

    /// Deliver all pending outbox rows to the relay.
    ///
    /// Retry-safe: a row is only marked sent after a `2xx` response, and the
    /// relay deduplicates by the stable event id.
    pub fn push(&self) -> Result<PushOutcome> {
        let mut sent = 0;
        loop {
            let Some(row) = self.store().pending_outbox()?.into_iter().next() else {
                break;
            };
            let blob = crypto::encode_blob(&row.payload);
            match self.client.post_change(&row.event_id, &blob) {
                Ok(_) => {
                    self.store().mark_outbox_sent(&row.event_id)?;
                    sent += 1;
                }
                Err(err) => {
                    self.store().mark_outbox_attempt(&row.event_id)?;
                    return Err(err);
                }
            }
        }
        Ok(PushOutcome {
            sent,
            remaining: self.store().pending_outbox_count()?,
        })
    }

    /// Fetch new remote changes into the durable incoming queue.
    ///
    /// Incremental: only sequences after the stored pull cursor are requested,
    /// so a sync never scans the whole vault. If any record fails to decrypt,
    /// nothing from that page is stored and the cursor does not advance.
    pub fn pull(&self) -> Result<PullOutcome> {
        let mut after = self.pull_cursor()?;
        let mut fetched = 0usize;
        let mut stored = 0usize;
        let mut skipped = 0usize;
        loop {
            let requested_after = after;
            let page = self.client.get_changes(requested_after, self.page_limit)?;
            // The server may return a short page because a byte bound was hit,
            // not because the stream ended, so keep going until an empty page.
            if page.items.is_empty() {
                break;
            }
            fetched += page.items.len();
            let mut prepared: Vec<(String, u64, Vec<u8>)> = Vec::new();
            for record in &page.items {
                let store = self.store();
                let already_known =
                    store.is_local_event(&record.id)? || store.is_applied_event(&record.id)?;
                drop(store);
                if already_known {
                    skipped += 1;
                    continue;
                }
                let blob = crypto::decode_blob(&record.blob)?;
                let plaintext = crypto::open(&self.key, &record.id, &blob)?;
                prepared.push((record.id.clone(), record.seq, plaintext));
            }
            stored += self.store().commit_pull_page(&prepared, page.cursor)?;
            after = page.cursor;
            if after <= requested_after {
                // Defensive: a misbehaving relay must not trap us forever.
                break;
            }
        }
        Ok(PullOutcome {
            fetched,
            stored,
            skipped,
        })
    }

    /// Pending incoming changes resolved against local state.
    ///
    /// Just returns the durable queue; it does not apply anything. Call
    /// [`SyncEngine::ack_applied`] only after the host has applied the changes.
    pub fn pending_incoming(&self) -> Result<Vec<Incoming>> {
        self.pending_incoming_limit(50)
    }

    /// Resolve a bounded batch; hosts use limit 1 and acknowledge each before the next.
    pub fn pending_incoming_limit(&self, limit: usize) -> Result<Vec<Incoming>> {
        let rows = self.store().pending_incoming(limit)?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let inc = row.payload;
            let kind = inc.entity.kind.as_str().to_string();
            let entity_id = inc.entity.id.clone();
            let known = self.store().snapshot(&kind, &entity_id)?;
            out.push(self.resolve(&row.event_id, row.seq, inc, known)?);
        }
        Ok(out)
    }

    /// Find the next pending queue key without parsing the record body.
    /// A failed record must not be acknowledged; a host can continue with this
    /// cursor and retry all failures in its next traversal.
    pub fn next_pending_incoming(
        &self,
        after: Option<&IncomingCursor>,
    ) -> Result<Option<IncomingCursor>> {
        self.store().next_pending_incoming(after)
    }

    /// Re-resolve one still-pending event against the current local snapshot.
    pub fn resolve_pending(&self, event_id: &str) -> Result<Option<Incoming>> {
        let Some(row) = self.store().get_incoming(event_id)? else {
            return Ok(None);
        };
        let known = self
            .store()
            .snapshot(row.payload.entity.kind.as_str(), &row.payload.entity.id)?;
        self.resolve(&row.event_id, row.seq, row.payload, known)
            .map(Some)
    }

    fn resolve(
        &self,
        event_id: &str,
        seq: u64,
        inc: ChangePayload,
        known: Option<Snapshot>,
    ) -> Result<Incoming> {
        let Some(known) = known else {
            return Ok(Incoming {
                event_id: event_id.to_string(),
                seq,
                entity: inc.entity,
                conflict: None,
                stale: false,
            });
        };
        if vclock::dominates(&known.vclock, &inc.vclock) {
            // Re-delivery of a version we already applied.
            return Ok(Incoming {
                event_id: event_id.to_string(),
                seq,
                entity: inc.entity,
                conflict: None,
                stale: true,
            });
        }
        if !vclock::concurrent(&known.vclock, &inc.vclock) {
            // Incoming strictly newer: fast-forward.
            return Ok(Incoming {
                event_id: event_id.to_string(),
                seq,
                entity: inc.entity,
                conflict: None,
                stale: false,
            });
        }
        // Concurrent edits: deterministic winner, loser preserved.
        let local_entity = Entity {
            kind: inc.entity.kind,
            id: inc.entity.id.clone(),
            data: serde_json::from_str(&known.data).unwrap_or(serde_json::Value::Null),
            deleted: known.deleted,
        };
        let local_change = ChangePayload {
            version: PAYLOAD_VERSION,
            entity: local_entity.clone(),
            device_id: known.device_id.clone(),
            counter: known.counter,
            ts: known.ts,
            vclock: known.vclock.clone(),
        };
        let (winner, loser, loser_device, loser_counter) = if inc.wins_over(&local_change) {
            (
                inc.entity.clone(),
                local_entity,
                known.device_id,
                known.counter,
            )
        } else {
            (local_entity, inc.entity, inc.device_id, inc.counter)
        };
        let copy_id = format!("{}~conflict~{}~{}", winner.id, loser_device, loser_counter);
        let mut copy = loser.clone();
        copy.id = copy_id.clone();
        Ok(Incoming {
            event_id: event_id.to_string(),
            seq,
            entity: winner.clone(),
            conflict: Some(Conflict {
                copy_id,
                winner,
                loser,
                copy,
            }),
            stale: false,
        })
    }

    /// Acknowledge that the host has applied (or deliberately skipped) these
    /// event ids.
    ///
    /// Call this inside the same logical step as the host apply, after the host
    /// transaction commits. Idempotent: acknowledging an unknown or repeated id
    /// is a no-op. Merges each change's vector clock into the local snapshot so
    /// future conflicts compare against the right history.
    pub fn ack_applied(&self, event_ids: &[String]) -> Result<usize> {
        let mut acked = 0;
        for event_id in event_ids {
            let Some(row) = self.store().get_incoming(event_id)? else {
                continue;
            };
            if self.store().is_applied_event(event_id)? {
                continue;
            }
            let inc = row.payload;
            let kind = inc.entity.kind.as_str().to_string();
            let entity_id = inc.entity.id.clone();
            let known = self.store().snapshot(&kind, &entity_id)?;
            let snapshot = merge_snapshot(known, &inc);
            self.store()
                .ack_incoming(event_id, row.seq, &kind, &entity_id, &snapshot)?;
            acked += 1;
        }
        Ok(acked)
    }

    /// One full sync round: push, pull, then return the resolved incoming
    /// queue. The host must still apply and [`SyncEngine::ack_applied`].
    ///
    /// Network failures are reported in the returned struct rather than as an
    /// `Err`, so a temporarily offline device can still surface queued work.
    pub fn sync_once(&self) -> Result<SyncOutcome> {
        let mut outcome = SyncOutcome {
            pushed: 0,
            incoming: Vec::new(),
            conflicts: 0,
            push_error: None,
            pull_error: None,
        };
        match self.push() {
            Ok(push) => outcome.pushed = push.sent,
            Err(err) => outcome.push_error = Some(err.to_string()),
        }
        if let Err(err) = self.pull() {
            outcome.pull_error = Some(err.to_string());
        }
        outcome.incoming = self.pending_incoming()?;
        outcome.conflicts = outcome
            .incoming
            .iter()
            .filter(|item| item.conflict.is_some())
            .count();
        Ok(outcome)
    }
}

/// Fold one incoming change into the local snapshot.
fn merge_snapshot(known: Option<Snapshot>, inc: &ChangePayload) -> Snapshot {
    let inc_clock = &inc.vclock;
    let Some(known) = known else {
        return Snapshot {
            vclock: inc_clock.clone(),
            device_id: inc.device_id.clone(),
            counter: inc.counter,
            ts: inc.ts,
            deleted: inc.entity.deleted,
            data: serde_json::to_string(&inc.entity.data).unwrap_or_default(),
        };
    };
    let merged = vclock::merge(&known.vclock, inc_clock);
    let inc_wins = if vclock::dominates(&known.vclock, inc_clock) {
        false
    } else if vclock::dominates(inc_clock, &known.vclock) {
        true
    } else {
        inc.wins_over(&ChangePayload {
            version: PAYLOAD_VERSION,
            entity: inc.entity.clone(),
            device_id: known.device_id.clone(),
            counter: known.counter,
            ts: known.ts,
            vclock: known.vclock.clone(),
        })
    };
    if inc_wins {
        Snapshot {
            vclock: merged,
            device_id: inc.device_id.clone(),
            counter: inc.counter,
            ts: inc.ts,
            deleted: inc.entity.deleted,
            data: serde_json::to_string(&inc.entity.data).unwrap_or_default(),
        }
    } else {
        Snapshot {
            vclock: merged,
            ..known
        }
    }
}
