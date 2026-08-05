use std::sync::Arc;

use tauri::{Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    WorkspaceCapabilities, WorkspaceCapabilitiesRequest, WorkspaceClearRecentRequest,
    WorkspaceCloseFolderRequest, WorkspaceCommitDeleteEntryRequest,
    WorkspaceCommitTrashEntryRequest, WorkspaceCopyRequest, WorkspaceDeleteBatchPlan,
    WorkspaceDeleteBatchRequest, WorkspaceDeleteResult, WorkspaceEntryRequest, WorkspaceEntryStat,
    WorkspaceMoveRequest, WorkspaceMoveResult, WorkspaceOpenFilesRequest, WorkspaceOpenFilesResult,
    WorkspaceOpenRecentRequest, WorkspacePickRootsRequest, WorkspacePickRootsResult,
    WorkspacePickRootsStatus, WorkspacePickSaveTargetRequest, WorkspacePickSaveTargetResult,
    WorkspacePrepareDeleteRequest, WorkspacePrepareTrashRequest, WorkspaceReadDirectoryResult,
    WorkspaceRecentListRequest, WorkspaceRecentListResult, WorkspaceRemoveRecentRequest,
    WorkspaceRemoveRootRequest, WorkspaceRenameRequest, WorkspaceSnapshot,
    WorkspaceSnapshotRequest, WorkspaceTrashBatchPlan, WorkspaceTrashBatchRequest,
    WorkspaceTrashResult, WorkspaceWatchSyncRequest, WorkspaceWatchSyncResult,
    WorkspaceWatchWakeEvent, WorkspaceWriteResult,
};
use super::picker::{TauriDirectoryPicker, TauriFilePicker};
use super::service::WorkspaceService;
use crate::recent::service::{WorkspaceHistoryRoot, WorkspaceHistoryService};
use crate::remote::session::RemoteSessionService;

pub(crate) const WORKSPACE_WATCH_WAKE_EVENT: &str = "plain://workspace-watch-wake";

fn workspace_watch_wake_sink(
    window: &WebviewWindow,
) -> Arc<dyn Fn(super::WorkspaceId) + Send + Sync> {
    let app = window.app_handle().clone();
    let window_label = window.label().to_owned();
    Arc::new(move |workspace_id| {
        let _ = app.emit_to(
            EventTarget::webview_window(window_label.clone()),
            WORKSPACE_WATCH_WAKE_EVENT,
            WorkspaceWatchWakeEvent::new(workspace_id),
        );
    })
}

/// Records the window's current root set into Recent — both backends. Local
/// roots come straight from [`WorkspaceService::history_roots`], unchanged
/// from before `F220`. Remote roots (`F220` S4, ADR 0007 §4) need one extra
/// step: [`WorkspaceService::remote_history_roots`] only ever has a
/// `session_id` to offer (see that method's own doc comment for why), so
/// each one is resolved to its live `(host, port, user)` here, against a
/// single up-front `remote.state(window_label)` snapshot of every session
/// still live in this window. **A remote root whose session has already
/// disconnected is silently skipped** — its `session_id` no longer appears
/// in that snapshot, so there is nothing to resolve `host`/`port`/`user`
/// from. This is a deliberate, narrow degradation: losing one stale remote
/// root from this Recent entry is preferable to failing the *entire*
/// recording (and therefore silently dropping every local root too) just
/// because one remote root's session happened to die moments earlier.
async fn record_current_workspace(
    window_label: &str,
    service: &WorkspaceService,
    history: &WorkspaceHistoryService,
    remote: &RemoteSessionService,
) -> Result<(), CommandError> {
    let roots = service
        .history_roots(window_label)?
        .into_iter()
        .map(|(canonical_path, display_name)| WorkspaceHistoryRoot {
            canonical_path,
            display_name,
        })
        .collect::<Vec<_>>();
    let live_sessions = remote.state(window_label);
    let remote_roots = service
        .remote_history_roots(window_label)?
        .into_iter()
        .filter_map(|(session_id, canonical_path, display_name)| {
            live_sessions
                .sessions
                .iter()
                .find(|entry| entry.session_id == session_id)
                .map(|entry| crate::recent::service::WorkspaceHistoryRemoteRoot {
                    host: entry.host.clone(),
                    port: entry.port,
                    user: entry.user.clone(),
                    canonical_path,
                    display_name,
                })
        })
        .collect::<Vec<_>>();
    let history = history.clone();
    tauri::async_runtime::spawn_blocking(move || history.record(&roots, &remote_roots))
        .await
        .map_err(|_| workspace_history_unavailable())?
}

