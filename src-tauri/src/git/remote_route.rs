//! `F220` S6: the thin routing/adapter layer between this domain's six core
//! commands (`status`/`diff`/`log`/`stage`/`unstage`/`commit`) and either
//! backend a selected workspace root can have. This is the *only* file in
//! `git::` that ever looks at `crate::remote::` (the SSH domain) — every one
//! of the six business functions in [`super::status`]/[`super::diff`]/
//! [`super::log`]/[`super::stage`]/[`super::commit`] calls
//! [`resolve_repo_route`] instead of [`super::repo::resolve_repo_toplevel`]
//! directly, then hands the result and its own git subcommand/arguments to
//! [`run_routed`], which never leaks which backend actually ran a given
//! invocation: both branches produce the identical [`super::exec::GitExecOutput`]
//! shape every one of this domain's existing porcelain parsers
//! (`parse_porcelain_v2`/`parse_name_status`/`parse_numstat`/
//! `merge_diff_files`/`parse_graph_entries`) already consumes unmodified.
//!
//! # Local branch: byte-for-byte the pre-`F220`-S6 behavior
//!
//! [`resolve_repo_route`]'s local branch is not a reimplementation — it
//! calls [`super::repo::resolve_repo_toplevel`] itself, the exact function
//! every one of this domain's other (out-of-scope) commands still calls
//! directly. [`run_routed`]'s local branch is the exact
//! `run_git`/`run_git_with_stdin` call every one of the six functions made
//! before this slice, just factored into one shared place instead of
//! duplicated six times.
//!
//! # Remote branch: a second, independent toplevel discovery, then the same shape
//!
//! A remote root has no local `git rev-parse --show-toplevel` to run — this
//! module runs the exact same command *remotely*, through
//! [`crate::remote::remote_git::run_remote_git`] under
//! [`crate::remote::remote_git::RemoteGitExecMode::BackgroundRead`], and
//! applies the identical "toplevel must canonicalize to exactly the
//! authorized root" check [`super::repo::resolve_repo_toplevel`]'s own doc
//! comment describes for the local case — string equality against the root's
//! own recorded `base_path`, since that path is already the *result* of a
//! real SFTP `realpath` call from when the root was authorized (`F220` S3),
//! and a remote `git rev-parse --show-toplevel` reports an equally canonical,
//! absolute path (confirmed empirically by `remote_route::tests`' own
//! toplevel-boundary fixtures — never merely assumed).
//!
//! # Every transport failure funnels through the domain's existing `GIT_EXEC_*` codes
//!
//! [`run_routed`]'s remote branch maps every
//! [`crate::remote::remote_git::RemoteGitExecFailure`] variant onto one of
//! this domain's own, pre-existing [`super::git_exec_unavailable`]/
//! [`super::git_exec_timeout`]/[`super::git_exec_cancelled`]/
//! [`super::git_exec_output_limit_exceeded`] codes — never a new one — except
//! [`crate::remote::remote_git::RemoteGitExecFailure::Disconnected`], which
//! maps to [`crate::remote::remote_session_disconnected`] instead: that
//! specific outcome ("the channel closed without ever reporting an exit
//! status") is exactly what happens when the underlying SSH session drops
//! out from under an in-flight git operation, and this domain already has a
//! purpose-built, more actionable code for that exact situation (`F220` S4)
//! than the generic "exec mechanism unavailable" bucket would be. A caller of
//! `git::status`/`git::diff`/etc. therefore cannot tell a local exec failure
//! from a remote one for the four shared codes — only a session-disconnect
//! is distinguishable, and only because it is a strictly more precise,
//! already-existing signal.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::remote::dto::RemoteSessionId;
use crate::remote::remote_git::{self, RemoteGitExecFailure, RemoteGitExecMode};
use crate::remote::session::RemoteSessionService;
use crate::trust::service::TrustService;
use crate::workspace::RemoteRootContext;

use super::exec::{run_git, run_git_with_stdin, GitExecMode, GitExecOutput};
use super::network::GitNetworkService;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};
use super::{
    git_exec_cancelled, git_exec_output_limit_exceeded, git_exec_timeout, git_exec_unavailable,
    git_no_repository, git_repository_outside_root,
};

