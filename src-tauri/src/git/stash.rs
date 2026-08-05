//! `git::stash` — `F090` S4's stash workflow (`docs/research/2026-07-26-git-history.md`'s
//! slice 5): `list`/`show` are read-only (`GitExecMode::BackgroundRead`,
//! exactly like every other read in this domain — no new exec path);
//! `push`/`apply`/`pop`/`drop` are real writes (`GitExecMode::Write`, exactly
//! like `stage`/`commit`/`discard`).
//!
//! # Field safety: `%gd`/`%H`/`%ct` are git-computed, `%B` is the one absorbing free-text field
//!
//! [`GIT_STASH_LIST_ARGS`]' `--format=%gd%x1f%H%x1f%ct%x1f%B` follows the
//! same discipline `super::log::GIT_LOG_COMMIT_META_ARGS` and
//! `super::log::GIT_LOG_GRAPH_ARGS` already established for this domain: a
//! stash entry's message is **entirely user-supplied** (`git stash push -m
//! <message>` accepts arbitrary bytes, including this format string's own
//! `0x1f` separator — confirmed empirically, this slice's own report: a real
//! `git stash push -m $'evil\x1fmessage\x1funits'` round-trips through
//! `git stash list` with the literal `0x1f` bytes intact inside the message,
//! same as `F090` S0/S1's hostile-commit-message findings), so it is
//! positioned **last** and the parser (`parse_stash_list`) uses
//! `splitn(4, ...)` so it absorbs everything after the third separator
//! rather than being naively split into more fields. `tests.rs`'s
//! `parse_stash_list_splitn_is_not_confused_by_a_message_containing_an_embedded_separator_byte`
//! is the required control-group proof: a hand-built two-record output whose
//! *first* record's message contains an embedded `0x1f` byte is parsed
//! correctly by the production `splitn(4, ...)` logic, while a naive
//! full-`.split(0x1f)` control path genuinely misparses it (shifts every
//! field of the *second* record by one) — never merely asserting the chosen
//! path "happens to look right".
//!
//! `%gd` (`stash@{N}`, an ASCII index token computed from the reflog
//! position — never user content), `%H` (hex40) and `%ct` (a decimal Unix
//! timestamp, optionally `-`-prefixed) can none of them ever contain a
//! `0x1f` byte by construction, so they need no absorbing treatment
//! themselves — mirrors `super::log::GIT_LOG_GRAPH_ARGS`' own "git-computed
//! fields positioned before the one free-text field" shape, independently
//! re-derived here for this command's own field set.
//!
//! A stash entry's message additionally **cannot** contain a literal `NUL`
//! byte at all — confirmed empirically at the lowest plumbing level, not
//! merely inferred from the `-m` argv-encoding limitation every other
//! argument already has: `git commit-tree <tree> -p <parent>` fed a message
//! containing an embedded `0x00` byte over **stdin** (which, unlike an argv
//! element, genuinely can carry an embedded NUL byte at the OS level) is
//! flatly rejected by git itself (`error: a NUL byte in commit log message
//! not allowed.`, non-zero exit, no object created) — this slice's own
//! report. A stash entry *is* a commit object, so this invariant applies to
//! it exactly as much as to an ordinary commit. [`split_nul_records`]
//! splitting [`GIT_STASH_LIST_ARGS`]' whole `-z` output into per-entry
//! records by `NUL` is therefore safe for the *same* reason
//! `super::log::parse_history_entries`'s own `%B`-absorbing field is: the one
//! byte used as the outer record separator is one no field's content can
//! ever legally contain, proven rather than assumed.
//!
//! # `-c core.quotePath=false` is unnecessary for `stash show` — confirmed empirically, contradicting the frozen plan's own inference
//!
//! The frozen research doc's "risk item 4" flagged this as unverified,
//! inferring (from [`super::blame`]'s own finding that `-z` alone does
//! *not* suppress `core.quotePath`-style path quoting there) that `stash
//! show`/`worktree list` would likely need the same override. **That
//! inference was wrong for `stash show`**, confirmed directly against real
//! git 2.50.1: a stash entry touching a file named with a literal double
//! quote, tab, backslash *and* non-ASCII bytes all in the same filename
//! (`weird"quote<TAB>and\backslash.txt`) comes back **byte-identical, fully
//! unescaped** from `git stash show --name-status -z <sha>` whether or not
//! `-c core.quotePath=false` is also passed — this slice's own
//! `stash_show_name_status_path_quoting_is_unaffected_by_core_quote_path`
//! control-group test reproduces both invocations side by side and asserts
//! they are identical. The mechanism is different from blame's: `stash
//! show`'s `--name-status`/`--numstat` output is produced by the exact same
//! `git diff`-family machinery `super::diff`'s own commands already use (not
//! `blame`'s special-cased `--line-porcelain` output), and `F080` S1 already
//! established that *that* family's `-z` genuinely does disable quoting
//! entirely, independent of `core.quotePath` — this module's own finding is
//! simply that `stash show`'s structured output belongs to that family, not
//! blame's. [`GIT_STASH_SHOW_NAME_STATUS_ARGS`]/[`GIT_STASH_SHOW_NUMSTAT_ARGS`]
//! therefore carry no `-c core.quotePath=...` override at all — a real,
//! disclosed deviation from what the frozen plan's own risk item guessed,
//! not an oversight. (This slice separately confirmed, as a documentation-only
//! bonus finding since `worktree` is `F090` S5's own scope and out of bounds
//! here, that `git worktree list --porcelain -z` behaves identically —
//! unaffected by `core.quotePath` either — so S5 should not need to add the
//! override either; that finding is *not* backed by a test in this slice's
//! own suite, only by an ad hoc manual repro, and must be re-verified with a
//! real fixture when S5 is implemented.)
//!
//! # `stash show` never has `git show`'s mixed human-readable-header problem
//!
//! Unlike [`super::show_commit`] (which never spawns `git show` at all,
//! specifically to dodge a real header-before-NUL-data defect that command
//! has), `git stash show --name-status -z -u <sha>` was confirmed empirically
//! (this slice's own report) to produce **pure, header-free** NUL-delimited
//! records from the very first byte — there is no commit-header text to
//! strip. This module therefore *does* spawn `stash show` directly (its own
//! dedicated subcommand, not `diff`/`show`), the simpler of the two designs
//! the frozen plan left open ("只读浏览可复用 F080 已有的 diff 解析路径…标注为
//! 待实施时用真实 stash fixture 复测确认" — now confirmed, not merely assumed).
//! `-u`/`--include-untracked` is passed **unconditionally**: confirmed
//! empirically that it is harmless to pass even when the stash entry being
//! shown was *not* itself created with `-u` (no error, simply nothing extra
//! to show) — there is no need to track "was this particular entry pushed
//! with untracked files" as separate state just to decide whether to pass
//! the flag.
//!
//! # Copy detection needs `--find-copies-harder`, exactly like `show_commit`
//!
//! Mirrors `super::show_commit`'s own finding: a byte-identical copy of a
//! file that was itself left untouched by the stash is only recognized as a
//! `Copied` record (rather than reported as a plain `Added`) when
//! `--find-copies-harder` is passed alongside `-M -C` — this module's own
//! [`GIT_STASH_SHOW_NAME_STATUS_ARGS`]/[`GIT_STASH_SHOW_NUMSTAT_ARGS`] include
//! it unconditionally (a one-off, user-triggered "show this stash's files"
//! request can afford the extra tree scan, exactly like `show_commit`'s own
//! reasoning for not reusing `super::diff::GIT_DIFF_BASE_ARGS`, which is
//! tuned instead for the automatic background-polling status/diff view).
//!
//! # Sha-based addressing eliminates the "index shifts after drop" race for `show`/`apply`, but *not* for `pop`/`drop`
//!
//! The frozen plan's own "风险与未知项" anticipated a real race: dropping a
//! stash entry shifts every later entry's `stash@{N}` index down by one, so a
//! caller holding a stale index from an earlier `list` call could otherwise
//! act on the wrong entry. This slice's first instinct — "always address by
//! the entry's own immutable sha, never by `stash@{N}`, and this race
//! disappears entirely" — is **half right**, confirmed by directly reading
//! `git help stash`'s own documented command grammar and testing all four
//! operations against a real bare sha:
//!
//! - `git stash show <sha>` and `git stash apply <sha>` **both accept a bare
//!   commit sha directly** — `apply`'s own manual page is explicit ("Unlike
//!   pop, `<stash>` may be any commit that looks like a commit created by
//!   stash push or stash create"), and this slice confirmed `show` accepts it
//!   too, empirically. [`show_stash`]/[`apply_stash`] therefore take a plain
//!   `sha: &str` and pass it straight through — no index, no drift, ever.
//! - `git stash pop <sha>` and `git stash drop <sha>` **both reject a bare
//!   sha outright** — confirmed empirically (`error: '<sha>' is not a stash
//!   reference`, exit `1`) — git's own grammar requires the `stash@{N}` (or
//!   bare integer `N`) reflog-relative form for these two specifically.
//!
//! [`pop_stash`]/[`drop_stash`] therefore still take the caller's held
//! `expected_sha`, but resolve it to a **fresh** `stash@{N}` themselves,
//! immediately before acting, via [`resolve_stash_ref_by_sha`] (a `list`
//! re-query, searching for the entry whose own `sha` matches — never trusting
//! an index the caller might supply): if no entry in that fresh list has the
//! expected sha (already dropped/popped by someone else, or a stale/bogus
//! value), this fails closed with [`git_stash_not_found`] *before* `pop`/
//! `drop` is ever spawned — the caller never needs to hold, track, or pass an
//! index at all; only the identity it already has from its own last `list`
//! call. This is a **stronger** design than "index + expected sha
//! verification" (the shape `super::log::line_history_detail`'s own
//! `--skip`+`expected_sha` check uses for an analogous drift problem):
//! `line_history_detail`'s target commit still exists elsewhere in history
//! even after the drift that stale skip position was chasing, so verifying
//! "does this position still name what I expect" is the right check; a
//! stash entry that has already been dropped is **genuinely gone** (no index
//! at all could ever name it again), so "does an entry with this sha still
//! exist right now" is the complete and correct check, not merely an
//! approximation of one. A residual race remains (this module's own `list`
//! re-query and the subsequent `pop`/`drop` spawn are two separate git
//! invocations, so an external actor could in principle modify the stash ref
//! between them) — accepted per the frozen plan's own framing of this as a
//! disclosed, narrow window, not eliminated outright; `tests.rs`'s
//! `drop_stash_shifts_a_later_entrys_index_but_a_third_entry_is_still_dropped_correctly_by_its_own_sha`
//! is the required real-fixture proof that a genuine index shift (from an
//! earlier drop) does not cause this module to act on the wrong entry.
//!
//! No two distinct real stash entries can ever collide on the same sha in
//! practice (each stash commit's own tree/parents/author-and-committer-date/
//! message would all have to match exactly) — and even in the contrived case
//! where a caller pushes byte-for-byte identical content twice with a forced
//! identical timestamp (`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` env overrides),
//! this slice confirmed empirically that git's own reflog mechanism does not
//! even *record* a second entry for a no-op ref update to the same value — so
//! there is structurally never more than one list entry sharing a sha to
//! disambiguate between in the first place; `resolve_stash_ref_by_sha`
//! nonetheless takes the *first* match deterministically (rather than
//! panicking on an impossible-in-practice duplicate) as a defensive,
//! documented tie-break.
//!
//! # `-m <message>` on the command line, not stdin — a deliberate, tested deviation from `commit`'s own convention
//!
//! [`super::commit::commit`]'s own module doc comment explains why a commit
//! message travels over stdin rather than as a `-m`/`--file -` command-line
//! argument: "a message beginning with `-` must never be misread as a git
//! flag". `git stash push` has **no stdin-message interface at all**
//! (confirmed by reading `git help stash`'s own command grammar for `push`:
//! only `(-m | --message) <message>` exists, no `--file`/stdin form) — this
//! module has no choice but to pass the message as a `-m` argv pair. This is
//! confirmed empirically safe regardless: `Command::arg` places the message
//! in its own, complete argv slot (no shell ever re-tokenizes it), and `-m`
//! unconditionally consumes exactly the next argv slot as its value
//! regardless of its own content — verified directly against real git 2.50.1
//! with a message that is itself `"-not-a-real-flag"`, which stashes
//! correctly rather than being misread as an option (`tests.rs`'s
//! `push_stash_accepts_a_message_that_itself_looks_like_a_flag`). This is a
//! real, disclosed difference from `commit`'s own defense-in-depth choice,
//! not an inconsistency introduced by oversight — `commit`'s stdin design is
//! *available* to it (git supports `--file -` there) and chosen anyway for
//! extra safety margin; this module simply has no equivalent option to
//! choose.
//!
//! # `--quiet` silently swallows `push`'s own "No local changes to save" outcome
//!
//! `git stash push`'s own documented behavior when there is nothing to stash
//! is to print `"No local changes to save"` to stdout and still exit `0` —
//! this module's first draft relied on exactly that text (mirroring
//! `commit::commit`'s own "nothing to commit" stdout-substring convention)
//! to distinguish [`StashPushOutcome::NoLocalChanges`] from
//! [`StashPushOutcome::Created`]. Confirmed empirically, and caught by this
//! slice's own integration test rather than assumed to transfer: passing
//! `--quiet` (this domain's default hardening posture for every other write
//! command) suppresses **both** stdout messages, the success one *and* the
//! "nothing to save" one — with `--quiet`, a no-op push and a real push are
//! byte-for-byte indistinguishable from stdout/stderr alone (both exit `0`
//! with empty output). [`GIT_STASH_PUSH_ARGS`]/
//! [`GIT_STASH_PUSH_INCLUDE_UNTRACKED_ARGS`] therefore deliberately omit
//! `--quiet` — the only way this module has to observe the outcome it needs
//! to report.
//!
//! # An explicit `-- .` pathspec is required for `--include-untracked` to actually work under this domain's own `GIT_LITERAL_PATHSPECS=1` hardening
//!
//! The single most significant, costly finding of this slice. `exec.rs`'s
//! `apply_universal_hardening` sets `GIT_LITERAL_PATHSPECS=1` for **every**
//! invocation this domain ever makes, in every [`GitExecMode`] — a blanket
//! defense against a real vulnerability `F080` found (git's pathspec-magic
//! glob expansion silently touching sibling files a caller's own literal
//! path never named, e.g. `checkout -q -- 'a*.txt'` reverting `a1.txt`/
//! `a2.txt` alongside the literally-intended `a*.txt`). This module's own
//! integration test for `push_stash(.., include_untracked: true)`
//! **deterministically failed** when exercised through this domain's real
//! `run_git`/`GitExecMode::Write` path: the stash entry was created
//! successfully (proven by a real `git stash list` afterward), but the
//! untracked file was **never removed from the working tree** — a silent,
//! partial failure of `--include-untracked`'s own documented contract, not
//! an error this module could otherwise have detected from `push`'s own exit
//! code or output (both reported success). Bisection (this slice's own
//! report, `GIT_LITERAL_PATHSPECS=1` isolated as the single environment
//! variable responsible, reproduced deterministically both via a raw
//! `env -i`-constructed invocation and via 5/5 repeated real test runs)
//! traced this to git's own internal implementation of
//! `--include-untracked`: whatever internal pathspec expression it uses by
//! default to select "every currently untracked file" for post-stash removal
//! apparently relies on the same glob/magic pathspec semantics
//! `GIT_LITERAL_PATHSPECS=1` disables — with that variable set, git still
//! *captures* the untracked content into the stash commit correctly, but
//! silently fails to actually delete the now-stashed file(s) from the
//! working tree. This is a genuinely surprising interaction between an
//! existing hardening measure and a brand-new command this domain had never
//! exercised before, not a defect in this module's own new code. **Fix**:
//! append an explicit, literal `-- .` pathspec to *every* `push` invocation
//! (not only the `include_untracked` branch — one single code path, not two
//! subtly different ones) — confirmed empirically (3/3 repeated runs) that
//! this restores `--include-untracked`'s correct removal behavior even with
//! `GIT_LITERAL_PATHSPECS=1` still set, and confirmed not to change behavior
//! for a plain (non-`include_untracked`) push, an unborn-`HEAD` push, or a
//! "nothing to save" push (all three re-verified after adding it). This
//! module deliberately does **not** weaken `GIT_LITERAL_PATHSPECS=1` itself
//! (that would silently reopen the exact `F080` glob vulnerability this
//! codebase's own hardening exists to close, for every other domain command
//! sharing the same universal hardening) — the fix is entirely local to this
//! one command's own argument list.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::diff::{merge_diff_files, parse_name_status, parse_numstat, DiffFileEntry};
use super::exec::{run_git, GitExecMode, GitExecOutput};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};
use super::status::{git_status_failed, parse_porcelain_v2, StatusEntry, GIT_STATUS_ARGS};
use super::wire::{split_nul_records, GitPathBuf};

