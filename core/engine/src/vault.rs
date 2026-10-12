//! Per-note vault storage (original `vault.add/open/save/remove`).
//!
//! The engine never sees keys or plaintext of a locked body. The runtime
//! encrypts and passes ciphertext; locking empties every plaintext copy the
//! engine owns (body, preview, history, crash drafts, persisted undo) and lets
//! the index worker rebuild search/blocks from the empty body. Plain editing
//! paths refuse locked notes (`ops_notes::ensure_editable`).
use crate::error::{EngineError, Result};
use crate::ids;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Attachment link inside the ciphertext (`reference`) and the id it now
/// resolves to locally (`id`). Backup restore may renumber `id`; the runtime
/// rewrites `reference` to `id` after decrypting.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentRef {
    pub id: String,
    #[serde(rename = "ref")]
    pub reference: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockedBody {
    pub key_id: String,
    pub ciphertext: String,
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,
}

/// Ciphertext limit: content+text field limits plus JSON/nonce/tag/base64 overhead.
pub fn validate(body: &LockedBody) -> Result<()> {
    let max = (2 * crate::limits::MAX_CONTENT_BYTES + 4096) / 3 * 4 + 1024;
    if !ids::valid_id(&body.key_id)
        || body.ciphertext.is_empty()
        || body.ciphertext.len() > max
        || body.attachments.len() > 10_000
        || body
            .attachments
            .iter()
            .any(|a| !ids::valid_id(&a.id) || !ids::valid_id(&a.reference))
    {
        return Err(EngineError::invalid("invalid locked note body"));
    }
    Ok(())
}

pub fn is_locked(conn: &Connection, id: &str) -> Result<bool> {
    Ok(conn
        .query_row("SELECT locked FROM notes_meta WHERE id=?1", [id], |r| r.get::<_, i64>(0))
        .optional()?
        .is_some_and(|locked| locked != 0))
}

pub fn locked_body(conn: &Connection, id: &str) -> Result<Option<LockedBody>> {
    let row = conn
        .query_row(
            "SELECT key_id,ciphertext,attachments FROM locked_notes WHERE note_id=?1",
            [id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()?;
    row.map(|(key_id, ciphertext, attachments)| {
        Ok(LockedBody {
            key_id,
            ciphertext,
            attachments: serde_json::from_str(&attachments)?,
        })
    })
    .transpose()
}

/// Caller owns the transaction. Stores ciphertext and removes every plaintext
/// copy of the body. Used by local lock, sync receive and backup import.
pub fn store_locked(conn: &Connection, id: &str, body: &LockedBody) -> Result<()> {
    validate(body)?;
    let named:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM history WHERE note_id=?1 AND label IS NOT NULL)",[id],|r|r.get(0))?;
    if named{return Err(EngineError::invalid("named versions must be backed up and removed before locking this note"));}
    conn.execute(
        "INSERT INTO locked_notes(note_id,key_id,ciphertext,attachments) VALUES(?1,?2,?3,?4)
         ON CONFLICT(note_id) DO UPDATE SET key_id=excluded.key_id,ciphertext=excluded.ciphertext,attachments=excluded.attachments",
        params![id, body.key_id, body.ciphertext, serde_json::to_string(&body.attachments)?],
    )?;
    conn.execute("UPDATE notes_meta SET locked=1,preview='' WHERE id=?1", [id])?;
    conn.execute(
        "INSERT INTO notes_body(note_id,content,text) VALUES(?1,'','')
         ON CONFLICT(note_id) DO UPDATE SET content='',text=''",
        [id],
    )?;
    crate::merge_changes::purge_note(conn,id)?;
    conn.execute("DELETE FROM history WHERE note_id=?1", [id])?;
    conn.execute("DELETE FROM draft_journal WHERE id=?1", [id])?;
    conn.execute("DELETE FROM editor_history WHERE note_id=?1", [id])?;
    Ok(())
}

/// Caller owns the transaction. Plaintext returns to the ordinary body row.
pub fn store_unlocked(conn: &Connection, id: &str, content: &str, text: &str, format: &str) -> Result<()> {
    crate::ops_notes::check_field_size("content", content)?;
    crate::ops_notes::check_field_size("text", text)?;
    crate::source_format::validate(format)?;
    conn.execute("DELETE FROM locked_notes WHERE note_id=?1", [id])?;
    conn.execute(
        "INSERT INTO notes_body(note_id,content,text) VALUES(?1,?2,?3)
         ON CONFLICT(note_id) DO UPDATE SET content=excluded.content,text=excluded.text",
        params![id, content, text],
    )?;
    let title: String = conn.query_row("SELECT title FROM notes_meta WHERE id=?1", [id], |r| r.get(0))?;
    conn.execute(
        "UPDATE notes_meta SET locked=0,content_format=?1,preview=?2 WHERE id=?3",
        params![format, crate::model::preview_for(format, text, &title), id],
    )?;
    Ok(())
}

/// One revision-guarded write transaction shared by lock/save/unlock.
fn revise(
    conn: &Connection,
    id: &str,
    revision: i64,
    want_locked: bool,
    write: impl FnOnce() -> Result<()>,
) -> Result<serde_json::Value> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<serde_json::Value> {
        let current = crate::ops_notes::load_summary(conn, id)?;
        if current.revision != revision {
            return Err(EngineError::Conflict("document revision changed".into()));
        }
        if want_locked && current.readonly {
            return Err(EngineError::Conflict(
                "읽기 전용 노트입니다. 읽기 전용을 해제한 뒤 편집하세요".into(),
            ));
        }
        if current.locked != want_locked {
            return Err(EngineError::invalid(if want_locked {
                "note is not locked"
            } else {
                "note is already locked"
            }));
        }
        write()?;
        let next = revision
            .checked_add(1)
            .ok_or_else(|| EngineError::invalid("revision overflow"))?;
        let now = ids::now_ms();
        conn.execute(
            "UPDATE notes_meta SET revision=?1,updated_at=?2,edited_at=?2 WHERE id=?3",
            params![next, now, id],
        )?;
        crate::indexer::enqueue(conn, id, next)?;
        Ok(serde_json::to_value(crate::ops_notes::load_summary(conn, id)?)?)
    })();
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT;")?;
            Ok(value)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

