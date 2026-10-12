//! Named versions across two real runtimes and the real relay.
mod common;
use common::{Relay, TOKEN};
use inkism_engine::attachments::AttachmentStore;
use inkism_runtime::AppCore;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
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
fn config(app: &AppCore, url: &str, key: &str, scope: Option<Value>) {
    let mut req = json!({"op":"sync_config","server_url":url,"token":TOKEN,"key":key});
    if let Some(scope) = scope {
        req["scope"] = scope;
    }
    call(app, req);
}
struct Pair {
    _relay: Relay,
    _dir: tempfile::TempDir,
    a: AppCore,
    b: AppCore,
    ap: PathBuf,
    bp: PathBuf,
    key: String,
    url: String,
}
fn pair() -> Pair {
    let relay = Relay::start().expect("real relay");
    let dir = tempfile::tempdir().unwrap();
    let (ap, bp) = (dir.path().join("a.db"), dir.path().join("b.db"));
    let a = AppCore::open(ap.to_str().unwrap()).unwrap();
    let b = AppCore::open(bp.to_str().unwrap()).unwrap();
    let key = Key::generate().to_base64();
    let url = relay.url.clone();
    Pair { _relay: relay, _dir: dir, a, b, ap, bp, key, url }
}
fn named(app: &AppCore, note: &Value) -> Vec<Value> {
    let h = call(app, json!({"op":"history","id":note}));
    h.as_array().unwrap().iter().filter(|v| !v["label"].is_null()).cloned().collect()
}
fn rev(app: &AppCore, note: &Value) -> Value {
    call(app, json!({"op":"get","id":note}))["revision"].clone()
}
fn db(path: &Path) -> rusqlite::Connection {
    rusqlite::Connection::open(path).unwrap()
}
fn count(path: &Path, sql: &str, id: &str) -> i64 {
    db(path).query_row(sql, [id], |r| r.get(0)).unwrap()
}

#[test]
fn round_trip_rename_delete_and_change_only_touched_rows() {
    let p = pair();
    let n = call(&p.a, json!({"op":"save","note":{"title":"공유 버전","content":"<p>첫 본문</p>","text":"첫 본문"}}));
    let v1 = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"초안"}));
    let n2 = call(&p.a, json!({"op":"save","note":{"id":n["id"],"revision":n["revision"],"title":"공유 버전","content":"<p>둘째 본문</p>","text":"둘째 본문"}}));
    let v2 = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n2["revision"],"label":"검토본"}));
    config(&p.a, &p.url, &p.key, None);
    sync(&p.a);
    config(&p.b, &p.url, &p.key, None);
    sync(&p.b);
    let got = named(&p.b, &n["id"]);
    assert_eq!(got.len(), 2, "{got:?}");
    assert_eq!(call(&p.b, json!({"op":"history_body","id":n["id"],"history_id":v1["id"]}))["content"], "<p>첫 본문</p>");
    // Automatic history is never synchronized.
    assert_eq!(count(&p.bp, "SELECT count(*) FROM history WHERE note_id=?1 AND label IS NULL", n["id"].as_str().unwrap()), 0);
    let seq_before: i64 = db(&p.bp).query_row("SELECT row_seq FROM history WHERE id=?1", [v2["id"].as_str().unwrap()], |r| r.get(0)).unwrap();

    // Rename on A journals exactly that version, and B updates in place.
    call(&p.a, json!({"op":"history_rename","id":n["id"],"revision":rev(&p.a,&n["id"]),"history_id":v1["id"],"expected_label":"초안","label":"최종"}));
    sync(&p.a);
    sync(&p.b);
    let got = named(&p.b, &n["id"]);
    assert!(got.iter().any(|v| v["id"] == v1["id"] && v["label"] == "최종"), "{got:?}");
    let seq_after: i64 = db(&p.bp).query_row("SELECT row_seq FROM history WHERE id=?1", [v2["id"].as_str().unwrap()], |r| r.get(0)).unwrap();
    assert_eq!(seq_before, seq_after, "untouched snapshot was rewritten");

    // Rename on B flows back.
    call(&p.b, json!({"op":"history_rename","id":n["id"],"revision":rev(&p.b,&n["id"]),"history_id":v2["id"],"expected_label":"검토본","label":"B 이름"}));
    sync(&p.b);
    sync(&p.a);
    assert!(named(&p.a, &n["id"]).iter().any(|v| v["id"] == v2["id"] && v["label"] == "B 이름"));

    // Delete propagates; the other snapshot remains.
    call(&p.a, json!({"op":"history_delete_named","id":n["id"],"revision":rev(&p.a,&n["id"]),"history_id":v1["id"],"expected_label":"최종"}));
    sync(&p.a);
    sync(&p.b);
    let got = named(&p.b, &n["id"]);
    assert_eq!(got.len(), 1, "{got:?}");
    assert_eq!(got[0]["id"], v2["id"]);
    // Re-running rounds re-delivers nothing new and duplicates nothing.
    sync(&p.b);
    sync(&p.a);
    sync(&p.b);
    assert_eq!(named(&p.b, &n["id"]).len(), 1);
    assert_eq!(named(&p.a, &n["id"]).len(), 1);
}

