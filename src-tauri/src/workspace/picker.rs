use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

use crate::error::CommandError;

pub type DirectoryPickerFuture<'picker> =
    Pin<Box<dyn Future<Output = Result<DirectoryPickerResult, CommandError>> + Send + 'picker>>;

#[derive(Debug)]
pub enum DirectoryPickerResult {
    Selected(Vec<PathBuf>),
    Cancelled,
}

pub trait DirectoryPicker: Send + Sync {
    fn pick_directories(&self, allow_multiple: bool) -> DirectoryPickerFuture<'_>;
}

#[derive(Clone)]
pub struct TauriDirectoryPicker {
    window: WebviewWindow,
}

impl TauriDirectoryPicker {
    pub fn new(window: WebviewWindow) -> Self {
        Self { window }
    }
}

impl DirectoryPicker for TauriDirectoryPicker {
    fn pick_directories(&self, allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let window = self.window.clone();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || {
                pick_directories_blocking(window, allow_multiple)
            })
            .await
            .map_err(|_| picker_failed())?
        })
    }
}

#[cfg(desktop)]
fn pick_directories_blocking(
    window: WebviewWindow,
    allow_multiple: bool,
) -> Result<DirectoryPickerResult, CommandError> {
    let dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Open Workspace Folder");
    let selected = if allow_multiple {
        dialog.blocking_pick_folders()
    } else {
        dialog.blocking_pick_folder().map(|path| vec![path])
    };

    selected.map_or(Ok(DirectoryPickerResult::Cancelled), |paths| {
        paths
            .into_iter()
            .map(|path| path.into_path().map_err(|_| picker_path_unavailable()))
            .collect::<Result<Vec<_>, CommandError>>()
            .map(DirectoryPickerResult::Selected)
    })
}

#[cfg(mobile)]
fn pick_directories_blocking(
    _window: WebviewWindow,
    _allow_multiple: bool,
) -> Result<DirectoryPickerResult, CommandError> {
    Err(picker_failed())
}

fn picker_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_PICK_FAILED",
        "The workspace folder picker could not be completed.",
    )
}

fn picker_path_unavailable() -> CommandError {
    CommandError::new(
        "ROOT_UNAVAILABLE",
        "The selected workspace root is unavailable.",
    )
}
