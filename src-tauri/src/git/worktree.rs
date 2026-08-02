//! `git::worktree` — `F090` S5's worktree workflow (`docs/research/2026-07-26-git-history.md`'s
//! slice 6): [`list_worktrees`] is read-only (`GitExecMode::BackgroundRead`,
//! exactly like every other read in this domain — no new exec path);
//! [`add_worktree`]/[`remove_worktree`] are real writes (`GitExecMode::Write`,
//! exactly like `stage`/`commit`/`discard`/`stash`'s own write half).
//!
//! # `worktree add`'s destination authorization model — already adjudicated, implemented as directed
//!
//! Every other write command in this domain operates entirely inside the
//! single, already-authorized workspace root [`super::repo::resolve_repo_toplevel`]
//! resolves — `stage`/`commit`/`discard`/`stash push` never create a path
//! outside that root. `git worktree add <path>` is structurally different: it
//! must create a brand-new working tree at a filesystem location that is, in
//! the overwhelmingly common case, a *sibling* of the open repository, not
//! inside it. The frozen research doc's own "风险与未知项" flagged this as a
//! genuinely open architecture question and the lead session's own resolution
//! (recorded there, not re-litigated here) is implemented verbatim:
//!
//! - The destination's *parent* directory is never a caller-typed string —
//!   [`add_worktree`] always invokes the exact same native OS folder-picker
//!   dialog `workspace_pick_roots`/`theme::picker`'s own directory imports
//!   already use (`workspace::picker::DirectoryPicker`, injected generically
//!   exactly like `WorkspaceService::pick_roots_with_watch_sink`'s own
//!   `<P: DirectoryPicker>` shape), so the parent path this module ever
//!   touches is always one the operating system's own picker UI just handed
//!   back for *this specific call* — the same one-time, explicit,
//!   OS-mediated consent event opening a workspace root already gets.
//! - The destination's *leaf* segment is a single, caller-supplied path
//!   segment — never a caller-supplied path — validated through
//!   [`crate::path_policy::RelativePath::join_child`] (the exact function
//!   `docs/research/2026-07-26-git-history.md`'s frozen risk-item resolution
//!   names; this module reuses it rather than re-implementing a second
//!   segment validator), *after* first rejecting any segment containing a
//!   `/` itself (`join_child`'s own `parse_wire` would otherwise happily
//!   accept a multi-segment child like `"a/b"`, silently defeating the "one
//!   single-level subdirectory" framing the frozen decision is built on).
//! - The final filesystem mkdir this triggers is therefore always performed
//!   by the `git worktree add` subprocess itself, inside a directory that was
//!   *just* authorized by the native picker in this very call — mirroring
//!   this domain's other write commands' "write only inside an
//!   already-authorized root" posture rather than adding an exception to it.
//! - This module never lets the frontend round-trip a raw absolute parent
//!   path back to it across two separate IPC calls — the picker is invoked,
//!   consumed and discarded entirely inside [`add_worktree`]'s own single
//!   invocation, so there is no window where a compromised or buggy frontend
//!   could substitute an arbitrary path string the user never actually
//!   picked in the native dialog.
//!
//! # `worktree add [--detach] <path> [<commit-ish>]`'s exact target-collision behavior — empirically confirmed, one real deviation from the frozen plan's own open question
//!
//! The frozen plan's own risk item left git's exact behavior for "parent
//! exists, child segment does not" unverified. Confirmed empirically (this
//! slice's own report, real `git 2.50.1`):
//!
//! - Target does not exist at all (the overwhelmingly common case for this
//!   module's own authorization model, since the child segment is always
//!   validated *not* to already exist as anything the caller controls):
//!   succeeds.
//! - Target already exists as an **empty** directory: also succeeds — `git
//!   worktree add` tolerates a pre-existing empty directory at the exact
//!   target path.
//! - Target already exists as a **non-empty** directory, or as a plain file:
//!   both fail identically, `fatal: '<path>' already exists`, exit `128` —
//!   git's own stderr text does not distinguish the two, so
//!   [`git_worktree_add_target_exists`] does not attempt to either.
//! - **One genuine surprise, not anticipated by the frozen plan's own risk
//!   item**: if the target's *parent* directory chain does not exist yet
//!   either (e.g. `<picked-parent>/missing-intermediate/leaf`), `git worktree
//!   add` silently creates every missing intermediate directory itself,
//!   exactly like `mkdir -p`. This module's own authorization model never
//!   relies on or exercises this behavior (the destination is always
//!   `<picked-parent>/<one-validated-segment>`, and `<picked-parent>` is
//!   always confirmed to already exist and be a real directory before this
//!   module ever builds the target path — see [`add_worktree`]), so it is
//!   disclosed here as a documented fact about git's own behavior, not
//!   something this module's own safety story depends on.
//!
//! # A user-typed `<commit-ish>` needs an explicit `--` separator — a real, previously-undiscussed injection surface this slice found and closed
//!
//! Every other user-supplied string this domain has ever passed to git so far
//! either travels over stdin (`commit`'s message, exactly to dodge this
//! problem) or is always positioned *after* a repository-relative path this
//! module itself validated (`discard`/`stash push`'s `-- <path>`). An
//! optional `<commit-ish>` for `worktree add` is the first case in this
//! domain where an *entirely free-form, attacker-influenceable* string is
//! positioned as a bare trailing argument with **no** preceding literal path
//! argument to anchor `--` before it. Confirmed empirically (this slice's own
//! report) that this is a real, exploitable-shaped gap absent a fix: `git
//! worktree add <path> -not-a-real-flag` (no `--`) is misparsed by git's own
//! getopt-style option scanner as a run of short options (`error: unknown
//! switch `n'`, exit `129` — a parse error, not "invalid reference"), **not**
//! rejected as a bad revision the way a literal ref-lookup failure would be.
//! With an explicit `--` inserted immediately before both positional
//! arguments (`git worktree add --detach -- <path> <commit-ish>`), the exact
//! same hostile string is instead correctly treated as a plain positional
//! value and rejected by git's own revision resolution (`fatal: invalid
//! reference: -not-a-real-flag`, exit `128`) — the safe, structurally-correct
//! failure mode. [`GIT_WORKTREE_ADD_BASE_ARGS`] therefore always inserts a
//! literal `--` immediately before the target path, whether or not a
//! `commit_ish` is even supplied, so there is exactly one code path rather
//! than two subtly different ones (mirrors `stash::push_stash`'s own "append
//! the fix unconditionally, not only on the branch that needs it" discipline
//! for an analogous reason). [`add_worktree`] separately, defensively rejects
//! a `commit_ish` that itself starts with `-` *before* ever building the argv
//! (belt-and-suspenders on top of the `--` fix, not a substitute for it —
//! `tests.rs`'s
//! `raw_git_worktree_add_without_a_double_dash_separator_misparses_a_hyphen_prefixed_commit_ish_as_an_option`
//! is the required control-group proof this vulnerability is real absent the
//! `--`, contrasted with the production path's own safe rejection).
//!
//! # `worktree remove`'s three-way, not two-way, "why did this fail" split — one real gap in the frozen plan's own risk item
//!
//! The frozen plan's own command table anticipated exactly one failure mode
//! requiring special handling: a dirty (modified/untracked) linked worktree,
//! which needs a "probe without `--force`, confirm, retry with `--force`"
//! two-phase flow. Confirmed empirically (this slice's own report) that a
//! **locked** worktree is a genuinely distinct third state the frozen plan's
//! risk item did not anticipate: `git worktree remove <path>` on a locked
//! worktree fails with `fatal: cannot remove a locked working tree, lock
//! reason: <reason>` / `use 'remove -f -f' to override or unlock first`, exit
//! `128` — **a single `--force` does not help at all** here (re-running with
//! exactly one `--force` reproduces the identical failure verbatim; only
//! **two** repeated `--force` flags override a lock, per git's own listed
//! remedy). This module deliberately does **not** escalate to `--force
//! --force` automatically on this path — doing so would silently override a
//! lock some other tool or the user themself deliberately set, with no
//! explicit "yes, override the lock" confirmation surface this slice's own
//! frozen scope was ever asked to design. [`remove_worktree`] instead surfaces
//! [`git_worktree_remove_locked`] as its own distinct, structured outcome —
//! the caller sees a clear "this worktree is locked" message rather than
//! either a silent double-force override or an opaque generic failure,
//! disclosed here as a deliberate scope narrowing (unlocking a worktree is
//! not implemented by this slice) rather than an oversight.
//!
//! Removing the *main* working tree (`fatal: '<path>' is a main working tree`,
//! exit `128`) is a fourth, structurally-unreachable-in-practice case this
//! module still maps defensively (`git_worktree_remove_is_main_worktree`):
//! [`list_worktrees`]' own `is_main` field lets a caller exclude the main
//! entry from anything offered as removable in the first place, but this
//! module does not *trust* the caller to have done so.
//!
//! # An arbitrary/hostile `path` can never destroy unrelated data — a structural guarantee, verified rather than assumed
//!
//! [`remove_worktree`] takes a plain path string and passes it straight
//! through to `git worktree remove -- <path>` with no independent
//! pre-verification against a fresh [`list_worktrees`] call (unlike
//! `stash::pop_stash`/`drop_stash`'s own mandatory sha-based re-resolution —
//! see that module's own doc comment for why *its* problem, a numeric index
//! that can drift after a concurrent drop, has no equivalent here: a
//! filesystem path is never subject to an analogous "shift" the way a
//! `stash@{N}` ordinal is). This is safe *because* `git worktree remove`
//! itself refuses to touch any path it does not already recognize as one of
//! *this exact repository's own* registered worktrees — confirmed
//! empirically (this slice's own report; `tests.rs`'s
//! `remove_worktree_on_a_path_that_is_not_a_registered_worktree_is_safely_refused_not_silently_destructive`
//! is the required control-group proof): pointing it at a real, populated,
//! entirely unrelated directory that happens to exist on disk produces
//! `fatal: '<path>' is not a working tree`, exit `128`, and **the directory
//! and its contents are left completely untouched** — there is no scenario
//! this module's own code needs to guard against beyond what git's own
//! worktree registry already refuses on its own.
//!
//! # `-c core.quotePath=false` is unnecessary for `worktree list --porcelain -z` — confirmed empirically, closing `F090` S4's own disclosed gap
//!
//! `F090` S4's own module doc comment recorded an unverified, ad hoc manual
//! observation ("S5 实施时应重新用真实 fixture 验证而非直接采信这条记录") that
//! `git worktree list --porcelain -z` behaves like `stash show` rather than
//! like `blame` with respect to `core.quotePath`. This slice formally
//! confirms that observation with a real fixture and a byte-for-byte
//! control-group comparison rather than merely repeating it: a real worktree
//! created at a path containing both non-ASCII bytes and an emoji
//! (`分支-🎉`) comes back **byte-identical** from `git worktree list
//! --porcelain -z` whether or not `-c core.quotePath=false` is also passed —
//! `tests.rs`'s
//! `worktree_list_path_quoting_is_unaffected_by_core_quote_path` is the
//! control-group test. [`GIT_WORKTREE_LIST_ARGS`] therefore carries no
//! `-c core.quotePath=...` override at all, exactly like
//! [`super::stash::GIT_STASH_SHOW_NAME_STATUS_ARGS`].
//!
//! # Block separator: confirmed double-`NUL`, not a bare LF-based scheme
//!
//! `git worktree list --porcelain -z` emits each worktree's own fields
//! individually `NUL`-terminated (`worktree <path>\0HEAD <sha>\0branch
//! <ref>\0`, …), and terminates *each whole block* with one additional, bare
//! `NUL` beyond its own last field's terminator — confirmed empirically by
//! `xxd`-level inspection of a real multi-worktree fixture (this slice's own
//! report), exactly matching the frozen plan's own "`-z` 让块间分隔符从空行变为
//! 双 NUL" claim. [`parse_worktree_blocks`] recovers this by reusing
//! [`super::wire::split_nul_records`] (splitting the *entire* output on a
//! single `NUL` first, which turns each block's own trailing "extra" `NUL`
//! into one literal empty-byte-string record between blocks) and then
//! grouping the resulting flat record list on those empty-string markers —
//! not a second, bespoke double-`NUL` byte scanner.
//!
//! # `GIT_LITERAL_PATHSPECS=1` (this domain's own universal hardening) does not affect any of this module's three commands — confirmed individually, not assumed by analogy
//!
//! Per the `⚠ 跨切片必读` note this feature's own frozen research doc carries
//! (`F090` S4's own real, costly discovery that this exact universal
//! hardening silently half-breaks `stash push --include-untracked`), every
//! new command this domain adds must be individually checked against it, in a
//! real hardened environment, rather than assumed safe by analogy. Confirmed
//! empirically for all three commands here (this slice's own report,
//! `tests.rs`'s
//! `worktree_add_list_and_remove_behavior_is_unaffected_by_git_literal_pathspecs`
//! is the required real-environment control-group proof): a worktree path
//! segment containing literal glob-magic characters (`a*b`) round-trips
//! identically through `add`/`list`/`remove` whether or not
//! `GIT_LITERAL_PATHSPECS=1` is set. This is the expected outcome, not a
//! coincidence — `<path>` for `worktree add`/`remove` is documented by git
//! itself as a plain filesystem path, never parsed through the pathspec
//! machinery `GIT_LITERAL_PATHSPECS` governs at all (unlike, say,
//! `discard`/`stash push`'s own repository-relative path arguments, which
//! *are* pathspecs), and `for-each-ref`-style ref-pattern matching (the other
//! thing this hardening variable does not touch, per `refs.rs`'s own doc
//! comment) is not involved here either.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::path_policy::RelativePath;
use crate::trust::service::TrustService;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerResult};

