//! Trashed-note retention: when each note entered the trash, an optional
//! synced auto-delete period (7/30/90 days; default none) and the purge that
//! applies it. Archived notes are never purged.
//!
//! Trash times are LOCAL (`note_trash_times`), kept by triggers on
//! `notes_meta.trashed`, so every write path (patch, sync, import) records them
//! without code changes. A note that was already in the trash when this table
//! first appeared, or that arrives trashed, starts counting from the moment
//! this replica saw it, never earlier.
use crate::error::{EngineError, Result};
use crate::ids;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

/// Synced setting: "7" | "30" | "90"; a missing row or NULL means never.
pub const KEY: &str = "trash_retention_days";
const DAYS: [i64; 3] = [7, 30, 90];
const DAY_MS: i64 = 86_400_000;
/// Bounded work per purge call; the caller simply calls again later.
const PURGE_BATCH: i64 = 200;

const NOW_MS: &str = "CAST(strftime('%s','now') AS INTEGER)*1000";

/// Additive and idempotent: runs inside `init_main`'s transaction.
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS note_trash_times(
            note_id    TEXT PRIMARY KEY REFERENCES notes_meta(id) ON DELETE CASCADE,
            trashed_at INTEGER NOT NULL
        );
        CREATE TRIGGER IF NOT EXISTS note_trash_time_insert AFTER INSERT ON notes_meta
        WHEN NEW.trashed=1 BEGIN
            INSERT OR IGNORE INTO note_trash_times(note_id,trashed_at) VALUES(NEW.id,{NOW_MS});
        END;
        CREATE TRIGGER IF NOT EXISTS note_trash_time_update AFTER UPDATE OF trashed ON notes_meta
        WHEN NEW.trashed<>OLD.trashed BEGIN
            DELETE FROM note_trash_times WHERE note_id=NEW.id;
            INSERT INTO note_trash_times(note_id,trashed_at) SELECT NEW.id,{NOW_MS} WHERE NEW.trashed=1;
        END;
        INSERT OR IGNORE INTO note_trash_times(note_id,trashed_at)
            SELECT id,{NOW_MS} FROM notes_meta WHERE trashed=1;"
    ))
}

pub fn validate(value: &str) -> Result<()> {
    match value.parse::<i64>() {
        Ok(days) if DAYS.contains(&days) => Ok(()),
        _ => Err(EngineError::invalid("trash retention must be 7, 30 or 90 days")),
    }
}

fn days(conn: &Connection) -> Result<Option<i64>> {
    Ok(crate::settings::stored(conn, KEY)?
        .and_then(|(value, _)| value)
        .and_then(|v| v.parse().ok())
        .filter(|d| DAYS.contains(d)))
}

/// {op:"trash_retention_get"} -> {days: 7|30|90|null}
pub fn get(conn: &Connection) -> Result<Value> {
    Ok(json!({ "days": days(conn)? }))
}

/// {op:"trash_retention_set", days: 7|30|90|null}
pub fn set(conn: &Connection, args: &Value) -> Result<Value> {
    let value = match args.get("days") {
        None | Some(Value::Null) => None,
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => return Err(EngineError::invalid("days must be a number or null")),
    };
    if let Some(v) = &value {
        validate(v)?;
    }
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let r = crate::settings::write_local(conn, KEY, value.as_deref()).map(|_| Value::Null);
    crate::ops_notes::finish_tx(conn, r)?;
    get(conn)
}

/// {op:"trash_times", ids:[...]} -> {times:{id:ms}} for trashed notes only.
pub fn times(conn: &Connection, args: &Value) -> Result<Value> {
    let list = args
        .get("ids")
        .and_then(Value::as_array)
        .ok_or_else(|| EngineError::invalid("ids required"))?;
    if list.len() > crate::limits::MAX_LIST_LIMIT as usize {
        return Err(EngineError::invalid("too many ids"));
    }
    let mut stmt = conn.prepare(
        "SELECT t.trashed_at FROM note_trash_times t JOIN notes_meta m ON m.id=t.note_id WHERE t.note_id=?1 AND m.trashed=1",
    )?;
    let mut out = serde_json::Map::new();
    for id in list.iter().filter_map(Value::as_str).filter(|id| ids::valid_id(id)) {
        if let Ok(at) = stmt.query_row([id], |r| r.get::<_, i64>(0)) {
            out.insert(id.to_string(), json!(at));
        }
    }
    Ok(json!({ "times": out, "days": days(conn)? }))
}

