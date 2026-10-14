use inkism_engine::Engine;
use serde_json::{json, Value};
struct Db(std::path::PathBuf);
impl Db {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("inkism-knowledge-{}.db", uuid::Uuid::new_v4())))
    }
    fn open(&self) -> Engine {
        Engine::open(self.0.to_str().unwrap()).unwrap()
    }
}
impl Drop for Db {
    fn drop(&mut self) {
        for suffix in [
            "",
            "-wal",
            "-shm",
            ".search",
            ".search-wal",
            ".search-shm",
            ".backup",
        ] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}
fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["data"].clone()
}
fn note(e: &Engine, title: &str, content: &str) -> Value {
    ok(e.execute(
        json!({"op":"save","note":{"title":title,"content":content,"content_format":"markdown"}}),
    ))
}
fn props() -> Value {
    json!([{"name":"상태","type":"text","value":"진행"},{"name":"점수","type":"number","value":73.5},{"name":"마감","type":"date","value":"2028-02-29"},{"name":"완료","type":"checkbox","value":false},{"name":"분류","type":"list","value":["업무","읽기"]}])
}
fn set(e: &Engine, n: &Value, aliases: Value) -> Value {
    ok(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":0,"aliases":aliases,"properties":props()})))
}
#[test]
fn typed_metadata_is_durable_independent_and_optimistic() {
    let db = Db::new();
    let e = db.open();
    let n = note(&e, "A", "원문\r\n");
    let metadata = set(&e, &n, json!(["별명"]));
    assert!(metadata["version"].as_i64().unwrap() > 0);
    assert_eq!(
        ok(e.execute(json!({"op":"get","id":n["id"]}))),
        n,
        "metadata must not rewrite body/revision"
    );
    for (version, revision) in [
        (json!(0), n["revision"].clone()),
        (metadata["version"].clone(), json!(99)),
    ] {
        let r=e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":revision,"version":version,"aliases":[],"properties":[]}));
        assert_eq!(r["ok"], false);
    }
    let invalid=e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":metadata["version"],"aliases":[],"properties":[{"name":"bad","type":"date","value":"2027-02-29"}]}));
    assert_eq!(invalid["ok"], false);
    drop(e);
    let e = db.open();
    assert_eq!(
        ok(e.execute(json!({"op":"knowledge_get","id":n["id"]}))),
        metadata
    );
    let locked = ok(e.execute(
        json!({"op":"patch","id":n["id"],"revision":n["revision"],"changes":{"readonly":true}}),
    ));
    assert_eq!(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":locked["revision"],"version":metadata["version"],"aliases":[],"properties":[]}))["ok"],false);
    assert_eq!(
        ok(e.execute(json!({"op":"knowledge_get","id":n["id"]}))),
        metadata
    );
}
#[test]
fn graph_and_backlinks_resolve_alias_fragments_and_refuse_ambiguous_edges() {
    let db = Db::new();
    let e = db.open();
    let a = note(&e, "회의", "내용");
    set(&e, &a, json!(["meeting"]));
    let b = note(
        &e,
        "기록",
        &format!(
            "[[meeting#결정|표시]] ![[회의#^abc]] [직접](note://{}#부분)",
            a["id"].as_str().unwrap()
        ),
    );
    e.wait_index(5000).unwrap();
    let resolved = ok(e.execute(json!({"op":"link_resolve","target":"![[meeting#결정|표시]]"})));
    assert_eq!(resolved["items"][0]["id"], a["id"]);
    let graph = ok(e.execute(json!({"op":"graph_get"})));
    assert_eq!(graph["edges"], json!([{"source":b["id"],"target":a["id"]}]));
    let backlinks = ok(e.execute(json!({"op":"backlinks","id":a["id"]})));
    assert_eq!(backlinks["items"][0]["id"], b["id"]);
    let c = note(&e, "Duplicate", "");
    set(&e, &c, json!(["meeting"]));
    let d = note(&e, "Ambiguous", "[[meeting]]");
    e.wait_index(5000).unwrap();
    let graph = ok(e.execute(json!({"op":"graph_get"})));
    assert!(!graph["edges"]
        .as_array()
        .unwrap()
        .iter()
        .any(|edge| edge["source"] == d["id"]));
    assert_eq!(
        ok(e.execute(json!({"op":"link_resolve","target":"meeting"})))["ambiguous"],
        true
    );
    // Trash removes both nodes and stale index edges immediately.
    ok(e.execute(
        json!({"op":"patch","id":a["id"],"revision":a["revision"],"changes":{"trashed":true}}),
    ));
    let graph = ok(e.execute(json!({"op":"graph_get"})));
    assert!(!graph["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["id"] == a["id"]));
    assert!(!graph["edges"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["target"] == a["id"]));
}
#[test]
fn template_and_daily_creation_preserve_source_and_are_idempotent() {
    let db = Db::new();
    let e = db.open();
    let template=ok(e.execute(json!({"op":"save","note":{"title":"템플릿","content_format":"html","content":"<h2>{{title}}</h2><p>{{date}} {{time}}</p>"}})));
    ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"template_ids":[template["id"]],"daily_template_id":template["id"]})));
    let created=ok(e.execute(json!({"op":"template_create","template_id":template["id"],"title":"<b>{{date}}</b>","date":"2026-10-12","time":"15:30"})));
    assert_eq!(
        created["content"],
        "<h2>&lt;b&gt;{{date}}&lt;/b&gt;</h2><p>2026-10-12 15:30</p>"
    );
    assert_eq!(created["text"], "<b>{{date}}</b>\n2026-10-12 15:30");
    let first = ok(e.execute(json!({"op":"daily_note","date":"2026-10-12","time":"10:30"})));
    let second = ok(e.execute(json!({"op":"daily_note","date":"2026-10-12","time":"17:30"})));
    assert_eq!(first, second);
    assert_eq!(first["id"], "daily-2026-10-12");
    assert_eq!(
        first["content"],
        "<h2>2026-10-12</h2><p>2026-10-12 10:30</p>"
    );
    assert_eq!(
        e.execute(json!({"op":"daily_note","date":"2026-02-30"}))["ok"],
        false
    );
    ok(e.execute(json!({"op":"patch","id":first["id"],"revision":first["revision"],"changes":{"trashed":true}})));
    assert_eq!(
        e.execute(json!({"op":"daily_note","date":"2026-10-12"}))["ok"],
        false,
        "do not overwrite trashed daily note"
    );
}
#[test]
fn backup_roundtrip_remaps_template_ids_and_preserves_properties() {
    let db = Db::new();
    let e = db.open();
    let n = note(&e, "템플릿", "# {{date}}");
    set(&e, &n, json!(["template"]));
    let view = json!({"id":"work","name":"업무","layout":"cards","filter":{"property":"상태","operator":"equals","value":"진행"},"sort":{"property":"점수","direction":"desc"}});
    ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"template_ids":[n["id"]],"daily_template_id":n["id"],"views":[view]})));
    let path = format!("{}.backup", db.0.display());
    ok(e.execute(json!({"op":"export","path":path})));
    let other = Db::new();
    let dest = other.open();
    ok(dest.execute(json!({"op":"import","path":path})));
    let items = ok(dest.execute(json!({"op":"knowledge_list"})))["items"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(items.len(), 1);
    assert_ne!(items[0]["id"], n["id"]);
    assert_eq!(items[0]["aliases"], json!(["template"]));
    assert_eq!(items[0]["properties"], props());
    let config = ok(dest.execute(json!({"op":"knowledge_settings_get"})));
    assert_eq!(config["template_ids"], json!([items[0]["id"]]));
    assert_eq!(config["daily_template_id"], items[0]["id"]);
    assert_eq!(config["views"], json!([view]));
    // Invalid metadata is validated before importing any note.
    let mut backup: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    backup["notes"][0]["knowledge"]["properties"][0]["type"] = json!("script");
    std::fs::write(&path, backup.to_string()).unwrap();
    assert_eq!(
        dest.execute(json!({"op":"import","path":path}))["ok"],
        false
    );
    assert_eq!(
        ok(dest.execute(json!({"op":"knowledge_list"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn old_index_upgrade_reextracts_fragment_links_without_body_revision_change() {
    let db = Db::new();
    let target;
    let source;
    {
        let e = db.open();
        target = note(&e, "대상", "");
        source = note(&e, "출처", "[[대상#제목|표시]]");
        e.wait_index(5000).unwrap();
    }
    let cache = rusqlite::Connection::open(format!("{}.search", db.0.display())).unwrap();
    cache
        .execute_batch(
            "UPDATE backlink_titles SET target_title='대상#제목|표시'; PRAGMA user_version=9;",
        )
        .unwrap();
    drop(cache);
    let e = db.open();
    e.wait_index(5000).unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"graph_get"})))["edges"],
        json!([{"source":source["id"],"target":target["id"]}])
    );
    assert_eq!(ok(e.execute(json!({"op":"get","id":source["id"]}))), source);
}
#[test]
fn concurrent_daily_requests_create_one_note() {
    let db = Db::new();
    let a = db.open();
    let b = db.open();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let other = barrier.clone();
    let one = std::thread::spawn(move || {
        other.wait();
        ok(a.execute(json!({"op":"daily_note","date":"2026-10-13","content_format":"markdown"})))
    });
    barrier.wait();
    let two =
        ok(b.execute(json!({"op":"daily_note","date":"2026-10-13","content_format":"markdown"})));
    assert_eq!(one.join().unwrap(), two);
    assert_eq!(
        ok(b.execute(json!({"op":"knowledge_list"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn permanent_delete_clears_metadata_and_template_references_in_same_transaction() {
    let db = Db::new();
    let e = db.open();
    let n = note(&e, "삭제", "");
    set(&e, &n, json!(["별명"]));
    ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"template_ids":[n["id"]],"daily_template_id":n["id"]})));
    ok(e.execute(
        json!({"op":"patch","id":n["id"],"revision":n["revision"],"changes":{"trashed":true}}),
    ));
    ok(e.execute(json!({"op":"delete","id":n["id"]})));
    let config = ok(e.execute(json!({"op":"knowledge_settings_get"})));
    assert_eq!(config["template_ids"], json!([]));
    assert_eq!(config["daily_template_id"], Value::Null);
    let key = format!("knowledge_note:{}", n["id"].as_str().unwrap());
    assert!(inkism_engine::settings::stored(e.connection(), &key)
        .unwrap()
        .unwrap()
        .0
        .is_none());
}
#[test]
fn expanded_template_overflow_never_creates_partial_note() {
    let db = Db::new();
    let e = db.open();
    let template = note(&e, "large", "{{title}}".repeat(12000).as_str());
    let before = ok(e.execute(json!({"op":"knowledge_list"})))["items"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(e.execute(json!({"op":"template_create","template_id":template["id"],"title":"x".repeat(2000),"date":"2026-10-12","time":"12:00"}))["ok"],false);
    assert_eq!(
        ok(e.execute(json!({"op":"knowledge_list"})))["items"]
            .as_array()
            .unwrap()
            .len(),
        before
    );
}
#[test]
fn inserted_id_wiki_references_index_but_code_examples_do_not() {
    let db = Db::new();
    let e = db.open();
    let a = note(&e, "대상", "");
    let id = a["id"].as_str().unwrap();
    let b = note(&e, "연결", &format!("![[note://{id}#anchor]]"));
    let false_sources = [
        format!("```md\n[[대상]]\n[n](note://{id})\n```"),
        format!("`[[대상]] note://{id}`"),
        "    [[대상]]".into(),
        "```\n[[대상]]".into(),
        "\\[[대상]]".into(),
        "<code>[[대상]]</code>".into(),
    ];
    for source in false_sources {
        note(&e, "코드", &source);
    }
    ok(e.execute(json!({"op":"save","note":{"title":"숨김","content_format":"html","content":format!("<pre>[[대상]] <a href=\"note://{id}\">x</a></pre><script>[[대상]]</script>")}})));
    e.wait_index(5000).unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"graph_get"})))["edges"],
        json!([{"source":b["id"],"target":a["id"]}])
    );
    assert_eq!(
        ok(e.execute(json!({"op":"backlinks","id":a["id"]})))["items"][0]["id"],
        b["id"]
    );
}
#[test]
fn no_filter_saved_view_is_valid_and_incomplete_views_are_rejected() {
    let db = Db::new();
    let e = db.open();
    let view = json!({"id":"all","name":"전체","layout":"table","filter":{"property":"","operator":"contains","value":""},"sort":{"property":"","direction":"asc"}});
    let config = ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"views":[view]})));
    assert_eq!(config["views"], json!([view]));
    let mut broken = view.clone();
    broken.as_object_mut().unwrap().remove("filter");
    assert_eq!(
        e.execute(
            json!({"op":"knowledge_settings_set","version":config["version"],"views":[broken]})
        )["ok"],
        false
    );
}