use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};
use super::wire::{split_nul_records, GitPathBuf};

/// Mirrors `log::is_lowercase_hex40`/`refs::is_lowercase_hex40`/
/// `stash::is_lowercase_hex40` — this module's own independent copy, per this
/// codebase's established per-domain-function duplication convention.
fn is_lowercase_hex40(bytes: &[u8]) -> bool {
    bytes.len() == 40
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

/// The literal 40-character all-zero sha `git` itself uses for an unborn
/// `HEAD` (a worktree whose branch has never had a commit) — confirmed
/// empirically (this slice's own report) against a real freshly-`git init`ed
/// repository's own main worktree entry.
const UNBORN_HEAD_SHA: &[u8] = b"0000000000000000000000000000000000000000";

/// Defensive ceiling on how many worktree entries a single [`list_worktrees`]
/// call ever returns — mirrors `stash::MAX_STASH_ENTRIES`/
/// `refs::MAX_REF_ENTRIES`'s identical "bound a pathological response size"
/// rationale for this domain. Unlike those two, `git worktree list` has no
/// `--count`/`--max-count`-style flag of its own to bound the *git-side* work
/// (confirmed by `git worktree list -h`); this ceiling is applied entirely
/// client-side, after parsing every block git actually returned — acceptable
/// because, unlike a commit/ref history, the number of worktrees a real
/// repository ever has is small in practice (this is a defensive ceiling
/// against a pathological/hostile registry, not a real-world scaling need).
const MAX_WORKTREE_ENTRIES: usize = 10_000;

/// Defensive ceiling on a `worktree add` `commit_ish` argument's byte length
/// — mirrors `dto::MAX_GIT_COMMIT_MESSAGE_BYTES`'s rationale for a
/// differently-shaped, but similarly user-typed, string field.
const MAX_WORKTREE_COMMIT_ISH_BYTES: usize = 4_096;

fn git_worktree_list_failed() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_LIST_FAILED",
        "git worktree list did not complete successfully.",
    )
}

