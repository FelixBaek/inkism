use inkism_engine::Engine;
use serde_json::{json,Value};
fn ok(value:Value)->Value{assert_eq!(value["ok"],true,"{value}");value["data"].clone()}
#[test]
fn imported_redirect_remaps_both_ids_and_invalid_input_rolls_back(){
 let root=std::env::temp_dir().join(format!("inkism-redirect-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&root).unwrap();
 {
 let source=Engine::open(root.join("source.db").to_str().unwrap()).unwrap();
 let a=ok(source.execute(json!({"op":"save","note":{"title":"merge source","content":"one","content_format":"text"}})));
 let b=ok(source.execute(json!({"op":"save","note":{"title":"merge target","content":"two","content_format":"text"}})));
 ok(source.execute(json!({"op":"merge_notes","source_id":a["id"],"target_id":b["id"],"source_revision":a["revision"],"target_revision":b["revision"]})));
 let path=root.join("backup.json");ok(source.execute(json!({"op":"export","path":path})));
 let backup:Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();assert_eq!(backup["merge_redirects"].as_array().unwrap().len(),1);
 let dest=Engine::open(root.join("dest.db").to_str().unwrap()).unwrap();ok(dest.execute(json!({"op":"import","path":path})));
 let conn=dest.connection();let new_a:String=conn.query_row("SELECT id FROM notes_meta WHERE title='merge source'",[],|r|r.get(0)).unwrap();let new_b:String=conn.query_row("SELECT id FROM notes_meta WHERE title='merge target'",[],|r|r.get(0)).unwrap();
 let resolved=ok(dest.execute(json!({"op":"link_resolve","target":format!("note://{new_a}")})));assert_eq!(resolved["items"][0]["id"],new_b);assert_eq!(resolved["redirected"],true);
 let mut invalid=backup;invalid["merge_redirects"][0]["target_id"]=json!("missing-note");std::fs::write(&path,serde_json::to_vec(&invalid).unwrap()).unwrap();assert_eq!(dest.execute(json!({"op":"import","path":path}))["ok"],false);
 let count:i64=conn.query_row("SELECT COUNT(*) FROM notes_meta",[],|r|r.get(0)).unwrap();assert_eq!(count,2,"invalid redirect import must roll back notes");
 }std::fs::remove_dir_all(root).unwrap();
}
