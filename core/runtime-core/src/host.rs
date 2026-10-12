//! Host-side sync integration: the durable change journal, staging local
//! edits into sync-core, and applying remote changes back into the note
//! database.
//!
//! Everything the runtime needs from sync-core happens through the engine's
//! own SQLite connection (`Engine::connection()`), never through
//! `engine.execute`, so remote apply can run inside one outer transaction with
//! the `sync_applied` bookkeeping row and the suppression flag.
//!
//! Atomicity: the journal is written by SQLite triggers in the *same*
//! transaction as the note/notebook change, so a committed local edit is
//! always observable. The remote apply is the mirror image: one transaction
//! that (a) suppresses the triggers, (b) writes the row, (c) records the
//! event id in `sync_applied`, then (d) re-enables the triggers.

use inkism_engine::{ids, indexer, limits, model, notebook_cover, notebook_membership, notebook_trash, ops_notes, settings, vault};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sync_core::{Conflict, Entity, EntityKind, Incoming};
use uuid::Uuid;

use crate::error::{Result, RuntimeError};

/// Journal rows read per staging pass. Bounded so a huge edit burst never
/// loads the whole journal (or all bodies) into memory at once.
pub const JOURNAL_BATCH: i64 = 32;

/// Suffix appended to a conflict copy's title/name so it is recognizable.
pub const CONFLICT_SUFFIX: &str = " (충돌 사본)";

/// Fixed namespace for mapping sync-core's deterministic conflict ids onto
/// UUIDv5. Every replica computes the same namespace+name, so copies converge.
const CONFLICT_NAMESPACE: Uuid = Uuid::from_bytes(*b"mindbox-sync-ns\x01");