/// {op:"trash_purge"} -> {deleted:[ids], more}. Permanently deletes trashed,
/// non-archived notes whose trash time is older than the chosen period, one at
/// a time through the ordinary permanent-delete path. No period = no-op.
pub fn purge(conn: &Connection, now_ms: i64) -> Result<Value> {
    let Some(days) = days(conn)? else {
        return Ok(json!({ "deleted": [], "more": false }));
    };
    let cutoff = now_ms - days * DAY_MS;
    let expired: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT m.id FROM notes_meta m JOIN note_trash_times t ON t.note_id=m.id
             WHERE m.trashed=1 AND m.archived=0 AND t.trashed_at<=?1
             ORDER BY t.trashed_at,m.id LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![cutoff, PURGE_BATCH + 1], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let more = expired.len() as i64 > PURGE_BATCH;
    let mut deleted = Vec::new();
    for id in expired.into_iter().take(PURGE_BATCH as usize) {
        crate::ops_notes::delete(conn, &json!({ "id": id }))?;
        deleted.push(id);
    }
    Ok(json!({ "deleted": deleted, "more": more }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(conn: &Connection, id: &str, trashed: i64, archived: i64) {
        conn.execute(
            "INSERT INTO notes_meta(id,created_at,updated_at,trashed,archived) VALUES(?1,1,1,?2,?3)",
            params![id, trashed, archived],
        )
        .unwrap();
        conn.execute("INSERT INTO notes_body(note_id) VALUES(?1)", [id]).unwrap();
    }

    fn exists(conn: &Connection, id: &str) -> bool {
        conn.query_row("SELECT count(*) FROM notes_meta WHERE id=?1", [id], |r| r.get::<_, i64>(0)).unwrap() == 1
    }

    #[test]
    fn purge_respects_default_never_archive_and_period() {
        let conn = Connection::open_in_memory().unwrap();
        crate::schema::init_main(&conn).unwrap();
        let (old, fresh, archived, live) = (ids::new_id(), ids::new_id(), ids::new_id(), ids::new_id());
        note(&conn, &old, 1, 0);
        note(&conn, &fresh, 0, 0);
        note(&conn, &archived, 1, 1);
        note(&conn, &live, 0, 0);
        conn.execute("UPDATE notes_meta SET trashed=1 WHERE id=?1", [&fresh]).unwrap();
        let now = ids::now_ms();
        conn.execute("UPDATE note_trash_times SET trashed_at=?1 WHERE note_id IN (?2,?3)", params![now - 40 * DAY_MS, old, archived]).unwrap();

        // Default: never delete.
        assert_eq!(get(&conn).unwrap()["days"], Value::Null);
        assert_eq!(purge(&conn, now).unwrap()["deleted"], json!([]));
        assert!(exists(&conn, &old));

        assert!(set(&conn, &json!({"days": 45})).is_err());
        set(&conn, &json!({"days": 30})).unwrap();
        let out = purge(&conn, now).unwrap();
        assert_eq!(out["deleted"], json!([old]));
        assert!(!exists(&conn, &old));
        assert!(exists(&conn, &fresh), "recently trashed note is kept");
        assert!(exists(&conn, &archived), "archived notes are never purged");
        assert!(exists(&conn, &live));

        // Restoring clears the trash time; trashing again restarts it.
        conn.execute("UPDATE notes_meta SET trashed=0 WHERE id=?1", [&fresh]).unwrap();
        assert_eq!(times(&conn, &json!({"ids":[fresh]})).unwrap()["times"], json!({}));
        conn.execute("UPDATE notes_meta SET trashed=1 WHERE id=?1", [&fresh]).unwrap();
        assert!(times(&conn, &json!({"ids":[fresh]})).unwrap()["times"][&fresh].as_i64().unwrap() >= now - 1000);

        set(&conn, &json!({"days": null})).unwrap();
        assert_eq!(get(&conn).unwrap()["days"], Value::Null);
    }

    #[test]
    fn existing_trash_is_backfilled_on_upgrade() {
        let conn = Connection::open_in_memory().unwrap();
        crate::schema::init_main(&conn).unwrap();
        let id = ids::new_id();
        conn.execute_batch("DROP TRIGGER note_trash_time_insert; DROP TRIGGER note_trash_time_update; DROP TABLE note_trash_times;").unwrap();
        note(&conn, &id, 1, 0);
        crate::schema::init_main(&conn).unwrap();
        assert_eq!(times(&conn, &json!({"ids":[id]})).unwrap()["times"].as_object().unwrap().len(), 1);
    }
}
