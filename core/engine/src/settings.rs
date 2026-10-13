//! Synced defaults for new notes (original `settings.defaultNotebook` and
//! `settings.defaultTag`).
//!
//! Each key is one `settings` row with its own decision time. Sync receive and
//! backup import merge by that time, never by arrival order, so a stale or
//! re-bootstrapped device cannot overwrite a newer choice. An empty device has
//! no row and therefore sends nothing. The notebook reference has no foreign
//! key: the setting may arrive before its notebook, and a missing notebook
//! reads as none. A NULL value is an explicit, synced "none".
use crate::error::{EngineError, Result};
use crate::ids;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub const DEFAULT_NOTEBOOK: &str = "default_notebook";
pub const DEFAULT_TAG: &str = "default_tag";
/// `vault_key:<key_id>` holds one password-wrapped vault key (base64); NULL
/// removes it. Envelopes are opaque here; the runtime seals and opens them.
pub const VAULT_KEY_PREFIX: &str = "vault_key:";

pub fn is_known_key(key: &str) -> bool {
    crate::workspace_tools::is_key(key) || crate::resources::is_key(key) || crate::knowledge::is_key(key)
        || key == DEFAULT_NOTEBOOK
        || key == DEFAULT_TAG
        || key == crate::trash_retention::KEY
        || key.strip_prefix(VAULT_KEY_PREFIX).is_some_and(ids::valid_id)
}

/// Shape check per key. Existence of a notebook is checked only for local sets.
pub fn validate(key: &str, value: Option<&str>) -> Result<()> {
    if !is_known_key(key) {
        return Err(EngineError::invalid(format!("invalid setting {key}")));
    }
    if crate::workspace_tools::is_key(key) { return match value { None=>Ok(()),Some(value)=>crate::workspace_tools::validate(key,value) }; }
    if crate::resources::is_key(key) { return match value { None=>Ok(()),Some(value)=>crate::resources::validate(value) }; }
    if crate::knowledge::is_key(key) { return match value { None => Ok(()), Some(value) => crate::knowledge::validate_setting(key, value) }; }
    match (key, value) {
        (_, None) => Ok(()),
        (DEFAULT_NOTEBOOK, Some(id)) if ids::valid_id(id) => Ok(()),
        (DEFAULT_TAG, Some(tag)) => crate::ops_notes::check_tags(&[tag.to_string()]),
        (crate::trash_retention::KEY, Some(days)) => crate::trash_retention::validate(days),
        (_, Some(envelope))
            if key.starts_with(VAULT_KEY_PREFIX)
                && !envelope.is_empty()
                && envelope.len() <= 1024
                && envelope.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b)) =>
        {
            Ok(())
        }
        _ => Err(EngineError::invalid(format!("invalid setting {key}"))),
    }
}

/// Live vault key envelopes: `(key_id, envelope, updated_at)`.
pub fn vault_keys(conn: &Connection) -> Result<Vec<(String, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT substr(key,?2),value,updated_at FROM settings WHERE key LIKE ?1 AND value IS NOT NULL ORDER BY updated_at,key",
    )?;
    let rows = stmt.query_map(
        params![format!("{VAULT_KEY_PREFIX}%"), VAULT_KEY_PREFIX.len() as i64 + 1],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Raw row: `(value, updated_at)`; None when never decided on this replica.
pub fn stored(conn: &Connection, key: &str) -> Result<Option<(Option<String>, i64)>> {
    Ok(conn
        .query_row(
            "SELECT value,updated_at FROM settings WHERE key=?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

/// The default notebook only while it exists locally and is not in trash.
pub fn default_notebook(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT s.value FROM settings s JOIN notebooks n ON n.id=s.value WHERE s.key=?1 AND n.deleted_at IS NULL",
            [DEFAULT_NOTEBOOK],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn default_tag(conn: &Connection) -> Result<Option<String>> {
    Ok(stored(conn, DEFAULT_TAG)?.and_then(|(value, _)| value))
}

pub fn get(conn: &Connection) -> Result<Value> {
    Ok(json!({ "notebook_id": default_notebook(conn)?, "tag": default_tag(conn)? }))
}

/// `{notebook_id?: id|null, tag?: name|null}`; omitted keys are unchanged.
pub fn set(conn: &Connection, args: &Value) -> Result<Value> {
    let mut changes = Vec::new();
    for (field, key) in [("notebook_id", DEFAULT_NOTEBOOK), ("tag", DEFAULT_TAG)] {
        if let Some(value) = crate::model::opt_string(args, field)? {
            validate(key, value.as_deref())?;
            changes.push((key, value));
        }
    }
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<()> {
        for (key, value) in &changes {
            if let (DEFAULT_NOTEBOOK, Some(id)) = (*key, value) {
                let exists: i64 = conn
                    .query_row("SELECT count(*) FROM notebooks WHERE id=?1 AND deleted_at IS NULL", [id], |r| r.get(0))?;
                if exists == 0 {
                    return Err(EngineError::NotFound(format!("notebook {id}")));
                }
            }
            write_local(conn, key, value.as_deref())?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => conn.execute_batch("COMMIT;")?,
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(e);
        }
    }
    get(conn)
}

fn upsert(conn: &Connection, key: &str, value: Option<&str>, at: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key,value,updated_at) VALUES(?1,?2,?3)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        params![key, value, at],
    )?;
    Ok(())
}

/// Caller owns the transaction. A local decision is always newer than the
/// stored one, even if the wall clock moved backwards.
pub fn write_local(conn: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    let previous = stored(conn, key)?.map(|(_, at)| at).unwrap_or(0);
    upsert(conn, key, value, ids::now_ms().max(previous.saturating_add(1)))
}

/// Caller owns the transaction. Last decision wins; equal times pick the larger
/// value so every replica converges. Returns whether the row changed.
pub fn merge(conn: &Connection, key: &str, value: Option<&str>, updated_at: i64) -> Result<bool> {
    if updated_at < 0 {
        return Err(EngineError::invalid("invalid setting time"));
    }
    validate(key, value)?;
    if let Some((current, at)) = stored(conn, key)? {
        if (updated_at, value) <= (at, current.as_deref()) {
            return Ok(false);
        }
    }
    upsert(conn, key, value, updated_at)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_latest_decision_and_converges_on_ties() {
        let conn = Connection::open_in_memory().unwrap();
        crate::schema::init_main(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO notebooks(id,name) VALUES('a','A'),('b','B');",
        )
        .unwrap();
        let nb = DEFAULT_NOTEBOOK;
        assert!(merge(&conn, nb, Some("a"), 10).unwrap());
        assert!(!merge(&conn, nb, None, 5).unwrap(), "older clear must not win");
        assert!(merge(&conn, nb, Some("b"), 10).unwrap(), "tie picks larger value");
        assert!(!merge(&conn, nb, Some("a"), 10).unwrap());
        assert_eq!(default_notebook(&conn).unwrap().as_deref(), Some("b"));
        conn.execute("DELETE FROM notebooks WHERE id='b'", []).unwrap();
        assert_eq!(default_notebook(&conn).unwrap(), None, "missing notebook reads as none");
        write_local(&conn, nb, None).unwrap();
        assert!(stored(&conn, nb).unwrap().unwrap().1 > 10);
        assert!(merge(&conn, DEFAULT_TAG, Some("업무"), 1).unwrap());
        assert!(merge(&conn, "unknown", None, 1).is_err());
    }
}
