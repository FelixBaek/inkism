//! Preflight library selection without running migrations or sync workers.
use crate::{local_key, local_storage::LocalStorage, Result, RuntimeError, StoredConfig};
use std::path::Path;

pub fn check(path: &str) -> Result<()> {
    check_with_storage(path, local_key::load(path)?)
}
fn check_with_storage(path: &str, storage: LocalStorage) -> Result<()> {
    if !Path::new(path).is_file()
        || Path::new(&format!("{path}.migration-incomplete")).try_exists()?
    {
        return Err(RuntimeError::config(
            "저장소 파일이 없거나 암호화 복사가 미완료 상태입니다",
        ));
    }
    let conn = storage.readonly(Path::new(path))?;
    let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > inkism_engine::schema::MAIN_USER_VERSION {
        return Err(RuntimeError::config(
            "더 최신 Inkism 버전으로 만든 저장소입니다",
        ));
    }
    // These are stable columns from the first supported schema. Do not require
    // later columns that the ordinary startup migration can safely add.
    conn.prepare("SELECT m.id,m.title,b.content,b.text FROM notes_meta m JOIN notes_body b ON b.note_id=m.id LIMIT 0")?;
    conn.prepare("SELECT id,name FROM notebooks LIMIT 0")?;
    let integrity: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(RuntimeError::config("저장소 무결성 검사에 실패했습니다"));
    }
    let config = StoredConfig::load_readonly(&format!("{path}.sync.json"))?;
    let sync_path = if let Some(config) = &config {
        config.decode_key()?;
        let state = config.state_path(path)?;
        if config.state_generation.is_some() && !Path::new(&state).try_exists()? {
            return Err(RuntimeError::config(
                "동기화 기록 파일을 찾을 수 없습니다. 기존 설정과 파일을 보존해 주세요.",
            ));
        }
        if config.state_generation.is_some() {
            storage.validate_sync_state(&state)?;
        }
        state
    } else {
        format!("{path}.sync")
    };
    for sidecar in [
        format!("{path}.search"),
        format!("{path}.attachments"),
        sync_path,
    ] {
        if Path::new(&sidecar).try_exists()? {
            let side = storage.readonly(Path::new(&sidecar))?;
            side.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
                row.get::<_, i64>(0)
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppCore;
    #[test]
    fn selection_rejects_foreign_missing_corrupt_and_future_files_without_mutation() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing.db");
        assert!(check(missing.to_str().unwrap()).is_err());
        assert!(!missing.exists());
        let foreign = dir.path().join("foreign.db");
        let db = rusqlite::Connection::open(&foreign).unwrap();
        db.execute_batch(
            "CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('preserve');",
        )
        .unwrap();
        drop(db);
        let before = std::fs::read(&foreign).unwrap();
        assert!(check(foreign.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read(&foreign).unwrap(), before);
        let path = dir.path().join("notes.db");
        let path = path.to_str().unwrap();
        drop(AppCore::open(path).unwrap());
        let before = std::fs::read(path).unwrap();
        check(path).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), before);
        std::fs::write(format!("{path}.sync.json"), b"invalid config").unwrap();
        assert!(check(path).is_err());
        assert_eq!(std::fs::read(path).unwrap(), before);
        std::fs::remove_file(format!("{path}.sync.json")).unwrap();
        let db = rusqlite::Connection::open(path).unwrap();
        db.pragma_update(None, "user_version", 999).unwrap();
        drop(db);
        let future = std::fs::read(path).unwrap();
        assert!(check(path).is_err());
        assert_eq!(std::fs::read(path).unwrap(), future);
    }
    #[cfg(feature = "encrypted-storage")]
    #[test]
    fn encrypted_selection_checks_key_without_rewriting_the_library() {
        use crate::local_storage::StorageKey;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.db");
        let path = path.to_str().unwrap();
        let key = StorageKey::from_bytes([51; 32]);
        drop(AppCore::open_encrypted(path, key.clone()).unwrap());
        let before = std::fs::read(path).unwrap();
        check_with_storage(path, LocalStorage::encrypted(key)).unwrap();
        assert!(check_with_storage(
            path,
            LocalStorage::encrypted(StorageKey::from_bytes([52; 32]))
        )
        .is_err());
        assert_eq!(std::fs::read(path).unwrap(), before);
    }
}
