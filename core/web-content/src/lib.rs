//! Trusted boundary for imported, published and exported HTML.
//!
//! Port of the former Go implementation's sanitizer. It never fetches URLs
//! and drops active content; the export policy keeps a small set of static
//! formatting attributes. The policy (tags, attributes, styles, URL rules,
//! limits, error messages) is identical to Go and checked against recorded Go
//! output in `tests/differential.rs` (`tests/fixtures/go-expected.json`).
//!
//! Known gap: parsing uses html5ever (WHATWG spec) where Go uses
//! `golang.org/x/net/html`. They build different trees for some malformed
//! input: framesets, `<isindex>`, math/svg integration points
//! (`annotation-xml`), stray table parts after `<caption>`, and a `<pre>` or
//! `<listing>` newline after an ignored tag (Go drops it). Random fuzzing of
//! tag soup showed 0.1-0.6% of inputs differ. The output is still made only
//! of allowed tags and escaped text.

use std::fmt;
use std::sync::OnceLock;

use html5ever::tendril::TendrilSink;
use html5ever::tokenizer::TokenizerOpts;
use html5ever::{driver, ParseOpts};
use regex::Regex;
use scraper::node::Element;
use scraper::{Html, HtmlTreeSink, Node};

mod url;

pub use url::source_url;

/// Import/publish size limit in bytes (Go `MaxBytes`).
pub const MAX_BYTES: usize = 2 << 20;
/// Largest limit [`sanitize`] accepts.
pub const MAX_LIMIT: usize = 64 << 20;
const MAX_DEPTH: usize = 128;

/// Which policy [`sanitize`] applies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Clipped/imported/published HTML: bare allowed tags, no attributes,
    /// attachments dropped.
    Import,
    /// Formatted export: keeps known formatting attributes and text
    /// alternatives, fails instead of silently losing visual content.
    Export,
}

/// Sanitized markup plus its plain text (trimmed).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cleaned {
    pub html: String,
    pub text: String,
}

/// Rejection reason. `Display` gives the same message as the Go version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error(String);

impl Error {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Error(message.into())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

/// Go `Clean`: import policy with the [`MAX_BYTES`] limit.
pub fn clean(raw: &str) -> Result<Cleaned, Error> {
    sanitize(raw, MAX_BYTES, Mode::Import)
}

/// Go `CleanExport`: export policy with a caller-chosen limit.
pub fn clean_export(raw: &str, limit: usize) -> Result<Cleaned, Error> {
    sanitize(raw, limit, Mode::Export)
}

/// Parses `raw` as a full HTML document and writes the allowed subset.
/// `limit` (1..=[`MAX_LIMIT`]) bounds the input, the markup and the text.
pub fn sanitize(raw: &str, limit: usize, mode: Mode) -> Result<Cleaned, Error> {
    if limit == 0 || limit > MAX_LIMIT || raw.len() > limit {
        return Err(Error::new(format!("HTML exceeds {limit} byte limit")));
    }
    // Go keeps a leading U+FEFF as text; html5ever drops it unless told not to.
    let opts = ParseOpts {
        tokenizer: TokenizerOpts {
            discard_bom: false,
            ..Default::default()
        },
        ..Default::default()
    };
    let document = driver::parse_document(HtmlTreeSink::new(Html::new_document()), opts).one(raw);
    let mut s = Sanitizer {
        out: String::new(),
        text: String::new(),
        limit,
        export: mode == Mode::Export,
        failure: None,
    };
    s.visit(document.tree.root(), 0);
    if let Some(e) = s.failure {
        return Err(e);
    }
    if s.out.len() > limit || s.text.len() > limit {
        return Err(Error::new("sanitized HTML exceeds limit"));
    }
    Ok(Cleaned {
        html: s.out,
        text: s.text.trim().to_string(),
    })
}

const ALLOWED_TAGS: &[&str] = &[
    "p",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "blockquote",
    "pre",
    "code",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "hr",
];
const BLOCKED_TAGS: &[&str] = &[
    "script", "style", "iframe", "object", "embed", "svg", "math", "form", "input", "textarea",
    "button", "select", "head", "template", "noscript",
];

type NodeRef<'a> = ego_tree::NodeRef<'a, Node>;

/// Walks the parsed tree once, writing escaped HTML and plain text. The first
/// failure stops the walk.
struct Sanitizer {
    out: String,
    text: String,
    limit: usize,
    export: bool,
    failure: Option<Error>,
}

impl Sanitizer {
    fn visit(&mut self, n: NodeRef<'_>, depth: usize) {
        if !self.proceed(depth) {
            return;
        }
        let element = n.value().as_element();
        if let Some(el) = element {
            if self.replace_element(el) {
                return;
            }
        }
        if let Node::Text(t) = n.value() {
            escape_into(&mut self.out, t);
            self.text.push_str(t);
            return;
        }
        let name = element.map(|el| &*el.name.local);
        if name.is_some_and(|tag| BLOCKED_TAGS.contains(&tag)) {
            return;
        }
        let mut tag = "";
        if let Some(el) = element.filter(|el| {
            ALLOWED_TAGS.contains(&&*el.name.local) || (self.export && export_element(n, el))
        }) {
            tag = &el.name.local;
            if !self.open_tag(el) {
                return;
            }
        }
        for child in n.children() {
            self.visit(child, depth + 1);
        }
        self.close_tag(tag);
    }

