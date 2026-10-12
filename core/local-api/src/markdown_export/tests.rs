use super::*;
use crate::{Attachments, Engine};
use std::io::Read;
use std::sync::Arc;
use std::time::Duration;
use zip::ZipArchive;

const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EXTRA: &str = "f8e3c38d-4c46-4b70-8ab1-41d7cf2a4fc5";

struct Fake {
    note: Value,
    bytes: Vec<u8>,
    size: u64,
    hash: String,
    missing: bool,
}
impl Attachments for Fake {
    fn import(
        &self,
        _: Deadline,
        _: &str,
        _: &str,
        _: &mut dyn Read,
    ) -> Result<AttachmentMetadata> {
        panic!("export must not modify attachments")
    }
    fn info(&self, _: Deadline, id: &str) -> Result<AttachmentMetadata> {
        if self.missing {
            return Err("첨부파일이 없습니다".into());
        }
        assert_eq!(id, ID, "unreferenced attachments must not be read");
        Ok(AttachmentMetadata {
            id: id.into(),
            name: "../../한글 이미지.PNG".into(),
            media_type: "image/png".into(),
            size: self.size,
            sha256: self.hash.clone(),
        })
    }
    fn export(&self, _: Deadline, id: &str, output: &mut dyn Write) -> Result<()> {
        assert_eq!(id, ID);
        output.write_all(&self.bytes)?;
        Ok(())
    }
    fn walk(&self, _: Deadline, _: &mut dyn FnMut(AttachmentMetadata) -> Result<()>) -> Result<()> {
        panic!("single-note export must not walk the library")
    }
}
impl Engine for Fake {
    fn call(&self, _: Deadline, raw: &[u8]) -> Result<Vec<u8>> {
        assert_eq!(
            serde_json::from_slice::<Value>(raw)?,
            json!({"op":"get", "id":"note"})
        );
        Ok(serde_json::to_vec(&json!({"ok":true, "data":self.note}))?)
    }
    fn attachments(&self) -> Option<&dyn Attachments> {
        Some(self)
    }
}

fn fixture(format: &str, source: &str) -> Fake {
    let bytes = b"image bytes \0 preserved".to_vec();
    Fake {
        note: json!({"id":"note", "title":"한글 노트", "revision":3, "content":source,
        "content_format":format, "tags":["보관"], "notebook_ids":["nb1","nb2"], "created_at":123}),
        size: bytes.len() as u64,
        hash: format!("{:x}", Sha256::digest(&bytes)),
        bytes,
        missing: false,
    }
}
fn handler(fake: Fake) -> Handler {
    Handler {
        engine: Some(Arc::new(fake)),
        ..Default::default()
    }
}
fn req(source: &str, markdown: &str) -> ExportRequest {
    ExportRequest {
        id: "note".into(),
        revision: 3,
        source: source.into(),
        markdown: markdown.into(),
    }
}
fn deadline() -> Deadline {
    Instant::now() + Duration::from_secs(10)
}
fn entry(archive: &mut ZipArchive<Cursor<Vec<u8>>>, name: &str) -> Vec<u8> {
    let mut out = Vec::new();
    archive
        .by_name(name)
        .unwrap()
        .read_to_end(&mut out)
        .unwrap();
    out
}

#[test]
fn portable_zip_keeps_metadata_and_original_and_copies_assets_once() {
    let source = format!(
        r#"<p><img src="/api/attachments/{ID}?preview=1"></p><a href="/api/attachments/{ID}">원본</a>"#
    );
    let md = format!("![그림](/api/attachments/{ID})\n\n[파일](/api/attachments/{ID})");
    let h = handler(fixture("html", &source));
    let bytes = bundle(&h, &req(&source, &md), deadline()).unwrap();
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    assert_eq!(
        archive.len(),
        6,
        "attachment referenced twice should be copied once"
    );
    assert_eq!(
        entry(&mut archive, &format!("attachments/{ID}.png")),
        b"image bytes \0 preserved"
    );
    let md_out = String::from_utf8(entry(&mut archive, "note.md")).unwrap();
    assert_eq!(
        md_out,
        format!("![그림](attachments/{ID}.png)\n\n[파일](attachments/{ID}.png)")
    );
    let portable_source = String::from_utf8(entry(&mut archive, "source.html")).unwrap();
    assert!(!portable_source.contains("/api/") && !portable_source.contains("?preview"));
    let original: Value = serde_json::from_slice(&entry(&mut archive, "note.json")).unwrap();
    assert_eq!(
        original["content"], source,
        "stored source must remain byte-exact"
    );
    assert_eq!(original["tags"], json!(["보관"]));
    assert_eq!(original["notebook_ids"], json!(["nb1", "nb2"]));
    let manifest: Value = serde_json::from_slice(&entry(&mut archive, "manifest.json")).unwrap();
    assert_eq!(manifest["revision"], 3);
    assert_eq!(
        manifest["attachments"][0]["path"],
        format!("attachments/{ID}.png")
    );
    assert!(archive.by_name(&format!("attachments/{EXTRA}")).is_err());
}