/// Lock the exact `revision` the runtime encrypted. A later edit fails with a
/// conflict instead of being silently lost or left as plaintext.
pub fn lock(conn: &Connection, id: &str, revision: i64, body: &LockedBody) -> Result<serde_json::Value> {
    revise(conn, id, revision, false, || store_locked(conn, id, body))
}

/// Save edited ciphertext (and optionally the plaintext title) of a locked
/// note. `format` mirrors the encrypted format so lists stay accurate.
pub fn save(
    conn: &Connection,
    id: &str,
    revision: i64,
    title: Option<&str>,
    format: &str,
    body: &LockedBody,
) -> Result<serde_json::Value> {
    if title.is_some_and(|t| t.chars().count() > crate::limits::MAX_TITLE_CHARS) {
        return Err(EngineError::invalid("title too long"));
    }
    crate::source_format::validate(format)?;
    revise(conn, id, revision, true, || {
        if let Some(title) = title {
            conn.execute("UPDATE notes_meta SET title=?1 WHERE id=?2", params![title, id])?;
        }
        conn.execute("UPDATE notes_meta SET content_format=?1 WHERE id=?2", params![format, id])?;
        store_locked(conn, id, body)
    })
}

/// Permanently remove a note from the vault with its decrypted body.
pub fn unlock(
    conn: &Connection,
    id: &str,
    revision: i64,
    content: &str,
    text: &str,
    format: &str,
) -> Result<serde_json::Value> {
    revise(conn, id, revision, true, || store_unlocked(conn, id, content, text, format))
}

/// Move named snapshots and current body into encryption in one CAS transaction.
pub fn lock_with_versions(conn:&Connection,id:&str,revision:i64,body:&LockedBody,versions:&serde_json::Value,expected:&str)->Result<serde_json::Value>{
 revise(conn,id,revision,false,||{
  let current=crate::named_versions::backup(conn,id)?;
  if crate::encrypted_versions::digest(&current)?!=expected{return Err(EngineError::Conflict("named versions changed".into()));}
  crate::encrypted_versions::replace(conn,id,versions,false)?;
  conn.execute("DELETE FROM history WHERE note_id=?1 AND label IS NOT NULL",[id])?;
  store_locked(conn,id,body)
 })
}
pub fn unlock_with_versions(conn:&Connection,id:&str,revision:i64,content:&str,text:&str,format:&str,versions:&serde_json::Value,expected:&str)->Result<serde_json::Value>{
 revise(conn,id,revision,true,||{
  if crate::encrypted_versions::digest(&crate::encrypted_versions::rows(conn,id)?)?!=expected{return Err(EngineError::Conflict("encrypted versions changed".into()));}
  store_unlocked(conn,id,content,text,format)?;
  crate::named_versions::import_with_ids(conn,id,versions,&std::collections::HashMap::new(),true)?;
  conn.execute("DELETE FROM encrypted_named_versions WHERE note_id=?1",[id])?;Ok(())
 })
}

pub fn change_encrypted_versions(conn:&Connection,id:&str,revision:i64,versions:&serde_json::Value,expected:&str,restore:Option<(&str,&str,&LockedBody)>)->Result<serde_json::Value>{
 conn.execute_batch("BEGIN IMMEDIATE")?;
 let result=(||{
  let current=crate::ops_notes::load_summary(conn,id)?;
  if !current.locked||current.readonly||current.trashed{return Err(EngineError::invalid("vault note is not editable"));}
  if current.revision!=revision||crate::encrypted_versions::digest(&crate::encrypted_versions::rows(conn,id)?)?!=expected{return Err(EngineError::Conflict("vault note or versions changed".into()));}
  crate::encrypted_versions::replace(conn,id,versions,false)?;
  if let Some((title,format,body))=restore{
   store_locked(conn,id,body)?;
   conn.execute("UPDATE notes_meta SET title=?1,content_format=?2,revision=revision+1,updated_at=?3,edited_at=?3 WHERE id=?4",params![title,format,ids::now_ms(),id])?;
   crate::indexer::enqueue(conn,id,current.revision+1)?;
  }
  Ok(serde_json::to_value(crate::ops_notes::load_summary(conn,id)?)?)
 })();crate::ops_notes::finish_tx(conn,result)
}
