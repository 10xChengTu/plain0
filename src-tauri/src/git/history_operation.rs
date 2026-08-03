//! Root-bound local-history mutation authority for `F180` S3.
//!
//! Every write is a fixed, non-interactive Git command. A targeted mutation
//! must consume a SHA-256 preview token derived from its operation, target,
//! current HEAD, porcelain-v2 status bytes and sequencer kind. The token is
//! recomputed while the per-window/per-root operation slot is held, so a
//! stale UI confirmation never silently applies to a changed worktree.

use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;

use sha2::{Digest, Sha256};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::RootId;

use super::exec::{run_git, GitExecMode, GitExecOutput};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};
use super::status::{self, GitStatus, StatusEntry};
use super::wire::GitPathBuf;

pub(crate) const GIT_HISTORY_STATUS_ARGS: &[&str] = &[
    "status",
    "--porcelain=v2",
    "-z",
    "--branch",
    "--untracked-files=all",
];
pub(crate) const GIT_HISTORY_WORKTREE_DIFF_ARGS: &[&str] = &[
    "diff",
    "--binary",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--",
];
pub(crate) const GIT_HISTORY_STAGED_DIFF_ARGS: &[&str] = &[
    "diff",
    "--cached",
    "--binary",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--",
];
pub(crate) const GIT_MERGE_ARGS: &[&str] = &[
    "-c",
    "core.editor=true",
    "merge",
    "--no-edit",
    "--no-autostash",
    "--",
];
pub(crate) const GIT_REBASE_ARGS: &[&str] = &[
    "-c",
    "core.editor=true",
    "rebase",
    "--no-autostash",
    "--no-rebase-merges",
    "--no-update-refs",
    "--",
];
pub(crate) const GIT_CHERRY_PICK_ARGS: &[&str] =
    &["-c", "core.editor=true", "cherry-pick", "--no-edit", "--"];
pub(crate) const GIT_REVERT_ARGS: &[&str] =
    &["-c", "core.editor=true", "revert", "--no-edit", "--"];
pub(crate) const GIT_RESET_SOFT_ARGS: &[&str] = &["reset", "--soft"];
pub(crate) const GIT_RESET_MIXED_ARGS: &[&str] = &["reset", "--mixed"];
pub(crate) const GIT_RESET_HARD_ARGS: &[&str] = &["reset", "--hard"];
pub(crate) const GIT_MERGE_CONTINUE_ARGS: &[&str] =
    &["-c", "core.editor=true", "merge", "--continue"];
pub(crate) const GIT_REBASE_CONTINUE_ARGS: &[&str] =
    &["-c", "core.editor=true", "rebase", "--continue"];
pub(crate) const GIT_CHERRY_PICK_CONTINUE_ARGS: &[&str] =
    &["-c", "core.editor=true", "cherry-pick", "--continue"];
pub(crate) const GIT_REVERT_CONTINUE_ARGS: &[&str] =
    &["-c", "core.editor=true", "revert", "--continue"];
pub(crate) const GIT_MERGE_ABORT_ARGS: &[&str] = &["merge", "--abort"];
pub(crate) const GIT_REBASE_ABORT_ARGS: &[&str] = &["rebase", "--abort"];
pub(crate) const GIT_CHERRY_PICK_ABORT_ARGS: &[&str] = &["cherry-pick", "--abort"];
pub(crate) const GIT_REVERT_ABORT_ARGS: &[&str] = &["revert", "--abort"];

pub(crate) const MAX_HISTORY_PATHS: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HistoryOperation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    ResetSoft,
    ResetMixed,
    ResetHard,
}

