//! Error type. Every protocol failure becomes `{ok:false,error:"..."}`;
//! no panics are allowed to cross `Engine::execute`.

use std::fmt;

#[derive(Debug)]
pub enum EngineError {
    /// Optimistic concurrency conflict (supplied revision != current).
    Conflict(String),
    /// Caller input violated the protocol or field limits.
    Invalid(String),
    /// Requested entity does not exist.
    NotFound(String),
    /// SQLite / IO failure.
    Internal(String),
}

impl EngineError {
    pub fn invalid(msg: impl Into<String>) -> Self {
        EngineError::Invalid(msg.into())
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        EngineError::Internal(msg.into())
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::Conflict(m) => write!(f, "conflict: {m}"),
            EngineError::Invalid(m) => write!(f, "invalid: {m}"),
            EngineError::NotFound(m) => write!(f, "not_found: {m}"),
            EngineError::Internal(m) => write!(f, "internal: {m}"),
        }
    }
}

impl std::error::Error for EngineError {}

impl From<rusqlite::Error> for EngineError {
    fn from(e: rusqlite::Error) -> Self {
        EngineError::Internal(format!("sqlite: {e}"))
    }
}

impl From<serde_json::Error> for EngineError {
    fn from(e: serde_json::Error) -> Self {
        EngineError::Invalid(format!("json: {e}"))
    }
}

impl From<std::io::Error> for EngineError {
    fn from(e: std::io::Error) -> Self {
        EngineError::Internal(format!("io: {e}"))
    }
}

pub type Result<T> = std::result::Result<T, EngineError>;