fn git_worktree_list_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_LIST_PARSE_FAILED",
        "The git worktree list output could not be parsed.",
    )
}

fn git_worktree_add_invalid_child_segment() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_INVALID_CHILD_SEGMENT",
        "The new worktree's folder name is empty, too long, or contains an invalid character.",
    )
}

fn git_worktree_add_invalid_commit_ish() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_INVALID_COMMIT_ISH",
        "The requested branch, tag or commit is empty, too long, or begins with '-'.",
    )
}

fn git_worktree_add_parent_unavailable() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_PARENT_UNAVAILABLE",
        "The chosen parent folder could not be opened, or is not a folder.",
    )
}

fn git_worktree_add_path_not_utf8() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_PATH_NOT_UTF8",
        "The new worktree's full path is not valid UTF-8.",
    )
}

/// `git worktree add`'s own "target already exists" outcome — see this
/// module's own doc comment for why a pre-existing non-empty directory and a
/// pre-existing plain file both map here (git's own stderr text does not
/// distinguish the two).
fn git_worktree_add_target_exists() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_TARGET_EXISTS",
        "The new worktree's target folder already exists and is not empty.",
    )
}

/// `git worktree add`'s own "that branch is already checked out in another
/// worktree" outcome (confirmed empirically: `fatal: '<branch>' is already
/// used by worktree at '<path>'`, exit `128`) — surfaced as its own
/// structured code so a caller can suggest `--detach` rather than an opaque
/// failure.
fn git_worktree_add_branch_in_use() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_BRANCH_IN_USE",
        "That branch is already checked out in another worktree.",
    )
}

