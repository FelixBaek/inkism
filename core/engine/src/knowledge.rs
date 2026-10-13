//! Synced note properties, aliases, saved views and writing preferences.
//! Settings rows are independently versioned; note bodies/revisions are untouched.
use crate::{
    error::{EngineError, Result},
    ids, model, ops_notes, settings,
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
pub const NOTE_PREFIX: &str = "knowledge_note:";
pub const REDIRECT_PREFIX: &str = "knowledge_redirect:";
pub const CONFIG_KEY: &str = "knowledge_config";
const MAX_NODES: usize = 5000;
const MAX_EDGES: usize = 20000;
fn invalid(message: &str) -> EngineError {
    EngineError::invalid(message)
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(&format!("missing {key}")))
}
fn bounded(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control)
}
pub fn is_key(key: &str) -> bool {
    key == CONFIG_KEY || key.strip_prefix(NOTE_PREFIX).is_some_and(ids::valid_id) || key.strip_prefix(REDIRECT_PREFIX).is_some_and(ids::valid_id)
}
pub fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || !b
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }
    let y = s[..4].parse::<u32>().unwrap_or(0);
    let m = s[5..7].parse::<u32>().unwrap_or(0);
    let d = s[8..].parse::<u32>().unwrap_or(0);
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    y > 0 && d > 0 && d <= days
}
pub fn validate_note(v: &Value) -> Result<()> {
    if v.to_string().len() > 64 * 1024 {
        return Err(invalid("note properties too large"));
    }
    let o = v
        .as_object()
        .ok_or_else(|| invalid("knowledge must be an object"))?;
    if o.keys()
        .any(|k| !["aliases", "properties", "document", "anchor_redirects"].contains(&k.as_str()))
    {
        return Err(invalid("unknown knowledge field"));
    }
    if let Some(document) = v.get("document") {
        validate_document(document)?;
    }
    if let Some(raw)=v.get("anchor_redirects") {
        let redirects=raw.as_object().ok_or_else(||invalid("anchor redirects must be an object"))?;
        if redirects.len()>128{return Err(invalid("too many anchor redirects"));}
        for (from,to) in redirects {
            let to=to.as_str().ok_or_else(||invalid("invalid anchor redirect"))?;
            if !bounded(from,256)||!bounded(to,256)||from.starts_with('#')||to.starts_with('#'){return Err(invalid("invalid anchor redirect"));}
            let mut current=from.as_str();let mut seen=HashSet::new();
            while let Some(next)=redirects.get(current){
                if !seen.insert(current)||seen.len()>16{return Err(invalid("anchor redirect cycle or chain too long"));}
                current=next.as_str().ok_or_else(||invalid("invalid anchor redirect"))?;
            }
        }
    }
    let aliases = v["aliases"]
        .as_array()
        .ok_or_else(|| invalid("aliases must be an array"))?;
    let properties = v["properties"]
        .as_array()
        .ok_or_else(|| invalid("properties must be an array"))?;
    if aliases.len() > 32 || properties.len() > 64 {
        return Err(invalid("too many aliases or properties"));
    }
    let mut seen = HashSet::new();
    for a in aliases {
        let a = a.as_str().ok_or_else(|| invalid("invalid alias"))?;
        if !bounded(a, 256) || a.contains(['[', ']', '#', '|']) || !seen.insert(a.to_lowercase()) {
            return Err(invalid("invalid or duplicate alias"));
        }
    }
    seen.clear();
    for p in properties {
        let name = string(p, "name")?;
        if !bounded(name, 80) || name.starts_with('$') || !seen.insert(name.to_lowercase()) {
            return Err(invalid("invalid or duplicate property name"));
        }
        if p.as_object().is_none_or(|o| {
            o.keys()
                .any(|k| !["name", "type", "value", "options", "definition_id"].contains(&k.as_str()))
        }) {
            return Err(invalid("invalid property"));
        }
        if p.get("definition_id").is_some_and(|id| !id.as_str().is_some_and(ids::valid_id)) { return Err(invalid("invalid property definition id")); }
        let options = p.get("options").and_then(Value::as_array);
        if let Some(raw) = p.get("options") {
            let a = raw
                .as_array()
                .ok_or_else(|| invalid("invalid property options"))?;
            let mut unique = HashSet::new();
            if a.len() > 64
                || a.iter().any(|v| {
                    !v.as_str()
                        .is_some_and(|s| bounded(s, 256) && unique.insert(s))
                })
            {
                return Err(invalid("invalid property options"));
            }
        }
        let valid = match string(p, "type")? {
            "attachment" => p["value"].as_str().is_some_and(|s|s.is_empty()||uuid::Uuid::parse_str(s).is_ok_and(|id|id.to_string()==s)),
            "select" => p["value"].as_str().is_some_and(|s| {
                s.is_empty() || options.is_some_and(|a| a.iter().any(|v| v.as_str() == Some(s)))
            }),
            "multiselect" | "relation" | "person" => p["value"].as_array().is_some_and(|a| {
                let mut unique = HashSet::new();
                a.len() <= 64
                    && a.iter().all(|v| {
                        v.as_str().is_some_and(|s| {
                            unique.insert(s)
                                && if p["type"] == "relation" {
                                    ids::valid_id(s)
                                } else if p["type"] == "multiselect" {
                                    options.is_some_and(|o| o.contains(v))
                                } else {
                                    bounded(s, 256)
                                }
                        })
                    })
            }),
            "text" => p["value"].as_str().is_some_and(|s| s.len() <= 8192),
            "number" => p["value"].as_f64().is_some_and(f64::is_finite),
            "checkbox" => p["value"].is_boolean(),
            "date" => p["value"].as_str().is_some_and(valid_date),
            "list" => p["value"].as_array().is_some_and(|a| {
                a.len() <= 64
                    && a.iter()
                        .all(|v| v.as_str().is_some_and(|s| bounded(s, 256)))
            }),
            _ => false,
        };
        if !valid {
            return Err(invalid("invalid typed property value"));
        }
    }
    Ok(())
}
pub fn validate_document(v: &Value) -> Result<()> {
    let o = v
        .as_object()
        .ok_or_else(|| invalid("invalid document settings"))?;
    if o.keys().any(|k| {
        ![
            "parent_id",
            "width",
            "spacing",
            "tone",
            "card_size",
            "card_shadow",
            "cover",
        ]
        .contains(&k.as_str())
    }) {
        return Err(invalid("unknown document setting"));
    }
    if let Some(parent) = v.get("parent_id") {
        if !parent.is_null() && !parent.as_str().is_some_and(ids::valid_id) {
            return Err(invalid("invalid parent"));
        }
    }
    for (key, allowed) in [
        ("width", &["standard", "wide", "full"][..]),
        ("spacing", &["compact", "normal", "relaxed"][..]),
        ("tone", &["default", "paper", "soft"][..]),
        ("card_size", &["small", "medium", "large"][..]),
    ] {
        if let Some(value) = v.get(key) {
            if !value.as_str().is_some_and(|s| allowed.contains(&s)) {
                return Err(invalid("invalid document style"));
            }
        }
    }
    if v.get("card_shadow").is_some_and(|v| !v.is_boolean()) {
        return Err(invalid("invalid card shadow"));
    }
    // Note cover photo: same rules as notebook covers, stored only in canonical form.
    if let Some(cover) = v.get("cover").filter(|c| !c.is_null()) {
        if crate::notebook_cover::validate(cover)? != *cover {
            return Err(invalid("invalid note cover"));
        }
    }
    Ok(())
}
fn validate_filter(filter: &Value) -> Result<()> {
    let property = string(filter, "property")?;
    if !(property.is_empty() || bounded(property, 80))
        || !["contains", "equals", "gt", "lt", "exists"].contains(&string(filter, "operator")?)
        || string(filter, "value")?.len() > 8192
    {
        return Err(invalid("invalid view filter"));
    }
    Ok(())
}
/// Small reusable definitions; inline annotations remain self-contained in note bodies.
fn validate_glossary(v: &Value) -> Result<()> {
    let Some(raw) = v.get("glossary") else { return Ok(()); };
    let entries = raw.as_array().ok_or_else(|| invalid("glossary must be an array"))?;
    if entries.len() > 1000 { return Err(invalid("too many glossary entries")); }
    let mut seen = HashSet::new();
    for entry in entries {
        let object = entry.as_object().ok_or_else(|| invalid("invalid glossary entry"))?;
        if object.keys().any(|key| !["id", "term", "definition", "noteId", "type", "lang"].contains(&key.as_str())) {
            return Err(invalid("unknown glossary field"));
        }
        let id = string(entry, "id")?;
        let definition = string(entry, "definition")?;
        if !ids::valid_id(id) || !seen.insert(id) || !bounded(string(entry, "term")?, 256)
            || definition.trim().is_empty() || definition.chars().count() > 4096
            || definition.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
            return Err(invalid("invalid glossary id, term or definition"));
        }
        if entry.get("noteId").is_some_and(|value| !value.as_str().is_some_and(ids::valid_id)) {
            return Err(invalid("invalid glossary note id"));
        }
        for (key, max) in [("type", 80), ("lang", 35)] {
            if entry.get(key).is_some_and(|value| !value.as_str().is_some_and(|s| bounded(s, max))) {
                return Err(invalid("invalid glossary metadata"));
            }
        }
    }
    Ok(())
}
pub fn validate_config(v: &Value) -> Result<()> {
    if v.to_string().len() > 256 * 1024 {
        return Err(invalid("knowledge settings too large"));
    }
    let o = v
        .as_object()
        .ok_or_else(|| invalid("invalid knowledge settings"))?;
    if o.keys()
        .any(|k| !["template_ids", "daily_template_id", "views", "style_presets", "property_definitions", "block_styles", "glossary"].contains(&k.as_str()))
    {
        return Err(invalid("unknown knowledge setting"));
    }
    validate_extensions(v)?;
    validate_glossary(v)?;
    let ids = v["template_ids"]
        .as_array()
        .ok_or_else(|| invalid("invalid template_ids"))?;
    if ids.len() > 100 || ids.iter().any(|v| !v.as_str().is_some_and(ids::valid_id)) {
        return Err(invalid("invalid template_ids"));
    }
    let unique: HashSet<_> = ids.iter().filter_map(Value::as_str).collect();
    if unique.len() != ids.len() {
        return Err(invalid("duplicate templates"));
    }
    if !v["daily_template_id"].is_null()
        && !v["daily_template_id"].as_str().is_some_and(ids::valid_id)
    {
        return Err(invalid("invalid daily template"));
    }
    let views = v["views"]
        .as_array()
        .ok_or_else(|| invalid("invalid views"))?;
    if views.len() > 100 {
        return Err(invalid("too many views"));
    }
    let mut seen = HashSet::new();
    for view in views {
        if !ids::valid_id(string(view, "id")?)
            || !seen.insert(string(view, "id")?)
            || !bounded(string(view, "name")?, 128)
            || !["table", "cards", "kanban"].contains(&string(view, "layout")?)
        {
            return Err(invalid("invalid saved view"));
        }
        validate_view_options(view)?;
        validate_calculations(view)?;
        validate_filter(&view["filter"])?;
        if let Some(filters) = view.get("filters") {
            let filters = filters
                .as_array()
                .ok_or_else(|| invalid("invalid filters"))?;
            if filters.len() > 8 {
                return Err(invalid("too many filters"));
            }
            for filter in filters {
                validate_filter(filter)?;
            }
        }
        if view
            .get("filter_mode")
            .is_some_and(|v| !matches!(v.as_str(), Some("all" | "any")))
        {
            return Err(invalid("invalid filter mode"));
        }
        if view
            .get("group_by")
            .is_some_and(|v| !v.as_str().is_some_and(|s| s.is_empty() || bounded(s, 80)))
        {
            return Err(invalid("invalid group property"));
        }
        {
            let sort = &view["sort"];
            let property = string(sort, "property")?;
            if !(property.is_empty() || bounded(property, 80))
                || !["asc", "desc"].contains(&string(sort, "direction")?)
            {
                return Err(invalid("invalid view sort"));
            }
        }
    }
    Ok(())
}
pub fn validate_setting(key: &str, s: &str) -> Result<()> {
    if s.len() > 256 * 1024 {
        return Err(invalid("knowledge setting too large"));
    }
    let v: Value = serde_json::from_str(s).map_err(|_| invalid("invalid knowledge JSON"))?;
    if key.strip_prefix(REDIRECT_PREFIX).is_some() {
        let target = v.get("target_id").and_then(Value::as_str).filter(|id| ids::valid_id(id)).ok_or_else(|| invalid("invalid redirect target"))?;
        if target == key.strip_prefix(REDIRECT_PREFIX).unwrap_or("") || v.get("source_revision").and_then(Value::as_i64).is_none_or(|revision| revision < 0) { return Err(invalid("invalid redirect")); }
        Ok(())
    } else if key == CONFIG_KEY {
        validate_config(&v)
    } else {
        validate_note(&v)
    }
}
fn defaults(config: bool) -> Value {
    if config {
        json!({"template_ids":[],"daily_template_id":null,"views":[]})
    } else {
        json!({"aliases":[],"properties":[]})
    }
}
fn read(conn: &Connection, key: &str) -> Result<Value> {
    let (raw, version) = settings::stored(conn, key)?.unwrap_or((None, 0));
    let mut v = match raw {
        Some(s) => serde_json::from_str(&s)?,
        None => defaults(key == CONFIG_KEY),
    };
    v["version"] = json!(version);
    Ok(v)
}
fn note_state(conn: &Connection, id: &str) -> Result<(i64, bool, bool, bool)> {
    if !ids::valid_id(id) {
        return Err(invalid("bad note id"));
    }
    conn.query_row(
        "SELECT revision,readonly,locked,trashed FROM notes_meta WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()?
    .ok_or_else(|| EngineError::NotFound(format!("note {id}")))
}
pub fn get(conn: &Connection, args: &Value) -> Result<Value> {
    let id = string(args, "id")?;
    if note_state(conn, id)?.2 {
        return Err(invalid("locked note metadata unavailable"));
    }
    let mut v = read(conn, &format!("{NOTE_PREFIX}{id}"))?;
    v["id"] = json!(id);
    Ok(v)
}
pub fn set(conn: &Connection, args: &Value) -> Result<Value> {
    let id = string(args, "id")?;

    let key = format!("{NOTE_PREFIX}{id}");
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        let (rev, readonly, locked, trashed) = note_state(conn, id)?;
        if readonly || locked || trashed {
            return Err(invalid("note is not editable"));
        }
        if args["revision"].as_i64() != Some(rev) {
            return Err(EngineError::Conflict("note revision changed".into()));
        }
        compare_version(conn, &key, args)?;
        // Merge optional fields so older clients cannot erase document settings.
        let mut data = read(conn, &key)?;
        data.as_object_mut().unwrap().remove("version");
        for field in ["aliases", "properties", "document", "anchor_redirects"] {
            if let Some(value) = args.get(field) {
                data[field] = value.clone();
            }
        }
        validate_note(&data)?;
        validate_bindings(conn, &data)?;
        let old = read(conn, &key)?;
        if data["document"]["parent_id"] != old["document"]["parent_id"] {
            let mut parent = data["document"]["parent_id"].as_str().map(str::to_owned);
            let mut visited = HashSet::from([id.to_owned()]);
            while let Some(current) = parent {
                if !visited.insert(current.clone()) || visited.len() > 128 {
                    return Err(invalid("page hierarchy cycle or too deep"));
                }
                let (_, _, locked, trashed) = note_state(conn, &current)?;
                if locked || trashed {
                    return Err(invalid("parent note unavailable"));
                }
                parent = read(conn, &format!("{NOTE_PREFIX}{current}"))?["document"]["parent_id"]
                    .as_str()
                    .map(str::to_owned);
            }
        }
        for property in data["properties"].as_array().unwrap() {
            if property["type"] != "relation" {
                continue;
            }
            for target in property["value"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(Value::as_str)
            {
                let existed = old["properties"].as_array().is_some_and(|a| {
                    a.iter().any(|p| {
                        p["type"] == "relation"
                            && p["value"]
                                .as_array()
                                .is_some_and(|v| v.contains(&json!(target)))
                    })
                });
                if !existed {
                    let (_, _, locked, trashed) = note_state(conn, target)?;
                    if locked || trashed {
                        return Err(invalid("relation note unavailable"));
                    }
                }
            }
        }
        settings::write_local(conn, &key, Some(&data.to_string()))?;
        get(conn, args)
    })();
    ops_notes::finish_tx(conn, result)
}
fn compare_version(conn: &Connection, key: &str, args: &Value) -> Result<()> {
    let version = settings::stored(conn, key)?.map(|(_, at)| at).unwrap_or(0);
    if args["version"].as_i64() != Some(version) {
        return Err(EngineError::Conflict("knowledge version changed".into()));
    }
    Ok(())
}
pub fn config_get(conn: &Connection) -> Result<Value> {
    read(conn, CONFIG_KEY)
}
pub fn config_set(conn: &Connection, args: &Value) -> Result<Value> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        compare_version(conn, CONFIG_KEY, args)?;
        let mut data = config_get(conn)?;
        data.as_object_mut().unwrap().remove("version");
        for key in ["template_ids", "daily_template_id", "views", "style_presets", "property_definitions", "block_styles", "glossary"] {
            if let Some(v) = args.get(key) {
                data[key] = v.clone();
            }
        }
        if data["property_definitions"] != config_get(conn)?["property_definitions"] { return Err(invalid("use collection_update to change shared definitions")); }
        if let Some(update) = args.get("collection_update") { apply_collection(conn, &mut data, update)?; }
        validate_config(&data)?;
        for id in data["template_ids"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .chain(data["daily_template_id"].as_str())
        {
            let (_, _, locked, trashed) = note_state(conn, id)?;
            if locked || trashed {
                return Err(invalid("template note unavailable"));
            }
        }
        settings::write_local(conn, CONFIG_KEY, Some(&data.to_string()))?;
        config_get(conn)
    })();
    ops_notes::finish_tx(conn, result)
}
pub fn list(conn: &Connection) -> Result<Value> {
    let mut stmt=conn.prepare("SELECT id,title,tags,revision,readonly,content_format,updated_at,notebook_id FROM notes_meta WHERE trashed=0 AND locked=0 ORDER BY updated_at DESC,id LIMIT 5001")?;
    let mut items = Vec::new();
    let mut total_bytes = 0;
    let mut byte_truncated = false;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let mut item = read(conn, &format!("{NOTE_PREFIX}{id}"))?;
        item["id"] = json!(id);
        item["title"] = json!(r.get::<_, String>(1)?);
        item["tags"] = serde_json::from_str(&r.get::<_, String>(2)?)?;
        item["revision"] = json!(r.get::<_, i64>(3)?);
        item["readonly"] = json!(r.get::<_, bool>(4)?);
        item["content_format"] = json!(r.get::<_, String>(5)?);
        item["updated_at"] = json!(r.get::<_, i64>(6)?);
        item["notebook_id"] = json!(r.get::<_, Option<String>>(7)?);
        total_bytes += item.to_string().len();
        if total_bytes > 4 * 1024 * 1024 {
            byte_truncated = true;
            break;
        }
        items.push(item);
    }
    let truncated = byte_truncated || items.len() > MAX_NODES;
    items.truncate(MAX_NODES);
    Ok(json!({"items":items,"truncated":truncated}))
}
fn title_key(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}
fn resolution_map(nodes: &[Value]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for n in nodes {
        let id = n["id"].as_str().unwrap();
        for title in std::iter::once(n["title"].as_str().unwrap()).chain(
            n["aliases"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(Value::as_str),
        ) {
            let entry = map.entry(title_key(title)).or_default();
            if !entry.iter().any(|s| s == id) {
                entry.push(id.to_owned());
            }
        }
    }
    map
}
/// Literal target only. Fragments and display labels do not change note resolution.
pub fn target_note(target: &str) -> &str {
    let target = target.trim();
    let target = target
        .strip_prefix("![[")
        .or_else(|| target.strip_prefix("[["))
        .and_then(|s| s.strip_suffix("]]"))
        .unwrap_or(target);
    target.split(['#', '|']).next().unwrap_or("").trim()
}
pub fn resolve(conn: &Connection, args: &Value) -> Result<Value> {
    let target = target_note(string(args, "target")?);
    if target.len() > 1024 {
        return Err(invalid("link target too long"));
    }
    let by_id = target.strip_prefix("note://").unwrap_or(target);
    let exact: Option<(String, String)> = conn
        .query_row(
            "SELECT id,title FROM notes_meta WHERE id=?1 AND trashed=0 AND locked=0",
            [by_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((id, title)) = exact {
        return Ok(json!({"items":[{"id":id,"title":title}],"ambiguous":false,"truncated":false}));
    }
    // Follow only retained, unlocked trashed originals. A restored live note
    // terminates the chain immediately. Permanent deletion of any intermediate
    // note intentionally breaks the link; a stale setting cannot bypass it.
    if let Some(source_id) = target.strip_prefix("note://") {
        let mut current = source_id.to_owned();
        let mut visited = HashSet::new();
        let mut sources = Vec::new();
        for _ in 0..=32 {
            if !visited.insert(current.clone()) { break; }
            let note: Option<(String, bool, bool)> = conn.query_row(
                "SELECT title,trashed,locked FROM notes_meta WHERE id=?1", [&current],
                |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
            ).optional()?;
            let Some((title, trashed, locked)) = note else { break; };
            if locked { break; }
            if !trashed {
                return Ok(json!({"items":[{"id":current,"title":title}],"ambiguous":false,"truncated":false,"redirected":!sources.is_empty(),"redirect_sources":sources}));
            }
            if sources.len() >= 32 { break; }
            let key = format!("{REDIRECT_PREFIX}{current}");
            let Some((Some(raw), _)) = settings::stored(conn, &key)? else { break; };
            let Ok(redirect) = serde_json::from_str::<Value>(&raw) else { break; };
            let Some(next) = redirect.get("target_id").and_then(Value::as_str).filter(|id| ids::valid_id(id)) else { break; };
            sources.push(current);
            current = next.to_owned();
        }
        return Ok(json!({"items":[],"ambiguous":false,"truncated":false}));
    }
    let mut stmt=conn.prepare("SELECT n.id,n.title FROM notes_meta n LEFT JOIN settings s ON s.key='knowledge_note:'||n.id WHERE n.trashed=0 AND n.locked=0 AND (n.title=?1 COLLATE NOCASE OR EXISTS(SELECT 1 FROM json_each(s.value,'$.aliases') a WHERE a.value=?1 COLLATE NOCASE)) ORDER BY n.id LIMIT 101")?;
    let mut items = stmt
        .query_map([target], |r| {
            Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?}))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let truncated = items.len() > 100;
    items.truncate(100);
    Ok(json!({"ambiguous":items.len()>1,"items":items,"truncated":truncated}))
}
pub fn graph(conn: &Connection) -> Result<Value> {
    let data = list(conn)?;
    let nodes = data["items"].as_array().unwrap();
    let available: HashSet<&str> = nodes.iter().filter_map(|n| n["id"].as_str()).collect();
    let titles = resolution_map(nodes);
    let mut edges = HashSet::new();
    let mut truncated = data["truncated"].as_bool().unwrap();
    for (table, column, is_title) in [
        ("backlinks", "target_id", false),
        ("backlink_titles", "target_title", true),
    ] {
        let mut stmt=conn.prepare(&format!("SELECT b.source_id,b.{column} FROM searchidx.{table} b JOIN notes_meta n ON n.id=b.source_id WHERE n.trashed=0 AND n.locked=0 ORDER BY b.source_id,b.{column} LIMIT 100001"))?;
        let mut rows = stmt.query([])?;
        let mut count = 0;
        while let Some(r) = rows.next()? {
            count += 1;
            if count > 100000 {
                truncated = true;
                break;
            }
            let source: String = r.get(0)?;
            let target: String = r.get(1)?;
            if !available.contains(source.as_str()) {
                continue;
            }
            let targets = if is_title {
                titles
                    .get(&title_key(target_note(&target)))
                    .cloned()
                    .unwrap_or_default()
            } else {
                vec![target]
            };
            // Ambiguous title/alias links remain unresolved instead of inventing edges.
            if targets.len() != 1 {
                continue;
            }
            let target = &targets[0];
            if available.contains(target.as_str()) {
                edges.insert((source, target.clone()));
            }
            if edges.len() > MAX_EDGES {
                truncated = true;
                break;
            }
        }
        if edges.len() > MAX_EDGES {
            break;
        }
    }
    for node in nodes {
        let source = node["id"].as_str().unwrap();
        let relations = node["properties"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["type"] == "relation")
            .flat_map(|p| {
                p["value"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(Value::as_str)
            });
        for target in node["document"]["parent_id"]
            .as_str()
            .into_iter()
            .chain(relations)
        {
            if available.contains(target) {
                edges.insert((source.to_owned(), target.to_owned()));
            }
            if edges.len() > MAX_EDGES {
                truncated = true;
                break;
            }
        }
        if edges.len() > MAX_EDGES {
            break;
        }
    }
    let mut edges: Vec<_> = edges.into_iter().collect();
    edges.sort();
    edges.truncate(MAX_EDGES);
    Ok(
        json!({"nodes":nodes,"edges":edges.into_iter().map(|(source,target)|json!({"source":source,"target":target})).collect::<Vec<_>>(),"truncated":truncated}),
    )
}
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn template_input(
    conn: &Connection,
    template: Option<&str>,
    title: &str,
    date: &str,
    time: &str,
    format: &str,
    id: Option<String>,
) -> Result<model::SaveInput> {
    if title.chars().count() > crate::limits::MAX_TITLE_CHARS {
        return Err(invalid("template title too long"));
    }
    let (content, format) = if let Some(template) = template {
        let n = ops_notes::get(conn, &json!({"id":template}))?;
        if n["locked"] == true || n["trashed"] == true {
            return Err(invalid("template unavailable"));
        }
        (
            n["content"].as_str().unwrap_or("").to_owned(),
            n["content_format"].as_str().unwrap_or("html").to_owned(),
        )
    } else {
        (String::new(), format.to_owned())
    };
    let encode = |value: &str| {
        if format == "html" {
            escape_html(value)
        } else {
            value.to_owned()
        }
    };
    let values = [
        ("{{date}}", encode(date)),
        ("{{time}}", encode(time)),
        ("{{title}}", encode(title)),
    ];
    // One pass: inserted values never become fresh template syntax.
    let mut output = String::with_capacity(content.len());
    let mut rest = content.as_str();
    while !rest.is_empty() {
        if let Some((token, value)) = values.iter().find(|(token, _)| rest.starts_with(token)) {
            if value.len() > crate::limits::MAX_CONTENT_BYTES.saturating_sub(output.len()) {
                return Err(invalid("expanded template too large"));
            }
            output.push_str(value);
            rest = &rest[token.len()..];
        } else {
            let ch = rest.chars().next().unwrap();
            if ch.len_utf8() > crate::limits::MAX_CONTENT_BYTES.saturating_sub(output.len()) {
                return Err(invalid("expanded template too large"));
            }
            output.push(ch);
            rest = &rest[ch.len_utf8()..];
        }
    }
    let text = if format == "html" {
        crate::source_format::search_text(&format, &output)?
    } else {
        output.clone()
    };
    let mut input: model::SaveInput = serde_json::from_value(
        json!({"id":id,"title":title,"content":output,"text":text,"content_format":format}),
    )?;
    input.notebook_id = Some(settings::default_notebook(conn)?);
    input.tags = settings::default_tag(conn)?.map(|tag| vec![tag]);
    ops_notes::validate_save(&input)?;
    Ok(input)
}
pub fn template_create(conn: &Connection, args: &Value) -> Result<Value> {
    let template = string(args, "template_id")?;
    let date = string(args, "date")?;
    let time = string(args, "time")?;
    if !valid_date(date) || !valid_time(time) {
        return Err(invalid("invalid template date/time"));
    }
    let title = args.get("title").and_then(Value::as_str).unwrap_or("");
    let input = template_input(conn, Some(template), title, date, time, "html", None)?;
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        let note = ops_notes::save_tx(conn, input)?;
        // Typed templates carry their properties (schema + default values) into each new note.
        let properties = read(conn, &format!("{NOTE_PREFIX}{template}"))?["properties"].clone();
        if properties.as_array().is_some_and(|p| !p.is_empty()) {
            let data = json!({"aliases":[],"properties":properties});
            validate_bindings(conn, &data)?;
            for target in properties.as_array().unwrap().iter().filter(|p| p["type"] == "relation").flat_map(|p| p["value"].as_array().cloned().unwrap_or_default()) {
                let (_, _, locked, trashed) = note_state(conn, target.as_str().unwrap_or(""))?;
                if locked || trashed { return Err(invalid("relation note unavailable")); }
            }
            settings::write_local(conn, &format!("{NOTE_PREFIX}{}", string(&note, "id")?), Some(&data.to_string()))?;
        }
        Ok(note)
    })();
    ops_notes::finish_tx(conn, result)
}
/// One atomic step: shared property definitions + a template note holding default values (+ optional saved view).
/// Re-running reuses same-named definitions/template/view; a same-named definition of another type is refused.
pub fn type_preset_apply(conn: &Connection, args: &Value) -> Result<Value> {
    let name = string(args, "name")?;
    if !bounded(name, 80) { return Err(invalid("invalid preset name")); }
    let content = string(args, "content")?;
    let wanted = args["properties"].as_array().filter(|p| !p.is_empty() && p.len() <= 32).ok_or_else(|| invalid("invalid preset properties"))?;
    let layout = args.get("view").and_then(Value::as_str);
    if layout.is_some_and(|l| !["table", "cards", "kanban"].contains(&l)) { return Err(invalid("invalid preset view")); }
    let mut input = template_input(conn, None, name, "", "", "html", None)?;
    input.text = Some(crate::source_format::search_text("html", content)?);
    input.content = Some(content.to_owned());
    ops_notes::validate_save(&input)?;
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        compare_version(conn, CONFIG_KEY, args)?;
        let mut config = config_get(conn)?;
        config.as_object_mut().unwrap().remove("version");
        let mut definitions = config["property_definitions"].as_array().cloned().unwrap_or_default();
        let mut properties = Vec::new();
        for p in wanted {
            let pname = string(p, "name")?;
            let kind = string(p, "type")?;
            let options = p.get("options").cloned();
            let id = match definitions.iter().find(|d| d["name"].as_str().is_some_and(|n| n.to_lowercase() == pname.to_lowercase())) {
                Some(d) if d["type"] != kind || d.get("options") != options.as_ref() => return Err(EngineError::Conflict(format!("property \"{pname}\" already exists with a different type or options"))),
                Some(d) => d["id"].clone(),
                None => {
                    let mut d = json!({"id":ids::new_id(),"name":pname,"type":kind});
                    if let Some(o) = &options { d["options"] = o.clone(); }
                    definitions.push(d.clone());
                    d["id"].clone()
                }
            };
            let d = definitions.iter().find(|d| d["id"] == id).unwrap();
            let mut property = d.clone();
            property.as_object_mut().unwrap().remove("id");
            property["definition_id"] = id;
            property["value"] = p.get("value").cloned().unwrap_or_else(|| default_property_value(kind));
            properties.push(property);
        }
        let data = json!({"aliases":[],"properties":properties});
        validate_note(&data)?;
        config["property_definitions"] = json!(definitions);
        let mut template_id = None;
        for id in config["template_ids"].as_array().unwrap().iter().filter_map(Value::as_str) {
            let n = ops_notes::get(conn, &json!({"id":id}))?;
            if n["title"] == name && n["trashed"] != true && n["locked"] != true { template_id = Some(id.to_owned()); break; }
        }
        let template_id = match template_id {
            Some(id) => id,
            None => {
                let note = ops_notes::save_tx(conn, input)?;
                let id = string(&note, "id")?.to_owned();
                settings::write_local(conn, &format!("{NOTE_PREFIX}{id}"), Some(&data.to_string()))?;
                config["template_ids"].as_array_mut().unwrap().push(json!(id));
                id
            }
        };
        if let Some(layout) = layout {
            if !config["views"].as_array().unwrap().iter().any(|v| v["name"] == name) {
                let first = properties[0]["name"].clone();
                let mut view = json!({"id":ids::new_id(),"name":name,"layout":layout,"filter":{"property":first,"operator":"exists","value":""},"sort":{"property":"$updated","direction":"desc"}});
                if layout == "kanban" { view["group_by"] = first; }
                config["views"].as_array_mut().unwrap().push(view);
            }
        }
        validate_config(&config)?;
        settings::write_local(conn, CONFIG_KEY, Some(&config.to_string()))?;
        Ok(json!({"template_id":template_id,"settings":config_get(conn)?}))
    })();
    ops_notes::finish_tx(conn, result)
}
fn valid_time(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && b.iter()
            .enumerate()
            .all(|(i, b)| i == 2 || b.is_ascii_digit())
        && s[..2].parse::<u32>().unwrap_or(99) < 24
        && s[3..].parse::<u32>().unwrap_or(99) < 60
}
pub fn daily(conn: &Connection, args: &Value) -> Result<Value> {
    let date = string(args, "date")?;
    if !valid_date(date) {
        return Err(invalid("invalid daily note date"));
    }
    let format = args
        .get("content_format")
        .and_then(Value::as_str)
        .unwrap_or("html");
    crate::source_format::validate(format)?;
    let id = format!("daily-{date}");
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        match note_state(conn, &id) {
            Ok((_, _, locked, trashed)) => {
                if locked || trashed {
                    return Err(invalid("daily note is locked or in trash"));
                }
                return ops_notes::get(conn, &json!({"id":id}));
            }
            Err(EngineError::NotFound(_)) => {}
            Err(e) => return Err(e),
        }
        let config = config_get(conn)?;
        let time = args.get("time").and_then(Value::as_str).unwrap_or("");
        if !time.is_empty() && !valid_time(time) {
            return Err(invalid("invalid daily time"));
        }
        let input = template_input(
            conn,
            config["daily_template_id"].as_str(),
            date,
            date,
            time,
            format,
            Some(id),
        )?;
        ops_notes::save_tx(conn, input)
    })();
    ops_notes::finish_tx(conn, result)
}

