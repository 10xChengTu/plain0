//! `F080` S1 git IPC read commands (`git_status`, `git_diff_files`,
//! `git_show_blob`), `F080` S3 git IPC write commands (`git_stage_paths`,
//! `git_unstage_paths`, `git_stage_blob`, `git_commit`, `git_discard_paths`)
//! and `F080` S4 git IPC network commands (`git_network_preview`,
//! `git_fetch`, `git_pull`, `git_push`, `git_network_cancel`).
//! Every command routes through the current window's `TrustService`/
//! `WorkspaceService` state exactly like `terminal::commands` does, and every
//! actual repository/spawn resolution happens inside
//! [`super::repo::resolve_repo_toplevel`] (via [`super::status::git_status`]/
//! [`super::diff::diff_files`]/[`super::diff::show_blob`]/
//! [`super::stage::stage_paths`]/[`super::stage::unstage_paths`]/
//! [`super::stage::stage_blob`]/[`super::commit::commit`]/
//! [`super::discard::discard_paths`]/[`super::network::preview`]/
//! [`super::network::fetch`]/[`super::network::pull`]/[`super::network::push`])
//! — this file is only the audited DTO-decode-and-single-service-route
//! wiring, matching the exact shape
//! `scripts/plain/boundary-contracts.mjs`'s command-registration locks expect
//! elsewhere in this codebase.

use tauri::{State, WebviewWindow};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::blame;
use super::commit;
use super::diff;
use super::discard;
use super::dto::{
    GitBlameCommitMessagesRequest, GitBlameCommitMessagesResult, GitBlameFileRequest,
    GitBlameFileResult, GitCommitRequest, GitDiffFilesRequest, GitDiffFilesResult,
    GitDiscardPathsRequest, GitFetchRequest, GitNetworkCancelRequest, GitNetworkPreviewRequest,
    GitNetworkPreviewResult, GitPullRequest, GitPushRequest, GitShowBlobRequest, GitShowBlobResult,
    GitStageBlobRequest, GitStagePathsRequest, GitStatusRequest, GitStatusResult,
    GitUnstagePathsRequest,
};
use super::network::{self, GitNetworkService};
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

#[tauri::command]
pub(crate) async fn git_network_preview(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitNetworkPreviewRequest,
) -> Result<GitNetworkPreviewResult, CommandError> {
    let operation = request.into_parts();
    let result =
        network::preview(trust.inner(), workspace.inner(), window.label(), operation).await?;
    Ok(GitNetworkPreviewResult::from(result))
}

#[tauri::command]
pub(crate) async fn git_fetch(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    request: GitFetchRequest,
) -> Result<(), CommandError> {
    request.validate();
    network::fetch(
        trust.inner(),
        workspace.inner(),
        network_service.inner(),
        window.label(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_pull(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    request: GitPullRequest,
) -> Result<(), CommandError> {
    request.validate();
    network::pull(
        trust.inner(),
        workspace.inner(),
        network_service.inner(),
        window.label(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_push(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    request: GitPushRequest,
) -> Result<(), CommandError> {
    let force = request.into_parts();
    network::push(
        trust.inner(),
        workspace.inner(),
        network_service.inner(),
        window.label(),
        force,
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_blame_file(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitBlameFileRequest,
) -> Result<GitBlameFileResult, CommandError> {
    let (path, range) = request.into_parts()?;
    let result = blame::blame_file(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &path,
        range,
    )
    .await?;
    Ok(GitBlameFileResult::from(result))
}

#[tauri::command]
pub(crate) async fn git_blame_commit_messages(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitBlameCommitMessagesRequest,
) -> Result<GitBlameCommitMessagesResult, CommandError> {
    let shas = request.into_parts()?;
    let messages =
        blame::blame_commit_messages(trust.inner(), workspace.inner(), window.label(), &shas)
            .await?;
    Ok(GitBlameCommitMessagesResult::new(messages))
}

#[tauri::command]
pub(crate) async fn git_network_cancel(
    window: WebviewWindow,
    network_service: State<'_, GitNetworkService>,
    request: GitNetworkCancelRequest,
) -> Result<(), CommandError> {
    request.validate();
    network_service.inner().request_cancel(window.label());
    Ok(())
}
