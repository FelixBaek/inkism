//! Inkism integrated runtime.
//!
//! `AppCore` is the single entry point the desktop shell drives. It owns:
//!
//! * the storage engine (`inkism-engine`) behind one mutex, so all note reads
//!   and writes keep the engine's single-writer discipline;
//! * the durable host change journal (SQLite triggers in the *same* database)
//!   that turns every note/notebook mutation into a monotonic `source_revision`;
//! * a background sync worker (auto every ~15s while configured) that stages
//!   local changes, pushes/pulls ciphertext, and applies remote changes;
//! * the user-private vault configuration persisted beside the database.
//!
//! Protocol operations are forwarded to the engine unchanged except the four
//! runtime-owned ops: `sync_config`, `sync_status`, `sync_now`, `sync_pause`, `sync_keygen`.
//! See `.private/docs/runtime-integration.md` for the full contract.
//!
//! Networking is only ever performed by the worker and *never* while the host
//! engine mutex is held; remote changes are applied by raw validated SQL in a
//! single host transaction that also records the sync event id, so a crash
//! between apply and sync-ack replays as a no-op.

#![forbid(unsafe_code)]

mod attachment_sync;
mod remote_history;
mod config;
mod error;
mod host;
#[cfg(test)]
mod tag_change_journal_tests;
pub mod library_check;
pub mod library_lock;
pub mod local_key;
pub mod local_storage;
pub mod migration;
pub mod recovery_envelope;
mod vault;
use local_storage::LocalStorage;

pub use config::{StoredConfig, SyncScope};
pub use error::{Result, RuntimeError};

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use inkism_engine::Engine as StoreEngine;
use rusqlite::Connection;
use serde_json::{json, Value};
use sync_core::{Key, SyncConfig, SyncEngine};

/// How often the worker syncs on its own while a vault is configured.
pub const AUTO_SYNC_INTERVAL: Duration = Duration::from_secs(15);

fn lock_ok<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_scope(value: Option<&Value>) -> Result<SyncScope> {
    let Some(value) = value else { return Ok(SyncScope::default()); };
    let scope: SyncScope = serde_json::from_value(value.clone())
        .map_err(|_| RuntimeError::config("sync scope must contain notebook_ids and tags arrays"))?;
    if scope.notebook_ids.len() > 256 || scope.tags.len() > 256
        || scope.notebook_ids.iter().any(|id| id.is_empty() || id.len() > 128)
        || scope.tags.iter().any(|tag| tag.is_empty() || tag.len() > 128)
    { return Err(RuntimeError::config("sync scope is too large or contains an empty value")); }
    Ok(scope)
}

fn scope_allows(scope: Option<&SyncScope>, entity: &sync_core::Entity) -> bool {
    let Some(scope) = scope else { return true; };
    if entity.deleted || (scope.notebook_ids.is_empty() && scope.tags.is_empty()) { return true; }
    if entity.kind == sync_core::EntityKind::Setting && (entity.id.starts_with("knowledge_note:") || entity.id.starts_with("knowledge_redirect:")) {
        return entity.data.get("scope_note").is_some_and(|data| scope_allows(Some(scope), &sync_core::Entity::new(sync_core::EntityKind::Note, "scope", data.clone())));
    }
    if entity.kind == sync_core::EntityKind::NamedVersion {return entity.data.get("scope_note").is_some_and(|data|scope_allows(Some(scope),&sync_core::Entity::new(sync_core::EntityKind::Note,"scope",data.clone())));}
    if entity.kind != sync_core::EntityKind::Note { return true; }
    let notebooks = entity.data.get("notebook_ids").and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>()).unwrap_or_default();
    let tags = entity.data.get("tags").and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>()).unwrap_or_default();
    (scope.notebook_ids.is_empty() || notebooks.iter().any(|id| scope.notebook_ids.iter().any(|wanted| wanted == id)))
        && (scope.tags.is_empty() || tags.iter().any(|tag| scope.tags.iter().any(|wanted| wanted == tag)))
}

fn scope_allows_host(conn: &Connection, scope: Option<&SyncScope>, entity: &sync_core::Entity) -> Result<bool> {
    if entity.kind == sync_core::EntityKind::Note && entity.deleted && scope.is_some_and(|s| !s.notebook_ids.is_empty() || !s.tags.is_empty()) {
        let current = host::build_raw_entity(conn, "note", &entity.id)?;
        return Ok(!current.deleted && scope_allows(scope, &current));
    }
    if entity.kind == sync_core::EntityKind::NamedVersion && !entity.deleted && scope.is_some_and(|s| !s.notebook_ids.is_empty() || !s.tags.is_empty()) {
        // The local parent decides once it exists, so a note moved into the
        // scope later also brings its held snapshots.
        if let Some(note_id) = entity.data.get("note_id").and_then(Value::as_str) {
            let note = host::build_raw_entity(conn, "note", note_id)?;
            if !note.deleted { return Ok(scope_allows(scope, &note)); }
        }
    }
    if entity.kind == sync_core::EntityKind::Setting && entity.data.get("scope_note").is_none() {
        if let Some(note_id) = entity.id.strip_prefix("knowledge_note:").or_else(|| entity.id.strip_prefix("knowledge_redirect:")) {
            let note = host::build_raw_entity(conn, "note", note_id)?;
            // Old peers have no scope annotation. Wait until the note arrives.
            if note.deleted { return Ok(scope.is_none_or(|s| s.notebook_ids.is_empty() && s.tags.is_empty())); }
            return Ok(scope_allows(scope, &note));
        }
    }
    Ok(scope_allows(scope, entity))
}

/// Shared state the worker publishes for `sync_status` and `wait_sync_idle`.
struct WorkerState {
    running: bool,
    last_sync: i64,
    error: Option<String>,
    /// Incremented by `sync_now`/config; the worker records `done_gen` after
    /// finishing a round so waiters can tell when their request was served.
    request_gen: u64,
    done_gen: u64,
    shutdown: bool,
    /// Notes whose remote changes wait for this device's vault key (last
    /// round). Not an error: they apply after `vault_unlock`.
    vault_key_required: Vec<String>,
}

struct Shared {
    state: Mutex<WorkerState>,
    cv: Condvar,
}

impl Shared {
    fn new() -> Self {
        Shared {
            state: Mutex::new(WorkerState {
                running: false,
                last_sync: 0,
                error: None,
                request_gen: 0,
                done_gen: 0,
                shutdown: false,
                vault_key_required: Vec::new(),
            }),
            cv: Condvar::new(),
        }
    }
}

/// Everything shared between the foreground `AppCore` and the worker thread.
struct Svc {
    storage: LocalStorage,
    round: Mutex<()>,
    engine: Arc<Mutex<StoreEngine>>,
    sync: Mutex<Option<Arc<SyncEngine>>>,
    config: Mutex<Option<StoredConfig>>,
    shared: Arc<Shared>,
    path: String,
    config_path: String,
    vault: vault::Keys,
    // Last field: keep the gate until engine/sync handles are dropped, including
    // a worker that outlives the foreground shutdown timeout.
    _lease: library_lock::LibraryLease,
}

impl Svc {
    fn with_host<R>(&self, f: impl FnOnce(&Connection) -> Result<R>) -> Result<R> {
        let guard = lock_ok(&self.engine);
        f(guard.connection())
    }

    fn current_sync(&self) -> Option<Arc<SyncEngine>> {
        lock_ok(&self.sync).clone()
    }

    fn config(&self) -> Option<StoredConfig> {
        lock_ok(&self.config).clone()
    }

