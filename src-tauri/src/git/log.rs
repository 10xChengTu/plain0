//! `git::log` — `F090` S1's file/line history (slice 2 of
//! `docs/research/2026-07-26-git-history.md`). Three variants, exactly as
//! named by the frozen plan: [`file_history`] (`--follow`, whole-file, no
//! line range), [`line_history_list`] (`-L<range>:<path> --no-patch`, the
//! commit list touching one specific line range) and
//! [`line_history_detail`] (drills into one `line_history_list` entry's
//! actual diff hunk). All three run under [`GitExecMode::BackgroundRead`]
//! through [`run_git`] — no new exec path, exactly like [`super::blame`].
//!
//! # Format-string safety: sha + full body only (same shape as `blame`'s hover fetch, independently re-verified for this module)
//!
//! The frozen plan's own S0-corrected `GIT_LOG_COMMIT_META_ARGS` sketch is
//! `["log", "-z", "--format=%H%x1f%B", "--no-patch"]` — exactly
//! [`super::blame::GIT_LOG_BLAME_MESSAGE_ARGS`]'s format string, independently
//! re-verified here (not merely assumed to transfer) against a *fresh*
//! hostile fixture built for this module's own commands (`tests.rs`'s
//! `file_history_is_immune_to_a_hostile_commit_message_containing_a_unit_separator_byte`
//! and its pure-function `parse_history_entries_splitn_is_not_confused_by_an_embedded_separator`
//! control group): `%H` is always exactly 40 lowercase hex bytes (safe to
//! match positionally), and `%B` (the full message body) is the *only* field
//! after it, so it can absorb every remaining byte of the record — including
//! an attacker-chosen `0x1f` byte the message itself contains — with nothing
//! left after it for a shift to corrupt. This module deliberately does
//! **not** add a second free-text field (e.g. author name) to this format
//! string for the same reason the frozen plan's own corrected sketch does
//! not: two attacker-controlled fields cannot both be threaded through one
//! `%x1f`-delimited record safely unless one of them is authoritatively last,
//! and this module has no safe *second* place to put one. Per the plan's own
//! allowance ("其他元数据若需要，必须各自独立取或改用不可被内容伪造的编码"),
//! author/date metadata is simply not fetched by this slice's list calls at
//! all — the list view shows only a short sha and the message's first line;
//! full author/date detail is available once a caller drills into
//! [`line_history_detail`], whose raw-text output is never field-parsed (see
//! that function's own doc comment).
//!
//! # Deviation from the frozen plan (disclosed, empirically discovered): `line_history_detail` cannot select a historical commit with a bare `<sha>` positional
//!
//! The frozen plan's own sketch for the drill-down call is `["log", "-1",
//! "-L<start>,<end>:<path>", <sha>]`. Empirically, this **does not work**
//! across a rename: `git log`'s `-L<range>:<path>` resolves `<path>` against
//! the *starting point* of whatever revision walk it performs — when that
//! starting point is a bare `<sha>` positional argument, the walk starts (and
//! the path is resolved) **at that exact commit's own tree**, not at the tip
//! the original list was built from. For any `<sha>` that predates a rename
//! (`<path>`'s current/post-rename name), that commit's own tree does not
//! contain a file by that name at all, and git fails hard:
//! `fatal: There is no path <path> in the commit` (confirmed against this
//! slice's own rename fixture; see `tests.rs`'s
//! `line_history_detail_of_a_pre_rename_commit_using_the_frozen_plans_bare_sha_form_fails`,
//! kept as a permanent regression/documentation test rather than silently
//! dropped once the working alternative below was found). By contrast,
//! anchoring the very same `-L<range>:<path>` walk at **HEAD** (no explicit
//! revision — exactly what [`line_history_list`] itself already does) lets
//! git's own internal rename-following correctly resolve the pre-rename name
//! at the point in the walk where it is needed — confirmed empirically that
//! `git log -1 -L<range>:<path> HEAD` for a pre-rename commit correctly shows
//! that commit's diff against its *own*, historical filename, with no
//! caller-tracked path bookkeeping needed at all.
//!
//! The fix this module implements: [`line_history_detail`] never passes a
//! bare `<sha>` as the revision to start the walk from. Instead it re-runs
//! the **exact same** command shape [`line_history_list`] itself uses
//! (anchored at `HEAD`, walking backward), narrowed to exactly one record via
//! `--skip=<n> --max-count=1` — `n` being the zero-based position of the
//! desired entry within the ordinary (unskipped) walk order, which the
//! caller already knows from its own previously-fetched [`HistoryList`] (the
//! two calls are guaranteed to walk in the same order, since they are the
//! same command with only the skip/count window narrowed — confirmed
//! empirically that `--skip=k --max-count=1`'s single result is always
//! identical to the `(k+1)`-th record an unrestricted call of the same
//! command produces). The caller also passes the sha it *expects* to land on
//! (read from its own list); [`line_history_detail`] verifies the drilled-into
//! commit's own reported sha matches before returning anything, and fails
//! with a distinguishable [`git_log_line_history_detail_stale_index`] error
//! otherwise — covering the case where the underlying history changed (a new
//! commit landing on the same line) between the list fetch and the click,
//! which would otherwise silently display the *wrong* commit's diff under
//! the *right*-looking list row.
//!
//! `line_history_detail`'s own output is deliberately **not** field-parsed at
//! all (unlike [`parse_history_entries`]): it uses git's default
//! human-readable `log -p` output (no `--format` override), so the returned
//! `diffText` is a preformatted block for direct display (commit header,
//! author, date, message, and the unified diff hunk itself) — exactly the
//! "raw text, not a structured field extraction" approach this module's own
//! report explains sidesteps needing a second unsafe-field-in-the-middle
//! design for author/date at all.
//!
//! # `F090` S3: the graph command's own format-string safety design (distinct from the list commands above)
//!
//! [`log_graph`]'s [`GIT_LOG_GRAPH_ARGS`] needs two fields the list-producing
//! commands above never do: `%P` (parent shas, for the DAG's own edges) and a
//! human-displayable subject line. Naively appending `%an`/`%ae` (author
//! name/email) or any other free-text field *before* an existing free-text
//! field would reintroduce exactly the delimiter-shift vulnerability
//! [`GIT_LOG_COMMIT_META_ARGS`]'s own doc comment (above) already documents
//! and fixes — this module does not repeat that mistake here: the format is
//! `%H%x1f%P%x1f%s`, and only **one** field, `%s` (the subject — attacker-
//! controlled, exactly like `%B`), is free text, positioned strictly *last*.
//! `%H` and `%P` are both git-computed, fixed hex-digit-and-space-only
//! fields (never attacker-influenced — the same reasoning
//! [`super::show_commit::resolve_first_parent`]'s own doc comment already
//! applies to `%P`) — safe to match positionally ahead of the one absorbing
//! field, exactly the "safe fields first, one absorbing free-text field
//! last" shape [`GIT_LOG_COMMIT_META_ARGS`] itself establishes.
//! [`parse_graph_entries`]'s `splitn(3, ..)` (not an unbounded split) is what
//! makes this safe regardless of what `%s` itself contains, including a
//! further embedded `0x1f` byte — see `tests.rs`'s own hostile fixture
//! (`log_graph_is_immune_to_a_hostile_subject_line_containing_a_unit_separator_byte`)
//! and its pure-function naive-split control group
//! (`parse_graph_entries_splitn_is_not_confused_by_an_embedded_separator_in_the_subject_while_a_naive_full_split_would_be`),
//! mirroring [`parse_history_entries`]'s own identical pair above.
//!
//! This module deliberately never asks git for ref/branch/tag decoration
//! (`%d`/`%D`) at all, for either format string — see
//! `docs/research/2026-07-26-git-history.md`'s own "不建议解析
//! `git log --format=%D`" finding: decoration text is free-form,
//! comma-and-arrow-joined human display text whose *own* separator (`", "`)
//! is not a delimiter git guarantees absent from a ref name the way a fixed
//! record separator is guaranteed absent from every one of `for-each-ref`'s
//! own fields (see [`super::refs`]'s own module doc comment for why *that*
//! command's fields need no such care). A graph node's ref badges are
//! instead computed entirely by the frontend, by comparing this command's
//! own node shas against a separately-fetched [`super::refs::list_refs`]
//! result's `target_sha`/`peeled_sha` — two independent, narrowly-safe data
//! sources joined by a plain sha equality check, never by parsing one
//! command's own decoration text.
//!
//! # `--topo-order`, not the default order
//!
//! A caller-visible swimlane layout (the frontend's own
//! `plain-git-graph-layout.ts`) needs every commit's parent(s) to still be
//! *unprocessed* (not yet emitted) at the moment that commit itself is
//! emitted, so it can correctly assign/continue a lane for each parent as it
//! is reached — this is exactly what git's own `--topo-order` guarantees ("a
//! commit is not shown until all of its children have been shown"; see
//! `git-log(1)`'s own documentation). Plain `git log`'s *default* order (no
//! explicit `--topo-order`/`--date-order`) is a close cousin (reverse
//! chronological by commit date) but does not carry this same hard
//! guarantee — a backdated commit or clock skew between two parallel
//! branches could in principle show a parent before all of its children.
//! Confirmed empirically (this slice's own report) that a real octopus merge
//! (3 parents) plus two independently-created side branches produces the
//! merge commit itself as the very first record under `--topo-order`, with
//! every one of its ancestors following later — see `tests.rs`'s own
//! multi-branch-merge DAG fixture.
//!
//! # Ref-namespace scope: `--branches --tags --remotes`, never `--all`
//!
//! `--all` additionally walks `refs/stash` (a real, distinct top-level ref
//! namespace, not a subset of `refs/heads`/`refs/tags`/`refs/remotes`) —
//! confirmed empirically (this slice's own report, and `tests.rs`'s own
//! `log_graph_excludes_a_real_stash_entry`) that a real `git stash push`'s
//! own commit is walkable from `refs/stash` but never appears in this
//! command's own `--branches --tags --remotes` output, matching the frozen
//! research doc's own "不用 --all，因其会带出 refs/stash，见实测" note.
//!
//! # Empty-repository / no-matching-ref case: exit 0, empty output, not an error
//!
//! Confirmed empirically (mirroring [`file_history`]'s own identical finding
//! for a path with no history): a repository with zero commits at all (or
//! with commits but zero refs under any of the three requested namespaces —
//! a fully detached-HEAD-only state, unusual but possible) makes
//! [`GIT_LOG_GRAPH_ARGS`] exit `0` with empty stdout, not a failure — this
//! resolves to an empty, non-truncated [`GraphList`], never
//! [`git_log_graph_failed`].