/// Mirrors `log::is_lowercase_hex40`/`refs::is_lowercase_hex40` — this
/// module's own independent copy, per this codebase's established
/// per-domain-function duplication convention.
fn is_lowercase_hex40(bytes: &[u8]) -> bool {
    bytes.len() == 40
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

/// Defensive ceiling on how many stash entries a single [`list_stashes`] call
/// ever returns — mirrors `super::log::MAX_HISTORY_ENTRIES`/
/// `super::refs::MAX_REF_ENTRIES`'s identical "bound a pathological response
/// size" rationale for this domain.
const MAX_STASH_ENTRIES: usize = 10_000;

/// Defensive ceiling on a stash message's byte length — mirrors
/// `commit::MAX_GIT_COMMIT_MESSAGE_BYTES` (its own independent copy, per this
/// file's own duplication convention).
const MAX_GIT_STASH_MESSAGE_BYTES: usize = 100_000;

fn git_stash_list_failed() -> CommandError {
    CommandError::new(
        "GIT_STASH_LIST_FAILED",
        "git stash list did not complete successfully.",
    )
}

fn git_stash_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_STASH_PARSE_FAILED",
        "The git stash list output could not be parsed.",
    )
}

fn git_stash_show_failed() -> CommandError {
    CommandError::new(
        "GIT_STASH_SHOW_FAILED",
        "git stash show did not complete successfully.",
    )
}

