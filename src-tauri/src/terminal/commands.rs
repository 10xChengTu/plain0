use std::sync::Arc;

use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::dto::{
    TerminalAckRequest, TerminalDataEvent, TerminalExitEvent, TerminalFocusRequest,
    TerminalInputKeyRequest, TerminalInputTextRequest, TerminalKillRequest, TerminalResizeRequest,
    TerminalScrollbackRequest, TerminalScrollbackResult, TerminalSessionId, TerminalStartRequest,
    TerminalStartResult,
};
use super::service::{TerminalExitStatus, TerminalOutputSink, TerminalService};
use super::vt;

/// Window-targeted terminal output events. Mirrors
/// `search::commands::WORKSPACE_SEARCH_TEXT_WAKE_EVENT`'s exact `emit_to`
/// precedent, except these two events carry the actual frame/exit payload
/// rather than a bare wake hint the frontend must separately poll to
/// resolve: every `plain://terminal-data` delivery is itself the
/// authoritative next frame of a session's render state (ordered by
/// `TerminalDataEvent`'s `sequence`, not re-fetchable), and
/// `plain://terminal-exit` is the session's one-shot terminal notification.
pub(crate) const TERMINAL_DATA_EVENT: &str = "plain://terminal-data";
pub(crate) const TERMINAL_EXIT_EVENT: &str = "plain://terminal-exit";

/// Real production [`TerminalOutputSink`]: emits every frame/exit straight
/// to the session's own window. Built once per [`terminal_start`] call (the
/// only place with access to a live `WebviewWindow`/`AppHandle`) and shared
/// by that session's vt/waiter threads for its whole lifetime — see
/// `service.rs`'s module doc for why those two threads each independently
/// call `emit_frame`/`emit_exit`, and for the documented exit-vs-last-frame
/// ordering caveat that follows from that independence (this sink does not
/// attempt to fix it; `terminal-stream.ts` is where the mitigation lives).
///
/// `pub(crate)` (unlike every other item in this file) since `F100` S4's
/// `debug::commands::RunInTerminalReverseRequestHandler` is a second,
/// legitimate production caller — a `runInTerminal`-launched terminal session
/// must emit under the *exact same* `TERMINAL_DATA_EVENT`/`TERMINAL_EXIT_EVENT`
/// names an ordinary `Plain: Create Terminal` session does, so the frontend's
/// existing `terminalWatchData`/`terminalWatchExit` listeners pick it up with
/// no special-casing at all — reusing this struct (rather than a second,
/// parallel implementation of the identical `emit_to` logic) is what
/// guarantees that.
pub(crate) struct WindowEmitSink {
    app: AppHandle,
    window_label: String,
}

impl WindowEmitSink {
    pub(crate) fn new(app: AppHandle, window_label: String) -> Self {
        Self { app, window_label }
    }
}

impl TerminalOutputSink for WindowEmitSink {
    fn emit_frame(&self, session_id: TerminalSessionId, sequence: u64, frame: vt::DirtyFrame) {
        let _ = self.app.emit_to(
            EventTarget::webview_window(self.window_label.clone()),
            TERMINAL_DATA_EVENT,
            TerminalDataEvent::new(session_id, sequence, frame),
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
            query.root_id,
            query.cwd,
            query.cols,
            query.rows,
            sink,
        )
        .await?;
    Ok(TerminalStartResult::new(session_id))
}

#[tauri::command]
pub(crate) async fn terminal_input_text(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    request: TerminalInputTextRequest,
) -> Result<(), CommandError> {
    let (session_id, text) = request.into_parts()?;
    terminal
        .inner()
        .input_text(window.label(), session_id, text)
        .await
}

#[tauri::command]
pub(crate) async fn terminal_input_key(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    request: TerminalInputKeyRequest,
) -> Result<(), CommandError> {
    let (session_id, input) = request.into_parts()?;
    terminal
        .inner()
        .input_key(window.label(), session_id, input)
        .await
}

#[tauri::command]
pub(crate) async fn terminal_focus(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    request: TerminalFocusRequest,
) -> Result<(), CommandError> {
    let (session_id, focused) = request.into_parts();
    terminal
        .inner()
        .focus(window.label(), session_id, focused)
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
    let (session_id, sequence) = request.into_parts();
    terminal.inner().ack(window.label(), session_id, sequence)
}

#[tauri::command]
pub(crate) async fn terminal_scrollback(
    window: WebviewWindow,
    terminal: State<'_, TerminalService>,
    request: TerminalScrollbackRequest,
) -> Result<TerminalScrollbackResult, CommandError> {
    let (session_id, start, count) = request.into_parts()?;
    let rows = terminal
        .inner()
        .scrollback(window.label(), session_id, start, count)
        .await?;
    Ok(TerminalScrollbackResult::new(rows))
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
