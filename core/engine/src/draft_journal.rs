//! Crash draft journal: the durable last-resort copy of UNSAVED editor input.
//!
//! The frontend mirrors the open editor as a "draft" via
//! {op:"draft_journal_put"}. ONE row per note id and editor slot is kept in the main DB
//! (`draft_journal`); the row deliberately has NO foreign key to
//! `notes_meta`, so deleting or trashing the original never destroys the
//! crash copy. The save path is untouched — when a save commits, the
//! frontend acknowledges with {op:"draft_journal_clear", id, token} using
//! the token from its put. The clear matches the CURRENT token only, so a
//! late save acknowledgement can never delete a newer draft.
//!
//! [`recover_pending`] runs in `Engine::open_with_key` after schema init and
//! before the index worker starts. Each row is replayed inside its own
//! BEGIN IMMEDIATE transaction, reusing the ordinary save internals:
//!   * If the original note already carries the exact snapshot body+metadata,
//!     the save had committed and only the clear was lost: the row is
//!     dropped without creating a duplicate.
//!   * Otherwise a SEPARATE note is created with a fresh UUID (title within
//!     the 2000-char limit plus a " (자동 복구)" suffix, exact source format
//!     and metadata, only notebooks that still exist) and the journal row is
//!     deleted in the SAME transaction. The original note is never modified.
//! Any failure rolls the row back and fails `Engine::open` — a crash draft
//! is never silently dropped.
//!
//! Partial drafts ({kind:"partial"}) never ship the whole body to the
//! renderer: the engine stores the exact baseline revision text once (the
//! same lookup `revision_body` serves) and validates edits as sequential
//! UTF-8 byte-range replacements against it. Re-putting the same
//! revision+format reuses the stored baseline, so recovery stays exact after
//! history expiry or deletion of the original. The composed body only ever
//! exists inside the engine.
//!
//! LOCAL-only by construction: export/import read notes/notebooks
//! exclusively and sync never sees this table. Encryption follows the main
//! DB connection boundary (`open_connection_with_key`).

use crate::error::{EngineError, Result};
use crate::ids;
use crate::limits;
use crate::ops_notes::{self, BodySplice};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

/// Whole-journal storage budget. A put that would exceed it is REJECTED —
/// existing crash drafts are never evicted to make room (unlike
/// editor_history), because each row may be the only copy of unsaved work.
pub const DRAFT_JOURNAL_TOTAL_BYTES: usize = 128 * 1024 * 1024;
pub const DRAFT_JOURNAL_MAX_ROWS: usize = 128;

/// Checkpoints may span many 128-edit save batches when normal saves fail.
/// Keep that whole unsaved sequence, bounded independently by bytes and count.
const MAX_DRAFT_EDITS: usize = 16_384;
/// Revisions cross the JS renderer boundary; values beyond
/// Number.MAX_SAFE_INTEGER cannot round-trip and are rejected.
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const DRAFT_FORMAT: &str = "inkism-draft";
const DRAFT_VERSION: i64 = 1;
/// Recovery copies carry this suffix (within the ordinary title limit).
const RECOVERY_SUFFIX: &str = " (자동 복구)";

enum DraftBody {
    Complete { revision: i64, content: String },
    Partial { revision: i64, edits: Vec<Value> },
}

