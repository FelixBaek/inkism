//! Notebook relationships are metadata; never read note bodies to list them.
use crate::error::{EngineError, Result};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::HashSet;

pub const MAX_NOTEBOOKS_PER_NOTE: usize = 1024;

/// Omitted preserves existing memberships. Null is invalid; [] removes all.
/// Backup IDs need not be UUIDs: validate real database IDs after remapping.
pub fn parse_ids(value: &Value) -> Result<Option<Vec<String>>> {
    let Some(raw) = value.get("notebook_ids") else {
        return Ok(None);
    };
    let mut values: Vec<String> = serde_json::from_value(raw.clone())
        .map_err(|_| EngineError::invalid("notebook_ids must be an array of strings"))?;
    if values.len() > MAX_NOTEBOOKS_PER_NOTE {
        return Err(EngineError::invalid("too many notebook memberships"));
    }
    let mut seen = HashSet::new();
    for id in &values {
        if id.is_empty() || !seen.insert(id) {
            return Err(EngineError::invalid(
                "empty or duplicate notebook membership",
            ));
        }
    }
    if let Some(primary) = value.get("notebook_id") {
        let primary = match primary {
            Value::Null => None,
            Value::String(id) => Some(id.as_str()),
            _ => return Err(EngineError::invalid("bad notebook_id")),
        };
        if primary != values.first().map(String::as_str) {
            return Err(EngineError::invalid(
                "notebook_id must match the first notebook_ids entry",
            ));
        }
    }
    if values.len() > 1 {
        // Only the primary's position is meaningful. Canonical tails also
        // prevent a saved crash snapshot from becoming a duplicate recovery.
        values[1..].sort_unstable();
    }
    Ok(Some(values))
}

pub fn validate_ids(values: &[String]) -> Result<()> {
    if values.len() > MAX_NOTEBOOKS_PER_NOTE {
        return Err(EngineError::invalid("too many notebook memberships"));
    }
    let mut seen = HashSet::new();
    for id in values {
        if !crate::ids::valid_id(id) || !seen.insert(id) {
            return Err(EngineError::invalid(
                "invalid or duplicate notebook membership",
            ));
        }
    }
    Ok(())
}

pub fn load(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut statement = conn.prepare_cached(
        "SELECT notebook_id FROM note_notebooks WHERE note_id=?1 \
         ORDER BY (notebook_id=(SELECT notebook_id FROM notes_meta WHERE id=?1)) DESC,notebook_id",
    )?;
    let rows = statement.query_map([id], |row| row.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// `load` for a page of notes in one query, same order per note.
pub fn load_many(conn: &Connection, ids: &[&str]) -> Result<std::collections::HashMap<String, Vec<String>>> {
    let mut out: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    if ids.is_empty() {
        return Ok(out);
    }
    let mut statement = conn.prepare_cached(
        "SELECT nn.note_id,nn.notebook_id FROM note_notebooks nn JOIN notes_meta m ON m.id=nn.note_id \
         WHERE nn.note_id IN (SELECT value FROM json_each(?1)) \
         ORDER BY nn.note_id,(nn.notebook_id=m.notebook_id) DESC,nn.notebook_id",
    )?;
    let rows = statement.query_map([serde_json::to_string(ids)?], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (note, notebook) = row?;
        out.entry(note).or_default().push(notebook);
    }
    Ok(out)
}

/// Caller owns the transaction and revision update. No notebook FK: an
/// authenticated remote note may arrive before its notebooks.
pub fn replace(
    conn: &Connection,
    id: &str,
    values: &[String],
    require_existing: bool,
) -> Result<()> {
    validate_ids(values)?;
    if require_existing {
        for notebook in values {
            let exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id=?1)",
                [notebook],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(EngineError::invalid(format!(
                    "notebook {notebook} does not exist"
                )));
            }
        }
    }
    let changed = conn.execute(
        "UPDATE notes_meta SET notebook_id=?1 WHERE id=?2",
        params![values.first(), id],
    )?;
    if changed == 0 {
        return Err(EngineError::NotFound(format!("note {id}")));
    }
    conn.execute("DELETE FROM note_notebooks WHERE note_id=?1", [id])?;
    let mut insert =
        conn.prepare_cached("INSERT INTO note_notebooks(note_id,notebook_id) VALUES(?1,?2)")?;
    for notebook in values {
        insert.execute(params![id, notebook])?;
    }
    Ok(())
}
