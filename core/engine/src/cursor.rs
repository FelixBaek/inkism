//! Date/title keyset cursor. Legacy cursors retain updated_at descending order.
//! New sort modes bind the cursor to its field and direction.

use crate::error::{EngineError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cursor {
    pub pinned: i64,
    pub timestamp: i64,
    pub id: String,
    pub sort_by: String,
    pub ascending: bool,
    pub title: Option<String>,
}

impl Cursor {
    pub fn encode(&self) -> String {
        if self.sort_by == "title" {
            // JSON escapes separators/control characters that titles may contain.
            return format!(
                "v3\u{1f}{}",
                serde_json::to_string(&(
                    self.pinned,
                    self.ascending,
                    self.title.as_deref().unwrap_or(""),
                    &self.id
                ))
                .expect("cursor fields serialize")
            );
        }
        // '\u{1f}' (unit separator) cannot appear in UUID ids or integers.
        let position = format!("{}\u{1f}{}\u{1f}{}", self.pinned, self.timestamp, self.id);
        if self.sort_by == "updated_at" && !self.ascending {
            position
        } else {
            format!(
                "v2\u{1f}{}\u{1f}{}\u{1f}{position}",
                self.sort_by,
                if self.ascending { "asc" } else { "desc" }
            )
        }
    }

    pub fn decode(s: &str) -> Result<Cursor> {
        if let Some(json) = s.strip_prefix("v3\u{1f}") {
            // A 2,000-character title can need six bytes per JSON-escaped character.
            if s.len() > crate::limits::MAX_TITLE_CHARS * 6 + 256 {
                return Err(EngineError::invalid("bad cursor"));
            }
            let (pinned, ascending, title, id): (i64, bool, String, String) =
                serde_json::from_str(json).map_err(|_| EngineError::invalid("bad cursor"))?;
            if !matches!(pinned, 0 | 1)
                || !crate::ids::valid_id(&id)
                || title.chars().count() > crate::limits::MAX_TITLE_CHARS
            {
                return Err(EngineError::invalid("bad cursor"));
            }
            return Ok(Cursor {
                pinned,
                timestamp: 0,
                id,
                sort_by: "title".into(),
                ascending,
                title: Some(title),
            });
        }
        if s.len() > 256 {
            return Err(EngineError::invalid("bad cursor"));
        }
        let mut it = s.split('\u{1f}');
        let first = it
            .next()
            .ok_or_else(|| EngineError::invalid("bad cursor"))?;
        let (sort_by, ascending, pinned) = if first == "v2" {
            let field = it
                .next()
                .filter(|field| matches!(*field, "created_at" | "updated_at" | "edited_at"))
                .ok_or_else(|| EngineError::invalid("bad cursor sort"))?;
            let ascending = match it.next() {
                Some("asc") => true,
                Some("desc") => false,
                _ => return Err(EngineError::invalid("bad cursor sort")),
            };
            (field, ascending, it.next())
        } else {
            ("updated_at", false, Some(first))
        };
        let pinned = pinned
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|n| *n == 0 || *n == 1)
            .ok_or_else(|| EngineError::invalid("bad cursor"))?;
        let timestamp = it
            .next()
            .and_then(|v| v.parse::<i64>().ok())
            .ok_or_else(|| EngineError::invalid("bad cursor"))?;
        let id = it
            .next()
            .filter(|id| crate::ids::valid_id(id))
            .ok_or_else(|| EngineError::invalid("bad cursor"))?
            .to_string();
        if it.next().is_some() {
            return Err(EngineError::invalid("bad cursor"));
        }
        Ok(Cursor {
            pinned,
            timestamp,
            id,
            sort_by: sort_by.to_string(),
            ascending,
            title: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let c = Cursor {
            pinned: 1,
            timestamp: 1_700_000_000_123,
            id: "0b6c2f6e-0000-4000-8000-000000000001".into(),
            sort_by: "updated_at".into(),
            ascending: false,
            title: None,
        };
        assert_eq!(Cursor::decode(&c.encode()).unwrap(), c);
        assert_eq!(
            c.encode(),
            "1\u{1f}1700000000123\u{1f}0b6c2f6e-0000-4000-8000-000000000001"
        );
        for sort_by in ["created_at", "updated_at", "edited_at"] {
            for ascending in [false, true] {
                let c = Cursor {
                    sort_by: sort_by.into(),
                    ascending,
                    ..c.clone()
                };
                assert_eq!(Cursor::decode(&c.encode()).unwrap(), c);
            }
        }
        for title in [
            "",
            "한글\u{1f}제목\n\"quoted\"",
            &"\u{1f}".repeat(crate::limits::MAX_TITLE_CHARS),
        ] {
            for ascending in [false, true] {
                let c = Cursor {
                    timestamp: 0,
                    sort_by: "title".into(),
                    title: Some(title.to_string()),
                    ascending,
                    ..c.clone()
                };
                assert_eq!(Cursor::decode(&c.encode()).unwrap(), c);
            }
        }
    }

    #[test]
    fn rejects_garbage() {
        assert!(Cursor::decode("").is_err());
        assert!(Cursor::decode("x\u{1f}y\u{1f}z").is_err());
        assert!(Cursor::decode("1\u{1f}2\u{1f}bad id\u{1f}extra").is_err());
        for cursor in [
            "2\u{1f}3\u{1f}note",
            "v2\u{1f}title\u{1f}asc\u{1f}0\u{1f}3\u{1f}note",
            "v2\u{1f}created_at\u{1f}up\u{1f}0\u{1f}3\u{1f}note",
            "v2\u{1f}created_at\u{1f}asc\u{1f}0\u{1f}3\u{1f}note\u{1f}extra",
            "v3\u{1f}[0,true,null,\"note\"]",
            "v3\u{1f}[2,true,\"title\",\"note\"]",
            "v3\u{1f}[0,\"asc\",\"title\",\"note\"]",
            "v3\u{1f}[0,true,\"title\",\"bad id\"]",
            "v3\u{1f}[0,true,\"title\",\"note\",1]",
        ] {
            assert!(Cursor::decode(cursor).is_err(), "{cursor}");
        }
        let oversized = format!(
            "v3\u{1f}{}",
            serde_json::to_string(&(
                0,
                true,
                "a".repeat(crate::limits::MAX_TITLE_CHARS + 1),
                "note"
            ))
            .unwrap()
        );
        assert!(Cursor::decode(&oversized).is_err());
    }
}
