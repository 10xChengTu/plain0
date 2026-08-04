//! `F220` S3: converts between `remote::remote_fs`'s plain, backend-agnostic
//! types and this crate's existing `workspace::dto` wire types — the one
//! seam that lets `workspace::service` dispatch a `RemoteSsh`-backed root to
//! the real SFTP implementation while every IPC command, DTO, and frontend
//! codec stays byte-for-byte the contract S1/S2 already froze ("零 wire 协议
//!变化"). Never imports `russh_sftp` itself (that stays confined to
//! `remote::remote_fs` per ADR 0007 §1's own guard) — only the plain structs
//! that module returns.

use crate::error::CommandError;
use crate::path_policy::RelativePath;
use crate::remote::dto::RemoteSessionId;
use crate::remote::remote_fs::{self, RemoteEntryKind, RemoteEntryStat};
use crate::remote::session::RemoteSessionService;

use super::dto::{
    WorkspaceDirectoryEntry, WorkspaceEntryKind, WorkspaceEntryStat, WorkspaceReadDirectoryResult,
    WorkspaceWriteResult,
};
use super::reader::WorkspaceReadFileReceipt;
use super::RemoteRootContext;

fn to_kind(kind: RemoteEntryKind) -> WorkspaceEntryKind {
    match kind {
        RemoteEntryKind::File => WorkspaceEntryKind::File,
        RemoteEntryKind::Directory => WorkspaceEntryKind::Directory,
        RemoteEntryKind::Symlink => WorkspaceEntryKind::Symlink,
        RemoteEntryKind::SymlinkFile => WorkspaceEntryKind::SymlinkFile,
        RemoteEntryKind::SymlinkDirectory => WorkspaceEntryKind::SymlinkDirectory,
        RemoteEntryKind::Other => WorkspaceEntryKind::Other,
    }
}

fn to_entry_stat(stat: RemoteEntryStat) -> WorkspaceEntryStat {
    WorkspaceEntryStat::new(
        to_kind(stat.kind),
        stat.size,
        stat.mtime_ms,
        stat.ctime_ms,
        stat.version,
    )
}

pub(crate) async fn stat(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
) -> Result<WorkspaceEntryStat, CommandError> {
    let stat = remote_fs::stat(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        &context.host_key_fingerprint,
        relative_path,
    )
    .await?;
    Ok(to_entry_stat(stat))
}

pub(crate) async fn read_directory(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
) -> Result<WorkspaceReadDirectoryResult, CommandError> {
    let entries = remote_fs::read_directory(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        relative_path,
    )
    .await?;
    let entries = entries
        .into_iter()
        .map(|entry| WorkspaceDirectoryEntry::new(entry.name, to_kind(entry.kind)))
        .collect();
    Ok(WorkspaceReadDirectoryResult::new(entries))
}

/// Returns the same `PLR1`-framed raw byte response `workspace_read_file`
/// sends for a local root — see [`super::reader::WorkspaceReadFileReceipt::into_plr1_frame`].
pub(crate) async fn read_file(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
) -> Result<Vec<u8>, CommandError> {
    let result = remote_fs::read_file(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        &context.host_key_fingerprint,
        relative_path,
    )
    .await?;
    let stat = to_entry_stat(result.stat);
    WorkspaceReadFileReceipt::new(stat, result.content)?.into_plr1_frame()
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn write_file(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
    expected_version: &str,
    content: &[u8],
) -> Result<WorkspaceWriteResult, CommandError> {
    let stat = remote_fs::write_file(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        &context.host_key_fingerprint,
        relative_path,
        expected_version,
        content,
    )
    .await?;
    Ok(WorkspaceWriteResult::written(to_entry_stat(stat)))
}

pub(crate) async fn publish_file(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
    content: &[u8],
) -> Result<WorkspaceWriteResult, CommandError> {
    let stat = remote_fs::publish_file(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        &context.host_key_fingerprint,
        relative_path,
        content,
    )
    .await?;
    Ok(WorkspaceWriteResult::written(to_entry_stat(stat)))
}

pub(crate) async fn create_file(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
) -> Result<WorkspaceEntryStat, CommandError> {
    let stat = remote_fs::create_file(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        relative_path,
    )
    .await?;
    Ok(to_entry_stat(stat))
}

pub(crate) async fn create_directory(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
) -> Result<WorkspaceEntryStat, CommandError> {
    let stat = remote_fs::create_directory(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        relative_path,
    )
    .await?;
    Ok(to_entry_stat(stat))
}

pub(crate) async fn rename(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    source_path: &RelativePath,
    target_path: &RelativePath,
) -> Result<(), CommandError> {
    remote_fs::rename_entry(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        source_path,
        target_path,
    )
    .await
}

pub(crate) struct RemoteDeleteOutcome {
    pub(crate) fully_deleted: bool,
    pub(crate) removed_entries: u32,
}

pub(crate) async fn delete_entry(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
    recursive: bool,
) -> Result<RemoteDeleteOutcome, CommandError> {
    let report = remote_fs::delete_entry(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        relative_path,
        recursive,
    )
    .await?;
    Ok(RemoteDeleteOutcome {
        fully_deleted: report.fully_deleted,
        removed_entries: report.removed_entries,
    })
}

/// `remote_workspace_add_root`'s own canonicalization step — resolves and
/// validates `path` as a directory on the live session, returning its
/// canonical absolute form (the future root's `base_path`). A thin
/// passthrough kept here (rather than called directly from
/// `workspace::commands`) so every `remote::remote_fs` touchpoint stays in
/// this one file.
pub(crate) async fn canonicalize_for_root(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    path: &str,
) -> Result<String, CommandError> {
    remote_fs::canonicalize_for_root(remote, window_label, session_id, path).await
}

/// Bounded, best-effort descendant count for a remote directory, used only
/// to populate the delete-confirmation plan's `descendant_entries` display
/// hint — a wrong or unavailable count never blocks or changes the actual
/// delete outcome, exactly like the local backend's own count (a UI hint,
/// not a safety property).
pub(crate) async fn count_descendants(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
    relative_path: &RelativePath,
) -> u32 {
    remote_fs::read_directory(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        relative_path,
    )
    .await
    .map(|entries| entries.len() as u32)
    .unwrap_or(0)
}
