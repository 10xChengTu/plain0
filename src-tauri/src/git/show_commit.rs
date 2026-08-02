//! `git::show_commit` — `F090` S2's commit-detail file list (slice 3 of
//! `docs/research/2026-07-26-git-history.md`). The frozen plan's own sketch
//! was `GIT_SHOW_COMMIT_ARGS = ["show", "--no-color", "--no-textconv",
//! "--no-ext-diff", "--first-parent", "--name-status"]` — i.e. literally
//! running `git show <sha> --first-parent --name-status`/`--numstat` the way
//! GitHub/GitLab's own merge-commit convention does. This module does **not**
//! do that, for reasons discovered empirically while implementing this slice
//! (see the two deviations below) — both are disclosed, not silently
//! corrected in the frozen plan text.
//!
//! # Deviation 1 (empirically discovered): `git show ... --name-status` is not a pure NUL-record stream
//!
//! Real `git 2.50.1`'s `git show <sha> --no-color -z --name-status <sha>`
//! prepends a human-readable, **`LF`-terminated** commit header (`commit
//! <sha>`, an optional `Merge: <p1> <p2>` line for a merge commit, `Author:
//! ...`, `Date: ...`, a blank line, then the free-text commit message body)
//! *before* the `-z` NUL-record name-status data begins — confirmed with
//! `xxd` against this slice's own merge-commit fixture. This is a
//! fundamentally different, harder-to-parse-safely shape than
//! [`super::diff`]'s `git diff --name-status -z` (no header at all, pure NUL
//! records from the first byte), and the commit message embedded in that
//! header is exactly the kind of attacker-controlled, arbitrary-byte field
//! this codebase's other modules (`blame`'s hover-metadata fetch, `log`'s
//! list fetch) go to real lengths to keep out of any custom-delimited format
//! string — see those modules' own doc comments for the hostile-`0x1f`-byte
//! fixture that motivated that discipline. Hand-splitting this header off
//! (e.g. "read until the first byte that looks like a name-status record")
//! would be exactly the "looks structured, is not" parsing risk
//! `docs/research/2026-07-26-git-history.md` flags for `git log --graph`'s
//! own ASCII art. Confirming this further: `git show`'s own `--no-patch`
//! flag — which S1's `line_history_list` already uses to strip `-L`'s hunk
//! text down to pure NUL-safe metadata — **cannot** be combined with
//! `--name-status` for `git show` at all (`fatal: options '--name-only',
//! '--name-status', '--check', and '-s' cannot be used together`, confirmed
//! empirically), so there is no flag-only way to suppress the header either.
//!
//! # Deviation 2 (empirically confirmed equivalent, and safer): a plain two-revision `git diff` reproduces `--first-parent`'s own semantics exactly
//!
//! `git show <sha> --first-parent`'s own documented behavior for a merge
//! commit is "diff this commit's tree against its **first parent's** tree
//! only" (as opposed to the default combined-diff, which is near-always
//! misleadingly empty for a clean merge — this module's own report and
//! `tests.rs`'s
//! `clean_merge_commit_bare_git_show_name_status_is_misleadingly_empty_without_first_parent`/
//! `clean_merge_commit_bare_diff_tree_is_also_misleadingly_empty_without_first_parent`
//! pair reproduce that trap as two independent control groups, proving it is
//! real rather than assuming the frozen plan's warning). Confirmed
//! empirically (this slice's
//! own report) that `git diff --name-status -z <first-parent-sha> <sha>` — a
//! **pure**, header-free, NUL-record `git diff` invocation, [`super::diff`]'s
//! own already-audited shape, just with two explicit revisions instead of
//! the working tree/index — produces **byte-identical** name-status/numstat
//! data (once `git show`'s own header is stripped) to `git show <sha>
//! --first-parent --name-status -z`. This module therefore never spawns
//! `git show` for the file list at all (this file's own tests assert the
//! literal string `"show"` never appears as a git-subcommand token anywhere
//! in it — see `scripts/plain/boundary-contracts.mjs`'s
//! `validateGitShowCommitFirstParentBoundary`, which locks this same
//! invariant mechanically). [`show_commit`] resolves the first-parent sha
//! itself ([`resolve_first_parent`]) and always diffs two explicit,
//! Rust-computed revisions — never a caller-supplied revspec suffix like
//! `<sha>^` (see [`resolve_first_parent`]'s own doc comment for why that bare
//! suffix form is itself unreliable for a root commit).
//!
//! # The root-commit (no parent) case
//!
//! A commit with zero parents has no "first parent tree" to diff against.
//! Git's own well-known, fixed empty-tree object id ([`EMPTY_TREE_SHA`])
//! stands in for it — confirmed empirically that `git diff --name-status -z
//! <empty-tree-sha> <root-commit-sha>` reports every file in the root commit
//! as `A`(dded), byte-for-byte the same "everything added" result `git show
//! --first-parent` on that same root commit produces on its own (its
//! `--first-parent` is a no-op with no parent to select, and git silently
//! falls back to diffing against the empty tree — confirmed empirically in
//! this slice's own report).
//!
//! # `--first-parent`'s semantics are unconditional, never a caller-supplied option
//!
//! [`show_commit`] never accepts an "include all parents"/"combined diff"
//! mode — the commit-detail view always shows "what this commit changed
//! relative to mainline" (GitHub/GitLab's own convention for merge commits),
//! per the frozen plan's own decision. There is no parameter anywhere in this
//! module's request shape that could opt back into git's own
//! near-always-empty combined-diff default.
//!
//! # Copy detection: `-M -C --find-copies-harder`, not [`super::diff::GIT_DIFF_BASE_ARGS`]'s `-M`-only
//!
//! [`super::diff::GIT_DIFF_BASE_ARGS`] (the working-tree/index live-status
//! diff, polled automatically on every SCM refresh) deliberately forces only
//! `-M` (rename detection), not `-C`/`--find-copies-harder` — copy detection
//! (especially the "harder" unchanged-file-scanning mode) is real, git-
//! documented extra cost per invocation, unacceptable for a background poll.
//! A commit-detail view is the opposite shape: one-off, explicitly
//! user-requested, bounded to a single commit's own tree diff. This module
//! therefore uses its own, independent [`GIT_SHOW_COMMIT_DIFF_BASE_ARGS`]
//! constant (not a reuse of `GIT_DIFF_BASE_ARGS`) that adds `-C
//! --find-copies-harder` — confirmed empirically (this slice's own report)
//! that *without* `--find-copies-harder`, a byte-identical copy of an
//! *unmodified* file elsewhere in the tree is **not** detected as `C` at all
//! (reported as a plain `A` instead) — git's non-"harder" copy heuristic only
//! ever considers files *also modified in the very same commit* as candidate
//! copy sources, and an untouched source file never qualifies. Only with
//! `--find-copies-harder` (which explicitly opts into scanning every
//! unmodified file in the tree as a candidate source too) does it get
//! recognized as `C100`. `tests.rs`'s
//! `show_commit_reports_a_copy_record_that_requires_find_copies_harder_to_detect_at_all`
//! reproduces this with real git (a control group asserting the plain `-M -C`
//! form misses it, then the production function's own `--find-copies-harder`
//! form catching it) — not a synthetic parser-only fixture; the ordinary
//! rename case (`tests.rs`'s `show_commit_reports_a_rename_record`) is
//! already found by `-M` alone, with no such extra flag needed.
//!
//! # Existence check: a syntactically valid sha can name a real, non-commit object
//!
//! [`is_lowercase_hex40`] rejects a request whose `sha` is not 40 lowercase
//! hex characters before ever spawning git — but a *syntactically* valid
//! hex40 string can still name a real blob or tree object (not a commit) or
//! simply not exist as any object at all. Empirically (this slice's own
//! report), neither `git log -1 --format=%P <object>` nor `git rev-list
//! --parents -n 1 <object>` distinguishes those from a genuine root commit:
//! both silently exit `0` with empty output for a blob/tree sha, exactly the
//! same output a real root commit (zero parents) produces — there is no way
//! to tell "not a commit at all" from "a commit with no parent" from that
//! output alone. [`verify_commit_exists`] is the dedicated, independent gate
//! this module runs first (`git rev-parse --verify -q <sha>^{commit}`,
//! confirmed empirically to fail — quietly, no stderr text with `-q` — for
//! both a non-existent object and a real blob/tree, and to succeed for a real
//! commit) — never folded into [`resolve_first_parent`]'s own call, which
//! cannot by itself tell the two cases apart.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::diff::{
    merge_diff_files, parse_name_status, parse_numstat, show_blob, DiffFileEntry, GitBlobRev,
};
use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};
use super::wire::split_nul_records;

