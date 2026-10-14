//! Local semantic index: embedding vectors for chunks of plain note text.
//! The engine chunks text itself so offsets are canonical; the renderer only
//! sends vectors back. Locked/trashed/deleted notes never keep rows (triggers),
//! and rows count only while their revision is the note's current one.
use crate::error::{EngineError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const CHUNK_CHARS: usize = 800;
const OVERLAP_CHARS: usize = 80;
// shortcut: only the first 64 chunks (~46k chars) of a note are embedded; raise with a streaming put if long notes matter.
const MAX_CHUNKS: usize = 64;
const MAX_DIM: usize = 4096;
const MAX_PENDING: u64 = 16;
const MAX_RESULTS: u64 = 50;
const MAX_MODEL: usize = 200;

fn setup(c: &Connection) -> Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS semantic_chunks(note_id TEXT NOT NULL,revision INTEGER NOT NULL,model TEXT NOT NULL,ordinal INTEGER NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,text_hash TEXT NOT NULL,dim INTEGER NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(note_id,ordinal));
CREATE INDEX IF NOT EXISTS idx_semantic_chunks_model ON semantic_chunks(model,note_id,revision);
CREATE TRIGGER IF NOT EXISTS purge_semantic_on_delete AFTER DELETE ON notes_meta BEGIN DELETE FROM semantic_chunks WHERE note_id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS purge_semantic_on_lock AFTER UPDATE OF locked ON notes_meta WHEN NEW.locked=1 BEGIN DELETE FROM semantic_chunks WHERE note_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS purge_semantic_on_trash AFTER UPDATE OF trashed ON notes_meta WHEN NEW.trashed=1 BEGIN DELETE FROM semantic_chunks WHERE note_id=NEW.id; END;")?;
    Ok(())
}

/// One chunk; `start`/`end` are UTF-16 offsets into the note's plain text.
pub struct Chunk {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// Prefers a paragraph break, then a space, in the second half of the window.
fn break_at(c: &[char], start: usize, hard: usize) -> usize {
    let floor = start + CHUNK_CHARS / 2;
    if let Some(i) = (floor..hard).rev().find(|&i| c[i] == '\n') {
        return i + 1;
    }
    (floor..hard).rev().find(|&i| c[i].is_whitespace()).map_or(hard, |i| i + 1)
}

fn skip_space(c: &[char], mut at: usize) -> usize {
    while at < c.len() && c[at].is_whitespace() {
        at += 1;
    }
    at
}

/// Paragraph-aware ~800-char windows with a small word-aligned overlap.
pub fn chunks(text: &str) -> Vec<Chunk> {
    let c: Vec<char> = text.chars().collect();
    let mut utf16 = Vec::with_capacity(c.len() + 1);
    let mut at = 0;
    for ch in &c {
        utf16.push(at);
        at += ch.len_utf16();
    }
    utf16.push(at);
    let mut out = Vec::new();
    let mut start = skip_space(&c, 0);
    while start < c.len() && out.len() < MAX_CHUNKS {
        let hard = (start + CHUNK_CHARS).min(c.len());
        let cut = if hard == c.len() { hard } else { break_at(&c, start, hard) };
        let mut end = cut;
        while end > start && c[end - 1].is_whitespace() {
            end -= 1;
        }
        out.push(Chunk { start: utf16[start], end: utf16[end], text: c[start..end].iter().collect() });
        if cut >= c.len() {
            break;
        }
        let mut next = cut.saturating_sub(OVERLAP_CHARS).max(start + 1);
        while next < cut && !c[next - 1].is_whitespace() {
            next += 1;
        }
        start = skip_space(&c, next);
    }
    out
}

fn model(args: &Value) -> Result<&str> {
    match args.get("model").and_then(Value::as_str) {
        Some(m) if !m.trim().is_empty() && m.len() <= MAX_MODEL => Ok(m),
        _ => Err(EngineError::invalid("semantic model must be 1-200 characters")),
    }
}

fn vector(v: &Value) -> Result<Vec<f32>> {
    let items = v.as_array().ok_or_else(|| EngineError::invalid("vector must be an array"))?;
    if items.is_empty() || items.len() > MAX_DIM {
        return Err(EngineError::invalid("vector dimension must be 1-4096"));
    }
    items
        .iter()
        .map(|x| match x.as_f64().map(|f| f as f32) {
            Some(f) if f.is_finite() => Ok(f),
            _ => Err(EngineError::invalid("vector values must be finite numbers")),
        })
        .collect()
}

fn hash(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().take(8).map(|b| format!("{b:02x}")).collect()
}

const ELIGIBLE: &str = "m.locked=0 AND m.trashed=0";
/// Body columns read by `plain`, in this order.
const BODY: &str = "m.content_format,b.content,b.text";

/// The same plain text the search index reads; unreadable bodies index as empty.
fn plain(r: &rusqlite::Row, at: usize) -> rusqlite::Result<String> {
    let (format, content, text): (String, String, String) = (r.get(at)?, r.get(at + 1)?, r.get(at + 2)?);
    Ok(crate::indexer::search_text(&format, &content, &text).map(|t| t.into_owned()).unwrap_or_default())
}

pub fn pending(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(8).clamp(1, MAX_PENDING);
    let mut stmt = c.prepare(&format!("SELECT m.id,m.revision,m.title,{BODY} FROM notes_meta m JOIN notes_body b ON b.note_id=m.id WHERE {ELIGIBLE} AND NOT EXISTS(SELECT 1 FROM semantic_chunks s WHERE s.note_id=m.id AND s.model=?1 AND s.revision=m.revision) ORDER BY m.updated_at DESC,m.id LIMIT ?2"))?;
    let rows = stmt.query_map(params![model, limit as i64], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, plain(r, 3)?))
    })?;
    let mut items = Vec::new();
    for row in rows {
        let (id, revision, title, text) = row?;
        let parts: Vec<Value> = chunks(&text)
            .iter()
            .enumerate()
            .map(|(i, k)| json!({"ordinal":i,"start":k.start,"end":k.end,"text":k.text}))
            .collect();
        items.push(json!({"id":id,"revision":revision,"title":title,"chunks":parts}));
    }
    Ok(json!({ "items": items }))
}

