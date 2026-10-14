//! Notebooks, tags, stats, health, backlinks and index-status operations.

use crate::error::{EngineError, Result};
use crate::ids;
use crate::limits;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

/// Live notebooks for screens; trashed ones are listed by `trashed_notebooks`.
pub fn notebooks(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, parent_id, description, cover FROM notebooks WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(json!({
            "id": r.get::<_, String>(0)?,
            "name": r.get::<_, String>(1)?,
            "color": r.get::<_, Option<String>>(2)?,
            "parent_id": r.get::<_, Option<String>>(3)?,
            "description": r.get::<_, String>(4)?,
            "cover": crate::notebook_cover::to_value(r.get(5)?),
        }))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(Value::Array(out))
}

/// Every notebook including trash state, for backups.
pub fn all_notebooks(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, parent_id, description, deleted_at, deleted_by, cover FROM notebooks ORDER BY name COLLATE NOCASE, id",
    )?;
    let rows = stmt.query_map([], |r| {
        let mut notebook = json!({
            "id": r.get::<_, String>(0)?,
            "name": r.get::<_, String>(1)?,
            "color": r.get::<_, Option<String>>(2)?,
            "parent_id": r.get::<_, Option<String>>(3)?,
            "description": r.get::<_, String>(4)?,
        });
        if let Some(at) = r.get::<_, Option<i64>>(5)? {
            notebook["deleted_at"] = json!(at);
            notebook["deleted_by"] = json!(r.get::<_, String>(6)?);
        }
        // Old backups have no cover field; only write it when set.
        let cover = crate::notebook_cover::to_value(r.get(7)?);
        if !cover.is_null() {
            notebook["cover"] = cover;
        }
        Ok(notebook)
    })?;
    Ok(Value::Array(rows.collect::<rusqlite::Result<Vec<_>>>()?))
}

