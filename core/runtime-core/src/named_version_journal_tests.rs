//! Host contract for named-version sync ("namedversion" entities): explicit
//! named snapshots journal and apply idempotently; automatic history and
//! restore receipts never become snapshots.
use serde_json::{json, Value};
use sync_core::{Conflict, Entity, EntityKind, Incoming};
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn open(dir: &tempfile::TempDir, name: &str) -> inkism_engine::Engine {
    let e = inkism_engine::Engine::open(dir.path().join(name).to_str().unwrap()).unwrap();
    crate::host::ensure_schema(e.connection()).unwrap();
    e
}
fn journal(e: &inkism_engine::Engine) -> Vec<(String, String)> {
    crate::host::journal_batch(e.connection(), 0, 1000).unwrap().into_iter().map(|r| (r.kind, r.id)).collect()
}
fn incoming(event: &str, entity: Entity) -> Incoming {
    Incoming { event_id: event.into(), seq: 1, entity, conflict: None, stale: false }
}
fn sealed(label: &str, at: i64) -> Value {
    json!({"label":label,"title":"t","content_format":"html","created_at":at,"plain_bytes":4,
        "locked_body":{"key_id":inkism_engine::ids::new_id(),"ciphertext":format!("CIPHERTEXT-{label}"),"attachments":[]}})
}

#[test]
fn named_versions_journal_by_id_and_restore_creates_no_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let e = open(&dir, "notes.db");
    let n = ok(e.execute(json!({"op":"save","note":{"title":"local","content":"checkpoint"}})));
    e.connection().execute("DELETE FROM sync_journal", []).unwrap();
    let h = ok(e.execute(json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"Local checkpoint"})));
    let hid = h["id"].as_str().unwrap().to_string();
    assert_eq!(journal(&e), vec![("namedversion".to_string(), hid.clone())]);
    e.connection().execute("DELETE FROM sync_journal", []).unwrap();
    ok(e.execute(json!({"op":"history_rename","id":n["id"],"revision":n["revision"],"history_id":hid,"expected_label":"Local checkpoint","label":"Renamed"})));
    assert_eq!(journal(&e), vec![("namedversion".to_string(), hid.clone())]);
    let built = crate::host::build_raw_entity(e.connection(), "namedversion", &hid).unwrap();
    assert_eq!(built.kind, EntityKind::NamedVersion);
    assert_eq!(built.data["label"], "Renamed");
    assert_eq!(built.data["content"], "checkpoint");
    assert!(built.data["scope_note"]["tags"].is_array());
    e.connection().execute("DELETE FROM sync_journal", []).unwrap();
    ok(e.execute(json!({"op":"restore","id":n["id"],"revision":n["revision"],"history_id":hid})));
    let after = journal(&e);
    assert!(after.iter().any(|(k, _)| k == "note"), "{after:?}");
    assert!(after.iter().all(|(k, _)| k != "namedversion"), "restore must not create or touch a snapshot: {after:?}");
    e.connection().execute("DELETE FROM sync_journal", []).unwrap();
    ok(e.execute(json!({"op":"history_delete_named","id":n["id"],"revision":ok(e.execute(json!({"op":"get","id":n["id"]})))["revision"],"history_id":hid,"expected_label":"Renamed"})));
    assert_eq!(journal(&e), vec![("namedversion".to_string(), hid.clone())]);
    assert!(crate::host::build_raw_entity(e.connection(), "namedversion", &hid).unwrap().deleted);
}

