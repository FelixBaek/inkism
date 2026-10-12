//! Backups (Go `backup_bundle.go`, `backup_restore.go`, `exportJSON`/`importJSON` in `http.go`).
//!
//! A bundle is a zip of `notes.json` (deflate), `attachments/<UUID>` (stored,
//! byte for byte) and `attachments.ndjson` (deflate, one metadata line per
//! attachment, in walk order). Go and Rust bundles restore on either side.

use crate::engine::{AttachmentMetadata, Attachments, Engine};
use crate::{success, Deadline, Handler, Request, Response, Result};
use regex::{Captures, Regex};
use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{self, Cursor, Read, Write};
use std::path::Path;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[cfg(test)]
mod tests;

const BUNDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const NOTE_CALL_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_METADATA_LINE: usize = 4096;
const MAX_MANIFEST: u64 = 64 << 20;
const MAX_ENTRIES: usize = 100_000;
pub(crate) const MAX_BUNDLE_BYTES: u64 = 64 << 30;
pub(crate) const MAX_BACKUP_NOTES_BYTES: u64 = 512 << 20;
pub(crate) const MAX_ATTACHMENT_BYTES: u64 = 1 << 30;
const MAX_IMPORT_BODY: usize = 512 << 20;
const ATTACHMENTS_PATH_PREFIX: &str = "/api/attachments/";

const NOTES_ENTRY: &str = "notes.json";
const MANIFEST_ENTRY: &str = "attachments.ndjson";
const ATTACHMENTS_DIR: &str = "attachments/";

// Go's `\s` is ASCII `[\t\n\f\r ]`, so it is spelled out.
static LOCAL_ASSET_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(^|["'\t\n\x0C\r (])(/api/attachments/)([a-zA-Z0-9_-]+)"#).unwrap()
});

type Row = BTreeMap<String, Box<RawValue>>;

/// ids::new_id() emits UUID strings. Only that shape may become a zip path or
/// manifest ID, which rules out traversal, separators and forged names.
fn is_asset_id(id: &str) -> bool {
    let b = id.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn is_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit())
}

fn check(deadline: Deadline) -> Result<()> {
    if Instant::now() >= deadline {
        return Err("context deadline exceeded".into());
    }
    Ok(())
}

fn hex(digest: impl AsRef<[u8]>) -> String {
    digest.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// The engine's own `{"ok":false,...}` (or final reply) passed through unchanged.
fn passthrough(status: u16, body: Vec<u8>) -> Response {
    Response {
        status,
        headers: vec![("content-type".into(), "application/json".into())],
        body,
    }
}

fn capability(h: &Handler) -> Option<(&dyn Engine, &dyn Attachments)> {
    let engine = h.engine.as_deref()?;
    Some((engine, engine.attachments()?))
}

/// Cancellation of the request must not interrupt the shared JSONL engine; a
/// bounded independent deadline still protects against an unresponsive one.
fn note_call(engine: &dyn Engine, deadline: Deadline, request: &Value) -> Result<Vec<u8>> {
    check(deadline)?;
    engine.call(
        Instant::now() + NOTE_CALL_TIMEOUT,
        &serde_json::to_vec(request)?,
    )
}

/// JSON the way Go's `json.Marshal` writes it (HTML-safe), so manifest lines
/// and their length limit match byte for byte.
fn go_json(value: &impl serde::Serialize) -> Result<Vec<u8>> {
    let plain = serde_json::to_string(value)?;
    let mut out = String::with_capacity(plain.len());
    for c in plain.chars() {
        match c {
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c => out.push(c),
        }
    }
    Ok(out.into_bytes())
}

// ---------------------------------------------------------------- export

/// `GET /api/backup`. The bundle is built and verified before any byte goes
/// out, so a partial or corrupt backup never reaches the client.
pub(crate) fn export_bundle(h: &Handler, _r: &Request) -> Response {
    let Some((engine, assets)) = capability(h) else {
        return Response::fail(501, "첨부파일 저장소가 없습니다");
    };
    let deadline = Instant::now() + BUNDLE_TIMEOUT;
    let directory = match tempfile::Builder::new().prefix("inkism-backup-").tempdir() {
        Ok(d) => d,
        Err(e) => return Response::fail(500, e),
    };
    // The export path is our own trusted temp file, never renderer input.
    let notes_path = directory.path().join(NOTES_ENTRY);
    let request = json!({"op": "export", "path": notes_path.to_string_lossy()});
    let response = match note_call(engine, deadline, &request) {
        Ok(r) => r,
        Err(e) => return Response::fail(500, e),
    };
    if !success(&response) {
        return passthrough(400, response);
    }
    match build_bundle(deadline, assets, &notes_path) {
        Ok(body) => Response {
            status: 200,
            headers: vec![
                ("content-type".into(), "application/zip".into()),
                (
                    "content-disposition".into(),
                    "attachment; filename=inkism-backup.zip".into(),
                ),
            ],
            body,
        },
        Err(e) => Response::fail(500, e),
    }
}

/// Counts and hashes bytes while they stream into a zip entry.
struct VerifiedWriter<'a, W: Write> {
    destination: &'a mut W,
    hash: Sha256,
    written: u64,
}