#[test]
fn snapshot_attachment_travels_even_when_current_body_dropped_it() {
    let p = pair();
    let mut assets = AttachmentStore::open(&PathBuf::from(format!("{}.attachments", p.ap.display()))).unwrap();
    let bytes: Vec<u8> = (0..70001).map(|i| (i % 253) as u8).collect();
    let file = assets.import_reader("버전 첨부.bin", "application/octet-stream", bytes.as_slice()).unwrap();
    drop(assets);
    let html = format!("<p><a href=\"/api/attachments/{}\">첨부</a></p>", file.id);
    let n = call(&p.a, json!({"op":"save","note":{"title":"첨부 버전","content":html,"text":"첨부"}}));
    let v = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"첨부 포함"}));
    call(&p.a, json!({"op":"save","note":{"id":n["id"],"revision":n["revision"],"title":"첨부 버전","content":"<p>첨부 없음</p>","text":"첨부 없음"}}));
    config(&p.a, &p.url, &p.key, None);
    sync(&p.a);
    config(&p.b, &p.url, &p.key, None);
    sync(&p.b);
    let body = call(&p.b, json!({"op":"history_body","id":n["id"],"history_id":v["id"]}));
    assert!(body["content"].as_str().unwrap().contains(&file.id));
    let store = AttachmentStore::open(&PathBuf::from(format!("{}.attachments", p.bp.display()))).unwrap();
    let mut out = Vec::new();
    store.copy_to(&file.id, &mut out).unwrap();
    assert_eq!(out, bytes);
}

