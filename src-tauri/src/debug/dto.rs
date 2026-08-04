//! Forward-declared wire/interface shape for the `debug` domain's spawn
//! primitive (`F100` S0). Declared `pub mod dto` in `debug/mod.rs` —
//! deliberately not `pub(crate)` like every other submodule in this domain
//! — for the same reason `git::dto` was already `pub` before every DTO in it
//! had a real Tauri-command consumer: this sidesteps Rust's dead-code lint
//! for a type that is a genuine forward-declared interface shape, not yet
//! consumed by any caller outside this domain's own tests. `plain` compiles
//! with `crate-type = ["staticlib", "cdylib", "rlib"]`, so a `pub` item is
//! part of the library's external surface and exempt from the same
//! `#[allow(dead_code)]` bookkeeping `exec`/`framing`'s `pub(crate)` items
//! need.
//!
//! [`AdapterSpawnDescriptor`] is the minimal, real, non-trivial type
//! [`super::exec::spawn_adapter`]/[`super::exec::spawn_adapter_sync`]
//! actually consume as a function parameter today — not a decorative
//! placeholder. `F100` S1 is expected to be the first real producer of one
//! (parsed from `.plain/debug-adapters.json`'s registry entries or
//! `.vscode/launch.json`'s inline `plainAdapter` block — see
//! `commands`'s own module doc), which is why `command`/`args` already carry
//! `#[serde(...)]` attributes matching this codebase's usual wire-DTO
//! convention (camelCase, `deny_unknown_fields`) even though nothing decodes
//! one from the Tauri IPC boundary yet.
//!
//! # `F100` S2 additions
//!
//! [`DebugSessionId`] (mirroring [`crate::terminal::dto::TerminalSessionId`]'s
//! exact validated-UUID shape), [`DebugSessionStartRequest`] (the shared wire
//! shape `debug_launch`/`debug_attach` both accept — see
//! `super::commands`'s module doc for why one DTO serves both),
//! [`SourceBreakpointsRequest`]/[`LineBreakpointRequest`] (the minimal,
//! closed shape the handshake's "配置断点系列" step needs — *not* the
//! breakpoint feature/UI itself, which is `F100` S3's job; see
//! `super::session`'s module doc) and [`DebugSessionStartResult`]/
//! [`DebugSessionIdRequest`] round out the new session-lifecycle command
//! surface.

use std::fmt;

use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use uuid::{Uuid, Variant};

use crate::error::CommandError;
use crate::workspace::RootId;

use super::session::{LaunchRequestKind, SourceBreakpoints};
use super::{debug_adapter_response_malformed, debug_session_request_invalid};

/// `command` is always an absolute executable path the adapter-config format
/// hands over verbatim — never `PATH`-resolved, never combined with `args`
/// into a single string — per the frozen research doc's "决策 1" (the config
/// format's own `command` field). `args` is the adapter's own argv, passed
/// through unchanged. See [`super::exec`]'s module doc for the full spawn
/// hardening this descriptor feeds into.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct AdapterSpawnDescriptor {
    pub command: String,
    pub args: Vec<String>,
}

impl AdapterSpawnDescriptor {
    /// Builds the exact [`AdapterConfirmationSubject`] the first-run
    /// confirmation gate (`F100` S1) checks/records for this descriptor under
    /// `transport` — the sole place this crate constructs one from a spawn
    /// descriptor, so [`super::exec::spawn_adapter`]/[`super::tcp::connect_adapter`]
    /// both call this rather than each hand-assembling the three fields
    /// themselves.
    pub(crate) fn confirmation_subject(
        &self,
        transport: AdapterTransportKind,
    ) -> AdapterConfirmationSubject {
        AdapterConfirmationSubject {
            command: self.command.clone(),
            args: self.args.clone(),
            transport,
        }
    }
}

/// A TCP `host:port` to connect to for a `"tcp"`-transport adapter (`F100`
/// S1) — see `docs/research/2026-07-28-generic-dap.md`'s "主导会话裁定" item 3:
/// v1 only ever *connects out* to this address (`TcpStream::connect`), never
/// listens for an incoming connection. Deliberately **not** part of
/// [`AdapterConfirmationSubject`]'s three-field identity — the frozen
/// decision's dedup key is exactly `(command, args, transport)`, not
/// `host`/`port`: many real adapters bind an ephemeral port per run (`--port
/// 0`), and folding a value that legitimately changes every launch into the
/// confirmation key would force a fresh confirmation dialog on every single
/// debug session, defeating the point of "first-run" confirmation.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct TcpConnectDescriptor {
    pub host: String,
    pub port: u16,
}

/// Which byte-transport an adapter descriptor uses — `"stdio"` (the process's
/// own stdin/stdout pipes, [`super::exec::spawn_adapter`]) or `"tcp"` (a
/// [`TcpConnectDescriptor`], [`super::tcp::connect_adapter`]). Serializes as
/// the bare lowercase word on the wire (`"stdio"`/`"tcp"`), matching the
/// adapter-config format's own `transport` field
/// (`docs/research/2026-07-28-generic-dap.md`'s "决策 1").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AdapterTransportKind {
    Stdio,
    Tcp,
}

/// The exact, precise identity the first-run confirmation gate is keyed on —
/// "主导会话裁定" item 2's `(command 绝对路径, args 数组, transport)` triple,
/// verbatim. Two subjects that differ in *any single field* are two distinct,
/// independently-confirmable identities — this is the whole safety property
/// [`super::confirm::ConfirmationService`] exists to provide (a silently
/// edited `command` must never inherit an earlier confirmation).
///
/// Deliberately excludes `host`/`port` — see [`TcpConnectDescriptor`]'s own
/// doc comment for why. This is also the wire shape the three
/// `debug_adapter_confirmation_*` Tauri commands accept as their request body
/// (camelCase, unknown fields rejected — the frontend confirmation resolver
/// in `app/features/debug/plain-debug-adapter-confirmation.ts` sends exactly
/// this shape).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct AdapterConfirmationSubject {
    pub command: String,
    pub args: Vec<String>,
    pub transport: AdapterTransportKind,
}

// ---------------------------------------------------------------------
// `F100` S2 — real session lifecycle wire shapes.
// ---------------------------------------------------------------------

/// Defensive ceiling on `DebugSessionStartRequest.args`'s length — real
/// adapter argv lists are a handful of flags (mirrors the reasoning already
/// applied to `AdapterSpawnDescriptor`'s own `args`, which this ceiling does
/// not itself touch — this one guards the wire *request*, not the descriptor
/// type), not an expected value.
const MAX_DEBUG_SESSION_ARGS: usize = 256;
/// Defensive ceiling on how many distinct source files
/// `DebugSessionStartRequest.initial_breakpoints` may name in one request —
/// mirrors the adapter-config parser's own "256 registry entries/launch
/// configs" double-fence ceiling (`app/features/debug/plain-debug-adapter-config.ts`),
/// not an expected value.
const MAX_DEBUG_SESSION_BREAKPOINT_SOURCES: usize = 256;
/// Defensive ceiling on how many breakpoints one source entry may carry —
/// generous above any real source file's realistic breakpoint count, purely
/// a hostile-input backstop.
const MAX_DEBUG_SESSION_BREAKPOINTS_PER_SOURCE: usize = 4096;

/// An opaque, window-bound identity for one live debug session. Validated
/// exactly like [`crate::terminal::dto::TerminalSessionId`] (exact-length,
/// version-4, RFC4122 hyphenated string) and redacted in `Debug` for the
/// same reason.
#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DebugSessionId(Uuid);

impl DebugSessionId {
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

impl fmt::Debug for DebugSessionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("debug session id")
            .field(&"<redacted>")
            .finish()
    }
}

impl Serialize for DebugSessionId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for DebugSessionId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        let value =
            Uuid::parse_str(&wire).map_err(|_| D::Error::custom("invalid debug session id"))?;
        if value.get_version_num() != 4
            || value.get_variant() != Variant::RFC4122
            || value.hyphenated().to_string() != wire
        {
            return Err(D::Error::custom("invalid debug session id"));
        }
        Ok(Self(value))
    }
}

/// One `line`/`condition`/`logMessage`/`hitCondition` breakpoint entry
/// within a [`SourceBreakpointsRequest`] — the wire shape for the
/// handshake's "setBreakpoints series" step (see `super::session`'s module
/// doc for why this is deliberately minimal, not the breakpoint feature
/// itself). `hit_condition` is an adapter-interpreted expression (e.g.
/// `"5"`/`">=3"`) this domain never parses — `set_breakpoints_arguments`
/// only trims and skips it when blank, exactly like every other field here
/// (no deserialize-time rejection of an empty/whitespace string, matching
/// `condition`/`log_message`'s own existing treatment — see
/// `docs/research/2026-08-04-complete-debug.md`'s "架构裁定 §3").
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct LineBreakpointRequest {
    pub line: u32,
    #[serde(default)]
    pub condition: Option<String>,
    #[serde(default)]
    pub log_message: Option<String>,
    #[serde(default)]
    pub hit_condition: Option<String>,
}

