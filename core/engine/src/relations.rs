//! Typed relation search around one note: body links, title links, relation
//! properties and document parents. Locked/trashed notes never appear on either end.
use crate::{
    error::{EngineError, Result},
    ids, knowledge,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// Rows read per note and query; bounds fan-out before availability filtering.
const FANOUT: i64 = 200;
/// Notes expanded on the second hop.
const MAX_FRONTIER: usize = 50;
const KINDS: [&str; 4] = ["link", "title_link", "relation", "parent"];

const ID_LINKS_OUT: &str = "SELECT source_id,target_id,NULL FROM searchidx.backlinks WHERE source_id=?1 LIMIT ?2";
const ID_LINKS_IN: &str = "SELECT source_id,target_id,NULL FROM searchidx.backlinks WHERE target_id=?1 LIMIT ?2";
const TITLE_LINKS_OUT: &str = "SELECT source_id,target_title,NULL FROM searchidx.backlink_titles WHERE source_id=?1 LIMIT ?2";
const TITLE_LINKS_IN: &str = "SELECT source_id,target_title,NULL FROM searchidx.backlink_titles WHERE target_title COLLATE NOCASE IN (SELECT title FROM notes_meta WHERE id=?1 UNION SELECT a.value FROM settings s,json_each(s.value,'$.aliases') a WHERE s.key='knowledge_note:'||?1 AND json_valid(s.value)) LIMIT ?2";
const RELATIONS_OUT: &str = "SELECT ?1,v.value,json_extract(p.value,'$.name') FROM settings s,json_each(s.value,'$.properties') p,json_each(p.value,'$.value') v WHERE s.key='knowledge_note:'||?1 AND json_valid(s.value) AND json_extract(p.value,'$.type')='relation' LIMIT ?2";
const RELATIONS_IN: &str = "SELECT substr(s.key,16),?1,json_extract(p.value,'$.name') FROM settings s,json_each(s.value,'$.properties') p,json_each(p.value,'$.value') v WHERE s.key LIKE 'knowledge_note:%' AND json_valid(s.value) AND json_extract(p.value,'$.type')='relation' AND v.value=?1 LIMIT ?2";
const PARENT_OUT: &str = "SELECT ?1,json_extract(s.value,'$.document.parent_id'),NULL FROM settings s WHERE s.key='knowledge_note:'||?1 AND json_valid(s.value) AND json_type(s.value,'$.document.parent_id')='text' LIMIT ?2";
const PARENT_IN: &str = "SELECT substr(s.key,16),?1,NULL FROM settings s WHERE s.key LIKE 'knowledge_note:%' AND json_valid(s.value) AND json_extract(s.value,'$.document.parent_id')=?1 LIMIT ?2";

#[derive(Clone, PartialEq, Eq, Hash)]
struct Edge {
    source: String,
    target: String,
    kind: &'static str,
    property: Option<String>,
}

struct Query {
    kinds: HashSet<&'static str>,
    property: Option<String>,
    direction: &'static str,
    depth: u64,
    limit: usize,
}

fn invalid(message: &str) -> EngineError {
    EngineError::invalid(message)
}

fn parse_kinds(args: &Value) -> Result<HashSet<&'static str>> {
    let Some(raw) = args.get("kinds") else { return Ok(KINDS.into_iter().collect()) };
    let list = raw.as_array().ok_or_else(|| invalid("kinds must be an array"))?;
    let mut kinds = HashSet::new();
    for kind in list {
        let kind = KINDS.into_iter().find(|k| kind.as_str() == Some(k)).ok_or_else(|| invalid("unknown relation kind"))?;
        kinds.insert(kind);
        // "link" covers both link spellings ([[Title]] and note://id).
        if kind == "link" {
            kinds.insert("title_link");
        }
    }
    Ok(kinds)
}