/// {op:"draft_journal_put"} -> {saved:true}. Validates the whole envelope
/// BEFORE opening the write transaction; a rejected put changes nothing.
/// The row is an upsert per note id and editor slot: the newest draft supersedes older
/// snapshots, and its token is the only one a later clear accepts.
pub fn put(conn: &Connection, args: &Value) -> Result<Value> {
    let editor = editor_slot(args)?;
    let token = uuid_field(args, "token")?;
    let draft = args
        .get("draft")
        .ok_or_else(|| EngineError::invalid("missing draft"))?;
    // Accept snapshots produced before the Inkism rename as well.
    if !matches!(
        draft.get("format").and_then(Value::as_str),
        Some(DRAFT_FORMAT | "mindbox-draft")
    ) {
        return Err(EngineError::invalid(
            "draft format must be \"inkism-draft\"",
        ));
    }
    if draft.get("version").and_then(Value::as_i64) != Some(DRAFT_VERSION) {
        return Err(EngineError::invalid("unsupported draft version"));
    }
    let note = draft
        .get("note")
        .ok_or_else(|| EngineError::invalid("draft requires note"))?;
    let id = id_value(&note["id"], "id")?;
    // Crash drafts are plaintext; a locked note's edits stay in the vault.
    if crate::vault::is_locked(conn, &id)? {
        return Err(EngineError::Conflict("잠긴 노트는 복구 초안을 남기지 않습니다".into()));
    }
    let title = note
        .get("title")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("draft note requires title"))?;
    if title.chars().count() > limits::MAX_TITLE_CHARS {
        return Err(EngineError::invalid("title too long"));
    }
    let notebook_id = match note.get("notebook_id") {
        None | Some(Value::Null) => None,
        Some(value) => Some(id_value(value, "notebook_id")?),
    };
    let notebook_ids = crate::notebook_membership::parse_ids(note)?;
    if let Some(values) = &notebook_ids { crate::notebook_membership::validate_ids(values)?; }
    let tags: Vec<String> = serde_json::from_value(
        note.get("tags")
            .cloned()
            .ok_or_else(|| EngineError::invalid("draft note requires tags"))?,
    )
    .map_err(|_| EngineError::invalid("tags must be an array of strings"))?;
    ops_notes::check_tags(&tags)?;
    let content_format = note
        .get("content_format")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("draft note requires content_format"))?;
    crate::source_format::validate(content_format)?;
    let body = parse_body(
        draft
            .get("body")
            .ok_or_else(|| EngineError::invalid("draft requires body"))?,
    )?;

    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = put_tx(
        conn,
        &id,
        editor,
        &token,
        title,
        notebook_id.as_deref(),
        notebook_ids,
        &tags,
        content_format,
        body,
    );
    ops_notes::finish_tx(conn, result)
}

fn parse_body(body: &Value) -> Result<DraftBody> {
    let kind = body
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("draft body requires kind"))?;
    match kind {
        "complete" => {
            let revision = safe_revision(body.get("revision"), 0)?;
            let content = body
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(|| EngineError::invalid("complete draft requires content"))?;
            ops_notes::check_field_size("content", content)?;
            Ok(DraftBody::Complete {
                revision,
                content: content.to_string(),
            })
        }
        "partial" => {
            let revision = safe_revision(body.get("revision"), 1)?;
            if body.get("offset_encoding").and_then(Value::as_str) != Some("utf-8") {
                return Err(EngineError::invalid(
                    "partial draft requires utf-8 offset_encoding",
                ));
            }
            if body.get("edit_order").and_then(Value::as_str) != Some("sequential") {
                return Err(EngineError::invalid(
                    "partial draft requires sequential edit_order",
                ));
            }
            let edits = body
                .get("edits")
                .and_then(Value::as_array)
                .ok_or_else(|| EngineError::invalid("partial draft requires edits"))?;
            if edits.len() > MAX_DRAFT_EDITS {
                return Err(EngineError::invalid(format!(
                    "too many edits (max {MAX_DRAFT_EDITS})"
                )));
            }
            // Parse every edit now so malformed entries fail before any
            // transaction or baseline lookup happens.
            for edit in edits {
                let _: BodySplice = serde_json::from_value(edit.clone())
                    .map_err(|e| EngineError::invalid(format!("bad edit: {e}")))?;
            }
            Ok(DraftBody::Partial {
                revision,
                edits: edits.clone(),
            })
        }
        other => Err(EngineError::invalid(format!(
            "unknown draft body kind: {other}"
        ))),
    }
}

