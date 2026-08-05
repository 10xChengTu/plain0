//! Rust SSH remote-workspace session and host-key trust domain (`F220` S1 —
//! `docs/decisions/0006-ssh-remote-workspace-trust.md`,
//! `docs/decisions/0007-remote-workspace-capability.md`,
//! `docs/research/2026-08-05-ssh-remote-workspace.md`). This slice builds
//! exactly the "session and trust foundation" vertical: `remote_session_connect`/
//! `remote_host_key_confirm`/`remote_session_disconnect`/`remote_session_state`/
//! `remote_host_key_forget`/`remote_host_key_list`/`remote_session_connect_cancel`
//! — no remote filesystem, PTY, Git, or DAP transport yet (those are S2+, per
//! ADR 0007's own "逐域显式接入" decision and the research doc's vertical-slice
//! plan).
//!
//! # Module layout
//!
//! - [`dto`] — strict wire request/response DTOs, an opaque [`dto::RemoteSessionId`].
//! - [`known_hosts`] — Plain's own versioned, staged-atomic-write pinned
//!   known-hosts store (ADR 0006 §3).
//! - [`agent`] — the sole ssh-agent protocol client in this crate (ADR 0006
//!   §2: agent-only authentication, no password/key-file/passphrase path).
//! - [`session`] — [`session::RemoteSessionService`], the per-window live-
//!   session table and the two-phase host-key-confirmation connect flow.
//! - [`commands`] — the seven `#[tauri::command]`s above, each a thin
//!   wrapper over `RemoteSessionService`.
//!
//! # `russh` is this module's alone to import
//!
//! Every other module in this crate is mechanically forbidden from importing
//! `russh`/`russh::keys` or constructing an outbound `TcpStream`/`UnixStream`
//! bound for an SSH endpoint — `scripts/plain/boundary-contracts.mjs`'s
//! `validateRemoteSshLibraryOwnershipBoundary` locks this, mirroring
//! `git::mod`'s own "`exec.rs` is the sole `std::process::Command` wrapper"
//! discipline for a different kind of single-owner boundary.

use crate::error::CommandError;

pub(crate) mod agent;
pub mod commands;
pub mod dto;
pub(crate) mod known_hosts;
pub(crate) mod remote_fs;
pub mod session;
#[cfg(test)]
pub(crate) mod test_support;

pub(crate) fn remote_request_invalid() -> CommandError {
    CommandError::new(
        "REMOTE_REQUEST_INVALID",
        "The remote SSH request is missing required fields, exceeds a size limit, or contains \
         a character this domain does not accept.",
    )
}

/// Returned when the plain `TcpStream::connect`/SSH-handshake step fails for
/// any reason other than a host-key mismatch (connection refused, DNS
/// resolution failure, no route, a protocol-level rejection unrelated to the
/// host key) — see `session`'s own module doc for exactly how this is
/// distinguished from the host-key-specific outcomes.
pub(crate) fn remote_connect_failed() -> CommandError {
    CommandError::new(
        "REMOTE_CONNECT_FAILED",
        "Could not establish an SSH connection to the requested host.",
    )
}

/// Returned when `session::REMOTE_CONNECT_TIMEOUT` elapses before the
/// TCP+SSH-handshake phase completes.
pub(crate) fn remote_connect_timed_out() -> CommandError {
    CommandError::new(
        "REMOTE_CONNECT_TIMED_OUT",
        "Timed out waiting to establish an SSH connection to the requested host.",
    )
}

/// Returned when the caller's own `remote_session_connect_cancel` flips the
/// in-flight cancellation flag before the connect attempt otherwise
/// completed — mirrors `debug::debug_adapter_cancelled`'s identical
/// "cooperative cancellation observed" contract.
pub(crate) fn remote_connect_cancelled() -> CommandError {
    CommandError::new(
        "REMOTE_CONNECT_CANCELLED",
        "Connecting to the SSH host was cancelled.",
    )
}

/// Returned when `SSH_AUTH_SOCK` is unset, or the socket it names cannot be
/// reached at all — ADR 0006 §2's "无 agent…fail closed" case. Never
/// includes any key material.
pub(crate) fn remote_agent_unavailable() -> CommandError {
    CommandError::new(
        "REMOTE_AGENT_UNAVAILABLE",
        "No SSH agent is available to authenticate with (SSH_AUTH_SOCK is unset, or the agent \
         could not be reached).",
    )
}