fn parse_vectors(args: &Value) -> Result<Vec<Vec<f32>>> {
    let list = args.get("vectors").and_then(Value::as_array).ok_or_else(|| EngineError::invalid("vectors must be an array"))?;
    if list.len() > MAX_CHUNKS {
        return Err(EngineError::invalid("too many vectors"));
    }
    let vectors = list.iter().map(vector).collect::<Result<Vec<_>>>()?;
    if vectors.iter().any(|v| v.len() != vectors[0].len()) {
        return Err(EngineError::invalid("vector dimensions differ"));
    }
    Ok(vectors)
}

fn transaction<T>(c: &Connection, f: impl FnOnce() -> Result<T>) -> Result<T> {
    c.execute_batch("BEGIN IMMEDIATE")?;
    let result = f();
    if result.is_ok() {
        c.execute_batch("COMMIT")?;
    } else {
        let _ = c.execute_batch("ROLLBACK");
    }
    result
}

/// Replaces a note's vectors only while `revision` is current and the note is eligible.
pub fn put(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let id = args.get("note_id").and_then(Value::as_str).ok_or_else(|| EngineError::invalid("missing note_id"))?;
    let revision = args.get("revision").and_then(Value::as_i64).ok_or_else(|| EngineError::invalid("missing revision"))?;
    let vectors = parse_vectors(args)?;
    transaction(c, || {
        let row: Option<(i64, bool, bool, String)> = c
            .query_row(&format!("SELECT m.revision,m.locked,m.trashed,{BODY} FROM notes_meta m JOIN notes_body b ON b.note_id=m.id WHERE m.id=?1"), [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, plain(r, 3)?)))
            .optional()?;
        let (current, locked, trashed, text) = row.ok_or_else(|| EngineError::NotFound(id.into()))?;
        if current != revision || locked || trashed {
            return Err(EngineError::Conflict("note changed or is not indexable".into()));
        }
        let parts = chunks(&text);
        if parts.len() != vectors.len() {
            return Err(EngineError::invalid("vector count must match chunk count"));
        }
        c.execute("DELETE FROM semantic_chunks WHERE note_id=?1", [id])?;
        let mut insert = c.prepare("INSERT INTO semantic_chunks VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)")?;
        for (i, (k, v)) in parts.iter().zip(&vectors).enumerate() {
            let blob: Vec<u8> = v.iter().flat_map(|f| f.to_le_bytes()).collect();
            insert.execute(params![id, revision, model, i as i64, k.start as i64, k.end as i64, hash(&k.text), v.len() as i64, blob])?;
        }
        if parts.is_empty() {
            // Marker so empty notes do not stay pending forever; search skips ordinal -1.
            insert.execute(params![id, revision, model, -1i64, 0i64, 0i64, "", 0i64, Vec::<u8>::new()])?;
        }
        Ok(json!({ "stored": parts.len() }))
    })
}