/// One source file's breakpoints — becomes one `setBreakpoints` request
/// during the handshake, per `docs/research/2026-07-28-generic-dap.md`'s
/// "决策 3" (`condition`/`logMessage` are only actually honored by an adapter
/// advertising `supportsConditionalBreakpoints`/`supportsLogPoints` — this
/// domain sends them regardless and lets the adapter itself decide, per that
/// same decision's own wording; a future slice consulting
/// [`super::protocol::Capabilities`] before even offering the UI to set one
/// is `F100` S3's job, not this DTO's).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SourceBreakpointsRequest {
    pub path: String,
    pub breakpoints: Vec<LineBreakpointRequest>,
}

/// Shared by [`SourceBreakpointsRequest::to_source_breakpoints`] (the
/// handshake's initial-configuration path) and
/// [`DebugSetBreakpointsRequest::into_parts`] (`F100` S3's runtime
/// `debug_set_breakpoints` command) — both build the exact same
/// `setBreakpoints` `arguments` shape from a path and a breakpoint list, and
/// this is the one place that shape is assembled.
fn set_breakpoints_arguments(path: &str, breakpoints: &[LineBreakpointRequest]) -> Value {
    let encoded: Vec<Value> = breakpoints
        .iter()
        .map(|breakpoint| {
            let mut object = serde_json::Map::new();
            object.insert("line".to_owned(), Value::from(breakpoint.line));
            if let Some(condition) = &breakpoint.condition {
                object.insert("condition".to_owned(), Value::from(condition.clone()));
            }
            if let Some(log_message) = &breakpoint.log_message {
                object.insert("logMessage".to_owned(), Value::from(log_message.clone()));
            }
            if let Some(hit_condition) = &breakpoint.hit_condition {
                let trimmed = hit_condition.trim();
                if !trimmed.is_empty() {
                    object.insert("hitCondition".to_owned(), Value::from(trimmed.to_owned()));
                }
            }
            Value::Object(object)
        })
        .collect();
    serde_json::json!({
        "source": { "path": path },
        "breakpoints": encoded,
    })
}

impl SourceBreakpointsRequest {
    fn to_source_breakpoints(&self) -> SourceBreakpoints {
        SourceBreakpoints {
            arguments: set_breakpoints_arguments(&self.path, &self.breakpoints),
        }
    }
}

/// Which transport a resolved [`DebugSessionStartQuery`] uses — the
/// service-layer counterpart of the wire-level `transport`/`host`/`port`
/// fields on [`DebugSessionStartRequest`], already split by kind so
/// `super::service::DebugSessionService::start_session` never has to
/// re-derive "does this request need a host/port" from optional fields.
pub(crate) enum SessionTransportRequest {
    Stdio {
        command: String,
        args: Vec<String>,
    },
    Tcp {
        command: String,
        args: Vec<String>,
        host: String,
        port: u16,
    },
}

/// The shared wire shape `debug_launch`/`debug_attach` both accept — see
/// `super::commands`'s module doc for why one DTO serves both (they differ
/// only in which literal DAP command the handshake sends, decided by which
/// Tauri command was actually called, not by a field on this struct).
/// `host`/`port` are required exactly when `transport == "tcp"` and must be
/// absent otherwise — validated in [`Self::into_parts`], mirroring
/// `TerminalStartRequest::into_parts`'s identical "validate before handing
/// off a typed query" shape.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugSessionStartRequest {
    pub root_id: RootId,
    pub transport: AdapterTransportKind,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    pub adapter_id: String,
    /// Opaque `launch`/`attach` arguments — ADR 0003's "adapter-specific 配置
    /// 透明透传". Defaults to an empty object so a caller with nothing
    /// adapter-specific to configure yet is not forced to send `{}` itself.
    #[serde(default = "empty_json_object")]
    pub arguments: Value,
    #[serde(default)]
    pub initial_breakpoints: Vec<SourceBreakpointsRequest>,
}

fn empty_json_object() -> Value {
    Value::Object(serde_json::Map::new())
}

pub(crate) struct DebugSessionStartQuery {
    pub(crate) root_id: RootId,
    pub(crate) transport: SessionTransportRequest,
    pub(crate) request: LaunchRequestKind,
    pub(crate) adapter_id: String,
    pub(crate) arguments: Value,
    pub(crate) breakpoints: Vec<SourceBreakpoints>,
}

impl DebugSessionStartRequest {
    /// Validates transport/host/port consistency and every defensive size
    /// ceiling above, then converts into a [`DebugSessionStartQuery`] —
    /// `request` is supplied by the caller (`debug_launch` passes
    /// [`LaunchRequestKind::Launch`], `debug_attach` passes
    /// [`LaunchRequestKind::Attach`]) since this DTO's own wire shape never
    /// carries that distinction (see the struct's own doc comment).
    pub(crate) fn into_parts(
        self,
        request: LaunchRequestKind,
    ) -> Result<DebugSessionStartQuery, CommandError> {
        if self.command.trim().is_empty() {
            return Err(debug_session_request_invalid());
        }
        if self.args.len() > MAX_DEBUG_SESSION_ARGS {
            return Err(debug_session_request_invalid());
        }
        if self.initial_breakpoints.len() > MAX_DEBUG_SESSION_BREAKPOINT_SOURCES {
            return Err(debug_session_request_invalid());
        }
        for source in &self.initial_breakpoints {
            if source.breakpoints.len() > MAX_DEBUG_SESSION_BREAKPOINTS_PER_SOURCE {
                return Err(debug_session_request_invalid());
            }
        }
        let transport = match self.transport {
            AdapterTransportKind::Stdio => {
                if self.host.is_some() || self.port.is_some() {
                    return Err(debug_session_request_invalid());
                }
                SessionTransportRequest::Stdio {
                    command: self.command,
                    args: self.args,
                }
            }
            AdapterTransportKind::Tcp => {
                let (Some(host), Some(port)) = (self.host, self.port) else {
                    return Err(debug_session_request_invalid());
                };
                if host.trim().is_empty() {
                    return Err(debug_session_request_invalid());
                }
                SessionTransportRequest::Tcp {
                    command: self.command,
                    args: self.args,
                    host,
                    port,
                }
            }
        };
        let breakpoints = self
            .initial_breakpoints
            .iter()
            .map(SourceBreakpointsRequest::to_source_breakpoints)
            .collect();
        Ok(DebugSessionStartQuery {
            root_id: self.root_id,
            transport,
            request,
            adapter_id: self.adapter_id,
            arguments: self.arguments,
            breakpoints,
        })
    }
}

/// `debug_launch`/`debug_attach`'s response: the newly started session's id
/// plus its negotiated capability set, exposed as a raw JSON object (see
/// [`super::protocol::Capabilities::as_value`]'s own doc comment for why
/// this is deliberately not a fixed, enumerated shape).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionStartResult {
    session_id: DebugSessionId,
    capabilities: Value,
}

impl DebugSessionStartResult {
    pub(crate) fn new(session_id: DebugSessionId, capabilities: Value) -> Self {
        Self {
            session_id,
            capabilities,
        }
    }
}

/// `debug_disconnect`'s request — just the session to tear down.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugSessionIdRequest {
    session_id: DebugSessionId,
}

impl DebugSessionIdRequest {
    pub(crate) fn into_parts(self) -> DebugSessionId {
        self.session_id
    }
}

/// `plain://debug-event`'s payload shape — see `super::session`'s module doc
/// for why `event` covers both real DAP events and Plain's own `plain/`-
/// prefixed synthetic notifications (reverse-request diagnostics, protocol
/// errors, session-ended) under the same single event channel.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugEventPayload {
    pub(crate) session_id: DebugSessionId,
    pub(crate) event: String,
    pub(crate) body: Option<Value>,
}

// ---------------------------------------------------------------------
// `F100` S3 — the interactive debugging surface: breakpoints (runtime,
// independent of the handshake's initial-configuration `setBreakpoints`
// series above), the call stack, and variables/watch. Every request DTO
// below carries its own `session_id` (the live session this request targets
// — see `super::service::DebugSessionService::send_request`, the one place
// that resolves it) and converts, via `into_parts`, into the exact DAP
// `arguments` shape `super::commands`'s new commands send unmodified.
// ---------------------------------------------------------------------

/// Defensive ceiling on `DebugSetBreakpointsRequest.breakpoints`'s length —
/// mirrors [`MAX_DEBUG_SESSION_BREAKPOINTS_PER_SOURCE`]'s identical "generous
/// hostile-input backstop, not an expected value" intent for the runtime
/// (rather than initial-handshake) breakpoint-set path.
const MAX_DEBUG_SET_BREAKPOINTS_ENTRIES: usize = 4096;
/// Defensive ceiling on `DebugEvaluateRequest.expression`'s length in UTF-8
/// bytes — a real watch/REPL expression is a short snippet, not this large;
/// purely a hostile-input backstop (the framing layer's own
/// `MAX_DAP_MESSAGE_BYTES` already bounds the wire message itself, this just
/// fails fast before ever building one).
const MAX_DEBUG_EVALUATE_EXPRESSION_BYTES: usize = 8_192;