impl<W: Write> Write for VerifiedWriter<'_, W> {
    fn write(&mut self, chunk: &[u8]) -> io::Result<usize> {
        let n = self.destination.write(chunk)?;
        self.written += n as u64;
        self.hash.update(&chunk[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.destination.flush()
    }
}

fn build_bundle(
    deadline: Deadline,
    assets: &dyn Attachments,
    notes_path: &Path,
) -> Result<Vec<u8>> {
    let mut notes = std::fs::File::open(notes_path)?;
    if notes.metadata()?.len() > MAX_BACKUP_NOTES_BYTES {
        return Err("노트 백업 크기 초과".into());
    }
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let store = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    archive.start_file(NOTES_ENTRY, deflate)?;
    io::copy(&mut notes, &mut archive)?;
    drop(notes);

    let mut seen = HashSet::new();
    let mut total: u64 = 0;
    let mut manifest = Vec::new();
    assets.walk(deadline, &mut |meta| {
        check(deadline)?;
        total = total.saturating_add(meta.size);
        if seen.len() >= MAX_ENTRIES || total > MAX_BUNDLE_BYTES {
            return Err("백업 크기 또는 항목 수 초과".into());
        }
        let line = go_json(&meta)?;
        validate_bundle_meta(&meta, &seen)?;
        if line.len() + 1 >= MAX_METADATA_LINE
            || (manifest.len() + line.len() + 1) as u64 > MAX_MANIFEST
        {
            return Err(format!("첨부파일 메타데이터가 너무 깁니다: {}", meta.id).into());
        }
        seen.insert(meta.id.clone());
        archive.start_file(format!("{ATTACHMENTS_DIR}{}", meta.id), store)?;
        let mut counter = VerifiedWriter {
            destination: &mut archive,
            hash: Sha256::new(),
            written: 0,
        };
        assets.export(deadline, &meta.id, &mut counter)?;
        if counter.written != meta.size {
            return Err(format!("첨부파일 크기가 일치하지 않습니다: {}", meta.id).into());
        }
        if !hex(counter.hash.finalize()).eq_ignore_ascii_case(&meta.sha256) {
            return Err(format!("첨부파일 해시가 일치하지 않습니다: {}", meta.id).into());
        }
        manifest.extend_from_slice(&line);
        manifest.push(b'\n');
        Ok(())
    })?;
    archive.start_file(MANIFEST_ENTRY, deflate)?;
    archive.write_all(&manifest)?;
    let bytes = archive.finish()?.into_inner();
    verify_bundle(deadline, &bytes)?;
    if bytes.len() as u64 > MAX_BUNDLE_BYTES {
        return Err("백업 전체 크기 초과".into());
    }
    Ok(bytes)
}

fn validate_bundle_meta(meta: &AttachmentMetadata, seen: &HashSet<String>) -> Result<()> {
    if !is_asset_id(&meta.id) {
        return Err(format!("첨부파일 ID가 UUID 형식이 아닙니다: {:?}", meta.id).into());
    }
    if seen.contains(&meta.id) {
        return Err(format!("첨부파일 ID가 중복됩니다: {}", meta.id).into());
    }
    if meta.size > MAX_ATTACHMENT_BYTES {
        return Err(format!("첨부파일은 1GiB 이하여야 합니다: {}", meta.id).into());
    }
    if !is_hash(&meta.sha256) {
        return Err(format!("첨부파일 해시 형식이 잘못되었습니다: {}", meta.id).into());
    }
    Ok(())
}

// ---------------------------------------------------------------- verify

struct Bundle<'a> {
    notes: BTreeMap<String, Box<RawValue>>,
    rows: Option<Vec<Row>>,
    assets: Vec<AttachmentMetadata>,
    archive: ZipArchive<Cursor<&'a [u8]>>,
}