pub fn save_notebook(conn: &Connection, args: &Value) -> Result<Value> {
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| EngineError::invalid("notebook name required"))?;
    if name.chars().count() > limits::MAX_NOTEBOOK_NAME_CHARS {
        return Err(EngineError::invalid("notebook name too long"));
    }
    let color = match crate::model::opt_string(args, "color")? {
        None => None,
        Some(c) => {
            if let Some(c) = &c {
                if c.chars().count() > limits::MAX_COLOR_CHARS {
                    return Err(EngineError::invalid("color too long"));
                }
            }
            c
        }
    };

    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<Value> {
        let existing = match args.get("id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => {
                if !ids::valid_id(id) {
                    return Err(EngineError::invalid("bad id"));
                }
                conn.query_row("SELECT id FROM notebooks WHERE id = ?1", params![id], |r| {
                    r.get::<_, String>(0)
                })
                .optional()?
            }
            _ => None,
        };
        let id = existing.unwrap_or_else(ids::new_id);
        let (parent, description) = notebook_details(conn, &id, args, true)?;
        let cover = crate::notebook_cover::resolve(conn, &id, args)?;
        conn.execute(
            "INSERT INTO notebooks(id,name,color,parent_id,description,cover) VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,parent_id=excluded.parent_id,description=excluded.description,cover=excluded.cover",
            params![id,name,color,parent,description,cover],
        )?;
        Ok(json!({ "id": id, "name": name, "color": color,"parent_id":parent,"description":description,"cover":crate::notebook_cover::to_value(cover) }))
    })();
    match result {
        Ok(v) => {
            conn.execute_batch("COMMIT;")?;
            Ok(v)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

/// Caller owns the write transaction. Older rename/sync payloads preserve
/// hierarchy and descriptions; an explicit null clears the corresponding field.
pub fn notebook_details(
    conn: &Connection,
    id: &str,
    args: &Value,
    require_parent: bool,
) -> Result<(Option<String>, String)> {
    let previous = conn
        .query_row(
            "SELECT parent_id,description FROM notebooks WHERE id=?1",
            [id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .unwrap_or_default();
    let parent = crate::model::opt_string(args, "parent_id")?.unwrap_or(previous.0);
    let description = crate::model::opt_string(args, "description")?
        .map(|value| value.unwrap_or_default())
        .unwrap_or(previous.1);
    crate::ops_notes::check_field_size("notebook description", &description)?;
    if let Some(parent) = &parent {
        if !ids::valid_id(parent) {
            return Err(EngineError::invalid("bad parent_id"));
        }
        let mut visited = std::collections::HashSet::from([id.to_string()]);
        let mut next = Some(parent.clone());
        let mut read = conn.prepare("SELECT parent_id FROM notebooks WHERE id=?1")?;
        while let Some(ancestor) = next {
            if !visited.insert(ancestor.clone()) {
                return Err(EngineError::invalid("notebook hierarchy contains a cycle"));
            }
            let row = read
                .query_row([&ancestor], |row| row.get::<_, Option<String>>(0))
                .optional()?;
            if require_parent
                && args.get("parent_id").is_some()
                && ancestor == *parent
                && row.is_none()
            {
                return Err(EngineError::NotFound(format!("parent notebook {parent}")));
            }
            // Incoming children can precede their parent. Keep the requested
            // reference so the hierarchy resolves when that parent arrives.
            next = row.flatten();
        }
    }
    Ok((parent, description))
}

/// Deleting a notebook never deletes notes (protocol); notes are detached.
pub fn delete_notebook(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("missing id"))?;
    if !ids::valid_id(id) {
        return Err(EngineError::invalid("bad id"));
    }
    let current = current_note_argument(args)?;
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<Value> {
        if let Some((note_id, revision)) = current {
            if crate::ops_notes::load_summary(conn, note_id)?.revision != revision {
                return Err(EngineError::Conflict("document revision changed".into()));
            }
        }
        let trashed: Option<i64> = conn
            .query_row("SELECT deleted_at FROM notebooks WHERE id=?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| EngineError::NotFound(format!("notebook {id}")))?;
        // Deleting from trash removes the trashed sub-notebooks with it (original
        // trash._delete); a live delete keeps the existing single-notebook rule.
        let removed = if trashed.is_some() {
            crate::notebook_trash::subtree(conn, id, true)?
        } else {
            vec![id.to_string()]
        };
        let key = crate::settings::DEFAULT_NOTEBOOK;
        let default = crate::settings::stored(conn, key)?.and_then(|(value, _)| value);
        let mut updated = 0;
        for notebook in &removed {
            conn.execute("DELETE FROM notebooks WHERE id = ?1", params![notebook])?;
            updated += detach_notebook(conn, notebook)?;
        }
        // A local delete is a new decision and syncs as an explicit clear.
        // Remote deletes leave the reference; reads ignore a missing notebook.
        if default.is_some_and(|value| removed.contains(&value)) {
            crate::settings::write_local(conn, key, None)?;
        }
        let summary = current
            .map(|(id, _)| crate::ops_notes::load_summary(conn, id))
            .transpose()?;
        Ok(json!({ "deleted": true,"removed":removed,"updated":updated,"current":summary }))
    })();
    match result {
        Ok(v) => {
            conn.execute_batch("COMMIT;")?;
            Ok(v)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

pub fn tags(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT je.value, COUNT(*), (SELECT value FROM settings WHERE key='tag_color:'||je.value)
         FROM notes_meta m, json_each(m.tags) je
         WHERE m.trashed = 0
         GROUP BY je.value ORDER BY COUNT(*) DESC, je.value",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(json!({
            "name": r.get::<_, String>(0)?,
            "count": r.get::<_, i64>(1)?,
            "color": r.get::<_, Option<String>>(2)?,
        }))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(Value::Array(out))
}

pub fn stats(conn: &Connection) -> Result<Value> {
    let count = |where_sql: &str| -> Result<i64> {
        Ok(conn.query_row(
            &format!("SELECT COUNT(*) FROM notes_meta WHERE {where_sql}"),
            [],
            |r| r.get(0),
        )?)
    };
    Ok(json!({
        "notes": count("trashed = 0 AND archived = 0")?,
        "favorites": count("trashed = 0 AND archived = 0 AND favorite = 1")?,
        "archive": count("trashed = 0 AND archived = 1")?,
        "trash": count("trashed = 1")?,
    }))
}

pub fn health() -> Result<Value> {
    Ok(json!({ "version": env!("CARGO_PKG_VERSION") }))
}

/// {op:"backlinks",id} -> {items:[Summary]} of non-trashed notes whose bodies
/// link to `id` via [[Title]] or note://ID. Built by the background worker.
pub fn backlinks(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("missing id"))?;
    if !ids::valid_id(id) {
        return Err(EngineError::invalid("bad id"));
    }
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(50).clamp(1,100) as usize;
    let cursor = args.get("cursor").and_then(Value::as_str).map(|raw| -> Result<(i64,String)> {
        let value: (i64,String) = serde_json::from_str(raw).map_err(|_| EngineError::invalid("bad backlinks cursor"))?;
        if !ids::valid_id(&value.1) { return Err(EngineError::invalid("bad backlinks cursor")); }
        Ok(value)
    }).transpose()?;
    let (created, after) = cursor.unwrap_or((i64::MAX,String::new()));
    let mut stmt = conn.prepare(
        "SELECT m.id, m.title, m.preview, m.notebook_id, m.tags, m.favorite, m.pinned,
                m.archived, m.trashed, m.color, m.created_at, m.updated_at, m.revision, m.edited_at
         FROM notes_meta m
         WHERE m.trashed=0 AND m.locked=0 AND m.id!=?1
           AND (m.created_at<?2 OR (m.created_at=?2 AND m.id<?3))
           AND EXISTS(SELECT 1 FROM notes_meta target WHERE target.id=?1 AND target.trashed=0 AND target.locked=0)
           AND m.id IN (
           SELECT source_id FROM searchidx.backlinks WHERE target_id=?1
           UNION SELECT source_id FROM searchidx.backlink_titles
             WHERE target_title COLLATE NOCASE IN (
               SELECT title FROM notes_meta WHERE id=?1 AND trashed=0 AND locked=0
               UNION SELECT a.value FROM settings s, json_each(s.value,'$.aliases') a
                 WHERE s.key='knowledge_note:'||?1 AND s.value IS NOT NULL
             )
         )
         ORDER BY m.created_at DESC, m.id DESC LIMIT ?4",
    )?;
    let rows = stmt.query_map(params![id,created,after,(limit+1) as i64], row_to_summary)?;
    let mut items = Vec::new();
    for r in rows {
        let mut note = r?;
        note["notebook_ids"] = json!(crate::notebook_membership::load(conn, note["id"].as_str().expect("summary id"))?);
        items.push(note);
    }
    let next_cursor = if items.len()>limit {
        items.truncate(limit);
        let last=items.last().expect("nonempty page");
        Some(serde_json::to_string(&(last["created_at"].as_i64().unwrap(),last["id"].as_str().unwrap())).expect("cursor"))
    } else { None };
    Ok(json!({ "items": items, "next_cursor":next_cursor }))
}

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let tags: Vec<String> = serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_default();
    Ok(json!({
        "id": r.get::<_, String>(0)?,
        "title": r.get::<_, String>(1)?,
        "preview": r.get::<_, String>(2)?,
        "notebook_id": r.get::<_, Option<String>>(3)?,
        "tags": tags,
        "favorite": r.get::<_, i64>(5)? != 0,
        "pinned": r.get::<_, i64>(6)? != 0,
        "archived": r.get::<_, i64>(7)? != 0,
        "trashed": r.get::<_, i64>(8)? != 0,
        "color": r.get::<_, Option<String>>(9)?,
        "created_at": r.get::<_, i64>(10)?,
        "updated_at": r.get::<_, i64>(11)?,
        "edited_at": r.get::<_, i64>(13)?,
        "revision": r.get::<_, i64>(12)?,
    }))
}

/// Rename/merge or remove a tag everywhere, including archive and trash.
/// All notes, history snapshots and sync/index jobs commit together.
pub fn change_tag(conn: &Connection, args: &Value) -> Result<Value> {
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("missing tag name"))?;
    let replacement = match args.get("replacement") {
        Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.as_str()),
        _ => {
            return Err(EngineError::invalid(
                "replacement must be a tag name or null",
            ))
        }
    };
    let mut names = vec![name.to_string()];
    if let Some(value) = replacement {
        names.push(value.to_string());
    }
    crate::ops_notes::check_tags(&names)?;
    let current = current_note_argument(args)?;
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<Value> {
        if let Some((id, revision)) = current {
            if crate::ops_notes::load_summary(conn, id)?.revision != revision {
                return Err(EngineError::Conflict("document revision changed".into()));
            }
        }
        let updated = retag_notes(conn, name, replacement)?;
        // The default tag follows a rename and is cleared by removal.
        if crate::settings::default_tag(conn)?.as_deref() == Some(name) {
            crate::settings::write_local(conn, crate::settings::DEFAULT_TAG, replacement)?;
        }
        crate::settings::move_tag_color(conn, name, replacement)?;
        let summary = current
            .map(|(id, _)| crate::ops_notes::load_summary(conn, id))
            .transpose()?;
        Ok(json!({"updated":updated,"current":summary}))
    })();
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT;")?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