#[test]
fn document_hierarchy_styles_relations_are_atomic_and_backup_remapped() {
    let db = Db::new();
    let e = db.open();
    let parent = note(&e, "Parent", "# preserved\r\n");
    let child=ok(e.execute(json!({"op":"page_create","id":"child-page","parent_id":parent["id"],"revision":1,"title":"Child"})));
    assert_eq!(ok(e.execute(json!({"op":"page_create","id":"child-page","parent_id":parent["id"],"revision":1,"title":"Child"}))),child);
    assert_eq!(ok(e.execute(json!({"op":"get","id":parent["id"]}))), parent);
    let meta = ok(e.execute(json!({"op":"knowledge_get","id":child["id"]})));
    let document = json!({"parent_id":parent["id"],"width":"wide","spacing":"relaxed","tone":"soft","card_size":"large","card_shadow":true});
    let properties = json!([
     {"name":"Status","type":"select","options":["Todo","Done"],"value":"Todo"},
     {"name":"Labels","type":"multiselect","options":["A","B"],"value":["A"]},
     {"name":"Owner","type":"person","value":["Felix"]},
     {"name":"Related","type":"relation","value":[parent["id"]]}
    ]);
    let saved=ok(e.execute(json!({"op":"knowledge_set","id":child["id"],"revision":1,"version":meta["version"],"document":document,"properties":properties})));
    // An older client can update aliases without erasing the document style.
    let saved=ok(e.execute(json!({"op":"knowledge_set","id":child["id"],"revision":1,"version":saved["version"],"aliases":["kid"],"properties":properties})));
    assert_eq!(saved["document"], document);
    assert_eq!(e.execute(json!({"op":"knowledge_set","id":parent["id"],"revision":1,"version":0,"document":{"parent_id":child["id"]}}))["ok"],false);
    assert_eq!(e.execute(json!({"op":"knowledge_set","id":child["id"],"revision":1,"version":saved["version"],"document":{"tone":"url(javascript:bad)"}}))["ok"],false);
    let mut invalid = properties.clone();
    invalid[0]["value"] = json!("Invalid");
    assert_eq!(e.execute(json!({"op":"knowledge_set","id":child["id"],"revision":1,"version":saved["version"],"properties":invalid}))["ok"],false);
    assert_eq!(
        ok(e.execute(json!({"op":"knowledge_get","id":child["id"]}))),
        saved
    );
    e.wait_index(5000).unwrap();
    assert_eq!(
        ok(e.execute(json!({"op":"graph_get"})))["edges"],
        json!([{"source":child["id"],"target":parent["id"]}])
    );
    let path = format!("{}.backup", db.0.display());
    ok(e.execute(json!({"op":"export","path":path})));
    let dest_db = Db::new();
    let dest = dest_db.open();
    ok(dest.execute(json!({"op":"import","path":path})));
    let list = ok(dest.execute(json!({"op":"knowledge_list"})));
    let items = list["items"].as_array().unwrap();
    let p = items.iter().find(|n| n["title"] == "Parent").unwrap();
    let c = items.iter().find(|n| n["title"] == "Child").unwrap();
    assert_ne!(p["id"], parent["id"]);
    assert_eq!(c["document"]["parent_id"], p["id"]);
    assert_eq!(c["properties"][3]["value"], json!([p["id"]]));
    assert_eq!(c["document"]["tone"], "soft");
    let locked = ok(
        e.execute(json!({"op":"patch","id":parent["id"],"revision":1,"changes":{"readonly":true}}))
    );
    assert_eq!(e.execute(json!({"op":"page_create","id":"denied-child","parent_id":parent["id"],"revision":locked["revision"],"title":"Denied"}))["ok"],false);
    assert_eq!(
        e.execute(json!({"op":"get","id":"denied-child"}))["ok"],
        false
    );
}
#[test]
fn collection_config_roundtrips_groups_and_bounded_multiple_filters() {
    let db = Db::new();
    let e = db.open();
    let filter = json!({"property":"Status","operator":"equals","value":"Done"});
    let view = json!({"id":"board","name":"Board","layout":"kanban","filter":filter,"filters":[{"property":"Score","operator":"gt","value":"2"}],"filter_mode":"all","group_by":"Status","sort":{"property":"$title","direction":"asc"}});
    let config = ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"views":[view]})));
    assert_eq!(config["views"], json!([view]));
    let mut invalid = view.clone();
    invalid["filters"] = json!(vec![filter; 9]);
    assert_eq!(
        e.execute(
            json!({"op":"knowledge_settings_set","version":config["version"],"views":[invalid]})
        )["ok"],
        false
    );
    assert_eq!(
        ok(e.execute(json!({"op":"knowledge_settings_get"}))),
        config
    );
}

