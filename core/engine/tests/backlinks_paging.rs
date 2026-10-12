use inkism_engine::Engine;
use serde_json::{json,Value};
fn ok(v:Value)->Value{assert_eq!(v["ok"],true,"{v}");v["data"].clone()}
#[test]
fn stable_pages_survive_edits_and_hide_deleted_locked_sources(){
 let dir=std::env::temp_dir().join(format!("inkism-backlinks-pages-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("notes.db");
 {let e=Engine::open(path.to_str().unwrap()).unwrap();let target=ok(e.execute(json!({"op":"save","note":{"title":"Destination","content":"<p>target</p>","content_format":"html"}})));
 let mut sources=Vec::new();for i in 0..125 {sources.push(ok(e.execute(json!({"op":"save","note":{"title":format!("Source {i}"),"content":format!("<p><a href=\"note://{}\">destination</a></p>",target["id"].as_str().unwrap()),"content_format":"html"}}))));}ok(e.execute(json!({"op":"wait_index"})));
 let first=ok(e.execute(json!({"op":"backlinks","id":target["id"],"limit":50})));assert_eq!(first["items"].as_array().unwrap().len(),50);assert!(first["next_cursor"].is_string());
 let mut ids:Vec<String>=first["items"].as_array().unwrap().iter().map(|n|n["id"].as_str().unwrap().into()).collect();
 let later:Vec<_>=sources.iter().filter(|s|!ids.contains(&s["id"].as_str().unwrap().to_string())).collect();
 ok(e.execute(json!({"op":"patch","id":later[0]["id"],"changes":{"trashed":true}})));
 let db=rusqlite::Connection::open(&path).unwrap();db.execute("UPDATE notes_meta SET locked=1 WHERE id=?1",[later[1]["id"].as_str().unwrap()]).unwrap();
 // An edit moves updated_at, but must not move the pagination key.
 ok(e.execute(json!({"op":"patch","id":ids[0],"revision":first["items"][0]["revision"],"changes":{"title":"Edited first page"}})));
 let mut cursor=first["next_cursor"].clone();while cursor.is_string(){let page=ok(e.execute(json!({"op":"backlinks","id":target["id"],"limit":50,"cursor":cursor})));for n in page["items"].as_array().unwrap(){assert!(n.get("content").is_none());let id=n["id"].as_str().unwrap().to_string();assert!(!ids.contains(&id));ids.push(id);}cursor=page["next_cursor"].clone();}
 assert_eq!(ids.len(),123);assert!(!ids.contains(&later[0]["id"].as_str().unwrap().to_string()));assert!(!ids.contains(&later[1]["id"].as_str().unwrap().to_string()));
 let big_content=format!("<p>{}</p><p><a href=\"note://{}\">Exact target</a></p>","padding ".repeat(300000),target["id"].as_str().unwrap());
 let big=ok(e.execute(json!({"op":"save","note":{"title":"Large","content":big_content,"content_format":"html"}})));ok(e.execute(json!({"op":"wait_index"})));
 let fragments=ok(e.execute(json!({"op":"backlink_blocks","id":big["id"],"target":target["id"],"revision":big["revision"]})));
 assert_eq!(fragments["ready"],true);assert_eq!(fragments["items"].as_array().unwrap().len(),1);assert!(fragments["items"][0]["byte_offset"].as_i64().unwrap()>2*1024*1024);assert!(fragments["items"][0]["html"].as_str().unwrap().len()<65536);
 assert_eq!(e.execute(json!({"op":"backlink_blocks","id":big["id"],"target":target["id"],"revision":9999}))["ok"],false);
 db.execute("UPDATE notes_meta SET locked=1 WHERE id=?1",[big["id"].as_str().unwrap()]).unwrap();assert_eq!(e.execute(json!({"op":"backlink_blocks","id":big["id"],"target":target["id"],"revision":big["revision"]}))["ok"],false);
 let links=sources.iter().map(|n|format!("<p><a href=\"note://{}\">target</a></p>",n["id"].as_str().unwrap())).collect::<String>();
 let outgoing=ok(e.execute(json!({"op":"save","note":{"title":"Outgoing","content":links,"content_format":"html"}})));ok(e.execute(json!({"op":"wait_index"})));
 let mut next=Value::Null;let mut all=std::collections::HashSet::new();loop{let page=ok(e.execute(json!({"op":"outgoing_links","id":outgoing["id"],"revision":outgoing["revision"],"cursor":next})));assert_eq!(page["ready"],true);let items=page["items"].as_array().unwrap();assert!(items.len()<=20);for item in items{assert!(all.insert(item.as_str().unwrap().to_string()));}next=page["next_cursor"].clone();if next.is_null(){break;}}assert_eq!(all.len(),125);
 assert_eq!(e.execute(json!({"op":"outgoing_links","id":outgoing["id"],"revision":9999}))["ok"],false);
 db.execute("UPDATE notes_meta SET locked=1 WHERE id=?1",[outgoing["id"].as_str().unwrap()]).unwrap();assert_eq!(e.execute(json!({"op":"outgoing_links","id":outgoing["id"],"revision":outgoing["revision"]}))["ok"],false);
 let md_body=format!("```\n[False](note://{})\n```\n{}\n[Exact **MD** target](note://{})\n",target["id"].as_str().unwrap(),"padding ".repeat(300000),target["id"].as_str().unwrap());
 let md=ok(e.execute(json!({"op":"save","note":{"title":"Large MD","content":md_body,"content_format":"markdown"}})));ok(e.execute(json!({"op":"wait_index"})));
 let location=ok(e.execute(json!({"op":"backlink_location","id":md["id"],"target":target["id"],"revision":md["revision"]})));assert_eq!(location["ready"],true);assert_eq!(location["item"]["label"],"Exact MD target");let begin=location["item"]["byte_offset"].as_u64().unwrap()as usize;let end=location["item"]["byte_end"].as_u64().unwrap()as usize;assert!(begin>2*1024*1024);assert_eq!(&md_body[begin..end],"Exact **MD** target");
 assert_eq!(e.execute(json!({"op":"backlink_location","id":md["id"],"target":target["id"],"revision":9999}))["ok"],false);
 db.execute("UPDATE notes_meta SET locked=1 WHERE id=?1",[md["id"].as_str().unwrap()]).unwrap();assert_eq!(e.execute(json!({"op":"backlink_location","id":md["id"],"target":target["id"],"revision":md["revision"]}))["ok"],false);
 db.execute("UPDATE notes_meta SET locked=1 WHERE id=?1",[target["id"].as_str().unwrap()]).unwrap();assert!(ok(e.execute(json!({"op":"backlinks","id":target["id"]})))["items"].as_array().unwrap().is_empty());
 assert_eq!(e.execute(json!({"op":"backlinks","id":target["id"],"cursor":"invalid"}))["ok"],false);
 }let _=std::fs::remove_dir_all(dir);
}

#[test]
fn markdown_location_upgrade_rebuilds_only_derived_index(){
 let dir=std::env::temp_dir().join(format!("inkism-backlink-upgrade-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("notes.db");let target;let source;let body;
 {let e=Engine::open(path.to_str().unwrap()).unwrap();target=ok(e.execute(json!({"op":"save","note":{"title":"Target","content":"","content_format":"markdown"}})));body=format!("before\n\n[Caption](note://{})\n",target["id"].as_str().unwrap());source=ok(e.execute(json!({"op":"save","note":{"title":"Source","content":body,"content_format":"markdown"}})));ok(e.execute(json!({"op":"wait_index"})));}
 {let search=rusqlite::Connection::open(format!("{}.search",path.display())).unwrap();search.execute_batch("DROP TABLE backlink_locations; PRAGMA user_version=10;").unwrap();}
 {let e=Engine::open(path.to_str().unwrap()).unwrap();ok(e.execute(json!({"op":"wait_index"})));let result=ok(e.execute(json!({"op":"backlink_location","id":source["id"],"target":target["id"],"revision":source["revision"]})));assert_eq!(result["item"]["label"],"Caption");let after=ok(e.execute(json!({"op":"get","id":source["id"]})));assert_eq!(after["content"],body);assert_eq!(after["revision"],source["revision"]);}
 let _=std::fs::remove_dir_all(dir);
}
