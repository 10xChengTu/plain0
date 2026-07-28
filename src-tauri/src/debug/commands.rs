//! `F100` S1 adds exactly three real `#[tauri::command]`s here — the
//! first-run confirmation gate's own query/grant/revoke surface — and no
//! more. Read this comment before adding a fourth.
//!
//! # Why these three, and only these three, are safe to expose now
//!
//! None of `debug_adapter_confirmation_state`/`_grant`/`_revoke` ever spawns
//! a process or opens a network connection — they only read, write or delete
//! a persisted *decision* about whether a `(command, args, transport)` triple
//! may be spawned/connected to later (see [`super::confirm::ConfirmationService`]).
//! Exposing a real `debug_launch`/`debug_attach`-style command — one that
//! actually calls [`super::exec::spawn_adapter`]/[`super::tcp::connect_adapter`]
//! — remains out of scope for this slice: that needs S2's real session
//! lifecycle (handshake orchestration, request/response correlation,
//! `plain://debug-event` delivery), so it stays deferred rather than being
//! exposed half-built.
//!
//! # Adapter-config parsing stays entirely in the frontend
//!
//! Per the frozen research doc's "决策 1" ("读取这两份配置完全复用既有的
//! `workspace_read_file` 能力,不新增任何 Rust 端文件读取代码"), parsing
//! `.plain/debug-adapters.json`/`.vscode/launch.json`'s inline `plainAdapter`
//! block happens in `app/features/debug/plain-debug-adapter-config.ts`, not
//! here — this file has no config-reading surface at all.
//!
//! # What S2 is still expected to add here
//!
//! Per the frozen doc's "IPC 层面的高层设计" section, the commands S2 adds are
//! expected to be specific, strongly-typed operations —
//! `debug_launch`/`debug_attach`/`debug_set_breakpoints`/`debug_stack_trace`/
//! `debug_scopes`/`debug_variables`/`debug_evaluate`/`debug_continue`/
//! `debug_next`/`debug_step_in`/`debug_step_out`/`debug_pause`/
//! `debug_disconnect` — never a generic "send an arbitrary DAP request"
//! escape hatch, mirroring `git::commands`'s existing "no generic `git_run`"
//! discipline. The sole deliberate exception (also per the frozen doc) is the
//! `launch`/`attach` commands' own `arguments` field, which ADR 0003 requires
//! passing through transparently as an opaque JSON payload — that field is
//! DAP's own already-open protocol surface, not a new escape hatch this
//! domain invents.

use tauri::{State, WebviewWindow};

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;

use super::confirm::ConfirmationService;
use super::dto::AdapterConfirmationSubject;

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

#[cfg(test)]
mod tests {
    use super::DebugAdapterConfirmationState;

    #[test]
    fn confirmation_state_response_is_camel_case() {
        let value = serde_json::to_value(DebugAdapterConfirmationState::new(true)).unwrap();
        assert_eq!(value, serde_json::json!({ "confirmed": true }));
    }
}
