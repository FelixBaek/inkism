//! AI-proposed wiki note updates. Receipts are local only: they keep the exact
//! before/after bodies so Approve and Undo are all-or-nothing, and the source
//! note revisions the proposal was written from, so later source edits show as stale.
use crate::{
    error::{EngineError, Result},
    ids, ops_notes,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_SOURCES: usize = 12;
const KEEP_PER_NOTE: i64 = 20;

fn setup(c: &Connection) -> Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_wiki_changes(id TEXT PRIMARY KEY,note_id TEXT NOT NULL,key TEXT NOT NULL,sig TEXT NOT NULL,status TEXT NOT NULL,before_hash TEXT NOT NULL,after_hash TEXT NOT NULL,before_body TEXT,before_text TEXT,after_body TEXT,after_text TEXT,format TEXT NOT NULL,sources TEXT NOT NULL,model TEXT NOT NULL,created_at INTEGER NOT NULL,touched_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS local_wiki_changes_note ON local_wiki_changes(note_id,touched_at);
CREATE TRIGGER IF NOT EXISTS purge_wiki_on_delete AFTER DELETE ON notes_meta BEGIN DELETE FROM local_wiki_changes WHERE note_id=OLD.id OR EXISTS(SELECT 1 FROM json_each(sources) s WHERE json_extract(s.value,'$.id')=OLD.id); END;
CREATE TRIGGER IF NOT EXISTS purge_wiki_on_lock AFTER UPDATE OF locked ON notes_meta WHEN NEW.locked=1 BEGIN DELETE FROM local_wiki_changes WHERE note_id=NEW.id OR EXISTS(SELECT 1 FROM json_each(sources) s WHERE json_extract(s.value,'$.id')=NEW.id); END;")?;
    Ok(())
}

fn transaction<T>(c: &Connection, f: impl FnOnce() -> Result<T>) -> Result<T> {
    c.execute_batch("BEGIN IMMEDIATE")?;
    let result = f();
    if result.is_ok() {
        c.execute_batch("COMMIT")?;
    } else {
        let _ = c.execute_batch("ROLLBACK");
    }
    result
}

fn sha(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}

fn arg_id<'a>(a: &'a Value, key: &str) -> Result<&'a str> {
    a[key]
        .as_str()
        .filter(|s| ids::valid_id(s))
        .ok_or_else(|| EngineError::invalid(format!("invalid {key}")))
}

/// The wiki note itself: present, editable and readable as plaintext.
fn editable_target(c: &Connection, id: &str) -> Result<crate::model::Note> {
    let note = ops_notes::load_note(c, id)?.ok_or_else(|| EngineError::NotFound(id.into()))?;
    if note.locked || note.trashed || note.readonly {
        return Err(EngineError::Conflict("wiki note is not editable".into()));
    }
    Ok(note)
}

