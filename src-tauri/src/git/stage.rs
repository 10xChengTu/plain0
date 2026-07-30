//! `F080` S3 whole-file stage/unstage (`git add -A --`/`git reset -q --`) and
//! hunk-level stage-blob (`git hash-object --stdin -w --path=` +
//! `git update-index --add --cacheinfo`) — see
//! `docs/research/2026-07-25-core-git.md`'s hunk-stage architecture note:
//! the frontend (Monaco's diff engine) computes "the full file content after
//! applying one hunk"; this module never parses or applies a unified diff
//! itself, it only ever receives a complete new content buffer and turns it
//! into a git blob + index entry.
//!
//! Every subprocess here runs under [`GitExecMode::Write`] (`F080` S3
//! activates that mode in `exec.rs`) — a user explicitly clicked "Stage" or
//! ran a stage command, so hooks/fsmonitor are *not* suppressed the way
//! `status`/`diff`'s `GitExecMode::BackgroundRead` calls suppress them (see
//! `exec::harden_write`'s own doc comment for the precise difference). None
//! of `git add`/`git reset`/`git hash-object`/`git update-index` invoke a
//! commit-family hook regardless of mode (only `git commit`, see
//! `super::commit`, actually fires `pre-commit`/`commit-msg`/`post-commit`),
//! so this module's own hook-fires evidence lives in `commit/tests.rs`, not
//! here — this module's own tests focus on the stage/unstage/hunk-stage
//! mechanics themselves.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::dto::is_valid_mutate_path;
use super::exec::{run_git, run_git_with_stdin, GitExecMode};
use super::git_exec_unavailable;
use super::repo::resolve_repo_toplevel;

/// Mirrors `dto::MAX_GIT_STAGE_BLOB_BYTES` — see this module's own doc
/// comment on why domain functions re-validate what the DTO layer already
/// checked.
const MAX_GIT_STAGE_BLOB_BYTES: usize = 8 * 1024 * 1024;
/// The default mode git assigns a newly created blob — used only when
/// [`resolve_blob_mode`] finds no existing index entry for the path (a
/// brand-new file being hunk-staged for the first time). Matches `git add`'s
/// own default for a new regular file; a new file's executable bit cannot be
/// determined this way (see [`resolve_blob_mode`]'s own doc comment for why
/// that is an accepted, documented scope limit rather than a silent bug).
const DEFAULT_NEW_BLOB_MODE: &str = "100644";

fn git_mutate_invalid_paths() -> CommandError {
    CommandError::new(
        "GIT_MUTATE_PATHS_INVALID_REQUEST",
        "The path list is empty, too large, or contains an invalid path.",
    )
}

fn git_stage_failed() -> CommandError {
    CommandError::new("GIT_STAGE_FAILED", "git add did not complete successfully.")
}

fn git_unstage_failed() -> CommandError {
    CommandError::new(
        "GIT_UNSTAGE_FAILED",
        "git reset did not complete successfully.",
    )
}

fn git_stage_blob_invalid_path() -> CommandError {
    CommandError::new(
        "GIT_STAGE_BLOB_INVALID_PATH",
        "The requested path is empty, too long, or outside the repository.",
    )
}

fn git_stage_blob_content_too_large() -> CommandError {
    CommandError::new(
        "GIT_STAGE_BLOB_CONTENT_TOO_LARGE",
        "The blob content exceeds the allowed size limit.",
    )
}

fn git_stage_blob_failed() -> CommandError {
    CommandError::new(
        "GIT_STAGE_BLOB_FAILED",
        "The blob could not be hashed into the object database or written to the index.",
    )
}

fn validate_paths(paths: &[String]) -> Result<(), CommandError> {
    if paths.is_empty() || !paths.iter().all(|path| is_valid_mutate_path(path)) {
        return Err(git_mutate_invalid_paths());
    }
    Ok(())
}

/// `git add -A -- <paths...>` — stages every kind of working-tree change
/// (modified/added/deleted) for exactly the given paths, nothing else. The
/// `--` separator (always present, even for a single path) stops any
/// `-`-prefixed path from being misread as a git option.
pub(crate) async fn stage_paths(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    paths: &[String],
) -> Result<(), CommandError> {
    validate_paths(paths)?;
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let mut args: Vec<String> = vec!["add".to_owned(), "-A".to_owned(), "--".to_owned()];
    args.extend(paths.iter().cloned());
    let output = run_write(&repo_dir, args).await?;
    if output.exit_code != 0 {
        return Err(git_stage_failed());
    }
    Ok(())
}

/// `git reset -q -- <paths...>` — unstages exactly the given paths (moves
/// their index state back to HEAD's, leaving working-tree content
/// untouched).
pub(crate) async fn unstage_paths(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    paths: &[String],
) -> Result<(), CommandError> {
    validate_paths(paths)?;
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let mut args: Vec<String> = vec!["reset".to_owned(), "-q".to_owned(), "--".to_owned()];
    args.extend(paths.iter().cloned());
    let output = run_write(&repo_dir, args).await?;
    if output.exit_code != 0 {
        return Err(git_unstage_failed());
    }
    Ok(())
}

