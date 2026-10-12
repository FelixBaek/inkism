mod common;
use common::{Relay, TOKEN};
use inkism_engine::attachments::AttachmentStore;
use inkism_runtime::AppCore;
use serde_json::{json, Value};
use std::path::Path;
use sync_core::Key;

fn call(app: &AppCore, request: Value) -> Value {
    let r = app.execute(request);
    assert_eq!(r["ok"], true, "{r}");
    r["data"].clone()
}
fn sync(app: &AppCore) {
    call(app, json!({"op":"sync_now"}));
    assert!(app.wait_sync_idle(30000));
    let status = call(app, json!({"op":"sync_status"}));
    assert!(status["error"].is_null(), "{status}");
}
fn config(app: &AppCore, url: &str, key: &str) {
    call(
        app,
        json!({"op":"sync_config","server_url":url,"token":TOKEN,"key":key}),
    );
}
fn attachment_db(path: &Path) -> std::path::PathBuf {
    std::path::PathBuf::from(format!("{}.attachments", path.display()))
}

#[test]
fn automatic_worker_transfers_files_before_notes_and_preserves_links_after_restart() {
    let relay = Relay::start().expect("real Go relay");
    let dir = tempfile::tempdir().unwrap();
    let ap = dir.path().join("a.db");
    let bp = dir.path().join("b.db");
    let a = AppCore::open(ap.to_str().unwrap()).unwrap();
    let b = AppCore::open(bp.to_str().unwrap()).unwrap();
    let source: Vec<u8> = (0..600019).map(|i| (i % 251) as u8).collect();
    let mut assets = AttachmentStore::open(&attachment_db(&ap)).unwrap();
    let file = assets
        .import_reader(
            "한글 파일.bin",
            "application/octet-stream",
            source.as_slice(),
        )
        .unwrap();
    let empty = assets
        .import_reader("빈 파일.bin", "application/octet-stream", &b""[..])
        .unwrap();
    drop(assets);
    let html=format!("<p><a href=\"/api/attachments/{}\">파일</a> <a href=\"/api/attachments/{}\">빈 파일</a></p>",file.id,empty.id);
    let note = call(
        &a,
        json!({"op":"save","note":{"title":"첨부 동기화","content":html,"text":"파일 빈 파일"}}),
    );
    let key = Key::generate().to_base64();
    config(&a, &relay.url, &key);
    sync(&a);
    config(&b, &relay.url, &key);
    sync(&b);
    let received = call(&b, json!({"op":"get","id":note["id"]}));
    assert_eq!(received["content"], html);
    let received_store = AttachmentStore::open(&attachment_db(&bp)).unwrap();
    assert_eq!(received_store.metadata(&file.id).unwrap(), file);
    assert_eq!(received_store.metadata(&empty.id).unwrap(), empty);
    let mut bytes = Vec::new();
    received_store.copy_to(&file.id, &mut bytes).unwrap();
    assert_eq!(bytes, source);
    drop(received_store);
    drop(b);
    let b = AppCore::open(bp.to_str().unwrap()).unwrap();
    // Editing a received note reuses the received manifest when syncing back.
    let mut edited = call(&b, json!({"op":"get","id":note["id"]}));
    edited["title"] = json!("다른 PC에서 수정");
    call(&b, json!({"op":"save","note":edited}));
    sync(&b);
    sync(&a);
    let result = call(&a, json!({"op":"get","id":note["id"]}));
    assert_eq!(result["title"], "다른 PC에서 수정");
    assert_eq!(result["content"], html);
    assert_eq!(
        call(&a, json!({"op":"list","view":"all"}))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn missing_local_attachment_does_not_publish_broken_remote_note() {
    let relay = Relay::start().expect("real Go relay");
    let dir = tempfile::tempdir().unwrap();
    let a = AppCore::open(dir.path().join("a.db").to_str().unwrap()).unwrap();
    let b = AppCore::open(dir.path().join("b.db").to_str().unwrap()).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    call(
        &a,
        json!({"op":"save","note":{"title":"누락파일","content":format!("<a href=\"/api/attachments/{id}\">파일</a>"),"text":"파일"}}),
    );
    let key = Key::generate().to_base64();
    config(&a, &relay.url, &key);
    call(&a, json!({"op":"sync_now"}));
    assert!(a.wait_sync_idle(30000));
    assert!(call(&a, json!({"op":"sync_status"}))["error"].is_string());
    config(&b, &relay.url, &key);
    sync(&b);
    assert_eq!(
        call(&b, json!({"op":"list","view":"all"}))["items"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        call(&a, json!({"op":"list","view":"all"}))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn incomplete_incoming_file_waits_across_restart_then_applies_after_last_chunk_arrives() {
    use sync_core::attachment::{
        AttachmentTransport, ChunkContext, SealedChunk, ATTACHMENT_CHUNK_BYTES,
    };
    use sync_core::{Entity, EntityKind, SyncConfig, SyncEngine};
    let relay = Relay::start().expect("real Go relay");
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let ap = dir.path().join("a.db");
    let bp = dir.path().join("b.db");
    let mut assets = AttachmentStore::open(&attachment_db(&ap)).unwrap();
    let bytes = vec![7; ATTACHMENT_CHUNK_BYTES + 17];
    let metadata = assets
        .import_reader("partial.bin", "application/octet-stream", bytes.as_slice())
        .unwrap();
    let chunks: Vec<_> = bytes
        .chunks(ATTACHMENT_CHUNK_BYTES)
        .enumerate()
        .map(|(index, data)| {
            SealedChunk::encrypt(
                &key,
                &ChunkContext {
                    attachment_id: metadata.id.clone(),
                    index: index as u32,
                    total_size: metadata.size,
                },
                data,
            )
            .unwrap()
        })
        .collect();
    let transport = AttachmentTransport::new(&relay.url, TOKEN).unwrap();
    transport.upload(&chunks[0]).unwrap();
    let writer = SyncEngine::open(SyncConfig::new(
        dir.path().join("writer.sync"),
        &relay.url,
        TOKEN,
        key.clone(),
    ))
    .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let html = format!(
        "<p><a href=\"/api/attachments/{}\">파일</a></p>",
        metadata.id
    );
    let entity = Entity::new(
        EntityKind::Note,
        &id,
        json!({"id":id,"title":"부분 수신","content":html,"text":"파일",
        "attachments":[{"version":1,"metadata":metadata,"chunks":chunks.iter().map(|c|c.id.clone()).collect::<Vec<_>>()}]}),
    );
    writer.stage_local(entity.clone(), 1).unwrap();
    writer.push().unwrap();
    let following_id = uuid::Uuid::new_v4().to_string();
    writer.stage_local(Entity::new(EntityKind::Note, &following_id,
        json!({"title":"누락 첨부 뒤의 정상 노트","content":"<p>수신 가능</p>","text":"수신 가능"})), 2).unwrap();
    writer.push().unwrap();
    let b = AppCore::open(bp.to_str().unwrap()).unwrap();
    config(&b, &relay.url, &key.to_base64());
    call(&b, json!({"op":"sync_now"}));
    assert!(b.wait_sync_idle(30000));
    assert!(call(&b, json!({"op":"sync_status"}))["error"].is_string());
    assert_eq!(
        call(&b, json!({"op":"list","view":"all"}))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        call(&b, json!({"op":"get","id":following_id}))["text"],
        "수신 가능"
    );
    let receiver = AttachmentStore::open(&attachment_db(&bp)).unwrap();
    assert!(receiver.metadata(&metadata.id).is_err());
    drop(receiver);
    let inbox = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("b.db.attachment-inbox-")
        })
        .unwrap();
    assert!(
        inbox.join(&chunks[0].id).exists(),
        "received encrypted chunks must survive retry"
    );
    drop(b);
    let b = AppCore::open(bp.to_str().unwrap()).unwrap();
    call(&b, json!({"op":"sync_now"}));
    assert!(b.wait_sync_idle(30000));
    assert!(call(&b, json!({"op":"sync_status"}))["error"].is_string());
    assert_eq!(
        call(&b, json!({"op":"get","id":following_id}))["text"],
        "수신 가능"
    );
    assert_eq!(b.execute(json!({"op":"get","id":id}))["ok"], false);
    assert!(inbox.join(&chunks[0].id).exists());
    transport.upload(&chunks[1]).unwrap();
    sync(&b);
    assert_eq!(call(&b, json!({"op":"get","id":id}))["content"], html);
    let receiver = AttachmentStore::open(&attachment_db(&bp)).unwrap();
    let mut restored = Vec::new();
    receiver.copy_to(&metadata.id, &mut restored).unwrap();
    assert_eq!(restored, bytes);
    for chunk in &chunks {
        assert!(
            !inbox.join(&chunk.id).exists(),
            "verified imports must discard their encrypted staging chunks"
        );
    }
    // Already imported attachments need no network download. Replayed note
    // events should also remove leftovers from a crash just after import.
    for chunk in &chunks {
        std::fs::write(inbox.join(&chunk.id), &chunk.ciphertext).unwrap();
    }
    let mut changed = entity;
    changed.data["title"] = json!("재전달 검사");
    writer.stage_local(changed, 3).unwrap();
    writer.push().unwrap();
    sync(&b);
    assert_eq!(
        call(&b, json!({"op":"get","id":id}))["title"],
        "재전달 검사"
    );
    for chunk in &chunks {
        assert!(
            !inbox.join(&chunk.id).exists(),
            "existing verified attachments must also clear crash leftovers"
        );
    }
    let mut again = Vec::new();
    receiver.copy_to(&metadata.id, &mut again).unwrap();
    assert_eq!(again, bytes);
}

#[test]
fn concurrent_notes_keep_both_attachments_in_conflict_copies() {
    let relay = Relay::start().expect("real Go relay");
    let dir = tempfile::tempdir().unwrap();
    let ap = dir.path().join("a.db");
    let bp = dir.path().join("b.db");
    let a = AppCore::open(ap.to_str().unwrap()).unwrap();
    let b = AppCore::open(bp.to_str().unwrap()).unwrap();
    let key = Key::generate().to_base64();
    config(&a, &relay.url, &key);
    config(&b, &relay.url, &key);
    let base = call(
        &a,
        json!({"op":"save","note":{"title":"공통 노트","content":"<p>시작</p>","text":"시작"}}),
    );
    sync(&a);
    sync(&b);
    let mut expected = Vec::new();
    for (app, path, text) in [(&a, &ap, "A 파일"), (&b, &bp, "B 파일")] {
        let mut assets = AttachmentStore::open(&attachment_db(path)).unwrap();
        let m = assets
            .import_reader("첨부.txt", "text/plain", text.as_bytes())
            .unwrap();
        call(
            app,
            json!({"op":"save","note":{"id":base["id"],"title":text,
            "content":format!("<p><a href=\"/api/attachments/{}\">{text}</a></p>",m.id),"text":text}}),
        );
        expected.push((m, text.as_bytes().to_vec()));
    }
    sync(&a);
    sync(&b);
    sync(&a);
    sync(&b);
    for (app, path) in [(&a, &ap), (&b, &bp)] {
        let list = call(app, json!({"op":"list","view":"all"}));
        let notes = list["items"].as_array().unwrap();
        assert_eq!(notes.len(), 2, "{list}");
        let contents: Vec<_> = notes
            .iter()
            .map(|n| {
                call(app, json!({"op":"get","id":n["id"]}))["content"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        let assets = AttachmentStore::open(&attachment_db(path)).unwrap();
        for (metadata, bytes) in &expected {
            assert!(contents.iter().any(|html| html.contains(&metadata.id)));
            let mut got = Vec::new();
            assets.copy_to(&metadata.id, &mut got).unwrap();
            assert_eq!(&got, bytes);
        }
    }
}
