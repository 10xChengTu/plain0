use tauri::{AppHandle, Manager, WebviewWindowBuilder};
use uuid::Uuid;

use crate::error::CommandError;

use super::dto::WindowCreateRequest;
use super::{MAIN_WINDOW_LABEL, SECONDARY_WINDOW_LABEL_PREFIX};

const MAX_WINDOW_LABEL_ATTEMPTS: usize = 16;

#[tauri::command]
pub(crate) fn window_create(
    app: AppHandle,
    request: WindowCreateRequest,
) -> Result<(), CommandError> {
    request.validate();
    create_window(&app)
}

fn create_window(app: &AppHandle) -> Result<(), CommandError> {
    let template = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW_LABEL)
        .ok_or_else(window_template_unavailable)?;

    for _ in 0..MAX_WINDOW_LABEL_ATTEMPTS {
        let label = new_window_label();
        if app.get_webview_window(&label).is_some() {
            continue;
        }
        let mut config = template.clone();
        config.label = label;
        WebviewWindowBuilder::from_config(app, &config)
            .map_err(|_| window_create_failed())?
            .build()
            .map_err(|_| window_create_failed())?;
        return Ok(());
    }

    Err(window_create_failed())
}

fn new_window_label() -> String {
    format!("{SECONDARY_WINDOW_LABEL_PREFIX}{}", Uuid::new_v4().simple())
}

fn window_template_unavailable() -> CommandError {
    CommandError::new(
        "WINDOW_TEMPLATE_UNAVAILABLE",
        "The Plain window template is unavailable.",
    )
}

fn window_create_failed() -> CommandError {
    CommandError::new(
        "WINDOW_CREATE_FAILED",
        "The Plain window could not be created.",
    )
}

#[cfg(test)]
pub(super) fn label_for_test() -> String {
    new_window_label()
}

#[cfg(test)]
pub(super) fn template_error_for_test() -> CommandError {
    window_template_unavailable()
}

#[cfg(test)]
pub(super) fn create_error_for_test() -> CommandError {
    window_create_failed()
}
