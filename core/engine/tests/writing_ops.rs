use inkism_engine::Engine;
use serde_json::{json, Value};

fn ok(value: Value) -> Value { assert_eq!(value["ok"], true, "{value}"); value["data"].clone() }

#[test]
fn merge_is_atomic_formatsafe_and_redirects_only_trashed_source() {
    let path = std::env::temp_dir().join(format!("inkism-merge-{}.db", uuid::Uuid::new_v4()));
    let engine = Engine::open(path.to_str().unwrap()).unwrap();
    let source = ok(engine.execute(json!({"op":"save","note":{"title":"Source","content":"source","content_format":"text"}})));
    let target = ok(engine.execute(json!({"op":"save","note":{"title":"Target","content":"target","content_format":"text"}})));
    let merged = ok(engine.execute(json!({"op":"merge_notes","source_id":source["id"],"target_id":target["id"],"source_revision":1,"target_revision":1,"redirect":true})));
    assert!(merged["target"]["content"].as_str().unwrap().contains("source"));
    assert_eq!(ok(engine.execute(json!({"op":"get","id":source["id"]}))) ["trashed"], true);
    let resolved = ok(engine.execute(json!({"op":"link_resolve","target":format!("note://{}",source["id"].as_str().unwrap())})));
    assert_eq!(resolved["items"][0]["id"], target["id"]);
    let source_trash = ok(engine.execute(json!({"op":"get","id":source["id"]})));
    let restored = ok(engine.execute(json!({"op":"patch","id":source["id"],"revision":source_trash["revision"],"changes":{"trashed":false}})));
    assert_eq!(restored["trashed"], false);
    let direct = ok(engine.execute(json!({"op":"link_resolve","target":format!("note://{}",source["id"].as_str().unwrap())})));
    assert_eq!(direct["items"][0]["id"], source["id"]);
    let stale = engine.execute(json!({"op":"merge_notes","source_id":source["id"],"target_id":target["id"],"source_revision":1,"target_revision":1}));
    assert_eq!(stale["ok"], false);
    drop(engine);
    for suffix in ["", "-wal", "-shm", ".search", ".search-wal", ".search-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", path.display())); }
}