/// Runtime `setBreakpoints` request — independent of the handshake's own
/// initial-configuration breakpoints ([`SourceBreakpointsRequest`] above,
/// still used only at `debug_launch`/`debug_attach` time). Toggling a
/// breakpoint in an already-running session (the normal editor-glyph-margin
/// interaction `F100` S3 implements) always goes through this instead —
/// DAP's `setBreakpoints` request is defined to *replace* the full set of
/// breakpoints for `source.path` each time it is sent (never an incremental
/// add/remove), so `breakpoints` here is always the complete, current set for
/// `path`, not just the one that changed.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugSetBreakpointsRequest {
    pub session_id: DebugSessionId,
    pub root_id: RootId,
    pub path: String,
    #[serde(default)]
    pub breakpoints: Vec<LineBreakpointRequest>,
}

pub(crate) struct DebugSetBreakpointsQuery {
    pub(crate) session_id: DebugSessionId,
    pub(crate) root_id: RootId,
    pub(crate) arguments: Value,
}

impl DebugSetBreakpointsRequest {
    pub(crate) fn into_parts(self) -> Result<DebugSetBreakpointsQuery, CommandError> {
        if self.path.trim().is_empty() {
            return Err(debug_session_request_invalid());
        }
        if self.breakpoints.len() > MAX_DEBUG_SET_BREAKPOINTS_ENTRIES {
            return Err(debug_session_request_invalid());
        }
        let arguments = set_breakpoints_arguments(&self.path, &self.breakpoints);
        Ok(DebugSetBreakpointsQuery {
            session_id: self.session_id,
            root_id: self.root_id,
            arguments,
        })
    }
}

/// One entry of a `setBreakpoints` response's `body.breakpoints` array (the
/// DAP `Breakpoint` type) — `verified`/`line` are the two fields
/// `docs/research/2026-07-28-generic-dap.md`'s own acceptance language calls
/// out explicitly ("adapter 回传的 `verified` 状态与实际落点行号可能与请求不同
/// —— 真实 adapter 会移动断点到最近可执行行"): a real adapter is free to both
/// reject a line (`verified: false`, often with `message` explaining why) and
/// silently relocate a verified one to the nearest executable line, and the
/// frontend must render whichever `line` this reports, not the line it asked
/// for.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugBreakpointResult {
    pub verified: bool,
    pub line: Option<u32>,
    pub id: Option<i64>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSetBreakpointsResult {
    pub breakpoints: Vec<DebugBreakpointResult>,
}

/// Parses a `setBreakpoints` response's `body` into
/// [`DebugSetBreakpointsResult`] — tolerant of every optional field being
/// absent (a minimal, spec-compliant adapter need only ever send
/// `verified`), but requires `body.breakpoints` itself to be an array at all
/// (its complete absence, or a non-array value, is a genuinely malformed
/// response this domain cannot make sense of).
pub(crate) fn parse_set_breakpoints_response(
    body: &Value,
) -> Result<DebugSetBreakpointsResult, CommandError> {
    let entries = body
        .get("breakpoints")
        .and_then(Value::as_array)
        .ok_or_else(debug_adapter_response_malformed)?;
    let breakpoints = entries
        .iter()
        .map(|entry| DebugBreakpointResult {
            verified: entry
                .get("verified")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            line: entry
                .get("line")
                .and_then(Value::as_u64)
                .map(|value| value as u32),
            id: entry.get("id").and_then(Value::as_i64),
            message: entry
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
        .collect();
    Ok(DebugSetBreakpointsResult { breakpoints })
}

/// `debug_stack_trace`'s request — `startFrame`/`levels` are DAP's own
/// pagination fields (regspec's `StackTraceArguments`), forwarded verbatim so
/// a caller can page through a deep call stack instead of always requesting
/// every frame.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugStackTraceRequest {
    pub session_id: DebugSessionId,
    pub thread_id: i64,
    #[serde(default)]
    pub start_frame: Option<u32>,
    #[serde(default)]
    pub levels: Option<u32>,
}

pub(crate) struct DebugStackTraceQuery {
    pub(crate) session_id: DebugSessionId,
    pub(crate) arguments: Value,
}

impl DebugStackTraceRequest {
    pub(crate) fn into_parts(self) -> DebugStackTraceQuery {
        let mut arguments = serde_json::Map::new();
        arguments.insert("threadId".to_owned(), Value::from(self.thread_id));
        if let Some(start_frame) = self.start_frame {
            arguments.insert("startFrame".to_owned(), Value::from(start_frame));
        }
        if let Some(levels) = self.levels {
            arguments.insert("levels".to_owned(), Value::from(levels));
        }
        DebugStackTraceQuery {
            session_id: self.session_id,
            arguments: Value::Object(arguments),
        }
    }
}

/// One DAP `StackFrame` — `source_path`/`source_name` come from the frame's
/// optional `source` object (itself entirely absent for a frame with no
/// resolvable source, e.g. deep in a native/library call an adapter cannot
/// map back to a file); `line`/`column` default to `0` when absent rather
/// than failing the whole response, since a real adapter may legitimately
/// omit them for such a frame (per-spec `line` is technically required, but
/// this domain would rather show a frame with a placeholder line than reject
/// an otherwise-useful stack trace over one adapter's leniency).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStackFrame {
    pub id: i64,
    pub name: String,
    pub line: u32,
    pub column: u32,
    pub source_path: Option<String>,
    pub source_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStackTraceResult {
    pub stack_frames: Vec<DebugStackFrame>,
    pub total_frames: Option<u32>,
}

pub(crate) fn parse_stack_trace_response(
    body: &Value,
) -> Result<DebugStackTraceResult, CommandError> {
    let entries = body
        .get("stackFrames")
        .and_then(Value::as_array)
        .ok_or_else(debug_adapter_response_malformed)?;
    let mut stack_frames = Vec::with_capacity(entries.len());
    for entry in entries {
        let id = entry
            .get("id")
            .and_then(Value::as_i64)
            .ok_or_else(debug_adapter_response_malformed)?;
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(debug_adapter_response_malformed)?;
        let line = entry
            .get("line")
            .and_then(Value::as_u64)
            .map(|value| value as u32)
            .unwrap_or(0);
        let column = entry
            .get("column")
            .and_then(Value::as_u64)
            .map(|value| value as u32)
            .unwrap_or(0);
        let source = entry.get("source");
        let source_path = source
            .and_then(|source| source.get("path"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let source_name = source
            .and_then(|source| source.get("name"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        stack_frames.push(DebugStackFrame {
            id,
            name,
            line,
            column,
            source_path,
            source_name,
        });
    }
    let total_frames = body
        .get("totalFrames")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    Ok(DebugStackTraceResult {
        stack_frames,
        total_frames,
    })
}

/// `debug_scopes`'s request — `frame_id` is a `StackFrame.id` a prior
/// `debug_stack_trace` response returned; DAP does not define any other way
/// to obtain one.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugScopesRequest {
    pub session_id: DebugSessionId,
    pub frame_id: i64,
}

pub(crate) struct DebugScopesQuery {
    pub(crate) session_id: DebugSessionId,
    pub(crate) arguments: Value,
}

impl DebugScopesRequest {
    pub(crate) fn into_parts(self) -> DebugScopesQuery {
        DebugScopesQuery {
            session_id: self.session_id,
            arguments: serde_json::json!({ "frameId": self.frame_id }),
        }
    }
}

/// One DAP `Scope` — `variables_reference` is the handle a follow-up
/// `debug_variables` call expands (never `0` for a scope itself, per spec,
/// but this domain does not special-case that; a `0` would simply expand to
/// no children).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScope {
    pub name: String,
    pub variables_reference: i64,
    pub named_variables: Option<u32>,
    pub indexed_variables: Option<u32>,
    pub expensive: bool,
}

/// `scopes` responses legitimately report zero scopes (e.g. a frame with no
/// local state at all) — an empty `scopes` array is a normal, successful
/// result, not an error.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScopesResult {
    pub scopes: Vec<DebugScope>,
}

pub(crate) fn parse_scopes_response(body: &Value) -> Result<DebugScopesResult, CommandError> {
    let entries = body
        .get("scopes")
        .and_then(Value::as_array)
        .ok_or_else(debug_adapter_response_malformed)?;
    let mut scopes = Vec::with_capacity(entries.len());
    for entry in entries {
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(debug_adapter_response_malformed)?;
        let variables_reference = entry
            .get("variablesReference")
            .and_then(Value::as_i64)
            .ok_or_else(debug_adapter_response_malformed)?;
        let named_variables = entry
            .get("namedVariables")
            .and_then(Value::as_u64)
            .map(|value| value as u32);
        let indexed_variables = entry
            .get("indexedVariables")
            .and_then(Value::as_u64)
            .map(|value| value as u32);
        let expensive = entry
            .get("expensive")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        scopes.push(DebugScope {
            name,
            variables_reference,
            named_variables,
            indexed_variables,
            expensive,
        });
    }
    Ok(DebugScopesResult { scopes })
}

/// Which slice of a `variablesReference`'s children `debug_variables`
/// requests — DAP's own `'indexed' | 'named'` `VariablesArguments.filter`
/// enum (omitted means "both"), forwarded verbatim.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DebugVariablesFilter {
    Indexed,
    Named,
}

impl DebugVariablesFilter {
    fn as_wire(self) -> &'static str {
        match self {
            Self::Indexed => "indexed",
            Self::Named => "named",
        }
    }
}