#[test]
fn vault_versions_arrive_as_ciphertext_without_key_and_switch_form_in_place() {
    let p = pair();
    let n = call(&p.a, json!({"op":"save","note":{"title":"금고 버전","content":"<p>SECRET-v1</p>","text":"SECRET-v1"}}));
    let v = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"비밀"}));
    let vid = v["id"].as_str().unwrap().to_string();
    config(&p.a, &p.url, &p.key, None);
    sync(&p.a);
    config(&p.b, &p.url, &p.key, None);
    sync(&p.b);
    assert_eq!(named(&p.b, &n["id"]).len(), 1);

    call(&p.a, json!({"op":"vault_create","password":"pw-named"}));
    call(&p.a, json!({"op":"vault_lock_note","id":n["id"],"revision":rev(&p.a,&n["id"])}));
    sync(&p.a);
    sync(&p.b);
    // B holds the ciphertext under the same id, no plaintext copy, no key needed.
    assert_eq!(count(&p.bp, "SELECT count(*) FROM history WHERE id=?1", &vid), 0);
    let raw: String = db(&p.bp).query_row("SELECT data FROM encrypted_named_versions WHERE id=?1", [&vid], |r| r.get(0)).unwrap();
    assert!(!raw.contains("SECRET-v1") && raw.contains("locked_body"), "{raw}");
    assert_eq!(p.b.execute(json!({"op":"vault_versions","id":n["id"]}))["ok"], false, "listed without the vault key");

    // Vault rename on A rewrites only that row on B.
    call(&p.a, json!({"op":"vault_unlock","password":"pw-named"}));
    let locked_rev = rev(&p.a, &n["id"]);
    call(&p.a, json!({"op":"vault_versions","action":"rename","id":n["id"],"revision":locked_rev,"history_id":vid,"expected_label":"비밀","label":"비밀-이름변경"}));
    sync(&p.a);
    sync(&p.b);
    call(&p.b, json!({"op":"vault_unlock","password":"pw-named"}));
    let items = call(&p.b, json!({"op":"vault_versions","id":n["id"]}));
    assert_eq!(items["items"][0]["label"], "비밀-이름변경", "{items}");
    assert_eq!(call(&p.b, json!({"op":"vault_versions","action":"body","id":n["id"],"history_id":vid}))["content"], "<p>SECRET-v1</p>");

    // Unlock on A turns the same id back into plaintext on B.
    call(&p.a, json!({"op":"vault_unlock_note","id":n["id"],"revision":rev(&p.a,&n["id"])}));
    sync(&p.a);
    sync(&p.b);
    assert_eq!(count(&p.bp, "SELECT count(*) FROM encrypted_named_versions WHERE id=?1", &vid), 0);
    // A keyed receiver must not mistake the unlock for a stale plaintext and re-seal it.
    sync(&p.a);
    assert_eq!(count(&p.ap, "SELECT count(*) FROM encrypted_named_versions WHERE id=?1", &vid), 0);
    let got = named(&p.b, &n["id"]);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0]["label"], "비밀-이름변경");
}

#[test]
fn offline_conflicts_converge_without_snapshot_copies() {
    let p = pair();
    let n = call(&p.a, json!({"op":"save","note":{"title":"충돌","content":"<p>body</p>","text":"body"}}));
    let v = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"base"}));
    let gone = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"to-delete"}));
    config(&p.a, &p.url, &p.key, None);
    sync(&p.a);
    config(&p.b, &p.url, &p.key, None);
    sync(&p.b);
    // Concurrent renames of one version + delete vs rename of another.
    call(&p.a, json!({"op":"history_rename","id":n["id"],"revision":rev(&p.a,&n["id"]),"history_id":v["id"],"expected_label":"base","label":"from-a"}));
    call(&p.b, json!({"op":"history_rename","id":n["id"],"revision":rev(&p.b,&n["id"]),"history_id":v["id"],"expected_label":"base","label":"from-b"}));
    call(&p.a, json!({"op":"history_delete_named","id":n["id"],"revision":rev(&p.a,&n["id"]),"history_id":gone["id"],"expected_label":"to-delete"}));
    call(&p.b, json!({"op":"history_rename","id":n["id"],"revision":rev(&p.b,&n["id"]),"history_id":gone["id"],"expected_label":"to-delete","label":"kept-by-b"}));
    for _ in 0..3 {
        sync(&p.a);
        sync(&p.b);
    }
    let (ga, gb) = (named(&p.a, &n["id"]), named(&p.b, &n["id"]));
    let labels = |g: &[Value]| {
        let mut l: Vec<(String, String)> = g.iter().map(|v| (v["id"].as_str().unwrap().into(), v["label"].as_str().unwrap().into())).collect();
        l.sort();
        l
    };
    assert_eq!(labels(&ga), labels(&gb), "replicas diverged");
    assert_eq!(ga.len(), 2, "{ga:?}");
    let renamed = ga.iter().find(|x| x["id"] == v["id"]).unwrap();
    assert!(renamed["label"] == "from-a" || renamed["label"] == "from-b");
    assert!(ga.iter().any(|x| x["id"] == gone["id"] && x["label"] == "kept-by-b"));
    // No conflict notes/copies were created for snapshots.
    let list = call(&p.a, json!({"op":"list","view":"all"}));
    assert_eq!(list["items"].as_array().unwrap().len(), 1, "{list}");
}