#[test]
fn collection_definitions_are_atomic_preserve_bodies_and_reject_lossy_changes() {
    let db=Db::new();let e=db.open();let a=note(&e,"A","exact\r\n" );let b=note(&e,"B","text");
    let def=json!({"id":"shared-score","name":"Score","type":"number"});
    let config=ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"collection_update":{"operation":"save","definition":def,"notes":[]}})));
    let versions=json!([{"id":a["id"],"revision":a["revision"],"version":0},{"id":b["id"],"revision":b["revision"],"version":0}]);
    let config=ok(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"collection_update":{"operation":"apply","definition":def,"notes":versions,"value":7}})));
    let ma=ok(e.execute(json!({"op":"knowledge_get","id":a["id"]})));let mb=ok(e.execute(json!({"op":"knowledge_get","id":b["id"]})));
    let snapshots=json!([{"id":a["id"],"revision":a["revision"],"version":ma["version"]},{"id":b["id"],"revision":b["revision"],"version":mb["version"]}]);
    let mut changed=def.clone();changed["name"]=json!("Renamed");changed["type"]=json!("text");
    assert_eq!(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"collection_update":{"operation":"save","definition":changed,"notes":snapshots}}))["ok"],false);
    assert_eq!(ok(e.execute(json!({"op":"knowledge_get","id":a["id"]}))),ma);
    assert_eq!(ok(e.execute(json!({"op":"knowledge_settings_get"}))),config);
    changed["type"]=json!("number");
    assert_eq!(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"collection_update":{"operation":"save","definition":changed,"notes":[snapshots[0]]}}))["ok"],false,"must not omit linked notes");
    let config=ok(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"collection_update":{"operation":"save","definition":changed,"notes":snapshots}})));
    let ma=ok(e.execute(json!({"op":"knowledge_get","id":a["id"]})));let mb=ok(e.execute(json!({"op":"knowledge_get","id":b["id"]})));
    assert_eq!(ma["properties"][0]["name"],"Renamed");assert_eq!(ma["properties"][0]["value"],7);
    assert_eq!(ok(e.execute(json!({"op":"get","id":a["id"]}))),a);
    let mut tampered=ma.clone();tampered["op"]=json!("knowledge_set");tampered["revision"]=a["revision"].clone();tampered["properties"][0]["name"]=json!("Bypass");
    assert_eq!(e.execute(tampered)["ok"],false);
    let locked=ok(e.execute(json!({"op":"patch","id":b["id"],"revision":b["revision"],"changes":{"readonly":true}})));
    let snapshots=json!([{"id":a["id"],"revision":a["revision"],"version":ma["version"]},{"id":b["id"],"revision":locked["revision"],"version":mb["version"]}]);
    assert_eq!(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"collection_update":{"operation":"remove","definition":changed,"notes":snapshots}}))["ok"],false);
    assert_eq!(ok(e.execute(json!({"op":"knowledge_get","id":a["id"]}))),ma,"partial writes must roll back");
}
#[test]
fn style_presets_preserve_optional_settings_and_reject_hierarchy_and_attributes() {
    let db=Db::new();let e=db.open();
    let styles=json!([{"id":"style-1","name":"Reading","style":{"width":"wide","spacing":"relaxed","tone":"paper","card_size":"large","card_shadow":true}}]);
    let blocks=json!([{"id":"block-1","name":"Centered","type":"paragraph","attrs":{"textAlign":"center"}}]);
    let config=ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"style_presets":styles,"block_styles":blocks})));
    let config=ok(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"views":[]})));
    assert_eq!(config["style_presets"],styles);assert_eq!(config["block_styles"],blocks);
    let mut bad=styles.clone();bad[0]["style"]["parent_id"]=json!("note-a");
    assert_eq!(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"style_presets":bad}))["ok"],false);
    let mut bad=blocks.clone();bad[0]["attrs"]["id"]=json!("duplicate");
    assert_eq!(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"block_styles":bad}))["ok"],false);
}
#[test]
fn shared_definition_backup_remaps_collisions_and_preserves_imported_links() {
    let db=Db::new();let e=db.open();let a=note(&e,"Source","exact");
    let definition=json!({"id":"definition-1","name":"Status","type":"text"});
    let config=ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"collection_update":{"operation":"save","definition":definition,"notes":[]}})));
    ok(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"collection_update":{"operation":"apply","definition":definition,"notes":[{"id":a["id"],"revision":a["revision"],"version":0}],"value":"Todo"}})));
    let path=format!("{}.backup",db.0.display());ok(e.execute(json!({"op":"export","path":path})));
    let config=ok(e.execute(json!({"op":"knowledge_settings_get"})));let metadata=ok(e.execute(json!({"op":"knowledge_get","id":a["id"]})));
    let mut changed=definition.clone();changed["name"]=json!("Changed");
    ok(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"collection_update":{"operation":"save","definition":changed,"notes":[{"id":a["id"],"revision":a["revision"],"version":metadata["version"]}]}})));
    ok(e.execute(json!({"op":"import","path":path})));
    let items=ok(e.execute(json!({"op":"knowledge_list"})));
    let imported=items["items"].as_array().unwrap().iter().find(|n|n["id"]!=a["id"]).unwrap();
    assert_eq!(imported["properties"][0]["value"],"Todo");assert_ne!(imported["properties"][0]["definition_id"],"definition-1");
    let config=ok(e.execute(json!({"op":"knowledge_settings_get"})));
    assert!(config["property_definitions"].as_array().unwrap().iter().any(|d|d["id"]==imported["properties"][0]["definition_id"]));
}
#[test]
fn block_style_names_are_unique_within_each_kind() {
 let db=Db::new();let e=db.open();
 let styles=json!([{"id":"p-style","name":"Basic","type":"paragraph","attrs":{}},{"id":"h-style","name":"Basic","type":"heading","attrs":{}}]);
 let config=ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"block_styles":styles})));
 let mut duplicate=styles;duplicate[1]["type"]=json!("paragraph");duplicate[1]["name"]=json!("basic");
 assert_eq!(e.execute(json!({"op":"knowledge_settings_set","version":config["version"],"block_styles":duplicate}))["ok"],false);
}

