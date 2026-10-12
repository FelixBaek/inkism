//! Durable canvas/bookmark workspace state. Notes remain canonical in notes_meta/body;
//! these rows only contain layout and navigation metadata and are version checked.
use crate::{error::{EngineError, Result}, settings};
use rusqlite::Connection;
use serde_json::{json, Value};

pub const CANVAS_KEY: &str = "workspace_canvas";
pub const WHITEBOARD_KEY: &str = "workspace_whiteboard";
pub const BOOKMARKS_KEY: &str = "workspace_bookmarks";
const MAX_BYTES: usize = 8 * 1024 * 1024;

fn row(conn: &Connection, key: &str) -> Result<Value> {
    Ok(match settings::stored(conn, key)? {
        Some((Some(value), updated_at)) => json!({"value": serde_json::from_str::<Value>(&value).map_err(|_| EngineError::internal("corrupt workspace data"))?, "updated_at": updated_at}),
        Some((None, updated_at)) => json!({"value": Value::Null, "updated_at": updated_at}),
        None => json!({"value": Value::Null, "updated_at": 0}),
    })
}

pub fn get(conn: &Connection) -> Result<Value> {
    Ok(json!({"canvas": row(conn, CANVAS_KEY)?, "bookmarks": row(conn, BOOKMARKS_KEY)?, "whiteboard": row(conn, WHITEBOARD_KEY)?}))
}

pub fn set(conn: &Connection, args: &Value) -> Result<Value> {
    let canvas = args.get("canvas").filter(|v| !v.is_null());
    let bookmarks = args.get("bookmarks").filter(|v| !v.is_null());
    let whiteboard = args.get("whiteboard").filter(|v| !v.is_null());
    if canvas.is_none() && bookmarks.is_none() && whiteboard.is_none() { return Err(EngineError::invalid("workspace_tools_set needs canvas, bookmarks or whiteboard")); }
    for value in [canvas, bookmarks, whiteboard].into_iter().flatten() {
        let bytes = serde_json::to_vec(value)?.len();
        if bytes > MAX_BYTES { return Err(EngineError::invalid("workspace data is too large")); }
        if !value.is_object() { return Err(EngineError::invalid("workspace data must be an object")); }
    }
    let expected = args.get("expected_updated_at").and_then(Value::as_object);
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<()> {
        for (key, value) in [(CANVAS_KEY, canvas), (BOOKMARKS_KEY, bookmarks), (WHITEBOARD_KEY, whiteboard)] {
            let Some(value) = value else { continue };
            { let expected = expected.and_then(|m| m.get(key)).and_then(Value::as_i64).unwrap_or(0);
                let actual = settings::stored(conn, key)?.map(|(_, at)| at).unwrap_or(0);
                if actual != expected { return Err(EngineError::Conflict(format!("{key} changed"))); }
            }
            let raw = serde_json::to_string(value)?;
            validate(key,&raw)?;
            settings::write_local(conn, key, Some(&raw))?;
        }
        Ok(())
    })();
    match result { Ok(()) => conn.execute_batch("COMMIT;")?, Err(e) => { let _ = conn.execute_batch("ROLLBACK;"); return Err(e); } }
    get(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn groups_restore_and_reject_invalid_styles_without_overwriting() {
        let path=std::env::temp_dir().join(format!("inkism-canvas-group-{}.db",crate::ids::new_id()));
        let c=Connection::open(&path).unwrap();crate::schema::init_main(&c).unwrap();
        let canvas=json!({"version":1,"nodes":[{"id":"g","kind":"group","x":-10,"y":20,"width":600,"height":400,"label":"Group","background":"assets/grid.png","backgroundStyle":"repeat"},{"id":"t","kind":"text","x":30,"y":80,"width":220,"height":130,"text":"kept"}],"edges":[{"id":"e","from":"g","to":"t"}]});
        let saved=set(&c,&json!({"canvas":canvas})).unwrap();let at=saved["canvas"]["updated_at"].clone();drop(c);
        let c=Connection::open(&path).unwrap();assert_eq!(get(&c).unwrap()["canvas"]["value"],canvas);
        for (field,bad) in [("backgroundStyle",json!("execute")),("background",json!({})),("label",json!([])),("width",json!(0))] {
            let mut broken=canvas.clone();broken["nodes"][0][field]=bad;
            assert!(set(&c,&json!({"canvas":broken,"expected_updated_at":{"workspace_canvas":at}})).is_err());
            assert_eq!(get(&c).unwrap()["canvas"]["value"],canvas);
        }
        drop(c);let _=std::fs::remove_file(path);
    }
    #[test]
    fn stores_and_conflict_checks_each_surface() {
        let c = Connection::open_in_memory().unwrap(); crate::schema::init_main(&c).unwrap();
        let first = set(&c, &json!({"canvas":{"version":1,"nodes":[],"edges":[]}})).unwrap();
        let at = first["canvas"]["updated_at"].as_i64().unwrap();
        assert!(set(&c, &json!({"canvas":{"version":1,"nodes":[],"edges":[]},"expected_updated_at":{"workspace_canvas":at}})).is_ok());
        assert!(matches!(set(&c, &json!({"canvas":{"version":1},"expected_updated_at":{"workspace_canvas":at}})), Err(EngineError::Conflict(_))));
    }
}

