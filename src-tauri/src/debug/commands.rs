//! `F100` S1 added the first-run confirmation gate's own query/grant/revoke
//! surface (`debug_adapter_confirmation_state`/`_grant`/`_revoke`). `F100` S2
//! added exactly three more — `debug_launch`/`debug_attach`/
//! `debug_disconnect` — the real session-lifecycle surface. `F100` S3 (this
//! slice) adds the *interactive* debugging surface: `debug_set_breakpoints`/
//! `debug_stack_trace`/`debug_scopes`/`debug_variables`/`debug_evaluate`.
//! Read this comment before adding a twelfth.
//!
//! # `F100` S3's five new commands
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
//! S3 only ever sends `context: "watch"` from the Watch view; `F100` S4's
//! Debug Console is expected to be the first `"repl"` caller. Still out of
//! scope, per the frozen research doc's own slice breakdown: `debug_continue`/
//! `debug_next`/`debug_step_in`/`debug_step_out`/`debug_pause` (`F100` S4).
//!
//! # Why `debug_launch`/`debug_attach`/`debug_disconnect` finally have a real caller
//!
//! S2 disclosed these three as having zero frontend callers. `F100` S3 is the
//! first slice to add `app/` UI at all, so it is also the first to give these
//! three a real production caller (`app/features/debug/plain-debug-session.ts`)
//! — see this slice's own final report for the exact orchestration.
//!
//! # Adapter-config parsing stays entirely in the frontend
//!
//! Per the frozen research doc's "决策 1" ("读取这两份配置完全复用既有的
//! `workspace_read_file` 能力,不新增任何 Rust 端文件读取代码"), parsing
//! `.plain/debug-adapters.json`/`.vscode/launch.json`'s inline `plainAdapter`
//! block happens in `app/features/debug/plain-debug-adapter-config.ts`, not
//! here — this file has no config-reading surface at all.

use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::confirm::ConfirmationService;
use super::dto::{
    self, AdapterConfirmationSubject, DebugEvaluateRequest, DebugEvaluateResult, DebugEventPayload,
    DebugScopesRequest, DebugScopesResult, DebugSessionId, DebugSessionIdRequest,
    DebugSessionStartRequest, DebugSessionStartResult, DebugSetBreakpointsRequest,
    DebugSetBreakpointsResult, DebugStackTraceRequest, DebugStackTraceResult,
    DebugVariablesRequest, DebugVariablesResult,
};
use super::service::DebugSessionService;
use super::session::{DebugEventSink, LaunchRequestKind, SessionEndReason};

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
    let (session_id, capabilities) = debug_sessions
        .inner()
        .start_session(
            trust.inner(),
            workspace.inner(),
            window.label(),
            confirmation.inner(),
            query.request,
            query.transport,
            query.adapter_id,
            query.arguments,
            query.breakpoints,
            sink,
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
    request: DebugSetBreakpointsRequest,
) -> Result<DebugSetBreakpointsResult, CommandError> {
    let query = request.into_parts()?;
    let body = debug_sessions
        .inner()
        .send_request(
            window.label(),
            query.session_id,
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

#[cfg(test)]
mod tests {
    use super::DebugAdapterConfirmationState;

    #[test]
    fn confirmation_state_response_is_camel_case() {
        let value = serde_json::to_value(DebugAdapterConfirmationState::new(true)).unwrap();
        assert_eq!(value, serde_json::json!({ "confirmed": true }));
    }
}
