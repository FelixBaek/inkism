//! Note operations: list/get/save/patch/delete + history/restore + search.
//! List/search read ONLY notes_meta (+ the attached search index); bodies are
//! touched exclusively by get/save/restore (.private/docs/performance-requirements.md).

use crate::cursor::Cursor;
use crate::error::{EngineError, Result};
use crate::ids;
use crate::indexer;
use crate::limits;
use crate::model::{self, Note, SaveInput};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

/// View filters per protocol: trash only in the trash view; `all`/notebook/
/// tag/favorites exclude archived and trashed.
fn view_clause(view: &str) -> Result<&'static str> {
    match view {
        "all" => Ok("m.trashed = 0 AND m.archived = 0"),
        "favorites" => Ok("m.trashed = 0 AND m.archived = 0 AND m.favorite = 1"),
        "archive" => Ok("m.trashed = 0 AND m.archived = 1"),
        "trash" => Ok("m.trashed = 1"),
        other => Err(EngineError::invalid(format!("unknown view: {other}"))),
    }
}

/// Sort of a list request. SQL identifiers and direction are fixed literals,
/// never interpolated input.
struct ListSort<'a> {
    sort_by: &'a str,
    column: &'static str,
    ascending: bool,
    direction: &'static str,
    pinned_column: &'static str,
}

fn list_sort(args: &Value) -> Result<ListSort<'_>> {
    let sort_by = match args.get("sort_by") {
        None => "updated_at",
        Some(Value::String(value))
            if matches!(value.as_str(), "updated_at" | "created_at" | "edited_at" | "title") => {
            value.as_str()
        }
        _ => return Err(EngineError::invalid("bad sort_by")),
    };
    let column = match sort_by {
        "created_at" => "m.created_at",
        "edited_at" => "m.edited_at",
        "title" => "m.title_order",
        _ => "m.updated_at",
    };
    let ascending = match args.get("sort_direction") {
        None => false,
        Some(Value::String(value)) if value == "asc" => true,
        Some(Value::String(value)) if value == "desc" => false,
        _ => return Err(EngineError::invalid("bad sort_direction")),
    };
    Ok(ListSort {
        sort_by,
        column,
        ascending,
        direction: if ascending { "ASC" } else { "DESC" },
        // Ascending indexes use -pinned to put pinned notes first.
        pinned_column: if ascending { "-m.pinned" } else { "m.pinned" },
    })
}

pub fn list(conn: &Connection, args: &Value) -> Result<Value> {
    let sort = list_sort(args)?;
    let ListSort {
        column,
        direction,
        pinned_column,
        ..
    } = sort;
    let keyset_order =
        format!(" ORDER BY {pinned_column} {direction}, {column} {direction}, m.id {direction} ");
    let mut first_order = keyset_order.clone();
    let mut next_cohort = None;
    let view = args
        .get("view")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("list requires view"))?;
    let mut where_sql = view_clause(view)?.to_string();
    let mut binds: Vec<SqlValue> = Vec::new();
    append_list_filters(conn, args, &mut where_sql, &mut binds)?;

    let limit_in = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(limits::DEFAULT_LIST_LIMIT as u64) as u32;
    let limit = limit_in.clamp(1, limits::MAX_LIST_LIMIT);

    if let Some(cur) = args.get("cursor").and_then(Value::as_str) {
        if !cur.is_empty() {
            next_cohort =
                apply_list_cursor(cur, &sort, &mut where_sql, &mut binds, &mut first_order)?;
        }
    }

    // Read both cohorts from one snapshot. At most limit+1 rows total are
    // fetched to detect the next page; bodies are never read here.
    let tx = conn.unchecked_transaction()?;
    let mut queries = vec![(where_sql, first_order, binds.len())];
    if let Some((clause, parameters)) = next_cohort {
        queries.push((clause, keyset_order, parameters));
    }
    let (mut items, next_cursor) = read_summary_page(&tx, queries, &binds, limit, &sort)?;
    // One indexed relation read for the page instead of one per row.
    let ids: Vec<&str> = items.iter().map(|r| r.id.as_str()).collect();
    let mut memberships = crate::notebook_membership::load_many(&tx, &ids)?;
    for item in &mut items {
        item.notebook_ids = memberships.remove(&item.id).unwrap_or_default();
    }
    tx.commit()?;
    let items: Vec<Value> = items
        .iter()
        .map(|r| {
            let tags: Vec<String> = serde_json::from_str(&r.tags_json).unwrap_or_default();
            json!({
                "id": r.id, "title": r.title, "preview": r.preview,
                "notebook_id": r.notebook_id, "notebook_ids":r.notebook_ids, "tags": tags, "favorite": r.favorite,
                "pinned": r.pinned, "readonly": r.readonly, "locked": r.locked, "archived": r.archived, "trashed": r.trashed,
                "color": r.color, "reminder_at": r.reminder_at, "reminder_repeat_hours":r.reminder_repeat_hours,
                "created_at": r.created_at, "updated_at": r.updated_at, "edited_at": r.edited_at,
                "revision": r.revision, "content_format":r.content_format,
            })
        })
        .collect();
    Ok(json!({ "items": items, "next_cursor": next_cursor }))
}

/// Notebook, tag and search-query filters of a list request.
fn append_list_filters(
    conn: &Connection,
    args: &Value,
    where_sql: &mut String,
    binds: &mut Vec<SqlValue>,
) -> Result<()> {
    if let Some(nb) = args.get("notebook_id") {
        if !nb.is_null() {
            let id = nb
                .as_str()
                .filter(|s| ids::valid_id(s))
                .ok_or_else(|| EngineError::invalid("bad notebook_id"))?;
            binds.push(SqlValue::Text(id.to_string()));
            // ponytail: indexed membership candidates; large notebook sorts need
            // measured denormalized order keys if SQLite's candidate sort dominates.
            where_sql.push_str(&format!(" AND m.id IN (SELECT note_id FROM note_notebooks WHERE notebook_id=?{})", binds.len()));
        }
    }
    if let Some(tag) = args.get("tag").and_then(Value::as_str) {
        if tag.chars().count() > limits::MAX_TAG_NAME_CHARS {
            return Err(EngineError::invalid("tag too long"));
        }
        // Exact membership via json_each; immune to LIKE metacharacters.
        binds.push(SqlValue::Text(tag.to_string()));
        where_sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM json_each(m.tags) je WHERE je.value = ?{n})",
            n = binds.len()
        ));
    }
    if let Some(q) = args.get("query").and_then(Value::as_str) {
        crate::search::append(conn, q, where_sql, binds)?;
    }
    // Daily notes are keyed `daily-YYYY-MM-DD` (knowledge::daily); '.' sorts right after '-'.
    if args.get("daily").and_then(Value::as_bool) == Some(true) {
        where_sql.push_str(" AND m.id >= 'daily-' AND m.id < 'daily.'");
    }
    Ok(())
}

/// Keyset continuation after `cur`. Returns the follow-up pinned cohort
/// query `(clause, parameter count)` that ascending sorts need.
fn apply_list_cursor(
    cur: &str,
    sort: &ListSort,
    where_sql: &mut String,
    binds: &mut Vec<SqlValue>,
    first_order: &mut String,
) -> Result<Option<(String, usize)>> {
    let ListSort {
        sort_by,
        column,
        ascending,
        pinned_column,
        ..
    } = *sort;
    let mut next_cohort = None;
    let c = Cursor::decode(cur)?;
    if c.sort_by != sort_by || c.ascending != ascending {
        return Err(EngineError::invalid("cursor belongs to a different sort"));
    }
    binds.push(SqlValue::Integer(if ascending {
        -c.pinned
    } else {
        c.pinned
    }));
    binds.push(if sort_by == "title" {
        SqlValue::Text(c.title.ok_or_else(|| EngineError::invalid("bad title cursor"))?)
    } else {
        SqlValue::Integer(c.timestamp)
    });
    binds.push(SqlValue::Text(c.id));
    let n = binds.len();
    if ascending {
        // SQLite does not seek a row-value range beginning with an
        // expression. Fix the pinned cohort, then seek (sort key,id).
        if c.pinned == 1 {
            next_cohort = Some((
                format!("{where_sql} AND {pinned_column} > ?{}", n - 2),
                n - 2,
            ));
        }
        where_sql.push_str(&format!(
            " AND {pinned_column} = ?{} AND ({column},m.id) > (?{},?{})",
            n - 2,
            n - 1,
            n
        ));
        *first_order = format!(" ORDER BY {column} ASC, m.id ASC ");
    } else {
        where_sql.push_str(&format!(
            " AND ({pinned_column},{column},m.id) < (?{},?{},?{})",
            n - 2,
            n - 1,
            n
        ));
    }
    Ok(next_cohort)
}

