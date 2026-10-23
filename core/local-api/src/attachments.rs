//! Attachment upload/download (Go `attachments.go` handler half). The loopback
//! upload server lives in `upload_server.rs`.

use crate::{Handler, Request, Response};
use serde::Serialize;
use std::time::{Duration, Instant};

pub(crate) const PATH_PREFIX: &str = "/api/attachments/";

pub(crate) const MAX_ATTACHMENT_BYTES: u64 = 1 << 30;
// Bound individual inline decodes; original files remain downloadable.
const MAX_PREVIEW_BYTES: u64 = 32 << 20;
const MAX_PREVIEW_DIMENSION: u64 = 8192;
const MAX_PREVIEW_PIXELS: u64 = 16_000_000;
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(600);

/// Strict whitelist for `?preview=1`: only raster images may render inline.
/// SVG/HTML and everything else stays a forced download, so stored markup can
/// never execute in the app origin.
const PREVIEW_INLINE_MEDIA_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const NO_STORE: &str = "첨부파일 저장소가 없습니다";
const NO_PREVIEW: &str = "이 첨부파일은 인라인 미리보기를 지원하지 않습니다";
const PREVIEW_TOO_BIG: &str = "큰 이미지는 미리보기 대신 원본을 다운로드해 주세요";

/// Address and capability token of the loopback upload server.
#[derive(Clone, Debug, Default, Serialize)]
pub struct UploadAccess {
    pub url: String,
    pub token: String,
}

pub(crate) fn upload_access(h: &Handler) -> Response {
    Response::json(200, &serde_json::to_value(h.upload.clone().unwrap_or_default()).unwrap_or_default())
}

pub(crate) fn upload(h: &Handler, r: &Request) -> Response {
    let Some(assets) = h.engine.as_ref().and_then(|e| e.attachments()) else {
        return Response::fail(501, NO_STORE);
    };
    if r.body.len() as u64 > MAX_ATTACHMENT_BYTES + (1 << 20) {
        return Response::fail(400, "http: request body too large");
    }
    let parts = match parse_multipart(r) {
        Ok(parts) => parts,
        Err(e) => return Response::fail(400, e),
    };
    let Some(file) = parts.iter().find(|p| p.name == "file" && p.filename.is_some()) else {
        return Response::fail(400, "http: no such file");
    };
    // Go `FormValue`: the query string wins over the multipart body.
    let expected = query_value(r, "size").or_else(|| {
        parts.iter().find(|p| p.name == "size" && p.filename.is_none()).map(|p| String::from_utf8_lossy(p.body).into_owned())
    });
    let received = file.body.len() as u64;
    if let Some(expected) = expected.filter(|s| !s.is_empty()) {
        if parse_go_uint(&expected) != Some(received) {
            return Response::fail(400, format!("첨부파일 전송 크기가 일치하지 않습니다 (예상 {expected}, 수신 {received} 바이트)"));
        }
    }
    if received > MAX_ATTACHMENT_BYTES {
        return Response::fail(413, "첨부파일은 1GiB 이하여야 합니다");
    }
    let media_type = file.content_type.as_deref().filter(|t| !t.is_empty()).unwrap_or("application/octet-stream");
    let name = file.filename.as_deref().unwrap_or_default();
    let mut source = file.body;
    let metadata = match assets.import(Instant::now() + TRANSFER_TIMEOUT, name, media_type, &mut source) {
        Ok(m) => m,
        Err(e) => return Response::fail(400, e),
    };
    if metadata.size != received {
        return Response::fail(500, format!("첨부파일 저장 크기가 일치하지 않습니다 (수신 {received}, 저장 {} 바이트)", metadata.size));
    }
    Response::json(201, &serde_json::json!({"ok": true, "data": metadata}))
}

pub(crate) fn download(h: &Handler, r: &Request) -> Response {
    let Some(assets) = h.engine.as_ref().and_then(|e| e.attachments()) else {
        return Response::fail(501, NO_STORE);
    };
    let id = match percent_decode(&r.path[PATH_PREFIX.len().min(r.path.len())..]) {
        Some(id) if !id.is_empty() && !id.contains(['/', '\\', '\0']) => id,
        _ => return Response::fail(400, "invalid attachment id"),
    };
    let deadline = Instant::now() + TRANSFER_TIMEOUT;
    let metadata = match assets.info(deadline, &id) {
        Ok(m) => m,
        Err(e) => return Response::fail(404, e),
    };
    let preview = query_value(r, "preview").as_deref() == Some("1");
    if preview {
        // The declared type must be whitelisted before any storage read.
        let declared = parse_media_type(&metadata.media_type).map(|(t, _)| t);
        if !declared.as_deref().is_some_and(|t| PREVIEW_INLINE_MEDIA_TYPES.contains(&t)) {
            return Response::fail(415, NO_PREVIEW);
        }
        if metadata.size > MAX_PREVIEW_BYTES {
            return Response::fail(413, PREVIEW_TOO_BIG);
        }
    }
    // Verify every byte/hash before sending anything to the client.
    let mut output = Vec::new();
    if let Err(e) = assets.export(deadline, &id, &mut output) {
        return Response::fail(500, e);
    }
    if output.len() as u64 != metadata.size {
        return Response::fail(500, "첨부파일 크기가 일치하지 않습니다");
    }
    let (content_type, disposition) = if preview {
        let declared = parse_media_type(&metadata.media_type).map(|(t, _)| t).unwrap_or_default();
        if let Some(rejected) = check_inline_preview(&output, &declared) {
            return rejected;
        }
        (declared, "inline")
    } else {
        ("application/octet-stream".to_string(), "attachment")
    };
    let headers = vec![
        ("content-type".to_string(), content_type),
        ("content-disposition".to_string(), format_disposition(disposition, &metadata.name)),
    ];
    serve_content(r, headers, &output)
}

