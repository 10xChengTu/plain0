//! `git diff --name-status -z` / `git diff --numstat -z` (file-level diff
//! listing) and `git show <rev>:<path>` (single-version blob content) —
//! `F080` S1. See `docs/research/2026-07-25-core-git.md`'s "S1 输出格式实测
//!事实" section; every claim below was independently re-verified against
//! the real `git 2.50.1` binary in this workspace with `xxd`.
//!
//! # Two independent tokenizers
//!
//! `--name-status -z` and `--numstat -z` are **not** the same wire format,
//! despite both being `-z` output of the same `git diff`:
//!
//! - `--name-status -z`: every field — status code, and one or two paths —
//!   is its own `NUL`-terminated record. A plain change is two records
//!   (`status`, `path`); a rename/copy is three (`status`, `oldPath`,
//!   `newPath`).
//! - `--numstat -z`: within one record, `added`/`deleted`/`path` are
//!   **`TAB`**-separated, and records are `NUL`-separated — a completely
//!   different nesting from `--name-status`. A binary file reports
//!   `-\t-\tpath`. A rename reports an **empty** third (path) field
//!   immediately followed by two *more* `NUL`-delimited records holding
//!   `oldPath`/`newPath` verbatim (confirmed empirically for both a text
//!   rename and — separately — a byte-identical binary rename; a binary
//!   file whose content differs too much for git's similarity index did
//!   *not* get paired as a rename at all in testing, and instead surfaced
//!   as an ordinary delete + add, which this parser handles as two entries
//!   without needing to know why the pairing did or didn't happen).
//!
//! [`parse_name_status`] and [`parse_numstat`] are two separate functions
//! for exactly this reason — sharing one tokenizer between them would be
//! incorrect, not just less elegant. [`diff_files`] runs *two* separate
//! `git diff` invocations (git itself does not support emitting both
//! formats from one invocation) and joins their entries by path in
//! [`merge_diff_files`].

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::exec::{run_git, GitExecMode};
use super::git_exec_output_limit_exceeded;
use super::git_exec_unavailable;
use super::repo::resolve_repo_toplevel;
use super::wire::{split_nul_records, GitPathBuf};

/// 8 MiB — the same ceiling `workspace::commands::workspace_read_file` and
/// `search::dto`'s streaming-text-search default already use for "a whole
/// file's bytes in one IPC response", applied here to a single blob version.
const MAX_GIT_SHOW_BLOB_BYTES: usize = 8 * 1024 * 1024;
const MAX_GIT_SHOW_BLOB_PATH_BYTES: usize = 4_096;

fn diff_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_DIFF_PARSE_FAILED",
        "The git diff output could not be parsed.",
    )
}

fn git_diff_failed() -> CommandError {
    CommandError::new("GIT_DIFF_FAILED", "git diff did not complete successfully.")
}

fn git_show_blob_invalid_path() -> CommandError {
    CommandError::new(
        "GIT_SHOW_BLOB_INVALID_PATH",
        "The requested path is empty or too long.",
    )
}