/// `debug_variables`'s request — the **lazy expansion and pagination**
/// surface `docs/research/2026-07-28-generic-dap.md`'s own acceptance
/// language requires ("必须实现 `variablesReference` 的惰性展开与分页"):
/// `variables_reference` is a [`DebugScope`]'s or a previous
/// [`DebugVariable`]'s own reference handle (`0` means "no children" and
/// should never reach this command at all — the frontend's own tree renders
/// no expand affordance for it); `start`/`count` are DAP's own
/// `VariablesArguments` pagination fields, letting a caller fetch one page of
/// a large indexed collection (e.g. a big array) instead of every element at
/// once — the adapter itself decides how to slice its own children by these
/// two fields, this domain only forwards them unmodified.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugVariablesRequest {
    pub session_id: DebugSessionId,
    pub variables_reference: i64,
    #[serde(default)]
    pub start: Option<u32>,
    #[serde(default)]
    pub count: Option<u32>,
    #[serde(default)]
    pub filter: Option<DebugVariablesFilter>,
}

pub(crate) struct DebugVariablesQuery {
    pub(crate) session_id: DebugSessionId,
    pub(crate) arguments: Value,
}

impl DebugVariablesRequest {
    pub(crate) fn into_parts(self) -> DebugVariablesQuery {
        let mut arguments = serde_json::Map::new();
        arguments.insert(
            "variablesReference".to_owned(),
            Value::from(self.variables_reference),
        );
        if let Some(start) = self.start {
            arguments.insert("start".to_owned(), Value::from(start));
        }
        if let Some(count) = self.count {
            arguments.insert("count".to_owned(), Value::from(count));
        }
        if let Some(filter) = self.filter {
            arguments.insert("filter".to_owned(), Value::from(filter.as_wire()));
        }
        DebugVariablesQuery {
            session_id: self.session_id,
            arguments: Value::Object(arguments),
        }
    }
}

/// One DAP `Variable` — `variables_reference` is `0` for a leaf value (the
/// tree-expansion sentinel `docs/research/2026-07-28-generic-dap.md`'s own
/// real `debugpy` capture documented: `a`/`b` both reported `variablesReference:0`),
/// non-zero for a further-expandable value a follow-up `debug_variables` call
/// should target.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariable {
    pub name: String,
    pub value: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub variables_reference: i64,
    pub named_variables: Option<u32>,
    pub indexed_variables: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariablesResult {
    pub variables: Vec<DebugVariable>,
}

/// Parses a `variables` response's `body` — deliberately imposes **no**
/// additional count/size ceiling of its own beyond requiring `variables`
/// itself to be an array: a large response (a big array's full page) is a
/// legitimate, expected shape this domain must not second-guess, and the
/// framing layer's own [`super::framing::MAX_DAP_MESSAGE_BYTES`] is already
/// the systemic backstop against a truly unbounded/hostile message.
pub(crate) fn parse_variables_response(body: &Value) -> Result<DebugVariablesResult, CommandError> {
    let entries = body
        .get("variables")
        .and_then(Value::as_array)
        .ok_or_else(debug_adapter_response_malformed)?;
    let mut variables = Vec::with_capacity(entries.len());
    for entry in entries {
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(debug_adapter_response_malformed)?;
        let value = entry
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(debug_adapter_response_malformed)?;
        let kind = entry.get("type").and_then(Value::as_str).map(str::to_owned);
        let variables_reference = entry
            .get("variablesReference")
            .and_then(Value::as_i64)
            .ok_or_else(debug_adapter_response_malformed)?;
        let named_variables = entry
            .get("namedVariables")
            .and_then(Value::as_u64)
            .map(|value| value as u32);
        let indexed_variables = entry
            .get("indexedVariables")
            .and_then(Value::as_u64)
            .map(|value| value as u32);
        variables.push(DebugVariable {
            name,
            value,
            kind,
            variables_reference,
            named_variables,
            indexed_variables,
        });
    }
    Ok(DebugVariablesResult { variables })
}

/// Which DAP `EvaluateArguments.context` value a `debug_evaluate` call uses —
/// the spec's own open string enum narrowed to the five documented values
/// (`docs/research/2026-07-28-generic-dap.md`'s own excerpt), matching this
/// codebase's "closed shape over a protocol field, not a generic passthrough"
/// convention (e.g. [`AdapterTransportKind`]) rather than accepting an
/// arbitrary caller-supplied string. `F100` S3 only ever sends `"watch"` from
/// the Watch view; `"repl"` is included now (rather than added later) because
/// it is part of the same closed spec enum and costs nothing extra to model
/// correctly today — `F100` S4's Debug Console is expected to be its first
/// caller.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DebugEvaluateContext {
    Watch,
    Repl,
    Hover,
    Clipboard,
    Variables,
}

/// `debug_evaluate`'s request — `frame_id` scopes the evaluation to a
/// specific stack frame's lexical context (omitted evaluates in a
/// global/frame-less context, which most adapters reject for anything but a
/// trivial literal).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugEvaluateRequest {
    pub session_id: DebugSessionId,
    pub expression: String,
    #[serde(default)]
    pub frame_id: Option<i64>,
    pub context: DebugEvaluateContext,
}

pub(crate) struct DebugEvaluateQuery {
    pub(crate) session_id: DebugSessionId,
    pub(crate) arguments: Value,
}

