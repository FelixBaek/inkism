//! Sidebar notebook counts and the daily-note list filter.
use inkism_engine::Engine;
use serde_json::{json, Value};

fn ok(value: Value) -> Value {
    assert_eq!(value["ok"], true, "{value}");
    value["data"].clone()
}

#[test]
fn notebook_counts_follow_the_notebook_view_and_daily_filter_lists_only_daily_notes() {
    let dir = std::env::temp_dir().join(format!("inkism-shell-lists-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let engine = Engine::open(&dir.join("notes.db").to_string_lossy()).unwrap();
    let a = ok(engine.execute(json!({"op":"save_notebook","name":"A"})))["id"].clone();
    let b = ok(engine.execute(json!({"op":"save_notebook","name":"B"})))["id"].clone();
    ok(engine.execute(json!({"op":"save","note":{"title":"both","content":"<p>x</p>","notebook_ids":[a,b]}})));
    ok(engine.execute(json!({"op":"save","note":{"title":"a","content":"<p>x</p>","notebook_id":a}})));
    let archived = ok(engine.execute(json!({"op":"save","note":{"title":"old","content":"<p>x</p>","notebook_id":a}})));
    ok(engine.execute(json!({"op":"patch","id":archived["id"],"revision":archived["revision"],"changes":{"archived":true}})));

    let counts = ok(engine.execute(json!({"op":"notebook_counts"})));
    let view = |id: &Value| ok(engine.execute(json!({"op":"list","view":"all","notebook_id":id})))["items"].as_array().unwrap().len();
    assert_eq!(counts[a.as_str().unwrap()], 2);
    assert_eq!(counts[b.as_str().unwrap()], 1);
    assert_eq!(view(&a), 2);
    assert_eq!(view(&b), 1);

    ok(engine.execute(json!({"op":"daily_note","date":"2026-10-12"})));
    ok(engine.execute(json!({"op":"daily_note","date":"2026-10-13"})));
    ok(engine.execute(json!({"op":"save","note":{"id":"dailyx","title":"not daily","content":"<p>x</p>"}})));
    let daily = ok(engine.execute(json!({"op":"list","view":"all","daily":true})));
    let ids: Vec<&str> = daily["items"].as_array().unwrap().iter().map(|n| n["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), 2, "{ids:?}");
    assert!(ids.iter().all(|id| id.starts_with("daily-")));
    drop(engine);
    let _ = std::fs::remove_dir_all(dir);
}
