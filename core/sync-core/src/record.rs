//! The plaintext that is encrypted into a relay blob.

use serde::{Deserialize, Serialize};

use crate::entity::Entity;
use crate::vclock::VClock;

/// Current payload schema version.
pub const PAYLOAD_VERSION: u32 = 1;

/// Everything a peer needs to apply a change and reason about ordering.
///
/// This whole struct is serialized to JSON, encrypted, and only then placed on
/// the relay. The relay never sees it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChangePayload {
    /// Payload schema version, for forward compatibility.
    pub version: u32,
    /// The object being changed.
    pub entity: Entity,
    /// Device that authored this change.
    pub device_id: String,
    /// Authoring device's counter for this entity (monotonic per entity).
    pub counter: u64,
    /// Authoring device's wall clock in Unix milliseconds. Used as the
    /// deterministic conflict tiebreaker together with `device_id`.
    pub ts: u64,
    /// The authoring device's full knowledge of this entity at edit time.
    pub vclock: VClock,
}

impl ChangePayload {
    /// Serialize to the JSON bytes that get sealed.
    pub fn encode(&self) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(self)
    }

    /// Parse decrypted JSON bytes.
    pub fn decode(bytes: &[u8]) -> serde_json::Result<Self> {
        serde_json::from_slice(bytes)
    }

    /// Deterministic total order used to pick a winner under conflict.
    ///
    /// Orders by wall clock, then by device id so both peers independently
    /// agree. Never used to *discard* data: the loser is preserved as a
    /// conflict copy.
    pub fn wins_over(&self, other: &ChangePayload) -> bool {
        (self.ts, &self.device_id) > (other.ts, &other.device_id)
    }
}