pub fn is_key(key:&str)->bool{[CANVAS_KEY,BOOKMARKS_KEY,WHITEBOARD_KEY].contains(&key)}
pub fn validate(key:&str,raw:&str)->Result<()> {
 let value:Value=serde_json::from_str(raw)?;
 if raw.len()>MAX_BYTES||value["version"]!=1 {return Err(EngineError::invalid("invalid workspace version or size"));}
 if key==WHITEBOARD_KEY{return validate_whiteboard(&value);}
 let text=|value:&Value,max:usize|required_string(value,max);
 let keys=if key==CANVAS_KEY {["nodes","edges"]}else{["bookmarks","groups"]};
 for name in keys {
  let items=value[name].as_array().filter(|v|v.len()<=1000).ok_or_else(||EngineError::invalid("invalid workspace collection"))?;
  let mut seen=std::collections::HashSet::new();
  for item in items {
   let id=item["id"].as_str().filter(|v|!v.is_empty()&&v.len()<=100).ok_or_else(||EngineError::invalid("invalid workspace item"))?;
   if !seen.insert(id) {return Err(EngineError::invalid("duplicate workspace item"));}
   match name {
    "nodes"=>{
     if !["note","text","file","web","group"].contains(&item["kind"].as_str().unwrap_or(""))||!["x","y","width","height"].iter().all(|field|item[field].as_f64().is_some_and(|v|v.is_finite()&&v.abs()<=1_000_000.0)) {return Err(EngineError::invalid("invalid canvas node"));}
     if ["width","height"].iter().any(|field|item[field].as_f64().unwrap_or(0.0)<=0.0) {return Err(EngineError::invalid("invalid canvas dimensions"));}
     if item["kind"]=="group" {
      for (field,max) in [("label",1000),("background",4000)] {if !item[field].is_null(){text(&item[field],max)?;}}
      if !item["backgroundStyle"].is_null() && !["cover","ratio","repeat"].contains(&item["backgroundStyle"].as_str().unwrap_or("")){return Err(EngineError::invalid("invalid canvas background style"));}
     }
     if item["kind"]=="note" && !item["noteId"].as_str().is_some_and(crate::ids::valid_id) {return Err(EngineError::invalid("invalid canvas note"));}
     if item["kind"]=="file" && !item["attachmentId"].as_str().is_some_and(crate::ids::valid_id) {return Err(EngineError::invalid("invalid canvas attachment"));}
     if item["kind"]=="web" && !item["url"].as_str().is_some_and(|url|url.starts_with("https://")||url.starts_with("http://")) {return Err(EngineError::invalid("invalid canvas web url"));}
     for (field,max) in [("title",1000),("text",100000),("color",100)] {if !item[field].is_null() {text(&item[field],max)?;}}
    },
    "edges"=>{for field in ["from","to"] {text(&item[field],100)?;if !value["nodes"].as_array().unwrap().iter().any(|n|n["id"]==item[field]) {return Err(EngineError::invalid("missing canvas endpoint"));}}if !item["label"].is_null(){text(&item["label"],1000)?;}},
    "bookmarks"=>{if !item["noteId"].as_str().is_some_and(crate::ids::valid_id)||item["createdAt"].as_i64().is_none(){return Err(EngineError::invalid("invalid bookmark"));}text(&item["title"],1000)?;if !item["anchor"].is_null(){text(&item["anchor"],1000)?;}},
    "groups"=>{text(&item["name"],100)?;let ids=item["bookmarkIds"].as_array().filter(|v|v.len()<=1000).ok_or_else(||EngineError::invalid("invalid bookmark group"))?;for id in ids{if !value["bookmarks"].as_array().unwrap().iter().any(|b|&b["id"]==id){return Err(EngineError::invalid("missing bookmark"));}}},_=>{}
   }
  }
 }
 Ok(())
}
fn required_string(value:&Value,max:usize)->Result<()> {if !value.as_str().is_some_and(|s|s.len()<=max){return Err(EngineError::invalid("invalid workspace text"));}Ok(())}
pub fn backup(conn:&Connection)->Result<Value>{let all=get(conn)?;Ok(json!({"canvas":all["canvas"]["value"],"bookmarks":all["bookmarks"]["value"],"whiteboard":all["whiteboard"]["value"]}))}
pub fn import(conn:&Connection,data:&Value,notes:&std::collections::HashMap<&str,String>)->Result<()>{
 if !data["whiteboard"].is_null(){validate(WHITEBOARD_KEY,&data["whiteboard"].to_string())?;let mut current=row(conn,WHITEBOARD_KEY)?["value"].clone();if current.is_null(){current=json!({"version":1,"shapes":[]});}for shape in data["whiteboard"]["shapes"].as_array().unwrap(){let mut shape=shape.clone();shape["id"]=json!(crate::ids::new_id());current["shapes"].as_array_mut().unwrap().push(shape);}validate(WHITEBOARD_KEY,&current.to_string())?;settings::write_local(conn,WHITEBOARD_KEY,Some(&current.to_string()))?;}
 for (field,key,left,right,ref_field) in [("canvas",CANVAS_KEY,"nodes","edges","noteId"),("bookmarks",BOOKMARKS_KEY,"bookmarks","groups","noteId")]{let incoming=&data[field];if incoming.is_null(){continue;}validate(key,&incoming.to_string())?;let mut current=row(conn,key)?["value"].clone();if current.is_null(){current=json!({"version":1,left:[],right:[]});}let mut id_map=std::collections::HashMap::new();for item in incoming[left].as_array().unwrap(){let mut item=item.clone();if let Some(old)=item[ref_field].as_str(){if let Some(new)=notes.get(old){item[ref_field]=json!(new);}else{continue;}}let old=item["id"].as_str().unwrap().to_owned();let new=crate::ids::new_id();item["id"]=json!(new);id_map.insert(old,new);current[left].as_array_mut().unwrap().push(item);}for item in incoming[right].as_array().unwrap(){let mut item=item.clone();item["id"]=json!(crate::ids::new_id());if field=="canvas"{let Some(from)=item["from"].as_str().and_then(|id|id_map.get(id))else{continue};let Some(to)=item["to"].as_str().and_then(|id|id_map.get(id))else{continue};item["from"]=json!(from);item["to"]=json!(to);}else{item["bookmarkIds"]=json!(item["bookmarkIds"].as_array().unwrap().iter().filter_map(|id|id.as_str().and_then(|id|id_map.get(id))).collect::<Vec<_>>());}current[right].as_array_mut().unwrap().push(item);}let raw=current.to_string();validate(key,&raw)?;settings::write_local(conn,key,Some(&raw))?;}Ok(())}

