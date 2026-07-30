//! `git status --porcelain=v2 -z --branch --ignored` invocation and parser
//! (`F080` S1 of `docs/research/2026-07-25-core-git.md` — see that document's
//! "S1 输出格式实测事实" section for the exact byte-level format this parser
//! implements; every claim below was independently re-verified against the
//! real `git 2.50.1` binary in this workspace with `xxd` before being encoded
//! here, not taken on faith from the research doc alone).
//!
//! # Record shape
//!
//! Every record (`NUL`-terminated; see [`super::wire::split_nul_records`])
//! is one of:
//! - `# <header>` — repository/branch metadata, zero or more, always first.
//! - `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` — an ordinary change.
//! - `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>` immediately
//!   followed by a *second* `NUL`-terminated record holding `origPath`
//!   verbatim — renames/copies are the one shape spanning two records, and
//!   the `path`/`origPath` separator is `NUL`, not `TAB` (confirmed by
//!   `xxd`; this is the single easiest-to-get-wrong detail in this format).
//! - `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>` — a conflicted
//!   (unmerged) entry.
//! - `? <path>` — untracked.
//! - `! <path>` — ignored (only emitted at all because the caller passes
//!   `--ignored`; git omits these entirely otherwise).

use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::resolve_repo_toplevel;
use super::wire::{split_n_fields, split_nul_records, GitPathBuf};

/// `# branch.oid` — no commits yet is the literal token `(initial)`, modeled
/// as its own variant rather than an `Option<String>` so a caller cannot
/// mistake "no commits" for "field missing" (which never happens for `oid`;
/// unlike `upstream`/`ab`, this header line is always present).
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum BranchOid {
    Initial,
    Commit(String),
}

/// `# branch.head` — detached HEAD is the literal token `(detached)`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum BranchHead {
    Detached,
    Named(String),
}

/// `# branch.upstream`/`# branch.ab`, always present or absent *together*:
/// with no upstream configured, both header lines are entirely missing from
/// the output (not present-but-empty) — see [`parse_porcelain_v2`]'s
/// consistency check.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BranchUpstream {
    pub(crate) name: String,
    pub(crate) ahead: u64,
    pub(crate) behind: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BranchInfo {
    pub(crate) oid: BranchOid,
    pub(crate) head: BranchHead,
    pub(crate) upstream: Option<BranchUpstream>,
}