/// `git worktree add`'s own "that is not a valid branch, tag or commit"
/// outcome (confirmed empirically: `fatal: invalid reference: <commit-ish>`,
/// exit `128`).
fn git_worktree_add_invalid_reference() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_INVALID_REFERENCE",
        "The requested branch, tag or commit does not exist.",
    )
}

fn git_worktree_add_failed() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_ADD_FAILED",
        "git worktree add did not complete successfully.",
    )
}

fn git_worktree_remove_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_REMOVE_INVALID_REQUEST",
        "The worktree path is empty or too long.",
    )
}

/// `git worktree remove`'s own "cannot remove a locked working tree" outcome
/// — see this module's own doc comment ("worktree remove's three-way…") for
/// why this is a distinct, non-`--force`-recoverable-once outcome this slice
/// deliberately does not auto-escalate to `--force --force`.
fn git_worktree_remove_locked() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_REMOVE_LOCKED",
        "This worktree is locked and must be unlocked before it can be removed.",
    )
}

/// `git worktree remove`'s own "that is the main working tree" outcome —
/// defensive; see this module's own doc comment for why this should be
/// structurally unreachable from a well-behaved caller.
fn git_worktree_remove_is_main_worktree() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_REMOVE_IS_MAIN_WORKTREE",
        "The main worktree cannot be removed.",
    )
}