fn workspace_history_unavailable() -> CommandError {
    CommandError::new(
        "WORKSPACE_HISTORY_UNAVAILABLE",
        "Recent workspaces are unavailable.",
    )
}

#[tauri::command]
pub(crate) fn workspace_capabilities(
    _window: WebviewWindow,
    request: WorkspaceCapabilitiesRequest,
) -> WorkspaceCapabilities {
    request.validate();
    WorkspaceCapabilities::current_platform()
}

#[tauri::command]
pub(crate) async fn workspace_snapshot(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceSnapshotRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    request.validate();
    let last_roots = if crate::window::should_restore_last_workspace(window.label()) {
        let history = history.inner().clone();
        tauri::async_runtime::spawn_blocking(move || history.last_roots())
            .await
            .map_err(|_| workspace_history_unavailable())?
    } else {
        Ok(None)
    };
    service
        .initial_snapshot_with_restore(
            window.label(),
            last_roots,
            workspace_watch_wake_sink(&window),
        )
        .await
}

#[tauri::command]
pub(crate) async fn workspace_pick_roots(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspacePickRootsRequest,
) -> Result<WorkspacePickRootsResult, CommandError> {
    let picker = TauriDirectoryPicker::new(window.clone());
    let result = service
        .pick_roots_with_watch_sink(
            window.label(),
            picker,
            request.mode(),
            workspace_watch_wake_sink(&window),
        )
        .await?;
    if result.status() == WorkspacePickRootsStatus::Selected {
        record_current_workspace(
            window.label(),
            service.inner(),
            history.inner(),
            remote.inner(),
        )
        .await?;
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn workspace_open_files(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceOpenFilesRequest,
) -> Result<WorkspaceOpenFilesResult, CommandError> {
    request.validate();
    let result = service
        .pick_files_with_watch_sink(
            window.label(),
            TauriFilePicker::new(window.clone()),
            workspace_watch_wake_sink(&window),
        )
        .await?;
    if result.status() == WorkspacePickRootsStatus::Selected {
        record_current_workspace(
            window.label(),
            service.inner(),
            history.inner(),
            remote.inner(),
        )
        .await?;
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn workspace_pick_save_target(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspacePickSaveTargetRequest,
) -> Result<WorkspacePickSaveTargetResult, CommandError> {
    let result = service
        .pick_save_target_with_watch_sink(
            window.label(),
            TauriFilePicker::new(window.clone()),
            request.into_suggested_name()?,
            workspace_watch_wake_sink(&window),
        )
        .await?;
    if result.status() == WorkspacePickRootsStatus::Selected {
        record_current_workspace(
            window.label(),
            service.inner(),
            history.inner(),
            remote.inner(),
        )
        .await?;
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn workspace_recent_list(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceRecentListRequest,
) -> Result<WorkspaceRecentListResult, CommandError> {
    request.validate();
    let history = history.inner().clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || history.snapshot())
        .await
        .map_err(|_| workspace_history_unavailable())??;
    Ok(WorkspaceRecentListResult::new(
        snapshot.revision,
        service.restore_status(window.label())?,
        snapshot.entries,
    ))
}

#[tauri::command]
pub(crate) async fn workspace_open_recent(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceOpenRecentRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    let recent_id = request.recent_id();
    let history_clone = history.inner().clone();
    // `F220` S4 (ADR 0007 §4): `roots_for` only ever resolves the *local*
    // half of the stored entry (see its own doc comment) — a remote root
    // named by this recent entry is deliberately never auto-connected here,
    // exactly as it is not on cold start. Its data is not lost, though:
    // `workspace_recent_list` still reports it (via `remote_roots()` on this
    // same entry), which is how the frontend surfaces a "needs reconnect"
    // affordance for it.
    let roots = tauri::async_runtime::spawn_blocking(move || history_clone.roots_for(recent_id))
        .await
        .map_err(|_| workspace_history_unavailable())??;
    let snapshot = service
        .replace_roots_with_watch_sink(window.label(), roots, workspace_watch_wake_sink(&window))
        .await?;
    record_current_workspace(
        window.label(),
        service.inner(),
        history.inner(),
        remote.inner(),
    )
    .await?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn workspace_remove_recent(
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceRemoveRecentRequest,
) -> Result<(), CommandError> {
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || history.remove(request.recent_id()))
        .await
        .map_err(|_| workspace_history_unavailable())?
}

#[tauri::command]
pub(crate) async fn workspace_clear_recent(
    history: State<'_, WorkspaceHistoryService>,
    request: WorkspaceClearRecentRequest,
) -> Result<(), CommandError> {
    request.validate();
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || history.clear())
        .await
        .map_err(|_| workspace_history_unavailable())?
}

#[tauri::command]
pub(crate) async fn workspace_watch_sync(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceWatchSyncRequest,
) -> Result<WorkspaceWatchSyncResult, CommandError> {
    service
        .watch_sync(window.label(), request.into_parts()?)
        .await
}

#[tauri::command]
pub(crate) async fn workspace_remove_root(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceRemoveRootRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    let snapshot = service.remove_root(window.label(), request.root_id())?;
    record_current_workspace(
        window.label(),
        service.inner(),
        history.inner(),
        remote.inner(),
    )
    .await?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn workspace_close_folder(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceCloseFolderRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    request.validate();
    let (snapshot, changed) = service.close_folder(window.label())?;
    if changed {
        record_current_workspace(
            window.label(),
            service.inner(),
            history.inner(),
            remote.inner(),
        )
        .await?;
    }
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn workspace_stat(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceEntryRequest,
) -> Result<WorkspaceEntryStat, CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    service
        .stat(window.label(), root_id, relative_path, remote.inner())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_read_dir(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceEntryRequest,
) -> Result<WorkspaceReadDirectoryResult, CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    service
        .read_directory(window.label(), root_id, relative_path, remote.inner())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_read_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceEntryRequest,
) -> Result<tauri::ipc::Response, CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    let bytes = service
        .read_file(window.label(), root_id, relative_path, remote.inner())
        .await?;
    Ok(raw_bytes_response(bytes))
}

#[tauri::command]
pub(crate) async fn workspace_write_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: tauri::ipc::Request<'_>,
) -> Result<WorkspaceWriteResult, CommandError> {
    let frame = super::write_frame::WorkspaceWriteFileFrame::parse_invoke_body(request.body())?;
    let (root_id, relative_path, expected_version, content) = frame.into_parts();
    service
        .write_file(
            window.label(),
            root_id,
            relative_path,
            expected_version,
            content,
            remote.inner(),
        )
        .await
}

#[tauri::command]
pub(crate) async fn workspace_publish_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: tauri::ipc::Request<'_>,
) -> Result<WorkspaceWriteResult, CommandError> {
    let frame = super::publish_frame::WorkspacePublishFileFrame::parse_invoke_body(request.body())?;
    let (root_id, relative_path, content) = frame.into_parts();
    service
        .publish_file(
            window.label(),
            root_id,
            relative_path,
            content,
            remote.inner(),
        )
        .await
}

#[tauri::command]
pub(crate) async fn workspace_create_file(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceEntryRequest,
) -> Result<WorkspaceEntryStat, CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    service
        .create_file(window.label(), root_id, relative_path, remote.inner())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_create_directory(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceEntryRequest,
) -> Result<WorkspaceEntryStat, CommandError> {
    let (root_id, relative_path) = request.into_parts()?;
    service
        .create_directory(window.label(), root_id, relative_path, remote.inner())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_rename(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceRenameRequest,
) -> Result<(), CommandError> {
    let (root_id, source_path, target_path) = request.into_parts()?;
    WorkspaceService::rename(
        service.inner(),
        window.label(),
        root_id,
        source_path,
        target_path,
        remote.inner(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn workspace_copy(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceCopyRequest,
) -> Result<(), CommandError> {
    let (source_root_id, source_path, target_root_id, target_path) = request.into_parts()?;
    WorkspaceService::copy_entry(
        service.inner(),
        window.label(),
        source_root_id,
        source_path,
        target_root_id,
        target_path,
    )
    .await
}

#[tauri::command]
pub(crate) async fn workspace_move(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceMoveRequest,
) -> Result<WorkspaceMoveResult, CommandError> {
    let (source_root_id, source_path, target_root_id, target_path) = request.into_parts()?;
    WorkspaceService::move_entry(
        service.inner(),
        window.label(),
        source_root_id,
        source_path,
        target_root_id,
        target_path,
    )
    .await
}

#[tauri::command]
pub(crate) async fn workspace_prepare_delete(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspacePrepareDeleteRequest,
) -> Result<WorkspaceDeleteBatchPlan, CommandError> {
    service
        .prepare_delete(window.label(), request.into_parts()?, remote.inner())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_cancel_delete(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceDeleteBatchRequest,
) -> Result<(), CommandError> {
    service
        .cancel_delete(window.label(), request.confirmation_id(), remote.inner())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_begin_delete(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceDeleteBatchRequest,
) -> Result<(), CommandError> {
    service
        .begin_delete(window.label(), request.confirmation_id(), remote.inner())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_commit_delete_entry(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, RemoteSessionService>,
    request: WorkspaceCommitDeleteEntryRequest,
) -> Result<WorkspaceDeleteResult, CommandError> {
    let (confirmation_id, entry_id, root_id, relative_path, recursive) = request.into_parts()?;
    service
        .commit_delete_entry(
            window.label(),
            confirmation_id,
            entry_id,
            root_id,
            relative_path,
            recursive,
            remote.inner(),
        )
        .await
}

#[tauri::command]
pub(crate) async fn workspace_prepare_trash(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspacePrepareTrashRequest,
) -> Result<WorkspaceTrashBatchPlan, CommandError> {
    service
        .prepare_trash(window.label(), request.into_parts()?)
        .await
}

#[tauri::command]
pub(crate) async fn workspace_cancel_trash(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceTrashBatchRequest,
) -> Result<(), CommandError> {
    service
        .cancel_trash(window.label(), request.confirmation_id())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_begin_trash(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceTrashBatchRequest,
) -> Result<(), CommandError> {
    service
        .begin_trash(window.label(), request.confirmation_id())
        .await
}

#[tauri::command]
pub(crate) async fn workspace_commit_trash_entry(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    request: WorkspaceCommitTrashEntryRequest,
) -> Result<WorkspaceTrashResult, CommandError> {
    let (confirmation_id, entry_id, root_id, relative_path) = request.into_parts()?;
    service
        .commit_trash_entry(
            window.label(),
            confirmation_id,
            entry_id,
            root_id,
            relative_path,
        )
        .await
}

fn raw_bytes_response(bytes: Vec<u8>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(bytes)
}

/// `F220` S3 (ADR 0007 §1): authorizes a remote directory (already browsed
/// via `remote_workspace_pick_directory`) as a new workspace root — the
/// real, user-reachable twin of `WorkspaceScope::authorize_remote_root_for_test`.
///
/// `F220` S4 addition: now also records into Recent, exactly like local
/// `workspace_pick_roots` already does — without this, a window whose only
/// root-set-changing action was adding a remote root would never produce a
/// Recent entry at all, which would make ADR 0007 §4's "Recent 记录远程 root"
/// (including a workspace made *entirely* of remote roots) practically
/// unreachable from the real product surface, not merely untested.
#[tauri::command]
pub(crate) async fn remote_workspace_add_root(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    history: State<'_, WorkspaceHistoryService>,
    remote: State<'_, crate::remote::session::RemoteSessionService>,
    request: crate::remote::dto::RemoteWorkspaceAddRootRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    let parts = request.into_parts()?;
    let canonical_path = super::remote_backend::canonicalize_for_root(
        remote.inner(),
        window.label(),
        parts.session_id,
        &parts.path,
    )
    .await?;
    let host_key_fingerprint = remote
        .inner()
        .session_host_key_fingerprint(window.label(), parts.session_id)?;
    let display_name = parts
        .display_name
        .unwrap_or_else(|| remote_root_display_name(&canonical_path));
    let (_root_id, snapshot) = service.authorize_remote_root(
        window.label(),
        parts.session_id,
        &host_key_fingerprint,
        &canonical_path,
        &display_name,
    )?;
    record_current_workspace(
        window.label(),
        service.inner(),
        history.inner(),
        remote.inner(),
    )
    .await?;
    Ok(snapshot)
}

/// `F220` S4 (ADR 0006 §5's own "显式重连是新的信任决策"): rebinds an
/// already-authorized remote root onto a brand-new SSH session. `root_id` is
/// unchanged by a reconnect (see `WorkspaceScope::reconnect_remote_root`'s
/// own doc comment) — only its `session_id` moves.
///
/// This function (not the thin `#[tauri::command]` wrapper below, which
/// needs a live `WebviewWindow` no hermetic test can construct) is where
/// every actual trust/identity check for a reconnect lives, so it is
/// unit-testable on its own: `workspace::commands::tests` drives it directly
/// against a real hermetic SFTP fixture.
///
/// 1. Reads the root's *originally recorded* `(base_path, host_key_fingerprint)`
///    via `service.remote_context` — never anything about the *new* session
///    until step 2.
/// 2. Compares that fingerprint against `new_session_id`'s own live,
///    just-authenticated one (`remote.session_host_key_fingerprint`). A
///    mismatch means the freshly (re)connected session speaks for a
///    *different* host identity than the one this root was authorized
///    under — `remote_root_identity_changed()`, and the root is left
///    completely untouched (no state mutated on this branch).
/// 3. Re-`realpath`s the root's original `base_path` over the *new* session
///    (`remote_backend::canonicalize_for_root`). If that call itself fails
///    (e.g. the path no longer exists), its error is propagated verbatim —
///    this function invents no new code for "cannot resolve at all". If it
///    succeeds but resolves to a *different* canonical path,
///    `remote_root_path_changed()` — again, the root is left untouched.
/// 4. Only once both checks pass does this call
///    `service.reconnect_remote_root`, which itself performs no further
///    verification (see its own doc comment) — every check that matters has
///    already happened above.
async fn reconnect_remote_root(
    service: &WorkspaceService,
    remote: &crate::remote::session::RemoteSessionService,
    window_label: &str,
    root_id: super::RootId,
    new_session_id: crate::remote::dto::RemoteSessionId,
) -> Result<WorkspaceSnapshot, CommandError> {
    let context = service
        .remote_context(window_label, root_id)?
        .ok_or_else(crate::workspace::root_backend_unsupported)?;
    let live_fingerprint = remote.session_host_key_fingerprint(window_label, new_session_id)?;
    if live_fingerprint != context.host_key_fingerprint {
        return Err(crate::remote::remote_root_identity_changed());
    }
    let recanonicalized = super::remote_backend::canonicalize_for_root(
        remote,
        window_label,
        new_session_id,
        &context.base_path,
    )
    .await?;
    if recanonicalized != context.base_path {
        return Err(crate::remote::remote_root_path_changed());
    }
    service.reconnect_remote_root(window_label, root_id, new_session_id)
}

/// Thin `#[tauri::command]` wrapper over [`reconnect_remote_root`] — see that
/// function's own doc comment for the full contract.
#[tauri::command]
pub(crate) async fn remote_workspace_reconnect_root(
    window: WebviewWindow,
    service: State<'_, WorkspaceService>,
    remote: State<'_, crate::remote::session::RemoteSessionService>,
    request: crate::remote::dto::RemoteWorkspaceReconnectRootRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    let parts = request.into_parts();
    reconnect_remote_root(
        service.inner(),
        remote.inner(),
        window.label(),
        parts.root_id,
        parts.session_id,
    )
    .await
}

/// Mirrors `workspace::root_display_name`'s own "last path segment, or a
/// generic fallback for the root" shape, adapted to a `/`-separated remote
/// path string instead of an ambient `Path`.
fn remote_root_display_name(canonical_path: &str) -> String {
    match canonical_path.trim_end_matches('/').rsplit('/').next() {
        Some(segment) if !segment.is_empty() => segment.to_owned(),
        _ => "Remote Root".to_owned(),
    }
}

#[cfg(test)]
mod tests;
