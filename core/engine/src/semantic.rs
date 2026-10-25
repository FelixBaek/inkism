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
/// Hard cap per note (~4M chars) against abuse; text past it is not embedded.
const MAX_CHUNKS: usize = 5000;
/// Chunks per pending/put page, which bounds each request.
const PAGE: usize = 64;
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
/// A note is indexed once its final page wrote the ordinal -1 marker. Older builds wrote one page of at most
/// 64 chunks and a marker only for empty notes, so rows without ordinal 63 also count as complete.
const DONE: &str = "EXISTS(SELECT 1 FROM semantic_chunks s WHERE s.note_id=m.id AND s.model=?1 AND s.revision=m.revision AND (s.ordinal=-1 OR s.ordinal=0 AND NOT EXISTS(SELECT 1 FROM semantic_chunks t WHERE t.note_id=m.id AND t.ordinal=63)))";

/// Vectors already stored for this exact revision and model; pages are written in order, so this is the next offset.
fn stored(c: &Connection, id: &str, revision: i64, model: &str) -> Result<usize> {
    let n: i64 = c.query_row("SELECT count(*) FROM semantic_chunks WHERE note_id=?1 AND revision=?2 AND model=?3 AND ordinal>=0", params![id, revision, model], |r| r.get(0))?;
    Ok(n as usize)
}
/// Body columns read by `plain`, in this order.
const BODY: &str = "m.content_format,b.content,b.text";

/// The same plain text the search index reads; unreadable bodies index as empty.
fn plain(r: &rusqlite::Row, at: usize) -> rusqlite::Result<String> {
    let (format, content, text): (String, String, String) = (r.get(at)?, r.get(at + 1)?, r.get(at + 2)?);
    Ok(crate::indexer::search_text(&format, &content, &text).map(|t| t.into_owned()).unwrap_or_default())
}

/// Notes not fully indexed, each with its next page of chunks (`offset` of `total`).
pub fn pending(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(8).clamp(1, MAX_PENDING);
    let mut stmt = c.prepare(&format!("SELECT m.id,m.revision,m.title,{BODY} FROM notes_meta m JOIN notes_body b ON b.note_id=m.id WHERE {ELIGIBLE} AND NOT {DONE} ORDER BY m.updated_at DESC,m.id LIMIT ?2"))?;
    let rows = stmt.query_map(params![model, limit as i64], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, plain(r, 3)?))
    })?;
    let mut items = Vec::new();
    for row in rows {
        let (id, revision, title, text) = row?;
        let all = chunks(&text);
        let offset = stored(c, &id, revision, model)?;
        let offset = if offset < all.len() { offset } else { 0 };
        let parts: Vec<Value> = all
            .iter()
            .enumerate()
            .skip(offset)
            .take(PAGE)
            .map(|(i, k)| json!({"ordinal":i,"start":k.start,"end":k.end,"text":k.text}))
            .collect();
        items.push(json!({"id":id,"revision":revision,"title":title,"offset":offset,"total":all.len(),"chunks":parts}));
    }
    Ok(json!({ "items": items }))
}

fn parse_vectors(args: &Value) -> Result<Vec<Vec<f32>>> {
    let list = args.get("vectors").and_then(Value::as_array).ok_or_else(|| EngineError::invalid("vectors must be an array"))?;
    if list.len() > PAGE {
        return Err(EngineError::invalid("too many vectors"));
    }
    let vectors = list.iter().map(vector).collect::<Result<Vec<_>>>()?;
    if vectors.iter().any(|v| v.len() != vectors[0].len()) {
        return Err(EngineError::invalid("vector dimensions differ"));
    }
    Ok(vectors)
}

