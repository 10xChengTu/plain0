//! `F100` S1 added the first-run confirmation gate's own query/grant/revoke
//! surface (`debug_adapter_confirmation_state`/`_grant`/`_revoke`). `F100` S2
//! added exactly three more — `debug_launch`/`debug_attach`/
//! `debug_disconnect` — the real session-lifecycle surface. `F100` S3 added
//! the *interactive* debugging surface: `debug_set_breakpoints`/
//! `debug_stack_trace`/`debug_scopes`/`debug_variables`/`debug_evaluate`.
//! `F100` S4 added five more: execution/step control
//! (`debug_continue`/`debug_next`/`debug_step_in`/`debug_step_out`/
//! `debug_pause`) — plus real `runInTerminal` reverse-request handling, which
//! is not a new `#[tauri::command]` at all (see below). `F100` S5 adds
//! exactly one more — `debug_output_ack` — the frontend's own acknowledgement
//! of a gated `output` event (see `super::output_gate`'s own module doc).
//! `F210` S4 (this slice) adds one final command — `debug_step_in_targets`,
//! the `stepInTargets` target picker's own data source (see its own doc
//! comment below) — and gives `debug_step_in` an optional `targetId` on its
//! existing request DTO (see [`super::dto::DebugStepInRequest`]'s own doc
//! comment for why that is a dedicated DTO, not a field grown onto the
//! shared [`super::dto::DebugThreadRequest`] the other four step-control
//! commands still use); this brings the total to eighteen real commands
//! (3 + 3 + 5 + 5 + 1 + 1). Read this comment before adding a nineteenth.
//!
//! # `F100` S3's five commands (unchanged this slice)
//!
//! Every one of these is a thin wrapper: convert the request DTO into a
//! `(session_id, arguments)` pair via its own `into_parts`, call
//! [`super::service::DebugSessionService::send_request`] with the one literal
//! DAP command name each corresponds to, then parse the raw response body via
//! the matching `dto::parse_*_response` function. None of these five take a
//! caller-supplied DAP command name — the command string is always a literal
//! in this file, matching `debug_launch`/`debug_attach`'s own "no generic
//! escape hatch" shape. `debug_set_breakpoints` is deliberately independent
//! of `debug_launch`/`debug_attach`'s own `initialBreakpoints` field (see
//! [`super::dto::DebugSetBreakpointsRequest`]'s own doc comment) — it is the
//! *only* path Plain's frontend uses to sync breakpoints with a live session,
//! both for a breakpoint toggled before the session started and one toggled
//! while it is already running, deliberately not duplicating that
//! serialization logic across two call sites. `debug_evaluate`'s `context`
//! field is a closed, spec-derived enum
//! ([`super::dto::DebugEvaluateContext`]), not an arbitrary string — `F100`
//! S3 only ever sent `context: "watch"` from the Watch view; this slice's
//! Debug Console is the first `"repl"` caller.
//!
//! # `F100` S4's five step-control commands
//!
//! `debug_continue`/`debug_next`/`debug_step_in`/`debug_step_out`/
//! `debug_pause` all send, per spec, `arguments` that are exactly
//! `{threadId: number, ...fields this domain does not send}` — real DAP
//! defines no `supportsXxx` capability gating these five basic requests
//! themselves (they are mandatory baseline requests every adapter must
//! implement), only optional *enhancements*. `debug_continue`/`debug_next`/
//! `debug_step_out`/`debug_pause` still share one request DTO
//! ([`super::dto::DebugThreadRequest`]); `debug_step_in` moved to its own
//! dedicated DTO in `F210` S4 (see below). Only `debug_continue` has a
//! meaningful response body ([`super::dto::DebugContinueResult`]); the other
//! four discard the adapter's response body entirely (a bare `Ok(())` — DAP
//! defines no useful fields on their own responses).
//!
//! # `F210` S4's `stepInTargets` target picker
//!
//! `debug_step_in_targets` is a thin wrapper exactly like `F100` S3's five
//! (see above): convert [`super::dto::DebugStepInTargetsRequest`] into a
//! `(session_id, arguments)` pair via its own `into_parts`, call
//! [`super::service::DebugSessionService::send_request`] with the literal
//! `"stepInTargets"` DAP command name, then parse the response via
//! [`dto::parse_step_in_targets_response`]. `debug_step_in` itself now takes
//! [`super::dto::DebugStepInRequest`] instead of the shared
//! `DebugThreadRequest` — its own doc comment explains why an optional
//! `targetId` warranted a dedicated DTO rather than growing the one
//! `continue`/`next`/`stepOut`/`pause` still share. Real DAP gates
//! `stepInTargets` behind `Capabilities.supportsStepInTargetsRequest`; this
//! domain does not enforce that gate in Rust (the frontend does, before ever
//! issuing the call) — matching every other `supportsXxx`-gated affordance
//! in this codebase.
//!
//! # `runInTerminal` is not a new Tauri command
//!
//! Real `runInTerminal` handling (this slice's other major addition) is a
//! **reverse**-request handler ([`RunInTerminalReverseRequestHandler`],
//! implementing `super::session::ReverseRequestHandler`) wired into
//! [`start_debug_session`]'s call to
//! [`DebugSessionService::start_session`] — it never crosses the Tauri IPC
//! boundary as its own command at all, because the frontend is never the one
//! who decides to call it: an *adapter* decides to send this reverse request,
//! mid-session, and Rust must answer it without a frontend round trip (per
//! the frozen research doc's "主导会话裁定" item 4). See
//! [`handle_run_in_terminal_reverse_request`]'s own doc comment for the full
//! design (why no second confirmation dialog, how visibility is the
//! substitute, why `kind: "external"` is treated identically to
//! `"integrated"`).
//!
//! # Why `debug_launch`/`debug_attach`/`debug_disconnect` finally have a real caller
//!
//! S2 disclosed these three as having zero frontend callers. `F100` S3 was
//! the first slice to add `app/` UI at all, giving these three a real
//! production caller (`app/features/debug/plain-debug-session.ts`).
//!
//! # Adapter-config parsing stays entirely in the frontend
//!
//! Per the frozen research doc's "决策 1" ("读取这两份配置完全复用既有的
//! `workspace_read_file` 能力,不新增任何 Rust 端文件读取代码"), parsing
//! `.plain/debug-adapters.json`/`.vscode/launch.json`'s inline `plainAdapter`
//! block happens in `app/features/debug/plain-debug-adapter-config.ts`, not
//! here — this file has no config-reading surface at all.

