//! Inkism sync core.
//!
//! An independent Rust crate that owns *all* cross-device sync and crypto:
//! authenticated encryption of change records, a durable outbox, an
//! incremental relay cursor, vector-clock conflict detection, and a durable
//! incoming queue that the host applies before acknowledging.
//!
//! The relay is a dumb, authenticated byte store (see `.private/docs/protocol.md`); it
//! never sees keys or plaintext. Local disk encryption of the host database is
//! a separate concern and is not provided here.
//!
//! ```no_run
//! use sync_core::{Entity, EntityKind, Key, SyncConfig, SyncEngine};
//!
//! let key = Key::from_base64("...32 random bytes, base64...").unwrap();
//! let engine = SyncEngine::open(
//!     SyncConfig::new("sync-state.db", "https://relay.example", "relay-token", key),
//! ).unwrap();
//! engine
//!     .stage_local(Entity::new(EntityKind::Note, "note-id", serde_json::json!({"title": "hi"})), 1)
//!     .unwrap();
//! let outcome = engine.sync_once().unwrap();
//! let ids: Vec<String> = outcome.incoming.iter().map(|c| c.event_id.clone()).collect();
//! engine.ack_applied(&ids).unwrap();
//! ```
//!
//! See `.private/docs/sync-integration.md` for the host integration contract.

#![forbid(unsafe_code)]

pub mod attachment;
pub mod attachment_queue;
mod client;
mod crypto;
mod engine;
mod entity;
mod error;
mod record;
mod store;
mod vclock;

pub use crypto::{decode_blob, encode_blob, Key, KEY_LEN, NONCE_LEN};
pub use engine::{
    Conflict, Incoming, PullOutcome, PushOutcome, StageOutcome, SyncConfig, SyncEngine, SyncOutcome,
};
pub use entity::{Entity, EntityKind};
pub use error::{Result, SyncError};
pub use record::{ChangePayload, PAYLOAD_VERSION};
pub use store::IncomingCursor;
pub use vclock::VClock;

pub use inkism_storage::StorageKey;

/// Authenticated relay history access; payloads remain encrypted on the server.
pub use client::RelayClient;
pub use crypto::open as open_record;
/// Seal an authenticated journal record for relay storage.
pub use crypto::seal as seal_record;
