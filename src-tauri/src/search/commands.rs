use std::sync::Arc;

use tauri::{Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;

use super::dto::{
    SearchId, WorkspaceSearchExpandReplacementsRequest, WorkspaceSearchExpandReplacementsResult,
    WorkspaceSearchFilesRequest, WorkspaceSearchFilesResult, WorkspaceSearchTextCancelRequest,
    WorkspaceSearchTextPollRequest, WorkspaceSearchTextPollResult, WorkspaceSearchTextStartRequest,
    WorkspaceSearchTextStartResult, WorkspaceSearchTextWakeEvent,
};
use super::replace;

/// Window-targeted wake hint for the streaming text search protocol (F040
/// S3). Mirrors `workspace::commands::WORKSPACE_WATCH_WAKE_EVENT`'s own
/// precedent exactly: a fire-and-forget `emit_to` the frontend must not
/// treat as authoritative (the search's real state is whatever the next
/// `workspace_search_text_poll` call returns) or rely on ever arriving at
/// all — see `app/platform/tauri/text-search-stream.ts`'s lost-wake
/// fallback-poll timer, the frontend-side analogue of
/// `workspace-watcher.ts`'s existing lost-wake handling.
pub(crate) const WORKSPACE_SEARCH_TEXT_WAKE_EVENT: &str = "plain://workspace-search-text-wake";

#[tauri::command]
pub(crate) async fn workspace_search_files(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceSearchFilesRequest,
) -> Result<WorkspaceSearchFilesResult, CommandError> {
    let query = request.into_parts()?;
    WorkspaceService::search_files(service.inner(), window.label(), query).await
}

#[tauri::command]
pub(crate) async fn workspace_search_text_start(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceSearchTextStartRequest,
) -> Result<WorkspaceSearchTextStartResult, CommandError> {
    let query = request.into_parts()?;
    let app = window.app_handle().clone();
    let window_label = window.label().to_owned();
    let wake_sink: Arc<dyn Fn(SearchId) + Send + Sync> = Arc::new(move |search_id: SearchId| {
        let _ = app.emit_to(
            EventTarget::webview_window(window_label.clone()),
            WORKSPACE_SEARCH_TEXT_WAKE_EVENT,
            WorkspaceSearchTextWakeEvent::new(search_id),
        );
    });
    service
        .inner()
        .search_text_start(window.label(), query, wake_sink)
}

#[tauri::command]
pub(crate) async fn workspace_search_text_poll(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceSearchTextPollRequest,
) -> Result<WorkspaceSearchTextPollResult, CommandError> {
    let (search_id, cursor) = request.into_parts()?;
    service
        .inner()
        .search_text_poll(window.label(), search_id, cursor)
}

#[tauri::command]
pub(crate) async fn workspace_search_text_cancel(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceSearchTextCancelRequest,
) -> Result<(), CommandError> {
    service
        .inner()
        .search_text_cancel(window.label(), request.search_id())
}

/// F200 S2: bounded, pure computation — no `WorkspaceService`, no window, no
/// `rootId`. See `search::replace`'s module doc for the anchored-re-match/
/// fail-closed-capture-group design this routes to.
#[tauri::command]
pub(crate) async fn workspace_search_expand_replacements(
    request: WorkspaceSearchExpandReplacementsRequest,
) -> Result<WorkspaceSearchExpandReplacementsResult, CommandError> {
    let query = request.into_parts()?;
    replace::expand_replacements(query)
}
