//! Portable Markdown copies; canonical notes and attachment stores stay intact.
use crate::{AttachmentMetadata, Deadline, Handler, Request, Response, Result};
use regex::{Captures, Regex};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{self, Cursor, Seek, SeekFrom, Write};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const MAX_BYTES: usize = 64 << 20;
const MAX_ASSETS: usize = 512;
static SLOT: Mutex<()> = Mutex::new(());
// Match local URL tokens, not a path inside an unrelated remote URL. Reject
// malformed IDs/queries instead of exporting a broken or traversing path.
static LOCAL_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(^|[="'\t\n\x0C\r (<])(/api/attachments/[^"'\t\n\x0C\r <>\)\]]+)"#).unwrap()
});

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportRequest {
    id: String,
    revision: i64,
    source: String,
    markdown: String,
}

fn asset_id(url: &str) -> Result<&str> {
    let id = url.strip_prefix("/api/attachments/").unwrap_or_default();
    let id = id.strip_suffix("?preview=1").unwrap_or(id);
    if uuid::Uuid::parse_str(id).is_err() || id.len() != 36 {
        return Err("첨부파일 주소가 올바르지 않습니다. ZIP 백업을 사용해 주세요".into());
    }
    Ok(id)
}

fn references(text: &str) -> Result<Vec<String>> {
    LOCAL_URL
        .captures_iter(text)
        .map(|c| asset_id(&c[2]).map(str::to_owned))
        .collect()
}

fn asset_path(meta: &AttachmentMetadata) -> String {
    // IDs are unique; only a short alphanumeric suffix is taken from the name.
    let extension = meta
        .name
        .rsplit_once('.')
        .map(|(_, ext)| ext)
        .filter(|ext| {
            !ext.is_empty() && ext.len() <= 12 && ext.bytes().all(|b| b.is_ascii_alphanumeric())
        });
    match extension {
        Some(ext) => format!("attachments/{}.{}", meta.id, ext.to_ascii_lowercase()),
        None => format!("attachments/{}", meta.id),
    }
}

fn rewrite(text: &str, paths: &BTreeMap<String, String>) -> Result<String> {
    // Validate before replacing, so no missing asset is left as an app URL.
    for id in references(text)? {
        if !paths.contains_key(&id) {
            return Err(format!("내보낼 첨부파일이 누락되었습니다: {id}").into());
        }
    }
    Ok(LOCAL_URL
        .replace_all(text, |c: &Captures<'_>| {
            let id = asset_id(&c[2]).expect("validated above");
            format!("{}{}", &c[1], paths[id])
        })
        .into_owned())
}

/// Bound the completed ZIP, including headers and any unexpectedly large writes.
#[derive(Default)]
struct LimitedZip(Cursor<Vec<u8>>);
impl Write for LimitedZip {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.0.position().saturating_add(bytes.len() as u64) > MAX_BYTES as u64 {
            return Err(io::Error::other(
                "Markdown ZIP은 64 MiB까지 지원합니다. ZIP 백업을 사용해 주세요",
            ));
        }
        self.0.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}
impl Seek for LimitedZip {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.0.seek(pos)
    }
}

struct VerifiedAsset<'a, W: Write> {
    target: &'a mut W,
    hash: Sha256,
    written: u64,
    expected: u64,
}
impl<W: Write> Write for VerifiedAsset<'_, W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.written.saturating_add(bytes.len() as u64) > self.expected {
            return Err(io::Error::other("첨부파일 크기가 일치하지 않습니다"));
        }
        let n = self.target.write(bytes)?;
        self.hash.update(&bytes[..n]);
        self.written += n as u64;
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.target.flush()
    }
}

const README: &str = "Inkism Markdown 내보내기\n\nZIP 전체를 풀고 note.md를 여세요. attachments 폴더를 함께 유지해 주세요.\n일부 서식과 특수 블록은 Markdown 안의 HTML로 보존됩니다. 다른 앱의 표시 방식은 다를 수 있습니다.\n외부 웹 자료는 다운로드하지 않습니다. 다른 Inkism 노트로 연결되는 note:// 링크는 Inkism에서 사용합니다.\nsource 파일은 첨부 주소를 상대 경로로 바꾼 사본입니다. note.json은 정확한 원문과 메타데이터입니다.\n이 ZIP은 암호화되지 않습니다. 전체 라이브러리 복원에는 앱의 ZIP 백업을 사용하세요.\n";

