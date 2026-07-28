//! DAP wire-envelope parsing/encoding (`F100` S2) — sits on top of
//! [`super::framing::FrameDecoder`]'s already-transport-agnostic
//! `Content-Length` decoder: that module stops at `body: Vec<u8>` on
//! purpose (see its own module doc's "full DAP envelope typing is a later
//! slice's job" section); this module is that later slice, parsing the raw
//! JSON body into the three envelope shapes the spec defines
//! (`Response`/`Event`/reverse `Request`) and encoding outgoing requests and
//! reverse-request responses back into fully framed bytes.
//!
//! # Why `request_seq` is the only correlation field this module trusts
//!
//! `docs/research/2026-07-28-generic-dap.md`'s own real capture proved
//! `lldb-dap` returns a response with `"seq":0` — flatly contradicting the
//! common assumption that `seq` increments from 1. Every function here
//! treats an incoming message's own `seq` field as write-only noise: it is
//! never read out of a [`ResponseEnvelope`] or [`EventEnvelope`] at all (the
//! struct fields do not even exist), and is read out of a
//! [`ReverseRequestEnvelope`] for exactly one purpose — echoing it back
//! verbatim as the eventual reply's `request_seq`, which is a structural
//! requirement of the reverse-request mechanism itself (the adapter
//! correlates our reply the same way we correlate its replies), not an
//! assumption about what value it holds. [`super::session`] is the only
//! place `request_seq` is ever compared against anything, and it compares it
//! only against the seq *we* assigned when we sent the original request —
//! never against the adapter's own `seq` counter.
//!
//! # Deliberately loose body typing
//!
//! `body`/`arguments` stay `serde_json::Value` — ADR 0003 requires
//! transparent passthrough of adapter-specific payloads, and ADR 0003 /
//! `docs/research/2026-07-28-generic-dap.md`'s "决策 1" `capabilities`
//! handling both call for capability negotiation rather than a fixed struct
//! (see [`Capabilities`]'s own doc comment) — a fully-typed `body` for every
//! possible DAP response would have to enumerate fields this project has
//! never even observed on either of the two real adapters this project has
//! captured.

use serde::Deserialize;
use serde_json::Value;
use std::str;

/// A fully-parsed `type: "response"` envelope. Deliberately has no `seq`
/// field at all — see the module doc's "why `request_seq` is the only
/// correlation field" section.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ResponseEnvelope {
    pub(crate) request_seq: i64,
    pub(crate) success: bool,
    pub(crate) command: String,
    pub(crate) message: Option<String>,
    pub(crate) body: Option<Value>,
}

/// A fully-parsed `type: "event"` envelope.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EventEnvelope {
    pub(crate) event: String,
    pub(crate) body: Option<Value>,
}

/// A fully-parsed `type: "request"` envelope arriving in the *reverse*
/// direction (adapter → client — the mechanism `runInTerminal` uses). `seq`
/// is kept here (unlike the other two envelopes) because the eventual reply
/// must echo it back as `request_seq` — see the module doc.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReverseRequestEnvelope {
    pub(crate) seq: i64,
    pub(crate) command: String,
    pub(crate) arguments: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum IncomingMessage {
    Response(ResponseEnvelope),
    Event(EventEnvelope),
    Request(ReverseRequestEnvelope),
}

/// Every way [`parse_incoming_message`] can fail — deliberately a flat,
/// non-fatal-to-the-session error type: [`super::session`]'s reader loop
/// treats every variant here as "surface a diagnostic event and keep
/// reading" (see that module's doc), never as a reason to tear down the
/// whole session — the framing layer below already proved the byte stream
/// itself is intact (a `Content-Length`-bounded body was successfully
/// extracted); only *this* message's JSON content was bad.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProtocolError {
    InvalidUtf8,
    InvalidJson,
    UnknownMessageType,
    MalformedResponse,
    MalformedEvent,
    MalformedRequest,
}

#[derive(Deserialize)]
struct RawEnvelope {
    #[serde(rename = "type")]
    kind: String,
}

