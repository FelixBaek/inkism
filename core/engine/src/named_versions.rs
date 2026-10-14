//! Explicit local checkpoints. Automatic pruning must never remove these.
use crate::{
    error::{EngineError, Result},
    ids, ops_notes,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
const MAX_VERSIONS: i64 = 100;
const MAX_BYTES: i64 = 64 * 1024 * 1024;
fn label(args: &Value) -> Result<String> {
    let v = args
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if v.is_empty() || v.chars().count() > 120 {
        return Err(EngineError::invalid(
            "version name requires 1–120 characters",
        ));
    }
    Ok(v.to_string())
}
fn id(args: &Value, key: &str) -> Result<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|v| ids::valid_id(v))
        .map(str::to_string)
        .ok_or_else(|| EngineError::invalid(format!("bad {key}")))
}
fn guard(conn: &Connection, args: &Value) -> Result<String> {
    let id = id(args, "id")?;
    let row = ops_notes::load_summary(conn, &id)?;
    if row.locked || row.readonly || row.trashed {
        return Err(EngineError::invalid("note is not editable"));
    }
    if args.get("revision").and_then(Value::as_i64) != Some(row.revision) {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    Ok(id)
}
pub fn change(conn: &Connection, args: &Value, op: &str) -> Result<Value> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        let note = id(args, "id")?;
        guard(conn, args)?;
        if op == "history_name_current" {
            let name = label(args)?;
            let (count,bytes):(i64,i64)=conn.query_row("SELECT count(*),coalesce(sum(length(CAST(content AS BLOB))+length(CAST(text AS BLOB))),0) FROM history WHERE note_id=?1 AND label IS NOT NULL",[&note],|r|Ok((r.get(0)?,r.get(1)?)))?;
            let size:i64=conn.query_row("SELECT length(CAST(content AS BLOB))+length(CAST(text AS BLOB)) FROM notes_body WHERE note_id=?1",[&note],|r|r.get(0))?;
            if count >= MAX_VERSIONS || bytes.saturating_add(size) > MAX_BYTES {
                return Err(EngineError::invalid("named versions limit reached (100 versions / 64 MiB per note); remove a named version first"));
            }
            let hid = ids::new_id();
            conn.execute("INSERT INTO history_seq DEFAULT VALUES", [])?;
            let seq = conn.last_insert_rowid();
            conn.execute("INSERT INTO history(id,note_id,title,content,text,created_at,row_seq,note_revision,content_format,label) SELECT ?1,m.id,m.title,b.content,b.text,?2,?3,m.revision,m.content_format,?4 FROM notes_meta m JOIN notes_body b ON b.note_id=m.id WHERE m.id=?5",params![hid,ids::now_ms(),seq,name,note])?;
            return Ok(json!({"id":hid}));
        }
        let hid = id(args, "history_id")?;
        let current: Option<String> = conn
            .query_row(
                "SELECT label FROM history WHERE id=?1 AND note_id=?2",
                params![hid, note],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let current = current.ok_or_else(|| EngineError::NotFound("named version".into()))?;
        if args.get("expected_label").and_then(Value::as_str) != Some(current.as_str()) {
            return Err(EngineError::Conflict("version name changed".into()));
        }
        if op == "history_rename" {
            conn.execute(
                "UPDATE history SET label=?1 WHERE id=?2",
                params![label(args)?, hid],
            )?;
        } else {
            conn.execute("DELETE FROM history WHERE id=?1", [&hid])?;
        }
        Ok(json!({"id":hid}))
    })();
    ops_notes::finish_tx(conn, result)
}
pub fn body(conn: &Connection, args: &Value) -> Result<Value> {
    let note = id(args, "id")?;
    let hid = id(args, "history_id")?;
    if ops_notes::load_summary(conn, &note)?.locked {
        return Err(EngineError::invalid("note is locked"));
    }
    conn.query_row("SELECT title,content,content_format FROM history WHERE id=?1 AND note_id=?2",params![hid,note],|r|Ok(json!({"title":r.get::<_,String>(0)?,"content":r.get::<_,String>(1)?,"content_format":r.get::<_,String>(2)?}))).optional()?.ok_or_else(||EngineError::NotFound("history".into()))
}
/// Ids of a note's named snapshots in [`backup`] order.
pub fn named_ids(conn: &Connection, note: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM history WHERE note_id=?1 AND label IS NOT NULL ORDER BY row_seq")?;
    let ids = stmt.query_map([note], |r| r.get(0))?.collect::<std::result::Result<Vec<String>, _>>()?;
    Ok(ids)
}
/// One named snapshot of `note` in the [`backup`] row form.
pub fn backup_row(conn: &Connection, note: &str, id: &str) -> Result<Option<Value>> {
    Ok(conn.query_row("SELECT label,title,content,text,content_format,created_at,id FROM history WHERE id=?1 AND note_id=?2 AND label IS NOT NULL",params![id,note],|r|Ok(json!({"label":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"content":r.get::<_,String>(2)?,"text":r.get::<_,String>(3)?,"content_format":r.get::<_,String>(4)?,"created_at":r.get::<_,i64>(5)?,"id":r.get::<_,String>(6)?}))).optional()?)
}
pub fn backup(conn: &Connection, note: &str) -> Result<Value> {
    let mut stmt=conn.prepare("SELECT label,title,content,text,content_format,created_at,id FROM history WHERE note_id=?1 AND label IS NOT NULL ORDER BY row_seq")?;
    let rows=stmt.query_map([note],|r|Ok(json!({"label":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"content":r.get::<_,String>(2)?,"text":r.get::<_,String>(3)?,"content_format":r.get::<_,String>(4)?,"created_at":r.get::<_,i64>(5)?,"id":r.get::<_,String>(6)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(json!(rows))
}
pub fn import(
    conn: &Connection,
    note: &str,
    data: &Value,
    mapping: &std::collections::HashMap<&str, String>,
) -> Result<()> { import_with_ids(conn,note,data,mapping,false) }
pub fn import_with_ids(conn:&Connection,note:&str,data:&Value,mapping:&std::collections::HashMap<&str,String>,preserve_ids:bool)->Result<()> {
    let rows = data
        .as_array()
        .filter(|v| v.len() <= MAX_VERSIONS as usize)
        .ok_or_else(|| EngineError::invalid("invalid named versions"))?;
    let mut bytes = 0usize;
    if !rows.is_empty() && ops_notes::load_summary(conn, note)?.locked {
        return Err(EngineError::invalid(
            "locked backup cannot contain plaintext versions",
        ));
    }
    for row in rows {
        let name = label(row)?;
        let title = row
            .get("title")
            .and_then(Value::as_str)
            .ok_or_else(|| EngineError::invalid("invalid version title"))?;
        if title.chars().count() > crate::limits::MAX_TITLE_CHARS {
            return Err(EngineError::invalid("version title too long"));
        }
        let content = crate::links::remap_note_urls(
            row.get("content")
                .and_then(Value::as_str)
                .ok_or_else(|| EngineError::invalid("invalid version body"))?,
            mapping,
        );
        let text = crate::links::remap_note_urls(
            row.get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| EngineError::invalid("invalid version text"))?,
            mapping,
        );
        bytes = bytes
            .saturating_add(content.len())
            .saturating_add(text.len());
        if bytes > MAX_BYTES as usize {
            return Err(EngineError::invalid("named versions too large"));
        }
        let format = crate::source_format::from_value(row.get("content_format"))?;
        let content = crate::links::remap_term_references(&content, format, mapping);
        let at = crate::model::opt_timestamp(row, "created_at")?
            .ok_or_else(|| EngineError::invalid("missing version timestamp"))?;
        conn.execute("INSERT INTO history_seq DEFAULT VALUES", [])?;
        let seq = conn.last_insert_rowid();
        // Imported note revision starts at 1; never reuse the old revision number.
        conn.execute("INSERT INTO history(id,note_id,label,title,content,text,content_format,created_at,row_seq,note_revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL)",params![if preserve_ids {row["id"].as_str().filter(|id|ids::valid_id(id)).ok_or_else(||EngineError::invalid("invalid version id"))?.to_string()}else{ids::new_id()},note,name,title,content.as_str(),text.as_ref(),format,at,seq])?;
    }
    Ok(())
}