/// `git worktree remove`'s own "that is not a registered worktree of this
/// repository" outcome — see this module's own doc comment ("An
/// arbitrary/hostile path can never destroy unrelated data") for why this is
/// git's own safety net, not a check this module performs itself.
fn git_worktree_remove_not_found() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_REMOVE_NOT_FOUND",
        "That path is not a registered worktree of this repository.",
    )
}

fn git_worktree_remove_failed() -> CommandError {
    CommandError::new(
        "GIT_WORKTREE_REMOVE_FAILED",
        "git worktree remove did not complete successfully.",
    )
}

/// The exact, audited `worktree list` argument list — see this module's own
/// doc comment for why no `-c core.quotePath=...` override is needed. Locked
/// by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_WORKTREE_LIST_ARGS: &[&str] = &["worktree", "list", "--porcelain", "-z"];

/// The exact, audited `worktree add` argument prefix — always includes a
/// literal `--` immediately before the target path, whether or not a
/// `commit_ish` is supplied (see this module's own doc comment, "A
/// user-typed `<commit-ish>` needs an explicit `--` separator"). `--detach`
/// is appended by [`add_worktree`] only when requested; the target path (and
/// optional `commit_ish`) are appended after this constant's own elements.
/// Locked by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_WORKTREE_ADD_BASE_ARGS: &[&str] = &["worktree", "add"];

