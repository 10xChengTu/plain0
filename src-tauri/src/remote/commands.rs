//! `F220` S1's seven `#[tauri::command]`s — each a thin wrapper over
//! [`RemoteSessionService`], exactly mirroring `debug::commands`'s own "thin
//! wrapper: convert the request DTO via its own `into_parts`, call the
//! service, convert the result" shape.

use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::error::CommandError;

use super::dto::{
    RemoteHostKeyConfirmRequest, RemoteHostKeyListResult, RemoteHostTarget,
    RemoteSessionConnectRequest, RemoteSessionConnectResult, RemoteSessionEventPayload,
    RemoteSessionIdRequest, RemoteSessionStateResult, RemoteWorkspaceDirectoryPage,
    RemoteWorkspacePickDirectoryRequest,
};
use super::remote_fs;
use super::session::{RemoteSessionEventSink, RemoteSessionService};

/// Window-targeted session-lifecycle event stream — mirrors
/// `debug::commands::DEBUG_EVENT`/`terminal::commands::TERMINAL_DATA_EVENT`'s
/// exact `emit_to` precedent.
pub(crate) const REMOTE_SESSION_EVENT: &str = "plain://remote-session-event";

/// Real production [`RemoteSessionEventSink`]: emits straight to the
/// session's own window — mirrors `debug::commands::DebugWindowEventSink`'s
/// identical shape.
struct RemoteWindowEventSink {
    app: AppHandle,
    window_label: String,
}

impl RemoteSessionEventSink for RemoteWindowEventSink {
    fn emit(&self, payload: RemoteSessionEventPayload) {
        let _ = self.app.emit_to(
            EventTarget::webview_window(self.window_label.clone()),
            REMOTE_SESSION_EVENT,
            payload,
        );
    }
}

/// Connects to `(host, port)` as `user` — see `session`'s own module doc for
/// the full two-phase host-key-confirmation flow this drives.
#[tauri::command]
pub(crate) async fn remote_session_connect(
    window: WebviewWindow,
    remote: State<'_, RemoteSessionService>,
    request: RemoteSessionConnectRequest,
) -> Result<RemoteSessionConnectResult, CommandError> {
    let target = request.into_parts()?;
    let agent_socket_path = RemoteSessionService::resolve_agent_socket_path()?;
    let sink = RemoteWindowEventSink {
        app: window.app_handle().clone(),
        window_label: window.label().to_owned(),
    };
    remote
        .inner()
        .connect(window.label(), target, &agent_socket_path, &sink)
        .await
}

/// Pins the exact `(algorithm, sha256Fingerprint)` a prior
/// `remote_session_connect`'s `hostKeyPendingConfirmation` response reported,
/// then re-runs the connect flow — see `session::RemoteSessionService::confirm_host_key`'s
/// own doc comment.
#[tauri::command]
pub(crate) async fn remote_host_key_confirm(
    window: WebviewWindow,
    remote: State<'_, RemoteSessionService>,
    request: RemoteHostKeyConfirmRequest,
) -> Result<RemoteSessionConnectResult, CommandError> {
    let parts = request.into_parts()?;
    let agent_socket_path = RemoteSessionService::resolve_agent_socket_path()?;
    let sink = RemoteWindowEventSink {
        app: window.app_handle().clone(),
        window_label: window.label().to_owned(),
    };
    remote
        .inner()
        .confirm_host_key(window.label(), parts, &agent_socket_path, &sink)
        .await
}

/// Best-effort cancellation of whatever connect attempt is currently in
/// flight for this exact `(host, port)` in this window — a no-op if none is.
#[tauri::command]
pub(crate) async fn remote_session_connect_cancel(
    window: WebviewWindow,
    remote: State<'_, RemoteSessionService>,
    request: RemoteHostTarget,
) -> Result<(), CommandError> {
    let (host, port) = request.into_parts()?;
    remote
        .inner()
        .request_cancel_connect(window.label(), &host, port);
    Ok(())
}

/// Tears down a live session.
#[tauri::command]
pub(crate) async fn remote_session_disconnect(
    window: WebviewWindow,
    remote: State<'_, RemoteSessionService>,
    request: RemoteSessionIdRequest,
) -> Result<(), CommandError> {
    let session_id = request.into_parts();
    let sink = RemoteWindowEventSink {
        app: window.app_handle().clone(),
        window_label: window.label().to_owned(),
    };
    remote
        .inner()
        .disconnect(window.label(), session_id, &sink)
        .await
}

/// Lists every live session in this window.
#[tauri::command]
pub(crate) async fn remote_session_state(
    window: WebviewWindow,
    remote: State<'_, RemoteSessionService>,
) -> Result<RemoteSessionStateResult, CommandError> {
    Ok(remote.inner().state(window.label()))
}

/// Deletes a pinned host-key entry — idempotent.
#[tauri::command]
pub(crate) async fn remote_host_key_forget(
    remote: State<'_, RemoteSessionService>,
    request: RemoteHostTarget,
) -> Result<(), CommandError> {
    let (host, port) = request.into_parts()?;
    remote.inner().forget_host_key(&host, port).await
}

/// Lists every pinned host-key entry — the `Plain: Forget SSH Host Key…`
/// QuickPick's own data source.
#[tauri::command]
pub(crate) async fn remote_host_key_list(
    remote: State<'_, RemoteSessionService>,
) -> Result<RemoteHostKeyListResult, CommandError> {
    remote.inner().list_host_keys().await
}

/// `F220` S3: the remote directory picker's own IPC entry point — browses
/// an arbitrary absolute remote path (bounded to
/// [`super::dto::MAX_REMOTE_PICK_PAGE_SIZE`] directories per page), used by
/// the `Plain: Open Remote Folder…` QuickPick flow before any root exists
/// yet. Never touches `WorkspaceService`: this is purely a remote-session-
/// scoped read, exactly like `remote_session_state`.
#[tauri::command]
pub(crate) async fn remote_workspace_pick_directory(
    window: WebviewWindow,
    remote: State<'_, RemoteSessionService>,
    request: RemoteWorkspacePickDirectoryRequest,
) -> Result<RemoteWorkspaceDirectoryPage, CommandError> {
    let parts = request.into_parts()?;
    let page = remote_fs::pick_directory(
        remote.inner(),
        window.label(),
        parts.session_id,
        &parts.path,
        parts.offset,
        parts.limit,
    )
    .await?;
    Ok(RemoteWorkspaceDirectoryPage {
        canonical_path: page.canonical_path,
        parent_path: page.parent_path,
        entries: page.entries.into_iter().map(|entry| entry.name).collect(),
        total: u32::try_from(page.total).unwrap_or(u32::MAX),
        offset: u32::try_from(page.offset).unwrap_or(u32::MAX),
        has_more: page.has_more,
    })
}

#[cfg(test)]
mod tests {
    use super::REMOTE_SESSION_EVENT;

    #[test]
    fn remote_session_event_name_is_stable() {
        assert_eq!(REMOTE_SESSION_EVENT, "plain://remote-session-event");
    }
}
