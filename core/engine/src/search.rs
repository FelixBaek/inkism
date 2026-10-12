//! Field filters over metadata and the existing search cache.
//! User values are always bound; no query can read canonical note bodies.
use crate::error::{EngineError, Result};
use crate::limits;
use rusqlite::{types::Value, Connection};

const FIELDS: &[&str] = &[
    "title",
    "content",
    "tag",
    "color",
    "favorite",
    "pinned",
    "readonly",
    "locked",
    "archived",
    "tagged",
    "colored",
    "in_notebook",
    "created_after",
    "created_before",
    "edited_after",
    "edited_before",
];

fn tokens(query: &str) -> Result<Vec<&str>> {
    let mut out = Vec::new();
    let mut quoted = false;
    let mut start = 0;
    for (i, ch) in query.char_indices() {
        if ch == '"' {
            quoted = !quoted;
        }
        if ch.is_whitespace() && !quoted {
            if i > start {
                out.push(&query[start..i]);
            }
            start = i + ch.len_utf8();
        }
    }
    if quoted {
        return Err(EngineError::invalid("검색 조건의 따옴표를 닫아 주세요"));
    }
    if start < query.len() {
        out.push(&query[start..]);
    }
    Ok(out)
}

fn unquote(value: &str) -> Result<String> {
    if let Some(inner) = value.strip_prefix('"') {
        let inner = inner
            .strip_suffix('"')
            .ok_or_else(|| EngineError::invalid("검색 조건의 따옴표를 닫아 주세요"))?;
        Ok(inner.replace("\"\"", "\""))
    } else {
        Ok(value.to_string())
    }
}

fn bind(binds: &mut Vec<Value>, value: Value) -> String {
    binds.push(value);
    format!("?{}", binds.len())
}

fn escaped_like(query: &str) -> Value {
    Value::Text(format!(
        "%{}%",
        query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    ))
}

fn term_clause(query: &str, field: &str, binds: &mut Vec<Value>) -> String {
    if query.chars().count() >= 3 {
        let phrase = format!("\"{}\"", query.replace('"', "\"\""));
        let phrase = match field {
            "title" => format!("title:{phrase}"),
            "content" => format!("text:{phrase}"),
            _ => phrase,
        };
        let parameter = bind(binds, Value::Text(phrase));
        format!("m.seq IN (SELECT rowid FROM searchidx.notes_fts({parameter}))")
    } else {
        let parameter = bind(binds, escaped_like(query));
        let title = format!("m.title LIKE {parameter} ESCAPE '\\'");
        if field == "title" {
            return title;
        }
        // ponytail: short body terms inspect cached text per candidate; use
        // a bigram cache if this measured cost becomes a bottleneck.
        let body = format!("EXISTS (SELECT 1 FROM searchidx.notes_fts f WHERE f.rowid=m.seq AND f.text LIKE {parameter} ESCAPE '\\')");
        if field == "content" {
            body
        } else {
            format!("({title} OR {body})")
        }
    }
}

// SQLite supplies precedence (NOT, AND, OR). Only these fixed keywords can
// enter SQL; every word/quoted phrase remains a bound literal search term.
fn text_expression(query: &str, field: &str, binds: &mut Vec<Value>) -> Result<String> {
    let mut expression = String::new();
    let mut need_term = true;
    let mut negate = false;
    let mut conjunction = "AND";
    for token in tokens(query)? {
        match token {
            "AND" | "OR" => {
                if need_term {
                    return Err(EngineError::invalid(
                        "검색 연산자 앞뒤에 검색어를 입력해 주세요",
                    ));
                }
                conjunction = token;
                need_term = true;
            }
            "NOT" => {
                if !need_term {
                    conjunction = "AND";
                    need_term = true;
                }
                negate = !negate;
            }
            _ => {
                let term = unquote(token)?;
                if term.is_empty() {
                    return Err(EngineError::invalid("빈 검색어는 사용할 수 없습니다"));
                }
                push_term(
                    &mut expression,
                    conjunction,
                    negate,
                    &term_clause(&term, field, binds),
                );
                need_term = false;
                negate = false;
                conjunction = "AND";
            }
        }
    }
    if expression.is_empty() || need_term {
        return Err(EngineError::invalid(
            "검색 연산자 뒤에 검색어를 입력해 주세요",
        ));
    }
    Ok(format!("({})", expression.trim()))
}

