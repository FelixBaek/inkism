//! End-to-end sync scenarios against the in-process relay double.
//!
//! Every test drives real `SyncEngine` instances with real encryption, real
//! SQLite state databases, and a relay that follows the v1 contract. Nothing
//! about the engine is stubbed.

mod common;

use std::path::Path;

use common::TestRelay;
use sync_core::{
    decode_blob, encode_blob, Entity, EntityKind, Key, SyncConfig, SyncEngine, SyncError,
};

const TOKEN: &str = "test-relay-token-abcdefghijklmnopqrstuvwxyz";

fn engine_at(dir: &Path, name: &str, url: &str, key: &Key, device: &str) -> SyncEngine {
    let config = SyncConfig::new(dir.join(format!("{name}.db")), url, TOKEN, key.clone())
        .with_device_id(device);
    SyncEngine::open(config).expect("open engine")
}

fn note(id: &str, value: &str) -> Entity {
    Entity::new(EntityKind::Note, id, serde_json::json!({ "v": value }))
}

#[test]
fn ciphertext_is_opaque_and_tamper_is_rejected_without_cursor_advance() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();

    let writer = engine_at(dir.path(), "writer", &relay.url(), &key, "device-writer");
    writer
        .stage_local(note("n1", "top-secret-value"), 1)
        .unwrap();
    writer.push().unwrap();

    // The relay sees only base64 ciphertext; the plaintext never appears.
    let stored = relay.records();
    assert_eq!(stored.len(), 1);
    let raw = decode_blob(&stored[0].blob).unwrap();
    assert!(
        !raw.windows(b"top-secret-value".len())
            .any(|w| w == b"top-secret-value"),
        "plaintext leaked to relay"
    );

    // Flip one ciphertext byte and confirm it is rejected, cursor untouched.
    let mut tampered = raw.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 0x01;
    relay.tamper_blob(stored[0].seq, &encode_blob(&tampered));

    let reader = engine_at(dir.path(), "reader", &relay.url(), &key, "device-reader");
    let err = reader.pull().unwrap_err();
    assert!(matches!(err, SyncError::Crypto(_)), "got {err:?}");
    assert_eq!(reader.pull_cursor().unwrap(), 0);
    assert!(reader.pending_incoming().unwrap().is_empty());
}

#[test]
fn wrong_key_never_advances_cursor_and_correct_key_recovers() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let right = Key::generate();
    let wrong = Key::generate();

    let writer = engine_at(dir.path(), "writer", &relay.url(), &right, "device-writer");
    writer.stage_local(note("n1", "value"), 1).unwrap();
    writer.push().unwrap();

    let state_path = dir.path().join("reader.db");
    let reader = SyncEngine::open(
        SyncConfig::new(state_path.clone(), relay.url(), TOKEN, wrong.clone())
            .with_device_id("device-reader"),
    )
    .unwrap();
    assert!(matches!(reader.pull(), Err(SyncError::Crypto(_))));
    assert_eq!(reader.pull_cursor().unwrap(), 0);
    drop(reader);

    // Reopen the same state DB with the correct key: nothing was lost.
    let reader = SyncEngine::open(
        SyncConfig::new(state_path, relay.url(), TOKEN, right).with_device_id("device-reader"),
    )
    .unwrap();
    let outcome = reader.pull().unwrap();
    assert_eq!(outcome.stored, 1);
    assert_eq!(reader.pull_cursor().unwrap(), 1);
}

#[test]
fn outbox_is_durable_across_restart() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let state_path = dir.path().join("device.db");

    {
        let engine = SyncEngine::open(
            SyncConfig::new(state_path.clone(), relay.url(), TOKEN, key.clone())
                .with_device_id("device-a"),
        )
        .unwrap();
        engine.stage_local(note("n1", "offline-edit"), 1).unwrap();
        assert_eq!(engine.pending_outbox_count().unwrap(), 1);
    } // engine dropped before any push

    let engine = SyncEngine::open(
        SyncConfig::new(state_path, relay.url(), TOKEN, key).with_device_id("device-a"),
    )
    .unwrap();
    assert_eq!(engine.pending_outbox_count().unwrap(), 1);
    assert_eq!(engine.journal_checkpoint().unwrap(), 1);
    assert_eq!(engine.push().unwrap().sent, 1);
    assert_eq!(relay.records().len(), 1);
}

#[test]
fn push_is_retry_idempotent() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let engine = engine_at(dir.path(), "device", &relay.url(), &key, "device-a");

    engine.stage_local(note("n1", "value"), 1).unwrap();
    assert_eq!(engine.push().unwrap().sent, 1);
    // A second push (as after a lost response) sends nothing and adds nothing.
    let second = engine.push().unwrap();
    assert_eq!(second.sent, 0);
    assert_eq!(second.remaining, 0);
    assert_eq!(relay.records().len(), 1);
}