/// Verifies the stored bytes before an inline response: the sniffed type must
/// equal the declaration, and a bounded header read must give sane dimensions.
fn check_inline_preview(data: &[u8], preview_type: &str) -> Option<Response> {
    if sniff_image(data) != Some(preview_type) {
        return Some(Response::fail(415, "첨부파일 내용이 선언된 형식과 일치하지 않습니다"));
    }
    let head = &data[..data.len().min(1 << 20)];
    let (width, height) = match image_config(head, preview_type) {
        Some((w, h)) if w > 0 && h > 0 => (w, h),
        _ => return Some(Response::fail(415, "이미지 크기를 확인할 수 없어 미리보기를 표시하지 않습니다")),
    };
    if width > MAX_PREVIEW_DIMENSION || height > MAX_PREVIEW_DIMENSION || width * height > MAX_PREVIEW_PIXELS {
        return Some(Response::fail(413, PREVIEW_TOO_BIG));
    }
    None
}

/// The image rows of Go's `http.DetectContentType`. For these four types no
/// earlier signature can match, so a prefix test gives the same answer.
fn sniff_image(data: &[u8]) -> Option<&'static str> {
    let webp = data.len() >= 14 && &data[..4] == b"RIFF" && &data[8..14] == b"WEBPVP";
    match data {
        _ if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") => Some("image/gif"),
        _ if webp => Some("image/webp"),
        _ if data.starts_with(b"\x89PNG\r\n\x1a\n") => Some("image/png"),
        _ if data.starts_with(b"\xff\xd8\xff") => Some("image/jpeg"),
        _ => None,
    }
}

/// Width and height from the header only (Go `image.DecodeConfig`).
fn image_config(data: &[u8], media_type: &str) -> Option<(u64, u64)> {
    match media_type {
        "image/png" => png_config(data),
        "image/jpeg" => jpeg_config(data),
        "image/gif" => gif_config(data),
        "image/webp" => webp_config(data),
        _ => None,
    }
}

fn be32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