fn push_term(expression: &mut String, conjunction: &str, negate: bool, clause: &str) {
    if !expression.is_empty() {
        expression.push_str(conjunction);
        expression.push(' ');
    }
    if negate {
        expression.push_str("NOT ");
    }
    expression.push('(');
    expression.push_str(clause);
    expression.push_str(") ");
}

pub(crate) fn append(
    conn: &Connection,
    query: &str,
    sql: &mut String,
    binds: &mut Vec<Value>,
) -> Result<()> {
    let query = query.trim();
    if query.chars().count() > limits::MAX_QUERY_CHARS {
        return Err(EngineError::invalid("query too long"));
    }
    if query.is_empty() {
        return Ok(());
    }
    let (filters, words) = split_filters(query)?;
    let text = words.join(" ");
    if !text.is_empty() {
        sql.push_str(&format!(" AND {}", text_expression(&text, "", binds)?));
    }
    append_alternatives(&filters, sql, binds);
    for (field, value) in filters {
        let clause = match field.as_str() {
            "tag" | "color" => continue,
            "title" | "content" => Some(if value.is_empty() {
                "0".to_string()
            } else {
                text_expression(&value, &field, binds)?
            }),
            "favorite" | "pinned" | "readonly" | "locked" | "archived" | "tagged" | "colored"
            | "in_notebook" => flag_clause(&field, &value),
            _ => date_clause(conn, &field, &value, binds)?,
        };
        match clause {
            Some(clause) => sql.push_str(&format!(" AND ({clause})")),
            None => sql.push_str(" AND 0"),
        }
    }
    Ok(())
}

type Filters = Vec<(String, String)>;

/// Splits `field:value` filters from free search words. Free words that
/// follow a filter extend its value, as in the original app.
fn split_filters(query: &str) -> Result<(Filters, Vec<&str>)> {
    let mut filters: Filters = Vec::new();
    let mut words = Vec::new();
    for token in tokens(query)? {
        let field_value = token
            .split_once(':')
            .map(|(field, value)| (field.to_ascii_lowercase(), value));
        if let Some((field, value)) =
            field_value.filter(|(field, _)| FIELDS.contains(&field.as_str()))
        {
            filters.push((field, value.to_string()));
        } else if let Some((_, value)) = filters.last_mut() {
            // The original keeps the current field until another supported
            // field begins: write free search words before field filters.
            value.push(' ');
            value.push_str(token);
        } else {
            words.push(token);
        }
    }
    for (field, value) in &mut filters {
        if field != "title" && field != "content" {
            *value = unquote(value)?;
        }
    }
    Ok((filters, words))
}

/// Repeated tag/color values are alternatives, matching the original app.
fn append_alternatives(filters: &[(String, String)], sql: &mut String, binds: &mut Vec<Value>) {
    for field in ["tag", "color"] {
        let values: Vec<_> = filters
            .iter()
            .filter(|(name, _)| name == field)
            .map(|(_, value)| value)
            .collect();
        if !values.is_empty() {
            let parameters: Vec<_> = values
                .iter()
                .map(|value| bind(binds, Value::Text((*value).clone())))
                .collect();
            let parameters = parameters.join(",");
            let clause = if field == "tag" {
                format!(
                    "EXISTS (SELECT 1 FROM json_each(m.tags) je WHERE je.value IN ({parameters}))"
                )
            } else {
                format!("m.color IN ({parameters})")
            };
            sql.push_str(&format!(" AND {clause}"));
        }
    }
}

/// `field:true|false` flag filters; `None` for any other value (no match).
fn flag_clause(field: &str, value: &str) -> Option<String> {
    let yes = match value {
        "true" => true,
        "false" => false,
        _ => return None,
    };
    let expression = match field {
        "favorite" => "m.favorite",
        "pinned" => "m.pinned",
        "readonly" => "m.readonly",
        "locked" => "m.locked",
        "archived" => "m.archived",
        "tagged" => "json_array_length(m.tags) > 0",
        "colored" => "m.color IS NOT NULL AND m.color != ''",
        "in_notebook" => "m.notebook_id IS NOT NULL",
        _ => unreachable!(),
    };
    Some(format!("({expression}) = {}", if yes { 1 } else { 0 }))
}