#[test]
fn remote_echo_is_not_reenqueued() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let engine = engine_at(dir.path(), "device", &relay.url(), &key, "device-a");

    engine.stage_local(note("n1", "value"), 1).unwrap();
    let outcome = engine.sync_once().unwrap();
    assert_eq!(outcome.pushed, 1);
    // Our own record came back; it is skipped and not treated as incoming.
    assert!(
        outcome.incoming.is_empty(),
        "own change surfaced as incoming"
    );
    assert_eq!(engine.pending_outbox_count().unwrap(), 0);
    assert!(engine.pull_cursor().unwrap() >= 1);

    let pull = engine.pull().unwrap();
    assert_eq!(pull.stored, 0);
}

#[test]
fn pull_is_incremental_and_advances_cursor() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let writer = engine_at(dir.path(), "writer", &relay.url(), &key, "device-writer");
    let reader = engine_at(dir.path(), "reader", &relay.url(), &key, "device-reader");

    for (revision, id) in [(1u64, "n1"), (2, "n2"), (3, "n3")] {
        writer.stage_local(note(id, "value"), revision).unwrap();
    }
    writer
        .stage_local(
            Entity::new(
                EntityKind::Notebook,
                "nb1",
                serde_json::json!({ "name": "box" }),
            ),
            4,
        )
        .unwrap();
    writer.push().unwrap();

    let first = reader.pull().unwrap();
    assert_eq!(first.stored, 4);
    assert_eq!(reader.pull_cursor().unwrap(), 4);

    // Nothing new: no records fetched, no full-vault scan.
    let second = reader.pull().unwrap();
    assert_eq!(second.fetched, 0);
    assert_eq!(second.stored, 0);

    // One more remote change is picked up alone.
    writer.stage_local(note("n5", "later"), 5).unwrap();
    writer.push().unwrap();
    let third = reader.pull().unwrap();
    assert_eq!(third.stored, 1);
    assert_eq!(reader.pull_cursor().unwrap(), 5);
}

#[test]
fn ack_is_required_and_idempotent() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let writer = engine_at(dir.path(), "writer", &relay.url(), &key, "device-writer");
    let reader = engine_at(dir.path(), "reader", &relay.url(), &key, "device-reader");

    writer.stage_local(note("n1", "value"), 1).unwrap();
    writer.push().unwrap();

    reader.pull().unwrap();
    let pending = reader.pending_incoming().unwrap();
    assert_eq!(pending.len(), 1);
    assert!(!pending[0].stale);

    let ids = vec![pending[0].event_id.clone()];
    assert_eq!(reader.ack_applied(&ids).unwrap(), 1);
    assert_eq!(reader.ack_cursor().unwrap(), 1);
    // Re-ack and unknown ids are no-ops.
    assert_eq!(reader.ack_applied(&ids).unwrap(), 0);
    assert_eq!(
        reader.ack_applied(&["does-not-exist".to_string()]).unwrap(),
        0
    );
    assert!(reader.pending_incoming().unwrap().is_empty());
}

#[test]
fn two_devices_offline_edit_conflict_preserves_both_sides() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let a = engine_at(dir.path(), "a", &relay.url(), &key, "device-a");
    let b = engine_at(dir.path(), "b", &relay.url(), &key, "device-b");

    // Both edit the same note while offline.
    a.stage_local(note("shared", "from-a"), 1).unwrap();
    b.stage_local(note("shared", "from-b"), 1).unwrap();
    a.push().unwrap();
    b.push().unwrap();

    // A learns about B's concurrent edit.
    let from_a = a.sync_once().unwrap();
    assert_eq!(from_a.conflicts, 1, "A should flag a conflict");
    let a_inc = from_a
        .incoming
        .iter()
        .find(|i| i.conflict.is_some())
        .unwrap();
    let a_conflict = a_inc.conflict.clone().unwrap();

    // B learns about A's concurrent edit.
    let from_b = b.sync_once().unwrap();
    assert_eq!(from_b.conflicts, 1, "B should flag a conflict");
    let b_inc = from_b
        .incoming
        .iter()
        .find(|i| i.conflict.is_some())
        .unwrap();
    let b_conflict = b_inc.conflict.clone().unwrap();

    // Deterministic winner and identical conflict-copy id on both devices.
    assert_eq!(a_conflict.winner.data, b_conflict.winner.data);
    assert_eq!(a_conflict.copy_id, b_conflict.copy_id);
    assert_eq!(a_conflict.loser.data, b_conflict.loser.data);
    assert_eq!(a_conflict.copy.id, a_conflict.copy_id);
    assert_eq!(a_conflict.copy.data, a_conflict.loser.data);

    // No data loss: the two original versions both survive somewhere.
    let canonical = a_conflict.winner.data["v"].as_str().unwrap().to_string();
    let preserved = a_conflict.copy.data["v"].as_str().unwrap().to_string();
    let mut pair = [canonical, preserved];
    pair.sort();
    assert_eq!(pair, ["from-a".to_string(), "from-b".to_string()]);

    // Host applies then acks, and the conflict does not repeat.
    let a_ids = from_a
        .incoming
        .iter()
        .map(|i| i.event_id.clone())
        .collect::<Vec<_>>();
    let b_ids = from_b
        .incoming
        .iter()
        .map(|i| i.event_id.clone())
        .collect::<Vec<_>>();
    a.ack_applied(&a_ids).unwrap();
    b.ack_applied(&b_ids).unwrap();

    assert_eq!(a.sync_once().unwrap().conflicts, 0);
    assert_eq!(b.sync_once().unwrap().conflicts, 0);
    assert!(a.pending_incoming().unwrap().is_empty());
    assert!(b.pending_incoming().unwrap().is_empty());
}