/// Backup metadata excludes local conflict tokens. The owning note is remapped by import.
pub fn backup_note(conn: &Connection, id: &str) -> Result<Value> {
    let mut v = read(conn, &format!("{NOTE_PREFIX}{id}"))?;
    v.as_object_mut().unwrap().remove("version");
    Ok(v)
}
pub fn import_note(
    conn: &Connection,
    id: &str,
    incoming: &Value,
    ids: &HashMap<&str, String>,
) -> Result<()> {
    validate_note(incoming)?;
    let mut v = incoming.clone();
    if let Some(parent) = incoming["document"]["parent_id"].as_str() {
        v["document"]["parent_id"] = ids.get(parent).map(|id| json!(id)).unwrap_or(Value::Null);
    }
    for property in v["properties"].as_array_mut().unwrap() {
        if property["type"] == "relation" {
            property["value"] = json!(property["value"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|v| ids.get(v.as_str().unwrap()))
                .collect::<Vec<_>>());
        }
    }
    settings::write_local(conn, &format!("{NOTE_PREFIX}{id}"), Some(&v.to_string()))
}
pub fn backup_config(conn: &Connection) -> Result<Value> {
    let mut v = config_get(conn)?;
    v.as_object_mut().unwrap().remove("version");
    let existing = |id: &str| -> Result<bool> {
        Ok(conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM notes_meta WHERE id=?1)",
            [id],
            |r| r.get(0),
        )?)
    };
    let mut templates = Vec::new();
    for id in v["template_ids"].as_array().unwrap() {
        if existing(id.as_str().unwrap())? {
            templates.push(id.clone());
        }
    }
    v["template_ids"] = json!(templates);
    if let Some(id) = v["daily_template_id"].as_str() {
        if !existing(id)? {
            v["daily_template_id"] = Value::Null;
        }
    }
    Ok(v)
}
pub fn import_config(
    conn: &Connection,
    incoming: &Value,
    ids: &HashMap<&str, String>,
) -> Result<()> {
    validate_config(incoming)?;
    let mut current = backup_config(conn)?;
    let templates = current["template_ids"].as_array_mut().unwrap();
    for id in incoming["template_ids"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
    {
        if let Some(new) = ids.get(id) {
            templates.push(json!(new));
        }
    }
    if current["daily_template_id"].is_null() {
        current["daily_template_id"] = incoming["daily_template_id"]
            .as_str()
            .and_then(|id| ids.get(id))
            .map(|id| json!(id))
            .unwrap_or(Value::Null);
    }
    let mut imported_view_ids=HashSet::new();
    let views = current["views"].as_array_mut().unwrap();
    for view in incoming["views"].as_array().unwrap() {
        let mut view = view.clone();
        if views.iter().any(|v| v["id"] == view["id"]) {
            view["id"] = json!(ids::new_id());
        }
        imported_view_ids.insert(string(&view,"id")?.to_owned());
        views.push(view);
    }
    let mut glossary = current["glossary"].as_array().cloned().unwrap_or_default();
    for entry in incoming["glossary"].as_array().into_iter().flatten() {
        let mut imported = entry.clone();
        if let Some(old) = entry["noteId"].as_str() {
            if let Some(new) = ids.get(old) { imported["noteId"] = json!(new); }
            else { imported.as_object_mut().unwrap().remove("noteId"); }
        }
        if let Some(existing) = glossary.iter().find(|item| item["id"] == imported["id"]) {
            // Never silently repoint imported inline annotations to a different definition.
            if existing != &imported { return Err(invalid("glossary id conflict in backup")); }
        } else { glossary.push(imported); }
    }
    if current.get("glossary").is_some() || incoming.get("glossary").is_some() {
        current["glossary"] = json!(glossary);
    }
    let mut definition_map = HashMap::new();
    for key in ["style_presets", "property_definitions", "block_styles"] {
        let mut merged = current[key].as_array().cloned().unwrap_or_default();
        for value in incoming[key].as_array().into_iter().flatten() {
            let original_id = string(value,"id")?.to_owned();
            let mut imported=value.clone();
            if let Some(existing)=merged.iter().find(|p|p["id"]==value["id"] && *p==value) {
                if key=="property_definitions" {definition_map.insert(original_id,existing.clone());}
                continue;
            }
            if merged.iter().any(|p|p["id"]==imported["id"]) {imported["id"]=json!(ids::new_id());}
            let base=string(value,"name")?.to_owned();let mut suffix=2;
            while merged.iter().any(|p|(key != "block_styles" || p["type"] == imported["type"]) && string(p,"name").is_ok_and(|name|name.to_lowercase()==imported["name"].as_str().unwrap().to_lowercase())) {
                imported["name"]=json!(format!("{} ({suffix})",base.chars().take(60).collect::<String>()));suffix+=1;
            }
            if key=="property_definitions" {definition_map.insert(original_id,imported.clone());}
            merged.push(imported);
        }
        current[key] = json!(merged);
    }
    for view in current["views"].as_array_mut().unwrap() {
        if imported_view_ids.contains(string(view,"id")?) {
            for original in incoming["property_definitions"].as_array().into_iter().flatten() {
                if let Some(mapped)=definition_map.get(string(original,"id")?) {rename_view_property(view,string(original,"name")?,string(mapped,"name")?);}
            }
        }
    }
    for new_id in ids.values() {
        let key=format!("{NOTE_PREFIX}{new_id}");
        let mut metadata=read(conn,&key)?;metadata.as_object_mut().unwrap().remove("version");
        let mut changed=false;
        for property in metadata["properties"].as_array_mut().unwrap() {
            if let Some(old_id)=property["definition_id"].as_str().map(str::to_owned) {
                changed=true;
                if let Some(definition)=definition_map.get(&old_id) {
                    if property["type"]!=definition["type"] || property["options"]!=definition["options"] {return Err(invalid("backup shared property does not match definition"));}
                    property["definition_id"]=definition["id"].clone();property["name"]=definition["name"].clone();
                } else {property.as_object_mut().unwrap().remove("definition_id");}
            }
        }
        if changed {validate_note(&metadata)?;settings::write_local(conn,&key,Some(&metadata.to_string()))?;}
    }
    validate_config(&current)?;
    settings::write_local(conn, CONFIG_KEY, Some(&current.to_string()))
}

/// Permanent deletion also removes independently stored properties and template references.
/// Caller owns the note-deletion transaction; tombstones travel through normal setting sync.
pub fn delete_local(conn: &Connection, id: &str) -> Result<()> {
    let key = format!("{NOTE_PREFIX}{id}");
    if settings::stored(conn, &key)?.is_some() {
        settings::write_local(conn, &key, None)?;
    }
    let mut config = config_get(conn)?;
    config.as_object_mut().unwrap().remove("version");
    let original = config.clone();
    config["template_ids"]
        .as_array_mut()
        .unwrap()
        .retain(|value| value.as_str() != Some(id));
    if config["daily_template_id"].as_str() == Some(id) {
        config["daily_template_id"] = Value::Null;
    }
    for entry in config["glossary"].as_array_mut().into_iter().flatten() {
        if entry["noteId"].as_str() == Some(id) { entry.as_object_mut().unwrap().remove("noteId"); }
    }
    if config != original {
        settings::write_local(conn, CONFIG_KEY, Some(&config.to_string()))?;
    }
    Ok(())
}

/// Child creation and its parent relationship commit together, including retry protection.
pub fn page_create(conn: &Connection, args: &Value) -> Result<Value> {
    let parent = string(args, "parent_id")?;
    let id = string(args, "id")?;
    if !ids::valid_id(id) || id == parent {
        return Err(invalid("invalid page id"));
    }
    let title = string(args, "title")?;
    if !bounded(title, 256) {
        return Err(invalid("invalid page title"));
    }
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        let (revision, readonly, locked, trashed) = note_state(conn, parent)?;
        if readonly || locked || trashed {
            return Err(invalid("parent note is not editable"));
        }
        if args["revision"].as_i64() != Some(revision) {
            return Err(EngineError::Conflict("parent note revision changed".into()));
        }
        if note_state(conn, id).is_ok() {
            if read(conn, &format!("{NOTE_PREFIX}{id}"))?["document"]["parent_id"] == parent {
                return ops_notes::get(conn, &json!({"id":id}));
            }
            return Err(EngineError::Conflict("page id already exists".into()));
        }
        let mut cursor = Some(parent.to_owned());
        let mut visited = HashSet::from([id.to_owned()]);
        while let Some(current) = cursor {
            if !visited.insert(current.clone()) || visited.len() > 128 {
                return Err(invalid("page hierarchy cycle or too deep"));
            }
            cursor = read(conn, &format!("{NOTE_PREFIX}{current}"))?["document"]["parent_id"]
                .as_str()
                .map(str::to_owned);
        }
        let source = ops_notes::get(conn, &json!({"id":parent}))?;
        let mut input = template_input(
            conn,
            None,
            title,
            "",
            "",
            source["content_format"].as_str().unwrap_or("html"),
            Some(id.to_owned()),
        )?;
        input.notebook_id = Some(source["notebook_id"].as_str().map(str::to_owned));
        let note = ops_notes::save_tx(conn, input)?;
        let data = json!({"aliases":[],"properties":[],"document":{"parent_id":parent}});
        settings::write_local(conn, &format!("{NOTE_PREFIX}{id}"), Some(&data.to_string()))?;
        Ok(note)
    })();
    ops_notes::finish_tx(conn, result)
}

