use tauri::{State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    ScratchCreateRequest, ScratchCreateResult, ScratchDiscardAllRequest, ScratchDiscardRequest,
    ScratchReadAllRequest,
};
use super::frame::{encode_read_all_frame, ScratchWriteFrame};
use super::service::ScratchService;

#[tauri::command]
pub(crate) fn scratch_create(
    window: WebviewWindow,
    scratch: State<'_, ScratchService>,
    request: ScratchCreateRequest,
) -> Result<ScratchCreateResult, CommandError> {
    request.validate();
    Ok(ScratchCreateResult::new(scratch.create(window.label())?))
}

#[tauri::command]
pub(crate) async fn scratch_write(
    window: WebviewWindow,
    scratch: State<'_, ScratchService>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), CommandError> {
    let (scratch_id, content) = ScratchWriteFrame::parse_invoke_body(request.body())?.into_parts();
    scratch.write(window.label(), scratch_id, content).await
}

#[tauri::command]
pub(crate) async fn scratch_read_all(
    window: WebviewWindow,
    scratch: State<'_, ScratchService>,
    request: ScratchReadAllRequest,
) -> Result<tauri::ipc::Response, CommandError> {
    request.validate();
    Ok(tauri::ipc::Response::new(encode_read_all_frame(
        &scratch.read_all(window.label()).await?,
    )?))
}

#[tauri::command]
pub(crate) async fn scratch_discard(
    window: WebviewWindow,
    scratch: State<'_, ScratchService>,
    request: ScratchDiscardRequest,
) -> Result<(), CommandError> {
    scratch.discard(window.label(), request.scratch_id()).await
}

#[tauri::command]
pub(crate) async fn scratch_discard_all(
    window: WebviewWindow,
    scratch: State<'_, ScratchService>,
    request: ScratchDiscardAllRequest,
) -> Result<(), CommandError> {
    request.validate();
    scratch.discard_all(window.label()).await
}

#[cfg(test)]
mod tests {
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    use super::encode_read_all_frame;
    use crate::scratch::ScratchId;

    #[test]
    fn read_all_response_is_raw_binary() {
        let id = ScratchId::parse_v4_wire("00000000-0000-4000-8000-000000000001").unwrap();
        let frame = encode_read_all_frame(&[(id, vec![1, 2, 3])]).unwrap();
        match tauri::ipc::Response::new(frame.clone()).body().unwrap() {
            InvokeResponseBody::Raw(body) => assert_eq!(body, frame),
            InvokeResponseBody::Json(_) => panic!("scratch entries must not be JSON serialized"),
        }
    }
}