fn dim(c: &Connection, id: &str) -> Result<usize> {
    let d: i64 = c.query_row("SELECT dim FROM semantic_chunks WHERE note_id=?1 AND ordinal=0", [id], |r| r.get(0))?;
    Ok(d as usize)
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

/// Stores one page of a note's vectors only while `revision` is current and the note is eligible.
/// Offset 0 drops whatever the note had; a later page must continue exactly where this revision and model stopped,
/// so pages of an older revision are refused and never mix. The final page writes the completion marker.
pub fn put(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let id = args.get("note_id").and_then(Value::as_str).ok_or_else(|| EngineError::invalid("missing note_id"))?;
    let revision = args.get("revision").and_then(Value::as_i64).ok_or_else(|| EngineError::invalid("missing revision"))?;
    let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let vectors = parse_vectors(args)?;
    transaction(c, || {
        let row: Option<(i64, bool, bool, String)> = c
            .query_row(&format!("SELECT m.revision,m.locked,m.trashed,{BODY} FROM notes_meta m JOIN notes_body b ON b.note_id=m.id WHERE m.id=?1"), [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, plain(r, 3)?)))
            .optional()?;
        let (current, locked, trashed, text) = row.ok_or_else(|| EngineError::NotFound(id.into()))?;
        if current != revision || locked || trashed {
            return Err(EngineError::Conflict("note changed or is not indexable".into()));
        }
        let all = chunks(&text);
        let parts = all.get(offset..).unwrap_or_default();
        let parts = &parts[..parts.len().min(PAGE)];
        if parts.len() != vectors.len() || (offset > 0 && parts.is_empty()) {
            return Err(EngineError::invalid("vector count must match chunk count"));
        }
        if offset == 0 {
            c.execute("DELETE FROM semantic_chunks WHERE note_id=?1", [id])?;
        } else if stored(c, id, revision, model)? != offset || vectors[0].len() != dim(c, id)? {
            return Err(EngineError::Conflict("earlier pages are missing or changed".into()));
        }
        let mut insert = c.prepare("INSERT INTO semantic_chunks VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)")?;
        for (i, (k, v)) in parts.iter().zip(&vectors).enumerate() {
            let blob: Vec<u8> = v.iter().flat_map(|f| f.to_le_bytes()).collect();
            insert.execute(params![id, revision, model, (offset + i) as i64, k.start as i64, k.end as i64, hash(&k.text), v.len() as i64, blob])?;
        }
        let done = offset + parts.len() == all.len();
        if done {
            // Completion marker, also for empty notes so they do not stay pending; search skips ordinal -1.
            insert.execute(params![id, revision, model, -1i64, 0i64, all.len() as i64, "", 0i64, Vec::<u8>::new()])?;
        }
        Ok(json!({ "stored": parts.len(), "done": done }))
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

/// The heap root is the worst retained hit. Scan order breaks ties so equal
/// scores have exactly the same order as the previous stable full sort.
struct RankedHit {
    hit: Hit,
    order: usize,
}
impl PartialEq for RankedHit {
    fn eq(&self, other: &Self) -> bool { self.cmp(other).is_eq() }
}
impl Eq for RankedHit {}
impl PartialOrd for RankedHit {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> { Some(self.cmp(other)) }
}
impl Ord for RankedHit {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other.hit.score.total_cmp(&self.hit.score).then_with(|| self.order.cmp(&other.order))
    }
}

fn rank(c: &Connection, model: &str, query: &[f32], limit: usize) -> Result<Vec<Hit>> {
    let norm = query.iter().map(|x| x * x).sum::<f32>().sqrt();
    // Exact scan, retaining only K candidates: O(N log K) comparisons and O(K)
    // hit storage. Vector comparison still visits every eligible chunk.
    let mut stmt = c.prepare(&format!("SELECT s.note_id,s.start,s.end,s.vector FROM semantic_chunks s JOIN notes_meta m ON m.id=s.note_id AND m.revision=s.revision WHERE {ELIGIBLE} AND m.archived=0 AND s.model=?1 AND s.dim=?2 AND s.ordinal>=0"))?;
    let mut rows = stmt.query(params![model, query.len() as i64])?;
    let mut hits: std::collections::BinaryHeap<RankedHit> = std::collections::BinaryHeap::with_capacity(limit);
    let mut order = 0;
    while let Some(r) = rows.next()? {
        let blob: Vec<u8> = r.get(3)?;
        let score = cosine(query, norm, &blob);
        if hits.len() < limit || hits.peek().is_some_and(|worst| score.total_cmp(&worst.hit.score).is_gt()) {
            if hits.len() == limit { hits.pop(); }
            hits.push(RankedHit { hit: Hit { score, id: r.get(0)?, start: r.get(1)?, end: r.get(2)? }, order });
        }
        order += 1;
    }
    let mut hits = hits.into_vec();
    hits.sort();
    Ok(hits.into_iter().map(|h| h.hit).collect())
}

pub fn search(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let query = vector(args.get("vector").unwrap_or(&Value::Null))?;
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(20).clamp(1, MAX_RESULTS) as usize;
    let tx = c.unchecked_transaction()?;
    let hits = rank(&tx, model, &query, limit)?;
    let items = hit_items(&tx, &hits)?;
    tx.commit()?;
    Ok(json!({ "items": items }))
}

fn hit_items(c: &Connection, hits: &[Hit]) -> Result<Vec<Value>> {
    let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
    let notes = crate::ops_notes::summaries(c, &ids)?;
    let mut body = c.prepare(&format!("SELECT {BODY} FROM notes_meta m JOIN notes_body b ON b.note_id=m.id WHERE m.id=?1"))?;
    let mut items = Vec::new();
    for h in hits {
        let (Some(note), Some(text)) = (notes.get(&h.id), body.query_row([&h.id], |r| plain(r, 0)).optional()?) else { continue };
        let snippet = utf16_slice(&text, h.start as usize, h.end as usize);
        items.push(json!({"note":note,"start":h.start,"end":h.end,"score":h.score,"snippet":snippet}));
    }
    Ok(items)
}

/// Average normalized chunks of the current complete index, never a prefix of
/// the source note. O(dimensions) working memory even for multi-page notes.
fn note_vector(c: &Connection, id: &str, revision: i64, model: &str) -> Result<Vec<f32>> {
    let mut stmt = c.prepare("SELECT dim,vector FROM semantic_chunks WHERE note_id=?1 AND revision=?2 AND model=?3 AND ordinal>=0 ORDER BY ordinal")?;
    let mut rows = stmt.query(params![id, revision, model])?;
    let mut sum: Vec<f64> = Vec::new();
    while let Some(row) = rows.next()? {
        let dimension: i64 = row.get(0)?;
        if !(1..=MAX_DIM as i64).contains(&dimension) { return Err(EngineError::invalid("invalid indexed vector")); }
        let dimension = dimension as usize;
        let blob: Vec<u8> = row.get(1)?;
        if blob.len() != dimension * 4 || (!sum.is_empty() && sum.len() != dimension) {
            return Err(EngineError::invalid("invalid indexed vector"));
        }
        let values: Vec<f64> = blob.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap()) as f64).collect();
        if values.iter().any(|x| !x.is_finite()) { return Err(EngineError::invalid("invalid indexed vector")); }
        if sum.is_empty() { sum.resize(dimension, 0.0); }
        let norm = values.iter().map(|x| x*x).sum::<f64>().sqrt();
        if norm > 0.0 { for (total, value) in sum.iter_mut().zip(values) { *total += value / norm; } }
    }
    let norm = sum.iter().map(|x| x*x).sum::<f64>().sqrt();
    if norm == 0.0 { return Ok(Vec::new()); }
    Ok(sum.into_iter().map(|x| (x / norm) as f32).collect())
}

