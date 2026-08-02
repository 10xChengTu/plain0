//! `F080` S3 discard: `git checkout -q -- <paths...>` — restores exactly the
//! given paths' working-tree content to the index's version, discarding any
//! unstaged edits. This is a **destructive, irreversible** operation from
//! Rust's point of view: this module only ever executes it, never confirms
//! it — the required "preview impact + require confirmation" UX (acceptance
//! criterion 5) lives entirely in the frontend (`IDialogService.confirm`,
//! see `app/features/scm/plain-scm-view.ts`), exactly like
//! `app/features/workspace/delete-coordinator.ts`'s own confirm-before-Rust-
//! call shape for the *other* irreversible operation in this codebase
//! (permanent delete).
//!
//! Empirically confirmed (this slice's own report) that `git checkout -q --`
//! validates every given pathspec *before* touching any of them: if one path
//! in the batch cannot be resolved (e.g. a caller mistakenly included an
//! untracked path, which has no index/HEAD version to restore from), the
//! whole invocation fails with a non-zero exit and **none** of the paths are
//! touched — so this module needs no partial-success bookkeeping, unlike
//! `workspace::delete`'s per-entry outcome tracking for a different,
//! genuinely-partial-failure-prone operation.

use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::dto::is_valid_mutate_path;
use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};

fn git_mutate_invalid_paths() -> CommandError {
    CommandError::new(
        "GIT_MUTATE_PATHS_INVALID_REQUEST",
        "The path list is empty, too large, or contains an invalid path.",
    )
}

fn git_discard_failed() -> CommandError {
    CommandError::new(
        "GIT_DISCARD_FAILED",
        "git checkout did not complete successfully.",
    )
}

/// `git checkout -q -- <paths...>`. Locked exactly by
/// `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_DISCARD_ARGS: &[&str] = &["checkout", "-q"];

pub(crate) async fn discard_paths(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    paths: &[String],
) -> Result<(), CommandError> {
    if paths.is_empty() || !paths.iter().all(|path| is_valid_mutate_path(path)) {
        return Err(git_mutate_invalid_paths());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let mut args: Vec<String> = GIT_DISCARD_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.push("--".to_owned());
    args.extend(paths.iter().cloned());

    let repo_dir_for_spawn = repo_dir.clone();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir_for_spawn, &args, GitExecMode::Write, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        return Err(git_discard_failed());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
