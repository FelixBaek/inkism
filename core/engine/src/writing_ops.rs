//! Atomic writing operations that span more than one note.
//!
//! A merge is deliberately one SQLite transaction: both revisions are
//! checked under the same write lock, the target is saved with normal history
//! and indexing, the source is trashed with normal patch history, and a
//! redirect/alias decision is recorded before commit.

use crate::error::{EngineError, Result};
use crate::ids;
use crate::knowledge;
use crate::model::{PatchInput, SaveInput};
use crate::ops_notes;
use crate::settings;
use rusqlite::Connection;
use serde_json::{json, Value};

fn id(args: &Value, key: &str) -> Result<String> {
    let value = args.get(key).and_then(Value::as_str).filter(|s| crate::ids::valid_id(s));
    value.map(str::to_owned).ok_or_else(|| EngineError::invalid(format!("missing or invalid {key}")))
}

fn html_title(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Read identities without changing a single source byte. HTML parsing decodes
/// attribute entities and ignores tag-shaped comment/raw-text contents.
fn block_ids(source: &str, format: &str) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    if format == "html" {
        let html = scraper::Html::parse_fragment(source);
        for node in html.tree.nodes() {
            if let Some(element) = node.value().as_element() {
                if let Some(id) = element.attr("id").filter(|id| !id.is_empty()) { out.insert(id.to_owned()); }
            }
        }
    } else if format == "markdown" {
        let mut fence: Option<(u8,usize)> = None;
        for line in source.lines() {
            let candidate = line.trim_end();
            let trimmed = candidate.trim_start_matches(' ');
            let indent = candidate.len()-trimmed.len();
            let marker = trimmed.as_bytes().first().copied();
            let length = marker.map_or(0,|m|trimmed.bytes().take_while(|b|*b==m).count());
            if indent<=3 && matches!(marker,Some(b'`'|b'~')) && length>=3 {
                if let Some((open,n))=fence {
                    if marker==Some(open) && length>=n && trimmed[length..].trim().is_empty() {fence=None;}
                } else {fence=Some((marker.unwrap(),length));}
                continue;
            }
            if fence.is_some() || indent>=4 || candidate.starts_with('\t') {continue;}
            if let Some(id)=candidate.split_whitespace().last().and_then(|word|word.strip_prefix('^')) {
                if !id.is_empty() && id.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'_'|b'-')) {out.insert(id.to_owned());}
            }
        }
    }
    out
}
fn check_identity_collisions(source:&str,target:&str,separator:&str,format:&str)->Result<()> {
    let mut existing=block_ids(target,format);
    for section in [separator,source] {
        for id in block_ids(section,format) {
            if !existing.insert(id.clone()) {
                return Err(EngineError::invalid(format!("duplicate block ID {:?}: rename the duplicate block ID before merging",id.chars().take(120).collect::<String>())));
            }
        }
    }
    Ok(())
}

/// Merge `source_id` into `target_id` with optimistic guards.
///
/// The caller supplies both current revisions. The source is never physically
/// deleted. Its title becomes an alias and its ID gets a redirect record so
/// old explicit links can be resolved only after the user confirms the merge.
pub fn merge(conn: &Connection, args: &Value) -> Result<Value> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result=merge_tx(conn,args);
    match result { Ok(value)=>{conn.execute_batch("COMMIT;")?;Ok(value)},Err(error)=>{let _=conn.execute_batch("ROLLBACK;");Err(error)} }
}