/// Git's fixed, well-known empty-tree object id (SHA-1) — every git
/// repository has this object regardless of its own history, and diffing
/// against it is git's own documented idiom for "this tree, as if created
/// from nothing" (the same object `git diff --cached` against a brand-new,
/// still-empty repository would compare against). See this module's own
/// "root-commit" section above. Locked exactly by
/// `scripts/plain/boundary-contracts.mjs`'s
/// `validateGitShowCommitFirstParentBoundary`.
pub(crate) const EMPTY_TREE_SHA: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// The exact, audited base `git diff` argument list this module's two
/// (name-status/numstat) invocations use — deliberately its own constant, not
/// a reuse of [`super::diff::GIT_DIFF_BASE_ARGS`]; see this module's own doc
/// comment for why the two need different rename/copy-detection cost
/// profiles. Never contains the literal subcommand token `"show"` — see this
/// module's own doc comment's first deviation. Locked exactly by
/// `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_SHOW_COMMIT_DIFF_BASE_ARGS: &[&str] = &[
    "diff",
    "--no-color",
    "-z",
    "-M",
    "-C",
    "--find-copies-harder",
    "--no-textconv",
    "--no-ext-diff",
];

fn git_show_commit_invalid_sha() -> CommandError {
    CommandError::new(
        "GIT_SHOW_COMMIT_INVALID_SHA",
        "The requested commit sha is not exactly 40 lowercase hex characters.",
    )
}