/// Covers both "no stash entry has this sha at all" (a malformed/bogus
/// caller-supplied value) and the genuine race [`resolve_stash_ref_by_sha`]'s
/// own doc comment describes (the entry existed when the caller last listed
/// stashes, but has since been popped/dropped by someone else) — both are, by
/// the time this is returned, simply "no such stash entry exists right now".
fn git_stash_not_found() -> CommandError {
    CommandError::new(
        "GIT_STASH_NOT_FOUND",
        "No stash entry with the requested identity exists.",
    )
}

fn git_stash_push_empty_message() -> CommandError {
    CommandError::new(
        "GIT_STASH_PUSH_EMPTY_MESSAGE",
        "The stash message must not be empty.",
    )
}

fn git_stash_push_message_too_large() -> CommandError {
    CommandError::new(
        "GIT_STASH_PUSH_MESSAGE_TOO_LARGE",
        "The stash message exceeds the allowed size limit.",
    )
}

/// `git stash push`'s own "no commit to base the stash on yet" outcome
/// (confirmed empirically: exit `1`, stderr "You do not have the initial
/// commit yet") — a repository with staged/modified content but zero commits
/// (an unborn `HEAD`) cannot be stashed at all, since a stash entry is itself
/// a commit requiring a parent. Surfaced as its own structured code rather
/// than the generic [`git_stash_push_failed`] so a caller can show a specific,
/// actionable message ("make an initial commit first").
fn git_stash_push_no_initial_commit() -> CommandError {
    CommandError::new(
        "GIT_STASH_PUSH_NO_INITIAL_COMMIT",
        "The repository has no commits yet, so there is nothing to base a stash on.",
    )
}