/// Current (revision, title) of a source that may still be cited; None when unusable.
fn live_source(c: &Connection, id: &str) -> Result<Option<(i64, String)>> {
    Ok(c
        .query_row(
            "SELECT revision,title FROM notes_meta WHERE id=?1 AND locked=0 AND trashed=0",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

/// Validates `[{id,revision}]` against the live notes and returns them sorted with titles.
fn checked_sources(c: &Connection, target: &str, a: &Value) -> Result<Vec<Value>> {
    let list = a["sources"]
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= MAX_SOURCES)
        .ok_or_else(|| EngineError::invalid("sources must list 1-12 notes"))?;
    let mut out = Vec::new();
    for s in list {
        let id = arg_id(s, "id")?;
        let revision = s["revision"]
            .as_i64()
            .ok_or_else(|| EngineError::invalid("source revision"))?;
        if id == target || out.iter().any(|v: &Value| v["id"] == id) {
            return Err(EngineError::invalid("duplicate or self source"));
        }
        match live_source(c, id)? {
            Some((current, title)) if current == revision => {
                out.push(json!({"id":id,"revision":revision,"title":title}))
            }
            _ => return Err(EngineError::Conflict("source note changed; propose again".into())),
        }
    }
    out.sort_by(|x, y| x["id"].as_str().cmp(&y["id"].as_str()));
    Ok(out)
}

fn model_arg(a: &Value) -> Result<&str> {
    a["model"]
        .as_str()
        .filter(|m| !m.trim().is_empty() && m.len() <= 200)
        .ok_or_else(|| EngineError::invalid("invalid model"))
}

/// Signature of what the AI saw besides the wiki body: sorted source revisions + model.
fn signature(sources: &[Value], model: &str) -> String {
    let parts: Vec<String> = sources
        .iter()
        .map(|s| format!("{}@{}", s["id"].as_str().unwrap_or(""), s["revision"]))
        .collect();
    format!("{}|{model}", parts.join(","))
}

fn proposal_key(note_id: &str, body_hash: &str, sig: &str) -> String {
    sha(&format!("{note_id}\n{body_hash}\n{sig}"))
}

const COLUMNS: &str = "id,note_id,status,before_body,after_body,format,sources,model,created_at";

fn public(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    let sources: String = r.get(6)?;
    Ok(json!({"id":r.get::<_,String>(0)?,"note_id":r.get::<_,String>(1)?,"status":r.get::<_,String>(2)?,"before":r.get::<_,Option<String>>(3)?,"after":r.get::<_,Option<String>>(4)?,"content_format":r.get::<_,String>(5)?,"sources":serde_json::from_str::<Value>(&sources).unwrap_or(Value::Null),"model":r.get::<_,String>(7)?,"created_at":r.get::<_,i64>(8)?}))
}

fn find(c: &Connection, sql_where: &str, p: impl rusqlite::Params) -> Result<Option<Value>> {
    let sql = format!("SELECT {COLUMNS} FROM local_wiki_changes WHERE {sql_where} ORDER BY touched_at DESC,rowid DESC LIMIT 1");
    Ok(c.query_row(&sql, p, public).optional()?)
}

/// An earlier proposal for the same wiki body and sources, or an applied one whose
/// result is the current body with the same sources: nothing new to send to AI.
fn duplicate(c: &Connection, note_id: &str, key: &str, body_hash: &str, sig: &str) -> Result<Option<Value>> {
    find(
        c,
        "note_id=?1 AND (key=?2 OR (status='applied' AND after_hash=?3 AND sig=?4))",
        params![note_id, key, body_hash, sig],
    )
}

/// `{note_id, sources:[{id,revision}], model}` → `{existing}` before any AI call.
pub fn check(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    let note_id = arg_id(a, "note_id")?;
    let note = editable_target(c, note_id)?;
    let sources = checked_sources(c, note_id, a)?;
    let sig = signature(&sources, model_arg(a)?);
    let hash = sha(&note.content);
    let existing = duplicate(c, note_id, &proposal_key(note_id, &hash, &sig), &hash, &sig)?;
    Ok(json!({"existing":existing,"sources":sources}))
}

fn after_args(a: &Value) -> Result<(&str, Option<&str>)> {
    let after = a["after"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| EngineError::invalid("empty proposal"))?;
    ops_notes::check_field_size("content", after)?;
    let text = a["after_text"].as_str();
    if let Some(t) = text {
        ops_notes::check_field_size("text", t)?;
    }
    Ok((after, text))
}

/// `{note_id, revision, sources, model, after, after_text?}`: stores a proposal
/// for the exact body and sources it was written from; duplicates return the earlier one.
pub fn record(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    let note_id = arg_id(a, "note_id")?;
    let (after, after_text) = after_args(a)?;
    let model = model_arg(a)?;
    transaction(c, || {
        let note = editable_target(c, note_id)?;
        if a["revision"].as_i64() != Some(note.revision) {
            return Err(EngineError::Conflict("wiki note changed; propose again".into()));
        }
        let sources = checked_sources(c, note_id, a)?;
        let sig = signature(&sources, model);
        let hash = sha(&note.content);
        let key = proposal_key(note_id, &hash, &sig);
        if let Some(existing) = duplicate(c, note_id, &key, &hash, &sig)? {
            return Ok(existing);
        }
        if after == note.content {
            return Err(EngineError::invalid("proposal does not change the note"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = ids::now_ms();
        let text = after_text.unwrap_or(after);
        c.execute("INSERT INTO local_wiki_changes(id,note_id,key,sig,status,before_hash,after_hash,before_body,before_text,after_body,after_text,format,sources,model,created_at,touched_at) VALUES(?1,?2,?3,?4,'proposed',?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14)",
            params![id,note_id,key,sig,hash,sha(after),note.content,note.text,after,text,note.content_format,serde_json::to_string(&sources)?,model,now])?;
        c.execute("DELETE FROM local_wiki_changes WHERE note_id=?1 AND id NOT IN(SELECT id FROM local_wiki_changes WHERE note_id=?1 ORDER BY touched_at DESC,rowid DESC LIMIT ?2)", params![note_id, KEEP_PER_NOTE])?;
        find(c, "id=?1", [&id])?.ok_or_else(|| EngineError::NotFound("wiki proposal".into()))
    })
}

struct Receipt {
    note_id: String,
    status: String,
    before_hash: String,
    after_hash: String,
    before: Option<(String, String)>,
    after: Option<(String, String)>,
    sources: Vec<Value>,
}

fn load(c: &Connection, a: &Value) -> Result<(String, Receipt)> {
    let id = arg_id(a, "id")?.to_string();
    let r = c
        .query_row("SELECT note_id,status,before_hash,after_hash,before_body,before_text,after_body,after_text,sources FROM local_wiki_changes WHERE id=?1", [&id], |r| {
            let pair = |i: usize| -> rusqlite::Result<Option<(String, String)>> {
                Ok(r.get::<_, Option<String>>(i)?.zip(r.get::<_, Option<String>>(i + 1)?))
            };
            Ok(Receipt { note_id: r.get(0)?, status: r.get(1)?, before_hash: r.get(2)?, after_hash: r.get(3)?, before: pair(4)?, after: pair(6)?, sources: serde_json::from_str(&r.get::<_, String>(8)?).unwrap_or_default() })
        })
        .optional()?
        .ok_or_else(|| EngineError::NotFound("wiki proposal expired".into()))?;
    Ok((id, r))
}

fn stale(c: &Connection, sources: &[Value]) -> Result<bool> {
    for s in sources {
        let current = live_source(c, s["id"].as_str().unwrap_or(""))?;
        if current.map(|v| v.0) != s["revision"].as_i64() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn write_body(c: &Connection, note: &crate::model::Note, body: &(String, String)) -> Result<()> {
    let input = serde_json::from_value(json!({"id":note.id,"content":body.0,"text":body.1,"content_format":note.content_format,"revision":note.revision}))?;
    ops_notes::save_tx(c, input)?;
    Ok(())
}

fn set_status(c: &Connection, id: &str, status: &str) -> Result<Value> {
    c.execute("UPDATE local_wiki_changes SET status=?2,touched_at=?3 WHERE id=?1", params![id, status, ids::now_ms()])?;
    find(c, "id=?1", [id])?.ok_or_else(|| EngineError::NotFound("wiki proposal".into()))
}

/// Applies only onto the exact body the proposal was made from, with unchanged sources.
pub fn apply(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    transaction(c, || {
        let (id, r) = load(c, a)?;
        if r.status != "proposed" && r.status != "undone" {
            return Err(EngineError::Conflict("proposal is not pending".into()));
        }
        let note = editable_target(c, &r.note_id)?;
        if sha(&note.content) != r.before_hash || stale(c, &r.sources)? {
            return Err(EngineError::Conflict("note or sources changed; propose again".into()));
        }
        write_body(c, &note, r.after.as_ref().ok_or_else(|| EngineError::Conflict("proposal body missing".into()))?)?;
        set_status(c, &id, "applied")
    })
}

/// Rejected proposals keep only their key so the same input is not sent to AI again.
pub fn reject(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    transaction(c, || {
        let (id, r) = load(c, a)?;
        if r.status != "proposed" && r.status != "undone" {
            return Err(EngineError::Conflict("proposal is not pending".into()));
        }
        c.execute("UPDATE local_wiki_changes SET before_body=NULL,before_text=NULL,after_body=NULL,after_text=NULL WHERE id=?1", [&id])?;
        set_status(c, &id, "rejected")
    })
}

/// Restores the exact earlier body, only while the note still holds the applied result.
pub fn undo(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    transaction(c, || {
        let (id, r) = load(c, a)?;
        let note = editable_target(c, &r.note_id)?;
        if r.status != "applied" || sha(&note.content) != r.after_hash {
            return Err(EngineError::Conflict("wiki note changed after approval; cannot undo".into()));
        }
        write_body(c, &note, r.before.as_ref().ok_or_else(|| EngineError::Conflict("earlier body missing".into()))?)?;
        set_status(c, &id, "undone")
    })
}

/// Last 10 receipts for one note, without bodies, with stale/undo flags.
pub fn list(c: &Connection, a: &Value) -> Result<Value> {
    setup(c)?;
    let note_id = arg_id(a, "note_id")?;
    let current = c
        .query_row("SELECT b.content FROM notes_body b JOIN notes_meta m ON m.id=b.note_id WHERE b.note_id=?1 AND m.locked=0", [note_id], |r| r.get::<_, String>(0))
        .optional()?
        .map(|body| sha(&body));
    let mut q = c.prepare("SELECT id,status,after_hash,sources,model,created_at,touched_at FROM local_wiki_changes WHERE note_id=?1 ORDER BY touched_at DESC,rowid DESC LIMIT 10")?;
    let rows = q
        .query_map([note_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, i64>(5)?, r.get::<_, i64>(6)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut items = Vec::new();
    for (id, status, after_hash, sources, model, created, touched) in rows {
        let sources: Vec<Value> = serde_json::from_str(&sources).unwrap_or_default();
        let can_undo = status == "applied" && current.as_deref() == Some(after_hash.as_str());
        items.push(json!({"id":id,"status":status,"sources":sources,"model":model,"created_at":created,"touched_at":touched,"stale":stale(c,&sources)?,"can_undo":can_undo}));
    }
    Ok(json!({"items":items}))
}

/// Linked notes usable as evidence: backlinks and outgoing links, newest first, bounded.
/// Locked/trashed notes and the wiki note itself never appear.
pub fn sources(c: &Connection, a: &Value) -> Result<Value> {
    let note_id = arg_id(a, "note_id")?;
    let mut q = c.prepare(
        "WITH target AS (SELECT id,title FROM notes_meta WHERE id=?1 AND locked=0 AND trashed=0),
         names AS (SELECT title AS name FROM target UNION SELECT a.value FROM settings s,json_each(s.value,'$.aliases') a WHERE s.key='knowledge_note:'||?1 AND EXISTS(SELECT 1 FROM target)),
         linked AS (
           SELECT source_id AS id FROM searchidx.backlinks WHERE target_id=?1
           UNION SELECT source_id FROM searchidx.backlink_titles WHERE target_title COLLATE NOCASE IN (SELECT name FROM names)
           UNION SELECT target_id FROM searchidx.backlinks WHERE source_id=?1
           UNION SELECT m.id FROM searchidx.backlink_titles b JOIN notes_meta m ON m.title=b.target_title COLLATE NOCASE WHERE b.source_id=?1)
         SELECT m.id,m.title,m.revision,m.updated_at FROM notes_meta m JOIN linked l ON l.id=m.id
         WHERE m.id<>?1 AND m.locked=0 AND m.trashed=0 AND EXISTS(SELECT 1 FROM target)
         ORDER BY m.updated_at DESC,m.id LIMIT ?2",
    )?;
    let items = q
        .query_map(params![note_id, MAX_SOURCES as i64], |r| Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"revision":r.get::<_,i64>(2)?,"updated_at":r.get::<_,i64>(3)?})))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({"items":items}))
}
