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

/// `plain://terminal-data` event payload (F070 S2): one already-read pty
/// output chunk, in the exact order and with the exact `sequence`
/// `terminal::service`'s reader thread produced it — see that module's doc
/// for the sequencing guarantee this field carries end to end. `bytes` is
/// wire-encoded as base64 rather than a JSON `number[]`: Tauri's `emit_to`
/// always JSON-serializes an event payload (there is no raw-frame transport
/// for events the way `tauri::ipc::Response` gives commands — see
/// `workspace::commands::raw_bytes_response`/`backup::commands` for that
/// command-only precedent), and for this high-frequency, small-packet stream
/// base64's ~1.33x size overhead beats a dense decimal `number[]`'s ~3.5x+
/// overhead (each byte becomes 1-3 ASCII digits plus a separator) by a wide
/// margin — see `docs/research/2026-07-24-pty-terminal.md` and this slice's
/// final report for the full comparison. Encoding is hand-rolled
/// ([`encode_base64`]) rather than adding a `base64` crate dependency: only
/// the encode direction is ever needed on the Rust side (decode happens in
/// `app/platform/tauri/terminal-codec.ts`), and the standard algorithm is
/// small enough to keep fully in-house and unit-tested against the RFC 4648
/// test vectors, consistent with this codebase's narrow-dependency-surface
/// convention.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataEvent {
    session_id: TerminalSessionId,
    sequence: u64,
    bytes: String,
}

impl TerminalDataEvent {
    pub(crate) fn new(session_id: TerminalSessionId, sequence: u64, bytes: &[u8]) -> Self {
        Self {
            session_id,
            sequence,
            bytes: encode_base64(bytes),
        }
    }
}

/// `plain://terminal-exit` event payload (F070 S2): exactly `{ sessionId,
/// exitCode }`, deliberately omitting `TerminalExitStatus::signal` — the
/// research doc's frozen decision only calls for these two fields, and a
/// wider payload can always be added in a later slice without breaking this
/// one (widening a `deny_unknown_fields`-free `Serialize`-only event payload
/// is backward compatible for any decoder that itself only reads named
/// keys).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    session_id: TerminalSessionId,
    exit_code: u32,
}

impl TerminalExitEvent {
    pub(crate) const fn new(session_id: TerminalSessionId, exit_code: u32) -> Self {
        Self {
            session_id,
            exit_code,
        }
    }
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard (RFC 4648 §4, with `=` padding) base64 encoder — see
/// [`TerminalDataEvent`]'s doc comment for why this is hand-rolled rather
/// than a crate dependency.
fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let triple = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        out.push(BASE64_ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(BASE64_ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 {
            BASE64_ALPHABET[((triple >> 6) & 0x3F) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_ALPHABET[(triple & 0x3F) as usize] as char
        } else {
            '='
        });
    }
    out
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

    fn valid_session_id() -> super::TerminalSessionId {
        serde_json::from_value(serde_json::Value::String(VALID_ID.to_owned())).unwrap()
    }

    #[test]
    fn data_event_is_exact_camel_case_with_base64_bytes() {
        let event = super::TerminalDataEvent::new(valid_session_id(), 7, b"hi");
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({ "sessionId": VALID_ID, "sequence": 7, "bytes": "aGk=" })
        );
    }

    #[test]
    fn exit_event_is_exact_camel_case_and_omits_signal() {
        let event = super::TerminalExitEvent::new(valid_session_id(), 130);
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({ "sessionId": VALID_ID, "exitCode": 130 })
        );
    }

    /// RFC 4648 §10's canonical test vectors — the standard, unambiguous
    /// cross-implementation check for a base64 encoder's padding/alphabet.
    #[test]
    fn base64_matches_the_rfc4648_test_vectors() {
        let vectors: &[(&[u8], &str)] = &[
            (b"", ""),
            (b"f", "Zg=="),
            (b"fo", "Zm8="),
            (b"foo", "Zm9v"),
            (b"foob", "Zm9vYg=="),
            (b"fooba", "Zm9vYmE="),
            (b"foobar", "Zm9vYmFy"),
        ];
        for (input, expected) in vectors {
            assert_eq!(&super::encode_base64(input), expected);
        }
    }

    #[test]
    fn base64_round_trips_every_byte_value() {
        let bytes: Vec<u8> = (0..=255).collect();
        let encoded = super::encode_base64(&bytes);
        // Cross-check against a fully independent decode (not sharing any
        // logic with the encoder under test): standard base64 groups four
        // output characters into three input bytes.
        const ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut decoded = Vec::new();
        let chars: Vec<char> = encoded.chars().collect();
        for group in chars.chunks(4) {
            let indices: Vec<i64> = group
                .iter()
                .map(|character| {
                    if *character == '=' {
                        -1
                    } else {
                        ALPHABET.find(*character).unwrap() as i64
                    }
                })
                .collect();
            let triple = (indices[0] << 18)
                | (indices[1] << 12)
                | (indices[2].max(0) << 6)
                | indices[3].max(0);
            decoded.push(((triple >> 16) & 0xFF) as u8);
            if indices[2] >= 0 {
                decoded.push(((triple >> 8) & 0xFF) as u8);
            }
            if indices[3] >= 0 {
                decoded.push((triple & 0xFF) as u8);
            }
        }
        assert_eq!(decoded, bytes);
    }
}