#[test]
fn native_markdown_and_plain_source_are_not_normalized() {
    let source = "\u{feff}# 한글\r\n<!--원문 주석-->\r\n";
    let bytes = bundle(
        &handler(fixture("markdown", source)),
        &req(source, source),
        deadline(),
    )
    .unwrap();
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    assert_eq!(entry(&mut archive, "note.md"), source.as_bytes());
    assert_eq!(entry(&mut archive, "source.md"), source.as_bytes());
    let text = "**원문**\r\n한글";
    let bytes = bundle(
        &handler(fixture("text", text)),
        &req(text, "\\*\\*원문\\*\\*  \n한글"),
        deadline(),
    )
    .unwrap();
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    assert_eq!(entry(&mut archive, "source.txt"), text.as_bytes());
}

#[test]
fn rejects_stale_source_locked_notes_and_modified_native_markdown() {
    let h = handler(fixture("html", "<p>기준</p>"));
    for request in [
        ExportRequest {
            revision: 2,
            ..req("<p>기준</p>", "기준")
        },
        req("<p>옛 내용</p>", "옛 내용"),
    ] {
        assert!(bundle(&h, &request, deadline())
            .unwrap_err()
            .to_string()
            .contains("버전"));
    }
    let mut fake = fixture("html", "");
    fake.note["locked"] = json!(true);
    assert!(bundle(&handler(fake), &req("", ""), deadline()).is_err());
    assert!(bundle(
        &handler(fixture("markdown", "# 기준")),
        &req("# 기준", "# 수정"),
        deadline()
    )
    .is_err());
}

#[test]
fn incomplete_or_corrupted_assets_never_produce_a_successful_zip() {
    let source = format!("![사진](/api/attachments/{ID})");
    for kind in ["missing", "hash", "short", "long", "huge"] {
        let mut fake = fixture("markdown", &source);
        match kind {
            "missing" => fake.missing = true,
            "hash" => fake.hash = "0".repeat(64),
            "short" => fake.size += 1,
            "long" => fake.size -= 1,
            "huge" => fake.size = MAX_BYTES as u64 + 1,
            _ => unreachable!(),
        }
        assert!(
            bundle(&handler(fake), &req(&source, &source), deadline()).is_err(),
            "{kind}"
        );
    }
}

#[test]
fn local_reference_validation_and_external_urls() {
    let paths = BTreeMap::from([(ID.to_string(), format!("attachments/{ID}.png"))]);
    for bad in [
        "../private",
        "not-a-uuid",
        &format!("{ID}/../private"),
        &format!("{ID}?other=1"),
    ] {
        assert!(
            rewrite(&format!("[x](/api/attachments/{bad})"), &paths).is_err(),
            "{bad}"
        );
    }
    assert!(rewrite(&format!("[x](/api/attachments/{EXTRA})"), &paths).is_err());
    let remote = format!("![x](https://example.com/api/attachments/{ID})");
    assert_eq!(rewrite(&remote, &paths).unwrap(), remote);
    let unquoted = format!("<img src=/api/attachments/{ID} >");
    assert_eq!(
        rewrite(&unquoted, &paths).unwrap(),
        format!("<img src=attachments/{ID}.png >")
    );
    // A conversion must not introduce a reference to an unrelated attachment.
    let h = handler(fixture("html", "<p>본문</p>"));
    assert!(bundle(
        &h,
        &req("<p>본문</p>", &format!("![x](/api/attachments/{ID})")),
        deadline()
    )
    .is_err());
}

#[test]
fn zip_bound_accounts_for_actual_output() {
    let mut target = LimitedZip::default();
    target.seek(SeekFrom::Start(MAX_BYTES as u64)).unwrap();
    assert!(target.write_all(b"x").is_err());
    assert!(
        target.0.get_ref().is_empty(),
        "must fail before allocating beyond limit"
    );
}

#[test]
fn route_checks_method_origin_and_request() {
    let h = handler(fixture("markdown", "# 내용"));
    let request = |method: &str, body: Value| Request {
        method: method.into(),
        path: "/api/export/markdown".into(),
        query: None,
        host: "localhost".into(),
        headers: vec![("content-type".into(), "application/json".into())],
        body: serde_json::to_vec(&body).unwrap(),
    };
    let valid = json!({"id":"note", "revision":3, "source":"# 내용", "markdown":"# 내용"});
    assert_eq!(h.handle(&request("GET", valid.clone())).status, 405);
    let mut cross = request("POST", valid.clone());
    cross
        .headers
        .push(("origin".into(), "https://bad.example".into()));
    assert_eq!(h.handle(&cross).status, 403);
    assert_eq!(
        h.handle(&request("POST", json!({"id":"note","revision":3})))
            .status,
        400
    );
    let mut no_json = request("POST", valid.clone());
    no_json.headers.clear();
    assert_eq!(h.handle(&no_json).status, 415);
    let out = h.handle(&request("POST", valid));
    assert_eq!(out.status, 200, "{}", String::from_utf8_lossy(&out.body));
    assert!(out
        .headers
        .contains(&("cache-control".into(), "no-store".into())));
    assert!(out
        .headers
        .contains(&("content-type".into(), "application/zip".into())));
}