    /// Stage committed journal rows, one entity body at a time, capturing the
    /// current row under the host lock and doing the (encrypting) `stage_local`
    /// outside it. The sync checkpoint advances monotonically to the batch max,
    /// which is safe because the batch is the *first* N rows above the
    /// checkpoint and every id in it is staged before the checkpoint moves.
    fn drain_journal(&self, sync: &SyncEngine) -> Result<usize> {
        let mut staged = 0usize;
        loop {
            let checkpoint = sync.journal_checkpoint()? as i64;
            let batch =
                self.with_host(|c| host::journal_batch(c, checkpoint, host::JOURNAL_BATCH))?;
            if batch.is_empty() {
                break;
            }
            let batch_max = batch.last().expect("non-empty").seq;
            for (kind, id, seq) in host::coalesce(&batch) {
                let mut entity = self.with_host(|c| host::build_raw_entity(c, &kind, &id))?;
                if let Some(note_id) = entity.id.strip_prefix("knowledge_note:").or_else(|| entity.id.strip_prefix("knowledge_redirect:")).filter(|_| entity.kind == sync_core::EntityKind::Setting) {
                    let note = self.with_host(|c| host::build_raw_entity(c, "note", note_id))?;
                    entity.data["scope_note"] = json!({"notebook_ids":note.data["notebook_ids"],"tags":note.data["tags"]});
                }
                if !scope_allows(self.config().as_ref().map(|c| &c.scope), &entity) {
                    // The journal row is still pruned: this device has
                    // deliberately opted out of this entity, and must not
                    // replay it forever or leak it on a later retry.
                    continue;
                }
                if entity.kind == sync_core::EntityKind::Note && !entity.deleted
                    && self.config().is_some_and(|c| !c.scope.notebook_ids.is_empty() || !c.scope.tags.is_empty())
                {
                    // Snapshots journaled while their note was outside this
                    // device's scope were pruned unsent; queue those never sent.
                    for version in self.with_host(|c| named_version_sync::ids_for_note(c, &entity.id))? {
                        if !sync.has_snapshot(sync_core::EntityKind::NamedVersion, &version)? {
                            self.with_host(|c| Ok(c.execute("INSERT INTO sync_journal(kind,id,deleted) VALUES('namedversion',?1,0)", [&version])?))?;
                        }
                    }
                }
                let mut manifests = Vec::new();
                for file_id in attachment_sync::references(&entity)? {
                    let manifest = match self.with_host(|c| attachment_sync::cached(c, &file_id))? {
                        Some(manifest) => manifest,
                        None => {
                            let cfg = self
                                .config()
                                .ok_or_else(|| RuntimeError::config("sync unconfigured"))?;
                            let queue_path = std::path::PathBuf::from(format!(
                                "{}.attachment-outbox-{}",
                                self.path,
                                sync.device_id()
                            ));
                            let manifest = attachment_sync::prepare(
                                &self.path,
                                &queue_path,
                                &cfg,
                                &file_id,
                                &self.storage,
                            )?;
                            self.with_host(|c| attachment_sync::cache(c, &manifest))?;
                            manifest
                        }
                    };
                    manifests.push(manifest);
                }
                // Keep the captured body. Later edits have newer journal rows
                // and are staged on subsequent passes; never prune past this batch.
                if !manifests.is_empty() {
                    entity.data["attachments"] = serde_json::to_value(manifests)?;
                }
                sync.stage_local(entity, seq as u64)?;
                staged += 1;
            }
            self.with_host(|c| host::prune_journal(c, batch_max))?;
        }
        Ok(staged)
    }

