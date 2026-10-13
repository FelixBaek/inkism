use inkism_runtime::AppCore;use serde_json::{json,Value};
fn ok(a:&AppCore,v:Value)->Value{let r=a.execute(v);assert_eq!(r["ok"],true,"{r}");r["data"].clone()}
#[test]
fn named_versions_encrypt_compare_restore_backup_and_unlock(){
 let dir=tempfile::tempdir().unwrap();let path=dir.path().join("notes.db");let a=AppCore::open(path.to_str().unwrap()).unwrap();
 let n=ok(&a,json!({"op":"save","note":{"title":"visible title","content":"SECRET named body","text":"SECRET named body"}}));
 ok(&a,json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"Release"}));
 let n=ok(&a,json!({"op":"save","note":{"id":n["id"],"revision":n["revision"],"title":"visible title","content":"CURRENT secret","text":"CURRENT secret"}}));
 ok(&a,json!({"op":"vault_create","password":"password"}));let locked=ok(&a,json!({"op":"vault_lock_note","id":n["id"],"revision":n["revision"]}));
 let c=rusqlite::Connection::open(&path).unwrap();let history:i64=c.query_row("SELECT count(*) FROM history WHERE note_id=?1",[n["id"].as_str().unwrap()],|r|r.get(0)).unwrap();assert_eq!(history,0);
 let encrypted:String=c.query_row("SELECT data FROM encrypted_named_versions WHERE note_id=?1",[n["id"].as_str().unwrap()],|r|r.get(0)).unwrap();assert!(!encrypted.contains("SECRET named body"));
 let versions=ok(&a,json!({"op":"vault_versions","id":n["id"]}));let hid=&versions["items"][0]["id"];assert_eq!(versions["items"][0]["label"],"Release");assert!(versions["items"][0].get("locked_body").is_none());
 assert_eq!(ok(&a,json!({"op":"vault_versions","action":"body","id":n["id"],"history_id":hid}))["content"],"SECRET named body");
 let restored=ok(&a,json!({"op":"vault_versions","action":"restore","id":n["id"],"revision":locked["revision"],"history_id":hid,"expected_label":"Release"}));assert_eq!(ok(&a,json!({"op":"vault_open","id":n["id"]}))["content"],"SECRET named body");
 let backup=dir.path().join("backup.json");ok(&a,json!({"op":"export","path":backup}));let raw=std::fs::read_to_string(&backup).unwrap();assert!(!raw.contains("SECRET named body")&&!raw.contains("CURRENT secret"));assert!(raw.contains("encrypted_named_versions"));
 ok(&a,json!({"op":"vault_lock"}));assert_eq!(a.execute(json!({"op":"vault_versions","id":n["id"]}))["ok"],false);assert_eq!(a.execute(json!({"op":"vault_versions","action":"body","id":n["id"],"history_id":hid}))["ok"],false);
 let b=AppCore::open(dir.path().join("restored.db").to_str().unwrap()).unwrap();ok(&b,json!({"op":"import","path":backup}));let items=ok(&b,json!({"op":"list","view":"all"}));let id=&items["items"][0]["id"];ok(&b,json!({"op":"vault_unlock","password":"password"}));let history=ok(&b,json!({"op":"vault_versions","id":id}));assert_eq!(history["items"].as_array().unwrap().len(),2);
 let release=history["items"].as_array().unwrap().iter().find(|v|v["label"]=="Release").unwrap();assert_eq!(ok(&b,json!({"op":"vault_versions","action":"body","id":id,"history_id":release["id"]}))["content"],"SECRET named body");
 ok(&b,json!({"op":"vault_unlock_note","id":id,"revision":items["items"][0]["revision"]}));let plain=ok(&b,json!({"op":"history","id":id}));assert_eq!(plain.as_array().unwrap().len(),2);let release=plain.as_array().unwrap().iter().find(|v|v["label"]=="Release").unwrap();assert_eq!(ok(&b,json!({"op":"history_body","id":id,"history_id":release["id"]}))["content"],"SECRET named body");
 assert!(restored["revision"].as_i64().unwrap()>locked["revision"].as_i64().unwrap());
}

/// A snapshot that stays sealed under a note that is no longer locked (as a
/// sync can leave it) is named by `history_sealed` without plaintext, and the
/// recovery path the history explains (lock the note again, then unlock it)
/// brings it back as a plain named version byte for byte.
#[test]
fn sealed_version_under_plain_note_is_listed_and_recovered_by_relock(){
 let dir=tempfile::tempdir().unwrap();let path=dir.path().join("notes.db");let a=AppCore::open(path.to_str().unwrap()).unwrap();
 let n=ok(&a,json!({"op":"save","note":{"title":"t","content":"<p>SEALED-ORIGINAL</p>","text":"SEALED-ORIGINAL"}}));
 ok(&a,json!({"op":"history_name_current","id":n["id"],"revision":n["revision"],"label":"Sealed"}));
 ok(&a,json!({"op":"vault_create","password":"password"}));
 let rev=|a:&AppCore|ok(a,json!({"op":"list","view":"all"}))["items"][0]["revision"].clone();
 ok(&a,json!({"op":"vault_lock_note","id":n["id"],"revision":rev(&a)}));
 let id=n["id"].as_str().unwrap();
 let c=rusqlite::Connection::open(&path).unwrap();
 let (hid,data):(String,String)=c.query_row("SELECT id,data FROM encrypted_named_versions WHERE note_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
 ok(&a,json!({"op":"vault_unlock_note","id":id,"revision":rev(&a)}));
 // Put the sealed row back under the now plain note.
 c.execute("DELETE FROM history WHERE id=?1",[&hid]).unwrap();
 c.execute("INSERT INTO encrypted_named_versions(id,note_id,data) VALUES(?1,?2,?3)",rusqlite::params![hid,id,data]).unwrap();
 let plain=ok(&a,json!({"op":"history","id":id}));assert!(plain.as_array().unwrap().iter().all(|h|h["id"]!=hid.as_str()),"{plain}");
 let sealed=ok(&a,json!({"op":"history_sealed","id":id}));
 assert_eq!(sealed,json!([{"id":hid,"label":"Sealed","title":"t","created_at":sealed[0]["created_at"]}]));
 assert!(!sealed.to_string().contains("SEALED-ORIGINAL")&&!sealed.to_string().contains("ciphertext"));
 // Recovery: lock again, read it in the vault, unlock: back as plain history.
 ok(&a,json!({"op":"vault_lock_note","id":id,"revision":rev(&a)}));
 let v=ok(&a,json!({"op":"vault_versions","id":id}));assert!(v["items"].as_array().unwrap().iter().any(|x|x["id"]==hid.as_str()),"{v}");
 assert_eq!(ok(&a,json!({"op":"vault_versions","action":"body","id":id,"history_id":hid}))["content"],"<p>SEALED-ORIGINAL</p>");
 ok(&a,json!({"op":"vault_unlock_note","id":id,"revision":rev(&a)}));
 assert_eq!(ok(&a,json!({"op":"history_sealed","id":id})),json!([]));
 assert_eq!(ok(&a,json!({"op":"history_body","id":id,"history_id":hid}))["content"],"<p>SEALED-ORIGINAL</p>");
}
