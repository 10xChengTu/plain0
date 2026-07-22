use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::CommandError;

pub(crate) mod commands;
pub mod dto;
pub(crate) mod frame;
pub(crate) mod service;
mod store;

/// Maximum byte length of a backup key's wire representation.
pub(crate) const MAX_BACKUP_KEY_BYTES: usize = 128;

/// Maximum byte length of a single backup entry's content. Chosen to match
/// the versioned workspace write ceiling so the same editor content that can
/// be saved can also be backed up.
pub(crate) const MAX_BACKUP_ENTRY_BYTES: u64 = 8 * 1_024 * 1_024;

/// Defensive ceiling on the number of entries a single window/workspace may
/// enumerate in one `backup_read_all` call. Chosen generously above any
/// realistic dirty-editor count; exceeding it fails the whole enumeration
/// instead of silently truncating recoverable content.
pub(crate) const MAX_BACKUP_ENTRIES: usize = 4_096;

/// An opaque, caller-supplied backup key.
///
/// Never used as a path segment until validated: only the ASCII alphabet
/// `[a-z0-9-]{1,128}` is accepted, which rules out `/`, `\`, NUL, `.`/`..`
/// segments, uppercase, whitespace and every other filesystem-meaningful
/// character. The validated value is later used verbatim as a single
/// filename inside a capability-relative directory, never concatenated into
/// a multi-segment path.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct BackupKey(String);

impl BackupKey {
    pub(crate) fn parse(wire: &str) -> Result<Self, CommandError> {
        if wire.is_empty()
            || wire.len() > MAX_BACKUP_KEY_BYTES
            || !wire
                .bytes()
                .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
        {
            return Err(invalid_backup_key());
        }
        Ok(Self(wire.to_owned()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl Serialize for BackupKey {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for BackupKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        Self::parse(&wire).map_err(|_| D::Error::custom("invalid backup key"))
    }
}

pub(crate) fn invalid_backup_key() -> CommandError {
    CommandError::new("INVALID_BACKUP_KEY", "The backup key is invalid.")
}

pub(crate) fn backup_too_large() -> CommandError {
    CommandError::new(
        "BACKUP_TOO_LARGE",
        "The backup payload exceeds the supported size limit.",
    )
}

pub(crate) fn backup_unavailable() -> CommandError {
    CommandError::new(
        "BACKUP_UNAVAILABLE",
        "The backup store is not available for this window.",
    )
}

pub(crate) fn backup_io_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The backup entry could not be processed.")
}

#[cfg(test)]
mod tests {
    use super::{BackupKey, MAX_BACKUP_KEY_BYTES};

    #[test]
    fn accepts_lowercase_alphanumeric_and_hyphen_up_to_the_byte_limit() {
        let longest = "a".repeat(MAX_BACKUP_KEY_BYTES);
        for key in ["a", "0", "-", "abc-123", longest.as_str()] {
            assert_eq!(BackupKey::parse(key).unwrap().as_str(), key);
        }
    }

    #[test]
    fn rejects_empty_overlong_and_forbidden_characters() {
        let overlong = "a".repeat(MAX_BACKUP_KEY_BYTES + 1);
        for key in [
            "",
            overlong.as_str(),
            "Abc",
            "abc.txt",
            "abc/def",
            "abc\\def",
            "..",
            ".",
            "abc def",
            "abc_def",
            "abc\0",
            "编辑器",
            "abc/../etc",
            "-.-",
        ] {
            assert_eq!(
                BackupKey::parse(key).unwrap_err().code(),
                "INVALID_BACKUP_KEY",
                "{key:?} should have been rejected"
            );
        }
    }

    #[test]
    fn serde_round_trips_a_valid_key_and_rejects_an_invalid_wire_string() {
        let key: BackupKey = serde_json::from_str("\"abc-123\"").expect("valid key deserializes");
        assert_eq!(serde_json::to_string(&key).unwrap(), "\"abc-123\"");
        assert!(serde_json::from_str::<BackupKey>("\"../escape\"").is_err());
        assert!(serde_json::from_str::<BackupKey>("\"UPPER\"").is_err());
    }
}