    /// Visit each pending change once per round. Record failures stay durable
    /// and unacknowledged, while subsequent valid changes can still apply.
    /// Resolve, apply and ack under the host lock so local edits cannot race
    /// the snapshot used for the next change. An ack/staging failure aborts
    /// the round: subsequent records must not use an outdated snapshot.
    fn apply_pending(&self, sync: &SyncEngine) -> Result<()> {
        // A record can depend on a later one in the same pull (a snapshot
        // pushed before its note's unlock). Revisit failures while a pass
        // still makes progress, bounded so a permanent failure ends the round.
        let mut last = None;
        let mut waiting = std::collections::BTreeSet::new();
        for _ in 0..3 {
            let (applied, error, wait) = self.apply_pending_pass(sync)?;
            waiting = wait;
            last = error;
            if (last.is_none() && waiting.is_empty()) || applied == 0 {
                break;
            }
        }
        lock_ok(&self.shared.state).vault_key_required = waiting.into_iter().collect();
        match last {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    /// One traversal; returns the number of applied records and the first
    /// record failure (left pending).
    fn apply_pending_pass(&self, sync: &SyncEngine) -> Result<(usize, Option<RuntimeError>, std::collections::BTreeSet<String>)> {
        let mut applied = 0usize;
        let mut waiting = std::collections::BTreeSet::new();
        let sealer = |key_id: &str, note: &str, row: &Value| vault::seal_version(&self.vault, key_id, note, row);
        let mut cursor = None;
        let mut first_error = None;
        while let Some(key) = sync.next_pending_incoming(cursor.as_ref())? {
            cursor = Some(key.clone());
            // Keep excluded events durable. If the user expands the scope
            // later, the same event can then be applied; acknowledging here
            // would make that expansion lose data permanently.
            // A record this version cannot decode (for example a newer
            // entity kind) stays pending and reported; it must not stop the
            // remaining records from applying.
            match sync.resolve_pending(&key.event_id) {
                Ok(Some(inc)) => match self.with_host(|conn| scope_allows_host(conn, self.config().as_ref().map(|c| &c.scope), &inc.entity)) {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(e) => { first_error.get_or_insert(e); continue; }
                },
                Ok(None) => {}
                Err(e) => { first_error.get_or_insert(e.into()); continue; }
            }
            // Download and verify before acquiring the note lock. Re-resolve
            // under that lock afterwards so concurrent local edits still win
            // or become conflict copies according to the existing rules.
            if let Err(e) = self.receive_pending(sync, &key.event_id) {
                first_error.get_or_insert(e);
                continue;
            }
            {
                // Reuse background staging so encryption and attachment upload
                // do not hold the note lock. A local edit can arrive after the
                // drain: recheck while locked before resolving/applying it.
                // ponytail: continuous local writes can defer inbound apply;
                // use a bounded staging epoch if this becomes a real limit.
                let guard = self.lock_drained(sync)?;
                let conn = guard.connection();
                if let Err(e) = apply_resolved(sync, conn, &key.event_id, self.config().as_ref().map(|c| &c.scope), Some(&sealer)) {
                    if !conn.is_autocommit() {
                        return Err(e);
                    }
                    match e {
                        // Held for the vault key; reported separately and
                        // never blocks the remaining records.
                        RuntimeError::VaultKeyRequired(note) => { waiting.insert(note); }
                        e => { first_error.get_or_insert(e); }
                    }
                    continue;
                }
                // Stop on ack failure rather than resolving another change
                // against a snapshot that missed the committed host write.
                sync.ack_applied(&[key.event_id])?;
                applied += 1;
            }
        }
        Ok((applied, first_error, waiting))
    }

    /// Download and verify a pending change's attachments without the note lock.
    fn receive_pending(&self, sync: &SyncEngine, event_id: &str) -> Result<()> {
        let Some(inc) = sync.resolve_pending(event_id)? else {
            return Ok(());
        };
        // A newer applied version can supersede an old failure whose
        // attachments will never arrive. No download is needed then.
        if inc.stale {
            return Ok(());
        }
        let cfg = self
            .config()
            .ok_or_else(|| RuntimeError::config("sync unconfigured"))?;
        let dir = std::path::PathBuf::from(format!(
            "{}.attachment-inbox-{}",
            self.path,
            sync.device_id()
        ));
        let mut entities = vec![&inc.entity];
        if let Some(conflict) = &inc.conflict {
            entities.push(&conflict.loser);
        }
        for entity in entities {
            for manifest in attachment_sync::receive(&self.path, &dir, &cfg, entity, &self.storage)? {
                self.with_host(|c| attachment_sync::cache(c, &manifest))?;
            }
        }
        Ok(())
    }

    /// The note lock, taken once no local edit is left to stage.
    fn lock_drained(&self, sync: &SyncEngine) -> Result<MutexGuard<'_, StoreEngine>> {
        loop {
            self.drain_journal(sync)?;
            let guard = lock_ok(&self.engine);
            let checkpoint = sync.journal_checkpoint()? as i64;
            if host::journal_batch(guard.connection(), checkpoint, 1)?.is_empty() {
                return Ok(guard);
            }
        }
    }

    fn pending_count(&self) -> usize {
        match self.current_sync() {
            Some(sync) => {
                let outbox = sync.pending_outbox_count().unwrap_or(0);
                let incoming = sync.pending_incoming_count().unwrap_or(0);
                let journal = self
                    .with_host(|c| {
                        Ok(c.query_row("SELECT COUNT(*) FROM sync_journal", [], |r| {
                            r.get::<_, i64>(0)
                        })? as usize)
                    })
                    .unwrap_or(0);
                outbox + incoming + journal
            }
            None => 0,
        }
    }
}

/// Re-resolve a pending change under the note lock and apply it.
fn apply_resolved(sync: &SyncEngine, conn: &Connection, event_id: &str, scope: Option<&SyncScope>, sealer: host::Sealer) -> Result<()> {
    if let Some(inc) = sync.resolve_pending(event_id)? {
        if scope_allows_host(conn, scope, &inc.entity)? {
            host::apply_one_sealed(conn, &inc, sealer)?;
        }
    }
    Ok(())
}

/// Whether configuration starts a new sync state: none yet, or a migration
/// to another vault url/key.
fn needs_fresh_state(
    existing: Option<&StoredConfig>,
    server_url: &str,
    key: &Key,
    migration: bool,
) -> Result<bool> {
    let Some(current) = existing else {
        return Ok(true);
    };
    let same_url = current.server_url == server_url;
    let same_key = current
        .decode_key()
        .map(|k| k.as_bytes() == key.as_bytes())
        .unwrap_or(false);
    if same_url && same_key {
        return Ok(false);
    }
    if !migration {
        return Err(RuntimeError::config(
            "changing the sync vault url/key requires migration:true",
        ));
    }
    Ok(true)
}

/// One full sync round: stage local edits, push, pull, then apply.
fn run_round(svc: &Svc) -> (bool, Option<String>) {
    let _round = lock_ok(&svc.round);
    let Some(cfg) = svc.config() else {
        return (false, None);
    };
    let Some(sync) = svc.current_sync() else {
        return (false, None);
    };
    // Config replacement is the durable commit point. Initializing its host
    // journal afterwards is replayable, including a crash before this step.
    let initialized = (|| -> Result<()> {
        let checkpoint = sync.journal_checkpoint()?;
        svc.with_host(|c| {
            host::configure_generation(c, cfg.generation())?;
            host::prune_to_checkpoint(c, checkpoint)
        })
    })();
    if let Err(error) = initialized {
        return (true, Some(error.to_string()));
    }
    // Read under the same gate used to persist pause/resume. Once pause
    // returns successfully, no new HTTP round can start until resumed.
    if cfg.paused {
        return (false, None);
    }
    let mut error: Option<String> = None;
    if let Err(e) = svc.drain_journal(&sync) {
        error = Some(e.to_string());
    }
    let scope = svc.config().map(|cfg| cfg.scope);
    if let Err(e) = sync.filter_outbox(|kind,id,data,deleted| {
        let Some(kind) = sync_core::EntityKind::parse(kind) else { return false; };
        scope_allows(scope.as_ref(), &sync_core::Entity {kind,id:id.into(),data:serde_json::from_str(data).unwrap_or(Value::Null),deleted})
    }) { return (true, Some(e.to_string())); }
    if let Err(e) = sync.push() {
        if error.is_none() {
            error = Some(e.to_string());
        }
    }
    if let Err(e) = sync.pull() {
        if error.is_none() {
            error = Some(e.to_string());
        }
    }
    if let Err(e) = svc.apply_pending(&sync) {
        if error.is_none() {
            error = Some(e.to_string());
        }
    }
    (true, error)
}

/// Background worker: runs a round on request or every [`AUTO_SYNC_INTERVAL`].
fn worker(svc: Arc<Svc>, shared: Arc<Shared>, stop: std::sync::mpsc::Sender<()>) {
    loop {
        let gen;
        {
            let mut st = lock_ok(&shared.state);
            if st.shutdown {
                drop(st);
                let _ = stop.send(());
                return;
            }
            if st.request_gen <= st.done_gen {
                let (guard, _) = shared
                    .cv
                    .wait_timeout_while(st, AUTO_SYNC_INTERVAL, |s| {
                        !s.shutdown && s.request_gen <= s.done_gen
                    })
                    .expect("sync condvar");
                st = guard;
            }
            if st.shutdown {
                drop(st);
                let _ = stop.send(());
                return;
            }
            gen = st.request_gen;
            st.running = true;
        }
        shared.cv.notify_all();

        let (attempted, error) = if svc.current_sync().is_some() {
            run_round(&svc)
        } else {
            (false, None)
        };

        {
            let mut st = lock_ok(&shared.state);
            st.running = false;
            if gen > st.done_gen {
                st.done_gen = gen;
            }
            if attempted {
                st.last_sync = now_ms();
                st.error = error;
            }
        }
        shared.cv.notify_all();
    }
}

struct WorkerHandle {
    join: Option<JoinHandle<()>>,
    stop_rx: std::sync::mpsc::Receiver<()>,
}

/// Integrated Inkism runtime. See the module docs for the ownership model.
pub struct AppCore {
    svc: Arc<Svc>,
    worker: Option<WorkerHandle>,
}

impl AppCore {
    /// Open (create if absent) a Inkism library at `path`.
    ///
    /// Reads an existing sync config beside the DB, validates its key with a
    /// clear error, bootstraps the journal if sync is configured, and starts
    /// the background worker. A corrupt or invalid configured key is rejected
    /// rather than silently ignored.
    pub fn open(path: &str) -> Result<AppCore> {
        let lease = library_lock::LibraryLease::shared(path)?;
        Self::open_with_storage(path, local_key::load(path)?, lease)
    }

    #[cfg(feature = "encrypted-storage")]
    pub fn open_encrypted(path: &str, key: local_storage::StorageKey) -> Result<AppCore> {
        let lease = library_lock::LibraryLease::shared(path)?;
        Self::open_with_storage(path, LocalStorage::encrypted(key), lease)
    }