struct DeadlineReader<R> {
    deadline: Deadline,
    source: R,
}

impl<R: Read> Read for DeadlineReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if Instant::now() >= self.deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "context deadline exceeded",
            ));
        }
        self.source.read(buf)
    }
}

/// Entry count from the end-of-central-directory record. The zip crate keys
/// entries by name and silently keeps one of two duplicates; comparing the
/// counts turns that into a rejection, as Go's reader sees every entry.
fn central_directory_entries(data: &[u8]) -> Option<u64> {
    let last = data.len().checked_sub(22)?;
    let first = data.len().saturating_sub(22 + 0xFFFF);
    let at = (first..=last)
        .rev()
        .find(|&i| data[i..i + 4] == [0x50, 0x4b, 0x05, 0x06])?;
    let count = u16::from_le_bytes([data[at + 10], data[at + 11]]);
    if count != 0xFFFF {
        return Some(count.into());
    }
    let locator = data.get(at.checked_sub(20)?..at)?;
    if locator[..4] != [0x50, 0x4b, 0x06, 0x07] {
        return Some(count.into()); // exactly 65535 entries, no zip64 record
    }
    let offset = usize::try_from(u64::from_le_bytes(locator[8..16].try_into().ok()?)).ok()?;
    let record = data.get(offset..offset.checked_add(40)?)?;
    if record[..4] != [0x50, 0x4b, 0x06, 0x06] {
        return None;
    }
    Some(u64::from_le_bytes(record[32..40].try_into().ok()?))
}

fn allowed_entry(name: &str) -> bool {
    name == NOTES_ENTRY
        || name == MANIFEST_ENTRY
        || name.strip_prefix(ATTACHMENTS_DIR).is_some_and(is_asset_id)
}

fn verify_bundle(deadline: Deadline, data: &[u8]) -> Result<Bundle<'_>> {
    check(deadline)?;
    let mut archive = ZipArchive::new(Cursor::new(data))?;
    let declared = central_directory_entries(data).ok_or("백업 목록을 읽을 수 없습니다")?;
    if declared > (MAX_ENTRIES + 2) as u64 {
        return Err("백업 항목 수 초과".into());
    }
    if declared != archive.len() as u64 {
        return Err("중복 백업 항목".into());
    }
    for i in 0..archive.len() {
        check(deadline)?;
        let file = archive.by_index_raw(i)?;
        let kind = file.unix_mode().unwrap_or(0) & 0o170000;
        if file.is_dir() || (kind != 0 && kind != 0o100000) {
            return Err("일반 파일이 아닌 백업 항목".into());
        }
        if !allowed_entry(file.name()) {
            return Err(format!("알 수 없는 백업 항목: {}", file.name()).into());
        }
    }
    if archive.index_for_name(NOTES_ENTRY).is_none()
        || archive.index_for_name(MANIFEST_ENTRY).is_none()
    {
        return Err("노트 또는 첨부 목록이 없습니다".into());
    }
    let notes: BTreeMap<String, Box<RawValue>> = serde_json::from_slice(&read_limited(
        &mut archive,
        NOTES_ENTRY,
        MAX_BACKUP_NOTES_BYTES,
    )?)?;
    let rows: Option<Vec<Row>> = match notes.get("notes") {
        Some(raw) => serde_json::from_str(raw.get())?,
        None => return Err("unexpected end of JSON input".into()),
    };
    if archive.by_name(MANIFEST_ENTRY)?.size() > MAX_MANIFEST {
        return Err("첨부 목록 크기 초과".into());
    }
    let manifest = read_limited(&mut archive, MANIFEST_ENTRY, MAX_MANIFEST)?;
    let mut bundle = Bundle {
        notes,
        rows,
        assets: Vec::new(),
        archive,
    };
    let seen = bundle.verify_manifest(deadline, &manifest)?;
    if bundle.archive.len() != bundle.assets.len() + 2 {
        return Err("목록에 없는 첨부파일".into());
    }
    // Reject dangling references before writing any attachment or note.
    check_note_references(bundle.rows.as_deref().unwrap_or_default(), &seen)?;
    Ok(bundle)
}