/// Runs the cohort queries in order until `limit` summaries are read; one
/// extra row yields the next-page cursor.
fn read_summary_page(
    tx: &Connection,
    queries: Vec<(String, String, usize)>,
    binds: &[SqlValue],
    limit: u32,
    sort: &ListSort,
) -> Result<(Vec<SummaryRow>, Option<String>)> {
    let mut items: Vec<SummaryRow> = Vec::with_capacity(limit as usize);
    for (clause, order, parameters) in queries {
        let remaining = limit as usize + 1 - items.len();
        let sql = format!(
            "SELECT m.id, m.title, m.preview, m.notebook_id, m.tags, m.favorite, m.pinned, \
                    m.archived, m.trashed, m.color, m.reminder_at, m.created_at, m.updated_at, \
                    m.revision, m.content_format, m.reminder_repeat_hours, m.readonly, m.edited_at, m.locked \
             FROM notes_meta m WHERE {clause}{order} LIMIT {remaining}"
        );
        let mut stmt = tx.prepare(&sql)?;
        let mut rows = stmt.query(rusqlite::params_from_iter(binds[..parameters].iter()))?;
        while let Some(row) = rows.next()? {
            if items.len() == limit as usize {
                let next_cursor = list_cursor(items.last().unwrap(), sort);
                return Ok((items, Some(next_cursor)));
            }
            items.push(summary_row(row)?);
        }
    }
    Ok((items, None))
}

/// Cursor that continues the page after `last`.
fn list_cursor(last: &SummaryRow, sort: &ListSort) -> String {
    let sort_by = sort.sort_by;
    let c = Cursor {
        pinned: if last.pinned { 1 } else { 0 },
        timestamp: match sort_by {
            "created_at" => last.created_at,
            "edited_at" => last.edited_at,
            "title" => 0,
            _ => last.updated_at,
        },
        id: last.id.clone(),
        sort_by: sort_by.to_string(),
        ascending: sort.ascending,
        title: if sort_by == "title" {
            Some(last.title.trim_start_matches([' ', '\u{a0}', '\r', '\n', '\t', '\u{b}']).to_string())
        } else {
            None
        },
    };
    c.encode()
}

fn summary_row(row: &rusqlite::Row) -> rusqlite::Result<SummaryRow> {
    Ok(SummaryRow {
        id: row.get(0)?,
        title: row.get(1)?,
        preview: row.get(2)?,
        notebook_id: row.get(3)?,
        notebook_ids: Vec::new(), // filled for the whole page by `list`
        tags_json: row.get(4)?,
        favorite: row.get::<_, i64>(5)? != 0,
        pinned: row.get::<_, i64>(6)? != 0,
        archived: row.get::<_, i64>(7)? != 0,
        trashed: row.get::<_, i64>(8)? != 0,
        color: row.get(9)?,
        reminder_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        revision: row.get(13)?,
        content_format: row.get(14)?,
        reminder_repeat_hours: row.get(15)?,
        readonly: row.get::<_, i64>(16)? != 0,
        edited_at: row.get(17)?,
        locked: row.get::<_, i64>(18)? != 0,
    })
}

struct SummaryRow {
    readonly: bool,
    locked: bool,
    content_format: String,
    id: String,
    title: String,
    preview: String,
    notebook_id: Option<String>,
    notebook_ids: Vec<String>,
    tags_json: String,
    favorite: bool,
    pinned: bool,
    archived: bool,
    trashed: bool,
    color: Option<String>,
    reminder_at: Option<i64>,
    reminder_repeat_hours: Option<i64>,
    created_at: i64,
    updated_at: i64,
    edited_at: i64,
    revision: i64,
}

/// Notes whose reminder has come due: `reminder_at` set and `<= now`, and the
/// note is not in the trash (archived notes still ring).
///
/// Metadata ONLY — bodies are never read and nothing is written; dismissal is
/// the caller's job via the ordinary revision-guarded `patch`
/// (`changes: {"reminder_at": null}`), so a crash while showing the list can
/// never lose or alter note data. Response is a bare Summary array ordered by
/// `reminder_at`, then `id` (oldest first, stable).
pub fn due_reminders(conn: &Connection, args: &Value) -> Result<Value> {
    let now = args
        .get("now")
        .and_then(Value::as_i64)
        .ok_or_else(|| EngineError::invalid("due_reminders requires now (unix ms)"))?;
    model::check_reminder_at(now)?;
    let limit = match args.get("limit") {
        None => limits::DEFAULT_LIST_LIMIT as u64,
        Some(value) => value
            .as_u64()
            .filter(|n| (1..=100).contains(n))
            .ok_or_else(|| EngineError::invalid("limit must be an integer from 1 to 100"))?,
    };

    // Range scan over the partial NOT NULL index (created in every
    // init_main, see schema): scheduled rows only, leading ORDER BY term
    // served by the index itself (verified with EXPLAIN QUERY PLAN).
    let after_at = args.get("after_at").and_then(Value::as_i64);
    let after_id = args.get("after_id").and_then(Value::as_str);
    if after_at.is_some() != after_id.is_some() {
        return Err(EngineError::invalid("both reminder cursor fields required"));
    }
    if let Some(at) = after_at {
        model::check_reminder_at(at)?;
    }
    let mut stmt = conn.prepare(
        "SELECT id, title, preview, notebook_id, tags, favorite, pinned, archived, trashed, \
                color, reminder_at, created_at, updated_at, revision, content_format, reminder_repeat_hours, readonly, edited_at, locked \
         FROM notes_meta INDEXED BY idx_notes_reminder \
         WHERE trashed = 0 AND reminder_at IS NOT NULL AND reminder_at <= ?1 \
         AND (?3 IS NULL OR (reminder_at,id) > (?3,?4)) \
         ORDER BY reminder_at ASC, id ASC \
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![now, limit as i64, after_at, after_id], |row| {
        let tags_json: String = row.get(4)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "title": row.get::<_, String>(1)?,
            "preview": row.get::<_, String>(2)?,
            "notebook_id": row.get::<_, Option<String>>(3)?,
            "tags": tags,
            "favorite": row.get::<_, i64>(5)? != 0,
            "pinned": row.get::<_, i64>(6)? != 0,
            "readonly": row.get::<_, i64>(16)? != 0,
            "locked": row.get::<_, i64>(18)? != 0,
            "archived": row.get::<_, i64>(7)? != 0,
            "trashed": row.get::<_, i64>(8)? != 0,
            "color": row.get::<_, Option<String>>(9)?,
            "reminder_at": row.get::<_, Option<i64>>(10)?,
            "created_at": row.get::<_, i64>(11)?,
            "updated_at": row.get::<_, i64>(12)?,
            "edited_at": row.get::<_, i64>(17)?,
            "revision": row.get::<_, i64>(13)?, "content_format":row.get::<_,String>(14)?, "reminder_repeat_hours":row.get::<_,Option<i64>>(15)?,
        }))
    })?;
    let mut items: Vec<Value> = rows.collect::<std::result::Result<_, _>>()?;
    for note in &mut items {
        note["notebook_ids"] = json!(crate::notebook_membership::load(conn, note["id"].as_str().expect("summary id"))?);
    }
    Ok(Value::Array(items))
}

pub fn get(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    // Optional background-read budget: inspect byte lengths before copying either
    // body into Rust/JSON, and keep the size check and load in one snapshot.
    if let Some(budget) = args.get("max_body_bytes") {
        let budget = budget.as_u64().filter(|n| *n > 0 && *n <= 64 * 1024 * 1024)
            .ok_or_else(|| EngineError::invalid("max_body_bytes must be between 1 and 67108864"))?;
        let tx = conn.unchecked_transaction()?;
        let bytes: Option<i64> = tx.query_row(
            "SELECT length(CAST(b.content AS BLOB))+length(CAST(b.text AS BLOB)) FROM notes_body b JOIN notes_meta m ON m.id=b.note_id WHERE m.id=?1 AND m.locked=0 AND m.trashed=0",
            [&id], |row| row.get(0),
        ).optional()?;
        let bytes = bytes.ok_or_else(|| EngineError::NotFound(format!("note {id}")))?;
        if bytes < 0 || bytes as u64 > budget { return Err(EngineError::invalid("note body exceeds read budget")); }
        let note = load_note(&tx, &id)?.ok_or_else(|| EngineError::NotFound(format!("note {id}")))?;
        tx.commit()?;
        return Ok(serde_json::to_value(note).unwrap());
    }
    let note = load_note(conn, &id)?.ok_or_else(|| EngineError::NotFound(format!("note {id}")))?;
    Ok(serde_json::to_value(note).unwrap())
}