impl DebugEvaluateRequest {
    pub(crate) fn into_parts(self) -> Result<DebugEvaluateQuery, CommandError> {
        if self.expression.is_empty() || self.expression.len() > MAX_DEBUG_EVALUATE_EXPRESSION_BYTES
        {
            return Err(debug_session_request_invalid());
        }
        let mut arguments = serde_json::Map::new();
        arguments.insert("expression".to_owned(), Value::from(self.expression));
        if let Some(frame_id) = self.frame_id {
            arguments.insert("frameId".to_owned(), Value::from(frame_id));
        }
        arguments.insert(
            "context".to_owned(),
            Value::from(match self.context {
                DebugEvaluateContext::Watch => "watch",
                DebugEvaluateContext::Repl => "repl",
                DebugEvaluateContext::Hover => "hover",
                DebugEvaluateContext::Clipboard => "clipboard",
                DebugEvaluateContext::Variables => "variables",
            }),
        );
        Ok(DebugEvaluateQuery {
            session_id: self.session_id,
            arguments: Value::Object(arguments),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugEvaluateResult {
    pub result: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub variables_reference: i64,
    pub named_variables: Option<u32>,
    pub indexed_variables: Option<u32>,
}

pub(crate) fn parse_evaluate_response(body: &Value) -> Result<DebugEvaluateResult, CommandError> {
    let result = body
        .get("result")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(debug_adapter_response_malformed)?;
    let kind = body.get("type").and_then(Value::as_str).map(str::to_owned);
    let variables_reference = body
        .get("variablesReference")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let named_variables = body
        .get("namedVariables")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    let indexed_variables = body
        .get("indexedVariables")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    Ok(DebugEvaluateResult {
        result,
        kind,
        variables_reference,
        named_variables,
        indexed_variables,
    })
}

// ---------------------------------------------------------------------
// `F100` S4 — execution/step control (`continue`/`next`/`stepIn`/`stepOut`/
// `pause`) and `runInTerminal` reverse-request handling.
// ---------------------------------------------------------------------

/// Shared `{sessionId, threadId}` request shape for every step/execution-
/// control DAP request this domain sends — `continue`/`next`/`stepIn`/
/// `stepOut`/`pause` all take, per spec, `arguments` that are exactly
/// `{threadId: number, ...fields this domain does not send}`
/// (`ContinueArguments`/`NextArguments`/`StepInArguments`/`StepOutArguments`/
/// `PauseArguments`). One request DTO for all five keeps this file from
/// repeating the identical shape four more times — see
/// `super::commands`'s own module doc for why `stepIn`'s `targetId` (the
/// "step into target" picker gated by `supportsStepInTargetsRequest`) and
/// every request's optional `singleThread`/`granularity` fields are
/// deliberately not exposed in this slice (a disclosed scope narrowing, not
/// an oversight — real DAP defines no `supportsXxx` capability gating the
/// *basic* five commands themselves; they are mandatory baseline requests
/// every adapter must implement, confirmed by both real capability captures
/// `docs/research/2026-07-28-generic-dap.md` recorded, neither of which
/// contains any such field).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugThreadRequest {
    pub session_id: DebugSessionId,
    pub thread_id: i64,
}

pub(crate) struct DebugThreadQuery {
    pub(crate) session_id: DebugSessionId,
    pub(crate) arguments: Value,
}

impl DebugThreadRequest {
    pub(crate) fn into_parts(self) -> DebugThreadQuery {
        DebugThreadQuery {
            session_id: self.session_id,
            arguments: serde_json::json!({ "threadId": self.thread_id }),
        }
    }
}

/// `debug_continue`'s response — `all_threads_continued` is the one
/// meaningful field DAP's `ContinueResponse.body` defines. Per spec: "If this
/// attribute is missing a value of `true` is assumed for backward
/// compatibility" — [`parse_continue_response`] implements that exact
/// default rather than treating a bodyless/fieldless response as `false` (a
/// minimal, spec-compliant adapter need not send a body at all, and that must
/// not be misread as "only this one thread resumed").
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugContinueResult {
    pub all_threads_continued: bool,
}

pub(crate) fn parse_continue_response(body: &Value) -> Result<DebugContinueResult, CommandError> {
    let all_threads_continued = body
        .get("allThreadsContinued")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    Ok(DebugContinueResult {
        all_threads_continued,
    })
}

/// Defensive ceilings on a `runInTerminal` reverse request's own `args`/`env`
/// — mirrors [`MAX_DEBUG_SESSION_ARGS`]'s "hostile-input backstop, not an
/// expected value" intent. Unlike every other ceiling in this file, this data
/// never crosses the Tauri IPC boundary at all (it arrives from the adapter
/// subprocess over the DAP transport, parsed entirely on the reader thread) —
/// but an already-trusted, already-spawned adapter can still be buggy or
/// hostile, and this domain should not build an unbounded `CommandBuilder`
/// any more than [`parse_variables_response`] should allocate without bound
/// for a malformed adapter response.
const MAX_RUN_IN_TERMINAL_ARGS: usize = 256;
const MAX_RUN_IN_TERMINAL_ARG_BYTES: usize = 8_192;
const MAX_RUN_IN_TERMINAL_ENV_ENTRIES: usize = 256;

/// Parsed, validated shape of a `runInTerminal` reverse request's own
/// `arguments` (DAP's `RunInTerminalRequestArguments`) — see
/// `super::commands`'s `handle_run_in_terminal_reverse_request` for how this
/// is actually acted on (spawning a real, visible `TerminalService` session,
/// never a hidden second spawn path). `kind` (`"integrated"`/`"external"`) is
/// deliberately not modeled here at all — Plain has exactly one terminal
/// facility (the integrated one) and no "external terminal" concept to honor
/// an `"external"` request with, so every `runInTerminal` request is served
/// identically regardless of which `kind` it names; see that module's own
/// doc comment for the full reasoning. `title` is carried through unparsed
/// (an arbitrary adapter-supplied label) purely for the frontend to build a
/// recognizable tab title from — this domain does not interpret it.
/// `argsCanBeInterpretedByShell` is likewise never read: this domain always
/// treats `args` as an already-tokenized argv (`args[0]` the program,
/// `args[1..]` its own arguments), passed to `CommandBuilder` element-by-
/// element, exactly like every other spawn this codebase performs — it never
/// asks a shell to interpret anything, regardless of what an adapter's
/// `argsCanBeInterpretedByShell` hint claims.
pub(crate) struct RunInTerminalArguments {
    pub(crate) cwd: Option<String>,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) env: Vec<(String, Option<String>)>,
    pub(crate) title: Option<String>,
}

/// Parses one `runInTerminal` reverse request's raw `arguments` value.
/// Although DAP declares `cwd` required, debugpy 1.6.7 omits it when the
/// launch configuration itself omits `cwd`; that real adapter shape is
/// accepted here and resolved against the selected debug root by the caller.
/// `None` for anything structurally invalid (missing `args`, a present but
/// non-string `cwd`, an empty or oversized `args` array, a non-string `args`
/// entry, an oversized `env` map, or an `env` entry whose value is neither a
/// string nor `null`) — the caller (`handle_run_in_terminal_reverse_request`)
/// turns a `None` into a real, structured `success: false` reply to the
/// adapter rather than panicking or silently doing nothing.
pub(crate) fn parse_run_in_terminal_arguments(
    arguments: Option<&Value>,
) -> Option<RunInTerminalArguments> {
    let arguments = arguments?;
    let cwd = match arguments.get("cwd") {
        None => None,
        Some(Value::String(cwd)) => Some(cwd.clone()),
        Some(_) => return None,
    };
    let args_value = arguments.get("args").and_then(Value::as_array)?;
    if args_value.is_empty() || args_value.len() > MAX_RUN_IN_TERMINAL_ARGS {
        return None;
    }
    let mut args_iter = args_value.iter();
    let program = args_iter.next()?.as_str()?.to_owned();
    let mut args = Vec::with_capacity(args_value.len() - 1);
    for entry in args_iter {
        let arg = entry.as_str()?;
        if arg.len() > MAX_RUN_IN_TERMINAL_ARG_BYTES {
            return None;
        }
        args.push(arg.to_owned());
    }
    let mut env = Vec::new();
    if let Some(env_object) = arguments.get("env").and_then(Value::as_object) {
        if env_object.len() > MAX_RUN_IN_TERMINAL_ENV_ENTRIES {
            return None;
        }
        for (key, value) in env_object {
            match value {
                Value::Null => env.push((key.clone(), None)),
                Value::String(value) => env.push((key.clone(), Some(value.clone()))),
                _ => return None,
            }
        }
    }
    let title = arguments
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Some(RunInTerminalArguments {
        cwd,
        program,
        args,
        env,
        title,
    })
}

// ---------------------------------------------------------------------
// `F100` S5 — `output`-event backpressure ack. See `super::output_gate`'s
// own module doc for the gate this acknowledges.
// ---------------------------------------------------------------------

/// `debug_output_ack`'s request — acknowledges every gated `output` event
/// through `sequence` (see [`super::session::DebugSession::ack_output`]).
/// `sequence` is a bare `u64` (not further validated beyond what `serde`
/// itself already requires of the wire type) — any value, including one
/// beyond what has ever actually been emitted, is handled tolerantly by
/// [`super::output_gate::OutputGate::ack`] (clamped, never a request-shape
/// rejection), mirroring `TerminalAckRequest`'s identical "no separate
/// validation beyond the type itself" precedent for the same kind of
/// monotonic-sequence ack.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DebugOutputAckRequest {
    pub session_id: DebugSessionId,
    pub sequence: u64,
}

impl DebugOutputAckRequest {
    pub(crate) fn into_parts(self) -> (DebugSessionId, u64) {
        (self.session_id, self.sequence)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        parse_continue_response, parse_evaluate_response, parse_run_in_terminal_arguments,
        parse_scopes_response, parse_set_breakpoints_response, parse_stack_trace_response,
        parse_variables_response, AdapterTransportKind, DebugEvaluateContext, DebugEvaluateRequest,
        DebugOutputAckRequest, DebugScopesRequest, DebugSessionId, DebugSessionStartRequest,
        DebugSetBreakpointsRequest, DebugStackTraceRequest, DebugThreadRequest,
        DebugVariablesFilter, DebugVariablesRequest, LineBreakpointRequest,
        SessionTransportRequest, SourceBreakpointsRequest, MAX_RUN_IN_TERMINAL_ARGS,
    };
    use crate::debug::session::LaunchRequestKind;
    use crate::workspace::RootId;
    use serde_json::Value;

    fn session_id() -> DebugSessionId {
        serde_json::from_value(serde_json::Value::String(VALID_ID.to_owned())).unwrap()
    }

    fn root_id() -> RootId {
        RootId::parse_v4_wire(VALID_ID).unwrap()
    }

    const VALID_ID: &str = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

    #[test]
    fn debug_session_id_round_trips_and_rejects_malformed_wire_strings() {
        let value: DebugSessionId =
            serde_json::from_value(serde_json::Value::String(VALID_ID.to_owned())).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), VALID_ID);