#[test]
fn offline_lock_versus_plaintext_rename_keeps_vault_form() {
    // Either winner: the vault form must survive and labels converge.
    lock_versus_rename(false);
    lock_versus_rename(true);
}

fn lock_versus_rename(rename_wins: bool) {
    let p = pair();
    let n = call(&p.a, json!({"op":"save","note":{"title":"잠금 충돌","content":"<p>PLAIN-SECRET</p>","text":"PLAIN-SECRET"}}));
    let v = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"base"}));
    let vid = v["id"].as_str().unwrap().to_string();
    call(&p.a, json!({"op":"vault_create","password":"pw-c"}));
    config(&p.a, &p.url, &p.key, None);
    sync(&p.a);
    config(&p.b, &p.url, &p.key, None);
    sync(&p.b);
    // Both edit offline. sync-core orders concurrent edits by staging time,
    // so the device that syncs second carries the winning clock.
    call(&p.b, json!({"op":"history_rename","id":n["id"],"revision":rev(&p.b,&n["id"]),"history_id":vid,"expected_label":"base","label":"b-offline"}));
    call(&p.a, json!({"op":"vault_lock_note","id":n["id"],"revision":rev(&p.a,&n["id"])}));
    let (first, second) = if rename_wins { (&p.a, &p.b) } else { (&p.b, &p.a) };
    sync(first);
    std::thread::sleep(std::time::Duration::from_millis(20));
    for _ in 0..3 {
        sync(second);
        sync(first);
    }
    // The note itself is locked on both devices and no conflict note appeared.
    for app in [&p.a, &p.b] {
        let list = call(app, json!({"op":"list","view":"all"}));
        assert_eq!(list["items"].as_array().unwrap().len(), 1, "{list}");
        assert_eq!(list["items"][0]["locked"], true);
    }
    for path in [&p.ap, &p.bp] {
        assert_eq!(count(path, "SELECT count(*) FROM history WHERE id=?1", &vid), 0, "plaintext survived on {path:?}");
        let raw: String = db(path).query_row("SELECT data FROM encrypted_named_versions WHERE id=?1", [&vid], |r| r.get(0)).unwrap();
        assert!(!raw.contains("PLAIN-SECRET"));
    }
    let label = |path: &Path| -> String {
        let raw: String = db(path).query_row("SELECT data FROM encrypted_named_versions WHERE id=?1", [&vid], |r| r.get(0)).unwrap();
        serde_json::from_str::<Value>(&raw).unwrap()["label"].as_str().unwrap().to_string()
    };
    assert_eq!(label(&p.ap), label(&p.bp), "labels diverged");
    // The winner's label is kept even when the vault form came from the loser.
    assert_eq!(label(&p.ap), if rename_wins { "b-offline" } else { "base" });
}