    fn proceed(&mut self, depth: usize) -> bool {
        if self.failure.is_some() {
            return false;
        }
        if depth > MAX_DEPTH {
            self.failure = Some(Error::new("HTML nesting exceeds 128 levels"));
            return false;
        }
        if self.out.len() > self.limit || self.text.len() > self.limit {
            self.failure = Some(Error::new("sanitized HTML exceeds limit"));
            return false;
        }
        true
    }

    /// Drops hidden/attachment elements and, for export, writes a text
    /// placeholder or fails. Reports whether the element was consumed.
    fn replace_element(&mut self, el: &Element) -> bool {
        let attr = |key: &str| attribute(el, key);
        if skipped_element(&attr, self.export) {
            return true;
        }
        self.export && self.export_placeholder(el, &attr)
    }

    fn export_placeholder(&mut self, el: &Element, attr: &dyn Fn(&str) -> Option<String>) -> bool {
        let name: &str = &el.name.local;
        match name {
            "svg" | "math" | "canvas" | "video" | "audio" => {
                self.failure = Some(Error::new(format!(
                    "{name} visual content cannot be exported without a text alternative"
                )));
                true
            }
            "img" => {
                let alt = attr("alt").unwrap_or_default();
                let alt = alt.trim();
                if alt.is_empty() {
                    self.failure = Some(Error::new(
                        "image has no description; add alternative text before export",
                    ));
                    return true;
                }
                let label = format!("[이미지: {alt}]");
                escape_into(&mut self.out, &label);
                self.text.push_str(&label);
                true
            }
            "input" if equal_fold(&attr("type").unwrap_or_default(), "checkbox") => {
                let label = if attr("checked").is_some() {
                    "[x] "
                } else {
                    "[ ] "
                };
                self.out.push_str(label);
                self.text.push_str(label);
                true
            }
            _ => false,
        }
    }

    /// Writes an allowed start tag; fails on an invalid table span.
    fn open_tag(&mut self, el: &Element) -> bool {
        let tag: &str = &el.name.local;
        self.out.push('<');
        self.out.push_str(tag);
        if self.export {
            export_attributes(&mut self.out, el);
            if (tag == "td" || tag == "th") && !self.write_spans(el) {
                return false;
            }
        }
        self.out.push('>');
        true
    }

    fn write_spans(&mut self, el: &Element) -> bool {
        for (key, value) in el.attrs() {
            if key != "colspan" && key != "rowspan" {
                continue;
            }
            match atoi(value) {
                Some(v @ 1..=1000) => self.out.push_str(&format!(" {key}=\"{v}\"")),
                _ => {
                    self.failure = Some(Error::new("invalid table span"));
                    return false;
                }
            }
        }
        true
    }

