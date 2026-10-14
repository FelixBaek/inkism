use inkism_engine::Engine;
use serde_json::{json,Value};
fn ok(v:Value)->Value {assert_eq!(v["ok"],true,"{v}");v["data"].clone()}
#[test]
fn change_feed_pages_every_row_in_update_order(){
 let dir=std::env::temp_dir().join(format!("inkism-changes-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&dir).unwrap();let engine=Engine::open(dir.join("notes.db").to_str().unwrap()).unwrap();
 let ids:Vec<String>=(0..3).map(|i|{let n=ok(engine.execute(json!({"op":"save","note":{"title":format!("n{i}"),"content":"x","content_format":"text"}})));std::thread::sleep(std::time::Duration::from_millis(2));n["id"].as_str().unwrap().to_string()}).collect();
 let page=ok(engine.execute(json!({"op":"changes","limit":2})));
 assert_eq!(page["items"].as_array().unwrap().iter().map(|n|n["id"].as_str().unwrap()).collect::<Vec<_>>(),[ids[0].as_str(),ids[1].as_str()]);
 assert_eq!(page["has_more"],true);
 let rest=ok(engine.execute(json!({"op":"changes","cursor":page["next_cursor"]})));
 assert_eq!(rest["items"].as_array().unwrap().len(),1);assert_eq!(rest["has_more"],false);
 let idle=ok(engine.execute(json!({"op":"changes","cursor":rest["next_cursor"]})));
 assert!(idle["items"].as_array().unwrap().is_empty());assert_eq!(idle["next_cursor"],rest["next_cursor"],"empty page keeps the cursor");
 // A pinned or trashed note still moves to the end of the feed, flags included.
 ok(engine.execute(json!({"op":"patch","id":ids[0],"changes":{"trashed":true}})));
 let moved=ok(engine.execute(json!({"op":"changes","cursor":rest["next_cursor"]})));
 assert_eq!(moved["items"][0]["id"],ids[0].as_str());assert_eq!(moved["items"][0]["trashed"],true);
 for bad in ["x","1:bad id","abc:"] {assert_eq!(engine.execute(json!({"op":"changes","cursor":bad}))["ok"],false,"{bad}");}
 drop(engine);let _=std::fs::remove_dir_all(dir);
}
