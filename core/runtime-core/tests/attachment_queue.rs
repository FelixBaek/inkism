mod common;
use common::{Relay, TOKEN};
use sync_core::attachment::{AttachmentTransport, ChunkContext, ATTACHMENT_CHUNK_BYTES};
use sync_core::attachment_queue::AttachmentQueue;
use sync_core::Key;

#[test]
fn durable_queue_replays_lost_ack_and_keeps_partial_manifests_private() {
    let relay = Relay::start().expect("real Go relay");
    let transport = AttachmentTransport::new(&relay.url, TOKEN).unwrap();
    let key = Key::generate();
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("outbox.db");
    let id = uuid::Uuid::new_v4().to_string();
    let mut context = ChunkContext {
        attachment_id: id.clone(),
        index: 1,
        total_size: ATTACHMENT_CHUNK_BYTES as u64 + 17,
    };
    let mut queue = AttachmentQueue::open(&path, key.clone(), &relay.url).unwrap();
    let last = queue.stage(&context, &[8; 17]).unwrap();
    assert_eq!(queue.pending_count().unwrap(), 1);
    assert!(queue.uploaded_ids(&id).unwrap().is_none());
    // Relay accepted a PUT, then process died before local acknowledgement.
    transport.upload(&last).unwrap();
    drop(queue);
    let mut queue = AttachmentQueue::open(&path, key.clone(), &relay.url).unwrap();
    let same = queue.stage(&context, &[8; 17]).unwrap();
    assert_eq!(same.id, last.id);
    assert_eq!(same.ciphertext, last.ciphertext);
    assert!(queue.upload_next(&transport).unwrap());
    assert_eq!(queue.pending_count().unwrap(), 0);
    assert!(
        queue.uploaded_ids(&id).unwrap().is_none(),
        "missing first chunk"
    );
    context.index = 0;
    let first = queue
        .stage(&context, &vec![3; ATTACHMENT_CHUNK_BYTES])
        .unwrap();
    let offline = AttachmentTransport::new("http://127.0.0.1:1", TOKEN).unwrap();
    assert!(queue.upload_next(&offline).is_err());
    assert_eq!(queue.pending_count().unwrap(), 1);
    drop(queue);
    let mut queue = AttachmentQueue::open(&path, key.clone(), &relay.url).unwrap();
    assert!(queue.upload_next(&transport).unwrap());
    assert!(!queue.upload_next(&transport).unwrap());
    assert_eq!(
        queue.uploaded_ids(&id).unwrap().unwrap(),
        vec![first.id, last.id]
    );
    assert!(queue
        .stage(&context, &vec![4; ATTACHMENT_CHUNK_BYTES])
        .is_err());
    context.total_size += 1;
    assert!(queue
        .stage(&context, &vec![3; ATTACHMENT_CHUNK_BYTES])
        .is_err());
    let empty = uuid::Uuid::new_v4().to_string();
    queue.register_empty(&empty).unwrap();
    assert_eq!(
        queue.uploaded_ids(&empty).unwrap().unwrap(),
        Vec::<String>::new()
    );
    assert!(queue.register_empty(&id).is_err());
    drop(queue);
    assert!(AttachmentQueue::open(&path, Key::generate(), &relay.url).is_err());
    assert!(AttachmentQueue::open(&path, key.clone(), "https://other.example").is_err());
    assert_eq!(
        AttachmentQueue::open(&path, key, &relay.url)
            .unwrap()
            .pending_count()
            .unwrap(),
        0
    );
}