    fn close_tag(&mut self, tag: &str) {
        if !tag.is_empty() && tag != "br" && tag != "hr" {
            self.out.push_str("</");
            self.out.push_str(tag);
            self.out.push('>');
        }
        // Go uses HasPrefix(tag, "h"), which includes hr.
        if matches!(tag, "p" | "br" | "li" | "tr") || tag.starts_with('h') {
            self.text.push('\n');
        }
    }
}

/// Go builds a map keyed by the lowercased attribute name; on a duplicate key
/// the last value wins.
fn attribute(el: &Element, key: &str) -> Option<String> {
    el.attrs()
        .filter(|(k, _)| go_lower(k) == key)
        .last()
        .map(|(_, v)| v.to_string())
}

fn skipped_element(attr: &dyn Fn(&str) -> Option<String>, export: bool) -> bool {
    let value = |key: &str| attr(key).unwrap_or_default();
    if !export
        && (value("data-type") == "mindbox-attachment" || !value("data-attachment-url").is_empty())
    {
        return true;
    }
    attr("hidden").is_some()
        || equal_fold(&value("aria-hidden"), "true")
        || hidden_style().is_match(&value("style"))
}

fn hidden_style() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Go RE2 `\s` is exactly [\t\n\f\r ].
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)(^|;)[\t\n\f\r ]*(display[\t\n\f\r ]*:[\t\n\f\r ]*none|visibility[\t\n\f\r ]*:[\t\n\f\r ]*hidden)[\t\n\f\r ]*(!important)?[\t\n\f\r ]*(;|$)",
        )
        .expect("static regex")
    })
}

/// A fragment cannot name a resource, URL scheme, escape sequence, or markup.
/// App footnotes and Markdown's generated definition IDs use this subset.
fn static_fragment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.'))
}

fn app_footnote_fragment(value: &str) -> bool {
    static_fragment(value)
        && value
            .get(..2)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("fn"))
}

fn has_class(el: &Element, class: &str) -> bool {
    attribute(el, "class").is_some_and(|v| v.split_ascii_whitespace().any(|c| c == class))
}

fn footnote_definition(el: &Element) -> bool {
    &*el.name.local == "div"
        && has_class(el, "footnote-definition")
        && attribute(el, "id").is_some_and(|v| static_fragment(&v))
}

/// Preserve semantic super/subscripts and only local fragment anchors. Other
/// links still become static text; imports keep their existing tag policy.
fn export_element(n: NodeRef<'_>, el: &Element) -> bool {
    match &*el.name.local {
        "sup" | "sub" => true,
        "a" => attribute(el, "href").is_some_and(|v| {
            v.strip_prefix('#').is_some_and(|id| {
                app_footnote_fragment(id)
                    || (static_fragment(id)
                        && n.parent()
                            .and_then(|p| p.value().as_element())
                            .is_some_and(|parent| {
                                &*parent.name.local == "sup"
                                    && has_class(parent, "footnote-reference")
                            }))
            })
        }),
        "div" => footnote_definition(el),
        _ => false,
    }
}

/// Export accepts exact formatting values and bounded local fragments, never
/// resource URLs, arbitrary CSS, or event handlers.
fn export_attributes(out: &mut String, el: &Element) {
    let tag: &str = &el.name.local;
    for (key, raw) in el.attrs() {
        let value = go_lower(raw.trim());
        let v = value.as_str();
        let allowed = match key {
            "data-table-style" => tag == "table" && matches!(v, "striped" | "plain"),
            "data-cell-tone" => {
                matches!(tag, "td" | "th") && matches!(v, "soft" | "success" | "warning")
            }
            "data-wrap" => tag == "pre" && v == "true",
            "dir" => matches!(v, "ltr" | "rtl"),
            "start" => {
                if let Some(n @ 1..=999_999) = atoi(v).filter(|_| tag == "ol") {
                    out.push_str(&format!(" start=\"{n}\""));
                }
                false
            }
            "value" => {
                if let Some(n @ 1..=999_999) = atoi(v).filter(|_| tag == "li") {
                    out.push_str(&format!(" value=\"{n}\""));
                }
                false
            }
            "id" => {
                if static_fragment(raw)
                    && ((matches!(tag, "p" | "li" | "sup" | "a") && app_footnote_fragment(raw))
                        || footnote_definition(el))
                {
                    out.push_str(" id=\"");
                    escape_into(out, raw);
                    out.push('"');
                }
                false
            }
            "href" => {
                if tag == "a" && raw.strip_prefix('#').is_some_and(static_fragment) {
                    out.push_str(" href=\"");
                    escape_into(out, raw);
                    out.push('"');
                }
                false
            }
            "class" => {
                if footnote_definition(el) {
                    out.push_str(" class=\"footnote-definition\"");
                } else if tag == "sup" && has_class(el, "footnote-reference") {
                    out.push_str(" class=\"footnote-reference\"");
                }
                false
            }
            "style" => {
                export_style(out, tag, v);
                false
            }
            _ => false,
        };
        if allowed {
            out.push_str(&format!(" {key}=\"{v}\""));
        }
    }
}

