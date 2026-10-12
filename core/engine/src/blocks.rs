//! Lossless, derived top-level HTML blocks for lazy rich-document loading.
//! This cache is rebuilt by the index worker; foreground saves never split HTML.
use crate::error::{EngineError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::ops::Range;

const PAGE_BYTES: usize = 512 * 1024;

/// Conservative splitting of the balanced HTML produced by our editor. Never
/// repair or normalize source markup. Ambiguous/malformed input stays opaque.
pub fn ranges(html: &str) -> Vec<Range<usize>> {
    split_blocks(html).unwrap_or_else(|| std::iter::once(0..html.len()).collect())
}

/// `None` means the source is ambiguous and must stay one opaque block.
fn split_blocks(html: &str) -> Option<Vec<Range<usize>>> {
    let b = html.as_bytes();
    let mut stack: Vec<String> = Vec::new();
    let mut blocks = Vec::new();
    let (mut i, mut start) = (0, 0);
    while i < b.len() {
        if b[i] != b'<' {
            if stack.is_empty() && !b[i].is_ascii_whitespace() {
                return None;
            }
            i += 1;
            continue;
        }
        if b[i..].starts_with(b"<!--") {
            let end = html[i + 4..].find("-->")?;
            i += 4 + end + 3;
            continue;
        }
        let tag = parse_tag(html, i, stack.is_empty())?;
        i = tag.end + 1;
        apply_tag(&mut stack, tag, b)?;
        if stack.is_empty() {
            blocks.push(start..i);
            start = i;
        }
    }
    if !stack.is_empty() || blocks.is_empty() {
        return None;
    }
    // Preserve inter-block whitespace/comments byte for byte, including the tail.
    blocks.last_mut().unwrap().end = html.len();
    Some(blocks)
}

/// A start or end tag; `end` is the byte index of its closing `>`.
struct Tag {
    name: String,
    closing: bool,
    end: usize,
}

/// Parses the tag starting at `html[i] == '<'`. `None` means opaque.
fn parse_tag(html: &str, i: usize, top_level: bool) -> Option<Tag> {
    let b = html.as_bytes();
    let mut k = i + 1;
    let closing = b.get(k) == Some(&b'/');
    if closing {
        k += 1;
    }
    let name_start = k;
    while k < b.len() && b[k].is_ascii_alphanumeric() {
        k += 1;
    }
    if k == name_start {
        return None;
    }
    let name = html[name_start..k].to_ascii_lowercase();
    if !b
        .get(k)
        .is_some_and(|c| c.is_ascii_whitespace() || *c == b'/' || *c == b'>')
    {
        return None;
    }
    // Raw-text, foreign-content and template parsing needs a full HTML parser.
    // Keeping the entire source opaque is safe and lossless for these cases.
    if is_raw_or_foreign_tag(&name) || (!closing && top_level && !is_top_block_tag(&name)) {
        return None;
    }
    let end = tag_end(b, k)?;
    Some(Tag { name, closing, end })
}

/// Index of the `>` closing a tag, skipping quoted attribute values.
fn tag_end(b: &[u8], mut k: usize) -> Option<usize> {
    let mut quote = None;
    while k < b.len() {
        let c = b[k];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
        } else if c == b'\'' || c == b'"' {
            quote = Some(c);
        } else if c == b'>' {
            return Some(k);
        }
        k += 1;
    }
    None
}

/// Updates the open-element stack; `None` means unbalanced/ambiguous markup.
fn apply_tag(stack: &mut Vec<String>, tag: Tag, b: &[u8]) -> Option<()> {
    if tag.closing {
        if stack.pop().as_deref() != Some(tag.name.as_str()) {
            return None;
        }
    } else if !is_void_tag(&tag.name) {
        if b[tag.end.saturating_sub(1)] == b'/' || stack.len() >= 512 {
            return None;
        }
        stack.push(tag.name);
    }
    Some(())
}

fn is_raw_or_foreign_tag(name: &str) -> bool {
    matches!(
        name,
        "script"
            | "style"
            | "textarea"
            | "title"
            | "svg"
            | "math"
            | "template"
            | "plaintext"
            | "xmp"
            | "iframe"
            | "noscript"
    )
}

fn is_top_block_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "blockquote"
            | "pre"
            | "ul"
            | "ol"
            | "table"
            | "div"
            | "details"
            | "hr"
            | "img"
    )
}

