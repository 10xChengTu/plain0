//! Wire DTOs for the git IPC commands (`F080` S1) and the `GitStatus`/
//! `DiffFileEntry` → wire conversions. Every path field is converted through
//! [`super::wire::GitPathBuf::to_wire_lossy`] at this exact boundary — see
//! that method's doc comment for why this is a real, documented lossy step
//! (the Tauri IPC wire is JSON, which requires valid UTF-8) rather than a
//! silent one.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::CommandError;

use super::blame::{BlameCommitHeader, BlameLineRange, BlameResult, BLAME_UNCOMMITTED_SHA};
use super::contributors::{ContributorEntry, ContributorList};
use super::diff::{DiffFileEntry, DiffStatusKind, GitBlobRev};
use super::history_operation::{
    HistoryMutationOutcome, HistoryMutationOutcomeKind, HistoryOperation, HistoryPreview,
    HistoryState, SequencerKind, SequencerState,
};
use super::log::{
    GraphList, GraphNode, HistoryEntry, HistoryList, HistorySearchMode, LineHistoryDetail,
    LineRange,
};
use super::management::{BranchDeleteOutcome, RemoteUrlKind};
use super::network::NetworkOperation;
use super::reflog::{ReflogEntry, ReflogList};
use super::refs::{RefEntry, RefGroupKind, RefList};
use super::remote::{RemoteEntry, RemoteList};
use super::show_commit::ShowCommitResult;
use super::stash::{StashApplyOutcome, StashEntry, StashList, StashPushOutcome, StashShowResult};
use super::status::{
    BranchHead, BranchInfo, BranchOid, GitStatus, RenameOrCopyKind, StatusEntry, SubmoduleState,
};
use super::worktree::{
    WorktreeAddOutcome, WorktreeEntry, WorktreeHeadState, WorktreeList, WorktreeRemoveOutcome,
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

// --- git_stage_paths / git_unstage_paths / git_discard_paths (F080 S3) -----
//
// The three "whole-file path list" write commands share one request shape
// and one validation routine — a caller-supplied path is rejected (not
// silently dropped) if it is empty, exceeds a defensive length ceiling, is
// absolute, or contains a `..` path segment. The `--` separator every
// `stage`/`discard` domain function places before these paths (see
// `git::stage`/`git::discard`) already stops a `-`-prefixed path from being
// misread as a git option — this check is a second, independent line of
// defense against a path smuggled from outside the repository, not a
// duplicate of that mechanism.

/// Defensive ceiling on how many paths one stage/unstage/discard call may
/// name — git itself imposes no such limit; this exists only to reject a
/// structurally hostile/runaway batch, mirroring `git-codec.ts`'s own
/// hostile-input-ceiling precedent for this same domain.
const MAX_GIT_MUTATE_PATHS: usize = 4_096;
/// Defensive per-path length ceiling — mirrors
/// `diff::MAX_GIT_SHOW_BLOB_PATH_BYTES`'s exact reasoning for this domain's
/// other path-carrying requests.
pub(crate) const MAX_GIT_MUTATE_PATH_BYTES: usize = 4_096;

fn git_mutate_paths_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_MUTATE_PATHS_INVALID_REQUEST",
        "The path list is empty, too large, or contains an invalid path.",
    )
}

/// Shared by every path-carrying write request in this module (list or
/// single) — public at `pub(crate)` so `git::stage`/`git::commit`/
/// `git::discard` can apply the exact same rule again on their own
/// already-decoded `&str`/`&[String]` inputs, the same "validated again at
/// the domain-function layer, not just the wire layer" duplication
/// `diff::show_blob` already establishes for `GIT_SHOW_BLOB_INVALID_PATH`.
pub(crate) fn is_valid_mutate_path(path: &str) -> bool {
    if path.is_empty() || path.len() > MAX_GIT_MUTATE_PATH_BYTES {
        return false;
    }
    if path.starts_with('/') {
        return false;
    }
    !path.split('/').any(|segment| segment == "..")
}

