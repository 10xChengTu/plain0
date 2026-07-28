//! Rust generic Debug Adapter Protocol (DAP) client domain (`F100` of
//! `docs/research/2026-07-28-generic-dap.md`, itself building on ADR
//! `docs/decisions/0003-native-git-and-generic-dap.md`'s "Rust 实现编辑器侧
//! DAP client" decision).
//!
//! # Scope of this slice (`F100` S2 — real session lifecycle)
//!
//! S0 built the transport-agnostic frame decoder ([`framing`]); S1 built the
//! TCP transport ([`tcp`]) and the first-run confirmation gate ([`confirm`]).
//! Neither drove a real, live session — [`exec::spawn_adapter`]/
//! [`tcp::connect_adapter`] had no production caller until now. S2 adds:
//!
//! 1. [`protocol`] — DAP envelope parsing/encoding on top of [`framing`]'s
//!    raw `Content-Length` bytes (`Response`/`Event`/reverse-`Request`
//!    envelopes, [`protocol::Capabilities`] negotiation).
//! 2. [`session`] — the real session lifecycle: a dedicated reader thread
//!    per session, `request_seq`-keyed request/response correlation (never
//!    the adapter's own `seq` — see [`protocol`]'s module doc for the real
//!    `lldb-dap` `seq: 0` evidence that rules this out), the handshake
//!    orchestration ([`session::run_handshake`]) this slice exists to get
//!    right (see that module's own doc for the exact ordering
//!    `docs/research/2026-07-28-generic-dap.md`'s real `debugpy` capture
//!    proved: `launch`/`attach`'s response must not be awaited until after
//!    `configurationDone`'s own response has arrived), and event dispatch
//!    via [`session::DebugEventSink`].
//! 3. [`service`] — [`service::DebugSessionService`], the per-window session
//!    table mirroring `terminal::service::TerminalService`'s own shape:
//!    resolves a request into either [`exec::spawn_adapter`] (stdio) or
//!    [`tcp::connect_adapter`] (TCP).
//! 4. Three new commands in [`commands`] — `debug_launch`/`debug_attach`/
//!    `debug_disconnect` — completing the command surface S1's own module
//!    doc already named as what S2 would add.
//!
//! # This slice's answer to S1's open "spawn-then-connect" question: connect-only, by decision, not by omission
//!
//! S1 left open whether the TCP transport should compose with spawning
//! ("Plain starts the adapter process, which itself opens a TCP listener,
//! and Plain then connects to the port it opened") or stay connect-only
//! ("the adapter is already running externally; Plain only ever connects
//! out"). Now that [`service::DebugSessionService`] actually has the session
//! state machine needed to sequence such a thing, this slice's concrete
//! decision is **connect-only, matching S1's existing scope** —
//! [`service::DebugSessionService::start_session`]'s TCP branch calls
//! [`tcp::connect_adapter`] alone, never [`exec::spawn_adapter`]. This is a
//! disclosed, deliberate narrowing, not an oversight: implementing
//! spawn-then-connect properly surfaced a real design snag while drafting
//! this slice, worth recording rather than papering over. [`exec::spawn_adapter`]
//! hardcodes `AdapterTransportKind::Stdio` when building the confirmation
//! subject it checks (`scripts/plain/boundary-contracts.mjs`'s
//! `validateDebugAdapterSpawnBoundary` mechanically locks this — correctly,
//! for the ordinary case where the spawned process's own stdio *is* the DAP
//! transport). A "spawn a companion process that will itself open a TCP
//! listener elsewhere" use case would need to confirm that spawn under the
//! **`Tcp`** confirmation subject instead (the one the user actually
//! confirmed for this TCP session) — reusing `spawn_adapter` as-is would
//! silently demand (or silently reuse) a *different* confirmation record
//! than the one governing the session the user is actually starting, which
//! is exactly the kind of confirmation-identity confusion `docs/research/2026-07-28-generic-dap.md`'s
//! "主导会话裁定" item 2 was written to prevent. Fixing this correctly needs a
//! second, `Tcp`-confirmed spawn entry point distinct from `spawn_adapter`
//! (not a generalization of `spawn_adapter` itself, which must keep hardcoding
//! `Stdio` for its own real use case) — a real, buildable fix, not a
//! blocked question, but one this slice declines to rush in alongside
//! everything else S2 already delivers. **Recommendation for whoever picks
//! this up next**: implement it as a small, separate addition — a
//! `Tcp`-confirmed companion-spawn primitive in `exec` (or a thin sibling
//! function), invoked from `start_session`'s TCP branch only when the
//! resolved request explicitly opts in (e.g. a `spawn_before_connect: bool`
//! alongside the existing `command`/`args`/`host`/`port` fields), with a
//! bounded connect-retry loop after spawning (a real listener needs a moment
//! to come up; a bare `TcpStream::connect` can observe `ECONNREFUSED`
//! near-instantly rather than actually waiting out
//! [`tcp::DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT`]). This only covers a
//! statically-known `host`/`port` (the common real case — e.g. `debugpy.adapter
//! --port 5678`); genuinely discovering an OS-assigned ephemeral port
//! (`--port 0`) from an adapter's own stdout announcement is adapter-specific
//! and not something this recommendation covers either.
//!
//! Adapter-config parsing (`.plain/debug-adapters.json`/`.vscode/launch.json`'s
//! inline `plainAdapter` block) is still frontend-only per the frozen doc's
//! own "决策 1" — see `app/features/debug/plain-debug-adapter-config.ts`. No
//! `app/` UI is wired to the new commands yet (`F100` S3/S4's job, per the
//! frozen doc's own slice breakdown: "S2...可以先用一个 DEV-only 诊断钩子...
//! 不急着接 UI") — see this slice's own final report for the explicit,
//! disclosed narrowing this implies.
//!
//! # Subprocess spawning is `exec::spawn_adapter`-only; TCP connecting is `tcp::connect_adapter`-only
//!
//! Exactly like `git::` (whose own module doc makes the same claim for
//! `exec::run_git`), every subprocess this domain ever spawns goes through
//! [`exec::spawn_adapter`]/[`exec::spawn_adapter_sync`], and every TCP
//! connection through [`tcp::connect_adapter`]/[`tcp::connect_adapter_sync`]
//! — never `std::process::Command`/`std::net::TcpStream::connect` directly
//! anywhere else in this module tree, and never by asking a shell to
//! interpret a concatenated command string.
//! `scripts/plain/boundary-contracts.mjs`'s `validateDebugSpawnConstructionShape`
//! mechanically locks the exact `Command::new(&descriptor.command)
//! .args(&descriptor.args)` construction shape; `validateDebugAdapterSpawnBoundary`/
//! `validateDebugAdapterConnectBoundary` lock that the trust-then-confirmation
//! gate runs, in that literal order, before any of it.
//!
//! # Trust *then* confirmation, before spawn or connect
//!
//! [`exec::spawn_adapter`]/[`tcp::connect_adapter`] both call
//! `TrustService::require_trusted` as their literal first statement (exactly
//! like `terminal::service::TerminalService::start`/
//! `git::discovery::discover_repository` — `trust::mod`'s own module doc
//! already names `F100`/DAP as the third consumer of this gate), then
//! `ConfirmationService::require_confirmed` as their literal second — the
//! second, independent gate ADR 0003 requires. Unlike inventing a new
//! domain-specific "not trusted" error code, this domain propagates
//! `require_trusted`'s own `WORKSPACE_NOT_TRUSTED` error verbatim (mirroring
//! what `git`/`terminal` actually do today), but the confirmation gate *does*
//! get its own domain-specific code
//! ([`debug_adapter_not_confirmed`]/`DEBUG_ADAPTER_NOT_CONFIRMED`) — unlike
//! "not trusted", this is a genuinely new concept neither `git` nor
//! `terminal` has a precedent for, so there is no existing verbatim error to
//! reuse.
//!
//! # The one remaining dead-code annotation is deliberate, not stray
//!
//! S0/S1 left a trail of `#[allow(dead_code)]` items across [`framing`],
//! [`exec`] and [`tcp`], each naming which future slice would add the real
//! caller. This slice ([`service::DebugSessionService::start_session`]) is
//! that caller for essentially all of them — [`framing::FrameDecoder`],
//! [`exec::spawn_adapter`]/`spawn_adapter_sync`/`apply_env_passthrough`/
//! `spawn_stderr_capture`, [`exec::AdapterHandle`]'s `kill`/`take_io`, and
//! [`tcp::connect_adapter`]/`connect_adapter_sync` are all genuinely live in
//! production now, so their annotations have been removed rather than left
//! stale. The one that remains is [`exec::AdapterHandle::stderr_tail`] — see
//! its own doc comment: no caller anywhere yet, even in tests, kept for a
//! later slice wanting to surface a running adapter's stderr diagnostics.