/// Random discovery uses metadata only and never returns protected/deleted notes.
pub fn random_note(conn: &Connection, args: &Value) -> Result<Value> {
    let view=args.get("view").and_then(Value::as_str).unwrap_or("all");
    let mut clause=view_clause(view)?.to_string();
    clause.push_str(" AND m.locked=0 AND m.trashed=0");
    let mut binds=Vec::new();
    append_list_filters(conn,args,&mut clause,&mut binds)?;
    let recent:Vec<String>=match args.get("recent_ids") {
        None=>Vec::new(),
        Some(Value::Array(values)) if values.len()<=20=>values.iter().map(|v|v.as_str().filter(|id|ids::valid_id(id)).map(str::to_string).ok_or_else(||EngineError::invalid("bad recent id"))).collect::<Result<_>>()?,
        _=>return Err(EngineError::invalid("recent_ids requires at most 20 ids")),
    };
    let current=model::opt_string(args,"current_id")?.flatten();
    if current.as_ref().is_some_and(|id|!ids::valid_id(id)){return Err(EngineError::invalid("bad current id"));}
    let mut exclusions=recent.clone();if let Some(id)=&current{exclusions.push(id.clone());}
    for omitted in [exclusions,current.into_iter().collect(),Vec::new()] {
        let mut params=binds.clone();let mut filter=clause.clone();
        for id in omitted {params.push(SqlValue::Text(id));filter.push_str(&format!(" AND m.id!=?{}",params.len()));}
        let id:Option<String>=conn.query_row(&format!("SELECT m.id FROM notes_meta m WHERE {filter} ORDER BY random() LIMIT 1"),rusqlite::params_from_iter(params),|row|row.get(0)).optional()?;
        if id.is_some(){return Ok(json!({"id":id}));}
    }
    Ok(json!({"id":null}))
}

/// Hover previews never materialize the canonical body, even for very large notes.
pub fn preview(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    let value = conn.query_row(
        "SELECT substr(title,1,240),substr(preview,1,240),revision FROM notes_meta WHERE id=?1 AND locked=0 AND trashed=0",
        [&id], |r| Ok(json!({"id":id,"title":r.get::<_,String>(0)?,"preview":r.get::<_,String>(1)?,"revision":r.get::<_,i64>(2)?})),
    ).optional()?.ok_or_else(|| EngineError::NotFound(format!("note {id}")))?;
    Ok(value)
}

/// Read a note's metadata only, including the persisted preview. Callers can
/// include this in the same read transaction as a block page.
pub fn load_summary(conn: &Connection, id: &str) -> Result<model::Summary> {
    let mut summary = conn.query_row(
        "SELECT title,preview,notebook_id,tags,favorite,pinned,archived,trashed,color,reminder_at,created_at,updated_at,revision,content_format,reminder_repeat_hours,readonly,edited_at,locked FROM notes_meta WHERE id=?1",
        [id], |r| Ok(model::Summary {
            id: id.to_string(), title: r.get(0)?, preview: r.get(1)?, content_format:r.get(13)?,
            notebook_id: r.get(2)?, notebook_ids:Vec::new(), tags: serde_json::from_str(&r.get::<_,String>(3)?).unwrap_or_default(),
            favorite: r.get::<_,i64>(4)? != 0, pinned: r.get::<_,i64>(5)? != 0,
            readonly: r.get::<_,i64>(15)? != 0, locked: r.get::<_,i64>(17)? != 0,
            archived: r.get::<_,i64>(6)? != 0, trashed: r.get::<_,i64>(7)? != 0,
            color: r.get(8)?, reminder_at: r.get(9)?, reminder_repeat_hours:r.get(14)?,
            created_at: r.get(10)?, updated_at: r.get(11)?, revision: r.get(12)?,
            edited_at: r.get(16)?,
        })
    ).optional()?.ok_or_else(|| EngineError::NotFound(format!("note {id}")))?;
    summary.notebook_ids = crate::notebook_membership::load(conn, id)?;
    Ok(summary)
}

/// Load a full note (metadata + body). Bodies are read only here and in the
/// save/restore paths.
pub fn load_note(conn: &Connection, id: &str) -> Result<Option<Note>> {
    let meta = conn
        .query_row(
            "SELECT title, notebook_id, tags, favorite, pinned, archived, trashed, color, \
                    reminder_at, created_at, updated_at, revision, content_format, reminder_repeat_hours, readonly, edited_at, locked \
             FROM notes_meta WHERE id = ?1",
            params![id],
            |r| {
                Ok(Note {
                    id: id.to_string(),
                    title: r.get(0)?,
                    content: String::new(),
                    text: String::new(),
                    notebook_id: r.get(1)?,
                    notebook_ids: Vec::new(),
                    tags: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default(),
                    favorite: r.get::<_, i64>(3)? != 0,
                    pinned: r.get::<_, i64>(4)? != 0,
                    readonly: r.get::<_, i64>(14)? != 0,
                    locked: r.get::<_, i64>(16)? != 0,
                    archived: r.get::<_, i64>(5)? != 0,
                    trashed: r.get::<_, i64>(6)? != 0,
                    color: r.get(7)?,
                    reminder_at: r.get(8)?,
                    reminder_repeat_hours: r.get(13)?,
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                    edited_at: r.get(15)?,
                    revision: r.get(11)?,
                    content_format: r.get(12)?,
                })
            },
        )
        .optional()?;
    let mut note = match meta {
        Some(n) => n,
        None => return Ok(None),
    };
    note.notebook_ids = crate::notebook_membership::load(conn, id)?;
    let body = conn
        .query_row(
            "SELECT content, text FROM notes_body WHERE note_id = ?1",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((content, text)) = body {
        note.content = content;
        note.text = text;
    }
    Ok(Some(note))
}

fn arg_id(args: &Value) -> Result<String> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("missing id"))?;
    if !ids::valid_id(id) {
        return Err(EngineError::invalid("bad id"));
    }
    Ok(id.to_string())
}

fn ensure_editable(conn: &Connection, id: &str, readonly: bool) -> Result<()> {
    if readonly {
        return Err(EngineError::Conflict(
            "읽기 전용 노트입니다. 읽기 전용을 해제한 뒤 편집하세요".into(),
        ));
    }
    // A locked body is only written through the vault, never as plaintext.
    if crate::vault::is_locked(conn, id)? {
        return Err(EngineError::Conflict(
            "잠긴 노트입니다. 잠금을 연 편집기에서 저장하세요".into(),
        ));
    }
    Ok(())
}

