use tauri::{State, WebviewWindow};

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;

use super::dto::{WorkspaceSearchFilesRequest, WorkspaceSearchFilesResult};

#[tauri::command]
pub(crate) async fn workspace_search_files(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceSearchFilesRequest,
) -> Result<WorkspaceSearchFilesResult, CommandError> {
    let query = request.into_parts()?;
    WorkspaceService::search_files(service.inner(), window.label(), query).await
}
