//! The domain object that the engine synchronizes.

use serde::{Deserialize, Serialize};

/// Kinds of synchronized objects. `Setting` ids are setting keys; app
/// versions before it leave such records pending instead of applying them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityKind {
    Note,
    Notebook,
    Setting,
    NamedVersion,
}

impl EntityKind {
    /// Stable string used in the state database.
    pub fn as_str(self) -> &'static str {
        match self {
            EntityKind::Note => "note",
            EntityKind::Notebook => "notebook",
            EntityKind::Setting => "setting",
            EntityKind::NamedVersion => "namedversion",
        }
    }

    /// Inverse of [`EntityKind::as_str`].
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "note" => Some(EntityKind::Note),
            "notebook" => Some(EntityKind::Notebook),
            "setting" => Some(EntityKind::Setting),
            "namedversion" => Some(EntityKind::NamedVersion),
            _ => None,
        }
    }
}

/// A synchronizable object.
///
/// `data` is an opaque JSON document owned by the host (the note or notebook
/// row). The sync engine never interprets it beyond moving it around; the host
/// is responsible for validating it before applying.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entity {
    /// Note or notebook.
    pub kind: EntityKind,
    /// Stable UUID string.
    pub id: String,
    /// Host-owned payload.
    pub data: serde_json::Value,
    /// Tombstone flag. Deleted entities still sync so peers can remove them.
    #[serde(default)]
    pub deleted: bool,
}

impl Entity {
    /// Convenience constructor.
    pub fn new(kind: EntityKind, id: impl Into<String>, data: serde_json::Value) -> Self {
        Entity {
            kind,
            id: id.into(),
            data,
            deleted: false,
        }
    }

    /// Returns a copy marked deleted (a tombstone).
    pub fn tombstone(mut self) -> Self {
        self.deleted = true;
        self
    }
}
