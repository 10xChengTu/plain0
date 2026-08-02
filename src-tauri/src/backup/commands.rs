use tauri::{State, WebviewWindow};

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;

use super::dto::{BackupDiscardAllRequest, BackupDiscardRequest, BackupReadAllRequest};
use super::frame::{encode_read_all_frame, BackupWriteFrame};
use super::service::BackupService;

#[tauri::command]
pub(crate) async fn backup_write(
    window: WebviewWindow,
    backup: State<'_, BackupService>,
    workspace: State<'_, WorkspaceService>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), CommandError> {
    let frame = BackupWriteFrame::parse_invoke_body(request.body())?;
    let (root_id, key, content) = frame.into_parts();
    backup
        .write(workspace.inner(), window.label(), root_id, key, content)
        .await
}

#[tauri::command]
pub(crate) async fn backup_read_all(
    window: WebviewWindow,
    backup: State<'_, BackupService>,
    workspace: State<'_, WorkspaceService>,
    request: BackupReadAllRequest,
) -> Result<tauri::ipc::Response, CommandError> {
    request.validate();
    let entries = backup.read_all(workspace.inner(), window.label()).await?;
    let frame = encode_read_all_frame(&entries)?;
    Ok(tauri::ipc::Response::new(frame))
}

#[tauri::command]
pub(crate) async fn backup_discard(
    window: WebviewWindow,
    backup: State<'_, BackupService>,
    workspace: State<'_, WorkspaceService>,
    request: BackupDiscardRequest,
) -> Result<(), CommandError> {
    let (root_id, key) = request.into_parts();
    backup
        .discard(workspace.inner(), window.label(), root_id, key)
        .await
}

#[tauri::command]
pub(crate) async fn backup_discard_all(
    window: WebviewWindow,
    backup: State<'_, BackupService>,
    workspace: State<'_, WorkspaceService>,
    request: BackupDiscardAllRequest,
) -> Result<(), CommandError> {
    request.validate();
    backup.discard_all(workspace.inner(), window.label()).await
}

#[cfg(test)]
mod tests {
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    use super::super::frame::encode_read_all_frame;
    use crate::backup::dto::{BackupDiscardAllRequest, BackupDiscardRequest, BackupReadAllRequest};

    #[test]
    fn read_all_requests_reject_every_extra_field() {
        serde_json::from_value::<BackupReadAllRequest>(serde_json::json!({})).unwrap();
        assert!(
            serde_json::from_value::<BackupReadAllRequest>(serde_json::json!({ "key": "a" }))
                .is_err()
        );
        serde_json::from_value::<BackupDiscardAllRequest>(serde_json::json!({})).unwrap();
        assert!(serde_json::from_value::<BackupDiscardAllRequest>(
            serde_json::json!({ "key": "a" })
        )
        .is_err());
        assert!(serde_json::from_value::<BackupDiscardRequest>(serde_json::json!({})).is_err());
    }

    #[test]
    fn read_all_response_uses_raw_ipc_bytes_instead_of_json() {
        let root_id =
            crate::workspace::RootId::parse_v4_wire("00000000-0000-4000-8000-000000000001")
                .unwrap();
        let frame = encode_read_all_frame(&[(root_id, "k".to_owned(), vec![1, 2, 3])]).unwrap();
        match tauri::ipc::Response::new(frame.clone()).body().unwrap() {
            InvokeResponseBody::Raw(body) => assert_eq!(body, frame),
            InvokeResponseBody::Json(_) => panic!("backup entries must not be JSON serialized"),
        }
    }
}