/// Which hardening profile a routed invocation needs — the routing-layer
/// counterpart to [`GitExecMode`]'s `BackgroundRead`/`Write` variants
/// (`Network` is never routed through here at all: `git::network`'s
/// `fetch`/`pull`/`push` fail closed for a remote root before ever reaching
/// this module — see this module's own doc comment). Kept as its own small
/// enum, rather than accepting a bare [`GitExecMode`] directly, so this
/// module cannot be handed the one variant ([`GitExecMode::Network`]) it has
/// no mapping for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RoutedGitMode {
    BackgroundRead,
    Write,
}

impl RoutedGitMode {
    const fn local_mode(self) -> GitExecMode {
        match self {
            Self::BackgroundRead => GitExecMode::BackgroundRead,
            Self::Write => GitExecMode::Write,
        }
    }

    const fn remote_mode(self) -> RemoteGitExecMode {
        match self {
            Self::BackgroundRead => RemoteGitExecMode::BackgroundRead,
            Self::Write => RemoteGitExecMode::Write,
        }
    }
}

/// The resolved repository this domain's six routed commands run against —
/// either a local canonical toplevel path (unchanged from pre-`F220`-S6
/// behavior) or a live remote session plus its canonical repository path.
pub(crate) enum RepoRoute {
    Local(PathBuf),
    Remote(RemoteRepoRoute),
}

pub(crate) struct RemoteRepoRoute {
    session_id: RemoteSessionId,
    repo_path: String,
}

/// The routing-layer counterpart to [`super::repo::resolve_repo_toplevel`] —
/// see this module's own doc comment for the full contract. Trust is checked
/// first (via the local-branch delegate, [`resolve_repo_toplevel`] itself,
/// for the `None`/local cases; explicitly, up front, for the remote case) so
/// an untrusted workspace fails closed before any exec of either kind is ever
/// attempted, exactly like every other trust-gated spawn in this codebase.
pub(crate) async fn resolve_repo_route(
    trust: &TrustService,
    scope: &(impl GitRepositoryScope + ?Sized),
    remote: &RemoteSessionService,
    window_label: &str,
) -> Result<RepoRoute, CommandError> {
    let workspace = scope.workspace();
    // Checked first, unconditionally, before any backend decision or exec of
    // any kind — exactly `resolve_repo_toplevel`'s own ordering, now
    // guaranteed to fail closed for a remote root too rather than only a
    // local one (`F220` S6's trust-identity extension is what makes this
    // check meaningful for a remote-only workspace at all — see
    // `workspace::WorkspaceScope::stable_identity`'s own doc comment). The
    // local branch below calls `resolve_repo_toplevel`, which re-checks this
    // itself — a redundant, idempotent, cheap re-read, not a correctness
    // concern (mirrors this same acceptable duplication pattern elsewhere in
    // this codebase, e.g. `discovery::discover_repository`'s own two-layer
    // authorization check).
    trust.require_trusted(workspace, window_label).await?;

    let Some(root_id) = scope.selected_root_id() else {
        // No explicit root selected: mirrors `resolve_repo_toplevel`'s own
        // multi-root/zero-root fail-closed behavior exactly (only reachable
        // from a direct single-root helper call, never production IPC —
        // every `git_*` command carries a mandatory `rootId`). Deliberately
        // does not attempt to discover a lone remote root this way; see this
        // module's own doc comment.
        let toplevel = resolve_repo_toplevel(trust, scope, window_label).await?;
        return Ok(RepoRoute::Local(toplevel));
    };
    match workspace.remote_context(window_label, root_id)? {
        None => {
            let toplevel = resolve_repo_toplevel(trust, scope, window_label).await?;
            Ok(RepoRoute::Local(toplevel))
        }
        Some(context) => {
            let toplevel = remote_repo_toplevel(remote, window_label, &context).await?;
            if toplevel != context.base_path {
                return Err(git_repository_outside_root());
            }
            Ok(RepoRoute::Remote(RemoteRepoRoute {
                session_id: context.session_id,
                repo_path: context.base_path,
            }))
        }
    }
}

/// `git -C <base_path> rev-parse --show-toplevel`, run remotely under
/// [`RemoteGitExecMode::BackgroundRead`] — the remote counterpart to
/// [`super::discovery::discover_repository`]'s own local `rev-parse`
/// invocation. Uses a fresh, non-shared cancellation flag (this discovery
/// step is not itself user-cancellable — mirrors `discovery::discover_repository`'s
/// own identical choice for the local case) and the production
/// [`remote_git::run_remote_git`] timeout.
async fn remote_repo_toplevel(
    remote: &RemoteSessionService,
    window_label: &str,
    context: &RemoteRootContext,
) -> Result<String, CommandError> {
    let cancel = AtomicBool::new(false);
    let args = vec!["rev-parse".to_owned(), "--show-toplevel".to_owned()];
    let outcome = remote_git::run_remote_git(
        remote,
        window_label,
        context.session_id,
        &context.base_path,
        RemoteGitExecMode::BackgroundRead,
        &args,
        None,
        &cancel,
    )
    .await;
    let output = map_remote_outcome(outcome)?;
    if output.exit_code != 0 {
        return Err(git_no_repository());
    }
    let toplevel = String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(['\n', '\r'])
        .to_owned();
    if toplevel.is_empty() {
        return Err(git_no_repository());
    }
    Ok(toplevel)
}

