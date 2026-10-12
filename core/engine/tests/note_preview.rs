use inkism_engine::Engine;
use serde_json::{json,Value};
fn ok(v:Value)->Value {assert_eq!(v["ok"],true,"{v}");v["data"].clone()}
#[test]
fn preview_is_bounded_metadata_only_and_denies_hidden_notes(){
 let dir=std::env::temp_dir().join(format!("inkism-preview-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&dir).unwrap();let path=dir.join("notes.db");let engine=Engine::open(path.to_str().unwrap()).unwrap();
 let note=ok(engine.execute(json!({"op":"save","note":{"title":"한".repeat(1000),"content":"본문😀".repeat(200000),"content_format":"text"}})));
 let preview=ok(engine.execute(json!({"op":"note_preview","id":note["id"]})));
 assert_eq!(preview["title"].as_str().unwrap().chars().count(),240);assert!(preview["preview"].as_str().unwrap().chars().count()<=240);assert!(serde_json::to_vec(&preview).unwrap().len()<2500);assert!(preview.get("content").is_none());
 let db=rusqlite::Connection::open(&path).unwrap();db.execute("DELETE FROM notes_body WHERE note_id=?1",[note["id"].as_str().unwrap()]).unwrap();
 assert_eq!(ok(engine.execute(json!({"op":"note_preview","id":note["id"]}))),preview,"preview must remain independent of body storage");
 for field in ["locked","trashed"] {db.execute(&format!("UPDATE notes_meta SET {field}=1 WHERE id=?1"),[note["id"].as_str().unwrap()]).unwrap();assert_eq!(engine.execute(json!({"op":"note_preview","id":note["id"]}))["ok"],false);db.execute(&format!("UPDATE notes_meta SET {field}=0 WHERE id=?1"),[note["id"].as_str().unwrap()]).unwrap();}
 assert_eq!(engine.execute(json!({"op":"note_preview","id":"missing"}))["ok"],false);drop(db);drop(engine);let _=std::fs::remove_dir_all(dir);
}

#[test]
fn bounded_get_checks_combined_utf8_body_size_and_visibility() {
 let dir=std::env::temp_dir().join(format!("inkism-bounded-get-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&dir).unwrap();let path=dir.join("notes.db");let engine=Engine::open(path.to_str().unwrap()).unwrap();
 let note=ok(engine.execute(json!({"op":"save","note":{"title":"budget","content":"한😀","text":"한😀","content_format":"text"}})));
 let id=note["id"].as_str().unwrap();
 let loaded=ok(engine.execute(json!({"op":"get","id":id})));
 let bytes=loaded["content"].as_str().unwrap().len()+loaded["text"].as_str().unwrap().len();
 assert_eq!(ok(engine.execute(json!({"op":"get","id":id,"max_body_bytes":bytes}))),loaded);
 assert_eq!(engine.execute(json!({"op":"get","id":id,"max_body_bytes":bytes-1}))["ok"],false);
 for invalid in [json!(0),json!(-1),json!(1.5),json!("100"),json!(67108865),Value::Null] {assert_eq!(engine.execute(json!({"op":"get","id":id,"max_body_bytes":invalid}))["ok"],false);}
 let db=rusqlite::Connection::open(&path).unwrap();
 for field in ["locked","trashed"] {db.execute(&format!("UPDATE notes_meta SET {field}=1 WHERE id=?1"),[id]).unwrap();assert_eq!(engine.execute(json!({"op":"get","id":id,"max_body_bytes":1024}))["ok"],false);db.execute(&format!("UPDATE notes_meta SET {field}=0 WHERE id=?1"),[id]).unwrap();}
 assert_eq!(ok(engine.execute(json!({"op":"get","id":id}))),loaded,"failed bounded reads must leave connection usable");
 drop(db);drop(engine);let _=std::fs::remove_dir_all(dir);
}

#[test]
fn random_discovery_excludes_protected_and_trashed_notes() {
 let dir=std::env::temp_dir().join(format!("inkism-random-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&dir).unwrap();let path=dir.join("notes.db");let engine=Engine::open(path.to_str().unwrap()).unwrap();
 assert!(ok(engine.execute(json!({"op":"random_note"})))["id"].is_null());
 let visible=ok(engine.execute(json!({"op":"save","note":{"title":"visible","content":""}})));
 let hidden=ok(engine.execute(json!({"op":"save","note":{"title":"hidden","content":""}})));
 let db=rusqlite::Connection::open(&path).unwrap();
 for field in ["locked","trashed"] {
  db.execute(&format!("UPDATE notes_meta SET locked=0,trashed=0,{field}=1 WHERE id=?1"),[hidden["id"].as_str().unwrap()]).unwrap();
  for _ in 0..20 {assert_eq!(ok(engine.execute(json!({"op":"random_note"})))["id"],visible["id"]);}
 }
 drop(db);drop(engine);let _=std::fs::remove_dir_all(dir);
}
