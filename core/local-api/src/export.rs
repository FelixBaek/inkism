//! Formatted HTML/PDF export (Go `formatted_export.go`).

use crate::{Handler, Request, Response};
use serde::Deserialize;
use std::sync::{Mutex, TryLockError};
use std::time::{Duration, Instant};

/// Largest standalone document (Go `pdfexport.MaxDocumentBytes`).
const MAX_DOCUMENT_BYTES: usize = 64 << 20;

/// One export at a time (Go `exportSlot`).
static EXPORT_SLOT: Mutex<()> = Mutex::new(());

const EXPORT_CSS: &str = r#"@page{size:A4;margin:18mm}body{font-family:"Malgun Gothic","Segoe UI",sans-serif;line-height:1.6;color:#202624;overflow-wrap:anywhere}h1,h2,h3{break-after:avoid}pre{white-space:pre;overflow-x:auto;background:#f5f6f5;padding:12px}table{border-collapse:collapse;max-width:100%;width:100%;table-layout:fixed}th,td{border:1px solid #bfc7c1;padding:6px;vertical-align:top}blockquote{border-left:3px solid #087f5b;padding-left:12px}img{max-width:100%}pre[data-wrap="true"],pre[data-wrap="true"] code{white-space:pre-wrap;overflow-wrap:anywhere}table[data-table-style="striped"] tr:nth-child(even){background:#e9e7e2}table[data-table-style="plain"] :is(td,th){border-left:0;border-right:0}:is(td,th)[data-cell-tone="soft"]{background:#e9e7e2}:is(td,th)[data-cell-tone="success"]{background:#dde5da}:is(td,th)[data-cell-tone="warning"]{background:#f2ecdf}th{background:#efede9}hr{border:0;border-top:1px solid #dedbd5}@media print{*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}"#;

/// Go `html.EscapeString`.
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\'' => out.push_str("&#39;"),
            '"' => out.push_str("&#34;"),
            c => out.push(c),
        }
    }
    out
}

pub(crate) fn standalone_document(title: &str, fragment: &str) -> Result<Vec<u8>, String> {
    let safe = inkism_web_content::clean_export(fragment, MAX_DOCUMENT_BYTES).map_err(|e| e.to_string())?;
    let title = escape(title);
    let document = format!(
        r#"<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>{title}</title><style>{EXPORT_CSS}</style></head><body><h1>{title}</h1>{}</body></html>"#,
        safe.html
    );
    if document.len() > MAX_DOCUMENT_BYTES {
        return Err("서식 문서가 64 MiB 한도를 넘었습니다".into());
    }
    Ok(document.into_bytes())
}

fn export_filename(title: &str, extension: &str) -> String {
    let cleaned: String =
        title.chars().map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c }).collect();
    let mut cleaned: String = cleaned.trim_matches([' ', '.']).chars().take(100).collect();
    if cleaned.is_empty() {
        cleaned = "Inkism".into();
    }
    cleaned + extension
}

fn token_char(b: u8) -> bool {
    (0x21..0x7f).contains(&b) && !br#"()<>@,;:\"/[]?="#.contains(&b)
}

