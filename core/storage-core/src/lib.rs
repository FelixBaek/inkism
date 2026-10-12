//! Connection-level encryption. Keys are supplied by the host, never persisted here.
#![forbid(unsafe_code)]
#[derive(Debug)]
pub struct Error(String);
impl Error {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Error {}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Self(error.to_string())
    }
}
pub type Result<T> = std::result::Result<T, Error>;
use rusqlite::Connection;
use std::path::Path;
use zeroize::Zeroizing;

#[derive(Clone)]
#[cfg_attr(not(feature = "encrypted-storage"), allow(dead_code))]
pub struct StorageKey(Zeroizing<[u8; 32]>);
impl StorageKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }
    #[cfg(feature = "encrypted-storage")]
    fn sql_key(&self) -> Zeroizing<String> {
        use std::fmt::Write;
        let mut text = Zeroizing::new(String::with_capacity(67));
        text.push_str("x'");
        for b in self.0.iter() {
            write!(&mut *text, "{b:02x}").expect("write string");
        }
        text.push('\'');
        text
    }
}
impl std::fmt::Debug for StorageKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StorageKey([REDACTED])")
    }
}

pub fn open(path: &Path, key: Option<&StorageKey>) -> Result<Connection> {
    open_flags(path, key, rusqlite::OpenFlags::default())
}

/// Inspect an existing database without creation, migration, or journal changes.
pub fn open_readonly(path: &Path, key: Option<&StorageKey>) -> Result<Connection> {
    open_flags(path, key, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
}

fn open_flags(path: &Path, key: Option<&StorageKey>, flags: rusqlite::OpenFlags) -> Result<Connection> {
    #[cfg(not(feature = "encrypted-storage"))]
    if key.is_some() {
        return Err(Error::new("encrypted storage is not enabled in this build"));
    }
    let conn = Connection::open_with_flags(path, flags)?;
    #[cfg(feature = "encrypted-storage")]
    if let Some(key) = key {
        let version: String = conn
            .query_row("PRAGMA cipher_version", [], |r| r.get(0))
            .map_err(|_| Error::new("SQLCipher is unavailable"))?;
        if version.is_empty() {
            return Err(Error::new("SQLCipher is unavailable"));
        }
        conn.pragma_update(None, "key", key.sql_key().as_str())
            .map_err(|_| Error::new("database key could not be applied"))?;
        // Validate BEFORE changing journal mode or initializing any schema.
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|_| Error::new("database key is incorrect or database is corrupt"))?;
        conn.pragma_update(None, "temp_store", "MEMORY")?;
    }
    Ok(conn)
}

/// Attach a database with an explicit key. Schema names must be simple identifiers.
pub fn attach(conn: &Connection, path: &str, schema: &str, key: Option<&StorageKey>) -> Result<()> {
    if schema.is_empty()
        || !schema
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err(Error::new("invalid attached schema name"));
    }
    #[cfg(feature = "encrypted-storage")]
    if let Some(key) = key {
        conn.execute(
            &format!("ATTACH DATABASE ?1 AS \"{schema}\" KEY ?2"),
            rusqlite::params![path, key.sql_key().as_str()],
        )
        .map_err(|_| Error::new("encrypted attached database could not be opened"))?;
        return Ok(());
    }
    #[cfg(not(feature = "encrypted-storage"))]
    if key.is_some() {
        return Err(Error::new("encrypted storage is not enabled in this build"));
    }
    conn.execute(&format!("ATTACH DATABASE ?1 AS \"{schema}\""), [path])?;
    Ok(())
}

#[cfg(feature = "encrypted-storage")]
pub mod migration;
