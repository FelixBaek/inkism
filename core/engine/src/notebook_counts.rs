//! Per-notebook note counts for the sidebar. Counts direct memberships only,
//! with the same filter as the notebook list view (not archived, not trashed).
use crate::error::Result;
use rusqlite::Connection;
use serde_json::{Map, Value};

pub fn counts(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT nn.notebook_id, COUNT(*) FROM note_notebooks nn \
         JOIN notes_meta m ON m.id = nn.note_id \
         WHERE m.trashed = 0 AND m.archived = 0 GROUP BY nn.notebook_id",
    )?;
    let mut out = Map::new();
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        out.insert(row.get::<_, String>(0)?, Value::from(row.get::<_, i64>(1)?));
    }
    Ok(Value::Object(out))
}