use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::error::CommandError;
use crate::terminal::service::{TerminalOutputSink, TerminalService};
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

use super::confirm::ConfirmationService;
use super::debug_run_in_terminal_arguments_invalid;
use super::dto::{
    self, AdapterConfirmationSubject, DebugContinueResult, DebugEvaluateRequest,
    DebugEvaluateResult, DebugEventPayload, DebugOutputAckRequest, DebugScopesRequest,
    DebugScopesResult, DebugSessionId, DebugSessionIdRequest, DebugSessionStartRequest,
    DebugSessionStartResult, DebugSetBreakpointsRequest, DebugSetBreakpointsResult,
    DebugStackTraceRequest, DebugStackTraceResult, DebugStepInRequest, DebugStepInTargetsRequest,
    DebugStepInTargetsResult, DebugThreadRequest, DebugVariablesRequest, DebugVariablesResult,
};
use super::service::DebugSessionService;
use super::session::{
    DebugEventSink, LaunchRequestKind, ReverseRequestHandler, ReverseRequestOutcome,
    SessionEndReason,
};

/// Response shape for `debug_adapter_confirmation_state` — an own-data,
/// exactly `{ confirmed }` object, mirroring `trust::commands::WorkspaceTrustState`'s
/// identical shape for the analogous "read a persisted yes/no fact" query.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugAdapterConfirmationState {
    confirmed: bool,
}

impl DebugAdapterConfirmationState {
    const fn new(confirmed: bool) -> Self {
        Self { confirmed }
    }
}