impl HistoryOperation {
    fn token_name(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Rebase => "rebase",
            Self::CherryPick => "cherry-pick",
            Self::Revert => "revert",
            Self::ResetSoft => "reset-soft",
            Self::ResetMixed => "reset-mixed",
            Self::ResetHard => "reset-hard",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SequencerKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

impl SequencerKind {
    fn token_name(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Rebase => "rebase",
            Self::CherryPick => "cherry-pick",
            Self::Revert => "revert",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SequencerState {
    pub(crate) kind: SequencerKind,
    pub(crate) conflicted_paths: Vec<GitPathBuf>,
    pub(crate) paths_truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoryState {
    pub(crate) head_sha: String,
    pub(crate) sequencer: Option<SequencerState>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoryPreview {
    pub(crate) operation: HistoryOperation,
    pub(crate) target_sha: String,
    pub(crate) head_sha: String,
    pub(crate) ahead: u64,
    pub(crate) behind: u64,
    pub(crate) working_tree_paths: Vec<GitPathBuf>,
    pub(crate) staged_paths: Vec<GitPathBuf>,
    pub(crate) conflicted_paths: Vec<GitPathBuf>,
    pub(crate) paths_truncated: bool,
    pub(crate) sequencer: Option<SequencerState>,
    pub(crate) preview_token: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HistoryMutationOutcomeKind {
    Completed,
    Conflicts,
    Stopped,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoryMutationOutcome {
    pub(crate) kind: HistoryMutationOutcomeKind,
    pub(crate) state: HistoryState,
}

fn error(code: &'static str, message: &'static str) -> CommandError {
    CommandError::new(code, message)
}

fn history_preview_failed() -> CommandError {
    error(
        "GIT_HISTORY_PREVIEW_FAILED",
        "The Git history operation preview could not be computed.",
    )
}

fn history_target_invalid() -> CommandError {
    error(
        "GIT_HISTORY_TARGET_INVALID",
        "The requested Git history target is not a commit.",
    )
}

fn history_head_invalid() -> CommandError {
    error(
        "GIT_HISTORY_HEAD_INVALID",
        "The Git repository has no current commit to operate on.",
    )
}

fn history_preview_stale() -> CommandError {
    error(
        "GIT_HISTORY_PREVIEW_STALE",
        "The Git repository changed after the operation preview. Review it again before continuing.",
    )
}

fn history_operation_in_progress() -> CommandError {
    error(
        "GIT_HISTORY_OPERATION_IN_PROGRESS",
        "Finish or abort the current Git operation before starting another one.",
    )
}

fn history_operation_busy() -> CommandError {
    error(
        "GIT_HISTORY_OPERATION_BUSY",
        "Another Git history operation is already running for this repository.",
    )
}

fn history_operation_kind_changed() -> CommandError {
    error(
        "GIT_HISTORY_OPERATION_KIND_CHANGED",
        "The in-progress Git operation changed. Refresh its state before continuing.",
    )
}

fn history_no_operation() -> CommandError {
    error(
        "GIT_HISTORY_NO_OPERATION",
        "There is no Git history operation to continue or abort.",
    )
}

fn history_state_failed() -> CommandError {
    error(
        "GIT_HISTORY_STATE_FAILED",
        "The current Git history operation state could not be read.",
    )
}

fn history_mutation_failed(operation: HistoryOperation) -> CommandError {
    match operation {
        HistoryOperation::Merge => error("GIT_MERGE_FAILED", "The Git merge did not complete."),
        HistoryOperation::Rebase => error("GIT_REBASE_FAILED", "The Git rebase did not complete."),
        HistoryOperation::CherryPick => error(
            "GIT_CHERRY_PICK_FAILED",
            "The Git cherry-pick did not complete.",
        ),
        HistoryOperation::Revert => error("GIT_REVERT_FAILED", "The Git revert did not complete."),
        HistoryOperation::ResetSoft
        | HistoryOperation::ResetMixed
        | HistoryOperation::ResetHard => {
            error("GIT_RESET_FAILED", "The Git reset did not complete.")
        }
    }
}

fn history_continue_failed() -> CommandError {
    error(
        "GIT_HISTORY_CONTINUE_FAILED",
        "The Git history operation could not continue.",
    )
}

fn history_abort_failed() -> CommandError {
    error(
        "GIT_HISTORY_ABORT_FAILED",
        "The Git history operation could not be aborted.",
    )
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_owned()).collect()
}

fn run_read(repo_dir: &Path, args: Vec<String>) -> Result<GitExecOutput, CommandError> {
    let cancel = AtomicBool::new(false);
    run_git(repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
}

fn is_lowercase_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn read_commit_sha(
    repo_dir: &Path,
    rev: &str,
    error: fn() -> CommandError,
) -> Result<String, CommandError> {
    let output = run_read(
        repo_dir,
        vec![
            "rev-parse".to_owned(),
            "--verify".to_owned(),
            format!("{rev}^{{commit}}"),
        ],
    )?;
    if output.exit_code != 0 {
        return Err(error());
    }
    let value = std::str::from_utf8(&output.stdout)
        .ok()
        .map(str::trim)
        .filter(|value| is_lowercase_hex(value, 40))
        .ok_or_else(error)?;
    Ok(value.to_owned())
}

fn parse_ahead_behind(stdout: &[u8]) -> Option<(u64, u64)> {
    let text = std::str::from_utf8(stdout).ok()?.trim();
    let mut fields = text.split_ascii_whitespace();
    let behind = fields.next()?.parse().ok()?;
    let ahead = fields.next()?.parse().ok()?;
    if fields.next().is_some() {
        return None;
    }
    Some((ahead, behind))
}

fn git_dir_path(repo_dir: &Path) -> Result<PathBuf, CommandError> {
    let output = run_read(
        repo_dir,
        vec!["rev-parse".to_owned(), "--absolute-git-dir".to_owned()],
    )?;
    if output.exit_code != 0 {
        return Err(history_state_failed());
    }
    let mut bytes = output.stdout;
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    if bytes.is_empty() || bytes.contains(&0) {
        return Err(history_state_failed());
    }
    #[cfg(unix)]
    let path = PathBuf::from(OsString::from_vec(bytes));
    #[cfg(not(unix))]
    let path = PathBuf::from(String::from_utf8(bytes).map_err(|_| history_state_failed())?);
    if !path.is_absolute() {
        return Err(history_state_failed());
    }
    Ok(path)
}

fn marker_is(git_dir: &Path, name: &str, directory: bool) -> Result<bool, CommandError> {
    let path = git_dir.join(name);
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink()
                || (directory && !metadata.is_dir())
                || (!directory && !metadata.is_file())
            {
                return Err(history_state_failed());
            }
            Ok(true)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(_) => Err(history_state_failed()),
    }
}

fn sequencer_kind(repo_dir: &Path) -> Result<Option<SequencerKind>, CommandError> {
    let git_dir = git_dir_path(repo_dir)?;
    if marker_is(&git_dir, "rebase-merge", true)? || marker_is(&git_dir, "rebase-apply", true)? {
        return Ok(Some(SequencerKind::Rebase));
    }
    if marker_is(&git_dir, "CHERRY_PICK_HEAD", false)? {
        return Ok(Some(SequencerKind::CherryPick));
    }
    if marker_is(&git_dir, "REVERT_HEAD", false)? {
        return Ok(Some(SequencerKind::Revert));
    }
    if marker_is(&git_dir, "MERGE_HEAD", false)? {
        return Ok(Some(SequencerKind::Merge));
    }
    Ok(None)
}

fn read_status(repo_dir: &Path) -> Result<(GitStatus, Vec<u8>), CommandError> {
    let output = run_read(repo_dir, strings(GIT_HISTORY_STATUS_ARGS))?;
    if output.exit_code != 0 {
        return Err(history_state_failed());
    }
    let status = status::parse_porcelain_v2(&output.stdout).map_err(|_| history_state_failed())?;
    Ok((status, output.stdout))
}

#[derive(Default)]
struct PathProjection {
    working_tree: Vec<GitPathBuf>,
    staged: Vec<GitPathBuf>,
    conflicted: Vec<GitPathBuf>,
    truncated: bool,
}

fn push_bounded(target: &mut Vec<GitPathBuf>, path: &GitPathBuf, truncated: &mut bool) {
    if target.iter().any(|candidate| candidate == path) {
        return;
    }
    if target.len() == MAX_HISTORY_PATHS {
        *truncated = true;
        return;
    }
    target.push(path.clone());
}

fn project_paths(status: &GitStatus) -> PathProjection {
    let mut projection = PathProjection::default();
    for entry in &status.entries {
        match entry {
            StatusEntry::Ordinary(entry) => {
                if entry.index_status != '.' {
                    push_bounded(
                        &mut projection.staged,
                        &entry.path,
                        &mut projection.truncated,
                    );
                }
                if entry.worktree_status != '.' {
                    push_bounded(
                        &mut projection.working_tree,
                        &entry.path,
                        &mut projection.truncated,
                    );
                }
            }
            StatusEntry::RenameOrCopy(entry) => {
                if entry.index_status != '.' {
                    push_bounded(
                        &mut projection.staged,
                        &entry.path,
                        &mut projection.truncated,
                    );
                }
                if entry.worktree_status != '.' {
                    push_bounded(
                        &mut projection.working_tree,
                        &entry.path,
                        &mut projection.truncated,
                    );
                }
            }
            StatusEntry::Unmerged(entry) => push_bounded(
                &mut projection.conflicted,
                &entry.path,
                &mut projection.truncated,
            ),
            StatusEntry::Untracked(_) | StatusEntry::Ignored(_) => {}
        }
    }
    projection
}

fn make_sequencer_state(
    kind: Option<SequencerKind>,
    projection: &PathProjection,
) -> Option<SequencerState> {
    kind.map(|kind| SequencerState {
        kind,
        conflicted_paths: projection.conflicted.clone(),
        paths_truncated: projection.truncated,
    })
}

fn read_state_sync(repo_dir: &Path) -> Result<HistoryState, CommandError> {
    let head_sha = read_commit_sha(repo_dir, "HEAD", history_head_invalid)?;
    let kind = sequencer_kind(repo_dir)?;
    let (status, _) = read_status(repo_dir)?;
    let projection = project_paths(&status);
    Ok(HistoryState {
        head_sha,
        sequencer: make_sequencer_state(kind, &projection),
    })
}

fn preview_token(
    operation: HistoryOperation,
    target_sha: &str,
    head_sha: &str,
    status_bytes: &[u8],
    worktree_diff: &[u8],
    staged_diff: &[u8],
    sequencer: Option<SequencerKind>,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"plain-git-history-preview-v1\0");
    digest.update(operation.token_name().as_bytes());
    digest.update(b"\0");
    digest.update(target_sha.as_bytes());
    digest.update(b"\0");
    digest.update(head_sha.as_bytes());
    digest.update(b"\0");
    digest.update(
        sequencer
            .map(SequencerKind::token_name)
            .unwrap_or("none")
            .as_bytes(),
    );
    digest.update(b"\0");
    digest.update(status_bytes);
    digest.update(b"\0worktree-diff\0");
    digest.update(worktree_diff);
    digest.update(b"\0staged-diff\0");
    digest.update(staged_diff);
    format!("{:x}", digest.finalize())
}

fn compute_preview_sync(
    repo_dir: &Path,
    operation: HistoryOperation,
    target_sha: &str,
) -> Result<HistoryPreview, CommandError> {
    if !is_lowercase_hex(target_sha, 40) {
        return Err(history_target_invalid());
    }
    let target_sha = read_commit_sha(repo_dir, target_sha, history_target_invalid)?;
    let head_sha = read_commit_sha(repo_dir, "HEAD", history_head_invalid)?;
    let counts = run_read(
        repo_dir,
        vec![
            "rev-list".to_owned(),
            "--left-right".to_owned(),
            "--count".to_owned(),
            format!("{target_sha}...{head_sha}"),
        ],
    )?;
    if counts.exit_code != 0 {
        return Err(history_preview_failed());
    }
    let (ahead, behind) = parse_ahead_behind(&counts.stdout).ok_or_else(history_preview_failed)?;
    let kind = sequencer_kind(repo_dir)?;
    let (status, status_bytes) = read_status(repo_dir)?;
    let worktree_diff = run_read(repo_dir, strings(GIT_HISTORY_WORKTREE_DIFF_ARGS))?;
    let staged_diff = run_read(repo_dir, strings(GIT_HISTORY_STAGED_DIFF_ARGS))?;
    if worktree_diff.exit_code != 0 || staged_diff.exit_code != 0 {
        return Err(history_preview_failed());
    }
    let projection = project_paths(&status);
    let token = preview_token(
        operation,
        &target_sha,
        &head_sha,
        &status_bytes,
        &worktree_diff.stdout,
        &staged_diff.stdout,
        kind,
    );
    let sequencer = make_sequencer_state(kind, &projection);
    Ok(HistoryPreview {
        operation,
        target_sha,
        head_sha,
        ahead,
        behind,
        working_tree_paths: projection.working_tree,
        staged_paths: projection.staged,
        conflicted_paths: projection.conflicted.clone(),
        paths_truncated: projection.truncated,
        sequencer,
        preview_token: token,
    })
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct HistoryOperationKey {
    window_label: String,
    root_id: Option<RootId>,
}

impl HistoryOperationKey {
    fn new(window_label: &str, root_id: Option<RootId>) -> Self {
        Self {
            window_label: window_label.to_owned(),
            root_id,
        }
    }
}

#[derive(Default)]
pub struct GitHistoryOperationService {
    inflight: Mutex<HashMap<HistoryOperationKey, Arc<AtomicBool>>>,
}

impl GitHistoryOperationService {
    pub fn new() -> Self {
        Self::default()
    }

    fn begin(
        &self,
        window_label: &str,
        root_id: Option<RootId>,
    ) -> Result<HistoryOperationGuard<'_>, CommandError> {
        let key = HistoryOperationKey::new(window_label, root_id);
        let flag = Arc::new(AtomicBool::new(false));
        let mut inflight = self.inflight.lock().unwrap_or_else(PoisonError::into_inner);
        match inflight.entry(key.clone()) {
            Entry::Occupied(_) => Err(history_operation_busy()),
            Entry::Vacant(entry) => {
                entry.insert(Arc::clone(&flag));
                Ok(HistoryOperationGuard {
                    service: self,
                    key,
                    flag,
                })
            }
        }
    }

    pub(crate) fn request_cancel_for_root(&self, window_label: &str, root_id: RootId) {
        self.request_cancel(window_label, Some(root_id));
    }

    fn request_cancel(&self, window_label: &str, root_id: Option<RootId>) {
        if let Some(flag) = self
            .inflight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&HistoryOperationKey::new(window_label, root_id))
        {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

struct HistoryOperationGuard<'service> {
    service: &'service GitHistoryOperationService,
    key: HistoryOperationKey,
    flag: Arc<AtomicBool>,
}

impl Drop for HistoryOperationGuard<'_> {
    fn drop(&mut self) {
        self.service
            .inflight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.key);
    }
}

fn outcome_from_state(
    kind: HistoryMutationOutcomeKind,
    state: HistoryState,
) -> HistoryMutationOutcome {
    HistoryMutationOutcome { kind, state }
}

fn classify_nonzero_state(state: HistoryState) -> HistoryMutationOutcome {
    let kind = if state
        .sequencer
        .as_ref()
        .is_some_and(|sequencer| !sequencer.conflicted_paths.is_empty())
    {
        HistoryMutationOutcomeKind::Conflicts
    } else {
        HistoryMutationOutcomeKind::Stopped
    };
    outcome_from_state(kind, state)
}

fn run_and_classify(
    repo_dir: &Path,
    args: Vec<String>,
    cancel: &AtomicBool,
    operation: Option<HistoryOperation>,
    aborting: bool,
) -> Result<HistoryMutationOutcome, CommandError> {
    let output = match run_git(repo_dir, &args, GitExecMode::Write, cancel) {
        Ok(output) => output,
        Err(error) if error.code() == "GIT_EXEC_CANCELLED" => {
            return Ok(outcome_from_state(
                HistoryMutationOutcomeKind::Cancelled,
                read_state_sync(repo_dir)?,
            ));
        }
        Err(error) => return Err(error),
    };
    let state = read_state_sync(repo_dir)?;
    if output.exit_code == 0 {
        return if state.sequencer.is_none() {
            Ok(outcome_from_state(
                HistoryMutationOutcomeKind::Completed,
                state,
            ))
        } else {
            Ok(classify_nonzero_state(state))
        };
    }
    if state.sequencer.is_some() {
        return Ok(classify_nonzero_state(state));
    }
    Err(match operation {
        Some(operation) => history_mutation_failed(operation),
        None if aborting => history_abort_failed(),
        None => history_continue_failed(),
    })
}

fn targeted_args(operation: HistoryOperation, target_sha: &str) -> Vec<String> {
    let mut args = match operation {
        HistoryOperation::Merge => strings(GIT_MERGE_ARGS),
        HistoryOperation::Rebase => strings(GIT_REBASE_ARGS),
        HistoryOperation::CherryPick => strings(GIT_CHERRY_PICK_ARGS),
        HistoryOperation::Revert => strings(GIT_REVERT_ARGS),
        HistoryOperation::ResetSoft => strings(GIT_RESET_SOFT_ARGS),
        HistoryOperation::ResetMixed => strings(GIT_RESET_MIXED_ARGS),
        HistoryOperation::ResetHard => strings(GIT_RESET_HARD_ARGS),
    };
    args.push(target_sha.to_owned());
    if matches!(
        operation,
        HistoryOperation::ResetSoft | HistoryOperation::ResetMixed | HistoryOperation::ResetHard
    ) {
        args.push("--".to_owned());
    }
    args
}

fn continue_args(kind: SequencerKind) -> Vec<String> {
    strings(match kind {
        SequencerKind::Merge => GIT_MERGE_CONTINUE_ARGS,
        SequencerKind::Rebase => GIT_REBASE_CONTINUE_ARGS,
        SequencerKind::CherryPick => GIT_CHERRY_PICK_CONTINUE_ARGS,
        SequencerKind::Revert => GIT_REVERT_CONTINUE_ARGS,
    })
}

fn abort_args(kind: SequencerKind) -> Vec<String> {
    strings(match kind {
        SequencerKind::Merge => GIT_MERGE_ABORT_ARGS,
        SequencerKind::Rebase => GIT_REBASE_ABORT_ARGS,
        SequencerKind::CherryPick => GIT_CHERRY_PICK_ABORT_ARGS,
        SequencerKind::Revert => GIT_REVERT_ABORT_ARGS,
    })
}

pub(crate) async fn preview(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    operation: HistoryOperation,
    target_sha: &str,
) -> Result<HistoryPreview, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let target_sha = target_sha.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        compute_preview_sync(&repo_dir, operation, &target_sha)
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn state(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<HistoryState, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    tauri::async_runtime::spawn_blocking(move || read_state_sync(&repo_dir))
        .await
        .map_err(|_| git_exec_unavailable())?
}

async fn execute_targeted(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    operation: HistoryOperation,
    target_sha: &str,
    expected_preview_token: &str,
) -> Result<HistoryMutationOutcome, CommandError> {
    if !is_lowercase_hex(target_sha, 40) || !is_lowercase_hex(expected_preview_token, 64) {
        return Err(history_preview_stale());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let guard = service.begin(window_label, workspace.selected_root_id())?;
    let cancel = Arc::clone(&guard.flag);
    let target_sha = target_sha.to_owned();
    let expected_preview_token = expected_preview_token.to_owned();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let current = compute_preview_sync(&repo_dir, operation, &target_sha)?;
        if current.preview_token != expected_preview_token {
            return Err(history_preview_stale());
        }
        if current.sequencer.is_some() {
            return Err(history_operation_in_progress());
        }
        let args = targeted_args(operation, &target_sha);
        run_and_classify(&repo_dir, args, &cancel, Some(operation), false)
    })
    .await
    .map_err(|_| git_exec_unavailable())?;
    drop(guard);
    result
}

pub(crate) async fn merge(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    target_sha: &str,
    preview_token: &str,
) -> Result<HistoryMutationOutcome, CommandError> {
    execute_targeted(
        trust,
        workspace,
        service,
        window_label,
        HistoryOperation::Merge,
        target_sha,
        preview_token,
    )
    .await
}

pub(crate) async fn rebase(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    target_sha: &str,
    preview_token: &str,
) -> Result<HistoryMutationOutcome, CommandError> {
    execute_targeted(
        trust,
        workspace,
        service,
        window_label,
        HistoryOperation::Rebase,
        target_sha,
        preview_token,
    )
    .await
}

pub(crate) async fn cherry_pick(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    target_sha: &str,
    preview_token: &str,
) -> Result<HistoryMutationOutcome, CommandError> {
    execute_targeted(
        trust,
        workspace,
        service,
        window_label,
        HistoryOperation::CherryPick,
        target_sha,
        preview_token,
    )
    .await
}

pub(crate) async fn revert(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    target_sha: &str,
    preview_token: &str,
) -> Result<HistoryMutationOutcome, CommandError> {
    execute_targeted(
        trust,
        workspace,
        service,
        window_label,
        HistoryOperation::Revert,
        target_sha,
        preview_token,
    )
    .await
}

pub(crate) async fn reset(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    operation: HistoryOperation,
    target_sha: &str,
    preview_token: &str,
) -> Result<HistoryMutationOutcome, CommandError> {
    if !matches!(
        operation,
        HistoryOperation::ResetSoft | HistoryOperation::ResetMixed | HistoryOperation::ResetHard
    ) {
        return Err(history_preview_stale());
    }
    execute_targeted(
        trust,
        workspace,
        service,
        window_label,
        operation,
        target_sha,
        preview_token,
    )
    .await
}

async fn execute_sequencer(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    expected_kind: SequencerKind,
    abort: bool,
) -> Result<HistoryMutationOutcome, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let guard = service.begin(window_label, workspace.selected_root_id())?;
    let cancel = Arc::clone(&guard.flag);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let before = read_state_sync(&repo_dir)?;
        let actual = before
            .sequencer
            .as_ref()
            .map(|state| state.kind)
            .ok_or_else(history_no_operation)?;
        if actual != expected_kind {
            return Err(history_operation_kind_changed());
        }
        let args = if abort {
            abort_args(actual)
        } else {
            continue_args(actual)
        };
        let outcome = run_and_classify(&repo_dir, args, &cancel, None, abort)?;
        if abort
            && outcome.kind == HistoryMutationOutcomeKind::Completed
            && outcome.state.sequencer.is_some()
        {
            return Err(history_abort_failed());
        }
        Ok(outcome)
    })
    .await
    .map_err(|_| git_exec_unavailable())?;
    drop(guard);
    result
}

pub(crate) async fn continue_operation(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    expected_kind: SequencerKind,
) -> Result<HistoryMutationOutcome, CommandError> {
    execute_sequencer(
        trust,
        workspace,
        service,
        window_label,
        expected_kind,
        false,
    )
    .await
}

pub(crate) async fn abort_operation(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    service: &GitHistoryOperationService,
    window_label: &str,
    expected_kind: SequencerKind,
) -> Result<HistoryMutationOutcome, CommandError> {
    let outcome =
        execute_sequencer(trust, workspace, service, window_label, expected_kind, true).await?;
    if outcome.kind == HistoryMutationOutcomeKind::Stopped {
        return Err(history_abort_failed());
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests;
