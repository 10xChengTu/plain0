use tauri::{State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    WorkspaceCapabilities, WorkspaceCapabilitiesRequest, WorkspaceCommitDeleteEntryRequest,
    WorkspaceCopyRequest, WorkspaceDeleteBatchPlan, WorkspaceDeleteBatchRequest,
    WorkspaceDeleteResult, WorkspaceEntryRequest, WorkspaceEntryStat, WorkspaceMoveRequest,
    WorkspaceMoveResult, WorkspacePickRootsRequest, WorkspacePickRootsResult,
    WorkspacePrepareDeleteRequest, WorkspaceReadDirectoryResult, WorkspaceRemoveRootRequest,
    WorkspaceRenameRequest, WorkspaceSnapshot, WorkspaceSnapshotRequest, WorkspaceWriteResult,
};
use super::picker::TauriDirectoryPicker;
use super::service::WorkspaceService;

#[tauri::command]
pub(crate) fn workspace_capabilities(
    _window: WebviewWindow,
    request: WorkspaceCapabilitiesRequest,
) -> WorkspaceCapabilities {
    request.validate();
    WorkspaceCapabilities::current_platform()
}

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
pub(crate) async fn workspace_write_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: tauri::ipc::Request<'_>,
) -> Result<WorkspaceWriteResult, CommandError> {
    let frame = super::write_frame::WorkspaceWriteFileFrame::parse_invoke_body(request.body())?;
    let (root_id, relative_path, expected_version, content) = frame.into_parts();
    service
        .write_file(
            window.label(),
            root_id,
            relative_path,
            expected_version,
            content,
        )
        .await
}

#[tauri::command]
pub(crate) async fn workspace_create_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceEntryRequest,
) -> Result<WorkspaceEntryStat, CommandError> {
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
) -> Result<WorkspaceEntryStat, CommandError> {
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

#[tauri::command]
pub(crate) async fn workspace_prepare_delete(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspacePrepareDeleteRequest,
) -> Result<WorkspaceDeleteBatchPlan, CommandError> {
    service
        .prepare_delete(window.label(), request.into_parts()?)
        .await
}

#[tauri::command]
pub(crate) async fn workspace_cancel_delete(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceDeleteBatchRequest,
) -> Result<(), CommandError> {
    service
        .cancel_delete(window.label(), request.confirmation_id())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_begin_delete(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceDeleteBatchRequest,
) -> Result<(), CommandError> {
    service
        .begin_delete(window.label(), request.confirmation_id())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_commit_delete_entry(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceCommitDeleteEntryRequest,
) -> Result<WorkspaceDeleteResult, CommandError> {
    let (confirmation_id, entry_id, root_id, relative_path, recursive) = request.into_parts()?;
    service
        .commit_delete_entry(
            window.label(),
            confirmation_id,
            entry_id,
            root_id,
            relative_path,
            recursive,
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
    use crate::workspace::dto::{WorkspaceCapabilities, WorkspaceCapabilitiesRequest};

    #[test]
    fn capabilities_are_an_exact_platform_closed_set() {
        let value = serde_json::to_value(WorkspaceCapabilities::current_platform())
            .expect("workspace capabilities serialize");
        let object = value
            .as_object()
            .expect("workspace capabilities are an object");
        let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "copyMove",
                "create",
                "delete",
                "renameNoReplace",
                "versionedWrite",
            ]
        );
        assert_eq!(value["create"], true);
        let namespace_mutations = cfg!(any(target_os = "linux", target_os = "macos"));
        for key in ["renameNoReplace", "copyMove", "delete", "versionedWrite"] {
            assert_eq!(value[key], namespace_mutations, "unexpected {key} value");
        }
    }

    #[test]
    fn capabilities_request_rejects_every_extra_field() {
        serde_json::from_value::<WorkspaceCapabilitiesRequest>(serde_json::json!({}))
            .expect("empty capability request is valid");
        assert!(
            serde_json::from_value::<WorkspaceCapabilitiesRequest>(serde_json::json!({
                "rootId": "00000000-0000-4000-8000-000000000001"
            }))
            .is_err()
        );
    }

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