fn validate_whiteboard(value:&Value)->Result<()> {
 let fail=||EngineError::invalid("invalid whiteboard shape");
 let shapes=value["shapes"].as_array().filter(|s|s.len()<=1000).ok_or_else(fail)?;let mut ids=std::collections::HashSet::new();let mut count=0;
 for shape in shapes {
  let id=shape["id"].as_str().filter(|s|!s.is_empty()&&s.len()<=100&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-')).ok_or_else(fail)?;if !ids.insert(id){return Err(fail());}
  let kind=shape["kind"].as_str().filter(|s|["pen","rectangle","ellipse","line","arrow"].contains(s)).ok_or_else(fail)?;
  for field in ["x","y","width","height"]{let number=shape[field].as_f64().filter(|n|n.is_finite()&&n.abs()<=100000.0).ok_or_else(fail)?;if ["width","height"].contains(&field)&&number<1.0{return Err(fail());}}
  shape["stroke"].as_f64().filter(|n|n.is_finite()&&*n>=1.0&&*n<=40.0).ok_or_else(fail)?;
  shape["color"].as_str().filter(|s|s.len()==7&&s.starts_with('#')&&s.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)).ok_or_else(fail)?;
  let points=shape["points"].as_array().ok_or_else(fail)?;count+=points.len();if count>20000||(kind=="pen"&&points.is_empty())||(["line","arrow"].contains(&kind)&&points.len()!=2){return Err(fail());}
  for point in points{for field in ["x","y"]{point[field].as_f64().filter(|n|n.is_finite()&&*n>=0.0&&*n<=1.0).ok_or_else(fail)?;}}
 }
 Ok(())
}

