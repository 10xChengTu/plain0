use tauri::{Emitter, State};

use crate::error::CommandError;

use super::dto::{UserDataChangedEvent, UserDataReadRequest, UserDataResult, UserDataWriteRequest};
use super::service::UserDataService;
use super::USER_DATA_CHANGED_EVENT;

#[tauri::command]
pub(crate) async fn user_data_read(
    service: State<'_, UserDataService>,
    request: UserDataReadRequest,
) -> Result<UserDataResult, CommandError> {
    service.read(request.into_resource()).await
}

#[tauri::command]
pub(crate) async fn user_data_write(
    app: tauri::AppHandle,
    service: State<'_, UserDataService>,
    request: UserDataWriteRequest,
) -> Result<UserDataResult, CommandError> {
    let (resource, expected_revision, content) = request.into_parts()?;
    let result = service.write(resource, expected_revision, content).await?;
    // The write is already atomically published. Event delivery is a
    // best-effort invalidation hint for sibling windows and must not turn a
    // successful durable write into an apparent failure that a caller might
    // retry against a now-stale revision.
    let _ = app.emit(USER_DATA_CHANGED_EVENT, UserDataChangedEvent::from(&result));
    Ok(result)
}
