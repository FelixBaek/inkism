//! Ports of the former Go implementation's backup bundle and restore tests.

use super::*;
use std::sync::{Arc, Mutex};

const LARGE_ID: &str = "11111111-2222-4333-8444-555555555555";
const EMPTY_ID: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RESTORE_OLD_ID: &str = "11111111-1111-4111-8111-111111111111";

fn digest_of(data: &[u8]) -> String {
    hex(Sha256::digest(data))
}

fn meta_for(data: &[u8], id: &str) -> AttachmentMetadata {
    AttachmentMetadata {
        id: id.into(),
        name: format!("{id}.bin"),
        media_type: "application/octet-stream".into(),
        size: data.len() as u64,
        sha256: digest_of(data),
    }
}

fn handler(engine: impl Engine + 'static) -> Handler {
    Handler {
        engine: Some(Arc::new(engine)),
        ..Default::default()
    }
}

fn request(method: &str, path: &str, headers: Vec<(String, String)>, body: Vec<u8>) -> Request {
    Request {
        method: method.into(),
        path: path.into(),
        query: None,
        headers,
        host: "127.0.0.1".into(),
        body,
    }
}

// ---------------------------------------------------------------- bundle fake

#[derive(Default)]
struct BundleFake {
    notes: Vec<u8>,
    metas: Vec<AttachmentMetadata>,
    blobs: HashMap<String, Vec<u8>>,
    fail_export: String,
    engine_fail: bool,
    no_store: bool,
    exported: Mutex<Vec<String>>,
    export_path: Mutex<String>,
}

