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
use crate::remote::session::RemoteSessionService;
use crate::trust::service::TrustService;
use crate::workspace::picker::TauriDirectoryPicker;
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

use super::blame;
use super::commit;
use super::contributors;
use super::diff;
use super::discard;
use super::dto::{
    GitBlameCommitMessagesRequest, GitBlameCommitMessagesResult, GitBlameFileRequest,
    GitBlameFileResult, GitBranchCreateRequest, GitBranchDeleteOutcomeWire, GitBranchDeleteRequest,
    GitBranchRenameRequest, GitBranchSwitchRequest, GitCherryPickRequest, GitCommitRequest,
    GitContributorsListRequest, GitContributorsListResultWire, GitDiffFilesRequest,
    GitDiffFilesResult, GitDiscardPathsRequest, GitFetchRequest, GitFileHistoryRequest,
    GitHistoryAbortRequest, GitHistoryCancelRequest, GitHistoryContinueRequest,
    GitHistoryListResultWire, GitHistoryMutationOutcomeWire, GitHistoryPreviewRequest,
    GitHistoryPreviewResultWire, GitHistoryStateRequest, GitHistoryStateResultWire,
    GitLineHistoryDetailRequest, GitLineHistoryDetailResultWire, GitLineHistoryListRequest,
    GitLogGraphRequest, GitLogGraphResultWire, GitMergeRequest, GitNetworkCancelRequest,
    GitNetworkPreviewRequest, GitNetworkPreviewResult, GitPullRequest, GitPushRequest,
    GitRebaseRequest, GitReflogListRequest, GitReflogListResultWire, GitRefsListRequest,
    GitRefsListResultWire, GitRemoteAddRequest, GitRemoteRemoveRequest, GitRemoteRenameRequest,
    GitRemoteSetUrlRequest, GitRemotesListRequest, GitRemotesListResultWire, GitResetRequest,
    GitRevertRequest, GitShowBlobRequest, GitShowBlobResult, GitShowCommitBlobRequest,
    GitShowCommitRequest, GitShowCommitResult, GitStageBlobRequest, GitStagePathsRequest,
    GitStashApplyOutcomeWire, GitStashApplyRequest, GitStashDropRequest, GitStashListRequest,
    GitStashListResultWire, GitStashPopRequest, GitStashPushOutcomeWire, GitStashPushRequest,
    GitStashShowRequest, GitStashShowResultWire, GitStatusRequest, GitStatusResult,
    GitTagCreateRequest, GitTagDeleteRequest, GitUnstagePathsRequest, GitUpstreamSetRequest,
    GitUpstreamUnsetRequest, GitWorktreeAddOutcomeWire, GitWorktreeAddRequest,
    GitWorktreeListRequest, GitWorktreeListResultWire, GitWorktreeRemoveOutcomeWire,
    GitWorktreeRemoveRequest,
};
use super::history_operation::{self, GitHistoryOperationService};
use super::log;
use super::management;
use super::network::{self, GitNetworkService};
use super::reflog;
use super::refs;
use super::remote;
use super::repo::SelectedGitRoot;
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
    network_service: State<'_, GitNetworkService>,
    remote: State<'_, RemoteSessionService>,
    root_id: RootId,
    request: GitStatusRequest,
) -> Result<GitStatusResult, CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = status::git_status(
        trust.inner(),
        &scope,
        network_service.inner(),
        remote.inner(),
        window.label(),
    )
    .await?;
    Ok(GitStatusResult::from(result))
}

#[tauri::command]
pub(crate) async fn git_diff_files(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    remote: State<'_, RemoteSessionService>,
    root_id: RootId,
    request: GitDiffFilesRequest,
) -> Result<GitDiffFilesResult, CommandError> {
    let cached = request.into_parts();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let entries = diff::diff_files(
        trust.inner(),
        &scope,
        network_service.inner(),
        remote.inner(),
        window.label(),
        cached,
    )
    .await?;
    Ok(GitDiffFilesResult::new(entries))
}

