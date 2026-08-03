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

pub type SaveFilePickerFuture<'picker> =
    Pin<Box<dyn Future<Output = Result<SaveFilePickerResult, CommandError>> + Send + 'picker>>;

#[derive(Debug)]
pub enum SaveFilePickerResult {
    Selected(PathBuf),
    Cancelled,
}

pub trait SaveFilePicker: Send + Sync {
    fn pick_file(&self, suggested_name: &str) -> SaveFilePickerFuture<'_>;
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

impl SaveFilePicker for TauriFilePicker {
    fn pick_file(&self, suggested_name: &str) -> SaveFilePickerFuture<'_> {
        let window = self.window.clone();
        let suggested_name = suggested_name.to_owned();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || {
                pick_save_file_blocking(window, &suggested_name)
            })
            .await
            .map_err(|_| save_file_picker_failed())?
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

#[cfg(desktop)]
fn pick_save_file_blocking(
    window: WebviewWindow,
    suggested_name: &str,
) -> Result<SaveFilePickerResult, CommandError> {
    let selected = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Save Plain Untitled File")
        .set_file_name(suggested_name)
        .blocking_save_file();
    let Some(path) = selected else {
        return Ok(SaveFilePickerResult::Cancelled);
    };
    let path = path
        .into_path()
        .map_err(|_| save_file_picker_path_unavailable())?;
    #[cfg(target_os = "macos")]
    {
        authorize_macos_save_parent(&window, path)
    }
    #[cfg(not(target_os = "macos"))]
    Ok(SaveFilePickerResult::Selected(path))
}

#[cfg(target_os = "macos")]
fn authorize_macos_save_parent(
    window: &WebviewWindow,
    path: PathBuf,
) -> Result<SaveFilePickerResult, CommandError> {
    let parent = path
        .parent()
        .filter(|parent| parent.is_absolute())
        .ok_or_else(save_file_picker_path_unavailable)?;
    // NSSavePanel extends macOS access only to the selected file URL. Plain's
    // no-replace stage, directory fsync, watcher and future edits require a
    // real parent-directory capability, so a separate folder selection is
    // the authority. Its result also decides the final parent if the user
    // deliberately changes folders here; cancellation never authorizes or
    // writes anything.
    let selected_parent = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title("Authorize Plain to Save in This Folder")
        .set_directory(parent)
        .blocking_pick_folder();
    let Some(selected_parent) = selected_parent else {
        return Ok(SaveFilePickerResult::Cancelled);
    };
    let selected_parent = selected_parent
        .into_path()
        .map_err(|_| save_file_picker_path_unavailable())?;
    authorized_save_path(&path, selected_parent)
        .map(SaveFilePickerResult::Selected)
        .map_err(|_| save_file_picker_path_unavailable())
}

#[cfg(any(target_os = "macos", test))]
fn authorized_save_path(
    requested_path: &std::path::Path,
    selected_parent: PathBuf,
) -> Result<PathBuf, ()> {
    let file_name = requested_path.file_name().ok_or(())?;
    if !selected_parent.is_absolute() {
        return Err(());
    }
    Ok(selected_parent.join(file_name))
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

#[cfg(mobile)]
fn pick_save_file_blocking(
    _window: WebviewWindow,
    _suggested_name: &str,
) -> Result<SaveFilePickerResult, CommandError> {
    Err(save_file_picker_failed())
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

fn save_file_picker_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_SAVE_PICK_FAILED",
        "The save file picker could not be completed.",
    )
}

fn save_file_picker_path_unavailable() -> CommandError {
    CommandError::new(
        "WORKSPACE_SAVE_TARGET_UNAVAILABLE",
        "The selected save target is unavailable.",
    )
}

#[cfg(test)]
mod tests {
    use super::authorized_save_path;
    use std::path::{Path, PathBuf};

    #[test]
    fn macos_save_authority_keeps_the_name_but_uses_the_explicit_folder() {
        assert_eq!(
            authorized_save_path(
                Path::new("/untrusted/first-choice/note.txt"),
                PathBuf::from("/authorized/final-choice"),
            )
            .unwrap(),
            PathBuf::from("/authorized/final-choice/note.txt"),
        );
        assert!(authorized_save_path(
            Path::new("/untrusted/first-choice/note.txt"),
            PathBuf::from("relative-folder"),
        )
        .is_err());
        assert!(authorized_save_path(Path::new("/"), PathBuf::from("/authorized")).is_err());
    }
}