#[test]
fn merge_redirect_chains_restore_precedence_and_permanent_deletion() {
    let root=std::env::temp_dir().join(format!("inkism-chain-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&root).unwrap();
    {
    let engine=Engine::open(root.join("notes.db").to_str().unwrap()).unwrap();
    let create=|title:&str|ok(engine.execute(json!({"op":"save","note":{"title":title,"content":title,"content_format":"text"}})));
    let a=create("A");let b=create("B");let c=create("C");
    let merge=|source:&Value,target:&Value|{let source=ok(engine.execute(json!({"op":"get","id":source["id"]})));let target=ok(engine.execute(json!({"op":"get","id":target["id"]})));ok(engine.execute(json!({"op":"merge_notes","source_id":source["id"],"target_id":target["id"],"source_revision":source["revision"],"target_revision":target["revision"]}))) };
    merge(&a,&b);merge(&b,&c);
    let resolve=||ok(engine.execute(json!({"op":"link_resolve","target":format!("note://{}",a["id"].as_str().unwrap())})));
    assert_eq!(resolve()["items"][0]["id"],c["id"]);
    assert_eq!(resolve()["redirect_sources"],json!([a["id"],b["id"]]));
    let trash=|note:&Value,trashed:bool|{let current=ok(engine.execute(json!({"op":"get","id":note["id"]})));ok(engine.execute(json!({"op":"patch","id":note["id"],"revision":current["revision"],"changes":{"trashed":trashed}}))) };
    trash(&b,false);assert_eq!(resolve()["items"][0]["id"],b["id"],"restored intermediate takes priority over its stale redirect");
    trash(&a,false);assert_eq!(resolve()["items"][0]["id"],a["id"],"restored original takes priority");
    trash(&a,true);trash(&b,true);
    ok(engine.execute(json!({"op":"delete","id":b["id"]})));
    assert!(resolve()["items"].as_array().unwrap().is_empty(),"permanently deleted intermediate must stop resolution");
    }std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn redirect_cycles_depth_limit_and_locked_intermediate_fail_closed() {
    let root=std::env::temp_dir().join(format!("inkism-chain-bound-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&root).unwrap();
    {
    let engine=Engine::open(root.join("notes.db").to_str().unwrap()).unwrap();
    let mut ids=Vec::new();
    for index in 0..34 {let note=ok(engine.execute(json!({"op":"save","note":{"title":format!("note{index}"),"content":"body"}})));ids.push(note["id"].as_str().unwrap().to_owned());}
    for index in 0..33 {
        engine.connection().execute("UPDATE notes_meta SET trashed=1 WHERE id=?1",[&ids[index]]).unwrap();
        inkism_engine::settings::write_local(engine.connection(),&format!("knowledge_redirect:{}",ids[index]),Some(&json!({"target_id":ids[index+1],"source_revision":1}).to_string())).unwrap();
    }
    let resolve=|index:usize|ok(engine.execute(json!({"op":"link_resolve","target":format!("note://{}",ids[index])})));
    assert!(resolve(0)["items"].as_array().unwrap().is_empty(),"33 hops exceed the explicit bound");
    assert_eq!(resolve(1)["items"][0]["id"],ids[33],"32 hops remain supported");
    engine.connection().execute("UPDATE notes_meta SET locked=1 WHERE id=?1",[&ids[20]]).unwrap();
    assert!(resolve(1)["items"].as_array().unwrap().is_empty(),"locked intermediate must not reveal its successor");
    engine.connection().execute("UPDATE notes_meta SET locked=0 WHERE id=?1",[&ids[20]]).unwrap();
    inkism_engine::settings::write_local(engine.connection(),&format!("knowledge_redirect:{}",ids[20]),Some(&json!({"target_id":ids[10],"source_revision":1}).to_string())).unwrap();
    assert!(resolve(1)["items"].as_array().unwrap().is_empty(),"cycle must terminate without a guessed target");
    }std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn conflicting_block_ids_reject_merge_atomically_without_rewriting_sources() {
    let root=std::env::temp_dir().join(format!("inkism-merge-ids-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&root).unwrap();
    {
    let engine=Engine::open(root.join("notes.db").to_str().unwrap()).unwrap();
    for (format,left,right) in [("html","<p id='same'>A</p>","<p id=\"s&#97;me\">B</p>"),("markdown","A ^same\r\n","B\n^same\n")] {
        let source=ok(engine.execute(json!({"op":"save","note":{"title":"source","content":left,"content_format":format}})));
        let target=ok(engine.execute(json!({"op":"save","note":{"title":"target","content":right,"content_format":format}})));
        let result=engine.execute(json!({"op":"merge_notes","source_id":source["id"],"target_id":target["id"],"source_revision":source["revision"],"target_revision":target["revision"]}));
        assert_eq!(result["ok"],false);assert!(result["error"].as_str().unwrap().contains("duplicate block ID"));
        assert_eq!(ok(engine.execute(json!({"op":"get","id":source["id"]}))),source,"source metadata and exact bytes remain unchanged");
        assert_eq!(ok(engine.execute(json!({"op":"get","id":target["id"]}))),target,"target metadata and exact bytes remain unchanged");
    }
    // Fenced/indented code and tag-looking HTML comments do not claim IDs.
    for (format,left,right) in [("html","<!-- <p id='same'> --> <p id='unique'>A</p>","<p id='same'>B</p>"),("markdown","```\nA ^same\n```\n    B ^same\nC ^unique","D ^same")] {
        let source=ok(engine.execute(json!({"op":"save","note":{"content":left,"content_format":format}})));let target=ok(engine.execute(json!({"op":"save","note":{"content":right,"content_format":format}})));
        ok(engine.execute(json!({"op":"merge_notes","source_id":source["id"],"target_id":target["id"],"source_revision":source["revision"],"target_revision":target["revision"]})));
    }
    }std::fs::remove_dir_all(root).unwrap();
}