/// Reads whether `request` (the exact `(command, args, transport)` triple)
/// has already been confirmed for the current workspace. `false`, never a
/// rejection, for the `EMPTY` workspace — mirrors
/// `trust::commands::workspace_trust_state`'s identical fail-closed-to-`false`
/// contract.
#[tauri::command]
pub(crate) async fn debug_adapter_confirmation_state(
    window: WebviewWindow,
    confirmation: State<'_, ConfirmationService>,
    workspace: State<'_, WorkspaceService>,
    request: AdapterConfirmationSubject,
) -> Result<DebugAdapterConfirmationState, CommandError> {
    let confirmed = confirmation
        .inner()
        .is_confirmed(workspace.inner(), window.label(), &request)
        .await?;
    Ok(DebugAdapterConfirmationState::new(confirmed))
}

/// Persists confirmation for `request`, scoped to the current workspace's
/// stable roots identity. Rejects with `DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE`
/// for the `EMPTY` workspace (nothing to grant confirmation against).
#[tauri::command]
pub(crate) async fn debug_adapter_confirmation_grant(
    window: WebviewWindow,
    confirmation: State<'_, ConfirmationService>,
    workspace: State<'_, WorkspaceService>,
    request: AdapterConfirmationSubject,
) -> Result<(), CommandError> {
    confirmation
        .inner()
        .grant(workspace.inner(), window.label(), &request)
        .await
}

/// Revokes a previously granted confirmation for `request`. Idempotent:
/// revoking a triple that was never (or no longer) confirmed succeeds
/// silently, mirroring `workspace_trust_revoke`.
#[tauri::command]
pub(crate) async fn debug_adapter_confirmation_revoke(
    window: WebviewWindow,
    confirmation: State<'_, ConfirmationService>,
    workspace: State<'_, WorkspaceService>,
    request: AdapterConfirmationSubject,
) -> Result<(), CommandError> {
    confirmation
        .inner()
        .revoke(workspace.inner(), window.label(), &request)
        .await
}

/// Window-targeted debug session event stream — mirrors
/// `terminal::commands::TERMINAL_DATA_EVENT`'s exact `emit_to` precedent.
/// Every real DAP event *and* every `plain/`-prefixed synthetic notification
/// [`super::session`] itself synthesizes (reverse-request diagnostics,
/// protocol errors, session-ended) rides this one event name — see that
/// module's own doc for why a single channel, not one Tauri event name per
/// DAP event type.
pub(crate) const DEBUG_EVENT: &str = "plain://debug-event";

/// Real production [`DebugEventSink`]: emits every event/session-ended
/// signal straight to the session's own window. Built once per
/// `debug_launch`/`debug_attach` call (the only place with access to a live
/// `WebviewWindow`/`AppHandle`) and shared by that session's reader thread
/// for its whole lifetime — mirrors `terminal::commands::WindowEmitSink`'s
/// identical shape and rationale.
struct DebugWindowEventSink {
    app: AppHandle,
    window_label: String,
}

impl DebugEventSink for DebugWindowEventSink {
    fn emit_event(&self, session_id: DebugSessionId, event: String, body: Option<Value>) {
        let _ = self.app.emit_to(
            EventTarget::webview_window(self.window_label.clone()),
            DEBUG_EVENT,
            DebugEventPayload {
                session_id,
                event,
                body,
            },
        );
    }

    fn emit_session_ended(&self, session_id: DebugSessionId, reason: SessionEndReason) {
        let _ = self.app.emit_to(
            EventTarget::webview_window(self.window_label.clone()),
            DEBUG_EVENT,
            DebugEventPayload {
                session_id,
                event: super::session::SESSION_ENDED_EVENT_NAME.to_owned(),
                body: Some(serde_json::json!({ "reason": reason.as_wire() })),
            },
        );
    }
}

/// Starts a new debug session by sending DAP's `launch` request — see the
/// module doc for why this and [`debug_attach`] share
/// [`DebugSessionStartRequest`]'s wire shape and differ only in which
/// literal DAP request is actually sent.
#[tauri::command]
pub(crate) async fn debug_launch(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    confirmation: State<'_, ConfirmationService>,
    request: DebugSessionStartRequest,
) -> Result<DebugSessionStartResult, CommandError> {
    start_debug_session(
        window,
        debug_sessions,
        trust,
        workspace,
        confirmation,
        request,
        LaunchRequestKind::Launch,
    )
    .await
}