fn png_config(data: &[u8]) -> Option<(u64, u64)> {
    let ihdr = data.get(8..33)?;
    if be32(ihdr) != 13 || &ihdr[4..8] != b"IHDR" || crc32(&ihdr[4..21]) != be32(&ihdr[21..]) {
        return None;
    }
    let (w, h, depth, color) = (be32(&ihdr[8..]), be32(&ihdr[12..]), ihdr[16], ihdr[17]);
    let depth_ok = match color {
        0 => matches!(depth, 1 | 2 | 4 | 8 | 16),
        3 => matches!(depth, 1 | 2 | 4 | 8),
        2 | 4 | 6 => matches!(depth, 8 | 16),
        _ => false,
    };
    // Go reads both as int32, so the top bit makes them non-positive.
    let valid = depth_ok && ihdr[18] == 0 && ihdr[19] == 0 && ihdr[20] <= 1 && (1..=i32::MAX as u32).contains(&w) && (1..=i32::MAX as u32).contains(&h);
    valid.then_some((w.into(), h.into()))
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

// ponytail: stops at the first SOF; Go keeps reading to SOS for non-JFIF files.
fn jpeg_config(data: &[u8]) -> Option<(u64, u64)> {
    if !data.starts_with(b"\xff\xd8") {
        return None;
    }
    let mut i = 2;
    loop {
        // Skip garbage up to a 0xff, then any fill bytes (Go is as lenient).
        while *data.get(i)? != 0xff {
            i += 1;
        }
        while *data.get(i)? == 0xff {
            i += 1;
        }
        let marker = data[i];
        i += 1;
        match marker {
            0x00 | 0xd0..=0xd7 => continue,
            0xd9 | 0xda => return None, // EOI / SOS before any SOF
            _ => {}
        }
        let len = usize::from(u16::from_be_bytes([*data.get(i)?, *data.get(i + 1)?])).checked_sub(2)?;
        let segment = data.get(i + 2..i + 2 + len)?;
        match marker {
            0xc0..=0xc2 => {
                let components = usize::from(*segment.get(5)?);
                if !matches!(len, 9 | 15 | 18) || len != 6 + 3 * components || segment[0] != 8 {
                    return None;
                }
                let height = u16::from_be_bytes([segment[1], segment[2]]);
                let width = u16::from_be_bytes([segment[3], segment[4]]);
                return Some((width.into(), height.into()));
            }
            0xc4 | 0xdb | 0xdd | 0xe0..=0xef | 0xfe => i += 2 + len,
            _ => return None,
        }
    }
}

fn gif_config(data: &[u8]) -> Option<(u64, u64)> {
    let header = data.get(..13)?;
    if !(header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a")) {
        return None;
    }
    let flags = header[10];
    if flags & 0x80 != 0 && data.len() < 13 + 3 * (1 << (1 + (flags & 7))) {
        return None; // truncated global colour table
    }
    let width = u16::from_le_bytes([header[6], header[7]]);
    let height = u16::from_le_bytes([header[8], header[9]]);
    Some((width.into(), height.into()))
}

fn webp_config(data: &[u8]) -> Option<(u64, u64)> {
    let riff_len = u32::from_le_bytes(data.get(4..8)?.try_into().ok()?);
    if data.get(..4)? != b"RIFF" || riff_len < 4 || data.get(8..12)? != b"WEBP" {
        return None;
    }
    let chunk_len = u32::from_le_bytes(data.get(16..20)?.try_into().ok()?) as usize;
    let chunk = data.get(20..20usize.checked_add(chunk_len)?)?;
    let le24 = |b: &[u8]| u64::from(b[0]) | u64::from(b[1]) << 8 | u64::from(b[2]) << 16;
    match data.get(12..16)? {
        b"VP8 " => {
            let b = chunk.get(..3)?;
            if b[0] & 1 != 0 {
                return Some((0, 0)); // not a key frame: Go reports no size
            }
            let b = chunk.get(3..10)?;
            if b[..3] != [0x9d, 0x01, 0x2a] {
                return None;
            }
            Some((u64::from(b[4] & 0x3f) << 8 | u64::from(b[3]), u64::from(b[6] & 0x3f) << 8 | u64::from(b[5])))
        }
        b"VP8L" => {
            let b = chunk.get(..5)?;
            let bits = u32::from_le_bytes([b[1], b[2], b[3], b[4]]);
            if b[0] != 0x2f || bits >> 29 != 0 {
                return None;
            }
            Some((u64::from(bits & 0x3fff) + 1, u64::from(bits >> 14 & 0x3fff) + 1))
        }
        b"VP8X" if chunk_len == 10 => Some((le24(&chunk[4..7]) + 1, le24(&chunk[7..10]) + 1)),
        _ => None,
    }
}

/// Go `http.ServeContent` for an in-memory body with no ETag or modtime:
/// conditional headers, `Range` (single and multipart), HEAD.
fn serve_content(r: &Request, mut headers: Vec<(String, String)>, data: &[u8]) -> Response {
    let size = data.len() as u64;
    let lists_star = |v: &str| v.split(',').any(|t| t.trim() == "*");
    if r.header("if-match").is_some_and(|v| !v.is_empty() && !lists_star(v)) {
        return Response { file: None, status: 412, headers, body: Vec::new() };
    }
    if r.header("if-none-match").is_some_and(lists_star) {
        headers.retain(|(k, _)| k != "content-type");
        return Response { file: None, status: 304, headers, body: Vec::new() };
    }
    // Without an ETag or modtime If-Range never matches: send the whole file.
    let range = r.header("range").filter(|_| r.header("if-range").is_none_or(str::is_empty)).unwrap_or("");
    headers.push(("accept-ranges".into(), "bytes".into()));
    let mut status = 200;
    let mut body = data.to_vec();
    match parse_range(range, size) {
        Err(no_overlap) => return range_not_satisfiable(headers, size, no_overlap),
        Ok(ranges) if ranges.iter().map(|r| r.1).sum::<u64>() > size => {}
        Ok(ranges) if ranges.len() == 1 => {
            let (start, length) = ranges[0];
            status = 206;
            headers.push(("content-range".into(), format!("bytes {start}-{}/{size}", start + length - 1)));
            body = data[start as usize..(start + length) as usize].to_vec();
        }
        Ok(ranges) if ranges.len() > 1 => {
            status = 206;
            let boundary = random_hex(30);
            let content_type = headers.iter().find(|(k, _)| k == "content-type").map(|(_, v)| v.clone()).unwrap_or_default();
            body = multipart_ranges(data, &ranges, &boundary, &content_type);
            headers.retain(|(k, _)| k != "content-type");
            headers.push(("content-type".into(), format!("multipart/byteranges; boundary={boundary}")));
        }
        Ok(_) => {}
    }
    headers.push(("content-length".into(), body.len().to_string()));
    if r.method == "HEAD" {
        body.clear();
    }
    Response { file: None, status, headers, body }
}

fn range_not_satisfiable(mut headers: Vec<(String, String)>, size: u64, no_overlap: bool) -> Response {
    if no_overlap {
        headers.push(("content-range".into(), format!("bytes */{size}")));
    }
    let message = if no_overlap { "invalid range: failed to overlap" } else { "invalid range" };
    headers.retain(|(k, _)| k != "content-type");
    headers.push(("content-type".into(), "text/plain; charset=utf-8".into()));
    Response { file: None, status: 416, headers, body: format!("{message}\n").into_bytes() }
}

fn multipart_ranges(data: &[u8], ranges: &[(u64, u64)], boundary: &str, content_type: &str) -> Vec<u8> {
    let size = data.len();
    let mut body = Vec::new();
    for (i, &(start, length)) in ranges.iter().enumerate() {
        let lead = if i == 0 { "" } else { "\r\n" };
        let end = start + length - 1;
        body.extend_from_slice(format!("{lead}--{boundary}\r\nContent-Range: bytes {start}-{end}/{size}\r\nContent-Type: {content_type}\r\n\r\n").as_bytes());
        body.extend_from_slice(&data[start as usize..=end as usize]);
    }
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// Go `parseRange`: `(start, length)` pairs; `Err(true)` = no overlap.
fn parse_range(header: &str, size: u64) -> Result<Vec<(u64, u64)>, bool> {
    if header.is_empty() {
        return Ok(Vec::new());
    }
    let spec = header.strip_prefix("bytes=").ok_or(false)?;
    let size = i64::try_from(size).map_err(|_| false)?;
    let mut ranges = Vec::new();
    let mut no_overlap = false;
    for part in spec.split(',') {
        let part = part.trim_matches([' ', '\t']);
        if part.is_empty() {
            continue;
        }
        match parse_range_spec(part, size)? {
            Some(range) => ranges.push(range),
            None => no_overlap = true,
        }
    }
    if no_overlap && ranges.is_empty() {
        return Err(true);
    }
    Ok(ranges)
}

/// One `first-last` or `-suffix` spec; `Ok(None)` = starts past the end.
fn parse_range_spec(part: &str, size: i64) -> Result<Option<(u64, u64)>, bool> {
    let (start, end) = part.split_once('-').ok_or(false)?;
    let (start, end) = (start.trim_matches([' ', '\t']), end.trim_matches([' ', '\t']));
    if start.is_empty() {
        // suffix-byte-range-spec: the final N bytes.
        if end.is_empty() || end.starts_with('-') {
            return Err(false);
        }
        let n = end.parse::<i64>().map_err(|_| false)?.min(size);
        return Ok(Some(((size - n) as u64, n as u64)));
    }
    let first = start.parse::<i64>().map_err(|_| false)?;
    if first < 0 {
        return Err(false);
    }
    if first >= size {
        return Ok(None);
    }
    let length = if end.is_empty() {
        size - first
    } else {
        let last = end.parse::<i64>().map_err(|_| false)?;
        if first > last {
            return Err(false);
        }
        last.min(size - 1) - first + 1
    };
    Ok(Some((first as u64, length as u64)))
}

pub(crate) fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("system random source");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Go `strconv.ParseUint(s, 10, 64)`: digits only, no sign.
fn parse_go_uint(s: &str) -> Option<u64> {
    s.bytes().all(|b| b.is_ascii_digit()).then(|| s.parse().ok()).flatten()
}

fn query_value(r: &Request, key: &str) -> Option<String> {
    url::form_urlencoded::parse(r.query.as_deref()?.as_bytes()).find(|(k, _)| k == key).map(|(_, v)| v.into_owned())
}

fn percent_decode(s: &str) -> Option<String> {
    let mut out = Vec::with_capacity(s.len());
    let mut bytes = s.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let hex = [bytes.next()?, bytes.next()?];
            out.push(u8::from_str_radix(std::str::from_utf8(&hex).ok()?, 16).ok()?);
        } else {
            out.push(b);
        }
    }
    String::from_utf8(out).ok()
}

