//! Merge redirects are library-relative metadata: backup import must allocate
//! both endpoint IDs before recreating them, never point at the old library.
use crate::{error::{EngineError, Result}, knowledge, settings};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub fn export(conn: &Connection) -> Result<Value> {
    let mut statement = conn.prepare("SELECT s.key,s.value FROM settings s JOIN notes_meta n ON s.key='knowledge_redirect:'||n.id WHERE s.value IS NOT NULL AND n.trashed=1 ORDER BY s.key")?;
    let rows=statement.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?;
    let mut out=Vec::new();
    for row in rows {
        let (key,raw)=row?;settings::validate(&key,Some(&raw))?;
        let value:Value=serde_json::from_str(&raw)?;
        let target=value["target_id"].as_str().unwrap();
        let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM notes_meta WHERE id=?1)",[target],|r|r.get(0))?;
        if exists {out.push(json!({"source_id":key.strip_prefix(knowledge::REDIRECT_PREFIX).unwrap(),"target_id":target,"source_revision":value["source_revision"]}));}
    }
    Ok(json!(out))
}
pub fn import(conn:&Connection, incoming:&Value, ids:&HashMap<&str,String>) -> Result<()> {
    let rows=incoming.as_array().ok_or_else(||EngineError::invalid("invalid merge redirects"))?;
    if rows.len()>ids.len(){return Err(EngineError::invalid("too many merge redirects"));}
    let mut seen=HashSet::new();
    for row in rows {
        let source=row["source_id"].as_str().ok_or_else(||EngineError::invalid("missing redirect source"))?;
        let target=row["target_id"].as_str().ok_or_else(||EngineError::invalid("missing redirect target"))?;
        if !seen.insert(source) {return Err(EngineError::invalid("duplicate redirect source"));}
        settings::validate(&format!("{}{source}",knowledge::REDIRECT_PREFIX),Some(&row.to_string()))?;
        let source=ids.get(source).ok_or_else(||EngineError::invalid("redirect source absent from backup"))?;
        let target=ids.get(target).ok_or_else(||EngineError::invalid("redirect target absent from backup"))?;
        let value=json!({"target_id":target,"source_revision":row["source_revision"]});
        settings::write_local(conn,&format!("{}{source}",knowledge::REDIRECT_PREFIX),Some(&value.to_string()))?;
    }
    Ok(())
}
