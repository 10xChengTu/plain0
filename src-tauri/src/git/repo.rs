//! Resolves "the repository" a git IPC command should act on for the
//! current window: `F080` currently authorizes exactly one workspace root
//! at a time (the same single-root assumption `search::dto`'s own doc
//! comments already document for this codebase), so [`resolve_repo_toplevel`]
//! takes that root as the sole candidate directory and confirms it is a Git
//! working tree exactly the way [`super::discovery::discover_repository`]
//! already does — this function is the wiring `discover_repository`'s own
//! doc comment predicted ("exercised by tests only until F080 S1 wires a
//! command onto this").
//!
//! Trust is checked *before* even looking at the workspace's roots, and as a
//! hard failure (`WORKSPACE_NOT_TRUSTED`) rather than
//! `discover_repository`'s own soft "untrusted still reports a filesystem
//! marker" branch: status/diff/show are always-spawns-git commands, so a
//! caller needs to distinguish "not trusted yet" (prompt to grant trust)
//! from "no repository here" (nothing to show), not have both collapse into
//! the same "no repository" outcome.
//!
//! # Known scope limit (not solved in this slice)
//!
//! This function trusts *git's own* reported toplevel, which may sit at or
//! above the authorized workspace root (e.g. the user opened a subdirectory
//! of a larger repository). Running status/diff from that toplevel would
//! then report entries outside the workspace's own authorized root —
//! `F080` S1 does not add a pathspec/authorized-subtree filter for that
//! case; it is accepted as a known gap for a follow-up slice, not silently
//! papered over.

use std::path::PathBuf;

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::discovery::{discover_repository, RepositoryDiscovery};
use super::git_no_repository;

pub(crate) async fn resolve_repo_toplevel(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
) -> Result<PathBuf, CommandError> {
    trust.require_trusted(workspace, window_label).await?;
    let roots = workspace.root_canonical_paths(window_label)?;
    let (_, candidate_dir) = roots.first().ok_or_else(git_no_repository)?;
    match discover_repository(trust, workspace, window_label, candidate_dir).await? {
        RepositoryDiscovery::Confirmed {
            toplevel: Some(toplevel),
        } => Ok(toplevel),
        _ => Err(git_no_repository()),
    }
}

#[cfg(test)]
mod tests;
