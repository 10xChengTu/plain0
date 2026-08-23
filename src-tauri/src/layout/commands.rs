use tauri::{State, Window};

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;

use super::dto::{LayoutReadRequest, LayoutStorageSnapshot, LayoutWriteRequest};
use super::service::LayoutService;

#[tauri::command]
pub(crate) async fn layout_read(
    window: Window,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, LayoutService>,
    _request: LayoutReadRequest,
) -> Result<LayoutStorageSnapshot, CommandError> {
    let identity = workspace.stable_identity(window.label())?;
    service.read(identity).await
}

#[tauri::command]
pub(crate) async fn layout_write(
    window: Window,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, LayoutService>,
    request: LayoutWriteRequest,
) -> Result<(), CommandError> {
    let identity = workspace.stable_identity(window.label())?;
    service.write(identity, request.into_entries()?).await
}
