//! `F050` S3's Tauri-facing orchestration: a single process-wide
//! [`ThemeService`] wrapping one [`ThemeLibrary`] behind `Arc` (so blocking
//! library operations can run on `tauri::async_runtime::spawn_blocking`
//! without borrowing across the `.await`, exactly like
//! `workspace::service::WorkspaceService` borrows an `Arc<WindowWorkspace>`
//! for its own blocking work). Every method here is the full "picker (or
//! bare id) → library operation → wire DTO" span for one `theme_*` command;
//! `commands.rs` only adds the `WebviewWindow`/`State` extraction Tauri
//! itself requires.

use std::path::PathBuf;
use std::sync::Arc;

use cap_std::ambient_authority;
use cap_std::fs::File;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{ThemeImportResult, ThemeListResult, ThemePackageSummary};
use super::import;
use super::library::ThemeLibrary;
use super::picker::{
    FilePicker, FilePickerResult, ThemeDirectoryPicker, ThemeDirectoryPickerResult,
};
use super::theme_io_failed;

pub(crate) struct ThemeService {
    library: Arc<ThemeLibrary>,
}

impl ThemeService {
    pub(crate) fn new(base_path: PathBuf) -> Self {
        Self {
            library: Arc::new(ThemeLibrary::new(base_path)),
        }
    }

    /// Prompts for a `.vsix` file (unless the picker reports cancellation)
    /// and imports it. The picker round-trip happens before the blocking
    /// import pipeline is handed to `spawn_blocking`, matching
    /// `WorkspaceService::pick_roots_with_watch_sink`'s own picker-then-
    /// blocking-work split.
    pub(crate) async fn import_vsix<P: FilePicker>(
        &self,
        picker: P,
    ) -> Result<ThemeImportResult, CommandError> {
        match picker.pick_file().await? {
            FilePickerResult::Cancelled => Ok(ThemeImportResult::cancelled()),
            FilePickerResult::Selected(path) => {
                let library = Arc::clone(&self.library);
                tauri::async_runtime::spawn_blocking(move || {
                    let source = File::open_ambient(&path, ambient_authority())
                        .map_err(|_| theme_io_failed())?;
                    import::import_vsix(&library, source)
                        .map(|imported| ThemeImportResult::imported(imported.manifest.into()))
                })
                .await
                .map_err(|_| theme_io_failed())?
            }
        }
    }

    /// Prompts for an already-unpacked theme package directory and imports
    /// it, sharing every check with [`Self::import_vsix`] except the input
    /// enumeration (see `theme::import::import_directory`).
    pub(crate) async fn import_directory<P: ThemeDirectoryPicker>(
        &self,
        picker: P,
    ) -> Result<ThemeImportResult, CommandError> {
        match picker.pick_directory().await? {
            ThemeDirectoryPickerResult::Cancelled => Ok(ThemeImportResult::cancelled()),
            ThemeDirectoryPickerResult::Selected(path) => {
                let library = Arc::clone(&self.library);
                tauri::async_runtime::spawn_blocking(move || {
                    import::import_directory(&library, &path)
                        .map(|imported| ThemeImportResult::imported(imported.manifest.into()))
                })
                .await
                .map_err(|_| theme_io_failed())?
            }
        }
    }

    /// The `theme_list` library enumeration, consumed both by the frontend's
    /// startup re-registration loop and (indirectly, via the same DTO shape)
    /// by a successful import's own response.
    pub(crate) async fn list(&self) -> Result<ThemeListResult, CommandError> {
        let library = Arc::clone(&self.library);
        let listing = tauri::async_runtime::spawn_blocking(move || library.list_packages())
            .await
            .map_err(|_| theme_io_failed())??;
        Ok(ThemeListResult::new(
            listing
                .packages
                .into_iter()
                .map(ThemePackageSummary::from)
                .collect(),
            listing.skipped,
        ))
    }

    /// `F050` S3's whitelisted resource read — see
    /// `resource::read_resource`'s own contract.
    pub(crate) async fn read_resource(
        &self,
        package_id: String,
        relative_path: RelativePath,
    ) -> Result<Vec<u8>, CommandError> {
        let library = Arc::clone(&self.library);
        tauri::async_runtime::spawn_blocking(move || {
            library.read_resource(&package_id, &relative_path)
        })
        .await
        .map_err(|_| theme_io_failed())?
    }

    /// Removes an imported package by id. Idempotent (see
    /// `ThemeLibrary::remove_package`'s own doc comment) — the frontend, not
    /// this method, is responsible for falling back the active theme
    /// selection if it belonged to the removed package.
    pub(crate) async fn remove(&self, package_id: String) -> Result<(), CommandError> {
        let library = Arc::clone(&self.library);
        tauri::async_runtime::spawn_blocking(move || library.remove_package(&package_id))
            .await
            .map_err(|_| theme_io_failed())?
    }
}

#[cfg(test)]
mod tests;
