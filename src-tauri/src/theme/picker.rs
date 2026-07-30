//! `F050` S3's injectable pickers: a VSIX file dialog and a theme-package
//! directory dialog. Mirrors `workspace::picker`'s `DirectoryPicker`
//! trait/`TauriDirectoryPicker` split exactly (a trait Rust tests can fake,
//! and a concrete `tauri_plugin_dialog` implementation the real commands
//! use) — kept as its own type here rather than reusing `workspace::picker`
//! directly because that trait's dialog title ("Open Workspace Folder") and
//! error codes (`WORKSPACE_PICK_FAILED`/`ROOT_UNAVAILABLE`) are workspace-
//! domain wording that would leak the wrong vocabulary into theme import
//! failures.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

use crate::error::CommandError;

use super::{theme_pick_failed, theme_pick_path_unavailable};

pub(crate) type FilePickerFuture<'picker> =
    Pin<Box<dyn Future<Output = Result<FilePickerResult, CommandError>> + Send + 'picker>>;

#[derive(Debug)]
pub(crate) enum FilePickerResult {
    Selected(PathBuf),
    Cancelled,
}

/// Picks a single arbitrary file (a `.vsix` archive). Distinct from
/// [`ThemeDirectoryPicker`] because a file dialog and a folder dialog are
/// different `tauri_plugin_dialog` entry points with different filters.
pub(crate) trait FilePicker: Send + Sync {
    fn pick_file(&self) -> FilePickerFuture<'_>;
}

pub(crate) type ThemeDirectoryPickerFuture<'picker> = Pin<
    Box<dyn Future<Output = Result<ThemeDirectoryPickerResult, CommandError>> + Send + 'picker>,
>;

#[derive(Debug)]
pub(crate) enum ThemeDirectoryPickerResult {
    Selected(PathBuf),
    Cancelled,
}

/// Picks a single already-unpacked theme package directory.
pub(crate) trait ThemeDirectoryPicker: Send + Sync {
    fn pick_directory(&self) -> ThemeDirectoryPickerFuture<'_>;
}

#[derive(Clone)]
pub(crate) struct TauriThemeVsixPicker {
    window: WebviewWindow,
}

impl TauriThemeVsixPicker {
    pub(crate) fn new(window: WebviewWindow) -> Self {
        Self { window }
    }
}

impl FilePicker for TauriThemeVsixPicker {
    fn pick_file(&self) -> FilePickerFuture<'_> {
        let window = self.window.clone();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || pick_vsix_file_blocking(window))
                .await
                .map_err(|_| theme_pick_failed())?
        })
    }
}

#[cfg(desktop)]
fn pick_vsix_file_blocking(window: WebviewWindow) -> Result<FilePickerResult, CommandError> {
    let selected = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Import Color Theme (VSIX)")
        .add_filter("VSIX Extension", &["vsix"])
        .blocking_pick_file();

    match selected {
        Some(path) => path
            .into_path()
            .map(FilePickerResult::Selected)
            .map_err(|_| theme_pick_path_unavailable()),
        None => Ok(FilePickerResult::Cancelled),
    }
}

#[cfg(mobile)]
fn pick_vsix_file_blocking(_window: WebviewWindow) -> Result<FilePickerResult, CommandError> {
    Err(theme_pick_failed())
}

#[derive(Clone)]
pub(crate) struct TauriThemeDirectoryPicker {
    window: WebviewWindow,
}

impl TauriThemeDirectoryPicker {
    pub(crate) fn new(window: WebviewWindow) -> Self {
        Self { window }
    }
}

impl ThemeDirectoryPicker for TauriThemeDirectoryPicker {
    fn pick_directory(&self) -> ThemeDirectoryPickerFuture<'_> {
        let window = self.window.clone();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || pick_theme_directory_blocking(window))
                .await
                .map_err(|_| theme_pick_failed())?
        })
    }
}

#[cfg(desktop)]
fn pick_theme_directory_blocking(
    window: WebviewWindow,
) -> Result<ThemeDirectoryPickerResult, CommandError> {
    let selected = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Import Color Theme (Folder)")
        .blocking_pick_folder();

    match selected {
        Some(path) => path
            .into_path()
            .map(ThemeDirectoryPickerResult::Selected)
            .map_err(|_| theme_pick_path_unavailable()),
        None => Ok(ThemeDirectoryPickerResult::Cancelled),
    }
}

#[cfg(mobile)]
fn pick_theme_directory_blocking(
    _window: WebviewWindow,
) -> Result<ThemeDirectoryPickerResult, CommandError> {
    Err(theme_pick_failed())
}
