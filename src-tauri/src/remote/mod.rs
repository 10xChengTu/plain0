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
pub mod session;

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

#[cfg(test)]
mod tests {
    use super::{
        remote_agent_auth_rejected, remote_agent_no_identities, remote_agent_timed_out,
        remote_agent_unavailable, remote_connect_cancelled, remote_connect_failed,
        remote_connect_timed_out, remote_host_key_changed, remote_host_key_store_unavailable,
        remote_request_invalid, remote_session_limit_reached, remote_session_not_found,
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