/// Locked by `scripts/plain/boundary-contracts.mjs`.
pub(crate) const GIT_WORKTREE_REMOVE_ARGS: &[&str] = &["worktree", "remove"];

/// Which of `refs/heads/<name>` (attached), a detached commit, or a bare
/// repository's own administrative worktree a [`WorktreeEntry`] currently has
/// checked out.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum WorktreeHeadState {
    Branch {
        ref_name: GitPathBuf,
    },
    Detached,
    /// The main worktree entry of a bare repository (no `HEAD` line at all in
    /// `git worktree list`'s own output) — see this module's own doc comment
    /// for why this is structurally unreachable via [`super::repo::resolve_repo_toplevel`]
    /// in practice (a bare repository never resolves a working-tree
    /// toplevel), tolerated here defensively rather than assumed impossible.
    Bare,
}

/// One `git worktree list --porcelain -z` block. `locked_reason`/
/// `prunable_reason` are `None` for "not locked"/"not prunable" and
/// `Some(reason)` (possibly an empty string, when git itself recorded no
/// reason text) when they are — mirrors `refs::RefEntry::upstream`'s own
/// `Option`, never an empty-string sentinel, convention.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorktreeEntry {
    /// The worktree's own absolute filesystem path, exactly as git reports
    /// it — see [`super::wire::GitPathBuf`]'s own doc comment for why this is
    /// byte-modeled rather than assumed UTF-8.
    pub(crate) path: GitPathBuf,
    /// `None` only for a genuinely unborn `HEAD` (see [`UNBORN_HEAD_SHA`]) or
    /// for [`WorktreeHeadState::Bare`] (no `HEAD` line at all).
    pub(crate) head_sha: Option<String>,
    pub(crate) head_state: WorktreeHeadState,
    pub(crate) locked_reason: Option<String>,
    pub(crate) prunable_reason: Option<String>,
    /// `true` for exactly the first entry `git worktree list` ever returns —
    /// confirmed empirically (this slice's own report) that git always lists
    /// the main worktree first, regardless of which worktree the command is
    /// actually invoked from.
    pub(crate) is_main: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct WorktreeList {
    pub(crate) entries: Vec<WorktreeEntry>,
    pub(crate) truncated: bool,
}

#[derive(Debug)]
pub(crate) enum WorktreeAddOutcome {
    Added {
        path: String,
    },
    /// The native folder picker was dismissed without a selection — not an
    /// error, mirrors `workspace::dto::WorkspacePickRootsResult`'s own
    /// cancellation modeling for the same real user gesture.
    PickerCancelled,
}

#[derive(Debug)]
pub(crate) enum WorktreeRemoveOutcome {
    Removed,
    /// The worktree has modified/untracked content — see this module's own
    /// doc comment for the required "probe without `--force`, confirm, retry
    /// with `--force`" two-phase caller flow this outcome exists to drive.
    NeedsForce,
}

