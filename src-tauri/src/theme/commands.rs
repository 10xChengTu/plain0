use tauri::{State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    ThemeEmptyRequest, ThemeImportResult, ThemeListResult, ThemeReadResourceRequest,
    ThemeRemoveRequest,
};
use super::picker::{TauriThemeDirectoryPicker, TauriThemeVsixPicker};
use super::service::ThemeService;

/// Prompts the user for a `.vsix` file via a native dialog and imports it.
/// The file dialog is the only path this domain's Tauri command surface
/// ever opens one from — never from a menu default, a startup routine, or
/// any other implicit trigger.
#[tauri::command]
pub(crate) async fn theme_import_vsix(
    window: WebviewWindow,
    service: State<'_, ThemeService>,
    request: ThemeEmptyRequest,
) -> Result<ThemeImportResult, CommandError> {
    request.validate();
    service.import_vsix(TauriThemeVsixPicker::new(window)).await
}

/// Prompts the user for an already-unpacked theme package directory via a
/// native dialog and imports it.
#[tauri::command]
pub(crate) async fn theme_import_directory(
    window: WebviewWindow,
    service: State<'_, ThemeService>,
    request: ThemeEmptyRequest,
) -> Result<ThemeImportResult, CommandError> {
    request.validate();
    service
        .import_directory(TauriThemeDirectoryPicker::new(window))
        .await
}

#[tauri::command]
pub(crate) async fn theme_list(
    service: State<'_, ThemeService>,
    request: ThemeEmptyRequest,
) -> Result<ThemeListResult, CommandError> {
    request.validate();
    service.list().await
}

#[tauri::command]
pub(crate) async fn theme_read_resource(
    service: State<'_, ThemeService>,
    request: ThemeReadResourceRequest,
) -> Result<tauri::ipc::Response, CommandError> {
    let (package_id, relative_path) = request.into_parts();
    let bytes = service.read_resource(package_id, relative_path).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub(crate) async fn theme_remove(
    service: State<'_, ThemeService>,
    request: ThemeRemoveRequest,
) -> Result<(), CommandError> {
    service.remove(request.into_package_id()).await
}

#[cfg(test)]
mod tests {
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    use crate::theme::dto::ThemeEmptyRequest;

    #[test]
    fn empty_request_rejects_every_extra_field() {
        serde_json::from_value::<ThemeEmptyRequest>(serde_json::json!({})).unwrap();
        assert!(
            serde_json::from_value::<ThemeEmptyRequest>(serde_json::json!({
                "packageId": "x"
            }))
            .is_err()
        );
    }

    #[test]
    fn resource_response_uses_raw_ipc_bytes_instead_of_json_numbers() {
        let bytes = vec![0, 255, 128, 1, 0, 42];
        match tauri::ipc::Response::new(bytes.clone()).body().unwrap() {
            InvokeResponseBody::Raw(body) => assert_eq!(body, bytes),
            InvokeResponseBody::Json(_) => panic!("resource bytes must not be JSON serialized"),
        }
    }
}
