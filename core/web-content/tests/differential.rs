//! Differential test: every fixture in tests/fixtures/cases.json must give
//! exactly the output the former Go implementation recorded in go-expected.json
//! (html, text, error). The Go generator was removed with the Go tree; the
//! oracle script is in git history (tests/oracle/ at commit 3ca693d).

use inkism_web_content::{clean, clean_export, source_url, Cleaned, Error};
use serde_json::{json, Value};

fn fixture(name: &str) -> Value {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn result(r: Result<Cleaned, Error>) -> Value {
    match r {
        Ok(c) => json!({"html": c.html, "text": c.text, "error": ""}),
        Err(e) => json!({"html": "", "text": "", "error": e.to_string()}),
    }
}

#[test]
fn sanitizer_matches_go() {
    let cases = fixture("cases.json");
    let expected = fixture("go-expected.json");
    let cases = cases["html"].as_array().unwrap();
    let expected = expected["html"].as_array().unwrap();
    assert_eq!(cases.len(), expected.len(), "regenerate go-expected.json");
    let mut failures = Vec::new();
    for (case, want) in cases.iter().zip(expected) {
        let name = case["name"].as_str().unwrap();
        assert_eq!(want["name"], name);
        let html = case["html"].as_str().unwrap();
        let limit = case["limit"].as_u64().unwrap_or(64 << 20) as usize;
        let got_clean = result(clean(html));
        let got_export = result(clean_export(html, limit));
        if got_clean != want["clean"] {
            failures.push(format!(
                "{name} [clean]\n  go:   {}\n  rust: {got_clean}",
                want["clean"]
            ));
        }
        // Export now retains scientific super/subscripts. Keep the historical
        // Go snapshot intact and spell out this intentional policy extension.
        let mut want_export = want["export"].clone();
        if name == "ruby and others" {
            want_export["html"] = json!("漢kan<sup>1</sup><sub>2</sub>mk");
        }
        if got_export != want_export {
            failures.push(format!(
                "{name} [export]\n  go:   {}\n  rust: {got_export}",
                want_export
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn source_url_matches_go() {
    let cases = fixture("cases.json");
    let expected = fixture("go-expected.json");
    let urls = cases["urls"].as_array().unwrap();
    let expected = expected["urls"].as_array().unwrap();
    assert_eq!(urls.len(), expected.len(), "regenerate go-expected.json");
    let mut failures = Vec::new();
    for (url, want) in urls.iter().zip(expected) {
        let url = url.as_str().unwrap();
        let got = match source_url(url) {
            Ok(u) => json!({"url": url, "result": u, "error": ""}),
            Err(e) => json!({"url": url, "result": "", "error": e.to_string()}),
        };
        let go = want;
        if &got != go {
            failures.push(format!("go:   {go}\n  rust: {got}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