/// `created_/edited_ before/after:YYYY-MM-DD`; `None` for a malformed date.
fn date_clause(
    conn: &Connection,
    field: &str,
    value: &str,
    binds: &mut Vec<Value>,
) -> Result<Option<String>> {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit())
    {
        return Ok(None);
    }
    let column = if field.starts_with("created_") {
        "m.created_at"
    } else {
        "m.edited_at"
    };
    let comparison = if field.ends_with("after") { ">" } else { "<" };
    // Resolve device-local midnight once, outside the row scan.
    // The round trip rejects normalized dates such as February 30.
    let timestamp: Option<i64> = conn.query_row(
        "SELECT CASE WHEN date(?1,'+0 days')=?1 THEN unixepoch(?1,'utc')*1000 END",
        [value],
        |row| row.get(0),
    )?;
    Ok(Some(match timestamp {
        Some(timestamp) => {
            let parameter = bind(binds, Value::Integer(timestamp));
            format!("{column} {comparison} {parameter}")
        }
        None => "0".to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params_from_iter, Connection};

    #[test]
    fn expressions_preserve_precedence_scope_and_literal_values() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("ATTACH ':memory:' AS searchidx; CREATE TABLE notes_meta(seq INTEGER,title TEXT,archived INTEGER); CREATE VIRTUAL TABLE searchidx.notes_fts USING fts5(title,text,tokenize='trigram');").unwrap();
        for (seq, title, text, archived) in [
            (1, "alpha gamma", "monthly report", 0),
            (2, "alpha", "annual report", 0),
            (3, "beta gamma", "monthly detailed report", 0),
            (4, "beta gamma", "monthly report", 1),
            (5, "AND", "x' OR 1=1 --", 0),
            (6, "%_", "a\"b", 0),
        ] {
            db.execute(
                "INSERT INTO notes_meta VALUES(?1,?2,?3)",
                rusqlite::params![seq, title, archived],
            )
            .unwrap();
            db.execute(
                "INSERT INTO searchidx.notes_fts(rowid,title,text) VALUES(?1,?2,?3)",
                rusqlite::params![seq, title, text],
            )
            .unwrap();
        }
        for (query, expected) in [
            ("monthly report", vec![1, 3]),
            ("\"monthly report\"", vec![1]),
            ("alpha OR beta AND monthly", vec![1, 2, 3]),
            ("NOT alpha", vec![3, 5, 6]),
            ("alpha NOT gamma", vec![2]),
            ("alpha AND NOT gamma", vec![2]),
            ("NOT NOT alpha", vec![1, 2]),
            ("alpha OR beta NOT monthly", vec![1, 2]),
            ("title:alpha OR beta", vec![1, 2, 3]),
            ("title:\"alpha gamma\"", vec![1]),
            ("content:monthly AND NOT detailed", vec![1]),
            ("content:\"monthly report\"", vec![1]),
            ("\"AND\"", vec![5]),
            ("content:\"x' OR 1=1 --\"", vec![5]),
            ("\"%\"", vec![6]),
            ("\"_\"", vec![6]),
            ("content:\"a\"\"b\"", vec![6]),
            ("an", vec![2, 5]),
        ] {
            // An existing parameter and view condition must survive OR.
            let mut sql = "m.archived = ?1".to_string();
            let mut binds = vec![Value::Integer(0)];
            append(&db, query, &mut sql, &mut binds).unwrap();
            let mut stmt = db
                .prepare(&format!(
                    "SELECT seq FROM notes_meta m WHERE {sql} ORDER BY seq"
                ))
                .unwrap();
            let actual: Vec<i64> = stmt
                .query_map(params_from_iter(binds.iter()), |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            assert_eq!(actual, expected, "{query}");
        }
        for query in [
            "AND alpha",
            "OR alpha",
            "alpha AND",
            "alpha OR",
            "NOT",
            "alpha NOT",
            "alpha AND OR beta",
            "alpha OR NOT",
            "\"\"",
            "\"unfinished",
            "alpha\"unfinished",
            "title:alpha OR",
        ] {
            let mut sql = "m.archived = 0".to_string();
            assert!(
                append(&db, query, &mut sql, &mut Vec::new()).is_err(),
                "{query}"
            );
        }
    }

    #[test]
    fn filters_are_bound_and_preserve_view_and_literals() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("ATTACH ':memory:' AS searchidx; CREATE TABLE notes_meta(seq INTEGER,id TEXT,title TEXT,tags TEXT,color TEXT,favorite INTEGER,pinned INTEGER,archived INTEGER,trashed INTEGER,notebook_id TEXT,created_at INTEGER,updated_at INTEGER,edited_at INTEGER); CREATE VIRTUAL TABLE searchidx.notes_fts USING fts5(title,text,tokenize='trigram');").unwrap();
        let add = |seq: i64, title: &str, tags: &str, archive: i64| {
            db.execute(
                "INSERT INTO notes_meta VALUES(?1,?2,?2,?3,'red',1,0,?4,0,NULL,0,0,0)",
                rusqlite::params![seq, title, tags, archive],
            )
            .unwrap();
            db.execute(
                "INSERT INTO searchidx.notes_fts(rowid,title,text) VALUES(?1,?2,'보고 자료')",
                rusqlite::params![seq, title],
            )
            .unwrap();
        };
        add(1, "계획 회의", r#"["업무 자료"]"#, 0);
        add(2, "보관 회의", r#"["개인"]"#, 1);
        for (query, expected) in [
            ("회의 tag:\"업무 자료\" favorite:true", vec![1]),
            ("tag:\"업무 자료\" tag:개인 archived:true", vec![]),
            ("content:보고 tagged:true in_notebook:false", vec![1]),
            ("content:\"보고 자료\"", vec![1]),
            ("title:계획 회의", vec![1]),
            ("title:보관 archived:true", vec![]),
            ("favorite:TRUE", vec![]),
            ("favorite:true 회의", vec![]),
            ("TAG:\"업무 자료\"", vec![1]),
            ("tag:\"업무 자료\" tag:개인", vec![1]),
            ("tag:\"x' OR 1=1 --\"", vec![]),
            ("created_before:2026-01-01", vec![1]),
            ("created_before:2026-02-30", vec![]),
            ("created_before:yesterday", vec![]),
        ] {
            let mut sql = "m.trashed = 0 AND m.archived = 0".to_string();
            let mut binds = Vec::new();
            append(&db, query, &mut sql, &mut binds).unwrap();
            let mut stmt = db
                .prepare(&format!(
                    "SELECT seq FROM notes_meta m WHERE {sql} ORDER BY seq"
                ))
                .unwrap();
            let actual: Vec<i64> = stmt
                .query_map(params_from_iter(binds.iter()), |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            assert_eq!(actual, expected, "{query}");
        }
        let mut sql = "m.trashed = 0 AND m.archived = 1 AND m.color = ?1".to_string();
        let mut binds = vec![Value::Text("red".into())];
        append(&db, "title:보관", &mut sql, &mut binds).unwrap();
        let mut statement = db
            .prepare(&format!("SELECT seq FROM notes_meta m WHERE {sql}"))
            .unwrap();
        let found: Vec<i64> = statement
            .query_map(params_from_iter(binds.iter()), |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(found, vec![2]);
        append(&db, "archived:false", &mut sql, &mut binds).unwrap();
        assert!(sql.contains("m.archived = 1"));
        let mut sql = String::new();
        let mut binds = Vec::new();
        append(&db, "unknown:word", &mut sql, &mut binds).unwrap();
        assert_eq!(binds, vec![Value::Text("\"unknown:word\"".into())]);
        assert!(append(&db, "tag:\"unfinished", &mut sql, &mut binds).is_err());
        assert!(append(&db, &"x".repeat(201), &mut sql, &mut binds).is_err());
    }
}