fn bundle(h: &Handler, req: &ExportRequest, deadline: Deadline) -> Result<Vec<u8>> {
    let engine = h.engine()?;
    let raw = engine.call(
        deadline,
        &serde_json::to_vec(&json!({"op":"get", "id":req.id}))?,
    )?;
    let envelope: Value = serde_json::from_slice(&raw)?;
    if envelope["ok"] != true {
        return Err(envelope["error"]
            .as_str()
            .unwrap_or("노트를 읽지 못했습니다")
            .into());
    }
    let note = &envelope["data"];
    if note["id"] != req.id
        || note["revision"].as_i64() != Some(req.revision)
        || note["content"].as_str() != Some(req.source.as_str())
    {
        return Err("노트 버전이 변경되었습니다. 다시 시도해 주세요".into());
    }
    if note["locked"] == true {
        return Err("잠긴 노트는 내보낼 수 없습니다".into());
    }
    let format = note["content_format"].as_str().unwrap_or("html");
    let extension = match format {
        "html" => "html",
        "markdown" => "md",
        "text" => "txt",
        _ => return Err("지원하지 않는 문서 형식입니다".into()),
    };
    if format == "markdown" && req.markdown != req.source {
        return Err("Markdown 원문이 변경되었습니다. 다시 시도해 주세요".into());
    }
    let mut paths = BTreeMap::new();
    let mut metadata = BTreeMap::new();
    let mut total = 0u64;
    for id in references(&req.source)? {
        if paths.contains_key(&id) {
            continue;
        }
        if paths.len() >= MAX_ASSETS {
            return Err("첨부파일은 512개까지 내보낼 수 있습니다. ZIP 백업을 사용해 주세요".into());
        }
        let assets = engine
            .attachments()
            .ok_or("첨부파일 저장소를 열 수 없습니다")?;
        let meta = assets.info(deadline, &id)?;
        if meta.id != id
            || meta.sha256.len() != 64
            || !meta.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("첨부파일 정보가 올바르지 않습니다".into());
        }
        total = total.saturating_add(meta.size);
        if total > MAX_BYTES as u64 {
            return Err("Markdown ZIP은 64 MiB까지 지원합니다. ZIP 백업을 사용해 주세요".into());
        }
        paths.insert(id.clone(), asset_path(&meta));
        metadata.insert(id, meta);
    }
    let markdown = rewrite(&req.markdown, &paths)?;
    let source = rewrite(&req.source, &paths)?;
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let mut archive = ZipWriter::new(LimitedZip::default());
    for (path, content) in [
        ("note.md".into(), markdown.into_bytes()),
        (format!("source.{extension}"), source.into_bytes()),
        ("note.json".into(), serde_json::to_vec_pretty(note)?),
        ("README.txt".into(), README.as_bytes().to_vec()),
    ] {
        archive.start_file(path, options)?;
        archive.write_all(&content)?;
    }
    let mut manifest = Vec::new();
    for (id, meta) in metadata {
        if Instant::now() >= deadline {
            return Err("내보내기 시간이 초과되었습니다".into());
        }
        archive.start_file(&paths[&id], options)?;
        let mut output = VerifiedAsset {
            target: &mut archive,
            hash: Sha256::new(),
            written: 0,
            expected: meta.size,
        };
        engine
            .attachments()
            .ok_or("첨부파일 저장소를 열 수 없습니다")?
            .export(deadline, &id, &mut output)?;
        if output.written != meta.size
            || format!("{:x}", output.hash.finalize()) != meta.sha256.to_ascii_lowercase()
        {
            return Err(format!("첨부파일 크기 또는 해시가 일치하지 않습니다: {id}").into());
        }
        manifest.push(json!({"path":paths[&id], "metadata":meta}));
    }
    archive.start_file("manifest.json", options)?;
    archive.write_all(&serde_json::to_vec_pretty(
        &json!({"format":"inkism-markdown", "version":1,
        "note_id":req.id, "revision":req.revision, "attachments":manifest}),
    )?)?;
    Ok(archive.finish()?.0.into_inner())
}

pub(crate) fn serve(h: &Handler, r: &Request, deadline: Deadline) -> Response {
    if r.method != "POST" {
        return Response::fail(405, "POST required");
    }
    if !r
        .header("content-type")
        .unwrap_or("")
        .starts_with("application/json")
    {
        return Response::fail(415, "JSON required");
    }
    if r.body.len() > MAX_BYTES {
        return Response::fail(
            413,
            "내보내기 요청이 64 MiB를 넘었습니다. ZIP 백업을 사용해 주세요",
        );
    }
    let req = match serde_json::from_slice::<ExportRequest>(&r.body) {
        Ok(req) if !req.id.is_empty() && req.id.len() <= 256 && req.revision >= 1 => req,
        _ => return Response::fail(400, "노트와 저장된 버전이 필요합니다"),
    };
    let _slot = match SLOT.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner(),
        Err(_) => return Response::fail(429, "다른 Markdown 내보내기가 진행 중입니다"),
    };
    match bundle(h, &req, deadline) {
        Ok(body) => Response {
            status: 200,
            headers: vec![
                ("content-type".into(), "application/zip".into()),
                (
                    "content-disposition".into(),
                    "attachment; filename=inkism-markdown.zip".into(),
                ),
            ],
            body,
        },
        Err(e) => Response::fail(422, e),
    }
}

#[cfg(test)]
mod tests;