/// Hunk-level stage: `path`'s *complete new content* (already computed by
/// the frontend's Monaco diff engine — see this module's own doc comment) is
/// hashed into the object database and written into the index at `path`,
/// without touching the working tree file at all. Two subprocesses:
///
/// 1. `git hash-object --stdin -w --path=<path>` — `content` travels over
///    stdin (never a command-line argument), `-w` actually writes the blob
///    into `.git/objects`, `--path=` (not a separate `--path` + value pair —
///    see [`resolve_blob_mode`] for why the analogous `ls-files` call takes
///    its path via `--` instead) only affects which `.gitattributes` filters
///    apply, never which object is produced.
/// 2. `git update-index --add --cacheinfo <mode>,<hash>,<path>` — writes the
///    resulting blob hash into the index at `path` with `mode` (see
///    [`resolve_blob_mode`]). `--add` is passed unconditionally: empirically
///    verified (this slice's own report) to be required for a path with no
///    existing index entry and to be a harmless no-op for a path that
///    already has one — see that function's own doc comment.
pub(crate) async fn stage_blob(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    path: &str,
    content: Vec<u8>,
) -> Result<(), CommandError> {
    if !is_valid_mutate_path(path) {
        return Err(git_stage_blob_invalid_path());
    }
    if content.len() > MAX_GIT_STAGE_BLOB_BYTES {
        return Err(git_stage_blob_content_too_large());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;

    let mode = resolve_blob_mode(&repo_dir, path).await?;

    let hash_args = vec![
        "hash-object".to_owned(),
        "--stdin".to_owned(),
        "-w".to_owned(),
        format!("--path={path}"),
    ];
    let hash_output = run_write_with_stdin(&repo_dir, hash_args, &content).await?;
    if hash_output.exit_code != 0 {
        return Err(git_stage_blob_failed());
    }
    let hash = parse_object_hash(&hash_output.stdout).ok_or_else(git_stage_blob_failed)?;

    let cacheinfo = format!("{mode},{hash},{path}");
    let update_args = vec![
        "update-index".to_owned(),
        "--add".to_owned(),
        "--cacheinfo".to_owned(),
        cacheinfo,
    ];
    let update_output = run_write(&repo_dir, update_args).await?;
    if update_output.exit_code != 0 {
        return Err(git_stage_blob_failed());
    }
    Ok(())
}

/// Resolves the file mode `stage_blob` should write into the index for
/// `path`: whatever `git ls-files -s -- <path>` already reports for the
/// current index entry (preserving an existing executable bit/symlink mode
/// exactly), or [`DEFAULT_NEW_BLOB_MODE`] when the path has no index entry
/// at all (a brand-new file being hunk-staged for the first time — verified
/// empirically that `git ls-files -s` for such a path exits `0` with empty
/// stdout, not an error).
///
/// Only the first whitespace-delimited token of `ls-files -s`'s output is
/// read (the mode) — the path field is deliberately never parsed back out
/// (avoiding this function needing to reason about `core.quotePath`
/// quoting), and only the first line is consulted for a conflicted
/// (multi-stage) path, which is an accepted, documented scope limit:
/// hunk-staging a currently-conflicted path is out of scope for this slice.
async fn resolve_blob_mode(repo_dir: &Path, path: &str) -> Result<String, CommandError> {
    let args = vec![
        "ls-files".to_owned(),
        "-s".to_owned(),
        "--".to_owned(),
        path.to_owned(),
    ];
    let output = run_write(repo_dir, args).await?;
    if output.exit_code != 0 {
        return Err(git_stage_blob_failed());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next();
    let Some(first_line) = first_line else {
        return Ok(DEFAULT_NEW_BLOB_MODE.to_owned());
    };
    let mode = first_line
        .split(' ')
        .next()
        .filter(|token| {
            !token.is_empty() && token.len() <= 7 && token.bytes().all(|byte| byte.is_ascii_digit())
        })
        .ok_or_else(git_stage_blob_failed)?;
    Ok(mode.to_owned())
}

/// Parses `git hash-object`'s stdout: exactly one line, a lowercase hex
/// object id (SHA-1 is 40 hex characters; a SHA-256 repository — `git init
/// --object-format=sha256` — would report 64, so this deliberately accepts
/// either length rather than hard-coding 40).
fn parse_object_hash(stdout: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(stdout).ok()?.trim();
    let is_hex_id =
        matches!(text.len(), 40 | 64) && text.bytes().all(|byte| byte.is_ascii_hexdigit());
    is_hex_id.then(|| text.to_owned())
}

async fn run_write(
    repo_dir: &Path,
    args: Vec<String>,
) -> Result<super::exec::GitExecOutput, CommandError> {
    let repo_dir = repo_dir.to_path_buf();
    let cancel = AtomicBool::new(false);
    tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::Write, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

async fn run_write_with_stdin(
    repo_dir: &Path,
    args: Vec<String>,
    stdin: &[u8],
) -> Result<super::exec::GitExecOutput, CommandError> {
    let repo_dir = repo_dir.to_path_buf();
    let stdin = stdin.to_vec();
    let cancel = AtomicBool::new(false);
    tauri::async_runtime::spawn_blocking(move || {
        run_git_with_stdin(&repo_dir, &args, GitExecMode::Write, &cancel, &stdin)
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

#[cfg(test)]
mod tests;
