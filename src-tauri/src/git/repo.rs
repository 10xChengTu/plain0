//! Resolves the exact repository a Git operation should act on. Production
//! IPC creates a [`SelectedGitRoot`] from the caller's explicit `rootId`;
//! direct single-root helpers can continue passing [`WorkspaceService`]
//! itself, but that compatibility path refuses a multi-root workspace rather
//! than silently selecting its first root.
//!
//! Trust is checked *before* even looking at the workspace's roots, and as a
//! hard failure (`WORKSPACE_NOT_TRUSTED`) rather than
//! `discover_repository`'s own soft "untrusted still reports a filesystem
//! marker" branch: status/diff/show are always-spawns-git commands, so a
//! caller needs to distinguish "not trusted yet" (prompt to grant trust)
//! from "no repository here" (nothing to show), not have both collapse into
//! the same "no repository" outcome.
//!
//! Git's reported top level must canonicalize to exactly the selected root.
//! A workspace opened at a subdirectory of a larger repository is rejected:
//! running repository-wide status, stash, refs, or mutations from the parent
//! top level would otherwise escape the authorized root.

use std::path::PathBuf;

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

use super::discovery::{discover_repository, RepositoryDiscovery};
use super::{git_no_repository, git_repository_outside_root, git_root_required};

/// The minimum workspace capability every Git operation needs. Keeping this
/// as a small trait lets the existing direct single-root unit tests pass a
/// `WorkspaceService`, while IPC passes a root-bound scope through the same
/// operation chain without ambient mutable selection state.
pub(crate) trait GitRepositoryScope {
    fn workspace(&self) -> &WorkspaceService;
    fn selected_root_id(&self) -> Option<RootId>;
}

impl GitRepositoryScope for WorkspaceService {
    fn workspace(&self) -> &WorkspaceService {
        self
    }

    fn selected_root_id(&self) -> Option<RootId> {
        None
    }
}

/// Immutable root-bound view over a window's workspace service. It carries
/// no filesystem authority of its own; every resolution revalidates the
/// identity against the current window state, so removing/replacing a root
/// invalidates subsequent Git calls immediately.
pub(crate) struct SelectedGitRoot<'workspace> {
    workspace: &'workspace WorkspaceService,
    root_id: RootId,
}

impl<'workspace> SelectedGitRoot<'workspace> {
    pub(crate) const fn new(workspace: &'workspace WorkspaceService, root_id: RootId) -> Self {
        Self { workspace, root_id }
    }
}

impl GitRepositoryScope for SelectedGitRoot<'_> {
    fn workspace(&self) -> &WorkspaceService {
        self.workspace
    }

    fn selected_root_id(&self) -> Option<RootId> {
        Some(self.root_id)
    }
}

pub(crate) async fn resolve_repo_toplevel(
    trust: &TrustService,
    scope: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<PathBuf, CommandError> {
    let workspace = scope.workspace();
    trust.require_trusted(workspace, window_label).await?;
    let candidate_dir = match scope.selected_root_id() {
        Some(root_id) => workspace.root_canonical_path(window_label, root_id)?,
        None => {
            let roots = workspace.root_canonical_paths(window_label)?;
            match roots.as_slice() {
                [] => return Err(git_no_repository()),
                [(_, path)] => path.clone(),
                _ => return Err(git_root_required()),
            }
        }
    };
    match discover_repository(trust, workspace, window_label, &candidate_dir).await? {
        RepositoryDiscovery::Confirmed {
            toplevel: Some(toplevel),
        } => {
            let canonical_toplevel =
                std::fs::canonicalize(toplevel).map_err(|_| git_no_repository())?;
            if canonical_toplevel != candidate_dir {
                return Err(git_repository_outside_root());
            }
            Ok(canonical_toplevel)
        }
        _ => Err(git_no_repository()),
    }
}

#[cfg(test)]
mod tests;
