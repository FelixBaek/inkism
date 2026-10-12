use inkism_engine::Engine;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
fn ok(v:Value)->Value{assert_eq!(v["ok"],true,"{v}");v["data"].clone()}
#[test]
fn external_save_never_resurrects_deleted_note_or_accepts_replaced_source(){
 let path=std::env::temp_dir().join(format!("inkism-portable-guard-{}.db",uuid::Uuid::new_v4()));
 {let engine=Engine::open(path.to_str().unwrap()).unwrap();let original="\u{feff}# Original\r\n";
 let note=ok(engine.execute(json!({"op":"save","note":{"title":"Guard","content":original,"content_format":"markdown"}})));
 let update=json!({"op":"save","note":{"id":note["id"],"revision":1,"title":"Guard","content":"Edited","content_format":"markdown","require_existing":true,"expected_source_sha256":format!("{:x}",Sha256::digest(original.as_bytes()))}});
 let mut wrong=update.clone();wrong["note"]["expected_source_sha256"]=json!("0".repeat(64));assert_eq!(engine.execute(wrong)["ok"],false);assert_eq!(ok(engine.execute(json!({"op":"get","id":note["id"]})))["content"],original);
 let changed=ok(engine.execute(update.clone()));assert_eq!(changed["content"],"Edited");assert_eq!(engine.execute(update.clone())["ok"],false,"stale revision rejected");
 ok(engine.execute(json!({"op":"patch","id":note["id"],"revision":changed["revision"],"changes":{"trashed":true}})));ok(engine.execute(json!({"op":"delete","id":note["id"]})));
 assert_eq!(engine.execute(update.clone())["ok"],false);assert_eq!(engine.execute(json!({"op":"get","id":note["id"]}))["ok"],false,"deleted note stays deleted");
 let recreated=ok(engine.execute(json!({"op":"save","note":{"id":note["id"],"title":"Replacement","content":"Different source","content_format":"markdown"}})));assert_eq!(recreated["revision"],1);assert_eq!(engine.execute(update)["ok"],false,"same ID/revision with a new source is rejected");
 assert_eq!(ok(engine.execute(json!({"op":"get","id":note["id"]})))["content"],"Different source");
 }
 for suffix in ["","-wal","-shm",".search",".search-wal",".search-shm"]{let _=std::fs::remove_file(format!("{}{suffix}",path.display()));}
}
#[test]
fn bounded_portable_snapshot_preserves_previous_destination_and_removes_partial_file(){
 let dir=std::env::temp_dir().join(format!("inkism-portable-limit-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&dir).unwrap();let path=dir.join("notes.db");let dest=dir.join("backup.json");
 {let engine=Engine::open(path.to_str().unwrap()).unwrap();ok(engine.execute(json!({"op":"save","note":{"title":"one","content":"x".repeat(10000)}})));ok(engine.execute(json!({"op":"save","note":{"title":"two","content":"body"}})));
 std::fs::write(&dest,"previous").unwrap();assert_eq!(engine.execute(json!({"op":"export","path":dest,"max_bytes":500}))["ok"],false);assert_eq!(std::fs::read_to_string(&dest).unwrap(),"previous");assert!(!std::fs::read_dir(&dir).unwrap().any(|entry|entry.unwrap().file_name().to_string_lossy().contains("notes-tmp")));
 assert_eq!(engine.execute(json!({"op":"export","path":dest,"max_notes":1}))["ok"],false);assert_eq!(std::fs::read_to_string(&dest).unwrap(),"previous");
 ok(engine.execute(json!({"op":"export","path":dest})));assert!(std::fs::metadata(&dest).unwrap().len()>500);
 }std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn portable_creation_and_trash_guards_preserve_existing_or_protected_notes() {
 let path=std::env::temp_dir().join(format!("inkism-portable-create-{}.db",uuid::Uuid::new_v4()));
 {let engine=Engine::open(path.to_str().unwrap()).unwrap();
 let create=json!({"op":"save","note":{"id":"portable-new","title":"Original","content":"body","require_absent":true}});
 let note=ok(engine.execute(create.clone()));
 assert_eq!(engine.execute(create)["ok"],false);
 assert_eq!(engine.execute(json!({"op":"patch","id":note["id"],"revision":note["revision"],"require_editable":true,"expected_source_sha256":"0".repeat(64),"changes":{"trashed":true}}))["ok"],false);
 let protected=ok(engine.execute(json!({"op":"patch","id":note["id"],"revision":note["revision"],"changes":{"readonly":true}})));
 assert_eq!(engine.execute(json!({"op":"patch","id":note["id"],"revision":protected["revision"],"require_editable":true,"changes":{"trashed":true}}))["ok"],false);
 let current=ok(engine.execute(json!({"op":"get","id":note["id"]})));
 assert_eq!(current["trashed"],false);assert_eq!(current["title"],"Original");
 assert_eq!(engine.execute(json!({"op":"patch","id":"missing","require_editable":true,"changes":{"trashed":true}}))["ok"],false);
 }
 for suffix in ["","-wal","-shm",".search",".search-wal",".search-shm"] {let _=std::fs::remove_file(format!("{}{suffix}",path.display()));}
}