/// Keeps only the whitelisted declarations of a style attribute.
fn export_style(out: &mut String, tag: &str, value: &str) {
    let styles: Vec<String> = value
        .split(';')
        .filter_map(|declaration| declaration.split_once(':'))
        .map(|(k, v)| (k.trim(), v.trim()))
        .filter(|(k, v)| style_allowed(tag, k, v))
        .map(|(k, v)| format!("{k}:{v}"))
        .collect();
    if !styles.is_empty() {
        out.push_str(&format!(" style=\"{}\"", styles.join(";")));
    }
}

fn style_allowed(tag: &str, key: &str, v: &str) -> bool {
    match key {
        "text-align" => matches!(v, "left" | "center" | "right" | "justify"),
        "vertical-align" => matches!(tag, "td" | "th") && matches!(v, "top" | "middle" | "bottom"),
        "border-top-style" => tag == "hr" && matches!(v, "solid" | "dashed" | "dotted"),
        "list-style-type" => {
            matches!(tag, "ol" | "ul")
                && matches!(
                    v,
                    "disc"
                        | "circle"
                        | "square"
                        | "decimal"
                        | "lower-alpha"
                        | "upper-alpha"
                        | "lower-roman"
                        | "upper-roman"
                )
        }
        _ => false,
    }
}

/// Go `html.EscapeString`.
fn escape_into(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '\'' => out.push_str("&#39;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&#34;"),
            _ => out.push(c),
        }
    }
}

/// Go `strings.ToLower`: per-rune simple lowercase (no final sigma, `İ` -> `i`).
fn go_lower(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c == '\u{130}' {
                'i'
            } else {
                c.to_lowercase().next().unwrap_or(c)
            }
        })
        .collect()
}

/// Go `strings.EqualFold` against an ASCII lowercase target. Only the Kelvin
/// sign and long s fold onto ASCII letters from outside ASCII.
fn equal_fold(s: &str, ascii_lower: &str) -> bool {
    let folded = s.chars().map(|c| match c {
        '\u{212A}' => 'k',
        '\u{17F}' => 's',
        c => c.to_ascii_lowercase(),
    });
    folded.eq(ascii_lower.chars())
}

/// Go `strconv.Atoi`: optional sign, decimal digits, no spaces.
fn atoi(s: &str) -> Option<i64> {
    s.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn go_string_helpers() {
        assert_eq!(go_lower("TEXT-ALİGN"), "text-align");
        assert_eq!(go_lower("Σ"), "σ");
        assert!(equal_fold("CHEC\u{212A}BOX", "checkbox"));
        assert!(!equal_fold("checkboxx", "checkbox"));
        assert_eq!(atoi("+2"), Some(2));
        assert_eq!(atoi("08"), Some(8));
        assert_eq!(atoi(" 2"), None);
        let mut out = String::new();
        escape_into(&mut out, "<a href=\"x\">'&'</a>");
        assert_eq!(out, "&lt;a href=&#34;x&#34;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    }
}

/// Extract a static reading view; no subresources or scripts are loaded.
pub fn reader(source: &str, plain: bool) -> Result<(String, Cleaned), Error> {
    if source.len() > MAX_BYTES { return Err(Error::new("page exceeds 2 MB")); }
    if plain {
        let escaped = source.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        return Ok((String::new(), clean(&format!("<pre>{escaped}</pre>"))?));
    }
    let document = Html::parse_document(source);
    let selector = |s| scraper::Selector::parse(s).expect("static selector");
    let title = document.select(&selector("title")).next().map(|n| n.text().collect::<String>().chars().take(240).collect()).unwrap_or_default();
    let root = document.select(&selector("article")).next()
        .or_else(|| document.select(&selector("main")).next())
        .or_else(|| document.select(&selector("body")).next());
    let html = root.map(|n|n.inner_html()).unwrap_or_else(||source.to_string());
    Ok((title, clean(&html)?))
}
