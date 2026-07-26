//! Rust Git domain (`F080` of `docs/research/2026-07-25-core-git.md`, itself
//! building on ADR `docs/decisions/0003-native-git-and-generic-dap.md`).
//! S0 built the hardened spawn primitive ([`exec::run_git`]) and repository
//! discovery ([`discovery::discover_repository`]), both pure Rust exercised
//! only by `#[cfg(test)]`. S1 added the porcelain-v2/diff parsers
//! ([`status`]/[`diff`]), the repository-resolution helper shared by every
//! command ([`repo::resolve_repo_toplevel`]) and the wire DTOs ([`dto`]). S3
//! activated [`exec::GitExecMode::Write`] for [`stage`]/[`commit`]/
//! [`discard`]. S4 activates [`exec::GitExecMode::Network`] for [`network`]
//! (fetch/pull/push, each gated by a mandatory ahead/behind preview + confirm
//! step — see [`network`]'s own module doc comment).
//!
//! # Subprocess spawning is `exec::run_git`-only
//!
//! Every subprocess this domain spawns goes through [`exec::run_git`] —
//! never `std::process::Command` directly anywhere else in this module tree,
//! and never by asking a shell to interpret a concatenated command string.
//! Unlike `terminal::` (whose `portable_pty::CommandBuilder` is an
//! interactive-PTY API entirely unsuited to a one-shot, non-interactive
//! capture like `git status`/`git diff`), this domain's spawn primitive is a
//! plain `std::process::Command` — but confined to exactly one audited file,
//! [`exec`], by `scripts/plain/boundary-contracts.mjs`'s
//! `validateTerminalRustBoundary` (the spawn-guard function predates this
//! domain and was not renamed — see that function's own doc comment for why
//! keeping the existing name was the lower-risk choice here). Every other
//! `.rs` file under `src-tauri/src/git/` is mechanically forbidden from
//! naming `std::process::Command` at all; the guard's failure message for
//! this domain points here instead of at `portable_pty::CommandBuilder`.
//!
//! # Trust gate before spawn
//!
//! Exactly like `terminal::service::TerminalService::start`, every code path
//! that ends in an actual `exec::run_git` call checks
//! `TrustService::require_trusted` *first* — see [`discovery::discover_repository`]
//! for the one entry point this slice provides. Repository discovery itself
//! additionally has a *fully spawn-free* branch for the untrusted (or
//! `EMPTY`) workspace case, per ADR 0003: "未信任 workspace 不启动 Git 子进程，
//! 只通过文件系统识别仓库标记" — only once the workspace is trusted does
//! discovery escalate to actually spawning `git rev-parse --show-toplevel`
//! to confirm the filesystem marker.
//!
//! # All three exec modes are now active
//!
//! [`exec::GitExecMode`] enumerates `BackgroundRead`, `Write` and `Network`
//! (decision 3's full command set — status/diff/hunk stage/commit/discard/
//! fetch/pull/push — needs all three, and all three are now implemented).
//! `BackgroundRead` (`F080` S0) suppresses hooks/fsmonitor/external diff/
//! textconv/credential prompts entirely. `Write` (`F080` S3, [`stage`]/
//! [`commit`]/[`discard`]) and `Network` (`F080` S4, [`network`]) both
//! respect the repository's own hooks/fsmonitor configuration (a
//! user-initiated action, per ADR 0003) but differ in credential/SSH
//! handling — see `exec::harden_write`/`exec::harden_network`'s own doc
//! comments for the precise deltas from `harden_background_read` and from
//! each other.

use crate::error::CommandError;

pub(crate) mod commands;
pub(crate) mod commit;
pub(crate) mod diff;
pub(crate) mod discard;
pub(crate) mod discovery;
pub mod dto;
pub(crate) mod exec;
pub(crate) mod network;
pub(crate) mod repo;
pub(crate) mod stage;
pub(crate) mod status;
pub(crate) mod wire;

pub(crate) fn git_cwd_invalid() -> CommandError {
    CommandError::new(
        "GIT_CWD_INVALID",
        "The requested directory is not inside an authorized workspace root, or does not exist.",
    )
}

pub(crate) fn git_exec_unavailable() -> CommandError {
    CommandError::new(
        "GIT_EXEC_UNAVAILABLE",
        "The git subprocess could not be started.",
    )
}

pub(crate) fn git_exec_timeout() -> CommandError {
    CommandError::new(
        "GIT_EXEC_TIMEOUT",
        "The git subprocess did not finish in time and was terminated.",
    )
}

pub(crate) fn git_exec_cancelled() -> CommandError {
    CommandError::new(
        "GIT_EXEC_CANCELLED",
        "The git subprocess was cancelled and was terminated.",
    )
}

pub(crate) fn git_exec_output_limit_exceeded() -> CommandError {
    CommandError::new(
        "GIT_EXEC_OUTPUT_LIMIT_EXCEEDED",
        "The git subprocess produced more output than the allowed limit and was terminated.",
    )
}

/// Returned when [`exec::run_git`]'s `GitExecMode::BackgroundRead` bootstrap
/// step (`git config --list -z`, used to discover which `filter.<name>`
/// drivers must be neutralized before the real command spawns — see
/// `exec::harden_background_read`'s own doc comment) itself fails to spawn or
/// exits non-zero. Deliberately a **hard failure**, never silently treated as
/// "no filters configured": ADR 0003 forbids a fail-open fallback, and
/// treating an unreadable/unparseable config as "nothing to neutralize"
/// would be exactly that.
pub(crate) fn git_exec_filter_discovery_failed() -> CommandError {
    CommandError::new(
        "GIT_EXEC_FILTER_DISCOVERY_FAILED",
        "The git subprocess could not read repository configuration to determine which \
         content filters must be neutralized for a background read.",
    )
}

/// `F080` S1: returned by [`repo::resolve_repo_toplevel`] whenever the
/// current window's authorized workspace root does not resolve to a
/// confirmed Git working tree — either there is no authorized root at all
/// (`EMPTY` workspace) or `git rev-parse --show-toplevel` itself reported
/// (via a non-zero exit) that the root is not inside one. Trust is checked
/// first and separately (`WORKSPACE_NOT_TRUSTED`, from
/// [`crate::trust::service::TrustService::require_trusted`]), so this code
/// specifically means "trusted, but no repository here".
pub(crate) fn git_no_repository() -> CommandError {
    CommandError::new(
        "GIT_NO_REPOSITORY",
        "The current workspace root is not a Git repository.",
    )
}

#[cfg(test)]
mod tests {
    use super::{
        git_cwd_invalid, git_exec_cancelled, git_exec_filter_discovery_failed,
        git_exec_output_limit_exceeded, git_exec_timeout, git_exec_unavailable, git_no_repository,
    };

    #[test]
    fn error_constructors_have_stable_codes() {
        assert_eq!(git_cwd_invalid().code(), "GIT_CWD_INVALID");
        assert_eq!(git_exec_unavailable().code(), "GIT_EXEC_UNAVAILABLE");
        assert_eq!(git_exec_timeout().code(), "GIT_EXEC_TIMEOUT");
        assert_eq!(git_exec_cancelled().code(), "GIT_EXEC_CANCELLED");
        assert_eq!(
            git_exec_output_limit_exceeded().code(),
            "GIT_EXEC_OUTPUT_LIMIT_EXCEEDED"
        );
        assert_eq!(git_no_repository().code(), "GIT_NO_REPOSITORY");
        assert_eq!(
            git_exec_filter_discovery_failed().code(),
            "GIT_EXEC_FILTER_DISCOVERY_FAILED"
        );
    }
}
