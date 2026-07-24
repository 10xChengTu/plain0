//! Rust-authoritative workspace *execution trust* domain (F070 S1 "决策 1"
//! of `docs/research/2026-07-24-pty-terminal.md`).
//!
//! This is deliberately a domain of its own, not folded into `workspace::`:
//! the concept it tracks ("is it safe to run arbitrary subprocesses inside
//! the currently authorized root set") is orthogonal to file-capability
//! authorization itself and is shared by every native domain that spawns a
//! subprocess (PTY here, Git in `F080`, DAP in `F100`) — none of which are
//! part of `workspace::`. Reusing [`crate::workspace::WorkspaceRootsIdentity`]
//! (the same stable, order- and ambiguity-free hash of canonical root paths
//! already used to key the hot-exit backup directory) as the trust key means
//! "trust travels with the exact set of open directories": reopening the
//! same roots — in any window, in any process, after a restart — reproduces
//! the same trust decision, and changing the root set (add/remove/replace)
//! always requires a fresh grant, exactly like the backup domain's own
//! identity semantics.
//!
//! An `EMPTY` workspace (zero authorized roots) has no stable identity and
//! is therefore *always* untrusted — there is nothing to have granted trust
//! to, and nothing a spawned subprocess could be scoped against.

use crate::error::CommandError;

pub(crate) mod commands;
pub(crate) mod service;
mod store;

pub(crate) fn workspace_not_trusted() -> CommandError {
    CommandError::new(
        "WORKSPACE_NOT_TRUSTED",
        "This workspace has not been granted execution trust.",
    )
}

/// Covers both "there is no stable identity to grant/revoke trust for" (the
/// `EMPTY` workspace) and "the trust store could not be read or written"
/// (disk I/O failure) — mirroring `backup::backup_unavailable`'s exact
/// precedent of folding both cases into one caller-facing code, since
/// neither is something the caller can usefully distinguish or recover from
/// differently.
pub(crate) fn trust_unavailable() -> CommandError {
    CommandError::new(
        "TRUST_UNAVAILABLE",
        "The workspace trust store is not available for this window.",
    )
}

#[cfg(test)]
mod tests {
    use super::{trust_unavailable, workspace_not_trusted};

    #[test]
    fn error_constructors_have_stable_codes() {
        assert_eq!(workspace_not_trusted().code(), "WORKSPACE_NOT_TRUSTED");
        assert_eq!(trust_unavailable().code(), "TRUST_UNAVAILABLE");
    }
}