/// Splits [`super::wire::split_nul_records`]'s flat record list into one
/// `Vec` per worktree block, on the empty-string markers each block's own
/// extra trailing `NUL` produces — see this module's own doc comment ("Block
/// separator") for the full byte-level derivation.
fn parse_worktree_blocks<'a>(records: &'a [&'a [u8]]) -> Vec<Vec<&'a [u8]>> {
    records
        .split(|record| record.is_empty())
        .filter(|group| !group.is_empty())
        .map(|group| group.to_vec())
        .collect()
}

fn parse_worktree_entry(fields: &[&[u8]]) -> Result<WorktreeEntry, CommandError> {
    let mut iter = fields.iter();
    let first = iter.next().ok_or_else(git_worktree_list_parse_failed)?;
    let path_bytes = first
        .strip_prefix(b"worktree ")
        .ok_or_else(git_worktree_list_parse_failed)?;
    let path = GitPathBuf::from_bytes(path_bytes.to_vec());

    let mut head_sha: Option<String> = None;
    let mut head_state: Option<WorktreeHeadState> = None;
    let mut locked_reason: Option<String> = None;
    let mut prunable_reason: Option<String> = None;

    for field in iter {
        if let Some(rest) = field.strip_prefix(b"HEAD ") {
            if !is_lowercase_hex40(rest) {
                return Err(git_worktree_list_parse_failed());
            }
            if rest != UNBORN_HEAD_SHA {
                head_sha = Some(String::from_utf8(rest.to_vec()).expect("hex digits are ASCII"));
            }
        } else if let Some(rest) = field.strip_prefix(b"branch ") {
            head_state = Some(WorktreeHeadState::Branch {
                ref_name: GitPathBuf::from_bytes(rest.to_vec()),
            });
        } else if *field == b"detached" {
            head_state = Some(WorktreeHeadState::Detached);
        } else if *field == b"bare" {
            head_state = Some(WorktreeHeadState::Bare);
        } else if *field == b"locked" {
            locked_reason = Some(String::new());
        } else if let Some(rest) = field.strip_prefix(b"locked ") {
            locked_reason = Some(String::from_utf8_lossy(rest).into_owned());
        } else if *field == b"prunable" {
            prunable_reason = Some(String::new());
        } else if let Some(rest) = field.strip_prefix(b"prunable ") {
            prunable_reason = Some(String::from_utf8_lossy(rest).into_owned());
        } else {
            return Err(git_worktree_list_parse_failed());
        }
    }

    let head_state = head_state.ok_or_else(git_worktree_list_parse_failed)?;
    Ok(WorktreeEntry {
        path,
        head_sha,
        head_state,
        locked_reason,
        prunable_reason,
        is_main: false,
    })
}

/// Parses [`GIT_WORKTREE_LIST_ARGS`]' `-z` output into an ordered
/// [`WorktreeList`], capping at `max_entries` and reporting `truncated` —
/// mirrors `stash::parse_stash_list`/`refs::parse_refs`'s identical shape.
pub(crate) fn parse_worktree_list(
    output: &[u8],
    max_entries: usize,
) -> Result<WorktreeList, CommandError> {
    let records = split_nul_records(output);
    let blocks = parse_worktree_blocks(&records);
    let mut entries = Vec::with_capacity(blocks.len());
    for (index, block) in blocks.iter().enumerate() {
        let mut entry = parse_worktree_entry(block)?;
        entry.is_main = index == 0;
        entries.push(entry);
    }
    let truncated = entries.len() > max_entries;
    if truncated {
        entries.truncate(max_entries);
    }
    Ok(WorktreeList { entries, truncated })
}

pub(crate) async fn list_worktrees(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<WorktreeList, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let args: Vec<String> = GIT_WORKTREE_LIST_ARGS
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
        return Err(git_worktree_list_failed());
    }
    parse_worktree_list(&output.stdout, MAX_WORKTREE_ENTRIES)
}

/// Validates `segment` as a genuinely single-level path segment and returns
/// it re-parsed as a [`RelativePath`] — see this module's own doc comment for
/// why the `contains('/')` check must happen *before* ever calling
/// [`RelativePath::join_child`] (which would otherwise happily accept a
/// multi-segment child, silently defeating the "one single-level
/// subdirectory" authorization model this function exists to enforce).
fn validate_worktree_child_segment(segment: &str) -> Result<RelativePath, CommandError> {
    if segment.is_empty() || segment.contains('/') {
        return Err(git_worktree_add_invalid_child_segment());
    }
    let root = RelativePath::parse_wire("").expect("the empty wire path is always the root");
    root.join_child(segment)
        .map_err(|_| git_worktree_add_invalid_child_segment())
}

/// Defensive validation for a caller-supplied `commit_ish` — see this
/// module's own doc comment ("A user-typed `<commit-ish>` needs an explicit
/// `--` separator") for why the leading-`-` rejection here is
/// belt-and-suspenders on top of, not a substitute for, the mandatory literal
/// `--` [`GIT_WORKTREE_ADD_BASE_ARGS`]'s own caller always inserts.
fn validate_worktree_commit_ish(commit_ish: &str) -> Result<(), CommandError> {
    if commit_ish.is_empty()
        || commit_ish.starts_with('-')
        || commit_ish.len() > MAX_WORKTREE_COMMIT_ISH_BYTES
    {
        return Err(git_worktree_add_invalid_commit_ish());
    }
    Ok(())
}

