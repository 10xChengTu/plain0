//! Stdio/TCP-agnostic `Content-Length` framing state machine for the Debug
//! Adapter Protocol wire format (`F100` S0) — see
//! `docs/research/2026-07-28-generic-dap.md`'s "协议基础事实" section for the
//! spec citations and the real `lldb-dap`/`debugpy` byte captures
//! `framing::tests` freezes into regression fixtures.
//!
//! # Why this is transport-agnostic
//!
//! The research doc's own real TCP test (`initialize` deliberately split
//! into 74 separate 3-byte writes over a real socket; confirmed to reassemble
//! correctly) already proves stdio and TCP share one framing format start to
//! finish — the only thing that differs between the two transports is
//! *where the bytes come from* (a pipe vs. a socket), never how they are
//! framed. [`FrameDecoder`] therefore takes no transport reference at all: it
//! is fed arbitrarily-sized byte chunks via [`FrameDecoder::feed`] and is
//! completely agnostic to whether the caller's eventual reader loop (a later
//! slice's job — S2 owns real session orchestration) is reading a stdio pipe
//! or a `TcpStream`.
//!
//! # Header/body separator: strictly `\r\n\r\n`
//!
//! Per the DAP spec (quoted in the research doc): "the content part of a
//! message is always preceded (and uniquely identified) by two `\r\n`
//! sequences" — both real adapters this project captured (`lldb-dap`,
//! `debugpy`) use exactly this separator, never a bare `\n\n` or any mixed
//! variant. This decoder deliberately does **not** add tolerance for `\n\n`:
//! that is not something either the real spec or either real captured
//! adapter needs, and silently accepting it would paper over a genuinely
//! malformed adapter rather than surfacing it. A header block that never
//! produces a literal `\r\n\r\n` simply never resolves into a header at all —
//! see [`FramingError::HeaderTooLarge`] for the bounded failure mode this
//! produces (not a hang, not a silent alternate acceptance) once
//! [`MAX_DAP_HEADER_BYTES`] is exceeded while still scanning for it.
//! `tests::lf_only_separator_under_the_cap_never_resolves_as_a_valid_header`
//! and its `_exceeding_the_cap_` sibling are the regression proving `\n\n`
//! specifically is never accidentally treated as valid, and that it still
//! fails deterministically once it grows past the cap.
//!
//! # Unknown header fields are tolerated; `Content-Length` matched case-sensitively
//!
//! The spec explicitly permits (and requires tolerating) header fields other
//! than `Content-Length` — this decoder splits the header block into
//! `Name: Value` lines (first `:` only, both sides trimmed) and ignores every
//! line whose name is not the literal string `Content-Length`. The match is
//! case-sensitive, matching the exact casing both `lldb-dap` and `debugpy`
//! emit in this project's own captured evidence: there is no real observed
//! adapter that varies this casing, so tolerating a case fold would only
//! widen the accepted input surface without a real need it actually serves.
//! See `tests::a_differently_cased_content_length_header_is_not_recognized`.
//!
//! # Full DAP envelope typing is a later slice's job
//!
//! [`DecodedMessage`] deliberately stays untyped past `body: Vec<u8>` — the
//! frozen research doc's own S0 slice description only asks for the framing
//! state machine itself. Parsing `type`/`request_seq`/`seq`/`command`/`event`
//! out of the JSON body and building request/response correlation on top of
//! it is S2's "真实会话生命周期" job, not this one's.

use std::str;

/// Per-message body size ceiling — bounds a hostile or malformed adapter's
/// claimed `Content-Length` from causing unbounded allocation, while staying
/// generously above any plausible single legitimate message: real DAP
/// `variables`/`evaluate` responses can carry a very large string (a huge
/// buffer/JSON blob the user is inspecting, a deep stack trace with many long
/// frames), and 64 MiB comfortably exceeds any such payload this project has
/// actually observed while still bounding worst-case memory against a
/// malformed/hostile claimed length. Like `git::exec::GIT_EXEC_OUTPUT_CAP_BYTES`,
/// this is a defensive ceiling, not yet measurement-backed against a real
/// huge payload — the frozen research doc's own S5 slice ("真实大对象基准
/// 测试") is explicitly where this number gets revisited against real
/// measured large payloads; this slice does not do that benchmarking.
pub(crate) const MAX_DAP_MESSAGE_BYTES: usize = 67_108_864; // 64 MiB

/// Header-block size ceiling — bounds a header block that never produces a
/// `\r\n\r\n` terminator from growing the decode buffer forever. Every real
/// header block this project has actually captured (the `lldb-dap`/`debugpy`
/// sessions cited in `docs/research/2026-07-28-generic-dap.md`) is a single
/// `Content-Length: NNN\r\n\r\n` line under 40 bytes; 8 KiB is two orders of
/// magnitude of headroom even with several unknown extra header fields (the
/// spec permits and requires tolerating those) while still bounding the
/// pathological/hostile "never terminates" case (see the module doc's
/// "header/body separator" section — this is also the mechanism that bounds
/// a `\n\n`-only stream, which this decoder never treats as a valid
/// terminator).
pub(crate) const MAX_DAP_HEADER_BYTES: usize = 8_192; // 8 KiB

const HEADER_TERMINATOR: &[u8] = b"\r\n\r\n";
const CONTENT_LENGTH_FIELD_NAME: &str = "Content-Length";

/// A single fully-decoded DAP wire message. `content_length` is the
/// `Content-Length` header's own declared value (kept alongside `body`
/// mostly so tests/regression fixtures can assert against it directly —
/// `body.len()` always equals it by construction); `body` is the raw JSON
/// bytes with no parsing applied at all — see the module doc's "full DAP
/// envelope typing" section for why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecodedMessage {
    pub(crate) content_length: usize,
    pub(crate) body: Vec<u8>,
}

