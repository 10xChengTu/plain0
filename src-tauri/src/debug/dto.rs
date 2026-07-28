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

use super::debug_session_request_invalid;
use super::session::{LaunchRequestKind, SourceBreakpoints};

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

/// One `line`/`condition`/`logMessage` breakpoint entry within a
/// [`SourceBreakpointsRequest`] — the wire shape for the handshake's
/// "setBreakpoints series" step (see `super::session`'s module doc for why
/// this is deliberately minimal, not the breakpoint feature itself).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct LineBreakpointRequest {
    pub line: u32,
    #[serde(default)]
    pub condition: Option<String>,
    #[serde(default)]
    pub log_message: Option<String>,
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

impl SourceBreakpointsRequest {
    fn to_source_breakpoints(&self) -> SourceBreakpoints {
        let breakpoints: Vec<Value> = self
            .breakpoints
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
                Value::Object(object)
            })
            .collect();
        SourceBreakpoints {
            arguments: serde_json::json!({
                "source": { "path": self.path },
                "breakpoints": breakpoints,
            }),
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        AdapterTransportKind, DebugSessionId, DebugSessionStartRequest, LineBreakpointRequest,
        SessionTransportRequest, SourceBreakpointsRequest,
    };
    use crate::debug::session::LaunchRequestKind;

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
                },
                LineBreakpointRequest {
                    line: 7,
                    condition: Some("x > 1".to_owned()),
                    log_message: Some("hit line 7".to_owned()),
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
    fn debug_session_start_request_deserializes_camel_case_and_rejects_unknown_fields() {
        let value = json!({
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
            "transport": "stdio",
            "command": "/usr/bin/python3",
            "adapterId": "mock",
            "unexpected": true,
        });
        assert!(serde_json::from_value::<DebugSessionStartRequest>(with_unknown_field).is_err());
    }
}