fn git_show_commit_not_found() -> CommandError {
    CommandError::new(
        "GIT_SHOW_COMMIT_NOT_FOUND",
        "No commit exists at the requested sha.",
    )
}

fn git_show_commit_failed() -> CommandError {
    CommandError::new(
        "GIT_SHOW_COMMIT_FAILED",
        "git diff did not complete successfully.",
    )
}

fn git_show_commit_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_SHOW_COMMIT_PARSE_FAILED",
        "The git parent-resolution output could not be parsed.",
    )
}

/// Mirrors `log::is_lowercase_hex40`/`diff::is_lowercase_hex40` — this
/// module's own independent copy, per this codebase's established
/// per-domain-function duplication convention.
pub(crate) fn is_lowercase_hex40(bytes: &[u8]) -> bool {
    bytes.len() == 40
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

async fn spawn_background_read(
    repo_dir: &Path,
    args: Vec<String>,
) -> Result<super::exec::GitExecOutput, CommandError> {
    let repo_dir = repo_dir.to_path_buf();
    let cancel = AtomicBool::new(false);
    tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

/// `git rev-parse --verify -q <sha>^{commit}` — the dedicated "does this sha
/// name a real commit object" gate this module's own doc comment explains is
/// necessary (neither `%P` nor `--parents` output alone can distinguish a
/// non-existent/non-commit object from a genuine root commit). `-q`
/// suppresses `rev-parse`'s own `fatal:`-prefixed stderr text for the common
/// "does not exist" case (confirmed empirically: both a non-existent object
/// and a real blob/tree fail with exit `1` and empty stderr under `-q`) — the
/// caller only needs the pass/fail distinction, not why.
async fn verify_commit_exists(repo_dir: &Path, sha: &str) -> Result<(), CommandError> {
    let args = vec![
        "rev-parse".to_owned(),
        "--verify".to_owned(),
        "-q".to_owned(),
        format!("{sha}^{{commit}}"),
    ];
    let output = spawn_background_read(repo_dir, args).await?;
    if output.exit_code != 0 {
        return Err(git_show_commit_not_found());
    }
    Ok(())
}

/// `git log -1 -z --format=%P --no-patch <sha>` — resolves `sha`'s first
/// parent, or `None` for a root commit (zero parents). Safe to thread through
/// a `%`-format string with no delimiter-shift risk at all: unlike
/// `%an`/`%s`/`%B` (free-text, attacker-controlled), `%P` is *computed* by
/// git itself as a fixed, space-separated list of exactly-40-lowercase-hex
/// parent object ids — it can never contain the format string's own `0x1f`
/// (not used here) or any byte the caller could smuggle in via `git commit
/// --author`/a crafted message the way `blame`/`log`'s hover-metadata
/// fetchers guard against. Only the *first* space-separated token is used
/// (this module's own file-list diff is always against the first parent
/// only, per `--first-parent`'s own documented semantics — see this module's
/// own doc comment).
///
/// This function alone cannot tell "root commit" apart from "`sha` is not a
/// real commit at all" (both produce empty `%P` output, confirmed
/// empirically) — callers must run [`verify_commit_exists`] first. See this
/// module's own doc comment's "Existence check" section.
pub(crate) async fn resolve_first_parent(
    repo_dir: &Path,
    sha: &str,
) -> Result<Option<String>, CommandError> {
    let args = vec![
        "log".to_owned(),
        "-1".to_owned(),
        "-z".to_owned(),
        "--format=%P".to_owned(),
        "--no-patch".to_owned(),
        sha.to_owned(),
    ];
    let output = spawn_background_read(repo_dir, args).await?;
    if output.exit_code != 0 {
        return Err(git_show_commit_failed());
    }
    let records = split_nul_records(&output.stdout);
    let record = records.first().copied().unwrap_or(&[]);
    if record.is_empty() {
        return Ok(None);
    }
    let first_token = record.split(|&byte| byte == b' ').next().unwrap_or(record);
    if !is_lowercase_hex40(first_token) {
        return Err(git_show_commit_parse_failed());
    }
    Ok(Some(
        String::from_utf8(first_token.to_vec()).expect("hex digits are ASCII"),
    ))
}

async fn run_show_commit_diff(
    repo_dir: &Path,
    base_revision: &str,
    target_revision: &str,
    format_flag: &'static str,
) -> Result<Vec<u8>, CommandError> {
    let mut args: Vec<String> = GIT_SHOW_COMMIT_DIFF_BASE_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.push(format_flag.to_owned());
    args.push(base_revision.to_owned());
    args.push(target_revision.to_owned());
    let output = spawn_background_read(repo_dir, args).await?;
    if output.exit_code != 0 {
        return Err(git_show_commit_failed());
    }
    Ok(output.stdout)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ShowCommitResult {
    pub(crate) sha: String,
    /// `None` exactly for a root commit (zero parents) — see this module's
    /// own "root-commit" doc-comment section. Every changed file in that case
    /// is inherently `Added` (the diff ran against [`EMPTY_TREE_SHA`]), so a
    /// caller never needs a distinct "no parent" branch to decide whether a
    /// file's original side exists — `DiffStatusKind::Added` already implies
    /// it does not, root commit or not.
    pub(crate) parent_sha: Option<String>,
    pub(crate) files: Vec<DiffFileEntry>,
}

/// Resolves `sha`'s file-level change list against its first parent (or the
/// empty tree for a root commit) — see this module's own doc comment for the
/// full rationale for why this never spawns `git show` at all. Runs under
/// [`GitExecMode::BackgroundRead`] through [`run_git`], exactly like every
/// other read in this domain — no new exec path.
pub(crate) async fn show_commit(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    sha: &str,
) -> Result<ShowCommitResult, CommandError> {
    if !is_lowercase_hex40(sha.as_bytes()) {
        return Err(git_show_commit_invalid_sha());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    verify_commit_exists(&repo_dir, sha).await?;
    let parent_sha = resolve_first_parent(&repo_dir, sha).await?;
    let base_revision: &str = parent_sha.as_deref().unwrap_or(EMPTY_TREE_SHA);
    let name_status_output =
        run_show_commit_diff(&repo_dir, base_revision, sha, "--name-status").await?;
    let numstat_output = run_show_commit_diff(&repo_dir, base_revision, sha, "--numstat").await?;
    let name_status_entries = parse_name_status(&name_status_output)?;
    let numstat_entries = parse_numstat(&numstat_output)?;
    let files = merge_diff_files(name_status_entries, numstat_entries);
    Ok(ShowCommitResult {
        sha: sha.to_owned(),
        parent_sha,
        files,
    })
}

/// Reads one version of `path` at an arbitrary, already-validated commit
/// `sha` — the multi-diff resolver's own content-fetch primitive for each
/// changed file's `originalUri`/`modifiedUri` (the commit itself for
/// `modifiedUri`, its resolved [`ShowCommitResult::parent_sha`] for
/// `originalUri`). Reuses [`super::diff::show_blob`] wholesale via
/// [`GitBlobRev::Commit`] — never duplicates its revspec-construction or
/// not-found-stderr-matching logic (see [`GitBlobRev::Commit`]'s own doc
/// comment for why this is a safe, additive widening of that already-audited
/// function rather than a parallel implementation).
pub(crate) async fn show_commit_blob(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    sha: &str,
    path: &str,
) -> Result<Option<Vec<u8>>, CommandError> {
    if !is_lowercase_hex40(sha.as_bytes()) {
        return Err(git_show_commit_invalid_sha());
    }
    show_blob(
        trust,
        workspace,
        window_label,
        GitBlobRev::Commit(sha.to_owned()),
        path,
    )
    .await
}

#[cfg(test)]
mod tests;