/// Parses `body` (one [`super::framing::DecodedMessage::body`]) into an
/// [`IncomingMessage`]. Never panics on hostile input — malformed UTF-8,
/// malformed JSON, an unrecognized `type`, or a recognized `type` missing
/// its own required fields all map to a distinct [`ProtocolError`] variant
/// rather than propagating a `serde_json` panic or an unwrap.
pub(crate) fn parse_incoming_message(body: &[u8]) -> Result<IncomingMessage, ProtocolError> {
    let text = str::from_utf8(body).map_err(|_| ProtocolError::InvalidUtf8)?;
    let value: Value = serde_json::from_str(text).map_err(|_| ProtocolError::InvalidJson)?;
    let Value::Object(mut object) = value else {
        return Err(ProtocolError::InvalidJson);
    };
    // Deserializing just the `type` discriminator first (rather than the
    // whole object) means an otherwise well-formed message with an unknown
    // `type` is reported as `UnknownMessageType`, not folded into the same
    // bucket as genuinely unparseable JSON.
    let kind = serde_json::from_value::<RawEnvelope>(Value::Object(object.clone()))
        .map_err(|_| ProtocolError::InvalidJson)?
        .kind;
    match kind.as_str() {
        "response" => {
            let request_seq = object
                .remove("request_seq")
                .and_then(|value| value.as_i64())
                .ok_or(ProtocolError::MalformedResponse)?;
            let success = object
                .remove("success")
                .and_then(|value| value.as_bool())
                .ok_or(ProtocolError::MalformedResponse)?;
            let command = object
                .remove("command")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or(ProtocolError::MalformedResponse)?;
            let message = object
                .remove("message")
                .and_then(|value| value.as_str().map(str::to_owned));
            let body = object.remove("body");
            Ok(IncomingMessage::Response(ResponseEnvelope {
                request_seq,
                success,
                command,
                message,
                body,
            }))
        }
        "event" => {
            let event = object
                .remove("event")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or(ProtocolError::MalformedEvent)?;
            let body = object.remove("body");
            Ok(IncomingMessage::Event(EventEnvelope { event, body }))
        }
        "request" => {
            let seq = object
                .remove("seq")
                .and_then(|value| value.as_i64())
                .ok_or(ProtocolError::MalformedRequest)?;
            let command = object
                .remove("command")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or(ProtocolError::MalformedRequest)?;
            let arguments = object.remove("arguments");
            Ok(IncomingMessage::Request(ReverseRequestEnvelope {
                seq,
                command,
                arguments,
            }))
        }
        _ => Err(ProtocolError::UnknownMessageType),
    }
}

/// Encodes an outgoing request as a fully `Content-Length`-framed byte
/// buffer ready to write straight to the transport. `seq` is Plain's own
/// monotonic per-session counter (see [`super::session::DebugSession`]) —
/// never read back out of the adapter's response to correlate anything (see
/// the module doc); it is included purely because the spec requires every
/// `ProtocolMessage` to carry one.
pub(crate) fn encode_request(seq: i64, command: &str, arguments: Option<Value>) -> Vec<u8> {
    let mut object = serde_json::Map::new();
    object.insert("seq".to_owned(), Value::from(seq));
    object.insert("type".to_owned(), Value::from("request"));
    object.insert("command".to_owned(), Value::from(command));
    if let Some(arguments) = arguments {
        object.insert("arguments".to_owned(), arguments);
    }
    frame(&Value::Object(object))
}

