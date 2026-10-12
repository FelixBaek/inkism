//! Trusted boundary for published HTML (Go webcontent.Clean): a fixed set of
//! static tags without attributes; scripts, embeds, forms, hidden content and
//! attachments are dropped. Never fetches anything.
use crate::publications::escape;
use ego_tree::NodeRef;
use scraper::{Html, Node};

pub const MAX_BYTES: usize = 2 << 20;

const ALLOWED: &[&str] = &[
    "p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "blockquote", "pre", "code", "ul",
    "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "hr",
];
const BLOCKED: &[&str] = &[
    "script", "style", "iframe", "object", "embed", "svg", "math", "form", "input", "textarea", "button", "select", "head",
    "template", "noscript",
];

pub fn clean(raw: &str) -> Result<String, String> {
    if raw.len() > MAX_BYTES {
        return Err(format!("HTML exceeds {MAX_BYTES} byte limit"));
    }
    let doc = Html::parse_document(raw);
    let mut s = Sanitizer { out: String::new(), text: 0, failure: None };
    s.visit(doc.tree.root(), 0);
    if let Some(f) = s.failure {
        return Err(f.into());
    }
    if s.out.len() > MAX_BYTES || s.text > MAX_BYTES {
        return Err("sanitized HTML exceeds limit".into());
    }
    Ok(s.out)
}

struct Sanitizer {
    out: String,
    text: usize, // length of the plain-text rendering, only bounded here
    failure: Option<&'static str>,
}

impl Sanitizer {
    fn visit(&mut self, n: NodeRef<Node>, depth: usize) {
        if self.failure.is_some() {
            return;
        }
        if depth > 128 {
            self.failure = Some("HTML nesting exceeds 128 levels");
            return;
        }
        if self.out.len() > MAX_BYTES || self.text > MAX_BYTES {
            self.failure = Some("sanitized HTML exceeds limit");
            return;
        }
        let Some(tag) = self.open(n) else { return };
        for c in n.children() {
            self.visit(c, depth + 1);
        }
        self.close(tag);
    }

    /// Writes the node's opening (or its text); None when its subtree is dropped.
    fn open(&mut self, n: NodeRef<Node>) -> Option<&'static str> {
        match n.value() {
            Node::Text(t) => {
                self.out.push_str(&escape(t));
                self.text += t.len();
                None
            }
            Node::Element(e) if skipped(e) || BLOCKED.contains(&e.name()) => None,
            Node::Element(e) if e.name()=="a" && e.attr("href").is_some_and(|h|h.starts_with('#') && h.len()>1 && h.len()<=129 && h[1..].bytes().all(|b|b.is_ascii_alphanumeric()||b"-_".contains(&b))) => {
                self.out.push_str("<a href=\"");self.out.push_str(&escape(e.attr("href").unwrap_or("")));self.out.push_str("\">");Some("a")
            }
            Node::Element(e) => {
                let Some(tag) = ALLOWED.iter().find(|a| **a == e.name()) else { return Some("") };
                self.out.push('<');
                self.out.push_str(tag);
                self.out.push('>');
                Some(tag)
            }
            _ => Some(""),
        }
    }

    fn close(&mut self, tag: &str) {
        if !tag.is_empty() && tag != "br" && tag != "hr" {
            self.out.push_str("</");
            self.out.push_str(tag);
            self.out.push('>');
        }
        if matches!(tag, "p" | "br" | "li" | "tr") || tag.starts_with('h') {
            self.text += 1;
        }
    }
}

/// Attachments, `hidden`, aria-hidden and display:none / visibility:hidden.
fn skipped(e: &scraper::node::Element) -> bool {
    let attr = |name: &str| e.attrs().filter(|(k, _)| k.eq_ignore_ascii_case(name)).last().map(|(_, v)| v);
    attr("data-type") == Some("mindbox-attachment")
        || attr("data-attachment-url").is_some_and(|v| !v.is_empty())
        || attr("hidden").is_some()
        || attr("aria-hidden").is_some_and(|v| v.eq_ignore_ascii_case("true"))
        || attr("style").is_some_and(hidden_style)
}

/// `(?i)(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*(!important)?\s*(;|$)`
/// with Go RE2 semantics: \s is ASCII only, (?i) also folds U+017F onto s.
fn hidden_style(style: &str) -> bool {
    let chars: Vec<char> = style.chars().collect();
    (0..=chars.len()).any(|start| (start == 0 || chars[start - 1] == ';') && hidden_at(&chars, start))
}

fn skip_ws(c: &[char], i: &mut usize) {
    while c.get(*i).is_some_and(|ch| matches!(ch, ' ' | '\t' | '\n' | '\x0c' | '\r')) {
        *i += 1;
    }
}

fn eat_word(c: &[char], i: &mut usize, w: &str) -> bool {
    let ok = w
        .chars()
        .enumerate()
        .all(|(k, l)| c.get(*i + k).is_some_and(|ch| ch.eq_ignore_ascii_case(&l) || (l == 's' && *ch == '\u{17f}')));
    if ok {
        *i += w.len();
    }
    ok
}

fn eat_pair(c: &[char], i: &mut usize, key: &str, value: &str) -> bool {
    let mut j = *i;
    let ok = eat_word(c, &mut j, key) && {
        skip_ws(c, &mut j);
        c.get(j) == Some(&':')
    } && {
        j += 1;
        skip_ws(c, &mut j);
        eat_word(c, &mut j, value)
    };
    if ok {
        *i = j;
    }
    ok
}

fn hidden_at(c: &[char], mut i: usize) -> bool {
    skip_ws(c, &mut i);
    if !eat_pair(c, &mut i, "display", "none") && !eat_pair(c, &mut i, "visibility", "hidden") {
        return false;
    }
    skip_ws(c, &mut i);
    let before = i;
    if eat_word(c, &mut i, "!important") {
        skip_ws(c, &mut i);
        if i == c.len() || c[i] == ';' {
            return true;
        }
    }
    i = before;
    i == c.len() || c[i] == ';'
}
