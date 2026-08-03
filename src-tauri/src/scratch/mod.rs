use std::fmt;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::{Uuid, Variant, Version};

use crate::error::CommandError;

pub(crate) mod commands;
pub mod dto;
pub(crate) mod frame;
pub(crate) mod service;

pub(crate) const MAX_SCRATCH_ENTRY_BYTES: usize = 8 * 1_024 * 1_024;
pub(crate) const MAX_SCRATCH_ENTRIES: usize = 4_096;

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ScratchId(Uuid);

impl ScratchId {
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }

    pub(crate) fn parse_v4_wire(wire: &str) -> Result<Self, CommandError> {
        let value = Uuid::parse_str(wire).map_err(|_| invalid_scratch_id())?;
        if value.hyphenated().to_string() != wire
            || value.get_version() != Some(Version::Random)
            || value.get_variant() != Variant::RFC4122
        {
            return Err(invalid_scratch_id());
        }
        Ok(Self(value))
    }
}

impl fmt::Debug for ScratchId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("ScratchId")
            .field(&self.as_wire())
            .finish()
    }
}

impl Serialize for ScratchId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for ScratchId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        Self::parse_v4_wire(&wire).map_err(|_| D::Error::custom("invalid scratch id"))
    }
}

pub(crate) fn invalid_scratch_id() -> CommandError {
    CommandError::new("INVALID_SCRATCH_ID", "The scratch identifier is invalid.")
}

pub(crate) fn invalid_scratch_request() -> CommandError {
    CommandError::new("INVALID_SCRATCH_REQUEST", "The scratch request is invalid.")
}

pub(crate) fn scratch_too_large() -> CommandError {
    CommandError::new(
        "SCRATCH_TOO_LARGE",
        "The scratch payload exceeds the supported size limit.",
    )
}

pub(crate) fn scratch_unavailable() -> CommandError {
    CommandError::new(
        "SCRATCH_UNAVAILABLE",
        "The scratch store is not available for this window.",
    )
}

#[cfg(test)]
mod tests {
    use super::ScratchId;

    #[test]
    fn scratch_ids_are_canonical_uuid_v4_values() {
        let id = ScratchId::new();
        assert_eq!(ScratchId::parse_v4_wire(&id.as_wire()).unwrap(), id);
        for invalid in [
            "00000000-0000-0000-0000-000000000000",
            "00000000-0000-4000-0000-000000000000",
            "00000000-0000-4000-8000-00000000000A",
            "not-a-scratch-id",
        ] {
            assert!(ScratchId::parse_v4_wire(invalid).is_err());
        }
    }
}
