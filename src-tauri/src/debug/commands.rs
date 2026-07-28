//! `F100` S1 added the first-run confirmation gate's own query/grant/revoke
//! surface (`debug_adapter_confirmation_state`/`_grant`/`_revoke`). `F100` S2
//! adds exactly three more — `debug_launch`/`debug_attach`/`debug_disconnect`
//! — the real session-lifecycle surface. Read this comment before adding a
//! seventh.
//!
//! # Why `debug_launch`/`debug_attach`/`debug_disconnect`, and only these three, are new
//!
//! These are the minimal commands that actually start/stop a live session
//! ([`super::service::DebugSessionService::start_session`]/`disconnect`) —
//! `debug_launch`/`debug_attach` differ only in which literal DAP request
//! they send (`"launch"` vs `"attach"`; see
//! [`super::session::LaunchRequestKind`]), sharing the identical wire shape
//! ([`super::dto::DebugSessionStartRequest`]) and query-building logic. Per
//! `super::session`'s own module doc, driving the *interactive* debugging
//! surface (`debug_set_breakpoints`/`debug_stack_trace`/`debug_scopes`/
//! `debug_variables`/`debug_evaluate`/`debug_continue`/`debug_next`/
//! `debug_step_in`/`debug_step_out`/`debug_pause`) remains out of scope —
//! that is `F100` S3/S4's job, per the frozen research doc's own slice
//! breakdown, once there is a UI to drive them from
//! (`docs/research/2026-07-28-generic-dap.md`'s "S2...可以先用一个 DEV-only
//! 诊断钩子验证全链路,不急着接 UI"). The one exception to "no generic escape
//! hatch" here is the same one ADR 0003 already names: `arguments` on
//! `debug_launch`/`debug_attach` is an opaque JSON payload, forwarded
//! transparently into the DAP `launch`/`attach` request — that field is
//! DAP's own already-open protocol surface, not a new escape hatch this
//! domain invents. `initialBreakpoints` is similarly minimal wire plumbing
//! for the handshake's "配置断点系列" step (see
//! [`super::dto::SourceBreakpointsRequest`]'s own doc comment) — not the
//! breakpoint feature/UI itself.
//!
//! # No `app/` UI consumes these commands yet
//!
//! Exactly like [`super::exec::spawn_adapter`]/[`super::tcp::connect_adapter`]
//! themselves had zero production callers across S0 *and* S1, these three
//! commands have zero frontend callers as of S2 — this slice's own report
//! discloses this explicitly as a deliberate, frozen-doc-sanctioned
//! narrowing, not an oversight. They are registered in `lib.rs`'s
//! `generate_handler!` and exercised by this domain's own Rust tests
//! (`super::service::tests`), proving the whole IPC-reachable path
//! type-checks and works end to end, exactly as S0's `commands.rs` did for
//! `spawn_adapter` before S1 gave it its first real caller.
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
    AdapterConfirmationSubject, DebugEventPayload, DebugSessionId, DebugSessionIdRequest,
    DebugSessionStartRequest, DebugSessionStartResult,
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

#[cfg(test)]
mod tests {
    use super::DebugAdapterConfirmationState;

    #[test]
    fn confirmation_state_response_is_camel_case() {
        let value = serde_json::to_value(DebugAdapterConfirmationState::new(true)).unwrap();
        assert_eq!(value, serde_json::json!({ "confirmed": true }));
    }
}