/// Returned when the agent is reachable but reports zero identities — ADR
/// 0006 §2's "agent 无可用身份" case.
pub(crate) fn remote_agent_no_identities() -> CommandError {
    CommandError::new(
        "REMOTE_AGENT_NO_IDENTITIES",
        "The SSH agent has no identities loaded.",
    )
}

/// Returned when the server rejected every identity the agent offered — ADR
/// 0006 §2's "服务器拒绝所有身份" case.
pub(crate) fn remote_agent_auth_rejected() -> CommandError {
    CommandError::new(
        "REMOTE_AGENT_AUTH_REJECTED",
        "The server rejected every identity the SSH agent offered.",
    )
}

/// Returned when `agent::REMOTE_AGENT_AUTH_TIMEOUT` elapses before agent
/// authentication completes.
pub(crate) fn remote_agent_timed_out() -> CommandError {
    CommandError::new(
        "REMOTE_AGENT_TIMED_OUT",
        "Timed out waiting for the SSH agent to authenticate.",
    )
}

/// Returned when the live server presented a host key that does not match
/// what is pinned for `(host, port)` — ADR 0006 §3's "指纹变化:硬失败" case,
/// with **no** bypass. The message names the old and new fingerprints (and
/// algorithm) verbatim so the caller can render them without needing a
/// separate structured field — see `dto::RemoteSessionConnectResult`'s own
/// doc comment for why this is an error, never a result variant.
pub(crate) fn remote_host_key_changed(
    host: &str,
    port: u16,
    algorithm: &str,
    old_fingerprint: &str,
    new_fingerprint: &str,
) -> CommandError {
    CommandError::new(
        "REMOTE_HOST_KEY_CHANGED",
        format!(
            "The host key for {host}:{port} has changed. Previously pinned ({algorithm}): \
             {old_fingerprint}. Now offered: {new_fingerprint}. This may indicate the host was \
             reinstalled or a man-in-the-middle attack; the existing pin must be explicitly \
             forgotten (Plain: Forget SSH Host Key…) before reconnecting."
        ),
    )
}

/// Covers every known-hosts-store failure mode: directory-creation failure,
/// any I/O/(de)serialization failure reading or writing the staged file, or
/// the entry-count/byte-size ceiling being exceeded — mirrors
/// `trust::trust_unavailable`/`backup::backup_unavailable`'s identical "fold
/// every unrecoverable-differently case into one caller-facing code"
/// precedent.
pub(crate) fn remote_host_key_store_unavailable() -> CommandError {
    CommandError::new(
        "REMOTE_HOST_KEY_STORE_UNAVAILABLE",
        "The SSH known-hosts store is not available.",
    )
}

/// Returned by `session::RemoteSessionService::disconnect` when `session_id`
/// does not name a live session for the current window.
pub(crate) fn remote_session_not_found() -> CommandError {
    CommandError::new(
        "REMOTE_SESSION_NOT_FOUND",
        "The requested SSH session does not exist for this window.",
    )
}

/// Returned when a window already holds `dto::MAX_REMOTE_SESSIONS_PER_WINDOW`
/// live sessions — ADR 0006's own per-window session ceiling.
pub(crate) fn remote_session_limit_reached() -> CommandError {
    CommandError::new(
        "REMOTE_SESSION_LIMIT_REACHED",
        "This window already has the maximum number of live SSH sessions open.",
    )
}

/// `F220` S3: returned whenever an SFTP subsystem channel cannot be opened,
/// initialized, or completes a request with a transport-level failure this
/// domain does not have a more specific code for — folds "channel open
/// rejected", "subsystem request rejected", "SFTP protocol handshake
/// failed", and "the channel died mid-request" into one caller-facing code,
/// mirroring `remote_host_key_store_unavailable`'s identical "fold every
/// unrecoverable-differently case together" precedent.
pub(crate) fn remote_sftp_unavailable() -> CommandError {
    CommandError::new(
        "REMOTE_SFTP_UNAVAILABLE",
        "The remote SFTP channel is not available.",
    )
}

/// `F220` S3 (ADR 0007 §1): returned when a resolved remote path's SFTP
/// `realpath` re-validation lands outside the root's canonical base path —
/// the symlink-escape / TOCTOU rejection this domain's every path resolution
/// funnels through. Deliberately accurate and path-free, mirroring the local
/// backend's own `path_outside_root`.
pub(crate) fn remote_path_outside_root() -> CommandError {
    CommandError::new(
        "PATH_OUTSIDE_ROOT",
        "The workspace path is outside the authorized root.",
    )
}

