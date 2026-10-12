//! Local editor undo data. Lives inside the encrypted main DB, never sync/export.
use crate::error::{EngineError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
const MAX_BYTES: usize = 8 * 1024 * 1024;
pub fn get(conn: &Connection) -> Result<Value> {
    let mut statement=conn.prepare("SELECT h.note_id,h.kind,h.revision,h.payload,n.content_format FROM editor_history h JOIN notes_meta n ON n.id=h.note_id AND n.revision=h.revision")?;
    let mut rows = statement.query([])?;
    let mut values = Vec::new();
    while let Some(row) = rows.next()? {
        let payload: String = row.get(3)?;
        let format: String = row.get(4)?;
        let decoded: Value = serde_json::from_str(&payload)?;
        if decoded
            .get("_format")
            .and_then(Value::as_str)
            .unwrap_or("html")
            != format
        {
            continue;
        }
        let value = decoded.get("_history").cloned().unwrap_or(decoded);

        values.push(json!({"id":row.get::<_,String>(0)?,"kind":row.get::<_,String>(1)?,"revision":row.get::<_,i64>(2)?,"format":format,"value":value}));
    }
    Ok(json!(values))
}
/// Validates each `kind -> history` entry and wraps it with its format.
fn encode_histories<'a>(
    values: &'a serde_json::Map<String, Value>,
    format: &str,
) -> Result<Vec<(&'a String, String)>> {
    let mut encoded = Vec::new();
    for (kind, value) in values {
        if !value.is_object() {
            return Err(EngineError::invalid("history payload must be an object"));
        }
        if ![
            "rich",
            "source",
            "window",
            "split-rich",
            "split-source",
            "split-window",
        ]
        .contains(&kind.as_str())
        {
            return Err(EngineError::invalid("bad history kind"));
        }
        let payload = serde_json::to_string(&json!({"_format":format,"_history":value}))?;
        if payload.len() > MAX_BYTES {
            return Err(EngineError::invalid("history exceeds 8 MiB"));
        }
        encoded.push((kind, payload));
    }
    Ok(encoded)
}
pub fn set(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args["id"]
        .as_str()
        .filter(|id| crate::ids::valid_id(id))
        .ok_or_else(|| EngineError::invalid("bad history id"))?;
    let revision = args["revision"]
        .as_i64()
        .filter(|n| *n > 0)
        .ok_or_else(|| EngineError::invalid("bad history revision"))?;
    // Undo stacks hold plaintext; a locked note keeps none on disk.
    if crate::vault::is_locked(conn, id)? {
        return Err(EngineError::Conflict("잠긴 노트는 실행 취소 기록을 저장하지 않습니다".into()));
    }
    let format = args.get("format").and_then(Value::as_str).unwrap_or("html");
    if !["text", "html", "markdown"].contains(&format) {
        return Err(EngineError::invalid("bad history format"));
    }
    let values = args["values"]
        .as_object()
        .ok_or_else(|| EngineError::invalid("bad histories"))?;
    let encoded = encode_histories(values, format)?;
    // Reserve the writer before reading the revision. A deferred read-to-write
    // upgrade cannot wait on a concurrent WAL writer and fails with SQLITE_BUSY.
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    let current: Option<(i64, String)> = tx
        .query_row(
            "SELECT revision,content_format FROM notes_meta WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if current != Some((revision, format.to_string())) {
        return Ok(json!({"saved":false,"stale":true}));
    }
    tx.execute("DELETE FROM editor_history WHERE note_id=?1", [id])?;
    for (kind, payload) in encoded {
        tx.execute(
            "INSERT INTO editor_history(note_id,kind,revision,payload) VALUES(?1,?2,?3,?4)",
            params![id, kind, revision, payload],
        )?;
    }
    // Evict stale data before bounding retained notes. Note bodies remain untouched.
    tx.execute("DELETE FROM editor_history WHERE NOT EXISTS (SELECT 1 FROM notes_meta n WHERE n.id=editor_history.note_id AND n.revision=editor_history.revision)",[])?;
    tx.execute("DELETE FROM editor_history WHERE note_id NOT IN (SELECT note_id FROM editor_history GROUP BY note_id ORDER BY MAX(rowid) DESC LIMIT 16)",[])?;
    loop {
        let bytes: i64 = tx.query_row(
            "SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) FROM editor_history",
            [],
            |r| r.get(0),
        )?;
        if bytes <= 16 * 1024 * 1024 {
            break;
        }
        let oldest:Option<String>=tx.query_row("SELECT note_id FROM editor_history WHERE note_id<>?1 GROUP BY note_id ORDER BY MAX(rowid) LIMIT 1",[id],|r|r.get(0)).optional()?;
        if let Some(oldest) = oldest {
            tx.execute("DELETE FROM editor_history WHERE note_id=?1", [oldest])?;
        } else {
            return Err(EngineError::invalid(
                "note history exceeds total 16 MiB cap",
            ));
        }
    }
    tx.commit()?;
    Ok(json!({"saved":true}))
}