const HOST_SCHEMA: &str = r#"
-- Single-row flag table. `suppress` is set while the runtime applies remote
-- changes (and while sync is unconfigured, so the journal cannot grow without
-- a consumer). `bootstrapped` records whether the initial journal snapshot for
-- pre-existing notes/notebooks has been taken.
CREATE TABLE IF NOT EXISTS sync_host_control (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    suppress     INTEGER NOT NULL DEFAULT 0,
    bootstrapped INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sync_host_control(id, suppress, bootstrapped) VALUES(1, 0, 0);

-- Persist the config/state identity alongside the bootstrap transaction.
-- A config committed before a crash can resume this step on reopen.
CREATE TABLE IF NOT EXISTS sync_config_binding (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO sync_config_binding(id,generation) VALUES(1,'');

-- Global monotonic change journal. `seq` is the source_revision handed to
-- sync-core; it is never reused. `deleted` is informational — staging always
-- re-reads the current row, so a later restoration is captured correctly even
-- when an earlier delete was coalesced.
CREATE TABLE IF NOT EXISTS sync_journal (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    kind    TEXT NOT NULL,
    id      TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sync_journal_id ON sync_journal(kind, id);

-- Remote event ids the host has already applied. Checked before applying so a
-- crash between the host commit and the sync ack is replay-safe.
CREATE TABLE IF NOT EXISTS sync_attachment_manifests (id TEXT PRIMARY KEY, manifest TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sync_applied (
    event_id TEXT PRIMARY KEY
);

-- Journal triggers fire in the same transaction as the mutation, so a
-- committed note/notebook change is never lost on the way to sync.
CREATE TRIGGER IF NOT EXISTS sync_notes_ai AFTER INSERT ON notes_meta
WHEN (SELECT suppress FROM sync_host_control WHERE id = 1) = 0
BEGIN INSERT INTO sync_journal(kind, id, deleted) VALUES('note', NEW.id, 0); END;

CREATE TRIGGER IF NOT EXISTS sync_notes_au AFTER UPDATE ON notes_meta
WHEN (SELECT suppress FROM sync_host_control WHERE id = 1) = 0
BEGIN INSERT INTO sync_journal(kind, id, deleted) VALUES('note', NEW.id, 0); END;

CREATE TRIGGER IF NOT EXISTS sync_notes_ad AFTER DELETE ON notes_meta
WHEN (SELECT suppress FROM sync_host_control WHERE id = 1) = 0
BEGIN INSERT INTO sync_journal(kind, id, deleted) VALUES('note', OLD.id, 1); END;

CREATE TRIGGER IF NOT EXISTS sync_notebooks_ai AFTER INSERT ON notebooks
WHEN (SELECT suppress FROM sync_host_control WHERE id = 1) = 0
BEGIN INSERT INTO sync_journal(kind, id, deleted) VALUES('notebook', NEW.id, 0); END;

CREATE TRIGGER IF NOT EXISTS sync_notebooks_au AFTER UPDATE ON notebooks
WHEN (SELECT suppress FROM sync_host_control WHERE id = 1) = 0
BEGIN INSERT INTO sync_journal(kind, id, deleted) VALUES('notebook', NEW.id, 0); END;

CREATE TRIGGER IF NOT EXISTS sync_notebooks_ad AFTER DELETE ON notebooks
WHEN (SELECT suppress FROM sync_host_control WHERE id = 1) = 0
BEGIN INSERT INTO sync_journal(kind, id, deleted) VALUES('notebook', OLD.id, 1); END;

-- Setting rows are never deleted; NULL values are synced decisions.
CREATE TRIGGER IF NOT EXISTS sync_settings_ai AFTER INSERT ON settings
WHEN (SELECT suppress FROM sync_host_control WHERE id = 1) = 0
BEGIN INSERT INTO sync_journal(kind, id, deleted) VALUES('setting', NEW.key, 0); END;

CREATE TRIGGER IF NOT EXISTS sync_settings_au AFTER UPDATE ON settings
WHEN (SELECT suppress FROM sync_host_control WHERE id = 1) = 0
BEGIN INSERT INTO sync_journal(kind, id, deleted) VALUES('setting', NEW.key, 0); END;
"#;

/// Create the host journal schema and triggers. Idempotent.
pub fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(HOST_SCHEMA)?;
    conn.execute_batch(crate::named_version_sync::SCHEMA)?;
    Ok(())
}

/// Pause journaling, clear any journal backlog and forget the bootstrap marker.
/// Used while sync is unconfigured: the journal would otherwise accumulate
/// without a consumer. A later first configuration bootstraps current state,
/// so nothing is lost.
pub fn pause(conn: &Connection) -> Result<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let r = conn.execute_batch(
        "DELETE FROM sync_journal;
         UPDATE sync_host_control SET suppress = 1, bootstrapped = 0 WHERE id = 1;",
    );
    finish(conn, r)
}

/// Bind the journal to the committed configuration. A new generation resets
/// and bootstraps current notes; the same generation preserves its backlog.
pub(crate) fn configure_generation(conn: &Connection, generation: &str) -> Result<()> {
    let (previous, bootstrapped, suppress): (String,i64,i64) = conn.query_row(
        "SELECT b.generation,c.bootstrapped,c.suppress FROM sync_config_binding b JOIN sync_host_control c ON c.id=b.id WHERE b.id=1",
        [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    if previous == generation && bootstrapped == 1 && suppress == 0 {
        return Ok(());
    }
    configure_binding(conn, previous != generation, Some(generation))
}

fn configure_binding(conn: &Connection, fresh: bool, generation: Option<&str>) -> Result<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let r = (|| -> rusqlite::Result<()> {
        if fresh {
            conn.execute("DELETE FROM sync_journal", [])?;
            conn.execute("DELETE FROM sync_applied", [])?;
            conn.execute("DELETE FROM sync_attachment_manifests", [])?;
            conn.execute(
                "UPDATE sync_host_control SET bootstrapped = 0 WHERE id = 1",
                [],
            )?;
        }
        conn.execute("UPDATE sync_host_control SET suppress = 0 WHERE id = 1", [])?;
        let boot: i64 = conn.query_row(
            "SELECT bootstrapped FROM sync_host_control WHERE id = 1",
            [],
            |r| r.get(0),
        )?;
        if boot == 0 {
            // One-time snapshot of pre-existing rows, in the same transaction
            // as the marker so it can never run twice.
            conn.execute(
                "INSERT INTO sync_journal(kind, id, deleted) SELECT 'note', id, 0 FROM notes_meta",
                [],
            )?;
            conn.execute(
                "INSERT INTO sync_journal(kind, id, deleted) SELECT 'notebook', id, 0 FROM notebooks",
                [],
            )?;
            crate::named_version_sync::bootstrap(conn)?;
            // Only decisions made on this device; an empty device sends none.
            conn.execute(
                "INSERT INTO sync_journal(kind, id, deleted) SELECT 'setting', key, 0 FROM settings",
                [],
            )?;
            conn.execute(
                "UPDATE sync_host_control SET bootstrapped = 1 WHERE id = 1",
                [],
            )?;
        }
        if let Some(generation) = generation {
            conn.execute(
                "UPDATE sync_config_binding SET generation=?1 WHERE id=1",
                [generation],
            )?;
        }
        Ok(())
    })();
    finish(conn, r)
}

/// Drop journal rows already covered by the durable sync checkpoint (a crash
/// after staging but before pruning).
pub fn prune_to_checkpoint(conn: &Connection, checkpoint: u64) -> Result<()> {
    if checkpoint > 0 {
        conn.execute(
            "DELETE FROM sync_journal WHERE seq <= ?1",
            params![checkpoint as i64],
        )?;
    }
    Ok(())
}

/// One row of the change journal.
#[derive(Debug, Clone)]
pub struct JournalRow {
    pub seq: i64,
    pub kind: String,
    pub id: String,
    /// Informational: staging re-reads the current row, so a later restoration
    /// is captured even when this earlier delete was coalesced.
    #[allow(dead_code)]
    pub deleted: bool,
}

/// Read the next bounded batch of journal rows, ascending by seq.
pub fn journal_batch(conn: &Connection, after: i64, limit: i64) -> Result<Vec<JournalRow>> {
    let mut stmt = conn.prepare(
        "SELECT seq, kind, id, deleted FROM sync_journal WHERE seq > ?1 ORDER BY seq LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![after, limit], |r| {
        Ok(JournalRow {
            seq: r.get(0)?,
            kind: r.get(1)?,
            id: r.get(2)?,
            deleted: r.get::<_, i64>(3)? != 0,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Collapse a batch to at most one entry per (kind, id), keeping the highest
/// seq. Returned ascending by that seq so callers advance the sync checkpoint
/// monotonically and never skip an id.
pub fn coalesce(rows: &[JournalRow]) -> Vec<(String, String, i64)> {
    let mut latest: std::collections::BTreeMap<(String, String), i64> =
        std::collections::BTreeMap::new();
    for row in rows {
        let key = (row.kind.clone(), row.id.clone());
        let e = latest.entry(key).or_insert(row.seq);
        if row.seq > *e {
            *e = row.seq;
        }
    }
    let mut out: Vec<(String, String, i64)> = latest
        .into_iter()
        .map(|((kind, id), seq)| (kind, id, seq))
        .collect();
    out.sort_by_key(|(_, _, seq)| *seq);
    out
}

/// Delete journal rows up to and including `upto` after they were staged.
pub fn prune_journal(conn: &Connection, upto: i64) -> Result<()> {
    conn.execute("DELETE FROM sync_journal WHERE seq <= ?1", params![upto])?;
    Ok(())
}

/// Read the current state of one entity and build the sync payload. Bodies are
/// read one at a time here. A missing row becomes a tombstone, which also
/// covers hard deletion of a trashed note.
pub fn build_raw_entity(conn: &Connection, kind: &str, id: &str) -> Result<Entity> {
    match kind {
        "namedversion" => crate::named_version_sync::build(conn,id),
        "note" => {
            let row = conn
                .query_row(
                    "SELECT m.title, m.notebook_id, m.tags, m.favorite, m.pinned, m.archived, \
                            m.trashed, m.color, m.reminder_at, m.created_at, m.updated_at, \
                            m.revision, \
                            COALESCE(b.content, ''), COALESCE(b.text, ''), m.content_format, m.reminder_repeat_hours, m.readonly, m.edited_at \
                     FROM notes_meta m LEFT JOIN notes_body b ON b.note_id = m.id \
                     WHERE m.id = ?1",
                    params![id],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, Option<String>>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, i64>(3)? != 0,
                            r.get::<_, i64>(4)? != 0,
                            r.get::<_, i64>(5)? != 0,
                            r.get::<_, i64>(6)? != 0,
                            r.get::<_, Option<String>>(7)?,
                            r.get::<_, Option<i64>>(8)?,
                            r.get::<_, i64>(9)?,
                            r.get::<_, i64>(10)?,
                            r.get::<_, i64>(11)?,
                            r.get::<_, String>(12)?,
                            r.get::<_, String>(13)?,
                            r.get::<_, String>(14)?,
                            r.get::<_, Option<i64>>(15)?,
                            r.get::<_, i64>(16)? != 0,
                            r.get::<_, i64>(17)?,
                        ))
                    },
                )
                .optional()?;
            match row {
                Some((
                    title,
                    nb,
                    tags,
                    fav,
                    pin,
                    arc,
                    trash,
                    color,
                    reminder_at,
                    created,
                    updated,
                    rev,
                    content,
                    text,
                    content_format,
                    repeat_hours,
                    readonly,
                    edited,
                )) => {
                    let tags: Value = serde_json::from_str(&tags).unwrap_or_else(|_| json!([]));
                    // Full membership list, primary first, so peers that parse
                    // notebook_ids reproduce the exact relationship set.
                    let memberships = notebook_membership::load(conn, id)?;
                    let mut entity = Entity::new(
                        EntityKind::Note,
                        id,
                        json!({
                            "id": id, "title": title, "content": content, "text": text, "content_format":content_format,
                            "notebook_id": nb, "notebook_ids": memberships, "tags": tags, "favorite": fav, "pinned": pin,
                            "archived": arc, "trashed": trash, "color": color,
                            "readonly": readonly,
                            "reminder_at": reminder_at, "reminder_repeat_hours":repeat_hours,
                            "created_at": created, "updated_at": updated, "edited_at": edited, "revision": rev,
                        }),
                    );
                    // Locked bodies travel as ciphertext only; the body above is empty.
                    let locked = vault::locked_body(conn, id)?;
                    entity.data["locked"] = json!(locked.is_some());
                    if let Some(body) = locked {
                        entity.data["locked_body"] = serde_json::to_value(body)
                            .map_err(|e| RuntimeError::internal(e.to_string()))?;
                    }
                    Ok(entity)
                }
                None => Ok(Entity {
                    kind: EntityKind::Note,
                    id: id.to_string(),
                    data: json!({ "id": id }),
                    deleted: true,
                }),
            }
        }
        "notebook" => {
            let row = conn
                .query_row(
                    "SELECT name,color,parent_id,description,deleted_at,deleted_by,cover FROM notebooks WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get::<_, String>(0)?,r.get::<_, Option<String>>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?,
                        r.get::<_,Option<i64>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?)),
                )
                .optional()?;
            match row {
                // deleted_at/by and cover are always sent; null means live / no
                // cover. Older peers ignore them.
                Some((name, color, parent, description, deleted_at, deleted_by, cover)) => Ok(Entity::new(
                    EntityKind::Notebook,
                    id,
                    json!({ "id": id, "name": name, "color": color,"parent_id":parent,"description":description,
                        "deleted_at":deleted_at,"deleted_by":deleted_by,"cover":notebook_cover::to_value(cover) }),
                )),
                None => Ok(Entity {
                    kind: EntityKind::Notebook,
                    id: id.to_string(),
                    data: json!({ "id": id }),
                    deleted: true,
                }),
            }
        }
        "setting" => Ok(match settings::stored(conn, id)?.filter(|_| settings::is_known_key(id)) {
            Some((value, updated_at)) => Entity::new(
                EntityKind::Setting,
                id,
                json!({ "value": value, "updated_at": updated_at }),
            ),
            // Unreachable for real rows; a tombstone keeps the journal moving.
            None => Entity::new(EntityKind::Setting, id, json!({})).tombstone(),
        }),
        other => Err(RuntimeError::internal(format!("bad journal kind {other}"))),
    }
}

/// Apply one resolved incoming change inside a single host transaction.
///
/// * replay (event id already in `sync_applied`) -> no-op
/// * stale (sync-core already had a dominating version) -> record + skip content
/// * otherwise write the canonical row and, when a concurrent edit lost, the
///   deterministic conflict copy. Triggers stay suppressed for the whole write.
#[cfg_attr(not(test), allow(dead_code))]
pub fn apply_one(conn: &Connection, inc: &Incoming) -> Result<()> {
    apply_one_sealed(conn, inc, None)
}

/// Seals a plaintext named-version row `(key_id, note_id, row)` for the vault;
/// `Ok(None)` when this device has not unlocked that key.
pub type Sealer<'a> = Option<&'a dyn Fn(&str, &str, &Value) -> Result<Option<Value>>>;

/// [`apply_one`] with access to unlocked vault keys, so plaintext snapshots
/// meeting a locked note are moved into the vault instead of waiting.
pub fn apply_one_sealed(conn: &Connection, inc: &Incoming, sealer: Sealer) -> Result<()> {
    if is_applied(conn, &inc.event_id)? {
        return Ok(());
    }
    if inc.stale {
        conn.execute(
            "INSERT OR IGNORE INTO sync_applied(event_id) VALUES(?1)",
            params![inc.event_id],
        )?;
        return Ok(());
    }

    conn.execute_batch("BEGIN IMMEDIATE;")?;
    match write_incoming(conn, inc, sealer) {
        Ok(()) => {
            if let Err(e) = conn.execute_batch("COMMIT;") {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(e.into());
            }
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

/// The body of `apply_one`'s transaction, with triggers suppressed.
fn write_incoming(conn: &Connection, inc: &Incoming, sealer: Sealer) -> Result<()> {
    conn.execute("UPDATE sync_host_control SET suppress = 1 WHERE id = 1", [])?;
    // Named snapshots merge in place (never a conflict copy of a snapshot).
    let named = inc.conflict.as_ref().filter(|c| c.winner.kind == EntityKind::NamedVersion);
    let merged = match named {
        Some(conflict) => Some(crate::named_version_sync::merge(conflict)),
        None => inc.conflict.as_ref().and_then(merge_relations),
    };
    apply_entity(conn, merged.as_ref().unwrap_or(&inc.entity), sealer)?;
    // The union exists only here; send it so the sync snapshot and peers
    // hold it too. Once both sides agree the union equals the winner and
    // nothing more is sent.
    if let (Some(merged), Some(conflict)) = (&merged, &inc.conflict) {
        if merged.data != conflict.winner.data || merged.deleted != conflict.winner.deleted {
            republish(conn, merged.kind.as_str(), &normalize_id(&merged.id))?;
        }
    }
    if let Some(conflict) = &inc.conflict {
        // A losing deletion is not a value to preserve: skipping the copy
        // prevents a phantom empty note from appearing.
        if merged.is_none() && !conflict.loser.deleted {
            apply_conflict_copy(conn, conflict)?;
        }
    }
    conn.execute(
        "INSERT OR IGNORE INTO sync_applied(event_id) VALUES(?1)",
        params![inc.event_id],
    )?;
    conn.execute("UPDATE sync_host_control SET suppress = 0 WHERE id = 1", [])?;
    Ok(())
}

/// Original notebooks/tags are separate relation items, so concurrent changes
/// to them converge instead of duplicating the note. When both sides carry the
/// same title and body, keep the winner's other fields (original last-write
/// rule) and add the loser's relations. Both replicas see the same winner and
/// loser, so they compute the same result. Returns None to keep the copy rule.
fn merge_relations(conflict: &Conflict) -> Option<Entity> {
    let (winner, loser) = (&conflict.winner, &conflict.loser);
    if winner.kind != EntityKind::Note || winner.deleted || loser.deleted {
        return None;
    }
    // Payloads from older apps (no membership array or vault field) keep the
    // copy rule those apps also use, so mixed fleets do not diverge.
    for side in [winner, loser] {
        if !side.data.get("notebook_ids").is_some_and(Value::is_array) || side.data.get("locked").is_none() {
            return None;
        }
    }
    if ["title", "content", "text", "content_format", "locked", "locked_body"]
        .iter()
        .any(|key| winner.data.get(*key) != loser.data.get(*key))
    {
        return None;
    }
    let mut merged = winner.clone();
    if let Some(notebooks) = relation_union(winner, loser, "notebook_ids") {
        set_merged_notebooks(&mut merged, notebooks)?;
    }
    if let Some(tags) = relation_union(winner, loser, "tags") {
        if tags.len() > limits::MAX_TAGS {
            return None;
        }
        merged.data["tags"] = Value::Array(tags);
    }
    Some(merged)
}

fn relation_union(winner: &Entity, loser: &Entity, key: &str) -> Option<Vec<Value>> {
    let mut out = winner.data.get(key)?.as_array()?.clone();
    for value in loser.data.get(key)?.as_array()? {
        if !out.contains(value) {
            out.push(value.clone());
        }
    }
    Some(out)
}

fn set_merged_notebooks(merged: &mut Entity, mut notebooks: Vec<Value>) -> Option<()> {
    if notebooks.len() > notebook_membership::MAX_NOTEBOOKS_PER_NOTE {
        return None;
    }
    // Canonical order: winner's primary first, the rest by id.
    if notebooks.len() > 1 {
        notebooks[1..].sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }
    merged.data["notebook_id"] = notebooks.first().cloned().unwrap_or(Value::Null);
    merged.data["notebook_ids"] = Value::Array(notebooks);
    Some(())
}

fn is_applied(conn: &Connection, event_id: &str) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sync_applied WHERE event_id = ?1",
        params![event_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn apply_entity(conn: &Connection, entity: &Entity, sealer: Sealer) -> Result<()> {
    match entity.kind {
        EntityKind::Note => apply_note(conn, entity, sealer),
        EntityKind::Notebook => apply_notebook(conn, entity),
        EntityKind::Setting => apply_setting(conn, entity),
        EntityKind::NamedVersion => crate::named_version_sync::apply(conn, entity, sealer),
    }
}

/// Merge by decision time, so arrival order and sync-core's staging-time
/// winner cannot replace a newer choice. Conflicts merge both sides.
fn apply_setting(conn: &Connection, entity: &Entity) -> Result<()> {
    if !settings::is_known_key(&entity.id) {
        return Err(RuntimeError::internal(format!("unknown setting {}", entity.id)));
    }
    if entity.deleted {
        return Ok(());
    }
    let value = match entity.data.get("value") {
        Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.as_str()),
        _ => return Err(RuntimeError::internal("incoming setting value is invalid")),
    };
    let updated_at = model::opt_timestamp(&entity.data, "updated_at")?
        .ok_or_else(|| RuntimeError::internal("incoming setting requires updated_at"))?;
    // Another device deleted a vault key this replica's locked notes still
    // need: keep the envelope and republish it as a newer decision.
    if let (None, Some(key_id)) = (value, entity.id.strip_prefix(settings::VAULT_KEY_PREFIX)) {
        let in_use: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM locked_notes WHERE key_id=?1)", [key_id], |r| r.get(0))?;
        if let (true, Some((Some(envelope), at))) = (in_use, settings::stored(conn, &entity.id)?) {
            settings::merge(conn, &entity.id, Some(&envelope), updated_at.max(at).saturating_add(1))?;
            republish(conn, "setting", &entity.id)?;
            return Ok(());
        }
    }
    settings::merge(conn, &entity.id, value, updated_at)?;
    Ok(())
}

/// Remote applies run with journal triggers suppressed; queue a local
/// change explicitly when this replica must answer with its own state.
fn republish(conn: &Connection, kind: &str, id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_journal(kind, id, deleted) VALUES(?1, ?2, 0)",
        params![kind, id],
    )?;
    Ok(())
}

/// Map sync-core's `{id}~conflict~{device}~{counter}` copy ids to a stable
/// UUIDv5 so every replica inserts the same row id.
pub fn normalize_id(id: &str) -> String {
    if id.contains("~conflict~") {
        Uuid::new_v5(&CONFLICT_NAMESPACE, id.as_bytes()).to_string()
    } else {
        id.to_string()
    }
}

#[derive(Debug, Deserialize)]
struct NoteData {
    #[serde(default)]
    readonly: Option<bool>,
    #[serde(default)]
    content_format: Option<String>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    notebook_id: Option<String>,
    #[serde(skip)]
    notebook_id_present: bool,
    /// Multi-notebook memberships, primary first. Omitted (legacy peer)
    /// preserves existing memberships; `[]` removes all. Explicit null and
    /// duplicates are rejected up front by `parse_ids` in `parse_note`.
    #[serde(default)]
    notebook_ids: Option<Vec<String>>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    trashed: bool,
    #[serde(default)]
    color: Option<String>,
    /// UTC ms reminder. Payloads from before the field existed read back None
    /// and are stored as NULL, never as a reset of an existing local value
    /// beyond what the winning payload itself carries.
    #[serde(default)]
    reminder_at: Option<i64>,
    #[serde(default)]
    reminder_repeat_hours: Option<i64>,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
    #[serde(default)]
    edited_at: Option<i64>,
    #[serde(default = "default_revision")]
    revision: i64,
    /// Omitted by older peers: keep the local vault state.
    #[serde(default)]
    locked: Option<bool>,
    #[serde(default)]
    locked_body: Option<vault::LockedBody>,
}

fn default_revision() -> i64 {
    1
}

#[derive(Debug, Deserialize)]
struct NotebookData {
    #[serde(default)]
    name: String,
    #[serde(default)]
    color: Option<String>,
}

fn parse_note(data: &Value) -> Result<NoteData> {
    model::opt_bool(data, "readonly")?;
    model::opt_timestamp(data, "edited_at")?;
    // Strict membership shape before serde would relax a JSON null into None:
    // omitted preserves, null/array-type/limit/duplicate/primary-mismatch are
    // all rejected here (parse_ids, unlike serde, treats null as invalid).
    notebook_membership::parse_ids(data)
        .map_err(|e| RuntimeError::internal(format!("incoming {e}")))?;
    let mut note: NoteData = serde_json::from_value(data.clone())
        .map_err(|e| RuntimeError::internal(format!("invalid note payload: {e}")))?;
    note.notebook_id_present = data.get("notebook_id").is_some();
    Ok(note)
}

fn validate_note(data: &NoteData) -> Result<()> {
    if let Some(format) = &data.content_format {
        inkism_engine::source_format::validate(format)?;
    }
    if data.title.chars().count() > limits::MAX_TITLE_CHARS {
        return Err(RuntimeError::internal("incoming title too long"));
    }
    ops_notes::check_field_size("content", &data.content)?;
    ops_notes::check_field_size("text", &data.text)?;
    ops_notes::check_tags(&data.tags)?;
    if let Some(color) = &data.color {
        if color.chars().count() > limits::MAX_COLOR_CHARS {
            return Err(RuntimeError::internal("incoming color too long"));
        }
    }
    if let Some(h) = data.reminder_repeat_hours {
        model::check_reminder_repeat(h)
            .map_err(|e| RuntimeError::internal(format!("incoming {e}")))?;
    }
    if let Some(reminder_at) = data.reminder_at {
        model::check_reminder_at(reminder_at)
            .map_err(|e| RuntimeError::internal(format!("incoming {e}")))?;
    }
    if let Some(nb) = &data.notebook_id {
        if !ids::valid_id(nb) {
            return Err(RuntimeError::internal("incoming notebook_id is invalid"));
        }
    }
    if let Some(memberships) = &data.notebook_ids {
        // parse_ids only checked array shape; the stored ids must be
        // UUID-shaped, unique and within the per-note limit.
        notebook_membership::validate_ids(memberships)
            .map_err(|e| RuntimeError::internal(format!("incoming {e}")))?;
    }
    match (data.locked, &data.locked_body) {
        (Some(true), Some(body)) if data.content.is_empty() && data.text.is_empty() => vault::validate(body)?,
        (Some(true), _) => return Err(RuntimeError::internal("incoming locked note is invalid")),
        _ => {}
    }
    Ok(())
}

fn apply_note(conn: &Connection, entity: &Entity, sealer: Sealer) -> Result<()> {
    let id = normalize_id(&entity.id);
    if !ids::valid_id(&id) {
        return Err(RuntimeError::internal("incoming note id is invalid"));
    }
    if entity.deleted {
        delete_note_row(conn, &id)?;
        return Ok(());
    }
    let data = parse_note(&entity.data)?;
    validate_note(&data)?;
    // A remote lock must not leave plaintext named snapshots behind: seal
    // local ones (for example named offline) or wait for the vault key.
    if let (Some(true), Some(body)) = (data.locked, &data.locked_body) {
        crate::named_version_sync::seal_local_plaintext(conn, &id, &body.key_id, sealer)?;
    }
    write_note(conn, &id, &data, None, false)
}

fn delete_note_row(conn: &Connection, id: &str) -> Result<()> {
    // FK cascade removes body + history; the worker removes the search row.
    conn.execute("DELETE FROM notes_meta WHERE id = ?1", params![id])?;
    indexer::enqueue(conn, id, i64::MAX)?;
    Ok(())
}

/// Insert or update a note row with raw validated SQL. On update the local
/// revision is raised above both sides so a foreground editor holding the old
/// revision gets a conflict instead of silently losing the remote change.
fn write_note(
    conn: &Connection,
    id: &str,
    data: &NoteData,
    title_override: Option<String>,
    is_copy: bool,
) -> Result<()> {
    // An older peer does not know the vault: never let its plaintext replace
    // or sit beside a locked body. The record stays pending, not lost.
    if data.locked.is_none()
        && (!data.content.is_empty() || !data.text.is_empty())
        && vault::is_locked(conn, id)?
    {
        return Err(RuntimeError::internal("plaintext write from an older app onto a locked note"));
    }
    let title = title_override.unwrap_or_else(|| data.title.clone());
    let tags = ops_notes::serialize_tags(Some(&data.tags))?;
    let preview = model::preview_of(&data.text, &title);
    let current: Option<i64> = conn
        .query_row(
            "SELECT revision FROM notes_meta WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;

    let content_format = data.content_format.as_deref().unwrap_or("html");
    let notebook_id = incoming_primary(conn, id, data, current.is_some())?;
    if current.is_some() && data.content_format.is_none() {
        check_legacy_format(conn, id)?;
    }
    match current {
        None => {
            let revision = if is_copy { 1 } else { data.revision.max(1) };
            conn.execute(
                "INSERT INTO notes_meta(id, seq, title, preview, notebook_id, tags, favorite, \
                     pinned, archived, trashed, color, reminder_at, created_at, updated_at, \
                     revision, edited_at) \
                 VALUES(?1, NULL, ?2, ?3, ?4, ?5, \
                        ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    id,
                    title,
                    preview,
                    notebook_id,
                    tags,
                    data.favorite as i64,
                    data.pinned as i64,
                    data.archived as i64,
                    data.trashed as i64,
                    data.color,
                    data.reminder_at,
                    data.created_at,
                    data.updated_at,
                    revision,
                    data.edited_at.unwrap_or(data.updated_at),
                ],
            )?;
            conn.execute(
                "UPDATE notes_meta SET reminder_repeat_hours=?1,readonly=?3 WHERE id=?2",
                params![data.reminder_repeat_hours, id, data.readonly.unwrap_or(false)],
            )?;
            conn.execute(
                "INSERT OR REPLACE INTO notes_body(note_id, content, text) VALUES(?1, ?2, ?3)",
                params![id, data.content, data.text],
            )?;
            conn.execute(
                "UPDATE notes_meta SET content_format=?1 WHERE id=?2",
                params![content_format, id],
            )?;
            indexer::enqueue(conn, id, revision)?;
        }
        Some(local_rev) => {
            ops_notes::snapshot_stored_history(conn, id)?;
            let revision = local_rev.max(data.revision) + 1;
            conn.execute(
                "UPDATE notes_meta SET title = ?1, preview = ?2, notebook_id = ?3, tags = ?4, \
                     favorite = ?5, pinned = ?6, archived = ?7, trashed = ?8, color = ?9, \
                     reminder_at = ?10, created_at = ?11, updated_at = ?12, revision = ?13, edited_at = ?15 \
                 WHERE id = ?14",
                params![
                    title,
                    preview,
                    notebook_id,
                    tags,
                    data.favorite as i64,
                    data.pinned as i64,
                    data.archived as i64,
                    data.trashed as i64,
                    data.color,
                    data.reminder_at,
                    data.created_at,
                    data.updated_at,
                    revision,
                    id,
                    data.edited_at.unwrap_or(data.updated_at),
                ],
            )?;
            conn.execute(
                "UPDATE notes_meta SET reminder_repeat_hours=?1,readonly=COALESCE(?3,readonly) WHERE id=?2",
                params![data.reminder_repeat_hours, id, data.readonly],
            )?;
            conn.execute(
                "INSERT OR IGNORE INTO notes_body(note_id, content, text) VALUES(?1, '', '')",
                params![id],
            )?;
            conn.execute(
                "UPDATE notes_body SET content = ?1, text = ?2 WHERE note_id = ?3",
                params![data.content, data.text, id],
            )?;
            conn.execute(
                "UPDATE notes_meta SET content_format=?1 WHERE id=?2",
                params![content_format, id],
            )?;
            indexer::enqueue(conn, id, revision)?;
        }
    }
    // A payload carrying notebook_ids replaces the primary and the whole
    // membership set exactly. require_existing=false: a notebook may
    // legitimately arrive after its note, so the reference is preserved
    // without a foreign key. Legacy payloads (no array) keep the plain SQL
    // above, where the schema-11 triggers initialize a new note's single
    // membership and leave an existing note's additional memberships intact.
    if let Some(memberships) = &data.notebook_ids {
        notebook_membership::replace(conn, id, memberships, false)?;
    }
    match (data.locked, &data.locked_body) {
        (Some(true), Some(body)) => vault::store_locked(conn, id, body)?,
        (Some(false), _) if vault::is_locked(conn, id)? => {
            conn.execute("DELETE FROM locked_notes WHERE note_id=?1", [id])?;
            conn.execute("UPDATE notes_meta SET locked=0 WHERE id=?1", [id])?;
        }
        _ => {}
    }
    Ok(())
}

fn incoming_primary(
    conn: &Connection,
    id: &str,
    data: &NoteData,
    exists: bool,
) -> Result<Option<String>> {
    Ok(if let Some(memberships) = &data.notebook_ids {
        memberships.first().cloned()
    } else if !data.notebook_id_present && exists {
        // A genuinely omitted legacy primary must not clear extra memberships.
        conn.query_row("SELECT notebook_id FROM notes_meta WHERE id=?1", [id], |row|row.get::<_,Option<String>>(0))?
    } else { data.notebook_id.clone() })
}

fn check_legacy_format(conn: &Connection, id: &str) -> Result<()> {
    let format: String = conn.query_row(
        "SELECT content_format FROM notes_meta WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    if format != "html" {
        return Err(RuntimeError::config(
            "incoming legacy write omitted source format",
        ));
    }
    Ok(())
}

fn apply_notebook(conn: &Connection, entity: &Entity) -> Result<()> {
    let id = normalize_id(&entity.id);
    if !ids::valid_id(&id) {
        return Err(RuntimeError::internal("incoming notebook id is invalid"));
    }
    if entity.deleted {
        conn.execute("DELETE FROM notebooks WHERE id = ?1", params![id])?;
        // Notes must never be orphaned to a missing notebook.
        inkism_engine::ops_meta::detach_notebook(conn, &id)?;
        return Ok(());
    }
    let data: NotebookData = serde_json::from_value(entity.data.clone())
        .map_err(|e| RuntimeError::internal(format!("invalid notebook payload: {e}")))?;
    if data.name.trim().is_empty() || data.name.chars().count() > limits::MAX_NOTEBOOK_NAME_CHARS {
        return Err(RuntimeError::internal("incoming notebook name is invalid"));
    }
    if let Some(color) = &data.color {
        if color.chars().count() > limits::MAX_COLOR_CHARS {
            return Err(RuntimeError::internal("incoming notebook color too long"));
        }
    }
    let (parent,description) = inkism_engine::ops_meta::notebook_details(conn,&id,&entity.data,false)?;
    // Omitted (older peer) keeps the local trash state.
    let (deleted_at, deleted_by) = notebook_trash::parse_state(&entity.data, notebook_trash::stored_state(conn, &id)?)?;
    // Omitted (older peer) keeps the local cover; null removes it.
    let cover = notebook_cover::resolve(conn, &id, &entity.data)?;
    conn.execute(
        "INSERT INTO notebooks(id,name,color,parent_id,description,deleted_at,deleted_by,cover) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) \
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,parent_id=excluded.parent_id,description=excluded.description,\
         deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,cover=excluded.cover",
        params![id,data.name,data.color,parent,description,deleted_at,deleted_by,cover],
    )?;
    Ok(())
}

/// Insert the losing side of a conflict as a fresh, deterministic entity.
fn apply_conflict_copy(conn: &Connection, conflict: &Conflict) -> Result<()> {
    let copy_id = normalize_id(&conflict.copy_id);
    if !ids::valid_id(&copy_id) {
        return Err(RuntimeError::internal("conflict copy id is invalid"));
    }
    match conflict.copy.kind {
        EntityKind::Setting => apply_setting(conn, &conflict.loser),
        // Resolved by named_version_sync::merge; snapshots are never copied.
        EntityKind::NamedVersion => Ok(()),
        EntityKind::Note => {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM notes_meta WHERE id = ?1",
                params![copy_id],
                |r| r.get(0),
            )?;
            if exists > 0 {
                return Ok(()); // already materialized on this replica
            }
            let mut data = parse_note(&conflict.copy.data)?;
            data.title = format!("{}{}", data.title, CONFLICT_SUFFIX);
            validate_note(&data)?;
            write_note(conn, &copy_id, &data, None, true)
        }
        EntityKind::Notebook => {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM notebooks WHERE id = ?1",
                params![copy_id],
                |r| r.get(0),
            )?;
            if exists > 0 {
                return Ok(());
            }
            let mut data: NotebookData = serde_json::from_value(conflict.copy.data.clone())
                .map_err(|e| RuntimeError::internal(format!("invalid notebook payload: {e}")))?;
            data.name = format!("{}{}", data.name, CONFLICT_SUFFIX);
            let (parent,description) = inkism_engine::ops_meta::notebook_details(conn,&copy_id,&conflict.copy.data,false)?;
            let (deleted_at, deleted_by) = notebook_trash::parse_state(&conflict.copy.data, (None, None))?;
            let cover = notebook_cover::arg(&conflict.copy.data)?.flatten();
            conn.execute(
                "INSERT OR IGNORE INTO notebooks(id,name,color,parent_id,description,deleted_at,deleted_by,cover) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![copy_id,data.name,data.color,parent,description,deleted_at,deleted_by,cover],
            )?;
            Ok(())
        }
    }
}

fn finish(conn: &Connection, r: rusqlite::Result<()>) -> Result<()> {
    match r {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use inkism_engine::Engine;

    fn open_host() -> (tempfile::TempDir, Engine) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.db");
        let engine = Engine::open(path.to_str().unwrap()).unwrap();
        ensure_schema(engine.connection()).unwrap();
        (dir, engine)
    }

    fn note_entity(id: &str, text: &str) -> Entity {
        Entity::new(
            EntityKind::Note,
            id,
            json!({
                "id": id, "title": "t", "content": format!("<p>{text}</p>"),
                "text": text, "tags": [], "created_at": 1, "updated_at": 2, "revision": 1,
            }),
        )
    }

    fn incoming(event_id: &str, entity: Entity) -> Incoming {
        Incoming {
            event_id: event_id.to_string(),
            seq: 1,
            entity,
            conflict: None,
            stale: false,
        }
    }

    fn revision(conn: &Connection, id: &str) -> Option<i64> {
        conn.query_row(
            "SELECT revision FROM notes_meta WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
    }

    fn journal_len(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM sync_journal", [], |r| r.get(0))
            .unwrap()
    }

    /// All membership rows for one note, sorted (primary-first is asserted
    /// separately via `build_raw_entity`).
    fn memberships(conn: &Connection, id: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT notebook_id FROM note_notebooks WHERE note_id = ?1 ORDER BY notebook_id")
            .unwrap();
        stmt.query_map([id], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap()
    }

    fn primary_notebook(conn: &Connection, id: &str) -> Option<String> {
        conn.query_row(
            "SELECT notebook_id FROM notes_meta WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn conflict_id_maps_deterministically() {
        let a = normalize_id("11111111-1111-1111-1111-111111111111~conflict~dev-a~3");
        let b = normalize_id("11111111-1111-1111-1111-111111111111~conflict~dev-a~3");
        assert_eq!(a, b);
        assert!(Uuid::parse_str(&a).is_ok());
        assert_ne!(a, normalize_id("normal-id"));
        assert_eq!(normalize_id("normal-id"), "normal-id");
    }

    #[test]
    fn replay_is_skipped_and_local_edits_still_journal() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "22222222-2222-2222-2222-222222222222";

        let inc = incoming("ev-1", note_entity(id, "remote"));
        apply_one(conn, &inc).unwrap();
        assert_eq!(revision(conn, id), Some(1));
        let after_first = journal_len(conn);
        assert_eq!(after_first, 0, "remote apply must stay suppressed");

        // Crash between host commit and sync ack -> replay is a no-op.
        apply_one(conn, &inc).unwrap();
        assert_eq!(revision(conn, id), Some(1));

        // A later remote event updates and bumps revision above the local one.
        let mut update = note_entity(id, "remote-2");
        update.data["revision"] = json!(5);
        apply_one(conn, &incoming("ev-2", update)).unwrap();
        assert_eq!(revision(conn, id), Some(6));
        let baseline = ops_notes::revision_body(conn, &json!({"id":id,"revision":1})).unwrap();
        assert_eq!(baseline["content"], "<p>remote</p>");
        apply_one(conn, &incoming("ev-2", note_entity(id, "remote-2"))).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM history WHERE note_id=?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1, "replayed sync must not duplicate history");

        // A normal engine save does journal, so it will be pushed.
        let before = journal_len(conn);
        let resp = engine.execute(json!({ "op": "save", "note": { "id": id, "text": "local" } }));
        assert_eq!(resp["ok"], true, "local save failed: {resp}");
        assert!(journal_len(conn) > before, "local edit did not journal");
    }

    #[test]
    fn metadata_patch_journals_only_committed_revision() {
        let (_dir, engine) = open_host();
        let n = engine.execute(json!({"op":"save","note":{"content":"<p>보존</p>","text":"보존"}}));
        let before = journal_len(engine.connection());
        let req = json!({"op":"patch","id":n["data"]["id"],"revision":1,
            "summary_only":true,"changes":{"favorite":true}});
        let result = engine.execute(req.clone());
        assert_eq!(result["ok"], true);
        assert!(result["data"].get("content").is_none());
        let committed = journal_len(engine.connection());
        assert!(committed > before);
        assert_eq!(engine.execute(req)["ok"], false);
        assert_eq!(journal_len(engine.connection()), committed);
        let stored = engine.execute(json!({"op":"get","id":n["data"]["id"]}));
        assert_eq!(stored["data"]["content"], "<p>보존</p>");
    }

    #[test]
    fn sync_preserves_edit_time_and_legacy_fallback_without_accepting_invalid_dates() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "34343434-3434-3434-3434-343434343434";
        let mut entity = note_entity(id, "remote");
        entity.data["edited_at"] = json!(1);
        apply_one(conn, &incoming("edit-time-create", entity.clone())).unwrap();
        assert_eq!(build_raw_entity(conn, "note", id).unwrap().data["edited_at"], 1);
        entity.data["updated_at"] = json!(3);
        apply_one(conn, &incoming("edit-time-metadata", entity.clone())).unwrap();
        let summary = ops_notes::load_summary(conn, id).unwrap();
        assert_eq!((summary.edited_at, summary.updated_at), (1, 3));
        for (index, value) in [Value::Null, json!(-1), json!(1.5), json!("1")].into_iter().enumerate() {
            entity.data["edited_at"] = value;
            assert!(apply_one(conn, &incoming(&format!("edit-time-invalid-{index}"), entity.clone())).is_err());
            assert_eq!(ops_notes::load_summary(conn, id).unwrap().edited_at, 1);
        }
        entity.data.as_object_mut().unwrap().remove("edited_at");
        apply_one(conn, &incoming("edit-time-legacy", entity)).unwrap();
        assert_eq!(ops_notes::load_summary(conn, id).unwrap().edited_at, 3);
    }

    #[test]
    fn readonly_sync_roundtrip_preserves_legacy_state_and_rejects_invalid_flags() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "33333333-3333-3333-3333-333333333333";
        let mut entity = note_entity(id, "remote");
        entity.data["readonly"] = json!(true);
        apply_one(conn, &incoming("readonly-create", entity.clone())).unwrap();
        assert_eq!(build_raw_entity(conn, "note", id).unwrap().data["readonly"], true);
        assert_eq!(engine.execute(json!({"op":"save","note":{"id":id,"text":"blocked"}}))["ok"], false);
        entity.data.as_object_mut().unwrap().remove("readonly");
        apply_one(conn, &incoming("readonly-legacy", entity.clone())).unwrap();
        assert!(ops_notes::load_summary(conn, id).unwrap().readonly);
        for (event, flag) in [("readonly-null", Value::Null), ("readonly-string", json!("false"))] {
            entity.data["readonly"] = flag;
            assert!(apply_one(conn, &incoming(event, entity.clone())).is_err());
            assert!(ops_notes::load_summary(conn, id).unwrap().readonly);
        }
        entity.data["readonly"] = json!(false);
        apply_one(conn, &incoming("readonly-clear", entity)).unwrap();
        assert!(!ops_notes::load_summary(conn, id).unwrap().readonly);
        assert_eq!(build_raw_entity(conn, "note", id).unwrap().data["readonly"], false);
        assert_eq!(engine.execute(json!({"op":"save","note":{"id":id,"text":"editable"}}))["ok"], true);
    }

    #[test]
    fn document_splice_journals_only_committed_changes() {
        let (_dir, engine) = open_host();
        let n = engine.execute(json!({"op":"save","note":{"content":"<p>앞</p>","text":"앞"}}));
        assert_eq!(n["ok"], true);
        let before = journal_len(engine.connection());
        let req = json!({"op":"document_splice","id":n["data"]["id"],"revision":1,
            "content":{"start":0,"expected":"<p>앞</p>","replacement":"<p>뒤</p>"},
            "text":{"start":0,"expected":"앞","replacement":"뒤"}});
        assert_eq!(engine.execute(req.clone())["ok"], true);
        let committed = journal_len(engine.connection());
        assert!(committed > before);
        assert_eq!(engine.execute(req)["ok"], false);
        assert_eq!(journal_len(engine.connection()), committed);
    }

    #[test]
    fn html_only_splice_journals_derived_text() {
        let (_dir, engine) = open_host();
        let n = engine.execute(json!({"op":"save","note":{"content":"<p>앞</p>","text":"앞"}}));
        let before = journal_len(engine.connection());
        let result = engine.execute(
            json!({"op":"document_splice_html","id":n["data"]["id"],"revision":1,
            "content":{"start":0,"expected":"<p>앞</p>","replacement":"<p>한글 &amp; 😀</p>"}}),
        );
        assert_eq!(result["ok"], true, "{result}");
        assert!(journal_len(engine.connection()) > before);
        let note = engine.execute(json!({"op":"get","id":n["data"]["id"]}));
        assert_eq!(note["data"]["text"], "한글 & 😀");
    }

    #[test]
    fn losing_deletion_makes_no_phantom_copy() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "33333333-3333-3333-3333-333333333333";

        let copy_id = format!("{id}~conflict~dev-b~2");
        let loser = Entity {
            kind: EntityKind::Note,
            id: id.to_string(),
            data: json!({ "id": id }),
            deleted: true, // the losing side was a deletion
        };
        let mut copy = loser.clone();
        copy.id = copy_id.clone();
        let inc = Incoming {
            event_id: "ev-del".into(),
            seq: 3,
            entity: note_entity(id, "winner"),
            conflict: Some(Conflict {
                copy_id: copy_id.clone(),
                winner: note_entity(id, "winner"),
                loser,
                copy,
            }),
            stale: false,
        };
        apply_one(conn, &inc).unwrap();

        assert_eq!(revision(conn, id), Some(1));
        let mapped = normalize_id(&copy_id);
        assert_eq!(revision(conn, &mapped), None, "phantom copy inserted");
    }

    #[test]
    fn conflict_copy_is_inserted_with_suffix() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "44444444-4444-4444-4444-444444444444";
        let copy_id = format!("{id}~conflict~dev-b~2");
        let mut loser = note_entity(id, "loser");
        loser.data["edited_at"] = json!(1);
        let mut copy = loser.clone();
        copy.id = copy_id.clone();
        let inc = Incoming {
            event_id: "ev-copy".into(),
            seq: 4,
            entity: note_entity(id, "winner"),
            conflict: Some(Conflict {
                copy_id: copy_id.clone(),
                winner: note_entity(id, "winner"),
                loser,
                copy,
            }),
            stale: false,
        };
        apply_one(conn, &inc).unwrap();

        let mapped = normalize_id(&copy_id);
        let (title, text): (String, String) = conn
            .query_row(
                "SELECT m.title, b.text FROM notes_meta m JOIN notes_body b ON b.note_id = m.id \
                 WHERE m.id = ?1",
                params![mapped],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(title.ends_with(CONFLICT_SUFFIX));
        assert_eq!(text, "loser");
        assert_eq!(ops_notes::load_summary(conn, &mapped).unwrap().edited_at, 1);

        // Re-applying the same event does not duplicate the copy.
        apply_one(conn, &inc).unwrap();
        let copies: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notes_meta WHERE title LIKE '%충돌 사본%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(copies, 1);
    }

    #[test]
    fn legacy_payloads_and_invalid_reminders_apply_safely() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "77777777-7777-7777-7777-777777777777";

        // A pre-reminder peer sends no reminder_at: the row applies with none.
        let legacy = Entity::new(
            EntityKind::Note,
            id,
            json!({
                "id": id, "title": "옛 동료", "content": "<p>옛 본문</p>", "text": "옛 본문",
                "tags": [], "created_at": 1, "updated_at": 2, "revision": 1,
            }),
        );
        apply_one(conn, &incoming("ev-legacy", legacy)).unwrap();
        let stored: Option<i64> = conn
            .query_row(
                "SELECT reminder_at FROM notes_meta WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, None, "legacy payload must read back no reminder");

        // An out-of-range reminder in a payload is rejected, not stored.
        let mut bad = note_entity(id, "나쁜 값");
        bad.data["reminder_at"] = json!(-1);
        assert!(apply_one(conn, &incoming("ev-bad", bad)).is_err());
        let mut bad2 = note_entity(id, "나쁜 값");
        bad2.data["reminder_at"] = json!(8_640_000_000_000_001i64);
        assert!(apply_one(conn, &incoming("ev-bad2", bad2)).is_err());
        let got = revision(conn, id);
        assert_eq!(got, Some(1), "rejected payloads must not touch the row");

        // Staging the row back out carries the stored reminder value.
        conn.execute(
            "UPDATE notes_meta SET reminder_at = ?1 WHERE id = ?2",
            params![1_234i64, id],
        )
        .unwrap();
        let entity = build_raw_entity(conn, "note", id).unwrap();
        assert_eq!(entity.data["reminder_at"], 1_234i64);
        // ...and a tombstone payload has no reminder data at all.
        let gone = build_raw_entity(conn, "note", "88888888-8888-8888-8888-888888888888").unwrap();
        assert!(gone.deleted);
    }

    #[test]
    fn recurring_reminder_sync_roundtrip_and_invalid_input() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "11111111-2222-3333-4444-555555555555";
        let mut note = note_entity(id, "repeat");
        note.data["reminder_at"] = json!(1000);
        note.data["reminder_repeat_hours"] = json!(168);
        apply_one(conn, &incoming("repeat-good", note)).unwrap();
        let entity = build_raw_entity(conn, "note", id).unwrap();
        assert_eq!(entity.data["reminder_repeat_hours"], 168);
        let mut bad = entity.clone();
        bad.data["reminder_repeat_hours"] = json!(2);
        assert!(apply_one(conn, &incoming("repeat-bad", bad)).is_err());
        assert_eq!(
            build_raw_entity(conn, "note", id).unwrap().data["reminder_repeat_hours"],
            168
        );
        let mut cleared = entity;
        cleared.data["reminder_repeat_hours"] = Value::Null;
        apply_one(conn, &incoming("repeat-clear", cleared)).unwrap();
        assert!(
            build_raw_entity(conn, "note", id).unwrap().data["reminder_repeat_hours"].is_null()
        );
    }

    #[test]
    fn notebook_hierarchy_arrives_child_first_and_preserves_legacy_metadata() {
        let (dir, engine) = open_host();
        let conn = engine.connection();
        let before = journal_len(conn);
        let child = Entity::new(
            EntityKind::Notebook,
            "child",
            json!({
                "name":"Child", "parent_id":"parent", "description":"설명"
            }),
        );
        apply_one(conn, &incoming("child-first", child)).unwrap();
        // A temporarily unresolved parent must not produce an unrestorable
        // backup or overwrite the user's previous backup.
        let backup = dir.path().join("previous.json");
        std::fs::write(&backup, b"previous backup").unwrap();
        let exported = engine.execute(json!({"op":"export", "path":backup.to_string_lossy()}));
        assert_eq!(exported["ok"], false);
        assert_eq!(std::fs::read(&backup).unwrap(), b"previous backup");
        let parent = Entity::new(EntityKind::Notebook, "parent", json!({"name":"Parent"}));
        apply_one(conn, &incoming("parent-second", parent)).unwrap();
        let legacy = Entity::new(EntityKind::Notebook, "child", json!({"name":"Renamed"}));
        apply_one(conn, &incoming("legacy-rename", legacy)).unwrap();
        let snapshot = build_raw_entity(conn, "notebook", "child").unwrap();
        assert_eq!(snapshot.data["name"], "Renamed");
        assert_eq!(snapshot.data["parent_id"], "parent");
        assert_eq!(snapshot.data["description"], "설명");
        let copy_id = "child~conflict~peer~2";
        let mut loser = snapshot.clone();
        loser.data["name"] = json!("Losing child");
        let mut copy = loser.clone();
        copy.id = copy_id.into();
        let mut conflict = incoming("hierarchy-conflict", snapshot.clone());
        conflict.conflict = Some(Conflict {
            copy_id: copy_id.into(),
            winner: snapshot.clone(),
            loser,
            copy,
        });
        apply_one(conn, &conflict).unwrap();
        let saved_copy = build_raw_entity(conn, "notebook", &normalize_id(copy_id)).unwrap();
        assert_eq!(saved_copy.data["parent_id"], "parent");
        assert_eq!(saved_copy.data["description"], "설명");
        assert!(saved_copy.data["name"]
            .as_str()
            .unwrap()
            .ends_with(CONFLICT_SUFFIX));

        for (event, entity) in [
            (
                "cycle",
                Entity::new(
                    EntityKind::Notebook,
                    "parent",
                    json!({
                        "name":"Parent", "parent_id":"child"
                    }),
                ),
            ),
            (
                "bad-description",
                Entity::new(
                    EntityKind::Notebook,
                    "child",
                    json!({
                        "name":"Lost", "description":7
                    }),
                ),
            ),
            (
                "bad-parent",
                Entity::new(
                    EntityKind::Notebook,
                    "child",
                    json!({
                        "name":"Lost", "parent_id":7
                    }),
                ),
            ),
        ] {
            assert!(apply_one(conn, &incoming(event, entity)).is_err());
            assert!(!is_applied(conn, event).unwrap());
            assert_eq!(
                build_raw_entity(conn, "notebook", "child").unwrap().data,
                snapshot.data
            );
            assert!(build_raw_entity(conn, "notebook", "parent").unwrap().data["parent_id"].is_null());
            assert_eq!(journal_len(conn), before);
            let suppress: i64 = conn
                .query_row(
                    "SELECT suppress FROM sync_host_control WHERE id=1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(suppress, 0);
        }
        let clear = Entity::new(
            EntityKind::Notebook,
            "child",
            json!({
                "name":"Child", "parent_id":null, "description":null
            }),
        );
        apply_one(conn, &incoming("clear", clear)).unwrap();
        let cleared = build_raw_entity(conn, "notebook", "child").unwrap();
        assert!(cleared.data["parent_id"].is_null());
        assert_eq!(cleared.data["description"], "");
        assert_eq!(journal_len(conn), before);
        assert_eq!(
            engine.execute(json!({
                "op":"save_notebook", "id":"child", "name":"Local edit"
            }))["ok"],
            true
        );
        assert!(
            journal_len(conn) > before,
            "rejections must not suppress later local writes"
        );
    }

    #[test]
    fn notebook_deletion_detaches_notes() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let nb = engine.execute(json!({ "op": "save_notebook", "name": "Box" }))["data"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let child = engine.execute(json!({
            "op":"save_notebook", "name":"Child", "parent_id":nb, "description":"keep"
        }));
        assert_eq!(child["ok"], true);
        let child_id = child["data"]["id"].as_str().unwrap();
        let note_id = "66666666-6666-6666-6666-666666666666";
        let saved = engine.execute(json!({
            "op": "save",
            "note": { "id": note_id, "title": "n", "text": "x", "notebook_id": nb }
        }));
        assert_eq!(saved["ok"], true, "save failed: {saved}");

        let tombstone = Entity {
            kind: EntityKind::Notebook,
            id: nb.clone(),
            data: json!({ "id": nb }),
            deleted: true,
        };
        let before = journal_len(conn);
        apply_one(conn, &incoming("ev-nb", tombstone)).unwrap();
        let remaining = build_raw_entity(conn, "notebook", child_id).unwrap();
        assert!(remaining.data["parent_id"].is_null());
        assert_eq!(remaining.data["description"], "keep");
        assert_eq!(journal_len(conn), before, "remote promotions must not echo into the journal");

        let nb_left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notebooks WHERE id = ?1",
                params![nb],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(nb_left, 0);
        let nb_ref: Option<String> = conn
            .query_row(
                "SELECT notebook_id FROM notes_meta WHERE id = ?1",
                params![note_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(nb_ref.is_none(), "note was not detached: {nb_ref:?}");
        assert_eq!(revision(conn, note_id), Some(2));
        let stale = engine
            .execute(json!({"op":"patch","id":note_id,"revision":1,"changes":{"favorite":true}}));
        assert_eq!(stale["ok"], false);
        assert_eq!(
            ops_notes::revision_body(conn, &json!({"id":note_id,"revision":1})).unwrap()["content"],
            saved["data"]["content"]
        );
    }

    #[test]
    fn source_formats_survive_remote_apply_history_and_conflict_copy() {
        let (_dir, engine) = open_host();
        let note=engine.execute(json!({"op":"save","note":{"content_format":"text","content":"<p>literal original</p>"}}));
        assert_eq!(note["ok"], true);
        let id = note["data"]["id"].as_str().unwrap();
        let mut entity = build_raw_entity(engine.connection(), "note", id).unwrap();
        assert_eq!(entity.data["content_format"], "text");
        entity.data["content_format"] = json!("markdown");
        entity.data["content"] = json!("# remote raw");
        entity.data["text"] = json!("# remote raw");
        apply_note(engine.connection(), &entity, None).unwrap();
        let current = ops_notes::load_note(engine.connection(), id)
            .unwrap()
            .unwrap();
        assert_eq!(current.content_format, "markdown");
        assert_eq!(current.content, "# remote raw");
        assert_eq!(
            ops_notes::revision_body(engine.connection(), &json!({"id":id,"revision":1})).unwrap()
                ["content_format"],
            "text"
        );
        let revision = current.revision;
        entity
            .data
            .as_object_mut()
            .unwrap()
            .remove("content_format");
        assert!(apply_note(engine.connection(), &entity, None).is_err());
        assert_eq!(
            ops_notes::load_note(engine.connection(), id)
                .unwrap()
                .unwrap()
                .revision,
            revision
        );
        entity.data["content_format"] = json!("markdown");
        let data = parse_note(&entity.data).unwrap();
        let copy = ids::new_id();
        write_note(engine.connection(), &copy, &data, None, true).unwrap();
        assert_eq!(
            ops_notes::load_note(engine.connection(), &copy)
                .unwrap()
                .unwrap()
                .content_format,
            "markdown"
        );
    }

    #[test]
    fn notebook_memberships_apply_replace_and_stage_primary_first() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "55555555-5555-5555-5555-555555555555";
        let primary = "b2222222-2222-4222-8222-222222222222";
        let extra = "a1111111-1111-4111-8111-111111111111";
        let moved = "c3333333-3333-4333-8333-333333333333";

        let mut entity = note_entity(id, "multi");
        entity.data["notebook_ids"] = json!([primary, extra]);
        apply_one(conn, &incoming("membership-create", entity.clone())).unwrap();
        assert_eq!(primary_notebook(conn, id).as_deref(), Some(primary));
        assert_eq!(memberships(conn, id), vec![extra, primary]);

        apply_one(conn, &incoming("legacy-omitted-primary", note_entity(id, "legacy absent"))).unwrap();
        assert_eq!(memberships(conn, id), vec![extra, primary]);
        assert_eq!(primary_notebook(conn, id).as_deref(), Some(primary));

        // Staging sends the exact set with the primary first ...
        let sent = build_raw_entity(conn, "note", id).unwrap();
        assert_eq!(sent.data["notebook_ids"], json!([primary, extra]));
        assert_eq!(sent.data["notebook_id"], primary);

        // ... and a later array replaces primary + set exactly.
        entity.data["notebook_ids"] = json!([moved, extra]);
        apply_one(conn, &incoming("membership-move", entity)).unwrap();
        assert_eq!(primary_notebook(conn, id).as_deref(), Some(moved));
        assert_eq!(memberships(conn, id), vec![extra, moved]);
        assert_eq!(
            build_raw_entity(conn, "note", id).unwrap().data["notebook_ids"],
            json!([moved, extra])
        );

        // An empty array removes every membership, primary included.
        let mut clear = note_entity(id, "multi");
        clear.data["notebook_ids"] = json!([]);
        apply_one(conn, &incoming("membership-clear", clear)).unwrap();
        assert_eq!(primary_notebook(conn, id), None);
        assert!(memberships(conn, id).is_empty());
    }

    #[test]
    fn legacy_payloads_preserve_additional_memberships() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "56565656-5656-5656-5656-565656565656";
        let primary = "b2222222-2222-4222-8222-222222222222";
        let extra = "a1111111-1111-4111-8111-111111111111";

        let mut entity = note_entity(id, "multi");
        entity.data["notebook_ids"] = json!([primary, extra]);
        apply_one(conn, &incoming("legacy-membership-create", entity)).unwrap();

        // A pre-membership peer resends only the primary: the schema-11
        // trigger must keep the additional relationship.
        let mut legacy = note_entity(id, "legacy edit");
        legacy.data["notebook_id"] = json!(primary);
        apply_one(conn, &incoming("legacy-resave", legacy)).unwrap();
        assert_eq!(memberships(conn, id), vec![extra, primary]);

        // A brand-new legacy note initializes its single membership.
        let fresh = "57575757-5757-5757-5757-575757575757";
        let mut fresh_entity = note_entity(fresh, "old peer");
        fresh_entity.data["notebook_id"] = json!(primary);
        apply_one(conn, &incoming("legacy-new", fresh_entity)).unwrap();
        assert_eq!(memberships(conn, fresh), vec![primary]);
        assert_eq!(primary_notebook(conn, fresh).as_deref(), Some(primary));
    }

    #[test]
    fn invalid_membership_payloads_roll_back_completely() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "58585858-5858-5858-5858-585858585858";
        let primary = "b2222222-2222-4222-8222-222222222222";
        let extra = "a1111111-1111-4111-8111-111111111111";

        let mut entity = note_entity(id, "multi");
        entity.data["notebook_ids"] = json!([primary, extra]);
        apply_one(conn, &incoming("membership-good", entity)).unwrap();
        let before = journal_len(conn);

        let mut null = note_entity(id, "bad");
        null.data["notebook_ids"] = Value::Null;
        let mut duplicate = note_entity(id, "bad");
        duplicate.data["notebook_ids"] = json!([primary, primary]);
        let mut mismatch = note_entity(id, "bad");
        mismatch.data["notebook_id"] = json!(primary);
        mismatch.data["notebook_ids"] = json!([extra]);
        let mut bad_shape = note_entity(id, "bad");
        bad_shape.data["notebook_ids"] = json!(["!!not-a-uuid"]);
        let mut number = note_entity(id, "bad");
        number.data["notebook_ids"] = json!([7]);

        for (event, payload) in [
            ("membership-null", null),
            ("membership-duplicate", duplicate),
            ("membership-mismatch", mismatch),
            ("membership-bad-shape", bad_shape),
            ("membership-number", number),
        ] {
            assert!(apply_one(conn, &incoming(event, payload)).is_err(), "{event}");
            assert!(!is_applied(conn, event).unwrap(), "{event}");
            assert_eq!(memberships(conn, id), vec![extra, primary], "{event}");
            assert_eq!(journal_len(conn), before, "{event}");
            let suppress: i64 = conn
                .query_row(
                    "SELECT suppress FROM sync_host_control WHERE id=1",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(suppress, 0, "{event}");
        }
    }

    #[test]
    fn conflict_copy_keeps_its_own_memberships() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let id = "59595959-5959-5959-5959-595959595959";
        let winner_nb = "d4444444-4444-4444-8444-444444444444";
        let loser_nb = "e5555555-5555-4555-8555-555555555555";

        let mut winner = note_entity(id, "winner");
        winner.data["notebook_ids"] = json!([winner_nb]);
        let mut loser = note_entity(id, "loser");
        loser.data["notebook_ids"] = json!([loser_nb]);
        let copy_id = format!("{id}~conflict~dev-c~1");
        let mut copy = loser.clone();
        copy.id = copy_id.clone();
        let inc = Incoming {
            event_id: "ev-membership-conflict".into(),
            seq: 5,
            entity: winner.clone(),
            conflict: Some(Conflict {
                copy_id: copy_id.clone(),
                winner,
                loser,
                copy,
            }),
            stale: false,
        };
        apply_one(conn, &inc).unwrap();

        assert_eq!(memberships(conn, id), vec![winner_nb]);
        let mapped = normalize_id(&copy_id);
        assert_eq!(memberships(conn, &mapped), vec![loser_nb]);
        let copy_title: String = conn
            .query_row(
                "SELECT title FROM notes_meta WHERE id = ?1",
                params![mapped],
                |r| r.get(0),
            )
            .unwrap();
        assert!(copy_title.ends_with(CONFLICT_SUFFIX));
        // Restaging both sides keeps their distinct membership sets.
        assert_eq!(
            build_raw_entity(conn, "note", id).unwrap().data["notebook_ids"],
            json!([winner_nb])
        );
        assert_eq!(
            build_raw_entity(conn, "note", &mapped).unwrap().data["notebook_ids"],
            json!([loser_nb])
        );
    }

    #[test]
    fn knowledge_metadata_syncs_before_note_and_preserves_typed_values() {
        let (_dir, engine) = open_host();
        let conn=engine.connection();
        configure_generation(conn,"g-knowledge").unwrap();
        let metadata=json!({"anchor_redirects":{"^deleted":"^replacement"},"aliases":["회의"],"document":{"parent_id":"parent-later","width":"wide","tone":"soft"},"properties":[{"name":"점수","type":"number","value":42},{"name":"관계","type":"relation","value":["parent-later"]}]});
        let key="knowledge_note:note-k";
        let entity=Entity::new(EntityKind::Setting,key,json!({"value":metadata.to_string(),"updated_at":200}));
        apply_one(conn,&incoming("metadata-first",entity)).unwrap();
        apply_one(conn,&incoming("note-later",note_entity("note-k","body"))).unwrap();
        let result=engine.execute(json!({"op":"knowledge_get","id":"note-k"}));
        assert_eq!(result["ok"],true,"{result}");
        assert_eq!(result["data"]["properties"],metadata["properties"]);
        let old=Entity::new(EntityKind::Setting,key,json!({"value":null,"updated_at":100}));
        apply_one(conn,&incoming("stale-clear",old)).unwrap();
        assert_eq!(engine.execute(json!({"op":"knowledge_get","id":"note-k"}))["data"]["aliases"],metadata["aliases"]);
        let revision=engine.execute(json!({"op":"get","id":"note-k"}))["data"]["revision"].clone();
        let changed=engine.execute(json!({"op":"knowledge_set","id":"note-k","revision":revision,"version":200,"aliases":["회의록"],"properties":[]}));
        assert_eq!(changed["ok"],true,"{changed}");
        let outgoing=build_raw_entity(conn,"setting",key).unwrap();
        let sent:Value=serde_json::from_str(outgoing.data["value"].as_str().unwrap()).unwrap();
        assert_eq!(sent["aliases"],json!(["회의록"]));
        assert_eq!(sent["document"],metadata["document"]);
        assert_eq!(sent["anchor_redirects"],metadata["anchor_redirects"]);
        assert!(conn.query_row("SELECT count(*) FROM sync_journal WHERE kind='setting' AND id=?1",[key],|r|r.get::<_,i64>(0)).unwrap()>0);
        let invalid=Entity::new(EntityKind::Setting,key,json!({"value":"{\"aliases\":[],\"properties\":[{\"name\":\"bad\",\"type\":\"number\",\"value\":\"text\"}]}","updated_at":i64::MAX}));
        assert!(apply_one(conn,&incoming("bad-metadata",invalid)).is_err());
        assert_eq!(engine.execute(json!({"op":"knowledge_get","id":"note-k"}))["data"]["aliases"],json!(["회의록"]));
    }

    #[test]
    fn default_notebook_syncs_by_decision_time_not_arrival() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let setting = |notebook: Value, at: i64| {
            Entity::new(EntityKind::Setting, settings::DEFAULT_NOTEBOOK, json!({"value":notebook,"updated_at":at}))
        };
        // An empty device has no decision to bootstrap.
        configure_generation(conn, "g1").unwrap();
        assert_eq!(journal_len(conn), 0);
        // The setting may precede its notebook; it reads as none until then.
        apply_one(conn, &incoming("early", setting(json!("nb-a"), 100))).unwrap();
        assert_eq!(journal_len(conn), 0, "remote apply is not re-sent");
        assert_eq!(engine.execute(json!({"op":"defaults_get"}))["data"]["notebook_id"], Value::Null);
        apply_one(conn, &incoming("nb", Entity::new(EntityKind::Notebook, "nb-a", json!({"name":"A"})))).unwrap();
        assert_eq!(engine.execute(json!({"op":"defaults_get"}))["data"]["notebook_id"], "nb-a");
        // An older decision arriving later, or as the loser, cannot win.
        apply_one(conn, &incoming("old", setting(Value::Null, 50))).unwrap();
        assert_eq!(settings::default_notebook(conn).unwrap().as_deref(), Some("nb-a"));
        let winner = setting(Value::Null, 60);
        let loser = setting(json!("nb-a"), 200);
        let mut conflict = incoming("concurrent", winner.clone());
        conflict.conflict = Some(Conflict { copy_id: "default_notebook~conflict~p~1".into(), winner, loser: loser.clone(), copy: loser });
        apply_one(conn, &conflict).unwrap();
        assert_eq!(settings::stored(conn, settings::DEFAULT_NOTEBOOK).unwrap(), Some((Some("nb-a".into()), 200)));
        // A local delete is a new decision and is journaled as an explicit clear.
        assert_eq!(engine.execute(json!({"op":"delete_notebook","id":"nb-a"}))["ok"], true);
        let entity = build_raw_entity(conn, "setting", settings::DEFAULT_NOTEBOOK).unwrap();
        assert!(entity.data["value"].is_null() && entity.data["updated_at"].as_i64().unwrap() > 200);
        assert!(conn.query_row("SELECT count(*) FROM sync_journal WHERE kind='setting'", [], |r| r.get::<_, i64>(0)).unwrap() > 0);
        assert!(apply_one(conn, &incoming("bad", setting(json!(7), 900))).is_err());
        let tag = Entity::new(EntityKind::Setting, settings::DEFAULT_TAG, json!({"value":"업무","updated_at":1}));
        apply_one(conn, &incoming("tag", tag)).unwrap();
        assert_eq!(engine.execute(json!({"op":"defaults_get"}))["data"]["tag"], "업무");
    }

    #[test]
    fn notebook_trash_state_syncs_and_legacy_payload_keeps_it() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let trashed = Entity::new(EntityKind::Notebook, "nb-t", json!({"name":"T","deleted_at":5,"deleted_by":"user"}));
        apply_one(conn, &incoming("trash", trashed)).unwrap();
        assert_eq!(engine.execute(json!({"op":"trashed_notebooks"}))["data"].as_array().unwrap().len(), 1);
        let legacy = Entity::new(EntityKind::Notebook, "nb-t", json!({"name":"Renamed"}));
        apply_one(conn, &incoming("legacy", legacy)).unwrap();
        let sent = build_raw_entity(conn, "notebook", "nb-t").unwrap();
        assert_eq!((sent.data["deleted_at"].clone(), sent.data["name"].clone()), (json!(5), json!("Renamed")));
        let restored = Entity::new(EntityKind::Notebook, "nb-t", json!({"name":"R","deleted_at":null,"deleted_by":null}));
        apply_one(conn, &incoming("restore", restored)).unwrap();
        assert!(build_raw_entity(conn, "notebook", "nb-t").unwrap().data["deleted_at"].is_null());
        let half = Entity::new(EntityKind::Notebook, "nb-t", json!({"name":"R","deleted_at":5}));
        assert!(apply_one(conn, &incoming("half", half)).is_err());
    }

    #[test]
    fn notebook_cover_syncs_and_legacy_payload_keeps_it() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let file = "0b6f3c55-2f1a-4c39-9d7e-0c3a3a5f1e2b";
        let photo = json!({"kind":"unsplash","unsplash_id":"abc_1","url":"https://images.unsplash.com/p?w=1080",
            "thumb":"https://images.unsplash.com/p?w=400","author":"Kim","author_url":"https://unsplash.com/@kim"});
        let first = Entity::new(EntityKind::Notebook, "nb-c", json!({"name":"C","cover":photo}));
        apply_one(conn, &incoming("cover", first)).unwrap();
        let sent = build_raw_entity(conn, "notebook", "nb-c").unwrap();
        assert_eq!(sent.data["cover"], photo);
        assert!(crate::attachment_sync::references(&sent).unwrap().is_empty());
        // Older peers omit the field: the local cover stays.
        apply_one(conn, &incoming("legacy", Entity::new(EntityKind::Notebook, "nb-c", json!({"name":"Renamed"})))).unwrap();
        assert_eq!(build_raw_entity(conn, "notebook", "nb-c").unwrap().data["cover"], photo);
        // A local-file cover travels with its attachment reference.
        let local = json!({"kind":"attachment","url":format!("/api/attachments/{file}")});
        apply_one(conn, &incoming("local", Entity::new(EntityKind::Notebook, "nb-c", json!({"name":"C","cover":local})))).unwrap();
        let sent = build_raw_entity(conn, "notebook", "nb-c").unwrap();
        assert_eq!(sent.data["cover"], local);
        assert_eq!(crate::attachment_sync::references(&sent).unwrap().into_iter().collect::<Vec<_>>(), vec![file.to_string()]);
        // Foreign hosts are rejected and leave the stored cover untouched.
        let evil = json!({"name":"C","cover":{"kind":"unsplash","unsplash_id":"x","url":"https://evil.example/p",
            "thumb":"https://evil.example/p","author":"X","author_url":"https://unsplash.com/@x"}});
        assert!(apply_one(conn, &incoming("evil", Entity::new(EntityKind::Notebook, "nb-c", evil))).is_err());
        assert_eq!(build_raw_entity(conn, "notebook", "nb-c").unwrap().data["cover"], local);
        apply_one(conn, &incoming("clear", Entity::new(EntityKind::Notebook, "nb-c", json!({"name":"C","cover":null})))).unwrap();
        assert!(build_raw_entity(conn, "notebook", "nb-c").unwrap().data["cover"].is_null());
    }

    #[test]
    fn relation_only_conflict_merges_without_copy() {
        let (_dir, engine) = open_host();
        let conn = engine.connection();
        let mut winner = note_entity("note-r", "same");
        winner.data["notebook_ids"] = json!(["nb-a"]);
        winner.data["tags"] = json!(["x"]);
        winner.data["locked"] = json!(false);
        let mut loser = winner.clone();
        loser.data["notebook_ids"] = json!(["nb-b"]);
        loser.data["tags"] = json!(["y"]);
        let mut copy = loser.clone();
        copy.id = "note-r~conflict~p~1".into();
        let mut inc = incoming("relations", winner.clone());
        inc.conflict = Some(Conflict { copy_id: copy.id.clone(), winner, loser, copy });
        apply_one(conn, &inc).unwrap();
        let saved = build_raw_entity(conn, "note", "note-r").unwrap();
        assert_eq!(saved.data["notebook_ids"], json!(["nb-a", "nb-b"]));
        assert_eq!(saved.data["tags"], json!(["x", "y"]));
        let copies: i64 = conn.query_row("SELECT count(*) FROM notes_meta", [], |r| r.get(0)).unwrap();
        assert_eq!(copies, 1, "no conflict copy for relation-only differences");
        assert!(journal_len(conn) > 0, "the union is sent back so peers converge");
    }
}
