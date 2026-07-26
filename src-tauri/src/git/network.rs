//! `F080` S4: fetch/pull/push, each targeting exactly the current branch's
//! configured upstream (`@{upstream}`) — the same thing bare `git fetch`/
//! `git pull`/`git push` (no arguments) already resolve to on their own, so
//! this domain never re-implements git's own remote/refspec resolution
//! logic (ADR 0003: never a general-purpose `git_run`).
//!
//! # Deliberate scope: one upstream, not an arbitrary remote/branch picker
//!
//! `pull`/`push` fail closed with [`git_network_no_upstream`] when the
//! current branch has no upstream configured — the same thing running the
//! real bare command would do anyway (verified empirically: `git push` with
//! no upstream fails with "The current branch … has no upstream branch";
//! `git pull` fails with "no tracking information"), so this is not an extra
//! restriction, just an earlier, cleaner one before ever spawning the write.
//! `fetch` tolerates a missing upstream (bare `git fetch` genuinely still
//! works without one, per git's own docs: it falls back to the `origin`
//! remote) — see [`preview`]'s own doc comment. A UI for choosing a
//! different remote/branch than the configured upstream, or for creating one
//! (`--set-upstream`), is out of scope for this slice — a disclosed
//! narrowing, not an oversight.
//!
//! # Preview + confirm is mandatory and never fail-open
//!
//! ADR 0003 / acceptance criterion 5: "fetch/pull/push 和所有破坏性动作在显示
//! 目标/影响后确认。不得提供通用命令或 fail-open 回退。" [`preview`] is the
//! dedicated ahead/behind computation the frontend's confirmation dialog
//! (`app/features/scm/plain-scm-network.ts`) always calls *before* ever
//! showing that dialog — if it rejects for any reason, the caller must not
//! fall back to executing the operation anyway (locked by
//! `scripts/plain/boundary-contracts.mjs`'s
//! `validateGitNetworkConfirmationBoundary`, the same discipline
//! `validateGitDiscardConfirmationBoundary` already established for
//! `F080` S3's discard). Notably, [`preview`] itself never spawns a network
//! subprocess at all: `@{upstream}` resolution and the ahead/behind count are
//! both pure local-ref/local-object-database reads, run under
//! [`GitExecMode::BackgroundRead`] exactly like `status`/`diff` — only
//! [`fetch`]/[`pull`]/[`push`] themselves ever use
//! [`GitExecMode::Network`]/[`super::exec::run_git_network`].
//!
//! # Force push: `--force-with-lease`, never bare `--force`
//!
//! [`push`]'s `force` parameter always emits [`GIT_PUSH_FORCE_ARGS`]
//! (`--force-with-lease`) — this domain does not expose plain `--force` at
//! all, not even as a second, harder-to-reach option. Verified empirically
//! (this slice's own report, real local bare-repository transcripts):
//! `--force-with-lease` still fails ("stale info") when the remote-tracking
//! ref this process last observed is not what the remote actually has right
//! now (i.e. someone else pushed in the meantime), where bare `--force`
//! would silently clobber it; refusing to offer the unsafe variant at all is
//! a deliberate, disclosed narrowing in the safer direction, not a missing
//! feature.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::exec::{run_git, run_git_network, GitExecMode, GitExecOutput};
use super::git_exec_unavailable;
use super::repo::resolve_repo_toplevel;

/// The git revision expression for "the current branch's configured
/// upstream" — resolved via `git rev-parse --abbrev-ref --symbolic-full-name`
/// (a display name like `"origin/main"`) and via `git rev-list --left-right
/// --count` (an ahead/behind count), never parsed out of
/// `branch.<name>.remote`/`branch.<name>.merge` config by hand — letting git
/// itself resolve the expression is both simpler and exactly matches what a
/// bare `git pull`/`git push` would use.
const GIT_UPSTREAM_REV: &str = "@{upstream}";

fn git_network_no_upstream() -> CommandError {
    CommandError::new(
        "GIT_NETWORK_NO_UPSTREAM",
        "The current branch has no upstream configured.",
    )
}

fn git_network_preview_failed() -> CommandError {
    CommandError::new(
        "GIT_NETWORK_PREVIEW_FAILED",
        "The ahead/behind preview could not be computed.",
    )
}

fn git_fetch_failed() -> CommandError {
    CommandError::new(
        "GIT_FETCH_FAILED",
        "git fetch did not complete successfully.",
    )
}

fn git_pull_failed() -> CommandError {
    CommandError::new("GIT_PULL_FAILED", "git pull did not complete successfully.")
}

/// `git pull`'s own "divergent branches, no reconcile strategy configured"
/// outcome (confirmed empirically against the real `git 2.50.1` binary:
/// exit `128`, stderr contains "Need to specify how to reconcile divergent
/// branches") — surfaced as its own structured code, distinct from the
/// generic [`git_pull_failed`], so a caller can show specific, actionable
/// copy rather than an opaque failure. This domain deliberately does **not**
/// auto-configure `pull.rebase`/`--ff-only` on the caller's behalf — a user's
/// or repository's own reconciliation-strategy configuration is respected,
/// exactly like `GitExecMode::Write` respects hooks (ADR 0003).
fn git_pull_needs_strategy() -> CommandError {
    CommandError::new(
        "GIT_PULL_NEEDS_STRATEGY",
        "Divergent branches need a reconcile strategy (merge, rebase, or fast-forward-only) \
         configured before pulling.",
    )
}