fn validate_mutate_paths(paths: &[String]) -> Result<(), CommandError> {
    if paths.is_empty() || paths.len() > MAX_GIT_MUTATE_PATHS {
        return Err(git_mutate_paths_invalid_request());
    }
    if !paths.iter().all(|path| is_valid_mutate_path(path)) {
        return Err(git_mutate_paths_invalid_request());
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStagePathsRequest {
    paths: Vec<String>,
}

impl GitStagePathsRequest {
    pub(crate) fn into_parts(self) -> Result<Vec<String>, CommandError> {
        validate_mutate_paths(&self.paths)?;
        Ok(self.paths)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitUnstagePathsRequest {
    paths: Vec<String>,
}

impl GitUnstagePathsRequest {
    pub(crate) fn into_parts(self) -> Result<Vec<String>, CommandError> {
        validate_mutate_paths(&self.paths)?;
        Ok(self.paths)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitDiscardPathsRequest {
    paths: Vec<String>,
}

impl GitDiscardPathsRequest {
    pub(crate) fn into_parts(self) -> Result<Vec<String>, CommandError> {
        validate_mutate_paths(&self.paths)?;
        Ok(self.paths)
    }
}

// --- git_stage_blob (F080 S3 hunk-level stage) ------------------------------

/// Mirrors `diff::MAX_GIT_SHOW_BLOB_BYTES` — the same 8 MiB "whole file
/// version in one IPC round-trip" ceiling, applied here to the *new* content
/// a caller wants written as a blob rather than a version being read back.
pub(crate) const MAX_GIT_STAGE_BLOB_BYTES: usize = 8 * 1024 * 1024;

fn git_stage_blob_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_STAGE_BLOB_INVALID_REQUEST",
        "The git stage blob request is invalid.",
    )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStageBlobRequest {
    path: String,
    content: Vec<u8>,
}

impl GitStageBlobRequest {
    pub(crate) fn into_parts(self) -> Result<(String, Vec<u8>), CommandError> {
        if !is_valid_mutate_path(&self.path) {
            return Err(git_stage_blob_invalid_request());
        }
        if self.content.len() > MAX_GIT_STAGE_BLOB_BYTES {
            return Err(git_stage_blob_invalid_request());
        }
        Ok((self.path, self.content))
    }
}

// --- git_commit ------------------------------------------------------------

/// Defensive ceiling on a commit message's byte length — git itself has no
/// hard limit; this exists only to reject a structurally hostile/runaway
/// message, exactly like every other size ceiling in this module.
pub(crate) const MAX_GIT_COMMIT_MESSAGE_BYTES: usize = 100_000;

fn git_commit_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_COMMIT_INVALID_REQUEST",
        "The commit message is empty or too large.",
    )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitCommitRequest {
    message: String,
    amend: bool,
}

impl GitCommitRequest {
    pub(crate) fn into_parts(self) -> Result<(String, bool), CommandError> {
        if self.message.trim().is_empty() || self.message.len() > MAX_GIT_COMMIT_MESSAGE_BYTES {
            return Err(git_commit_invalid_request());
        }
        Ok((self.message, self.amend))
    }
}

// --- git_network_preview / git_fetch / git_pull / git_push / git_network_cancel
// (F080 S4) -------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GitNetworkOperationWire {
    Fetch,
    Pull,
    Push,
}

impl From<GitNetworkOperationWire> for NetworkOperation {
    fn from(value: GitNetworkOperationWire) -> Self {
        match value {
            GitNetworkOperationWire::Fetch => Self::Fetch,
            GitNetworkOperationWire::Pull => Self::Pull,
            GitNetworkOperationWire::Push => Self::Push,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitNetworkPreviewRequest {
    operation: GitNetworkOperationWire,
}

impl GitNetworkPreviewRequest {
    pub(crate) const fn into_parts(self) -> NetworkOperation {
        match self.operation {
            GitNetworkOperationWire::Fetch => NetworkOperation::Fetch,
            GitNetworkOperationWire::Pull => NetworkOperation::Pull,
            GitNetworkOperationWire::Push => NetworkOperation::Push,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitNetworkPreviewResult {
    upstream: Option<String>,
    ahead: Option<u64>,
    behind: Option<u64>,
}

impl From<super::network::NetworkPreview> for GitNetworkPreviewResult {
    fn from(value: super::network::NetworkPreview) -> Self {
        Self {
            upstream: value.upstream,
            ahead: value.ahead,
            behind: value.behind,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitFetchRequest {}

impl GitFetchRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitPullRequest {}

impl GitPullRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitPushRequest {
    force: bool,
}

impl GitPushRequest {
    pub(crate) const fn into_parts(self) -> bool {
        self.force
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitNetworkCancelRequest {}

impl GitNetworkCancelRequest {
    pub const fn validate(self) {}
}

// --- git_blame_file / git_blame_commit_messages (F090 S0) -------------------

/// Defensive ceiling on how many shas one `git_blame_commit_messages` call
/// may request — mirrors `blame::MAX_BLAME_COMMIT_MESSAGE_SHAS` (kept as an
/// independent wire-layer constant rather than re-exported, exactly like
/// `MAX_GIT_MUTATE_PATHS` above is this file's own copy of a ceiling also
/// enforced deeper in the stack).
const MAX_GIT_BLAME_COMMIT_MESSAGE_SHAS: usize = 4_096;

fn git_blame_file_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_BLAME_FILE_INVALID_REQUEST",
        "The git blame file request is invalid.",
    )
}

fn git_blame_commit_messages_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_BLAME_COMMIT_MESSAGES_INVALID_REQUEST",
        "The commit sha list is empty, too large, or contains an invalid entry.",
    )
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitBlameLineRangeWire {
    start: u32,
    end: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitBlameFileRequest {
    path: String,
    range: Option<GitBlameLineRangeWire>,
}

impl GitBlameFileRequest {
    pub(crate) fn into_parts(self) -> Result<(String, Option<BlameLineRange>), CommandError> {
        if !is_valid_mutate_path(&self.path) {
            return Err(git_blame_file_invalid_request());
        }
        let range = match self.range {
            None => None,
            Some(range) => {
                if range.start == 0 || range.end < range.start {
                    return Err(git_blame_file_invalid_request());
                }
                Some(BlameLineRange {
                    start: range.start,
                    end: range.end,
                })
            }
        };
        Ok((self.path, range))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameCommitHeaderWire {
    author: String,
    author_mail: String,
    author_time: i64,
    author_tz: String,
    committer: String,
    committer_mail: String,
    committer_time: i64,
    committer_tz: String,
    summary: String,
}

impl From<BlameCommitHeader> for GitBlameCommitHeaderWire {
    fn from(value: BlameCommitHeader) -> Self {
        Self {
            author: value.author,
            author_mail: value.author_mail,
            author_time: value.author_time,
            author_tz: value.author_tz,
            committer: value.committer,
            committer_mail: value.committer_mail,
            committer_time: value.committer_time,
            committer_tz: value.committer_tz,
            summary: value.summary,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlamePreviousWire {
    sha: String,
    path: String,
}

/// `isUncommitted` is derived here (from comparing `commitSha` against
/// [`BLAME_UNCOMMITTED_SHA`]) rather than left for the frontend to hardcode
/// the 40-zero sentinel itself — the same "derive a boolean at the wire
/// boundary rather than leak a sentinel-value convention to the caller"
/// discipline `GitBranchWire`'s own doc comment applies to
/// `"(initial)"`/`"(detached)"` (there the tokens are kept verbatim because
/// they cannot collide with a real value and the frontend already documents
/// the convention; here the sentinel is purely an implementation artifact of
/// how git denotes "no commit yet", so it is fully hidden instead).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLineEntryWire {
    commit_sha: String,
    is_uncommitted: bool,
    orig_line: u32,
    final_line: u32,
    is_boundary: bool,
    filename: String,
    previous: Option<GitBlamePreviousWire>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameFileResult {
    entries: Vec<GitBlameLineEntryWire>,
    commits: HashMap<String, GitBlameCommitHeaderWire>,
}

impl From<BlameResult> for GitBlameFileResult {
    fn from(value: BlameResult) -> Self {
        let entries = value
            .entries
            .into_iter()
            .map(|entry| GitBlameLineEntryWire {
                is_uncommitted: entry.commit_sha == BLAME_UNCOMMITTED_SHA,
                commit_sha: entry.commit_sha,
                orig_line: entry.orig_line,
                final_line: entry.final_line,
                is_boundary: entry.is_boundary,
                filename: entry.filename.to_wire_lossy(),
                previous: entry.previous.map(|previous| GitBlamePreviousWire {
                    sha: previous.sha,
                    path: previous.path.to_wire_lossy(),
                }),
            })
            .collect();
        let commits = value
            .commits
            .into_iter()
            .map(|(sha, header)| (sha, GitBlameCommitHeaderWire::from(header)))
            .collect();
        Self { entries, commits }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitBlameCommitMessagesRequest {
    shas: Vec<String>,
}

impl GitBlameCommitMessagesRequest {
    pub(crate) fn into_parts(self) -> Result<Vec<String>, CommandError> {
        if self.shas.len() > MAX_GIT_BLAME_COMMIT_MESSAGE_SHAS {
            return Err(git_blame_commit_messages_invalid_request());
        }
        Ok(self.shas)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameCommitMessagesResult {
    messages: HashMap<String, String>,
}

impl GitBlameCommitMessagesResult {
    pub(crate) const fn new(messages: HashMap<String, String>) -> Self {
        Self { messages }
    }
}

// --- git_file_history / git_line_history_list / git_line_history_detail
// (F090 S1) -------------------------------------------------------------

fn git_log_invalid_request() -> CommandError {
    CommandError::new("GIT_LOG_INVALID_REQUEST", "The git log request is invalid.")
}

fn git_history_search_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_HISTORY_SEARCH_INVALID_QUERY",
        "The commit history search query is invalid.",
    )
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GitHistorySearchModeWire {
    Message,
    Author,
    Sha,
}

impl From<GitHistorySearchModeWire> for HistorySearchMode {
    fn from(value: GitHistorySearchModeWire) -> Self {
        match value {
            GitHistorySearchModeWire::Message => Self::Message,
            GitHistorySearchModeWire::Author => Self::Author,
            GitHistorySearchModeWire::Sha => Self::Sha,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitHistorySearchRequest {
    mode: GitHistorySearchModeWire,
    query: String,
}

impl GitHistorySearchRequest {
    pub(crate) fn into_parts(self) -> Result<(HistorySearchMode, String), CommandError> {
        let query = self.query.trim();
        if query.is_empty() || query.len() > 256 || query.chars().any(char::is_control) {
            return Err(git_history_search_invalid_request());
        }
        let mode = HistorySearchMode::from(self.mode);
        if mode == HistorySearchMode::Sha
            && (query.len() < 4
                || query.len() > 40
                || !query.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            return Err(git_history_search_invalid_request());
        }
        Ok((mode, query.to_owned()))
    }
}

/// Mirrors `log::is_lowercase_hex40` — kept as its own independent copy
/// here, exactly like `MAX_GIT_MUTATE_PATH_BYTES` above is this file's own
/// copy of a ceiling also enforced deeper in the stack (see
/// `git::commit`'s module doc comment for why domain functions re-validate
/// what the DTO layer already checked, and vice versa here: the DTO layer
/// rejects a malformed `expectedSha` before ever resolving a repository).
fn is_lowercase_hex40(bytes: &[u8]) -> bool {
    bytes.len() == 40
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitFileHistoryRequest {
    path: String,
}

impl GitFileHistoryRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if !is_valid_mutate_path(&self.path) {
            return Err(git_log_invalid_request());
        }
        Ok(self.path)
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLogLineRangeWire {
    start: u32,
    end: u32,
}

fn line_range_from_wire(value: GitLogLineRangeWire) -> Result<LineRange, CommandError> {
    if value.start == 0 || value.end < value.start {
        return Err(git_log_invalid_request());
    }
    Ok(LineRange {
        start: value.start,
        end: value.end,
    })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLineHistoryListRequest {
    path: String,
    range: GitLogLineRangeWire,
}

impl GitLineHistoryListRequest {
    pub(crate) fn into_parts(self) -> Result<(String, LineRange), CommandError> {
        if !is_valid_mutate_path(&self.path) {
            return Err(git_log_invalid_request());
        }
        let range = line_range_from_wire(self.range)?;
        Ok((self.path, range))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLineHistoryDetailRequest {
    path: String,
    range: GitLogLineRangeWire,
    skip: u32,
    expected_sha: String,
}

impl GitLineHistoryDetailRequest {
    pub(crate) fn into_parts(self) -> Result<(String, LineRange, u32, String), CommandError> {
        if !is_valid_mutate_path(&self.path) {
            return Err(git_log_invalid_request());
        }
        let range = line_range_from_wire(self.range)?;
        if !is_lowercase_hex40(self.expected_sha.as_bytes()) {
            return Err(git_log_invalid_request());
        }
        Ok((self.path, range, self.skip, self.expected_sha))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryEntryWire {
    sha: String,
    message: String,
}

impl From<HistoryEntry> for GitHistoryEntryWire {
    fn from(value: HistoryEntry) -> Self {
        Self {
            sha: value.sha,
            message: value.message,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryListResultWire {
    entries: Vec<GitHistoryEntryWire>,
    truncated: bool,
}

impl From<HistoryList> for GitHistoryListResultWire {
    fn from(value: HistoryList) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(GitHistoryEntryWire::from)
                .collect(),
            truncated: value.truncated,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLineHistoryDetailResultWire {
    sha: String,
    diff_text: String,
}

impl From<LineHistoryDetail> for GitLineHistoryDetailResultWire {
    fn from(value: LineHistoryDetail) -> Self {
        Self {
            sha: value.sha,
            diff_text: value.diff_text,
        }
    }
}

// --- git_show_commit / git_show_commit_blob (F090 S2) -----------------------

fn git_show_commit_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_SHOW_COMMIT_INVALID_REQUEST",
        "The git show commit request is invalid.",
    )
}

fn git_show_commit_blob_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_SHOW_COMMIT_BLOB_INVALID_REQUEST",
        "The git show commit blob request is invalid.",
    )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitShowCommitRequest {
    sha: String,
}

impl GitShowCommitRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if !is_lowercase_hex40(self.sha.as_bytes()) {
            return Err(git_show_commit_invalid_request());
        }
        Ok(self.sha)
    }
}

/// Wire projection of one `git::show_commit::ShowCommitResult` — `files`
/// reuses [`GitDiffFileEntryWire`] verbatim (the exact same wire shape
/// [`GitDiffFilesResult`] already exposes): `show_commit`'s file list is
/// built from the identical `git::diff::DiffFileEntry` domain type
/// `diff_files` produces, just from a different pair of `git diff`
/// invocations server-side (see `show_commit.rs`'s own module doc comment)
/// — there is no reason for the wire shape to diverge, and reusing it means
/// the frontend's existing `decodeGitDiffFileEntry`-style decoding logic
/// (already thoroughly tested against `git_diff_files`) applies unchanged.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShowCommitResult {
    sha: String,
    parent_sha: Option<String>,
    files: Vec<GitDiffFileEntryWire>,
}

impl From<ShowCommitResult> for GitShowCommitResult {
    fn from(value: ShowCommitResult) -> Self {
        Self {
            sha: value.sha,
            parent_sha: value.parent_sha,
            files: value
                .files
                .into_iter()
                .map(GitDiffFileEntryWire::from)
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitShowCommitBlobRequest {
    sha: String,
    path: String,
}

impl GitShowCommitBlobRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        if !is_lowercase_hex40(self.sha.as_bytes()) {
            return Err(git_show_commit_blob_invalid_request());
        }
        if self.path.is_empty() || self.path.len() > MAX_GIT_SHOW_BLOB_PATH_BYTES {
            return Err(git_show_commit_blob_invalid_request());
        }
        Ok((self.sha, self.path))
    }
}

// --- git_log_graph (F090 S3) -------------------------------------------------

/// Mirrors `log::MAX_GRAPH_MAX_COUNT` — kept as its own independent wire-layer
/// copy, exactly like `MAX_GIT_MUTATE_PATH_BYTES` above is this file's own
/// copy of a ceiling also enforced deeper in the stack (see `git::commit`'s
/// module doc comment for why domain functions re-validate what the DTO
/// layer already checked, and vice versa here).
const MAX_GIT_LOG_GRAPH_MAX_COUNT: u32 = 5_000;

fn git_log_graph_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_LOG_GRAPH_INVALID_REQUEST",
        "The requested max_count is zero or exceeds the allowed ceiling.",
    )
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLogGraphRequest {
    max_count: u32,
}

impl GitLogGraphRequest {
    pub(crate) fn into_parts(self) -> Result<u32, CommandError> {
        if self.max_count == 0 || self.max_count > MAX_GIT_LOG_GRAPH_MAX_COUNT {
            return Err(git_log_graph_invalid_request());
        }
        Ok(self.max_count)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphNodeWire {
    sha: String,
    parents: Vec<String>,
    subject: String,
}

impl From<GraphNode> for GitGraphNodeWire {
    fn from(value: GraphNode) -> Self {
        Self {
            sha: value.sha,
            parents: value.parents,
            subject: value.subject,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogGraphResultWire {
    nodes: Vec<GitGraphNodeWire>,
    truncated: bool,
}

impl From<GraphList> for GitLogGraphResultWire {
    fn from(value: GraphList) -> Self {
        Self {
            nodes: value
                .nodes
                .into_iter()
                .map(GitGraphNodeWire::from)
                .collect(),
            truncated: value.truncated,
        }
    }
}

// --- git_refs_list (F090 S3) -------------------------------------------------

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitRefsListRequest {}

impl GitRefsListRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRefKindWire {
    Branch,
    RemoteBranch,
    Tag,
}

impl From<RefGroupKind> for GitRefKindWire {
    fn from(value: RefGroupKind) -> Self {
        match value {
            RefGroupKind::Branch => Self::Branch,
            RefGroupKind::RemoteBranch => Self::RemoteBranch,
            RefGroupKind::Tag => Self::Tag,
        }
    }
}

/// `upstream`/`peeledSha` are `None` (never an empty-string sentinel) for
/// "not applicable" — see `refs::RefEntry`'s own doc comment for why this
/// mirrors `status.rs`'s existing `Option`-for-absence convention rather than
/// `GitBranchWire`'s different "verbatim git-native token" one (there the
/// tokens `"(initial)"`/`"(detached)"` cannot collide with a real value and
/// are already a documented frontend convention; here the sentinel would be
/// purely this wire layer's own invention, so it is avoided entirely).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefEntryWire {
    kind: GitRefKindWire,
    full_name: String,
    short_name: String,
    target_sha: String,
    is_annotated_tag: bool,
    peeled_sha: Option<String>,
    upstream: Option<String>,
    is_head: bool,
}

impl From<RefEntry> for GitRefEntryWire {
    fn from(value: RefEntry) -> Self {
        Self {
            kind: value.kind.into(),
            full_name: value.full_name.to_wire_lossy(),
            short_name: value.short_name.to_wire_lossy(),
            target_sha: value.target_sha,
            is_annotated_tag: value.is_annotated_tag,
            peeled_sha: value.peeled_sha,
            upstream: value.upstream.map(|upstream| upstream.to_wire_lossy()),
            is_head: value.is_head,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefsListResultWire {
    entries: Vec<GitRefEntryWire>,
    truncated: bool,
}

impl From<RefList> for GitRefsListResultWire {
    fn from(value: RefList) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(GitRefEntryWire::from)
                .collect(),
            truncated: value.truncated,
        }
    }
}

// --- F180 S1A read models: remotes / reflog / contributors -----------------

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitRemotesListRequest {}

impl GitRemotesListRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteEntryWire {
    name: String,
    fetch_urls: Vec<String>,
    push_urls: Vec<String>,
}

impl From<RemoteEntry> for GitRemoteEntryWire {
    fn from(value: RemoteEntry) -> Self {
        Self {
            name: value.name,
            fetch_urls: value.fetch_urls,
            push_urls: value.push_urls,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemotesListResultWire {
    entries: Vec<GitRemoteEntryWire>,
    truncated: bool,
}

impl From<RemoteList> for GitRemotesListResultWire {
    fn from(value: RemoteList) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(GitRemoteEntryWire::from)
                .collect(),
            truncated: value.truncated,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitReflogListRequest {}

impl GitReflogListRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReflogEntryWire {
    sha: String,
    selector: String,
    committer_time: i64,
    summary: String,
}

impl From<ReflogEntry> for GitReflogEntryWire {
    fn from(value: ReflogEntry) -> Self {
        Self {
            sha: value.sha,
            selector: value.selector,
            committer_time: value.committer_time,
            summary: value.summary,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReflogListResultWire {
    entries: Vec<GitReflogEntryWire>,
    truncated: bool,
}

impl From<ReflogList> for GitReflogListResultWire {
    fn from(value: ReflogList) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(GitReflogEntryWire::from)
                .collect(),
            truncated: value.truncated,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitContributorsListRequest {}

impl GitContributorsListRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContributorEntryWire {
    name: String,
    email: String,
    commits: u32,
}

impl From<ContributorEntry> for GitContributorEntryWire {
    fn from(value: ContributorEntry) -> Self {
        Self {
            name: value.name,
            email: value.email,
            commits: value.commits,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContributorsListResultWire {
    entries: Vec<GitContributorEntryWire>,
    truncated: bool,
}

impl From<ContributorList> for GitContributorsListResultWire {
    fn from(value: ContributorList) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(GitContributorEntryWire::from)
                .collect(),
            truncated: value.truncated,
        }
    }
}

// --- F180 S1B branch/tag/remote/upstream mutation authority ---------------

const MAX_GIT_MANAGEMENT_REF_NAME_BYTES: usize = 1_024;
const MAX_GIT_MANAGEMENT_REMOTE_NAME_BYTES: usize = 255;
const MAX_GIT_MANAGEMENT_REMOTE_URL_BYTES: usize = 4_096;
const MAX_GIT_MANAGEMENT_TAG_MESSAGE_BYTES: usize = 100_000;

fn git_branch_management_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_BRANCH_MANAGEMENT_INVALID_REQUEST",
        "The Git branch management request is invalid.",
    )
}

fn git_tag_management_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_TAG_MANAGEMENT_INVALID_REQUEST",
        "The Git tag management request is invalid.",
    )
}

fn git_remote_management_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_REMOTE_MANAGEMENT_INVALID_REQUEST",
        "The Git remote management request is invalid.",
    )
}

fn git_upstream_management_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_UPSTREAM_MANAGEMENT_INVALID_REQUEST",
        "The Git upstream management request is invalid.",
    )
}

fn management_name_is_valid(value: &str, max_bytes: usize, allow_slash: bool) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && !value.starts_with('-')
        && !value.starts_with("refs/")
        && !value.chars().any(char::is_control)
        && (allow_slash || !value.contains('/'))
}

fn management_sha_is_valid(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitBranchCreateRequest {
    name: String,
    target_sha: String,
}

impl GitBranchCreateRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        if !management_name_is_valid(&self.name, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true)
            || !management_sha_is_valid(&self.target_sha)
        {
            return Err(git_branch_management_invalid_request());
        }
        Ok((self.name, self.target_sha))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitBranchSwitchRequest {
    name: String,
}

impl GitBranchSwitchRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if !management_name_is_valid(&self.name, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true) {
            return Err(git_branch_management_invalid_request());
        }
        Ok(self.name)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitBranchRenameRequest {
    old_name: String,
    new_name: String,
}

impl GitBranchRenameRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        if !management_name_is_valid(&self.old_name, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true)
            || !management_name_is_valid(&self.new_name, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true)
        {
            return Err(git_branch_management_invalid_request());
        }
        Ok((self.old_name, self.new_name))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitBranchDeleteRequest {
    name: String,
    force: bool,
}

impl GitBranchDeleteRequest {
    pub(crate) fn into_parts(self) -> Result<(String, bool), CommandError> {
        if !management_name_is_valid(&self.name, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true) {
            return Err(git_branch_management_invalid_request());
        }
        Ok((self.name, self.force))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitBranchDeleteOutcomeWire {
    Deleted,
    NeedsForce,
}

impl From<BranchDeleteOutcome> for GitBranchDeleteOutcomeWire {
    fn from(value: BranchDeleteOutcome) -> Self {
        match value {
            BranchDeleteOutcome::Deleted => Self::Deleted,
            BranchDeleteOutcome::NeedsForce => Self::NeedsForce,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitTagCreateRequest {
    name: String,
    target_sha: String,
    message: Option<String>,
}

impl GitTagCreateRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String, Option<String>), CommandError> {
        if !management_name_is_valid(&self.name, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true)
            || !management_sha_is_valid(&self.target_sha)
            || self.message.as_ref().is_some_and(|message| {
                message.trim().is_empty() || message.len() > MAX_GIT_MANAGEMENT_TAG_MESSAGE_BYTES
            })
        {
            return Err(git_tag_management_invalid_request());
        }
        Ok((self.name, self.target_sha, self.message))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitTagDeleteRequest {
    name: String,
}

impl GitTagDeleteRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if !management_name_is_valid(&self.name, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true) {
            return Err(git_tag_management_invalid_request());
        }
        Ok(self.name)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitRemoteAddRequest {
    name: String,
    url: String,
}

impl GitRemoteAddRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        if !management_name_is_valid(&self.name, MAX_GIT_MANAGEMENT_REMOTE_NAME_BYTES, false)
            || self.url.is_empty()
            || self.url.len() > MAX_GIT_MANAGEMENT_REMOTE_URL_BYTES
            || self.url.chars().any(char::is_control)
        {
            return Err(git_remote_management_invalid_request());
        }
        Ok((self.name, self.url))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitRemoteRenameRequest {
    old_name: String,
    new_name: String,
}

impl GitRemoteRenameRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        if !management_name_is_valid(&self.old_name, MAX_GIT_MANAGEMENT_REMOTE_NAME_BYTES, false)
            || !management_name_is_valid(
                &self.new_name,
                MAX_GIT_MANAGEMENT_REMOTE_NAME_BYTES,
                false,
            )
        {
            return Err(git_remote_management_invalid_request());
        }
        Ok((self.old_name, self.new_name))
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRemoteUrlKindRequest {
    Fetch,
    Push,
}

impl From<GitRemoteUrlKindRequest> for RemoteUrlKind {
    fn from(value: GitRemoteUrlKindRequest) -> Self {
        match value {
            GitRemoteUrlKindRequest::Fetch => Self::Fetch,
            GitRemoteUrlKindRequest::Push => Self::Push,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitRemoteSetUrlRequest {
    name: String,
    kind: GitRemoteUrlKindRequest,
    url: String,
}

impl GitRemoteSetUrlRequest {
    pub(crate) fn into_parts(self) -> Result<(String, RemoteUrlKind, String), CommandError> {
        if !management_name_is_valid(&self.name, MAX_GIT_MANAGEMENT_REMOTE_NAME_BYTES, false)
            || self.url.is_empty()
            || self.url.len() > MAX_GIT_MANAGEMENT_REMOTE_URL_BYTES
            || self.url.chars().any(char::is_control)
        {
            return Err(git_remote_management_invalid_request());
        }
        Ok((self.name, self.kind.into(), self.url))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitRemoteRemoveRequest {
    name: String,
}

impl GitRemoteRemoveRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if !management_name_is_valid(&self.name, MAX_GIT_MANAGEMENT_REMOTE_NAME_BYTES, false) {
            return Err(git_remote_management_invalid_request());
        }
        Ok(self.name)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitUpstreamSetRequest {
    branch: String,
    upstream: String,
}

impl GitUpstreamSetRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        if !management_name_is_valid(&self.branch, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true)
            || !management_name_is_valid(&self.upstream, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true)
            || !self.upstream.contains('/')
            || self.upstream.starts_with('/')
            || self.upstream.ends_with('/')
        {
            return Err(git_upstream_management_invalid_request());
        }
        Ok((self.branch, self.upstream))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitUpstreamUnsetRequest {
    branch: String,
}

impl GitUpstreamUnsetRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if !management_name_is_valid(&self.branch, MAX_GIT_MANAGEMENT_REF_NAME_BYTES, true) {
            return Err(git_upstream_management_invalid_request());
        }
        Ok(self.branch)
    }
}

// --- F180 S3 history mutation authority -----------------------------------

fn git_history_preview_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_HISTORY_PREVIEW_INVALID_REQUEST",
        "The Git history preview request is invalid.",
    )
}

fn git_history_mutation_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_HISTORY_MUTATION_INVALID_REQUEST",
        "The Git history mutation request is invalid.",
    )
}

fn history_preview_token_is_valid(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitHistoryOperationWire {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    ResetSoft,
    ResetMixed,
    ResetHard,
}

impl From<GitHistoryOperationWire> for HistoryOperation {
    fn from(value: GitHistoryOperationWire) -> Self {
        match value {
            GitHistoryOperationWire::Merge => Self::Merge,
            GitHistoryOperationWire::Rebase => Self::Rebase,
            GitHistoryOperationWire::CherryPick => Self::CherryPick,
            GitHistoryOperationWire::Revert => Self::Revert,
            GitHistoryOperationWire::ResetSoft => Self::ResetSoft,
            GitHistoryOperationWire::ResetMixed => Self::ResetMixed,
            GitHistoryOperationWire::ResetHard => Self::ResetHard,
        }
    }
}

impl From<HistoryOperation> for GitHistoryOperationWire {
    fn from(value: HistoryOperation) -> Self {
        match value {
            HistoryOperation::Merge => Self::Merge,
            HistoryOperation::Rebase => Self::Rebase,
            HistoryOperation::CherryPick => Self::CherryPick,
            HistoryOperation::Revert => Self::Revert,
            HistoryOperation::ResetSoft => Self::ResetSoft,
            HistoryOperation::ResetMixed => Self::ResetMixed,
            HistoryOperation::ResetHard => Self::ResetHard,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitSequencerKindWire {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

impl From<GitSequencerKindWire> for SequencerKind {
    fn from(value: GitSequencerKindWire) -> Self {
        match value {
            GitSequencerKindWire::Merge => Self::Merge,
            GitSequencerKindWire::Rebase => Self::Rebase,
            GitSequencerKindWire::CherryPick => Self::CherryPick,
            GitSequencerKindWire::Revert => Self::Revert,
        }
    }
}

impl From<SequencerKind> for GitSequencerKindWire {
    fn from(value: SequencerKind) -> Self {
        match value {
            SequencerKind::Merge => Self::Merge,
            SequencerKind::Rebase => Self::Rebase,
            SequencerKind::CherryPick => Self::CherryPick,
            SequencerKind::Revert => Self::Revert,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GitResetModeRequest {
    Soft,
    Mixed,
    Hard,
}

impl From<GitResetModeRequest> for HistoryOperation {
    fn from(value: GitResetModeRequest) -> Self {
        match value {
            GitResetModeRequest::Soft => Self::ResetSoft,
            GitResetModeRequest::Mixed => Self::ResetMixed,
            GitResetModeRequest::Hard => Self::ResetHard,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitHistoryStateRequest {}

impl GitHistoryStateRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitHistoryPreviewRequest {
    operation: GitHistoryOperationWire,
    target_sha: String,
}

impl GitHistoryPreviewRequest {
    pub(crate) fn into_parts(self) -> Result<(HistoryOperation, String), CommandError> {
        if !management_sha_is_valid(&self.target_sha) {
            return Err(git_history_preview_invalid_request());
        }
        Ok((self.operation.into(), self.target_sha))
    }
}

fn history_target_parts(
    target_sha: String,
    preview_token: String,
) -> Result<(String, String), CommandError> {
    if !management_sha_is_valid(&target_sha) || !history_preview_token_is_valid(&preview_token) {
        return Err(git_history_mutation_invalid_request());
    }
    Ok((target_sha, preview_token))
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitMergeRequest {
    target_sha: String,
    preview_token: String,
}

impl GitMergeRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        history_target_parts(self.target_sha, self.preview_token)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitRebaseRequest {
    target_sha: String,
    preview_token: String,
}

impl GitRebaseRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        history_target_parts(self.target_sha, self.preview_token)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitCherryPickRequest {
    target_sha: String,
    preview_token: String,
}

impl GitCherryPickRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        history_target_parts(self.target_sha, self.preview_token)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitRevertRequest {
    target_sha: String,
    preview_token: String,
}

impl GitRevertRequest {
    pub(crate) fn into_parts(self) -> Result<(String, String), CommandError> {
        history_target_parts(self.target_sha, self.preview_token)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitResetRequest {
    target_sha: String,
    mode: GitResetModeRequest,
    preview_token: String,
}

impl GitResetRequest {
    pub(crate) fn into_parts(self) -> Result<(HistoryOperation, String, String), CommandError> {
        if !management_sha_is_valid(&self.target_sha)
            || !history_preview_token_is_valid(&self.preview_token)
        {
            return Err(git_history_mutation_invalid_request());
        }
        Ok((self.mode.into(), self.target_sha, self.preview_token))
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitHistoryContinueRequest {
    kind: GitSequencerKindWire,
}

impl GitHistoryContinueRequest {
    pub(crate) fn into_parts(self) -> SequencerKind {
        self.kind.into()
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitHistoryAbortRequest {
    kind: GitSequencerKindWire,
}

impl GitHistoryAbortRequest {
    pub(crate) fn into_parts(self) -> SequencerKind {
        self.kind.into()
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitHistoryCancelRequest {}

impl GitHistoryCancelRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSequencerStateWire {
    kind: GitSequencerKindWire,
    conflicted_paths: Vec<String>,
    paths_truncated: bool,
}

impl From<SequencerState> for GitSequencerStateWire {
    fn from(value: SequencerState) -> Self {
        Self {
            kind: value.kind.into(),
            conflicted_paths: value
                .conflicted_paths
                .into_iter()
                .map(|path| path.to_wire_lossy())
                .collect(),
            paths_truncated: value.paths_truncated,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryStateResultWire {
    head_sha: String,
    sequencer: Option<GitSequencerStateWire>,
}

impl From<HistoryState> for GitHistoryStateResultWire {
    fn from(value: HistoryState) -> Self {
        Self {
            head_sha: value.head_sha,
            sequencer: value.sequencer.map(GitSequencerStateWire::from),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryPreviewResultWire {
    operation: GitHistoryOperationWire,
    target_sha: String,
    head_sha: String,
    ahead: u64,
    behind: u64,
    working_tree_paths: Vec<String>,
    staged_paths: Vec<String>,
    conflicted_paths: Vec<String>,
    paths_truncated: bool,
    sequencer: Option<GitSequencerStateWire>,
    preview_token: String,
}

impl From<HistoryPreview> for GitHistoryPreviewResultWire {
    fn from(value: HistoryPreview) -> Self {
        Self {
            operation: value.operation.into(),
            target_sha: value.target_sha,
            head_sha: value.head_sha,
            ahead: value.ahead,
            behind: value.behind,
            working_tree_paths: value
                .working_tree_paths
                .into_iter()
                .map(|path| path.to_wire_lossy())
                .collect(),
            staged_paths: value
                .staged_paths
                .into_iter()
                .map(|path| path.to_wire_lossy())
                .collect(),
            conflicted_paths: value
                .conflicted_paths
                .into_iter()
                .map(|path| path.to_wire_lossy())
                .collect(),
            paths_truncated: value.paths_truncated,
            sequencer: value.sequencer.map(GitSequencerStateWire::from),
            preview_token: value.preview_token,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitHistoryMutationOutcomeKindWire {
    Completed,
    Conflicts,
    Stopped,
    Cancelled,
}

impl From<HistoryMutationOutcomeKind> for GitHistoryMutationOutcomeKindWire {
    fn from(value: HistoryMutationOutcomeKind) -> Self {
        match value {
            HistoryMutationOutcomeKind::Completed => Self::Completed,
            HistoryMutationOutcomeKind::Conflicts => Self::Conflicts,
            HistoryMutationOutcomeKind::Stopped => Self::Stopped,
            HistoryMutationOutcomeKind::Cancelled => Self::Cancelled,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryMutationOutcomeWire {
    kind: GitHistoryMutationOutcomeKindWire,
    state: GitHistoryStateResultWire,
}

impl From<HistoryMutationOutcome> for GitHistoryMutationOutcomeWire {
    fn from(value: HistoryMutationOutcome) -> Self {
        Self {
            kind: value.kind.into(),
            state: value.state.into(),
        }
    }
}

// --- git_stash_list / git_stash_show / git_stash_push / git_stash_apply /
// git_stash_pop / git_stash_drop (F090 S4) -----------------------------------
//
// Reuses this file's own single `is_lowercase_hex40` (defined above, next to
// `GitFileHistoryRequest`) — this file's own established convention is one
// module-scoped copy shared by every request DTO in `dto.rs` itself, not a
// fresh per-section copy (unlike each *domain* module under `src-tauri/src/git/`,
// which does keep its own independent copy per this codebase's established
// per-domain-function duplication convention).

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitStashListRequest {}

impl GitStashListRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntryWire {
    index: u32,
    sha: String,
    committer_time: i64,
    message: String,
}

impl From<StashEntry> for GitStashEntryWire {
    fn from(value: StashEntry) -> Self {
        Self {
            index: value.index,
            sha: value.sha,
            committer_time: value.committer_time,
            message: value.message,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashListResultWire {
    entries: Vec<GitStashEntryWire>,
    truncated: bool,
}

impl From<StashList> for GitStashListResultWire {
    fn from(value: StashList) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(GitStashEntryWire::from)
                .collect(),
            truncated: value.truncated,
        }
    }
}

fn git_stash_show_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_STASH_SHOW_INVALID_REQUEST",
        "The git stash show request is invalid.",
    )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStashShowRequest {
    sha: String,
}

impl GitStashShowRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if !is_lowercase_hex40(self.sha.as_bytes()) {
            return Err(git_stash_show_invalid_request());
        }
        Ok(self.sha)
    }
}

/// `files` reuses [`GitDiffFileEntryWire`] verbatim — the exact same wire
/// shape [`GitDiffFilesResult`]/[`GitShowCommitResult`] already expose (see
/// `stash.rs`'s own module doc comment for why `stash::show_stash` produces
/// the identical `DiffFileEntry` domain type).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashShowResultWire {
    sha: String,
    parent_sha: Option<String>,
    files: Vec<GitDiffFileEntryWire>,
}

impl From<StashShowResult> for GitStashShowResultWire {
    fn from(value: StashShowResult) -> Self {
        Self {
            sha: value.sha,
            parent_sha: value.parent_sha,
            files: value
                .files
                .into_iter()
                .map(GitDiffFileEntryWire::from)
                .collect(),
        }
    }
}

fn git_stash_push_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_STASH_PUSH_INVALID_REQUEST",
        "The stash message is empty or too large.",
    )
}

/// Mirrors `stash::MAX_GIT_STASH_MESSAGE_BYTES` — this file's own
/// independent copy, exactly like `MAX_GIT_COMMIT_MESSAGE_BYTES` above is its
/// own copy of a ceiling also enforced deeper in the stack.
const MAX_GIT_STASH_MESSAGE_BYTES: usize = 100_000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStashPushRequest {
    message: String,
    include_untracked: bool,
}

impl GitStashPushRequest {
    pub(crate) fn into_parts(self) -> Result<(String, bool), CommandError> {
        if self.message.trim().is_empty() || self.message.len() > MAX_GIT_STASH_MESSAGE_BYTES {
            return Err(git_stash_push_invalid_request());
        }
        Ok((self.message, self.include_untracked))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitStashPushOutcomeWire {
    Created,
    NoLocalChanges,
}

impl From<StashPushOutcome> for GitStashPushOutcomeWire {
    fn from(value: StashPushOutcome) -> Self {
        match value {
            StashPushOutcome::Created => Self::Created,
            StashPushOutcome::NoLocalChanges => Self::NoLocalChanges,
        }
    }
}

fn git_stash_apply_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_STASH_APPLY_INVALID_REQUEST",
        "The git stash apply request is invalid.",
    )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStashApplyRequest {
    sha: String,
    use_index: bool,
}

impl GitStashApplyRequest {
    pub(crate) fn into_parts(self) -> Result<(String, bool), CommandError> {
        if !is_lowercase_hex40(self.sha.as_bytes()) {
            return Err(git_stash_apply_invalid_request());
        }
        Ok((self.sha, self.use_index))
    }
}

fn git_stash_pop_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_STASH_POP_INVALID_REQUEST",
        "The git stash pop request is invalid.",
    )
}

/// Unlike [`GitStashApplyRequest`], the field is named `expected_sha` (not
/// `sha`) — mirrors `GitLineHistoryDetailRequest`'s identical naming choice
/// for the same reason: this is a caller-held identity being *verified*
/// against a freshly re-resolved `stash@{N}`, not a value trusted blindly
/// (see `stash.rs`'s own module doc comment for the full rationale).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStashPopRequest {
    expected_sha: String,
    use_index: bool,
}

impl GitStashPopRequest {
    pub(crate) fn into_parts(self) -> Result<(String, bool), CommandError> {
        if !is_lowercase_hex40(self.expected_sha.as_bytes()) {
            return Err(git_stash_pop_invalid_request());
        }
        Ok((self.expected_sha, self.use_index))
    }
}

/// Shared wire projection of [`StashApplyOutcome`] for both `git_stash_apply`
/// and `git_stash_pop` — mirrors the domain type's own "shared result shape"
/// rationale (see `stash.rs`'s own doc comment on [`StashApplyOutcome`]).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitStashApplyOutcomeWire {
    Applied,
    Conflict { conflicted_paths: Vec<String> },
}

impl From<StashApplyOutcome> for GitStashApplyOutcomeWire {
    fn from(value: StashApplyOutcome) -> Self {
        match value {
            StashApplyOutcome::Applied => Self::Applied,
            StashApplyOutcome::Conflict { conflicted_paths } => Self::Conflict {
                conflicted_paths: conflicted_paths
                    .into_iter()
                    .map(|path| path.to_wire_lossy())
                    .collect(),
            },
        }
    }
}

fn git_stash_drop_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_STASH_DROP_INVALID_REQUEST",
        "The git stash drop request is invalid.",
    )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStashDropRequest {
    expected_sha: String,
}

impl GitStashDropRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if !is_lowercase_hex40(self.expected_sha.as_bytes()) {
            return Err(git_stash_drop_invalid_request());
        }
        Ok(self.expected_sha)
    }
}

// --- Git worktree (F090 S5: `git::worktree`) --------------------------------

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitWorktreeListRequest {}

impl GitWorktreeListRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitWorktreeHeadStateWire {
    Branch { ref_name: String },
    Detached,
    Bare,
}

impl From<WorktreeHeadState> for GitWorktreeHeadStateWire {
    fn from(value: WorktreeHeadState) -> Self {
        match value {
            WorktreeHeadState::Branch { ref_name } => Self::Branch {
                ref_name: ref_name.to_wire_lossy(),
            },
            WorktreeHeadState::Detached => Self::Detached,
            WorktreeHeadState::Bare => Self::Bare,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeEntryWire {
    path: String,
    head_sha: Option<String>,
    head_state: GitWorktreeHeadStateWire,
    lock_reason: Option<String>,
    prunable_reason: Option<String>,
    is_main: bool,
}

impl From<WorktreeEntry> for GitWorktreeEntryWire {
    fn from(value: WorktreeEntry) -> Self {
        Self {
            path: value.path.to_wire_lossy(),
            head_sha: value.head_sha,
            head_state: GitWorktreeHeadStateWire::from(value.head_state),
            lock_reason: value.locked_reason,
            prunable_reason: value.prunable_reason,
            is_main: value.is_main,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeListResultWire {
    entries: Vec<GitWorktreeEntryWire>,
    truncated: bool,
}

impl From<WorktreeList> for GitWorktreeListResultWire {
    fn from(value: WorktreeList) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(GitWorktreeEntryWire::from)
                .collect(),
            truncated: value.truncated,
        }
    }
}

fn git_worktree_add_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_INVALID_REQUEST",
        "The new worktree's folder name or requested revision is invalid.",
    )
}

/// Mirrors `worktree::MAX_WORKTREE_COMMIT_ISH_BYTES` — this file's own
/// independent copy, exactly like `MAX_GIT_COMMIT_MESSAGE_BYTES` above is its
/// own copy of a ceiling also enforced deeper in the stack.
const MAX_WORKTREE_COMMIT_ISH_BYTES: usize = 4_096;

/// Mirrors `crate::path_policy::MAX_RELATIVE_PATH_BYTES` — a cheap, wire-level
/// bound; the authoritative "is this a single, legal path segment" check is
/// `worktree::validate_worktree_child_segment`'s own re-validation through
/// `RelativePath::join_child`, exactly like every other domain function in
/// this codebase that re-checks what its own DTO layer already bounded.
const MAX_WORKTREE_CHILD_SEGMENT_BYTES: usize = 4_096;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitWorktreeAddRequest {
    child_segment: String,
    detach: bool,
    commit_ish: Option<String>,
}

impl GitWorktreeAddRequest {
    pub(crate) fn into_parts(self) -> Result<(String, bool, Option<String>), CommandError> {
        if self.child_segment.is_empty()
            || self.child_segment.len() > MAX_WORKTREE_CHILD_SEGMENT_BYTES
        {
            return Err(git_worktree_add_invalid_request());
        }
        if let Some(commit_ish) = &self.commit_ish {
            if commit_ish.is_empty() || commit_ish.len() > MAX_WORKTREE_COMMIT_ISH_BYTES {
                return Err(git_worktree_add_invalid_request());
            }
        }
        Ok((self.child_segment, self.detach, self.commit_ish))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitWorktreeAddOutcomeWire {
    Added { path: String },
    PickerCancelled,
}

impl From<WorktreeAddOutcome> for GitWorktreeAddOutcomeWire {
    fn from(value: WorktreeAddOutcome) -> Self {
        match value {
            WorktreeAddOutcome::Added { path } => Self::Added { path },
            WorktreeAddOutcome::PickerCancelled => Self::PickerCancelled,
        }
    }
}

fn git_worktree_remove_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_REMOVE_INVALID_REQUEST",
        "The worktree path is empty or too large.",
    )
}

/// Mirrors `worktree`'s own path handling — worktree paths are absolute
/// filesystem paths (not repository-relative), so `MAX_GIT_MUTATE_PATH_BYTES`/
/// `is_valid_mutate_path` (repo-relative-path-shaped) do not apply; this is
/// its own, differently-scoped ceiling.
const MAX_WORKTREE_PATH_BYTES: usize = 4_096;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitWorktreeRemoveRequest {
    path: String,
    force: bool,
}

impl GitWorktreeRemoveRequest {
    pub(crate) fn into_parts(self) -> Result<(String, bool), CommandError> {
        if self.path.is_empty() || self.path.len() > MAX_WORKTREE_PATH_BYTES {
            return Err(git_worktree_remove_invalid_request());
        }
        Ok((self.path, self.force))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitWorktreeRemoveOutcomeWire {
    Removed,
    NeedsForce,
}

impl From<WorktreeRemoveOutcome> for GitWorktreeRemoveOutcomeWire {
    fn from(value: WorktreeRemoveOutcome) -> Self {
        match value {
            WorktreeRemoveOutcome::Removed => Self::Removed,
            WorktreeRemoveOutcome::NeedsForce => Self::NeedsForce,
        }
    }
}

#[cfg(test)]
mod tests;
