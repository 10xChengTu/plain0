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
use crate::workspace::picker::TauriDirectoryPicker;
use crate::workspace::service::WorkspaceService;

use super::blame;
use super::commit;
use super::diff;
use super::discard;
use super::dto::{
    GitBlameCommitMessagesRequest, GitBlameCommitMessagesResult, GitBlameFileRequest,
    GitBlameFileResult, GitCommitRequest, GitDiffFilesRequest, GitDiffFilesResult,
    GitDiscardPathsRequest, GitFetchRequest, GitFileHistoryRequest, GitHistoryListResultWire,
    GitLineHistoryDetailRequest, GitLineHistoryDetailResultWire, GitLineHistoryListRequest,
    GitLogGraphRequest, GitLogGraphResultWire, GitNetworkCancelRequest, GitNetworkPreviewRequest,
    GitNetworkPreviewResult, GitPullRequest, GitPushRequest, GitRefsListRequest,
    GitRefsListResultWire, GitShowBlobRequest, GitShowBlobResult, GitShowCommitBlobRequest,
    GitShowCommitRequest, GitShowCommitResult, GitStageBlobRequest, GitStagePathsRequest,
    GitStashApplyOutcomeWire, GitStashApplyRequest, GitStashDropRequest, GitStashListRequest,
    GitStashListResultWire, GitStashPopRequest, GitStashPushOutcomeWire, GitStashPushRequest,
    GitStashShowRequest, GitStashShowResultWire, GitStatusRequest, GitStatusResult,
    GitUnstagePathsRequest, GitWorktreeAddOutcomeWire, GitWorktreeAddRequest,
    GitWorktreeListRequest, GitWorktreeListResultWire, GitWorktreeRemoveOutcomeWire,
    GitWorktreeRemoveRequest,
};
use super::log;
use super::network::{self, GitNetworkService};
use super::refs;
use super::show_commit;
use super::stage;
use super::stash;
use super::status;
use super::worktree;

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
pub(crate) async fn git_file_history(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitFileHistoryRequest,
) -> Result<GitHistoryListResultWire, CommandError> {
    let path = request.into_parts()?;
    let result = log::file_history(trust.inner(), workspace.inner(), window.label(), &path).await?;
    Ok(GitHistoryListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_line_history_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitLineHistoryListRequest,
) -> Result<GitHistoryListResultWire, CommandError> {
    let (path, range) = request.into_parts()?;
    let result = log::line_history_list(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &path,
        range,
    )
    .await?;
    Ok(GitHistoryListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_line_history_detail(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitLineHistoryDetailRequest,
) -> Result<GitLineHistoryDetailResultWire, CommandError> {
    let (path, range, skip, expected_sha) = request.into_parts()?;
    let result = log::line_history_detail(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &path,
        range,
        skip,
        &expected_sha,
    )
    .await?;
    Ok(GitLineHistoryDetailResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_show_commit(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitShowCommitRequest,
) -> Result<GitShowCommitResult, CommandError> {
    let sha = request.into_parts()?;
    let result =
        show_commit::show_commit(trust.inner(), workspace.inner(), window.label(), &sha).await?;
    Ok(GitShowCommitResult::from(result))
}

#[tauri::command]
pub(crate) async fn git_show_commit_blob(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitShowCommitBlobRequest,
) -> Result<GitShowBlobResult, CommandError> {
    let (sha, path) = request.into_parts()?;
    let content = show_commit::show_commit_blob(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &sha,
        &path,
    )
    .await?;
    Ok(GitShowBlobResult::new(content))
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

#[tauri::command]
pub(crate) async fn git_log_graph(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitLogGraphRequest,
) -> Result<GitLogGraphResultWire, CommandError> {
    let max_count = request.into_parts()?;
    let result =
        log::log_graph(trust.inner(), workspace.inner(), window.label(), max_count).await?;
    Ok(GitLogGraphResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_refs_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitRefsListRequest,
) -> Result<GitRefsListResultWire, CommandError> {
    request.validate();
    let result = refs::list_refs(trust.inner(), workspace.inner(), window.label()).await?;
    Ok(GitRefsListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_stash_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStashListRequest,
) -> Result<GitStashListResultWire, CommandError> {
    request.validate();
    let result = stash::list_stashes(trust.inner(), workspace.inner(), window.label()).await?;
    Ok(GitStashListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_stash_show(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStashShowRequest,
) -> Result<GitStashShowResultWire, CommandError> {
    let sha = request.into_parts()?;
    let result = stash::show_stash(trust.inner(), workspace.inner(), window.label(), &sha).await?;
    Ok(GitStashShowResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_stash_push(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStashPushRequest,
) -> Result<GitStashPushOutcomeWire, CommandError> {
    let (message, include_untracked) = request.into_parts()?;
    let outcome = stash::push_stash(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &message,
        include_untracked,
    )
    .await?;
    Ok(GitStashPushOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_stash_apply(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStashApplyRequest,
) -> Result<GitStashApplyOutcomeWire, CommandError> {
    let (sha, use_index) = request.into_parts()?;
    let outcome = stash::apply_stash(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &sha,
        use_index,
    )
    .await?;
    Ok(GitStashApplyOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_stash_pop(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStashPopRequest,
) -> Result<GitStashApplyOutcomeWire, CommandError> {
    let (expected_sha, use_index) = request.into_parts()?;
    let outcome = stash::pop_stash(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &expected_sha,
        use_index,
    )
    .await?;
    Ok(GitStashApplyOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_stash_drop(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitStashDropRequest,
) -> Result<(), CommandError> {
    let expected_sha = request.into_parts()?;
    stash::drop_stash(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &expected_sha,
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_worktree_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitWorktreeListRequest,
) -> Result<GitWorktreeListResultWire, CommandError> {
    request.validate();
    let result = worktree::list_worktrees(trust.inner(), workspace.inner(), window.label()).await?;
    Ok(GitWorktreeListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_worktree_add(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitWorktreeAddRequest,
) -> Result<GitWorktreeAddOutcomeWire, CommandError> {
    let (child_segment, detach, commit_ish) = request.into_parts()?;
    let picker = TauriDirectoryPicker::new(window.clone());
    let outcome = worktree::add_worktree(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &picker,
        &child_segment,
        detach,
        commit_ish.as_deref(),
    )
    .await?;
    Ok(GitWorktreeAddOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_worktree_remove(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: GitWorktreeRemoveRequest,
) -> Result<GitWorktreeRemoveOutcomeWire, CommandError> {
    let (path, force) = request.into_parts()?;
    let outcome = worktree::remove_worktree(
        trust.inner(),
        workspace.inner(),
        window.label(),
        &path,
        force,
    )
    .await?;
    Ok(GitWorktreeRemoveOutcomeWire::from(outcome))
}
