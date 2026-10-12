//! Data shapes returned over the protocol (.private/docs/protocol.md v1).
//! `Summary` deliberately excludes `content`/`text` so list queries never
//! touch the bodies table.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
pub struct Summary {
    pub content_format: String,
    pub id: String,
    pub title: String,
    pub preview: String,
    #[serde(rename = "notebook_id")]
    pub notebook_id: Option<String>,
    pub notebook_ids: Vec<String>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub pinned: bool,
    pub readonly: bool,
    /// Body is encrypted in the vault; content/text are empty here.
    pub locked: bool,
    pub archived: bool,
    pub trashed: bool,
    pub color: Option<String>,
    /// Scheduled reminder in UTC Unix milliseconds (null = none).
    pub reminder_at: Option<i64>,
    pub reminder_repeat_hours: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub edited_at: i64,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub content_format: String,
    pub id: String,
    pub title: String,
    pub content: String,
    pub text: String,
    #[serde(rename = "notebook_id")]
    pub notebook_id: Option<String>,
    pub notebook_ids: Vec<String>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub pinned: bool,
    pub readonly: bool,
    /// Body is encrypted in the vault; content/text are empty here.
    pub locked: bool,
    pub archived: bool,
    pub trashed: bool,
    pub color: Option<String>,
    /// Scheduled reminder in UTC Unix milliseconds (null = none).
    pub reminder_at: Option<i64>,
    pub reminder_repeat_hours: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub edited_at: i64,
    pub revision: i64,
}

impl Note {
    pub fn summary(&self) -> Summary {
        Summary {
            content_format: self.content_format.clone(),
            id: self.id.clone(),
            preview: preview_for(&self.content_format, &self.text, &self.title),
            notebook_id: self.notebook_id.clone(),
            notebook_ids: self.notebook_ids.clone(),
            tags: self.tags.clone(),
            favorite: self.favorite,
            pinned: self.pinned,
            readonly: self.readonly,
            locked: self.locked,
            archived: self.archived,
            trashed: self.trashed,
            color: self.color.clone(),
            reminder_at: self.reminder_at,
            reminder_repeat_hours: self.reminder_repeat_hours,
            created_at: self.created_at,
            updated_at: self.updated_at,
            edited_at: self.edited_at,
            revision: self.revision,
            title: self.title.clone(),
        }
    }
}

/// HTML 원문을 그대로 text로 저장한 경우(원문 편집 경로) 미리보기에는 태그 대신 보이는 글자를 쓴다.
/// 앞부분만 해석해 큰 문서에서도 저장 비용이 늘지 않게 한다.
pub fn preview_for(format: &str, text: &str, title: &str) -> String {
    let source = (format == "html" && text.trim_start().starts_with('<')) || format == "markdown";
    if source {
        let mut cut = text.len().min(64 * 1024);
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        if let Ok(plain) = crate::source_format::search_text(format, &text[..cut]) {
            let plain = plain.split_whitespace().collect::<Vec<_>>().join(" ");
            return preview_of(&plain, title);
        }
    }
    preview_of(text, title)
}

