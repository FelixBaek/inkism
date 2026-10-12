#![cfg(feature = "encrypted-storage")]
mod common;
use common::TestRelay;
use sync_core::attachment::ChunkContext;
use sync_core::attachment_queue::AttachmentQueue;
use sync_core::{Entity, EntityKind, Key, StorageKey, SyncConfig, SyncEngine};
const TOKEN: &str = "encrypted-storage-test-token";
fn no_plaintext(dir: &std::path::Path, marker: &[u8]) {
    for file in std::fs::read_dir(dir).unwrap() {
        let raw = std::fs::read(file.unwrap().path()).unwrap();
        assert!(!raw.windows(marker.len()).any(|v| v == marker));
    }
}
#[test]
fn different_local_keys_share_a_vault_and_keep_incoming_state_across_restart() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let vault = Key::generate();
    let ka = StorageKey::from_bytes([1; 32]);
    let kb = StorageKey::from_bytes([2; 32]);
    let pa = dir.path().join("a.db");
    let pb = dir.path().join("b.db");
    let ca = || SyncConfig::new(&pa, relay.url(), TOKEN, vault.clone());
    let cb = || SyncConfig::new(&pb, relay.url(), TOKEN, vault.clone());
    let a = SyncEngine::open_encrypted(ca(), &ka).unwrap();
    let device = a.device_id().to_owned();
    let entity = Entity::new(
        EntityKind::Note,
        "private-entity-id",
        serde_json::json!({"text":"private-sync-marker"}),
    );
    let stage = a.stage_local(entity.clone(), 1).unwrap();
    assert!(!stage.event_id.is_empty());
    assert_eq!(a.pending_outbox_count().unwrap(), 1);
    drop(a);
    assert!(SyncEngine::open(ca()).is_err());
    assert!(SyncEngine::open_encrypted(ca(), &kb).is_err());
    let a = SyncEngine::open_encrypted(ca(), &ka).unwrap();
    assert_eq!(a.device_id(), device);
    assert_eq!(a.journal_checkpoint().unwrap(), 1);
    a.push().unwrap();
    let b = SyncEngine::open_encrypted(cb(), &kb).unwrap();
    b.pull().unwrap();
    let incoming = b.pending_incoming().unwrap();
    assert_eq!(incoming.len(), 1);
    assert_eq!(incoming[0].entity, entity);
    let event = incoming[0].event_id.clone();
    let cursor = b.pull_cursor().unwrap();
    no_plaintext(dir.path(), b"private-sync-marker");
    no_plaintext(dir.path(), b"private-entity-id");
    drop(b);
    let b = SyncEngine::open_encrypted(cb(), &kb).unwrap();
    assert_eq!(b.pull_cursor().unwrap(), cursor);
    assert_eq!(b.pending_incoming().unwrap()[0].entity, entity);
    b.ack_applied(&[event]).unwrap();
    assert_eq!(b.pending_incoming_count().unwrap(), 0);
}
#[test]
fn encrypted_attachment_queue_replays_identical_ciphertext_after_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("queue.db");
    let vault = Key::generate();
    let local = StorageKey::from_bytes([3; 32]);
    let relay = "https://sync.example.test";
    let context = ChunkContext {
        attachment_id: "00000000-0000-4000-8000-000000000001".into(),
        index: 0,
        total_size: 19,
    };
    let body = b"private-file-marker";
    let mut queue = AttachmentQueue::open_encrypted(&path, vault.clone(), relay, &local).unwrap();
    let first = queue.stage(&context, body).unwrap();
    assert_eq!(queue.pending_count().unwrap(), 1);
    no_plaintext(dir.path(), context.attachment_id.as_bytes());
    no_plaintext(dir.path(), body);
    drop(queue);
    assert!(AttachmentQueue::open(&path, vault.clone(), relay).is_err());
    assert!(AttachmentQueue::open_encrypted(
        &path,
        vault.clone(),
        relay,
        &StorageKey::from_bytes([4; 32])
    )
    .is_err());
    let mut queue = AttachmentQueue::open_encrypted(&path, vault.clone(), relay, &local).unwrap();
    let second = queue.stage(&context, body).unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(first.ciphertext, second.ciphertext);
    assert_eq!(second.decrypt(&vault, &context).unwrap(), body);
    drop(queue);
    assert!(AttachmentQueue::open_encrypted(&path, Key::generate(), relay, &local).is_err());
    assert!(
        AttachmentQueue::open_encrypted(&path, vault, "https://other.example.test", &local)
            .is_err()
    );
}