/// Rewrites `name` to `replacement` (or drops it) on every tagged note.
/// Returns how many notes changed. Caller owns the transaction.
fn retag_notes(conn: &Connection, name: &str, replacement: Option<&str>) -> Result<i64> {
    let mut stmt=conn.prepare("SELECT id,tags,revision FROM notes_meta m WHERE EXISTS (SELECT 1 FROM json_each(m.tags) WHERE value=?1)")?;
    let rows = stmt
        .query_map([name], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    let mut updated = 0;
    for (id, raw, revision) in rows {
        let tags: Vec<String> = serde_json::from_str(&raw)?;
        let mut next = Vec::new();
        for tag in tags {
            if tag == name {
                if let Some(value) = replacement {
                    next.push(value.to_string());
                }
            } else {
                next.push(tag);
            }
        }
        let serialized = crate::ops_notes::serialize_tags(Some(&next))?;
        if serialized == raw {
            continue;
        }
        let revision = revision
            .checked_add(1)
            .ok_or_else(|| EngineError::invalid("revision overflow"))?;
        crate::ops_notes::snapshot_stored_history(conn, &id)?;
        conn.execute(
            "UPDATE notes_meta SET tags=?1,revision=?2,updated_at=?3 WHERE id=?4",
            params![serialized, revision, ids::now_ms(), id],
        )?;
        crate::indexer::enqueue(conn, &id, revision)?;
        updated += 1;
    }
    Ok(updated)
}

pub(crate) fn current_note_argument(args: &Value) -> Result<Option<(&str, i64)>> {
    Ok(match args.get("current_id") {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) if ids::valid_id(id) => {
            let revision = args
                .get("current_revision")
                .and_then(Value::as_i64)
                .filter(|v| *v > 0)
                .ok_or_else(|| EngineError::invalid("current_revision required"))?;
            Some((id, revision))
        }
        _ => return Err(EngineError::invalid("invalid current_id")),
    })
}