const TSPECIALS: &[u8] = b"()<>@,;:\\\"/[]?=";

fn is_token_char(b: u8) -> bool {
    b > b' ' && b < 0x7f && !TSPECIALS.contains(&b)
}

fn consume_token(s: &str) -> (&str, &str) {
    let end = s.bytes().position(|b| !is_token_char(b)).unwrap_or(s.len());
    s.split_at(end)
}

/// Token or quoted-string (Go `consumeValue`).
fn consume_value(s: &str) -> Option<(String, &str)> {
    let Some(quoted) = s.strip_prefix('"') else {
        let (token, rest) = consume_token(s);
        return (!token.is_empty()).then(|| (token.to_string(), rest));
    };
    let mut value = Vec::new();
    let bytes = quoted.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => return Some((String::from_utf8_lossy(&value).into_owned(), &quoted[i + 1..])),
            b'\\' if i + 1 < bytes.len() && TSPECIALS.contains(&bytes[i + 1]) => {
                value.push(bytes[i + 1]);
                i += 1;
            }
            b'\r' | b'\n' => return None,
            b => value.push(b),
        }
        i += 1;
    }
    None
}

// ponytail: RFC 2231 `name*=` parameters are not decoded; browsers send plain ones.
/// Go `mime.ParseMediaType`: lower-case type and parameters.
fn parse_media_type(v: &str) -> Option<(String, Vec<(String, String)>)> {
    let base = v.split(';').next().unwrap_or_default();
    let media_type = base.trim().to_ascii_lowercase();
    let (kind, rest) = consume_token(&media_type);
    if kind.is_empty() {
        return None;
    }
    if let Some(sub) = rest.strip_prefix('/') {
        let (sub, rest) = consume_token(sub);
        if sub.is_empty() || !rest.is_empty() {
            return None;
        }
    } else if !rest.is_empty() {
        return None;
    }
    let mut params: Vec<(String, String)> = Vec::new();
    let mut rest = &v[base.len()..];
    loop {
        rest = rest.trim_start();
        if rest.is_empty() {
            break;
        }
        let parsed = rest.strip_prefix(';').and_then(|p| {
            let (key, after) = consume_token(p.trim_start());
            let after = after.trim_start().strip_prefix('=')?;
            let (value, after) = consume_value(after.trim_start())?;
            (!key.is_empty()).then(|| (key.to_ascii_lowercase(), value, after))
        });
        match parsed {
            Some((key, value, after)) => {
                if params.iter().any(|(k, _)| *k == key) {
                    return None;
                }
                params.push((key, value));
                rest = after;
            }
            None if rest.trim() == ";" => break, // trailing semicolon
            None => return None,
        }
    }
    Some((media_type, params))
}

/// Go `mime.FormatMediaType(disposition, {"filename": name})`.
fn format_disposition(disposition: &str, name: &str) -> String {
    if name.bytes().any(|b| !(b' '..=b'~').contains(&b) && b != b'\t') {
        let mut out = format!("{disposition}; filename*=utf-8''");
        for b in name.bytes() {
            if b <= b' ' || b >= 0x7f || b"*'%".contains(&b) || TSPECIALS.contains(&b) {
                out.push_str(&format!("%{b:02X}"));
            } else {
                out.push(b as char);
            }
        }
        return out;
    }
    if !name.is_empty() && name.bytes().all(is_token_char) {
        return format!("{disposition}; filename={name}");
    }
    let escaped = name.replace('\\', "\\\\").replace('"', "\\\"");
    format!("{disposition}; filename=\"{escaped}\"")
}

pub(crate) struct Part<'a> {
    pub name: String,
    /// `Some` marks a file field (Go: a non-empty filename parameter).
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub body: &'a [u8],
}

// ponytail: in-memory multipart/form-data reader; no part-count or
// quoted-printable handling, the request body is already bounded.
/// Go `ParseMultipartForm`, form-data parts in order.
pub(crate) fn parse_multipart(r: &Request) -> Result<Vec<Part<'_>>, String> {
    let content_type = r.header("content-type").unwrap_or_default();
    let not_multipart = || "request Content-Type isn't multipart/form-data".to_string();
    let (kind, params) = parse_media_type(content_type).ok_or_else(not_multipart)?;
    if kind != "multipart/form-data" {
        return Err(not_multipart());
    }
    let boundary = params.into_iter().find(|(k, _)| k == "boundary").map(|(_, v)| v).filter(|b| !b.is_empty());
    let boundary = boundary.ok_or("no multipart boundary param in Content-Type")?;
    let dash = format!("--{boundary}");
    let body = r.body.as_slice();
    let eof = || "multipart: NextPart: EOF".to_string();

    let mut at = first_delimiter(body, dash.as_bytes()).ok_or_else(eof)?;
    let line_end = find_from(body, at, b"\n").ok_or_else(eof)?;
    let nl: &[u8] = if line_end > 0 && body[line_end - 1] == b'\r' { b"\r\n" } else { b"\n" };
    let delimiter = [nl, dash.as_bytes()].concat();
    let blank = [nl, nl].concat();
    let mut parts = Vec::new();
    // `at` points at a delimiter line ("--boundary..." without its leading newline).
    loop {
        let after = at + dash.len();
        if body.get(after..after + 2) == Some(b"--") {
            return Ok(parts);
        }
        let header_start = find_from(body, after, b"\n").ok_or_else(eof)? + 1;
        let (header_end, body_start) = if body[header_start..].starts_with(nl) {
            (header_start, header_start + nl.len())
        } else {
            let end = find_from(body, header_start, &blank).ok_or("malformed MIME header")?;
            (end, end + blank.len())
        };
        let headers = String::from_utf8_lossy(&body[header_start..header_end]);
        let next = next_delimiter(body, body_start, &delimiter).ok_or_else(eof)?;
        parts.extend(form_part(&headers, &body[body_start..next]));
        at = next + nl.len();
    }
}