#[test]
fn anchor_repairs_are_validated_versioned_and_backup_preserved(){
 let db=Db::new();let e=db.open();let n=note(&e,"repair","new paragraph ^new\n");
 let repaired=ok(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":0,"anchor_redirects":{"^old":"^new"}})));
 assert_eq!(repaired["anchor_redirects"]["^old"],"^new");
 assert_eq!(ok(e.execute(json!({"op":"get","id":n["id"]}))),n,"repair must not restore or rewrite body");
 assert_eq!(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":0,"anchor_redirects":{}}))["ok"],false);
 for invalid in [json!({"^a":"^b","^b":"^a"}),json!({"^a":"^a"}),json!({"":"^a"}),json!({"^a":1})]{
  assert_eq!(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":repaired["version"],"anchor_redirects":invalid}))["ok"],false);
 }
 let old_client=ok(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":repaired["version"],"aliases":["old client"]})));
 assert_eq!(old_client["anchor_redirects"],repaired["anchor_redirects"]);
 let path=format!("{}.backup",db.0.display());ok(e.execute(json!({"op":"export","path":path})));
 let target=Db::new();let dest=target.open();ok(dest.execute(json!({"op":"import","path":path})));
 let listed=ok(dest.execute(json!({"op":"knowledge_list"})));assert_eq!(listed["items"][0]["anchor_redirects"],repaired["anchor_redirects"]);
 ok(e.execute(json!({"op":"patch","id":n["id"],"revision":n["revision"],"changes":{"readonly":true}})));
 assert_eq!(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":old_client["version"],"anchor_redirects":{}}))["ok"],false);
}

#[test]
fn collection_card_settings_survive_database_restart() {
    let db=Db::new();let e=db.open();let mut config=ok(e.execute(json!({"op":"knowledge_settings_get"})));
    config["op"]=json!("knowledge_settings_set");config["views"]=json!([{"id":"cover-view","name":"Covers","layout":"cards","filter":{"property":"","operator":"contains","value":""},"sort":{"property":"$title","direction":"asc"},"card":{"cover_property":"Image","visible_properties":["Score"]}}]);
    let saved=ok(e.execute(config));drop(e);let reopened=db.open();let loaded=ok(reopened.execute(json!({"op":"knowledge_settings_get"})));assert_eq!(loaded["views"],saved["views"]);
}

#[test]
fn glossary_is_validated_versioned_and_preserved_for_older_clients() {
    let db = Db::new(); let e = db.open();
    let glossary = json!([{"id":"term-rag","term":"RAG","definition":"검색 증강 생성\n근거를 찾아 답변한다.","type":"concept","lang":"ko"}]);
    let saved = ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"glossary":glossary})));
    assert_eq!(saved["glossary"], glossary);
    assert_eq!(ok(e.execute(json!({"op":"knowledge_list"})))["items"], json!([]), "definitions must not create notes");
    assert_eq!(e.execute(json!({"op":"knowledge_settings_set","version":0,"glossary":[]}))["ok"], false);
    let preserved = ok(e.execute(json!({"op":"knowledge_settings_set","version":saved["version"],"views":[]})));
    assert_eq!(preserved["glossary"], glossary);
    for invalid in [json!(null), json!([glossary[0],glossary[0]]), json!([{"id":"bad/id","term":"T","definition":"D"}]), json!([{"id":"t","term":" ","definition":"D"}]), json!([{"id":"t","term":"T","definition":"D","noteId":"bad/id"}]), json!([{"id":"t","term":"T","definition":"D","extra":true}]), json!([{"id":"t","term":"T","definition":"x".repeat(4097)}])] {
        assert_eq!(e.execute(json!({"op":"knowledge_settings_set","version":preserved["version"],"glossary":invalid}))["ok"], false);
        assert_eq!(ok(e.execute(json!({"op":"knowledge_settings_get"}))), preserved);
    }
    drop(e);
    assert_eq!(ok(db.open().execute(json!({"op":"knowledge_settings_get"})))["glossary"], glossary);
}

#[test]
fn glossary_backup_remaps_notes_and_delete_keeps_definition() {
    let db=Db::new(); let e=db.open(); let n=note(&e,"RAG","expanded explanation");
    let glossary=json!([{"id":"term-rag","term":"RAG","definition":"검색 증강 생성","noteId":n["id"]}]);
    ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"glossary":glossary})));
    let path=format!("{}.backup",db.0.display()); ok(e.execute(json!({"op":"export","path":path})));
    let target=Db::new(); let dest=target.open(); ok(dest.execute(json!({"op":"import","path":path})));
    let imported=ok(dest.execute(json!({"op":"knowledge_list"})))["items"][0].clone();
    let config=ok(dest.execute(json!({"op":"knowledge_settings_get"})));
    assert_eq!(config["glossary"][0]["id"],"term-rag");
    assert_eq!(config["glossary"][0]["noteId"],imported["id"]);
    assert_ne!(imported["id"],n["id"]);
    ok(dest.execute(json!({"op":"patch","id":imported["id"],"revision":imported["revision"],"changes":{"trashed":true}})));
    ok(dest.execute(json!({"op":"delete","id":imported["id"]})));
    let after=ok(dest.execute(json!({"op":"knowledge_settings_get"})));
    assert_eq!(after["glossary"][0]["definition"],"검색 증강 생성");
    assert!(after["glossary"][0].get("noteId").is_none());
}