pub fn split_get(conn: &Connection) -> Result<Value> {
    let saved: Option<(Option<String>, String, String)> = conn
        .query_row(
            "SELECT note_id,mode,state FROM split_layout WHERE slot=0",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (id, mode, state) = saved.unwrap_or((None, "source".into(), "{}".into()));
    let state: Value = serde_json::from_str(&state)?;
    let ids: Vec<String> = if let Some(ids) = state.get("ids") {
        serde_json::from_value(ids.clone())?
    } else {
        id.iter().cloned().collect()
    };
    let positions = state.get("locations").cloned().unwrap_or(json!({}));
    let seen = ids.iter().map(String::as_str).collect();
    crate::workspace::validate_locations(&positions, &seen)?;
    let mut tabs = Vec::new();
    let mut locations = serde_json::Map::new();
    let mut active = None;
    for item in ids {
        let row: Option<(String, i64)> = conn
            .query_row(
                "SELECT title,revision FROM notes_meta WHERE id=?1 AND trashed=0",
                [&item],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((title, revision)) = row {
            if id.as_ref() == Some(&item) {
                active = Some(item.clone());
            }
            if let Some(position) = positions
                .get(&item)
                .filter(|p| p["revision"].as_i64() == Some(revision))
            {
                locations.insert(item.clone(), position.clone());
            }
            tabs.push(json!({"id":item,"title":title}));
        }
    }
    Ok(json!({"id":active,"mode":mode,"tabs":tabs,"locations":locations}))
}
pub fn split_set(conn: &Connection, args: &Value) -> Result<Value> {
    let id = match &args["id"] {
        Value::Null => None,
        Value::String(id) if crate::ids::valid_id(id) => Some(id),
        _ => return Err(EngineError::invalid("bad split note")),
    };
    let mode = args["mode"]
        .as_str()
        .filter(|m| ["rich", "source"].contains(m))
        .ok_or_else(|| EngineError::invalid("bad split mode"))?;
    let ids: Vec<String> = if let Some(ids) = args.get("ids") {
        serde_json::from_value(ids.clone())?
    } else {
        id.into_iter().cloned().collect()
    };
    let seen: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
    if ids.len() > 32
        || seen.len() != ids.len()
        || ids.iter().any(|id| !crate::ids::valid_id(id))
        || id.is_some_and(|id| !seen.contains(id.as_str()))
    {
        return Err(EngineError::invalid("bad split tabs"));
    }
    let locations = args.get("locations").cloned().unwrap_or(json!({}));
    crate::workspace::validate_locations(&locations, &seen)?;
    let state = serde_json::to_string(&json!({"ids":ids,"locations":locations}))?;
    conn.execute("INSERT INTO split_layout(slot,note_id,mode,state) VALUES(0,?1,?2,?3) ON CONFLICT(slot) DO UPDATE SET note_id=excluded.note_id,mode=excluded.mode,state=excluded.state",params![id,mode,state])?;
    Ok(json!({"saved":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::schema::init_main(&conn).unwrap();
        conn.execute_batch("INSERT INTO notes_meta(id,title,revision,trashed,content_format,created_at,updated_at)
  VALUES('note-a','A',1,0,'markdown',0,0),('note-b','B',2,0,'text',0,0);").unwrap();
        conn
    }
    #[test]
    fn canonical_format_guard_rejects_mismatched_history_without_mutation() {
        let conn = connection();
        let args = json!({"id":"note-a","revision":1,"format":"markdown","values":{"source":{"history":{"done":[],"undone":[]}}}});
        assert_eq!(set(&conn, &args).unwrap()["saved"], true);
        let mut wrong = args.clone();
        wrong["format"] = json!("html");
        assert_eq!(set(&conn, &wrong).unwrap()["stale"], true);
        assert_eq!(get(&conn).unwrap()[0]["format"], "markdown");
        // Even an out-of-band format mutation cannot replay a different syntax.
        conn.execute(
            "UPDATE notes_meta SET content_format='text' WHERE id='note-a'",
            [],
        )
        .unwrap();
        assert!(get(&conn).unwrap().as_array().unwrap().is_empty());
    }
    #[test]
    fn split_layout_is_atomic_and_positions_require_current_revision() {
        let conn = connection();
        let args = json!({"id":"note-a","mode":"source","ids":["note-b","note-a"],"locations":{"note-a":{"revision":1,"kind":"markdown","offset":0,"scrollTop":100,"selection":{"ranges":[{"anchor":2,"head":4}],"main":0}}}});
        split_set(&conn, &args).unwrap();
        assert_eq!(split_get(&conn).unwrap()["tabs"][0]["id"], "note-b");
        let mut bad = args.clone();
        bad["locations"]["note-a"]["selection"]["ranges"][0]["anchor"] = json!(-1);
        assert!(split_set(&conn, &bad).is_err());
        assert_eq!(
            split_get(&conn).unwrap()["locations"]["note-a"]["scrollTop"],
            100
        );
        conn.execute("UPDATE notes_meta SET revision=3 WHERE id='note-a'", [])
            .unwrap();
        assert!(split_get(&conn).unwrap()["locations"]
            .as_object()
            .unwrap()
            .is_empty());
        conn.execute("DELETE FROM notes_meta WHERE id='note-a'", [])
            .unwrap();
        assert!(split_get(&conn).unwrap()["id"].is_null());
        assert_eq!(
            split_get(&conn).unwrap()["tabs"].as_array().unwrap().len(),
            1
        );
    }
    #[test]
    fn aggregate_history_response_stays_below_jsonl_budget() {
        let conn = connection();
        conn.execute("INSERT INTO notes_meta(id,title,revision,trashed,content_format,created_at,updated_at) VALUES('note-c','C',1,0,'html',0,0)", [])
            .unwrap();
        // Quote-heavy delta measures encoded JSON bytes rather than raw length.
        let delta = "\"".repeat(3 * 1024 * 1024);
        for (id, revision, format) in [
            ("note-a", 1, "markdown"),
            ("note-b", 2, "text"),
            ("note-c", 1, "html"),
        ] {
            set(&conn,&json!({"id":id,"revision":revision,"format":format,"values":{"source":{"delta":delta}}})).unwrap();
        }
        let values = get(&conn).unwrap();
        assert_eq!(
            values.as_array().unwrap().len(),
            2,
            "oldest note is evicted before exceeding total cap"
        );
        assert!(
            serde_json::to_vec(&json!({"ok":true,"data":values}))
                .unwrap()
                .len()
                < 20 * 1024 * 1024
        );
    }
}