    fn open_with_storage(
        path: &str,
        storage: LocalStorage,
        lease: library_lock::LibraryLease,
    ) -> Result<AppCore> {
        if path.trim().is_empty() {
            return Err(RuntimeError::config("empty db path"));
        }
        let engine = storage.engine(path)?;
        let engine = Arc::new(Mutex::new(engine));
        {
            let guard = lock_ok(&engine);
            host::ensure_schema(guard.connection())?;
        }

        let config_path = format!("{path}.sync.json");
        let shared = Arc::new(Shared::new());
        let svc = Arc::new(Svc {
            storage,
            round: Mutex::new(()),
            engine: engine.clone(),
            sync: Mutex::new(None),
            config: Mutex::new(None),
            shared: shared.clone(),
            path: path.to_string(),
            config_path,
            vault: vault::Keys::default(),
            _lease: lease,
        });

        match StoredConfig::load(&svc.config_path)? {
            Some(cfg) => {
                let key = cfg.decode_key()?; // rejection point for a bad key
                let state_path = cfg.state_path(path)?;
                if cfg.state_generation.is_some()
                    && !std::path::Path::new(&state_path).try_exists()?
                {
                    return Err(RuntimeError::config(
                        "동기화 기록 파일을 찾을 수 없습니다. 기존 설정과 파일을 보존해 주세요.",
                    ));
                }
                if cfg.state_generation.is_some() {
                    svc.storage.validate_sync_state(&state_path)?;
                }
                let sync = svc.storage.sync(SyncConfig::new(
                    state_path,
                    cfg.server_url.clone(),
                    cfg.token.clone(),
                    key,
                ))?;
                let checkpoint = sync.journal_checkpoint()?;
                svc.with_host(|c| {
                    host::configure_generation(c, cfg.generation())?;
                    host::prune_to_checkpoint(c, checkpoint)
                })?;
                *lock_ok(&svc.sync) = Some(Arc::new(sync));
                *lock_ok(&svc.config) = Some(cfg);
            }
            None => {
                // No vault yet: pause the journal so it cannot grow unbounded;
                // the first `sync_config` bootstraps current state instead.
                svc.with_host(host::pause)?;
            }
        }

        {
            let mut st = lock_ok(&shared.state);
            st.request_gen = 1; // one immediate round at startup
        }

        let (stop_tx, stop_rx) = std::sync::mpsc::channel();
        let worker_svc = Arc::clone(&svc);
        let worker_shared = Arc::clone(&shared);
        let join = std::thread::Builder::new()
            .name("inkism-sync".into())
            .spawn(move || worker(worker_svc, worker_shared, stop_tx))
            .map_err(|e| RuntimeError::Io(format!("spawning sync worker: {e}")))?;

        shared.cv.notify_all();
        Ok(AppCore {
            svc,
            worker: Some(WorkerHandle {
                join: Some(join),
                stop_rx,
            }),
        })
    }

    /// Protocol entry point. Sync-owned ops are handled here; everything else
    /// is forwarded to the storage engine unchanged.
    pub fn execute(&self, req: Value) -> Value {
        let op = req.get("op").and_then(Value::as_str).unwrap_or("");
        match op {
            "remote_history_list" | "remote_history_preview" | "remote_history_restore" => match self.svc.remote_history(op, &req) {
                Ok(data) => json!({"ok":true,"data":data}),
                Err(e) => json!({"ok":false,"error":e.to_string()}),
            },
            "storage_status" => json!({"ok":true,"data":{
                "encrypted": self.svc.storage.is_encrypted()
            }}),
            "sync_keygen"
            | "sync_status"
            | "sync_now"
            | "sync_config"
            | "sync_scope"
            | "sync_pause"
            | "sync_recovery_export"
            | "sync_recovery_import"
            | "sync_relay_token" => self.handle_sync(op, &req),
            "vault_status" | "vault_create" | "vault_unlock" | "vault_lock"
            | "vault_change_password" | "vault_lock_note" | "vault_open" | "vault_save"
            | "vault_unlock_note" | "vault_clear" | "vault_delete" | "vault_versions" => match self.svc.handle_vault(op, &req) {
                Ok(data) => {
                    // Held vault-key records can apply now.
                    if op == "vault_unlock" && self.svc.config().is_some() { self.request_sync(); }
                    json!({"ok":true,"data":data})
                }
                Err(e) => json!({"ok":false,"error":e.to_string()}),
            },
            _ => lock_ok(&self.svc.engine).execute(req),
        }
    }

    fn handle_sync(&self, op: &str, req: &Value) -> Value {
        match op {
            // Key generation returns secret material to the explicit caller.
            "sync_keygen" => json!({ "ok": true, "data": { "key": Key::generate().to_base64() } }),
            // Host-only: never add this op to the renderer RPC whitelist.
            // Server-assisted recovery is an explicit trust-policy opt-in.
            "sync_recovery_export" => {
                if req
                    .get("confirmed_server_recovery")
                    .and_then(Value::as_bool)
                    != Some(true)
                {
                    return json!({"ok":false,"error":"서버 키 보관을 명시적으로 승인해야 합니다"});
                }
                match self.svc.config() {
                    Some(cfg)
                        if req.get("server_url").and_then(Value::as_str)
                            == Some(cfg.server_url.as_str()) =>
                    {
                        json!({"ok":true,"data":{
                            "server_url":cfg.server_url,"key":cfg.key
                        }})
                    }
                    Some(_) => json!({"ok":false,"error":"승인한 서버와 동기화 설정이 다릅니다"}),
                    None => json!({"ok":false,"error":"연결된 동기화 서버가 없습니다"}),
                }
            }
            // Host-only restoration into an empty, unconfigured library.
            // Never replace an existing sync key or merge unrelated local notes.
            "sync_recovery_import" => {
                let result = self.sync_recovery_import(req);
                match result {
                    Ok(data) => json!({"ok":true,"data":data}),
                    Err(e) => json!({"ok":false,"error":e.to_string()}),
                }
            }
            // Host-only (public-link publishing): never add to the renderer RPC whitelist.
            "sync_relay_token" => match self.svc.config() {
                Some(cfg) => json!({"ok":true,"data":{"token":cfg.token}}),
                None => json!({"ok":false,"error":"연결된 동기화 서버가 없습니다"}),
            },
            "sync_status" => json!({ "ok": true, "data": self.sync_status() }),
            "sync_now" => {
                if self.svc.config().is_some_and(|cfg| cfg.paused) {
                    return json!({"ok":false,"error":"동기화가 일시중지되어 있습니다. 먼저 다시 시작하세요."});
                }
                self.request_sync();
                json!({ "ok": true, "data": { "queued": true } })
            }
            "sync_pause" => match self.sync_pause(req) {
                Ok(data) => json!({"ok":true,"data":data}),
                Err(e) => json!({"ok":false,"error":e.to_string()}),
            },
            "sync_scope" => match self.sync_scope(req) {
                Ok(data) => json!({"ok":true,"data":data}),
                Err(e) => json!({"ok":false,"error":e.to_string()}),
            },
            "sync_config" => match self.sync_config(req) {
                Ok(data) => json!({ "ok": true, "data": data }),
                Err(e) => json!({ "ok": false, "error": e.to_string() }),
            },
            _ => json!({ "ok": false, "error": "unknown sync op" }),
        }
    }