/// Starts a new debug session by sending DAP's `attach` request — see
/// [`debug_launch`]'s doc comment.
#[tauri::command]
pub(crate) async fn debug_attach(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    confirmation: State<'_, ConfirmationService>,
    request: DebugSessionStartRequest,
) -> Result<DebugSessionStartResult, CommandError> {
    start_debug_session(
        window,
        debug_sessions,
        trust,
        workspace,
        confirmation,
        request,
        LaunchRequestKind::Attach,
    )
    .await
}

async fn start_debug_session(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    confirmation: State<'_, ConfirmationService>,
    request: DebugSessionStartRequest,
    request_kind: LaunchRequestKind,
) -> Result<DebugSessionStartResult, CommandError> {
    let query = request.into_parts(request_kind)?;
    let sink: Arc<dyn DebugEventSink> = Arc::new(DebugWindowEventSink {
        app: window.app_handle().clone(),
        window_label: window.label().to_owned(),
    });
    let reverse_requests: Arc<dyn ReverseRequestHandler> =
        Arc::new(RunInTerminalReverseRequestHandler {
            app: window.app_handle().clone(),
            window_label: window.label().to_owned(),
            root_id: query.root_id,
        });
    let (session_id, capabilities) = debug_sessions
        .inner()
        .start_session(
            trust.inner(),
            workspace.inner(),
            window.label(),
            query.root_id,
            confirmation.inner(),
            query.request,
            query.transport,
            query.adapter_id,
            query.arguments,
            query.breakpoints,
            sink,
            reverse_requests,
        )
        .await?;
    Ok(DebugSessionStartResult::new(session_id, capabilities))
}

/// Tears down a live debug session.
#[tauri::command]
pub(crate) async fn debug_disconnect(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugSessionIdRequest,
) -> Result<(), CommandError> {
    debug_sessions
        .inner()
        .disconnect(window.label(), request.into_parts())
        .await
}

/// Runtime `setBreakpoints` — see [`super::dto::DebugSetBreakpointsRequest`]'s
/// own doc comment for why this is independent of `debug_launch`/
/// `debug_attach`'s `initialBreakpoints` field.
#[tauri::command]
pub(crate) async fn debug_set_breakpoints(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    workspace: State<'_, WorkspaceService>,
    request: DebugSetBreakpointsRequest,
) -> Result<DebugSetBreakpointsResult, CommandError> {
    let query = request.into_parts()?;
    workspace
        .inner()
        .root_canonical_path(window.label(), query.root_id)?;
    let body = debug_sessions
        .inner()
        .send_request_for_root(
            window.label(),
            query.session_id,
            query.root_id,
            "setBreakpoints",
            query.arguments,
        )
        .await?;
    dto::parse_set_breakpoints_response(&body)
}

/// Fetches (a page of) the call stack for one thread — see
/// [`super::dto::DebugStackTraceRequest`]'s own doc comment for its
/// `startFrame`/`levels` pagination fields.
#[tauri::command]
pub(crate) async fn debug_stack_trace(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugStackTraceRequest,
) -> Result<DebugStackTraceResult, CommandError> {
    let query = request.into_parts();
    let body = debug_sessions
        .inner()
        .send_request(
            window.label(),
            query.session_id,
            "stackTrace",
            query.arguments,
        )
        .await?;
    dto::parse_stack_trace_response(&body)
}

/// Fetches the variable scopes available at one stack frame.
#[tauri::command]
pub(crate) async fn debug_scopes(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugScopesRequest,
) -> Result<DebugScopesResult, CommandError> {
    let query = request.into_parts();
    let body = debug_sessions
        .inner()
        .send_request(window.label(), query.session_id, "scopes", query.arguments)
        .await?;
    dto::parse_scopes_response(&body)
}