fn parse(args: &Value) -> Result<Query> {
    let depth = args.get("depth").map_or(Some(1), Value::as_u64).filter(|d| (1..=2).contains(d)).ok_or_else(|| invalid("depth must be 1 or 2"))?;
    let direction = match args.get("direction").map_or(Some("both"), Value::as_str) {
        Some("out") => "out",
        Some("in") => "in",
        Some("both") => "both",
        _ => return Err(invalid("direction must be out, in or both")),
    };
    let property = match args.get("property") {
        None | Some(Value::Null) => None,
        Some(Value::String(p)) if !p.trim().is_empty() && p.chars().count() <= 80 => Some(p.to_lowercase()),
        _ => return Err(invalid("invalid property")),
    };
    let limit = args.get("limit").map_or(Some(50), Value::as_u64).filter(|l| (1..=200).contains(l)).ok_or_else(|| invalid("limit must be 1..200"))? as usize;
    Ok(Query { kinds: parse_kinds(args)?, property, direction, depth, limit })
}

/// Title of a note visible to relation search, cached per request.
fn visible<'a>(conn: &Connection, cache: &'a mut HashMap<String, Option<String>>, id: &str) -> Result<Option<&'a String>> {
    if !cache.contains_key(id) {
        let title = conn.query_row("SELECT title FROM notes_meta WHERE id=?1 AND locked=0 AND trashed=0", [id], |r| r.get(0)).optional()?;
        cache.insert(id.to_owned(), title);
    }
    Ok(cache[id].as_ref())
}