pub(crate) fn merge_tx(conn: &Connection,args: &Value)->Result<Value>{
    let source_id = id(args, "source_id")?;
    let target_id = id(args, "target_id")?;
    if source_id == target_id { return Err(EngineError::invalid("source and target must differ")); }
    let source_revision = args.get("source_revision").and_then(Value::as_i64).ok_or_else(|| EngineError::invalid("missing source_revision"))?;
    let target_revision = args.get("target_revision").and_then(Value::as_i64).ok_or_else(|| EngineError::invalid("missing target_revision"))?;
    if source_revision < 0 || target_revision < 0 { return Err(EngineError::invalid("invalid revision")); }

        let source = ops_notes::load_note(conn, &source_id)?.ok_or_else(|| EngineError::NotFound(format!("note {source_id}")))?;
        let target = ops_notes::load_note(conn, &target_id)?.ok_or_else(|| EngineError::NotFound(format!("note {target_id}")))?;
        for (note, expected, role) in [(&source, source_revision, "source"), (&target, target_revision, "target")] {
            if note.revision != expected { return Err(EngineError::Conflict(format!("{role} revision changed"))); }
            if note.trashed { return Err(EngineError::Conflict(format!("{role} is trashed"))); }
            if note.locked { return Err(EngineError::Conflict(format!("{role} is locked"))); }
            if note.readonly { return Err(EngineError::Conflict(format!("{role} is read-only"))); }
        }
        if source.content_format != target.content_format { return Err(EngineError::invalid("content formats must match")); }
        let separator = args.get("separator").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| {
            if matches!(target.content_format.as_str(), "markdown" | "text") {
                format!("\n\n---\n\n## {}\n\n", source.title.replace(['\r','\n','#'], " ").trim())
            } else {
                format!("<hr data-inkism-merge=\"{}\"><h2>{}</h2>", source.id, html_title(source.title.trim()))
            }
        });
        check_identity_collisions(&source.content,&target.content,&separator,&source.content_format)?;
        let content = format!("{}{}{}", target.content, separator, source.content);
        let text = format!("{}\n\n{}", target.text, source.text);
        let input = SaveInput { id: Some(target.id.clone()), title: Some(target.title.clone()), content: Some(content), text: Some(text), content_format: Some(target.content_format.clone()), revision: Some(target.revision), readonly: None, notebook_id: None, notebook_ids: None, tags: None, reminder_at: None, reminder_repeat_hours: None };
        ops_notes::validate_save(&input)?;
        let updated_target = ops_notes::save_tx(conn, input)?;
        let trash = PatchInput { trashed: Some(true), readonly: None, title: None, favorite: None, pinned: None, archived: None, color: None, notebook_id: None, notebook_ids: None, tags: None, reminder_at: None, reminder_repeat_hours: None };
        let trashed_source = ops_notes::apply_patch(conn, &source.id, &trash, Some(source.revision), false)?;
        // Alias and redirect are committed with the note updates. Existing
        // links are therefore recoverable, while restore can remove the
        // redirect in its own guarded transaction.
        let target_key = format!("knowledge_note:{}", target.id);
        let aliases = conn.query_row("SELECT value FROM settings WHERE key=?1", [&target_key], |r| r.get::<_, Option<String>>(0)).ok().flatten().and_then(|raw| serde_json::from_str::<Value>(&raw).ok()).unwrap_or_else(|| json!({"aliases":[],"properties":[]}));
        let mut meta = aliases;
        meta.as_object_mut().map(|object| { object.remove("version"); });
        let list = meta.get_mut("aliases").and_then(Value::as_array_mut).ok_or_else(|| EngineError::internal("invalid target knowledge"))?;
        if !source.title.trim().is_empty() && !list.iter().any(|v| v.as_str().is_some_and(|s| s.eq_ignore_ascii_case(source.title.trim()))) { list.push(json!(source.title.trim())); }
        knowledge::validate_note(&meta)?;
        settings::write_local(conn, &target_key, Some(&meta.to_string()))?;
        let redirect = json!({"target_id":target.id,"source_revision":source.revision,"created_at":ids::now_ms()});
        if args.get("redirect").and_then(Value::as_bool).unwrap_or(true) {
            settings::write_local(conn, &format!("knowledge_redirect:{}", source.id), Some(&redirect.to_string()))?;
        }
        Ok(json!({"target":updated_target,"source":trashed_source,"redirect":redirect,"alias":source.title}))
}