fn validate_extensions(v: &Value) -> Result<()> {
    for key in ["style_presets", "property_definitions", "block_styles"] {
        let Some(values) = v.get(key) else { continue };
        let values = values.as_array().ok_or_else(|| invalid("invalid collection settings"))?;
        if values.len() > 100 { return Err(invalid("too many shared definitions or styles")); }
        let mut seen = HashSet::new();
        let mut names = HashSet::new();
        for entry in values {
            if !ids::valid_id(string(entry,"id")?) || !seen.insert(string(entry,"id")?) || !bounded(string(entry,"name")?,128) || !names.insert(if key == "block_styles" { json!([string(entry,"type")?,string(entry,"name")?.to_lowercase()]).to_string() } else { string(entry,"name")?.to_lowercase() }) { return Err(invalid("invalid or duplicate shared definition/style")); }
            if key == "style_presets" {
                if entry.as_object().unwrap().keys().any(|k| !["id","name","style"].contains(&k.as_str())) || entry["style"].get("parent_id").is_some() { return Err(invalid("style preset cannot contain hierarchy")); }
                validate_document(&entry["style"])?;
            } else if key == "block_styles" {
                if entry.as_object().unwrap().keys().any(|k| !["id","name","type","attrs"].contains(&k.as_str())) || !["paragraph","heading","blockquote","callout","codeBlock"].contains(&string(entry,"type")?) { return Err(invalid("invalid block style")); }
                let attrs=entry["attrs"].as_object().ok_or_else(|| invalid("invalid block style attributes"))?;
                for (key,value) in attrs { let valid=match key.as_str() { "textAlign"=>matches!(value.as_str(),Some("left"|"center"|"right"|"justify")),"dir"=>matches!(value.as_str(),Some("ltr"|"rtl")),_=>false }; if !valid {return Err(invalid("invalid block style attribute"));} }
            } else {
                if entry.as_object().unwrap().keys().any(|k| !["id","name","type","options"].contains(&k.as_str())) { return Err(invalid("invalid property definition")); }
                let mut p=entry.clone();p.as_object_mut().unwrap().remove("id");p["value"]=default_property_value(string(entry,"type")?);
                validate_note(&json!({"aliases":[],"properties":[p]}))?;
            }
        }
    }
    Ok(())
}
fn default_property_value(kind: &str) -> Value { match kind {"number"=>json!(0),"checkbox"=>json!(false),"list"|"multiselect"|"person"|"relation"=>json!([]),"date"=>json!("2000-01-01"),_=>json!("")} }
fn validate_calculations(view: &Value) -> Result<()> {
    if let Some(formulas)=view.get("formulas") {
        let formulas=formulas.as_array().ok_or_else(||invalid("invalid formulas"))?;
        if formulas.len()>8 {return Err(invalid("too many formulas"));}
        let mut ids_seen=HashSet::new();
        for f in formulas {if !ids::valid_id(string(f,"id")?) || !ids_seen.insert(string(f,"id")?) || !bounded(string(f,"name")?,80) || !bounded(string(f,"expression")?,512) {return Err(invalid("invalid formula"));}}
    }
    if let Some(a)=view.get("aggregate") {if !["count","sum","average","min","max"].contains(&string(a,"operation")?) || string(a,"property")?.len()>128 {return Err(invalid("invalid aggregate"));}}
    Ok(())
}
fn validate_bindings(conn: &Connection,data:&Value)->Result<()> {
    let config=config_get(conn)?;
    for p in data["properties"].as_array().unwrap() {
        if let Some(id)=p["definition_id"].as_str() {
            let d=config["property_definitions"].as_array().and_then(|defs|defs.iter().find(|d|d["id"]==id)).ok_or_else(||invalid("shared property definition unavailable"))?;
            if p["name"]!=d["name"] || p["type"]!=d["type"] || p["options"]!=d["options"] {return Err(invalid("shared property must be edited in collection settings"));}
        }
    }
    Ok(())
}
/// Atomic shared-schema migration and explicit selected-note value writes.
/// The client must supply revisions for every affected note, including off-page notes.
fn apply_collection(conn:&Connection,config:&mut Value,update:&Value)->Result<()> {
    let operation=string(update,"operation")?;
    if !["save","apply","remove"].contains(&operation) {return Err(invalid("invalid collection operation"));}
    let definition=&update["definition"];
    let id=string(definition,"id")?;
    let mut definitions=config["property_definitions"].as_array().cloned().unwrap_or_default();
    let previous=definitions.iter().find(|d|d["id"]==id).cloned();
    if operation!="save" && previous.is_none() {return Err(invalid("shared property unavailable"));}
    if operation=="apply" && previous.as_ref()!=Some(definition) {return Err(EngineError::Conflict("shared property changed".into()));}
    if operation!="apply" {definitions.retain(|d|d["id"]!=id);if operation=="save" {definitions.push(definition.clone());}}
    let candidate=json!({"property_definitions":definitions});validate_extensions(&candidate)?;
    let snapshots=update["notes"].as_array().ok_or_else(||invalid("missing collection note versions"))?;
    if snapshots.len()>500 {return Err(invalid("collection update limited to 500 notes"));}
    let mut targets=HashMap::new();
    for snapshot in snapshots {let note=string(snapshot,"id")?;if !ids::valid_id(note)||targets.insert(note,snapshot).is_some(){return Err(invalid("invalid collection note"));}}
    if operation!="apply" {
        let mut stmt=conn.prepare("SELECT key FROM settings WHERE key LIKE 'knowledge_note:%' AND value IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(settings.value,'$.properties') p WHERE json_extract(p.value,'$.definition_id')=?1) LIMIT 501")?;
        let rows=stmt.query_map([id],|r|r.get::<_,String>(0))?;
        for row in rows {let key=row?;
            if !targets.contains_key(key.trim_start_matches(NOTE_PREFIX)) {return Err(EngineError::Conflict("all linked notes must be loaded before changing this definition".into()));}
        }
    }
    for (note,snapshot) in targets {
        let(revision,readonly,locked,trashed)=note_state(conn,note)?;
        if readonly||locked||trashed {return Err(invalid("collection contains an unavailable or read-only note"));}
        if snapshot["revision"].as_i64()!=Some(revision) {return Err(EngineError::Conflict("note revision changed".into()));}
        let key=format!("{NOTE_PREFIX}{note}");compare_version(conn,&key,snapshot)?;
        let mut data=read(conn,&key)?;data.as_object_mut().unwrap().remove("version");
        let props=data["properties"].as_array_mut().unwrap();
        let existing=props.iter().position(|p|p["definition_id"]==id);
        if operation=="remove" {if let Some(index)=existing {props[index].as_object_mut().unwrap().remove("definition_id");}}
        else {
            if operation=="save"&&existing.is_none(){return Err(invalid("unexpected note in schema migration"));}
            let mut p=definition.clone();p.as_object_mut().unwrap().remove("id");p["definition_id"]=json!(id);
            let value=if operation=="apply" {update.get("value").ok_or_else(||invalid("missing bulk value"))?.clone()} else {props[existing.unwrap()]["value"].clone()};
            // No silent coercion: a type/option change must accept each exact existing value.
            p["value"]=value;
            if p["type"]=="relation" {for target in p["value"].as_array().into_iter().flatten().filter_map(Value::as_str){let(_,_,locked,trashed)=note_state(conn,target)?;if locked||trashed{return Err(invalid("relation note unavailable"));}}}
            if let Some(index)=existing {props[index]=p;} else {props.push(p);}
        }
        validate_note(&data)?;
        settings::write_local(conn,&key,Some(&data.to_string()))?;
    }
    if operation=="save" {
        if let Some(old)=previous {if old["name"]!=definition["name"] {
            let old_name=old["name"].as_str().unwrap();let new_name=definition["name"].as_str().unwrap();
            for view in config["views"].as_array_mut().unwrap() {rename_view_property(view,old_name,new_name);}
        }}
    }
    config["property_definitions"]=json!(definitions);
    Ok(())
}