fn put_tx(
    conn: &Connection,
    id: &str,
    editor: &str,
    token: &str,
    title: &str,
    notebook_id: Option<&str>,
    notebook_ids: Option<Vec<String>>,
    tags: &[String],
    content_format: &str,
    body: DraftBody,
) -> Result<Value> {
    let notebook_ids = match notebook_ids {
        Some(values) => values,
        None => legacy_draft_notebooks(conn, id, editor, notebook_id)?,
    };
    let notebooks_json = serde_json::to_string(&notebook_ids)?;
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM draft_journal WHERE id=?1 AND editor=?2)",
        params![id, editor],
        |r| r.get(0),
    )?;
    if !exists
        && conn.query_row("SELECT count(*) FROM draft_journal", [], |r| {
            r.get::<_, i64>(0)
        })? >= DRAFT_JOURNAL_MAX_ROWS as i64
    {
        return Err(EngineError::invalid(
            "draft journal exceeds 128 pending notes",
        ));
    }
    let (body_kind, revision, baseline, edits_json, content) = match body {
        DraftBody::Complete { revision, content } => {
            ("complete", revision, None, None, Some(content))
        }
        DraftBody::Partial { revision, edits } => {
            // The baseline is the exact stored revision text. The same
            // revision+format re-put reuses the journal baseline, so puts and
            // recovery stay exact after history expiry or deletion of the
            // original note.
            let stored: Option<(String, i64, Option<String>)> = conn
                .query_row(
                    "SELECT content_format, revision, baseline FROM draft_journal WHERE id = ?1 AND editor=?2",
                    params![id,editor],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let baseline = match stored {
                Some((format, stored_revision, Some(baseline)))
                    if stored_revision == revision && format == content_format =>
                {
                    baseline
                }
                _ => {
                    let fetched =
                        ops_notes::revision_body(conn, &json!({ "id": id, "revision": revision }))?;
                    if fetched["content_format"].as_str() != Some(content_format) {
                        return Err(EngineError::invalid(
                            "draft content_format differs from the stored baseline revision",
                        ));
                    }
                    fetched["content"]
                        .as_str()
                        .ok_or_else(|| EngineError::internal("baseline content missing"))?
                        .to_string()
                }
            };
            // Sequential exact validation: every offset is a UTF-8 byte
            // boundary, `expected` matches exactly, and every intermediate
            // result stays within the ordinary body limit (this also bounds
            // the final composed body).
            let mut result = baseline.clone();
            for edit in &edits {
                let edit: BodySplice = serde_json::from_value(edit.clone())
                    .map_err(|e| EngineError::invalid(format!("bad edit: {e}")))?;
                edit.validate(&result)?;
                edit.apply(&mut result);
            }
            let edits_json = serde_json::to_string(&Value::Array(edits))?;
            ("partial", revision, Some(baseline), Some(edits_json), None)
        }
    };
    let tags_json = ops_notes::serialize_tags(Some(&tags.to_vec()))?;
    let byte_count = id.len()
        + editor.len()
        + token.len()
        + title.len()
        + notebook_id.map_or(0, str::len)
        + notebooks_json.len()
        + tags_json.len()
        + content_format.len()
        + body_kind.len()
        + baseline.as_ref().map_or(0, String::len)
        + edits_json.as_ref().map_or(0, String::len)
        + content.as_ref().map_or(0, String::len);
    conn.execute(
        "INSERT INTO draft_journal(id, token, title, notebook_id, tags, content_format, \
             body_kind, revision, baseline, edits, content, updated_at, byte_count, editor, notebook_ids) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) \
         ON CONFLICT(id,editor) DO UPDATE SET token = excluded.token, title = excluded.title, \
             notebook_id = excluded.notebook_id, notebook_ids=excluded.notebook_ids, tags = excluded.tags, \
             content_format = excluded.content_format, body_kind = excluded.body_kind, \
             revision = excluded.revision, baseline = excluded.baseline, \
             edits = excluded.edits, content = excluded.content, \
             updated_at = excluded.updated_at, byte_count = excluded.byte_count",
        params![
            id,
            token,
            title,
            notebook_id,
            tags_json,
            content_format,
            body_kind,
            revision,
            baseline,
            edits_json,
            content,
            ids::now_ms(),
            byte_count as i64,
            editor,
            notebooks_json
        ],
    )?;
    let total = total_bytes(conn)?;
    if total as usize > DRAFT_JOURNAL_TOTAL_BYTES {
        return Err(EngineError::invalid(
            "draft journal exceeds the total 128 MiB budget",
        ));
    }
    Ok(json!({ "saved": true }))
}

// Current renderers send only the primary notebook. Snapshot all relationships
// here, applying the same primary-only move/clear contract as normal saves.
fn legacy_draft_notebooks(conn: &Connection, id: &str, editor: &str, next: Option<&str>) -> Result<Vec<String>> {
    let saved: Option<Option<String>> = conn.query_row("SELECT notebook_id FROM notes_meta WHERE id=?1", [id], |row|row.get(0)).optional()?;
    let (previous, mut values) = if let Some(previous) = saved {
        (previous, crate::notebook_membership::load(conn, id)?)
    } else {
        let pending: Option<(Option<String>,Option<String>)> = conn.query_row(
            "SELECT notebook_id,notebook_ids FROM draft_journal WHERE id=?1 AND editor=?2", params![id,editor],
            |row|Ok((row.get(0)?,row.get(1)?)),
        ).optional()?;
        match pending {
            Some((previous,Some(encoded))) => (previous,serde_json::from_str(&encoded)?),
            Some((previous,None)) => (previous.clone(),previous.into_iter().collect()),
            None => (None,Vec::new()),
        }
    };
    if let Some(next) = next {
        values.retain(|id|id!=next && (previous.as_deref()==Some(next) || Some(id.as_str())!=previous.as_deref()));
        values.insert(0,next.to_string());
    } else { values.clear(); }
    crate::notebook_membership::validate_ids(&values)?;
    Ok(values)
}

