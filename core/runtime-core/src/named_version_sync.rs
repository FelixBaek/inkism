//! Cross-device sync of explicit named snapshots ("namedversion" entities).
//! Automatic history is never synchronized.
//!
//! Wire payload (inside the end-to-end encrypted sync record):
//! * plaintext: `{id,note_id,label,title,content,text,content_format,created_at,scope_note}`
//! * vault: `{id,note_id,label,title,content_format,created_at,plain_bytes,locked_body,scope_note}`
//!   — the body is vault ciphertext; a receiver needs no vault key to store it.
//!
//! Snapshot owner, title, format, time and plaintext source are immutable; only
//! the label and the encryption form change. Conflicts never create copies of a
//! snapshot: see [`merge`].
use crate::host::Sealer;
use crate::{Result, RuntimeError};
use inkism_engine::{encrypted_versions, ids, named_versions};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sync_core::{Conflict, Entity, EntityKind};
pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS sync_version_owner(id TEXT PRIMARY KEY,note_id TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS sync_named_ai AFTER INSERT ON history WHEN NEW.label IS NOT NULL
BEGIN
 INSERT OR REPLACE INTO sync_version_owner VALUES(NEW.id,NEW.note_id);
 INSERT INTO sync_journal(kind,id,deleted) SELECT 'namedversion',NEW.id,0 WHERE (SELECT suppress FROM sync_host_control WHERE id=1)=0;
END;
CREATE TRIGGER IF NOT EXISTS sync_named_au AFTER UPDATE ON history WHEN NEW.label IS NOT NULL
BEGIN INSERT INTO sync_journal(kind,id,deleted) SELECT 'namedversion',NEW.id,0 WHERE (SELECT suppress FROM sync_host_control WHERE id=1)=0; END;
CREATE TRIGGER IF NOT EXISTS sync_named_ad AFTER DELETE ON history WHEN OLD.label IS NOT NULL
BEGIN INSERT INTO sync_journal(kind,id,deleted) SELECT 'namedversion',OLD.id,1 WHERE (SELECT suppress FROM sync_host_control WHERE id=1)=0; END;
CREATE TRIGGER IF NOT EXISTS sync_encrypted_named_ai AFTER INSERT ON encrypted_named_versions
BEGIN
 INSERT OR REPLACE INTO sync_version_owner VALUES(NEW.id,NEW.note_id);
 INSERT INTO sync_journal(kind,id,deleted) SELECT 'namedversion',NEW.id,0 WHERE (SELECT suppress FROM sync_host_control WHERE id=1)=0;
END;
CREATE TRIGGER IF NOT EXISTS sync_encrypted_named_au AFTER UPDATE ON encrypted_named_versions
BEGIN INSERT INTO sync_journal(kind,id,deleted) SELECT 'namedversion',NEW.id,0 WHERE (SELECT suppress FROM sync_host_control WHERE id=1)=0; END;
CREATE TRIGGER IF NOT EXISTS sync_encrypted_named_ad AFTER DELETE ON encrypted_named_versions
BEGIN INSERT INTO sync_journal(kind,id,deleted) SELECT 'namedversion',OLD.id,1 WHERE (SELECT suppress FROM sync_host_control WHERE id=1)=0; END;
INSERT OR IGNORE INTO sync_version_owner SELECT id,note_id FROM history WHERE label IS NOT NULL;
INSERT OR IGNORE INTO sync_version_owner SELECT id,note_id FROM encrypted_named_versions;
"#;

/// Journal every current named version. Plain SQL only, so it can run inside
/// the host's rusqlite transaction closure (initial bootstrap, scope restage).
pub fn bootstrap(c: &Connection) -> rusqlite::Result<()> {
    c.execute("INSERT INTO sync_journal(kind,id,deleted) SELECT 'namedversion',id,0 FROM history WHERE label IS NOT NULL", [])?;
    c.execute("INSERT INTO sync_journal(kind,id,deleted) SELECT 'namedversion',id,0 FROM encrypted_named_versions", [])?;
    Ok(())
}

/// Ids of the named versions (plaintext or vault) currently owned by `note`.
pub fn ids_for_note(c: &Connection, note: &str) -> Result<Vec<String>> {
    let mut q = c.prepare("SELECT id FROM history WHERE note_id=?1 AND label IS NOT NULL UNION SELECT id FROM encrypted_named_versions WHERE note_id=?1")?;
    let ids = q.query_map([note], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(ids)
}

fn encrypted(e: &Entity) -> bool {
    e.data.get("locked_body").is_some_and(|v| !v.is_null())
}

pub fn build(c: &Connection, id: &str) -> Result<Entity> {
    let enc: Option<(String, String)> = c
        .query_row("SELECT note_id,data FROM encrypted_named_versions WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let mut value = if let Some((note, raw)) = enc {
        let mut v: Value = serde_json::from_str(&raw)?;
        v["note_id"] = json!(note);
        v
    } else {
        let plain = c
            .query_row(
                "SELECT note_id,label,title,content,text,content_format,created_at FROM history WHERE id=?1 AND label IS NOT NULL",
                [id],
                |r| Ok(json!({"note_id":r.get::<_,String>(0)?,"label":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"content":r.get::<_,String>(3)?,"text":r.get::<_,String>(4)?,"content_format":r.get::<_,String>(5)?,"created_at":r.get::<_,i64>(6)?})),
            )
            .optional()?;
        match plain {
            Some(v) => v,
            None => {
                let owner: Option<String> = c.query_row("SELECT note_id FROM sync_version_owner WHERE id=?1", [id], |r| r.get(0)).optional()?;
                return Ok(Entity::new(EntityKind::NamedVersion, id, json!({"id":id,"note_id":owner})).tombstone());
            }
        }
    };
    value["id"] = json!(id);
    let note = value["note_id"].as_str().unwrap_or_default().to_string();
    let parent = inkism_engine::ops_notes::load_summary(c, &note)?;
    value["scope_note"] = json!({"notebook_ids":parent.notebook_ids,"tags":parent.tags});
    Ok(Entity::new(EntityKind::NamedVersion, id, value))
}

/// Deterministic resolution of concurrent changes to one named version. Both
/// replicas see the same winner/loser, so they compute the same result.
/// * delete vs. rename: the snapshot is kept (an explicit checkpoint is never
///   lost to a concurrent delete); both deleted stays deleted.
/// * plaintext vs. vault form (offline lock on one device, rename on the
///   other): the vault form wins, so a concurrent edit can never downgrade a
///   snapshot the user moved into the vault back to plaintext.
/// * label: the winner's label (sync-core's clock/device order). The losing
///   label is not kept; snapshots are never duplicated for a name.
pub fn merge(conflict: &Conflict) -> Entity {
    let (w, l) = (&conflict.winner, &conflict.loser);
    match (w.deleted, l.deleted) {
        (true, true) | (false, true) => return w.clone(),
        (true, false) => return l.clone(),
        _ => {}
    }
    let mut out = if encrypted(l) && !encrypted(w) { l.clone() } else { w.clone() };
    out.id = w.id.clone();
    out.data["label"] = w.data["label"].clone();
    out
}

fn label(v: &Value) -> Result<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.chars().count() <= 120)
        .map(str::to_string)
        .ok_or_else(|| RuntimeError::config("invalid named version label"))
}

