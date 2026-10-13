//! Version checks belong to the shared decode boundary, including direct ack.
use rusqlite::{params, Connection};
use serde_json::json;
use sync_core::{
    ChangePayload, Entity, EntityKind, Key, SyncConfig, SyncEngine, SyncError, PAYLOAD_VERSION,
};

fn payload(version: u32, kind: EntityKind) -> ChangePayload {
    ChangePayload {
        version,
        entity: Entity::new(
            kind,
            "existing-kind",
            json!({"title":"original 😀","version":99}),
        ),
        device_id: "future-device".into(),
        counter: 1,
        ts: 1,
        vclock: [("future-device".into(), 1)].into(),
    }
}

#[test]
fn each_existing_kind_checks_the_envelope_version_and_keeps_older_compatibility() {
    for kind in [
        EntityKind::Note,
        EntityKind::Notebook,
        EntityKind::Setting,
        EntityKind::NamedVersion,
    ] {
        for version in [0, PAYLOAD_VERSION] {
            let original = payload(version, kind);
            assert_eq!(
                ChangePayload::decode(&original.encode().unwrap()).unwrap(),
                original
            );
        }
        for version in [PAYLOAD_VERSION + 1, u32::MAX] {
            assert!(
                matches!(ChangePayload::decode(&payload(version, kind).encode().unwrap()),
                Err(SyncError::UnsupportedPayloadVersion {version: actual, supported})
                    if actual == version && supported == PAYLOAD_VERSION)
            );
        }
    }
    // A malformed record is still a protocol error, and unknown entity kinds
    // retain the existing error used by the runtime's pending-kind policy.
    assert!(matches!(
        ChangePayload::decode(b"{broken"),
        Err(SyncError::Protocol(_))
    ));
    let mut unknown = serde_json::to_value(payload(PAYLOAD_VERSION, EntityKind::Note)).unwrap();
    unknown["entity"]["kind"] = json!("futurekind");
    assert!(
        matches!(ChangePayload::decode(&serde_json::to_vec(&unknown).unwrap()),
        Err(SyncError::Protocol(message)) if message.starts_with("unknown variant"))
    );
}

#[test]
fn future_record_cannot_be_acknowledged_directly_and_keeps_its_pending_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let config = SyncConfig::new(
        &path,
        "http://127.0.0.1:9",
        "fixture-token",
        Key::generate(),
    );
    let engine = SyncEngine::open(config).unwrap();
    let db = Connection::open(&path).unwrap();
    let bytes = payload(PAYLOAD_VERSION + 1, EntityKind::Note)
        .encode()
        .unwrap();
    db.execute("INSERT INTO incoming(event_id,seq,state,created_at,payload) VALUES('future',1,'pending',0,?1)", params![bytes]).unwrap();
    assert!(matches!(
        engine.resolve_pending("future"),
        Err(SyncError::UnsupportedPayloadVersion { .. })
    ));
    assert!(matches!(
        engine.ack_applied(&["future".into()]),
        Err(SyncError::UnsupportedPayloadVersion { .. })
    ));
    assert_eq!(engine.ack_cursor().unwrap(), 0);
    assert!(!engine
        .has_snapshot(EntityKind::Note, "existing-kind")
        .unwrap());
    assert_eq!(
        db.query_row(
            "SELECT state,payload FROM incoming WHERE event_id='future'",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
        )
        .unwrap(),
        ("pending".into(), bytes)
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM applied_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
