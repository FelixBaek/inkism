//! Notebook cover photo (schema v15): save, rename-keeps, remove, reopen,
//! invalid input rejected without touching the row, backup round trip.

use inkism_engine::Engine;
use serde_json::{json, Value};

fn ok(res: Value) -> Value {
    assert_eq!(res["ok"], true, "expected ok response, got {res}");
    res["data"].clone()
}

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("inkism-cover-{tag}-{}-{}", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn cover_of(e: &Engine, id: &Value) -> Value {
    ok(e.execute(json!({"op":"notebooks"})))
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == *id)
        .unwrap()["cover"]
        .clone()
}

#[test]
fn cover_saves_survives_reopen_and_backs_up() {
    let dir = temp_dir("a");
    let path = dir.join("lib.db").to_string_lossy().into_owned();
    let photo = json!({"kind":"unsplash","unsplash_id":"abc_1","url":"https://images.unsplash.com/photo-1?w=1080",
        "thumb":"https://images.unsplash.com/photo-1?w=400","author":"Kim",
        "author_url":"https://unsplash.com/@kim?utm_source=inkism&utm_medium=referral"});
    let id = {
        let e = Engine::open(&path).unwrap();
        let nb = ok(e.execute(json!({"op":"save_notebook","name":"여행","cover":photo})));
        assert_eq!(nb["cover"], photo);
        // Rename without the field keeps the cover.
        ok(e.execute(json!({"op":"save_notebook","id":nb["id"],"name":"여행 2"})));
        assert_eq!(cover_of(&e, &nb["id"]), photo);
        // Invalid covers are rejected and leave the stored value alone.
        for bad in [
            json!({"kind":"unsplash","unsplash_id":"x","url":"https://evil.example/p","thumb":"https://evil.example/p","author":"X","author_url":"https://unsplash.com/@x"}),
            json!({"kind":"attachment","url":"/api/attachments/not-a-uuid"}),
            json!("https://images.unsplash.com/p"),
        ] {
            assert_eq!(e.execute(json!({"op":"save_notebook","id":nb["id"],"name":"x","cover":bad}))["ok"], false);
        }
        assert_eq!(cover_of(&e, &nb["id"]), photo);
        nb["id"].clone()
    };
    let e = Engine::open(&path).unwrap();
    assert_eq!(cover_of(&e, &id), photo, "cover must survive a restart");

    // Backup round trip keeps the cover; a cover-less notebook exports no field.
    let plain = ok(e.execute(json!({"op":"save_notebook","name":"빈"})));
    assert!(cover_of(&e, &plain["id"]).is_null());
    let file = dir.join("backup.json");
    ok(e.execute(json!({"op":"export","path":file.to_string_lossy()})));
    let backup: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    let rows = backup["notebooks"].as_array().unwrap();
    assert_eq!(rows.iter().find(|n| n["id"] == id).unwrap()["cover"], photo);
    assert!(rows.iter().find(|n| n["id"] == plain["id"]).unwrap().get("cover").is_none());
    let other = temp_dir("b");
    let d = Engine::open(other.join("lib.db").to_str().unwrap()).unwrap();
    ok(d.execute(json!({"op":"import","path":file.to_string_lossy()})));
    let listed = ok(d.execute(json!({"op":"notebooks"})));
    assert_eq!(listed.as_array().unwrap().iter().find(|n| n["name"] == "여행 2").unwrap()["cover"], photo);

    // Removing it.
    ok(e.execute(json!({"op":"save_notebook","id":id,"name":"여행 2","cover":null})));
    assert!(cover_of(&e, &id).is_null());
    drop((e, d));
    let _ = std::fs::remove_dir_all(dir);
    let _ = std::fs::remove_dir_all(other);
}