/// save: create (absent/unknown id) or optimistic-concurrency update.
/// Partial saves touch only supplied fields; create fills defaults; empty
/// title is legal. The index job is enqueued in the SAME transaction.
pub fn save(conn: &Connection, args: &Value) -> Result<Value> {
    let note_val = args
        .get("note")
        .ok_or_else(|| EngineError::invalid("save requires note"))?;
    let mut input: SaveInput = serde_json::from_value(note_val.clone())
        .map_err(|e| EngineError::invalid(format!("bad note: {e}")))?;
    // serde cannot tell absent from explicit null; re-derive so a null
    // reminder clears it while an omitted one preserves the stored value.
    input.reminder_at = model::opt_i64(note_val, "reminder_at")?;
    input.reminder_repeat_hours = model::opt_i64(note_val, "reminder_repeat_hours")?;
    input.readonly = model::opt_bool(note_val, "readonly")?;
    input.notebook_id = model::opt_string(note_val, "notebook_id")?;
    input.notebook_ids = crate::notebook_membership::parse_ids(note_val)?;
    if note_val.get("content_format").is_some() {
        crate::source_format::from_value(note_val.get("content_format"))?;
    }
    if let Some(format) = &input.content_format {
        crate::source_format::validate(format)?;
        // Source formats store text == content; the indexer and preview derive
        // visible text lazily. HTML keeps client-extracted text when supplied.
        if format != "html" || input.text.is_none() {
            if let Some(content) = &input.content {
                input.text = Some(content.clone());
            }
        }
    }
    validate_save(&input)?;

    // External editors must update an existing exact source, never resurrect
    // a note removed after their preview. All guards run under this write lock.
    let require_existing = model::opt_bool(note_val, "require_existing")?.unwrap_or(false);
    let require_absent = model::opt_bool(note_val, "require_absent")?.unwrap_or(false);
    let timestamp_title = model::opt_bool(note_val, "timestamp_title")?.unwrap_or(false);
    if require_absent && require_existing { return Err(EngineError::invalid("incompatible existence guards")); }
    let expected_source = match note_val.get("expected_source_sha256") {
        None => None,
        Some(Value::String(hash)) if hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) => Some(hash.as_str()),
        Some(_) => return Err(EngineError::invalid("invalid expected source digest")),
    };
    if expected_source.is_some() && !require_existing { return Err(EngineError::invalid("source digest requires existing note guard")); }
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| {
        if require_absent {
            let id = input.id.as_deref().ok_or_else(|| EngineError::invalid("absence guard requires id"))?;
            if load_note(conn, id)?.is_some() { return Err(EngineError::Conflict("note already exists".into())); }
        }
        if require_existing {
            let id = input.id.as_deref().ok_or_else(|| EngineError::invalid("existing note guard requires id"))?;
            let current = load_note(conn, id)?.ok_or_else(|| EngineError::Conflict("note was deleted".into()))?;
            if current.trashed || current.locked || current.readonly { return Err(EngineError::Conflict("note is no longer editable".into())); }
            if let Some(expected) = expected_source {
                use sha2::{Digest, Sha256};
                if format!("{:x}", Sha256::digest(current.content.as_bytes())) != expected { return Err(EngineError::Conflict("source changed".into())); }
            }
        }
        if timestamp_title {
            let existing=match &input.id{Some(id)=>conn.query_row("SELECT EXISTS(SELECT 1 FROM notes_meta WHERE id=?1)",[id],|r|r.get::<_,bool>(0))?,None=>false};
            if !existing {
                let base=input.title.clone().ok_or_else(||EngineError::invalid("timestamp title required"))?;
                if base.len()!=15 || base.as_bytes()[8]!=b'-' || !base.bytes().enumerate().all(|(i,c)|i==8||c.is_ascii_digit()){return Err(EngineError::invalid("bad timestamp title"));}
                let mut title=base.clone();let mut suffix=2u64;
                while conn.query_row("SELECT EXISTS(SELECT 1 FROM notes_meta WHERE title=?1)",[&title],|r|r.get::<_,bool>(0))? {
                    title=format!("{base}-{suffix}");suffix+=1;
                }
                input.title=Some(title);
            }
        }
        save_tx(conn, input)
    })();
    finish_tx(conn, result)
}

/// Replace bounded UTF-8 byte ranges in HTML and extracted text atomically.
/// Clients supply both representations, as with save. No HTML parsing occurs
/// here. Revision and exact old slices are mandatory; offsets are not UTF-16.
pub fn splice(conn: &Connection, args: &Value) -> Result<Value> {
    splice_impl(conn, args, false)
}

/// A lazy editor need not load the entire extracted text to edit an HTML range.
/// Derive text before obtaining the write lock, then recheck the revision.
pub fn splice_html(conn: &Connection, args: &Value) -> Result<Value> {
    if args.get("text").is_some() {
        return Err(EngineError::invalid(
            "document_splice_html derives text; omit text",
        ));
    }
    splice_impl(conn, args, true)
}

pub fn splice_source(conn: &Connection, args: &Value) -> Result<Value> {
    if args.get("text").is_some() {
        return Err(EngineError::invalid("source edit must omit derived text"));
    }
    splice_impl(conn, args, true)
}

fn splice_impl(conn: &Connection, args: &Value, derive_text: bool) -> Result<Value> {
    let id = arg_id(args)?;
    let revision = args
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|v| *v > 0)
        .ok_or_else(|| EngineError::invalid("splice requires revision"))?;
    let content = splice_edits(args, derive_text)?;
    let text: Option<BodySplice> = if derive_text {
        None
    } else {
        Some(
            serde_json::from_value(args.get("text").cloned().unwrap_or(Value::Null))
                .map_err(|e| EngineError::invalid(format!("bad text splice: {e}")))?,
        )
    };
    let metadata = splice_metadata(args, derive_text)?;
    let mut current =
        load_note(conn, &id)?.ok_or_else(|| EngineError::NotFound(format!("note {id}")))?;
    ensure_editable(conn, &id, current.readonly)?;
    let source_edit = args.get("op").and_then(Value::as_str) == Some("document_splice_source");
    check_splice_format(args, &current, source_edit)?;
    if current.revision != revision {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    if let Some(text) = &text {
        text.validate(&current.text)?;
    }
    let metadata_changed = metadata.as_ref().is_some_and(|m| {
        m.title != current.title || m.notebook_id != current.notebook_id || m.tags != current.tags
    });
    let title_changed = metadata.as_ref().is_some_and(|m| m.title != current.title);
    let text_changed = text.as_ref().is_some_and(|t| t.expected != t.replacement);
    let body_changed = apply_body_edits(&mut current.content, content)?;
    if !body_changed
        && !metadata_changed
        && text.as_ref().is_none_or(|t| t.expected == t.replacement)
    {
        return Ok(splice_reply(&current, derive_text));
    }
    match text {
        Some(text) => text.apply(&mut current.text),
        None if body_changed && source_edit => current.text = current.content.clone(),
        None if body_changed => current.text = crate::plaintext::from_html(&current.content)?,
        None => {}
    }
    if let Some(m) = metadata {
        current.title = m.title;
        current.notebook_id = m.notebook_id;
        current.tags = m.tags;
    }
    current.revision = revision
        .checked_add(1)
        .ok_or_else(|| EngineError::invalid("revision overflow"))?;
    current.updated_at = ids::now_ms();
    if body_changed || title_changed || text_changed {
        current.edited_at = current.updated_at;
    }
    let reply = splice_reply(&current, derive_text);
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = write_splice(conn, &id, revision, &current, reply);
    finish_tx(conn, result)
}

/// The content splices: a batch of HTML `edits`, or one `content` splice.
fn splice_edits(args: &Value, derive_text: bool) -> Result<Vec<BodySplice>> {
    Ok(match args.get("edits") {
        Some(edits) => {
            if !derive_text || args.get("content").is_some() {
                return Err(EngineError::invalid(
                    "HTML edits requires omitting content and text",
                ));
            }
            let edits = edits
                .as_array()
                .filter(|items| !items.is_empty() && items.len() <= 128)
                .ok_or_else(|| EngineError::invalid("edits must contain 1 to 128 splices"))?;
            edits
                .iter()
                .map(|edit| {
                    serde_json::from_value(edit.clone())
                        .map_err(|e| EngineError::invalid(format!("bad HTML edit: {e}")))
                })
                .collect::<Result<_>>()?
        }
        None => vec![
            serde_json::from_value(args.get("content").cloned().unwrap_or(Value::Null))
                .map_err(|e| EngineError::invalid(format!("bad content splice: {e}")))?,
        ],
    })
}

/// Optional replacement title/notebook/tags sent with an HTML splice.
fn splice_metadata(args: &Value, derive_text: bool) -> Result<Option<SpliceMetadata>> {
    Ok(match args.get("metadata") {
        None => None,
        Some(value) => {
            if !derive_text || value.get("notebook_id").is_none() {
                return Err(EngineError::invalid(
                    "HTML metadata requires title, notebook_id and tags",
                ));
            }
            let mut m: SpliceMetadata = serde_json::from_value(value.clone())
                .map_err(|e| EngineError::invalid(format!("bad splice metadata: {e}")))?;
            if m.title.chars().count() > limits::MAX_TITLE_CHARS {
                return Err(EngineError::invalid("title too long"));
            }
            check_tags(&m.tags)?;
            if m.notebook_id.as_ref().is_some_and(|id| !ids::valid_id(id)) {
                return Err(EngineError::invalid("bad notebook_id"));
            }
            m.tags.sort();
            m.tags.dedup();
            Some(m)
        }
    })
}

