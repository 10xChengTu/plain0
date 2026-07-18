use tauri::{State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    WorkspaceCopyRequest, WorkspaceEntryRequest, WorkspaceEntryStat, WorkspaceMoveRequest,
    WorkspaceMoveResult, WorkspacePickRootsRequest, WorkspacePickRootsResult,
    WorkspaceReadDirectoryResult, WorkspaceRemoveRootRequest, WorkspaceRenameRequest,
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

#[tauri::command]
pub(crate) async fn workspace_create_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceEntryRequest,
) -> Result<(), CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    service
        .create_file(window.label(), root_id, relative_path)
        .await
}

#[tauri::command]
pub(crate) async fn workspace_create_directory(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceEntryRequest,
) -> Result<(), CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    service
        .create_directory(window.label(), root_id, relative_path)
        .await
}

#[tauri::command]
pub(crate) async fn workspace_rename(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceRenameRequest,
) -> Result<(), CommandError> {
    let (root_id, source_path, target_path) = request.into_parts()?;
    WorkspaceService::rename(
        service.inner(),
        window.label(),
        root_id,
        source_path,
        target_path,
    )
    .await
}

#[tauri::command]
pub(crate) async fn workspace_copy(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceCopyRequest,
) -> Result<(), CommandError> {
    let (source_root_id, source_path, target_root_id, target_path) = request.into_parts()?;
    WorkspaceService::copy_entry(
        service.inner(),
        window.label(),
        source_root_id,
        source_path,
        target_root_id,
        target_path,
    )
    .await
}

#[tauri::command]
pub(crate) async fn workspace_move(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceMoveRequest,
) -> Result<WorkspaceMoveResult, CommandError> {
    let (source_root_id, source_path, target_root_id, target_path) = request.into_parts()?;
    WorkspaceService::move_entry(
        service.inner(),
        window.label(),
        source_root_id,
        source_path,
        target_root_id,
        target_path,
    )
    .await
}

fn raw_bytes_response(bytes: Vec<u8>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(bytes)
}

#[cfg(test)]
mod tests {
    use tauri::ipc::{InvokeResponse, InvokeResponseBody, IpcResponse};

    use super::raw_bytes_response;
    use crate::error::CommandError;

    #[test]
    fn file_response_uses_raw_ipc_bytes_instead_of_json_numbers() {
        let bytes = vec![0, 255, 128, 1, 0, 42];
        match raw_bytes_response(bytes.clone()).body().unwrap() {
            InvokeResponseBody::Raw(body) => assert_eq!(body, bytes),
            InvokeResponseBody::Json(_) => panic!("file bytes must not be JSON serialized"),
        }
    }

    #[test]
    fn successful_empty_command_results_serialize_as_json_null() {
        let response: InvokeResponse = Result::<(), CommandError>::Ok(()).into();
        match response {
            InvokeResponse::Ok(InvokeResponseBody::Json(body)) => assert_eq!(body, "null"),
            InvokeResponse::Ok(InvokeResponseBody::Raw(_)) => {
                panic!("empty command success must use JSON null")
            }
            InvokeResponse::Err(_) => panic!("empty command success must not reject the invoke"),
        }
    }
}