use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::dto::is_valid_mutate_path;
use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};
use super::wire::split_nul_records;

/// The shared, audited "sha + full message body" metadata format both
/// list-producing variants ([`file_history`]/[`line_history_list`]) use —
/// locked by `scripts/plain/boundary-contracts.mjs`. See this module's own
/// doc comment for the full format-string safety rationale.
pub(crate) const GIT_LOG_COMMIT_META_ARGS: &[&str] =
    &["log", "-z", "--format=%H%x1f%B", "--no-patch"];

/// Defensive ceiling on how many entries a single [`file_history`]/
/// [`line_history_list`] call ever returns — git itself imposes no such
/// limit; this exists only to bound a pathological, very-long-lived file's
/// response size, mirroring `dto::MAX_GIT_MUTATE_PATHS`'s identical
/// "defensive, not measured" rationale for this domain. Not the risk
/// decision 4 of the research doc flags for `-L`/blame-style *per-line*
/// cost (that remains an open, disclosed risk — see this slice's own
/// report) — this is purely a response-size ceiling.
const MAX_HISTORY_ENTRIES: usize = 500;

fn git_log_invalid_path() -> CommandError {
    CommandError::new(
        "GIT_LOG_INVALID_PATH",
        "The requested path is empty, too large, or invalid.",
    )
}

