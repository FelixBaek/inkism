//! Backlink extraction: `[[Title]]` wiki-links and `note://<id>` URLs.
//! Hand-rolled scanning (no regex dependency). Runs on the background index
//! worker. Backup import also uses the exact-ID URL remapper below.

/// Targets referenced by one note body. `ById` are exact note ids,
/// `ByTitle` are stored as titles and resolved against current notes at query time.
pub fn extract(content: &str) -> Vec<Link> {
    let bytes = content.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"note://") {
            i = scan_note_url(content, i + 7, &mut out);
        } else if bytes[i..].starts_with(b"[[") {
            i = scan_wiki_link(content, i + 2, &mut out);
        } else {
            // Advance by one *character* to stay on UTF-8 boundaries.
            let mut step = 1;
            while i + step < bytes.len() && !content.is_char_boundary(i + step) {
                step += 1;
            }
            i += step;
        }
    }
    out
}

/// Extract only actual references, excluding code examples and hidden HTML.
pub fn extract_format(content: &str, format: &str) -> Vec<Link> {
    match format {
        "text" => Vec::new(),
        "html" => extract_html(content),
        "markdown" => {
            use pulldown_cmark::{Event, Parser, Tag, TagEnd};
            let mut out = Vec::new();
            let mut text = String::new();
            let mut code = false;
            let mut raw_hidden: Option<&str> = None;
            let flush = |text: &mut String, out: &mut Vec<Link>| {
                out.extend(extract(text));
                text.clear();
            };
            for event in Parser::new_ext(content, pulldown_cmark::Options::all()) {
                if let Event::Html(value) | Event::InlineHtml(value) = &event {
                    let lower = value.to_ascii_lowercase();
                    if let Some(tag) = raw_hidden {
                        if lower.contains(&format!("</{tag}")) {
                            raw_hidden = None;
                        }
                        continue;
                    }
                    if let Some(tag) = ["code", "pre", "script", "style", "textarea", "template"]
                        .into_iter()
                        .find(|tag| {
                            lower
                                .trim_start()
                                .strip_prefix(&format!("<{tag}"))
                                .is_some_and(|rest| {
                                    rest.starts_with('>') || rest.starts_with(char::is_whitespace)
                                })
                        })
                    {
                        if !lower.contains(&format!("</{tag}")) {
                            raw_hidden = Some(tag);
                        }
                        flush(&mut text, &mut out);
                        continue;
                    }
                }
                if raw_hidden.is_some() {
                    continue;
                }
                match event {
                    Event::Start(Tag::CodeBlock(_)) => {
                        flush(&mut text, &mut out);
                        code = true;
                    }
                    Event::End(TagEnd::CodeBlock) => code = false,
                    Event::Text(value) if !code => {
                        // WikiLink events below preserve escaped literal brackets as text.
                        for link in extract(&value) {
                            if matches!(link, Link::ById(_)) {
                                out.push(link);
                            }
                        }
                    }
                    Event::Start(Tag::Link {
                        dest_url,
                        link_type,
                        ..
                    })
                    | Event::Start(Tag::Image {
                        dest_url,
                        link_type,
                        ..
                    }) if !code => {
                        if dest_url.starts_with("note://") {
                            out.extend(extract(&dest_url));
                        } else if matches!(link_type, pulldown_cmark::LinkType::WikiLink { .. }) {
                            let target = crate::knowledge::target_note(&dest_url);
                            if !target.is_empty() {
                                out.push(Link::ByTitle(target.to_owned()));
                            }
                        }
                    }
                    Event::Code(_) => flush(&mut text, &mut out),
                    Event::Html(value) | Event::InlineHtml(value) if !code => {
                        flush(&mut text, &mut out);
                        out.extend(extract_html(&value));
                    }
                    Event::SoftBreak | Event::HardBreak if !code => text.push('\n'),
                    Event::End(TagEnd::Paragraph)
                    | Event::End(TagEnd::Heading(_))
                    | Event::End(TagEnd::Item) => flush(&mut text, &mut out),
                    _ => {}
                }
            }
            flush(&mut text, &mut out);
            out
        }
        _ => Vec::new(),
    }
}
fn extract_html(content: &str) -> Vec<Link> {
    let doc = scraper::Html::parse_fragment(content);
    let mut text = String::new();
    let mut out = Vec::new();
    for node in doc.root_element().descendants() {
        if node.ancestors().any(|ancestor| {
            ancestor.value().as_element().is_some_and(|el| {
                ["code", "pre", "script", "style", "textarea", "template"].contains(&el.name())
            })
        }) {
            continue;
        }
        if let Some(value) = node.value().as_text() {
            text.push_str(value);
        }
        if let Some(el) = node.value().as_element() {
            if el.name() == "a" {
                if let Some(href) = el.attr("href").filter(|href| href.starts_with("note://")) {
                    out.extend(extract(href));
                }
            }
        }
    }
    out.extend(extract(&text));
    out
}