/// Vault form of a plaintext snapshot sealed with the parent's vault key, or
/// `VaultKeyRequired` when this device has not unlocked that key.
fn seal(note: &str, key_id: &str, plain: &Value, sealer: Sealer) -> Result<Value> {
    let sealed = match sealer {
        Some(seal) => seal(key_id, note, plain)?,
        None => None,
    };
    let sealed = sealed.ok_or_else(|| RuntimeError::VaultKeyRequired(note.to_string()))?;
    let mut row = json!({});
    for key in ["id", "label", "title", "content_format", "created_at"] {
        row[key] = plain[key].clone();
    }
    row["locked_body"] = sealed["locked_body"].clone();
    row["plain_bytes"] = sealed["plain_bytes"].clone();
    Ok(row)
}

/// Before a remote lock is stored: move this note's plaintext named
/// snapshots into the vault (same ids) and journal them so peers receive the
/// vault form. Without the key nothing changes and the lock waits.
pub fn seal_local_plaintext(c: &Connection, note: &str, key_id: &str, sealer: Sealer) -> Result<()> {
    let plain = named_versions::backup(c, note)?;
    let plain = plain.as_array().cloned().unwrap_or_default();
    if plain.is_empty() {
        return Ok(());
    }
    let mut rows = encrypted_versions::rows(c, note)?.as_array().cloned().unwrap_or_default();
    let mut moved = Vec::new();
    for version in &plain {
        let row = seal(note, key_id, version, sealer)?;
        rows.retain(|v| v["id"] != row["id"]);
        moved.push(row["id"].as_str().unwrap_or_default().to_string());
        rows.push(row);
    }
    encrypted_versions::replace(c, note, &json!(rows), false)?;
    for id in &moved {
        c.execute("DELETE FROM history WHERE id=?1 AND label IS NOT NULL", [id])?;
        republish(c, id, note)?;
    }
    Ok(())
}