use crate::error::CommandError;

pub(crate) mod commands;
pub(crate) mod confirm;
mod confirm_store;
pub mod dto;
pub(crate) mod exec;
pub(crate) mod framing;
pub(crate) mod protocol;
pub(crate) mod service;
pub(crate) mod session;
pub(crate) mod tcp;

/// Returned when [`exec::spawn_adapter_sync`]'s own `Command::spawn()` call
/// fails outright (bad executable path, missing execute permission, …) — the
/// DAP-domain analogue of `git::git_exec_unavailable`. Also used when the
/// `spawn_blocking` hop itself panics/is cancelled, mirroring every other
/// domain's `spawn_blocking` join-error mapping (e.g.
/// `terminal::terminal_unavailable`'s own use for the identical join-error
/// case), and when polling the child's exit status itself returns an OS
/// error during the startup grace window.
pub(crate) fn debug_adapter_spawn_unavailable() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_SPAWN_UNAVAILABLE",
        "The debug adapter subprocess could not be started.",
    )
}

/// Returned when [`exec::spawn_adapter_sync`]'s cooperative `cancel` flag is
/// observed during the startup grace-window wait — the caller asked to give
/// up before the adapter had a chance to prove it stayed alive. The child (if
/// it was actually spawned) is killed and reaped before this is returned.
pub(crate) fn debug_adapter_cancelled() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_CANCELLED",
        "Starting the debug adapter was cancelled.",
    )
}