/// `start` follows `note://`. Returns the index after the id characters.
fn scan_note_url(content: &str, start: usize, out: &mut Vec<Link>) -> usize {
    let bytes = content.as_bytes();
    let mut end = start;
    while end < bytes.len() {
        let b = bytes[end];
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
            end += 1;
        } else {
            break;
        }
    }
    let id = &content[start..end];
    if crate::ids::valid_id(id) {
        out.push(Link::ById(id.to_string()));
    }
    end
}

/// `start` follows `[[`. Returns the index after `]]`, or `start` when unclosed.
fn scan_wiki_link(content: &str, start: usize, out: &mut Vec<Link>) -> usize {
    let bytes = content.as_bytes();
    let mut end = start;
    while end + 1 < bytes.len() {
        if bytes[end] == b']' && bytes[end + 1] == b']' {
            let title = crate::knowledge::target_note(content[start..end].trim());
            if !title.is_empty() && title.chars().count() <= crate::limits::MAX_TITLE_CHARS {
                if let Some(id) = title
                    .strip_prefix("note://")
                    .filter(|id| crate::ids::valid_id(id))
                {
                    out.push(Link::ById(id.to_owned()));
                } else {
                    out.push(Link::ByTitle(title.to_string()));
                }
            }
            return end + 2;
        }
        end += 1;
    }
    start
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Link {
    ById(String),
    ByTitle(String),
}

/// Retarget exact note:// IDs when an imported backup receives fresh IDs.
/// Leave external links, unknown targets and title links untouched.
pub fn remap_note_urls<'a>(
    content: &'a str,
    ids: &std::collections::HashMap<&str, String>,
) -> std::borrow::Cow<'a, str> {
    let mut output: Option<String> = None;
    let mut copied = 0;
    for (offset, _) in content.match_indices("note://") {
        let start = offset + 7;
        let length = content.as_bytes()[start..]
            .iter()
            .take_while(|&&b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            .count();
        let end = start + length;
        if let Some(replacement) = ids.get(&content[start..end]) {
            let out = output.get_or_insert_with(|| String::with_capacity(content.len()));
            out.push_str(&content[copied..start]);
            out.push_str(replacement);
            copied = end;
        }
    }
    match output {
        Some(mut out) => {
            out.push_str(&content[copied..]);
            std::borrow::Cow::Owned(out)
        }
        None => std::borrow::Cow::Borrowed(content),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_both_kinds() {
        let links = extract("see [[회의 메모]] and note://abc-123 plus [[x]] done");
        assert_eq!(
            links,
            vec![
                Link::ByTitle("회의 메모".into()),
                Link::ById("abc-123".into()),
                Link::ByTitle("x".into()),
            ]
        );
    }

    #[test]
    fn korean_and_unclosed() {
        assert_eq!(
            extract("한글[[노트]][[안닫힘"),
            vec![Link::ByTitle("노트".into())]
        );
        assert!(extract("[[no close").is_empty());
    }
}

/// Bounded location records emitted while the background worker already owns
/// the source. Offset iteration preserves UTF-8 positions and excludes code.
pub fn markdown_locations(content: &str) -> Vec<(String,usize,usize,String)> {
 use pulldown_cmark::{Event,Parser,Tag,TagEnd};
 let mut out=Vec::new();let mut current:Option<(String,usize,usize,String)>=None;let mut hidden:Option<&str>=None;
 for(event,range)in Parser::new_ext(content,pulldown_cmark::Options::all()).into_offset_iter(){
  if let Event::Html(value)|Event::InlineHtml(value)=&event{let lower=value.to_ascii_lowercase();if let Some(tag)=hidden{if lower.contains(&format!("</{tag}")){hidden=None;}continue;}hidden=["code","pre","script","style","textarea","template"].into_iter().find(|tag|lower.trim_start().strip_prefix(&format!("<{tag}")).is_some_and(|s|s.starts_with('>')||s.starts_with(char::is_whitespace))&&!lower.contains(&format!("</{tag}")));}
  if hidden.is_some(){continue;}
  match event{
   Event::Start(Tag::Link{dest_url,link_type,..})=>{if dest_url.starts_with("note://")||matches!(link_type,pulldown_cmark::LinkType::WikiLink{..}){let target=crate::knowledge::target_note(&dest_url).to_owned();current=Some((target,usize::MAX,0,String::new()));}},
   Event::Text(value)|Event::Code(value)=>if let Some((_,start,end,label))=&mut current{if label.len()+value.len()<=4096{*start=(*start).min(range.start);*end=range.end;label.push_str(&value);}else{current=None;}},
   Event::SoftBreak|Event::HardBreak=>if let Some((_,_,end,label))=&mut current{*end=range.end;label.push(' ');},
   Event::End(TagEnd::Link)=>if let Some((target,start,end,label))=current.take(){if start!=usize::MAX&&!label.is_empty(){out.push((target,start,end,label));}},
   _=>{}
  }
 }
 out
}