        for malformed in [
            "not-a-uuid",
            "0D3F4B0E-6F1A-4C9D-9C3A-1A2B3C4D5E6F",
            "0d3f4b0e6f1a4c9d9c3a1a2b3c4d5e6f",
        ] {
            assert!(
                serde_json::from_value::<DebugSessionId>(serde_json::Value::String(
                    malformed.to_owned()
                ))
                .is_err()
            );
        }
    }

    fn stdio_request(command: &str) -> DebugSessionStartRequest {
        DebugSessionStartRequest {
            root_id: root_id(),
            transport: AdapterTransportKind::Stdio,
            command: command.to_owned(),
            args: Vec::new(),
            host: None,
            port: None,
            adapter_id: "mock".to_owned(),
            arguments: json!({}),
            initial_breakpoints: Vec::new(),
        }
    }

    fn tcp_request(host: Option<&str>, port: Option<u16>) -> DebugSessionStartRequest {
        DebugSessionStartRequest {
            root_id: root_id(),
            transport: AdapterTransportKind::Tcp,
            command: "/usr/bin/true".to_owned(),
            args: Vec::new(),
            host: host.map(str::to_owned),
            port,
            adapter_id: "mock".to_owned(),
            arguments: json!({}),
            initial_breakpoints: Vec::new(),
        }
    }

    #[test]
    fn a_valid_stdio_request_converts_and_carries_no_host_or_port() {
        let query = stdio_request("/usr/bin/python3")
            .into_parts(LaunchRequestKind::Launch)
            .expect("valid stdio request converts");
        match query.transport {
            SessionTransportRequest::Stdio { command, args } => {
                assert_eq!(command, "/usr/bin/python3");
                assert!(args.is_empty());
            }
            SessionTransportRequest::Tcp { .. } => panic!("expected the stdio variant"),
        }
    }

    #[test]
    fn a_valid_tcp_request_converts_and_carries_host_and_port() {
        let query = tcp_request(Some("127.0.0.1"), Some(5678))
            .into_parts(LaunchRequestKind::Attach)
            .expect("valid tcp request converts");
        match query.transport {
            SessionTransportRequest::Tcp { host, port, .. } => {
                assert_eq!(host, "127.0.0.1");
                assert_eq!(port, 5678);
            }
            SessionTransportRequest::Stdio { .. } => panic!("expected the tcp variant"),
        }
    }

    #[test]
    fn an_empty_command_is_rejected_for_either_transport() {
        assert!(stdio_request("")
            .into_parts(LaunchRequestKind::Launch)
            .is_err());
        assert!(stdio_request("   ")
            .into_parts(LaunchRequestKind::Launch)
            .is_err());

        let mut request = tcp_request(Some("127.0.0.1"), Some(1));
        request.command = String::new();
        assert!(request.into_parts(LaunchRequestKind::Launch).is_err());
    }

    #[test]
    fn a_stdio_request_carrying_a_host_or_port_is_rejected() {
        let mut request = stdio_request("/usr/bin/python3");
        request.host = Some("127.0.0.1".to_owned());
        assert!(request.into_parts(LaunchRequestKind::Launch).is_err());

        let mut request = stdio_request("/usr/bin/python3");
        request.port = Some(1234);
        assert!(request.into_parts(LaunchRequestKind::Launch).is_err());
    }

    #[test]
    fn a_tcp_request_missing_host_or_port_is_rejected() {
        assert!(tcp_request(None, Some(1))
            .into_parts(LaunchRequestKind::Launch)
            .is_err());
        assert!(tcp_request(Some("127.0.0.1"), None)
            .into_parts(LaunchRequestKind::Launch)
            .is_err());
    }

    #[test]
    fn a_tcp_request_with_a_blank_host_is_rejected() {
        assert!(tcp_request(Some("   "), Some(1))
            .into_parts(LaunchRequestKind::Launch)
            .is_err());
    }

    #[test]
    fn args_beyond_the_defensive_ceiling_are_rejected() {
        let mut request = stdio_request("/usr/bin/python3");
        request.args = vec!["-x".to_owned(); super::MAX_DEBUG_SESSION_ARGS + 1];
        assert!(request.into_parts(LaunchRequestKind::Launch).is_err());

        let mut request = stdio_request("/usr/bin/python3");
        request.args = vec!["-x".to_owned(); super::MAX_DEBUG_SESSION_ARGS];
        assert!(request.into_parts(LaunchRequestKind::Launch).is_ok());
    }

    #[test]
    fn too_many_breakpoint_sources_are_rejected() {
        let mut request = stdio_request("/usr/bin/python3");
        request.initial_breakpoints = (0..=super::MAX_DEBUG_SESSION_BREAKPOINT_SOURCES)
            .map(|index| SourceBreakpointsRequest {
                path: format!("/tmp/{index}.py"),
                breakpoints: Vec::new(),
            })
            .collect();
        assert!(request.into_parts(LaunchRequestKind::Launch).is_err());
    }

    #[test]
    fn too_many_breakpoints_in_one_source_are_rejected() {
        let mut request = stdio_request("/usr/bin/python3");
        request.initial_breakpoints = vec![SourceBreakpointsRequest {
            path: "/tmp/a.py".to_owned(),
            breakpoints: (0..=super::MAX_DEBUG_SESSION_BREAKPOINTS_PER_SOURCE)
                .map(|line| LineBreakpointRequest {
                    line: line as u32,
                    condition: None,
                    log_message: None,
                    hit_condition: None,
                })
                .collect(),
        }];
        assert!(request.into_parts(LaunchRequestKind::Launch).is_err());
    }

    #[test]
    fn source_breakpoints_convert_into_the_expected_set_breakpoints_arguments_shape() {
        let request = SourceBreakpointsRequest {
            path: "/tmp/a.py".to_owned(),
            breakpoints: vec![
                LineBreakpointRequest {
                    line: 3,
                    condition: None,
                    log_message: None,
                    hit_condition: None,
                },
                LineBreakpointRequest {
                    line: 7,
                    condition: Some("x > 1".to_owned()),
                    log_message: Some("hit line 7".to_owned()),
                    hit_condition: None,
                },
            ],
        };
        let built = request.to_source_breakpoints();
        assert_eq!(
            built.arguments,
            json!({
                "source": { "path": "/tmp/a.py" },
                "breakpoints": [
                    { "line": 3 },
                    { "line": 7, "condition": "x > 1", "logMessage": "hit line 7" },
                ],
            })
        );
    }

    #[test]
    fn hit_condition_is_trimmed_and_omitted_when_blank_or_absent() {
        let request = SourceBreakpointsRequest {
            path: "/tmp/a.py".to_owned(),
            breakpoints: vec![
                LineBreakpointRequest {
                    line: 1,
                    condition: None,
                    log_message: None,
                    hit_condition: None,
                },
                LineBreakpointRequest {
                    line: 2,
                    condition: None,
                    log_message: None,
                    hit_condition: Some("   ".to_owned()),
                },
                LineBreakpointRequest {
                    line: 3,
                    condition: None,
                    log_message: None,
                    hit_condition: Some("  >= 3  ".to_owned()),
                },
                LineBreakpointRequest {
                    line: 4,
                    condition: Some("x > 1".to_owned()),
                    log_message: None,
                    hit_condition: Some("5".to_owned()),
                },
            ],
        };
        let built = request.to_source_breakpoints();
        assert_eq!(
            built.arguments,
            json!({
                "source": { "path": "/tmp/a.py" },
                "breakpoints": [
                    { "line": 1 },
                    { "line": 2 },
                    { "line": 3, "hitCondition": ">= 3" },
                    { "line": 4, "condition": "x > 1", "hitCondition": "5" },
                ],
            })
        );
    }

    #[test]
    fn line_breakpoint_request_deserializes_hit_condition_camel_case_and_rejects_unknown_fields() {
        let value = json!({ "line": 7, "hitCondition": "5" });
        let request: LineBreakpointRequest = serde_json::from_value(value).unwrap();
        assert_eq!(request.line, 7);
        assert_eq!(request.condition, None);
        assert_eq!(request.log_message, None);
        assert_eq!(request.hit_condition, Some("5".to_owned()));

        let without_hit_condition = json!({ "line": 7 });
        let request: LineBreakpointRequest = serde_json::from_value(without_hit_condition).unwrap();
        assert_eq!(request.hit_condition, None);

        let with_unknown_field = json!({ "line": 7, "hitCondition": "5", "unexpected": true });
        assert!(serde_json::from_value::<LineBreakpointRequest>(with_unknown_field).is_err());
    }

    #[test]
    fn debug_session_start_request_deserializes_camel_case_and_rejects_unknown_fields() {
        let value = json!({
            "rootId": VALID_ID,
            "transport": "stdio",
            "command": "/usr/bin/python3",
            "args": ["-m", "debugpy.adapter"],
            "adapterId": "mock",
        });
        let request: DebugSessionStartRequest = serde_json::from_value(value).unwrap();
        assert_eq!(request.command, "/usr/bin/python3");
        assert_eq!(request.arguments, json!({}));
        assert!(request.initial_breakpoints.is_empty());

        let with_unknown_field = json!({
            "rootId": VALID_ID,
            "transport": "stdio",
            "command": "/usr/bin/python3",
            "adapterId": "mock",
            "unexpected": true,
        });
        assert!(serde_json::from_value::<DebugSessionStartRequest>(with_unknown_field).is_err());
    }

    #[test]
    fn debug_root_ids_are_required_and_reject_malformed_wire_values() {
        let missing_start_root = json!({
            "transport": "stdio",
            "command": "/usr/bin/python3",
            "adapterId": "mock",
        });
        assert!(serde_json::from_value::<DebugSessionStartRequest>(missing_start_root).is_err());
        let malformed_start_root = json!({
            "rootId": "not-a-root-id",
            "transport": "stdio",
            "command": "/usr/bin/python3",
            "adapterId": "mock",
        });
        assert!(serde_json::from_value::<DebugSessionStartRequest>(malformed_start_root).is_err());

        let missing_breakpoint_root = json!({
            "sessionId": VALID_ID,
            "path": "main.py",
            "breakpoints": [],
        });
        assert!(
            serde_json::from_value::<DebugSetBreakpointsRequest>(missing_breakpoint_root).is_err()
        );
        let malformed_breakpoint_root = json!({
            "sessionId": VALID_ID,
            "rootId": "not-a-root-id",
            "path": "main.py",
            "breakpoints": [],
        });
        assert!(
            serde_json::from_value::<DebugSetBreakpointsRequest>(malformed_breakpoint_root)
                .is_err()
        );
    }

    // -------------------------------------------------------------
    // `F100` S3 — interactive debugging DTOs.
    // -------------------------------------------------------------

    #[test]
    fn debug_set_breakpoints_request_builds_the_exact_set_breakpoints_arguments_shape() {
        let request = DebugSetBreakpointsRequest {
            session_id: session_id(),
            root_id: root_id(),
            path: "/tmp/a.py".to_owned(),
            breakpoints: vec![
                LineBreakpointRequest {
                    line: 3,
                    condition: None,
                    log_message: None,
                    hit_condition: None,
                },
                LineBreakpointRequest {
                    line: 7,
                    condition: Some("x > 1".to_owned()),
                    log_message: Some("hit line 7".to_owned()),
                    hit_condition: None,
                },
            ],
        };
        let query = request.into_parts().expect("valid request converts");
        assert_eq!(
            query.arguments,
            json!({
                "source": { "path": "/tmp/a.py" },
                "breakpoints": [
                    { "line": 3 },
                    { "line": 7, "condition": "x > 1", "logMessage": "hit line 7" },
                ],
            })
        );
    }

    #[test]
    fn debug_set_breakpoints_request_rejects_a_blank_path() {
        let request = DebugSetBreakpointsRequest {
            session_id: session_id(),
            root_id: root_id(),
            path: "   ".to_owned(),
            breakpoints: Vec::new(),
        };
        assert!(request.into_parts().is_err());
    }

    #[test]
    fn debug_set_breakpoints_request_rejects_more_breakpoints_than_the_defensive_ceiling() {
        let request = DebugSetBreakpointsRequest {
            session_id: session_id(),
            root_id: root_id(),
            path: "/tmp/a.py".to_owned(),
            breakpoints: (0..=super::MAX_DEBUG_SET_BREAKPOINTS_ENTRIES)
                .map(|line| LineBreakpointRequest {
                    line: line as u32,
                    condition: None,
                    log_message: None,
                    hit_condition: None,
                })
                .collect(),
        };
        assert!(request.into_parts().is_err());
    }

    #[test]
    fn parse_set_breakpoints_response_reports_a_moved_line_and_an_unverified_entry() {
        let body = json!({
            "breakpoints": [
                { "verified": true, "line": 12, "id": 1 },
                { "verified": false, "message": "no code on this line" },
            ]
        });
        let result = parse_set_breakpoints_response(&body).expect("well-formed response parses");
        assert_eq!(result.breakpoints.len(), 2);
        assert!(result.breakpoints[0].verified);
        assert_eq!(result.breakpoints[0].line, Some(12));
        assert_eq!(result.breakpoints[0].id, Some(1));
        assert!(!result.breakpoints[1].verified);
        assert_eq!(result.breakpoints[1].line, None);
        assert_eq!(
            result.breakpoints[1].message.as_deref(),
            Some("no code on this line")
        );
    }

    #[test]
    fn parse_set_breakpoints_response_rejects_a_body_missing_the_breakpoints_array() {
        assert!(parse_set_breakpoints_response(&json!({})).is_err());
        assert!(parse_set_breakpoints_response(&json!({"breakpoints": "nope"})).is_err());
    }

    #[test]
    fn debug_stack_trace_request_omits_pagination_fields_when_absent_and_includes_them_when_present(
    ) {
        let bare = DebugStackTraceRequest {
            session_id: session_id(),
            thread_id: 1,
            start_frame: None,
            levels: None,
        };
        assert_eq!(bare.into_parts().arguments, json!({"threadId": 1}));

        let paged = DebugStackTraceRequest {
            session_id: session_id(),
            thread_id: 1,
            start_frame: Some(20),
            levels: Some(10),
        };
        assert_eq!(
            paged.into_parts().arguments,
            json!({"threadId": 1, "startFrame": 20, "levels": 10})
        );
    }

    #[test]
    fn parse_stack_trace_response_parses_frames_and_total_frames_including_frames_without_a_source()
    {
        let body = json!({
            "stackFrames": [
                {"id": 1, "name": "add", "line": 3, "column": 5, "source": {"path": "/tmp/a.py", "name": "a.py"}},
                {"id": 2, "name": "<native>"},
            ],
            "totalFrames": 42,
        });
        let result = parse_stack_trace_response(&body).expect("well-formed response parses");
        assert_eq!(result.total_frames, Some(42));
        assert_eq!(result.stack_frames.len(), 2);
        assert_eq!(
            result.stack_frames[0].source_path.as_deref(),
            Some("/tmp/a.py")
        );
        assert_eq!(result.stack_frames[0].line, 3);
        // A frame with no `source` at all, and no `line`/`column`, still
        // parses — defaults to line/column 0 rather than rejecting the whole
        // response over one adapter's leniency (see the DTO's own doc
        // comment).
        assert_eq!(result.stack_frames[1].source_path, None);
        assert_eq!(result.stack_frames[1].line, 0);
        assert_eq!(result.stack_frames[1].column, 0);
    }

    #[test]
    fn parse_stack_trace_response_rejects_a_frame_missing_its_required_id_or_name() {
        assert!(parse_stack_trace_response(&json!({"stackFrames": [{"name": "x"}]})).is_err());
        assert!(parse_stack_trace_response(&json!({"stackFrames": [{"id": 1}]})).is_err());
        assert!(parse_stack_trace_response(&json!({})).is_err());
    }

    #[test]
    fn debug_scopes_request_builds_the_frame_id_arguments_shape() {
        let request = DebugScopesRequest {
            session_id: session_id(),
            frame_id: 7,
        };
        assert_eq!(request.into_parts().arguments, json!({"frameId": 7}));
    }

    #[test]
    fn parse_scopes_response_accepts_a_genuinely_empty_scopes_array() {
        let result = parse_scopes_response(&json!({"scopes": []})).expect("empty scopes parses");
        assert!(result.scopes.is_empty());
    }

    #[test]
    fn parse_scopes_response_parses_locals_and_globals_with_variable_counts() {
        let body = json!({
            "scopes": [
                {"name": "Locals", "variablesReference": 5, "namedVariables": 2, "expensive": false},
                {"name": "Globals", "variablesReference": 6, "expensive": true},
            ]
        });
        let result = parse_scopes_response(&body).expect("well-formed response parses");
        assert_eq!(result.scopes.len(), 2);
        assert_eq!(result.scopes[0].variables_reference, 5);
        assert_eq!(result.scopes[0].named_variables, Some(2));
        assert!(!result.scopes[0].expensive);
        assert_eq!(result.scopes[1].variables_reference, 6);
        assert!(result.scopes[1].expensive);
    }

    #[test]
    fn parse_scopes_response_rejects_a_scope_missing_its_required_variables_reference() {
        assert!(parse_scopes_response(&json!({"scopes": [{"name": "Locals"}]})).is_err());
    }

    #[test]
    fn debug_variables_request_forwards_pagination_and_filter_fields_when_present() {
        let bare = DebugVariablesRequest {
            session_id: session_id(),
            variables_reference: 5,
            start: None,
            count: None,
            filter: None,
        };
        assert_eq!(
            bare.into_parts().arguments,
            json!({"variablesReference": 5})
        );

        let paged = DebugVariablesRequest {
            session_id: session_id(),
            variables_reference: 300,
            start: Some(1000),
            count: Some(200),
            filter: Some(DebugVariablesFilter::Indexed),
        };
        assert_eq!(
            paged.into_parts().arguments,
            json!({
                "variablesReference": 300,
                "start": 1000,
                "count": 200,
                "filter": "indexed",
            })
        );
    }

    #[test]
    fn debug_variables_filter_named_forwards_as_the_lowercase_wire_string() {
        let request = DebugVariablesRequest {
            session_id: session_id(),
            variables_reference: 5,
            start: None,
            count: None,
            filter: Some(DebugVariablesFilter::Named),
        };
        assert_eq!(request.into_parts().arguments["filter"], "named");
    }

    #[test]
    fn parse_variables_response_preserves_a_nonzero_variables_reference_for_expansion() {
        // Mirrors the real `debugpy` capture the frozen research doc quotes:
        // leaf values report `variablesReference: 0`; a further-expandable
        // one (this test's synthetic "big" collection) reports a real,
        // nonzero handle a follow-up `debug_variables` call should target.
        let body = json!({
            "variables": [
                {"name": "a", "value": "3", "type": "int", "variablesReference": 0},
                {"name": "big", "value": "list", "variablesReference": 300, "indexedVariables": 5000},
            ]
        });
        let result = parse_variables_response(&body).expect("well-formed response parses");
        assert_eq!(result.variables[0].variables_reference, 0);
        assert_eq!(result.variables[1].variables_reference, 300);
        assert_eq!(result.variables[1].indexed_variables, Some(5000));
    }

    #[test]
    fn parse_variables_response_imposes_no_extra_ceiling_on_a_genuinely_large_page() {
        let entries: Vec<_> = (0..5000)
            .map(|index| {
                json!({"name": format!("item_{index}"), "value": index.to_string(), "variablesReference": 0})
            })
            .collect();
        let body = json!({ "variables": entries });
        let result = parse_variables_response(&body).expect("a large page parses without limit");
        assert_eq!(result.variables.len(), 5000);
        assert_eq!(result.variables[4999].name, "item_4999");
    }

    #[test]
    fn parse_variables_response_rejects_an_entry_missing_its_required_name_or_value() {
        assert!(parse_variables_response(
            &json!({"variables": [{"value": "3", "variablesReference": 0}]})
        )
        .is_err());
        assert!(parse_variables_response(
            &json!({"variables": [{"name": "a", "variablesReference": 0}]})
        )
        .is_err());
        assert!(
            parse_variables_response(&json!({"variables": [{"name": "a", "value": "3"}]})).is_err()
        );
    }

    #[test]
    fn debug_evaluate_request_builds_the_watch_context_arguments_shape() {
        let request = DebugEvaluateRequest {
            session_id: session_id(),
            expression: "a + b".to_owned(),
            frame_id: Some(3),
            context: DebugEvaluateContext::Watch,
        };
        let query = request.into_parts().expect("valid request converts");
        assert_eq!(
            query.arguments,
            json!({"expression": "a + b", "frameId": 3, "context": "watch"})
        );
    }

    #[test]
    fn debug_evaluate_request_omits_frame_id_when_absent() {
        let request = DebugEvaluateRequest {
            session_id: session_id(),
            expression: "1 + 1".to_owned(),
            frame_id: None,
            context: DebugEvaluateContext::Repl,
        };
        let query = request.into_parts().expect("valid request converts");
        assert_eq!(
            query.arguments,
            json!({"expression": "1 + 1", "context": "repl"})
        );
    }

    #[test]
    fn debug_evaluate_request_rejects_an_empty_or_oversized_expression() {
        let empty = DebugEvaluateRequest {
            session_id: session_id(),
            expression: String::new(),
            frame_id: None,
            context: DebugEvaluateContext::Watch,
        };
        assert!(empty.into_parts().is_err());

        let oversized = DebugEvaluateRequest {
            session_id: session_id(),
            expression: "x".repeat(super::MAX_DEBUG_EVALUATE_EXPRESSION_BYTES + 1),
            frame_id: None,
            context: DebugEvaluateContext::Watch,
        };
        assert!(oversized.into_parts().is_err());
    }

    #[test]
    fn parse_evaluate_response_parses_a_leaf_result_and_defaults_variables_reference_to_zero() {
        let body = json!({"result": "7", "type": "int"});
        let result = parse_evaluate_response(&body).expect("well-formed response parses");
        assert_eq!(result.result, "7");
        assert_eq!(result.kind.as_deref(), Some("int"));
        assert_eq!(result.variables_reference, 0);
    }

    #[test]
    fn parse_evaluate_response_preserves_a_nonzero_variables_reference() {
        let body = json!({"result": "[1, 2, 3]", "variablesReference": 400, "indexedVariables": 3});
        let result = parse_evaluate_response(&body).expect("well-formed response parses");
        assert_eq!(result.variables_reference, 400);
        assert_eq!(result.indexed_variables, Some(3));
    }

    #[test]
    fn parse_evaluate_response_rejects_a_body_missing_its_required_result() {
        assert!(parse_evaluate_response(&json!({})).is_err());
        assert!(parse_evaluate_response(&json!({"result": 7})).is_err());
    }

    #[test]
    fn debug_evaluate_context_serializes_as_the_lowercase_spec_enum_values() {
        for (variant, wire) in [
            (DebugEvaluateContext::Watch, "watch"),
            (DebugEvaluateContext::Repl, "repl"),
            (DebugEvaluateContext::Hover, "hover"),
            (DebugEvaluateContext::Clipboard, "clipboard"),
            (DebugEvaluateContext::Variables, "variables"),
        ] {
            assert_eq!(serde_json::to_value(variant).unwrap(), wire);
        }
    }

    // -----------------------------------------------------------------
    // `F100` S4 — step control + `runInTerminal` argument parsing.
    // -----------------------------------------------------------------

    #[test]
    fn debug_thread_request_builds_the_bare_thread_id_arguments_shape() {
        let request = DebugThreadRequest {
            session_id: session_id(),
            thread_id: 7,
        };
        let query = request.into_parts();
        assert_eq!(query.arguments, json!({"threadId": 7}));
    }

    #[test]
    fn debug_thread_request_rejects_unknown_fields() {
        let mut value = json!({"sessionId": VALID_ID, "threadId": 1});
        value["singleThread"] = json!(true);
        assert!(serde_json::from_value::<DebugThreadRequest>(value).is_err());
    }

    #[test]
    fn parse_continue_response_defaults_all_threads_continued_to_true_when_absent() {
        let result = parse_continue_response(&json!({})).expect("empty body parses");
        assert!(result.all_threads_continued);
    }

    #[test]
    fn parse_continue_response_honors_an_explicit_false() {
        let result = parse_continue_response(&json!({"allThreadsContinued": false}))
            .expect("well-formed body parses");
        assert!(!result.all_threads_continued);
    }

    #[test]
    fn parse_run_in_terminal_arguments_splits_the_program_from_its_own_args() {
        let arguments = json!({
            "kind": "integrated",
            "title": "Run Program",
            "cwd": "/tmp",
            "args": ["python3", "-c", "print(1)"],
            "env": {"FOO": "bar", "UNSET_ME": null},
        });
        let parsed =
            parse_run_in_terminal_arguments(Some(&arguments)).expect("well-formed request parses");
        assert_eq!(parsed.cwd.as_deref(), Some("/tmp"));
        assert_eq!(parsed.program, "python3");
        assert_eq!(parsed.args, vec!["-c".to_owned(), "print(1)".to_owned()]);
        assert_eq!(
            parsed.env,
            vec![
                ("FOO".to_owned(), Some("bar".to_owned())),
                ("UNSET_ME".to_owned(), None),
            ]
        );
        assert_eq!(parsed.title.as_deref(), Some("Run Program"));
    }

    #[test]
    fn parse_run_in_terminal_arguments_does_not_branch_on_kind() {
        // `kind: "external"` must parse identically to `"integrated"` — see
        // `RunInTerminalArguments`'s own doc comment for why this domain
        // never models (or branches on) `kind` at all.
        let external = json!({"cwd": "/tmp", "args": ["true"], "kind": "external"});
        let integrated = json!({"cwd": "/tmp", "args": ["true"], "kind": "integrated"});
        let missing = json!({"cwd": "/tmp", "args": ["true"]});
        for arguments in [external, integrated, missing] {
            let parsed = parse_run_in_terminal_arguments(Some(&arguments))
                .expect("well-formed request parses regardless of kind");
            assert_eq!(parsed.program, "true");
        }
    }

    #[test]
    fn parse_run_in_terminal_arguments_accepts_debugpy_missing_cwd_shape() {
        let parsed = parse_run_in_terminal_arguments(Some(&json!({
            "kind": "integrated",
            "args": ["python3", "launcher.py"],
        })))
        .expect("debugpy's omitted cwd shape is resolved by the root-bound handler");
        assert_eq!(parsed.cwd, None);
        assert_eq!(parsed.program, "python3");
    }

    #[test]
    fn parse_run_in_terminal_arguments_rejects_structurally_invalid_requests() {
        assert!(parse_run_in_terminal_arguments(None).is_none());
        assert!(parse_run_in_terminal_arguments(Some(&json!({}))).is_none());
        assert!(
            parse_run_in_terminal_arguments(Some(&json!({"cwd": "/tmp", "args": []}))).is_none()
        );
        assert!(
            parse_run_in_terminal_arguments(Some(&json!({"cwd": "/tmp", "args": [1, 2]})))
                .is_none()
        );
        assert!(
            parse_run_in_terminal_arguments(Some(&json!({"cwd": 1, "args": ["true"]}))).is_none()
        );
        assert!(parse_run_in_terminal_arguments(Some(
            &json!({"cwd": "/tmp", "args": ["true"], "env": {"FOO": 1}})
        ))
        .is_none());
    }

    #[test]
    fn parse_run_in_terminal_arguments_enforces_the_args_ceiling() {
        let oversized: Vec<Value> = (0..(MAX_RUN_IN_TERMINAL_ARGS + 1))
            .map(|index| Value::from(format!("arg{index}")))
            .collect();
        let arguments = json!({"cwd": "/tmp", "args": oversized});
        assert!(parse_run_in_terminal_arguments(Some(&arguments)).is_none());
    }

    #[test]
    fn debug_output_ack_request_parses_and_splits_into_parts() {
        let value = json!({"sessionId": VALID_ID, "sequence": 42});
        let request: DebugOutputAckRequest =
            serde_json::from_value(value).expect("well-formed request parses");
        let (session_id, sequence) = request.into_parts();
        assert_eq!(session_id.as_wire(), VALID_ID);
        assert_eq!(sequence, 42);
    }

    #[test]
    fn debug_output_ack_request_rejects_unknown_fields() {
        let mut value = json!({"sessionId": VALID_ID, "sequence": 1});
        value["extra"] = json!(true);
        assert!(serde_json::from_value::<DebugOutputAckRequest>(value).is_err());
    }

    #[test]
    fn debug_output_ack_request_rejects_a_negative_sequence() {
        let value = json!({"sessionId": VALID_ID, "sequence": -1});
        assert!(serde_json::from_value::<DebugOutputAckRequest>(value).is_err());
    }
}