fn git_stash_push_failed() -> CommandError {
    CommandError::new(
        "GIT_STASH_PUSH_FAILED",
        "git stash push did not complete successfully.",
    )
}

fn git_stash_apply_would_overwrite() -> CommandError {
    CommandError::new(
        "GIT_STASH_APPLY_WOULD_OVERWRITE",
        "Applying this stash would overwrite local changes to the same files; commit or stash them first.",
    )
}

fn git_stash_apply_failed() -> CommandError {
    CommandError::new(
        "GIT_STASH_APPLY_FAILED",
        "git stash apply did not complete successfully.",
    )
}

fn git_stash_pop_would_overwrite() -> CommandError {
    CommandError::new(
        "GIT_STASH_POP_WOULD_OVERWRITE",
        "Popping this stash would overwrite local changes to the same files; commit or stash them first.",
    )
}

fn git_stash_pop_failed() -> CommandError {
    CommandError::new(
        "GIT_STASH_POP_FAILED",
        "git stash pop did not complete successfully.",
    )
}

fn git_stash_drop_failed() -> CommandError {
    CommandError::new(
        "GIT_STASH_DROP_FAILED",
        "git stash drop did not complete successfully.",
    )
}

/// The exact, audited `stash list` argument list — see this module's own doc
/// comment for the full field-safety rationale. Locked by
/// `scripts/plain/boundary-contracts.mjs`'s `validateGitStashMessageFieldSafetyBoundary`.
pub(crate) const GIT_STASH_LIST_ARGS: &[&str] =
    &["stash", "list", "-z", "--format=%gd%x1f%H%x1f%ct%x1f%B"];