fn git_push_failed() -> CommandError {
    CommandError::new("GIT_PUSH_FAILED", "git push did not complete successfully.")
}

/// `git push`'s own "current branch has no upstream branch" outcome
/// (confirmed empirically) — distinguished from [`git_push_failed`] for the
/// same reason [`git_pull_needs_strategy`] is. In practice [`preview`]
/// already rejects with [`git_network_no_upstream`] before `push` is ever
/// called for this exact case; this exists as defense-in-depth against the
/// narrow race where the upstream configuration changes between the preview
/// call and the push call.
fn git_push_no_upstream() -> CommandError {
    CommandError::new(
        "GIT_PUSH_NO_UPSTREAM",
        "The current branch has no upstream branch configured.",
    )
}

/// `git push`'s non-fast-forward/`--force-with-lease` stale-info rejection —
/// distinguished from [`git_push_failed`] so a caller can suggest "fetch (or
/// pull) first" (plain push) or "someone else pushed since you last fetched"
/// (force-with-lease) rather than an opaque failure.
fn git_push_rejected() -> CommandError {
    CommandError::new(
        "GIT_PUSH_REJECTED",
        "The remote rejected the push (it has commits this branch does not).",
    )
}

/// Locked exactly by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_FETCH_ARGS: &[&str] = &["fetch", "--quiet"];
/// Locked exactly by `scripts/plain/boundary-contracts.mjs`. Deliberately
/// does *not* include a reconcile-strategy flag (`--rebase`/`--no-rebase`/
/// `--ff-only`) — see [`git_pull_needs_strategy`]'s own doc comment.
pub(crate) const GIT_PULL_ARGS: &[&str] = &["pull", "--quiet"];
/// Locked exactly by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_PUSH_ARGS: &[&str] = &["push", "--quiet"];
/// Locked exactly by `scripts/plain/boundary-contracts.mjs`. `--force-with-lease`,
/// never bare `--force` — see this module's own doc comment.
pub(crate) const GIT_PUSH_FORCE_ARGS: &[&str] = &["push", "--quiet", "--force-with-lease"];

/// Which network operation a [`preview`]/confirmation is being computed for
/// — only [`NetworkOperation::Fetch`] tolerates a missing upstream (see this
/// module's own doc comment for why).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NetworkOperation {
    Fetch,
    Pull,
    Push,
}

/// The ahead/behind preview the frontend's confirmation dialog always shows
/// before ever calling [`fetch`]/[`pull`]/[`push`]. `upstream` is `None`
/// only for [`NetworkOperation::Fetch`] against a branch with no upstream
/// configured (in which case `ahead`/`behind` are also `None` — there is
/// nothing local to compare against).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NetworkPreview {
    pub(crate) upstream: Option<String>,
    pub(crate) ahead: Option<u64>,
    pub(crate) behind: Option<u64>,
}