fn is_void_tag(name: &str) -> bool {
    matches!(
        name,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

/// Called inside the worker's search-file transaction. Returns the body digest
/// for the FTS signature; the primary body is untouched.
pub fn rebuild(conn: &Connection, id: &str, revision: i64, html: &str) -> Result<[u8; 32]> {
    let digest = Sha256::digest(html.as_bytes());
    // Metadata-only revisions keep the exact same HTML. Promote the existing
    // cache without parsing and rewriting every block (millions in large notes).
    if conn.execute("UPDATE document_layout SET revision=?1 WHERE note_id=?2 AND content_hash=?3 AND byte_count=?4",
        params![revision,id,digest.as_slice(),html.len() as i64])? == 1 {
        crate::segments::refresh(conn, id, html, digest.as_slice(), None)?;
        return Ok(digest.into());
    }
    let blocks = ranges(html);
    if refresh_existing(conn, id, revision, html, &blocks, digest.as_slice())? {
        crate::segments::refresh(conn, id, html, digest.as_slice(), Some(&blocks))?;
        return Ok(digest.into());
    }
    conn.execute("DELETE FROM document_layout WHERE note_id=?1", [id])?;
    conn.execute(
        "INSERT INTO document_layout(note_id,revision,block_count,byte_count,content_hash) VALUES(?1,?2,?3,?4,?5)",
        params![id, revision, blocks.len() as i64, html.len() as i64,digest.as_slice()],
    )?;
    let mut insert = conn.prepare_cached(
        "INSERT INTO document_blocks(note_id,ordinal,byte_offset,html,search_text,search_folded) VALUES(?1,?2,?3,?4,?5,?6)",
    )?;
    for (ordinal, range) in blocks.iter().enumerate() {
        let text = crate::plaintext::from_html(&html[range.clone()])?;
        insert.execute(params![
            id,
            ordinal as i64,
            range.start as i64,
            &html[range.clone()],
            text,
            text.to_lowercase()
        ])?;
    }
    crate::segments::refresh(conn, id, html, digest.as_slice(), Some(&blocks))?;
    Ok(digest.into())
}

/// Preserve derived text for unchanged blocks when their ordinals are stable.
/// Read the old rows before writing: changing a table under a live SQLite scan
/// has undefined visibility. Retain only changed ordinals, never copied bodies.
/// The caller's index_note savepoint makes layout and block updates atomic.
fn refresh_existing(
    conn: &Connection,
    id: &str,
    revision: i64,
    html: &str,
    blocks: &[Range<usize>],
    digest: &[u8],
) -> Result<bool> {
    let count: Option<i64> = conn
        .query_row(
            "SELECT block_count FROM document_layout WHERE note_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    if count != Some(blocks.len() as i64) {
        return match count {
            Some(old_count) if old_count > 0 => {
                refresh_resized(conn, id, revision, html, blocks, digest, old_count)
            }
            _ => Ok(false),
        };
    }
    let mut changed = Vec::new();
    {
        let mut query = conn.prepare_cached(
            "SELECT ordinal,byte_offset,html FROM document_blocks WHERE note_id=?1 ORDER BY ordinal",
        )?;
        let mut rows = query.query([id])?;
        for (ordinal, range) in blocks.iter().enumerate() {
            let Some(row) = rows.next()? else {
                return Ok(false);
            };
            if row.get::<_, i64>(0)? != ordinal as i64 {
                return Ok(false);
            }
            let body_changed = row
                .get_ref(2)?
                .as_str()
                .map_err(|e| EngineError::invalid(format!("invalid cached block: {e}")))?
                != &html[range.clone()];
            if body_changed || row.get::<_, i64>(1)? != range.start as i64 {
                changed.push((ordinal, body_changed));
            }
        }
        if rows.next()?.is_some() {
            return Ok(false);
        }
    }
    let mut body_update = conn.prepare_cached(
        "UPDATE document_blocks SET byte_offset=?3,html=?4,search_text=?5,search_folded=?6 WHERE note_id=?1 AND ordinal=?2",
    )?;
    let mut offset_update = conn.prepare_cached(
        "UPDATE document_blocks SET byte_offset=?3 WHERE note_id=?1 AND ordinal=?2",
    )?;
    for (ordinal, body_changed) in changed {
        let range = &blocks[ordinal];
        if body_changed {
            let source = &html[range.clone()];
            let text = crate::plaintext::from_html(source)?;
            body_update.execute(params![
                id,
                ordinal as i64,
                range.start as i64,
                source,
                text,
                text.to_lowercase()
            ])?;
        } else {
            offset_update.execute(params![id, ordinal as i64, range.start as i64])?;
        }
    }
    conn.execute(
        "UPDATE document_layout SET revision=?2,byte_count=?3,content_hash=?4 WHERE note_id=?1",
        params![id, revision, html.len() as i64, digest],
    )?;
    Ok(true)
}

/// Insert/delete only the changed middle, preserving equal prefix/suffix text.
/// Suffix ordinals move through a disjoint negative range to avoid primary-key
/// collisions regardless of SQLite's UPDATE order. All writes remain inside
/// the caller's savepoint; readers cannot observe these temporary ordinals.
fn refresh_resized(
    conn: &Connection,
    id: &str,
    revision: i64,
    html: &str,
    blocks: &[Range<usize>],
    digest: &[u8],
    old_count: i64,
) -> Result<bool> {
    let shape: (i64, Option<i64>, Option<i64>) = conn.query_row(
        "SELECT count(*),min(ordinal),max(ordinal) FROM document_blocks WHERE note_id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if shape != (old_count, Some(0), Some(old_count - 1)) {
        return Ok(false);
    }
    let mut prefix = 0usize;
    {
        let mut query = conn.prepare_cached(
            "SELECT byte_offset,html FROM document_blocks WHERE note_id=?1 ORDER BY ordinal",
        )?;
        let mut rows = query.query([id])?;
        for range in blocks {
            let Some(row) = rows.next()? else {
                break;
            };
            if row
                .get_ref(1)?
                .as_str()
                .map_err(|e| EngineError::invalid(format!("invalid cached block: {e}")))?
                != &html[range.clone()]
            {
                break;
            }
            if row.get::<_, i64>(0)? != range.start as i64 {
                return Ok(false);
            }
            prefix += 1;
        }
    }
    let mut suffix = 0usize;
    let mut byte_delta = None;
    {
        let mut query=conn.prepare_cached("SELECT byte_offset,html FROM document_blocks WHERE note_id=?1 AND ordinal>=?2 ORDER BY ordinal DESC")?;
        let mut rows = query.query(params![id, prefix as i64])?;
        for range in blocks[prefix..].iter().rev() {
            let Some(row) = rows.next()? else {
                break;
            };
            if row
                .get_ref(1)?
                .as_str()
                .map_err(|e| EngineError::invalid(format!("invalid cached block: {e}")))?
                != &html[range.clone()]
            {
                break;
            }
            let delta = range.start as i64 - row.get::<_, i64>(0)?;
            if byte_delta.is_some_and(|d| d != delta) {
                return Ok(false);
            }
            byte_delta = Some(delta);
            suffix += 1;
        }
    }
    if prefix == 0 && suffix == 0 {
        return Ok(false);
    }
    let old_suffix = old_count - suffix as i64;
    conn.execute(
        "DELETE FROM document_blocks WHERE note_id=?1 AND ordinal>=?2 AND ordinal<?3",
        params![id, prefix as i64, old_suffix],
    )?;
    if suffix > 0 {
        conn.execute(
            "UPDATE document_blocks SET ordinal=-ordinal-1 WHERE note_id=?1 AND ordinal>=?2",
            params![id, old_suffix],
        )?;
        conn.execute("UPDATE document_blocks SET ordinal=-ordinal-1+?2,byte_offset=byte_offset+?3 WHERE note_id=?1 AND ordinal<0",
            params![id,blocks.len() as i64-old_count,byte_delta.unwrap()])?;
    }
    let mut insert=conn.prepare_cached("INSERT INTO document_blocks(note_id,ordinal,byte_offset,html,search_text,search_folded) VALUES(?1,?2,?3,?4,?5,?6)")?;
    for (ordinal, range) in blocks
        .iter()
        .enumerate()
        .take(blocks.len() - suffix)
        .skip(prefix)
    {
        let source = &html[range.clone()];
        let text = crate::plaintext::from_html(source)?;
        insert.execute(params![
            id,
            ordinal as i64,
            range.start as i64,
            source,
            text,
            text.to_lowercase()
        ])?;
    }
    conn.execute("UPDATE document_layout SET revision=?2,block_count=?3,byte_count=?4,content_hash=?5 WHERE note_id=?1",
        params![id,revision,blocks.len() as i64,html.len() as i64,digest])?;
    Ok(true)
}

/// A body-free opening manifest. Unlike page(), this never reads even the
/// first derived block: one oversized paragraph cannot inflate this response.
/// Counts are usable only when the background layout matches the live revision.
pub fn info(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .filter(|v| crate::ids::valid_id(v))
        .ok_or_else(|| EngineError::invalid("bad id"))?;
    let expected = match args.get("revision") {
        None => None,
        Some(v) => Some(
            v.as_i64()
                .filter(|n| *n >= 0)
                .ok_or_else(|| EngineError::invalid("bad revision"))?,
        ),
    };
    let tx = conn.unchecked_transaction()?;
    let summary = crate::ops_notes::load_summary(&tx, id)?;
    if expected.is_some_and(|value| value != summary.revision) {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    let layout = tx.query_row(
        "SELECT revision,block_count,byte_count FROM searchidx.document_layout WHERE note_id=?1",
        [id], |row| Ok((row.get::<_,i64>(0)?, row.get::<_,i64>(1)?, row.get::<_,i64>(2)?))
    ).optional()?;
    let current = layout.filter(|(revision, _, _)| *revision == summary.revision);
    Ok(json!({
        "content_format":summary.content_format, "revision": summary.revision, "summary": summary, "ready": current.is_some(),
        "total_blocks": current.map(|(_,count,_)| count),
        "total_bytes": current.map(|(_,_,bytes)| bytes),
    }))
}

/// Metadata + a revision-consistent page of derived blocks, without reading notes_body.
pub fn page(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .filter(|v| crate::ids::valid_id(v))
        .ok_or_else(|| EngineError::invalid("bad id"))?;
    let number = |key: &str, default: u64| -> Result<u64> {
        match args.get(key) {
            None => Ok(default),
            Some(v) => v
                .as_u64()
                .ok_or_else(|| EngineError::invalid(format!("bad {key}"))),
        }
    };
    let offset = number("offset", 0)?;
    let limit = number("limit", 64)?;
    let max_block_bytes = number("max_block_bytes", PAGE_BYTES as u64)?;
    if !(4..=PAGE_BYTES as u64).contains(&max_block_bytes) {
        return Err(EngineError::invalid("invalid max_block_bytes"));
    }
    if offset > i64::MAX as u64 || !(1..=256).contains(&limit) {
        return Err(EngineError::invalid("invalid block page bounds"));
    }
    let expected = match args.get("revision") {
        None => None,
        Some(v) => Some(
            v.as_i64()
                .filter(|n| *n >= 0)
                .ok_or_else(|| EngineError::invalid("bad revision"))?,
        ),
    };
    let include_summary = match args.get("include_summary") {
        None => false,
        Some(v) => v
            .as_bool()
            .ok_or_else(|| EngineError::invalid("bad include_summary"))?,
    };
    // Legacy callers can still fetch a whole first block to make progress.
    // Editors opt in to a hard bound and receive metadata rather than a
    // deceptively empty source block when one block exceeds the budget.
    let bounded = args
        .get("bounded")
        .map(|v| {
            v.as_bool()
                .ok_or_else(|| EngineError::invalid("bad bounded"))
        })
        .unwrap_or(Ok(false))?;
    let tx = conn.unchecked_transaction()?;
    let format: String = tx.query_row(
        "SELECT content_format FROM notes_meta WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    if format != "html" {
        return Err(EngineError::invalid(
            "HTML block operation requires an HTML note",
        ));
    }

    let metadata = tx.query_row("SELECT m.revision,c.revision,c.block_count,c.byte_count FROM notes_meta m LEFT JOIN searchidx.document_layout c ON c.note_id=m.id WHERE m.id=?1", [id], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,Option<i64>>(1)?,r.get::<_,Option<i64>>(2)?,r.get::<_,Option<i64>>(3)?))).optional()?.ok_or_else(|| EngineError::NotFound("note".into()))?;
    let (revision, cached, count, bytes) = metadata;
    if expected.is_some_and(|v| v != revision) {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    let summary = if include_summary {
        Some(crate::ops_notes::load_summary(&tx, id)?)
    } else {
        None
    };
    if cached != Some(revision) {
        return Ok(
            json!({"ready":false,"revision":revision,"summary":summary,"blocks":[],"total_blocks":null,"total_bytes":null,"next_offset":null}),
        );
    }
    let (blocks, returned_bytes, next, oversized) =
        read_block_page(&tx, id, offset, limit, max_block_bytes, bounded)?;
    Ok(
        json!({"ready":true,"revision":revision,"summary":summary,"blocks":blocks,"total_blocks":count,"total_bytes":bytes,"next_offset":if next < count.unwrap_or(0) as u64 { Some(next) } else { None },"oversized_block":oversized.is_some() || returned_bytes > PAGE_BYTES,"oversized":oversized}),
    )
}

/// Reads up to `limit` cached blocks from `offset`, stopping at the page byte
/// budget. Returns `(blocks, returned_bytes, next_offset, oversized_block)`.
fn read_block_page(
    tx: &Connection,
    id: &str,
    offset: u64,
    limit: u64,
    max_block_bytes: u64,
    bounded: bool,
) -> Result<(Vec<Value>, usize, u64, Option<Value>)> {
    let mut stmt = tx.prepare("SELECT ordinal,rowid,byte_offset FROM searchidx.document_blocks WHERE note_id=?1 AND ordinal>=?2 ORDER BY ordinal LIMIT ?3")?;
    let mut rows = stmt.query(params![id, offset as i64, limit as i64])?;
    let mut blocks = Vec::new();
    let mut returned_bytes = 0;
    let mut next = offset;
    let mut oversized = None;
    while let Some(row) = rows.next()? {
        let ordinal: i64 = row.get(0)?;
        let blob = tx.blob_open("searchidx", "document_blocks", "html", row.get(1)?, true)?;
        let byte_count = blob.len();
        if bounded && blocks.is_empty() && byte_count > max_block_bytes as usize {
            oversized = Some(
                json!({"ordinal":ordinal,"byte_offset":row.get::<_,i64>(2)?,"byte_count":byte_count}),
            );
            next = ordinal as u64;
            break;
        }
        if !blocks.is_empty()
            && (returned_bytes + byte_count > PAGE_BYTES
                || (bounded && byte_count > max_block_bytes as usize))
        {
            break;
        }
        let mut source = vec![0; byte_count];
        blob.read_at_exact(&mut source, 0)?;
        let html = String::from_utf8(source)
            .map_err(|_| EngineError::internal("invalid cached block UTF-8"))?;
        returned_bytes += html.len();
        next = ordinal as u64 + 1;
        blocks.push(json!({"ordinal":ordinal,"byte_offset":row.get::<_,i64>(2)?,"html":html}));
    }
    Ok((blocks, returned_bytes, next, oversized))
}

/// Lossless raw UTF-8 bytes inside one cached block. Fragments may begin/end
/// inside HTML tags or entities; this is NOT standalone editable HTML.
/// The mandatory revision pins every chunk to the same canonical document.
pub fn block_window(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .filter(|v| crate::ids::valid_id(v))
        .ok_or_else(|| EngineError::invalid("bad id"))?;
    let revision = args
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|v| *v > 0)
        .ok_or_else(|| EngineError::invalid("document_block_window requires revision"))?;
    let ordinal = args
        .get("ordinal")
        .and_then(Value::as_i64)
        .filter(|v| *v >= 0)
        .ok_or_else(|| EngineError::invalid("bad ordinal"))?;
    let number = |key: &str, default: u64| -> Result<u64> {
        args.get(key)
            .map(|v| {
                v.as_u64()
                    .ok_or_else(|| EngineError::invalid(format!("bad {key}")))
            })
            .unwrap_or(Ok(default))
    };
    let offset = number("offset", 0)?;
    let limit = number("limit", 16 * 1024)?;
    // Four bytes guarantee progress for any UTF-8 scalar at a valid boundary.
    if offset > i64::MAX as u64 || !(4..=64 * 1024).contains(&limit) {
        return Err(EngineError::invalid("invalid block window bounds"));
    }
    let tx = conn.unchecked_transaction()?;
    let (format, actual, cached): (String, i64, Option<i64>) = tx.query_row(
        "SELECT m.content_format,m.revision,c.revision FROM notes_meta m LEFT JOIN searchidx.document_layout c ON c.note_id=m.id WHERE m.id=?1",
        [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))
    ).optional()?.ok_or_else(|| EngineError::NotFound("note".into()))?;
    if format != "html" {
        return Err(EngineError::invalid(
            "HTML block operation requires an HTML note",
        ));
    }
    if actual != revision {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    if cached != Some(revision) {
        return Ok(
            json!({"ready":false,"revision":revision,"ordinal":ordinal,"source":null,"next_offset":null}),
        );
    }
    let (rowid, byte_start): (i64, i64) = tx.query_row(
        "SELECT rowid,byte_offset FROM searchidx.document_blocks WHERE note_id=?1 AND ordinal=?2",
        params![id,ordinal], |r| Ok((r.get(0)?,r.get(1)?))
    ).optional()?.ok_or_else(|| EngineError::NotFound("document block".into()))?;
    let blob = tx.blob_open("searchidx", "document_blocks", "html", rowid, true)?;
    let total = blob.len();
    if offset > total as u64 {
        return Err(EngineError::invalid("block window offset beyond source"));
    }
    let offset = offset as usize;
    let mut source = vec![0; (total - offset).min(limit as usize)];
    blob.read_at_exact(&mut source, offset)?;
    if source.first().is_some_and(|b| b & 0xc0 == 0x80) {
        return Err(EngineError::invalid("block window offset splits UTF-8"));
    }
    match std::str::from_utf8(&source) {
        Ok(_) => {}
        Err(e) if e.error_len().is_none() && offset + source.len() < total => {
            // Only an incomplete final scalar can be omitted. Invalid bytes
            // elsewhere are corruption, never repaired with replacement chars.
            source.truncate(e.valid_up_to());
        }
        Err(_) => return Err(EngineError::internal("invalid cached block UTF-8")),
    }
    let source = String::from_utf8(source)
        .map_err(|_| EngineError::internal("invalid cached block UTF-8"))?;
    let next = offset + source.len();
    Ok(json!({"ready":true,"revision":revision,"ordinal":ordinal,
        "block_byte_offset":byte_start,"offset":offset,"source":source,
        "total_bytes":total,"next_offset":if next < total {Some(next)} else {None}}))
}

/// Search the cached text of one document. No canonical body or HTML parsing on
/// this read path; results are bounded and pinned to a mandatory revision.
pub fn find(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| crate::ids::valid_id(id))
        .ok_or_else(|| EngineError::invalid("bad id"))?;
    let revision = args
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|v| *v > 0)
        .ok_or_else(|| EngineError::invalid("document_find requires revision"))?;
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .filter(|q| !q.is_empty() && q.chars().count() <= crate::limits::MAX_QUERY_CHARS)
        .ok_or_else(|| EngineError::invalid("bad query"))?;
    let integer = |key: &str, default: u64| -> Result<u64> {
        args.get(key)
            .map(|v| {
                v.as_u64()
                    .ok_or_else(|| EngineError::invalid(format!("bad {key}")))
            })
            .unwrap_or(Ok(default))
    };
    let offset = integer("offset", 0)?;
    let limit = integer("limit", 32)?;
    if offset > i64::MAX as u64 || !(1..=64).contains(&limit) {
        return Err(EngineError::invalid("invalid search bounds"));
    }
    let sensitive = args
        .get("case_sensitive")
        .map(|v| {
            v.as_bool()
                .ok_or_else(|| EngineError::invalid("bad case_sensitive"))
        })
        .unwrap_or(Ok(false))?;
    let needle = if sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let tx = conn.unchecked_transaction()?;
    let format: String = tx.query_row(
        "SELECT content_format FROM notes_meta WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    if format != "html" {
        return Err(EngineError::invalid(
            "HTML block operation requires an HTML note",
        ));
    }

    let (actual, cached): (i64, Option<i64>) = tx.query_row("SELECT m.revision,c.revision FROM notes_meta m LEFT JOIN searchidx.document_layout c ON c.note_id=m.id WHERE m.id=?1", [id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?.ok_or_else(|| EngineError::NotFound("note".into()))?;
    if actual != revision {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    if cached != Some(revision) {
        return Ok(json!({"ready":false,"revision":revision,"items":[],"next_offset":null}));
    }
    let field = if sensitive {
        "search_text"
    } else {
        "search_folded"
    };
    let sql = format!("SELECT ordinal,search_text FROM searchidx.document_blocks WHERE note_id=?1 AND ordinal>=?2 AND instr({field},?3)>0 ORDER BY ordinal LIMIT ?4");
    let mut statement = tx.prepare(&sql)?;
    let mut rows = statement.query(params![id, offset as i64, needle, limit as i64 + 1])?;
    let mut items = Vec::new();
    let mut next_offset = None;
    let mut last = offset;
    while let Some(row) = rows.next()? {
        if items.len() == limit as usize {
            next_offset = Some(last + 1);
            break;
        }
        last = row.get::<_, i64>(0)? as u64;
        let text: String = row.get(1)?;
        let snippet = match_snippet(&text, &needle, sensitive);
        items.push(json!({"ordinal":last,"snippet":snippet}));
    }
    Ok(json!({"ready":true,"revision":revision,"items":items,"next_offset":next_offset}))
}

/// Up to 180 chars of `text` starting 40 chars before the first match.
fn match_snippet(text: &str, needle: &str, sensitive: bool) -> String {
    let matched = if sensitive {
        text.find(needle)
    } else {
        text.to_lowercase().find(needle)
    }
    .unwrap_or(0);
    let mut position: usize = 0;
    let mut bytes = 0;
    for ch in text.chars() {
        if bytes >= matched {
            break;
        }
        bytes += if sensitive {
            ch.len_utf8()
        } else {
            ch.to_lowercase().map(char::len_utf8).sum()
        };
        position += 1;
    }
    let start = position.saturating_sub(40);
    text.chars().skip(start).take(180).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn search_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(crate::schema::SEARCH_SCHEMA_SQL)
            .unwrap();
        conn
    }
    fn cached(conn: &Connection, id: &str) -> Vec<(i64, i64, String, String, String)> {
        conn.prepare("SELECT ordinal,byte_offset,html,search_text,search_folded FROM document_blocks WHERE note_id=?1 ORDER BY ordinal")
            .unwrap().query_map([id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))
            .unwrap().collect::<std::result::Result<_,_>>().unwrap()
    }
    #[test]
    fn reuses_unchanged_blocks_and_matches_clean_rebuild() {
        let conn = search_db();
        let original = "<p>앞</p><p>중간</p><p>끝</p>";
        rebuild(&conn, "reuse", 1, original).unwrap();
        conn.execute_batch("CREATE TABLE writes(kind TEXT);            CREATE TRIGGER body_write AFTER UPDATE OF html ON document_blocks BEGIN INSERT INTO writes VALUES('body'); END;            CREATE TRIGGER delete_write AFTER DELETE ON document_blocks BEGIN INSERT INTO writes VALUES('delete'); END;            CREATE TRIGGER insert_write AFTER INSERT ON document_blocks BEGIN INSERT INTO writes VALUES('insert'); END;").unwrap();
        let changed = "<p>앞</p><p><strong>긴 中간 😀</strong></p><p>끝</p>";
        rebuild(&conn, "reuse", 2, changed).unwrap();
        let writes: Vec<String> = conn
            .prepare("SELECT kind FROM writes")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(writes, vec!["body"]);
        rebuild(&conn, "clean", 2, changed).unwrap();
        assert_eq!(cached(&conn, "reuse"), cached(&conn, "clean"));
        // Byte offsets must shift even though the final block's text is reused.
        assert_eq!(
            cached(&conn, "reuse")[2].1,
            changed.find("<p>끝").unwrap() as i64
        );
        for (revision, html) in [
            "<p>하나</p>",
            "<p>하나</p><p>둘</p>",
            "<p>malformed<p>뒤",
            "<p>한글</p><p>복원</p>",
        ]
        .iter()
        .enumerate()
        {
            rebuild(&conn, "reuse", revision as i64 + 3, html).unwrap();
            conn.execute("DELETE FROM document_layout WHERE note_id='clean'", [])
                .unwrap();
            rebuild(&conn, "clean", revision as i64 + 3, html).unwrap();
            assert_eq!(cached(&conn, "reuse"), cached(&conn, "clean"));
        }
    }
    #[test]
    fn inserted_and_removed_blocks_preserve_reused_text_and_ordinals() {
        let conn = search_db();
        let original = "<p>앞</p><p>중간</p><p>끝</p>";
        rebuild(&conn, "note", 1, original).unwrap();
        rebuild(&conn, "other", 1, original).unwrap();
        let other = cached(&conn, "other");
        conn.execute_batch("CREATE TABLE writes(kind TEXT);            CREATE TRIGGER body_write AFTER UPDATE OF html ON document_blocks BEGIN INSERT INTO writes VALUES('body'); END;            CREATE TRIGGER insert_write AFTER INSERT ON document_blocks BEGIN INSERT INTO writes VALUES('insert'); END;            CREATE TRIGGER delete_write AFTER DELETE ON document_blocks BEGIN INSERT INTO writes VALUES('delete'); END;").unwrap();
        let inserted = "<p>새 문단😀</p><p>앞</p><p>중간</p><p>끝</p>";
        rebuild(&conn, "note", 2, inserted).unwrap();
        let writes: Vec<String> = conn
            .prepare("SELECT kind FROM writes")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(writes, vec!["insert"]);
        conn.execute("DELETE FROM writes", []).unwrap();
        rebuild(&conn, "note", 3, original).unwrap();
        let writes: Vec<String> = conn
            .prepare("SELECT kind FROM writes")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(writes, vec!["delete"]);
        assert_eq!(cached(&conn, "note"), other);
        assert_eq!(cached(&conn, "other"), other);
    }
    #[test]
    fn resized_cache_matches_fresh_rebuild_for_insert_delete_and_replace() {
        let conn = search_db();
        let original = [
            "<p>같음😀</p>",
            "<p>같음😀</p>",
            "<!--간격--><p>세 번째</p>",
            "<details><summary>접기</summary><p>내용</p></details>",
        ];
        let additions = ["<p>추가&amp;😀</p>", "<hr>", "<p>같음😀</p>"];
        for start in 0..=original.len() {
            for remove in 0..=original.len() - start {
                for add in 0..=additions.len() {
                    conn.execute("DELETE FROM document_layout", []).unwrap();
                    rebuild(&conn, "reuse", 1, &original.concat()).unwrap();
                    let html = [
                        original[..start].concat(),
                        additions[..add].concat(),
                        original[start + remove..].concat(),
                    ]
                    .concat();
                    rebuild(&conn, "reuse", 2, &html).unwrap();
                    rebuild(&conn, "fresh", 2, &html).unwrap();
                    assert_eq!(
                        cached(&conn, "reuse"),
                        cached(&conn, "fresh"),
                        "start={start} remove={remove} add={add}"
                    );
                    let layout = |id| {
                        conn.query_row("SELECT revision,block_count,byte_count,content_hash FROM document_layout WHERE note_id=?1",[id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,Vec<u8>>(3)?))).unwrap()
                    };
                    assert_eq!(layout("reuse"), layout("fresh"));
                }
            }
        }
    }
    #[test]
    fn suffix_move_failure_rolls_back_temporary_ordinals() {
        let conn = search_db();
        let original = "<p>첫째</p><p>둘째</p><p>셋째</p>";
        rebuild(&conn, "note", 1, original).unwrap();
        let baseline = cached(&conn, "note");
        conn.execute_batch("CREATE TRIGGER fail_move BEFORE UPDATE OF ordinal ON document_blocks WHEN NEW.ordinal<0 AND OLD.ordinal=2 BEGIN SELECT RAISE(ABORT,'test failure'); END; SAVEPOINT index_note;").unwrap();
        assert!(rebuild(&conn, "note", 2, &format!("<p>추가</p>{original}")).is_err());
        conn.execute_batch("ROLLBACK TO index_note; RELEASE index_note;")
            .unwrap();
        assert_eq!(cached(&conn, "note"), baseline);
        assert_eq!(
            conn.query_row(
                "SELECT revision FROM document_layout WHERE note_id='note'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        conn.execute_batch("DROP TRIGGER fail_move;").unwrap();
        rebuild(&conn, "note", 2, &format!("<p>추가</p>{original}")).unwrap();
        assert_eq!(cached(&conn, "note").len(), 4);
    }
    #[test]
    fn incomplete_cache_is_rebuilt_and_failed_updates_roll_back() {
        let conn = search_db();
        let original = "<p>앞</p><p>뒤</p>";
        rebuild(&conn, "note", 1, original).unwrap();
        conn.execute(
            "DELETE FROM document_blocks WHERE note_id='note' AND ordinal=1",
            [],
        )
        .unwrap();
        let changed = "<p>변경</p><p>뒤</p>";
        rebuild(&conn, "note", 2, changed).unwrap();
        assert_eq!(cached(&conn, "note").len(), 2);
        let baseline = cached(&conn, "note");
        conn.execute_batch("CREATE TRIGGER fail_update BEFORE UPDATE ON document_blocks WHEN NEW.ordinal=1 BEGIN SELECT RAISE(ABORT,'test failure'); END; SAVEPOINT index_note;").unwrap();
        assert!(rebuild(&conn, "note", 3, "<p>다시 변경</p><p>뒤</p>").is_err());
        conn.execute_batch("ROLLBACK TO index_note; RELEASE index_note;")
            .unwrap();
        assert_eq!(cached(&conn, "note"), baseline);
        assert_eq!(
            conn.query_row(
                "SELECT revision FROM document_layout WHERE note_id='note'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
    }
    #[test]
    #[ignore = "manual block reindex benchmark"]
    fn benchmark_single_block_reindex() {
        let conn = search_db();
        let html = (0..10000)
            .map(|i| format!("<p>문단 {i:05} 검색 본문</p>"))
            .collect::<String>();
        let mut full = Vec::new();
        let mut incremental = Vec::new();
        let mut append = Vec::new();
        for sample in 0..5 {
            let id = format!("note{sample}");
            let start = std::time::Instant::now();
            rebuild(&conn, &id, 1, &html).unwrap();
            full.push(start.elapsed().as_micros());
            let edited = html.replace("문단 05000", "수정 05000");
            let start = std::time::Instant::now();
            rebuild(&conn, &id, 2, &edited).unwrap();
            incremental.push(start.elapsed().as_micros());
            let appended = format!("{edited}<p>추가 문단</p>");
            let start = std::time::Instant::now();
            rebuild(&conn, &id, 3, &appended).unwrap();
            append.push(start.elapsed().as_micros());
        }
        full.sort();
        incremental.sort();
        append.sort();
        println!(
            "10000 blocks: full median {}us; single changed block median {}us; append median {}us",
            full[2], incremental[2], append[2]
        );
    }
    #[test]
    fn preserves_nested_markup_quotes_comments_and_unicode() {
        let html = " \n<p title='한글 > 글자'>가 <strong>나</strong><br>다</p><!-- gap > -->\n<details><summary>제목</summary><div><p>본문</p></div></details><hr><table><colgroup><col></colgroup><tbody><tr><td>표</td></tr></tbody></table>\n<!--tail-->";
        let blocks = ranges(html);
        assert_eq!(blocks.len(), 4);
        assert_eq!(
            blocks.iter().map(|r| &html[r.clone()]).collect::<String>(),
            html
        );
        assert!(html[blocks[1].clone()].contains("<details>"));
    }
    #[test]
    fn ambiguous_source_is_one_unchanged_block() {
        for html in [
            "",
            "plain 한글",
            "<strong>inline</strong><p>block</p>",
            "<p>a<p>b",
            "<p><b>x</p>",
            "<p title='>",
            "<script>if(x<y){}</script><p>x</p>",
            "<svg><path/></svg><p>x</p>",
            "<p/>tail",
            "<p>a</p>tail",
            "<!--",
            "<!DOCTYPE html><p>x</p>",
        ] {
            assert_eq!(ranges(html), vec![0..html.len()], "{html}");
        }
    }
}