/// Runs `git_args` against `route`, dispatching to the local
/// `run_git`/`run_git_with_stdin` path (unchanged) or to
/// [`remote_git::run_remote_git`] (`F220` S6) — see this module's own doc
/// comment. The remote branch registers/deregisters `cancel`+`network`
/// exactly like `git::network`'s own fetch/pull/push already do, so the
/// existing `git_network_cancel` IPC command transparently covers these six
/// commands too once they are routed remotely.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_routed(
    route: &RepoRoute,
    network: &GitNetworkService,
    remote: &RemoteSessionService,
    window_label: &str,
    root_id: Option<crate::workspace::RootId>,
    mode: RoutedGitMode,
    git_args: &[String],
    stdin: Option<&[u8]>,
) -> Result<GitExecOutput, CommandError> {
    match route {
        RepoRoute::Local(repo_dir) => run_local(repo_dir, mode, git_args, stdin).await,
        RepoRoute::Remote(remote_route) => {
            run_remote(
                remote_route,
                network,
                remote,
                window_label,
                root_id,
                mode,
                git_args,
                stdin,
            )
            .await
        }
    }
}

async fn run_local(
    repo_dir: &std::path::Path,
    mode: RoutedGitMode,
    git_args: &[String],
    stdin: Option<&[u8]>,
) -> Result<GitExecOutput, CommandError> {
    let repo_dir = repo_dir.to_path_buf();
    let args = git_args.to_vec();
    let local_mode = mode.local_mode();
    let cancel = AtomicBool::new(false);
    if let Some(stdin_bytes) = stdin {
        let stdin_bytes = stdin_bytes.to_vec();
        tauri::async_runtime::spawn_blocking(move || {
            run_git_with_stdin(&repo_dir, &args, local_mode, &cancel, &stdin_bytes)
        })
        .await
        .map_err(|_| git_exec_unavailable())?
    } else {
        tauri::async_runtime::spawn_blocking(move || run_git(&repo_dir, &args, local_mode, &cancel))
            .await
            .map_err(|_| git_exec_unavailable())?
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_remote(
    remote_route: &RemoteRepoRoute,
    network: &GitNetworkService,
    remote: &RemoteSessionService,
    window_label: &str,
    root_id: Option<crate::workspace::RootId>,
    mode: RoutedGitMode,
    git_args: &[String],
    stdin: Option<&[u8]>,
) -> Result<GitExecOutput, CommandError> {
    let flag = network.begin_for_root(window_label, root_id);
    let outcome = remote_git::run_remote_git(
        remote,
        window_label,
        remote_route.session_id,
        &remote_route.repo_path,
        mode.remote_mode(),
        git_args,
        stdin,
        &flag,
    )
    .await;
    network.end_for_root(window_label, root_id);
    map_remote_outcome(outcome)
}

/// The one place [`RemoteGitExecFailure`] is translated into this domain's
/// own error codes — see this module's own doc comment for the full mapping
/// rationale.
fn map_remote_outcome(
    outcome: Result<remote_git::RemoteGitExecOutcome, RemoteGitExecFailure>,
) -> Result<GitExecOutput, CommandError> {
    match outcome {
        Ok(outcome) => Ok(GitExecOutput {
            exit_code: outcome.exit_code,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
        }),
        Err(RemoteGitExecFailure::Unavailable) => Err(git_exec_unavailable()),
        Err(RemoteGitExecFailure::TimedOut) => Err(git_exec_timeout()),
        Err(RemoteGitExecFailure::Cancelled) => Err(git_exec_cancelled()),
        Err(RemoteGitExecFailure::OutputLimitExceeded) => Err(git_exec_output_limit_exceeded()),
        Err(RemoteGitExecFailure::Disconnected) => {
            Err(crate::remote::remote_session_disconnected())
        }
    }
}

#[cfg(test)]
mod tests;
