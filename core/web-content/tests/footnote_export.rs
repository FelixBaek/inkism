use inkism_web_content::{clean, clean_export};

#[test]
fn export_keeps_footnote_numbers_fragments_and_scientific_semantics() {
    let source = r##"<p><sup><a href="#fn-B">1</a></sup> again <a href="#fn-B">1</a></p><ol><li id="fn-A" value="2"><p><sup>13</sup>C; E=mc<sup>2</sup>; H<sub>2</sub>O.</p></li><li id="fn-B" value="1">Beta<a href="#fnref-B">↩</a></li></ol><div class="footnote-definition" id="markdown-a"><sup>3</sup> Markdown</div><sup class="footnote-reference"><a href="#markdown-a">3</a></sup>"##;
    assert_eq!(clean_export(source, 1 << 20).unwrap().html, source);
    assert_eq!(
        clean_export(&clean_export(source, 1 << 20).unwrap().html, 1 << 20)
            .unwrap()
            .html,
        source
    );
    let imported = clean(source).unwrap().html;
    assert!(
        !imported.contains("<sup")
            && !imported.contains("<sub")
            && !imported.contains("href=")
            && !imported.contains("value=")
    );
}

#[test]
fn export_fragment_policy_does_not_admit_resources_scripts_or_arbitrary_attributes() {
    let source = r##"<p id="ordinary" onclick="attack()">body</p><sup class="unknown" style="position:fixed" onmouseover="attack()">2</sup><sub>3</sub><a href="javascript:attack()">script URL</a><a href="https://secret/x#fn-a">external</a><a href="file:///private#fn-a">private</a><a href="//secret/#fn-a">network</a><a href="/fn-a">relative</a><a href="#ordinary">ordinary</a><a href="#fn-a" onclick="attack()" target="_blank" style="background:url(https://secret)">local</a><a href="#fn%2fa">escaped</a><a href="#fn a">space</a><li value="expression(1)">invalid</li><li value="1000000">large</li><div class="footnote-definition" id="bad id">plain</div><script>attack()</script>"##;
    let got = clean_export(source, 1 << 20).unwrap().html;
    assert!(got.contains("<sup>2</sup><sub>3</sub>"), "{got}");
    assert!(got.contains(r##"<a href="#fn-a">local</a>"##), "{got}");
    assert_eq!(got.matches("href=").count(), 1, "{got}");
    for bad in [
        "attack",
        "secret",
        "private#",
        "javascript",
        "file:",
        "target=",
        "onclick",
        "onmouseover",
        "style=",
        "class=",
        "id=",
        "value=",
        "<script",
        "<div",
    ] {
        assert!(!got.contains(bad), "unsafe {bad}: {got}");
    }
}