#[test]
fn glossary_backup_conflict_rolls_back_entire_import() {
    let db=Db::new();let e=db.open();note(&e,"source","body");
    ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"glossary":[{"id":"term-1","term":"T","definition":"source meaning"}]})));
    let path=format!("{}.backup",db.0.display());ok(e.execute(json!({"op":"export","path":path})));
    let target=Db::new();let dest=target.open();
    let config=ok(dest.execute(json!({"op":"knowledge_settings_set","version":0,"glossary":[{"id":"term-1","term":"T","definition":"other meaning"}]})));
    assert_eq!(dest.execute(json!({"op":"import","path":path}))["ok"],false);
    assert_eq!(ok(dest.execute(json!({"op":"knowledge_settings_get"}))),config);
    assert_eq!(ok(dest.execute(json!({"op":"knowledge_list"})))["items"],json!([]));
}

#[test]
fn glossary_sync_uses_existing_settings_validation_and_versions() {
    let db=Db::new();let e=db.open();
    let value=json!({"template_ids":[],"daily_template_id":null,"views":[],"glossary":[{"id":"term-1","term":"T","definition":"remote"}]}).to_string();
    assert!(inkism_engine::settings::merge(e.connection(),inkism_engine::knowledge::CONFIG_KEY,Some(&value),100).unwrap());
    let loaded=ok(e.execute(json!({"op":"knowledge_settings_get"})));
    assert_eq!(loaded["glossary"][0]["definition"],"remote");assert_eq!(loaded["version"],100);
    let bad=value.replace("\"id\":\"term-1\"","\"id\":\"bad/id\"");
    assert!(inkism_engine::settings::merge(e.connection(),inkism_engine::knowledge::CONFIG_KEY,Some(&bad),101).is_err());
    assert_eq!(ok(e.execute(json!({"op":"knowledge_settings_get"}))),loaded);
}