/// Go `mime.FormatMediaType("attachment", {"filename": name})`.
fn content_disposition(name: &str) -> String {
    if name.chars().any(|c| !(' '..='~').contains(&c) && c != '\t') {
        let mut out = String::from("attachment; filename*=utf-8''");
        for b in name.bytes() {
            if token_char(b) && !b"*'%".contains(&b) {
                out.push(b as char);
            } else {
                out.push_str(&format!("%{b:02X}"));
            }
        }
        out
    } else if !name.is_empty() && name.bytes().all(token_char) {
        format!("attachment; filename={name}")
    } else {
        let escaped = name.replace('\\', "\\\\").replace('"', "\\\"");
        format!("attachment; filename=\"{escaped}\"")
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportRequest {
    #[serde(default)]
    id: String,
    #[serde(default)]
    revision: i64,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Envelope {
    ok: bool,
    error: String,
    data: Rendered,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Rendered {
    id: String,
    title: String,
    revision: i64,
    html: String,
}

fn decode_request(body: &[u8]) -> Result<ExportRequest, Response> {
    let missing = || Response::fail(400, "노트와 저장된 버전이 필요합니다");
    if body.len() > 4096 {
        return Err(missing());
    }
    let mut de = serde_json::Deserializer::from_slice(body);
    let req = match ExportRequest::deserialize(&mut de) {
        Ok(req) if !req.id.is_empty() && req.id.len() <= 256 && req.revision >= 1 => req,
        _ => return Err(missing()),
    };
    if de.end().is_err() {
        return Err(Response::fail(400, "invalid request"));
    }
    Ok(req)
}

pub(crate) fn formatted(h: &Handler, r: &Request, pdf: bool) -> Response {
    if r.method != "POST" {
        return Response::fail(405, "POST required");
    }
    if !r.header("content-type").unwrap_or("").starts_with("application/json") {
        return Response::fail(415, "JSON required");
    }
    let render = match (&h.native.pdf_render, pdf) {
        (None, true) => return Response::fail(400, "PDF 내보내기는 Windows 앱에서 사용할 수 있습니다"),
        (render, _) => render,
    };
    let req = match decode_request(&r.body) {
        Ok(req) => req,
        Err(response) => return response,
    };
    let _slot = match EXPORT_SLOT.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::Poisoned(p)) => p.into_inner(),
        Err(TryLockError::WouldBlock) => {
            return Response::fail(429, "다른 내보내기가 진행 중입니다. 완료 후 다시 시도해 주세요")
        }
    };
    let call = serde_json::json!({"op": "document_render", "id": req.id, "revision": req.revision});
    let raw = match h.engine().and_then(|e| e.call(Instant::now() + Duration::from_secs(30), call.to_string().as_bytes())) {
        Ok(raw) => raw,
        Err(_) => return Response::fail(500, "문서를 준비하지 못했습니다"),
    };
    let Ok(envelope) = serde_json::from_slice::<Envelope>(&raw) else {
        return Response::fail(500, "문서 응답이 올바르지 않습니다");
    };
    if !envelope.ok {
        return Response::fail(409, envelope.error);
    }
    let data = envelope.data;
    if data.revision != req.revision || data.id != req.id {
        return Response::fail(409, "노트 버전이 변경되었습니다. 다시 시도해 주세요");
    }
    let document = match standalone_document(&data.title, &data.html) {
        Ok(document) => document,
        Err(e) => return Response::fail(422, e),
    };
    let (body, media, extension) = match render.as_ref().filter(|_| pdf) {
        Some(render) => match render(&document, Instant::now() + Duration::from_secs(60)) {
            Ok(body) => (body, "application/pdf", ".pdf"),
            Err(e) => return Response::fail(500, e),
        },
        None => (document, "text/html; charset=utf-8", ".html"),
    };
    Response { file: None, status: 200, headers: vec![("content-type".into(), media.into())], body }
        .with_header("content-disposition", content_disposition(&export_filename(&data.title, extension)))
        .with_header(
            "x-inkism-export-policy",
            "static-text;images-as-alternative-text;latex-as-source;external-resources-blocked",
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Deadline, Engine, REQUEST_TIMEOUT};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc};

    /// Export tests share the global slot; run them one at a time.
    static SERIAL: Mutex<()> = Mutex::new(());
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|p| p.into_inner())
    }

    struct ExportCaller {
        response: String,
        calls: AtomicUsize,
    }
    impl Engine for ExportCaller {
        fn call(&self, _: Deadline, raw: &[u8]) -> crate::Result<Vec<u8>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let req: serde_json::Value = serde_json::from_slice(raw).unwrap();
            assert_eq!(req["op"], "document_render", "wrong operation");
            Ok(self.response.clone().into_bytes())
        }
    }
    fn caller(response: impl Into<String>) -> Arc<ExportCaller> {
        Arc::new(ExportCaller { response: response.into(), calls: AtomicUsize::new(0) })
    }

    fn export_request(h: &Handler, path: &str, body: &str) -> Response {
        let r = Request {
            method: "POST".into(),
            path: path.into(),
            query: None,
            headers: vec![("content-type".into(), "application/json".into())],
            host: "localhost".into(),
            body: body.as_bytes().to_vec(),
        };
        h.same_origin(&r).unwrap_or_else(|| h.route(&r, Instant::now() + REQUEST_TIMEOUT))
    }
    fn text(w: &Response) -> String {
        String::from_utf8_lossy(&w.body).into_owned()
    }
    fn header<'a>(w: &'a Response, name: &str) -> &'a str {
        w.headers.iter().find(|(k, _)| k == name).map_or("", |(_, v)| v)
    }

    #[test]
    fn html_export_revision_sanitization_and_filename() {
        let _s = serial();
        let response = serde_json::json!({"ok": true, "data": {"id": "note", "revision": 3, "title": "한글 </title>../노트", "html": r#"<p onclick="evil()">문서</p><script>alert(1)</script><p hidden>private</p><img alt="그림 설명" src="https://bad.example">"#}});
        let h = Handler { engine: Some(caller(response.to_string())), ..Default::default() };
        let w = export_request(&h, "/api/export/html", r#"{"id":"note","revision":3}"#);
        assert_eq!(w.status, 200, "{}", text(&w));
        let body = text(&w);
        for leak in ["onclick", "<script", "bad.example", "private"] {
            assert!(!body.contains(leak), "active/private markup leaked: {leak}");
        }
        assert!(body.contains("Content-Security-Policy") && body.contains("그림 설명"));
        assert!(header(&w, "content-disposition").contains("filename*="), "{:?}", w.headers);
        assert_eq!(export_request(&h, "/api/export/html", r#"{"id":"note","revision":2}"#).status, 409);
        assert_eq!(export_request(&h, "/api/export/html", r#"{"id":"note"}"#).status, 400);
    }

    #[test]
    fn pdf_in_flight_rejects_concurrent_request() {
        let _s = serial();
        let engine = caller(r#"{"ok":true,"data":{"id":"n","revision":1,"title":"n","html":"<p>body</p>"}}"#);
        let (started_tx, started) = mpsc::channel();
        let (release, release_rx) = mpsc::channel::<()>();
        let (started_tx, release_rx) = (Mutex::new(started_tx), Mutex::new(release_rx));
        let mut h = Handler { engine: Some(engine.clone()), ..Default::default() };
        h.native.pdf_render = Some(Box::new(move |_doc: &[u8], _| {
            started_tx.lock().unwrap().send(()).unwrap();
            let _ = release_rx.lock().unwrap().recv();
            Err("cancelled".into())
        }));
        let h = Arc::new(h);
        let job = {
            let h = h.clone();
            std::thread::spawn(move || export_request(&h, "/api/export/pdf", r#"{"id":"n","revision":1}"#).status)
        };
        started.recv_timeout(Duration::from_secs(1)).expect("job didn't start");
        assert_eq!(export_request(&h, "/api/export/html", r#"{"id":"n","revision":1}"#).status, 429);
        release.send(()).unwrap();
        assert_eq!(job.join().unwrap(), 500);
        assert_eq!(engine.calls.load(Ordering::SeqCst), 1, "duplicate engine request");
        // The slot is free again.
        assert_eq!(export_request(&h, "/api/export/html", r#"{"id":"n","revision":1}"#).status, 200);
    }

    #[test]
    fn export_rejects_unrepresented_visual_content() {
        let _s = serial();
        let h = Handler {
            engine: Some(caller(r#"{"ok":true,"data":{"id":"n","revision":1,"html":"<img src='file:///private'>"}}"#)),
            ..Default::default()
        };
        let w = export_request(&h, "/api/export/html", r#"{"id":"n","revision":1}"#);
        assert_eq!(w.status, 422, "{}", text(&w));
    }

    #[test]
    fn table_formatting_in_html_and_pdf() {
        let _s = serial();
        let engine = caller(
            r#"{"ok":true,"data":{"id":"n","revision":1,"title":"table","html":"<table data-table-style=\"striped\"><tr><td data-cell-tone=\"success\" style=\"vertical-align:middle\"><p style=\"text-align:right\">value</p></td></tr></table>"}}"#,
        );
        let mut h = Handler { engine: Some(engine), ..Default::default() };
        h.native.pdf_render = Some(Box::new(|doc: &[u8], _| {
            let doc = String::from_utf8_lossy(doc);
            for keep in [
                r#"data-table-style="striped""#,
                r#"data-cell-tone="success""#,
                "vertical-align:middle",
                "text-align:right",
                "print-color-adjust:exact",
            ] {
                assert!(doc.contains(keep), "PDF lost {keep}");
            }
            Ok(b"%PDF-test".to_vec())
        }));
        for path in ["/api/export/html", "/api/export/pdf"] {
            let w = export_request(&h, path, r#"{"id":"n","revision":1}"#);
            assert_eq!(w.status, 200, "{path} {}", text(&w));
        }
    }

    #[test]
    fn request_and_filename_edges() {
        let _s = serial();
        let h = Handler { engine: Some(caller("{}")), ..Default::default() };
        assert_eq!(export_request(&h, "/api/export/pdf", r#"{"id":"n","revision":1}"#).status, 400);
        assert_eq!(export_request(&h, "/api/export/html", r#"{"id":"n","revision":1,"x":1}"#).status, 400);
        let trailing = export_request(&h, "/api/export/html", r#"{"id":"n","revision":1}{}"#);
        assert!(trailing.status == 400 && text(&trailing).contains("invalid request"));
        assert_eq!(export_filename(" ..a<b>\u{7}. ", ".pdf"), "a_b__.pdf");
        assert_eq!(export_filename("..", ".html"), "Inkism.html");
        assert_eq!(content_disposition("a.html"), "attachment; filename=a.html");
        assert_eq!(content_disposition("a b.html"), r#"attachment; filename="a b.html""#);
        assert_eq!(content_disposition("노트 1.pdf"), "attachment; filename*=utf-8''%EB%85%B8%ED%8A%B8%201.pdf");
        assert_eq!(escape(r#"<a href='x'>&"#), "&lt;a href=&#39;x&#39;&gt;&amp;");
    }

    #[cfg(windows)]
    #[test]
    fn real_styled_table_pdf() {
        if std::env::var("INKISM_TEST_REAL_PDF").as_deref() != Ok("1") {
            return; // explicit Windows PDF validation
        }
        let doc = standalone_document(
            "표 서식 검증",
            r#"<table data-table-style="striped"><tr><th>항목</th><th>결과</th></tr><tr><td data-cell-tone="success" style="vertical-align:middle"><p style="text-align:right">초록 · 오른쪽</p></td><td><p>줄무늬</p><p>두 번째 줄</p></td></tr><tr><td data-cell-tone="warning">노랑</td><td data-cell-tone="soft">회색</td></tr></table>"#,
        )
        .unwrap();
        let temp = std::env::temp_dir().join(format!("inkism-pdf-test-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        let renderer = inkism_pdf_export::Renderer { temp_root: Some(temp.clone()), ..Default::default() };
        let result = renderer.render(&doc);
        let _ = std::fs::remove_dir_all(&temp);
        let result = result.unwrap();
        assert!(result.len() >= 1000, "empty PDF");
        if let Ok(output) = std::env::var("INKISM_PDF_TEST_OUTPUT") {
            if !output.is_empty() {
                assert!(std::path::Path::new(&output).is_absolute(), "absolute output path required");
                std::fs::write(output, result).unwrap();
            }
        }
    }
}
