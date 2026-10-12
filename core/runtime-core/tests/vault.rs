//! Note vault: create, lock a note (plaintext copies removed, plain edits
//! refused), open/save/unlock with the in-memory key, wrong password, password
//! change, and a backup that carries ciphertext plus wrapped keys.
use inkism_runtime::AppCore;
use serde_json::{json, Value};

fn call(app: &AppCore, req: Value) -> Value {
    let resp = app.execute(req);
    assert!(resp["ok"].as_bool().unwrap_or(false), "rpc failed: {resp}");
    resp["data"].clone()
}

#[test]
fn vault_locks_opens_and_unlocks_notes() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppCore::open(dir.path().join("a.db").to_str().unwrap()).unwrap();
    let note = call(&app, json!({"op":"save","note":{"title":"비밀","content":"<p>내용😀</p>","text":"내용😀"}}));
    call(&app, json!({"op":"vault_create","password":"pw-1"}));
    let locked = call(&app, json!({"op":"vault_lock_note","id":note["id"],"revision":note["revision"]}));
    assert_eq!(locked["locked"], true);
    let plain = call(&app, json!({"op":"get","id":note["id"]}));
    assert_eq!((plain["content"].as_str(), plain["text"].as_str()), (Some(""), Some("")));
    assert_eq!(app.execute(json!({"op":"save","note":{"id":note["id"],"revision":locked["revision"],"title":"x","content":"<p>평문</p>","text":"평문"}}))["ok"], false);

    let opened = call(&app, json!({"op":"vault_open","id":note["id"]}));
    assert_eq!(opened["text"], "내용😀");
    let saved = call(&app, json!({"op":"vault_save","id":note["id"],"revision":locked["revision"],"title":"새 제목","content":"<p>수정</p>","text":"수정"}));

    // Backup keeps ciphertext and the wrapped key, never the plaintext.
    let path = dir.path().join("backup.json");
    call(&app, json!({"op":"export","path":path.to_string_lossy()}));
    let backup = std::fs::read_to_string(&path).unwrap();
    assert!(!backup.contains("수정") && backup.contains("vault_keys"));

    call(&app, json!({"op":"vault_lock"}));
    assert_eq!(app.execute(json!({"op":"vault_open","id":note["id"]}))["ok"], false);
    assert_eq!(app.execute(json!({"op":"vault_unlock","password":"wrong"}))["ok"], false);
    call(&app, json!({"op":"vault_change_password","old_password":"pw-1","new_password":"pw-2"}));
    call(&app, json!({"op":"vault_unlock","password":"pw-2"}));
    let unlocked = call(&app, json!({"op":"vault_unlock_note","id":note["id"],"revision":saved["revision"]}));
    assert_eq!(unlocked["locked"], false);
    assert_eq!(call(&app, json!({"op":"get","id":note["id"]}))["text"], "수정");
    call(&app, json!({"op":"vault_clear"}));
    call(&app, json!({"op":"vault_delete"}));
    assert_eq!(call(&app, json!({"op":"vault_status"}))["exists"], false);

    // A fresh library restores the locked note and opens it with the password.
    let other = AppCore::open(dir.path().join("b.db").to_str().unwrap()).unwrap();
    call(&other, json!({"op":"import","path":path.to_string_lossy()}));
    call(&other, json!({"op":"vault_unlock","password":"pw-1"}));
    let items = call(&other, json!({"op":"list","view":"all"}))["items"].clone();
    let id = items[0]["id"].clone();
    assert_eq!(call(&other, json!({"op":"vault_open","id":id}))["text"], "수정");
}