impl Engine for BundleFake {
    fn call(&self, _: Deadline, request: &[u8]) -> Result<Vec<u8>> {
        let req: Value = serde_json::from_slice(request)?;
        if req["op"] != "export" {
            return Ok(br#"{"ok":false,"error":"unexpected op"}"#.to_vec());
        }
        let path = req["path"].as_str().unwrap_or_default().to_string();
        *self.export_path.lock().unwrap() = path.clone();
        if self.engine_fail {
            return Ok(br#"{"ok":false,"error":"engine export failed"}"#.to_vec());
        }
        std::fs::write(path, &self.notes)?;
        Ok(br#"{"ok":true,"data":{"notes":1}}"#.to_vec())
    }
    fn attachments(&self) -> Option<&dyn Attachments> {
        if self.no_store {
            None
        } else {
            Some(self)
        }
    }
}

impl Attachments for BundleFake {
    fn import(
        &self,
        _: Deadline,
        _: &str,
        _: &str,
        _: &mut dyn Read,
    ) -> Result<AttachmentMetadata> {
        Err("unexpected import".into())
    }
    fn info(&self, _: Deadline, _: &str) -> Result<AttachmentMetadata> {
        Err("unexpected info".into())
    }
    fn export(&self, _: Deadline, id: &str, output: &mut dyn Write) -> Result<()> {
        self.exported.lock().unwrap().push(id.into());
        if id == self.fail_export {
            return Err("export interrupted".into());
        }
        output.write_all(self.blobs.get(id).map(Vec::as_slice).unwrap_or_default())?;
        Ok(())
    }
    fn walk(
        &self,
        _: Deadline,
        visit: &mut dyn FnMut(AttachmentMetadata) -> Result<()>,
    ) -> Result<()> {
        for meta in &self.metas {
            visit(meta.clone())?;
        }
        Ok(())
    }
}

// Small fixture assertions inspect ZIP bytes; production adapters stream the spool.
fn materialize(mut response: Response) -> Response {
    if let Some(mut file) = response.file.take() {
        file.as_file_mut().read_to_end(&mut response.body).unwrap();
    }
    response
}

fn run_bundle(fake: BundleFake) -> (Response, Arc<BundleFake>) {
    let fake = Arc::new(fake);
    let h = Handler {
        engine: Some(fake.clone()),
        ..Default::default()
    };
    (
        materialize(export_bundle(&h, &request("GET", "/api/backup", vec![], vec![]))),
        fake,
    )
}

fn header<'a>(r: &'a Response, name: &str) -> &'a str {
    r.headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
        .unwrap_or("")
}

fn body(r: &Response) -> String {
    String::from_utf8_lossy(&r.body).into_owned()
}

fn assert_no_zip(r: &Response) {
    let text = body(r);
    assert!(
        text.contains(r#""ok":false"#) && !text.contains("PK\x03\x04"),
        "partial zip leaked to client: {} {text:?}",
        r.status
    );
}

fn entries(data: &[u8]) -> ZipArchive<Cursor<&[u8]>> {
    ZipArchive::new(Cursor::new(data)).unwrap()
}

fn read_entry(archive: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> (Vec<u8>, CompressionMethod) {
    let mut file = archive
        .by_name(name)
        .unwrap_or_else(|_| panic!("missing entry {name}"));
    let mut data = Vec::new();
    file.read_to_end(&mut data).unwrap();
    (data, file.compression())
}

#[test]
fn bundle_export_builds_verified_zip() {
    let large = b"INKISM-attachment-".repeat(20000);
    let fake = BundleFake {
        notes: br#"{"version":1,"notes":[{"id":"n1"}]}"#.to_vec(),
        metas: vec![meta_for(&large, LARGE_ID), meta_for(b"", EMPTY_ID)],
        blobs: HashMap::from([(LARGE_ID.into(), large.clone()), (EMPTY_ID.into(), vec![])]),
        ..Default::default()
    };
    let (reply, fake) = run_bundle(fake);
    assert_eq!(reply.status, 200, "{}", body(&reply));
    let export_path = fake.export_path.lock().unwrap().clone();
    assert!(
        Path::new(&export_path).starts_with(std::env::temp_dir()),
        "export path not a trusted temp file: {export_path:?}"
    );
    assert!(!Path::new(&export_path).exists(), "temp export left behind");
    assert_eq!(header(&reply, "content-type"), "application/zip");
    assert!(
        header(&reply, "content-disposition").starts_with("attachment;"),
        "missing forced download"
    );
    let mut archive = entries(&reply.body);
    assert_eq!(archive.len(), 4);
    for (id, want) in [(LARGE_ID, &large[..]), (EMPTY_ID, &b""[..])] {
        let (got, method) = read_entry(&mut archive, &format!("attachments/{id}"));
        assert_eq!(
            method,
            CompressionMethod::Stored,
            "{id} not stored uncompressed"
        );
        assert_eq!(got, want, "entry {id} bytes mismatch");
    }
    let (lines, method) = read_entry(&mut archive, "attachments.ndjson");
    assert_eq!(method, CompressionMethod::Deflated);
    let lines = String::from_utf8(lines).unwrap();
    for (i, line) in lines.trim_end_matches('\n').split('\n').enumerate() {
        let meta: AttachmentMetadata = serde_json::from_str(line).unwrap();
        assert_eq!(meta, fake.metas[i], "manifest line {i} mismatch");
    }
}

#[test]
fn bundle_export_empty_library_is_valid() {
    let (reply, _) = run_bundle(BundleFake {
        notes: br#"{"version":1,"notes":[]}"#.to_vec(),
        ..Default::default()
    });
    assert_eq!(reply.status, 200, "{}", body(&reply));
    let mut archive = entries(&reply.body);
    assert_eq!(archive.len(), 2);
    let mut manifest = archive.by_index(1).unwrap();
    let mut empty = Vec::new();
    manifest.read_to_end(&mut empty).unwrap();
    assert!(empty.is_empty(), "manifest not empty: {}", empty.len());
}

#[test]
fn bundle_export_without_attachment_store() {
    let (reply, _) = run_bundle(BundleFake {
        no_store: true,
        ..Default::default()
    });
    assert_eq!(reply.status, 501);
    let reply = export_bundle(
        &Handler::default(),
        &request("GET", "/api/backup", vec![], vec![]),
    );
    assert_eq!(reply.status, 501);
}

#[test]
fn bundle_export_engine_failure_sends_nothing() {
    let (reply, _) = run_bundle(BundleFake {
        engine_fail: true,
        ..Default::default()
    });
    assert!(
        reply.status == 400 && body(&reply).contains("engine export failed"),
        "engine failure not passed through: {} {}",
        reply.status,
        body(&reply)
    );
    assert_no_zip(&reply);
}

#[test]
fn bundle_export_corrupt_hash_sends_nothing() {
    let data = b"private-attachment-bytes";
    let mut meta = meta_for(data, LARGE_ID);
    meta.sha256 = digest_of(b"different");
    let (reply, _) = run_bundle(BundleFake {
        notes: b"{}".to_vec(),
        blobs: HashMap::from([(meta.id.clone(), data.to_vec())]),
        metas: vec![meta],
        ..Default::default()
    });
    assert_eq!(reply.status, 500);
    assert_no_zip(&reply);
    assert!(
        !body(&reply).contains("private-attachment-bytes"),
        "attachment bytes leaked"
    );
}

#[test]
fn bundle_export_size_mismatch_sends_nothing() {
    let data = b"three";
    let mut meta = meta_for(data, "22222222-2222-4333-8444-555555555555");
    meta.size += 1;
    let (reply, _) = run_bundle(BundleFake {
        notes: b"{}".to_vec(),
        blobs: HashMap::from([(meta.id.clone(), data.to_vec())]),
        metas: vec![meta],
        ..Default::default()
    });
    assert_eq!(reply.status, 500);
    assert_no_zip(&reply);
}

#[test]
fn bundle_export_mid_failure_sends_nothing() {
    let (first, second, third) = (
        "33333333-2222-4333-8444-555555555555",
        "44444444-2222-4333-8444-555555555555",
        "45444444-2222-4333-8444-555555555555",
    );
    let fake = BundleFake {
        notes: b"{}".to_vec(),
        metas: vec![
            meta_for(b"first-bytes", first),
            meta_for(b"second-bytes", second),
            meta_for(b"third-bytes", third),
        ],
        blobs: HashMap::from([
            (first.into(), b"first-bytes".to_vec()),
            (second.into(), b"second-bytes".to_vec()),
            (third.into(), b"third-bytes".to_vec()),
        ]),
        fail_export: second.into(),
        ..Default::default()
    };
    let (reply, fake) = run_bundle(fake);
    assert_eq!(reply.status, 500);
    assert_eq!(
        *fake.exported.lock().unwrap(),
        vec![first.to_string(), second.to_string()],
        "walk did not stop at failure"
    );
    assert_no_zip(&reply);
}

#[test]
fn bundle_export_rejects_unsafe_metadata() {
    let data = b"payload";
    type Mutate = fn(&mut AttachmentMetadata);
    let cases: Vec<(&str, Mutate)> = vec![
        ("traversal id", |m| m.id = "../engine.db".into()),
        ("malformed id", |m| {
            m.id = "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz".into()
        }),
        ("duplicate id", |_| {}),
        ("oversize", |m| m.size = MAX_ATTACHMENT_BYTES + 1),
        ("malformed hash", |m| m.sha256 = "deadbeef".into()),
        ("long metadata", |m| m.name = "길".repeat(2000)),
    ];
    for (name, mutate) in cases {
        let id = "55555555-2222-4333-8444-555555555555";
        let first = meta_for(data, id);
        let mut second = meta_for(data, id);
        mutate(&mut second);
        let metas = if name == "duplicate id" {
            vec![first, second]
        } else {
            vec![second]
        };
        let (reply, _) = run_bundle(BundleFake {
            notes: b"{}".to_vec(),
            metas,
            blobs: HashMap::from([(id.into(), data.to_vec())]),
            ..Default::default()
        });
        assert_eq!(reply.status, 500, "{name}: {}", body(&reply));
        assert_no_zip(&reply);
    }
}

// ---------------------------------------------------------------- restore fake

/// Records engine ops and imports; each import gets a fresh UUID.
#[derive(Default)]
struct RestoreFake {
    calls: Mutex<Vec<String>>,
    notes: Mutex<Vec<u8>>,
    imported: Mutex<Vec<(AttachmentMetadata, Vec<u8>)>>,
}

impl Engine for RestoreFake {
    fn call(&self, _: Deadline, request: &[u8]) -> Result<Vec<u8>> {
        let args: Value = serde_json::from_slice(request)?;
        let op = args["op"].as_str().unwrap_or_default();
        self.calls.lock().unwrap().push(op.into());
        let data = std::fs::read(args["path"].as_str().unwrap_or_default())?;
        if op == "import" {
            *self.notes.lock().unwrap() = data;
        }
        Ok(br#"{"ok":true,"data":{"imported":1}}"#.to_vec())
    }
    fn attachments(&self) -> Option<&dyn Attachments> {
        Some(self)
    }
}

impl Attachments for RestoreFake {
    fn import(
        &self,
        _: Deadline,
        name: &str,
        media_type: &str,
        input: &mut dyn Read,
    ) -> Result<AttachmentMetadata> {
        let mut data = Vec::new();
        input.read_to_end(&mut data)?;
        let mut imported = self.imported.lock().unwrap();
        let meta = AttachmentMetadata {
            id: format!("{:08x}-2222-4222-8222-222222222222", imported.len() + 1),
            name: name.into(),
            media_type: media_type.into(),
            size: data.len() as u64,
            sha256: digest_of(&data),
        };
        imported.push((meta.clone(), data));
        Ok(meta)
    }
    fn info(&self, _: Deadline, _: &str) -> Result<AttachmentMetadata> {
        Err("unexpected info".into())
    }
    fn export(&self, _: Deadline, _: &str, _: &mut dyn Write) -> Result<()> {
        Err("unexpected export".into())
    }
    fn walk(&self, _: Deadline, _: &mut dyn FnMut(AttachmentMetadata) -> Result<()>) -> Result<()> {
        Err("unexpected walk".into())
    }
}

fn restore_fixture(broken: bool, missing: bool) -> Vec<u8> {
    let payload = b"exact attachment bytes";
    let mut metadata = AttachmentMetadata {
        id: RESTORE_OLD_ID.into(),
        name: "한글.bin".into(),
        media_type: "application/octet-stream".into(),
        size: payload.len() as u64,
        sha256: digest_of(payload),
    };
    if broken {
        metadata.sha256 = "0".repeat(64);
    }
    let notes = format!(
        r#"{{"version":1,"notes":[{{"id":"note-a","title":"with file","content":"<p><a href=\"/api/attachments/{RESTORE_OLD_ID}\">파일</a></p>","text":"file"}}],"notebooks":[]}}"#
    );
    let mut manifest = serde_json::to_vec(&metadata).unwrap();
    manifest.push(b'\n');
    let mut list = vec![
        ("notes.json".to_string(), notes.into_bytes()),
        ("attachments.ndjson".into(), manifest),
    ];
    if !missing {
        list.push((format!("attachments/{RESTORE_OLD_ID}"), payload.to_vec()));
    }
    let mut z = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in list {
        z.start_file(name, SimpleFileOptions::default()).unwrap();
        z.write_all(&data).unwrap();
    }
    z.finish().unwrap().into_inner()
}

fn multipart(data: &[u8]) -> (Vec<(String, String)>, Vec<u8>) {
    let boundary = "xcompat0boundary7MA4YWxkTrZu0gW";
    let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"backup.zip\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (
        vec![(
            "content-type".into(),
            format!("multipart/form-data; boundary={boundary}"),
        )],
        body,
    )
}

fn restore_request(data: &[u8], fake: &Arc<RestoreFake>) -> Response {
    let (headers, body) = multipart(data);
    let h = Handler {
        engine: Some(fake.clone()),
        ..Default::default()
    };
    restore_bundle(&h, &request("POST", "/api/restore", headers, body))
}

#[test]
fn bundle_restore_remaps_files_before_importing_notes() {
    let fake = Arc::new(RestoreFake::default());
    let reply = restore_request(&restore_fixture(false, false), &fake);
    assert_eq!(reply.status, 200, "{}", body(&reply));
    let notes = String::from_utf8(fake.notes.lock().unwrap().clone()).unwrap();
    let imported = fake.imported.lock().unwrap();
    assert_eq!(imported.len(), 1);
    assert!(
        !notes.contains(RESTORE_OLD_ID) && notes.contains(&imported[0].0.id),
        "references not remapped: {notes}"
    );
    assert_eq!(*fake.calls.lock().unwrap(), ["validate_import", "import"]);
}

#[test]
fn bundle_restore_rejects_corrupt_or_missing_files_before_writes() {
    for (bad, missing) in [(true, false), (false, true)] {
        let fake = Arc::new(RestoreFake::default());
        let reply = restore_request(&restore_fixture(bad, missing), &fake);
        assert!(
            reply.status == 400
                && fake.imported.lock().unwrap().is_empty()
                && fake.calls.lock().unwrap().is_empty(),
            "partial restore: {} {}",
            reply.status,
            body(&reply)
        );
    }
}

#[test]
fn bundle_restore_without_attachment_store() {
    let fake = BundleFake {
        no_store: true,
        ..Default::default()
    };
    let (headers, body) = multipart(&restore_fixture(false, false));
    let reply = restore_bundle(
        &handler(fake),
        &request("POST", "/api/restore", headers, body),
    );
    assert_eq!(reply.status, 501);
}

// ---------------------------------------------------------------- rich round trip

const PHOTO_ID: &str = "0a0b0c0d-1111-4222-8333-444455556666";
const BLANK_ID: &str = "1a0b0c0d-1111-4222-8333-444455556666";
const LOCKED_ID: &str = "2a0b0c0d-1111-4222-8333-444455556666";
const GONE_ID: &str = "99999999-9999-4999-8999-999999999999";

/// Notes, attachments and their metadata covering every remap path.
fn rich_fixture() -> (String, Vec<(AttachmentMetadata, Vec<u8>)>) {
    let photo: Vec<u8> = (0..70_000u32).map(|i| (i * 7 % 251) as u8).collect();
    let locked = b"locked note attachment".to_vec();
    let named = |data: &[u8], id: &str, name: &str, kind: &str| AttachmentMetadata {
        name: name.into(),
        media_type: kind.into(),
        ..meta_for(data, id)
    };
    let attachments = vec![
        (
            named(&photo, PHOTO_ID, "사진 & <원본>.png", "image/png"),
            photo,
        ),
        (named(b"", BLANK_ID, "빈 파일.txt", "text/plain"), vec![]),
        (
            named(&locked, LOCKED_ID, "locked.bin", "application/octet-stream"),
            locked,
        ),
    ];
    let notes = json!({
        "version": 1,
        "notes": [
            {"id": "n1", "title": "파일", "content": format!("<p><a href=\"/api/attachments/{PHOTO_ID}\">사진</a><img src=\"/api/attachments/{BLANK_ID}\"></p>"), "text": format!("see /api/attachments/{PHOTO_ID}"), "updated_at": 1760000000123u64},
            {"id": "n2", "locked_body": {"ciphertext": "c2VjcmV0", "attachments": [{"id": LOCKED_ID, "ref": "r1"}]}},
        ],
        "notebooks": [
            {"id": "nb1", "cover": {"kind": "attachment", "url": format!("/api/attachments/{PHOTO_ID}")}},
            {"id": "nb2", "cover": {"kind": "attachment", "url": format!("/api/attachments/{GONE_ID}")}},
            {"id": "nb3", "cover": {"kind": "color", "url": "#fff"}},
        ],
    });
    (notes.to_string(), attachments)
}

/// Asserts a rich-fixture restore: exact bytes imported, every link remapped.
fn assert_rich_restore(calls: &[String], notes: &[u8], imported: &[(AttachmentMetadata, Vec<u8>)]) {
    let (_, attachments) = rich_fixture();
    assert_eq!(calls, ["validate_import", "import"]);
    assert_eq!(imported.len(), attachments.len());
    let mut ids = HashMap::new();
    for ((old, want), (new, got)) in attachments.iter().zip(imported) {
        assert_eq!(
            (&new.name, &new.media_type, got),
            (&old.name, &old.media_type, want),
            "imported bytes differ"
        );
        ids.insert(old.id.as_str(), new.id.clone());
    }
    let notes: Value = serde_json::from_slice(notes).unwrap();
    let text = notes.to_string();
    for old in [PHOTO_ID, BLANK_ID, LOCKED_ID, GONE_ID] {
        assert!(!text.contains(old), "old id {old} survived: {text}");
    }
    let n = &notes["notes"];
    assert_eq!(
        n[0]["content"],
        format!(
            "<p><a href=\"/api/attachments/{}\">사진</a><img src=\"/api/attachments/{}\"></p>",
            ids[PHOTO_ID], ids[BLANK_ID]
        )
    );
    assert_eq!(
        n[0]["text"],
        format!("see /api/attachments/{}", ids[PHOTO_ID])
    );
    assert_eq!(n[0]["updated_at"], 1760000000123u64);
    assert_eq!(
        n[1]["locked_body"],
        json!({"ciphertext": "c2VjcmV0", "attachments": [{"id": ids[LOCKED_ID], "ref": "r1"}]})
    );
    let books = &notes["notebooks"];
    assert_eq!(
        books[0]["cover"],
        json!({"kind": "attachment", "url": format!("/api/attachments/{}", ids[PHOTO_ID])})
    );
    assert!(books[1].get("cover").is_none(), "dangling cover kept");
    assert_eq!(books[2]["cover"], json!({"kind": "color", "url": "#fff"}));
}

fn rich_bundle_fake() -> BundleFake {
    let (notes, attachments) = rich_fixture();
    BundleFake {
        notes: notes.into_bytes(),
        metas: attachments.iter().map(|(m, _)| m.clone()).collect(),
        blobs: attachments.into_iter().map(|(m, d)| (m.id, d)).collect(),
        ..Default::default()
    }
}

fn rust_restore(bundle: &[u8]) -> Arc<RestoreFake> {
    let fake = Arc::new(RestoreFake::default());
    let reply = restore_request(bundle, &fake);
    assert_eq!(reply.status, 200, "{}", body(&reply));
    fake
}

#[test]
fn bundle_round_trip_remaps_covers_and_locked_notes() {
    let (reply, _) = run_bundle(rich_bundle_fake());
    assert_eq!(reply.status, 200, "{}", body(&reply));
    let fake = rust_restore(&reply.body);
    assert_rich_restore(
        &fake.calls.lock().unwrap(),
        &fake.notes.lock().unwrap(),
        &fake.imported.lock().unwrap(),
    );
}

#[test]
fn bundle_restore_rejects_dangling_and_unknown_entries() {
    let build = |extra: &str, content: &str| {
        let notes = json!({"version": 1, "notes": [{"id": "n", "content": content}]}).to_string();
        let mut z = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in [
            ("notes.json", notes.as_str()),
            ("attachments.ndjson", ""),
            (extra, "x"),
        ] {
            if !name.is_empty() {
                z.start_file(name, SimpleFileOptions::default()).unwrap();
                z.write_all(data.as_bytes()).unwrap();
            }
        }
        z.finish().unwrap().into_inner()
    };
    for (extra, content) in [
        ("", "<a href=\"/api/attachments/x\">x</a>"),
        ("../evil", ""),
        (&format!("attachments/{GONE_ID}"), ""),
    ] {
        let fake = Arc::new(RestoreFake::default());
        let reply = restore_request(&build(extra, content), &fake);
        assert_eq!(reply.status, 400, "{extra:?}: {}", body(&reply));
        assert!(fake.calls.lock().unwrap().is_empty());
    }
    assert_eq!(
        rust_restore(&build("", "no links"))
            .calls
            .lock()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn manifest_lines_match_go_encoding() {
    let meta = AttachmentMetadata {
        id: PHOTO_ID.into(),
        name: "a&b<c>.png".into(),
        media_type: "image/png".into(),
        size: 3,
        sha256: "ab".repeat(32),
    };
    let line = String::from_utf8(go_json(&meta).unwrap()).unwrap();
    assert_eq!(
        line,
        format!(
            r#"{{"id":"{PHOTO_ID}","name":"a\u0026b\u003cc\u003e.png","media_type":"image/png","size":3,"sha256":"{}"}}"#,
            "ab".repeat(32)
        )
    );
}

#[test]
fn named_versions_check_and_remap_attachment_references() {
    let old="11111111-1111-4111-8111-111111111111";
    let new="22222222-2222-4222-8222-222222222222";
    let value=serde_json::json!({"content":"current without attachment","named_versions":[{"label":"kept","content":format!("<img src=\"/api/attachments/{old}\">"),"text":""}]});
    let mut row:Row=serde_json::from_value(value).unwrap();
    assert!(check_note_references(&[row.clone()],&HashSet::new()).is_err());
    check_note_references(&[row.clone()],&HashSet::from([old.to_string()])).unwrap();
    remap_note_assets(&mut row,&HashMap::from([(old.to_string(),new.to_string())])).unwrap();
    let versions=named_version_rows(&row).unwrap();
    assert_eq!(string_field(&versions[0],"content").unwrap().unwrap(),format!("<img src=\"/api/attachments/{new}\">"));
}

#[test]
fn encrypted_named_versions_remap_aliases_without_touching_ciphertext(){
 let old="11111111-1111-4111-8111-111111111111";let new="22222222-2222-4222-8222-222222222222";
 let mut row:Row=serde_json::from_value(serde_json::json!({"encrypted_named_versions":[{"label":"kept","locked_body":{"key_id":"k","ciphertext":"unchanged sealed body","attachments":[{"id":old,"ref":old}]}}]})).unwrap();
 assert!(check_note_references(&[row.clone()],&HashSet::new()).is_err());
 remap_note_assets(&mut row,&HashMap::from([(old.to_string(),new.to_string())])).unwrap();
 let versions=version_rows(&row,"encrypted_named_versions").unwrap();let body=locked_body(&versions[0]).unwrap().unwrap();assert_eq!(body["ciphertext"],"unchanged sealed body");assert_eq!(body["attachments"][0]["id"],new);assert_eq!(body["attachments"][0]["ref"],old);
}