#[tauri::command]
pub(crate) async fn git_show_blob(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitShowBlobRequest,
) -> Result<GitShowBlobResult, CommandError> {
    let (rev, path) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let content = diff::show_blob(trust.inner(), &scope, window.label(), rev, &path).await?;
    Ok(GitShowBlobResult::new(content))
}

#[tauri::command]
pub(crate) async fn git_stage_paths(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    remote: State<'_, RemoteSessionService>,
    root_id: RootId,
    request: GitStagePathsRequest,
) -> Result<(), CommandError> {
    let paths = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    stage::stage_paths(
        trust.inner(),
        &scope,
        network_service.inner(),
        remote.inner(),
        window.label(),
        &paths,
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_unstage_paths(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    remote: State<'_, RemoteSessionService>,
    root_id: RootId,
    request: GitUnstagePathsRequest,
) -> Result<(), CommandError> {
    let paths = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    stage::unstage_paths(
        trust.inner(),
        &scope,
        network_service.inner(),
        remote.inner(),
        window.label(),
        &paths,
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_stage_blob(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitStageBlobRequest,
) -> Result<(), CommandError> {
    let (path, content) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    stage::stage_blob(trust.inner(), &scope, window.label(), &path, content).await
}

#[tauri::command]
pub(crate) async fn git_commit(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    remote: State<'_, RemoteSessionService>,
    root_id: RootId,
    request: GitCommitRequest,
) -> Result<(), CommandError> {
    let (message, amend) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    commit::commit(
        trust.inner(),
        &scope,
        network_service.inner(),
        remote.inner(),
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
    root_id: RootId,
    request: GitDiscardPathsRequest,
) -> Result<(), CommandError> {
    let paths = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    discard::discard_paths(trust.inner(), &scope, window.label(), &paths).await
}

#[tauri::command]
pub(crate) async fn git_network_preview(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitNetworkPreviewRequest,
) -> Result<GitNetworkPreviewResult, CommandError> {
    let operation = request.into_parts();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = network::preview(trust.inner(), &scope, window.label(), operation).await?;
    Ok(GitNetworkPreviewResult::from(result))
}

#[tauri::command]
pub(crate) async fn git_fetch(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    root_id: RootId,
    request: GitFetchRequest,
) -> Result<(), CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    network::fetch(
        trust.inner(),
        &scope,
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
    root_id: RootId,
    request: GitPullRequest,
) -> Result<(), CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    network::pull(
        trust.inner(),
        &scope,
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
    root_id: RootId,
    request: GitPushRequest,
) -> Result<(), CommandError> {
    let force = request.into_parts();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    network::push(
        trust.inner(),
        &scope,
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
    root_id: RootId,
    request: GitBlameFileRequest,
) -> Result<GitBlameFileResult, CommandError> {
    let (path, range) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = blame::blame_file(trust.inner(), &scope, window.label(), &path, range).await?;
    Ok(GitBlameFileResult::from(result))
}

#[tauri::command]
pub(crate) async fn git_blame_commit_messages(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitBlameCommitMessagesRequest,
) -> Result<GitBlameCommitMessagesResult, CommandError> {
    let shas = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let messages =
        blame::blame_commit_messages(trust.inner(), &scope, window.label(), &shas).await?;
    Ok(GitBlameCommitMessagesResult::new(messages))
}

#[tauri::command]
pub(crate) async fn git_file_history(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitFileHistoryRequest,
) -> Result<GitHistoryListResultWire, CommandError> {
    let path = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = log::file_history(trust.inner(), &scope, window.label(), &path).await?;
    Ok(GitHistoryListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_line_history_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitLineHistoryListRequest,
) -> Result<GitHistoryListResultWire, CommandError> {
    let (path, range) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result =
        log::line_history_list(trust.inner(), &scope, window.label(), &path, range).await?;
    Ok(GitHistoryListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_line_history_detail(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitLineHistoryDetailRequest,
) -> Result<GitLineHistoryDetailResultWire, CommandError> {
    let (path, range, skip, expected_sha) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = log::line_history_detail(
        trust.inner(),
        &scope,
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
    root_id: RootId,
    request: GitShowCommitRequest,
) -> Result<GitShowCommitResult, CommandError> {
    let sha = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = show_commit::show_commit(trust.inner(), &scope, window.label(), &sha).await?;
    Ok(GitShowCommitResult::from(result))
}

#[tauri::command]
pub(crate) async fn git_show_commit_blob(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitShowCommitBlobRequest,
) -> Result<GitShowBlobResult, CommandError> {
    let (sha, path) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let content =
        show_commit::show_commit_blob(trust.inner(), &scope, window.label(), &sha, &path).await?;
    Ok(GitShowBlobResult::new(content))
}

#[tauri::command]
pub(crate) async fn git_network_cancel(
    window: WebviewWindow,
    network_service: State<'_, GitNetworkService>,
    root_id: RootId,
    request: GitNetworkCancelRequest,
) -> Result<(), CommandError> {
    request.validate();
    network_service
        .inner()
        .request_cancel_for_root(window.label(), root_id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn git_log_graph(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    network_service: State<'_, GitNetworkService>,
    remote: State<'_, RemoteSessionService>,
    root_id: RootId,
    request: GitLogGraphRequest,
) -> Result<GitLogGraphResultWire, CommandError> {
    let max_count = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = log::log_graph(
        trust.inner(),
        &scope,
        network_service.inner(),
        remote.inner(),
        window.label(),
        max_count,
    )
    .await?;
    Ok(GitLogGraphResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_refs_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitRefsListRequest,
) -> Result<GitRefsListResultWire, CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = refs::list_refs(trust.inner(), &scope, window.label()).await?;
    Ok(GitRefsListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_remotes_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitRemotesListRequest,
) -> Result<GitRemotesListResultWire, CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = remote::list_remotes(trust.inner(), &scope, window.label()).await?;
    Ok(GitRemotesListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_reflog_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitReflogListRequest,
) -> Result<GitReflogListResultWire, CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = reflog::list_reflog(trust.inner(), &scope, window.label()).await?;
    Ok(GitReflogListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_contributors_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitContributorsListRequest,
) -> Result<GitContributorsListResultWire, CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = contributors::list_contributors(trust.inner(), &scope, window.label()).await?;
    Ok(GitContributorsListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_branch_create(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitBranchCreateRequest,
) -> Result<(), CommandError> {
    let (name, target_sha) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::create_branch(trust.inner(), &scope, window.label(), &name, &target_sha).await
}

#[tauri::command]
pub(crate) async fn git_branch_switch(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitBranchSwitchRequest,
) -> Result<(), CommandError> {
    let name = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::switch_branch(trust.inner(), &scope, window.label(), &name).await
}

#[tauri::command]
pub(crate) async fn git_branch_rename(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitBranchRenameRequest,
) -> Result<(), CommandError> {
    let (old_name, new_name) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::rename_branch(trust.inner(), &scope, window.label(), &old_name, &new_name).await
}

#[tauri::command]
pub(crate) async fn git_branch_delete(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitBranchDeleteRequest,
) -> Result<GitBranchDeleteOutcomeWire, CommandError> {
    let (name, force) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome =
        management::delete_branch(trust.inner(), &scope, window.label(), &name, force).await?;
    Ok(GitBranchDeleteOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_tag_create(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitTagCreateRequest,
) -> Result<(), CommandError> {
    let (name, target_sha, message) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::create_tag(
        trust.inner(),
        &scope,
        window.label(),
        &name,
        &target_sha,
        message.as_deref(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn git_tag_delete(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitTagDeleteRequest,
) -> Result<(), CommandError> {
    let name = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::delete_tag(trust.inner(), &scope, window.label(), &name).await
}

#[tauri::command]
pub(crate) async fn git_remote_add(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitRemoteAddRequest,
) -> Result<(), CommandError> {
    let (name, url) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::add_remote(trust.inner(), &scope, window.label(), &name, &url).await
}

#[tauri::command]
pub(crate) async fn git_remote_rename(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitRemoteRenameRequest,
) -> Result<(), CommandError> {
    let (old_name, new_name) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::rename_remote(trust.inner(), &scope, window.label(), &old_name, &new_name).await
}

#[tauri::command]
pub(crate) async fn git_remote_set_url(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitRemoteSetUrlRequest,
) -> Result<(), CommandError> {
    let (name, kind, url) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::set_remote_url(trust.inner(), &scope, window.label(), &name, kind, &url).await
}

#[tauri::command]
pub(crate) async fn git_remote_remove(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitRemoteRemoveRequest,
) -> Result<(), CommandError> {
    let name = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::remove_remote(trust.inner(), &scope, window.label(), &name).await
}

#[tauri::command]
pub(crate) async fn git_upstream_set(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitUpstreamSetRequest,
) -> Result<(), CommandError> {
    let (branch, upstream) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::set_upstream(trust.inner(), &scope, window.label(), &branch, &upstream).await
}

#[tauri::command]
pub(crate) async fn git_upstream_unset(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitUpstreamUnsetRequest,
) -> Result<(), CommandError> {
    let branch = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    management::unset_upstream(trust.inner(), &scope, window.label(), &branch).await
}

#[tauri::command]
pub(crate) async fn git_history_state(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitHistoryStateRequest,
) -> Result<GitHistoryStateResultWire, CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let state = history_operation::state(trust.inner(), &scope, window.label()).await?;
    Ok(GitHistoryStateResultWire::from(state))
}

#[tauri::command]
pub(crate) async fn git_history_preview(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitHistoryPreviewRequest,
) -> Result<GitHistoryPreviewResultWire, CommandError> {
    let (operation, target_sha) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let preview = history_operation::preview(
        trust.inner(),
        &scope,
        window.label(),
        operation,
        &target_sha,
    )
    .await?;
    Ok(GitHistoryPreviewResultWire::from(preview))
}

#[tauri::command]
pub(crate) async fn git_merge(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, GitHistoryOperationService>,
    root_id: RootId,
    request: GitMergeRequest,
) -> Result<GitHistoryMutationOutcomeWire, CommandError> {
    let (target_sha, preview_token) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = history_operation::merge(
        trust.inner(),
        &scope,
        service.inner(),
        window.label(),
        &target_sha,
        &preview_token,
    )
    .await?;
    Ok(GitHistoryMutationOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_rebase(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, GitHistoryOperationService>,
    root_id: RootId,
    request: GitRebaseRequest,
) -> Result<GitHistoryMutationOutcomeWire, CommandError> {
    let (target_sha, preview_token) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = history_operation::rebase(
        trust.inner(),
        &scope,
        service.inner(),
        window.label(),
        &target_sha,
        &preview_token,
    )
    .await?;
    Ok(GitHistoryMutationOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_cherry_pick(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, GitHistoryOperationService>,
    root_id: RootId,
    request: GitCherryPickRequest,
) -> Result<GitHistoryMutationOutcomeWire, CommandError> {
    let (target_sha, preview_token) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = history_operation::cherry_pick(
        trust.inner(),
        &scope,
        service.inner(),
        window.label(),
        &target_sha,
        &preview_token,
    )
    .await?;
    Ok(GitHistoryMutationOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_revert(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, GitHistoryOperationService>,
    root_id: RootId,
    request: GitRevertRequest,
) -> Result<GitHistoryMutationOutcomeWire, CommandError> {
    let (target_sha, preview_token) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = history_operation::revert(
        trust.inner(),
        &scope,
        service.inner(),
        window.label(),
        &target_sha,
        &preview_token,
    )
    .await?;
    Ok(GitHistoryMutationOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_reset(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, GitHistoryOperationService>,
    root_id: RootId,
    request: GitResetRequest,
) -> Result<GitHistoryMutationOutcomeWire, CommandError> {
    let (operation, target_sha, preview_token) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = history_operation::reset(
        trust.inner(),
        &scope,
        service.inner(),
        window.label(),
        operation,
        &target_sha,
        &preview_token,
    )
    .await?;
    Ok(GitHistoryMutationOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_history_continue(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, GitHistoryOperationService>,
    root_id: RootId,
    request: GitHistoryContinueRequest,
) -> Result<GitHistoryMutationOutcomeWire, CommandError> {
    let kind = request.into_parts();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = history_operation::continue_operation(
        trust.inner(),
        &scope,
        service.inner(),
        window.label(),
        kind,
    )
    .await?;
    Ok(GitHistoryMutationOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_history_abort(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    service: State<'_, GitHistoryOperationService>,
    root_id: RootId,
    request: GitHistoryAbortRequest,
) -> Result<GitHistoryMutationOutcomeWire, CommandError> {
    let kind = request.into_parts();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = history_operation::abort_operation(
        trust.inner(),
        &scope,
        service.inner(),
        window.label(),
        kind,
    )
    .await?;
    Ok(GitHistoryMutationOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_history_cancel(
    window: WebviewWindow,
    service: State<'_, GitHistoryOperationService>,
    root_id: RootId,
    request: GitHistoryCancelRequest,
) -> Result<(), CommandError> {
    request.validate();
    service.request_cancel_for_root(window.label(), root_id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn git_stash_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitStashListRequest,
) -> Result<GitStashListResultWire, CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = stash::list_stashes(trust.inner(), &scope, window.label()).await?;
    Ok(GitStashListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_stash_show(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitStashShowRequest,
) -> Result<GitStashShowResultWire, CommandError> {
    let sha = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = stash::show_stash(trust.inner(), &scope, window.label(), &sha).await?;
    Ok(GitStashShowResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_stash_push(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitStashPushRequest,
) -> Result<GitStashPushOutcomeWire, CommandError> {
    let (message, include_untracked) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = stash::push_stash(
        trust.inner(),
        &scope,
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
    root_id: RootId,
    request: GitStashApplyRequest,
) -> Result<GitStashApplyOutcomeWire, CommandError> {
    let (sha, use_index) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome =
        stash::apply_stash(trust.inner(), &scope, window.label(), &sha, use_index).await?;
    Ok(GitStashApplyOutcomeWire::from(outcome))
}

#[tauri::command]
pub(crate) async fn git_stash_pop(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitStashPopRequest,
) -> Result<GitStashApplyOutcomeWire, CommandError> {
    let (expected_sha, use_index) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = stash::pop_stash(
        trust.inner(),
        &scope,
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
    root_id: RootId,
    request: GitStashDropRequest,
) -> Result<(), CommandError> {
    let expected_sha = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    stash::drop_stash(trust.inner(), &scope, window.label(), &expected_sha).await
}

#[tauri::command]
pub(crate) async fn git_worktree_list(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitWorktreeListRequest,
) -> Result<GitWorktreeListResultWire, CommandError> {
    request.validate();
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let result = worktree::list_worktrees(trust.inner(), &scope, window.label()).await?;
    Ok(GitWorktreeListResultWire::from(result))
}

#[tauri::command]
pub(crate) async fn git_worktree_add(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    root_id: RootId,
    request: GitWorktreeAddRequest,
) -> Result<GitWorktreeAddOutcomeWire, CommandError> {
    let (child_segment, detach, commit_ish) = request.into_parts()?;
    let picker = TauriDirectoryPicker::new(window.clone());
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome = worktree::add_worktree(
        trust.inner(),
        &scope,
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
    root_id: RootId,
    request: GitWorktreeRemoveRequest,
) -> Result<GitWorktreeRemoveOutcomeWire, CommandError> {
    let (path, force) = request.into_parts()?;
    let scope = SelectedGitRoot::new(workspace.inner(), root_id);
    let outcome =
        worktree::remove_worktree(trust.inner(), &scope, window.label(), &path, force).await?;
    Ok(GitWorktreeRemoveOutcomeWire::from(outcome))
}
