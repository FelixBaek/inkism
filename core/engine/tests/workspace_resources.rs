use inkism_engine::Engine;use serde_json::{json,Value};
fn ok(v:Value)->Value{assert_eq!(v["ok"],true,"{v}");v["data"].clone()}
#[test]
fn font_and_workspace_backup_preserve_bytes_and_remap_note_references(){
 let dir=std::env::temp_dir().join(format!("inkism-resources-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&dir).unwrap();
 {let engine=Engine::open(dir.join("one.db").to_str().unwrap()).unwrap();let note=ok(engine.execute(json!({"op":"save","note":{"title":"canvas note","content":"source"}})));
 ok(engine.execute(json!({"op":"font_resource_set","id":"test-font","version":0,"family":"Test Font","data":"data:font/woff2;base64,d09GMg=="})));
 assert_eq!(engine.execute(json!({"op":"font_resource_set","id":"test-font","version":0,"family":"wrong","data":"data:font/woff2;base64,d09GMg=="}))["ok"],false);
 let font=ok(engine.execute(json!({"op":"font_resources"})));assert_eq!(font["items"][0]["data"],"data:font/woff2;base64,d09GMg==");
 ok(engine.execute(json!({"op":"workspace_tools_set","canvas":{"version":1,"nodes":[{"id":"card","kind":"note","noteId":note["id"],"title":"canvas note","x":10,"y":20,"width":220,"height":130}],"edges":[]},"bookmarks":{"version":1,"bookmarks":[{"id":"bookmark","noteId":note["id"],"title":"canvas note","createdAt":1}],"groups":[]},"expected_updated_at":{"workspace_canvas":0,"workspace_bookmarks":0}})));
 let path=dir.join("backup.json");ok(engine.execute(json!({"op":"export","path":path})));
 let other=Engine::open(dir.join("two.db").to_str().unwrap()).unwrap();ok(other.execute(json!({"op":"import","path":path})));
 let fonts=ok(other.execute(json!({"op":"font_resources"})));assert_eq!(fonts["items"][0]["data"],font["items"][0]["data"]);
 let workspace=ok(other.execute(json!({"op":"workspace_tools_get"})));let new_id=&workspace["canvas"]["value"]["nodes"][0]["noteId"];assert_ne!(new_id,&note["id"]);assert_eq!(workspace["bookmarks"]["value"]["bookmarks"][0]["noteId"],*new_id);assert_eq!(ok(other.execute(json!({"op":"get","id":new_id})))["content"],"source");
 }std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn two_surface_write_rolls_back_if_second_revision_conflicts(){
 let dir=std::env::temp_dir().join(format!("inkism-workspace-atomic-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&dir).unwrap();let engine=Engine::open(dir.join("atomic.db").to_str().unwrap()).unwrap();
 let initial=ok(engine.execute(json!({"op":"workspace_tools_set","canvas":{"version":1,"nodes":[],"edges":[]},"bookmarks":{"version":1,"bookmarks":[],"groups":[]}})));
 let failed=engine.execute(json!({"op":"workspace_tools_set","canvas":{"version":1,"nodes":[{"id":"x","kind":"text","text":"must roll back","x":0,"y":0,"width":200,"height":100}],"edges":[]},"bookmarks":{"version":1,"bookmarks":[],"groups":[]},"expected_updated_at":{"workspace_canvas":initial["canvas"]["updated_at"],"workspace_bookmarks":0}}));
 assert_eq!(failed["ok"],false);assert_eq!(ok(engine.execute(json!({"op":"workspace_tools_get"}))),initial);drop(engine);std::fs::remove_dir_all(dir).unwrap();
}
