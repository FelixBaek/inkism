//! Local workspace: open tabs, active tab and revision-checked editor positions.
//! Deliberately LOCAL convenience data with a tiny contract (.private/docs/protocol.md):
//!   * {op:"workspace_get"} -> {tabs:[{id,title}],active:string|null}
//!   * {op:"workspace_set",ids:string[],active:string|null,locations?:object} -> {saved:true}
//!
//! Storage is ONE single-slot row (`workspace_state`, slot = 0) in the main
//! database, upserted atomically by [`set`]. Everything is validated BEFORE
//! writing, so a rejected request can never disturb the
//! previously saved row (invalid input preserves existing state).
//!
//! Sync/backup exclusion by construction: `workspace_state` is never read by
//! export/import or the sync journal — a fresh device simply starts empty.
//!
//! Liveness is resolved at read time: [`get`] touches ONLY `notes_meta`
//! (never `notes_body`) to look up titles/revisions, drops ids whose note no longer
//! exists, and returns `active: null` when the stored active tab was one of
//! them. Set accepts ids without existence checks (a tab may reference a
//! note the frontend is about to create); get is the single place that
//! filters.

use crate::error::{EngineError, Result};
use crate::ids;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

/// Hard cap on open tabs. Oversized input is rejected, never truncated.
pub const MAX_WORKSPACE_TABS: usize = 256;