/// {op:"draft_journal_clear", id, token} -> {cleared:boolean}. Only the row
/// whose token matches the CURRENT put is removed: a save acknowledgement
/// that was in flight while a newer draft was put cannot delete it.
pub fn clear(conn: &Connection, args: &Value) -> Result<Value> {
    let editor = editor_slot(args)?;
    let id = id_value(&args["id"], "id")?;
    let token = uuid_field(args, "token")?;
    let cleared = conn.execute(
        "DELETE FROM draft_journal WHERE id = ?1 AND token = ?2 AND editor=?3",
        params![id, token, editor],
    )? > 0;
    Ok(json!({ "cleared": cleared }))
}

/// {op:"draft_journal_status"} -> {pending:count}. Metadata only; bodies are
/// never returned over the protocol.
pub fn status(conn: &Connection) -> Result<Value> {
    let pending: i64 = conn.query_row("SELECT COUNT(*) FROM draft_journal", [], |r| r.get(0))?;
    Ok(json!({ "pending": pending }))
}

/// Byte size of every stored row (metadata + body columns).
fn total_bytes(conn: &Connection) -> Result<i64> {
    let total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(byte_count),0) FROM draft_journal",
        [],
        |r| r.get(0),
    )?;
    Ok(total)
}

struct PendingDraft {
    id: String,
    editor: String,
    title: String,
    notebook_id: Option<String>,
    notebook_ids: Option<String>,
    tags: String,
    content_format: String,
    body_kind: String,
    baseline: Option<String>,
    edits: Option<String>,
    content: Option<String>,
}

/// Replay every pending draft after reopen. Per-row BEGIN IMMEDIATE: a
/// failing row is rolled back and fails the open (journal + original
/// preserved), while already recovered rows stay recovered.
pub(crate) fn recover_pending(conn: &Connection) -> Result<()> {
    // Read only ids first; do not load every large baseline into memory at once.
    let mut stmt =
        conn.prepare("SELECT id, editor FROM draft_journal ORDER BY updated_at, rowid")?;
    let ids = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    for (id, editor) in &ids {
        conn.execute_batch("BEGIN IMMEDIATE;")?;
        let result = (|| -> Result<Value> {
            let row=conn.query_row("SELECT id, title, notebook_id, tags, content_format, body_kind, baseline, edits, content, notebook_ids FROM draft_journal WHERE id=?1 AND editor=?2",params![id,editor],|r|Ok(PendingDraft {
                id: r.get(0)?,
                editor:editor.clone(),
                title: r.get(1)?,
                notebook_id: r.get(2)?,
                notebook_ids: r.get(9)?,
                tags: r.get(3)?,
                content_format: r.get(4)?,
                body_kind: r.get(5)?,
                baseline: r.get(6)?,
                edits: r.get(7)?,
                content: r.get(8)?,
            })).optional()?;
            if let Some(row) = row {
                recover_row(conn, &row)?;
            }
            Ok(Value::Null)
        })();
        ops_notes::finish_tx(conn, result)?;
    }
    Ok(())
}

fn recover_row(conn: &Connection, row: &PendingDraft) -> Result<()> {
    let content = compose_body(row)?;
    let tags: Vec<String> = serde_json::from_str(&row.tags)?;
    // Only notebooks that still exist are attached; a deleted notebook
    // resolves to no notebook (delete_notebook detaches its notes too).
    let memberships: Vec<String> = match &row.notebook_ids {
        Some(encoded) => serde_json::from_str(encoded)?,
        None => row.notebook_id.clone().into_iter().collect(),
    };
    crate::notebook_membership::validate_ids(&memberships)?;
    let mut notebook_ids = Vec::new();
    for notebook in memberships {
        if notebook_exists(conn, &notebook)? { notebook_ids.push(notebook); }
    }
    let notebook_id = notebook_ids.first().cloned();
    if let Some(current) = ops_notes::load_note(conn, &row.id)? {
        let same_tags = ops_notes::serialize_tags(Some(&tags))?
            == ops_notes::serialize_tags(Some(&current.tags))?;
        if current.title == row.title
            && current.content == content
            && current.content_format == row.content_format
            && current.notebook_id == notebook_id
            && current.notebook_ids == notebook_ids
            && same_tags
        {
            // The save committed; only the clear was lost. Drop the stale
            // row instead of duplicating the note.
            conn.execute(
                "DELETE FROM draft_journal WHERE id = ?1 AND editor=?2",
                params![row.id, row.editor],
            )?;
            return Ok(());
        }
    }
    // Never touch the original: create a separate recovery copy and delete
    // the journal row in this one transaction.
    // Explicit source saves retain source in the text field; the existing
    // background index worker derives searchable text. Recovery must not parse
    // every large HTML body before the runtime can answer its startup health.
    let text = content.clone();
    let input = crate::model::SaveInput {
        readonly: None, // A recovered draft is a new, editable note.
        content_format: Some(row.content_format.clone()),
        id: None, // fresh UUID
        title: Some(recovery_title(&row.title, &row.editor)),
        content: Some(content),
        text: Some(text),
        notebook_id: Some(notebook_id),
        notebook_ids: Some(notebook_ids),
        tags: Some(tags),
        reminder_at: None,
        reminder_repeat_hours: None,
        revision: None,
    };
    ops_notes::validate_save(&input)?;
    ops_notes::save_tx(conn, input)?;
    conn.execute(
        "DELETE FROM draft_journal WHERE id = ?1 AND editor=?2",
        params![row.id, row.editor],
    )?;
    Ok(())
}