/// Caller owns the transaction, including remote notebook tombstones.
pub fn detach_notebook(conn: &Connection, id: &str) -> Result<usize> {
    // Permanent removal keeps child notebooks and their notes, promoting the
    // children to roots. The existing journal triggers record local promotions.
    conn.execute("UPDATE notebooks SET parent_id=NULL WHERE parent_id=?1", [id])?;
    let mut stmt = conn.prepare("SELECT m.id,m.revision FROM note_notebooks nn JOIN notes_meta m ON m.id=nn.note_id WHERE nn.notebook_id=?1")?;
    let rows = stmt
        .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    for (note, revision) in &rows {
        let revision = revision
            .checked_add(1)
            .ok_or_else(|| EngineError::invalid("revision overflow"))?;
        crate::ops_notes::snapshot_stored_history(conn, note)?;
        let remaining = crate::notebook_membership::load(conn, note)?.into_iter()
            .filter(|notebook|notebook != id).collect::<Vec<_>>();
        crate::notebook_membership::replace(conn, note, &remaining, false)?;
        conn.execute(
            "UPDATE notes_meta SET revision=?1,updated_at=?2 WHERE id=?3",
            params![revision, ids::now_ms(), note],
        )?;
        crate::indexer::enqueue(conn, note, revision)?;
    }
    Ok(rows.len())
}

/// Bounded derived HTML candidates for a backlink; never reads the canonical body.
pub fn backlink_blocks(conn:&Connection,args:&Value)->Result<Value>{
 let id=args.get("id").and_then(Value::as_str).filter(|v|ids::valid_id(v)).ok_or_else(||EngineError::invalid("bad id"))?;
 let target=args.get("target").and_then(Value::as_str).filter(|v|ids::valid_id(v)).ok_or_else(||EngineError::invalid("bad target"))?;
 let revision=args.get("revision").and_then(Value::as_i64).ok_or_else(||EngineError::invalid("missing revision"))?;
 let after=args.get("after").and_then(Value::as_i64).unwrap_or(-1);
 let tx=conn.unchecked_transaction()?;
 let actual:Option<i64>=tx.query_row("SELECT revision FROM notes_meta WHERE id=?1 AND locked=0 AND trashed=0",[id],|r|r.get(0)).optional()?;
 if actual!=Some(revision){return Err(EngineError::Conflict("document revision changed or unavailable".into()));}
 let title:Option<String>=tx.query_row("SELECT title FROM notes_meta WHERE id=?1 AND locked=0 AND trashed=0",[target],|r|r.get(0)).optional()?;
 let Some(title)=title else{return Err(EngineError::NotFound("target".into()));};
 let cached:Option<i64>=tx.query_row("SELECT revision FROM searchidx.document_layout WHERE note_id=?1",[id],|r|r.get(0)).optional()?;
 if cached!=Some(revision){return Ok(json!({"ready":false,"items":[],"next":null}));}
 let mut stmt=tx.prepare("SELECT ordinal,byte_offset,CASE WHEN length(CAST(html AS BLOB))<=65536 THEN html ELSE NULL END FROM searchidx.document_blocks WHERE note_id=?1 AND ordinal>?2 AND (instr(html,?3)>0 OR (?4!='' AND instr(lower(html),lower(?4))>0) OR EXISTS(SELECT 1 FROM settings s,json_each(s.value,'$.aliases') a WHERE s.key='knowledge_note:'||?3 AND instr(lower(html),lower(a.value))>0)) ORDER BY ordinal LIMIT 17")?;
 let mut rows=stmt.query(params![id,after,target,title])?;let mut items=Vec::new();let mut next=None;
 while let Some(row)=rows.next()?{if items.len()==16{next=items.last().and_then(|v:&Value|v["ordinal"].as_i64());break;}items.push(json!({"ordinal":row.get::<_,i64>(0)?,"byte_offset":row.get::<_,i64>(1)?,"html":row.get::<_,Option<String>>(2)?}));}
 Ok(json!({"ready":true,"items":items,"next":next}))
}