fn read_limited(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>> {
    let file = archive.by_name(name)?;
    if file.size() > limit {
        return Err(format!("백업 항목이 너무 큽니다: {name}").into());
    }
    let mut data = Vec::new();
    file.take(limit + 1).read_to_end(&mut data)?;
    if data.len() as u64 > limit {
        return Err("백업 항목 크기 초과".into());
    }
    Ok(data)
}

impl Bundle<'_> {
    /// Checks every listed attachment against its bundle bytes; returns the verified ids.
    fn verify_manifest(&mut self, deadline: Deadline, manifest: &[u8]) -> Result<HashSet<String>> {
        let mut seen = HashSet::new();
        let mut total: u64 = 0;
        let mut lines: Vec<&[u8]> = manifest.split(|&b| b == b'\n').collect();
        if lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop(); // bufio.Scanner yields no token after a final newline
        }
        for line in lines {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            if line.len() >= MAX_METADATA_LINE {
                return Err("bufio.Scanner: token too long".into());
            }
            self.verify_manifest_line(deadline, line, &mut seen, &mut total)?;
        }
        Ok(seen)
    }

    fn verify_manifest_line(
        &mut self,
        deadline: Deadline,
        line: &[u8],
        seen: &mut HashSet<String>,
        total: &mut u64,
    ) -> Result<()> {
        check(deadline)?;
        let m: AttachmentMetadata = serde_json::from_slice(line)?;
        if !valid_bundle_metadata(&m) || seen.contains(&m.id) {
            return Err("잘못된 첨부 메타데이터".into());
        }
        let file = match self.archive.by_name(&format!("{ATTACHMENTS_DIR}{}", m.id)) {
            Ok(f) if f.size() == m.size => f,
            _ => return Err(format!("첨부파일 누락 또는 크기 불일치: {}", m.name).into()),
        };
        *total = total.saturating_add(m.size);
        if *total > MAX_BUNDLE_BYTES {
            return Err("백업 전체 크기 초과".into());
        }
        let mut hash = Sha256::new();
        let count = io::copy(
            &mut DeadlineReader {
                deadline,
                source: file,
            }
            .take(m.size + 1),
            &mut hash,
        )?;
        if count != m.size || !hex(hash.finalize()).eq_ignore_ascii_case(&m.sha256) {
            return Err(format!("첨부파일 해시 불일치: {}", m.name).into());
        }
        seen.insert(m.id.clone());
        self.assets.push(m);
        Ok(())
    }
}

fn valid_bundle_metadata(m: &AttachmentMetadata) -> bool {
    let bad_name = m.name.is_empty()
        || m.name.chars().count() > 255
        || m.name.contains(['/', '\\'])
        || m.name.chars().any(char::is_control);
    let bad_type = m.media_type.is_empty()
        || m.media_type.len() > 255
        || m.media_type.chars().any(char::is_control);
    is_asset_id(&m.id)
        && m.size <= MAX_ATTACHMENT_BYTES
        && is_hash(&m.sha256)
        && !bad_name
        && !bad_type
}

/// A `content`/`text` field: `None` when absent, `""` for JSON null (as Go reads it).
fn string_field(row: &Row, field: &str) -> Result<Option<String>> {
    match row.get(field) {
        None => Ok(None),
        Some(raw) => Ok(Some(
            serde_json::from_str::<Option<String>>(raw.get())?.unwrap_or_default(),
        )),
    }
}

/// A vault note's ciphertext record. Its plaintext attachment list is the only
/// part restore may rewrite; the engine maps old links inside the ciphertext
/// through each {id, ref} pair after decrypting.
fn locked_body(row: &Row) -> Result<Option<Map<String, Value>>> {
    let Some(raw) = row.get("locked_body") else {
        return Ok(None);
    };
    let body: Option<Map<String, Value>> =
        serde_json::from_str(raw.get()).map_err(|e| format!("잠긴 노트 형식 오류: {e}"))?;
    if let Some(body) = &body {
        if locked_attachments(body).any(|item| item.and_then(|i| i.get("id")?.as_str()).is_none()) {
            return Err("잠긴 노트 첨부 형식 오류".into());
        }
    }
    Ok(body)
}

