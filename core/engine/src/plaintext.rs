//! Search text derived from HTML for clients that only load a block window.
//! HTML is never executed or rewritten. Literal paragraphs avoid a DOM;
//! Flat editor paragraphs/headings use the existing HTML tokenizer without a
//! DOM. Other markup uses iterative traversal to handle deeply nested imports.
use crate::error::Result;
use html5ever::tokenizer::{
    BufferQueue, Tag, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts,
};
use html5ever::{tendril::StrTendril, LocalName};
use scraper::{Html, Node};
use std::cell::RefCell;

pub fn from_html(source: &str) -> Result<String> {
    if let Some(text) = plain_paragraphs(source)? {
        return Ok(text);
    }
    if let Some(text) = flat_blocks(source)? {
        return Ok(text);
    }
    from_html_dom(source)
}

/// The balanced subset has no implied closures, adoption across blocks,
/// foster parenting, raw-text states or custom attachment text. Character
/// references and CR normalization still belong to html5ever, the same
/// tokenizer that the full parser uses. Reject anything outside that grammar.
fn flat_blocks(mut source: &str) -> Result<Option<String>> {
    // html5ever 0.39 checks discard_bom at every feed, not just the first.
    // Match parse_fragment's single input: remove only the document's first
    // BOM, then keep any BOM at an internal text/attribute chunk boundary.
    source = source.strip_prefix('\u{feff}').unwrap_or(source);
    // A cheap conservative scan avoids tokenizing most of a large rich note
    // only to discover a table/list near its end and parse it all again.
    // Apparent tags inside attributes/comments may reject an otherwise valid
    // fragment; that is only a missed optimization, never a semantic change.
    for (at, _) in source.match_indices('<') {
        let tail = &source[at + 1..];
        if tail.starts_with("!--") {
            continue;
        }
        let tail = tail.strip_prefix('/').unwrap_or(tail);
        let end = tail.bytes().take_while(u8::is_ascii_alphanumeric).count();
        let name = &tail[..end];
        if !(flat_block(name) || flat_inline(name) || name == "br") {
            return Ok(None);
        }
    }
    let input = BufferQueue::default();
    let tokenizer = Tokenizer::new(
        FlatSink::default(),
        TokenizerOpts {
            discard_bom: false,
            ..Default::default()
        },
    );
    // Stop promptly on unsupported markup, without copying/tokenizing the
    // remainder before the original tree parser handles it. Tokenizer state
    // carries tags, entities and CR pairs across these UTF-8-safe chunks.
    while !source.is_empty() {
        let mut end = source.len().min(8192);
        while !source.is_char_boundary(end) {
            end -= 1;
        }
        input.push_back(StrTendril::from(&source[..end]));
        let _ = tokenizer.feed(&input);
        if tokenizer.sink.0.borrow().rejected {
            return Ok(None);
        }
        source = &source[end..];
    }
    tokenizer.end();
    let state = tokenizer.sink.0.into_inner();
    if state.rejected || !state.stack.is_empty() {
        return Ok(None);
    }
    crate::ops_notes::check_field_size("derived text", &state.output)?;
    Ok(Some(state.output.trim().to_string()))
}

#[derive(Default)]
struct FlatState {
    output: String,
    stack: Vec<LocalName>,
    rejected: bool,
}
#[derive(Default)]
struct FlatSink(RefCell<FlatState>);