/// Distinct outgoing targets from the background index; works without a full-body read.
pub fn outgoing_links(conn:&Connection,args:&Value)->Result<Value>{
 let id=args.get("id").and_then(Value::as_str).filter(|v|ids::valid_id(v)).ok_or_else(||EngineError::invalid("bad id"))?;
 let revision=args.get("revision").and_then(Value::as_i64).ok_or_else(||EngineError::invalid("missing revision"))?;
 let tx=conn.unchecked_transaction()?;
 let actual:Option<i64>=tx.query_row("SELECT revision FROM notes_meta WHERE id=?1 AND locked=0 AND trashed=0",[id],|r|r.get(0)).optional()?;
 if actual!=Some(revision){return Err(EngineError::Conflict("document revision changed or unavailable".into()));}
 let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM index_jobs WHERE note_id=?1)",[id],|r|r.get(0))?;
 if pending{return Ok(json!({"ready":false,"items":[],"next_cursor":null}));}
 let after=args.get("cursor").and_then(Value::as_str).unwrap_or("");
 let mut stmt=tx.prepare("SELECT target FROM (SELECT 'note://' || target_id AS target FROM searchidx.backlinks WHERE source_id=?1 UNION SELECT target_title AS target FROM searchidx.backlink_titles WHERE source_id=?1) WHERE target>?2 ORDER BY target LIMIT 21")?;
 let rows=stmt.query_map(params![id,after],|r|r.get::<_,String>(0))?;let mut items=Vec::new();for row in rows{items.push(row?);}let next=if items.len()>20{items.truncate(20);items.last().cloned()}else{None};
 Ok(json!({"ready":true,"items":items,"next_cursor":next}))
}

/// Exact Markdown link positions, prepared by the background parser. No body read.
pub fn backlink_location(conn:&Connection,args:&Value)->Result<Value>{
 let id=args.get("id").and_then(Value::as_str).filter(|v|ids::valid_id(v)).ok_or_else(||EngineError::invalid("bad id"))?;
 let target=args.get("target").and_then(Value::as_str).filter(|v|ids::valid_id(v)).ok_or_else(||EngineError::invalid("bad target"))?;
 let revision=args.get("revision").and_then(Value::as_i64).ok_or_else(||EngineError::invalid("missing revision"))?;
 let tx=conn.unchecked_transaction()?;
 let actual:Option<i64>=tx.query_row("SELECT revision FROM notes_meta WHERE id=?1 AND locked=0 AND trashed=0",[id],|r|r.get(0)).optional()?;if actual!=Some(revision){return Err(EngineError::Conflict("document revision changed or unavailable".into()));}
 let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM index_jobs WHERE note_id=?1)",[id],|r|r.get(0))?;if pending{return Ok(json!({"ready":false,"item":null}));}
 let item:Option<Value>=tx.query_row("SELECT byte_offset,byte_end,label FROM searchidx.backlink_locations WHERE source_id=?1 AND EXISTS(SELECT 1 FROM notes_meta WHERE id=?2 AND locked=0 AND trashed=0) AND (target='note://' || ?2 OR target COLLATE NOCASE IN (SELECT title FROM notes_meta WHERE id=?2 UNION SELECT a.value FROM settings s,json_each(s.value,'$.aliases') a WHERE s.key='knowledge_note:'||?2)) ORDER BY byte_offset LIMIT 1",params![id,target],|r|Ok(json!({"byte_offset":r.get::<_,i64>(0)?,"byte_end":r.get::<_,i64>(1)?,"label":r.get::<_,String>(2)?}))).optional()?;
 Ok(json!({"ready":true,"item":item}))
}
