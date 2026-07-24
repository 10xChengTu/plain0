//! Wire request/response shapes for the five terminal commands. Only the
//! signatures are frozen in this slice (F070 S1): the byte-array encoding of
//! `TerminalInputRequest::data` below is a placeholder Tauri JSON shape, not
//! the audited binary frame codec `F070 S2` will replace it with (mirroring
//! how `backup`/`workspace` versioned-write frames moved from JSON to a raw
//! `tauri::ipc::Request` body once their own codec slice landed) — no
//! frontend consumes any of this yet, so there is nothing to keep binary-
//! compatible across that future change.

use std::fmt;

use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::{Uuid, Variant};

use crate::error::CommandError;

/// Defensive ceiling on `cols`/`rows` for both `terminal_start` and
/// `terminal_resize`: comfortably above any real display (a 16K monitor at
/// a 4px-wide monospace font is nowhere near this many columns), purely a
/// hostile-input backstop against a request trying to make Rust allocate an
/// unreasonable pty geometry.
const MAX_TERMINAL_DIMENSION: u16 = 2_000;
/// Defensive ceiling on a single `terminal_input` call's byte length. Real
/// keyboard input is a handful of bytes per keystroke; even a large pasted
/// block is well under this, so this is a hostile-input backstop, not an
/// expected value.
const MAX_TERMINAL_INPUT_BYTES: usize = 1024 * 1024;

/// An opaque, window-bound identity for one terminal session. Validated the
/// same strict way `search::dto::SearchId` is (exact-length, version-4,
/// RFC4122 hyphenated string), and redacted in `Debug` for the same reason.
#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct TerminalSessionId(Uuid);

impl TerminalSessionId {
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

impl fmt::Debug for TerminalSessionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("terminal session id")
            .field(&"<redacted>")
            .finish()
    }
}

impl Serialize for TerminalSessionId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for TerminalSessionId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        let value =
            Uuid::parse_str(&wire).map_err(|_| D::Error::custom("invalid terminal session id"))?;
        if value.get_version_num() != 4
            || value.get_variant() != Variant::RFC4122
            || value.hyphenated().to_string() != wire
        {
            return Err(D::Error::custom("invalid terminal session id"));
        }
        Ok(Self(value))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalStartRequest {
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Debug)]
pub(crate) struct TerminalStartQuery {
    pub(crate) cwd: Option<String>,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
}

impl TerminalStartRequest {
    pub(crate) fn into_parts(self) -> Result<TerminalStartQuery, CommandError> {
        validate_dimensions(self.cols, self.rows)?;
        Ok(TerminalStartQuery {
            cwd: self.cwd,
            cols: self.cols,
            rows: self.rows,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResult {
    session_id: TerminalSessionId,
}

impl TerminalStartResult {
    pub(crate) fn new(session_id: TerminalSessionId) -> Self {
        Self { session_id }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalInputRequest {
    session_id: TerminalSessionId,
    data: Vec<u8>,
}

impl TerminalInputRequest {
    pub(crate) fn into_parts(self) -> Result<(TerminalSessionId, Vec<u8>), CommandError> {
        if self.data.len() > MAX_TERMINAL_INPUT_BYTES {
            return Err(invalid_terminal_request());
        }
        Ok((self.session_id, self.data))
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalResizeRequest {
    session_id: TerminalSessionId,
    cols: u16,
    rows: u16,
}

impl TerminalResizeRequest {
    pub(crate) fn into_parts(self) -> Result<(TerminalSessionId, u16, u16), CommandError> {
        validate_dimensions(self.cols, self.rows)?;
        Ok((self.session_id, self.cols, self.rows))
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalAckRequest {
    session_id: TerminalSessionId,
    byte_count: u32,
}

impl TerminalAckRequest {
    pub(crate) fn into_parts(self) -> (TerminalSessionId, u32) {
        (self.session_id, self.byte_count)
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalKillRequest {
    session_id: TerminalSessionId,
    immediate: bool,
}

impl TerminalKillRequest {
    pub(crate) fn into_parts(self) -> (TerminalSessionId, bool) {
        (self.session_id, self.immediate)
    }
}

fn validate_dimensions(cols: u16, rows: u16) -> Result<(), CommandError> {
    if cols == 0 || rows == 0 || cols > MAX_TERMINAL_DIMENSION || rows > MAX_TERMINAL_DIMENSION {
        return Err(invalid_terminal_request());
    }
    Ok(())
}

fn invalid_terminal_request() -> CommandError {
    CommandError::new(
        "INVALID_TERMINAL_REQUEST",
        "The terminal request is invalid.",
    )
}

#[cfg(test)]
mod tests {
    use super::{
        TerminalAckRequest, TerminalInputRequest, TerminalKillRequest, TerminalResizeRequest,
        TerminalStartRequest, MAX_TERMINAL_INPUT_BYTES,
    };

    const VALID_ID: &str = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

    #[test]
    fn every_terminal_request_rejects_extra_fields() {
        assert!(
            serde_json::from_value::<TerminalStartRequest>(serde_json::json!({
                "cols": 80, "rows": 24, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalInputRequest>(serde_json::json!({
                "sessionId": VALID_ID, "data": [1,2,3], "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalResizeRequest>(serde_json::json!({
                "sessionId": VALID_ID, "cols": 80, "rows": 24, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalAckRequest>(serde_json::json!({
                "sessionId": VALID_ID, "byteCount": 10, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalKillRequest>(serde_json::json!({
                "sessionId": VALID_ID, "immediate": true, "extra": true
            }))
            .is_err()
        );
    }

    #[test]
    fn start_request_accepts_missing_cwd_and_rejects_zero_or_oversized_dimensions() {
        let request: TerminalStartRequest = serde_json::from_value(serde_json::json!({
            "cols": 80, "rows": 24
        }))
        .unwrap();
        let query = request.into_parts().unwrap();
        assert_eq!(query.cwd, None);
        assert_eq!(query.cols, 80);
        assert_eq!(query.rows, 24);

        for (cols, rows) in [(0, 24), (80, 0), (3_000, 24), (80, 3_000)] {
            let request: TerminalStartRequest = serde_json::from_value(serde_json::json!({
                "cols": cols, "rows": rows
            }))
            .unwrap();
            assert_eq!(
                request.into_parts().unwrap_err().code(),
                "INVALID_TERMINAL_REQUEST"
            );
        }
    }

    #[test]
    fn input_request_rejects_oversized_data() {
        let oversized = vec![0_u8; MAX_TERMINAL_INPUT_BYTES + 1];
        let request = TerminalInputRequest {
            session_id: serde_json::from_value(serde_json::Value::String(VALID_ID.to_owned()))
                .unwrap(),
            data: oversized,
        };
        assert_eq!(
            request.into_parts().unwrap_err().code(),
            "INVALID_TERMINAL_REQUEST"
        );
    }

    #[test]
    fn session_id_round_trips_and_rejects_malformed_wire_strings() {
        let value: super::TerminalSessionId =
            serde_json::from_value(serde_json::Value::String(VALID_ID.to_owned())).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), VALID_ID);

        for malformed in [
            "not-a-uuid",
            "0D3F4B0E-6F1A-4C9D-9C3A-1A2B3C4D5E6F",
            "0d3f4b0e6f1a4c9d9c3a1a2b3c4d5e6f",
        ] {
            assert!(
                serde_json::from_value::<super::TerminalSessionId>(serde_json::Value::String(
                    malformed.to_owned()
                ))
                .is_err()
            );
        }
    }
}
