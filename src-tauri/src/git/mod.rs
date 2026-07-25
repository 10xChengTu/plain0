//! Rust Git domain (`F080` S0+S1 of `docs/research/2026-07-25-core-git.md`,
//! itself building on ADR `docs/decisions/0003-native-git-and-generic-dap.md`).
//! S0 built the hardened spawn primitive ([`exec::run_git`]) and repository
//! discovery ([`discovery::discover_repository`]), both pure Rust exercised
//! only by `#[cfg(test)]`. S1 adds the porcelain-v2/diff parsers
//! ([`status`]/[`diff`]), the repository-resolution helper shared by every
//! command ([`repo::resolve_repo_toplevel`], the wiring
//! `discover_repository`'s own doc comment predicted), the wire DTOs
//! ([`dto`]) and the three Tauri commands this domain now registers
//! ([`commands::git_status`]/[`commands::git_diff_files`]/
//! [`commands::git_show_blob`]).
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
//! # Write mode is active; network mode is still deliberately unimplemented
//!
//! [`exec::GitExecMode`] enumerates `BackgroundRead`, `Write` and `Network`
//! (decision 3's full command set — status/diff/hunk stage/commit/discard/
//! fetch/pull/push — needs all three). `F080` S0 implemented only
//! `BackgroundRead`; `F080` S3 (this slice) activates `Write` for
//! [`stage`]/[`commit`]/[`discard`] — see `exec::harden_write`'s own doc
//! comment for exactly how it differs from `harden_background_read`.
//! `exec::run_git` still fails closed with [`git_exec_mode_unsupported`] for
//! `Network`: allowing credential-helper/SSH passthrough for fetch/pull/push
//! is explicitly `F080` S4's job, never something this slice silently
//! permits.

use crate::error::CommandError;

pub(crate) mod commands;
pub(crate) mod commit;
pub(crate) mod diff;
pub(crate) mod discard;
pub(crate) mod discovery;
pub mod dto;
pub(crate) mod exec;
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

pub(crate) fn git_exec_mode_unsupported() -> CommandError {
    CommandError::new(
        "GIT_EXEC_MODE_UNSUPPORTED",
        "This git execution mode is not implemented yet.",
    )
}

#[cfg(test)]
mod tests {
    use super::{
        git_cwd_invalid, git_exec_cancelled, git_exec_mode_unsupported,
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
        assert_eq!(
            git_exec_mode_unsupported().code(),
            "GIT_EXEC_MODE_UNSUPPORTED"
        );
        assert_eq!(git_no_repository().code(), "GIT_NO_REPOSITORY");
    }
}