/// Expands one `variablesReference` — see
/// [`super::dto::DebugVariablesRequest`]'s own doc comment for the lazy-
/// expansion/pagination contract this implements.
#[tauri::command]
pub(crate) async fn debug_variables(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugVariablesRequest,
) -> Result<DebugVariablesResult, CommandError> {
    let query = request.into_parts();
    let body = debug_sessions
        .inner()
        .send_request(
            window.label(),
            query.session_id,
            "variables",
            query.arguments,
        )
        .await?;
    dto::parse_variables_response(&body)
}

/// Evaluates an expression — the Watch view's own sole data source
/// (`context: "watch"`); see [`super::dto::DebugEvaluateContext`]'s own doc
/// comment for the other closed-enum context values this also accepts.
#[tauri::command]
pub(crate) async fn debug_evaluate(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugEvaluateRequest,
) -> Result<DebugEvaluateResult, CommandError> {
    let query = request.into_parts()?;
    let body = debug_sessions
        .inner()
        .send_request(
            window.label(),
            query.session_id,
            "evaluate",
            query.arguments,
        )
        .await?;
    dto::parse_evaluate_response(&body)
}

// ---------------------------------------------------------------------
// `F100` S4 — execution/step control. See the module doc's own
// "`F100` S4's five step-control commands" section.
// ---------------------------------------------------------------------

/// Resumes execution of the given thread (or, per DAP's own default, every
/// thread — see [`super::dto::DebugContinueResult`]'s own doc comment for the
/// `allThreadsContinued` default this domain implements).
#[tauri::command]
pub(crate) async fn debug_continue(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugThreadRequest,
) -> Result<DebugContinueResult, CommandError> {
    let query = request.into_parts();
    let body = debug_sessions
        .inner()
        .send_request(
            window.label(),
            query.session_id,
            "continue",
            query.arguments,
        )
        .await?;
    dto::parse_continue_response(&body)
}

/// Steps over the current line ("step over"/`next` in DAP terms).
#[tauri::command]
pub(crate) async fn debug_next(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugThreadRequest,
) -> Result<(), CommandError> {
    let query = request.into_parts();
    debug_sessions
        .inner()
        .send_request(window.label(), query.session_id, "next", query.arguments)
        .await?;
    Ok(())
}

/// Steps into the current line's call ("step into"/`stepIn` in DAP terms).
/// `request.target_id` (`F210` S4) is `None` for the existing Step Into
/// *button* call path, which never sends `targetId` at all; a caller that
/// resolved one via [`debug_step_in_targets`] passes it through instead. See
/// [`super::dto::DebugStepInRequest`]'s own doc comment for the exact
/// `arguments` shape either way.
#[tauri::command]
pub(crate) async fn debug_step_in(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugStepInRequest,
) -> Result<(), CommandError> {
    let query = request.into_parts();
    debug_sessions
        .inner()
        .send_request(window.label(), query.session_id, "stepIn", query.arguments)
        .await?;
    Ok(())
}

/// Fetches the step-into targets available at one stack frame (DAP's
/// `stepInTargets` request), gated by the frontend on
/// `Capabilities.supportsStepInTargetsRequest` before ever being called. See
/// [`super::dto::DebugStepInTargetsRequest`]'s own doc comment for the
/// `frameId` contract and [`super::dto::DebugStepInTargetsResult`]'s own for
/// the bounded-list/truncation-flag response shape.
#[tauri::command]
pub(crate) async fn debug_step_in_targets(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugStepInTargetsRequest,
) -> Result<DebugStepInTargetsResult, CommandError> {
    let query = request.into_parts();
    let body = debug_sessions
        .inner()
        .send_request(
            window.label(),
            query.session_id,
            "stepInTargets",
            query.arguments,
        )
        .await?;
    dto::parse_step_in_targets_response(&body)
}

/// Steps out of the current function ("step out"/`stepOut` in DAP terms).
#[tauri::command]
pub(crate) async fn debug_step_out(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugThreadRequest,
) -> Result<(), CommandError> {
    let query = request.into_parts();
    debug_sessions
        .inner()
        .send_request(window.label(), query.session_id, "stepOut", query.arguments)
        .await?;
    Ok(())
}