/// Unique visible note for a [[Title]]/alias target; ambiguous titles resolve to nothing, like graph_get.
fn resolve_title(conn: &Connection, raw: &str) -> Result<Option<String>> {
    let target = knowledge::target_note(raw);
    let mut stmt = conn.prepare_cached("SELECT n.id FROM notes_meta n LEFT JOIN settings s ON s.key='knowledge_note:'||n.id AND json_valid(s.value) WHERE n.trashed=0 AND n.locked=0 AND (n.title=?1 COLLATE NOCASE OR EXISTS(SELECT 1 FROM json_each(s.value,'$.aliases') a WHERE a.value=?1 COLLATE NOCASE)) LIMIT 2")?;
    let found = stmt.query_map([target], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(if found.len() == 1 { found.into_iter().next() } else { None })
}

fn rows(conn: &Connection, sql: &str, id: &str) -> Result<Vec<(String, String, Option<String>)>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let found = stmt.query_map(params![id, FANOUT], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(found)
}

fn push_rows(conn: &Connection, sql: &str, id: &str, kind: &'static str, out: &mut Vec<Edge>) -> Result<()> {
    for (source, target, property) in rows(conn, sql, id)? {
        out.push(Edge { source, target, kind, property });
    }
    Ok(())
}

fn push_title_links(conn: &Connection, id: &str, out: &mut Vec<Edge>) -> Result<()> {
    for sql in [TITLE_LINKS_OUT, TITLE_LINKS_IN] {
        for (source, title, _) in rows(conn, sql, id)? {
            let Some(target) = resolve_title(conn, &title)? else { continue };
            // Incoming rows matched by spelling only; keep them when the title really resolves here.
            if source == id || target == id {
                out.push(Edge { source, target, kind: "title_link", property: None });
            }
        }
    }
    Ok(())
}

/// Every typed edge touching `id`, unfiltered by visibility.
fn node_edges(conn: &Connection, id: &str, kinds: &HashSet<&'static str>) -> Result<Vec<Edge>> {
    let mut out = Vec::new();
    let sets: [(&'static str, [&str; 2]); 3] = [("link", [ID_LINKS_OUT, ID_LINKS_IN]), ("relation", [RELATIONS_OUT, RELATIONS_IN]), ("parent", [PARENT_OUT, PARENT_IN])];
    for (kind, queries) in sets {
        if !kinds.contains(kind) {
            continue;
        }
        for sql in queries {
            push_rows(conn, sql, id, kind, &mut out)?;
        }
    }
    if kinds.contains("title_link") {
        push_title_links(conn, id, &mut out)?;
    }
    Ok(out)
}

fn link_evidence(conn: &Connection, edge: &Edge) -> Result<Value> {
    let mut stmt = conn.prepare_cached("SELECT byte_offset,byte_end,label FROM searchidx.backlink_locations WHERE source_id=?1 AND (target='note://'||?2 OR target COLLATE NOCASE IN (SELECT title FROM notes_meta WHERE id=?2 UNION SELECT a.value FROM settings s,json_each(s.value,'$.aliases') a WHERE s.key='knowledge_note:'||?2 AND json_valid(s.value))) ORDER BY byte_offset LIMIT 1")?;
    let found = stmt.query_row(params![edge.source, edge.target], |r| Ok(json!({"byte_offset":r.get::<_,i64>(0)?,"byte_end":r.get::<_,i64>(1)?,"label":r.get::<_,String>(2)?}))).optional()?;
    Ok(found.unwrap_or(Value::Null))
}

fn evidence(conn: &Connection, edge: &Edge) -> Result<Value> {
    match edge.kind {
        "link" | "title_link" => link_evidence(conn, edge),
        "relation" => Ok(json!({"property":edge.property})),
        _ => Ok(Value::Null),
    }
}

fn accepts(q: &Query, edge: &Edge, direction: &str) -> bool {
    if edge.source == edge.target || (q.direction != "both" && q.direction != direction) {
        return false;
    }
    match &q.property {
        Some(p) => edge.property.as_ref().is_some_and(|name| name.to_lowercase() == *p),
        None => true,
    }
}

struct Walk<'c> {
    conn: &'c Connection,
    titles: HashMap<String, Option<String>>,
    seen: HashSet<Edge>,
    items: Vec<Value>,
    truncated: bool,
}

impl Walk<'_> {
    /// Adds the accepted edges of `node`; returns the newly reached neighbour ids.
    fn expand(&mut self, q: &Query, node: &str, hop: u64) -> Result<Vec<String>> {
        let mut reached = Vec::new();
        for edge in node_edges(self.conn, node, &q.kinds)? {
            let direction = if edge.source == node { "out" } else { "in" };
            if !accepts(q, &edge, direction) || self.seen.contains(&edge) {
                continue;
            }
            let Some(source_title) = visible(self.conn, &mut self.titles, &edge.source)?.cloned() else { continue };
            let Some(target_title) = visible(self.conn, &mut self.titles, &edge.target)?.cloned() else { continue };
            if self.items.len() == q.limit {
                self.truncated = true;
                break;
            }
            let other = if direction == "out" { &edge.target } else { &edge.source };
            reached.push(other.clone());
            self.items.push(json!({"source":edge.source,"target":edge.target,"source_title":source_title,"target_title":target_title,"kind":edge.kind,"property":edge.property,"direction":direction,"from":node,"hop":hop,"evidence":evidence(self.conn, &edge)?}));
            self.seen.insert(edge);
        }
        Ok(reached)
    }
}

/// {op:"relations",id,depth?,kinds?,property?,direction?,limit?} -> {items:[typed edge],truncated}
pub fn relations(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args.get("id").and_then(Value::as_str).filter(|v| ids::valid_id(v)).ok_or_else(|| invalid("bad id"))?;
    let q = parse(args)?;
    let mut walk = Walk { conn, titles: HashMap::new(), seen: HashSet::new(), items: Vec::new(), truncated: false };
    if visible(conn, &mut walk.titles, id)?.is_none() {
        return Err(EngineError::NotFound(format!("note {id}")));
    }
    let mut visited = HashSet::from([id.to_owned()]);
    let mut frontier = vec![id.to_owned()];
    for hop in 1..=q.depth {
        let mut next = Vec::new();
        for node in &frontier {
            for other in walk.expand(&q, node, hop)? {
                if visited.insert(other.clone()) {
                    next.push(other);
                }
            }
        }
        walk.truncated |= next.len() > MAX_FRONTIER && hop < q.depth;
        next.truncate(MAX_FRONTIER);
        frontier = next;
    }
    Ok(json!({"items":walk.items,"truncated":walk.truncated}))
}
