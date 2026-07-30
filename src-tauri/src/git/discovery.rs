//! Repository discovery: the one entry point this `F080` S0 slice provides
//! into the git domain. Implements ADR 0003's "未信任 workspace 不启动 Git
//! 子进程，只通过文件系统识别仓库标记" — see the module doc on [`super`] for
//! the full security contract this mirrors from
//! `terminal::service::TerminalService::start`'s "trust gate before spawn"
//! call sequence.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;

/// The outcome of [`discover_repository`]. The untrusted and trusted
/// variants are deliberately distinct types of evidence, not the same
/// boolean at two confidence levels: [`UnconfirmedMarker`] only reflects
/// what a filesystem `.git` entry lookup saw (no subprocess ever ran, and a
/// stray `.git` file/directory does not *prove* a working repository);
/// [`Confirmed`] reflects what `git rev-parse --show-toplevel` — a real
/// spawned, trust-gated subprocess — actually reported.
///
/// [`UnconfirmedMarker`]: RepositoryDiscovery::UnconfirmedMarker
/// [`Confirmed`]: RepositoryDiscovery::Confirmed
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RepositoryDiscovery {
    /// Untrusted (or `EMPTY`) workspace: only `<dir>/.git`'s existence was
    /// checked, walking upward from the authorized candidate directory no
    /// further than the authorized root itself — see
    /// [`filesystem_git_marker_within_root`]. No subprocess was spawned.
    UnconfirmedMarker { has_git_marker: bool },
    /// Trusted workspace: `git rev-parse --show-toplevel` actually ran.
    /// `toplevel` is `None` when git reported (via a non-zero exit) that
    /// `candidate_dir` is not inside a working tree.
    Confirmed { toplevel: Option<PathBuf> },
}

/// Discovers whether `candidate_dir` — which must already be inside one of
/// `window_label`'s currently authorized workspace roots — is a Git
/// repository. Never spawns a subprocess unless the workspace is trusted;
/// see the module doc.
pub(crate) async fn discover_repository(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    candidate_dir: &Path,
) -> Result<RepositoryDiscovery, CommandError> {
    let (canonical_dir, root_floor) =
        authorize_candidate_dir(workspace, window_label, candidate_dir)?;

    if trust
        .require_trusted(workspace, window_label)
        .await
        .is_err()
    {
        let has_git_marker = filesystem_git_marker_within_root(&canonical_dir, &root_floor);
        return Ok(RepositoryDiscovery::UnconfirmedMarker { has_git_marker });
    }

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(
            &canonical_dir,
            &["rev-parse".to_owned(), "--show-toplevel".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
        )
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        return Ok(RepositoryDiscovery::Confirmed { toplevel: None });
    }
    let toplevel = String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(['\n', '\r'])
        .to_owned();
    if toplevel.is_empty() {
        return Ok(RepositoryDiscovery::Confirmed { toplevel: None });
    }
    Ok(RepositoryDiscovery::Confirmed {
        toplevel: Some(PathBuf::from(toplevel)),
    })
}

/// Validates that `candidate_dir` canonicalizes to a path inside (or
/// exactly equal to) one of `window_label`'s currently authorized workspace
/// roots, exactly like `terminal::service::resolve_cwd`'s own
/// canonicalize + `starts_with` check (see that function's doc for why this
/// specific ambient-`std::fs` check is the sanctioned boundary for a
/// spawn-adjacent cwd, as opposed to capability-relative file I/O). Returns
/// both the canonicalized candidate and the specific authorized root that
/// contains it, so callers can bound any further filesystem walk to never
/// cross above that root.
fn authorize_candidate_dir(
    workspace: &WorkspaceService,
    window_label: &str,
    candidate_dir: &Path,
) -> Result<(PathBuf, PathBuf), CommandError> {
    let roots = workspace.root_canonical_paths(window_label)?;
    let canonical = std::fs::canonicalize(candidate_dir).map_err(|_| super::git_cwd_invalid())?;
    roots
        .iter()
        .find(|(_, root)| canonical == *root || canonical.starts_with(root))
        .map(|(_, root)| (canonical.clone(), root.clone()))
        .ok_or_else(super::git_cwd_invalid)
}

/// Walks upward from `candidate_dir` looking for a `.git` entry (file or
/// directory — covers both a plain repository and a linked worktree/
/// submodule's gitdir-pointer file), stopping at (and including) `root_floor`
/// so an untrusted lookup never probes filesystem existence above the
/// workspace's own authorized root. Pure `Path`/metadata inspection, no
/// subprocess — the whole point of this branch.
fn filesystem_git_marker_within_root(candidate_dir: &Path, root_floor: &Path) -> bool {
    let mut current = candidate_dir;
    loop {
        if current.join(".git").exists() {
            return true;
        }
        if current == root_floor {
            return false;
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return false,
        }
    }
}

#[cfg(test)]
mod tests;
