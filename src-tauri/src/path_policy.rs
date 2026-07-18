use std::fmt;
use std::path::{Path, PathBuf};

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::CommandError;

pub const MAX_RELATIVE_PATH_BYTES: usize = 4_096;
pub const MAX_RELATIVE_PATH_SEGMENTS: usize = 256;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct RelativePath {
    wire: String,
    native: PathBuf,
}

impl RelativePath {
    pub fn parse_wire(wire: &str) -> Result<Self, CommandError> {
        if wire.len() > MAX_RELATIVE_PATH_BYTES {
            return Err(invalid_relative_path());
        }

        if wire.is_empty() {
            return Ok(Self {
                wire: String::new(),
                native: PathBuf::new(),
            });
        }

        if wire.starts_with('/') || wire.contains('\0') || wire.contains('\\') || wire.contains(':')
        {
            return Err(invalid_relative_path());
        }

        let mut native = PathBuf::new();
        let mut segment_count = 0;
        for segment in wire.split('/') {
            segment_count += 1;
            if segment_count > MAX_RELATIVE_PATH_SEGMENTS
                || segment.is_empty()
                || matches!(segment, "." | "..")
                || is_windows_ambiguous_segment(segment)
            {
                return Err(invalid_relative_path());
            }
            native.push(segment);
        }

        Ok(Self {
            wire: wire.to_owned(),
            native,
        })
    }

    pub fn is_root(&self) -> bool {
        self.wire.is_empty()
    }

    pub fn as_wire(&self) -> &str {
        &self.wire
    }

    pub fn as_path(&self) -> &Path {
        &self.native
    }
}

impl fmt::Display for RelativePath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.wire)
    }
}

impl Serialize for RelativePath {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.wire)
    }
}

impl<'de> Deserialize<'de> for RelativePath {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        Self::parse_wire(&wire).map_err(|_| D::Error::custom("invalid relative path"))
    }
}

fn invalid_relative_path() -> CommandError {
    CommandError::new(
        "INVALID_RELATIVE_PATH",
        "The workspace-relative path is invalid.",
    )
}

fn is_windows_ambiguous_segment(segment: &str) -> bool {
    if segment.ends_with(['.', ' '])
        || segment.bytes().any(|byte| {
            byte.is_ascii_control() || matches!(byte, b'<' | b'>' | b'"' | b'|' | b'?' | b'*')
        })
    {
        return true;
    }

    let stem = segment.split('.').next().unwrap_or(segment);
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || upper
        .strip_prefix("COM")
        .or_else(|| upper.strip_prefix("LPT"))
        .is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::{
        is_windows_ambiguous_segment, RelativePath, MAX_RELATIVE_PATH_BYTES,
        MAX_RELATIVE_PATH_SEGMENTS,
    };

    #[test]
    fn empty_wire_path_is_the_only_root_spelling() {
        let root = RelativePath::parse_wire("").expect("empty path is the root");
        assert!(root.is_root());
        assert_eq!(root.as_wire(), "");

        for vector in [".", "./", "/", "//"] {
            assert_invalid(vector);
        }
    }

    #[test]
    fn accepts_normal_utf8_segments_without_lossy_conversion() {
        let path = RelativePath::parse_wire("src/编辑器.rs").expect("valid relative path");
        assert!(!path.is_root());
        assert_eq!(path.as_wire(), "src/编辑器.rs");
        assert_eq!(path.as_path(), std::path::Path::new("src/编辑器.rs"));
    }

    #[test]
    fn rejects_cross_platform_escape_and_ambiguous_vectors() {
        for vector in [
            "/etc/passwd",
            "../secret",
            "src/../secret",
            "./src",
            "src/./main.rs",
            "src//main.rs",
            "src/",
            "a\\b",
            "C:/Windows",
            "file:stream",
            "nul\0byte",
            "CON",
            "aux.txt",
            "COM1.log",
            "COM¹.log",
            "lpt²",
            "LPT³.txt",
            "CONIN$",
            "conout$.log",
            "folder. ",
            "less<than",
            "greater>than",
            "double\"quote",
            "pipe|name",
            "question?mark",
            "star*name",
            "control\u{1f}name",
        ] {
            assert_invalid(vector);
        }
    }

    #[test]
    fn percent_encoded_traversal_is_an_ordinary_filename() {
        let path = RelativePath::parse_wire("%2e%2e").expect("path layer does not URL-decode");
        assert_eq!(path.as_wire(), "%2e%2e");
        assert_eq!(path.as_path(), std::path::Path::new("%2e%2e"));
    }

    #[test]
    fn windows_ambiguity_helper_rejects_reserved_characters_and_controls() {
        for segment in [
            "a<b", "a>b", "a\"b", "a|b", "a?b", "a*b", "a\u{01}b", "a\u{1f}b",
        ] {
            assert!(is_windows_ambiguous_segment(segment), "{segment:?}");
        }
        for segment in ["plain", "编辑器.rs", "%2e%2e"] {
            assert!(!is_windows_ambiguous_segment(segment), "{segment:?}");
        }
    }

    #[test]
    fn enforces_byte_and_segment_limits() {
        assert_invalid(&"a".repeat(MAX_RELATIVE_PATH_BYTES + 1));
        let too_many_segments = std::iter::repeat_n("a", MAX_RELATIVE_PATH_SEGMENTS + 1)
            .collect::<Vec<_>>()
            .join("/");
        assert_invalid(&too_many_segments);

        let largest_segment = "a".repeat(MAX_RELATIVE_PATH_BYTES);
        assert!(RelativePath::parse_wire(&largest_segment).is_ok());
        let maximum_segments = std::iter::repeat_n("a", MAX_RELATIVE_PATH_SEGMENTS)
            .collect::<Vec<_>>()
            .join("/");
        assert!(RelativePath::parse_wire(&maximum_segments).is_ok());
    }

    #[test]
    fn serde_never_accepts_an_unvalidated_path() {
        let path: RelativePath =
            serde_json::from_str("\"src/main.rs\"").expect("valid path deserializes");
        assert_eq!(serde_json::to_string(&path).unwrap(), "\"src/main.rs\"");
        assert!(serde_json::from_str::<RelativePath>("\"../escape\"").is_err());
    }

    fn assert_invalid(wire: &str) {
        let error = RelativePath::parse_wire(wire).expect_err("path must be rejected");
        assert_eq!(error.code(), "INVALID_RELATIVE_PATH");
        assert_eq!(error.message(), "The workspace-relative path is invalid.");
    }
}