#[test]
fn selective_sync_holds_snapshots_until_parent_enters_scope() {
    let p = pair();
    let scope = json!({"notebook_ids":[],"tags":["work"]});
    // Sender-side scope: A only sends work notes.
    let n = call(&p.a, json!({"op":"save","note":{"title":"개인","content":"<p>private</p>","text":"private","tags":["home"]}}));
    let v = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"개인 버전"}));
    config(&p.a, &p.url, &p.key, Some(scope.clone()));
    sync(&p.a);
    config(&p.b, &p.url, &p.key, None);
    sync(&p.b);
    assert_eq!(p.b.execute(json!({"op":"get","id":n["id"]}))["ok"], false);
    assert_eq!(count(&p.bp, "SELECT count(*) FROM history WHERE id=?1", v["id"].as_str().unwrap()), 0);
    call(&p.a, json!({"op":"save","note":{"id":n["id"],"revision":rev(&p.a,&n["id"]),"title":"개인","content":"<p>private</p>","text":"private","tags":["work"]}}));
    sync(&p.a);
    sync(&p.b);
    assert_eq!(named(&p.b, &n["id"]).len(), 1, "snapshot skipped while excluded was never sent");

    // Receiver-side scope: A (scoped) holds B's home note and snapshot until it is retagged.
    let m = call(&p.b, json!({"op":"save","note":{"title":"B 개인","content":"<p>b</p>","text":"b","tags":["home"]}}));
    let mv = call(&p.b, json!({"op":"history_name_current","id":m["id"],"revision":m["revision"],"label":"B 버전"}));
    sync(&p.b);
    call(&p.a, json!({"op":"sync_scope","scope":scope}));
    sync(&p.a);
    assert_eq!(p.a.execute(json!({"op":"get","id":m["id"]}))["ok"], false);
    assert_eq!(count(&p.ap, "SELECT count(*) FROM history WHERE id=?1", mv["id"].as_str().unwrap()), 0);
    call(&p.b, json!({"op":"save","note":{"id":m["id"],"revision":rev(&p.b,&m["id"]),"title":"B 개인","content":"<p>b</p>","text":"b","tags":["work"]}}));
    sync(&p.b);
    sync(&p.a);
    sync(&p.a);
    assert_eq!(named(&p.a, &m["id"]).len(), 1, "held snapshot not applied after parent entered scope");
}

#[test]
fn undecodable_entity_kind_stays_pending_without_blocking_other_records() {
    // Stand-in for an older app receiving `namedversion`: this build receives
    // a kind it does not know. The record must stay pending (not acknowledged,
    // not applied) and ordinary notes behind it must still apply.
    let p = pair();
    config(&p.a, &p.url, &p.key, None);
    config(&p.b, &p.url, &p.key, None);
    let key = Key::from_base64(&p.key).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let payload = json!({"version":1,"entity":{"kind":"futurekind","id":"x","data":{},"deleted":false},"device_id":"future-device","counter":1,"ts":1,"vclock":{"future-device":1}});
    let blob = sync_core::encode_blob(&sync_core::seal_record(&key, &id, payload.to_string().as_bytes()).unwrap());
    sync_core::RelayClient::new(&p.url, TOKEN).unwrap().post_change(&id, &blob).unwrap();
    let n = call(&p.a, json!({"op":"save","note":{"title":"뒤의 노트","content":"<p>after</p>","text":"after"}}));
    let round = |app: &AppCore| {
        call(app, json!({"op":"sync_now"}));
        assert!(app.wait_sync_idle(30000));
        call(app, json!({"op":"sync_status"}))
    };
    // A also pulls the unknown record; its own note is still pushed.
    assert!(!round(&p.a)["error"].is_null());
    for _ in 0..2 {
        let status = round(&p.b);
        assert!(!status["error"].is_null(), "unknown record must be reported: {status}");
        assert!(status["pending"].as_u64().unwrap() >= 1, "{status}");
    }
    assert_eq!(call(&p.b, json!({"op":"get","id":n["id"]}))["title"], "뒤의 노트");
}

