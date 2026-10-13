//! Scale check for named-version sync at the per-note limit (100 versions,
//! 64 MiB): two real runtimes, the real relay, plaintext then vault form.
//! Ignored by default (minutes, ~1 GiB temp data); run with
//! `cargo test --test named_version_scale -- --ignored --nocapture`.
mod common;
use common::{Relay, TOKEN};
use inkism_runtime::AppCore;
use serde_json::{json, Value};
use std::time::Instant;
use sync_core::Key;

fn call(app: &AppCore, request: Value) -> Value {
    let r = app.execute(request);
    assert_eq!(r["ok"], true, "{r}");
    r["data"].clone()
}
fn sync(app: &AppCore) {
    call(app, json!({"op":"sync_now"}));
    assert!(app.wait_sync_idle(600_000));
    let status = call(app, json!({"op":"sync_status"}));
    assert!(status["error"].is_null(), "{status}");
}
fn rev(app: &AppCore, id: &Value) -> Value {
    call(app, json!({"op":"list","view":"all"}))["items"].as_array().unwrap().iter().find(|n| n["id"] == *id).unwrap()["revision"].clone()
}
/// Start a phase: reset the kernel's peak-RSS mark so each phase reports its
/// own peak (Linux `clear_refs` 5; elsewhere the peak stays cumulative).
fn phase() -> Instant {
    let _ = std::fs::write("/proc/self/clear_refs", "5");
    PHASE_START_MIB.store(status_mib("VmRSS:"), std::sync::atomic::Ordering::Relaxed);
    Instant::now()
}
/// Resident memory when the current phase started, MiB.
static PHASE_START_MIB: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn status_mib(field: &str) -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    status.lines().find_map(|l| l.strip_prefix(field)).and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<u64>().ok()).unwrap_or(0) / 1024
}
/// Peak resident memory of this test process (both runtimes) since the
/// phase started, MiB.
fn peak_mib() -> u64 {
    status_mib("VmHWM:")
}
fn body(i: usize) -> String {
    // 100 × (content + text) stays just under the 64 MiB per-note cap.
    let seed = format!("version-{i:03}-");
    seed.repeat(335_000 / seed.len() + 1)[..335_000].to_string()
}

