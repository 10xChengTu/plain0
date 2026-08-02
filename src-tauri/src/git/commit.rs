//! `F080` S3 commit: `git -c user.useConfigOnly=true commit --quiet --file -
//! [--amend]` — the message travels over stdin, never a command-line
//! argument (a message beginning with `-` must never be misread as a git
//! flag). Runs under [`GitExecMode::Write`] (see `exec::harden_write`'s own
//! doc comment): unlike `status`/`diff`'s hardened background reads, a
//! commit's `pre-commit`/`commit-msg`/`post-commit` hooks are deliberately
//! **not** suppressed — see `tests.rs`'s `commit_runs_the_repositorys_own_hooks`
//! for the executable proof, directly contrasted with
//! `exec::tests::background_read_disables_a_malicious_hooks_path_hook`.
//!
//! `user.useConfigOnly=true` (verbatim from
//! `docs/research/2026-07-25-core-git.md`) means this command never falls
//! back to guessing an identity from the OS user/hostname the way plain
//! `git commit` can — either the repository/global/system config already has
//! `user.name`/`user.email` set, or the commit fails with a structured error
//! (mapped by [`commit`] below), never a surprising auto-generated identity.

use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::exec::{run_git_with_stdin, GitExecMode};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};

/// Mirrors `dto::MAX_GIT_COMMIT_MESSAGE_BYTES` — see `git::stage`'s module
/// doc comment for why domain functions re-validate what the DTO layer
/// already checked.
const MAX_GIT_COMMIT_MESSAGE_BYTES: usize = 100_000;

fn git_commit_empty_message() -> CommandError {
    CommandError::new(
        "GIT_COMMIT_EMPTY_MESSAGE",
        "The commit message must not be empty.",
    )
}

fn git_commit_message_too_large() -> CommandError {
    CommandError::new(
        "GIT_COMMIT_MESSAGE_TOO_LARGE",
        "The commit message exceeds the allowed size limit.",
    )
}

/// `git commit`'s own "nothing to commit" outcome (exit `1`, the message
/// printed to **stdout**, not stderr — confirmed empirically against the
/// real `git 2.50.1` binary in this workspace) — surfaced as its own
/// structured code rather than the generic [`git_commit_failed`] so a caller
/// can show a specific, actionable message ("stage a change first") instead
/// of an opaque failure.
fn git_commit_nothing_to_commit() -> CommandError {
    CommandError::new(
        "GIT_COMMIT_NOTHING_TO_COMMIT",
        "There are no staged changes to commit.",
    )
}

fn git_commit_failed() -> CommandError {
    CommandError::new(
        "GIT_COMMIT_FAILED",
        "git commit did not complete successfully.",
    )
}

/// Runs [`GIT_COMMIT_ARGS`] (plus `--amend` when requested) through the
/// hardened write-mode exec path, with `message` supplied over stdin. Locked
/// exactly by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_COMMIT_ARGS: &[&str] = &[
    "-c",
    "user.useConfigOnly=true",
    "commit",
    "--quiet",
    "--file",
    "-",
];

pub(crate) async fn commit(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    message: &str,
    amend: bool,
) -> Result<(), CommandError> {
    if message.trim().is_empty() {
        return Err(git_commit_empty_message());
    }
    if message.len() > MAX_GIT_COMMIT_MESSAGE_BYTES {
        return Err(git_commit_message_too_large());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;

    let mut args: Vec<String> = GIT_COMMIT_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    if amend {
        args.push("--amend".to_owned());
    }
    let message_bytes = message.as_bytes().to_vec();
    let repo_dir_for_spawn = repo_dir.clone();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git_with_stdin(
            &repo_dir_for_spawn,
            &args,
            GitExecMode::Write,
            &cancel,
            &message_bytes,
        )
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if combined.contains("nothing to commit") {
            return Err(git_commit_nothing_to_commit());
        }
        return Err(git_commit_failed());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
