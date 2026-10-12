//! ID and timestamp helpers. All timestamps are integer Unix milliseconds,
//! all IDs are UUID v4 strings (except user-supplied IDs, see `limits`).

use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Acceptable machine-generated / user-supplied ID shape.
/// We accept UUIDs but do not hard-require v4; anything non-empty, at most 64
/// chars, restricted to UUID-safe characters is allowed.
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