#[test]
fn redelivery_and_duplicate_events_apply_once_without_rewriting() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (open(&dir, "a.db"), open(&dir, "b.db"));
    let n = ok(a.execute(json!({"op":"save","note":{"title":"redeliver","content":"<p>x</p>","text":"x"}})));
    let h = ok(a.execute(json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"one"})));
    let hid = h["id"].as_str().unwrap();
    let note = crate::host::build_raw_entity(a.connection(), "note", n["id"].as_str().unwrap()).unwrap();
    let version = crate::host::build_raw_entity(a.connection(), "namedversion", hid).unwrap();
    // A version that arrives before its note fails and stays pending.
    assert!(crate::host::apply_one(b.connection(), &incoming("v-early", version.clone())).is_err());
    crate::host::apply_one(b.connection(), &incoming("n1", note)).unwrap();
    crate::host::apply_one(b.connection(), &incoming("v1", version.clone())).unwrap();
    let seq = |c: &rusqlite::Connection| -> i64 { c.query_row("SELECT row_seq FROM history WHERE id=?1", [hid], |r| r.get(0)).unwrap() };
    let before = seq(b.connection());
    crate::host::apply_one(b.connection(), &incoming("v1", version.clone())).unwrap();
    crate::host::apply_one(b.connection(), &incoming("v1-again-other-event", version.clone())).unwrap();
    let count: i64 = b.connection().query_row("SELECT count(*) FROM history WHERE note_id=?1", [n["id"].as_str().unwrap()], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
    assert_eq!(seq(b.connection()), before, "identical redelivery rewrote the snapshot");
    // Remote apply is suppressed: nothing echoes back.
    assert!(journal(&b).iter().all(|(k, _)| k != "namedversion"));
    // Tombstone redelivery is also idempotent.
    let tomb = Entity::new(EntityKind::NamedVersion, hid, json!({"id":hid})).tombstone();
    crate::host::apply_one(b.connection(), &incoming("d1", tomb.clone())).unwrap();
    crate::host::apply_one(b.connection(), &incoming("d2", tomb)).unwrap();
    let count: i64 = b.connection().query_row("SELECT count(*) FROM history WHERE id=?1", [hid], |r| r.get(0)).unwrap();
    assert_eq!(count, 0);
    // Immutable source: a different body under the same id is rejected.
    let mut forged = version.clone();
    crate::host::apply_one(b.connection(), &incoming("v2", version)).unwrap();
    forged.data["content"] = json!("<p>forged</p>");
    assert!(crate::host::apply_one(b.connection(), &incoming("v3", forged)).is_err());
}

#[test]
fn encrypted_change_touches_only_the_changed_row() {
    let dir = tempfile::tempdir().unwrap();
    let e = open(&dir, "notes.db");
    let n = ok(e.execute(json!({"op":"save","note":{"title":"t","content":"c"}})));
    let note = n["id"].as_str().unwrap();
    let ids: Vec<String> = (0..3).map(|_| inkism_engine::ids::new_id()).collect();
    let rows: Vec<Value> = ids.iter().enumerate().map(|(i, id)| { let mut v = sealed(&format!("v{i}"), 10 + i as i64); v["id"] = json!(id); v }).collect();
    inkism_engine::encrypted_versions::replace(e.connection(), note, &json!(rows), false).unwrap();
    e.connection().execute("DELETE FROM sync_journal", []).unwrap();
    let mut changed = rows.clone();
    changed[1]["label"] = json!("renamed");
    changed.remove(2);
    inkism_engine::encrypted_versions::replace(e.connection(), note, &json!(changed), false).unwrap();
    let mut got = journal(&e);
    got.sort();
    let mut want = vec![("namedversion".to_string(), ids[1].clone()), ("namedversion".to_string(), ids[2].clone())];
    want.sort();
    assert_eq!(got, want, "unchanged snapshot was rewritten");
    e.connection().execute("DELETE FROM sync_journal", []).unwrap();
    inkism_engine::encrypted_versions::replace(e.connection(), note, &json!(changed), false).unwrap();
    assert!(journal(&e).is_empty(), "identical replace journaled");
    // A row of another note cannot be claimed.
    let other = ok(e.execute(json!({"op":"save","note":{"title":"o","content":"o"}})));
    assert!(inkism_engine::encrypted_versions::replace(e.connection(), other["id"].as_str().unwrap(), &json!([changed[0].clone()]), false).is_err());
}

