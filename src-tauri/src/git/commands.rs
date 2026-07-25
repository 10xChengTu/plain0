//! `F080` S1 git IPC read commands (`git_status`, `git_diff_files`,
//! `git_show_blob`) and `F080` S3 git IPC write commands (`git_stage_paths`,
//! `git_unstage_paths`, `git_stage_blob`, `git_commit`, `git_discard_paths`).
//! Every command routes through the current window's `TrustService`/
//! `WorkspaceService` state exactly like `terminal::commands` does, and every
//! actual repository/spawn resolution happens inside
//! [`super::repo::resolve_repo_toplevel`] (via [`super::status::git_status`]/
//! [`super::diff::diff_files`]/[`super::diff::show_blob`]/
//! [`super::stage::stage_paths`]/[`super::stage::unstage_paths`]/
//! [`super::stage::stage_blob`]/[`super::commit::commit`]/
//! [`super::discard::discard_paths`]) — this file is only the audited
//! DTO-decode-and-single-service-route wiring, matching the exact shape
//! `scripts/plain/boundary-contracts.mjs`'s command-registration locks expect
//! elsewhere in this codebase.

use tauri::{State, WebviewWindow};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::commit;
use super::diff;
use super::discard;
use super::dto::{
    GitCommitRequest, GitDiffFilesRequest, GitDiffFilesResult, GitDiscardPathsRequest,
    GitShowBlobRequest, GitShowBlobResult, GitStageBlobRequest, GitStagePathsRequest,
    GitStatusRequest, GitStatusResult, GitUnstagePathsRequest,
};
use super::stage;
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

#[tauri::command]
pub(crate) async fn git_stage_paths(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStagePathsRequest,
) -> Result<(), CommandError> {
    let paths = request.into_parts()?;
    stage::stage_paths(trust.inner(), workspace.inner(), window.label(), &paths).await
}

#[tauri::command]
pub(crate) async fn git_unstage_paths(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitUnstagePathsRequest,
) -> Result<(), CommandError> {
    let paths = request.into_parts()?;
    stage::unstage_paths(trust.inner(), workspace.inner(), window.label(), &paths).await
}

#[tauri::command]
pub(crate) async fn git_stage_blob(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStageBlobRequest,
) -> Result<(), CommandError> {
    let (path, content) = request.into_parts()?;
    stage::stage_blob(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &path,
        content,
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_commit(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitCommitRequest,
) -> Result<(), CommandError> {
    let (message, amend) = request.into_parts()?;
    commit::commit(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &message,
        amend,
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_discard_paths(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitDiscardPathsRequest,
) -> Result<(), CommandError> {
    let paths = request.into_parts()?;
    discard::discard_paths(trust.inner(), workspace.inner(), window.label(), &paths).await
}
