//! Device-local, library-scoped collaboration checkpoints. Never stores tokens.
use crate::error::{EngineError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
fn ensure(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS collaboration_bindings(publication_id TEXT NOT NULL,page_id TEXT NOT NULL,value TEXT,version INTEGER NOT NULL,PRIMARY KEY(publication_id,page_id));")?;
    Ok(())
}
fn key(args: &Value) -> Result<(&str, &str)> {
    let publication = args["publication_id"]
        .as_str()
        .filter(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .ok_or_else(|| EngineError::invalid("invalid publication"))?;
    let page = args["page_id"].as_str().unwrap_or("");
    if page.len() > 128 || (!page.is_empty() && !crate::ids::valid_id(page)) {
        return Err(EngineError::invalid("invalid page"));
    }
    Ok((publication, page))
}
pub fn get(conn: &Connection, args: &Value) -> Result<Value> {
    ensure(conn)?;
    let (publication, page) = key(args)?;
    let row:Option<(Option<String>,i64)>=conn.query_row("SELECT value,version FROM collaboration_bindings WHERE publication_id=?1 AND page_id=?2",params![publication,page],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let (value, version) = row.unwrap_or((None, 0));
    Ok(
        json!({"binding":value.map(|v|serde_json::from_str::<Value>(&v)).transpose()?,"updated_at":version}),
    )
}
pub fn set(conn: &Connection, args: &Value) -> Result<Value> {
    ensure(conn)?;
    let (publication, page) = key(args)?;
    let binding = &args["binding"];
    if !binding.is_null() {
        if binding.as_object().is_none_or(|o| {
            o.keys()
                .any(|k| !matches!(k.as_str(), "id" | "revision" | "version" | "format"))
        }) {
            return Err(EngineError::invalid("invalid binding fields"));
        }
        if !binding["id"].as_str().is_some_and(crate::ids::valid_id)
            || !binding["revision"].as_i64().is_some_and(|v| v > 0)
            || !binding["version"].as_u64().is_some_and(|v| v > 0)
            || !matches!(
                binding["format"].as_str(),
                Some("html" | "markdown" | "text")
            )
        {
            return Err(EngineError::invalid("invalid binding"));
        }
        if serde_json::to_vec(binding)?.len() > 1024 {
            return Err(EngineError::invalid("binding too large"));
        }
    }
    let expected = args["expected_updated_at"]
        .as_i64()
        .filter(|v| *v >= 0)
        .ok_or_else(|| EngineError::invalid("binding version required"))?;
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        let current = get(conn, args)?;
        if current["updated_at"].as_i64() != Some(expected) {
            return Err(EngineError::Conflict("binding changed; reload".into()));
        }
        let next = expected
            .checked_add(1)
            .ok_or_else(|| EngineError::invalid("binding version exhausted"))?;
        let value = if binding.is_null() {
            None
        } else {
            Some(serde_json::to_string(binding)?)
        };
        conn.execute("INSERT INTO collaboration_bindings(publication_id,page_id,value,version) VALUES(?1,?2,?3,?4) ON CONFLICT(publication_id,page_id) DO UPDATE SET value=excluded.value,version=excluded.version",params![publication,page,value,next])?;
        get(conn, args)
    })();
    match result {
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
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn survives_reopen_and_rejects_stale_checkpoints() {
        let root =
            std::env::temp_dir().join(format!("inkism-bindings-{}.db", uuid::Uuid::new_v4()));
        let c = Connection::open(&root).unwrap();
        let args = json!({"publication_id":"a".repeat(64),"page_id":"child","expected_updated_at":0,"binding":{"id":"source","revision":2,"version":3,"format":"markdown"}});
        assert_eq!(set(&c, &args).unwrap()["updated_at"], 1);
        assert!(set(&c, &args).is_err());
        drop(c);
        let c = Connection::open(&root).unwrap();
        assert_eq!(get(&c, &args).unwrap()["binding"]["revision"], 2);
        let other = json!({"publication_id":"a".repeat(64),"page_id":""});
        assert!(get(&c, &other).unwrap()["binding"].is_null());
        drop(c);
        std::fs::remove_file(root).unwrap();
    }
}
