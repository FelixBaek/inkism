//! Local-only receipts: preview uses the actual merge inside a rolled-back transaction.
//! Applying and undoing guard complete note+knowledge snapshots, never partially undo.
use crate::{
    error::{EngineError, Result},
    ids, ops_notes, settings, writing_ops,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
fn setup(c: &Connection) -> Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_merge_changes(id TEXT PRIMARY KEY,status TEXT NOT NULL,touched_at INTEGER NOT NULL,receipt TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS purge_merge_on_delete AFTER DELETE ON notes_meta BEGIN DELETE FROM local_merge_changes WHERE json_extract(receipt,'$.args.source_id')=OLD.id OR json_extract(receipt,'$.args.target_id')=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS purge_merge_on_lock AFTER UPDATE OF locked ON notes_meta WHEN NEW.locked=1 BEGIN DELETE FROM local_merge_changes WHERE json_extract(receipt,'$.args.source_id')=NEW.id OR json_extract(receipt,'$.args.target_id')=NEW.id; END;")?;
    Ok(())
}
fn transaction<T>(c: &Connection, f: impl FnOnce() -> Result<T>) -> Result<T> {
    c.execute_batch("BEGIN IMMEDIATE")?;
    match f() {
        Ok(v) => {
            c.execute_batch("COMMIT")?;
            Ok(v)
        }
        Err(e) => {
            let _ = c.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
fn snapshot(c: &Connection, args: &Value) -> Result<Value> {
    let mut notes = Vec::new();
    let mut meta = serde_json::Map::new();
    for key in ["source_id", "target_id"] {
        let id = args[key]
            .as_str()
            .ok_or_else(|| EngineError::invalid("missing merge ID"))?;
        let note = ops_notes::load_note(c, id)?.ok_or_else(|| EngineError::NotFound(id.into()))?;
        if note.locked || note.readonly {
            return Err(EngineError::Conflict("protected merge note".into()));
        }
        notes.push(serde_json::to_value(note)?);
        for prefix in ["knowledge_note:", "knowledge_redirect:"] {
            let key = format!("{prefix}{id}");
            meta.insert(
                key.clone(),
                serde_json::to_value(settings::stored(c, &key)?)?,
            );
        }
    }
    Ok(json!({"notes":notes,"settings":meta}))
}
fn write(c: &Connection, r: &Value) -> Result<()> {
    let raw = serde_json::to_string(r)?;
    if raw.len() > 32 * 1024 * 1024 {
        return Err(EngineError::invalid("merge receipt exceeds 32 MiB"));
    }
    c.execute("INSERT INTO local_merge_changes VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET status=excluded.status,touched_at=excluded.touched_at,receipt=excluded.receipt",params![r["id"].as_str(),r["status"].as_str(),ids::now_ms(),raw])?;
    for status in ["status='preview'", "status<>'preview'"] {
        c.execute(&format!("DELETE FROM local_merge_changes WHERE {status} AND id NOT IN(SELECT id FROM local_merge_changes WHERE {status} ORDER BY touched_at DESC,rowid DESC LIMIT 10)"),[])?;
    }
    Ok(())
}
fn read(c: &Connection, a: &Value) -> Result<Value> {
    let id = a["id"]
        .as_str()
        .filter(|s| ids::valid_id(s))
        .ok_or_else(|| EngineError::invalid("invalid merge receipt ID"))?;
    let raw: String = c
        .query_row(
            "SELECT receipt FROM local_merge_changes WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| EngineError::NotFound("merge receipt expired".into()))?;
    Ok(serde_json::from_str(&raw)?)
}
fn public(r: &Value) -> Value {
    json!({"id":r["id"],"status":r["status"],"source":r["before"]["notes"][0],"target":r["before"]["notes"][1],"merged":r["result"]["target"],"redirect":r["args"]["redirect"],"created_at":r["created_at"]})
}
pub fn preview(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    c.execute_batch("BEGIN IMMEDIATE")?;
    let result: Result<Value> = (|| {
        let before = snapshot(c, a)?;
        let merged = writing_ops::merge_tx(c, a)?;
        Ok(
            json!({"id":uuid::Uuid::new_v4().to_string(),"status":"preview","args":a,"before":before,"result":merged,"created_at":ids::now_ms()}),
        )
    })();
    c.execute_batch("ROLLBACK")?;
    let receipt: Value = result?;
    transaction(c, || {
        write(c, &receipt)?;
        Ok(public(&receipt))
    })
}
pub fn apply(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    transaction(c, || {
        let mut r = read(c, a)?;
        if r["status"] != "preview" || snapshot(c, &r["args"])? != r["before"] {
            return Err(EngineError::Conflict(
                "merge preview changed; preview again".into(),
            ));
        }
        let result = writing_ops::merge_tx(c, &r["args"])?;
        r["result"] = result;
        r["after"] = snapshot(c, &r["args"])?;
        r["status"] = json!("applied");
        write(c, &r)?;
        Ok(public(&r))
    })
}
pub fn undo(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    transaction(c, || {
        let mut r = read(c, a)?;
        if r["status"] != "applied" || snapshot(c, &r["args"])? != r["after"] {
            return Err(EngineError::Conflict(
                "merged notes or metadata changed; cannot undo".into(),
            ));
        }
        let before = &r["before"]["notes"];
        let target = &before[1];
        let input = serde_json::from_value(
            json!({"id":target["id"],"title":target["title"],"content":target["content"],"text":target["text"],"content_format":target["content_format"],"revision":r["after"]["notes"][1]["revision"]}),
        )?;
        ops_notes::save_tx(c, input)?;
        let patch = serde_json::from_value(json!({"trashed":before[0]["trashed"]}))?;
        ops_notes::apply_patch(
            c,
            before[0]["id"].as_str().unwrap(),
            &patch,
            r["after"]["notes"][0]["revision"].as_i64(),
            false,
        )?;
        for (key, value) in r["before"]["settings"].as_object().unwrap() {
            if value != &r["after"]["settings"][key] {
                let old = value
                    .as_array()
                    .and_then(|v| v.first())
                    .and_then(Value::as_str);
                settings::write_local(c, key, old)?;
            }
        }
        r["status"] = json!("undone");
        write(c, &r)?;
        Ok(public(&r))
    })
}
pub fn list(c: &Connection) -> Result<Value> {
    setup(c)?;
    let mut q=c.prepare("SELECT receipt FROM local_merge_changes WHERE status<>'preview' ORDER BY touched_at DESC,rowid DESC LIMIT 10")?;
    let rows = q
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut items = Vec::new();
    for raw in rows {
        let r: Value = serde_json::from_str(&raw)?;
        let mut item = json!({"id":r["id"],"status":r["status"],"created_at":r["created_at"],"source_title":r["before"]["notes"][0]["title"],"target_title":r["before"]["notes"][1]["title"]});
        item["can_undo"] = json!(
            r["status"] == "applied"
                && snapshot(c, &r["args"]).is_ok_and(|current| current == r["after"])
        );
        items.push(item);
    }
    Ok(json!({"items":items}))
}

/// Remove cleartext receipts before vault encryption or permanent deletion.
pub fn purge_note(c: &Connection, id: &str) -> Result<()> {
    setup(c)?;
    c.execute("DELETE FROM local_merge_changes WHERE json_extract(receipt,'$.args.source_id')=?1 OR json_extract(receipt,'$.args.target_id')=?1",[id])?;
    Ok(())
}