/// Each `attachments` entry; non-objects come back as `None`.
fn locked_attachments(
    body: &Map<String, Value>,
) -> impl Iterator<Item = Option<&Map<String, Value>>> {
    body.get("attachments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(Value::as_object)
}

#[cfg(test)]
fn named_version_rows(note:&Row)->Result<Vec<Row>> {version_rows(note,"named_versions")}
fn version_rows(note:&Row,field:&str)->Result<Vec<Row>> {
 let Some(value)=note.get(field) else{return Ok(Vec::new());};
 let rows:Vec<Row>=serde_json::from_str(value.get())?;
 if rows.len()>100 || rows.iter().any(|r|r.contains_key("named_versions")||r.contains_key("encrypted_named_versions")){return Err("invalid named versions".into());}Ok(rows)
}

fn check_note_references(rows: &[Row], seen: &HashSet<String>) -> Result<()> {
    for note in rows {
        check_text_references(note, seen)?;
        for field in ["named_versions","encrypted_named_versions"] {for version in version_rows(note,field)? {check_text_references(&version,seen)?;check_locked_references(&version,seen)?;}}
        check_locked_references(note, seen)?;
    }
    Ok(())
}

fn check_text_references(note: &Row, seen: &HashSet<String>) -> Result<()> {
    for field in ["content", "text"] {
        let value = string_field(note, field)?.unwrap_or_default();
        for caps in LOCAL_ASSET_URL.captures_iter(&value) {
            if !seen.contains(&caps[3]) {
                return Err(format!("노트가 참조하는 첨부파일 누락: {}", &caps[3]).into());
            }
        }
    }
    Ok(())
}

fn check_locked_references(note: &Row, seen: &HashSet<String>) -> Result<()> {
    let Some(body) = locked_body(note)? else {
        return Ok(());
    };
    for item in locked_attachments(&body).flatten() {
        let id = item["id"].as_str().unwrap_or_default();
        if !seen.contains(id) {
            return Err(format!("잠긴 노트가 참조하는 첨부파일 누락: {id}").into());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- restore

fn raw(value: &impl serde::Serialize) -> Result<Box<RawValue>> {
    Ok(serde_json::value::to_raw_value(value)?)
}

impl Bundle<'_> {
    fn write_notes(&mut self, path: &Path, ids: Option<&HashMap<String, String>>) -> Result<()> {
        if let Some(ids) = ids {
            for note in self.rows.iter_mut().flatten() {
                remap_note_assets(note, ids)?;
            }
            remap_notebook_covers(&mut self.notes, ids)?;
        }
        self.notes.insert("notes".into(), raw(&self.rows)?);
        let mut encoded = serde_json::to_vec(&self.notes)?;
        encoded.push(b'\n');
        std::fs::write(path, encoded)?;
        Ok(())
    }
}

/// Rewrites one note's attachment links to the restored ids.
fn remap_note_assets(note: &mut Row, ids: &HashMap<String, String>) -> Result<()> {
    for field in ["named_versions","encrypted_named_versions"]{let mut versions=version_rows(note,field)?;for version in &mut versions{remap_note_assets(version,ids)?;}if note.contains_key(field){note.insert(field.into(),raw(&versions)?);}}
    let new_id = |id: &str| ids.get(id).cloned().unwrap_or_default();
    for field in ["content", "text"] {
        let Some(value) = string_field(note, field)? else {
            continue;
        };
        let value = LOCAL_ASSET_URL.replace_all(&value, |c: &Captures| {
            format!("{}{}{}", &c[1], &c[2], new_id(&c[3]))
        });
        note.insert(field.into(), raw(&value)?);
    }
    let Some(mut body) = locked_body(note)? else {
        return Ok(());
    };
    if let Some(Value::Array(list)) = body.get_mut("attachments") {
        for item in list.iter_mut().filter_map(Value::as_object_mut) {
            let id = new_id(item["id"].as_str().unwrap_or_default());
            item.insert("id".into(), Value::String(id));
        }
    }
    note.insert("locked_body".into(), raw(&body)?);
    Ok(())
}

/// Points local-file notebook covers at the renumbered attachments; a cover
/// whose file is not in the bundle is dropped instead of failing the restore.
fn remap_notebook_covers(
    notes: &mut BTreeMap<String, Box<RawValue>>,
    ids: &HashMap<String, String>,
) -> Result<()> {
    #[derive(Deserialize)]
    struct Cover {
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        url: Option<String>,
    }
    let Some(notebooks) = notes.get("notebooks") else {
        return Ok(());
    };
    let mut notebooks: Option<Vec<Row>> = serde_json::from_str(notebooks.get())?;
    for notebook in notebooks.iter_mut().flatten() {
        let Some(cover) = notebook.get("cover") else {
            continue;
        };
        let Ok(Some(cover)) = serde_json::from_str::<Option<Cover>>(cover.get()) else {
            continue;
        };
        if cover.kind.as_deref() != Some("attachment") {
            continue;
        }
        let url = cover.url.unwrap_or_default();
        match url
            .strip_prefix(ATTACHMENTS_PATH_PREFIX)
            .and_then(|id| ids.get(id))
        {
            Some(next) => {
                let cover = json!({"kind": "attachment", "url": format!("{ATTACHMENTS_PATH_PREFIX}{next}")});
                notebook.insert("cover".into(), raw(&cover)?);
            }
            None => {
                notebook.remove("cover");
            }
        }
    }
    notes.insert("notebooks".into(), raw(&notebooks)?);
    Ok(())
}

/// `POST /api/restore`.
pub(crate) fn restore_bundle(h: &Handler, r: &Request) -> Response {
    let Some((engine, assets)) = capability(h) else {
        return Response::fail(501, "첨부파일 저장소가 없습니다");
    };
    if r.body.len() as u64 > MAX_BUNDLE_BYTES + (1 << 20) {
        return Response::fail(400, "http: request body too large");
    }
    let data = match form_file(r, "file") {
        Ok(d) => d,
        Err(e) => return Response::fail(400, e),
    };
    let deadline = Instant::now() + BUNDLE_TIMEOUT;
    let mut bundle = match verify_bundle(deadline, data) {
        Ok(b) => b,
        Err(e) => return Response::fail(400, e),
    };
    let directory = match tempfile::Builder::new().prefix("inkism-restore-").tempdir() {
        Ok(d) => d,
        Err(e) => return Response::fail(500, e),
    };
    let path = directory.path().join(NOTES_ENTRY);
    if let Err(e) = bundle.write_notes(&path, None) {
        return Response::fail(500, e);
    }
    let path_text = path.to_string_lossy();
    let response = match note_call(
        engine,
        deadline,
        &json!({"op": "validate_import", "path": path_text}),
    ) {
        Ok(r) => r,
        Err(e) => return Response::fail(500, e),
    };
    if !success(&response) {
        return passthrough(400, response);
    }
    // Publish immutable assets before the single notes transaction. A crash can
    // leave unreferenced assets, but can never commit notes pointing at missing bytes.
    let ids = match publish_assets(&mut bundle, assets, deadline) {
        Ok(ids) => ids,
        Err(rejected) => return rejected,
    };
    if let Err(e) = bundle.write_notes(&path, Some(&ids)) {
        return Response::fail(500, e);
    }
    match note_call(
        engine,
        deadline,
        &json!({"op": "import", "path": path_text}),
    ) {
        Ok(r) => passthrough(if success(&r) { 200 } else { 400 }, r),
        Err(e) => Response::fail(500, e),
    }
}

/// Imports every bundled asset; maps old attachment ids to the new ones.
fn publish_assets(
    bundle: &mut Bundle,
    assets: &dyn Attachments,
    deadline: Deadline,
) -> std::result::Result<HashMap<String, String>, Response> {
    let mut ids = HashMap::new();
    for old in std::mem::take(&mut bundle.assets) {
        let mut stream = bundle
            .archive
            .by_name(&format!("{ATTACHMENTS_DIR}{}", old.id))
            .map_err(|e| Response::fail(400, e))?;
        let metadata = assets
            .import(deadline, &old.name, &old.media_type, &mut stream)
            .map_err(|e| Response::fail(500, e))?;
        if metadata.size != old.size
            || !metadata.sha256.eq_ignore_ascii_case(&old.sha256)
            || !is_asset_id(&metadata.id)
        {
            return Err(Response::fail(500, "복원한 첨부파일 검증 실패"));
        }
        ids.insert(old.id, metadata.id);
    }
    Ok(ids)
}

// ---------------------------------------------------------------- JSON export/import

/// `GET /api/export`: the notes-only JSON backup.
pub(crate) fn export_json(h: &Handler, _r: &Request, deadline: Deadline) -> Response {
    let engine = match h.engine() {
        Ok(e) => e,
        Err(e) => return Response::fail(500, e),
    };
    let directory = match tempfile::Builder::new().prefix("inkism-backup-").tempdir() {
        Ok(d) => d,
        Err(e) => return Response::fail(500, e),
    };
    let path = directory.path().join("inkism-backup.json");
    let request = json!({"op": "export", "path": path.to_string_lossy()});
    let response = match serde_json::to_vec(&request)
        .map_err(Into::into)
        .and_then(|req| engine.call(deadline, &req))
    {
        Ok(r) => r,
        Err(e) => return Response::fail(500, e),
    };
    if !success(&response) {
        return passthrough(400, response);
    }
    match std::fs::read(&path) {
        Ok(body) => passthrough(200, body).with_header(
            "content-disposition",
            r#"attachment; filename="inkism-backup.json""#,
        ),
        Err(e) => Response::fail(500, e),
    }
}

/// `POST /api/import`: a notes-only JSON backup, uploaded as multipart `file`.
pub(crate) fn import_json(h: &Handler, r: &Request, deadline: Deadline) -> Response {
    if r.body.len() > MAX_IMPORT_BODY {
        return Response::fail(400, "http: request body too large");
    }
    let data = match form_file(r, "file") {
        Ok(d) => d,
        Err(e) => return Response::fail(400, e),
    };
    let file = tempfile::Builder::new()
        .prefix("inkism-import-")
        .suffix(".json")
        .tempfile()
        .and_then(|mut f| {
            f.write_all(data)?;
            Ok(f.into_temp_path()) // closed, so the engine can open it on Windows
        });
    let path = match file {
        Ok(p) => p,
        Err(e) => return Response::fail(500, e),
    };
    let request = json!({"op": "import", "path": path.to_string_lossy()});
    crate::rpc::forward(
        h,
        &serde_json::to_vec(&request).unwrap_or_default(),
        deadline,
    )
}

// ---------------------------------------------------------------- multipart

/// The bytes of the multipart/form-data file part `name` (Go `FormFile`).
// ponytail: CRLF-delimited form-data only, as browsers send it; whole body in memory.
fn form_file<'a>(r: &'a Request, name: &str) -> Result<&'a [u8]> {
    let content_type = r.header("content-type").unwrap_or("");
    let mut params = content_type.split(';').map(str::trim);
    if !params
        .next()
        .unwrap_or("")
        .eq_ignore_ascii_case("multipart/form-data")
    {
        return Err("request Content-Type isn't multipart/form-data".into());
    }
    let boundary = params
        .filter_map(|p| p.split_once('='))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("boundary"))
        .map(|(_, v)| v.trim().trim_matches('"'))
        .filter(|b| !b.is_empty())
        .ok_or("no multipart boundary param in Content-Type")?;
    let delimiter = format!("\r\n--{boundary}").into_bytes();
    let body = &r.body;
    // The first delimiter may sit at the very start, without the leading CRLF.
    let mut at = if body.starts_with(&delimiter[2..]) {
        delimiter.len() - 2
    } else {
        find(body, &delimiter, 0).ok_or("multipart: NextPart: EOF")? + delimiter.len()
    };
    loop {
        if body[at..].starts_with(b"--") {
            return Err("http: no such file".into());
        }
        at = find(body, b"\r\n", at).ok_or("multipart: NextPart: EOF")? + 2;
        let headers_end = find(body, b"\r\n\r\n", at).ok_or("multipart: NextPart: EOF")?;
        let headers = String::from_utf8_lossy(&body[at..headers_end]);
        let data_start = headers_end + 4;
        let data_end = find(body, &delimiter, data_start).ok_or("multipart: NextPart: EOF")?;
        if is_file_part(&headers, name) {
            return Ok(&body[data_start..data_end]);
        }
        at = data_end + delimiter.len();
    }
}

fn is_file_part(headers: &str, name: &str) -> bool {
    let Some(disposition) = headers
        .split("\r\n")
        .filter_map(|line| line.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-disposition"))
        .map(|(_, v)| v)
    else {
        return false;
    };
    let params: Vec<(String, &str)> = disposition
        .split(';')
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().trim_matches('"')))
        .collect();
    params.iter().any(|(k, v)| k == "name" && *v == name)
        && params.iter().any(|(k, v)| k == "filename" && !v.is_empty())
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|i| i + from)
}