/// {op:"workspace_get"} -> {tabs,active}. Tab order is the stored id order;
/// titles come from `notes_meta` at call time (a rename is reflected
/// immediately), dead ids are silently dropped, and a vanished/filtered-out
/// active id normalizes to null. A missing row means the default empty state;
/// corrupt JSON fails so the client cannot overwrite it with an empty workspace.
pub fn get(conn: &Connection) -> Result<Value> {
    let (stored, active, positions): (String, Option<String>, String) = conn
        .query_row(
            "SELECT ids, active, locations FROM workspace_state WHERE slot = 0",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .unwrap_or_else(|| ("[]".to_string(), None, "{}".to_string()));
    let ids: Vec<String> = serde_json::from_str(&stored)?;

    let positions: Value = serde_json::from_str(&positions)?;
    validate_locations(&positions, &ids.iter().map(String::as_str).collect())?;
    let mut locations = serde_json::Map::new();
    let mut titles = conn.prepare("SELECT title,revision FROM notes_meta WHERE id = ?1")?;
    let mut tabs = Vec::with_capacity(ids.len());
    let mut live = HashSet::with_capacity(ids.len());
    for id in &ids {
        let row: Option<(String, i64)> = titles
            .query_row(params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        if let Some((title, revision)) = row {
            if let Some(position) = positions
                .get(id)
                .filter(|p| p["revision"].as_i64() == Some(revision))
            {
                locations.insert(id.clone(), position.clone());
            }
            live.insert(id.as_str());
            tabs.push(json!({ "id": id, "title": title }));
        }
    }
    drop(titles);

    let active = match active {
        Some(a) if live.contains(a.as_str()) => json!(a),
        _ => Value::Null,
    };
    let mut result = json!({ "tabs": tabs, "active": active });
    if !locations.is_empty() {
        result["locations"] = Value::Object(locations);
    }
    Ok(result)
}

/// {op:"workspace_set",ids,active} -> {saved:true}. Validation order (all
/// before any write): `ids` must be an array of at most
/// [`MAX_WORKSPACE_TABS`] distinct `ids::valid_id` strings with no
/// duplicates; `active` must be null/absent or one of `ids` (and itself a
/// valid id). The row is then written as one atomic upsert.
pub fn set(conn: &Connection, args: &Value) -> Result<Value> {
    let arr = args
        .get("ids")
        .ok_or_else(|| EngineError::invalid("missing ids"))?
        .as_array()
        .ok_or_else(|| EngineError::invalid("ids must be an array"))?;
    if arr.len() > MAX_WORKSPACE_TABS {
        return Err(EngineError::invalid(format!(
            "too many ids (max {MAX_WORKSPACE_TABS})"
        )));
    }
    let mut seen: HashSet<&str> = HashSet::with_capacity(arr.len());
    let mut ids: Vec<&str> = Vec::with_capacity(arr.len());
    for v in arr {
        let id = v
            .as_str()
            .ok_or_else(|| EngineError::invalid("ids must be strings"))?;
        if !ids::valid_id(id) {
            return Err(EngineError::invalid("bad id in ids"));
        }
        if !seen.insert(id) {
            return Err(EngineError::invalid("duplicate id in ids"));
        }
        ids.push(id);
    }
    let active: Option<&str> = match args.get("active") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => {
            if !ids::valid_id(s) {
                return Err(EngineError::invalid("bad active id"));
            }
            if !seen.contains(s.as_str()) {
                return Err(EngineError::invalid("active must be one of ids or null"));
            }
            Some(s.as_str())
        }
        Some(_) => return Err(EngineError::invalid("active must be a string or null")),
    };

    let locations = args.get("locations").cloned().unwrap_or_else(|| json!({}));
    validate_locations(&locations, &seen)?;
    // One SQL statement is already atomic, including commit failure rollback.
    conn.execute(
        "INSERT INTO workspace_state(slot, ids, active, locations) VALUES(0, ?1, ?2, ?3)
         ON CONFLICT(slot) DO UPDATE SET ids = excluded.ids, active = excluded.active, locations = excluded.locations",
        params![serde_json::to_string(&ids)?, active, serde_json::to_string(&locations)?],
    )?;
    Ok(json!({ "saved": true }))
}

/// Position data is bounded and structurally limited to numeric editor offsets;
/// arbitrary document strings must never enter the local workspace cache.
pub(crate) fn validate_locations(value: &Value, ids: &HashSet<&str>) -> Result<()> {
    let positions = value.as_object().ok_or_else(invalid_locations)?;
    if positions.len() > MAX_WORKSPACE_TABS {
        return Err(invalid_locations());
    }
    for (id, location) in positions {
        if !ids.contains(id.as_str()) {
            return Err(invalid_locations());
        }
        validate_location(location)?;
    }
    Ok(())
}

fn invalid_locations() -> EngineError {
    EngineError::invalid("bad workspace locations")
}

fn location_number(v: &Value) -> bool {
    v.as_u64().is_some_and(|n| n <= 2_147_483_647)
}

fn validate_location(location: &Value) -> Result<()> {
    let invalid = invalid_locations;
    let number = location_number;
    let fields = location.as_object().ok_or_else(invalid)?;
    if fields
        .keys()
        .any(|k| !["revision", "kind", "offset", "scrollTop", "selection"].contains(&k.as_str()))
        || !location["revision"].as_i64().is_some_and(|n| n > 0)
        || !number(&location["offset"])
        || !matches!(
            location["kind"].as_str(),
            Some("rich" | "windowed" | "source" | "markdown")
        )
    {
        return Err(invalid());
    }
    if let Some(y) = fields.get("scrollTop") {
        if !y
            .as_f64()
            .is_some_and(|n| n.is_finite() && (0.0..=2_147_483_647.0).contains(&n))
        {
            return Err(invalid());
        }
    }
    if let Some(selection) = fields.get("selection") {
        let object = selection.as_object().ok_or_else(invalid)?;
        if matches!(location["kind"].as_str(), Some("source" | "markdown")) {
            validate_source_selection(selection, object)?;
        } else {
            validate_rich_selection(location, selection, object)?;
        }
    }
    Ok(())
}

fn validate_source_selection(selection: &Value, object: &Map<String, Value>) -> Result<()> {
    let invalid = invalid_locations;
    let number = location_number;
    if object
        .keys()
        .any(|k| !["ranges", "main"].contains(&k.as_str()))
    {
        return Err(invalid());
    }
    let ranges = selection["ranges"].as_array().ok_or_else(invalid)?;
    if ranges.is_empty()
        || ranges.len() > 128
        || !selection["main"]
            .as_u64()
            .is_some_and(|n| n < ranges.len() as u64)
    {
        return Err(invalid());
    }
    for range in ranges {
        let range = range.as_object().ok_or_else(invalid)?;
        if range.len() != 2
            || !range.get("anchor").is_some_and(number)
            || !range.get("head").is_some_and(number)
        {
            return Err(invalid());
        }
    }
    Ok(())
}

fn validate_rich_selection(
    location: &Value,
    selection: &Value,
    object: &Map<String, Value>,
) -> Result<()> {
    let invalid = invalid_locations;
    let number = location_number;
    let source_fields = ["anchorByte", "anchorWithin", "headByte", "headWithin"];
    let extras = object
        .keys()
        .filter(|k| source_fields.contains(&k.as_str()))
        .count();
    if extras > 0
        && (location["kind"] != "windowed"
            || source_fields
                .iter()
                .any(|k| object.get(*k).is_some_and(|v| !number(v)))
            || object.contains_key("anchorByte") != object.contains_key("anchorWithin")
            || object.contains_key("headByte") != object.contains_key("headWithin"))
    {
        return Err(invalid());
    }
    let base_len = object.len() - extras;
    if object.keys().any(|k| {
        !["type", "anchor", "head"].contains(&k.as_str()) && !source_fields.contains(&k.as_str())
    }) {
        return Err(invalid());
    }
    match selection["type"].as_str() {
        Some("all") if object.len() == 1 => {}
        Some("node")
            if base_len == 2
                && (extras == 0 || extras == 2)
                && !object.contains_key("headByte")
                && number(&selection["anchor"]) => {}
        Some("text" | "cell")
            if base_len == 3
                && (extras == 0 || extras == 4)
                && number(&selection["anchor"])
                && number(&selection["head"]) => {}
        _ => return Err(invalid()),
    }
    Ok(())
}
