use tauri::{State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    WorkspaceEntryRequest, WorkspaceEntryStat, WorkspacePickRootsRequest, WorkspacePickRootsResult,
    WorkspaceReadDirectoryResult, WorkspaceRemoveRootRequest, WorkspaceSnapshot,
    WorkspaceSnapshotRequest,
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

#[tauri::command]
pub(crate) async fn workspace_stat(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceEntryRequest,
) -> Result<WorkspaceEntryStat, CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    service.stat(window.label(), root_id, relative_path).await
}

#[tauri::command]
pub(crate) async fn workspace_read_dir(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceEntryRequest,
) -> Result<WorkspaceReadDirectoryResult, CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    service
        .read_directory(window.label(), root_id, relative_path)
        .await
}

#[tauri::command]
pub(crate) async fn workspace_read_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceEntryRequest,
) -> Result<tauri::ipc::Response, CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    let bytes = service
        .read_file(window.label(), root_id, relative_path)
        .await?;
    Ok(raw_bytes_response(bytes))
}

fn raw_bytes_response(bytes: Vec<u8>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(bytes)
}

#[cfg(test)]
mod tests {
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    use super::raw_bytes_response;

    #[test]
    fn file_response_uses_raw_ipc_bytes_instead_of_json_numbers() {
        let bytes = vec![0, 255, 128, 1, 0, 42];
        match raw_bytes_response(bytes.clone()).body().unwrap() {
            InvokeResponseBody::Raw(body) => assert_eq!(body, bytes),
            InvokeResponseBody::Json(_) => panic!("file bytes must not be JSON serialized"),
        }
    }
}
