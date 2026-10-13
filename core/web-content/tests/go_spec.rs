//! Port of the former Go implementation's sanitizer tests.

use inkism_web_content::{clean, clean_export, source_url, MAX_BYTES};

#[test]
fn active_and_private_content_removed() {
    let got = clean(r#"<h1 onclick="x()">Hello</h1><script>secret()</script><img src="http://private/x"><a href="javascript:x()">link</a><iframe>hidden</iframe><p style="background:url(x)">한글 &amp; ok</p><span data-attachment="vault">file</span>"#).unwrap();
    assert_eq!(got.html, "<h1>Hello</h1>link<p>한글 &amp; ok</p>file");
    assert!(got.text.contains("한글 & ok"), "{:?}", got.text);
    for bad in [
        "file:///c:/secret",
        "javascript:alert(1)",
        "https://user:pass@host/x",
        "//host/x",
    ] {
        assert!(source_url(bad).is_err(), "{bad}");
    }
    assert_eq!(
        source_url("https://example.com/page#secret").unwrap(),
        "https://example.com/page"
    );
    assert!(
        clean(&"x".repeat(MAX_BYTES + 1)).is_err(),
        "unbounded input"
    );
}

#[test]
fn export_preserves_alternatives_and_rejects_loss() {
    let got = clean_export(r#"<p hidden>private</p><p style="display: none !important">secret</p><table><tr><td colspan="2">keep</td></tr></table><img alt="plot &amp; labels" src="https://secret"><input type="checkbox" checked>"#, 64 << 20)
        .unwrap()
        .html;
    assert!(!got.contains("private") && !got.contains("secret"), "{got}");
    assert!(
        got.contains(r#"colspan="2""#) && got.contains("plot &amp; labels") && got.contains("[x]"),
        "{got}"
    );
    let deep = format!("{}lost{}", "<div>".repeat(130), "</div>".repeat(130));
    for raw in [
        r#"<img src="secret">"#,
        "<math><mi>x</mi></math>",
        deep.as_str(),
    ] {
        assert!(
            clean_export(raw, 64 << 20).is_err(),
            "silently lost unsupported content: {raw}"
        );
    }
    clean_export(&format!("<p>{}</p>", "x".repeat(3 << 20)), 64 << 20).unwrap();
}

#[test]
fn export_preserves_only_known_formatting() {
    let raw = r#"<table data-table-style="striped" onclick="evil()"><tr><td data-cell-tone="success" style="vertical-align:middle;background:url(https://secret);position:fixed"><p dir="rtl" style="text-align:right;color:expression(evil())">cell</p></td></tr></table><ol start="8" style="list-style-type:lower-roman"><li>item</li></ol><pre data-wrap="true">code</pre><hr style="border-top-style:dotted">"#;
    let got = clean_export(raw, 64 << 20).unwrap().html;
    for keep in [
        r#"data-table-style="striped""#,
        r#"data-cell-tone="success""#,
        "vertical-align:middle",
        r#"dir="rtl""#,
        "text-align:right",
        r#"start="8""#,
        "list-style-type:lower-roman",
        r#"data-wrap="true""#,
        "border-top-style:dotted",
    ] {
        assert!(got.contains(keep), "lost {keep}: {got}");
    }
    for bad in [
        "onclick",
        "evil",
        "url(",
        "position",
        "secret",
        "expression",
    ] {
        assert!(!got.contains(bad), "unsafe {bad}: {got}");
    }
    let got = clean_export(r#"<table data-table-style='url(evil)'><tr><td data-cell-tone='red' style='text-align:center!important;vertical-align:url(evil)'>x</td></tr></table><pre data-wrap='false'>x</pre>"#, 64 << 20)
        .unwrap()
        .html;
    assert!(!got.contains("data-") && !got.contains("style="), "{got}");
    let imported = clean(raw).unwrap().html;
    assert!(
        !imported.contains("style=") && !imported.contains("data-"),
        "import policy changed: {imported}"
    );
}
