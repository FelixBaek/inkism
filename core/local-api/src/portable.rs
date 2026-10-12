//! Explicit portable copies. The database remains authoritative; folder import
//! checks both the source digest and revision before any individual note save.
use crate::{Deadline, Handler, Request, Response, Result};
use regex::{Captures, Regex};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap};
use std::io::{Cursor, Read, Write, Seek, SeekFrom};
use std::sync::{LazyLock, Mutex};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const LIMIT: usize = 64 << 20;
static SLOT: Mutex<()> = Mutex::new(());
static ASSET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(^|[="'\t\n\x0C\r (<])(/api/attachments/[^"'\t\n\x0C\r <>\)\]]+)"#).unwrap());
static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(^|[="'\t\n\x0C\r (<\[])note://([A-Za-z0-9_-]+)"#).unwrap());
fn asset_id(url:&str)->Result<&str> {
    let id=url.strip_prefix("/api/attachments/").unwrap_or("");
    let id=id.strip_suffix("?preview=1").unwrap_or(id);
    uuid(id)?; Ok(id)
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn ext(format: &str) -> Result<&'static str> { match format { "markdown" => Ok("md"), "html" => Ok("html"), "text" => Ok("txt"), _ => Err("지원하지 않는 문서 형식입니다".into()) } }
fn uuid(id: &str) -> Result<()> { if id.len() != 36 || uuid::Uuid::parse_str(id).is_err() { return Err("올바르지 않은 문서 ID입니다".into()); } Ok(()) }
fn rewrite(source: &str, files: &BTreeMap<String, String>, assets: &BTreeMap<String, String>) -> Result<String> {
    for captures in ASSET.captures_iter(source) { let id=asset_id(&captures[2])?;if !assets.contains_key(id){return Err("내보낼 첨부파일이 누락되었습니다".into());} }
    let text = ASSET.replace_all(source, |c: &Captures<'_>| {
        let id=asset_id(&c[2]).expect("validated attachment");
        let preview=if c[2].ends_with("?preview=1") {"?preview=1"} else {""};
        format!("{}../{}{}", &c[1],assets[id],preview)
    });
    Ok(LINK.replace_all(&text, |c: &Captures<'_>| {
        let boundary=text[c.get(0).unwrap().end()..].chars().next().is_none_or(|ch|ch.is_whitespace()||"#?|\"'<>)]".contains(ch));
        if !boundary {return c[0].to_owned();}
        files.get(&c[2]).map(|p|format!("{}{}",&c[1],p.trim_start_matches("notes/"))).unwrap_or_else(||c[0].to_owned())
    }).into_owned())
}
fn bundle(h: &Handler, deadline: Deadline) -> Result<Vec<u8>> {
    let engine = h.engine()?;
    let tmp = tempfile::tempdir()?;
    let path = tmp.path().join("notes.json");
    let reply: Value = serde_json::from_slice(&engine.call(deadline, &serde_json::to_vec(&json!({"op":"export", "path":path,"max_bytes":LIMIT,"max_notes":2048}))?)?)?;
    if reply["ok"] != true { return Err(reply["error"].as_str().unwrap_or("내보내기에 실패했습니다").into()); }
    let mut data = Vec::new();
    std::fs::File::open(&path)?.take((LIMIT + 1) as u64).read_to_end(&mut data)?;
    if data.len() > LIMIT { return Err("폴더 내보내기는 64 MiB까지 지원합니다. ZIP 백업을 사용해 주세요".into()); }
    let snapshot: Value = serde_json::from_slice(&data)?;
    let notes = snapshot["notes"].as_array().ok_or("노트 목록이 없습니다")?;
    if notes.len() > 2048 { return Err("폴더 내보내기는 2,048개 노트까지 지원합니다".into()); }
    let mut files = BTreeMap::new();
    let mut skipped = Vec::new();
    for note in notes {
        let id = note["id"].as_str().ok_or("노트 ID가 없습니다")?; if id.is_empty() || id.len()>64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b==b'-' || b==b'_') { return Err("올바르지 않은 문서 ID입니다".into()); }
        if note["locked"] == true || note["trashed"] == true { skipped.push(json!({"id":id,"title":note["title"],"reason":if note["locked"] == true {"locked"} else {"trashed"}})); continue; }
        files.insert(id.to_owned(), format!("notes/{id}.{}", ext(note["content_format"].as_str().unwrap_or("html"))?));
    }
    let mut assets = BTreeMap::new();
    let mut asset_bytes = BTreeMap::new();
    let mut budget = data.len();
    let mut asset_manifest = Vec::new();
    for note in notes.iter().filter(|n| files.contains_key(n["id"].as_str().unwrap_or(""))) {
        for c in ASSET.captures_iter(note["content"].as_str().unwrap_or("")) {
            let id = asset_id(&c[2])?; if assets.contains_key(id) { continue; }
            if assets.len() >= 512 { return Err("첨부파일은 512개까지 내보낼 수 있습니다".into()); }
            let store = engine.attachments().ok_or("첨부파일 저장소가 없습니다")?;
            let meta = store.info(deadline, id)?;
            if meta.id != id { return Err("첨부파일 ID가 일치하지 않습니다".into()); }
            if meta.size > (LIMIT.saturating_sub(budget)) as u64 { return Err("폴더 내보내기 크기가 64 MiB를 넘습니다".into()); }
            let suffix = meta.name.rsplit_once('.').map(|(_,s)| s).filter(|s| !s.is_empty() && s.len() <= 12 && s.bytes().all(|b| b.is_ascii_alphanumeric()));
            let path = format!("attachments/{id}{}", suffix.map(|s| format!(".{}",s.to_ascii_lowercase())).unwrap_or_default());
            let mut bytes = Capped { bytes: Vec::new(), limit: meta.size as usize };
            store.export(deadline, id, &mut bytes)?;
            if bytes.bytes.len() as u64 != meta.size || digest(&bytes.bytes) != meta.sha256 { return Err("첨부파일 검증에 실패했습니다".into()); }
            budget += bytes.bytes.len();
            asset_manifest.push(json!({"path":path,"id":id,"sha256":meta.sha256,"size":meta.size}));
            assets.insert(id.to_owned(), path.clone()); asset_bytes.insert(path, bytes.bytes);
        }
    }
    let mut entries = Vec::new();
    let mut archive = ZipWriter::new(LimitedZip(Cursor::new(Vec::new())));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for note in notes.iter().filter(|n| files.contains_key(n["id"].as_str().unwrap_or(""))) {
        let id = note["id"].as_str().unwrap(); let source = note["content"].as_str().ok_or("본문이 없습니다")?;
        let portable = rewrite(source, &files, &assets)?;
        let mut metadata = note.clone(); metadata.as_object_mut().unwrap().remove("content"); metadata.as_object_mut().unwrap().remove("text");
        entries.push(json!({"id":id,"path":files[id],"revision":note["revision"],"format":note["content_format"].as_str().unwrap_or("html"),"source_sha256":digest(source.as_bytes()),"portable_sha256":digest(portable.as_bytes()),"baseline_metadata":{"title":metadata["title"],"tags":metadata["tags"],"notebook_id":metadata["notebook_id"]},"metadata":metadata}));
        archive.start_file(&files[id], options)?; archive.write_all(portable.as_bytes())?;
    }
    for (path, bytes) in asset_bytes { archive.start_file(path, options)?; archive.write_all(&bytes)?; }
    archive.start_file(".inkism-portable.json", options)?;
    archive.write_all(&serde_json::to_vec_pretty(&json!({"version":1,"notes":&entries,"attachments":asset_manifest,"skipped":skipped,"notebooks":snapshot["notebooks"],"knowledge_settings":snapshot["knowledge_settings"]}))?)?;
    archive.start_file("INDEX.md", options)?;
    archive.write_all(b"# Inkism\n\n")?;
    for entry in &entries {
        let title = entry["metadata"]["title"].as_str().unwrap_or("Untitled").replace(['\r','\n'], " ").replace('\\', "\\\\").replace('[', "\\[").replace(']', "\\]");
        archive.write_all(format!("- [{}]({})\n", title, entry["path"].as_str().unwrap_or("")).as_bytes())?;
    }
    archive.start_file("README.txt", options)?;
    archive.write_all("Inkism 외부 편집 폴더\n\nnotes 폴더의 .md / .html / .txt를 다른 편집기에서 열 수 있습니다.\n첨부파일과 .inkism-portable.json을 함께 유지하세요. 문서 이름 변경은 같은 내용의 파일을 자동으로 연결합니다. 이름과 본문을 동시에 바꿀 때에는 문서 ID 파일명을 유지하세요.\n앱 설정의 ‘편집한 폴더 반영’으로 변경 목록을 확인하고 선택한 항목을 반영합니다. 삭제는 휴지통으로 이동합니다.\n앱에서 노트가 바뀌었으면 충돌로 표시하며 덮어쓰지 않습니다.\nnotes의 신규 파일, 이름 변경, 삭제와 첨부 변경, 목록 파일의 제목·태그·노트북 변경을 미리보기에서 확인할 수 있습니다. 자동 감지는 앱 설정 화면이 열린 동안만 작동하며 자동 저장하지 않습니다.\n잠긴 노트와 휴지통은 제외됩니다. 완전한 복원에는 ZIP 백업을 사용하세요.\n이 폴더는 암호화되지 않은 사본입니다.\n".as_bytes())?;
    let bytes = archive.finish()?.0.into_inner();
    if bytes.len() > LIMIT { return Err("폴더 내보내기 크기가 64 MiB를 넘습니다".into()); } Ok(bytes)
}
struct LimitedZip(Cursor<Vec<u8>>);
impl Write for LimitedZip {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.position().saturating_add(bytes.len() as u64) > LIMIT as u64 { return Err(std::io::Error::other("폴더 내보내기 크기가 64 MiB를 넘습니다")); }
        self.0.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> { self.0.flush() }
}
impl Seek for LimitedZip { fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> { self.0.seek(pos) } }
struct Capped { bytes: Vec<u8>, limit: usize }
impl Write for Capped { fn write(&mut self, b: &[u8]) -> std::io::Result<usize> { if b.len() > self.limit.saturating_sub(self.bytes.len()) { return Err(std::io::Error::other("attachment size changed")); } self.bytes.extend_from_slice(b); Ok(b.len()) } fn flush(&mut self)->std::io::Result<()> { Ok(()) } }
pub(crate) fn export(h: &Handler, r: &Request, deadline: Deadline) -> Response {
    if r.method != "POST" { return Response::fail(405,"POST required"); }
    if !r.header("content-type").unwrap_or("").starts_with("application/json") || r.body.len() > 128 || serde_json::from_slice::<Value>(&r.body).ok() != Some(json!({})) { return Response::fail(400,"빈 JSON 요청이 필요합니다"); }
    let Ok(_guard) = SLOT.try_lock() else { return Response::fail(409,"다른 내보내기가 진행 중입니다"); };
    match bundle(h,deadline) { Ok(body) => Response {status:200,headers:vec![("content-type".into(),"application/zip".into()),("content-disposition".into(),"attachment; filename=inkism-folder.zip".into())],body}, Err(e) => Response::fail(400,e) }
}
#[cfg(test)] mod tests { use super::*;
struct Fake;
impl crate::Engine for Fake {
    fn call(&self, _:Deadline, raw:&[u8])->Result<Vec<u8>> {
        let request:Value=serde_json::from_slice(raw)?;
        assert_eq!(request["op"],"export");
        std::fs::write(request["path"].as_str().unwrap(),serde_json::to_vec(&json!({"notes":[
            {"id":"12345678-1234-1234-1234-123456789012","title":"MD [title]","content":"\u{feff}# Exact\r\n","content_format":"markdown","revision":3,"knowledge":{"aliases":["alias"],"properties":[{"name":"rating","type":"number","value":4}]}},
            {"id":"22345678-1234-1234-1234-123456789012","title":"HTML","content":"<h1 style=\"color:red\">Rich</h1>","content_format":"html","revision":2},
            {"id":"32345678-1234-1234-1234-123456789012","title":"Locked","content":"secret","locked":true,"content_format":"markdown","revision":1}
        ],"notebooks":[],"knowledge_settings":{"views":[]}}))?)?;
        Ok(serde_json::to_vec(&json!({"ok":true,"data":{}}))?)
    }
}
#[test] fn library_preserves_exact_source_and_metadata_and_skips_locked() {
    let h=Handler{engine:Some(std::sync::Arc::new(Fake)),..Default::default()};
    let bytes=bundle(&h,std::time::Instant::now()+std::time::Duration::from_secs(5)).unwrap();
    let mut zip=zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut md=String::new();zip.by_name("notes/12345678-1234-1234-1234-123456789012.md").unwrap().read_to_string(&mut md).unwrap();assert_eq!(md,"\u{feff}# Exact\r\n");
    let mut html=String::new();zip.by_name("notes/22345678-1234-1234-1234-123456789012.html").unwrap().read_to_string(&mut html).unwrap();assert_eq!(html,"<h1 style=\"color:red\">Rich</h1>");
    assert!(zip.by_name("notes/32345678-1234-1234-1234-123456789012.md").is_err());
    let mut raw=String::new();zip.by_name(".inkism-portable.json").unwrap().read_to_string(&mut raw).unwrap();let m:Value=serde_json::from_str(&raw).unwrap();assert_eq!(m["notes"][0]["metadata"]["knowledge"]["aliases"][0],"alias");assert_eq!(m["skipped"][0]["reason"],"locked");assert_eq!(m["notes"][0]["source_sha256"],digest(md.as_bytes()));
}
#[test] fn paths_preserve_formats_fragments_and_preview() { let id="12345678-1234-1234-1234-123456789012"; let files=BTreeMap::from([(id.into(),format!("notes/{id}.md"))]); let assets=BTreeMap::from([(id.into(),format!("attachments/{id}.png"))]); let src=format!("[x](note://{id}#heading) ![x](/api/attachments/{id}?preview=1)"); assert_eq!(rewrite(&src,&files,&assets).unwrap(),format!("[x]({id}.md#heading) ![x](../attachments/{id}.png?preview=1)")); }
#[test] fn attachment_write_is_bounded() { let mut w=Capped{bytes:vec![],limit:2}; assert!(w.write_all(b"abc").is_err()); assert!(w.bytes.is_empty()); }
}
#[cfg(test)] mod boundary_tests {
    use super::*;
    #[test] fn relative_rewrites_never_consume_url_prefixes_or_suffixes() {
        let id="daily-2026-10-12";
        let files=BTreeMap::from([(id.into(),format!("notes/{id}.md"))]);
        for source in [format!("xnote://{id}"),format!("note://{id}.extra"),format!("note://{id}/child"),format!("https://x/note://{id}")] {
            assert_eq!(rewrite(&source,&files,&BTreeMap::new()).unwrap(),source);
        }
        assert_eq!(rewrite(&format!("![[note://{id}#heading]]"),&files,&BTreeMap::new()).unwrap(),format!("![[{id}.md#heading]]"));
    }
    #[test] fn malformed_attachment_tokens_fail_before_partial_rewrite() {
        let id="12345678-1234-1234-1234-123456789012";
        let assets=BTreeMap::from([(id.into(),format!("attachments/{id}.png"))]);
        for suffix in ["junk","/../other","?preview=1other","?other=1","?preview=1&other=1"] {
            assert!(rewrite(&format!("![x](/api/attachments/{id}{suffix})"),&BTreeMap::new(),&assets).is_err());
        }
        let foreign=format!("https://foreign.test/api/attachments/{id}");
        assert_eq!(rewrite(&foreign,&BTreeMap::new(),&assets).unwrap(),foreign);
    }
}