/// Returned by [`confirm::ConfirmationService::require_confirmed`] when the
/// caller's `(command, args, transport)` triple has not yet been confirmed
/// for the current workspace — the actionable, structured failure mode
/// `docs/research/2026-07-28-generic-dap.md`'s acceptance criterion 4 ("缺失
/// 或未信任的 adapter 以可操作的确认失败") calls for on the confirmation side
/// (missing/untrusted adapters get their own codes: `WORKSPACE_NOT_TRUSTED`
/// propagated verbatim, and the config-resolution "adapter type not found"
/// case the frontend config module reports). A caller seeing this code knows
/// exactly what to do next: run the confirmation flow
/// (`app/features/debug/plain-debug-adapter-confirmation.ts`'s
/// `resolveDebugAdapterConfirmation`), then retry.
pub(crate) fn debug_adapter_not_confirmed() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_NOT_CONFIRMED",
        "This exact adapter command has not been confirmed for this workspace yet.",
    )
}

/// Covers every confirmation-store failure mode: no stable workspace identity
/// to key a grant/revoke against (the `EMPTY` workspace), and any I/O/
/// (de)serialization failure reading or writing `confirm_store`'s persisted
/// entries — mirroring `trust::trust_unavailable`/`backup::backup_unavailable`'s
/// identical "fold every unrecoverable-differently case into one caller-facing
/// code" precedent.
pub(crate) fn confirmation_unavailable() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE",
        "The debug adapter confirmation store is not available for this window.",
    )
}

/// Returned when [`tcp::connect_adapter_sync`]'s own `TcpStream::connect`
/// attempt fails outright (connection refused, DNS resolution failure, no
/// route) — the TCP-transport analogue of [`debug_adapter_spawn_unavailable`].
pub(crate) fn debug_adapter_connect_failed() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_CONNECT_FAILED",
        "Could not connect to the debug adapter's TCP endpoint.",
    )
}

/// Returned when the spawned adapter process exits on its own before
/// [`exec`]'s startup grace window has elapsed — see that module's doc
/// comment for why this is the concrete, testable meaning of "adapter
/// crashed at startup" for this slice (a real per-session "adapter crashed
/// later, mid-session" path needs the reader/waiter machinery S2 builds, and
/// is explicitly out of scope here). The message carries the process's exit
/// status and whatever stderr the capped background reader managed to
/// capture before this error is constructed, so a caller gets an actionable
/// diagnostic instead of a bare "it failed".
pub(crate) fn debug_adapter_startup_crashed(
    exit_code: Option<i32>,
    stderr_tail: &[u8],
) -> CommandError {
    let exit_description = match exit_code {
        Some(code) => format!("exit code {code}"),
        None => "no exit code (terminated by signal)".to_owned(),
    };
    let tail = String::from_utf8_lossy(stderr_tail);
    let trimmed_tail = tail.trim();
    CommandError::new(
        "DEBUG_ADAPTER_STARTUP_CRASHED",
        format!(
            "The debug adapter process exited ({exit_description}) before it was confirmed to \
             have started; captured stderr: {}",
            if trimmed_tail.is_empty() {
                "(empty)"
            } else {
                trimmed_tail
            }
        ),
    )
}