#[test]
fn glossary_backup_keeps_annotation_and_expanded_note_connected() {
    let db=Db::new();let e=db.open();let expanded=note(&e,"Expanded meaning","Explanation");
    let body=format!("<p><span data-term-id=\"occurrence-1\" data-term-glossary-id=\"term-1\" data-term-note-id=\"{}\" data-term-definition=\"Short meaning\">Term</span></p>",expanded["id"].as_str().unwrap());
    ok(e.execute(json!({"op":"save","note":{"title":"Annotated","content_format":"html","content":body}})));
    ok(e.execute(json!({"op":"knowledge_settings_set","version":0,"glossary":[{"id":"term-1","term":"Term","definition":"Short meaning","noteId":expanded["id"]}]})));
    let path=format!("{}.backup",db.0.display());ok(e.execute(json!({"op":"export","path":path})));
    let target=Db::new();let dest=target.open();ok(dest.execute(json!({"op":"import","path":path})));
    let items=ok(dest.execute(json!({"op":"knowledge_list"})))["items"].as_array().unwrap().clone();
    let expanded=items.iter().find(|item|item["title"]=="Expanded meaning").unwrap();
    let annotated=items.iter().find(|item|item["title"]=="Annotated").unwrap();
    let imported=ok(dest.execute(json!({"op":"get","id":annotated["id"]})));
    assert!(imported["content"].as_str().unwrap().contains(&format!("data-term-note-id=\"{}\"",expanded["id"].as_str().unwrap())));
    assert!(imported["content"].as_str().unwrap().contains("data-term-glossary-id=\"term-1\""));
    assert_eq!(ok(dest.execute(json!({"op":"knowledge_settings_get"})))["glossary"][0]["noteId"],expanded["id"]);
}