#[test]
fn delivered_incoming_queue_survives_restart_before_ack() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let writer = engine_at(dir.path(), "writer", &relay.url(), &key, "device-writer");
    let reader_state = dir.path().join("reader.db");

    writer.stage_local(note("n1", "value"), 1).unwrap();
    writer.push().unwrap();

    {
        let reader = SyncEngine::open(
            SyncConfig::new(reader_state.clone(), relay.url(), TOKEN, key.clone())
                .with_device_id("device-reader"),
        )
        .unwrap();
        assert_eq!(reader.pull().unwrap().stored, 1);
        // Crash here: pulled but not yet applied/acked by the host.
    }

    let reader = SyncEngine::open(
        SyncConfig::new(reader_state, relay.url(), TOKEN, key).with_device_id("device-reader"),
    )
    .unwrap();
    let pending = reader.pending_incoming().unwrap();
    assert_eq!(pending.len(), 1, "incoming queue must be durable");
    let ids = vec![pending[0].event_id.clone()];
    assert_eq!(reader.ack_applied(&ids).unwrap(), 1);
    assert!(reader.pending_incoming().unwrap().is_empty());
}

#[test]
fn observe_local_uses_journal_checkpoint_and_is_idempotent() {
    let relay = TestRelay::start(TOKEN);
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let engine = engine_at(dir.path(), "device", &relay.url(), &key, "device-a");

    // Host journal rows 1..=2 arrive above the checkpoint (0).
    let staged = engine
        .observe_local(|checkpoint| {
            assert_eq!(checkpoint, 0);
            Ok(vec![(1, note("n1", "a")), (2, note("n2", "b"))])
        })
        .unwrap();
    assert_eq!(staged, 2);
    assert_eq!(engine.journal_checkpoint().unwrap(), 2);
    assert_eq!(engine.pending_outbox_count().unwrap(), 2);

    // Re-staging the same revision is a no-op (idempotence key).
    let again = engine.stage_local(note("n1", "a"), 1).unwrap();
    assert!(!again.newly_staged);
    assert_eq!(engine.pending_outbox_count().unwrap(), 2);

    // The next observation starts after the checkpoint and finds nothing.
    let staged = engine
        .observe_local(|checkpoint| {
            assert_eq!(checkpoint, 2);
            Ok(Vec::new())
        })
        .unwrap();
    assert_eq!(staged, 0);
}

#[test]
fn sync_once_reports_offline_push_without_losing_pending_work() {
    // Point at a port with no listener: the push leg must fail gracefully.
    let dir = tempfile::tempdir().unwrap();
    let key = Key::generate();
    let engine = SyncEngine::open(
        SyncConfig::new(
            dir.path().join("device.db"),
            "http://127.0.0.1:9",
            TOKEN,
            key,
        )
        .with_device_id("device-a"),
    )
    .unwrap();
    engine.stage_local(note("n1", "value"), 1).unwrap();

    let outcome = engine.sync_once().unwrap();
    assert_eq!(outcome.pushed, 0);
    assert!(outcome.push_error.is_some());
    assert_eq!(engine.pending_outbox_count().unwrap(), 1);
}

#[test]
fn relay_accepts_fragmented_request_after_idle_connection() {
    use std::io::{Read, Write};
    let relay = TestRelay::start(TOKEN);
    let mut stream =
        std::net::TcpStream::connect(relay.url().strip_prefix("http://").unwrap()).unwrap();
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    // Exercise a peer that connects before it sends any data, then splits
    // the header and body across separate writes, as real TCP can do.
    std::thread::sleep(std::time::Duration::from_millis(100));
    stream
        .write_all(b"POST /v1/changes HTTP/1.1\r\nHost: localhost\r\n")
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    let body = r#"{"id":"fragmented","blob":"opaque"}"#;
    write!(
        stream,
        "Authorization: Bearer {TOKEN}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    stream.write_all(body.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert_eq!(relay.records()[0].id, "fragmented");
}
