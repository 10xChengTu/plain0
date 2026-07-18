use tauri::{State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    WorkspacePickRootsRequest, WorkspacePickRootsResult, WorkspaceRemoveRootRequest,
    WorkspaceSnapshot, WorkspaceSnapshotRequest,
};
use super::picker::TauriDirectoryPicker;
use super::service::WorkspaceService;

#[tauri::command]
pub(crate) async fn workspace_snapshot(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceSnapshotRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    request.validate();
    service.snapshot(window.label())
}

#[tauri::command]
pub(crate) async fn workspace_pick_roots(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspacePickRootsRequest,
) -> Result<WorkspacePickRootsResult, CommandError> {
    let picker = TauriDirectoryPicker::new(window.clone());
    service
        .pick_roots(window.label(), picker, request.mode())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_remove_root(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceRemoveRootRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    service.remove_root(window.label(), request.root_id())
}
