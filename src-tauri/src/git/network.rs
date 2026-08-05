//! `F080` S4: fetch/pull/push, running the plain, unscoped `git fetch`/
//! `git pull`/`git push` (no remote/refspec arguments) this domain's audited
//! [`GIT_FETCH_ARGS`]/[`GIT_PULL_ARGS`]/[`GIT_PUSH_ARGS`]/[`GIT_PUSH_FORCE_ARGS`]
//! constants are — this domain never re-implements git's own remote/refspec
//! resolution logic, and never re-scopes what those bare commands would
//! otherwise do (ADR 0003: never a general-purpose `git_run`).
//!
//! # `@{upstream}` is a precondition check, not a scope guarantee on the network operation itself
//!
//! An earlier version of this doc claimed fetch/pull/push each "precisely
//! target the current branch's configured upstream". That is not what the
//! code actually does, and is not true in general — verified empirically
//! (this slice's own report, a real local bare remote with multiple
//! branches): a bare `git fetch --quiet` (exactly [`GIT_FETCH_ARGS`], no
//! remote/refspec arguments) updates **every** remote-tracking ref the
//! remote's own configured `remote.<name>.fetch` refspec covers — a branch
//! that is not the current branch's upstream at all still gets its tracking
//! ref updated by a plain fetch, confirmed directly. Likewise a bare
//! `git push --quiet` only happens to touch just the current branch's own
//! upstream because of *today's default* `push.default=simple` — this is a
//! repository/git-installation configuration default this code does not
//! control, not a guarantee this code enforces: with `push.default=matching`
//! configured (a legitimate, real git setting), the exact same bare
//! `git push --quiet` uploads *every* locally matching branch, not just the
//! current one, also confirmed directly against a real fixture.
//!
//! What genuinely *is* scoped to `@{upstream}` is exactly two things, both
//! preconditions/derived reads rather than the network operations
//! themselves: (1) [`preview`]'s own ahead/behind computation, and (2)
//! `pull`'s own implicit merge step is a merge of `@{upstream}` into
//! `HEAD` by definition, once the (unscoped) fetch that pull performs
//! first has updated it. `pull`/`push` fail closed with
//! [`git_network_no_upstream`] when the current branch has no upstream
//! configured at all — the same thing running the real bare command would
//! do anyway (verified empirically: `git push` with no upstream fails with
//! "The current branch … has no upstream branch"; `git pull` fails with "no
//! tracking information") — so this is a precondition check, not an extra
//! restriction beyond what bare git already refuses.
//!
//! # Deliberate scope: no arbitrary remote/branch picker
//!
//! `fetch` tolerates a missing upstream (bare `git fetch` genuinely still
//! works without one, per git's own docs: it falls back to the `origin`
//! remote) — see [`preview`]'s own doc comment. A UI for choosing a
//! different remote/branch than whatever the repository's own
//! remote/refspec/`push.default` configuration resolves to, or for setting
//! an upstream (`--set-upstream`), is out of scope for this slice — a
//! disclosed narrowing, not an oversight.
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
use crate::workspace::RootId;

use super::exec::{run_git, run_git_network, GitExecMode, GitExecOutput};
use super::git_exec_unavailable;
use super::git_remote_network_unsupported;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};

/// `F220` S6: fails closed with [`git_remote_network_unsupported`] the
/// instant `scope`'s explicitly selected root is remote-backed — checked
/// first, before [`resolve_repo_toplevel`] or any exec attempt of either
/// kind, in every one of [`preview`]/[`fetch`]/[`pull`]/[`push`]. See this
/// module's own doc comment for why this is a distinct code from the generic
/// `ROOT_BACKEND_UNSUPPORTED` fallback every *other* out-of-scope command in
/// this domain still relies on.
///
/// Only checks the *explicit* `root_id` case (`scope.selected_root_id()` is
/// `Some`) — mirrors `remote_route::resolve_repo_route`'s own documented
/// narrowing for the implicit/no-explicit-root compatibility path (never
/// reached by production IPC, every `git_*` command carries a mandatory
/// `rootId`): a `None` selection falls through to
/// [`resolve_repo_toplevel`]'s existing local-only behavior unchanged.
fn reject_remote_root(
    scope: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<(), CommandError> {
    if let Some(root_id) = scope.selected_root_id() {
        if scope
            .workspace()
            .remote_context(window_label, root_id)?
            .is_some()
        {
            return Err(git_remote_network_unsupported());
        }
    }
    Ok(())
}

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

/// Tracks at most one in-flight network-shaped operation per `(window,
/// selected root)`, so [`GitNetworkService::request_cancel_for_root`] can
/// reach the real cooperative-cancellation flag the in-flight operation's own
/// poll loop checks. Originally `F080` S4's own fetch/pull/push cancellation
/// table (reaching `run_git_network`'s `wait_with_limits` poll loop, `F080`
/// S0's mechanism — this service was simply the first thing in this domain
/// to actually *expose* it to a caller, because no write command before that
/// slice was slow enough to need a user-reachable cancel path).
///
/// `F220` S6 widens this to also serve the six git core-subset commands this
/// slice routes to a remote root (`status`/`diff`/`log`/`stage`/`unstage`/
/// `commit`) — every one of them now involves a real network round trip when
/// routed remotely (unlike their `GitExecMode::BackgroundRead`/`Write` local
/// counterparts, which are never cancellable by design), so
/// `git::remote_route` calls [`Self::begin_for_root`]/[`Self::end_for_root`]
/// around each remote invocation exactly like `fetch`/`pull`/`push` already
/// do here — reusing the identical table, key shape and
/// `git_network_cancel` IPC entry point rather than adding a second
/// cancellation mechanism. The root identity remains part of the key so
/// changing SCM selection can never cancel another repository's operation;
/// no operation id is needed because the frontend still enforces at most one
/// mutation per selected repository.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct NetworkOperationKey {
    window_label: String,
    root_id: Option<RootId>,
}