/// Interrupts a running thread.
#[tauri::command]
pub(crate) async fn debug_pause(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugThreadRequest,
) -> Result<(), CommandError> {
    let query = request.into_parts();
    debug_sessions
        .inner()
        .send_request(window.label(), query.session_id, "pause", query.arguments)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------
// `F100` S5 — `output`-event backpressure ack. See `super::output_gate`'s own
// module doc for the gate this acknowledges.
// ---------------------------------------------------------------------

/// Acknowledges every gated `output` event through `sequence` — see
/// [`super::session::DebugSession::ack_output`]. Always succeeds (including
/// for a session that no longer exists — see
/// [`DebugSessionService::ack_output`]'s own doc comment for why that race is
/// tolerated, not an error).
#[tauri::command]
pub(crate) async fn debug_output_ack(
    window: WebviewWindow,
    debug_sessions: State<'_, DebugSessionService>,
    request: DebugOutputAckRequest,
) -> Result<(), CommandError> {
    let (session_id, sequence) = request.into_parts();
    debug_sessions
        .inner()
        .ack_output(window.label(), session_id, sequence)
        .await;
    Ok(())
}

// ---------------------------------------------------------------------
// `F100` S4 — real `runInTerminal` reverse-request handling. See the module
// doc's own "`runInTerminal` is not a new Tauri command" section.
// ---------------------------------------------------------------------

/// A freshly `runInTerminal`-launched session's pty starts at this fixed size
/// — DAP's `RunInTerminalRequestArguments` carries no columns/rows of its
/// own (it names a `cwd`/`args`/`env` to run, not a terminal geometry), and
/// there is no live editor-measured pane to size against yet (the frontend
/// tab this creates does not exist until
/// [`ReverseRequestOutcome::notify`] reaches it) — matches a common ordinary
/// terminal default; the frontend can still resize it once its own pane has
/// a real, measured size, exactly like an ordinary `Plain: Create Terminal`
/// session does on its very first layout pass.
const RUN_IN_TERMINAL_DEFAULT_COLS: u16 = 80;
const RUN_IN_TERMINAL_DEFAULT_ROWS: u16 = 24;

/// Real `runInTerminal` handling — see the module doc's own "runInTerminal is
/// not a new Tauri command" section for the full design (no second
/// confirmation, visibility as the substitute, `kind` never distinguished,
/// no shell interpretation of `args`).
///
/// Deliberately `AppHandle`-free: [`RunInTerminalReverseRequestHandler`] (the
/// production `ReverseRequestHandler` impl below) is the only thing that
/// needs an `AppHandle` — purely to fetch `terminal`/`trust`/`workspace` via
/// `AppHandle::state::<T>()` (mirroring `lib.rs`'s own
/// `window.state::<T>()` window-close-cleanup precedent) and to build the
/// real [`crate::terminal::commands::WindowEmitSink`] a freshly spawned
/// session needs before calling this. Keeping *this* function free of that
/// dependency is what lets `debug::service::tests`'s own real-subprocess
/// `runInTerminal` integration test call it directly against a
/// `TerminalService`/`TrustService`/`WorkspaceService` it constructs itself,
/// with no live Tauri `App` running at all — exactly the same reason
/// `handle_run_in_terminal_reverse_request`'s sibling command functions above
/// are themselves thin wrappers around `DebugSessionService` methods that
/// take plain references, not `State<'_, T>`.
pub(crate) fn handle_run_in_terminal_reverse_request(
    terminal: &TerminalService,
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    root_id: RootId,
    arguments: Option<&Value>,
    sink: Arc<dyn TerminalOutputSink>,
) -> ReverseRequestOutcome {
    let Some(parsed) = dto::parse_run_in_terminal_arguments(arguments) else {
        return ReverseRequestOutcome {
            success: false,
            body: None,
            message: Some(debug_run_in_terminal_arguments_invalid().to_owned()),
            notify: None,
        };
    };
    let title = parsed.title.clone().unwrap_or_else(|| {
        let mut command_line = parsed.program.clone();
        for arg in &parsed.args {
            command_line.push(' ');
            command_line.push_str(arg);
        }
        command_line
    });
    let selected_root = match workspace.root_canonical_path(window_label, root_id) {
        Ok(root) => root,
        Err(error) => {
            return ReverseRequestOutcome {
                success: false,
                body: None,
                message: Some(error.message().to_owned()),
                notify: None,
            };
        }
    };
    let resolved_cwd = match parsed.cwd.as_deref() {
        None | Some("") => selected_root,
        Some(cwd) if Path::new(cwd).is_absolute() => Path::new(cwd).to_path_buf(),
        Some(cwd) => selected_root.join(cwd),
    };
    let Ok(resolved_cwd) = resolved_cwd.into_os_string().into_string() else {
        return ReverseRequestOutcome {
            success: false,
            body: None,
            message: Some(debug_run_in_terminal_arguments_invalid().to_owned()),
            notify: None,
        };
    };
    let result = tauri::async_runtime::block_on(terminal.start_program(
        trust,
        workspace,
        window_label,
        resolved_cwd,
        parsed.program,
        parsed.args,
        parsed.env,
        RUN_IN_TERMINAL_DEFAULT_COLS,
        RUN_IN_TERMINAL_DEFAULT_ROWS,
        sink,
    ));
    match result {
        Ok((terminal_session_id, process_id)) => {
            let notify_body = serde_json::json!({
                "terminalSessionId": terminal_session_id.as_wire(),
                "title": title,
                "processId": process_id,
            });
            let mut response_body = serde_json::Map::new();
            if let Some(process_id) = process_id {
                response_body.insert("processId".to_owned(), Value::from(process_id));
            }
            ReverseRequestOutcome {
                success: true,
                body: Some(Value::Object(response_body)),
                message: None,
                notify: Some(("plain/runInTerminal".to_owned(), notify_body)),
            }
        }
        Err(error) => ReverseRequestOutcome {
            success: false,
            body: None,
            message: Some(error.message().to_owned()),
            notify: None,
        },
    }
}

/// Production [`ReverseRequestHandler`] for `runInTerminal` — built once per
/// [`debug_launch`]/[`debug_attach`] call (the only place with access to a
/// live `WebviewWindow`/`AppHandle`) and shared by that session's reader
/// thread for its whole lifetime, mirroring [`DebugWindowEventSink`]'s
/// identical construction-time shape. Fetches
/// `TerminalService`/`TrustService`/`WorkspaceService` fresh from
/// `self.app.state::<T>()` on every call (rather than capturing them once at
/// construction time) — the same on-demand pattern `lib.rs`'s own
/// `window.state::<T>()` window-close-cleanup callbacks already use — since
/// none of those three services derive `Clone`, and this handler must
/// outlive any single Tauri command invocation's own `State<'_, T>` borrow
/// (a reverse request can arrive at any point in a session that may run for
/// minutes or hours).
struct RunInTerminalReverseRequestHandler {
    app: AppHandle,
    window_label: String,
    root_id: RootId,
}

impl ReverseRequestHandler for RunInTerminalReverseRequestHandler {
    fn handle(
        &self,
        _session_id: DebugSessionId,
        command: &str,
        arguments: Option<&Value>,
    ) -> Option<ReverseRequestOutcome> {
        if command != "runInTerminal" {
            return None;
        }
        let terminal = self.app.state::<TerminalService>();
        let trust = self.app.state::<TrustService>();
        let workspace = self.app.state::<WorkspaceService>();
        let sink: Arc<dyn TerminalOutputSink> =
            Arc::new(crate::terminal::commands::WindowEmitSink::new(
                self.app.clone(),
                self.window_label.clone(),
            ));
        Some(handle_run_in_terminal_reverse_request(
            terminal.inner(),
            trust.inner(),
            workspace.inner(),
            &self.window_label,
            self.root_id,
            arguments,
            sink,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::DebugAdapterConfirmationState;

    #[test]
    fn confirmation_state_response_is_camel_case() {
        let value = serde_json::to_value(DebugAdapterConfirmationState::new(true)).unwrap();
        assert_eq!(value, serde_json::json!({ "confirmed": true }));
    }
}