/// See this module's own doc comment ("`stash show` never has `git show`'s
/// mixed human-readable-header problem") for why this is safe as a direct
/// `--name-status -z` invocation, and ("Copy detection needs
/// `--find-copies-harder`") for why every flag here is required. Locked by
/// `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STASH_SHOW_NAME_STATUS_ARGS: &[&str] = &[
    "stash",
    "show",
    "--no-color",
    "-z",
    "-u",
    "-M",
    "-C",
    "--find-copies-harder",
    "--no-textconv",
    "--no-ext-diff",
    "--name-status",
];
/// Identical to [`GIT_STASH_SHOW_NAME_STATUS_ARGS`] except for the trailing
/// format flag — mirrors `super::show_commit`'s own two-invocation
/// name-status/numstat pairing (`git diff` cannot emit both in one call).
pub(crate) const GIT_STASH_SHOW_NUMSTAT_ARGS: &[&str] = &[
    "stash",
    "show",
    "--no-color",
    "-z",
    "-u",
    "-M",
    "-C",
    "--find-copies-harder",
    "--no-textconv",
    "--no-ext-diff",
    "--numstat",
];

/// **Deliberately no `--quiet`** — see this module's own doc comment
/// ("`--quiet` silently swallows the `push`'s own `No local changes to
/// save`…") for why this domain's [`StashPushOutcome`] detection needs that
/// text to actually be present on stdout. Locked by
/// `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STASH_PUSH_ARGS: &[&str] = &["stash", "push"];
/// Locked by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STASH_PUSH_INCLUDE_UNTRACKED_ARGS: &[&str] =
    &["stash", "push", "--include-untracked"];
/// Locked by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STASH_APPLY_ARGS: &[&str] = &["stash", "apply"];
/// Locked by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STASH_APPLY_INDEX_ARGS: &[&str] = &["stash", "apply", "--index"];
/// Locked by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STASH_POP_ARGS: &[&str] = &["stash", "pop"];
/// Locked by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STASH_POP_INDEX_ARGS: &[&str] = &["stash", "pop", "--index"];
/// Locked by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_STASH_DROP_ARGS: &[&str] = &["stash", "drop"];