fn combined_output_text(stdout: &[u8], stderr: &[u8]) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    )
}

/// See this module's own doc comment for the full authorization model this
/// implements. `picker` is generic over [`DirectoryPicker`] exactly like
/// `WorkspaceService::pick_roots_with_watch_sink`'s own shape, so a real
/// Tauri command supplies `workspace::picker::TauriDirectoryPicker` and a
/// test supplies a fake.
pub(crate) async fn add_worktree<P: DirectoryPicker>(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    picker: &P,
    child_segment: &str,
    detach: bool,
    commit_ish: Option<&str>,
) -> Result<WorktreeAddOutcome, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let relative_child = validate_worktree_child_segment(child_segment)?;
    if let Some(commit_ish) = commit_ish {
        validate_worktree_commit_ish(commit_ish)?;
    }

    let selection = picker.pick_directories(false).await?;
    let parent = match selection {
        DirectoryPickerResult::Cancelled => return Ok(WorktreeAddOutcome::PickerCancelled),
        DirectoryPickerResult::Selected(paths) => paths
            .into_iter()
            .next()
            .ok_or_else(git_worktree_add_parent_unavailable)?,
    };
    let canonical_parent =
        std::fs::canonicalize(&parent).map_err(|_| git_worktree_add_parent_unavailable())?;
    if !canonical_parent.is_dir() {
        return Err(git_worktree_add_parent_unavailable());
    }

    let target: PathBuf = canonical_parent.join(relative_child.as_path());
    let target_str = target
        .to_str()
        .ok_or_else(git_worktree_add_path_not_utf8)?
        .to_owned();

    let mut args: Vec<String> = GIT_WORKTREE_ADD_BASE_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    if detach {
        args.push("--detach".to_owned());
    }
    args.push("--".to_owned());
    args.push(target_str.clone());
    if let Some(commit_ish) = commit_ish {
        args.push(commit_ish.to_owned());
    }

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::Write, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        let combined = combined_output_text(&output.stdout, &output.stderr);
        if combined.contains("already exists") {
            return Err(git_worktree_add_target_exists());
        }
        if combined.contains("is already used by worktree") {
            return Err(git_worktree_add_branch_in_use());
        }
        if combined.contains("invalid reference") {
            return Err(git_worktree_add_invalid_reference());
        }
        return Err(git_worktree_add_failed());
    }
    Ok(WorktreeAddOutcome::Added { path: target_str })
}

/// See this module's own doc comment for the full three-way (clean / dirty /
/// locked) outcome split this implements, and for why an arbitrary `path` is
/// safe to pass straight through to git without an independent
/// re-verification step. `force` is `true` only on the caller's own,
/// already-confirmed retry after a first, unforced attempt returned
/// [`WorktreeRemoveOutcome::NeedsForce`] — this function itself never decides
/// to escalate.
pub(crate) async fn remove_worktree(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    path: &str,
    force: bool,
) -> Result<WorktreeRemoveOutcome, CommandError> {
    if path.is_empty() {
        return Err(git_worktree_remove_invalid_request());
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;

    let mut args: Vec<String> = GIT_WORKTREE_REMOVE_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    if force {
        args.push("--force".to_owned());
    }
    args.push("--".to_owned());
    args.push(path.to_owned());

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::Write, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code == 0 {
        return Ok(WorktreeRemoveOutcome::Removed);
    }
    let combined = combined_output_text(&output.stdout, &output.stderr);
    if !force && combined.contains("contains modified or untracked files") {
        return Ok(WorktreeRemoveOutcome::NeedsForce);
    }
    if combined.contains("cannot remove a locked working tree") {
        return Err(git_worktree_remove_locked());
    }
    if combined.contains("is a main working tree") {
        return Err(git_worktree_remove_is_main_worktree());
    }
    if combined.contains("is not a working tree") {
        return Err(git_worktree_remove_not_found());
    }
    Err(git_worktree_remove_failed())
}

#[cfg(test)]
mod tests;