/// Compose the draft's target body. Partial rows replay their validated
/// edits over the stored baseline; re-validating here keeps a tampered or
/// truncated row from ever becoming a corrupt note (it fails the open).
fn compose_body(row: &PendingDraft) -> Result<String> {
    match row.body_kind.as_str() {
        "complete" => row
            .content
            .clone()
            .ok_or_else(|| EngineError::internal("complete draft missing content")),
        "partial" => {
            let baseline = row
                .baseline
                .as_deref()
                .ok_or_else(|| EngineError::internal("partial draft missing baseline"))?;
            let stored = row
                .edits
                .as_deref()
                .ok_or_else(|| EngineError::internal("partial draft missing edits"))?;
            let edits: Value = serde_json::from_str(stored)?;
            let edits = edits
                .as_array()
                .ok_or_else(|| EngineError::internal("stored edits must be an array"))?;
            let mut result = baseline.to_string();
            for edit in edits {
                let edit: BodySplice = serde_json::from_value(edit.clone())
                    .map_err(|e| EngineError::internal(format!("stored edit invalid: {e}")))?;
                edit.validate(&result)?;
                edit.apply(&mut result);
            }
            Ok(result)
        }
        other => Err(EngineError::internal(format!(
            "unknown draft body kind: {other}"
        ))),
    }
}

fn notebook_exists(conn: &Connection, id: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notebooks WHERE id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

/// Keep the copy's title inside the ordinary limit even with the suffix.
fn recovery_title(title: &str, editor: &str) -> String {
    let suffix = if editor == "split" {
        " (분할 자동 복구)"
    } else {
        RECOVERY_SUFFIX
    };
    let budget = limits::MAX_TITLE_CHARS.saturating_sub(suffix.chars().count());
    let mut out: String = title.chars().take(budget).collect();
    out.push_str(suffix);
    out
}

fn safe_revision(value: Option<&Value>, min: i64) -> Result<i64> {
    let revision = value
        .and_then(Value::as_i64)
        .ok_or_else(|| EngineError::invalid("draft revision must be an integer"))?;
    if revision < min || revision > MAX_SAFE_INTEGER {
        return Err(EngineError::invalid(format!(
            "draft revision out of range ({min}..={MAX_SAFE_INTEGER})"
        )));
    }
    Ok(revision)
}

fn uuid_field(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .ok_or_else(|| EngineError::invalid(format!("missing {key}")))
        .and_then(|v| uuid_value(v, key))
}

fn editor_slot(args: &Value) -> Result<&str> {
    match args.get("editor") {
        None => Ok("main"),
        Some(Value::String(editor)) if ["main", "split"].contains(&editor.as_str()) => Ok(editor),
        _ => Err(EngineError::invalid("bad draft editor")),
    }
}

// Imported and synced libraries can carry any ordinary engine-safe id.
// Preserve case and spelling exactly; only checkpoint tokens require UUIDs.
fn id_value(value: &Value, key: &str) -> Result<String> {
    value
        .as_str()
        .filter(|id| ids::valid_id(id))
        .map(str::to_owned)
        .ok_or_else(|| EngineError::invalid(format!("bad {key}")))
}

fn uuid_value(value: &Value, key: &str) -> Result<String> {
    let text = value
        .as_str()
        .ok_or_else(|| EngineError::invalid(format!("{key} must be a UUID string")))?;
    uuid::Uuid::parse_str(text)
        .map(|parsed| parsed.to_string())
        .map_err(|_| EngineError::invalid(format!("bad {key} UUID")))
}