/// One `stash list` record. `index` is `%gd`'s own parsed `stash@{N}`
/// position — exposed for display only (e.g. rendering "#0"); no write
/// operation in this module ever accepts it back as an input (see this
/// module's own doc comment on sha-based addressing).
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StashEntry {
    pub(crate) index: u32,
    pub(crate) sha: String,
    pub(crate) committer_time: i64,
    pub(crate) message: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct StashList {
    pub(crate) entries: Vec<StashEntry>,
    /// `true` when more entries actually matched than were returned — the
    /// same "capped, not exhaustive" meaning this domain's other list
    /// results already carry.
    pub(crate) truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StashShowResult {
    pub(crate) sha: String,
    /// The stash entry's own base commit (`stash@{N}^1`, always the first of
    /// up to three parents — see this module's own module doc comment's
    /// verification that stash's parent order is always
    /// `[base, index?, untracked?]`) — `None` only when the base itself is a
    /// root commit (zero parents), mirroring `show_commit::ShowCommitResult`'s
    /// identical `parent_sha` convention.
    pub(crate) parent_sha: Option<String>,
    pub(crate) files: Vec<DiffFileEntry>,
}

#[derive(Debug)]
pub(crate) enum StashPushOutcome {
    Created,
    /// `git stash push`'s own "nothing to stash" outcome (confirmed
    /// empirically: exit `0`, stdout "No local changes to save") — not an
    /// error: an untracked-only working tree pushed without
    /// `include_untracked` legitimately has nothing a plain stash can save.
    NoLocalChanges,
}

/// Shared result shape for [`apply_stash`]/[`pop_stash`] — see this module's
/// own doc comment for why a bare sha is safe for `apply` but [`pop_stash`]
/// must still resolve its own `stash@{N}` internally. Whether the underlying
/// stash *entry* was itself removed afterward is not encoded here (it is
/// implied entirely by which function was called: `apply` never removes it,
/// `pop` removes it only on [`StashApplyOutcome::Applied`], never on
/// [`StashApplyOutcome::Conflict`] — confirmed empirically, this module's own
/// required control-group proof, `tests.rs`'s
/// `pop_stash_on_conflict_retains_the_stash_entry`).
#[derive(Debug)]
pub(crate) enum StashApplyOutcome {
    Applied,
    /// `conflicted_paths` is read back from a fresh `git status` call (via
    /// [`conflicted_paths_from_status`]) rather than parsed out of `apply`/
    /// `pop`'s own conflict output — reusing `super::status`'s already-audited
    /// porcelain-v2 parser instead of inventing a second, narrower one.
    Conflict {
        conflicted_paths: Vec<GitPathBuf>,
    },
}

/// Parses [`GIT_STASH_LIST_ARGS`]' NUL-record output into an ordered
/// [`StashEntry`] list, capping at `max_entries` + reporting `truncated`. See
/// this module's own doc comment for the full field-safety design this
/// implements.
fn parse_stash_list(output: &[u8], max_entries: usize) -> Result<StashList, CommandError> {
    let mut entries = Vec::new();
    for (position, record) in split_nul_records(output).into_iter().enumerate() {
        if record.is_empty() {
            continue;
        }
        let mut parts = record.splitn(4, |&byte| byte == 0x1f);
        let gd_bytes = parts.next().ok_or_else(git_stash_parse_failed)?;
        let sha_bytes = parts.next().ok_or_else(git_stash_parse_failed)?;
        let ct_bytes = parts.next().ok_or_else(git_stash_parse_failed)?;
        let message_bytes = parts.next().ok_or_else(git_stash_parse_failed)?;

        let gd_text = std::str::from_utf8(gd_bytes).map_err(|_| git_stash_parse_failed())?;
        let index: u32 = gd_text
            .strip_prefix("stash@{")
            .and_then(|rest| rest.strip_suffix('}'))
            .and_then(|digits| digits.parse().ok())
            .ok_or_else(git_stash_parse_failed)?;
        // Defensive: `%gd`'s own numbering must already match `stash list`'s
        // own emission order (newest first, `stash@{0}` first) — verified
        // rather than assumed, since every write operation in this module
        // resolves a sha to a `stash@{N}` string by trusting this exact
        // correspondence (see `resolve_stash_ref_by_sha`).
        if index as usize != position {
            return Err(git_stash_parse_failed());
        }

        if !is_lowercase_hex40(sha_bytes) {
            return Err(git_stash_parse_failed());
        }
        let sha = String::from_utf8(sha_bytes.to_vec()).expect("hex digits are ASCII");

        let committer_time: i64 = std::str::from_utf8(ct_bytes)
            .ok()
            .and_then(|text| text.parse().ok())
            .ok_or_else(git_stash_parse_failed)?;

        let message = String::from_utf8_lossy(message_bytes).into_owned();
        entries.push(StashEntry {
            index,
            sha,
            committer_time,
            message,
        });
    }
    let truncated = entries.len() > max_entries;
    if truncated {
        entries.truncate(max_entries);
    }
    Ok(StashList { entries, truncated })
}

/// Runs [`GIT_STASH_LIST_ARGS`] against an already-resolved `repo_dir` —
/// shared by [`list_stashes`] (the public, trust-checking entry point) and
/// [`resolve_stash_ref_by_sha`] (an internal re-query [`pop_stash`]/
/// [`drop_stash`] issue after they have already resolved trust/repo once of
/// their own).
async fn run_stash_list(repo_dir: &Path) -> Result<StashList, CommandError> {
    let mut args: Vec<String> = GIT_STASH_LIST_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.push(format!("--max-count={}", MAX_STASH_ENTRIES + 1));

    let repo_dir = repo_dir.to_path_buf();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        return Err(git_stash_list_failed());
    }
    parse_stash_list(&output.stdout, MAX_STASH_ENTRIES)
}

pub(crate) async fn list_stashes(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<StashList, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    run_stash_list(&repo_dir).await
}

/// Resolves `expected_sha` to a fresh `stash@{N}` reference — see this
/// module's own doc comment ("Sha-based addressing eliminates…") for why
/// [`pop_stash`]/[`drop_stash`] need this (unlike [`show_stash`]/
/// [`apply_stash`], which pass a bare sha straight to git). Fails closed with
/// [`git_stash_not_found`] if no entry in a **freshly re-queried** list
/// currently has this sha — never trusts a caller-supplied index.
async fn resolve_stash_ref_by_sha(
    repo_dir: &Path,
    expected_sha: &str,
) -> Result<String, CommandError> {
    let list = run_stash_list(repo_dir).await?;
    let entry = list
        .entries
        .iter()
        .find(|entry| entry.sha == expected_sha)
        .ok_or_else(git_stash_not_found)?;
    Ok(format!("stash@{{{}}}", entry.index))
}

/// `git log -1 -z --format=%P --no-patch <sha>` — `%P` is git's own computed,
/// fixed hex+space field (exactly like `show_commit::resolve_first_parent`'s
/// identical use of it), so no `%x1f`-style absorbing-field defense is
/// needed here; this module keeps its own independent copy of this small
/// resolution step rather than importing `show_commit`'s, per this
/// codebase's established per-domain-function duplication convention (see
/// this module's own doc comment for why the *existence* gate `show_commit`
/// needs before calling this is unnecessary here: by the time this is
/// called, `sha` has already been proven to name a real stash-like commit by
/// a successful `git stash show`).
async fn resolve_stash_parent_sha(
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
    let repo_dir = repo_dir.to_path_buf();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;
    if output.exit_code != 0 {
        return Err(git_stash_show_failed());
    }
    // `-z` replaces the usual trailing LF with a single trailing NUL and adds
    // no other separator — confirmed empirically (this slice's own report):
    // a multi-parent `%P` is exactly `"<sha1> <sha2> <sha3>\0"`, a
    // zero-parent (root) commit's is exactly `"\0"`.
    let trimmed = output.stdout.strip_suffix(b"\0").unwrap_or(&output.stdout);
    let first_parent = trimmed
        .split(|&byte| byte == b' ')
        .find(|field| !field.is_empty());
    match first_parent {
        None => Ok(None),
        Some(bytes) if is_lowercase_hex40(bytes) => Ok(Some(
            String::from_utf8(bytes.to_vec()).expect("hex digits are ASCII"),
        )),
        Some(_) => Err(git_stash_show_failed()),
    }
}

async fn run_stash_show_variant(
    repo_dir: &Path,
    sha: &str,
    base_args: &'static [&'static str],
) -> Result<Vec<u8>, CommandError> {
    let mut args: Vec<String> = base_args.iter().map(|arg| (*arg).to_owned()).collect();
    args.push(sha.to_owned());
    let repo_dir = repo_dir.to_path_buf();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;
    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("is not a stash-like commit")
            || stderr.contains("unknown revision")
            || stderr.contains("bad revision")
        {
            return Err(git_stash_not_found());
        }
        return Err(git_stash_show_failed());
    }
    Ok(output.stdout)
}