    fn sync_recovery_import(&self, req: &Value) -> Result<Value> {
        if req
            .get("confirmed_server_recovery")
            .and_then(Value::as_bool)
            != Some(true)
        {
            return Err(RuntimeError::config(
                "서버 복구를 명시적으로 승인해야 합니다",
            ));
        }
        if self.svc.config().is_some()
            || req.get("migration").and_then(Value::as_bool) == Some(true)
        {
            return Err(RuntimeError::config(
                "기존 동기화 설정은 복구로 교체할 수 없습니다",
            ));
        }
        let occupied = self.svc.with_host(|c| {
            Ok(c.query_row("SELECT EXISTS(SELECT 1 FROM notes_meta) OR EXISTS(SELECT 1 FROM notebooks)", [], |r| r.get::<_, bool>(0))?)
        })?;
        if occupied {
            return Err(RuntimeError::config(
                "새 빈 저장소에만 서버 복구를 연결할 수 있습니다",
            ));
        }
        self.sync_config(req)
    }

    fn sync_pause(&self, req: &Value) -> Result<Value> {
        let paused = req
            .get("paused")
            .and_then(Value::as_bool)
            .ok_or_else(|| RuntimeError::config("paused 값은 true 또는 false여야 합니다"))?;
        let _round = self.svc.round.try_lock().map_err(|_| {
            RuntimeError::config("동기화가 진행 중입니다. 완료 후 다시 시도하세요.")
        })?;
        let mut cfg = self
            .svc
            .config()
            .ok_or_else(|| RuntimeError::config("연결된 동기화 서버가 없습니다"))?;
        cfg.paused = paused;
        cfg.save(&self.svc.config_path)?;
        *lock_ok(&self.svc.config) = Some(cfg);
        lock_ok(&self.svc.shared.state).error = None;
        self.request_sync();
        Ok(json!({"paused":paused}))
    }

    /// Configure (or reconfigure) the vault. Never echoes the key or token.
    fn sync_config(&self, req: &Value) -> Result<Value> {
        let server_url = req
            .get("server_url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let token = req
            .get("token")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let key_str = req
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| RuntimeError::config("sync_config requires key"))?;
        let key = Key::from_base64(key_str)
            .map_err(|e| RuntimeError::config(format!("invalid sync key: {e}")))?;
        if server_url.is_empty() {
            return Err(RuntimeError::config("sync_config requires server_url"));
        }
        if token.is_empty() {
            return Err(RuntimeError::config("sync_config requires token"));
        }
        // Validate the relay URL *before* mutating anything, so a bad scheme or
        // non-loopback plaintext URL can never leave a half-migrated vault.
        validate_server_url(&server_url)?;
        let migration = req
            .get("migration")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let requested_scope = req.get("scope").map(|value| parse_scope(Some(value))).transpose()?;

        // Never mix a new vault with in-flight attachment manifests. Reject
        // promptly instead of blocking the foreground note protocol on HTTP.
        let _round = self.svc.round.try_lock().map_err(|_| {
            RuntimeError::config("sync is in progress; retry configuration after it finishes")
        })?;
        let existing = self.svc.config();
        let fresh = needs_fresh_state(existing.as_ref(), &server_url, &key, migration)?;

        let cfg = StoredConfig {
            version: config::CONFIG_VERSION,
            paused: existing.as_ref().is_some_and(|cfg| cfg.paused),
            state_generation: if fresh {
                Some(uuid::Uuid::new_v4().to_string())
            } else {
                existing
                    .as_ref()
                    .and_then(|cfg| cfg.state_generation.clone())
            },
            server_url,
            token,
            key: key.to_base64(),
            scope: requested_scope.unwrap_or_else(|| existing.as_ref().map(|cfg| cfg.scope.clone()).unwrap_or_default()),
        };
        let state_path = cfg.state_path(&self.svc.path)?;
        if !fresh && cfg.state_generation.is_some() {
            self.svc.storage.validate_sync_state(&state_path)?;
        }
        if fresh {
            // Reserve only our new path. Never overwrite or remove old state.
            drop(
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&state_path)?,
            );
        }
        let prepared = self.svc.storage.sync(SyncConfig::new(
            state_path.clone(),
            cfg.server_url.clone(),
            cfg.token.clone(),
            key,
        ));
        let sync = match prepared {
            Ok(sync) => sync,
            Err(error) => {
                if fresh {
                    remove_prepared_state_files(&state_path);
                }
                return Err(error);
            }
        };
        if let Err(error) = cfg.save(&self.svc.config_path) {
            drop(sync);
            if fresh {
                remove_prepared_state_files(&state_path);
            }
            return Err(error);
        }
        // The persisted config now names the prepared state. Keep prior files;
        // the worker/reopen initializes the corresponding journal atomically.
        *lock_ok(&self.svc.sync) = Some(Arc::new(sync));
        *lock_ok(&self.svc.config) = Some(cfg);
        {
            let mut state = lock_ok(&self.svc.shared.state);
            state.error = None;
            if fresh {
                state.last_sync = 0;
            }
        }

        self.request_sync();
        Ok(json!({ "configured": true }))
    }

    fn sync_scope(&self, req: &Value) -> Result<Value> {
        let _round = self.svc.round.try_lock().map_err(|_| RuntimeError::config("sync is in progress; retry after it finishes"))?;
        let mut cfg = self.svc.config().ok_or_else(|| RuntimeError::config("sync is not configured"))?;
        cfg.scope = parse_scope(req.get("scope"))?;
        // Previously excluded journal rows were pruned. Restage current state
        // with new monotonic sequences so expansion includes existing notes.
        self.svc.with_host(|conn| {
            conn.execute("INSERT INTO sync_journal(kind,id,deleted) SELECT 'note',id,0 FROM notes_meta", [])?;
            conn.execute("INSERT INTO sync_journal(kind,id,deleted) SELECT 'setting',key,0 FROM settings WHERE key LIKE 'knowledge_note:%'", [])?;
            named_version_sync::bootstrap(conn)?;
            Ok(())
        })?;
        cfg.save(&self.svc.config_path)?;
        *lock_ok(&self.svc.config) = Some(cfg.clone());
        self.request_sync();
        Ok(json!({"scope": cfg.scope}))
    }

    fn sync_status(&self) -> Value {
        let config = self.svc.config();
        let (running, last_sync, error, vault_key_required) = {
            let st = lock_ok(&self.svc.shared.state);
            (st.running, st.last_sync, st.error.clone(), st.vault_key_required.clone())
        };
        json!({
            "configured": config.is_some(),
            "paused": config.as_ref().is_some_and(|cfg|cfg.paused),
            "running": running,
            "pending": self.svc.pending_count(),
            "last_sync": last_sync,
            "error": error,
            // Note ids whose incoming changes wait for `vault_unlock` on this
            // device (named snapshot vs. vault lock); not a sync failure.
            "vault_key_required": vault_key_required,
            "server_url": config.as_ref().map(|c| c.server_url.clone()),
            "scope": config.as_ref().map(|c| c.scope.clone()),
        })
    }

    fn request_sync(&self) {
        {
            let mut st = lock_ok(&self.svc.shared.state);
            st.request_gen = st.request_gen.wrapping_add(1);
        }
        self.svc.shared.cv.notify_all();
    }

    /// Whether a vault is configured; paused vaults still journal local edits.
    pub fn is_configured(&self) -> bool {
        self.svc.config().is_some()
    }

    /// Wait until the worker has served every outstanding request. Returns
    /// `false` on timeout. Not part of the JSON protocol; used by callers
    /// (and tests) that need a synchronous barrier after `sync_now`.
    pub fn wait_sync_idle(&self, timeout_ms: u64) -> bool {
        let shared = &self.svc.shared;
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        let mut st = lock_ok(&shared.state);
        loop {
            if !st.running && st.done_gen >= st.request_gen {
                return true;
            }
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let (guard, _) = shared
                .cv
                .wait_timeout(st, deadline - now)
                .expect("sync condvar");
            st = guard;
        }
    }

