use std::sync::Arc;

use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::dto::{
    TerminalAckRequest, TerminalDataEvent, TerminalExitEvent, TerminalInputRequest,
    TerminalKillRequest, TerminalResizeRequest, TerminalSessionId, TerminalStartRequest,
    TerminalStartResult,
};
use super::service::{TerminalChunk, TerminalExitStatus, TerminalOutputSink, TerminalService};

/// Window-targeted terminal output events (F070 S2). Mirrors
/// `search::commands::WORKSPACE_SEARCH_TEXT_WAKE_EVENT`'s exact `emit_to`
/// precedent, except these two events carry the actual output/exit payload
/// rather than a bare wake hint the frontend must separately poll to
/// resolve: every `plain://terminal-data` delivery is itself the
/// authoritative next chunk of a session's output (ordered by
/// `TerminalDataEvent`'s `sequence`, not re-fetchable), and
/// `plain://terminal-exit` is the session's one-shot terminal notification.
pub(crate) const TERMINAL_DATA_EVENT: &str = "plain://terminal-data";
pub(crate) const TERMINAL_EXIT_EVENT: &str = "plain://terminal-exit";

/// Real production [`TerminalOutputSink`]: emits every chunk/exit straight
/// to the session's own window. Built once per [`terminal_start`] call (the
/// only place with access to a live `WebviewWindow`/`AppHandle`) and shared
/// by that session's reader-delivery and waiter threads for its whole
/// lifetime — see `service.rs`'s module doc for why those two threads each
/// independently call `emit_chunk`/`emit_exit`, and for the documented
/// exit-vs-last-chunk ordering caveat that follows from that independence
/// (this sink does not attempt to fix it; `terminal-stream.ts` is where the
/// mitigation lives).
struct WindowEmitSink {
    app: AppHandle,
    window_label: String,
}

impl TerminalOutputSink for WindowEmitSink {
    fn emit_chunk(&self, session_id: TerminalSessionId, chunk: TerminalChunk) {
        let _ = self.app.emit_to(
            EventTarget::webview_window(self.window_label.clone()),
            TERMINAL_DATA_EVENT,
            TerminalDataEvent::new(session_id, chunk.sequence, &chunk.bytes),
        );
    }

    fn emit_exit(&self, session_id: TerminalSessionId, status: TerminalExitStatus) {
        let _ = self.app.emit_to(
            EventTarget::webview_window(self.window_label.clone()),
            TERMINAL_EXIT_EVENT,
            TerminalExitEvent::new(session_id, status.exit_code),
        );
    }
}

#[tauri::command]
pub(crate) async fn terminal_start(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: TerminalStartRequest,
) -> Result<TerminalStartResult, CommandError> {
    let query = request.into_parts()?;
    let sink: Arc<dyn TerminalOutputSink> = Arc::new(WindowEmitSink {
        app: window.app_handle().clone(),
        window_label: window.label().to_owned(),
    });
    let session_id = terminal
        .inner()
        .start(
            trust.inner(),
            workspace.inner(),
            window.label(),
            query.cwd,
            query.cols,
            query.rows,
            sink,
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
