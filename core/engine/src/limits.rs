//! Hard field/line limits. Enforced in the engine (so every caller benefits)
//! and in the JSONL adapter (line length) — see README for the exact numbers.
//! Oversized input is rejected with an `invalid:` error, never truncated.

/// Maximum stdin request line (JSON). Must cover the largest legal `content`.
pub const MAX_REQUEST_LINE_BYTES: usize = 20 * 1024 * 1024; // 20 MiB

pub const MAX_TITLE_CHARS: usize = 2_000;
pub const MAX_PREVIEW_CHARS: usize = 180;
pub const MAX_QUERY_CHARS: usize = 200;
pub const MAX_TAG_NAME_CHARS: usize = 100;
pub const MAX_TAGS: usize = 100;
pub const MAX_NOTEBOOK_NAME_CHARS: usize = 200;
pub const MAX_COLOR_CHARS: usize = 32;
pub const MAX_CONTENT_BYTES: usize = 20 * 1024 * 1024; // 20 MiB per field
pub const MAX_LIST_LIMIT: u32 = 100;
pub const DEFAULT_LIST_LIMIT: u32 = 50;
/// Note reminders are UTC Unix milliseconds, bounded to the widest range
/// mainstream date/time libraries accept (100 million days ≈ year 294247).
pub const MIN_REMINDER_AT_MS: i64 = 0;
pub const MAX_REMINDER_AT_MS: i64 = 8_640_000_000_000_000;
/// Bounded wait for `wait_index` (tests rely on this).
pub const WAIT_INDEX_TIMEOUT_MS: u64 = 10_000;
/// History retained per note.
pub const HISTORY_MAX_PER_NOTE: usize = 20;
