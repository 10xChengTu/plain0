use std::time::Instant;

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::error::CommandError;

use super::close_failed;
use super::dto::{CompleteCloseRequest, RequestCloseRequest};
use super::service::{CloseCoordinator, CompletionAction};

#[tauri::command]
pub(crate) fn lifecycle_complete_close(
    app: AppHandle,
    window: WebviewWindow,
    lifecycle: State<'_, CloseCoordinator>,
    request: CompleteCloseRequest,
) -> Result<(), CommandError> {
    match lifecycle.complete(
        window.label(),
        request.request_id,
        request.outcome,
        Instant::now(),
    )? {
        CompletionAction::None => Ok(()),
        CompletionAction::CloseWindow => {
            if app.webview_windows().len() == 1 {
                lifecycle.allow_exit_after_last_window_close();
            }
            if window.close().is_err() {
                lifecycle.rollback_failed_window_close(window.label());
                return Err(close_failed());
            }
            Ok(())
        }
        CompletionAction::Exit(code) => {
            app.exit(code);
            Ok(())
        }
    }
}

#[tauri::command]
pub(crate) fn lifecycle_request_close(
    window: WebviewWindow,
    request: RequestCloseRequest,
) -> Result<(), CommandError> {
    request.validate();
    window.close().map_err(|_| close_failed())
}
