//! `F080` S1 git IPC commands: `git_status`, `git_diff_files`,
//! `git_show_blob`. Every command routes through the current window's
//! `TrustService`/`WorkspaceService` state exactly like `terminal::commands`
//! does, and every actual repository/spawn resolution happens inside
//! [`super::repo::resolve_repo_toplevel`] (via [`super::status::git_status`]/
//! [`super::diff::diff_files`]/[`super::diff::show_blob`]) — this file is
//! only the audited DTO-decode-and-single-service-route wiring, matching the
//! exact shape `scripts/plain/boundary-contracts.mjs`'s command-registration
//! locks expect elsewhere in this codebase.

use tauri::{State, WebviewWindow};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::diff;
use super::dto::{
    GitDiffFilesRequest, GitDiffFilesResult, GitShowBlobRequest, GitShowBlobResult,
    GitStatusRequest, GitStatusResult,
};
use super::status;

#[tauri::command]
pub(crate) async fn git_status(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStatusRequest,
) -> Result<GitStatusResult, CommandError> {
    request.validate();
    let result = status::git_status(trust.inner(), workspace.inner(), window.label()).await?;
    Ok(GitStatusResult::from(result))
}

#[tauri::command]
pub(crate) async fn git_diff_files(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitDiffFilesRequest,
) -> Result<GitDiffFilesResult, CommandError> {
    let cached = request.into_parts();
    let entries =
        diff::diff_files(trust.inner(), workspace.inner(), window.label(), cached).await?;
    Ok(GitDiffFilesResult::new(entries))
}

#[tauri::command]
pub(crate) async fn git_show_blob(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitShowBlobRequest,
) -> Result<GitShowBlobResult, CommandError> {
    let (rev, path) = request.into_parts()?;
    let content =
        diff::show_blob(trust.inner(), workspace.inner(), window.label(), rev, &path).await?;
    Ok(GitShowBlobResult::new(content))
}
