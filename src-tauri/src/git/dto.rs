//! Wire DTOs for the git IPC commands (`F080` S1) and the `GitStatus`/
//! `DiffFileEntry` → wire conversions. Every path field is converted through
//! [`super::wire::GitPathBuf::to_wire_lossy`] at this exact boundary — see
//! that method's doc comment for why this is a real, documented lossy step
//! (the Tauri IPC wire is JSON, which requires valid UTF-8) rather than a
//! silent one.

use serde::{Deserialize, Serialize};

use crate::error::CommandError;

use super::diff::{DiffFileEntry, DiffStatusKind, GitBlobRev};
use super::status::{
    BranchHead, BranchInfo, BranchOid, GitStatus, RenameOrCopyKind, StatusEntry, SubmoduleState,
};

const MAX_GIT_SHOW_BLOB_PATH_BYTES: usize = 4_096;

fn git_show_blob_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_SHOW_BLOB_INVALID_REQUEST",
        "The git show blob request is invalid.",
    )
}

// --- git_status --------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitStatusRequest {}

impl GitStatusRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSubmoduleStateWire {
    is_submodule: bool,
    commit_changed: bool,
    tracked_changed: bool,
    untracked_changed: bool,
}

impl From<SubmoduleState> for GitSubmoduleStateWire {
    fn from(value: SubmoduleState) -> Self {
        Self {
            is_submodule: value.is_submodule,
            commit_changed: value.commit_changed,
            tracked_changed: value.tracked_changed,
            untracked_changed: value.untracked_changed,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchUpstreamWire {
    name: String,
    ahead: u64,
    behind: u64,
}

/// `oid`/`head` are the git-native literal tokens (`"(initial)"`/
/// `"(detached)"`) verbatim when there is no commit/the HEAD is detached —
/// see [`super::status::BranchOid`]/[`super::status::BranchHead`]'s own doc
/// comments. Neither token can collide with a real oid (hex-only) or a real
/// branch name (git rejects parentheses-only refnames), so this flat
/// encoding is unambiguous without a separate boolean flag.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchWire {
    oid: String,
    head: String,
    upstream: Option<GitBranchUpstreamWire>,
}

impl From<BranchInfo> for GitBranchWire {
    fn from(value: BranchInfo) -> Self {
        Self {
            oid: match value.oid {
                BranchOid::Initial => "(initial)".to_owned(),
                BranchOid::Commit(oid) => oid,
            },
            head: match value.head {
                BranchHead::Detached => "(detached)".to_owned(),
                BranchHead::Named(name) => name,
            },
            upstream: value.upstream.map(|upstream| GitBranchUpstreamWire {
                name: upstream.name,
                ahead: upstream.ahead,
                behind: upstream.behind,
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRenameOrCopyKindWire {
    Rename,
    Copy,
}

impl From<RenameOrCopyKind> for GitRenameOrCopyKindWire {
    fn from(value: RenameOrCopyKind) -> Self {
        match value {
            RenameOrCopyKind::Rename => Self::Rename,
            RenameOrCopyKind::Copy => Self::Copy,
        }
    }
}

// `rename_all` on an enum only renames the *variant* (the `"type"` tag
// value) — it deliberately does not cascade into a struct variant's own
// field names (unlike a plain struct), so each variant's snake_case Rust
// field names would otherwise leak onto the wire unrenamed. `rename_all_fields`
// is the separate, serde-native container attribute for exactly this case.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitStatusEntryWire {
    Ordinary {
        index_status: char,
        worktree_status: char,
        submodule: GitSubmoduleStateWire,
        mode_head: String,
        mode_index: String,
        mode_worktree: String,
        hash_head: String,
        hash_index: String,
        path: String,
    },
    RenameOrCopy {
        index_status: char,
        worktree_status: char,
        submodule: GitSubmoduleStateWire,
        mode_head: String,
        mode_index: String,
        mode_worktree: String,
        hash_head: String,
        hash_index: String,
        rename_or_copy_kind: GitRenameOrCopyKindWire,
        similarity: u16,
        path: String,
        orig_path: String,
    },
    Unmerged {
        index_status: char,
        worktree_status: char,
        submodule: GitSubmoduleStateWire,
        mode_stage1: String,
        mode_stage2: String,
        mode_stage3: String,
        mode_worktree: String,
        hash_stage1: String,
        hash_stage2: String,
        hash_stage3: String,
        path: String,
    },
    Untracked {
        path: String,
    },
    Ignored {
        path: String,
    },
}

impl From<StatusEntry> for GitStatusEntryWire {
    fn from(value: StatusEntry) -> Self {
        match value {
            StatusEntry::Ordinary(entry) => Self::Ordinary {
                index_status: entry.index_status,
                worktree_status: entry.worktree_status,
                submodule: entry.submodule.into(),
                mode_head: entry.mode_head,
                mode_index: entry.mode_index,
                mode_worktree: entry.mode_worktree,
                hash_head: entry.hash_head,
                hash_index: entry.hash_index,
                path: entry.path.to_wire_lossy(),
            },
            StatusEntry::RenameOrCopy(entry) => Self::RenameOrCopy {
                index_status: entry.index_status,
                worktree_status: entry.worktree_status,
                submodule: entry.submodule.into(),
                mode_head: entry.mode_head,
                mode_index: entry.mode_index,
                mode_worktree: entry.mode_worktree,
                hash_head: entry.hash_head,
                hash_index: entry.hash_index,
                rename_or_copy_kind: entry.kind.into(),
                similarity: entry.similarity,
                path: entry.path.to_wire_lossy(),
                orig_path: entry.orig_path.to_wire_lossy(),
            },
            StatusEntry::Unmerged(entry) => Self::Unmerged {
                index_status: entry.index_status,
                worktree_status: entry.worktree_status,
                submodule: entry.submodule.into(),
                mode_stage1: entry.mode_stage1,
                mode_stage2: entry.mode_stage2,
                mode_stage3: entry.mode_stage3,
                mode_worktree: entry.mode_worktree,
                hash_stage1: entry.hash_stage1,
                hash_stage2: entry.hash_stage2,
                hash_stage3: entry.hash_stage3,
                path: entry.path.to_wire_lossy(),
            },
            StatusEntry::Untracked(path) => Self::Untracked {
                path: path.to_wire_lossy(),
            },
            StatusEntry::Ignored(path) => Self::Ignored {
                path: path.to_wire_lossy(),
            },
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    branch: GitBranchWire,
    entries: Vec<GitStatusEntryWire>,
}

impl From<GitStatus> for GitStatusResult {
    fn from(value: GitStatus) -> Self {
        Self {
            branch: value.branch.into(),
            entries: value
                .entries
                .into_iter()
                .map(GitStatusEntryWire::from)
                .collect(),
        }
    }
}

// --- git_diff_files ------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitDiffFilesRequest {
    cached: bool,
}

impl GitDiffFilesRequest {
    pub const fn into_parts(self) -> bool {
        self.cached
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitDiffStatusKindWire {
    Added,
    Copied,
    Deleted,
    Modified,
    Renamed,
    TypeChanged,
    Unmerged,
    Unknown,
}

impl From<DiffStatusKind> for GitDiffStatusKindWire {
    fn from(value: DiffStatusKind) -> Self {
        match value {
            DiffStatusKind::Added => Self::Added,
            DiffStatusKind::Copied => Self::Copied,
            DiffStatusKind::Deleted => Self::Deleted,
            DiffStatusKind::Modified => Self::Modified,
            DiffStatusKind::Renamed => Self::Renamed,
            DiffStatusKind::TypeChanged => Self::TypeChanged,
            DiffStatusKind::Unmerged => Self::Unmerged,
            DiffStatusKind::Unknown => Self::Unknown,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffFileEntryWire {
    kind: GitDiffStatusKindWire,
    similarity: Option<u16>,
    path: String,
    orig_path: Option<String>,
    added: Option<u64>,
    deleted: Option<u64>,
    binary: bool,
}

impl From<DiffFileEntry> for GitDiffFileEntryWire {
    fn from(value: DiffFileEntry) -> Self {
        Self {
            kind: value.kind.into(),
            similarity: value.similarity,
            path: value.path.to_wire_lossy(),
            orig_path: value.orig_path.map(|path| path.to_wire_lossy()),
            added: value.added,
            deleted: value.deleted,
            binary: value.binary,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffFilesResult {
    entries: Vec<GitDiffFileEntryWire>,
}

impl GitDiffFilesResult {
    pub(crate) fn new(entries: Vec<DiffFileEntry>) -> Self {
        Self {
            entries: entries
                .into_iter()
                .map(GitDiffFileEntryWire::from)
                .collect(),
        }
    }
}

// --- git_show_blob --------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GitBlobRevWire {
    Head,
    Index,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitShowBlobRequest {
    rev: GitBlobRevWire,
    path: String,
}

impl GitShowBlobRequest {
    pub(crate) fn into_parts(self) -> Result<(GitBlobRev, String), CommandError> {
        if self.path.is_empty() || self.path.len() > MAX_GIT_SHOW_BLOB_PATH_BYTES {
            return Err(git_show_blob_invalid_request());
        }
        let rev = match self.rev {
            GitBlobRevWire::Head => GitBlobRev::Head,
            GitBlobRevWire::Index => GitBlobRev::Index,
        };
        Ok((rev, self.path))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShowBlobResult {
    content: Option<Vec<u8>>,
}

impl GitShowBlobResult {
    pub(crate) const fn new(content: Option<Vec<u8>>) -> Self {
        Self { content }
    }
}

#[cfg(test)]
mod tests;