/// Encodes a reply to a *reverse* request (adapter → client) — `request_seq`
/// must be the reverse request's own `seq` field, echoed back verbatim (see
/// [`ReverseRequestEnvelope`]'s doc). Used today only by
/// [`super::session`]'s minimal "acknowledge and decline" handling of
/// reverse requests it does not yet implement (real `runInTerminal` handling
/// is `F100` S4's job) — see that module's doc for why declining rather than
/// never replying at all matters (an adapter's own request/response
/// machinery would otherwise wait forever for a reply that never comes).
pub(crate) fn encode_response(
    seq: i64,
    request_seq: i64,
    command: &str,
    success: bool,
    message: Option<&str>,
    body: Option<Value>,
) -> Vec<u8> {
    let mut object = serde_json::Map::new();
    object.insert("seq".to_owned(), Value::from(seq));
    object.insert("type".to_owned(), Value::from("response"));
    object.insert("request_seq".to_owned(), Value::from(request_seq));
    object.insert("success".to_owned(), Value::from(success));
    object.insert("command".to_owned(), Value::from(command));
    if let Some(message) = message {
        object.insert("message".to_owned(), Value::from(message));
    }
    if let Some(body) = body {
        object.insert("body".to_owned(), body);
    }
    frame(&Value::Object(object))
}

fn frame(value: &Value) -> Vec<u8> {
    let json = serde_json::to_vec(value).expect("envelope objects always serialize");
    let mut framed = format!("Content-Length: {}\r\n\r\n", json.len()).into_bytes();
    framed.extend_from_slice(&json);
    framed
}

/// The adapter's negotiated capability set from its `initialize` response
/// body — `docs/research/2026-07-28-generic-dap.md`'s own real captures
/// prove two real adapters (`lldb-dap`, `debugpy`) report almost entirely
/// disjoint `supportsXxx` sets, so this is deliberately **not** a fixed
/// struct enumerating every known capability field. [`Self::supports`] is
/// the one, deterministic way any later slice queries a specific capability
/// — a missing field (an adapter that never mentions a capability at all,
/// not even as `false`) and an explicit `false` are indistinguishable, both
/// answering "not available", which is exactly the safe default
/// `docs/research/2026-07-28-generic-dap.md`'s "决策 3" repeatedly calls for
/// ("不能假设某功能永远可用"). [`Self::as_value`] exposes the *entire* raw
/// object as-is over IPC, so a future slice can read a capability this
/// module has no dedicated accessor for without a Rust-side change.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Capabilities {
    raw: serde_json::Map<String, Value>,
}

impl Capabilities {
    /// Builds a [`Capabilities`] from an `initialize` response's `body`.
    /// Anything other than a JSON object (missing body, `null`, or —
    /// hypothetically, for a malformed adapter — a non-object body) becomes
    /// an empty capability set: every [`Self::supports`] query then
    /// deterministically answers `false`, never a parse error, matching this
    /// module's "missing means unsupported" contract.
    pub(crate) fn from_body(body: Option<Value>) -> Self {
        let raw = match body {
            Some(Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        };
        Self { raw }
    }

    /// `true` only if `capability` is present *and* explicitly `true` in the
    /// adapter's own `initialize` response body — every other case (absent,
    /// explicitly `false`, present but not a boolean) is `false`. This is the
    /// "确定性的处理路径" `docs/research/2026-07-28-generic-dap.md` calls for
    /// when an adapter does not support something: callers never need a
    /// separate "unknown" branch.
    ///
    /// No production caller yet — `F100` S3 is where a specific capability
    /// (e.g. `supportsConditionalBreakpoints`) first gets consulted before
    /// offering the corresponding UI (frozen doc "决策 3"); this slice's job
    /// is exposing the full negotiated set (via
    /// [`Self::as_value`]/`DebugSessionStartResult.capabilities`) and getting
    /// this query method itself correct and tested (`tests`,
    /// `debug::session::tests`), not consuming it yet.
    #[allow(dead_code)] // No production caller until F100 S3 consults a specific capability.
    pub(crate) fn supports(&self, capability: &str) -> bool {
        self.raw
            .get(capability)
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    /// The entire raw capability object, for exposing over IPC verbatim
    /// (see the struct's own doc comment for why this is deliberately not a
    /// fixed, enumerated shape).
    pub(crate) fn as_value(&self) -> Value {
        Value::Object(self.raw.clone())
    }
}

#[cfg(test)]
mod tests;
