//! Explicit portable copies. The database remains authoritative; folder import
//! checks both the source digest and revision before any individual note save.
use crate::{Deadline, Handler, Request, Response, Result};
use regex::{Captures, Regex};
use serde::Deserialize;
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
    Ok(note_links(&text, &files.iter().map(|(id,p)|(id.clone(),p.trim_start_matches("notes/").to_owned())).collect()))
}
/// Shared by both exporters: links to exported notes become relative paths
/// (`targets`: ID -> path), every other note link becomes `inkism://note/<ID>`.
pub(crate) fn note_links(text: &str, targets: &BTreeMap<String, String>) -> String {
    LINK.replace_all(text, |c: &Captures<'_>| {
        let boundary=text[c.get(0).unwrap().end()..].chars().next().is_none_or(|ch|ch.is_whitespace()||"#?|\"'<>)]".contains(ch));
        if !boundary {return c[0].to_owned();}
        format!("{}{}",&c[1],targets.get(&c[2]).cloned().unwrap_or_else(||format!("inkism://note/{}",&c[2])))
    }).into_owned()
}
/// YAML 1.2 accepts JSON scalars/flow values; escape the few code points YAML
/// treats as line breaks or forbids, which JSON leaves raw.
fn yaml(v: &Value) -> String { serde_json::to_string(v).unwrap_or_default().replace('\u{85}',"\\u0085").replace('\u{2028}',"\\u2028").replace('\u{2029}',"\\u2029").replace('\u{feff}',"\\ufeff") }
fn iso(ms: &Value) -> Value {
    let Some(ms)=ms.as_i64() else { return Value::Null };
    let (days,rem)=(ms.div_euclid(86_400_000),ms.rem_euclid(86_400_000));
    // Civil-from-days (H. Hinnant), proleptic Gregorian UTC.
    let z=days+719_468; let era=z.div_euclid(146_097); let doe=z-era*146_097; let yoe=(doe-doe/1460+doe/36_524-doe/146_096)/365;
    let doy=doe-(365*yoe+yoe/4-yoe/100); let mp=(5*doy+2)/153; let d=doy-(153*mp+2)/5+1; let m=if mp<10 {mp+3} else {mp-9}; let y=yoe+era*400+i64::from(m<=2);
    json!(format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",rem/3_600_000,rem/60_000%60,rem/1000%60,rem%1000))
}
fn frontmatter(note: &Value) -> String {
    let mut out=format!("---\nid: {}\ntitle: {}\ntags: {}\ncreated: {}\nupdated: {}\n",yaml(&note["id"]),yaml(&note["title"]),yaml(note.get("tags").filter(|t|t.is_array()).unwrap_or(&json!([]))),yaml(&iso(&note["created_at"])),yaml(&iso(&note["updated_at"])));
    if let Some(a)=note["knowledge"]["aliases"].as_array().filter(|a|!a.is_empty()) { out+=&format!("aliases: {}\n",yaml(&json!(a))); }
    if let Some(props)=note["knowledge"]["properties"].as_array().filter(|p|!p.is_empty()) {
        out+="properties:\n"; for p in props { out+=&format!("  {}: {}\n",yaml(&p["name"]),yaml(&p["value"])); }
    }
    out+"---\n"
}
/// `markdown`: Markdown the app converted from HTML/text notes at `revision`
/// (the converter is the editor's own schema, so it runs in the app).
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ExportRequest { #[serde(default)] sources: bool, #[serde(default)] markdown: BTreeMap<String, Converted> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Converted { revision: i64, markdown: String }
fn snapshot(h: &Handler, deadline: Deadline) -> Result<(Value, usize)> {
    let engine = h.engine()?;
    let tmp = tempfile::tempdir()?;
    let path = tmp.path().join("notes.json");
    let reply: Value = serde_json::from_slice(&engine.call(deadline, &serde_json::to_vec(&json!({"op":"export", "path":path,"max_bytes":LIMIT,"max_notes":2048}))?)?)?;
    if reply["ok"] != true { return Err(reply["error"].as_str().unwrap_or("내보내기에 실패했습니다").into()); }
    let mut data = Vec::new();
    std::fs::File::open(&path)?.take((LIMIT + 1) as u64).read_to_end(&mut data)?;
    if data.len() > LIMIT { return Err("폴더 내보내기는 64 MiB까지 지원합니다. ZIP 백업을 사용해 주세요".into()); }
    let snapshot: Value = serde_json::from_slice(&data)?;
    if snapshot["notes"].as_array().ok_or("노트 목록이 없습니다")?.len() > 2048 { return Err("폴더 내보내기는 2,048개 노트까지 지원합니다".into()); }
    Ok((snapshot, data.len()))
}
fn exported(note: &Value) -> bool { note["locked"] != true && note["trashed"] != true }
/// Sources the app converts to Markdown before requesting the folder ZIP.
fn sources(h: &Handler, deadline: Deadline) -> Result<Vec<u8>> {
    let (snapshot, _) = snapshot(h, deadline)?;
    let notes: Vec<Value> = snapshot["notes"].as_array().unwrap().iter().filter(|n| exported(n) && n["content_format"] != "markdown").map(|n| json!({"id":n["id"],"revision":n["revision"],"format":n["content_format"].as_str().unwrap_or("html"),"content":n["content"]})).collect();
    Ok(serde_json::to_vec(&json!({"notes":notes}))?)
}
fn bundle(h: &Handler, req: &ExportRequest, deadline: Deadline) -> Result<(Vec<u8>, usize)> {
    let engine = h.engine()?;
    let (snapshot, size) = snapshot(h, deadline)?;
    let notes = snapshot["notes"].as_array().unwrap();
    let mut files = BTreeMap::new();
    let mut bodies = BTreeMap::new();
    let mut skipped = Vec::new();
    for note in notes {
        let id = note["id"].as_str().ok_or("노트 ID가 없습니다")?; if id.is_empty() || id.len()>64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b==b'-' || b==b'_') { return Err("올바르지 않은 문서 ID입니다".into()); }
        // Locked bodies are never decrypted; the manifest lists them so the user sees what is missing.
        if !exported(note) { skipped.push(json!({"id":id,"title":note["title"],"reason":if note["locked"] == true {"locked"} else {"trashed"}})); continue; }
        let format = note["content_format"].as_str().unwrap_or("html");
        let source = note["content"].as_str().ok_or("본문이 없습니다")?;
        let (body, converted) = match req.markdown.get(id) {
            Some(c) if format != "markdown" => {
                if note["revision"].as_i64() != Some(c.revision) { return Err("노트가 변경되었습니다. 다시 시도해 주세요".into()); }
                // A conversion must not introduce a reference to an unrelated attachment.
                for x in ASSET.captures_iter(&c.markdown) { if !ASSET.captures_iter(source).any(|y| y[2] == x[2]) { return Err("변환 결과의 첨부파일이 원문과 다릅니다".into()); } }
                (c.markdown.as_str(), true)
            }
            _ => (source, false),
        };
        files.insert(id.to_owned(), format!("notes/{id}.{}", if converted { "md" } else { ext(format)? }));
        bodies.insert(id.to_owned(), body);
    }
    if let Some(id) = req.markdown.keys().find(|id| !bodies.contains_key(*id)) { return Err(format!("노트가 변경되었습니다. 다시 시도해 주세요: {id}").into()); }
    let mut assets = BTreeMap::new();
    let mut asset_bytes = BTreeMap::new();
    let mut budget = size;
    let mut asset_manifest = Vec::new();
    for body in bodies.values() {
        for c in ASSET.captures_iter(body) {
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
        let id = note["id"].as_str().unwrap(); let source = note["content"].as_str().unwrap();
        let mut portable = rewrite(bodies[id], &files, &assets)?;
        if files[id].ends_with(".md") { portable.insert_str(0, &frontmatter(note)); }
        let mut metadata = note.clone(); metadata.as_object_mut().unwrap().remove("content"); metadata.as_object_mut().unwrap().remove("text");
        entries.push(json!({"id":id,"path":files[id],"revision":note["revision"],"format":note["content_format"].as_str().unwrap_or("html"),"file_format":files[id].ends_with(".md").then_some("markdown"),"source_sha256":digest(source.as_bytes()),"portable_sha256":digest(portable.as_bytes()),"baseline_metadata":{"title":metadata["title"],"tags":metadata["tags"],"notebook_id":metadata["notebook_id"]},"metadata":metadata}));
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
    archive.write_all("Inkism 외부 편집 폴더\n\nnotes 폴더의 .md / .html / .txt를 다른 편집기에서 열 수 있습니다.\n첨부파일과 .inkism-portable.json을 함께 유지하세요. 문서 이름 변경은 같은 내용의 파일을 자동으로 연결합니다. 이름과 본문을 동시에 바꿀 때에는 문서 ID 파일명을 유지하세요.\n앱 설정의 ‘편집한 폴더 반영’으로 변경 목록을 확인하고 선택한 항목을 반영합니다. 삭제는 지운 노트로 이동합니다.\n앱에서 노트가 바뀌었으면 충돌로 표시하며 덮어쓰지 않습니다.\nnotes의 신규 파일, 이름 변경, 삭제와 첨부 변경, 목록 파일의 제목·태그·폴더 변경을 미리보기에서 확인할 수 있습니다. 자동 감지는 앱 설정 화면이 열린 동안만 작동하며 자동 저장하지 않습니다.\n.md 파일 맨 위의 YAML 머리말(id·제목·태그·만든 날짜·수정한 날짜·별칭·속성)은 참고용이며 반영하지 않습니다. 제목·태그·폴더는 .inkism-portable.json에서 편집하세요.\n내보내지 않은 노트로 가는 링크는 inkism://note/<ID> 형식입니다.\n잠긴 노트와 지운 노트는 내용 없이 .inkism-portable.json의 skipped 목록에만 남습니다. 완전한 복원에는 ZIP 백업을 사용하세요.\n이 폴더는 암호화되지 않은 사본입니다.\n".as_bytes())?;
    let bytes = archive.finish()?.0.into_inner();
    if bytes.len() > LIMIT { return Err("폴더 내보내기 크기가 64 MiB를 넘습니다".into()); }
    Ok((bytes, skipped.iter().filter(|s| s["reason"] == "locked").count()))
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
    let Some(req) = r.header("content-type").unwrap_or("").starts_with("application/json").then(|| serde_json::from_slice::<ExportRequest>(&r.body).ok()).flatten().filter(|_| r.body.len() <= LIMIT) else { return Response::fail(400,"내보내기 요청이 올바르지 않습니다"); };
    let Ok(_guard) = SLOT.try_lock() else { return Response::fail(409,"다른 내보내기가 진행 중입니다"); };
    if req.sources { return match sources(h,deadline) { Ok(body) => Response {status:200,headers:vec![("content-type".into(),"application/json".into())],body}, Err(e) => Response::fail(400,e) }; }
    match bundle(h,&req,deadline) { Ok((body,locked)) => Response {status:200,headers:vec![("content-type".into(),"application/zip".into()),("content-disposition".into(),"attachment; filename=inkism-folder.zip".into()),("x-inkism-locked-skipped".into(),locked.to_string())],body}, Err(e) => Response::fail(400,e) }
}
#[cfg(test)] mod tests { use super::*;
struct Fake;
impl crate::Engine for Fake {
    fn call(&self, _:Deadline, raw:&[u8])->Result<Vec<u8>> {
        let request:Value=serde_json::from_slice(raw)?;
        assert_eq!(request["op"],"export");
        std::fs::write(request["path"].as_str().unwrap(),serde_json::to_vec(&json!({"notes":[
            {"id":"12345678-1234-1234-1234-123456789012","title":"MD [title]: \"q\" #x\n\u{2028}","tags":["a: b","- c"],"created_at":1760400000123i64,"updated_at":-1,"content":"\u{feff}# Exact\r\n","content_format":"markdown","revision":3,"knowledge":{"aliases":["alias"],"properties":[{"name":"rating","type":"number","value":4},{"name":"key: \"x\"\n#","type":"text","value":"---\n'v' \u{85}"}]}},
            {"id":"22345678-1234-1234-1234-123456789012","title":"HTML","content":"<h1 style=\"color:red\">Rich</h1><a href=\"note://12345678-1234-1234-1234-123456789012\">md</a><a href=\"note://32345678-1234-1234-1234-123456789012\">locked</a>","content_format":"html","revision":2},
            {"id":"32345678-1234-1234-1234-123456789012","title":"Locked","content":"secret","locked":true,"content_format":"markdown","revision":1}
        ],"notebooks":[],"knowledge_settings":{"views":[]}}))?)?;
        Ok(serde_json::to_vec(&json!({"ok":true,"data":{}}))?)
    }
}
fn run(req: ExportRequest) -> Result<(zip::ZipArchive<Cursor<Vec<u8>>>, usize)> { let h=Handler{engine:Some(std::sync::Arc::new(Fake)),..Default::default()}; let (bytes,locked)=bundle(&h,&req,std::time::Instant::now()+std::time::Duration::from_secs(5))?; Ok((zip::ZipArchive::new(Cursor::new(bytes)).unwrap(),locked)) }
fn read(zip: &mut zip::ZipArchive<Cursor<Vec<u8>>>, name: &str) -> String { let mut out=String::new(); zip.by_name(name).unwrap().read_to_string(&mut out).unwrap(); out }
const MD: &str = "12345678-1234-1234-1234-123456789012"; const HTML: &str = "22345678-1234-1234-1234-123456789012"; const LOCKED: &str = "32345678-1234-1234-1234-123456789012";
#[test] fn library_preserves_exact_source_and_metadata_and_skips_locked() {
    let (mut zip,locked)=run(ExportRequest::default()).unwrap(); assert_eq!(locked,1);
    let md=read(&mut zip,&format!("notes/{MD}.md")); let (front,body)=md.split_once("\n---\n").unwrap(); assert!(front.starts_with("---\n")); assert_eq!(body,"\u{feff}# Exact\r\n");
    // Without an app conversion the HTML note keeps its exact source, with links made portable.
    assert_eq!(read(&mut zip,&format!("notes/{HTML}.html")),format!("<h1 style=\"color:red\">Rich</h1><a href=\"{MD}.md\">md</a><a href=\"inkism://note/{LOCKED}\">locked</a>"));
    assert!(zip.by_name(&format!("notes/{LOCKED}.md")).is_err());
    let m:Value=serde_json::from_str(&read(&mut zip,".inkism-portable.json")).unwrap();assert_eq!(m["notes"][0]["metadata"]["knowledge"]["aliases"][0],"alias");assert_eq!(m["skipped"],json!([{"id":LOCKED,"title":"Locked","reason":"locked"}]));assert_eq!(m["notes"][0]["portable_sha256"],digest(md.as_bytes()));assert_eq!(m["notes"][0]["file_format"],"markdown");assert!(m["notes"][1]["file_format"].is_null());
    assert!(!format!("{m}").contains("secret"),"locked content is never exported");
}
#[test] fn frontmatter_is_line_safe_yaml_with_properties() {
    let (mut zip,_)=run(ExportRequest::default()).unwrap();
    let md=read(&mut zip,&format!("notes/{MD}.md")); let front=md.split_once("\n---\n").unwrap().0.strip_prefix("---\n").unwrap();
    assert!(!front.contains(['\u{85}','\u{2028}','\r']));
    let lines:Vec<&str>=front.split('\n').collect();
    // Every value is a JSON scalar or flow collection, which YAML 1.2 reads unchanged.
    let field=|key:&str|->Value{let line=lines.iter().find_map(|l|l.strip_prefix(&format!("{key}: "))).unwrap();serde_json::from_str(line).unwrap()};
    assert_eq!(field("id"),MD);assert_eq!(field("title"),"MD [title]: \"q\" #x\n\u{2028}");assert_eq!(field("tags"),json!(["a: b","- c"]));
    assert_eq!(field("created"),"2025-10-14T00:00:00.123Z");assert_eq!(field("updated"),"1969-12-31T23:59:59.999Z");assert_eq!(field("aliases"),json!(["alias"]));
    let props=&lines[lines.iter().position(|l|*l=="properties:").unwrap()+1..];assert_eq!(props.len(),2);
    let pair=|l:&str|{let l=l.strip_prefix("  ").unwrap();let mut it=serde_json::Deserializer::from_str(l).into_iter::<Value>();let k=it.next().unwrap().unwrap();let rest=l[it.byte_offset()..].strip_prefix(": ").unwrap();(k,serde_json::from_str::<Value>(rest).unwrap())};
    assert_eq!(pair(props[0]),(json!("rating"),json!(4)));assert_eq!(pair(props[1]),(json!("key: \"x\"\n#"),json!("---\n'v' \u{85}")));
}
#[test] fn app_converted_html_is_exported_as_markdown() {
    let markdown=format!("# Rich\n\n[md](note://{MD}) [locked](note://{LOCKED})\n");
    let (mut zip,_)=run(ExportRequest{markdown:BTreeMap::from([(HTML.into(),Converted{revision:2,markdown})]),..Default::default()}).unwrap();
    assert!(zip.by_name(&format!("notes/{HTML}.html")).is_err());
    let md=read(&mut zip,&format!("notes/{HTML}.md"));assert!(md.starts_with(&format!("---\nid: \"{HTML}\"\ntitle: \"HTML\"\n")));
    assert!(md.ends_with(&format!("\n---\n# Rich\n\n[md]({MD}.md) [locked](inkism://note/{LOCKED})\n")));
    let m:Value=serde_json::from_str(&read(&mut zip,".inkism-portable.json")).unwrap();let e=&m["notes"][1];
    assert_eq!((e["format"].as_str(),e["file_format"].as_str(),e["path"].as_str()),(Some("html"),Some("markdown"),Some(format!("notes/{HTML}.md").as_str())));assert_eq!(e["portable_sha256"],digest(md.as_bytes()));
    for (id,revision,markdown) in [(HTML,1,"stale".to_owned()),(LOCKED,1,"x".into()),(HTML,2,format!("![x](/api/attachments/{MD})"))] { assert!(run(ExportRequest{markdown:BTreeMap::from([(id.into(),Converted{revision,markdown})]),..Default::default()}).is_err(),"{id} {revision}"); }
}
#[test] fn route_serves_sources_then_zip_with_locked_count() {
    let h=Handler{engine:Some(std::sync::Arc::new(Fake)),..Default::default()};
    let post=|body:&str|h.handle(&Request{method:"POST".into(),path:"/api/portable/export".into(),query:None,host:"localhost".into(),headers:vec![("content-type".into(),"application/json".into())],body:body.into()});
    let out=post(r#"{"sources":true}"#);assert_eq!(out.status,200);let v:Value=serde_json::from_slice(&out.body).unwrap();
    assert_eq!(v["notes"].as_array().unwrap().iter().map(|n|n["id"].as_str().unwrap()).collect::<Vec<_>>(),[HTML],"only unlocked HTML/text sources");
    let out=post("{}");assert_eq!(out.status,200);assert!(out.headers.contains(&("x-inkism-locked-skipped".into(),"1".into())));
    assert_eq!(post(r#"{"other":1}"#).status,400);
}
#[test] fn iso_dates() { assert_eq!(iso(&json!(0)),"1970-01-01T00:00:00.000Z"); assert_eq!(iso(&json!(951782400000i64)),"2000-02-29T00:00:00.000Z"); assert!(iso(&Value::Null).is_null()); }
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