/// Every way [`FrameDecoder::feed`] can fail. Each variant corresponds to
/// exactly one malformed-input case this slice's own report enumerates; see
/// each variant's own doc comment for its trigger and `tests.rs`'s matching
/// fixture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FramingError {
    /// [`MAX_DAP_HEADER_BYTES`] was exceeded while still scanning for the
    /// `\r\n\r\n` terminator — including the "adapter sent `\n\n` instead of
    /// `\r\n\r\n`" case, which never terminates a header and so always ends
    /// up here once enough bytes accumulate (see the module doc).
    HeaderTooLarge,
    /// A header block was found (the `\r\n\r\n` terminator arrived) but no
    /// `Content-Length` field was present in it.
    MissingContentLength,
    /// A `Content-Length` field was present but its value did not parse as an
    /// unsigned integer — covers non-numeric text, a leading `-` (negative),
    /// and a value with too many digits to fit `usize` (overflow), all via
    /// the same `str::parse::<usize>` call. See `tests.rs` for one fixture
    /// per case proving all three land here, not three different behaviors.
    InvalidContentLength,
    /// `Content-Length` parsed successfully but the value exceeds
    /// [`MAX_DAP_MESSAGE_BYTES`] — returned the instant the header itself is
    /// parsed, before ever waiting for or allocating anywhere close to the
    /// claimed body size.
    MessageTooLarge,
}

enum DecoderState {
    AwaitingHeader,
    AwaitingBody { content_length: usize },
}

/// The framing state machine itself — see the module doc for the full design
/// rationale. Owns an append-only decode buffer (bytes already emitted as a
/// [`DecodedMessage`] are drained out of it as soon as they are complete) plus
/// a small state enum tracking whether it is currently scanning for a header
/// terminator or waiting for a known-length body.
///
/// Real production caller: `super::session::run_reader` (`F100` S2's session
/// reader loop).
pub(crate) struct FrameDecoder {
    buffer: Vec<u8>,
    state: DecoderState,
}

impl FrameDecoder {
    pub(crate) fn new() -> Self {
        Self {
            buffer: Vec::new(),
            state: DecoderState::AwaitingHeader,
        }
    }

    /// Feeds `chunk` (any size — including a single byte, or several
    /// back-to-back complete messages at once) into the decoder, returning
    /// every complete [`DecodedMessage`] this call was able to drain. Any
    /// incomplete remainder (a partial header, or a body still short of its
    /// declared `Content-Length`) stays buffered for the next call.
    ///
    /// Once this returns `Err`, the decoder should be treated as terminated
    /// by the caller (a malformed/hostile stream) — this slice does not
    /// define resynchronization-after-error semantics, matching the module
    /// doc's "surface a malformed adapter, do not paper over it" stance.
    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Result<Vec<DecodedMessage>, FramingError> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();
        loop {
            match self.state {
                DecoderState::AwaitingHeader => match find_header_terminator(&self.buffer) {
                    None => {
                        if self.buffer.len() > MAX_DAP_HEADER_BYTES {
                            return Err(FramingError::HeaderTooLarge);
                        }
                        return Ok(messages);
                    }
                    Some(terminator_start) => {
                        let header_block_len = terminator_start + HEADER_TERMINATOR.len();
                        if header_block_len > MAX_DAP_HEADER_BYTES {
                            return Err(FramingError::HeaderTooLarge);
                        }
                        let content_length =
                            parse_content_length(&self.buffer[..terminator_start])?;
                        self.buffer.drain(..header_block_len);
                        if content_length > MAX_DAP_MESSAGE_BYTES {
                            return Err(FramingError::MessageTooLarge);
                        }
                        self.state = DecoderState::AwaitingBody { content_length };
                    }
                },
                DecoderState::AwaitingBody { content_length } => {
                    if self.buffer.len() < content_length {
                        return Ok(messages);
                    }
                    let body: Vec<u8> = self.buffer.drain(..content_length).collect();
                    messages.push(DecodedMessage {
                        content_length,
                        body,
                    });
                    self.state = DecoderState::AwaitingHeader;
                }
            }
        }
    }
}

impl Default for FrameDecoder {
    fn default() -> Self {
        Self::new()
    }
}

fn find_header_terminator(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(HEADER_TERMINATOR.len())
        .position(|window| window == HEADER_TERMINATOR)
}

/// Parses the `Content-Length` value out of `header_bytes` (everything before
/// the `\r\n\r\n` terminator — never includes it). Lines are split on `\r\n`;
/// each line is split on the first `:`, both sides trimmed; the first line
/// whose name is the literal `Content-Length` (case-sensitive — see the
/// module doc) wins. See [`FramingError`]'s own variant docs for exactly
/// which malformed inputs land where.
fn parse_content_length(header_bytes: &[u8]) -> Result<usize, FramingError> {
    let Ok(header_text) = str::from_utf8(header_bytes) else {
        // Non-UTF-8 header bytes cannot contain a well-formed
        // `Content-Length: <digits>` field either way — folding this into
        // "no Content-Length field found" rather than inventing a fifth
        // error variant for an input class the real spec (7-bit-clean ASCII
        // header field names/values) never produces.
        return Err(FramingError::MissingContentLength);
    };
    for line in header_text.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim() != CONTENT_LENGTH_FIELD_NAME {
            continue;
        }
        return value
            .trim()
            .parse::<usize>()
            .map_err(|_| FramingError::InvalidContentLength);
    }
    Err(FramingError::MissingContentLength)
}

#[cfg(test)]
mod tests;