/// Keep the strongest evidence per distinct note, with at most K retained
/// notes. Repeated chunks of one note cannot crowd other notes out of results.
fn rank_notes(c: &Connection, model: &str, source: &str, query: &[f32], limit: usize) -> Result<Vec<Hit>> {
    if query.is_empty() || limit == 0 { return Ok(Vec::new()); }
    let norm = query.iter().map(|x| x*x).sum::<f32>().sqrt();
    let mut stmt = c.prepare(&format!("SELECT s.note_id,s.start,s.end,s.vector FROM semantic_chunks s JOIN notes_meta m ON m.id=s.note_id AND m.revision=s.revision WHERE {ELIGIBLE} AND m.archived=0 AND s.model=?1 AND s.dim=?2 AND s.note_id!=?3 AND s.ordinal>=0"))?;
    let mut rows = stmt.query(params![model, query.len() as i64, source])?;
    let mut hits: Vec<Hit> = Vec::with_capacity(limit);
    while let Some(row) = rows.next()? {
        let score = cosine(query, norm, &row.get::<_, Vec<u8>>(3)?);
        if !score.is_finite() || score <= 0.0 { continue; }
        let id: String = row.get(0)?;
        if let Some(index) = hits.iter().position(|hit| hit.id == id) {
            if score <= hits[index].score { continue; }
            hits.remove(index);
        } else if hits.len() == limit {
            let worst = hits.last().unwrap();
            if score < worst.score || (score == worst.score && id >= worst.id) { continue; }
            hits.pop();
        }
        hits.push(Hit { score, id, start: row.get(1)?, end: row.get(2)? });
        hits.sort_by(|a,b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    }
    Ok(hits)
}

pub fn related(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let id = args.get("note_id").and_then(Value::as_str).ok_or_else(|| EngineError::invalid("missing note_id"))?;
    let revision = args.get("revision").and_then(Value::as_i64).ok_or_else(|| EngineError::invalid("missing revision"))?;
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(10).clamp(1, MAX_RESULTS) as usize;
    let tx = c.unchecked_transaction()?;
    let source: Option<(i64, bool, bool, bool)> = tx.query_row(&format!("SELECT m.revision,m.locked,m.trashed,{DONE} FROM notes_meta m WHERE m.id=?2"), params![model,id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    let (current, locked, trashed, ready) = source.ok_or_else(|| EngineError::NotFound(id.into()))?;
    if current != revision || locked || trashed { return Err(EngineError::Conflict("note changed or is not indexable".into())); }
    if !ready { return Ok(json!({"ready":false,"items":[]})); }
    let query = note_vector(&tx, id, revision, model)?;
    let hits = rank_notes(&tx, model, id, &query, limit)?;
    let items = hit_items(&tx, &hits)?;
    tx.commit()?;
    Ok(json!({"ready":true,"items":items}))
}

pub fn status(c: &Connection, args: &Value) -> Result<Value> {
    setup(c)?;
    let model = model(args)?;
    let (total, indexed): (i64, i64) = c.query_row(&format!("SELECT count(*),count(*) FILTER (WHERE {DONE}) FROM notes_meta m WHERE {ELIGIBLE}"), [model], |r| Ok((r.get(0)?, r.get(1)?)))?;
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
    fn indexed_note(e: &crate::Engine, title: &str, content: &str, vector: Value) -> Value {
        let note = run(e, json!({"op":"save","note":{"title":title,"content":content,"content_format":"text"}}));
        loop {
            let pending = run(e, json!({"op":"semantic_pending","model":"m","limit":16}));
            let page = pending["items"].as_array().unwrap().iter().find(|p| p["id"] == note["id"]);
            let Some(page) = page else { break };
            let vectors = vec![vector.clone();page["chunks"].as_array().unwrap().len()];
            run(e, json!({"op":"semantic_put","model":"m","note_id":note["id"],"revision":note["revision"],"offset":page["offset"],"vectors":vectors}));
        }
        note
    }

    #[test]
    fn related_notes_deduplicate_evidence_and_reject_hidden_stale_sources() {
        let (root, e) = fixture();
        let source = indexed_note(&e, "source", "source text", json!([1.0,0.0]));
        let repeated = indexed_note(&e, "repeated", &"related sentence. ".repeat(300), json!([1.0,0.0]));
        let other = indexed_note(&e, "other", "other evidence", json!([0.8,0.2]));
        indexed_note(&e, "orthogonal", "not related", json!([0.0,1.0]));
        let query = json!({"op":"semantic_related","model":"m","note_id":source["id"],"revision":source["revision"],"limit":2});
        let result = run(&e, query.clone());
        assert_eq!(result["ready"],true);
        assert_eq!(result["items"].as_array().unwrap().len(),2);
        assert_eq!(result["items"][0]["note"]["id"], repeated["id"]);
        assert_eq!(result["items"][1]["note"]["id"], other["id"]);
        assert_eq!(result["items"][1]["snippet"],"other evidence");
        let mut wrong_model = query.clone();wrong_model["model"] = json!("different-server-space");
        assert_eq!(run(&e,wrong_model)["ready"],false);
        run(&e,json!({"op":"patch","id":other["id"],"changes":{"trashed":true}}));
        e.connection().execute("UPDATE notes_meta SET locked=1 WHERE id=?1",[repeated["id"].as_str().unwrap()]).unwrap();
        assert!(run(&e,query.clone())["items"].as_array().unwrap().is_empty());
        e.connection().execute("UPDATE notes_meta SET locked=1 WHERE id=?1",[source["id"].as_str().unwrap()]).unwrap();
        assert_eq!(e.execute(query.clone())["ok"],false);
        e.connection().execute("UPDATE notes_meta SET locked=0,revision=revision+1 WHERE id=?1",[source["id"].as_str().unwrap()]).unwrap();
        assert_eq!(e.execute(query)["ok"],false);
        drop(e);std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn related_source_waits_for_all_pages_and_includes_the_tail() {
        let (root,e) = fixture();
        let source = long_note(&e,None,"꼬리 문단");
        let query=json!({"op":"semantic_related","model":"m","note_id":source["id"],"revision":source["revision"]});
        let first=next_page(&e);
        assert!(first["total"].as_u64().unwrap()>PAGE as u64);
        assert_eq!(put_page(&e,&first,&source["revision"],0)["ok"],true);
        assert_eq!(run(&e,query.clone())["ready"],false);
        while status(&e)["pending"].as_i64().unwrap()>0 {
            let page=next_page(&e);
            assert_eq!(put_page(&e,&page,&source["revision"],page["offset"].as_u64().unwrap() as usize)["ok"],true);
        }
        assert_eq!(run(&e,query)["ready"],true);
        let vector=note_vector(e.connection(),source["id"].as_str().unwrap(),source["revision"].as_i64().unwrap(),"m").unwrap();
        assert_eq!(vector.len(),2);assert!(vector[0]>0.0 && vector[1]>0.0,"the final page contributes to the source vector");
        drop(e);std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn related_ranking_matches_distinct_note_oracle() {
        let (root, engine) = fixture();
        let c = engine.connection();
        setup(c).unwrap();
        let mut expected = Vec::new();
        for i in 0..120 {
            let id = format!("related-{i:04}");
            let hidden = i % 17;
            c.execute("INSERT INTO notes_meta(id,title,created_at,updated_at,locked,trashed,archived) VALUES(?1,'',0,0,?2,?3,?4)", params![id,hidden==1,hidden==2,hidden==3]).unwrap();
            let mut best = 0f32;
            for ordinal in 0..5 {
                let vector = [((i*13+ordinal*7)%23) as f32-11.0,1.0f32];
                let score = vector[0]/(vector[0]*vector[0]+1.0).sqrt();
                best = best.max(score);
                let blob: Vec<u8> = vector.iter().flat_map(|v|v.to_le_bytes()).collect();
                c.execute("INSERT INTO semantic_chunks VALUES(?1,?2,?3,?4,0,1,'',2,?5)", params![id,if hidden==4 {0} else {1},if hidden==5 {"other"} else {"m"},ordinal,blob]).unwrap();
            }
            if !(1..=5).contains(&hidden) && i!=0 && best>0.0 { expected.push((id,best)); }
        }
        expected.sort_by(|a,b|b.1.total_cmp(&a.1).then_with(||a.0.cmp(&b.0)));
        for limit in [1,2,10,50,150] {
            let actual = rank_notes(c,"m","related-0000",&[1.0,0.0],limit).unwrap();
            assert_eq!(actual.iter().map(|h|(h.id.clone(),h.score)).collect::<Vec<_>>(),expected.iter().take(limit).cloned().collect::<Vec<_>>());
        }
        assert!(rank_notes(c,"m","related-0000",&[],10).unwrap().is_empty());
        drop(engine);std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn related_zero_vector_returns_no_suggestions_and_preserves_source() {
        let (root,e) = fixture();
        let source = indexed_note(&e,"zero","original text",json!([0.0,0.0]));
        indexed_note(&e,"other","other text",json!([1.0,0.0]));
        let before = run(&e,json!({"op":"get","id":source["id"]}));
        let result = run(&e,json!({"op":"semantic_related","model":"m","note_id":source["id"],"revision":source["revision"]}));
        assert_eq!(result,json!({"ready":true,"items":[]}));
        assert_eq!(run(&e,json!({"op":"get","id":source["id"]})),before);
        drop(e);std::fs::remove_dir_all(root).unwrap();
    }

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

    fn run(e: &crate::Engine, req: Value) -> Value {
        let v = e.execute(req);
        assert_eq!(v["ok"], true, "{v}");
        v["data"].clone()
    }

    fn fixture() -> (std::path::PathBuf, crate::Engine) {
        let root = std::env::temp_dir().join(format!("semantic-unit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let e = crate::Engine::open(root.join("notes.db").to_str().unwrap()).unwrap();
        (root, e)
    }

    /// About 110 chunks: two pages.
    fn long_note(e: &crate::Engine, prev: Option<&Value>, tail: &str) -> Value {
        let body: String = (0..200).map(|i| format!("<p>{i}번째 문단. {}</p>", "채움 문장이 이어집니다. ".repeat(25))).collect();
        let mut note = json!({"title":"Long","content":format!("{body}<p>{tail}</p>"),"content_format":"html"});
        if let Some(p) = prev {
            note["id"] = p["id"].clone();
            note["revision"] = p["revision"].clone();
        }
        run(e, json!({"op":"save","note":note}))
    }

    fn next_page(e: &crate::Engine) -> Value {
        run(e, json!({"op":"semantic_pending","model":"m","limit":16}))["items"][0].clone()
    }

    /// Chunks mentioning the tail point one way, filler the other.
    fn put_page(e: &crate::Engine, p: &Value, revision: &Value, offset: usize) -> Value {
        let vectors: Vec<Value> = p["chunks"].as_array().unwrap().iter().map(|k| if k["text"].as_str().unwrap().contains("꼬리") { json!([0.0, 1.0]) } else { json!([1.0, 0.0]) }).collect();
        e.execute(json!({"op":"semantic_put","model":"m","note_id":p["id"],"revision":revision,"offset":offset,"vectors":vectors}))
    }

    fn status(e: &crate::Engine) -> Value {
        run(e, json!({"op":"semantic_status","model":"m"}))
    }

    fn tail_hits(e: &crate::Engine) -> Vec<Value> {
        run(e, json!({"op":"semantic_search","model":"m","vector":[0.0,1.0],"limit":3}))["items"].as_array().unwrap().clone()
    }

    #[test]
    fn bounded_ranking_matches_stable_full_sort_with_ties_and_hidden_rows() {
        let (root, engine) = fixture();
        let c = engine.connection();
        setup(c).unwrap();
        let mut expected = Vec::new();
        let tx = c.unchecked_transaction().unwrap();
        for i in 0..400 {
            let id = format!("rank-{i:04}");
            let hidden = i % 29;
            let model = if hidden == 4 { "other" } else { "m" };
            let revision = if hidden == 5 { 0 } else { 1 };
            let vector = [((i * 17) % 19) as f32 - 9.0, ((i * 7) % 11) as f32 - 5.0, 1.0];
            let blob: Vec<u8> = vector.iter().flat_map(|f| f.to_le_bytes()).collect();
            tx.execute("INSERT INTO notes_meta(id,title,created_at,updated_at,locked,trashed,archived) VALUES(?1,'',0,0,?2,?3,?4)", params![id, hidden == 1, hidden == 2, hidden == 3]).unwrap();
            tx.execute("INSERT INTO semantic_chunks VALUES(?1,?2,?3,0,0,1,'',3,?4)", params![id, revision, model, blob]).unwrap();
            if !(1..=5).contains(&hidden) { expected.push((id, vector)); }
        }
        tx.commit().unwrap();
        for query in [[1.0f32, 0.0, 0.0], [0.0, 0.0, 0.0], [-1.0, 1.0, 0.0]] {
            let norm = query.iter().map(|x| x*x).sum::<f32>().sqrt();
            let mut oracle: Vec<_> = expected.iter().map(|(id, vector)| {
                let dot = query.iter().zip(vector).map(|(a,b)| a*b).sum::<f32>();
                let magnitude = vector.iter().map(|x| x*x).sum::<f32>().sqrt();
                (id.clone(), if norm == 0.0 { 0.0 } else { dot / (norm * magnitude) })
            }).collect();
            oracle.sort_by(|a,b| b.1.total_cmp(&a.1));
            for limit in [0, 1, 3, 20, 100, 500] {
                let actual = rank(c, "m", &query, limit).unwrap();
                let actual: Vec<_> = actual.iter().map(|h| (h.id.clone(),h.score)).collect();
                assert_eq!(actual, oracle.iter().take(limit).cloned().collect::<Vec<_>>(), "limit={limit}, query={query:?}");
            }
        }
        drop(engine);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn long_note_is_indexed_page_by_page_and_its_tail_is_found() {
        let (root, e) = fixture();
        long_note(&e, None, "꼬리 문단: 마지막 결론은 여기에 있다.");
        let (mut offset, mut pages) = (0, 0);
        loop {
            let p = next_page(&e);
            if p.is_null() {
                break;
            }
            assert!(p["total"].as_u64().unwrap() as usize > PAGE);
            assert_eq!(p["offset"].as_u64().unwrap() as usize, offset);
            assert_eq!(status(&e), json!({"indexed":0,"pending":1}));
            assert_eq!(put_page(&e, &p, &p["revision"], offset + PAGE)["ok"], false, "pages go in order");
            assert_eq!(put_page(&e, &p, &p["revision"], offset)["ok"], true);
            offset += p["chunks"].as_array().unwrap().len();
            pages += 1;
        }
        assert!(pages >= 2 && offset > PAGE);
        assert_eq!(status(&e), json!({"indexed":1,"pending":0}));
        let hits = tail_hits(&e);
        assert!(hits[0]["snippet"].as_str().unwrap().contains("마지막 결론"), "{hits:?}");
        drop(e);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn revision_change_mid_way_discards_partial_pages() {
        let (root, e) = fixture();
        let first = long_note(&e, None, "꼬리 문단: 옛 결론.");
        let p = next_page(&e);
        assert_eq!(put_page(&e, &p, &first["revision"], 0)["ok"], true);
        let edited = long_note(&e, Some(&first), "꼬리 문단: 새 결론.");
        // The rest of the old revision is refused; its first page no longer counts or matches.
        let mut rest = p.clone();
        rest["chunks"] = json!(p["chunks"].as_array().unwrap()[..1]);
        assert_eq!(put_page(&e, &rest, &first["revision"], PAGE)["ok"], false);
        assert_eq!(status(&e), json!({"indexed":0,"pending":1}));
        assert!(run(&e, json!({"op":"semantic_search","model":"m","vector":[1.0,0.0]}))["items"].as_array().unwrap().is_empty());
        let fresh = next_page(&e);
        assert_eq!((fresh["revision"].clone(), fresh["offset"].as_u64()), (edited["revision"].clone(), Some(0)));
        assert_eq!(put_page(&e, &fresh, &edited["revision"], 0)["ok"], true);
        let old: i64 = e.connection().query_row("SELECT count(*) FROM semantic_chunks WHERE revision=?1", [first["revision"].as_i64()], |r| r.get(0)).unwrap();
        assert_eq!(old, 0);
        let p2 = next_page(&e);
        assert_eq!(p2["offset"].as_u64(), Some(PAGE as u64));
        assert_eq!(put_page(&e, &p2, &edited["revision"], PAGE)["ok"], true);
        assert_eq!(status(&e), json!({"indexed":1,"pending":0}));
        assert!(tail_hits(&e)[0]["snippet"].as_str().unwrap().contains("새 결론"));
        drop(e);
        std::fs::remove_dir_all(root).unwrap();
    }
}
