//! Original notebook trash (`notebooks.moveToTrash`, `trash.restore/_delete`).
//!
//! Trashing marks the chosen notebook 'user' and its live sub-notebooks 'app'
//! with the same time; rows, hierarchy and note memberships stay intact.
//! Restore brings the notebook back with every trashed sub-notebook. Permanent
//! deletion of a trashed notebook removes it with its trashed sub-notebooks.
//! Live reads (`notebooks`, default notebook) hide trashed rows; backup and
//! sync carry them.
use crate::error::{EngineError, Result};
use crate::ids;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

/// Sub-notebooks of `id` (inclusive). `through_trashed` selects which rows
/// the walk may pass: live ones for trashing, trashed ones for restore/delete.
pub fn subtree(conn: &Connection, id: &str, through_trashed: bool) -> Result<Vec<String>> {
    let state = if through_trashed { "IS NOT NULL" } else { "IS NULL" };
    // UNION (not ALL) also stops a corrupt cycle.
    let mut stmt = conn.prepare(&format!(
        "WITH RECURSIVE sub(id) AS (SELECT ?1 UNION SELECT n.id FROM notebooks n JOIN sub ON n.parent_id=sub.id WHERE n.deleted_at {state})
         SELECT id FROM sub"
    ))?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
}

fn deleted_at(conn: &Connection, id: &str) -> Result<Option<i64>> {
    conn.query_row("SELECT deleted_at FROM notebooks WHERE id=?1", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| EngineError::NotFound(format!("notebook {id}")))
}

fn arg_id(args: &Value) -> Result<&str> {
    args.get("id")
        .and_then(Value::as_str)
        .filter(|id| ids::valid_id(id))
        .ok_or_else(|| EngineError::invalid("bad id"))
}

/// `{id, trash_notes?: bool, current_id?, current_revision?}`. With
/// `trash_notes`, notes in the trashed notebooks also move to the note trash.
pub fn trash(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    let trash_notes = crate::model::opt_bool(args, "trash_notes")?.unwrap_or(false);
    let current = crate::ops_meta::current_note_argument(args)?;
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<Value> {
        if let Some((note_id, revision)) = current {
            if crate::ops_notes::load_summary(conn, note_id)?.revision != revision {
                return Err(EngineError::Conflict("document revision changed".into()));
            }
        }
        if deleted_at(conn, id)?.is_some() {
            return Err(EngineError::invalid("notebook is already in trash"));
        }
        let notebooks = subtree(conn, id, false)?;
        let now = ids::now_ms();
        mark_trashed(conn, id, &notebooks, now)?;
        let notes = if trash_notes {
            trash_notes_in(conn, &notebooks, now)?
        } else {
            0
        };
        let summary = current
            .map(|(id, _)| crate::ops_notes::load_summary(conn, id))
            .transpose()?;
        Ok(json!({ "trashed": notebooks, "notes": notes, "current": summary }))
    })();
    finish(conn, result)
}

/// The user trashed `id`; its descendants are trashed by the app.
fn mark_trashed(conn: &Connection, id: &str, notebooks: &[String], now: i64) -> Result<()> {
    for notebook in notebooks {
        let by = if notebook == id { "user" } else { "app" };
        conn.execute(
            "UPDATE notebooks SET deleted_at=?1,deleted_by=?2 WHERE id=?3",
            params![now, by, notebook],
        )?;
    }
    Ok(())
}

/// Moves live notes filed in `notebooks` to the note trash; returns the count.
fn trash_notes_in(conn: &Connection, notebooks: &[String], now: i64) -> Result<i64> {
    let mut notes = 0;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT m.id,m.revision FROM note_notebooks nn JOIN notes_meta m ON m.id=nn.note_id
         WHERE nn.notebook_id=?1 AND m.trashed=0",
    )?;
    let mut rows = Vec::new();
    for notebook in notebooks {
        rows.extend(
            stmt.query_map([notebook], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        );
    }
    drop(stmt);
    rows.sort();
    rows.dedup();
    // Same columns as `patch {trashed:true}`.
    for (note, revision) in rows {
        let revision = revision
            .checked_add(1)
            .ok_or_else(|| EngineError::invalid("revision overflow"))?;
        conn.execute(
            "UPDATE notes_meta SET trashed=1,updated_at=?1,revision=?2 WHERE id=?3",
            params![now, revision, note],
        )?;
        crate::indexer::enqueue(conn, &note, revision)?;
        notes += 1;
    }
    Ok(notes)
}

/// `{id}`: the notebook and all of its trashed sub-notebooks become live.
pub fn restore(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<Value> {
        if deleted_at(conn, id)?.is_none() {
            return Err(EngineError::invalid("notebook is not in trash"));
        }
        let notebooks = subtree(conn, id, true)?;
        for notebook in &notebooks {
            conn.execute(
                "UPDATE notebooks SET deleted_at=NULL,deleted_by=NULL WHERE id=?1",
                [notebook],
            )?;
        }
        Ok(json!({ "restored": notebooks }))
    })();
    finish(conn, result)
}

/// User-trashed notebooks, newest first (sub-notebooks moved with a parent are
/// listed through that parent, as in the original).
pub fn list(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT id,name,color,parent_id,description,deleted_at FROM notebooks
         WHERE deleted_by='user' ORDER BY deleted_at DESC,id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(json!({
            "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?,
            "color": r.get::<_, Option<String>>(2)?, "parent_id": r.get::<_, Option<String>>(3)?,
            "description": r.get::<_, String>(4)?, "deleted_at": r.get::<_, i64>(5)?,
        }))
    })?;
    Ok(Value::Array(rows.collect::<rusqlite::Result<Vec<_>>>()?))
}

/// Shared by sync receive and backup import: omitted keeps the stored state,
/// null makes the notebook live, otherwise both fields must be valid.
pub fn parse_state(data: &Value, previous: (Option<i64>, Option<String>)) -> Result<(Option<i64>, Option<String>)> {
    let at = match data.get("deleted_at") {
        None => return Ok(previous),
        Some(Value::Null) => None,
        Some(_) => Some(
            crate::model::opt_timestamp(data, "deleted_at")?
                .expect("present timestamp"),
        ),
    };
    let by = match data.get("deleted_by") {
        None | Some(Value::Null) => None,
        Some(Value::String(by)) if by == "user" || by == "app" => Some(by.clone()),
        _ => return Err(EngineError::invalid("bad notebook deleted_by")),
    };
    if at.is_some() != by.is_some() {
        return Err(EngineError::invalid("notebook trash state is incomplete"));
    }
    Ok((at, by))
}

/// Stored trash state of a notebook, or live when the row does not exist.
pub fn stored_state(conn: &Connection, id: &str) -> Result<(Option<i64>, Option<String>)> {
    Ok(conn
        .query_row("SELECT deleted_at,deleted_by FROM notebooks WHERE id=?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?
        .unwrap_or_default())
}

fn finish(conn: &Connection, result: Result<Value>) -> Result<Value> {
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT;")?;
            Ok(value)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}
