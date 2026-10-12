//! Device-bound key identity, never the key itself, is stored beside the DB.
//! Missing identities/OS secrets fail closed; existing libraries are untouched.
use local_api::Result;
use std::{
    io::{Read, Write},
    path::Path,
};
const PREFIX: &str = "INKISM-MOBILE-KEY-1\n";

fn identity(db: &Path, create: impl FnOnce(&str) -> Result<()>) -> Result<String> {
    let marker = db.with_file_name(format!(
        "{}.mobile-key",
        db.file_name()
            .ok_or("invalid database path")?
            .to_str()
            .ok_or("invalid database path")?
    ));
    match std::fs::File::open(&marker) {
        Ok(file) => {
            let mut value = String::new();
            file.take(128).read_to_string(&mut value)?;
            let id = value
                .strip_prefix(PREFIX)
                .ok_or("invalid mobile key identity")?;
            let id = uuid::Uuid::parse_str(id)?;
            return Ok(id.to_string());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let parent = db.parent().ok_or("invalid database directory")?;
    std::fs::create_dir_all(parent)?;
    let name = db
        .file_name()
        .unwrap()
        .to_str()
        .ok_or("invalid database name")?;
    for entry in std::fs::read_dir(parent)? {
        let entry = entry?;
        let file = entry.file_name();
        let file = file.to_string_lossy();
        if file == format!("{name}.runtime-lock") && entry.file_type()?.is_file() {
            continue;
        }
        if file == name
            || file.starts_with(&format!("{name}."))
            || file.starts_with(&format!("{name}-"))
        {
            return Err("기존 라이브러리는 보존했습니다. 모바일 암호화는 새 라이브러리에만 적용할 수 있습니다. 저장키가 누락된 경우 원래 기기의 키를 복구해 주세요.".into());
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    create(&id)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    write!(temp, "{PREFIX}{id}")?;
    temp.as_file().sync_all()?;
    temp.persist_noclobber(marker)?;
    // The marker must be durable before any encrypted DB can be created.
    #[cfg(unix)]
    std::fs::File::open(parent)?.sync_all()?;
    Ok(id)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn load(db: &Path) -> Result<inkism_runtime::local_storage::StorageKey> {
    std::fs::create_dir_all(db.parent().ok_or("invalid library directory")?)?;
    let _lease = inkism_runtime::library_lock::LibraryLease::exclusive(
        db.to_str().ok_or("invalid library path")?,
    )?;
    let id = identity(db, platform::create)?;
    let bytes = zeroize::Zeroizing::new(platform::read(&id)?);
    let key: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid mobile key length")?;
    Ok(inkism_runtime::local_storage::StorageKey::from_bytes(key))
}

#[cfg(target_os = "ios")]
mod platform {
    use super::*;
    use rand::RngCore;
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{
        generic_password, set_generic_password_options, PasswordOptions,
    };
    const SERVICE: &str = "app.inkism.local-storage.v1";
    pub fn create(id: &str) -> Result<()> {
        // Each new library receives a random identity, never replacing an old item.
        let mut key = zeroize::Zeroizing::new(vec![0; 32]);
        rand::rngs::OsRng.try_fill_bytes(&mut key)?;
        let mut options = PasswordOptions::new_generic_password(SERVICE, id);
        options.set_access_synchronized(Some(false));
        options.set_access_control(SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
            0,
        )?);
        set_generic_password_options(&key, options)?;
        Ok(())
    }
    pub fn read(id: &str) -> Result<Vec<u8>> {
        Ok(generic_password(PasswordOptions::new_generic_password(
            SERVICE, id,
        ))?)
    }
}

#[cfg(target_os = "android")]
#[path = "mobile_key_android.rs"]
mod platform;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_reopens_without_creating_or_storing_secret() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        let id = identity(&db, |_| Ok(())).unwrap();
        assert_eq!(
            identity(&db, |_| panic!("must not recreate key")).unwrap(),
            id
        );
        assert!(
            std::fs::read_to_string(dir.path().join("notes.db.mobile-key"))
                .unwrap()
                .starts_with(PREFIX)
        );
    }
    #[test]
    fn missing_or_failed_key_does_not_replace_existing_data() {
        for suffix in ["", ".attachments", ".sync", "-wal", ".storage-key"] {
            let dir = tempfile::tempdir().unwrap();
            let db = dir.path().join("notes.db");
            let existing = dir.path().join(format!("notes.db{suffix}"));
            std::fs::write(&existing, b"preserved").unwrap();
            assert!(identity(&db, |_| panic!("must not create")).is_err());
            assert_eq!(std::fs::read(existing).unwrap(), b"preserved");
        }
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        assert!(identity(&db, |_| Err("OS key store unavailable".into())).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn corrupt_marker_never_recreates_key() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("notes.db");
        std::fs::write(dir.path().join("notes.db.mobile-key"), "corrupt").unwrap();
        assert!(identity(&db, |_| panic!("must not create")).is_err());
    }
}