#[test]
fn concurrent_staging_preserves_one_random_ciphertext() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("queue.db");
    let key = Key::generate();
    let url = "https://example.com";
    drop(AttachmentQueue::open(&path, key.clone(), url).unwrap());
    let context = ChunkContext {
        attachment_id: uuid::Uuid::new_v4().to_string(),
        index: 0,
        total_size: 1,
    };
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let (path, key, context) = (path.clone(), key.clone(), context.clone());
            std::thread::spawn(move || {
                AttachmentQueue::open(&path, key, url)
                    .unwrap()
                    .stage(&context, b"x")
                    .unwrap()
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    for result in &results[1..] {
        assert_eq!(result.id, results[0].id);
        assert_eq!(result.ciphertext, results[0].ciphertext);
    }
}

#[test]
fn corrupt_staged_bytes_are_not_uploaded_or_acknowledged() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("corrupt.db");
    let key = Key::generate();
    let url = "http://127.0.0.1:1";
    let context = ChunkContext {
        attachment_id: uuid::Uuid::new_v4().to_string(),
        index: 0,
        total_size: 1,
    };
    let mut queue = AttachmentQueue::open(&path, key.clone(), url).unwrap();
    queue.stage(&context, b"x").unwrap();
    drop(queue);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute("UPDATE chunks SET ciphertext=zeroblob(1000000)", [])
        .unwrap();
    drop(db);
    let mut queue = AttachmentQueue::open(&path, key, url).unwrap();
    let transport = AttachmentTransport::new(url, TOKEN).unwrap();
    assert!(matches!(
        queue.upload_next(&transport),
        Err(sync_core::SyncError::Protocol(_))
    ));
    assert_eq!(queue.pending_count().unwrap(), 1);
    assert!(queue
        .uploaded_ids(&context.attachment_id)
        .unwrap()
        .is_none());
    assert!(queue.stage(&context, b"x").is_err());
}

#[test]
fn two_attachment_stores_keep_original_ids_through_encrypted_queue_and_relay() {
    use inkism_engine::attachments::AttachmentStore;
    use std::io::{Seek, Write};
    let relay = Relay::start().expect("real Go relay");
    let transport = AttachmentTransport::new(&relay.url, TOKEN).unwrap();
    let key = Key::generate();
    let tmp = tempfile::tempdir().unwrap();
    let source: Vec<u8> = (0..ATTACHMENT_CHUNK_BYTES * 2 + 19)
        .map(|i| (i % 251) as u8)
        .collect();
    let mut origin = AttachmentStore::open(&tmp.path().join("source.db")).unwrap();
    let metadata = origin
        .import_reader(
            "한글 원본.bin",
            "application/octet-stream",
            source.as_slice(),
        )
        .unwrap();
    origin.copy_to(&metadata.id, &mut std::io::sink()).unwrap();
    let queue_path = tmp.path().join("queue.db");
    let mut queue = AttachmentQueue::open(&queue_path, key.clone(), &relay.url).unwrap();
    for index in 0..3 {
        let context = ChunkContext {
            attachment_id: metadata.id.clone(),
            index,
            total_size: metadata.size,
        };
        queue
            .stage(
                &context,
                &origin.read_chunk(&metadata.id, index as usize).unwrap(),
            )
            .unwrap();
    }
    // Upload one chunk, close the process-owned queue and resume the rest.
    assert!(queue.upload_next(&transport).unwrap());
    drop(queue);
    let mut queue = AttachmentQueue::open(&queue_path, key.clone(), &relay.url).unwrap();
    while queue.upload_next(&transport).unwrap() {}
    let ids = queue.uploaded_ids(&metadata.id).unwrap().unwrap();
    // Stage receiver bytes before beginning the storage write transaction.
    let mut staged = tempfile::tempfile().unwrap();
    for (index, id) in ids.iter().enumerate() {
        let context = ChunkContext {
            attachment_id: metadata.id.clone(),
            index: index as u32,
            total_size: metadata.size,
        };
        let bytes = transport
            .download(id)
            .unwrap()
            .unwrap()
            .decrypt(&key, &context)
            .unwrap();
        staged.write_all(&bytes).unwrap();
    }
    staged.rewind().unwrap();
    let destination = tmp.path().join("receiver.db");
    let mut receiver = AttachmentStore::open(&destination).unwrap();
    assert_eq!(
        receiver.import_verified(&metadata, staged).unwrap(),
        metadata
    );
    drop(receiver);
    let receiver = AttachmentStore::open(&destination).unwrap();
    assert_eq!(receiver.metadata(&metadata.id).unwrap(), metadata);
    let mut restored = Vec::new();
    receiver.copy_to(&metadata.id, &mut restored).unwrap();
    assert_eq!(restored, source);
}