fn flat_block(name: &str) -> bool {
    matches!(name, "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
}
fn flat_inline(name: &str) -> bool {
    matches!(
        name,
        "strong"
            | "b"
            | "em"
            | "i"
            | "s"
            | "u"
            | "strike"
            | "span"
            | "mark"
            | "code"
            | "sub"
            | "sup"
            | "a"
            | "small"
    )
}
impl FlatState {
    /// Applies one tag of the flat grammar; anything else rejects the input.
    fn tag(&mut self, tag: Tag) {
        let custom = tag.attrs.iter().any(|a| {
            a.name.local.as_ref() == "data-type" && a.value.as_ref() == "mindbox-attachment"
        });
        if custom || tag.had_duplicate_attributes {
            self.rejected = true;
        } else if tag.kind == TagKind::EndTag {
            self.end_tag(tag);
        } else {
            self.start_tag(tag);
        }
    }

    fn end_tag(&mut self, tag: Tag) {
        if !tag.attrs.is_empty() || tag.self_closing || self.stack.last() != Some(&tag.name) {
            self.rejected = true;
        } else {
            self.stack.pop();
            if flat_block(tag.name.as_ref()) {
                newline(&mut self.output);
            }
        }
    }

    fn start_tag(&mut self, tag: Tag) {
        let name = tag.name.as_ref();
        if name == "br" && !self.stack.is_empty() {
            newline(&mut self.output);
        } else if tag.self_closing || self.stack.len() >= 128 {
            self.rejected = true;
        } else if flat_block(name) && self.stack.is_empty() {
            newline(&mut self.output);
            self.stack.push(tag.name);
        } else if flat_inline(name)
            && !self.stack.is_empty()
            && !(name == "a" && self.stack.iter().any(|n| n.as_ref() == "a"))
        {
            self.stack.push(tag.name);
        } else {
            self.rejected = true;
        }
    }
}
impl TokenSink for FlatSink {
    type Handle = ();
    fn process_token(&self, token: Token, _line: u64) -> TokenSinkResult<()> {
        let mut state = self.0.borrow_mut();
        if state.rejected {
            return TokenSinkResult::Continue;
        }
        match token {
            Token::CharacterTokens(text) => state.output.push_str(&text),
            Token::CommentToken(_) | Token::EOFToken => {}
            Token::TagToken(tag) => state.tag(tag),
            // Invalid tokens, nulls and declarations retain all tree-builder
            // recovery behavior by going through the original parser.
            _ => state.rejected = true,
        }
        TokenSinkResult::Continue
    }
}

/// The editor's plain paragraphs need neither a DOM nor a tree traversal.
/// Accept only contiguous, explicit <p>...</p> elements containing literal
/// text. Entities, parser-normalized characters and any markup use the full
/// HTML parser, including malformed HTML's implicit element closures.
fn plain_paragraphs(mut source: &str) -> Result<Option<String>> {
    if source.is_empty() {
        return Ok(Some(String::new()));
    }
    let mut output = String::new();
    while !source.is_empty() {
        let Some(rest) = source.strip_prefix("<p>") else {
            return Ok(None);
        };
        let Some(end) = rest.find('<') else {
            return Ok(None);
        };
        let text = &rest[..end];
        let Some(tail) = rest[end..].strip_prefix("</p>") else {
            return Ok(None);
        };
        if text
            .as_bytes()
            .iter()
            .any(|b| matches!(b, b'&' | b'\r' | 0))
        {
            return Ok(None);
        }
        newline(&mut output);
        output.push_str(text);
        newline(&mut output);
        crate::ops_notes::check_field_size("derived text", &output)?;
        source = tail;
    }
    output.truncate(output.trim_end().len());
    let leading = output.len() - output.trim_start().len();
    output.drain(..leading);
    Ok(Some(output))
}

fn from_html_dom(source: &str) -> Result<String> {
    let document = Html::parse_fragment(source);
    let mut output = String::new();
    let mut stack = vec![(document.tree.root(), false)];
    while let Some((node, exiting)) = stack.pop() {
        match node.value() {
            Node::Text(text) if !exiting => output.push_str(text),
            Node::Element(element) if !push_element_text(element, exiting, &mut output) => {
                continue;
            }
            _ => {}
        }
        crate::ops_notes::check_field_size("derived text", &output)?;
        if !exiting {
            stack.push((node, true));
            for child in node.children().rev() {
                stack.push((child, false));
            }
        }
    }
    Ok(output.trim().to_string())
}
/// Text an element contributes on entry/exit. Returns false when its
/// children are skipped (hidden content or an attachment's own name).
fn push_element_text(element: &scraper::node::Element, exiting: bool, output: &mut String) -> bool {
    let tag = element.name();
    if matches!(tag, "script" | "style" | "template" | "noscript" | "iframe") {
        return false;
    }
    if text_block(tag) || tag == "br" {
        newline(output);
    }
    if !exiting {
        if element.attr("data-type") == Some("mindbox-attachment") {
            output.push_str(element.attr("data-name").unwrap_or("파일"));
            newline(output);
            return false;
        }
        if tag == "img" {
            output.push_str(element.attr("alt").unwrap_or(""));
        }
    } else if matches!(tag, "td" | "th") && !output.ends_with('\t') {
        output.push('\t');
    }
    true
}

fn text_block(tag: &str) -> bool {
    matches!(
        tag,
        "p" | "div"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "li"
            | "ul"
            | "ol"
            | "tr"
            | "table"
            | "blockquote"
            | "pre"
            | "details"
            | "summary"
            | "section"
            | "article"
            | "hr"
    )
}

fn newline(output: &mut String) {
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn entities_quotes_hidden_details_and_custom_nodes() {
        let html = r#"<p title="a > b">한글 &amp; &#x1F600;<br>줄</p><!-- 없음 --><details><summary>접기</summary><div hidden><p>안쪽</p></div></details><div data-type="mindbox-attachment" data-name="사진&amp;파일.png"><a>장식과 크기</a></div><span data-type="inline-math">E=mc^2</span><script>검색제외</script><style>검색제외</style><template>검색제외</template>"#;
        let text = from_html(html).unwrap();
        assert_eq!(text, "한글 & 😀\n줄\n접기\n안쪽\n사진&파일.png\nE=mc^2");
        assert_eq!(html.as_bytes()[0], b'<');
    }
    #[test]
    fn malformed_html_and_preformatted_text() {
        assert_eq!(from_html("<p>앞<p>뒤 &lt;끝&gt;").unwrap(), "앞\n뒤 <끝>");
        assert_eq!(
            from_html("<pre><code>a  b\n  c</code></pre>").unwrap(),
            "a  b\n  c"
        );
        let nested = format!("{}중첩{}", "<div>".repeat(2000), "</div>".repeat(2000));
        assert_eq!(from_html(&nested).unwrap(), "중첩");
    }

    #[test]
    fn plain_paragraphs_match_html_parser_whitespace_and_unicode() {
        let texts = [
            "",
            " ",
            "한글😀",
            "a > b",
            "\n",
            "앞\n뒤",
            "\t끝\t",
            "\u{00a0}",
            "\u{2003}글",
            "\u{000c}글\u{000b}",
        ];
        for a in texts {
            for b in texts {
                for c in texts {
                    let html = format!("<p>{a}</p><p>{b}</p><p>{c}</p>");
                    let fast = plain_paragraphs(&html)
                        .unwrap()
                        .expect("literal paragraphs");
                    assert_eq!(fast, from_html_dom(&html).unwrap(), "{html:?}");
                    assert_eq!(from_html(&html).unwrap(), fast);
                }
            }
        }
    }

    #[test]
    fn paragraph_shortcut_defers_html_semantics_to_parser() {
        for html in [
            "<p>&amp; &#x1F600;</p>",
            "<p>\r\n한글</p>",
            "<p>\0</p>",
            "<p><strong>서식</strong></p>",
            "<p><p>암묵적 닫기</p></p>",
            "<p>앞</p>\n<p>뒤</p>",
            "<p title=\"a > b\">속성</p>",
            "<p>닫기 없음",
            "<p>완료</p><script>제외</script>",
            "<p>완료</p><!-- 주석 -->",
            "<P>대문자</P>",
            "<p><img alt=\"이미지\"></p>",
            "<pre>a  b</pre>",
        ] {
            assert_eq!(plain_paragraphs(html).unwrap(), None, "{html:?}");
            assert_eq!(
                from_html(html).unwrap(),
                from_html_dom(html).unwrap(),
                "{html:?}"
            );
        }
    }

    #[test]
    fn literal_character_text_matches_html_parser() {
        for scalar in 0..=127 {
            let ch = char::from_u32(scalar).unwrap();
            let html = format!("<p>앞{ch}뒤</p><p>끝</p>");
            assert_eq!(
                from_html(&html).unwrap(),
                from_html_dom(&html).unwrap(),
                "{html:?}"
            );
        }
    }

    fn assert_flat_matches_dom(html: &str, nested_anchors: bool) {
        let dom = from_html_dom(html).unwrap();
        let flat = flat_blocks(html).unwrap();
        if nested_anchors {
            assert!(flat.is_none(), "nested anchors need tree recovery");
        } else {
            assert_eq!(flat.as_deref(), Some(dom.as_str()), "{html:?}");
        }
        assert_eq!(from_html(html).unwrap(), dom, "{html:?}");
    }

    #[test]
    fn flat_rich_blocks_match_dom_for_nested_inline_marks_and_block_whitespace() {
        let blocks = ["p", "h1", "h2", "h3", "h4", "h5", "h6"];
        let inline = [
            "strong", "b", "em", "i", "s", "u", "strike", "span", "mark", "code", "sub", "sup",
            "a", "small",
        ];
        let separators = ["", "\n", " \t", "<!--사이--> "];
        for block in blocks {
            for outer in inline {
                for inner in inline {
                    for sep in separators {
                        let html = format!("앞 <{block} title=\"a &gt; b\"><{outer}><{inner}> &amp; 한글 &#x1F600; </{inner}><br/>뒤\r\n </{outer}></{block}>{sep}<p><strong>끝</strong> </p>");
                        assert_flat_matches_dom(&html, outer == "a" && inner == "a");
                    }
                }
            }
        }
    }

    #[test]
    fn flat_tokens_match_dom_entities_controls_bom_and_empty_blocks() {
        let text = [
            "",
            " ",
            "\n",
            "\t",
            "\r\n",
            "\u{00a0}",
            "\u{2003}",
            "&nbsp;",
            "&notit;",
            "&copy",
            "&#13;&#10;",
            "&NewLine;",
            "&NotEqualTilde;",
            "&#x1F600;",
            "&lt;p&gt;&amp;&quot;&#39;",
            "&#0;",
            "&#x110000;",
            "&#xD800;",
            "&#x80;",
            "\0",
        ];
        for a in text {
            for b in text {
                let html = format!("\u{feff}<p data-x=\"a > b\"><span> {a} </span></p><p></p>\t<p><em>{b}</em><br><br>끝</p>");
                assert_eq!(
                    from_html(&html).unwrap(),
                    from_html_dom(&html).unwrap(),
                    "{html:?}"
                );
            }
        }
        for text in [
            "&amp;",
            "&nbsp;",
            "&#10;",
            "&NewLine;",
            "&NotEqualTilde;",
            "&#x1F600;",
            "\r\n",
            "가😀",
        ] {
            let html = format!("\u{feff}<p><span>앞{text}뒤</span><br>끝</p>");
            let expected = from_html_dom(&html).unwrap();
            assert_eq!(
                flat_blocks(&html).unwrap().as_deref(),
                Some(expected.as_str()),
                "must exercise the tokenizer path: {html:?}"
            );
        }
        for scalar in 0..=127 {
            let html = format!(
                "<p><strong>앞{}뒤</strong></p><p><code> 끝 </code></p>",
                char::from_u32(scalar).unwrap()
            );
            assert_eq!(
                from_html(&html).unwrap(),
                from_html_dom(&html).unwrap(),
                "{html:?}"
            );
        }
    }

    #[test]
    fn tree_dependent_markup_falls_back_without_changing_recovery_semantics() {
        for html in [
            "<p><strong>교차<em>닫기</strong>뒤</em></p>",
            "<p><span>암묵적<p>종료</span></p>",
            "<h1><h2>제목 종료</h2></h1>",
            "<p><a href=\"one\"><a href=\"two\">중첩 링크</a></a></p>",
            "<p><span data-type=\"mindbox-attachment\" data-name=\"사진&amp;파일\">내부 장식</span></p>",
            "<p><strong/>자기 닫기</p>",
            "<p title=one title=two><span>중복 속성</span></p>",
            "<p><span>끝 없음",
            "<p><em>줄</em></br>뒤</p>",
            "<pre>\n첫 줄 생략</pre>",
            "<table>외부 텍스트<tr><td>표</td></tr>끝</table>",
            "<p><svg><title>SVG 제목</title></svg>뒤</p>",
            "<p><script>검색 제외</script><style>검색 제외</style>뒤</p>",
            "<p><textarea>&amp; 텍스트</textarea></p>",
            "<p><template>검색 제외</template><img alt=\"이미지\"></p>",
            "<!DOCTYPE html><p><b>본문</b></p>",
            "<span>루트 인라인</span><br>끝",
        ] {
            assert!(flat_blocks(html).unwrap().is_none(), "{html:?}");
            assert_eq!(from_html(html).unwrap(), from_html_dom(html).unwrap(), "{html:?}");
        }
        let deep = format!(
            "<p>{}깊은 서식{}</p>",
            "<span>".repeat(2000),
            "</span>".repeat(2000)
        );
        assert!(flat_blocks(&deep).unwrap().is_none());
        assert_eq!(from_html(&deep).unwrap(), from_html_dom(&deep).unwrap());
    }

    #[test]
    fn short_arbitrary_token_sequences_agree_with_full_tree_parser() {
        let tokens = [
            "<p>",
            "</p>",
            "<b>",
            "</b>",
            "<a>",
            "</a>",
            "<br>",
            "<span data-type=\"mindbox-attachment\">",
            "<table>",
            "</table>",
            "&amp;",
            "\0",
            " ",
            "한글😀",
        ];
        // Reproducible invalid/valid HTML, including implied closures and
        // adoption cases that a balanced tag stack must never accept.
        let mut seed = 192837465u64;
        for _ in 0..5000 {
            let mut html = String::new();
            for _ in 0..12 {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                html.push_str(tokens[((seed >> 32) as usize) % tokens.len()]);
            }
            assert_eq!(
                from_html(&html).unwrap(),
                from_html_dom(&html).unwrap(),
                "{html:?}"
            );
        }
    }

    #[test]
    fn chunk_boundaries_preserve_tags_entities_cr_pairs_and_unicode() {
        for at in 8160..8220 {
            let prefix = format!("<p><strong>{}", "가".repeat(at / 3));
            for tail in [
                "&NotEqualTilde;&#x1F600;",
                "\r\n",
                "<span title=\"a &gt; b\">😀</span>",
                "</strong></p><h2><em>",
            ] {
                let html = format!("{prefix}{tail}끝</strong></p>");
                let dom = from_html_dom(&html).unwrap();
                assert_eq!(
                    from_html(&html).unwrap(),
                    dom,
                    "boundary at {at}, tail {tail:?}"
                );
                if !tail.contains("<h2>") {
                    assert_eq!(flat_blocks(&html).unwrap().as_deref(), Some(dom.as_str()));
                }
            }
        }
    }

    #[test]
    fn chunk_boundaries_never_discard_embedded_byte_order_marks() {
        let prefix = "<p><strong>";
        for boundary in [8192, 16384, 24576] {
            let html = format!(
                "{prefix}{}\u{feff}끝</strong></p>",
                "a".repeat(boundary - prefix.len())
            );
            let expected = from_html_dom(&html).unwrap();
            assert!(expected.contains('\u{feff}'));
            assert_eq!(
                flat_blocks(&html).unwrap().as_deref(),
                Some(expected.as_str())
            );
        }
        let html = "\u{feff}\u{feff}<p><strong>본문\u{feff}끝</strong></p>";
        assert_eq!(
            flat_blocks(html).unwrap().as_deref(),
            Some(from_html_dom(html).unwrap().as_str())
        );
    }

    #[test]
    #[ignore = "manual rich plaintext tokenizer benchmark"]
    fn benchmark_flat_rich_blocks() {
        let html: String = (0..100_000).map(|n| format!("<p><strong>한글 {n} 😀</strong> &amp; <a href=\"https://example.invalid\">링크</a><br>끝</p>")).collect();
        let expected = from_html_dom(&html).unwrap();
        assert_eq!(
            flat_blocks(&html).unwrap().as_deref(),
            Some(expected.as_str())
        );
        let mut flat = Vec::new();
        let mut dom = Vec::new();
        for _ in 0..5 {
            let start = std::time::Instant::now();
            let actual = from_html(&html).unwrap();
            flat.push(start.elapsed().as_micros());
            assert_eq!(actual, expected);
            let start = std::time::Instant::now();
            let actual = from_html_dom(&html).unwrap();
            dom.push(start.elapsed().as_micros());
            assert_eq!(actual, expected);
        }
        flat.sort_unstable();
        dom.sort_unstable();
        eprintln!(
            "100000 rich paragraphs, {} source bytes: tokenizer median {} us, DOM median {} us",
            html.len(),
            flat[2],
            dom[2]
        );
    }

    #[test]
    #[ignore = "manual plaintext parser benchmark"]
    fn benchmark_plain_paragraphs() {
        let html: String = (0..100_000)
            .map(|n| format!("<p>한글 {n} 😀</p>"))
            .collect();
        let expected = from_html_dom(&html).unwrap();
        let mut fast = Vec::new();
        let mut dom = Vec::new();
        for _ in 0..5 {
            let started = std::time::Instant::now();
            let actual = from_html(&html).unwrap();
            fast.push(started.elapsed().as_micros());
            assert_eq!(actual, expected);
            let started = std::time::Instant::now();
            let actual = from_html_dom(&html).unwrap();
            dom.push(started.elapsed().as_micros());
            assert_eq!(actual, expected);
        }
        fast.sort_unstable();
        dom.sort_unstable();
        eprintln!(
            "100000 literal paragraphs, {} source bytes: shortcut median {} us, DOM median {} us",
            html.len(),
            fast[2],
            dom[2]
        );
    }
}
