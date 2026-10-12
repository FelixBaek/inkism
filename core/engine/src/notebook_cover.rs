//! Notebook cover photo (main schema v15, `notebooks.cover`, canonical JSON).
//!
//! Two kinds, both validated here so local saves, sync and backups share one rule:
//!   * `unsplash`   – hotlinked `images.unsplash.com` photo plus the credit
//!                    Unsplash requires (author, author profile, photo id).
//!   * `attachment` – a local image stored in the attachment database,
//!                    referenced by the same `/api/attachments/<uuid>` URL notes use.
//! Unknown fields are dropped, so the stored value is always canonical.

use crate::error::{EngineError, Result};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

const MAX_URL: usize = 600;
const MAX_AUTHOR_CHARS: usize = 80;
const MAX_AUTHOR_URL: usize = 300;

fn bad(what: &str) -> EngineError {
    EngineError::invalid(format!("invalid notebook cover: {what}"))
}

fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key).and_then(Value::as_str).ok_or_else(|| bad(key))
}

fn clean(s: &str) -> bool {
    !s.chars().any(char::is_control)
}

fn image_url(s: &str) -> bool {
    s.len() <= MAX_URL && clean(s) && !s.contains(['"', '\'', '<', '>', ' ', '\\']) && s.starts_with("https://images.unsplash.com/")
}

fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|u| u.to_string() == s)
}

/// Validate one cover object and return its canonical stored form.
pub fn validate(v: &Value) -> Result<Value> {
    match text(v, "kind")? {
        "unsplash" => validate_unsplash(v),
        "attachment" => {
            let url = text(v, "url")?;
            match url.strip_prefix("/api/attachments/") {
                Some(id) if uuid(id) => Ok(json!({"kind":"attachment","url":url})),
                _ => Err(bad("url")),
            }
        }
        _ => Err(bad("kind")),
    }
}

fn validate_unsplash(v: &Value) -> Result<Value> {
    let id = text(v, "unsplash_id")?;
    if id.is_empty() || id.len() > 32 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err(bad("unsplash_id"));
    }
    let (url, thumb) = (text(v, "url")?, text(v, "thumb")?);
    if !image_url(url) || !image_url(thumb) {
        return Err(bad("url"));
    }
    let author = text(v, "author")?.trim();
    if author.is_empty() || author.chars().count() > MAX_AUTHOR_CHARS || !clean(author) {
        return Err(bad("author"));
    }
    let author_url = text(v, "author_url")?;
    if author_url.len() > MAX_AUTHOR_URL || !clean(author_url) || author_url.contains(['"', '\'', '<', '>', ' ', '\\'])
        || !author_url.starts_with("https://unsplash.com/")
    {
        return Err(bad("author_url"));
    }
    Ok(json!({"kind":"unsplash","url":url,"thumb":thumb,"author":author,"author_url":author_url,"unsplash_id":id}))
}

/// `cover` argument: omitted = None (keep), null = Some(None) (remove),
/// object = Some(Some(canonical JSON)).
pub fn arg(args: &Value) -> Result<Option<Option<String>>> {
    match args.get("cover") {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(v @ Value::Object(_)) => Ok(Some(Some(validate(v)?.to_string()))),
        Some(_) => Err(bad("must be an object or null")),
    }
}

/// Resolve the cover to store for `id`: an omitted field (older peer or
/// rename-only call) keeps the current value. Caller owns the transaction.
pub fn resolve(conn: &Connection, id: &str, args: &Value) -> Result<Option<String>> {
    match arg(args)? {
        Some(next) => Ok(next),
        None => Ok(conn
            .query_row("SELECT cover FROM notebooks WHERE id=?1", [id], |r| r.get::<_, Option<String>>(0))
            .optional()?
            .flatten()),
    }
}

/// Stored text -> JSON value (null when absent or unreadable).
pub fn to_value(raw: Option<String>) -> Value {
    raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn photo() -> Value {
        json!({"kind":"unsplash","unsplash_id":"abc_1","url":"https://images.unsplash.com/photo-1?w=1080",
            "thumb":"https://images.unsplash.com/photo-1?w=400","author":"Kim","author_url":"https://unsplash.com/@kim?utm_source=inkism&utm_medium=referral","extra":1})
    }

    #[test]
    fn accepts_canonical_unsplash_and_attachment() {
        let v = validate(&photo()).unwrap();
        assert!(v.get("extra").is_none());
        assert_eq!(v["author"], "Kim");
        let a = json!({"kind":"attachment","url":"/api/attachments/0b6f3c55-2f1a-4c39-9d7e-0c3a3a5f1e2b"});
        assert_eq!(validate(&a).unwrap(), a);
    }

    #[test]
    fn rejects_foreign_hosts_and_bad_ids() {
        for (k, v) in [
            ("url", "https://evil.example/p.jpg"),
            ("url", "http://images.unsplash.com/p"),
            ("thumb", "https://images.unsplash.com.evil.example/p"),
            ("author_url", "https://evil.example/@kim"),
            ("author_url", "javascript:alert(1)"),
            ("unsplash_id", "../x"),
            ("author", " "),
            ("kind", "web"),
        ] {
            let mut p = photo();
            p[k] = json!(v);
            assert!(validate(&p).is_err(), "{k}={v}");
        }
        for url in ["/api/attachments/../x", "/api/attachments/0B6F3C55-2F1A-4C39-9D7E-0C3A3A5F1E2B", "https://x/api/attachments/0b6f3c55-2f1a-4c39-9d7e-0c3a3a5f1e2b"] {
            assert!(validate(&json!({"kind":"attachment","url":url})).is_err(), "{url}");
        }
        assert!(arg(&json!({"cover":"x"})).is_err());
        assert_eq!(arg(&json!({})).unwrap(), None);
        assert_eq!(arg(&json!({"cover":null})).unwrap(), Some(None));
    }
}