/// JSONL client for a separately built older `inkism-engine` binary.
struct OldApp {
    child: std::process::Child,
    out: std::io::BufReader<std::process::ChildStdout>,
}
impl OldApp {
    fn call(&mut self, request: Value) -> Value {
        use std::io::{BufRead, Write};
        let stdin = self.child.stdin.as_mut().unwrap();
        writeln!(stdin, "{request}").unwrap();
        stdin.flush().unwrap();
        let mut line = String::new();
        self.out.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }
    fn round(&mut self) -> Value {
        let before = self.call(json!({"op":"sync_status"}))["data"]["last_sync"].as_i64().unwrap_or(0);
        assert_eq!(self.call(json!({"op":"sync_now"}))["ok"], true);
        let start = std::time::Instant::now();
        loop {
            let s = self.call(json!({"op":"sync_status"}))["data"].clone();
            if s["running"] == false && s["last_sync"].as_i64().unwrap_or(0) > before {
                return s;
            }
            assert!(start.elapsed().as_secs() < 30, "old app round timed out: {s}");
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}
impl Drop for OldApp {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn older_app_without_named_versions_keeps_notes_syncing() {
    // Set INKISM_OLD_ENGINE_BIN to an `inkism-engine` built from a commit
    // before `namedversion` existed (for example HEAD c19a9cc).
    let Ok(bin) = std::env::var("INKISM_OLD_ENGINE_BIN") else {
        eprintln!("SKIP: INKISM_OLD_ENGINE_BIN is not set");
        return;
    };
    let p = pair();
    let n = call(&p.a, json!({"op":"save","note":{"title":"혼합 기기","content":"<p>v1</p>","text":"v1"}}));
    let v = call(&p.a, json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"새 앱 버전"}));
    config(&p.a, &p.url, &p.key, None);
    sync(&p.a);
    let old_db = p.bp.with_file_name("old.db");
    let mut child = std::process::Command::new(bin)
        .arg("--db").arg(&old_db)
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null())
        .spawn().unwrap();
    let out = std::io::BufReader::new(child.stdout.take().unwrap());
    let mut old = OldApp { child, out };
    assert_eq!(old.call(json!({"op":"sync_config","server_url":p.url,"token":TOKEN,"key":p.key}))["ok"], true);
    let status = old.round();
    // The unknown record is reported and held, never applied or acknowledged.
    assert!(status["error"].as_str().unwrap_or("").contains("namedversion"), "{status}");
    assert!(status["pending"].as_u64().unwrap() >= 1, "{status}");
    assert_eq!(old.call(json!({"op":"get","id":n["id"]}))["data"]["text"], "v1");
    // Later note edits in both directions still flow.
    let latest = call(&p.a, json!({"op":"get","id":n["id"]}));
    call(&p.a, json!({"op":"save","note":{"id":n["id"],"revision":latest["revision"],"title":"혼합 기기","content":"<p>v2</p>","text":"v2"}}));
    sync(&p.a);
    old.round();
    let got = old.call(json!({"op":"get","id":n["id"]}))["data"].clone();
    assert_eq!(got["text"], "v2");
    let saved = old.call(json!({"op":"save","note":{"id":n["id"],"revision":got["revision"],"title":"혼합 기기","content":"<p>from old</p>","text":"from old"}}));
    assert_eq!(saved["ok"], true, "{saved}");
    old.round();
    sync(&p.a);
    assert_eq!(call(&p.a, json!({"op":"get","id":n["id"]}))["text"], "from old");
    // The old app neither deletes nor alters the new app's snapshot.
    let kept = named(&p.a, &n["id"]);
    assert!(kept.iter().any(|x| x["id"] == v["id"] && x["label"] == "새 앱 버전"), "{kept:?}");
}

fn status(app: &AppCore) -> Value {
    call(app, json!({"op":"sync_now"}));
    assert!(app.wait_sync_idle(30000));
    let s = call(app, json!({"op":"sync_status"}));
    assert!(s["error"].is_null(), "vault waits must not be sync errors: {s}");
    s
}
fn waits_for(s: &Value, note: &Value) -> bool {
    s["vault_key_required"].as_array().is_some_and(|v| v.contains(note))
}