    /// The note database path this runtime owns.
    pub fn path(&self) -> &str {
        &self.svc.path
    }
}

impl Drop for AppCore {
    fn drop(&mut self) {
        {
            let mut st = lock_ok(&self.svc.shared.state);
            st.shutdown = true;
        }
        self.svc.shared.cv.notify_all();
        if let Some(mut handle) = self.worker.take() {
            // Bound the join: never block the foreground behind a slow network
            // call. The worker checks `shutdown` between rounds, and its
            // checkpoint/outbox are durable, so a detached worker is safe.
            if handle.stop_rx.recv_timeout(Duration::from_secs(5)).is_ok() {
                if let Some(join) = handle.join.take() {
                    let _ = join.join();
                }
            }
        }
    }
}

/// Mirror of sync-core's TLS rule, checked before a config mutation: `https`
/// only, except loopback `http` for tests.
fn validate_server_url(server_url: &str) -> Result<()> {
    use url::{Host, Url};
    let url = Url::parse(server_url)
        .map_err(|e| RuntimeError::config(format!("invalid relay URL: {e}")))?;
    match url.scheme() {
        "https" => Ok(()),
        "http" => {
            let loopback = match url.host() {
                Some(Host::Domain("localhost")) => true,
                Some(Host::Ipv4(addr)) => addr.is_loopback(),
                Some(Host::Ipv6(addr)) => addr.is_loopback(),
                _ => false,
            };
            if loopback {
                Ok(())
            } else {
                Err(RuntimeError::config(
                    "refusing plaintext relay URL: TLS is required except for loopback",
                ))
            }
        }
        other => Err(RuntimeError::config(format!(
            "unsupported relay scheme {other:?}; use https"
        ))),
    }
}

// Used only for the exclusively reserved, not-yet-committed candidate path.
fn remove_prepared_state_files(state_path: &str) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{state_path}{suffix}"));
    }
}

#[cfg(test)]
mod configuration_round_tests {
    use super::*;