/// Preview = first 180 *characters* of extracted text (Korean-safe). An empty
/// body has an empty preview; the list shows the title separately.
pub fn preview_of(text: &str, _title: &str) -> String {
    let src = text.trim();
    let mut end = 0;
    let mut count = 0;
    for (i, _) in src.char_indices() {
        if count == crate::limits::MAX_PREVIEW_CHARS {
            break;
        }
        end = i;
        count += 1;
    }
    let mut out: String = src.chars().take(crate::limits::MAX_PREVIEW_CHARS).collect();
    if count == crate::limits::MAX_PREVIEW_CHARS && end < src.len() {
        // There were more characters than the cap; mark truncation.
        out.push('…');
    }
    // Sanity: never emit broken JSON strings (control chars are legal in JSON,
    // so no extra work needed here).
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct Notebook {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Parent notebook id; null = top level. Deliberately NOT a foreign key:
    /// a remote child notebook may be received before its parent.
    pub parent_id: Option<String>,
    pub description: String,
    /// Cover photo (schema v15), validated by `notebook_cover`; null = none.
    pub cover: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    pub id: String,
    pub note_id: String,
    pub title: String,
    pub created_at: i64,
}

/// Raw save input (serde does the shape validation; extra unknown fields in
/// `note` are ignored on purpose — partial saves only touch supplied fields).
#[derive(Debug, Clone, Deserialize)]
pub struct SaveInput {
    #[serde(default)]
    pub readonly: Option<bool>,
    #[serde(default)]
    pub content_format: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub notebook_id: Option<Option<String>>, // explicit null clears
    #[serde(default)]
    pub notebook_ids: Option<Vec<String>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// UTC Unix ms. Re-derived from the raw JSON via [`opt_i64`] so absent
    /// (preserve) and explicit null (clear) stay distinguishable.
    #[serde(default)]
    pub reminder_at: Option<Option<i64>>,
    #[serde(default)]
    pub reminder_repeat_hours: Option<Option<i64>>,
    #[serde(default)]
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchInput {
    #[serde(default)]
    pub readonly: Option<bool>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub favorite: Option<bool>,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub archived: Option<bool>,
    #[serde(default)]
    pub trashed: Option<bool>,
    #[serde(default)]
    pub color: Option<Option<String>>,
    #[serde(default)]
    pub notebook_id: Option<Option<String>>,
    #[serde(default)]
    pub notebook_ids: Option<Vec<String>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// UTC Unix ms; explicit null clears the reminder.
    #[serde(default)]
    pub reminder_at: Option<Option<i64>>,
    #[serde(default)]
    pub reminder_repeat_hours: Option<Option<i64>>,
}

/// Optional UTC milliseconds from backups/sync. Explicit null is invalid.
pub fn opt_timestamp(v: &Value, key: &str) -> crate::error::Result<Option<i64>> {
    match v.get(key) {
        None => Ok(None),
        Some(value) => value
            .as_i64()
            .filter(|time| *time >= 0)
            .map(Some)
            .ok_or_else(|| crate::error::EngineError::invalid(format!("{key} must be a nonnegative integer"))),
    }
}

/// Ok(None) = absent, Ok(Some(None)) = explicit null, Ok(Some(Some(v))) = set.
pub fn opt_string(v: &Value, key: &str) -> crate::error::Result<Option<Option<String>>> {
    match v.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(Value::String(s)) => Ok(Some(Some(s.clone()))),
        Some(_) => Err(crate::error::EngineError::invalid(format!(
            "{key} must be a string or null"
        ))),
    }
}

/// An optional Boolean: omitted preserves state; explicit null is invalid.
pub fn opt_bool(v: &Value, key: &str) -> crate::error::Result<Option<bool>> {
    match v.get(key) {
        None => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(crate::error::EngineError::invalid(format!(
            "{key} must be a boolean"
        ))),
    }
}

/// [`opt_string`] for integer milliseconds (e.g. `reminder_at`).
pub fn opt_i64(v: &Value, key: &str) -> crate::error::Result<Option<Option<i64>>> {
    match v.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => Ok(Some(Some(i))),
            None => Err(crate::error::EngineError::invalid(format!(
                "{key} must be an integer or null"
            ))),
        },
        Some(_) => Err(crate::error::EngineError::invalid(format!(
            "{key} must be an integer or null"
        ))),
    }
}

/// Reminders are UTC Unix milliseconds bounded to
/// `[0, 8_640_000_000_000_000]` (see `limits`).
pub fn check_reminder_at(v: i64) -> crate::error::Result<()> {
    if !(crate::limits::MIN_REMINDER_AT_MS..=crate::limits::MAX_REMINDER_AT_MS).contains(&v) {
        return Err(crate::error::EngineError::invalid(
            "reminder_at out of range (0..=8640000000000000 ms)",
        ));
    }
    Ok(())
}

pub fn check_reminder_repeat(v: i64) -> crate::error::Result<()> {
    if v == 24 || v == 168 {
        Ok(())
    } else {
        Err(crate::error::EngineError::invalid(
            "reminder_repeat_hours must be 24, 168 or null",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preview_korean_180() {
        let text: String = "가".repeat(300);
        let p = preview_of(&text, "t");
        assert_eq!(p.chars().count(), 181); // 180 + ellipsis
        assert!(p.ends_with('…'));
        assert_eq!(preview_for("html", "<h2>오늘의 기록</h2><p>생각을 <b>모아</b> 둡니다.</p>", "t"), "오늘의 기록 생각을 모아 둡니다.");
        assert_eq!(preview_for("html", "이미 뽑은 글", "t"), "이미 뽑은 글");
        assert_eq!(preview_for("markdown", "# 제목\n\n**굵게** 와 *기울임*\n\n- 항목 A", "t"), "제목 굵게 와 기울임 항목 A");
        assert_eq!(preview_for("text", "# 그대로", "t"), "# 그대로");
        let short = preview_of("짧", "t");
        assert_eq!(short, "짧");
        assert_eq!(preview_of("", "제목만"), "");
        assert_eq!(preview_for("html", "<p></p>", "제목만"), "");
    }

    #[test]
    fn reminder_range_and_triple_state() {
        check_reminder_at(0).unwrap();
        check_reminder_at(crate::limits::MAX_REMINDER_AT_MS).unwrap();
        assert!(check_reminder_at(-1).is_err());
        assert!(check_reminder_at(crate::limits::MAX_REMINDER_AT_MS + 1).is_err());

        let absent = json!({ "title": "t" });
        assert_eq!(opt_i64(&absent, "reminder_at").unwrap(), None);
        let cleared = json!({ "reminder_at": null });
        assert_eq!(opt_i64(&cleared, "reminder_at").unwrap(), Some(None));
        let set = json!({ "reminder_at": 1_720_000_000_000i64 });
        assert_eq!(
            opt_i64(&set, "reminder_at").unwrap(),
            Some(Some(1_720_000_000_000))
        );
        let float = json!({ "reminder_at": 1.5 });
        assert!(opt_i64(&float, "reminder_at").is_err());
        let text = json!({ "reminder_at": "곧" });
        assert!(opt_i64(&text, "reminder_at").is_err());
    }
}