fn git_log_invalid_range() -> CommandError {
    CommandError::new(
        "GIT_LOG_INVALID_RANGE",
        "The requested line range is invalid (start must be >= 1 and <= end).",
    )
}

fn git_log_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_LOG_PARSE_FAILED",
        "The git log output could not be parsed.",
    )
}

fn git_file_history_failed() -> CommandError {
    CommandError::new(
        "GIT_FILE_HISTORY_FAILED",
        "git log did not complete successfully.",
    )
}

fn git_line_history_path_not_found() -> CommandError {
    CommandError::new(
        "GIT_LINE_HISTORY_PATH_NOT_FOUND",
        "The requested path does not exist at the current revision.",
    )
}

fn git_line_history_range_out_of_bounds() -> CommandError {
    CommandError::new(
        "GIT_LINE_HISTORY_RANGE_OUT_OF_BOUNDS",
        "The requested line range is outside the file's current line count.",
    )
}

fn git_line_history_list_failed() -> CommandError {
    CommandError::new(
        "GIT_LINE_HISTORY_LIST_FAILED",
        "git log did not complete successfully.",
    )
}

fn git_line_history_detail_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_LINE_HISTORY_DETAIL_INVALID_REQUEST",
        "The line history detail request is invalid.",
    )
}

fn git_line_history_detail_not_found() -> CommandError {
    CommandError::new(
        "GIT_LINE_HISTORY_DETAIL_NOT_FOUND",
        "No commit exists at the requested position in this line's history.",
    )
}