    #[test]
    fn incoming_staging_does_not_hold_note_lock_while_sync_storage_waits() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.db");
        let path = path.to_str().unwrap();
        let cfg = StoredConfig {
            version: config::CONFIG_VERSION,
            server_url: "http://127.0.0.1:9".into(),
            token: "synthetic-token".into(),
            key: Key::generate().to_base64(),
            paused: true,
            state_generation: None,
            scope: SyncScope::default(),
        };
        cfg.save(&format!("{path}.sync.json")).unwrap();
        let app = AppCore::open(path).unwrap();
        assert!(app.wait_sync_idle(30_000));
        let _round = lock_ok(&app.svc.round); // Keep the normal worker paused.
        let local = app.execute(json!({"op":"save","note":{"title":"local","text":"preserved"}}));
        assert_eq!(local["ok"], true);
        let remote_id = uuid::Uuid::new_v4().to_string();
        let event_id = uuid::Uuid::new_v4().to_string();
        let payload = sync_core::ChangePayload {
            version: sync_core::PAYLOAD_VERSION,
            entity: sync_core::Entity::new(sync_core::EntityKind::Note, &remote_id,
                json!({"title":"remote","content":"<p>remote</p>","text":"remote"})),
            device_id: "synthetic-peer".into(),
            counter: 1,
            ts: 1,
            vclock: [("synthetic-peer".into(), 1)].into_iter().collect(),
        };
        let blocker = Connection::open(cfg.state_path(path).unwrap()).unwrap();
        blocker.execute("INSERT INTO incoming(event_id,seq,created_at,payload) VALUES(?1,1,1,?2)",
            rusqlite::params![event_id,payload.encode().unwrap()]).unwrap();
        blocker.execute_batch("BEGIN IMMEDIATE;").unwrap();
        let sync = app.svc.current_sync().unwrap();
        let svc = &app.svc;
        let sync_for_apply = &sync;
        let local_id = local["data"]["id"].clone();
        let id_for_edit = local_id.clone();
        let revision = local["data"]["revision"].clone();
        let prompt = std::thread::scope(|scope| {
            let (started, ready) = std::sync::mpsc::channel();
            let apply = scope.spawn(move || {
                started.send(()).unwrap();
                svc.apply_pending(sync_for_apply)
            });
            ready.recv_timeout(Duration::from_secs(5)).unwrap();
            // Give the artificial sync DB write lock time to block staging.
            std::thread::sleep(Duration::from_millis(500));
            let (send, receive) = std::sync::mpsc::channel();
            let read = scope.spawn(move || {
                let engine = lock_ok(&svc.engine);
                let saved = engine.execute(json!({"op":"save","note":{"id":id_for_edit,
                    "revision":revision,"text":"changed during staging"}}));
                let fetched = engine.execute(json!({"op":"get","id":id_for_edit}));
                send.send((saved, fetched)).unwrap();
            });
            let prompt = receive.recv_timeout(Duration::from_millis(500));
            // Release before assertions/join so a regression cannot deadlock.
            blocker.execute_batch("ROLLBACK;").unwrap();
            apply.join().unwrap().unwrap();
            read.join().unwrap();
            prompt
        });
        let (saved, response) = prompt.expect("foreground note edit waited for sync staging");
        assert_eq!(saved["ok"], true);
        assert_eq!(response["data"]["text"], "changed during staging");
        assert_eq!(app.execute(json!({"op":"get","id":remote_id}))["data"]["text"], "remote");
        assert_eq!(sync.pending_incoming_count().unwrap(), 0);
        assert!(sync.pending_outbox_count().unwrap() > 0);
        let staged: String = blocker.query_row("SELECT json_extract(data,'$.text') FROM entities WHERE entity_kind='note' AND entity_id=?1",
            [local_id.as_str().unwrap()], |row| row.get(0)).unwrap();
        assert_eq!(staged, "changed during staging", "later journal edits must also be staged");
        app.svc.with_host(|c| {
            assert!(host::journal_batch(c, 0, host::JOURNAL_BATCH)?.is_empty());
            Ok(())
        }).unwrap();
    }

    #[test]
    fn relay_token_is_only_the_saved_sync_token() {
        let tmp = tempfile::tempdir().unwrap();
        let app = AppCore::open(tmp.path().join("relay-token.db").to_str().unwrap()).unwrap();
        assert_eq!(app.execute(json!({"op":"sync_relay_token"}))["ok"], false);
        let key = Key::generate().to_base64();
        let req = json!({"op":"sync_recovery_import", "server_url":"http://127.0.0.1:9", "key":key, "token":"synthetic-token", "confirmed_server_recovery":true});
        assert_eq!(app.execute(req)["ok"], true);
        let out = app.execute(json!({"op":"sync_relay_token"}));
        assert_eq!(out["data"]["token"], "synthetic-token");
        assert!(out["data"].get("key").is_none());
    }

    #[test]
    fn recovery_requires_consent_and_preserves_existing_vault() {
        let tmp = tempfile::tempdir().unwrap();
        let app = AppCore::open(tmp.path().join("recovery.db").to_str().unwrap()).unwrap();
        let key = Key::generate().to_base64();
        let mut req = json!({"op":"sync_recovery_import", "server_url":"http://127.0.0.1:9", "key":key, "token":"synthetic-token"});
        assert_eq!(app.execute(req.clone())["ok"], false);
        assert!(app.svc.config().is_none());
        req["confirmed_server_recovery"] = json!(true);
        assert_eq!(app.execute(req.clone())["ok"], true);
        let original = app.svc.config().unwrap().key;
        req["key"] = json!(Key::generate().to_base64());
        req["migration"] = json!(true);
        assert_eq!(app.execute(req)["ok"], false);
        assert_eq!(app.svc.config().unwrap().key, original);
        assert_eq!(
            app.execute(json!({"op":"sync_recovery_export"}))["ok"],
            false
        );
        assert_eq!(app.execute(json!({"op":"sync_recovery_export", "confirmed_server_recovery":true, "server_url":"https://other.invalid"}))["ok"], false);
        let export = app.execute(json!({"op":"sync_recovery_export", "confirmed_server_recovery":true, "server_url":"http://127.0.0.1:9"}));
        assert_eq!(export["data"]["key"], original);
        let status = app.execute(json!({"op":"sync_status"}));
        assert!(status["data"].get("key").is_none());
        assert!(status["data"].get("token").is_none());
    }

    #[test]
    fn first_config_save_failure_keeps_journaling_disabled_and_removes_only_candidate() {
        let tmp = tempfile::tempdir().unwrap();
        let app = AppCore::open(tmp.path().join("notes.db").to_str().unwrap()).unwrap();
        assert!(app.wait_sync_idle(30_000));
        let saved =
            app.execute(json!({"op":"save","note":{"content":"<p>한글😀</p>","text":"보존"}}));
        std::fs::create_dir(&app.svc.config_path).unwrap();
        let keep = std::path::Path::new(&app.svc.config_path).join("keep");
        std::fs::write(&keep, b"unowned").unwrap();
        let response = app.execute(json!({"op":"sync_config","server_url":"http://127.0.0.1:9",
            "token":"fixture-token","key":Key::generate().to_base64()}));
        assert_eq!(response["ok"], false);
        assert!(app.svc.current_sync().is_none());
        assert!(app.svc.config().is_none());
        assert_eq!(std::fs::read(keep).unwrap(), b"unowned");
        assert!(config::state_files(&app.svc.path).unwrap().is_empty());
        app.svc
            .with_host(|c| {
                assert_eq!(
                    c.query_row(
                        "SELECT suppress,bootstrapped FROM sync_host_control",
                        [],
                        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                    )?,
                    (1, 0)
                );
                assert_eq!(
                    c.query_row("SELECT count(*) FROM sync_journal", [], |r| r
                        .get::<_, i64>(0))?,
                    0
                );
                Ok(())
            })
            .unwrap();
        assert_eq!(
            app.execute(json!({"op":"get","id":saved["data"]["id"]}))["data"],
            saved["data"]
        );
    }

    #[test]
    fn committed_config_recovers_failed_bootstrap_on_reopen_without_deleting_old_state() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.db");
        let path = path.to_str().unwrap();
        let app = AppCore::open(path).unwrap();
        let note = app
            .execute(json!({"op":"save","note":{"content":"<p>最初 한글😀</p>","text":"기준"}}))
            ["data"]
            .clone();
        drop(app);
        let cfg = StoredConfig {
            version: config::CONFIG_VERSION,
            server_url: "http://127.0.0.1:9".into(),
            token: "fixture-token".into(),
            key: Key::generate().to_base64(),
            paused: true,
            state_generation: None,
            scope: SyncScope::default(),
        };
        cfg.save(&format!("{path}.sync.json")).unwrap();
        let app = AppCore::open(path).unwrap();
        assert!(app.wait_sync_idle(30_000));
        let old = app.svc.current_sync().unwrap();
        old.stage_local(
            sync_core::Entity::new(
                sync_core::EntityKind::Note,
                "old-pending",
                json!({"body":"old"}),
            ),
            1,
        )
        .unwrap();
        let old_device = old.device_id().to_owned();
        let old_path = cfg.state_path(path).unwrap();
        drop(old);
        app.svc.with_host(|c| {
            c.execute_batch("CREATE TRIGGER fail_binding BEFORE UPDATE ON sync_config_binding BEGIN SELECT RAISE(ABORT,'binding failure'); END;")?;
            Ok(())
        }).unwrap();
        let response = app.execute(
            json!({"op":"sync_config","server_url":"http://127.0.0.1:10",
            "token":"replacement-token","key":Key::generate().to_base64(),"migration":true}),
        );
        assert_eq!(response["ok"], true, "settings were not durably committed");
        assert!(app.wait_sync_idle(30_000));
        assert!(app.execute(json!({"op":"sync_status"}))["data"]["error"]
            .as_str()
            .unwrap()
            .contains("binding failure"));
        let new_cfg = StoredConfig::load(&app.svc.config_path).unwrap().unwrap();
        assert!(new_cfg.state_generation.is_some());
        let new_path = new_cfg.state_path(path).unwrap();
        assert_ne!(new_path, old_path);
        assert!(std::path::Path::new(&old_path).is_file());
        app.svc
            .with_host(|c| {
                assert_eq!(
                    c.query_row("SELECT generation FROM sync_config_binding", [], |r| r
                        .get::<_, String>(
                        0
                    ))?,
                    ""
                );
                Ok(())
            })
            .unwrap();
        let changed = app.execute(json!({"op":"save","note":{"id":note["id"],"revision":note["revision"],"content":"<p>保留 중 편집😀</p>","text":"최근 편집"}}));
        assert_eq!(changed["ok"], true);
        drop(app);
        // Model restart after the persistent SQL failure has been resolved.
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("DROP TRIGGER fail_binding").unwrap();
        drop(conn);
        for _ in 0..2 {
            let reopened = AppCore::open(path).unwrap();
            assert!(reopened.wait_sync_idle(30_000));
            reopened
                .svc
                .with_host(|c| {
                    assert_eq!(
                        c.query_row("SELECT generation FROM sync_config_binding", [], |r| r
                            .get::<_, String>(
                            0
                        ))?,
                        new_cfg.generation()
                    );
                    assert_eq!(
                        c.query_row(
                            "SELECT count(*) FROM sync_journal WHERE kind='note'",
                            [],
                            |r| r.get::<_, i64>(0)
                        )?,
                        1
                    );
                    Ok(())
                })
                .unwrap();
            assert_eq!(
                reopened.execute(json!({"op":"get","id":note["id"]}))["data"],
                changed["data"]
            );
        }
        let retained = SyncEngine::open(SyncConfig::new(
            old_path,
            &cfg.server_url,
            &cfg.token,
            cfg.decode_key().unwrap(),
        ))
        .unwrap();
        assert_eq!(retained.device_id(), old_device);
        assert_eq!(retained.pending_outbox_count().unwrap(), 1);
        drop(retained);
        std::fs::rename(&new_path, format!("{new_path}.preserved")).unwrap();
        assert!(AppCore::open(path).is_err());
        assert!(
            !std::path::Path::new(&new_path).exists(),
            "missing active state was silently replaced"
        );
        std::fs::write(&new_path, []).unwrap();
        assert!(AppCore::open(path).is_err());
        assert_eq!(
            std::fs::metadata(&new_path).unwrap().len(),
            0,
            "empty active state was silently initialized"
        );
    }

    #[test]
    fn failed_vault_config_save_preserves_active_state_journal_and_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.db");
        let path = path.to_str().unwrap();
        let app = AppCore::open(path).unwrap();
        let created = app.execute(json!({"op":"save","note":{"title":"실패 전 원문","content":"<p>한글😀</p>","text":"정확한 검색 텍스트"}}));
        assert_eq!(created["ok"], true);
        let note = created["data"].clone();
        drop(app);
        let cfg = StoredConfig {
            version: config::CONFIG_VERSION,
            server_url: "http://127.0.0.1:9".into(),
            token: "private-fixture-token".into(),
            key: Key::generate().to_base64(),
            paused: true,
            state_generation: None,
            scope: SyncScope::default(),
        };
        cfg.save(&format!("{path}.sync.json")).unwrap();
        let app = AppCore::open(path).unwrap();
        assert!(app.wait_sync_idle(30_000));
        let sync = app.svc.current_sync().unwrap();
        sync.stage_local(
            sync_core::Entity::new(
                sync_core::EntityKind::Note,
                note["id"].as_str().unwrap(),
                json!({"title":"미전송 기록"}),
            ),
            1,
        )
        .unwrap();
        let device = sync.device_id().to_string();
        let pending = sync.pending_outbox_count().unwrap();
        drop(sync);
        let journal = || {
            app.svc
                .with_host(|c| {
                    let mut stmt =
                        c.prepare("SELECT seq,kind,id,deleted FROM sync_journal ORDER BY seq")?;
                    let rows = stmt.query_map([], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, i64>(3)?,
                        ))
                    })?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                })
                .unwrap()
        };
        let before = journal();
        {
            let mut state = lock_ok(&app.svc.shared.state);
            state.error = Some("previous-sync-error".into());
            state.last_sync = 42;
        }
        let original_config = std::fs::read(&app.svc.config_path).unwrap();
        let backup = format!("{}.backup", app.svc.config_path);
        std::fs::rename(&app.svc.config_path, &backup).unwrap();
        std::fs::create_dir(&app.svc.config_path).unwrap();
        let reply = app.execute(
            json!({"op":"sync_config","server_url":"http://127.0.0.1:10",
            "token":"another-fixture-token","key":Key::generate().to_base64(),"migration":true}),
        );
        assert_eq!(reply["ok"], false);
        assert!(
            app.svc.current_sync().is_some(),
            "failed persistence discarded the active sync engine"
        );
        assert_eq!(app.svc.current_sync().unwrap().device_id(), device);
        assert_eq!(
            app.svc
                .current_sync()
                .unwrap()
                .pending_outbox_count()
                .unwrap(),
            pending
        );
        assert_eq!(journal(), before);
        assert_eq!(
            lock_ok(&app.svc.shared.state).error.as_deref(),
            Some("previous-sync-error")
        );
        assert_eq!(lock_ok(&app.svc.shared.state).last_sync, 42);
        assert_eq!(
            app.execute(json!({"op":"get","id":note["id"]}))["data"],
            note
        );
        std::fs::remove_dir(&app.svc.config_path).unwrap();
        std::fs::rename(backup, &app.svc.config_path).unwrap();
        assert_eq!(
            std::fs::read(&app.svc.config_path).unwrap(),
            original_config
        );
        drop(app);
        let reopened = AppCore::open(path).unwrap();
        assert!(reopened.wait_sync_idle(30_000));
        assert_eq!(reopened.svc.current_sync().unwrap().device_id(), device);
        assert_eq!(
            reopened
                .svc
                .current_sync()
                .unwrap()
                .pending_outbox_count()
                .unwrap(),
            pending
        );
        assert_eq!(
            reopened.execute(json!({"op":"get","id":note["id"]}))["data"],
            note
        );
    }

    #[test]
    fn pause_rejects_active_transfer_and_failed_persistence_without_changing_state() {
        let tmp = tempfile::tempdir().unwrap();
        let app = AppCore::open(tmp.path().join("notes.db").to_str().unwrap()).unwrap();
        assert!(app.wait_sync_idle(30000));
        let cfg = StoredConfig {
            version: config::CONFIG_VERSION,
            server_url: "https://example.com".into(),
            token: "token".into(),
            key: Key::generate().to_base64(),
            paused: false,
            state_generation: None,
            scope: SyncScope::default(),
        };
        cfg.save(&app.svc.config_path).unwrap();
        *lock_ok(&app.svc.config) = Some(cfg);
        {
            let _transfer = lock_ok(&app.svc.round);
            let response = app.execute(json!({"op":"sync_pause","paused":true}));
            assert_eq!(response["ok"], false);
            assert!(!app.svc.config().unwrap().paused);
        }
        let backup = format!("{}.backup", app.svc.config_path);
        std::fs::rename(&app.svc.config_path, &backup).unwrap();
        std::fs::create_dir(&app.svc.config_path).unwrap();
        let response = app.execute(json!({"op":"sync_pause","paused":true}));
        assert_eq!(response["ok"], false);
        assert!(!app.svc.config().unwrap().paused);
        std::fs::remove_dir(&app.svc.config_path).unwrap();
        std::fs::rename(backup, &app.svc.config_path).unwrap();
        assert!(
            !StoredConfig::load(&app.svc.config_path)
                .unwrap()
                .unwrap()
                .paused
        );
        assert_eq!(
            app.execute(json!({"op":"sync_pause","paused":"true"}))["ok"],
            false
        );
    }

    #[test]
    fn vault_change_cannot_race_file_transfers_or_block_note_writes() {
        let tmp = tempfile::tempdir().unwrap();
        let app = AppCore::open(tmp.path().join("notes.db").to_str().unwrap()).unwrap();
        let _transfer = lock_ok(&app.svc.round);
        let response = app.execute(
            json!({"op":"sync_config","server_url":"https://example.com",
            "token":"test-token-with-more-than-32-characters","key":Key::generate().to_base64()}),
        );
        assert_eq!(response["ok"], false);
        assert!(response["error"].as_str().unwrap().contains("in progress"));
        assert!(app.svc.config().is_none());
        let saved = app.execute(json!({"op":"save","note":{"title":"전송 중 편집","text":"보존"}}));
        assert_eq!(saved["ok"], true);
    }

    #[test]
    fn sync_scope_matches_notebooks_and_tags_without_leaking_other_entities() {
        let scope = SyncScope { notebook_ids: vec!["work".into()], tags: vec!["urgent".into()] };
        let selected = sync_core::Entity::new(sync_core::EntityKind::Note, "n1", json!({"notebook_ids":["work"],"tags":["later","urgent"]}));
        let wrong_notebook = sync_core::Entity::new(sync_core::EntityKind::Note, "n2", json!({"notebook_ids":["home"],"tags":["urgent"]}));
        let wrong_tag = sync_core::Entity::new(sync_core::EntityKind::Note, "n3", json!({"notebook_ids":["work"],"tags":["later"]}));
        let notebook = sync_core::Entity::new(sync_core::EntityKind::Notebook, "work", json!({"name":"Work"}));
        assert!(scope_allows(Some(&scope), &selected));
        assert!(!scope_allows(Some(&scope), &wrong_notebook));
        assert!(!scope_allows(Some(&scope), &wrong_tag));
        assert!(scope_allows(Some(&scope), &notebook));
        let private_metadata = sync_core::Entity::new(sync_core::EntityKind::Setting,"knowledge_note:n2",json!({"value":"secret","scope_note":wrong_notebook.data}));
        let selected_metadata = sync_core::Entity::new(sync_core::EntityKind::Setting,"knowledge_note:n1",json!({"value":"allowed","scope_note":selected.data}));
        assert!(!scope_allows(Some(&scope),&private_metadata));
        assert!(scope_allows(Some(&scope),&selected_metadata));
    }
}

#[cfg(all(test, feature = "encrypted-storage"))]
#[path = "../tests/common/mod.rs"]
mod test_relay;

#[cfg(test)]
mod named_version_journal_tests;

mod named_version_sync;