/// Returned when writing a request to (or reading a reply from) a live
/// session's transport fails at the I/O level — [`session::DebugSession::send_request`]'s
/// write failure path, and the `spawn_blocking`/`try_clone` join/setup
/// failures in [`service::DebugSessionService::start_session`] that occur
/// before a session even exists to report [`debug_session_ended`] instead.
pub(crate) fn debug_transport_unavailable() -> CommandError {
    CommandError::new(
        "DEBUG_TRANSPORT_UNAVAILABLE",
        "The debug session's transport could not be used.",
    )
}

/// Returned by [`session::DebugSession::wait_for_response`]/`wait_for_initialized`
/// when the session's transport closes (or an unrecoverable framing error
/// occurs) before the awaited response/event ever arrives — see
/// [`session::SessionEndReason`] for the two distinct underlying causes this
/// one caller-facing code covers. This is what turns "the reader thread will
/// never deliver what I'm waiting for" into a clean, immediate error instead
/// of a permanent hang — no per-request timeout is needed for this case (see
/// `session`'s own module doc for what per-request timeouts, deliberately
/// *not* implemented in this slice, would additionally cover).
pub(crate) fn debug_session_ended() -> CommandError {
    CommandError::new(
        "DEBUG_SESSION_ENDED",
        "The debug session's transport closed before this operation completed.",
    )
}

/// Returned by [`session::run_handshake`] when the adapter's own response to
/// `initialize`/`launch`/`attach`/`setBreakpoints`/`configurationDone`
/// reports `success: false` — the message carries which step failed and the
/// adapter's own `message` field, if it sent one, so a caller gets an
/// actionable diagnostic rather than a bare failure.
pub(crate) fn debug_handshake_failed(step: &str, adapter_message: Option<&str>) -> CommandError {
    let detail = match adapter_message {
        Some(message) if !message.is_empty() => format!(": {message}"),
        _ => String::new(),
    };
    CommandError::new(
        "DEBUG_HANDSHAKE_FAILED",
        format!("The debug adapter rejected the '{step}' step{detail}."),
    )
}

/// Returned by [`service::DebugSessionService::disconnect`]/`send_request`
/// (`F100` S3 added the latter caller) when `session_id` does not name a live
/// session for the current window — either it never existed, already ended on
/// its own, or was already disconnected.
pub(crate) fn debug_session_not_found() -> CommandError {
    CommandError::new(
        "DEBUG_SESSION_NOT_FOUND",
        "The requested debug session does not exist for this window.",
    )
}

/// Returned by [`dto::DebugSessionStartRequest::into_parts`] when the
/// request itself is structurally invalid — a `tcp` transport missing
/// `host`/`port` (or a `stdio` transport carrying either), an empty
/// `command`, or any of the defensive size ceilings on `args`/
/// `initialBreakpoints` exceeded. `F100` S3 reuses this same code for its own
/// analogous request-shape failures (an empty `debug_set_breakpoints` path,
/// an empty/oversized `debug_evaluate` expression, …) rather than inventing a
/// second "request invalid" code for the same kind of failure.
pub(crate) fn debug_session_request_invalid() -> CommandError {
    CommandError::new(
        "DEBUG_SESSION_REQUEST_INVALID",
        "The debug session start request is missing required fields or exceeds a size limit.",
    )
}

/// Returned by [`service::DebugSessionService::send_request`] when the
/// adapter's own response to an interactive request (`setBreakpoints`/
/// `stackTrace`/`scopes`/`variables`/`evaluate`) reports `success: false` —
/// the post-handshake analogue of [`debug_handshake_failed`], carrying which
/// DAP command failed and the adapter's own `message`, if it sent one.
pub(crate) fn debug_request_failed(command: &str, adapter_message: Option<&str>) -> CommandError {
    let detail = match adapter_message {
        Some(message) if !message.is_empty() => format!(": {message}"),
        _ => String::new(),
    };
    CommandError::new(
        "DEBUG_REQUEST_FAILED",
        format!("The debug adapter rejected the '{command}' request{detail}."),
    )
}