#[cfg(test)]
mod whiteboard_tests {
 use super::*;
 fn board()->Value{json!({"version":1,"shapes":[{"id":"stroke","kind":"pen","x":10,"y":20,"width":30,"height":40,"color":"#123abc","stroke":3,"points":[{"x":0,"y":0},{"x":1,"y":1}]}]})}
 #[test] fn whiteboard_persists_cas_and_rejects_invalid_without_mutation(){
  let path=std::env::temp_dir().join(format!("inkism-whiteboard-{}.db",crate::ids::new_id()));
  let conn=Connection::open(&path).unwrap();crate::schema::init_main(&conn).unwrap();
  let first=set(&conn,&json!({"whiteboard":board()})).unwrap();let at=first["whiteboard"]["updated_at"].as_i64().unwrap();
  assert!(matches!(set(&conn,&json!({"whiteboard":board()})),Err(EngineError::Conflict(_))));
  for (field,value) in [("color",json!("url(javascript:x)")),("kind",json!("script")),("width",json!(0)),("stroke",json!(100)),("points",json!([{"x":-1,"y":0}]))]{let mut bad=board();bad["shapes"][0][field]=value;assert!(set(&conn,&json!({"whiteboard":bad,"expected_updated_at":{"workspace_whiteboard":at}})).is_err());assert_eq!(get(&conn).unwrap()["whiteboard"]["value"],board());}
  drop(conn);let conn=Connection::open(&path).unwrap();assert_eq!(get(&conn).unwrap()["whiteboard"]["value"],board());drop(conn);let _=std::fs::remove_file(path);
 }
 #[test] fn whiteboard_backup_merge_rekeys_and_preserves_canvas(){
  let conn=Connection::open_in_memory().unwrap();crate::schema::init_main(&conn).unwrap();set(&conn,&json!({"whiteboard":board(),"canvas":{"version":1,"nodes":[],"edges":[]}})).unwrap();let saved=backup(&conn).unwrap();
  assert_eq!(saved["whiteboard"],board());import(&conn,&json!({"whiteboard":board()}),&std::collections::HashMap::new()).unwrap();let current=get(&conn).unwrap();let shapes=current["whiteboard"]["value"]["shapes"].as_array().unwrap();assert_eq!(shapes.len(),2);assert_ne!(shapes[0]["id"],shapes[1]["id"]);assert_eq!(current["canvas"]["value"]["nodes"],json!([]));
 }
}
