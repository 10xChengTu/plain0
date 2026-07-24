use tauri::{State, WebviewWindow};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::dto::{
    TerminalAckRequest, TerminalInputRequest, TerminalKillRequest, TerminalResizeRequest,
    TerminalStartRequest, TerminalStartResult,
};
use super::service::TerminalService;

/// This slice (F070 S1) freezes the five command signatures below so the
/// spawn-side domain logic (trust gate, cwd validation, session lifecycle,
/// backpressure) can be fully implemented and tested now; nothing in
/// `app/` calls any of them yet — no output/exit *events* are emitted
/// either (`F070` S2 wires the Tauri event bridge these commands' sessions
/// will actually stream through).
#[tauri::command]
pub(crate) async fn terminal_start(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: TerminalStartRequest,
) -> Result<TerminalStartResult, CommandError> {
    let query = request.into_parts()?;
    let session_id = terminal
        .inner()
        .start(
            trust.inner(),
            workspace.inner(),
            window.label(),
            query.cwd,
            query.cols,
            query.rows,
        )
        .await?;
    Ok(TerminalStartResult::new(session_id))
}

#[tauri::command]
pub(crate) async fn terminal_input(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    request: TerminalInputRequest,
) -> Result<(), CommandError> {
    let (session_id, data) = request.into_parts()?;
    terminal
        .inner()
        .input(window.label(), session_id, data)
        .await
}

#[tauri::command]
pub(crate) async fn terminal_resize(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    request: TerminalResizeRequest,
) -> Result<(), CommandError> {
    let (session_id, cols, rows) = request.into_parts()?;
    terminal
        .inner()
        .resize(window.label(), session_id, cols, rows)
        .await
}

#[tauri::command]
pub(crate) async fn terminal_ack(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    request: TerminalAckRequest,
) -> Result<(), CommandError> {
    let (session_id, byte_count) = request.into_parts();
    terminal.inner().ack(window.label(), session_id, byte_count)
}

#[tauri::command]
pub(crate) async fn terminal_kill(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    request: TerminalKillRequest,
) -> Result<(), CommandError> {
    let (session_id, immediate) = request.into_parts();
    terminal
        .inner()
        .kill(window.label(), session_id, immediate)
        .await
}
