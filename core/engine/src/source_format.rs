//! Source-first rendering is explicit and read-only; editing never renders HTML.
use crate::{
    error::{EngineError, Result},
    ops_notes,
};
use pulldown_cmark::{Event, Options, Parser, TagEnd};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::io::{self, Write};

pub const MAX_RENDER_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_RENDER_JSON_BYTES: usize = 63 * 1024 * 1024;
pub fn validate(format: &str) -> Result<()> {
    if !matches!(format, "text" | "html" | "markdown") {
        return Err(EngineError::invalid("unknown content_format"));
    }
    Ok(())
}
pub fn from_value(value: Option<&Value>) -> Result<&str> {
    match value {
        None => Ok("html"),
        Some(Value::String(s)) => {
            validate(s)?;
            Ok(s)
        }
        Some(_) => Err(EngineError::invalid("invalid content_format")),
    }
}
pub fn search_text(format: &str, source: &str) -> Result<String> {
    validate(format)?;
    match format {
        "html" => crate::plaintext::from_html(source),
        "text" => Ok(source.to_owned()),
        _ => {
            let mut output = String::new();
            for event in Parser::new_ext(source, Options::all()) {
                match event {
                    Event::Text(text)
                    | Event::Code(text)
                    | Event::InlineMath(text)
                    | Event::DisplayMath(text) => output.push_str(&text),
                    Event::SoftBreak | Event::HardBreak | Event::Rule => output.push('\n'),
                    Event::End(
                        TagEnd::Paragraph
                        | TagEnd::Heading(_)
                        | TagEnd::CodeBlock
                        | TagEnd::Item
                        | TagEnd::TableRow,
                    ) => output.push('\n'),
                    _ => {}
                }
                ops_notes::check_field_size("derived text", &output)?;
            }
            Ok(output)
        }
    }
}
struct BoundedOutput(Vec<u8>);
impl Write for BoundedOutput {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_RENDER_BYTES.saturating_sub(self.0.len()) {
            return Err(io::Error::other(
                "preview output exceeds render limit; source is unchanged",
            ));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub fn render(format: &str, source: &str) -> Result<String> {
    validate(format)?;
    let mut output = BoundedOutput(Vec::new());
    match format {
        "html" => output.write_all(source.as_bytes())?,
        "text" => {
            output.write_all(b"<pre>")?;
            for part in source.split_inclusive(['&', '<', '>', '"', '\'']) {
                let last = part.chars().last().unwrap();
                let escaped = match last {
                    '&' => Some("&amp;"),
                    '<' => Some("&lt;"),
                    '>' => Some("&gt;"),
                    '"' => Some("&quot;"),
                    '\'' => Some("&#39;"),
                    _ => None,
                };
                if let Some(escaped) = escaped {
                    output.write_all(&part.as_bytes()[..part.len() - last.len_utf8()])?;
                    output.write_all(escaped.as_bytes())?;
                } else {
                    output.write_all(part.as_bytes())?;
                }
            }
            output.write_all(b"</pre>")?;
        }
        // A leading BOM marks the encoding, not content. The stored source keeps it.
        _ => pulldown_cmark::html::write_html_io(
            &mut output,
            Parser::new_ext(
                source.strip_prefix('\u{FEFF}').unwrap_or(source),
                Options::all(),
            ),
        )?,
    }
    String::from_utf8(output.0).map_err(|_| EngineError::internal("render produced invalid UTF-8"))
}
pub fn document_render(conn: &Connection, args: &Value) -> Result<Value> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("missing id"))?;
    let revision = args
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|r| *r > 0)
        .ok_or_else(|| EngineError::invalid("render requires revision"))?;
    let note = ops_notes::load_note(conn, id)?.ok_or_else(|| EngineError::NotFound(id.into()))?;
    if note.revision != revision {
        return Err(EngineError::Conflict("document revision changed".into()));
    }
    let html = render(&note.content_format, &note.content)?;
    let result = json!({"id":id,"title":note.title,"trashed":note.trashed,"revision":revision,
        "content_format":note.content_format,"html":html});
    if serde_json::to_vec(&result)?.len() > MAX_RENDER_JSON_BYTES {
        return Err(EngineError::invalid(
            "preview JSON exceeds transport limit; source is unchanged",
        ));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    #[test]
    fn markdown_render_ignores_leading_bom() {
        let html = super::render("markdown", "\u{FEFF}# 제목\n").unwrap();
        assert_eq!(html, "<h1>제목</h1>\n");
        // Only a leading BOM is an encoding mark.
        assert!(super::render("markdown", "a\u{FEFF}b")
            .unwrap()
            .contains('\u{FEFF}'));
    }
}