/// `F220` S3: returned when a remote entry a filesystem operation named does
/// not exist — mirrors the local backend's own `ENTRY_NOT_FOUND`.
pub(crate) fn remote_entry_not_found() -> CommandError {
    CommandError::new("ENTRY_NOT_FOUND", "The workspace entry does not exist.")
}

/// `F220` S3: returned when a remote entry exists but has an incompatible
/// type for the requested operation (e.g. `stat`-ing a directory as a file)
/// — mirrors the local backend's own `ENTRY_TYPE_MISMATCH`.
pub(crate) fn remote_entry_type_mismatch() -> CommandError {
    CommandError::new(
        "ENTRY_TYPE_MISMATCH",
        "The workspace entry has an incompatible type.",
    )
}

/// `F220` S3: returned when a remote create/rename/publish target already
/// exists — mirrors the local backend's own `ENTRY_ALREADY_EXISTS`.
pub(crate) fn remote_entry_already_exists() -> CommandError {
    CommandError::new(
        "ENTRY_ALREADY_EXISTS",
        "The workspace entry already exists.",
    )
}

/// `F220` S3: returned when a remote directory listing or a recursive
/// delete would exceed this domain's bounded entry-count ceiling — mirrors
/// the local backend's own `DIRECTORY_TOO_LARGE`.
pub(crate) fn remote_directory_too_large() -> CommandError {
    CommandError::new(
        "DIRECTORY_TOO_LARGE",
        "The workspace directory exceeds the supported listing limits.",
    )
}

/// `F220` S3: returned when a remote file read/write would exceed this
/// domain's bounded size ceiling — mirrors the local backend's own
/// `FILE_TOO_LARGE`.
pub(crate) fn remote_file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace file exceeds the supported read/write limit.",
    )
}

/// `F220` S3: returned when a remote versioned write's `expected_version`
/// receipt no longer matches the live target (or the live target vanished
/// out from under an overwrite) — mirrors the local backend's own
/// `WORKSPACE_FILE_MODIFIED`.
pub(crate) fn remote_file_modified() -> CommandError {
    CommandError::new(
        "WORKSPACE_FILE_MODIFIED",
        "The workspace file changed before it could be written.",
    )
}

/// `F220` S3: a catch-all for a remote filesystem operation that failed for
/// a reason none of this domain's more specific codes name — mirrors the
/// local backend's own `IO_FAILED`.
pub(crate) fn remote_io_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be accessed.")
}

/// `F220` S3: returned when a remote versioned-write/publish request names
/// the workspace root itself (a file operation cannot target a directory) —
/// mirrors the local backend's own `INVALID_WORKSPACE_WRITE_REQUEST`.
pub(crate) fn remote_invalid_write_request() -> CommandError {
    CommandError::new(
        "INVALID_WORKSPACE_WRITE_REQUEST",
        "The workspace write request is invalid.",
    )
}

/// `F220` S3: returned when a remote-directory-picker or add-root request
/// names an absolute remote path this domain's own defensive shape check
/// (bounded length, no NUL bytes) rejects — deliberately independent of
/// [`remote_request_invalid`] (a different request shape) even though both
/// share the same wire code family.
pub(crate) fn remote_path_request_invalid() -> CommandError {
    CommandError::new(
        "REMOTE_REQUEST_INVALID",
        "The remote path request is missing required fields, exceeds a size limit, or contains \
         a character this domain does not accept.",
    )
}

/// `F220` S4 (ADR 0006 §5): returned whenever a filesystem operation reaches
/// an already-authorized `RemoteSsh` root whose bound SSH session is no
/// longer live. This is deliberately a distinct code from
/// [`remote_session_not_found`], even though `remote_fs::open`'s own
/// translation (see that function's doc comment) is the *only* place that
/// ever turns one into the other: `remote_session_not_found` is the right
/// code for a "session management" command (`remote_session_disconnect`/
/// `remote_session_state`/…) where the caller passed in a `sessionId` that
/// might simply never have existed, or might belong to a different window.
/// A workspace root's bound session id, by contrast, can never have been
/// bogus — a root only ever gets created by binding it to a session that was
/// real and live at that exact moment (`WorkspaceScope::authorize_remote_root`/
/// `reconnect_remote_root`) — so when a filesystem operation on that root
/// can no longer find its session, the only honest explanation is that the
/// session disconnected out from under it, not that it never existed.
/// Deliberately path-free.
pub(crate) fn remote_session_disconnected() -> CommandError {
    CommandError::new(
        "REMOTE_SESSION_DISCONNECTED",
        "The SSH session backing this workspace root is no longer connected.",
    )
}