#[test]
fn annotation_note_links_appear_in_graph_and_backlinks() {
    let db=Db::new();let e=db.open();let target=note(&e,"Meaning","Expanded definition");
    let body=format!("<p><span data-term-id='occurrence-1' data-term-definition='Short meaning' data-term-note-id='{}'>Term</span></p>",target["id"].as_str().unwrap());
    let source=ok(e.execute(json!({"op":"save","note":{"title":"Annotated","content_format":"html","content":body}})));
    e.wait_index(5000).unwrap();
    assert_eq!(ok(e.execute(json!({"op":"graph_get"})))["edges"],json!([{"source":source["id"],"target":target["id"]}]));
    assert_eq!(ok(e.execute(json!({"op":"backlinks","id":target["id"]})))["items"][0]["id"],source["id"]);
}

#[test]
fn note_cover_is_validated_canonical_and_survives_other_updates() {
    let db = Db::new();
    let e = db.open();
    let n = note(&e, "Cover", "body");
    let meta = ok(e.execute(json!({"op":"knowledge_get","id":n["id"]})));
    let cover = json!({"kind":"unsplash","url":"https://images.unsplash.com/photo-1?w=1600","thumb":"https://images.unsplash.com/photo-1?w=400","author":"Ink Maker","author_url":"https://unsplash.com/@ink","unsplash_id":"abc_1"});
    let saved = ok(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":meta["version"],"document":{"cover":cover}})));
    assert_eq!(saved["document"]["cover"], cover);
    // Aliases-only updates (older clients) keep the cover.
    let saved = ok(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":saved["version"],"aliases":["c"]})));
    assert_eq!(saved["document"]["cover"], cover);
    // Hostile or non-canonical covers are refused and leave the stored value alone.
    for bad in [
        json!({"kind":"unsplash","url":"https://evil.example/x.png","thumb":"https://evil.example/x.png","author":"a","author_url":"https://unsplash.com/@a","unsplash_id":"x"}),
        json!({"kind":"attachment","url":"/api/attachments/not-a-uuid"}),
        json!({"kind":"attachment","url":"/api/attachments/12345678-1234-1234-1234-123456789012","extra":"dropped"}),
        json!("https://images.unsplash.com/photo-1"),
    ] {
        assert_eq!(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":saved["version"],"document":{"cover":bad}}))["ok"], false);
    }
    assert_eq!(ok(e.execute(json!({"op":"knowledge_get","id":n["id"]})))["document"]["cover"], cover);
    // null removes the cover.
    let cleared = ok(e.execute(json!({"op":"knowledge_set","id":n["id"],"revision":n["revision"],"version":saved["version"],"document":{"cover":null}})));
    assert!(cleared["document"]["cover"].is_null());
}