#[test]
#[ignore]
fn hundred_versions_at_64_mib_sync_plain_then_sealed() {
    let relay = Relay::start().expect("real relay");
    let dir = tempfile::tempdir().unwrap();
    let a = AppCore::open(dir.path().join("a.db").to_str().unwrap()).unwrap();
    let b = AppCore::open(dir.path().join("b.db").to_str().unwrap()).unwrap();
    let key = Key::generate().to_base64();
    for app in [&a, &b] {
        call(app, json!({"op":"sync_config","server_url":relay.url,"token":TOKEN,"key":key}));
    }
    let report = |phase: &str, started: Instant| println!("SCALE {phase}: {:.1}s, peak RSS {} MiB (start {} MiB)", started.elapsed().as_secs_f64(), peak_mib(), PHASE_START_MIB.load(std::sync::atomic::Ordering::Relaxed));

    let started = phase();
    let mut note = call(&a, json!({"op":"save","note":{"title":"scale","content":"<p>start</p>","text":"start"}}));
    let id = note["id"].clone();
    let mut expected = std::collections::BTreeMap::new();
    for i in 0..100 {
        let text = body(i);
        note = call(&a, json!({"op":"save","note":{"id":id,"revision":note["revision"],"title":"scale","content":format!("<p>{text}</p>"),"text":text}}));
        let v = call(&a, json!({"op":"history_name_current","id":id,"revision":note["revision"],"label":format!("v{i:03}")}));
        expected.insert(v["id"].as_str().unwrap().to_string(), i);
    }
    // The cap holds: a 101st version is refused, nothing is dropped.
    let over = a.execute(json!({"op":"history_name_current","id":id,"revision":note["revision"],"label":"v100"}));
    assert_eq!(over["ok"], false, "{over}");
    report("create 100 versions (64 MiB) on A", started);

    let started = phase();
    sync(&a);
    report("A push", started);
    let started = phase();
    sync(&b);
    report("B pull + apply", started);
    let named: Vec<Value> = call(&b, json!({"op":"history","id":id})).as_array().unwrap().iter().filter(|h| !h["label"].is_null()).cloned().collect();
    assert_eq!(named.len(), 100);
    for (hid, i) in &expected {
        let got = call(&b, json!({"op":"history_body","id":id,"history_id":hid}));
        assert!(got["content"].as_str() == Some(&format!("<p>{}</p>", body(*i))), "version {hid} differs on B");
    }

    // Lock with all 100 versions; B has no key and receives ciphertext only.
    call(&a, json!({"op":"vault_create","password":"scale-password"}));
    let started = phase();
    call(&a, json!({"op":"vault_lock_note","id":id,"revision":rev(&a, &id)}));
    report("A seal note + 100 versions", started);
    let sealed_started = Instant::now();
    let started = phase();
    sync(&a);
    report("sealed A push", started);
    let started = phase();
    sync(&b);
    report("sealed B pull + apply", started);
    println!("SCALE sealed push + pull total: {:.1}s", sealed_started.elapsed().as_secs_f64());
    let c = rusqlite::Connection::open(dir.path().join("b.db")).unwrap();
    let (rows, plain): (i64, i64) = c.query_row("SELECT count(*), sum(instr(data,'version-0')>0) FROM encrypted_named_versions WHERE note_id=?1", [id.as_str().unwrap()], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((rows, plain), (100, 0));
    let history: i64 = c.query_row("SELECT count(*) FROM history WHERE note_id=?1", [id.as_str().unwrap()], |r| r.get(0)).unwrap();
    assert_eq!(history, 0, "plaintext history left under the locked note on B");

    let started = phase();
    call(&b, json!({"op":"vault_unlock","password":"scale-password"}));
    let listed = call(&b, json!({"op":"vault_versions","id":id}));
    assert_eq!(listed["items"].as_array().unwrap().len(), 100);
    for (hid, i) in expected.iter().step_by(10) {
        let got = call(&b, json!({"op":"vault_versions","action":"body","id":id,"history_id":hid}));
        assert!(got["content"].as_str() == Some(&format!("<p>{}</p>", body(*i))), "sealed version {hid} differs on B");
    }
    report("B unlock + list + read 10 sealed bodies", started);

    // Editing one sealed version touches that row only.
    let started = phase();
    let (hid, i) = expected.iter().next().unwrap();
    call(&b, json!({"op":"vault_versions","action":"rename","id":id,"history_id":hid,"expected_label":format!("v{i:03}"),"label":"renamed","revision":rev(&b, &id)}));
    let listed = call(&b, json!({"op":"vault_versions","id":id}));
    assert_eq!(listed["items"].as_array().unwrap().iter().filter(|v| v["label"] == "renamed").count(), 1);
    report("B rename 1 sealed version", started);

    // Unlocking restores all 100 plaintext versions byte for byte.
    let started = phase();
    call(&a, json!({"op":"vault_unlock_note","id":id,"revision":rev(&a, &id)}));
    report("A unlock note + 100 versions", started);
    let c = rusqlite::Connection::open(dir.path().join("a.db")).unwrap();
    let left: i64 = c.query_row("SELECT count(*) FROM encrypted_named_versions WHERE note_id=?1", [id.as_str().unwrap()], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
    for (hid, i) in expected.iter().step_by(10) {
        let got = call(&a, json!({"op":"history_body","id":id,"history_id":hid}));
        assert!(got["content"].as_str() == Some(&format!("<p>{}</p>", body(*i))), "unlocked version {hid} differs on A");
    }
}