impl NetworkOperationKey {
    fn new(window_label: &str, root_id: Option<RootId>) -> Self {
        Self {
            window_label: window_label.to_owned(),
            root_id,
        }
    }
}

#[derive(Default)]
pub struct GitNetworkService {
    inflight: Mutex<HashMap<NetworkOperationKey, Arc<AtomicBool>>>,
}

impl GitNetworkService {
    pub fn new() -> Self {
        Self::default()
    }

    /// `F220` S6: `pub(crate)` (not module-private, its pre-`F220` visibility)
    /// so `git::remote_route`'s six routed remote commands can register their
    /// own in-flight cancellation flag through the exact same table this
    /// service already used exclusively for fetch/pull/push — see this
    /// struct's own doc comment.
    pub(crate) fn begin_for_root(
        &self,
        window_label: &str,
        root_id: Option<RootId>,
    ) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.inflight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(
                NetworkOperationKey::new(window_label, root_id),
                Arc::clone(&flag),
            );
        flag
    }

    /// `F220` S6: see [`Self::begin_for_root`]'s own doc comment for why this
    /// is now `pub(crate)`.
    pub(crate) fn end_for_root(&self, window_label: &str, root_id: Option<RootId>) {
        self.inflight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&NetworkOperationKey::new(window_label, root_id));
    }

    /// Root-bound production variant. It deliberately does not re-read the
    /// current workspace authorization set: cancellation must remain able to
    /// stop a process even if the root was removed while that process was in
    /// flight, while the key still prevents cross-root cancellation.
    pub(crate) fn request_cancel_for_root(&self, window_label: &str, root_id: RootId) {
        self.request_cancel_for_root_id(window_label, Some(root_id));
    }

    fn request_cancel_for_root_id(&self, window_label: &str, root_id: Option<RootId>) {
        if let Some(flag) = self
            .inflight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&NetworkOperationKey::new(window_label, root_id))
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
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    operation: NetworkOperation,
) -> Result<NetworkPreview, CommandError> {
    reject_remote_root(workspace, window_label)?;
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
    root_id: Option<RootId>,
    repo_dir: &Path,
    args: Vec<String>,
) -> Result<GitExecOutput, CommandError> {
    let flag = network.begin_for_root(window_label, root_id);
    let repo_dir = repo_dir.to_path_buf();
    let flag_for_spawn = Arc::clone(&flag);
    let joined = tauri::async_runtime::spawn_blocking(move || {
        run_git_network(&repo_dir, &args, &flag_for_spawn)
    })
    .await;
    network.end_for_root(window_label, root_id);
    joined.map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn fetch(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    network: &GitNetworkService,
    window_label: &str,
) -> Result<(), CommandError> {
    reject_remote_root(workspace, window_label)?;
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args: Vec<String> = GIT_FETCH_ARGS.iter().map(|arg| (*arg).to_owned()).collect();
    let output = run_network(
        network,
        window_label,
        workspace.selected_root_id(),
        &repo_dir,
        args,
    )
    .await?;
    if output.exit_code != 0 {
        return Err(git_fetch_failed());
    }
    Ok(())
}

pub(crate) async fn pull(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    network: &GitNetworkService,
    window_label: &str,
) -> Result<(), CommandError> {
    reject_remote_root(workspace, window_label)?;
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args: Vec<String> = GIT_PULL_ARGS.iter().map(|arg| (*arg).to_owned()).collect();
    let output = run_network(
        network,
        window_label,
        workspace.selected_root_id(),
        &repo_dir,
        args,
    )
    .await?;
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
    workspace: &(impl GitRepositoryScope + ?Sized),
    network: &GitNetworkService,
    window_label: &str,
    force: bool,
) -> Result<(), CommandError> {
    reject_remote_root(workspace, window_label)?;
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args_const: &[&str] = if force {
        GIT_PUSH_FORCE_ARGS
    } else {
        GIT_PUSH_ARGS
    };
    let args: Vec<String> = args_const.iter().map(|arg| (*arg).to_owned()).collect();
    let output = run_network(
        network,
        window_label,
        workspace.selected_root_id(),
        &repo_dir,
        args,
    )
    .await?;
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