fn git_show_blob_failed() -> CommandError {
    CommandError::new(
        "GIT_SHOW_BLOB_FAILED",
        "git show did not complete successfully.",
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DiffStatusKind {
    Added,
    Copied,
    Deleted,
    Modified,
    Renamed,
    TypeChanged,
    Unmerged,
    Unknown,
}

fn diff_status_kind(byte: u8) -> Result<DiffStatusKind, CommandError> {
    match byte {
        b'A' => Ok(DiffStatusKind::Added),
        b'C' => Ok(DiffStatusKind::Copied),
        b'D' => Ok(DiffStatusKind::Deleted),
        b'M' => Ok(DiffStatusKind::Modified),
        b'R' => Ok(DiffStatusKind::Renamed),
        b'T' => Ok(DiffStatusKind::TypeChanged),
        b'U' => Ok(DiffStatusKind::Unmerged),
        b'X' => Ok(DiffStatusKind::Unknown),
        _ => Err(diff_parse_failed()),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct NameStatusEntry {
    kind: DiffStatusKind,
    similarity: Option<u16>,
    path: GitPathBuf,
    orig_path: Option<GitPathBuf>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct NumstatEntry {
    added: Option<u64>,
    deleted: Option<u64>,
    path: GitPathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DiffFileEntry {
    pub(crate) kind: DiffStatusKind,
    pub(crate) similarity: Option<u16>,
    pub(crate) path: GitPathBuf,
    pub(crate) orig_path: Option<GitPathBuf>,
    pub(crate) added: Option<u64>,
    pub(crate) deleted: Option<u64>,
    pub(crate) binary: bool,
}

/// Tokenizes `--name-status -z` output: pure `NUL`-record fields, no `TAB`
/// nesting at all — see the module doc's "Two independent tokenizers"
/// section.
fn parse_name_status(output: &[u8]) -> Result<Vec<NameStatusEntry>, CommandError> {
    let mut entries = Vec::new();
    let mut iter = split_nul_records(output).into_iter();
    while let Some(status_token) = iter.next() {
        if status_token.is_empty() {
            continue;
        }
        let kind = diff_status_kind(status_token[0])?;
        if matches!(kind, DiffStatusKind::Renamed | DiffStatusKind::Copied) {
            let similarity_text =
                std::str::from_utf8(&status_token[1..]).map_err(|_| diff_parse_failed())?;
            let similarity: u16 = similarity_text.parse().map_err(|_| diff_parse_failed())?;
            let old_path = iter.next().ok_or_else(diff_parse_failed)?;
            let new_path = iter.next().ok_or_else(diff_parse_failed)?;
            entries.push(NameStatusEntry {
                kind,
                similarity: Some(similarity),
                path: GitPathBuf::from_bytes(new_path.to_vec()),
                orig_path: Some(GitPathBuf::from_bytes(old_path.to_vec())),
            });
        } else {
            let path = iter.next().ok_or_else(diff_parse_failed)?;
            entries.push(NameStatusEntry {
                kind,
                similarity: None,
                path: GitPathBuf::from_bytes(path.to_vec()),
                orig_path: None,
            });
        }
    }
    Ok(entries)
}

fn parse_numstat_count(field: &[u8]) -> Result<Option<u64>, CommandError> {
    if field == b"-" {
        return Ok(None);
    }
    std::str::from_utf8(field)
        .ok()
        .and_then(|text| text.parse::<u64>().ok())
        .map(Some)
        .ok_or_else(diff_parse_failed)
}

/// Tokenizes `--numstat -z` output: `TAB`-separated fields *within* a
/// record, `NUL`-separated records — the opposite nesting from
/// `--name-status`. See the module doc's "Two independent tokenizers"
/// section for the rename/binary special cases this implements.
fn parse_numstat(output: &[u8]) -> Result<Vec<NumstatEntry>, CommandError> {
    let mut entries = Vec::new();
    let mut iter = split_nul_records(output).into_iter();
    while let Some(record) = iter.next() {
        if record.is_empty() {
            continue;
        }
        let mut parts = record.splitn(3, |&byte| byte == b'\t');
        let added_field = parts.next().ok_or_else(diff_parse_failed)?;
        let deleted_field = parts.next().ok_or_else(diff_parse_failed)?;
        let path_field = parts.next().ok_or_else(diff_parse_failed)?;
        let added = parse_numstat_count(added_field)?;
        let deleted = parse_numstat_count(deleted_field)?;
        if path_field.is_empty() {
            // Rename: the path field is empty and the real old/new paths
            // follow as two more NUL records, verbatim, **old path first,
            // then new path** (confirmed empirically — easy to get backwards
            // since `--name-status`'s own rename record orders them the same
            // way, but this is a completely separate tokenizer).
            //
            // The old path is intentionally not retained here: `NumstatEntry`
            // only exists to donate its added/deleted counts to the
            // name-status entry with the same (new) path in
            // `merge_diff_files`, which already has its own `orig_path` from
            // the name-status record.
            let _old_path_unused = iter.next().ok_or_else(diff_parse_failed)?;
            let new_path = iter.next().ok_or_else(diff_parse_failed)?;
            entries.push(NumstatEntry {
                added,
                deleted,
                path: GitPathBuf::from_bytes(new_path.to_vec()),
            });
        } else {
            entries.push(NumstatEntry {
                added,
                deleted,
                path: GitPathBuf::from_bytes(path_field.to_vec()),
            });
        }
    }
    Ok(entries)
}

/// Joins `--name-status` (authoritative for `kind`/similarity/rename
/// pairing) and `--numstat` (authoritative for added/deleted line counts)
/// entries from two independent `git diff` invocations of the same
/// underlying state, by each entry's current (post-rename) path.
///
/// These are two separate process invocations, not one atomic snapshot —
/// a filesystem change landing between them could in principle make a path
/// present in one listing and absent from the other. This is accepted as an
/// inherent, momentary-staleness limitation of a two-invocation read (not a
/// correctness bug this function can fix on its own): a `--numstat` miss
/// simply reports `binary: true`/`None` counts for that entry rather than
/// failing the whole request.
fn merge_diff_files(
    name_status_entries: Vec<NameStatusEntry>,
    numstat_entries: Vec<NumstatEntry>,
) -> Vec<DiffFileEntry> {
    let mut counts: HashMap<Vec<u8>, (Option<u64>, Option<u64>)> = HashMap::new();
    for entry in &numstat_entries {
        counts.insert(entry.path.as_bytes().to_vec(), (entry.added, entry.deleted));
    }
    name_status_entries
        .into_iter()
        .map(|entry| {
            let (added, deleted) = counts
                .get(entry.path.as_bytes())
                .copied()
                .unwrap_or((None, None));
            let binary = added.is_none() && deleted.is_none();
            DiffFileEntry {
                kind: entry.kind,
                similarity: entry.similarity,
                path: entry.path,
                orig_path: entry.orig_path,
                added,
                deleted,
                binary,
            }
        })
        .collect()
}

/// The exact, audited base `git diff` argument list every file-level diff
/// invocation starts from — `-M` forces rename detection on regardless of
/// the repository's own `diff.renames` config (locale/config-independent);
/// `--no-textconv --no-ext-diff` are the caller-supplied hardening flags
/// `exec::harden_background_read`'s own doc comment requires for any
/// diff-family invocation. `--cached` and the format flag
/// (`--name-status`/`--numstat`) are appended per-call. Locked exactly by
/// `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_DIFF_BASE_ARGS: &[&str] = &[
    "diff",
    "--no-color",
    "-z",
    "-M",
    "--no-textconv",
    "--no-ext-diff",
];

async fn run_diff(
    repo_dir: &Path,
    cached: bool,
    format_flag: &'static str,
) -> Result<Vec<u8>, CommandError> {
    let mut args: Vec<String> = GIT_DIFF_BASE_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    if cached {
        args.push("--cached".to_owned());
    }
    args.push(format_flag.to_owned());
    let repo_dir = repo_dir.to_path_buf();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;
    if output.exit_code != 0 {
        return Err(git_diff_failed());
    }
    Ok(output.stdout)
}

pub(crate) async fn diff_files(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    cached: bool,
) -> Result<Vec<DiffFileEntry>, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let name_status_output = run_diff(&repo_dir, cached, "--name-status").await?;
    let numstat_output = run_diff(&repo_dir, cached, "--numstat").await?;
    let name_status_entries = parse_name_status(&name_status_output)?;
    let numstat_entries = parse_numstat(&numstat_output)?;
    Ok(merge_diff_files(name_status_entries, numstat_entries))
}

/// The closed set of revisions [`show_blob`] accepts — deliberately not an
/// arbitrary revision string (that would turn this into a general-purpose
/// `git_run`, exactly what ADR 0003 forbids).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GitBlobRev {
    Head,
    Index,
}

/// Reads one version of `path` via `git show`. Returns `Ok(None)` — not an
/// error — when git reports (via one of three distinguishable, exit-128
/// stderr messages) that no such version exists; this is an expected,
/// common outcome (e.g. a new untracked file has no `HEAD` version), not a
/// failure. Any other non-zero exit is a genuine [`git_show_blob_failed`]
/// error.
///
/// `path` is rendered into the revspec with a `./` prefix
/// (`HEAD:./<path>` / `:0:./<path>`) — confirmed empirically to be the
/// robust construction: the bare index shorthand `:<path>` (no explicit
/// stage) reports an *ambiguous argument* error instead of one of the three
/// clean "not found" messages for a path that does not exist, whereas the
/// explicit-stage `:0:<path>` form (used here for [`GitBlobRev::Index`])
/// does not have that problem.
/// The exact, audited base `git show` argument list — the revspec (with its
/// `./`-prefixed path) is appended per-call. Locked exactly by
/// `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_SHOW_BASE_ARGS: &[&str] =
    &["show", "--no-color", "--no-textconv", "--no-ext-diff"];

pub(crate) async fn show_blob(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    rev: GitBlobRev,
    path: &str,
) -> Result<Option<Vec<u8>>, CommandError> {
    if path.is_empty() || path.len() > MAX_GIT_SHOW_BLOB_PATH_BYTES {
        return Err(git_show_blob_invalid_path());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let revspec = match rev {
        GitBlobRev::Head => format!("HEAD:./{path}"),
        GitBlobRev::Index => format!(":0:./{path}"),
    };
    let mut args: Vec<String> = GIT_SHOW_BASE_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.push(revspec);
    let repo_dir_for_spawn = repo_dir.clone();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(
            &repo_dir_for_spawn,
            &args,
            GitExecMode::BackgroundRead,
            &cancel,
        )
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code == 0 {
        if output.stdout.len() > MAX_GIT_SHOW_BLOB_BYTES {
            return Err(git_exec_output_limit_exceeded());
        }
        return Ok(Some(output.stdout));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if is_missing_blob_stderr(&stderr) {
        return Ok(None);
    }
    Err(git_show_blob_failed())
}

/// The three distinguishable "no such version" stderr messages `git show
/// <rev>:<path>` prints (all exit code 128) — confirmed verbatim against
/// the real `git 2.50.1` binary: path missing from the given revision, path
/// present on disk but not in the given revision, and path absent from both
/// disk and the index entirely.
fn is_missing_blob_stderr(stderr: &str) -> bool {
    stderr.contains("does not exist in")
        || stderr.contains("exists on disk, but not in")
        || stderr.contains("does not exist (neither on disk nor in the index)")
}

#[cfg(test)]
mod tests;