fn validate_view_options(view:&Value)->Result<()> {
    let Some(card)=view.get("card") else {return Ok(());};
    let card=card.as_object().ok_or_else(||invalid("invalid card settings"))?;
    if card.keys().any(|k|!matches!(k.as_str(),"cover_property"|"visible_properties")){return Err(invalid("unknown card setting"));}
    if card.get("cover_property").is_some_and(|v|!v.as_str().is_some_and(|s|s.is_empty()||bounded(s,80))){return Err(invalid("invalid cover property"));}
    if let Some(properties)=card.get("visible_properties") {
        let properties=properties.as_array().filter(|p|p.len()<=32).ok_or_else(||invalid("invalid visible properties"))?;
        let mut seen=HashSet::new();for property in properties {let name=property.as_str().filter(|s|bounded(s,80)).ok_or_else(||invalid("invalid visible property"))?;if !seen.insert(name){return Err(invalid("duplicate visible property"));}}
    }
    Ok(())
}

fn rename_view_property(view:&mut Value,old_name:&str,new_name:&str) {
    if view["card"]["cover_property"]==old_name {view["card"]["cover_property"]=json!(new_name);}
    if let Some(properties)=view["card"]["visible_properties"].as_array_mut(){for property in properties.iter_mut() {if property==old_name {*property=json!(new_name);}}let mut seen=HashSet::new();properties.retain(|p|seen.insert(p.as_str().unwrap_or("").to_owned()));}

    for key in ["filter","sort","aggregate"] {if view[key]["property"]==old_name {view[key]["property"]=json!(new_name);}}
    if view["group_by"]==old_name {view["group_by"]=json!(new_name);}
    if let Some(filters)=view["filters"].as_array_mut(){for filter in filters {if filter["property"]==old_name {filter["property"]=json!(new_name);}}}
    if let Some(formulas)=view["formulas"].as_array_mut(){for formula in formulas {if let Some(expression)=formula["expression"].as_str(){formula["expression"]=json!(expression.replace(&format!("[{old_name}]"),&format!("[{new_name}]")));}}}
}

#[cfg(test)] mod card_options_tests {
 use super::*;
 #[test] fn validates_and_renames_card_property_references(){
  let mut view=json!({"card":{"cover_property":"Cover","visible_properties":["Cover","Score"]}});
  validate_view_options(&view).unwrap();rename_view_property(&mut view,"Cover","Image");
  assert_eq!(view["card"]["cover_property"],"Image");assert_eq!(view["card"]["visible_properties"][0],"Image");
  for card in [json!({"visible_properties":["a","a"]}),json!({"visible_properties":[1]}),json!({"cover_property":7}),json!({"url":"https://external.example"})] {assert!(validate_view_options(&json!({"card":card})).is_err());}
 }
}
