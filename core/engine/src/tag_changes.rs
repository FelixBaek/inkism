//! Local preview receipts for atomic tag changes and exact, revision-checked undo.
//! Bodies are never loaded for previews; history/index/sync use existing write paths.
use crate::{
    error::{EngineError, Result},
    ids, ops_notes, settings,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize, PartialEq)]
struct Item {
    id: String,
    title: String,
    tags: Vec<String>,
    next_tags: Vec<String>,
    revision: i64,
    archived: bool,
    trashed: bool,
    readonly: bool,
    locked: bool,
    reason: Option<String>,
    raw: String,
    next_raw: String,
}
#[derive(Serialize, Deserialize)]
struct Receipt {
    id: String,
    name: String,
    replacement: Option<String>,
    status: String,
    created_at: i64,
    applied_at: Option<i64>,
    undone_at: Option<i64>,
    items: Vec<Item>,
    default_before: Option<(Option<String>, i64)>,
    default_after: Option<(Option<String>, i64)>,
    default_changed: bool,
    /// Color moved off `name` and whether it was given to `replacement` (see
    /// `settings::move_tag_color`). Older receipts have none.
    #[serde(default)]
    color_moved: (Option<String>, bool),
}
fn transaction<T>(conn: &Connection, f: impl FnOnce() -> Result<T>) -> Result<T> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    match f() {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}
fn conflict() -> EngineError {
    EngineError::Conflict("tag change targets or revisions changed; preview again".into())
}
fn snapshot(conn: &Connection, name: &str, replacement: Option<&str>) -> Result<Vec<Item>> {
    let mut q=conn.prepare("SELECT id,title,tags,revision,archived,trashed,readonly,locked FROM notes_meta m WHERE EXISTS(SELECT 1 FROM json_each(m.tags) WHERE value=?1) ORDER BY id LIMIT 10001")?;
    let rows = q
        .query_map([name], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, bool>(4)?,
                r.get::<_, bool>(5)?,
                r.get::<_, bool>(6)?,
                r.get::<_, bool>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.len() > 10000 {
        return Err(EngineError::invalid("tag change exceeds 10000 notes"));
    }
    rows.into_iter()
        .map(
            |(id, title, raw, revision, archived, trashed, readonly, locked)| {
                let tags: Vec<String> = serde_json::from_str(&raw)?;
                let next: Vec<String> = tags
                    .iter()
                    .filter_map(|tag| {
                        if tag == name {
                            replacement.map(str::to_owned)
                        } else {
                            Some(tag.clone())
                        }
                    })
                    .collect();
                let next_raw = ops_notes::serialize_tags(Some(&next))?;
                let next_tags = serde_json::from_str(&next_raw)?;
                Ok(Item {
                    id,
                    title,
                    tags,
                    next_tags,
                    revision,
                    archived,
                    trashed,
                    readonly,
                    locked,
                    reason: if locked {
                        Some("locked".into())
                    } else if readonly {
                        Some("readonly".into())
                    } else {
                        None
                    },
                    raw,
                    next_raw,
                })
            },
        )
        .collect()
}
fn eligible(item: &Item) -> bool {
    item.reason.is_none() && item.raw != item.next_raw
}
fn write(conn: &Connection, receipt: &Receipt) -> Result<()> {
    let raw = serde_json::to_string(receipt)?;
    if raw.len() > 8 * 1024 * 1024 {
        return Err(EngineError::invalid("tag preview metadata exceeds 8 MiB"));
    }
    conn.execute("INSERT INTO local_tag_changes(id,status,touched_at,receipt) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET status=excluded.status,touched_at=excluded.touched_at,receipt=excluded.receipt",params![receipt.id,receipt.status,ids::now_ms(),raw])?;
    for condition in ["status='preview'", "status<>'preview'"] {
        conn.execute(&format!("DELETE FROM local_tag_changes WHERE {condition} AND id NOT IN(SELECT id FROM local_tag_changes WHERE {condition} ORDER BY touched_at DESC,rowid DESC LIMIT 20)"),[])?;
    }
    Ok(())
}
fn read(conn: &Connection, id: &str) -> Result<Receipt> {
    if !ids::valid_id(id) {
        return Err(EngineError::invalid("invalid tag change id"));
    }
    let raw: String = conn
        .query_row(
            "SELECT receipt FROM local_tag_changes WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| EngineError::NotFound("tag preview or undo receipt expired".into()))?;
    Ok(serde_json::from_str(&raw)?)
}
fn arg_id<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args[key]
        .as_str()
        .ok_or_else(|| EngineError::invalid(format!("{key} required")))
}
fn default_value(row: &Option<(Option<String>, i64)>) -> Option<String> {
    row.as_ref().and_then(|(value, _)| value.clone())
}
fn summary(r: &Receipt) -> Value {
    json!({"id":r.id,"name":r.name,"replacement":r.replacement,"status":r.status,"created_at":r.created_at,"applied_at":r.applied_at,"undone_at":r.undone_at,"updated":r.items.iter().filter(|i|eligible(i)).count(),"default_changed":r.default_changed})
}
fn preview_data(r: &Receipt, args: &Value) -> Value {
    let offset = args["offset"]
        .as_u64()
        .unwrap_or(0)
        .min(r.items.len() as u64) as usize;
    let limit = args["limit"].as_u64().unwrap_or(100).clamp(1, 100) as usize;
    let end = (offset + limit).min(r.items.len());
    let items:Vec<_>=r.items[offset..end].iter().map(|i|json!({"id":i.id,"title":i.title,"tags":i.tags,"next_tags":i.next_tags,"revision":i.revision,"archived":i.archived,"trashed":i.trashed,"readonly":i.readonly,"locked":i.locked,"reason":i.reason})).collect();
    let mut out = summary(r);
    out["total"] = json!(r.items.len());
    out["eligible_count"] = json!(r.items.iter().filter(|i| eligible(i)).count());
    out["excluded_count"] = json!(r.items.iter().filter(|i| i.reason.is_some()).count());
    out["items"] = json!(items);
    out["offset"] = json!(offset);
    out["next_offset"] = if end < r.items.len() {
        json!(end)
    } else {
        Value::Null
    };
    out["default_tag"] = json!({"before":default_value(&r.default_before),"after":if r.default_changed{r.replacement.clone()}else{default_value(&r.default_before)},"changes":r.default_changed});
    out
}
pub fn preview(conn: &Connection, args: &Value) -> Result<Value> {
    if let Some(id) = args["preview_id"].as_str() {
        return Ok(preview_data(&read(conn, id)?, args));
    }
    let name = arg_id(args, "name")?.to_string();
    let replacement = match &args["replacement"] {
        Value::Null => None,
        Value::String(v) => Some(v.clone()),
        _ => return Err(EngineError::invalid("replacement must be string or null")),
    };
    if !args
        .as_object()
        .is_some_and(|o| o.contains_key("replacement"))
    {
        return Err(EngineError::invalid("replacement required"));
    }
    let mut tags = vec![name.clone()];
    tags.extend(replacement.clone());
    ops_notes::check_tags(&tags)?;
    transaction(conn, || {
        let items = snapshot(conn, &name, replacement.as_deref())?;
        let default_before = settings::stored(conn, settings::DEFAULT_TAG)?;
        let default_changed = default_value(&default_before).as_deref() == Some(&name)
            && replacement.as_deref() != Some(&name);
        let r = Receipt {
            id: ids::new_id(),
            name,
            replacement,
            status: "preview".into(),
            created_at: ids::now_ms(),
            applied_at: None,
            undone_at: None,
            items,
            default_before,
            default_after: None,
            default_changed,
            color_moved: (None, false),
        };
        write(conn, &r)?;
        Ok(preview_data(&r, args))
    })
}
fn result(conn: &Connection, r: &Receipt, args: &Value) -> Result<Value> {
    let current = crate::ops_meta::current_note_argument(args)?
        .map(|(id, _)| ops_notes::load_summary(conn, id))
        .transpose()?;
    Ok(
        json!({"id":r.id,"status":r.status,"updated":r.items.iter().filter(|i|eligible(i)).count(),"affected_ids":r.items.iter().filter(|i|eligible(i)).map(|i|&i.id).collect::<Vec<_>>(),"default_tag":settings::default_tag(conn)?,"current":current}),
    )
}
fn check_current(conn: &Connection, args: &Value) -> Result<()> {
    if let Some((id, revision)) = crate::ops_meta::current_note_argument(args)? {
        if ops_notes::load_summary(conn, id)?.revision != revision {
            return Err(conflict());
        }
    }
    Ok(())
}

fn change(conn: &Connection, item: &Item, tags: &str, revision: i64) -> Result<()> {
    let next = revision
        .checked_add(1)
        .ok_or_else(|| EngineError::invalid("revision overflow"))?;
    ops_notes::snapshot_stored_history(conn, &item.id)?;
    let changed=conn.execute("UPDATE notes_meta SET tags=?1,revision=?2,updated_at=?3 WHERE id=?4 AND revision=?5 AND readonly=0 AND locked=0",params![tags,next,ids::now_ms(),item.id,revision])?;
    if changed != 1 {
        return Err(conflict());
    }
    crate::indexer::enqueue(conn, &item.id, next)?;
    Ok(())
}
pub fn apply(conn: &Connection, args: &Value) -> Result<Value> {
    transaction(conn, || {
        check_current(conn, args)?;
        let mut r = read(conn, arg_id(args, "preview_id")?)?;
        if r.status == "applied" {
            return result(conn, &r, args);
        }
        if r.status != "preview" {
            return Err(conflict());
        }
        if snapshot(conn, &r.name, r.replacement.as_deref())? != r.items
            || settings::stored(conn, settings::DEFAULT_TAG)? != r.default_before
        {
            return Err(conflict());
        }
        for item in r.items.iter().filter(|i| eligible(i)) {
            change(conn, item, &item.next_raw, item.revision)?;
        }
        if r.default_changed {
            settings::write_local(conn, settings::DEFAULT_TAG, r.replacement.as_deref())?;
        }
        r.default_after = settings::stored(conn, settings::DEFAULT_TAG)?;
        r.color_moved = settings::move_tag_color(conn, &r.name, r.replacement.as_deref())?;
        r.status = "applied".into();
        r.applied_at = Some(ids::now_ms());
        write(conn, &r)?;
        result(conn, &r, args)
    })
}
pub fn undo(conn: &Connection, args: &Value) -> Result<Value> {
    transaction(conn, || {
        check_current(conn, args)?;
        let mut r = read(conn, arg_id(args, "id")?)?;
        if r.status == "undone" {
            return result(conn, &r, args);
        }
        if r.status != "applied" {
            return Err(conflict());
        }
        // Check every note and default before writing anything. Exact original tags
        // distinguish a merge from a rename: reverse renaming would corrupt originals.
        for item in r.items.iter().filter(|i| eligible(i)) {
            let actual: Option<(String, i64, bool, bool)> = conn
                .query_row(
                    "SELECT tags,revision,readonly,locked FROM notes_meta WHERE id=?1",
                    [&item.id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
            if actual != Some((item.next_raw.clone(), item.revision + 1, false, false)) {
                return Err(conflict());
            }
        }
        if r.default_changed && settings::stored(conn, settings::DEFAULT_TAG)? != r.default_after {
            return Err(conflict());
        }
        for item in r.items.iter().filter(|i| eligible(i)) {
            change(conn, item, &item.raw, item.revision + 1)?;
        }
        if r.default_changed {
            settings::write_local(
                conn,
                settings::DEFAULT_TAG,
                default_value(&r.default_before).as_deref(),
            )?;
        }
        settings::restore_tag_color(conn, &r.name, r.replacement.as_deref(), r.color_moved.clone())?;
        r.status = "undone".into();
        r.undone_at = Some(ids::now_ms());
        write(conn, &r)?;
        result(conn, &r, args)
    })
}
pub fn list(conn: &Connection) -> Result<Value> {
    let mut q=conn.prepare("SELECT receipt FROM local_tag_changes WHERE status<>'preview' ORDER BY touched_at DESC,rowid DESC LIMIT 20")?;
    let raw = q
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let items = raw
        .into_iter()
        .map(|s| Ok(summary(&serde_json::from_str::<Receipt>(&s)?)))
        .collect::<Result<Vec<_>>>()?;
    Ok(json!({"items":items}))
}