/// The `<sub>` field, always exactly 4 ASCII characters, split into its four
/// independent boolean axes rather than kept as a raw string — verified
/// against `N...`/`S.M.`/`SC..`/`SC.U` fixtures.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct SubmoduleState {
    pub(crate) is_submodule: bool,
    pub(crate) commit_changed: bool,
    pub(crate) tracked_changed: bool,
    pub(crate) untracked_changed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RenameOrCopyKind {
    Rename,
    Copy,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct OrdinaryStatusEntry {
    pub(crate) index_status: char,
    pub(crate) worktree_status: char,
    pub(crate) submodule: SubmoduleState,
    pub(crate) mode_head: String,
    pub(crate) mode_index: String,
    pub(crate) mode_worktree: String,
    pub(crate) hash_head: String,
    pub(crate) hash_index: String,
    pub(crate) path: GitPathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RenameOrCopyStatusEntry {
    pub(crate) index_status: char,
    pub(crate) worktree_status: char,
    pub(crate) submodule: SubmoduleState,
    pub(crate) mode_head: String,
    pub(crate) mode_index: String,
    pub(crate) mode_worktree: String,
    pub(crate) hash_head: String,
    pub(crate) hash_index: String,
    pub(crate) kind: RenameOrCopyKind,
    pub(crate) similarity: u16,
    pub(crate) path: GitPathBuf,
    pub(crate) orig_path: GitPathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UnmergedStatusEntry {
    pub(crate) index_status: char,
    pub(crate) worktree_status: char,
    pub(crate) submodule: SubmoduleState,
    pub(crate) mode_stage1: String,
    pub(crate) mode_stage2: String,
    pub(crate) mode_stage3: String,
    pub(crate) mode_worktree: String,
    pub(crate) hash_stage1: String,
    pub(crate) hash_stage2: String,
    pub(crate) hash_stage3: String,
    pub(crate) path: GitPathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum StatusEntry {
    Ordinary(OrdinaryStatusEntry),
    RenameOrCopy(RenameOrCopyStatusEntry),
    Unmerged(UnmergedStatusEntry),
    Untracked(GitPathBuf),
    Ignored(GitPathBuf),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GitStatus {
    pub(crate) branch: BranchInfo,
    pub(crate) entries: Vec<StatusEntry>,
}

fn status_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_STATUS_PARSE_FAILED",
        "The git status output could not be parsed.",
    )
}

fn git_status_failed() -> CommandError {
    CommandError::new(
        "GIT_STATUS_FAILED",
        "git status did not complete successfully.",
    )
}

/// The exact, audited `git status` argument list — `--ignored` is passed
/// explicitly because git omits ignored entries entirely without it
/// (confirmed empirically). Unlike `git diff`, `git status` does not accept
/// `--no-color` at all (confirmed empirically — it is rejected as an unknown
/// option) and porcelain output is never colorized regardless, so no
/// color-suppression flag is needed here. Locked exactly by
/// `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STATUS_ARGS: &[&str] =
    &["status", "--porcelain=v2", "-z", "--branch", "--ignored"];

/// Resolves the current window's repository and runs [`GIT_STATUS_ARGS`]
/// through the hardened background-read exec path, then parses the result.
pub(crate) async fn git_status(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
) -> Result<GitStatus, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args: Vec<String> = GIT_STATUS_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;
    if output.exit_code != 0 {
        return Err(git_status_failed());
    }
    parse_porcelain_v2(&output.stdout)
}

pub(crate) fn parse_porcelain_v2(output: &[u8]) -> Result<GitStatus, CommandError> {
    let mut oid = None;
    let mut head = None;
    let mut upstream_name = None;
    let mut ab = None;
    let mut entries = Vec::new();

    let records = split_nul_records(output);
    let mut iter = records.into_iter();
    while let Some(record) = iter.next() {
        if record.is_empty() {
            continue;
        }
        match record[0] {
            b'#' => parse_header_line(record, &mut oid, &mut head, &mut upstream_name, &mut ab)?,
            b'1' => entries.push(StatusEntry::Ordinary(parse_ordinary(record)?)),
            b'2' => {
                let partial = parse_rename_prefix(record)?;
                let orig_record = iter.next().ok_or_else(status_parse_failed)?;
                entries.push(StatusEntry::RenameOrCopy(RenameOrCopyStatusEntry {
                    index_status: partial.index_status,
                    worktree_status: partial.worktree_status,
                    submodule: partial.submodule,
                    mode_head: partial.mode_head,
                    mode_index: partial.mode_index,
                    mode_worktree: partial.mode_worktree,
                    hash_head: partial.hash_head,
                    hash_index: partial.hash_index,
                    kind: partial.kind,
                    similarity: partial.similarity,
                    path: partial.path,
                    orig_path: GitPathBuf::from_bytes(orig_record.to_vec()),
                }));
            }
            b'u' => entries.push(StatusEntry::Unmerged(parse_unmerged(record)?)),
            b'?' => entries.push(StatusEntry::Untracked(parse_marker_path(record)?)),
            b'!' => entries.push(StatusEntry::Ignored(parse_marker_path(record)?)),
            _ => return Err(status_parse_failed()),
        }
    }

    let oid = oid.ok_or_else(status_parse_failed)?;
    let head = head.ok_or_else(status_parse_failed)?;
    let upstream = match (upstream_name, ab) {
        (Some(name), Some((ahead, behind))) => Some(BranchUpstream {
            name,
            ahead,
            behind,
        }),
        (None, None) => None,
        _ => return Err(status_parse_failed()),
    };
    Ok(GitStatus {
        branch: BranchInfo {
            oid,
            head,
            upstream,
        },
        entries,
    })
}

fn parse_header_line(
    record: &[u8],
    oid: &mut Option<BranchOid>,
    head: &mut Option<BranchHead>,
    upstream_name: &mut Option<String>,
    ab: &mut Option<(u64, u64)>,
) -> Result<(), CommandError> {
    let text = std::str::from_utf8(record).map_err(|_| status_parse_failed())?;
    let rest = text.strip_prefix("# ").ok_or_else(status_parse_failed)?;
    if let Some(value) = rest.strip_prefix("branch.oid ") {
        *oid = Some(if value == "(initial)" {
            BranchOid::Initial
        } else {
            BranchOid::Commit(value.to_owned())
        });
    } else if let Some(value) = rest.strip_prefix("branch.head ") {
        *head = Some(if value == "(detached)" {
            BranchHead::Detached
        } else {
            BranchHead::Named(value.to_owned())
        });
    } else if let Some(value) = rest.strip_prefix("branch.upstream ") {
        *upstream_name = Some(value.to_owned());
    } else if let Some(value) = rest.strip_prefix("branch.ab ") {
        let mut parts = value.split(' ');
        let ahead_token = parts.next().ok_or_else(status_parse_failed)?;
        let behind_token = parts.next().ok_or_else(status_parse_failed)?;
        if parts.next().is_some() {
            return Err(status_parse_failed());
        }
        let ahead: i64 = ahead_token.parse().map_err(|_| status_parse_failed())?;
        let behind: i64 = behind_token.parse().map_err(|_| status_parse_failed())?;
        *ab = Some((ahead.unsigned_abs(), behind.unsigned_abs()));
    }
    // Any other "# " line (a future git version's new header) is ignored
    // rather than rejected — forward-compatible, since this parser only
    // needs the four header lines above.
    Ok(())
}

fn parse_xy(field: &[u8]) -> Result<(char, char), CommandError> {
    if field.len() != 2 || !field.is_ascii() {
        return Err(status_parse_failed());
    }
    Ok((field[0] as char, field[1] as char))
}

fn parse_submodule(field: &[u8]) -> Result<SubmoduleState, CommandError> {
    if field.len() != 4 || !field.is_ascii() {
        return Err(status_parse_failed());
    }
    Ok(SubmoduleState {
        is_submodule: field[0] == b'S',
        commit_changed: field[1] == b'C',
        tracked_changed: field[2] == b'M',
        untracked_changed: field[3] == b'U',
    })
}

fn field_to_string(field: &[u8]) -> Result<String, CommandError> {
    std::str::from_utf8(field)
        .map(str::to_owned)
        .map_err(|_| status_parse_failed())
}

fn parse_ordinary(record: &[u8]) -> Result<OrdinaryStatusEntry, CommandError> {
    let fields = split_n_fields(record, 9).ok_or_else(status_parse_failed)?;
    let (index_status, worktree_status) = parse_xy(fields[1])?;
    Ok(OrdinaryStatusEntry {
        index_status,
        worktree_status,
        submodule: parse_submodule(fields[2])?,
        mode_head: field_to_string(fields[3])?,
        mode_index: field_to_string(fields[4])?,
        mode_worktree: field_to_string(fields[5])?,
        hash_head: field_to_string(fields[6])?,
        hash_index: field_to_string(fields[7])?,
        path: GitPathBuf::from_bytes(fields[8].to_vec()),
    })
}

struct RenameOrCopyPartial {
    index_status: char,
    worktree_status: char,
    submodule: SubmoduleState,
    mode_head: String,
    mode_index: String,
    mode_worktree: String,
    hash_head: String,
    hash_index: String,
    kind: RenameOrCopyKind,
    similarity: u16,
    path: GitPathBuf,
}

fn parse_rename_prefix(record: &[u8]) -> Result<RenameOrCopyPartial, CommandError> {
    let fields = split_n_fields(record, 10).ok_or_else(status_parse_failed)?;
    let (index_status, worktree_status) = parse_xy(fields[1])?;
    let submodule = parse_submodule(fields[2])?;
    let score_field = fields[8];
    if score_field.is_empty() {
        return Err(status_parse_failed());
    }
    let kind = match score_field[0] {
        b'R' => RenameOrCopyKind::Rename,
        b'C' => RenameOrCopyKind::Copy,
        _ => return Err(status_parse_failed()),
    };
    let similarity: u16 = std::str::from_utf8(&score_field[1..])
        .ok()
        .and_then(|text| text.parse().ok())
        .ok_or_else(status_parse_failed)?;
    Ok(RenameOrCopyPartial {
        index_status,
        worktree_status,
        submodule,
        mode_head: field_to_string(fields[3])?,
        mode_index: field_to_string(fields[4])?,
        mode_worktree: field_to_string(fields[5])?,
        hash_head: field_to_string(fields[6])?,
        hash_index: field_to_string(fields[7])?,
        kind,
        similarity,
        path: GitPathBuf::from_bytes(fields[9].to_vec()),
    })
}

fn parse_unmerged(record: &[u8]) -> Result<UnmergedStatusEntry, CommandError> {
    let fields = split_n_fields(record, 11).ok_or_else(status_parse_failed)?;
    let (index_status, worktree_status) = parse_xy(fields[1])?;
    Ok(UnmergedStatusEntry {
        index_status,
        worktree_status,
        submodule: parse_submodule(fields[2])?,
        mode_stage1: field_to_string(fields[3])?,
        mode_stage2: field_to_string(fields[4])?,
        mode_stage3: field_to_string(fields[5])?,
        mode_worktree: field_to_string(fields[6])?,
        hash_stage1: field_to_string(fields[7])?,
        hash_stage2: field_to_string(fields[8])?,
        hash_stage3: field_to_string(fields[9])?,
        path: GitPathBuf::from_bytes(fields[10].to_vec()),
    })
}

fn parse_marker_path(record: &[u8]) -> Result<GitPathBuf, CommandError> {
    let fields = split_n_fields(record, 2).ok_or_else(status_parse_failed)?;
    Ok(GitPathBuf::from_bytes(fields[1].to_vec()))
}

#[cfg(test)]
mod tests;