fn find_from(body: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    body.get(from..).and_then(|b| b.windows(needle.len()).position(|w| w == needle)).map(|p| p + from)
}

/// Preamble: the first line that starts with the delimiter.
fn first_delimiter(body: &[u8], dash: &[u8]) -> Option<usize> {
    let mut at = 0;
    loop {
        let start = find_from(body, at, dash)?;
        if start == 0 || body[start - 1] == b'\n' {
            return Some(start);
        }
        at = start + 1;
    }
}

/// The next delimiter must be followed by "--", whitespace or a newline.
fn next_delimiter(body: &[u8], from: usize, delimiter: &[u8]) -> Option<usize> {
    let mut search = from;
    loop {
        let found = find_from(body, search, delimiter)?;
        let tail = body.get(found + delimiter.len()..).unwrap_or_default();
        if tail.starts_with(b"--") || tail.first().is_some_and(|c| b" \t\r\n".contains(c)) {
            return Some(found);
        }
        search = found + 1;
    }
}

/// A named form-data part; other parts are skipped.
fn form_part<'a>(headers: &str, body: &'a [u8]) -> Option<Part<'a>> {
    let mut disposition = None;
    let mut content_type = None;
    for line in headers.lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        match k.trim().to_ascii_lowercase().as_str() {
            "content-disposition" if disposition.is_none() => disposition = parse_media_type(v.trim()),
            "content-type" if content_type.is_none() => content_type = Some(v.trim().to_string()),
            _ => {}
        }
    }
    let (_, params) = disposition.filter(|(k, _)| k == "form-data")?;
    let param = |name: &str| params.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone());
    let name = param("name").filter(|n| !n.is_empty())?;
    Some(Part { name, filename: param("filename").filter(|f| !f.is_empty()).map(|f| base_name(&f)), content_type, body })
}