fn check_splice_format(args: &Value, current: &Note, source_edit: bool) -> Result<()> {
    if source_edit {
        if args.get("content_format").and_then(Value::as_str)
            != Some(current.content_format.as_str())
        {
            return Err(EngineError::invalid(
                "source edit requires matching content_format",
            ));
        }
    } else if current.content_format != "html" {
        return Err(EngineError::invalid("HTML operation requires an HTML note"));
    }
    Ok(())
}

/// A single validated replacement changes the source iff its bytes differ.
/// Mutate the loaded buffer without retaining a second full Note for history.
/// Batches need a separate buffer to detect edits that cancel each other out;
/// their coordinates still refer to the result of the preceding edit.
fn apply_body_edits(source: &mut String, edits: Vec<BodySplice>) -> Result<bool> {
    if edits.len() == 1 {
        let edit = edits.into_iter().next().unwrap();
        edit.validate(source)?;
        let changed = edit.expected != edit.replacement;
        if changed {
            edit.apply(source);
        }
        return Ok(changed);
    }
    let mut updated = source.clone();
    for edit in edits {
        edit.validate(&updated)?;
        edit.apply(&mut updated);
    }
    let changed = updated != *source;
    if changed {
        *source = updated;
    }
    Ok(changed)
}

/// Write phase of a splice under BEGIN IMMEDIATE (caller finishes the tx).
fn write_splice(
    conn: &Connection,
    id: &str,
    revision: i64,
    current: &Note,
    mut reply: Value,
) -> Result<Value> {
    let actual: Option<(i64, bool)> = conn
        .query_row("SELECT revision,readonly FROM notes_meta WHERE id=?1", [id], |r| {
            Ok((r.get(0)?, r.get::<_, i64>(1)? != 0))
        })
        .optional()?;
    if actual.map(|row| row.0) != Some(revision) {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    ensure_editable(conn, id, actual.unwrap().1)?;
    if let Some(nb) = &current.notebook_id {
        ensure_notebook_exists(conn, nb)?;
    }
    // The revision was rechecked under the write lock. Snapshot the exact
    // stored baseline before replacing either the body or its metadata.
    snapshot_stored_history(conn, id)?;
    conn.execute(
        "UPDATE notes_body SET content=?1,text=?2 WHERE note_id=?3",
        params![current.content, current.text, id],
    )?;
    conn.execute(
        "UPDATE notes_meta SET revision=?1,updated_at=?2,preview=?3,title=?5,notebook_id=?6,tags=?7,edited_at=?8 WHERE id=?4",
        params![
            current.revision,
            current.updated_at,
            model::preview_for(&current.content_format, &current.text, &current.title),
            id, current.title, current.notebook_id, serialize_tags(Some(&current.tags))?, current.edited_at
        ],
    )?;
    // Primary-only splice metadata also changes the relationship set via
    // the schema trigger. Return that committed set, not the old snapshot.
    reply["notebook_ids"] = json!(crate::notebook_membership::load(conn, id)?);
    indexer::enqueue(conn, id, current.revision)?;
    Ok(reply)
}

fn splice_reply(note: &Note, include_stats: bool) -> Value {
    let mut value = serde_json::to_value(note.summary()).unwrap();
    if include_stats {
        let text = note.text.trim();
        value["text_stats"] = json!({"words":text.split_whitespace().count(),
            "chars":text.encode_utf16().count()});
    }
    value
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SpliceMetadata {
    title: String,
    notebook_id: Option<String>,
    tags: Vec<String>,
}

/// One bounded UTF-8 byte-range replacement. Reused by draft_journal for
/// sequential partial-draft edits (same validation, same size bounds).
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BodySplice {
    start: usize,
    expected: String,
    replacement: String,
}
impl BodySplice {
    pub(crate) fn validate(&self, source: &str) -> Result<()> {
        let end = self
            .start
            .checked_add(self.expected.len())
            .ok_or_else(|| EngineError::invalid("splice offset overflow"))?;
        let old = source
            .get(self.start..end)
            .ok_or_else(|| EngineError::invalid("splice outside UTF-8 boundaries"))?;
        if old != self.expected {
            return Err(EngineError::Conflict("splice source changed".into()));
        }
        let size = source.len() - self.expected.len();
        if self.replacement.len() > limits::MAX_CONTENT_BYTES.saturating_sub(size)
            || size > limits::MAX_CONTENT_BYTES
        {
            return Err(EngineError::invalid("splice result too large"));
        }
        Ok(())
    }
    pub(crate) fn apply(self, source: &mut String) {
        source.replace_range(
            self.start..self.start + self.expected.len(),
            &self.replacement,
        );
    }
}

/// Shared commit/rollback discipline (also used by draft_journal recovery,
/// which reuses [`save_tx`] inside its own BEGIN IMMEDIATE transaction).
pub(crate) fn finish_tx(conn: &Connection, result: Result<Value>) -> Result<Value> {
    match result {
        Ok(v) => {
            if let Err(error) = conn.execute_batch("COMMIT;") {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(error.into());
            }
            Ok(v)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

/// Transaction-body of `save` (also reused by draft_journal recovery inside
/// the caller's BEGIN IMMEDIATE — never begins a transaction itself).
pub(crate) fn save_tx(conn: &Connection, input: SaveInput) -> Result<Value> {
    save_tx_format(conn, input, false)
}
fn save_tx_format(conn: &Connection, input: SaveInput, converting: bool) -> Result<Value> {
    let now = ids::now_ms();
    let existing = match &input.id {
        Some(id) => load_note(conn, id)?,
        None => None,
    };
    match existing {
        None => create_note(conn, input, now),
        Some(current) => update_note(conn, input, current, now, converting),
    }
}

fn create_note(conn: &Connection, input: SaveInput, now: i64) -> Result<Value> {
    // Create: honor a client-supplied id, else fresh UUID. A supplied
    // revision on create is ignored; revision always starts at 1.
    let id = input.id.clone().unwrap_or_else(ids::new_id);
    let content_format = input.content_format.as_deref().unwrap_or("html");
    let title = input.title.unwrap_or_default();
    let content = input.content.unwrap_or_default();
    let text = input.text.unwrap_or_default();
    let notebook_id = input.notebook_ids.as_ref().map(|ids|ids.first().cloned())
        .unwrap_or_else(||input.notebook_id.unwrap_or(None));
    if let Some(nb) = &notebook_id {
        ensure_notebook_exists(conn, nb)?;
    }
    let tags = serialize_tags(input.tags.as_ref())?;
    let preview = model::preview_for(content_format, &text, &title);
    let reminder_at = input.reminder_at.unwrap_or(None);
    conn.execute(
        "INSERT INTO notes_meta(id, seq, title, preview, notebook_id, tags, \
             reminder_at, created_at, updated_at, edited_at, revision) \
         VALUES(?1, NULL, \
                ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7, 1)",
        params![id, title, preview, notebook_id, tags, reminder_at, now],
    )?;
    conn.execute(
        "UPDATE notes_meta SET reminder_repeat_hours=?1,readonly=?3 WHERE id=?2",
        params![input.reminder_repeat_hours.flatten(), id, input.readonly.unwrap_or(false)],
    )?;
    conn.execute(
        "INSERT INTO notes_body(note_id, content, text) VALUES(?1,?2,?3)",
        params![id, content, text],
    )?;
    conn.execute(
        "UPDATE notes_meta SET content_format=?1 WHERE id=?2",
        params![content_format, id],
    )?;
    if let Some(values) = &input.notebook_ids {
        crate::notebook_membership::replace(conn, &id, values, true)?;
    }
    indexer::enqueue(conn, &id, 1)?;
    Ok(serde_json::to_value(load_note(conn, &id)?.unwrap()).unwrap())
}

fn update_note(
    conn: &Connection,
    input: SaveInput,
    current: Note,
    now: i64,
    converting: bool,
) -> Result<Value> {
    check_update(conn, &input, &current, converting)?;
    let touches_content = input.title.is_some()
        || input.content.is_some()
        || input.text.is_some()
        || input.notebook_id.is_some()
        || input.notebook_ids.is_some()
        || input.tags.is_some();
    if touches_content {
        snapshot_history(conn, &current)?;
    }
    write_update_fields(conn, &input, &current)?;
    let new_rev = current.revision + 1;
    let edited_at = if input.title.is_some()
        || input.content.is_some()
        || input.text.is_some()
        || input.content_format.as_ref().is_some_and(|format| format != &current.content_format)
    {
        now
    } else {
        current.edited_at
    };
    conn.execute(
        "UPDATE notes_meta SET revision = ?1, updated_at = ?2, edited_at = ?4 WHERE id = ?3",
        params![new_rev, now, current.id, edited_at],
    )?;
    let fresh = load_note(conn, &current.id)?.unwrap();
    let preview = model::preview_for(&fresh.content_format, &fresh.text, &fresh.title);
    conn.execute(
        "UPDATE notes_meta SET preview = ?1 WHERE id = ?2",
        params![preview, current.id],
    )?;
    indexer::enqueue(conn, &current.id, new_rev)?;
    Ok(serde_json::to_value(fresh).unwrap())
}

/// Update preconditions: revision-guarded fields, editability, format and
/// optimistic revision.
fn check_update(
    conn: &Connection,
    input: &SaveInput,
    current: &Note,
    converting: bool,
) -> Result<()> {
    if input.notebook_ids.is_some() && input.revision.is_none() {
        return Err(EngineError::invalid("notebook_ids save requires revision"));
    }
    if input.readonly.is_some() && input.revision.is_none() {
        return Err(EngineError::invalid("readonly save requires revision"));
    }
    if input.title.is_some()
        || input.content.is_some()
        || input.text.is_some()
        || input.content_format.is_some()
    {
        ensure_editable(conn, &current.id, current.readonly)?;
    }
    if input.content_format.is_some() && input.revision.is_none() {
        return Err(EngineError::invalid("source save requires revision"));
    }
    if !converting {
        check_format_unchanged(input, current)?;
    }
    // Optimistic revision check — only when the caller sends a
    // revision. Omitted revision = unchecked write (documented in
    // README; the UI autosave always sends one).
    if let Some(rev) = input.revision {
        if rev != current.revision {
            return Err(EngineError::Conflict(format!(
                "note {} revision {} != current {}",
                current.id, rev, current.revision
            )));
        }
    }
    Ok(())
}

fn check_format_unchanged(input: &SaveInput, current: &Note) -> Result<()> {
    if current.content_format != "html" && input.content_format.is_none() {
        return Err(EngineError::invalid(
            "source-format note requires content_format",
        ));
    }
    if input
        .content_format
        .as_ref()
        .is_some_and(|f| f != &current.content_format)
    {
        return Err(EngineError::invalid(
            "use convert_content to change source format",
        ));
    }
    Ok(())
}

/// Writes each supplied field; absent fields keep their stored values.
fn write_update_fields(conn: &Connection, input: &SaveInput, current: &Note) -> Result<()> {
    if let Some(title) = &input.title {
        conn.execute(
            "UPDATE notes_meta SET title = ?1 WHERE id = ?2",
            params![title, current.id],
        )?;
    }
    if let Some(nb) = &input.notebook_id {
        if let Some(nb) = nb {
            ensure_notebook_exists(conn, nb)?;
        }
        conn.execute(
            "UPDATE notes_meta SET notebook_id = ?1 WHERE id = ?2",
            params![nb, current.id],
        )?;
    }
    if let Some(values) = &input.notebook_ids {
        crate::notebook_membership::replace(conn, &current.id, values, true)?;
    }
    if let Some(tags) = &input.tags {
        conn.execute(
            "UPDATE notes_meta SET tags = ?1 WHERE id = ?2",
            params![serialize_tags(Some(tags))?, current.id],
        )?;
    }
    if let Some(hours) = input.reminder_repeat_hours {
        conn.execute(
            "UPDATE notes_meta SET reminder_repeat_hours=?1 WHERE id=?2",
            params![hours, current.id],
        )?;
    }
    if let Some(readonly) = input.readonly {
        conn.execute(
            "UPDATE notes_meta SET readonly=?1 WHERE id=?2",
            params![readonly, current.id],
        )?;
    }
    if let Some(reminder_at) = &input.reminder_at {
        conn.execute(
            "UPDATE notes_meta SET reminder_at = ?1 WHERE id = ?2",
            params![reminder_at, current.id],
        )?;
    }
    if let Some(content) = &input.content {
        upsert_body(conn, &current.id, "content", content)?;
    }
    if let Some(text) = &input.text {
        upsert_body(conn, &current.id, "text", text)?;
    }
    if let Some(format) = &input.content_format {
        conn.execute(
            "UPDATE notes_meta SET content_format=?1 WHERE id=?2",
            params![format, current.id],
        )?;
    }
    Ok(())
}

fn upsert_body(conn: &Connection, note_id: &str, field: &str, value: &str) -> Result<()> {
    // The row exists for every created note; INSERT OR IGNORE guards
    // imported/edge states.
    conn.execute(
        "INSERT OR IGNORE INTO notes_body(note_id, content, text) VALUES(?1,'','')",
        params![note_id],
    )?;
    let sql = format!("UPDATE notes_body SET {field} = ?1 WHERE note_id = ?2");
    conn.execute(&sql, params![value, note_id])?;
    Ok(())
}

fn ensure_notebook_exists(conn: &Connection, nb: &str) -> Result<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notebooks WHERE id = ?1",
        params![nb],
        |r| r.get(0),
    )?;
    if count == 0 {
        return Err(EngineError::invalid(format!(
            "notebook {nb} does not exist"
        )));
    }
    Ok(())
}

pub(crate) fn validate_save(input: &SaveInput) -> Result<()> {
    validate_save_memberships(input)?;
    if let Some(t) = &input.title {
        if t.chars().count() > limits::MAX_TITLE_CHARS {
            return Err(EngineError::invalid("title too long"));
        }
    }
    if let Some(c) = &input.content {
        check_field_size("content", c)?;
    }
    if let Some(t) = &input.text {
        check_field_size("text", t)?;
    }
    if let Some(tags) = &input.tags {
        check_tags(tags)?;
    }
    if let Some(Some(nb)) = &input.notebook_id {
        if !ids::valid_id(nb) {
            return Err(EngineError::invalid("bad notebook_id"));
        }
    }
    if let Some(Some(hours)) = input.reminder_repeat_hours {
        model::check_reminder_repeat(hours)?;
    }
    if let Some(Some(reminder_at)) = input.reminder_at {
        model::check_reminder_at(reminder_at)?;
    }
    if let Some(id) = &input.id {
        if !ids::valid_id(id) {
            return Err(EngineError::invalid("bad id"));
        }
    }
    Ok(())
}

fn validate_save_memberships(input: &SaveInput) -> Result<()> {
    if let Some(values) = &input.notebook_ids {
        crate::notebook_membership::validate_ids(values)?;
        if input.notebook_id.as_ref().is_some_and(|primary|primary.as_ref()!=values.first()) {
            return Err(EngineError::invalid("notebook_id must match the first notebook_ids entry"));
        }
    }
    Ok(())
}

pub fn check_field_size(name: &str, s: &str) -> Result<()> {
    if s.len() > limits::MAX_CONTENT_BYTES {
        return Err(EngineError::invalid(format!(
            "{name} exceeds {} bytes",
            limits::MAX_CONTENT_BYTES
        )));
    }
    Ok(())
}

pub fn check_tags(tags: &[String]) -> Result<()> {
    if tags.len() > limits::MAX_TAGS {
        return Err(EngineError::invalid("too many tags"));
    }
    for t in tags {
        if t.is_empty() || t.chars().count() > limits::MAX_TAG_NAME_CHARS {
            return Err(EngineError::invalid("bad tag name"));
        }
    }
    Ok(())
}

/// Tags are stored canonically: sorted, deduped JSON array.
pub fn serialize_tags(tags: Option<&Vec<String>>) -> Result<String> {
    match tags {
        None => Ok("[]".into()),
        Some(tags) => {
            check_tags(tags)?;
            let mut sorted: Vec<&String> = tags.iter().collect();
            sorted.sort();
            sorted.dedup();
            serde_json::to_string(&sorted.into_iter().map(String::as_str).collect::<Vec<_>>())
                .map_err(|e| EngineError::internal(e.to_string()))
        }
    }
}

pub fn patch(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    let summary_only = match args.get("summary_only") {
        None => false,
        Some(value) => value
            .as_bool()
            .ok_or_else(|| EngineError::invalid("bad summary_only"))?,
    };
    let expected_revision = match args.get("revision") {
        None => None,
        Some(value) => Some(
            value
                .as_i64()
                .filter(|v| *v > 0)
                .ok_or_else(|| EngineError::invalid("bad revision"))?,
        ),
    };
    let changes = parse_patch_changes(args, expected_revision)?;
    validate_patch_changes(&changes)?;

    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| {
        if model::opt_bool(args, "require_editable")?.unwrap_or(false) {
            let current = load_note(conn, &id)?.ok_or_else(|| EngineError::Conflict("note was deleted".into()))?;
            if current.trashed || current.locked || current.readonly { return Err(EngineError::Conflict("note is no longer editable".into())); }
            if let Some(expected) = args.get("expected_source_sha256") {
                use sha2::{Digest, Sha256};
                let expected = expected.as_str().filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))).ok_or_else(|| EngineError::invalid("invalid expected source digest"))?;
                if format!("{:x}", Sha256::digest(current.content.as_bytes())) != expected { return Err(EngineError::Conflict("source changed".into())); }
            }
        } else if args.get("expected_source_sha256").is_some() { return Err(EngineError::invalid("source digest requires editable guard")); }
        apply_patch(conn, &id, &changes, expected_revision, summary_only)
    })();
    finish_tx(conn, result)
}