/// `F220` S4 (ADR 0006 §5's own "显式重连是新的信任决策"): returned by
/// `remote_workspace_reconnect_root` when the just-authenticated session's
/// live host-key fingerprint does not match the fingerprint the target root
/// was originally authorized under — a different host identity, not a
/// reconnect of the same one. The caller must treat this as a brand-new
/// host (forget the stale pin, if any, and let the user decide whether to
/// trust the new identity) rather than silently rebinding an existing root
/// onto it. Deliberately fingerprint/path-free.
pub(crate) fn remote_root_identity_changed() -> CommandError {
    CommandError::new(
        "REMOTE_ROOT_IDENTITY_CHANGED",
        "The reconnected SSH session's host identity does not match this workspace root's \
         original identity.",
    )
}

/// `F220` S4: returned by `remote_workspace_reconnect_root` when the root's
/// original canonical base path no longer `realpath`s to the exact same
/// path over the freshly reconnected session (the directory was moved,
/// renamed, or replaced by something else since the root was first
/// authorized, or since it was last successfully reconnected). Deliberately
/// path-free; distinct from whatever error `remote::remote_fs::canonicalize_for_root`
/// itself raises when the path cannot be resolved at all (e.g. it no longer
/// exists) — that error is propagated as-is rather than folded into this
/// one, since "resolves, but to somewhere else" and "does not resolve at
/// all" are different, independently actionable outcomes.
pub(crate) fn remote_root_path_changed() -> CommandError {
    CommandError::new(
        "REMOTE_ROOT_PATH_CHANGED",
        "The workspace root's directory no longer resolves to the same remote path.",
    )
}

#[cfg(test)]
mod tests {
    use super::{
        remote_agent_auth_rejected, remote_agent_no_identities, remote_agent_timed_out,
        remote_agent_unavailable, remote_connect_cancelled, remote_connect_failed,
        remote_connect_timed_out, remote_host_key_changed, remote_host_key_store_unavailable,
        remote_request_invalid, remote_root_identity_changed, remote_root_path_changed,
        remote_session_disconnected, remote_session_limit_reached, remote_session_not_found,
    };

    #[test]
    fn error_constructors_have_stable_codes() {
        assert_eq!(remote_request_invalid().code(), "REMOTE_REQUEST_INVALID");
        assert_eq!(remote_connect_failed().code(), "REMOTE_CONNECT_FAILED");
        assert_eq!(
            remote_connect_timed_out().code(),
            "REMOTE_CONNECT_TIMED_OUT"
        );
        assert_eq!(
            remote_connect_cancelled().code(),
            "REMOTE_CONNECT_CANCELLED"
        );
        assert_eq!(
            remote_agent_unavailable().code(),
            "REMOTE_AGENT_UNAVAILABLE"
        );
        assert_eq!(
            remote_agent_no_identities().code(),
            "REMOTE_AGENT_NO_IDENTITIES"
        );
        assert_eq!(
            remote_agent_auth_rejected().code(),
            "REMOTE_AGENT_AUTH_REJECTED"
        );
        assert_eq!(remote_agent_timed_out().code(), "REMOTE_AGENT_TIMED_OUT");
        assert_eq!(
            remote_host_key_store_unavailable().code(),
            "REMOTE_HOST_KEY_STORE_UNAVAILABLE"
        );
        assert_eq!(
            remote_session_not_found().code(),
            "REMOTE_SESSION_NOT_FOUND"
        );
        assert_eq!(
            remote_session_limit_reached().code(),
            "REMOTE_SESSION_LIMIT_REACHED"
        );
        assert_eq!(
            remote_session_disconnected().code(),
            "REMOTE_SESSION_DISCONNECTED"
        );
        assert_eq!(
            remote_root_identity_changed().code(),
            "REMOTE_ROOT_IDENTITY_CHANGED"
        );
        assert_eq!(
            remote_root_path_changed().code(),
            "REMOTE_ROOT_PATH_CHANGED"
        );
    }

    #[test]
    fn host_key_changed_message_names_both_fingerprints_and_the_algorithm() {
        let error =
            remote_host_key_changed("example.com", 22, "ssh-ed25519", "SHA256:old", "SHA256:new");
        assert_eq!(error.code(), "REMOTE_HOST_KEY_CHANGED");
        assert!(error.message().contains("example.com:22"));
        assert!(error.message().contains("ssh-ed25519"));
        assert!(error.message().contains("SHA256:old"));
        assert!(error.message().contains("SHA256:new"));
    }
}
