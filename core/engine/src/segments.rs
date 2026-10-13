//! Derived, lossless internal windows for large HTML blocks. The worker records
//! source spans and the ancestors open at each edge. Querying reads only a span
//! of the existing block BLOB. Synthetic wrappers are never written to notes.
use crate::error::{EngineError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::ops::Range;

pub const LARGE_BLOCK_BYTES: usize = 64 * 1024;
pub const TARGET_BYTES: usize = 16 * 1024;
pub const MAX_SOURCE_BYTES: usize = 32 * 1024;
const MAX_CONTEXT_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Ancestor {
    pub tag: String,
    pub open: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub prelude: String,
    /// Byte offset of `open` (block-relative in the cache, note-absolute in
    /// pages). Lets an edit inside a large block give the enclosing block an
    /// identity with a bounded splice of just this opening tag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<u64>,
}
#[derive(Clone, Debug)]
pub struct Segment {
    pub range: Range<usize>,
    pub start_context: Vec<Ancestor>,
    pub end_context: Vec<Ancestor>,
}

fn inline(tag: &str) -> bool {
    matches!(
        tag,
        "strong"
            | "b"
            | "em"
            | "i"
            | "s"
            | "u"
            | "strike"
            | "del"
            | "span"
            | "mark"
            | "code"
            | "sub"
            | "sup"
            | "a"
            | "small"
    )
}
fn textblock(tag: &str) -> bool {
    matches!(tag, "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "pre")
}
fn void(tag: &str) -> bool {
    matches!(tag, "br" | "hr" | "img" | "col" | "input")
}
fn allowed(tag: &str) -> bool {
    inline(tag)
        || textblock(tag)
        || void(tag)
        || matches!(
            tag,
            "blockquote"
                | "div"
                | "details"
                | "summary"
                | "ul"
                | "ol"
                | "li"
                | "table"
                | "thead"
                | "tbody"
                | "tfoot"
                | "tr"
                | "td"
                | "th"
                | "colgroup"
                | "label"
        )
}
fn child_allowed(stack: &[Ancestor], tag: &str) -> bool {
    let parent = stack.last().map(|a| a.tag.as_str());
    if inline(tag)
        && !stack
            .iter()
            .any(|a| textblock(&a.tag) || a.tag == "summary")
        && !(tag == "span" && parent == Some("label"))
    {
        return false;
    }
    if tag == "a" && stack.iter().any(|a| a.tag == "a") {
        return false;
    }
    if !inline(tag) && tag != "br" && stack.iter().any(|a| textblock(&a.tag) || inline(&a.tag)) {
        return false;
    }
    match parent {
        Some("table") => matches!(tag, "thead" | "tbody" | "tfoot" | "colgroup"),
        Some("thead" | "tbody" | "tfoot") => tag == "tr",
        Some("tr") => matches!(tag, "td" | "th"),
        Some("colgroup") => tag == "col",
        Some("ul" | "ol") => tag == "li",
        Some("label") => matches!(tag, "input" | "span"),
        Some("li") if tag == "label" => true,
        _ => !matches!(
            tag,
            "thead"
                | "tbody"
                | "tfoot"
                | "tr"
                | "td"
                | "th"
                | "colgroup"
                | "col"
                | "li"
                | "label"
                | "input"
        ),
    }
}

// Scan exact source positions rather than infer them from the HTML tokenizer's
// normalized strings. Restrict to balanced editor markup, avoiding tree-builder
// recovery (implied end tags, table foster parenting, raw text, foreign content).
fn tag_at(source: &str, at: usize) -> Option<(usize, String, bool)> {
    let (mut i, name, closing) = tag_name(source, at)?;
    let bytes = source.as_bytes();
    let mut attrs = HashSet::new();
    loop {
        let before_space = i;
        i = skip_whitespace(bytes, i);
        if let Some(end) = tag_end(bytes, i, &name, closing) {
            return (name != "input" || attrs.contains("type")).then_some((end, name, closing));
        }
        if closing || before_space == i {
            return None;
        }
        let (attr_end, attr) = attr_name(source, i)?;
        if !attrs.insert(attr.clone()) || attr.starts_with("on") {
            return None;
        }
        let value;
        (i, value) = attr_value(source, attr_end)?;
        if !attr_allowed(&name, &attr, value) || i - at > TARGET_BYTES {
            return None;
        }
    }
}

/// `<name` or `</name` at `at`: returns the position after the name.
fn tag_name(source: &str, at: usize) -> Option<(usize, String, bool)> {
    let bytes = source.as_bytes();
    let mut i = at + 1;
    let closing = bytes.get(i) == Some(&b'/');
    if closing {
        i += 1;
    }
    let start = i;
    while bytes.get(i).is_some_and(u8::is_ascii_alphanumeric) {
        i += 1;
    }
    if i == start {
        return None;
    }
    let name = source[start..i].to_ascii_lowercase();
    allowed(&name).then_some((i, name, closing))
}

fn skip_whitespace(bytes: &[u8], mut i: usize) -> usize {
    while bytes.get(i).is_some_and(u8::is_ascii_whitespace) {
        i += 1;
    }
    i
}

/// Position after `>` (or a void element's `/>`) at `i`.
fn tag_end(bytes: &[u8], i: usize, name: &str, closing: bool) -> Option<usize> {
    if bytes.get(i) == Some(&b'>') {
        return Some(i + 1);
    }
    if bytes.get(i) == Some(&b'/') && bytes.get(i + 1) == Some(&b'>') && !closing && void(name) {
        return Some(i + 2);
    }
    None
}

fn attr_name(source: &str, begin: usize) -> Option<(usize, String)> {
    let bytes = source.as_bytes();
    let mut i = begin;
    while bytes
        .get(i)
        .is_some_and(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
    {
        i += 1;
    }
    if i == begin {
        return None;
    }
    Some((i, source[begin..i].to_ascii_lowercase()))
}

/// Optional `= value` after an attribute name ending at `attr_end`.
fn attr_value(source: &str, attr_end: usize) -> Option<(usize, Option<&str>)> {
    let bytes = source.as_bytes();
    let i = skip_whitespace(bytes, attr_end);
    if bytes.get(i) != Some(&b'=') {
        return Some((attr_end, None));
    }
    let i = skip_whitespace(bytes, i + 1);
    let quote = bytes.get(i).copied()?;
    let (end, value) = if quote == b'\'' || quote == b'"' {
        quoted_value(source, i + 1, quote)?
    } else {
        unquoted_value(source, i)?
    };
    Some((end, Some(value)))
}

fn quoted_value(source: &str, begin: usize, quote: u8) -> Option<(usize, &str)> {
    let bytes = source.as_bytes();
    let mut i = begin;
    while bytes.get(i).is_some_and(|b| *b != quote && *b != 0) {
        i += 1;
    }
    if bytes.get(i) != Some(&quote) {
        return None;
    }
    Some((i + 1, &source[begin..i]))
}

fn unquoted_value(source: &str, begin: usize) -> Option<(usize, &str)> {
    let bytes = source.as_bytes();
    let mut i = begin;
    while bytes
        .get(i)
        .is_some_and(|b| !b.is_ascii_whitespace() && *b != b'>')
    {
        if matches!(bytes[i], 0 | b'"' | b'\'' | b'<' | b'=' | b'`') {
            return None;
        }
        i += 1;
    }
    if begin == i {
        return None;
    }
    Some((i, &source[begin..i]))
}

fn attr_allowed(name: &str, attr: &str, value: Option<&str>) -> bool {
    // Only the known task list schema has a lossless custom-node layout.
    if attr == "data-type"
        && !matches!(
            (name, value),
            ("ul", Some("taskList")) | ("li", Some("taskItem"))
        )
    {
        return false;
    }
    !(name == "input" && attr == "type" && value != Some("checkbox"))
}

/// The returned ranges partition every byte exactly once. Contexts contain only
/// synthetic ancestors at the edges. Unsupported input has no guessed mapping.
pub fn split(source: &str) -> Option<Vec<Segment>> {
    if source.contains('\0') {
        return None;
    }
    let mut splitter = Splitter {
        source,
        stack: Vec::new(),
        open_offsets: Vec::new(),
        start_stack: Vec::new(),
        result: Vec::new(),
        context_bytes: 0,
        start: 0,
    };
    let mut at = 0;
    while at < source.len() {
        let (end, tag_action) = next_token(source, at, &splitter.stack)?;
        if end - at > TARGET_BYTES {
            return None;
        }
        if end - splitter.start > MAX_SOURCE_BYTES {
            splitter.cut(at);
        }
        if let Some(action) = tag_action {
            splitter.apply(at, end, action)?;
        }
        at = end;
        // Keep ordinary table rows/list items intact. A single giant row/item
        // still uses the hard byte bound, with its exact cell/paragraph context.
        if at - splitter.start >= TARGET_BYTES
            && !splitter
                .stack
                .iter()
                .any(|a| matches!(a.tag.as_str(), "tr" | "li" | "colgroup"))
        {
            splitter.cut(at);
        }
    }
    if !splitter.stack.is_empty() {
        return None;
    }
    Some(splitter.finish(at))
}

/// `(closing, ancestor)` for a start/end tag that changes the open stack.
type TagAction = (bool, Ancestor);

/// The token at `at`: its end and the stack change it causes, if any.
fn next_token(source: &str, at: usize, stack: &[Ancestor]) -> Option<(usize, Option<TagAction>)> {
    let bytes = source.as_bytes();
    if bytes[at..].starts_with(b"<!--") {
        let end = at + 4 + source[at + 4..].find("-->")? + 3;
        // A comment containing an earlier bogus terminator is opaque.
        if source[at + 4..end - 3].contains("--") {
            return None;
        }
        Some((end, None))
    } else if bytes[at] == b'<' {
        tag_token(source, at, stack)
    } else if bytes[at] == b'&' {
        Some((reference_end(bytes, at, stack)?, None))
    } else if bytes[at] == b'\r' && bytes.get(at + 1) == Some(&b'\n') {
        Some((at + 2, None))
    } else {
        let c = source[at..].chars().next()?;
        if !c.is_whitespace() && !in_text(stack) {
            return None;
        }
        Some((at + c.len_utf8(), None))
    }
}

fn in_text(stack: &[Ancestor]) -> bool {
    stack
        .iter()
        .any(|a| textblock(&a.tag) || a.tag == "summary")
}

fn tag_token(source: &str, at: usize, stack: &[Ancestor]) -> Option<(usize, Option<TagAction>)> {
    let (end, name, closing) = tag_at(source, at)?;
    let action = if closing {
        if void(&name) || stack.last()?.tag != name {
            return None;
        }
        Some((
            true,
            Ancestor {
                tag: name,
                open: String::new(),
                prelude: String::new(),
                at: None,
            },
        ))
    } else if !child_allowed(stack, &name) {
        return None;
    } else if void(&name) {
        None
    } else {
        if stack.len() >= 128 {
            return None;
        }
        Some((
            false,
            Ancestor {
                tag: name,
                open: source[at..end].to_string(),
                prelude: String::new(),
                at: Some(at as u64),
            },
        ))
    };
    Some((end, action))
}

/// End of a character reference starting with `&` at `at`.
fn reference_end(bytes: &[u8], at: usize, stack: &[Ancestor]) -> Option<usize> {
    if !in_text(stack) {
        return None;
    }
    // Never split a possible named/numeric reference. Include the
    // complete alphanumeric run even for legacy references without ';'.
    let mut end = at + 1;
    if bytes.get(end) == Some(&b'#') {
        end += 1;
    }
    while bytes.get(end).is_some_and(u8::is_ascii_alphanumeric) {
        end += 1;
    }
    if bytes.get(end) == Some(&b';') {
        end += 1;
    }
    Some(end)
}

struct Splitter<'a> {
    source: &'a str,
    stack: Vec<Ancestor>,
    open_offsets: Vec<usize>,
    start_stack: Vec<Ancestor>,
    result: Vec<Segment>,
    context_bytes: usize,
    start: usize,
}

impl Splitter<'_> {
    /// Ends the current segment at `at`; the next one starts there.
    fn cut(&mut self, at: usize) {
        let start_context = std::mem::replace(&mut self.start_stack, self.stack.clone());
        self.result.push(Segment {
            range: self.start..at,
            start_context,
            end_context: self.stack.clone(),
        });
        self.start = at;
    }

    fn apply(&mut self, at: usize, end: usize, (closing, ancestor): TagAction) -> Option<()> {
        if !closing {
            self.context_bytes += ancestor.open.len();
            if self.context_bytes > MAX_CONTEXT_BYTES {
                return None;
            }
            self.stack.push(ancestor);
            self.open_offsets.push(at);
            return Some(());
        }
        let old = self.stack.pop()?;
        let opened = self.open_offsets.pop()?;
        self.context_bytes -= old.open.len() + old.prelude.len();
        if old.tag == "colgroup" {
            // Synthetic table wrappers retain immutable column widths.
            let table = self.stack.last_mut()?;
            if table.tag != "table" {
                return None;
            }
            let columns = &self.source[opened..end];
            self.context_bytes += columns.len();
            if self.context_bytes > MAX_CONTEXT_BYTES {
                return None;
            }
            table.prelude.push_str(columns);
        }
        Some(())
    }

    /// Emits the tail, folding a tiny remainder into the previous segment.
    fn finish(mut self, at: usize) -> Vec<Segment> {
        if self.start < at {
            if at - self.start < 256
                && self
                    .result
                    .last()
                    .is_some_and(|s| at - s.range.start <= MAX_SOURCE_BYTES)
            {
                let last = self.result.last_mut().unwrap();
                last.range.end = at;
                last.end_context.clear();
            } else {
                self.result.push(Segment {
                    range: self.start..at,
                    start_context: self.start_stack,
                    end_context: Vec::new(),
                });
            }
        }
        self.result
    }
}

/// In the index_note savepoint, after top-level block updates. Identical body
/// revisions reuse the entire cache; changed bodies reuse unchanged large blocks.
pub fn refresh(
    conn: &Connection,
    id: &str,
    html: &str,
    digest: &[u8],
    ranges: Option<&[Range<usize>]>,
) -> Result<()> {
    let current: Option<Vec<u8>> = conn
        .query_row(
            "SELECT content_hash FROM document_segment_index WHERE note_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    if current.as_deref() == Some(digest) {
        return Ok(());
    }
    let computed;
    let ranges = match ranges {
        Some(r) => r,
        None => {
            computed = crate::blocks::ranges(html);
            &computed
        }
    };
    let mut large = HashSet::new();
    for (ordinal, range) in ranges
        .iter()
        .enumerate()
        .filter(|(_, r)| r.len() > LARGE_BLOCK_BYTES)
    {
        let ordinal = ordinal as i64;
        large.insert(ordinal);
        let source = &html[range.clone()];
        let hash = Sha256::digest(source.as_bytes());
        let old: Option<Vec<u8>> = conn.query_row("SELECT content_hash FROM document_segment_layout WHERE note_id=?1 AND block_ordinal=?2", params![id,ordinal], |r| r.get(0)).optional()?;
        if old.as_deref() == Some(hash.as_slice()) {
            continue;
        }
        let segments = split(source);
        conn.execute(
            "DELETE FROM document_segment_layout WHERE note_id=?1 AND block_ordinal=?2",
            params![id, ordinal],
        )?;
        conn.execute("INSERT INTO document_segment_layout(note_id,block_ordinal,content_hash,segment_count,supported) VALUES(?1,?2,?3,?4,?5)", params![id,ordinal,hash.as_slice(),segments.as_ref().map_or(0,Vec::len) as i64,segments.is_some()])?;
        if let Some(segments) = segments {
            let mut insert = conn.prepare_cached("INSERT INTO document_segments(note_id,block_ordinal,ordinal,byte_offset,byte_count,start_context,end_context) VALUES(?1,?2,?3,?4,?5,?6,?7)")?;
            for (index, segment) in segments.iter().enumerate() {
                insert.execute(params![
                    id,
                    ordinal,
                    index as i64,
                    segment.range.start as i64,
                    segment.range.len() as i64,
                    serde_json::to_string(&segment.start_context)?,
                    serde_json::to_string(&segment.end_context)?
                ])?;
            }
        }
    }
    let old = conn
        .prepare("SELECT block_ordinal FROM document_segment_layout WHERE note_id=?1")?
        .query_map([id], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for ordinal in old.into_iter().filter(|o| !large.contains(o)) {
        conn.execute(
            "DELETE FROM document_segment_layout WHERE note_id=?1 AND block_ordinal=?2",
            params![id, ordinal],
        )?;
    }
    conn.execute("INSERT INTO document_segment_index(note_id,content_hash) VALUES(?1,?2) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash", params![id,digest])?;
    Ok(())
}

/// One bounded page of internal segments at a mandatory canonical revision.
/// Unsupported large tokens/source are explicit; no raw partial HTML is passed
/// off as a self-contained rich fragment. Small blocks have one identity segment.
pub fn page(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| crate::ids::valid_id(s))
        .ok_or_else(|| EngineError::invalid("bad id"))?;
    let revision = args
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|n| *n > 0)
        .ok_or_else(|| EngineError::invalid("document_segments requires revision"))?;
    let ordinal = args
        .get("ordinal")
        .and_then(Value::as_i64)
        .filter(|n| *n >= 0)
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
    let limit = number("limit", 1)?;
    if offset > i64::MAX as u64 || !(1..=8).contains(&limit) {
        return Err(EngineError::invalid("invalid segment page bounds"));
    }
    let tx = conn.unchecked_transaction()?;
    let (format, actual, cached, indexed): (String,i64,Option<i64>,bool) = tx.query_row("SELECT m.content_format,m.revision,c.revision,s.content_hash IS NOT NULL AND s.content_hash=c.content_hash FROM notes_meta m LEFT JOIN searchidx.document_layout c ON c.note_id=m.id LEFT JOIN searchidx.document_segment_index s ON s.note_id=m.id WHERE m.id=?1", [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?.ok_or_else(|| EngineError::NotFound("note".into()))?;
    if format != "html" {
        return Err(EngineError::invalid(
            "HTML segment operation requires an HTML note",
        ));
    }
    if actual != revision {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    if cached != Some(revision) || !indexed {
        return Ok(
            json!({"ready":false,"revision":revision,"ordinal":ordinal,"segments":[],"total_segments":null,"next_offset":null}),
        );
    }
    let (rowid, byte_start): (i64,i64) = tx.query_row("SELECT rowid,byte_offset FROM searchidx.document_blocks WHERE note_id=?1 AND ordinal=?2", params![id,ordinal], |r| Ok((r.get(0)?,r.get(1)?))).optional()?.ok_or_else(|| EngineError::NotFound("document block".into()))?;
    let blob = tx.blob_open("searchidx", "document_blocks", "html", rowid, true)?;
    let layout: Option<(i64,bool)> = tx.query_row("SELECT segment_count,supported FROM searchidx.document_segment_layout WHERE note_id=?1 AND block_ordinal=?2", params![id,ordinal], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
    let (count, supported) = if blob.len() <= LARGE_BLOCK_BYTES {
        (1, true)
    } else {
        layout.ok_or_else(|| EngineError::internal("large block segment layout missing"))?
    };
    if !supported {
        return Ok(
            json!({"ready":true,"supported":false,"revision":revision,"ordinal":ordinal,"segments":[],"total_segments":0,"next_offset":null,"block_bytes":blob.len()}),
        );
    }
    if offset >= count as u64 {
        return Err(EngineError::invalid("segment offset beyond source"));
    }
    let out = if blob.len() <= LARGE_BLOCK_BYTES {
        vec![whole_block(&blob, byte_start)?]
    } else {
        read_segments(&tx, &blob, (id, ordinal), offset, limit, count, byte_start)?
    };
    let next = offset as usize + out.len();
    Ok(
        json!({"ready":true,"supported":true,"revision":revision,"ordinal":ordinal,"block_bytes":blob.len(),"total_segments":count,"segments":out,"next_offset":if next < count as usize {Some(next)} else {None}}),
    )
}

/// A small block's single identity segment.
fn whole_block(blob: &rusqlite::blob::Blob, byte_start: i64) -> Result<Value> {
    let mut bytes = vec![0; blob.len()];
    blob.read_at_exact(&mut bytes, 0)?;
    let source = String::from_utf8(bytes)
        .map_err(|_| EngineError::internal("invalid cached block UTF-8"))?;
    Ok(
        json!({"ordinal":0,"byte_offset":byte_start,"source":source,"start_context":[],"end_context":[]}),
    )
}

/// Cached segments `offset..offset+limit` of a large block, validated against the blob.
fn read_segments(
    tx: &rusqlite::Transaction,
    blob: &rusqlite::blob::Blob,
    (id, ordinal): (&str, i64),
    offset: u64,
    limit: u64,
    count: i64,
    byte_start: i64,
) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    let mut stmt = tx.prepare("SELECT ordinal,byte_offset,byte_count,start_context,end_context FROM searchidx.document_segments WHERE note_id=?1 AND block_ordinal=?2 AND ordinal>=?3 ORDER BY ordinal LIMIT ?4")?;
    let mut rows = stmt.query(params![id, ordinal, offset as i64, limit as i64])?;
    while let Some(row) = rows.next()? {
        let index: i64 = row.get(0)?;
        let start: i64 = row.get(1)?;
        let size: i64 = row.get(2)?;
        if start < 0
            || size <= 0
            || size as usize > MAX_SOURCE_BYTES
            || (start as u64 + size as u64) > blob.len() as u64
            || index != offset as i64 + out.len() as i64
        {
            return Err(EngineError::internal("invalid cached segment bounds"));
        }
        let mut bytes = vec![0; size as usize];
        blob.read_at_exact(&mut bytes, start as usize)?;
        let source = String::from_utf8(bytes)
            .map_err(|_| EngineError::internal("invalid cached segment UTF-8"))?;
        let start_context =
            absolute_context(segment_context(&row.get::<_, String>(3)?)?, byte_start);
        let end_context = absolute_context(segment_context(&row.get::<_, String>(4)?)?, byte_start);
        if start_context
            .iter()
            .chain(&end_context)
            .map(|a| a.open.len() + a.prelude.len())
            .sum::<usize>()
            > MAX_CONTEXT_BYTES * 2
        {
            return Err(EngineError::internal("oversized cached segment context"));
        }
        out.push(json!({"ordinal":index,"byte_offset":byte_start+start,"source":source,"start_context":start_context,"end_context":end_context}));
    }
    if out.len() != (limit as usize).min(count as usize - offset as usize) {
        return Err(EngineError::internal("incomplete cached segment page"));
    }
    Ok(out)
}

/// Cached ancestor offsets are block-relative; pages report note offsets.
fn absolute_context(context: Vec<Ancestor>, byte_start: i64) -> Vec<Ancestor> {
    context
        .into_iter()
        .map(|a| Ancestor {
            at: a.at.map(|at| at + byte_start as u64),
            ..a
        })
        .collect()
}

fn segment_context(json: &str) -> Result<Vec<Ancestor>> {
    serde_json::from_str(json).map_err(|_| EngineError::internal("invalid segment context"))
}

/// Find a window by canonical byte position after edits/reindexing. A `before`
/// bias selects the preceding span at an exact boundary; neither path reads the
/// body. The returned cursor remains the original UTF-8 byte position.
pub fn locate(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| crate::ids::valid_id(s))
        .ok_or_else(|| EngineError::invalid("bad id"))?;
    let revision = args
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|n| *n > 0)
        .ok_or_else(|| EngineError::invalid("document_locate requires revision"))?;
    let position = args
        .get("byte_offset")
        .and_then(Value::as_i64)
        .filter(|n| *n >= 0)
        .ok_or_else(|| EngineError::invalid("bad byte_offset"))?;
    let bias = args.get("bias").and_then(Value::as_str).unwrap_or("after");
    if !matches!(bias, "before" | "after") || args.get("bias").is_some_and(|v| !v.is_string()) {
        return Err(EngineError::invalid("bad locate bias"));
    }
    let tx = conn.unchecked_transaction()?;
    let (format, actual, cached, bytes, count, indexed):(String,i64,Option<i64>,Option<i64>,Option<i64>,bool) = tx.query_row("SELECT m.content_format,m.revision,c.revision,c.byte_count,c.block_count,s.content_hash IS NOT NULL AND s.content_hash=c.content_hash FROM notes_meta m LEFT JOIN searchidx.document_layout c ON c.note_id=m.id LEFT JOIN searchidx.document_segment_index s ON s.note_id=m.id WHERE m.id=?1",[id],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional()?.ok_or_else(|| EngineError::NotFound("note".into()))?;
    if format != "html" {
        return Err(EngineError::invalid("HTML locate requires an HTML note"));
    }
    if actual != revision {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    if cached != Some(revision) || !indexed {
        return Ok(json!({"ready":false,"revision":revision,"byte_offset":position}));
    }
    if position > bytes.unwrap_or(0) {
        return Err(EngineError::invalid("locate position beyond source"));
    }
    let seek = if bias == "before" || position == bytes.unwrap_or(0) {
        (position - 1).max(0)
    } else {
        position
    };
    let (ordinal,rowid,start):(i64,i64,i64) = tx.query_row("SELECT ordinal,rowid,byte_offset FROM searchidx.document_blocks WHERE note_id=?1 AND byte_offset<=?2 ORDER BY byte_offset DESC LIMIT 1",params![id,seek],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?.ok_or_else(|| EngineError::internal("cached block position missing"))?;
    let blob = tx.blob_open("searchidx", "document_blocks", "html", rowid, true)?;
    let cursor = position - start;
    if cursor < 0 || cursor as usize > blob.len() {
        return Err(EngineError::internal("invalid cached cursor bounds"));
    }
    check_char_boundary(&blob, cursor as usize)?;
    let (total, supported, segment) = if blob.len() <= LARGE_BLOCK_BYTES {
        (1, true, 0)
    } else {
        large_block_segment(&tx, id, ordinal, seek - start)?
    };
    Ok(
        json!({"ready":true,"supported":supported,"revision":revision,"byte_offset":position,"ordinal":ordinal,"offset":segment,"total_segments":total,"total_blocks":count,"block_bytes":blob.len()}),
    )
}

fn check_char_boundary(blob: &rusqlite::blob::Blob, cursor: usize) -> Result<()> {
    if cursor < blob.len() {
        let mut first = [0];
        blob.read_at_exact(&mut first, cursor)?;
        if first[0] & 0xc0 == 0x80 {
            return Err(EngineError::invalid("locate position splits UTF-8"));
        }
    }
    Ok(())
}

/// `(total, supported, segment)` of the cached segment containing `seek_in_block`.
fn large_block_segment(
    tx: &rusqlite::Transaction,
    id: &str,
    ordinal: i64,
    seek_in_block: i64,
) -> Result<(i64, bool, i64)> {
    let (total,supported):(i64,bool)=tx.query_row("SELECT segment_count,supported FROM searchidx.document_segment_layout WHERE note_id=?1 AND block_ordinal=?2",params![id,ordinal],|r| Ok((r.get(0)?,r.get(1)?)))?;
    let segment = if supported {
        tx.query_row("SELECT ordinal FROM searchidx.document_segments WHERE note_id=?1 AND block_ordinal=?2 AND byte_offset<=?3 ORDER BY byte_offset DESC LIMIT 1",params![id,ordinal,seek_in_block],|r|r.get::<_,i64>(0)).optional()?.ok_or_else(|| EngineError::internal("cached segment position missing"))?
    } else {
        0
    };
    Ok((total, supported, segment))
}