#[test]
fn ciphertext_is_stored_without_a_vault_key_and_plaintext_never_lands_in_a_locked_note() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (open(&dir, "a.db"), open(&dir, "b.db"));
    let n = ok(a.execute(json!({"op":"save","note":{"title":"t","content":"<p>x</p>","text":"x"}})));
    let note = crate::host::build_raw_entity(a.connection(), "note", n["id"].as_str().unwrap()).unwrap();
    crate::host::apply_one(b.connection(), &incoming("n1", note)).unwrap();
    let vid = inkism_engine::ids::new_id();
    let mut data = sealed("vault", 5);
    data["id"] = json!(vid);
    data["note_id"] = n["id"].clone();
    data["scope_note"] = json!({"notebook_ids":[],"tags":[]});
    // B has no vault at all: the snapshot is kept as opaque ciphertext.
    crate::host::apply_one(b.connection(), &incoming("e1", Entity::new(EntityKind::NamedVersion, &vid, data.clone()))).unwrap();
    let raw: String = b.connection().query_row("SELECT data FROM encrypted_named_versions WHERE id=?1", [&vid], |r| r.get(0)).unwrap();
    let stored: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(stored["locked_body"], data["locked_body"]);
    assert!(stored.get("note_id").is_none() && stored.get("scope_note").is_none());
    // Vault fields only: plaintext keys inside a vault payload are refused.
    let mut leaking = data.clone();
    leaking["content"] = json!("plaintext");
    assert!(crate::host::apply_one(b.connection(), &incoming("e2", Entity::new(EntityKind::NamedVersion, &vid, leaking))).is_err());
    // Plaintext snapshots for a locked parent wait instead of landing.
    let locked = ok(a.execute(json!({"op":"save","note":{"title":"locked","content":"<p>y</p>","text":"y"}})));
    let mut entity = crate::host::build_raw_entity(a.connection(), "note", locked["id"].as_str().unwrap()).unwrap();
    entity.data["content"] = json!("");
    entity.data["text"] = json!("");
    entity.data["locked"] = json!(true);
    entity.data["locked_body"] = json!({"key_id":inkism_engine::ids::new_id(),"ciphertext":"NOTE-CIPHER","attachments":[]});
    crate::host::apply_one(b.connection(), &incoming("n2", entity)).unwrap();
    let plain = Entity::new(EntityKind::NamedVersion, inkism_engine::ids::new_id(), json!({"note_id":locked["id"],"label":"p","title":"locked","content":"<p>secret</p>","text":"secret","content_format":"html","created_at":1}));
    assert!(crate::host::apply_one(b.connection(), &incoming("p1", plain)).is_err());
    let n: i64 = b.connection().query_row("SELECT count(*) FROM history WHERE content LIKE '%secret%'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}

#[test]
fn concurrent_named_version_merge_is_deterministic() {
    let id = inkism_engine::ids::new_id();
    let plain = Entity::new(EntityKind::NamedVersion, &id, json!({"note_id":"n","label":"winner-name","title":"t","content":"c","text":"c","content_format":"html","created_at":1}));
    let mut vault = Entity::new(EntityKind::NamedVersion, &id, sealed("loser-name", 1));
    vault.data["note_id"] = json!("n");
    let gone = Entity::new(EntityKind::NamedVersion, &id, json!({"id":id})).tombstone();
    let conflict = |w: &Entity, l: &Entity| Conflict { copy_id: format!("{id}~conflict~d~1"), winner: w.clone(), loser: l.clone(), copy: l.clone() };
    let m = crate::named_version_sync::merge(&conflict(&plain, &vault));
    assert!(m.data.get("locked_body").is_some() && m.data.get("content").is_none(), "vault form must win");
    assert_eq!(m.data["label"], "winner-name");
    assert_eq!(crate::named_version_sync::merge(&conflict(&vault, &plain)).data, vault.data);
    let kept = crate::named_version_sync::merge(&conflict(&gone, &plain));
    assert!(!kept.deleted && kept.data == plain.data);
    assert!(!crate::named_version_sync::merge(&conflict(&plain, &gone)).deleted);
    assert!(crate::named_version_sync::merge(&conflict(&gone, &gone)).deleted);
}

#[test]
fn unknown_entity_kinds_are_not_decodable() {
    // Older apps lack `namedversion` exactly as this one lacks a future kind:
    // decoding fails, so the record stays pending instead of being applied.
    assert!(EntityKind::parse("futurekind").is_none());
    let raw = json!({"version":1,"entity":{"kind":"futurekind","id":"x","data":{},"deleted":false},"device_id":"d","counter":1,"ts":1,"vclock":{"d":1}});
    assert!(sync_core::ChangePayload::decode(raw.to_string().as_bytes()).is_err());
    let named = json!({"version":1,"entity":{"kind":"namedversion","id":"x","data":{},"deleted":false},"device_id":"d","counter":1,"ts":1,"vclock":{"d":1}});
    assert_eq!(sync_core::ChangePayload::decode(named.to_string().as_bytes()).unwrap().entity.kind, EntityKind::NamedVersion);
}

#[test]
fn single_row_vault_apply_keeps_the_per_note_limits() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (open(&dir, "a.db"), open(&dir, "b.db"));
    let n = ok(a.execute(json!({"op":"save","note":{"title":"t","content":"<p>x</p>","text":"x"}})));
    let note = crate::host::build_raw_entity(a.connection(), "note", n["id"].as_str().unwrap()).unwrap();
    crate::host::apply_one(b.connection(), &incoming("n1", note)).unwrap();
    let vault = |label: &str, plain_bytes: u64| {
        let id = inkism_engine::ids::new_id();
        let mut data = sealed(label, 5);
        data["id"] = json!(id);
        data["note_id"] = n["id"].clone();
        data["plain_bytes"] = json!(plain_bytes);
        Entity::new(EntityKind::NamedVersion, &id, data)
    };
    let count = |c: &rusqlite::Connection| -> i64 { c.query_row("SELECT count(*) FROM encrypted_named_versions", [], |r| r.get(0)).unwrap() };
    // Declared plaintext over 64 MiB in total is refused and rolled back.
    crate::host::apply_one(b.connection(), &incoming("big", vault("big", 60 << 20))).unwrap();
    assert!(crate::host::apply_one(b.connection(), &incoming("over", vault("over", 5 << 20))).is_err());
    assert_eq!(count(b.connection()), 1);
    for i in 1..100 {
        crate::host::apply_one(b.connection(), &incoming(&format!("e{i}"), vault(&format!("v{i}"), 1))).unwrap();
    }
    // The 101st snapshot of one note is refused; nothing is stored.
    assert!(crate::host::apply_one(b.connection(), &incoming("e101", vault("v101", 1))).is_err());
    assert_eq!(count(b.connection()), 100);
    // A rename of a held snapshot still applies at the cap.
    let held: String = b.connection().query_row("SELECT id FROM encrypted_named_versions WHERE json_extract(data,'$.label')='v1'", [], |r| r.get(0)).unwrap();
    let mut renamed = crate::host::build_raw_entity(b.connection(), "namedversion", &held).unwrap();
    renamed.data["label"] = json!("renamed");
    crate::host::apply_one(b.connection(), &incoming("rename", renamed)).unwrap();
    let label: String = b.connection().query_row("SELECT json_extract(data,'$.label') FROM encrypted_named_versions WHERE id=?1", [&held], |r| r.get(0)).unwrap();
    assert_eq!(label, "renamed");
    // A snapshot of another note cannot be claimed through a single row.
    let other = ok(b.execute(json!({"op":"save","note":{"title":"o","content":"o"}})));
    let mut moved = crate::host::build_raw_entity(b.connection(), "namedversion", &held).unwrap();
    moved.data["note_id"] = other["id"].clone();
    assert!(crate::host::apply_one(b.connection(), &incoming("move", moved)).is_err());
    let mut row = crate::host::build_raw_entity(b.connection(), "namedversion", &held).unwrap().data;
    for key in ["note_id", "scope_note"] {
        row.as_object_mut().unwrap().remove(key);
    }
    assert!(inkism_engine::encrypted_versions::upsert(b.connection(), other["id"].as_str().unwrap(), &row).is_err());
}
