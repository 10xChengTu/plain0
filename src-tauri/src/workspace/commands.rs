use std::sync::Arc;

use tauri::{Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    WorkspaceCapabilities, WorkspaceCapabilitiesRequest, WorkspaceClearRecentRequest,
    WorkspaceCloseFolderRequest, WorkspaceCommitDeleteEntryRequest,
    WorkspaceCommitTrashEntryRequest, WorkspaceCopyRequest, WorkspaceDeleteBatchPlan,
    WorkspaceDeleteBatchRequest, WorkspaceDeleteResult, WorkspaceEntryRequest, WorkspaceEntryStat,
    WorkspaceMoveRequest, WorkspaceMoveResult, WorkspaceOpenFilesRequest, WorkspaceOpenFilesResult,
    WorkspaceOpenRecentRequest, WorkspacePickRootsRequest, WorkspacePickRootsResult,
    WorkspacePickRootsStatus, WorkspacePickSaveTargetRequest, WorkspacePickSaveTargetResult,
    WorkspacePrepareDeleteRequest, WorkspacePrepareTrashRequest, WorkspaceReadDirectoryResult,
    WorkspaceRecentListRequest, WorkspaceRecentListResult, WorkspaceRemoveRecentRequest,
    WorkspaceRemoveRootRequest, WorkspaceRenameRequest, WorkspaceSnapshot,
    WorkspaceSnapshotRequest, WorkspaceTrashBatchPlan, WorkspaceTrashBatchRequest,
    WorkspaceTrashResult, WorkspaceWatchSyncRequest, WorkspaceWatchSyncResult,
    WorkspaceWatchWakeEvent, WorkspaceWriteResult,
};
use super::picker::{TauriDirectoryPicker, TauriFilePicker};
use super::service::WorkspaceService;
use crate::recent::service::{WorkspaceHistoryRoot, WorkspaceHistoryService};

pub(crate) const WORKSPACE_WATCH_WAKE_EVENT: &str = "plain://workspace-watch-wake";

fn workspace_watch_wake_sink(
    window: &WebviewWindow,
) -> Arc<dyn Fn(super::WorkspaceId) + Send + Sync> {
    let app = window.app_handle().clone();
    let window_label = window.label().to_owned();
    Arc::new(move |workspace_id| {
        let _ = app.emit_to(
            EventTarget::webview_window(window_label.clone()),
            WORKSPACE_WATCH_WAKE_EVENT,
            WorkspaceWatchWakeEvent::new(workspace_id),
        );
    })
}

async fn record_current_workspace(
    window_label: &str,
    service: &WorkspaceService,
    history: &WorkspaceHistoryService,
) -> Result<(), CommandError> {
    let roots = service
        .history_roots(window_label)?
        .into_iter()
        .map(|(canonical_path, display_name)| WorkspaceHistoryRoot {
            canonical_path,
            display_name,
        })
        .collect::<Vec<_>>();
    let history = history.clone();
    tauri::async_runtime::spawn_blocking(move || history.record(&roots))
        .await
        .map_err(|_| workspace_history_unavailable())?
}

fn workspace_history_unavailable() -> CommandError {
    CommandError::new(
        "WORKSPACE_HISTORY_UNAVAILABLE",
        "Recent workspaces are unavailable.",
    )
}

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
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceSnapshotRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    request.validate();
    let last_roots = if crate::window::should_restore_last_workspace(window.label()) {
        let history = history.inner().clone();
        tauri::async_runtime::spawn_blocking(move || history.last_roots())
            .await
            .map_err(|_| workspace_history_unavailable())?
    } else {
        Ok(None)
    };
    service
        .initial_snapshot_with_restore(
            window.label(),
            last_roots,
            workspace_watch_wake_sink(&window),
        )
        .await
}

