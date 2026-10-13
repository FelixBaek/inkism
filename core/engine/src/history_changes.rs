//! Per-version change size for the note info panel: words added/removed against the next older version.
//! Words, not lines: stored plain text joins HTML paragraphs, so lines would hide most edits.
use crate::{
    error::{EngineError, Result},
    ids, ops_notes,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashMap;

const DEFAULT_LIMIT: i64 = 5;
const MAX_LIMIT: i64 = 20;
/// Bodies above this are reported as unknown instead of compared.
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;

/// Multiset word difference: (added, removed). Order-insensitive, so a moved word counts as unchanged.
pub fn word_changes(older: &str, newer: &str) -> (usize, usize) {
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for word in older.split_whitespace() {
        *counts.entry(word).or_default() += 1;
    }
    let mut added = 0;
    for word in newer.split_whitespace() {
        match counts.get_mut(word) {
            Some(n) if *n > 0 => *n -= 1,
            _ => added += 1,
        }
    }
    let removed = counts.values().filter(|n| **n > 0).sum::<i64>() as usize;
    (added, removed)
}

pub fn changes(conn: &Connection, args: &Value) -> Result<Value> {
    let note = args
        .get("id")
        .and_then(Value::as_str)
        .filter(|v| ids::valid_id(v))
        .ok_or_else(|| EngineError::invalid("bad id"))?;
    if ops_notes::load_summary(conn, note)?.locked {
        return Err(EngineError::invalid("note is locked"));
    }
    let limit = args.get("limit").and_then(Value::as_i64).unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    // One extra row so the oldest shown entry still has something to compare with.
    let mut stmt = conn.prepare(
        "SELECT id, CASE WHEN length(CAST(text AS BLOB))<=?3 THEN text END
         FROM history WHERE note_id = ?1 ORDER BY created_at DESC, row_seq DESC LIMIT ?2",
    )?;
    let rows: Vec<(String, Option<String>)> = stmt
        .query_map(params![note, limit + 1, MAX_TEXT_BYTES as i64], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<_, _>>()?;
    let items: Vec<Value> = rows
        .iter()
        .take(limit as usize)
        .enumerate()
        .map(|(i, (id, text))| match (text, rows.get(i + 1)) {
            (Some(text), Some((_, Some(older)))) => {
                let (added, removed) = word_changes(older, text);
                json!({"id": id, "added": added, "removed": removed})
            }
            _ => json!({"id": id, "added": null, "removed": null}),
        })
        .collect();
    Ok(json!({ "items": items }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_history_is_unknown_and_small_versions_keep_exact_counts() {
        let conn = Connection::open_in_memory().unwrap();
        crate::schema::init_main(&conn).unwrap();
        conn.execute_batch("INSERT INTO notes_meta(id,created_at,updated_at) VALUES('note',1,1);
            INSERT INTO notes_body(note_id) VALUES('note');
            INSERT INTO history(id,note_id,title,content,text,created_at,row_seq) VALUES
            ('old','note','','','one two',1,1),('new','note','','','two three four',2,2);").unwrap();
        let out = changes(&conn, &json!({"id":"note"})).unwrap();
        assert_eq!(out["items"][0], json!({"id":"new","added":2,"removed":1}));
        let large = "한".repeat(MAX_TEXT_BYTES / 3 + 1);
        conn.execute("UPDATE history SET text=?1 WHERE id='old'", [&large]).unwrap();
        let out = changes(&conn, &json!({"id":"note"})).unwrap();
        assert_eq!(out["items"][0], json!({"id":"new","added":null,"removed":null}));
        assert_eq!(out["items"][1], json!({"id":"old","added":null,"removed":null}));
    }
}