/// Tracks at most one in-flight `F080` S4 network operation (fetch/pull/
/// push) per window, so [`GitNetworkService::request_cancel`] can reach the
/// real cooperative-cancellation flag `run_git_network`'s `wait_with_limits`
/// poll loop already checks (`F080` S0's mechanism — this service is simply
/// the first thing in this domain that actually *exposes* it to a caller,
/// because no write command before this slice was slow enough to need a
/// user-reachable cancel path). A single flag per window — not a registry
/// keyed by an operation id — is enough: the frontend already enforces "at
/// most one mutation in flight" (`PlainScmView`'s `#mutationInFlight`).
#[derive(Default)]
pub struct GitNetworkService {
    inflight: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl GitNetworkService {
    pub fn new() -> Self {
        Self::default()
    }

    fn begin(&self, window_label: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.inflight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(window_label.to_owned(), Arc::clone(&flag));
        flag
    }

    fn end(&self, window_label: &str) {
        self.inflight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(window_label);
    }

    /// Best-effort and idempotent: requests cancellation of whatever network
    /// operation is currently in flight for `window_label`, or does nothing
    /// at all if none is (already finished, or never started). Mirrors
    /// `TrustService::revoke`'s "idempotent, cannot itself fail" shape —
    /// unlike `search::service`'s `search_text_cancel`, there is no id a
    /// caller could get wrong, only "is one running right now for this
    /// window".
    pub(crate) fn request_cancel(&self, window_label: &str) {
        if let Some(flag) = self
            .inflight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(window_label)
        {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Parses `git rev-list --left-right --count '@{upstream}...HEAD'`'s stdout
/// — confirmed empirically (this slice's own report) to be exactly two
/// whitespace-separated (in practice tab-separated) non-negative integers,
/// `<behind>` then `<ahead>`, on one line: `<behind>` is how many commits
/// the upstream has that `HEAD` does not (the `--left-right` "left" side of
/// the symmetric difference), `<ahead>` is the reverse.
fn parse_ahead_behind(stdout: &[u8]) -> Option<(u64, u64)> {
    let text = std::str::from_utf8(stdout).ok()?.trim();
    let mut fields = text
        .split(|byte: char| byte.is_whitespace())
        .filter(|field| !field.is_empty());
    let behind = fields.next()?.parse().ok()?;
    let ahead = fields.next()?.parse().ok()?;
    if fields.next().is_some() {
        return None;
    }
    Some((behind, ahead))
}

async fn run_background_read(
    repo_dir: &Path,
    args: Vec<String>,
) -> Result<GitExecOutput, CommandError> {
    let repo_dir = repo_dir.to_path_buf();
    let cancel = AtomicBool::new(false);
    tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

/// Computes [`NetworkPreview`] for `operation` — never spawns a network
/// subprocess (see this module's own doc comment): both git invocations
/// here run under [`GitExecMode::BackgroundRead`], exactly like `status`/
/// `diff`.
pub(crate) async fn preview(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    operation: NetworkOperation,
) -> Result<NetworkPreview, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;

    let upstream_output = run_background_read(
        &repo_dir,
        vec![
            "rev-parse".to_owned(),
            "--abbrev-ref".to_owned(),
            "--symbolic-full-name".to_owned(),
            GIT_UPSTREAM_REV.to_owned(),
        ],
    )
    .await?;
    if upstream_output.exit_code != 0 {
        return match operation {
            NetworkOperation::Fetch => Ok(NetworkPreview {
                upstream: None,
                ahead: None,
                behind: None,
            }),
            NetworkOperation::Pull | NetworkOperation::Push => Err(git_network_no_upstream()),
        };
    }
    let upstream = String::from_utf8_lossy(&upstream_output.stdout)
        .trim()
        .to_owned();
    if upstream.is_empty() {
        return Err(git_network_preview_failed());
    }

    let ahead_behind_output = run_background_read(
        &repo_dir,
        vec![
            "rev-list".to_owned(),
            "--left-right".to_owned(),
            "--count".to_owned(),
            format!("{GIT_UPSTREAM_REV}...HEAD"),
        ],
    )
    .await?;
    if ahead_behind_output.exit_code != 0 {
        return Err(git_network_preview_failed());
    }
    let (behind, ahead) =
        parse_ahead_behind(&ahead_behind_output.stdout).ok_or_else(git_network_preview_failed)?;

    Ok(NetworkPreview {
        upstream: Some(upstream),
        ahead: Some(ahead),
        behind: Some(behind),
    })
}

async fn run_network(
    network: &GitNetworkService,
    window_label: &str,
    repo_dir: &Path,
    args: Vec<String>,
) -> Result<GitExecOutput, CommandError> {
    let flag = network.begin(window_label);
    let repo_dir = repo_dir.to_path_buf();
    let flag_for_spawn = Arc::clone(&flag);
    let joined = tauri::async_runtime::spawn_blocking(move || {
        run_git_network(&repo_dir, &args, &flag_for_spawn)
    })
    .await;
    network.end(window_label);
    joined.map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn fetch(
    trust: &TrustService,
    workspace: &WorkspaceService,
    network: &GitNetworkService,
    window_label: &str,
) -> Result<(), CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args: Vec<String> = GIT_FETCH_ARGS.iter().map(|arg| (*arg).to_owned()).collect();
    let output = run_network(network, window_label, &repo_dir, args).await?;
    if output.exit_code != 0 {
        return Err(git_fetch_failed());
    }
    Ok(())
}

pub(crate) async fn pull(
    trust: &TrustService,
    workspace: &WorkspaceService,
    network: &GitNetworkService,
    window_label: &str,
) -> Result<(), CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args: Vec<String> = GIT_PULL_ARGS.iter().map(|arg| (*arg).to_owned()).collect();
    let output = run_network(network, window_label, &repo_dir, args).await?;
    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Need to specify how to reconcile divergent branches") {
            return Err(git_pull_needs_strategy());
        }
        return Err(git_pull_failed());
    }
    Ok(())
}

pub(crate) async fn push(
    trust: &TrustService,
    workspace: &WorkspaceService,
    network: &GitNetworkService,
    window_label: &str,
    force: bool,
) -> Result<(), CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args_const: &[&str] = if force {
        GIT_PUSH_FORCE_ARGS
    } else {
        GIT_PUSH_ARGS
    };
    let args: Vec<String> = args_const.iter().map(|arg| (*arg).to_owned()).collect();
    let output = run_network(network, window_label, &repo_dir, args).await?;
    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("has no upstream branch")
            || stderr.contains("No configured push destination")
        {
            return Err(git_push_no_upstream());
        }
        if stderr.contains("rejected") || stderr.contains("stale info") {
            return Err(git_push_rejected());
        }
        return Err(git_push_failed());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
