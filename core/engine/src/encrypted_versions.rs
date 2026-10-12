//! Local encrypted snapshots. Keys and plaintext are owned by the runtime.
use crate::{
    error::{EngineError, Result},
    ids,
};
use rusqlite::{params, Connection};
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
pub fn digest(value: &Value) -> Result<String> {
    use sha2::{Digest, Sha256};
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
pub fn replace(c: &Connection, note: &str, data: &Value, fresh_ids: bool) -> Result<()> {
    let values = data
        .as_array()
        .filter(|v| v.len() <= 100)
        .ok_or_else(|| EngineError::invalid("invalid encrypted versions"))?;
    if serde_json::to_vec(data)?.len() > 96 * 1024 * 1024 {
        return Err(EngineError::invalid("encrypted versions too large"));
    }
    let mut bytes = 0u64;
    for v in values {
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
        bytes = bytes.saturating_add(
            v["plain_bytes"]
                .as_u64()
                .ok_or_else(|| EngineError::invalid("missing encrypted version size"))?,
        );
        if bytes > 64 * 1024 * 1024 {
            return Err(EngineError::invalid("named versions exceed 64 MiB"));
        }
        let label = v["label"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.chars().count() <= 120)
            .ok_or_else(|| EngineError::invalid("invalid encrypted version name"))?;
        let title = v["title"]
            .as_str()
            .filter(|s| s.chars().count() <= crate::limits::MAX_TITLE_CHARS)
            .ok_or_else(|| EngineError::invalid("invalid encrypted version title"))?;
        let body: crate::vault::LockedBody = serde_json::from_value(v["locked_body"].clone())?;
        crate::vault::validate(&body)?;
        crate::source_format::from_value(v.get("content_format"))?;
        crate::model::opt_timestamp(v, "created_at")?
            .ok_or_else(|| EngineError::invalid("missing version time"))?;
        let _ = (label, title);
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