/// B names a new plaintext snapshot offline while A locks the same note.
/// `a_key`/`b_key`: whether each device has the vault key unlocked;
/// `a_first`: which device syncs first after both went offline.
fn offline_snapshot_versus_lock(a_key: bool, b_key: bool, a_first: bool) {
    let p = pair();
    let n = call(&p.a, json!({"op":"save","note":{"title":"보류","content":"<p>HELD-SECRET</p>","text":"HELD-SECRET"}}));
    call(&p.a, json!({"op":"vault_create","password":"pw-h"}));
    config(&p.a, &p.url, &p.key, None);
    sync(&p.a);
    config(&p.b, &p.url, &p.key, None);
    sync(&p.b);
    if b_key {
        call(&p.b, json!({"op":"vault_unlock","password":"pw-h"}));
    }
    let bv = call(&p.b, json!({"op":"history_name_current","id":n["id"],"revision":rev(&p.b,&n["id"]),"label":"B 오프라인"}));
    let vid = bv["id"].as_str().unwrap().to_string();
    call(&p.a, json!({"op":"vault_lock_note","id":n["id"],"revision":rev(&p.a,&n["id"])}));
    if !a_key {
        call(&p.a, json!({"op":"vault_lock"}));
    }
    let (first, second) = if a_first { (&p.a, &p.b) } else { (&p.b, &p.a) };
    let mut waited = (false, false);
    for _ in 0..3 {
        for app in [first, second] {
            let s = status(app);
            let w = waits_for(&s, &n["id"]);
            if std::ptr::eq(app, &p.a) { waited.0 |= w } else { waited.1 |= w }
        }
    }
    // A plaintext snapshot never lands under A's locked note, whatever the keys.
    assert_eq!(count(&p.ap, "SELECT count(*) FROM history WHERE id=?1", &vid), 0);
    if !a_key && !b_key {
        // Nobody can seal: both hold the records, report the wait, lose nothing.
        assert!(waited.0 && waited.1, "both keyless devices must report the wait: {waited:?}");
        assert_eq!(named(&p.b, &n["id"]).len(), 1, "B lost its snapshot");
        let unlock = if a_first { &p.b } else { &p.a };
        call(unlock, json!({"op":"vault_unlock","password":"pw-h"}));
        for _ in 0..3 {
            status(first);
            status(second);
        }
    } else if a_key != b_key {
        // The keyless side waited at most until the keyed side sealed it.
        assert!(!(if a_key { waited.0 } else { waited.1 }), "keyed device reported a wait");
    }
    for (app, path) in [(&p.a, &p.ap), (&p.b, &p.bp)] {
        let s = status(app);
        assert!(!waits_for(&s, &n["id"]), "wait not cleared: {s}");
        let list = call(app, json!({"op":"list","view":"all"}));
        assert_eq!(list["items"].as_array().unwrap().len(), 1, "{list}");
        assert_eq!(list["items"][0]["locked"], true, "{list}");
        assert_eq!(count(path, "SELECT count(*) FROM history WHERE note_id=?1", n["id"].as_str().unwrap()), 0, "plaintext history under locked note");
        let raw: String = db(path).query_row("SELECT data FROM encrypted_named_versions WHERE id=?1", [&vid], |r| r.get(0)).unwrap();
        assert!(!raw.contains("HELD-SECRET") && raw.contains("B 오프라인"), "{raw}");
    }
    // The sealed snapshot is exactly B's offline body.
    for app in [&p.a, &p.b] {
        app.execute(json!({"op":"vault_unlock","password":"pw-h"}));
        let body = call(app, json!({"op":"vault_versions","action":"body","id":n["id"],"history_id":vid}));
        assert_eq!(body["content"], "<p>HELD-SECRET</p>");
    }
}

#[test]
fn offline_snapshot_versus_lock_with_keys_on_both() {
    offline_snapshot_versus_lock(true, true, true);
    offline_snapshot_versus_lock(true, true, false);
}

#[test]
fn offline_snapshot_versus_lock_with_key_only_on_locker() {
    offline_snapshot_versus_lock(true, false, true);
    offline_snapshot_versus_lock(true, false, false);
}

#[test]
fn offline_snapshot_versus_lock_with_key_only_on_snapshot_device() {
    offline_snapshot_versus_lock(false, true, true);
    offline_snapshot_versus_lock(false, true, false);
}

#[test]
fn offline_snapshot_versus_lock_without_keys_waits_then_resolves_after_unlock() {
    offline_snapshot_versus_lock(false, false, true);
    offline_snapshot_versus_lock(false, false, false);
}
