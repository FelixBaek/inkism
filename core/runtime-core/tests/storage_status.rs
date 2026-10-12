use inkism_runtime::AppCore;
use serde_json::json;

#[test]
fn plain_library_reports_actual_policy_without_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppCore::open(dir.path().join("notes.db").to_str().unwrap()).unwrap();
    assert_eq!(
        app.execute(json!({"op":"storage_status"})),
        json!({"ok":true,"data":{"encrypted":false}})
    );
}

#[cfg(feature = "encrypted-storage")]
#[test]
fn encrypted_library_reports_actual_policy_without_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppCore::open_encrypted(
        dir.path().join("notes.db").to_str().unwrap(),
        inkism_runtime::local_storage::StorageKey::from_bytes([17; 32]),
    )
    .unwrap();
    assert_eq!(
        app.execute(json!({"op":"storage_status"})),
        json!({"ok":true,"data":{"encrypted":true}})
    );
}