/// Returned when [`line_history_detail`]'s own re-walk lands on a different
/// commit than the caller expected — see this module's own doc comment for
/// why this is a distinguishable outcome (the underlying history shifted
/// between the caller's list fetch and this call) rather than either a
/// silent wrong-commit display or a generic parse failure.
fn git_line_history_detail_stale_index() -> CommandError {
    CommandError::new(
        "GIT_LINE_HISTORY_DETAIL_STALE_INDEX",
        "The line's history has changed since it was listed; refresh and try again.",
    )
}

fn git_line_history_detail_failed() -> CommandError {
    CommandError::new(
        "GIT_LINE_HISTORY_DETAIL_FAILED",
        "git log did not complete successfully.",
    )
}

fn is_lowercase_hex40(bytes: &[u8]) -> bool {
    bytes.len() == 40
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

/// A 1-based, inclusive line range — the same shape as
/// [`super::blame::BlameLineRange`], kept as this module's own independent
/// type (not a shared/reused struct) exactly like every other per-domain
/// constant/type in this codebase (e.g. `dto::MAX_GIT_MUTATE_PATH_BYTES`
/// duplicated rather than imported by `commit.rs`) — this module's own range
/// has a different meaning (mandatory for every call, never `None`) from
/// blame's (optional, `None` means whole-file).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct LineRange {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

impl LineRange {
    fn validate(self) -> Result<(), CommandError> {
        if self.start == 0 || self.end < self.start {
            return Err(git_log_invalid_range());
        }
        Ok(())
    }

    fn spec(self, path: &str) -> String {
        format!("-L{},{}:{}", self.start, self.end, path)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoryEntry {
    pub(crate) sha: String,
    /// The commit's full message body (`%B`) — never truncated server-side;
    /// see this module's own doc comment for why a caller wanting the
    /// message's first line alone derives it itself rather than this module
    /// duplicating `blame::BlameCommitHeader::summary`'s "first line only"
    /// convention.
    pub(crate) message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoryList {
    pub(crate) entries: Vec<HistoryEntry>,
    /// `true` when more than [`MAX_HISTORY_ENTRIES`] commits actually matched
    /// — the response was capped, not exhaustive.
    pub(crate) truncated: bool,
}

/// Parses [`GIT_LOG_COMMIT_META_ARGS`]'s NUL-record output into an ordered
/// [`HistoryEntry`] list, capping at [`MAX_HISTORY_ENTRIES`] + reporting
/// `truncated`. `output` is expected to have been produced by a call that
/// requested `MAX_HISTORY_ENTRIES + 1` records (via `--max-count`) so
/// truncation can be detected without a second round trip.
fn parse_history_entries(output: &[u8]) -> Result<HistoryList, CommandError> {
    let mut entries = Vec::new();
    for record in split_nul_records(output) {
        if record.is_empty() {
            continue;
        }
        // Exactly [`super::blame::parse_commit_messages`]'s own technique,
        // independently re-verified for this module (see this module's own
        // doc comment and `tests.rs`'s hostile-message fixture): split on the
        // *first* `0x1f` byte only, so the sha (always exactly 40 lowercase
        // hex bytes, safe to match positionally) is recovered correctly no
        // matter what the message body itself contains, including a further
        // embedded `0x1f`.
        let mut parts = record.splitn(2, |&byte| byte == 0x1f);
        let sha_bytes = parts.next().ok_or_else(git_log_parse_failed)?;
        let message_bytes = parts.next().ok_or_else(git_log_parse_failed)?;
        if !is_lowercase_hex40(sha_bytes) {
            return Err(git_log_parse_failed());
        }
        let sha = String::from_utf8(sha_bytes.to_vec()).expect("hex digits are ASCII");
        let message = String::from_utf8_lossy(message_bytes).into_owned();
        entries.push(HistoryEntry { sha, message });
    }
    let truncated = entries.len() > MAX_HISTORY_ENTRIES;
    if truncated {
        entries.truncate(MAX_HISTORY_ENTRIES);
    }
    Ok(HistoryList { entries, truncated })
}

/// Shared by [`file_history`]/[`line_history_list`] — `on_other_failure` is
/// each caller's own generic "git exited non-zero for some other reason"
/// error constructor, so the two commands keep independent, caller-specific
/// error codes for that fallback case while sharing this one spawn/parse
/// pipeline and the two error messages both commands' own `-L`/`--` argument
/// shapes can actually produce ("There is no path"/"has only" — the latter
/// only reachable for [`line_history_list`]'s own `-L` form, never
/// [`file_history`]'s `--follow --`, but checked unconditionally here since
/// it can never falsely match [`file_history`]'s own stderr).
async fn run_history_list(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    suffix_args: Vec<String>,
    on_other_failure: fn() -> CommandError,
) -> Result<Vec<u8>, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let mut args: Vec<String> = GIT_LOG_COMMIT_META_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.push(format!("--max-count={}", MAX_HISTORY_ENTRIES + 1));
    args.extend(suffix_args);

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("There is no path") {
            return Err(git_line_history_path_not_found());
        }
        if stderr.contains("has only") {
            return Err(git_line_history_range_out_of_bounds());
        }
        return Err(on_other_failure());
    }
    Ok(output.stdout)
}

/// `git log -z --format=%H%x1f%B --no-patch --follow -- <path>` — the
/// whole-file commit list. `--follow` is git's own documented *heuristic*
/// rename tracker (same-commit rename-detection similarity, not a guarantee)
/// — see `tests.rs`'s
/// `file_history_follow_crosses_a_single_rename_while_the_unfollowed_call_stops_at_it`
/// for the executable proof of both halves of that claim (crosses one clean
/// rename; the plain unfollowed call does not). A path with no history at
/// all (never committed, or never existed) is **not** an error — git itself
/// reports exit `0` with empty output for that case (confirmed empirically),
/// so this returns an empty, non-truncated [`HistoryList`].
pub(crate) async fn file_history(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    path: &str,
) -> Result<HistoryList, CommandError> {
    if !is_valid_mutate_path(path) {
        return Err(git_log_invalid_path());
    }
    let suffix = vec!["--follow".to_owned(), "--".to_owned(), path.to_owned()];
    let stdout = run_history_list(
        trust,
        workspace,
        window_label,
        suffix,
        git_file_history_failed,
    )
    .await?;
    parse_history_entries(&stdout)
}

/// `git log -z --format=%H%x1f%B --no-patch -L<start>,<end>:<path>` — the
/// commit list touching one specific line range. Unlike [`file_history`],
/// this is **not** combined with `--follow` (confirmed empirically mutually
/// exclusive: `fatal: --follow requires exactly one pathspec` — `-L`'s own
/// embedded path does not count as a standalone pathspec to git). `-L`
/// already follows a rename on its own by default for the tracked line range
/// (see `tests.rs`'s
/// `line_history_list_crosses_a_rename_by_default_without_needing_follow`).
pub(crate) async fn line_history_list(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    path: &str,
    range: LineRange,
) -> Result<HistoryList, CommandError> {
    if !is_valid_mutate_path(path) {
        return Err(git_log_invalid_path());
    }
    range.validate()?;
    let suffix = vec![range.spec(path)];
    let stdout = run_history_list(
        trust,
        workspace,
        window_label,
        suffix,
        git_line_history_list_failed,
    )
    .await?;
    parse_history_entries(&stdout)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LineHistoryDetail {
    pub(crate) sha: String,
    /// Raw, human-readable `git log -p`-style text (commit header, author,
    /// date, message, unified diff hunk) — never field-parsed, only
    /// validated to begin with `commit <sha>` (see this module's own doc
    /// comment for why no `--format` override is used here at all).
    pub(crate) diff_text: String,
}

/// Verifies `stdout` begins with `commit <expected_sha>\n` (git's own,
/// undecorated default header line — decorations are off by default for
/// non-tty/piped output, confirmed empirically, so this exact match is safe)
/// and returns the full text unmodified. `None` distinguishes "the output
/// does not even look like a git log record at all" from "well-formed but a
/// different commit than expected" — the caller maps the two to different
/// structured errors.
fn verify_leading_commit_line(stdout: &[u8], expected_sha: &str) -> Option<String> {
    let text = String::from_utf8_lossy(stdout);
    let expected_header = format!("commit {expected_sha}\n");
    if text.starts_with(&expected_header) {
        Some(text.into_owned())
    } else {
        None
    }
}

/// Drills into one [`line_history_list`] entry's actual diff hunk. `skip` is
/// the zero-based position of the desired entry within the *same*
/// `line_history_list(path, range)` call's own result order — see this
/// module's own doc comment for the full rationale for why this (not a bare
/// `<sha>` positional, the frozen plan's original sketch) is the command
/// shape that actually threads through a rename. `expected_sha` must be the
/// sha the caller's own previously-fetched list reported at that position;
/// a mismatch (or no record at all at that position — see
/// [`git_line_history_detail_not_found`]) is rejected rather than silently
/// showing the wrong commit.
pub(crate) async fn line_history_detail(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    path: &str,
    range: LineRange,
    skip: u32,
    expected_sha: &str,
) -> Result<LineHistoryDetail, CommandError> {
    if !is_valid_mutate_path(path) {
        return Err(git_log_invalid_path());
    }
    range.validate()?;
    if !is_lowercase_hex40(expected_sha.as_bytes()) {
        return Err(git_line_history_detail_invalid_request());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args: Vec<String> = vec![
        "-c".to_owned(),
        "core.quotePath=false".to_owned(),
        "log".to_owned(),
        format!("--skip={skip}"),
        "--max-count=1".to_owned(),
        range.spec(path),
    ];

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("There is no path") {
            return Err(git_line_history_path_not_found());
        }
        if stderr.contains("has only") {
            return Err(git_line_history_range_out_of_bounds());
        }
        return Err(git_line_history_detail_failed());
    }
    if output.stdout.is_empty() {
        // Exit 0 with empty output means the walk simply had no record at
        // this `skip` position (confirmed empirically: `--skip` beyond the
        // number of matching commits is not an error) — distinguishable from
        // a hard git failure above.
        return Err(git_line_history_detail_not_found());
    }
    match verify_leading_commit_line(&output.stdout, expected_sha) {
        Some(diff_text) => Ok(LineHistoryDetail {
            sha: expected_sha.to_owned(),
            diff_text,
        }),
        None => Err(git_line_history_detail_stale_index()),
    }
}

// --- F090 S3: log_graph -----------------------------------------------------

/// The exact, audited base `git log` argument list [`log_graph`] uses — see
/// this module's own doc comment ("F090 S3: the graph command's own
/// format-string safety design") for the full field-safety, ordering and
/// ref-namespace-scope rationale. Locked by
/// `scripts/plain/boundary-contracts.mjs`'s
/// `validateGitLogGraphFormatStringBoundary`.
pub(crate) const GIT_LOG_GRAPH_ARGS: &[&str] = &[
    "log",
    "-z",
    "--format=%H%x1f%P%x1f%s",
    "--no-patch",
    "--topo-order",
    "--branches",
    "--tags",
    "--remotes",
];

/// Defensive ceiling on the caller-requested `max_count` for a single
/// [`log_graph`] call — exists only to reject a structurally hostile/runaway
/// request, not to model any real per-view display limit (the caller's own
/// `max_count`, itself bounded by this ceiling, is the real display budget).
const MAX_GRAPH_MAX_COUNT: u32 = 5_000;

fn git_log_graph_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_LOG_GRAPH_INVALID_REQUEST",
        "The requested max_count is zero or exceeds the allowed ceiling.",
    )
}

fn git_log_graph_failed() -> CommandError {
    CommandError::new(
        "GIT_LOG_GRAPH_FAILED",
        "git log did not complete successfully.",
    )
}

fn git_log_graph_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_LOG_GRAPH_PARSE_FAILED",
        "The git log graph output could not be parsed.",
    )
}