/// Go `filepath.Base` on the client-supplied name (both separators, as on Windows).
fn base_name(name: &str) -> String {
    let trimmed = name.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return "/".to_string();
    }
    trimmed.rsplit(['/', '\\']).next().unwrap_or(trimmed).to_string()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{AttachmentMetadata, Attachments, Deadline, Engine};
    use std::io::{Read, Write};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct State {
        data: Vec<u8>,
        /// `None` = Go `attachmentFake.AttachmentInfo`; `Some` = `previewFake`.
        metadata: Option<AttachmentMetadata>,
        fail_export: bool,
        export_calls: usize,
        imported: bool,
    }

    #[derive(Default)]
    pub(crate) struct Fake(Mutex<State>);

    impl Fake {
        fn with(data: &[u8], metadata: Option<AttachmentMetadata>, fail_export: bool) -> Arc<Self> {
            Arc::new(Fake(Mutex::new(State { data: data.to_vec(), metadata, fail_export, ..Default::default() })))
        }
        pub(crate) fn data(&self) -> Vec<u8> {
            self.0.lock().unwrap().data.clone()
        }
        pub(crate) fn imported(&self) -> bool {
            self.0.lock().unwrap().imported
        }
        fn export_calls(&self) -> usize {
            self.0.lock().unwrap().export_calls
        }
    }

    impl Engine for Fake {
        fn call(&self, _: Deadline, _: &[u8]) -> crate::Result<Vec<u8>> {
            Err("unexpected note RPC".into())
        }
        fn attachments(&self) -> Option<&dyn Attachments> {
            Some(self)
        }
    }

    impl Attachments for Fake {
        fn import(&self, _: Deadline, name: &str, media_type: &str, input: &mut dyn Read) -> crate::Result<AttachmentMetadata> {
            let mut s = self.0.lock().unwrap();
            s.data.clear();
            input.read_to_end(&mut s.data)?;
            s.imported = true;
            Ok(AttachmentMetadata { id: "asset-id".into(), name: name.into(), media_type: media_type.into(), size: s.data.len() as u64, ..Default::default() })
        }
        fn info(&self, _: Deadline, _: &str) -> crate::Result<AttachmentMetadata> {
            let s = self.0.lock().unwrap();
            Ok(s.metadata.clone().unwrap_or(AttachmentMetadata { id: "asset-id".into(), name: "한글.txt".into(), size: s.data.len() as u64, ..Default::default() }))
        }
        fn export(&self, _: Deadline, _: &str, output: &mut dyn Write) -> crate::Result<()> {
            let mut s = self.0.lock().unwrap();
            s.export_calls += 1;
            output.write_all(&s.data)?;
            if s.fail_export {
                return Err("hash mismatch".into());
            }
            Ok(())
        }
        fn walk(&self, _: Deadline, _: &mut dyn FnMut(AttachmentMetadata) -> crate::Result<()>) -> crate::Result<()> {
            Ok(())
        }
    }

    /// What Go's `multipart.Writer` emits for `CreateFormFile` (+ optional `size` field).
    pub(crate) fn multipart(filename: &str, content: &[u8], size: Option<&str>) -> (String, Vec<u8>) {
        let boundary = "d1f0b0c4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0";
        let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
        body.extend_from_slice(content);
        if let Some(size) = size {
            body.extend_from_slice(format!("\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"size\"\r\n\r\n{size}").as_bytes());
        }
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        (format!("multipart/form-data; boundary={boundary}"), body)
    }

    fn request(method: &str, target: &str, headers: &[(&str, &str)], body: Vec<u8>) -> Request {
        let (path, query) = match target.split_once('?') {
            Some((p, q)) => (p.to_string(), Some(q.to_string())),
            None => (target.to_string(), None),
        };
        let headers = headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        Request { method: method.into(), path, query, headers, host: "127.0.0.1".into(), body }
    }

    fn handler(fake: &Arc<Fake>) -> Handler {
        Handler { engine: Some(fake.clone() as Arc<dyn Engine>), ..Default::default() }
    }

    fn header<'a>(r: &'a Response, name: &str) -> &'a str {
        r.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str()).unwrap_or("")
    }

    fn get(h: &Handler, method: &str, target: &str, headers: &[(&str, &str)]) -> Response {
        download(h, &request(method, target, headers, Vec::new()))
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    // --- attachments_test.go ---

    #[test]
    fn http_upload_download_and_range() {
        let content = b"attachment".repeat(220_000);
        let (content_type, body) = multipart("한글.txt", &content, None);
        let fake = Arc::new(Fake::default());
        let h = handler(&fake);
        let reply = upload(&h, &request("POST", "/api/attachments", &[("content-type", &content_type)], body));
        assert_eq!(reply.status, 201, "upload: {}", String::from_utf8_lossy(&reply.body));
        assert!(fake.data() == content, "upload changed bytes");
        let reply = get(&h, "GET", "/api/attachments/asset-id", &[("range", "bytes=5-14")]);
        assert_eq!(reply.status, 206);
        assert_eq!(reply.body, content[5..15]);
        assert!(header(&reply, "content-disposition").starts_with("attachment;"), "missing forced download");
        assert_eq!(header(&reply, "content-type"), "application/octet-stream", "unsafe content type");
        assert_eq!(header(&reply, "content-range"), format!("bytes 5-14/{}", content.len()));
    }

    #[test]
    fn corruption_does_not_send_partial_file() {
        let fake = Fake::with(b"corrupt-private-content", None, true);
        let reply = get(&handler(&fake), "GET", "/api/attachments/asset-id", &[]);
        assert_eq!(reply.status, 500);
        assert!(!contains(&reply.body, b"corrupt-private-content"), "corrupt export leaked content");
    }

    #[test]
    fn cross_origin_upload_rejected_before_reading() {
        let fake = Arc::new(Fake::default());
        let h = Handler { host: "127.0.0.1:47831".into(), ..handler(&fake) };
        let mut r = request("POST", "/api/attachments", &[("origin", "https://example.com")], b"untrusted".to_vec());
        r.host = "127.0.0.1:47831".into();
        // `same_origin` rejects before the gate, so the full handler is safe to call here.
        let reply = h.handle(&r);
        assert_eq!(reply.status, 403);
        assert!(!fake.imported(), "cross-origin upload was accepted");
    }

    // --- attachment_preview_test.go ---

    fn png_1x1() -> Vec<u8> {
        png_sized(1, 1)
    }

    /// A PNG whose IHDR claims `width`x`height` (with a valid CRC); DecodeConfig reads only the IHDR.
    fn png_sized(width: u32, height: u32) -> Vec<u8> {
        let mut ihdr = b"IHDR".to_vec();
        ihdr.extend_from_slice(&width.to_be_bytes());
        ihdr.extend_from_slice(&height.to_be_bytes());
        ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
        let mut out = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0d".to_vec();
        out.extend_from_slice(&ihdr);
        out.extend_from_slice(&crc32(&ihdr).to_be_bytes());
        out.extend_from_slice(b"\x00\x00\x00\x0dIDAT\x78\x9c\x63\x10\x68\x38\xf0\x1f\x00\x04\x41\x02\x10\x00\x00\x00\x00");
        out.extend_from_slice(b"\x00\x00\x00\x00IEND\xae\x42\x60\x82");
        out
    }

    fn jpeg_1x1() -> Vec<u8> {
        let mut out = b"\xff\xd8".to_vec();
        out.extend_from_slice(b"\xff\xdb\x00\x43\x00");
        out.extend_from_slice(&[1u8; 64]);
        out.extend_from_slice(b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00");
        out.extend_from_slice(b"\xff\xd9");
        out
    }

    fn gif_1x1() -> Vec<u8> {
        b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x10\x80\xc0\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;".to_vec()
    }

    // Go's generated 1x1 RGB(16,128,192) lossless WebP fixture.
    const WEBP_1X1: &[u8] = &[82, 73, 70, 70, 30, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 17, 0, 0, 0, 47, 0, 0, 0, 0, 7, 80, 192, 66, 20, 184, 255, 129, 136, 232, 127, 0, 0];

    fn preview_meta(media_type: &str, size: u64) -> Option<AttachmentMetadata> {
        Some(AttachmentMetadata { id: "preview-id".into(), name: "photo.png".into(), media_type: media_type.into(), size, ..Default::default() })
    }

    fn preview_fake(content: &[u8], media_type: &str) -> Arc<Fake> {
        Fake::with(content, preview_meta(media_type, content.len() as u64), false)
    }

    const PREVIEW: &str = "/api/attachments/preview-id?preview=1";

    #[test]
    fn fixtures_decode_as_1x1() {
        for (kind, data) in [("image/png", png_1x1()), ("image/jpeg", jpeg_1x1()), ("image/gif", gif_1x1()), ("image/webp", WEBP_1X1.to_vec())] {
            assert_eq!(sniff_image(&data), Some(kind));
            assert_eq!(image_config(&data, kind), Some((1, 1)), "{kind}");
        }
    }

    #[test]
    fn preview_png_serves_exact_bytes_inline() {
        let content = png_1x1();
        let reply = get(&handler(&preview_fake(&content, "image/png")), "GET", PREVIEW, &[]);
        assert_eq!(reply.status, 200, "{}", String::from_utf8_lossy(&reply.body));
        assert_eq!(reply.body, content);
        assert_eq!(header(&reply, "content-type"), "image/png");
        assert!(header(&reply, "content-disposition").starts_with("inline"));
        // nosniff on every response is added by `Handler::handle`.
    }

    #[test]
    fn preview_head_and_range_still_work() {
        let content = png_1x1();
        let h = handler(&preview_fake(&content, "image/png"));
        let reply = get(&h, "HEAD", PREVIEW, &[]);
        assert_eq!((reply.status, reply.body.len()), (200, 0));
        assert_eq!(header(&reply, "content-type"), "image/png");
        assert_eq!(header(&reply, "content-length"), content.len().to_string());
        let reply = get(&h, "GET", PREVIEW, &[("range", "bytes=0-7")]);
        assert_eq!(reply.status, 206);
        assert_eq!(reply.body, content[..8]);
        assert_eq!(header(&reply, "content-type"), "image/png");
    }

    #[test]
    fn preview_allows_whitelisted_image_types_only() {
        for (media_type, content) in [("image/png", png_1x1()), ("image/jpeg", jpeg_1x1()), ("image/gif", gif_1x1()), ("image/webp", WEBP_1X1.to_vec())] {
            let reply = get(&handler(&preview_fake(&content, media_type)), "GET", PREVIEW, &[]);
            assert_eq!(reply.status, 200, "{media_type}: {}", String::from_utf8_lossy(&reply.body));
            assert_eq!(reply.body, content, "{media_type}");
            assert_eq!(header(&reply, "content-type"), media_type);
        }
    }

    #[test]
    fn preview_rejects_undecodable_image_config() {
        let zeros = [0u8; 64];
        let cases: [(&str, Vec<u8>); 4] = [
            ("image/png", [b"\x89PNG\r\n\x1a\n".as_slice(), &zeros].concat()),
            ("image/jpeg", [b"\xff\xd8\xff\xe0".as_slice(), &zeros].concat()),
            ("image/gif", [b"GIF89a".as_slice(), &zeros].concat()),
            ("image/webp", b"RIFF\x08\x00\x00\x00WEBPVP8 \x00\x00\x00\x00".to_vec()),
        ];
        for (media_type, payload) in cases {
            let reply = get(&handler(&preview_fake(&payload, media_type)), "GET", PREVIEW, &[]);
            assert_eq!(reply.status, 415, "{media_type}: {}", String::from_utf8_lossy(&reply.body));
            assert!(!contains(&reply.body, &payload[..8]), "{media_type} leaked file bytes");
        }
    }

    #[test]
    fn preview_rejects_oversized_image_dimensions() {
        let side = MAX_PREVIEW_DIMENSION as u32;
        for (width, height) in [(32768, 1), (side, (MAX_PREVIEW_PIXELS / MAX_PREVIEW_DIMENSION + 1) as u32)] {
            let content = png_sized(width, height);
            let fake = preview_fake(&content, "image/png");
            let reply = get(&handler(&fake), "GET", PREVIEW, &[]);
            assert_eq!(reply.status, 413, "{width}x{height}");
            assert!(!contains(&reply.body, &content[..8]));
            assert_eq!(fake.export_calls(), 1, "dimension gate must verify the exported bytes first");
        }
    }

    #[test]
    fn preview_allows_image_at_exact_limits() {
        let content = png_sized(MAX_PREVIEW_DIMENSION as u32, (MAX_PREVIEW_PIXELS / MAX_PREVIEW_DIMENSION) as u32);
        let reply = get(&handler(&preview_fake(&content, "image/png")), "GET", PREVIEW, &[]);
        assert_eq!(reply.status, 200, "{}", String::from_utf8_lossy(&reply.body));
        assert_eq!(reply.body, content);
        assert_eq!(header(&reply, "content-type"), "image/png");
    }

    #[test]
    fn preview_oversize_metadata_rejected_before_export() {
        let fake = Fake::with(&png_1x1(), preview_meta("image/png", MAX_PREVIEW_BYTES + 1), false);
        let h = handler(&fake);
        assert_eq!(get(&h, "GET", PREVIEW, &[]).status, 413);
        assert_eq!(fake.export_calls(), 0, "oversize metadata preview must not touch storage");
        assert_eq!(get(&h, "HEAD", PREVIEW, &[]).status, 413);
        assert_eq!(fake.export_calls(), 0);
    }

    #[test]
    fn preview_oversize_rejection_covers_head_and_range() {
        let content = png_sized(32768, 1);
        let h = handler(&preview_fake(&content, "image/png"));
        assert_eq!(get(&h, "HEAD", PREVIEW, &[]).status, 413);
        let reply = get(&h, "GET", PREVIEW, &[("range", "bytes=0-7")]);
        assert_eq!(reply.status, 413);
        assert!(!contains(&reply.body, &content[..8]));
    }

    #[test]
    fn preview_rejects_unsafe_and_unknown_media_types() {
        let payload = br#"<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"/>"#;
        for media_type in ["image/svg+xml", "text/html", "application/pdf", ""] {
            let reply = get(&handler(&preview_fake(payload, media_type)), "GET", PREVIEW, &[]);
            assert_eq!(reply.status, 415, "{media_type:?}");
            assert!(!contains(&reply.body, payload));
        }
    }

    #[test]
    fn normal_download_stays_forced_octet_stream() {
        let content = png_1x1();
        let h = handler(&preview_fake(&content, "image/png"));
        for target in ["/api/attachments/preview-id", "/api/attachments/preview-id?preview=0"] {
            let reply = get(&h, "GET", target, &[]);
            assert_eq!(reply.status, 200, "{target}");
            assert_eq!(reply.body, content);
            assert_eq!(header(&reply, "content-type"), "application/octet-stream");
            assert!(header(&reply, "content-disposition").starts_with("attachment"));
        }
    }

    #[test]
    fn normal_download_ignores_preview_limits() {
        let content = png_sized(32768, 1);
        let h = handler(&preview_fake(&content, "image/png"));
        for target in ["/api/attachments/preview-id", "/api/attachments/preview-id?preview=0"] {
            let reply = get(&h, "GET", target, &[]);
            assert_eq!(reply.status, 200, "{target}");
            assert_eq!(reply.body, content);
            assert_eq!(header(&reply, "content-type"), "application/octet-stream");
            assert!(header(&reply, "content-disposition").starts_with("attachment"));
        }
    }

    #[test]
    fn preview_rejects_spoofed_media_type() {
        let html = b"<html><body><script>alert('x')</script></body></html>";
        let reply = get(&handler(&preview_fake(html, "image/png")), "GET", PREVIEW, &[]);
        assert_eq!(reply.status, 415);
        assert!(!contains(&reply.body, html));
    }

    #[test]
    fn preview_corruption_does_not_send_partial_file() {
        let content = png_1x1();
        let fake = Fake::with(&content, preview_meta("image/png", content.len() as u64), true);
        let reply = get(&handler(&fake), "GET", PREVIEW, &[]);
        assert_eq!(reply.status, 500);
        assert!(!contains(&reply.body, &content[..8]));
    }

    // --- ServeContent / helpers (no Go test file of their own) ---

    #[test]
    fn serve_content_ranges_like_go() {
        let data = b"0123456789";
        let r = |range: &str| serve_content(&request("GET", "/", &[("range", range)], Vec::new()), vec![("content-type".into(), "text/x".into())], data);
        assert_eq!(r("bytes=-3").body, b"789");
        assert_eq!(r("bytes=7-").body, b"789");
        assert_eq!(r("bytes=8-100").body, b"89");
        let miss = r("bytes=10-");
        assert_eq!((miss.status, header(&miss, "content-range")), (416, "bytes */10"));
        assert_eq!(r("items=0-1").status, 416);
        assert_eq!(r("bytes=3-1").status, 416);
        assert_eq!(r("bytes=0-9,0-9").status, 200, "ranges larger than the file are ignored");
        let multi = r("bytes=0-1,5-6");
        assert_eq!(multi.status, 206);
        assert!(header(&multi, "content-type").starts_with("multipart/byteranges; boundary="));
        let text = String::from_utf8_lossy(&multi.body);
        assert!(text.contains("Content-Range: bytes 0-1/10\r\nContent-Type: text/x\r\n\r\n01\r\n"), "{text}");
        assert!(text.contains("Content-Range: bytes 5-6/10\r\nContent-Type: text/x\r\n\r\n56\r\n"));
        let ignored = serve_content(&request("GET", "/", &[("range", "bytes=0-1"), ("if-range", "\"x\"")], Vec::new()), Vec::new(), data);
        assert_eq!((ignored.status, ignored.body.as_slice()), (200, data.as_slice()));
        let not_modified = serve_content(&request("GET", "/", &[("if-none-match", "*")], Vec::new()), Vec::new(), data);
        assert_eq!(not_modified.status, 304);
        let failed = serve_content(&request("GET", "/", &[("if-match", "\"x\"")], Vec::new()), Vec::new(), data);
        assert_eq!(failed.status, 412);
    }

    #[test]
    fn disposition_and_media_type_match_go() {
        assert_eq!(format_disposition("attachment", "a.txt"), "attachment; filename=a.txt");
        assert_eq!(format_disposition("inline", "my \"photo\".png"), "inline; filename=\"my \\\"photo\\\".png\"");
        assert_eq!(format_disposition("attachment", "한.txt"), "attachment; filename*=utf-8''%ED%95%9C.txt");
        assert_eq!(parse_media_type("Image/PNG; q=1;").map(|(t, _)| t).as_deref(), Some("image/png"));
        assert!(parse_media_type("").is_none());
        assert!(parse_media_type("image/png; a").is_none());
        assert!(parse_media_type("image/png extra").is_none());
    }

    #[test]
    fn download_rejects_path_ids_and_reports_upload_access() {
        let fake = Arc::new(Fake::default());
        let h = handler(&fake);
        for id in ["", "a%2Fb", "a%5Cb", "a%00b"] {
            assert_eq!(get(&h, "GET", &format!("{PATH_PREFIX}{id}"), &[]).status, 400, "{id}");
        }
        assert_eq!(get(&Handler::default(), "GET", "/api/attachments/x", &[]).status, 501);
        let access = Handler { upload: Some(UploadAccess { url: "http://127.0.0.1:1".into(), token: "t".into() }), ..Default::default() };
        assert_eq!(upload_access(&access).body, b"{\"token\":\"t\",\"url\":\"http://127.0.0.1:1\"}\n");
    }

    #[test]
    fn upload_checks_size_field_and_file_part() {
        let fake = Arc::new(Fake::default());
        let h = handler(&fake);
        let (content_type, body) = multipart("dir/a.bin", b"abc", Some("3"));
        let reply = upload(&h, &request("POST", "/api/attachments", &[("content-type", &content_type)], body.clone()));
        assert_eq!(reply.status, 201);
        assert!(String::from_utf8_lossy(&reply.body).contains("\"name\":\"a.bin\""));
        let reply = upload(&h, &request("POST", "/api/attachments?size=4", &[("content-type", &content_type)], body));
        assert_eq!(reply.status, 400, "query size wins, as Go FormValue");
        assert_eq!(upload(&h, &request("POST", "/api/attachments", &[("content-type", "text/plain")], Vec::new())).status, 400);
    }
}
