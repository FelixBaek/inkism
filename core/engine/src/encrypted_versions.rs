//! Local encrypted snapshots. Keys and plaintext are owned by the runtime.
use crate::{
    error::{EngineError, Result},
    ids,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
pub fn rows(c: &Connection, note: &str) -> Result<Value> {
    let mut q =
        c.prepare("SELECT id,data FROM encrypted_named_versions WHERE note_id=?1 ORDER BY id")?;
    let values = q
        .query_map([note], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut out = Vec::new();
    for (id, data) in values {
        let mut v: Value = serde_json::from_str(&data)?;
        v["id"] = json!(id);
        out.push(v);
    }
    Ok(json!(out))
}
/// Names and times of a note's encrypted snapshots, never their ciphertext.
/// Lets the version history explain snapshots that stay sealed under a note
/// that is no longer locked (for example one synced from another device).
pub fn sealed(c: &Connection, args: &Value) -> Result<Value> {
    let note = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("missing id"))?;
    let mut out = Vec::new();
    for v in listing(c, note)?.as_array().into_iter().flatten() {
        out.push(json!({"id":v["id"],"label":v["label"],"title":v["title"],"created_at":v["created_at"]}));
    }
    out.sort_by_key(|v| std::cmp::Reverse(v["created_at"].as_i64().unwrap_or(0)));
    Ok(json!(out))
}
const MAX_ROWS: usize = 100;
const MAX_PLAIN_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SERIALIZED_BYTES: u64 = 96 * 1024 * 1024;

/// Checks one stored row and returns its declared plaintext size.
fn validate_row(v: &Value) -> Result<u64> {
    if v.as_object().is_none_or(|o| {
        o.keys().any(|k| {
            !matches!(
                k.as_str(),
                "id" | "label"
                    | "title"
                    | "content_format"
                    | "created_at"
                    | "plain_bytes"
                    | "locked_body"
            )
        })
    }) {
        return Err(EngineError::invalid("unknown encrypted version field"));
    }
    let bytes = v["plain_bytes"]
        .as_u64()
        .ok_or_else(|| EngineError::invalid("missing encrypted version size"))?;
    v["label"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.chars().count() <= 120)
        .ok_or_else(|| EngineError::invalid("invalid encrypted version name"))?;
    v["title"]
        .as_str()
        .filter(|s| s.chars().count() <= crate::limits::MAX_TITLE_CHARS)
        .ok_or_else(|| EngineError::invalid("invalid encrypted version title"))?;
    let body = crate::vault::LockedBody::deserialize(&v["locked_body"])?;
    crate::vault::validate(&body)?;
    crate::source_format::from_value(v.get("content_format"))?;
    crate::model::opt_timestamp(v, "created_at")?
        .ok_or_else(|| EngineError::invalid("missing version time"))?;
    Ok(bytes)
}

/// Metadata of one note's encrypted snapshots without their ciphertext,
/// in [`rows`] order. Ciphertext is not read into memory.
pub fn listing(c: &Connection, note: &str) -> Result<Value> {
    let mut q = c.prepare(
        "SELECT id,json_remove(data,'$.locked_body') FROM encrypted_named_versions WHERE note_id=?1 ORDER BY id",
    )?;
    let values = q
        .query_map([note], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut out = Vec::with_capacity(values.len());
    for (id, data) in values {
        let mut v: Value = serde_json::from_str(&data)?;
        v["id"] = json!(id);
        out.push(v);
    }
    Ok(json!(out))
}

/// One encrypted snapshot of `note` as [`rows`] returns it.
pub fn row(c: &Connection, note: &str, id: &str) -> Result<Option<Value>> {
    let data: Option<String> = c
        .query_row(
            "SELECT data FROM encrypted_named_versions WHERE id=?1 AND note_id=?2",
            params![id, note],
            |r| r.get(0),
        )
        .optional()?;
    data.map(|data| {
        let mut v: Value = serde_json::from_str(&data)?;
        v["id"] = json!(id);
        Ok(v)
    })
    .transpose()
}

/// Ids of one note's encrypted snapshots in [`rows`] order.
pub fn version_ids(c: &Connection, note: &str) -> Result<Vec<String>> {
    let mut q = c.prepare("SELECT id FROM encrypted_named_versions WHERE note_id=?1 ORDER BY id")?;
    let ids = q
        .query_map([note], |r| r.get(0))?
        .collect::<std::result::Result<Vec<String>, _>>()?;
    Ok(ids)
}

/// Add or change one snapshot of `note` (same identity), leaving the note's
/// other snapshots untouched. Same checks and result as [`replace`] with the
/// note's current rows plus this one, without reading the other ciphertexts.
/// Caller owns the transaction: on error nothing must be committed.
pub fn upsert(c: &Connection, note: &str, value: &Value) -> Result<()> {
    put(c, note, value)?;
    check_totals(c, note)
}

/// [`upsert`] without the per-note totals; the caller runs [`check_totals`]
/// once after its last row, in the same transaction.
pub fn put(c: &Connection, note: &str, value: &Value) -> Result<()> {
    validate_row(value)?;
    let id = value["id"]
        .as_str()
        .filter(|id| ids::valid_id(id))
        .ok_or_else(|| EngineError::invalid("invalid version id"))?;
    let stored: Option<(String, String)> = c
        .query_row(
            "SELECT note_id,data FROM encrypted_named_versions WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match stored {
        Some((owner, _)) if owner != note => {
            return Err(EngineError::invalid("encrypted version belongs to another note"));
        }
        Some((_, data)) => {
            if &serde_json::from_str::<Value>(&data)? != value {
                c.execute(
                    "UPDATE encrypted_named_versions SET data=?1 WHERE id=?2 AND note_id=?3",
                    params![serde_json::to_string(value)?, id, note],
                )?;
            }
        }
        None => {
            c.execute(
                "INSERT INTO encrypted_named_versions(id,note_id,data) VALUES(?1,?2,?3)",
                params![id, note, serde_json::to_string(value)?],
            )?;
        }
    }
    Ok(())
}

/// Per-note limits over the stored rows (what [`replace`] checks over its
/// input): 100 snapshots, 64 MiB declared plaintext, 96 MiB serialized.
pub fn check_totals(c: &Connection, note: &str) -> Result<()> {
    let (count, plain, stored): (i64, i64, i64) = c.query_row(
        "SELECT count(*),coalesce(sum(json_extract(data,'$.plain_bytes')),0),coalesce(sum(octet_length(data)),0) FROM encrypted_named_versions WHERE note_id=?1",
        [note],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if count as usize > MAX_ROWS {
        return Err(EngineError::invalid("invalid encrypted versions"));
    }
    if plain as u64 > MAX_PLAIN_BYTES {
        return Err(EngineError::invalid("named versions exceed 64 MiB"));
    }
    // JSON array of the rows: brackets plus a comma between rows.
    if (stored + count + 1) as u64 > MAX_SERIALIZED_BYTES {
        return Err(EngineError::invalid("encrypted versions too large"));
    }
    Ok(())
}

pub fn replace(c: &Connection, note: &str, data: &Value, fresh_ids: bool) -> Result<()> {
    let values = data
        .as_array()
        .filter(|v| v.len() <= MAX_ROWS)
        .ok_or_else(|| EngineError::invalid("invalid encrypted versions"))?;
    if serde_json::to_vec(data)?.len() as u64 > MAX_SERIALIZED_BYTES {
        return Err(EngineError::invalid("encrypted versions too large"));
    }
    let mut bytes = 0u64;
    for v in values {
        bytes = bytes.saturating_add(validate_row(v)?);
        if bytes > MAX_PLAIN_BYTES {
            return Err(EngineError::invalid("named versions exceed 64 MiB"));
        }
    }
    if fresh_ids {
        // Backup import into a new note: every row gets a new identity.
        c.execute(
            "DELETE FROM encrypted_named_versions WHERE note_id=?1",
            [note],
        )?;
        for value in values {
            c.execute(
                "INSERT INTO encrypted_named_versions(id,note_id,data) VALUES(?1,?2,?3)",
                params![ids::new_id(), note, serde_json::to_string(value)?],
            )?;
        }
        return Ok(());
    }
    // Same identities: touch only rows that actually changed, so journal
    // triggers (and peers) see one change per renamed/added/removed version
    // instead of a delete+reinsert of every snapshot of the note.
    let mut wanted = std::collections::BTreeMap::new();
    for value in values {
        let id = value["id"]
            .as_str()
            .filter(|id| ids::valid_id(id))
            .ok_or_else(|| EngineError::invalid("invalid version id"))?;
        if wanted.insert(id.to_string(), value).is_some() {
            return Err(EngineError::invalid("duplicate encrypted version id"));
        }
    }
    let current: Vec<(String, String, String)> = {
        let mut q = c.prepare(
            "SELECT id,note_id,data FROM encrypted_named_versions WHERE note_id=?1 OR id IN (SELECT value FROM json_each(?2))",
        )?;
        let id_list = serde_json::to_string(&wanted.keys().collect::<Vec<_>>())?;
        let rows = q
            .query_map(params![note, id_list], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    for (id, owner, _) in &current {
        if owner != note && wanted.contains_key(id) {
            return Err(EngineError::invalid("encrypted version belongs to another note"));
        }
        if owner == note && !wanted.contains_key(id) {
            c.execute("DELETE FROM encrypted_named_versions WHERE id=?1", [id])?;
        }
    }
    for (id, value) in wanted {
        let stored = current
            .iter()
            .find(|(cid, owner, _)| *cid == id && owner == note)
            .map(|(_, _, data)| serde_json::from_str::<Value>(data))
            .transpose()?;
        match stored {
            Some(old) if &old == value => {}
            Some(_) => {
                c.execute(
                    "UPDATE encrypted_named_versions SET data=?1 WHERE id=?2 AND note_id=?3",
                    params![serde_json::to_string(value)?, id, note],
                )?;
            }
            None => {
                c.execute(
                    "INSERT INTO encrypted_named_versions(id,note_id,data) VALUES(?1,?2,?3)",
                    params![id, note, serde_json::to_string(value)?],
                )?;
            }
        }
    }
    Ok(())
}