/// Deserializes `changes`, re-deriving explicit nulls, and enforces which
/// fields require an expected revision.
fn parse_patch_changes(args: &Value, expected_revision: Option<i64>) -> Result<model::PatchInput> {
    let changes_value = args.get("changes").cloned().unwrap_or(Value::Null);
    if changes_value.get("content_format").is_some() {
        return Err(EngineError::invalid(
            "use convert_content to change source format",
        ));
    }
    let mut changes: model::PatchInput = serde_json::from_value(changes_value.clone())
        .map_err(|e| EngineError::invalid(format!("bad changes: {e}")))?;
    changes.readonly = model::opt_bool(&changes_value, "readonly")?;
    if changes.readonly.is_some() && expected_revision.is_none() {
        return Err(EngineError::invalid("readonly patch requires revision"));
    }
    changes.notebook_id = model::opt_string(&changes_value, "notebook_id")?;
    changes.notebook_ids = crate::notebook_membership::parse_ids(&changes_value)?;
    if let Some(values) = &changes.notebook_ids {
        crate::notebook_membership::validate_ids(values)?;
        if expected_revision.is_none() {
            return Err(EngineError::invalid("notebook_ids patch requires revision"));
        }
    }
    changes.color = model::opt_string(&changes_value, "color")?;
    changes.reminder_at = model::opt_i64(&changes_value, "reminder_at")?;
    changes.reminder_repeat_hours = model::opt_i64(&changes_value, "reminder_repeat_hours")?;
    if changes_value.get("title").is_some() {
        let title = changes
            .title
            .as_ref()
            .ok_or_else(|| EngineError::invalid("title must be a string"))?;
        if expected_revision.is_none() {
            return Err(EngineError::invalid("title patch requires revision"));
        }
        if title.chars().count() > limits::MAX_TITLE_CHARS {
            return Err(EngineError::invalid("title too long"));
        }
    }
    Ok(changes)
}