/// One DAG node — `parents` is empty for a root commit, one element for an
/// ordinary commit, two for a normal merge, or three-or-more for an octopus
/// merge (see `tests.rs`'s own fixture covering all four shapes). `subject`
/// is the commit message's first line only (git's own `%s` convention) — a
/// caller wanting the full body already has
/// [`blame_commit_messages`](super::blame::blame_commit_messages) for an
/// on-demand batch fetch, exactly like
/// [`super::blame::BlameCommitHeader::summary`]'s own "full body is a
/// separate, on-demand fetch" precedent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphNode {
    pub(crate) sha: String,
    pub(crate) parents: Vec<String>,
    pub(crate) subject: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphList {
    pub(crate) nodes: Vec<GraphNode>,
    /// `true` when more commits actually matched the caller's own requested
    /// `max_count` than were returned — the same "capped, not exhaustive"
    /// meaning [`HistoryList::truncated`] already carries for this domain.
    pub(crate) truncated: bool,
}

/// Parses [`GIT_LOG_GRAPH_ARGS`]'s NUL-record output, requested with
/// `--max-count={max_nodes + 1}` so truncation is detectable without a
/// second round trip — exactly [`parse_history_entries`]'s own technique,
/// applied to this command's three-field (not two-field) record shape.
fn parse_graph_entries(output: &[u8], max_nodes: usize) -> Result<GraphList, CommandError> {
    let mut nodes = Vec::new();
    for record in split_nul_records(output) {
        if record.is_empty() {
            continue;
        }
        // Exactly `parse_history_entries`'s own "split on the first N-1
        // separators only" technique (here N=3), so the one free-text field
        // (`subject`, last) safely absorbs every remaining byte of the
        // record regardless of what it contains — see this module's own doc
        // comment for the full rationale.
        let mut parts = record.splitn(3, |&byte| byte == 0x1f);
        let sha_bytes = parts.next().ok_or_else(git_log_graph_parse_failed)?;
        let parents_bytes = parts.next().ok_or_else(git_log_graph_parse_failed)?;
        let subject_bytes = parts.next().ok_or_else(git_log_graph_parse_failed)?;
        if !is_lowercase_hex40(sha_bytes) {
            return Err(git_log_graph_parse_failed());
        }
        let sha = String::from_utf8(sha_bytes.to_vec()).expect("hex digits are ASCII");
        let mut parents = Vec::new();
        if !parents_bytes.is_empty() {
            for token in parents_bytes.split(|&byte| byte == b' ') {
                if !is_lowercase_hex40(token) {
                    return Err(git_log_graph_parse_failed());
                }
                parents.push(String::from_utf8(token.to_vec()).expect("hex digits are ASCII"));
            }
        }
        let subject = String::from_utf8_lossy(subject_bytes).into_owned();
        nodes.push(GraphNode {
            sha,
            parents,
            subject,
        });
    }
    let truncated = nodes.len() > max_nodes;
    if truncated {
        nodes.truncate(max_nodes);
    }
    Ok(GraphList { nodes, truncated })
}

/// `git log -z --format=%H%x1f%P%x1f%s --no-patch --topo-order --branches
/// --tags --remotes --max-count=<max_count+1>` — the graph view's own DAG
/// source. `max_count` must be nonzero and at most [`MAX_GRAPH_MAX_COUNT`];
/// the caller (the graph view) picks the real display window within that
/// ceiling. Runs under [`GitExecMode::BackgroundRead`] through [`run_git`],
/// exactly like every other read in this domain — no new exec path. See
/// this module's own doc comment for the full format-string-safety,
/// ordering and ref-namespace-scope rationale.
pub(crate) async fn log_graph(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    max_count: u32,
) -> Result<GraphList, CommandError> {
    if max_count == 0 || max_count > MAX_GRAPH_MAX_COUNT {
        return Err(git_log_graph_invalid_request());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let mut args: Vec<String> = GIT_LOG_GRAPH_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.push(format!("--max-count={}", u64::from(max_count) + 1));

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        return Err(git_log_graph_failed());
    }
    parse_graph_entries(&output.stdout, max_count as usize)
}

#[cfg(test)]
mod tests;
