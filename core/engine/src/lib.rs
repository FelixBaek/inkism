//! inkism-engine: SQLite storage/search core for the Inkism desktop app
//!. Protocol v1: .private/docs/protocol.md, performance contract:
//! .private/docs/performance-requirements.md.
//!
//! Library API (used by the JSONL adapter in `main.rs`; the sync module will
//! be added by the main agent later on top of `Engine::connection`):
//!   * [`Engine::open`]      – open/create a library ("<path>" + "<path>.search")
//!   * [`Engine::execute`]   – one protocol request -> response envelope
//!   * [`Engine::wait_index`]- bounded wait for the background index queue
//!   * [`Engine::connection`]- direct main connection for engine modules
//!
//! Layout: metadata and bodies are separate SQLite TABLES in the main file;
//! FTS5 trigram + backlinks live in a SEPARATE file ("<path>.search") written
//! only by a dedicated worker thread, driven by durable `index_jobs` rows
//! committed together with saves. Saves never tokenize.

pub mod attachments;
pub mod blocks;
pub mod cursor;
pub mod draft_journal;
pub mod editor_history;
pub mod engine;
pub mod error;
pub mod ids;
pub mod indexer;
pub mod limits;
pub mod links;
pub mod knowledge;
mod redirect_backup;
pub mod model;
pub mod notebook_counts;
pub mod notebook_cover;
pub mod notebook_membership;
pub mod notebook_trash;
pub mod trash_retention;
pub mod ops_backup;
pub mod ops_meta;
pub mod tag_changes;
pub mod ops_notes;
pub mod plaintext;
pub mod schema;
mod search;
pub mod segments;
pub mod settings;
pub mod source_format;
pub mod storage;
pub mod vault;
pub mod workspace;
pub mod workspace_tools;

pub use engine::Engine;
pub use error::EngineError;

pub mod protocol;

pub mod writing_ops;
pub mod merge_changes;

pub mod resources;


pub mod named_versions;
pub mod history_changes;

pub mod connection_index;

pub mod encrypted_versions;