fn validate_patch_changes(changes: &model::PatchInput) -> Result<()> {
    if let Some(Some(c)) = &changes.color {
        if c.chars().count() > limits::MAX_COLOR_CHARS {
            return Err(EngineError::invalid("color too long"));
        }
    }
    if let Some(tags) = &changes.tags {
        check_tags(tags)?;
    }
    if let Some(Some(nb)) = &changes.notebook_id {
        if !ids::valid_id(nb) {
            return Err(EngineError::invalid("bad notebook_id"));
        }
    }
    if let Some(Some(hours)) = changes.reminder_repeat_hours {
        model::check_reminder_repeat(hours)?;
    }
    if let Some(Some(reminder_at)) = changes.reminder_at {
        model::check_reminder_at(reminder_at)?;
    }
    Ok(())
}

/// Transaction body of `patch` (caller finishes the transaction).
pub(crate) fn apply_patch(
    conn: &Connection,
    id: &str,
    changes: &model::PatchInput,
    expected_revision: Option<i64>,
    summary_only: bool,
) -> Result<Value> {
    let current = load_summary(conn, id)?;
    if expected_revision.is_some_and(|revision| revision != current.revision) {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    if changes.title.is_some() {
        ensure_editable(conn, id, current.readonly)?;
    }
    if changes.title.is_some() || changes.tags.is_some() || changes.notebook_id.is_some() || changes.notebook_ids.is_some() {
        snapshot_stored_history(conn, id)?;
    }
    let now = ids::now_ms();
    let mut sets: Vec<String> = Vec::new();
    let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    patch_assignments(conn, id, changes, now, &mut sets, &mut vals)?;
    if sets.is_empty() {
        return Err(EngineError::invalid("empty changes"));
    }
    vals.push(Box::new(now));
    sets.push(format!("updated_at = ?{}", vals.len()));
    let new_rev = current
        .revision
        .checked_add(1)
        .ok_or_else(|| EngineError::invalid("revision overflow"))?;
    vals.push(Box::new(new_rev));
    sets.push(format!("revision = ?{}", vals.len()));
    // id only goes into WHERE (numbered placeholder — never mix an
    // anonymous ? with ?N indexes).
    vals.push(Box::new(id.to_string()));
    let sql = format!(
        "UPDATE notes_meta SET {} WHERE id = ?{}",
        sets.join(", "),
        vals.len()
    );
    let params_ref: Vec<&dyn rusqlite::ToSql> = vals.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;
    indexer::enqueue(conn, id, new_rev)?;
    if summary_only {
        Ok(serde_json::to_value(load_summary(conn, id)?).unwrap())
    } else {
        Ok(serde_json::to_value(load_note(conn, id)?.unwrap()).unwrap())
    }
}

/// Collects `column = ?N` assignments and their values for the supplied
/// changes; also rewrites title-only previews and notebook memberships.
fn patch_assignments(
    conn: &Connection,
    id: &str,
    changes: &model::PatchInput,
    now: i64,
    sets: &mut Vec<String>,
    vals: &mut Vec<Box<dyn rusqlite::ToSql>>,
) -> Result<()> {
    for (col, v) in [
        ("favorite", changes.favorite.map(|b| b as i64)),
        ("pinned", changes.pinned.map(|b| b as i64)),
        ("readonly", changes.readonly.map(|b| b as i64)),
        ("archived", changes.archived.map(|b| b as i64)),
        ("trashed", changes.trashed.map(|b| b as i64)),
    ] {
        if let Some(v) = v {
            vals.push(Box::new(v));
            sets.push(format!("{col} = ?{}", vals.len()));
        }
    }
    if let Some(title) = &changes.title {
        vals.push(Box::new(title.clone()));
        sets.push(format!("title = ?{}", vals.len()));
        vals.push(Box::new(now));
        sets.push(format!("edited_at = ?{}", vals.len()));
        // Only title-only previews change; actual body previews remain intact.
        conn.execute("UPDATE notes_meta SET preview=?1 WHERE id=?2 AND EXISTS (SELECT 1 FROM notes_body WHERE note_id=?2 AND text='')",
            params![model::preview_of("", title), id])?;
    }
    if let Some(c) = &changes.color {
        vals.push(Box::new(c.clone()));
        sets.push(format!("color = ?{}", vals.len()));
    }
    if let Some(hours) = changes.reminder_repeat_hours {
        vals.push(Box::new(hours));
        sets.push(format!("reminder_repeat_hours = ?{}", vals.len()));
    }
    if let Some(reminder_at) = &changes.reminder_at {
        // Option<i64>: Some(ms) sets the schedule, None (explicit null)
        // clears it. Absent never reaches this arm.
        vals.push(Box::new(*reminder_at));
        sets.push(format!("reminder_at = ?{}", vals.len()));
    }
    if let Some(nb) = &changes.notebook_id {
        if let Some(nb) = nb {
            ensure_notebook_exists(conn, nb)?;
        }
        vals.push(Box::new(nb.clone()));
        sets.push(format!("notebook_id = ?{}", vals.len()));
    }
    if let Some(values) = &changes.notebook_ids {
        crate::notebook_membership::replace(conn, id, values, true)?;
        // Keep membership-only patches in the ordinary revision/journal path.
        vals.push(Box::new(values.first().cloned()));
        sets.push(format!("notebook_id = ?{}", vals.len()));
    }
    if let Some(tags) = &changes.tags {
        vals.push(Box::new(serialize_tags(Some(tags))?));
        sets.push(format!("tags = ?{}", vals.len()));
    }
    Ok(())
}

/// Hard rule against accidental permanent deletes: only trashed notes may be
/// deleted. Bodies + history cascade via FK; the surviving job row makes the
/// worker clean the search index.
pub fn delete(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<Value> {
        let trashed: Option<i64> = conn
            .query_row(
                "SELECT trashed FROM notes_meta WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?;
        match trashed {
            None => Err(EngineError::NotFound(format!("note {id}"))),
            Some(0) => Err(EngineError::Invalid(
                "note is not in trash; move it to trash first".into(),
            )),
            Some(_) => {
                crate::knowledge::delete_local(conn, &id)?;
                conn.execute("DELETE FROM notes_meta WHERE id = ?1", params![id])?;
                indexer::enqueue(conn, &id, i64::MAX)?;
                Ok(json!({ "deleted": true }))
            }
        }
    })();
    finish_tx(conn, result)
}

/// Snapshot inside SQLite, without copying the body into a foreground Note.
pub fn snapshot_stored_history(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("INSERT INTO history_seq DEFAULT VALUES", [])?;
    let row_seq = conn.last_insert_rowid();
    let inserted = conn.execute(
        "INSERT INTO history(id,note_id,title,content,text,created_at,row_seq,note_revision,content_format) SELECT ?1,m.id,m.title,b.content,b.text,?2,?3,m.revision,m.content_format FROM notes_meta m JOIN notes_body b ON b.note_id=m.id WHERE m.id=?4",
        params![ids::new_id(), ids::now_ms(), row_seq, id])?;
    if inserted != 1 {
        return Err(EngineError::internal("missing note body"));
    }
    conn.execute("DELETE FROM history WHERE note_id=?1 AND label IS NULL AND row_seq NOT IN (SELECT row_seq FROM history WHERE note_id=?1 AND label IS NULL ORDER BY created_at DESC,row_seq DESC LIMIT ?2)",
        params![id, limits::HISTORY_MAX_PER_NOTE as i64])?;
    Ok(())
}

/// Snapshot the PREVIOUS content into history. row_seq comes from the
/// AUTOINCREMENT helper table so retention/ordering uses a declared column.
pub fn snapshot_history(conn: &Connection, note: &Note) -> Result<()> {
    let hid = ids::new_id();
    conn.execute("INSERT INTO history_seq DEFAULT VALUES", [])?;
    let row_seq = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO history(id, note_id, title, content, text, created_at, row_seq, note_revision, content_format) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            hid,
            note.id,
            note.title,
            note.content,
            note.text,
            ids::now_ms(),
            row_seq,
            note.revision, note.content_format
        ],
    )?;
    conn.execute(
        "DELETE FROM history WHERE note_id = ?1 AND label IS NULL AND row_seq NOT IN ( \
             SELECT row_seq FROM history WHERE note_id = ?1 AND label IS NULL \
             ORDER BY created_at DESC, row_seq DESC LIMIT ?2)",
        params![note.id, limits::HISTORY_MAX_PER_NOTE as i64],
    )?;
    Ok(())
}

