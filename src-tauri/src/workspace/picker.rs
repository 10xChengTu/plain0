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

pub type FilePickerFuture<'picker> =
    Pin<Box<dyn Future<Output = Result<FilePickerResult, CommandError>> + Send + 'picker>>;

#[derive(Debug)]
pub enum FilePickerResult {
    Selected(Vec<PathBuf>),
    Cancelled,
}

pub trait FilePicker: Send + Sync {
    fn pick_files(&self) -> FilePickerFuture<'_>;
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

#[derive(Clone)]
pub struct TauriFilePicker {
    window: WebviewWindow,
}

impl TauriFilePicker {
    pub fn new(window: WebviewWindow) -> Self {
        Self { window }
    }
}

impl FilePicker for TauriFilePicker {
    fn pick_files(&self) -> FilePickerFuture<'_> {
        let window = self.window.clone();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || pick_files_blocking(window))
                .await
                .map_err(|_| file_picker_failed())?
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

#[cfg(desktop)]
fn pick_files_blocking(window: WebviewWindow) -> Result<FilePickerResult, CommandError> {
    let selected = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Open File")
        .blocking_pick_files();
    selected.map_or(Ok(FilePickerResult::Cancelled), |paths| {
        paths
            .into_iter()
            .map(|path| path.into_path().map_err(|_| file_picker_path_unavailable()))
            .collect::<Result<Vec<_>, CommandError>>()
            .map(FilePickerResult::Selected)
    })
}

#[cfg(mobile)]
fn pick_directories_blocking(
    _window: WebviewWindow,
    _allow_multiple: bool,
) -> Result<DirectoryPickerResult, CommandError> {
    Err(picker_failed())
}

#[cfg(mobile)]
fn pick_files_blocking(_window: WebviewWindow) -> Result<FilePickerResult, CommandError> {
    Err(file_picker_failed())
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

fn file_picker_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_FILE_PICK_FAILED",
        "The file picker could not be completed.",
    )
}

fn file_picker_path_unavailable() -> CommandError {
    CommandError::new(
        "WORKSPACE_FILE_UNAVAILABLE",
        "The selected file is unavailable.",
    )
}
