//! Real Rust encryption -> authenticated Go relay -> independent receiving client.
mod common;
use common::{Relay, TOKEN};
use sync_core::attachment::{
    AttachmentTransport, ChunkContext, SealedChunk, ATTACHMENT_CHUNK_BYTES,
};
use sync_core::Key;

#[test]
fn encrypted_chunks_cross_real_relay_with_safe_retries() {
    let relay = Relay::start().expect("real Go relay must build and start");
    let sender = AttachmentTransport::new(&relay.url, TOKEN).unwrap();
    let receiver = AttachmentTransport::new(&relay.url, TOKEN).unwrap();
    let key = Key::generate();
    let source: Vec<u8> = (0..ATTACHMENT_CHUNK_BYTES * 2 + 17)
        .map(|i| (i % 251) as u8)
        .collect();
    let attachment_id = uuid::Uuid::new_v4().to_string();
    let mut reconstructed = Vec::new();
    for (index, bytes) in source.chunks(ATTACHMENT_CHUNK_BYTES).enumerate() {
        let context = ChunkContext {
            attachment_id: attachment_id.clone(),
            index: index as u32,
            total_size: source.len() as u64,
        };
        let sealed = SealedChunk::encrypt(&key, &context, bytes).unwrap();
        assert!(receiver.download(&sealed.id).unwrap().is_none());
        // Emulate a persisted outbox and a lost HTTP acknowledgement.
        let staged = serde_json::to_vec(&sealed).unwrap();
        sender.upload(&sealed).unwrap();
        let resumed: SealedChunk = serde_json::from_slice(&staged).unwrap();
        sender.upload(&resumed).unwrap();
        let received = receiver.download(&sealed.id).unwrap().unwrap();
        assert_eq!(received.ciphertext, sealed.ciphertext);
        assert_ne!(received.ciphertext.as_slice(), bytes);
        reconstructed.extend(received.decrypt(&key, &context).unwrap());

        let mut changed = sealed.clone();
        changed.ciphertext[30] ^= 1;
        assert!(
            sender.upload(&changed).is_err(),
            "same ID cannot overwrite bytes"
        );
        assert_eq!(
            receiver.download(&sealed.id).unwrap().unwrap().ciphertext,
            sealed.ciphertext
        );
        let denied = AttachmentTransport::new(&relay.url, "invalid-token").unwrap();
        assert!(denied.upload(&sealed).is_err());
        assert!(denied.download(&sealed.id).is_err());
    }
    assert_eq!(reconstructed, source);
}

#[test]
fn malformed_blob_ids_never_become_request_paths() {
    let client = AttachmentTransport::new("http://127.0.0.1:1", TOKEN).unwrap();
    for id in [
        "../changes",
        "/v1/changes",
        "abc",
        "12345678123442348234123456789abc",
    ] {
        assert!(matches!(
            client.download(id),
            Err(sync_core::SyncError::Protocol(_))
        ));
    }
}