#[tauri::command]
pub(crate) async fn workspace_pick_roots(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspacePickRootsRequest,
) -> Result<WorkspacePickRootsResult, CommandError> {
    let picker = TauriDirectoryPicker::new(window.clone());
    let result = service
        .pick_roots_with_watch_sink(
            window.label(),
            picker,
            request.mode(),
            workspace_watch_wake_sink(&window),
        )
        .await?;
    if result.status() == WorkspacePickRootsStatus::Selected {
        record_current_workspace(window.label(), service.inner(), history.inner()).await?;
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn workspace_open_files(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceOpenFilesRequest,
) -> Result<WorkspaceOpenFilesResult, CommandError> {
    request.validate();
    let result = service
        .pick_files_with_watch_sink(
            window.label(),
            TauriFilePicker::new(window.clone()),
            workspace_watch_wake_sink(&window),
        )
        .await?;
    if result.status() == WorkspacePickRootsStatus::Selected {
        record_current_workspace(window.label(), service.inner(), history.inner()).await?;
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn workspace_pick_save_target(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspacePickSaveTargetRequest,
) -> Result<WorkspacePickSaveTargetResult, CommandError> {
    let result = service
        .pick_save_target_with_watch_sink(
            window.label(),
            TauriFilePicker::new(window.clone()),
            request.into_suggested_name()?,
            workspace_watch_wake_sink(&window),
        )
        .await?;
    if result.status() == WorkspacePickRootsStatus::Selected {
        record_current_workspace(window.label(), service.inner(), history.inner()).await?;
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn workspace_recent_list(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceRecentListRequest,
) -> Result<WorkspaceRecentListResult, CommandError> {
    request.validate();
    let history = history.inner().clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || history.snapshot())
        .await
        .map_err(|_| workspace_history_unavailable())??;
    Ok(WorkspaceRecentListResult::new(
        snapshot.revision,
        service.restore_status(window.label())?,
        snapshot.entries,
    ))
}

#[tauri::command]
pub(crate) async fn workspace_open_recent(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceOpenRecentRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    let recent_id = request.recent_id();
    let history_clone = history.inner().clone();
    let roots = tauri::async_runtime::spawn_blocking(move || history_clone.roots_for(recent_id))
        .await
        .map_err(|_| workspace_history_unavailable())??;
    let snapshot = service
        .replace_roots_with_watch_sink(window.label(), roots, workspace_watch_wake_sink(&window))
        .await?;
    record_current_workspace(window.label(), service.inner(), history.inner()).await?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn workspace_remove_recent(
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceRemoveRecentRequest,
) -> Result<(), CommandError> {
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || history.remove(request.recent_id()))
        .await
        .map_err(|_| workspace_history_unavailable())?
}

#[tauri::command]
pub(crate) async fn workspace_clear_recent(
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceClearRecentRequest,
) -> Result<(), CommandError> {
    request.validate();
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || history.clear())
        .await
        .map_err(|_| workspace_history_unavailable())?
}

#[tauri::command]
pub(crate) async fn workspace_watch_sync(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceWatchSyncRequest,
) -> Result<WorkspaceWatchSyncResult, CommandError> {
    service
        .watch_sync(window.label(), request.into_parts()?)
        .await
}

#[tauri::command]
pub(crate) async fn workspace_remove_root(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceRemoveRootRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    let snapshot = service.remove_root(window.label(), request.root_id())?;
    record_current_workspace(window.label(), service.inner(), history.inner()).await?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn workspace_close_folder(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceCloseFolderRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    request.validate();
    let (snapshot, changed) = service.close_folder(window.label())?;
    if changed {
        record_current_workspace(window.label(), service.inner(), history.inner()).await?;
    }
    Ok(snapshot)
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
pub(crate) async fn workspace_publish_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: tauri::ipc::Request<'_>,
) -> Result<WorkspaceWriteResult, CommandError> {
    let frame = super::publish_frame::WorkspacePublishFileFrame::parse_invoke_body(request.body())?;
    let (root_id, relative_path, content) = frame.into_parts();
    service
        .publish_file(window.label(), root_id, relative_path, content)
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

#[tauri::command]
pub(crate) async fn workspace_prepare_trash(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspacePrepareTrashRequest,
) -> Result<WorkspaceTrashBatchPlan, CommandError> {
    service
        .prepare_trash(window.label(), request.into_parts()?)
        .await
}

#[tauri::command]
pub(crate) async fn workspace_cancel_trash(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceTrashBatchRequest,
) -> Result<(), CommandError> {
    service
        .cancel_trash(window.label(), request.confirmation_id())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_begin_trash(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceTrashBatchRequest,
) -> Result<(), CommandError> {
    service
        .begin_trash(window.label(), request.confirmation_id())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_commit_trash_entry(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceCommitTrashEntryRequest,
) -> Result<WorkspaceTrashResult, CommandError> {
    let (confirmation_id, entry_id, root_id, relative_path) = request.into_parts()?;
    service
        .commit_trash_entry(
            window.label(),
            confirmation_id,
            entry_id,
            root_id,
            relative_path,
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
