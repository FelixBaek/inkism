//! Multi-notebook membership backup contract: export writes `notebook_ids`
//! per note, import validates the whole file and remaps every membership, old
//! backups without the field keep the single-notebook behavior, and invalid
//! membership references roll back without touching existing data.

use inkism_engine::Engine;
use serde_json::{json, Value};

struct TempDb {
    dir: std::path::PathBuf,
    path: String,
}

impl TempDb {
    fn new(tag: &str) -> TempDb {
        let dir = std::env::temp_dir().join(format!(
            "inkism-test-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("library.db").to_string_lossy().into_owned();
        TempDb { dir, path }
    }
    fn open(&self) -> Engine {
        Engine::open(&self.path).unwrap()
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn ok(res: Value) -> Value {
    assert_eq!(res["ok"], true, "expected ok response, got {res}");
    res["data"].clone()
}

fn err(res: Value) -> String {
    assert_eq!(res["ok"], false, "expected error response, got {res}");
    res["error"].as_str().unwrap().to_string()
}

fn save_note(e: &Engine, title: &str, text: &str, extra: Value) -> Value {
    let mut note = json!({ "title": title, "content": format!("<p>{text}</p>"), "text": text });
    if let Value::Object(map) = extra {
        for (k, v) in map {
            note[k] = v;
        }
    }
    ok(e.execute(json!({ "op": "save", "note": note })))
}

#[test]
fn backup_roundtrip_preserves_multi_notebook_memberships() {
    let t = TempDb::new("membership-roundtrip");
    let e = t.open();

    // Hand-staged backup: legacy non-UUID notebook IDs (backup IDs need not
    // be UUIDs) and three notes — multi-membership, explicit empty list, and
    // an old-style note without the array field.
    const ALPHA_OLD: &str = "nb-alpha-old";
    const BETA_OLD: &str = "nb-beta-old";
    let backup = json!({
        "version": 2,
        "notes": [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "title": "multi", "content": "<p>m</p>", "text": "m", "tags": [],
                "notebook_id": ALPHA_OLD,
                "notebook_ids": [ALPHA_OLD, BETA_OLD]
            },
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "title": "loose", "content": "<p>l</p>", "text": "l", "tags": [],
                "notebook_ids": []
            },
            {
                "id": "33333333-3333-4333-8333-333333333333",
                "title": "legacy", "content": "<p>o</p>", "text": "o", "tags": [],
                "notebook_id": ALPHA_OLD
            }
        ],
        "notebooks": [
            { "id": ALPHA_OLD, "name": "Alpha" },
            { "id": BETA_OLD, "name": "Beta" }
        ]
    });
    let backup_path = t.dir.join("membership-backup.json");
    std::fs::write(&backup_path, serde_json::to_vec(&backup).unwrap()).unwrap();

    assert_eq!(
        ok(e.execute(json!({ "op": "import", "path": backup_path.to_string_lossy() })))["imported"],
        3
    );
    ok(e.execute(json!({ "op": "wait_index" })));

    // Real roundtrip: export the imported library back out and verify the
    // memberships survived with remapped fresh IDs.
    let export_path = t.dir.join("roundtrip.json");
    ok(e.execute(json!({ "op": "export", "path": export_path.to_string_lossy() })));
    let exported: Value = serde_json::from_slice(&std::fs::read(&export_path).unwrap()).unwrap();
    assert_eq!(exported["version"], 2);

    let by_title = |title: &str| -> Value {
        exported["notes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["title"] == title)
            .unwrap_or_else(|| panic!("missing exported note {title}"))
            .clone()
    };
    let notebook_new_id = |name: &str| -> String {
        exported["notebooks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|nb| nb["name"] == name)
            .unwrap_or_else(|| panic!("missing exported notebook {name}"))["id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let alpha = notebook_new_id("Alpha");
    let beta = notebook_new_id("Beta");
    assert_ne!(alpha, beta, "notebooks must get distinct fresh IDs");

    // Multi-membership note: primary first, rest in order, all remapped.
    let multi = by_title("multi");
    assert_eq!(
        multi["notebook_ids"],
        json!([alpha, beta]),
        "memberships must survive the roundtrip, remapped to fresh IDs"
    );
    assert_eq!(multi["notebook_id"].as_str().unwrap(), alpha);

    // Explicit [] imports with every membership detached.
    assert_eq!(by_title("loose")["notebook_ids"], json!([]));
    assert!(by_title("loose")["notebook_id"].is_null());

    // Old backups (no array field) keep the single-notebook behavior.
    let legacy = by_title("legacy");
    assert_eq!(legacy["notebook_ids"], json!([alpha]));
    assert_eq!(legacy["notebook_id"].as_str().unwrap(), alpha);
}

#[test]
fn import_rejects_bad_memberships_and_rolls_back() {
    let t = TempDb::new("membership-rollback");
    let e = t.open();
    save_note(&e, "existing", "x", json!({}));
    ok(e.execute(json!({ "op": "wait_index" })));

    let good = json!({
        "id": "11111111-1111-4111-8111-111111111111",
        "title": "good", "content": "<p>g</p>", "text": "g", "tags": []
    });
    const ALPHA: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let notebooks = || {
        json!([
            { "id": ALPHA, "name": "Alpha" }
        ])
    };
    let bad_note_cases: Vec<(Value, &str)> = vec![
        // Membership references a notebook that is not in the backup.
        (
            json!({
                "id": "22222222-2222-4222-8222-222222222222",
                "title": "bad", "content": "<p>b</p>", "text": "b", "tags": [],
                "notebook_ids": ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]
            }),
            "references missing notebook",
        ),
        // Duplicate entries are rejected by the shared parser.
        (
            json!({
                "id": "22222222-2222-4222-8222-222222222222",
                "title": "bad", "content": "<p>b</p>", "text": "b", "tags": [],
                "notebook_ids": [ALPHA, ALPHA]
            }),
            "duplicate",
        ),
        // notebook_id must agree with the first notebook_ids entry.
        (
            json!({
                "id": "22222222-2222-4222-8222-222222222222",
                "title": "bad", "content": "<p>b</p>", "text": "b", "tags": [],
                "notebook_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "notebook_ids": [ALPHA]
            }),
            "notebook_id must match",
        ),
        // null is invalid: the field must be omitted or a proper array.
        (
            json!({
                "id": "22222222-2222-4222-8222-222222222222",
                "title": "bad", "content": "<p>b</p>", "text": "b", "tags": [],
                "notebook_ids": null
            }),
            "notebook_ids must be an array",
        ),
    ];

    for (i, (bad_note, needle)) in bad_note_cases.iter().enumerate() {
        let path = t.dir.join(format!("bad-{i}.json"));
        std::fs::write(
            &path,
            serde_json::to_vec(&json!({
                "version": 2,
                "notes": [good.clone(), bad_note],
                "notebooks": notebooks(),
            }))
            .unwrap(),
        )
        .unwrap();
        // Whole-file validation refuses before any write.
        let msg =
            err(e.execute(json!({ "op": "validate_import", "path": path.to_string_lossy() })));
        assert!(
            msg.contains(needle),
            "case {i}: expected \"{needle}\" in validation error \"{msg}\""
        );
        // Import fails too, and rolls back: the pre-existing note is intact,
        // neither backup note nor backup notebook was created.
        let msg = err(e.execute(json!({ "op": "import", "path": path.to_string_lossy() })));
        assert!(
            msg.contains(needle),
            "case {i}: expected \"{needle}\" in import error \"{msg}\""
        );
        let list = ok(e.execute(json!({ "op": "list", "view": "all" })));
        let items = list["items"].as_array().unwrap();
        assert_eq!(items.len(), 1, "case {i}: rollback left a stray note");
        assert_eq!(items[0]["title"], "existing");
        let notebooks_now = ok(e.execute(json!({ "op": "notebooks" })));
        assert!(
            notebooks_now.as_array().unwrap().is_empty(),
            "case {i}: rollback left a stray notebook"
        );
    }
}