pub(crate) async fn show_stash(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    sha: &str,
) -> Result<StashShowResult, CommandError> {
    if !is_lowercase_hex40(sha.as_bytes()) {
        return Err(git_stash_not_found());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;

    let name_status_output =
        run_stash_show_variant(&repo_dir, sha, GIT_STASH_SHOW_NAME_STATUS_ARGS).await?;
    let numstat_output =
        run_stash_show_variant(&repo_dir, sha, GIT_STASH_SHOW_NUMSTAT_ARGS).await?;
    let name_status_entries = parse_name_status(&name_status_output)?;
    let numstat_entries = parse_numstat(&numstat_output)?;
    let files = merge_diff_files(name_status_entries, numstat_entries);

    let parent_sha = resolve_stash_parent_sha(&repo_dir, sha).await?;

    Ok(StashShowResult {
        sha: sha.to_owned(),
        parent_sha,
        files,
    })
}

fn combined_output_text(output: &GitExecOutput) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

pub(crate) async fn push_stash(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    message: &str,
    include_untracked: bool,
) -> Result<StashPushOutcome, CommandError> {
    if message.trim().is_empty() {
        return Err(git_stash_push_empty_message());
    }
    if message.len() > MAX_GIT_STASH_MESSAGE_BYTES {
        return Err(git_stash_push_message_too_large());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;

    let base_args: &[&str] = if include_untracked {
        GIT_STASH_PUSH_INCLUDE_UNTRACKED_ARGS
    } else {
        GIT_STASH_PUSH_ARGS
    };
    let mut args: Vec<String> = base_args.iter().map(|arg| (*arg).to_owned()).collect();
    args.push("-m".to_owned());
    args.push(message.to_owned());
    // See this module's own doc comment ("An explicit `-- .` pathspec is
    // required for `--include-untracked` to actually work under this
    // domain's own `GIT_LITERAL_PATHSPECS=1` hardening") — required
    // unconditionally, not only when `include_untracked` is set, for one
    // single code path rather than two subtly different ones.
    args.push("--".to_owned());
    args.push(".".to_owned());

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::Write, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        let combined = combined_output_text(&output);
        if combined.contains("You do not have the initial commit yet") {
            return Err(git_stash_push_no_initial_commit());
        }
        return Err(git_stash_push_failed());
    }
    let combined = combined_output_text(&output);
    if combined.contains("No local changes to save") {
        Ok(StashPushOutcome::NoLocalChanges)
    } else {
        Ok(StashPushOutcome::Created)
    }
}

/// Re-reads `git status` and extracts every currently-unmerged path — shared
/// by [`apply_stash`]/[`pop_stash`]'s own conflict reporting. Reuses
/// `super::status`'s already-audited porcelain-v2 parser (`parse_porcelain_v2`/
/// `GIT_STATUS_ARGS`) rather than trying to scrape a path list out of
/// `apply`/`pop`'s own free-text conflict output.
///
/// Deliberately calls [`resolve_repo_toplevel`]/[`run_git`] directly here
/// rather than `status::git_status` (`F220` S6 routes that entry point
/// through `remote_route` for a remote-backed root) — every caller of this
/// function has already resolved locally via its own, unrouted
/// `resolve_repo_toplevel` call (stash stays out of `F220` S6's routed
/// scope entirely, by design), so a second, independent local-only
/// resolution here is both correct and avoids threading
/// `GitNetworkService`/`RemoteSessionService` references through a code path
/// that can never actually reach a remote root.
async fn conflicted_paths_from_status(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<Vec<GitPathBuf>, CommandError> {
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
    let status = parse_porcelain_v2(&output.stdout)?;
    Ok(status
        .entries
        .into_iter()
        .filter_map(|entry| match entry {
            StatusEntry::Unmerged(unmerged) => Some(unmerged.path),
            _ => None,
        })
        .collect())
}

/// Interprets a completed `apply`/`pop` invocation's exit code/output into a
/// [`StashApplyOutcome`], or a structured error — shared by [`apply_stash`]/
/// [`pop_stash`]. `check_not_found` is `true` only for [`apply_stash`] (whose
/// `sha` is passed to git directly, unvalidated by a prior list lookup); a
/// generic-error and would-overwrite-error constructor are threaded through
/// per caller so each retains its own distinct, operation-specific error code
/// (mirrors `super::log::run_history_list`'s own `on_other_failure: fn() ->
/// CommandError` parameter for the identical "shared plumbing, distinct
/// per-caller error identity" shape).
async fn stash_apply_outcome_from_exec(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    output: GitExecOutput,
    check_not_found: bool,
    would_overwrite_err: fn() -> CommandError,
    generic_err: fn() -> CommandError,
) -> Result<StashApplyOutcome, CommandError> {
    if output.exit_code == 0 {
        return Ok(StashApplyOutcome::Applied);
    }
    let combined = combined_output_text(&output);
    if check_not_found
        && (combined.contains("is not a stash-like commit")
            || combined.contains("unknown revision")
            || combined.contains("bad revision")
            || combined.contains("is not a valid reference"))
    {
        return Err(git_stash_not_found());
    }
    if combined.contains("CONFLICT") {
        let conflicted_paths = conflicted_paths_from_status(trust, workspace, window_label).await?;
        return Ok(StashApplyOutcome::Conflict { conflicted_paths });
    }
    if combined.contains("would be overwritten by merge") {
        return Err(would_overwrite_err());
    }
    Err(generic_err())
}

pub(crate) async fn apply_stash(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    sha: &str,
    use_index: bool,
) -> Result<StashApplyOutcome, CommandError> {
    if !is_lowercase_hex40(sha.as_bytes()) {
        return Err(git_stash_not_found());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;

    let base_args: &[&str] = if use_index {
        GIT_STASH_APPLY_INDEX_ARGS
    } else {
        GIT_STASH_APPLY_ARGS
    };
    let mut args: Vec<String> = base_args.iter().map(|arg| (*arg).to_owned()).collect();
    args.push(sha.to_owned());

    let repo_dir_for_spawn = repo_dir.clone();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir_for_spawn, &args, GitExecMode::Write, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    stash_apply_outcome_from_exec(
        trust,
        workspace,
        window_label,
        output,
        true,
        git_stash_apply_would_overwrite,
        git_stash_apply_failed,
    )
    .await
}

pub(crate) async fn pop_stash(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    expected_sha: &str,
    use_index: bool,
) -> Result<StashApplyOutcome, CommandError> {
    if !is_lowercase_hex40(expected_sha.as_bytes()) {
        return Err(git_stash_not_found());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let stash_ref = resolve_stash_ref_by_sha(&repo_dir, expected_sha).await?;

    let base_args: &[&str] = if use_index {
        GIT_STASH_POP_INDEX_ARGS
    } else {
        GIT_STASH_POP_ARGS
    };
    let mut args: Vec<String> = base_args.iter().map(|arg| (*arg).to_owned()).collect();
    args.push(stash_ref);

    let repo_dir_for_spawn = repo_dir.clone();
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir_for_spawn, &args, GitExecMode::Write, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    stash_apply_outcome_from_exec(
        trust,
        workspace,
        window_label,
        output,
        false,
        git_stash_pop_would_overwrite,
        git_stash_pop_failed,
    )
    .await
}

pub(crate) async fn drop_stash(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    expected_sha: &str,
) -> Result<(), CommandError> {
    if !is_lowercase_hex40(expected_sha.as_bytes()) {
        return Err(git_stash_not_found());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let stash_ref = resolve_stash_ref_by_sha(&repo_dir, expected_sha).await?;

    let mut args: Vec<String> = GIT_STASH_DROP_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.push(stash_ref);

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::Write, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        return Err(git_stash_drop_failed());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