/// Exact revision only: never infer a baseline from timestamps or similar text.
pub fn revision_body(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    let revision = args
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|v| *v > 0)
        .ok_or_else(|| EngineError::invalid("missing or bad revision"))?;
    let content: Option<(String,String)> = conn
        .query_row(
            "SELECT b.content, m.content_format FROM notes_meta m JOIN notes_body b ON b.note_id=m.id
         WHERE m.id=?1 AND m.revision=?2
         UNION ALL SELECT content, content_format FROM history WHERE note_id=?1 AND note_revision=?2 LIMIT 1",
            params![id, revision],
            |r| Ok((r.get(0)?,r.get(1)?)),
        )
        .optional()?;
    let content = content.ok_or_else(|| {
        EngineError::NotFound("편집 기준 버전이 이력에 없습니다. 현재 편집을 유지했습니다.".into())
    })?;
    Ok(json!({"revision":revision,"content":content.0,"content_format":content.1}))
}

pub fn history(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    let mut stmt = conn.prepare(
        "SELECT id, note_id, title, created_at, content_format, note_revision, label FROM history \
         WHERE note_id = ?1 ORDER BY created_at DESC, row_seq DESC",
    )?;
    let entries: Vec<Value> = stmt
        .query_map(params![id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "note_id": r.get::<_, String>(1)?,
                "title": r.get::<_, String>(2)?,
                "created_at": r.get::<_, i64>(3)?, "content_format":r.get::<_,String>(4)?,
                // 버전 비교: 이 값으로 revision_body를 읽는다. 오래된 기록은 비어 있을 수 있다.
                "note_revision": r.get::<_, Option<i64>>(5)?, "label":r.get::<_,Option<String>>(6)?,
            }))
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(Value::Array(entries))
}

pub fn restore(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    let history_id = args
        .get("history_id")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("missing history_id"))?;
    if !ids::valid_id(history_id) {
        return Err(EngineError::invalid("bad history_id"));
    }
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<Value> {
        let current =
            load_note(conn, &id)?.ok_or_else(|| EngineError::NotFound(format!("note {id}")))?;
        ensure_editable(conn, &id, current.readonly)?;
        let (title, content, text, content_format) = conn
            .query_row(
                "SELECT title, content, text, content_format FROM history WHERE id = ?1 AND note_id = ?2",
                params![history_id, id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?, r.get::<_,String>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| EngineError::NotFound(format!("history {history_id}")))?;
        if args
            .get("revision")
            .and_then(Value::as_i64)
            .is_some_and(|r| r != current.revision)
        {
            return Err(EngineError::Conflict("document revision changed".into()));
        }
        snapshot_history(conn, &current)?;
        conn.execute(
            "UPDATE notes_meta SET content_format=?1 WHERE id=?2",
            params![content_format, id],
        )?;
        let now = ids::now_ms();
        let new_rev = current.revision + 1;
        conn.execute(
            "UPDATE notes_meta SET title = ?1, revision = ?2, updated_at = ?3, edited_at = ?3 WHERE id = ?4",
            params![title, new_rev, now, id],
        )?;
        upsert_body(conn, &id, "content", &content)?;
        upsert_body(conn, &id, "text", &text)?;
        let preview = model::preview_for(&content_format, &text, &title);
        conn.execute(
            "UPDATE notes_meta SET preview = ?1 WHERE id = ?2",
            params![preview, id],
        )?;
        indexer::enqueue(conn, &id, new_rev)?;
        Ok(serde_json::to_value(load_note(conn, &id)?.unwrap()).unwrap())
    })();
    finish_tx(conn, result)
}

/// Explicit reinterpretation preserves source bytes unless the caller supplies
/// a replacement. Never infer conversion from an editor/view mode change.
pub fn convert_content(conn: &Connection, args: &Value) -> Result<Value> {
    let id = arg_id(args)?;
    let revision = args
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|r| *r > 0)
        .ok_or_else(|| EngineError::invalid("conversion requires revision"))?;
    let format = args
        .get("content_format")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("conversion requires content_format"))?;
    crate::source_format::validate(format)?;
    // An explicit replacement is a transformation, not just a new label.
    // Derive HTML search/preview text before obtaining the write lock.
    let replacement_text = match args.get("content") {
        Some(Value::String(content)) if format == "html" => {
            check_field_size("content", content)?;
            Some(crate::source_format::search_text(format, content)?)
        },
        _ => None,
    };
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| {
        let old = load_note(conn, &id)?.ok_or_else(|| EngineError::NotFound(id.clone()))?;
        if old.revision != revision {
            return Err(EngineError::Conflict("document revision changed".into()));
        }
        let content = match args.get("content") {
            None => old.content,
            Some(Value::String(s)) => s.clone(),
            Some(_) => return Err(EngineError::invalid("content must be a string")),
        };
        let input: SaveInput = serde_json::from_value(json!({"id":id,"revision":revision,
            "content_format":format,"content":content,"text":replacement_text.as_ref().unwrap_or(&content)}))
        .map_err(|_| EngineError::invalid("invalid conversion"))?;
        validate_save(&input)?;
        save_tx_format(conn, input, true)
    })();
    finish_tx(conn, result)
}