fn cosine(query: &[f32], norm: f32, blob: &[u8]) -> f32 {
    let mut dot = 0f32;
    let mut sq = 0f32;
    for (q, b) in query.iter().zip(blob.chunks_exact(4)) {
        let x = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
        dot += q * x;
        sq += x * x;
    }
    if sq == 0.0 || norm == 0.0 {
        return 0.0;
    }
    dot / (norm * sq.sqrt())
}

/// UTF-16 offsets back to a string slice.
fn utf16_slice(text: &str, start: usize, end: usize) -> String {
    let mut at = 0;
    let mut out = String::new();
    for ch in text.chars() {
        if at >= end {
            break;
        }
        if at >= start {
            out.push(ch);
        }
        at += ch.len_utf16();
    }
    out
}

struct Hit {
    score: f32,
    id: String,
    start: i64,
    end: i64,
}

fn rank(c: &Connection, model: &str, query: &[f32], limit: usize) -> Result<Vec<Hit>> {
    let norm = query.iter().map(|x| x * x).sum::<f32>().sqrt();
    // shortcut: brute-force scan of every chunk; add an ANN index if libraries grow past ~100k chunks.
    let mut stmt = c.prepare(&format!("SELECT s.note_id,s.start,s.end,s.vector FROM semantic_chunks s JOIN notes_meta m ON m.id=s.note_id AND m.revision=s.revision WHERE {ELIGIBLE} AND m.archived=0 AND s.model=?1 AND s.dim=?2 AND s.ordinal>=0"))?;
    let mut rows = stmt.query(params![model, query.len() as i64])?;
    let mut hits = Vec::new();
    while let Some(r) = rows.next()? {
        let blob: Vec<u8> = r.get(3)?;
        hits.push(Hit { score: cosine(query, norm, &blob), id: r.get(0)?, start: r.get(1)?, end: r.get(2)? });
    }
    hits.sort_by(|a, b| b.score.total_cmp(&a.score));
    hits.truncate(limit);
    Ok(hits)
}

pub fn search(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let query = vector(args.get("vector").unwrap_or(&Value::Null))?;
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(20).clamp(1, MAX_RESULTS) as usize;
    let tx = c.unchecked_transaction()?;
    let hits = rank(&tx, model, &query, limit)?;
    let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
    let notes = crate::ops_notes::summaries(&tx, &ids)?;
    let mut body = tx.prepare(&format!("SELECT {BODY} FROM notes_meta m JOIN notes_body b ON b.note_id=m.id WHERE m.id=?1"))?;
    let mut items = Vec::new();
    for h in &hits {
        let (Some(note), Some(text)) = (notes.get(&h.id), body.query_row([&h.id], |r| plain(r, 0)).optional()?) else { continue };
        let snippet = utf16_slice(&text, h.start as usize, h.end as usize);
        items.push(json!({"note":note,"start":h.start,"end":h.end,"score":h.score,"snippet":snippet}));
    }
    drop(body);
    tx.commit()?;
    Ok(json!({ "items": items }))
}

pub fn status(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let (total, indexed): (i64, i64) = c.query_row(&format!("SELECT count(*),count(*) FILTER (WHERE EXISTS(SELECT 1 FROM semantic_chunks s WHERE s.note_id=m.id AND s.model=?1 AND s.revision=m.revision)) FROM notes_meta m WHERE {ELIGIBLE}"), [model], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(json!({ "indexed": indexed, "pending": total - indexed }))
}

/// Drops every vector so the next indexing pass rebuilds them.
pub fn reset(c: &Connection) -> Result<Value> {
    setup(c)?;
    c.execute("DELETE FROM semantic_chunks", [])?;
    Ok(json!({}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunks_cover_text_with_bounded_size_and_utf16_offsets() {
        let para = "가나다 라마바사 아자차카 타파하. ".repeat(30);
        let text = format!("😀 {para}\n\n{para}\n짧은 끝");
        let parts = chunks(&text);
        assert!(parts.len() >= 2);
        let units: Vec<u16> = text.encode_utf16().collect();
        for k in &parts {
            assert!(k.text.chars().count() <= CHUNK_CHARS);
            assert_eq!(String::from_utf16(&units[k.start..k.end]).unwrap(), k.text);
        }
        assert!(parts.last().unwrap().text.ends_with("짧은 끝"));
        assert!(chunks(" \n\t").is_empty());
    }
}