/// Returned by every `dto::parse_*_response` function (`F100` S3) when an
/// adapter's own response body is structurally not what its DAP command's
/// spec requires (e.g. `variables` missing its own `variables` array
/// entirely, or a `Variable` entry missing its required `name`/`value`) —
/// distinct from [`debug_request_failed`] (the adapter itself reported
/// failure) and from [`debug_session_ended`] (the transport died before a
/// response ever arrived): this is "a response arrived, the adapter claims
/// success, but Plain cannot make sense of its shape".
pub(crate) fn debug_adapter_response_malformed() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_RESPONSE_MALFORMED",
        "The debug adapter's response did not match the shape its own request requires.",
    )
}

#[cfg(test)]
mod tests {
    use super::{
        confirmation_unavailable, debug_adapter_cancelled, debug_adapter_connect_failed,
        debug_adapter_not_confirmed, debug_adapter_response_malformed,
        debug_adapter_spawn_unavailable, debug_adapter_startup_crashed, debug_handshake_failed,
        debug_request_failed, debug_session_ended, debug_session_not_found,
        debug_session_request_invalid, debug_transport_unavailable,
    };

    #[test]
    fn error_constructors_have_stable_codes() {
        assert_eq!(
            debug_adapter_spawn_unavailable().code(),
            "DEBUG_ADAPTER_SPAWN_UNAVAILABLE"
        );
        assert_eq!(debug_adapter_cancelled().code(), "DEBUG_ADAPTER_CANCELLED");
        assert_eq!(
            debug_adapter_startup_crashed(Some(1), b"boom").code(),
            "DEBUG_ADAPTER_STARTUP_CRASHED"
        );
        assert_eq!(
            debug_adapter_not_confirmed().code(),
            "DEBUG_ADAPTER_NOT_CONFIRMED"
        );
        assert_eq!(
            confirmation_unavailable().code(),
            "DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE"
        );
        assert_eq!(
            debug_adapter_connect_failed().code(),
            "DEBUG_ADAPTER_CONNECT_FAILED"
        );
        assert_eq!(
            debug_transport_unavailable().code(),
            "DEBUG_TRANSPORT_UNAVAILABLE"
        );
        assert_eq!(debug_session_ended().code(), "DEBUG_SESSION_ENDED");
        assert_eq!(
            debug_handshake_failed("initialize", None).code(),
            "DEBUG_HANDSHAKE_FAILED"
        );
        assert_eq!(debug_session_not_found().code(), "DEBUG_SESSION_NOT_FOUND");
        assert_eq!(
            debug_session_request_invalid().code(),
            "DEBUG_SESSION_REQUEST_INVALID"
        );
        assert_eq!(
            debug_request_failed("stackTrace", None).code(),
            "DEBUG_REQUEST_FAILED"
        );
        assert_eq!(
            debug_adapter_response_malformed().code(),
            "DEBUG_ADAPTER_RESPONSE_MALFORMED"
        );
    }

    #[test]
    fn request_failed_includes_the_command_and_adapter_message_when_present() {
        let error = debug_request_failed("variables", Some("boom"));
        assert!(error.message().contains("variables"));
        assert!(error.message().contains("boom"));
    }

    #[test]
    fn request_failed_omits_the_colon_when_there_is_no_adapter_message() {
        let error = debug_request_failed("scopes", None);
        assert!(error.message().contains("scopes"));
        assert!(!error.message().contains(": "));
    }

    #[test]
    fn handshake_failed_includes_the_step_and_adapter_message_when_present() {
        let error = debug_handshake_failed("configurationDone", Some("boom"));
        assert!(error.message().contains("configurationDone"));
        assert!(error.message().contains("boom"));
    }

    #[test]
    fn handshake_failed_omits_the_colon_when_there_is_no_adapter_message() {
        let error = debug_handshake_failed("initialize", None);
        assert!(error.message().contains("initialize"));
        assert!(!error.message().contains(": "));
    }

    #[test]
    fn startup_crashed_message_includes_exit_code_and_stderr_tail() {
        let error = debug_adapter_startup_crashed(Some(127), b"command not found");
        assert!(error.message().contains("127"));
        assert!(error.message().contains("command not found"));
    }

    #[test]
    fn startup_crashed_message_handles_missing_exit_code_and_empty_stderr() {
        let error = debug_adapter_startup_crashed(None, b"");
        assert!(error.message().contains("signal"));
        assert!(error.message().contains("(empty)"));
    }

    #[test]
    fn startup_crashed_message_trims_whitespace_only_stderr_to_empty() {
        let error = debug_adapter_startup_crashed(Some(1), b"   \n  ");
        assert!(error.message().contains("(empty)"));
    }
}