/// Journal a locally changed snapshot while remote-apply triggers are suppressed.
fn republish(c: &Connection, id: &str, note: &str) -> Result<()> {
    c.execute("INSERT OR REPLACE INTO sync_version_owner VALUES(?1,?2)", params![id, note])?;
    c.execute("INSERT INTO sync_journal(kind,id,deleted) VALUES('namedversion',?1,0)", [id])?;
    Ok(())
}

pub fn apply(c: &Connection, e: &Entity, sealer: Sealer) -> Result<()> {
    if !ids::valid_id(&e.id) {
        return Err(RuntimeError::config("invalid named version id"));
    }
    if e.deleted {
        c.execute("DELETE FROM history WHERE id=?1 AND label IS NOT NULL", [&e.id])?;
        c.execute("DELETE FROM encrypted_named_versions WHERE id=?1", [&e.id])?;
        return Ok(());
    }
    let note = e.data["note_id"].as_str().filter(|id| ids::valid_id(id)).ok_or_else(|| RuntimeError::config("invalid named version owner"))?;
    // A version can arrive before its note: fail so the event stays pending.
    let parent = inkism_engine::ops_notes::load_summary(c, note)?;
    let existing = build(c, &e.id)?;
    let live = !existing.deleted;
    if live && existing.data["note_id"] != e.data["note_id"] {
        return Err(RuntimeError::config("named version owner is immutable"));
    }
    for key in ["title", "content_format", "created_at"] {
        if live && existing.data[key] != e.data[key] {
            return Err(RuntimeError::config("named version snapshot metadata is immutable"));
        }
    }
    let name = label(&e.data["label"])?;
    if !encrypted(e) && parent.locked {
        if live && encrypted(&existing) {
            // A newer plaintext form of a snapshot we hold sealed is the
            // other device unlocking the note; its note change follows.
            return Err(RuntimeError::config("plaintext version waits for note unlock"));
        }
        // A snapshot named without seeing the lock: never store plaintext
        // under a vault note. Seal it now with the note's key and send the
        // vault form on, or wait for the key.
        let key_id = inkism_engine::vault::locked_body(c, note)?
            .ok_or_else(|| RuntimeError::internal("locked note has no body"))?
            .key_id;
        let mut plain = e.data.clone();
        plain["id"] = json!(e.id);
        plain["label"] = json!(name);
        let mut sealed = Entity::new(EntityKind::NamedVersion, &e.id, seal(note, &key_id, &plain, sealer)?);
        sealed.data["note_id"] = json!(note);
        apply(c, &sealed, None)?;
        return republish(c, &e.id, note);
    }
    let incoming_encrypted = encrypted(e);
    let existing_plain = live && !encrypted(&existing);
    if !incoming_encrypted && existing_plain {
        for key in ["content", "text"] {
            if existing.data[key] != e.data[key] {
                return Err(RuntimeError::config("named snapshot source is immutable"));
            }
        }
    }
    if incoming_encrypted {
        let mut value = e.data.clone();
        if let Some(map) = value.as_object_mut() {
            for key in ["note_id", "scope_note", "attachments"] {
                map.remove(key);
            }
        }
        value["id"] = json!(e.id);
        value["label"] = json!(name);
        let mut rows = encrypted_versions::rows(c, note)?.as_array().cloned().unwrap_or_default();
        rows.retain(|v| v["id"] != e.id);
        rows.push(value);
        // Changed-row update: other snapshots of the note are left untouched.
        encrypted_versions::replace(c, note, &json!(rows), false)?;
        c.execute("DELETE FROM history WHERE id=?1 AND label IS NOT NULL", [&e.id])?;
    } else if existing_plain {
        c.execute("UPDATE history SET label=?1 WHERE id=?2 AND label IS NOT NULL AND label IS NOT ?1", params![name, e.id])?;
    } else {
        let mut value = e.data.clone();
        value["label"] = json!(name);
        c.execute("DELETE FROM encrypted_named_versions WHERE id=?1", [&e.id])?;
        named_versions::import_with_ids(c, note, &json!([value]), &std::collections::HashMap::new(), true)?;
    }
    c.execute("INSERT OR REPLACE INTO sync_version_owner VALUES(?1,?2)", params![e.id, note])?;
    Ok(())
}
