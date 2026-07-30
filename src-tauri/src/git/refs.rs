//! `git::refs` — `F090` S3's read-only branches/tags/remotes listing
//! (`for-each-ref`; slice 4 of `docs/research/2026-07-26-git-history.md`).
//! Feeds both the refs sidebar and the graph view's per-node ref badges (the
//! latter joined entirely client-side, by comparing [`RefEntry::target_sha`]/
//! [`RefEntry::peeled_sha`] against a graph node's own sha — see
//! [`super::log`]'s module doc comment for why no `%d`/`%D` decoration
//! parsing is ever used for that join).
//!
//! # Format-string safety: every field here is NUL-free *by construction*, unlike `log`'s commit metadata
//!
//! [`super::log`]'s commit-metadata commands need real care (a single
//! absorbing free-text field, positioned last) because `%an`/`%s`/`%B` are
//! attacker-controlled *content* a hostile contributor's own commit can stuff
//! arbitrary bytes into — including the very separator byte (`0x1f`) those
//! commands' own format strings use (see that module's own doc comment).
//! [`GIT_FOR_EACH_REF_ARGS`] has **no such field at all**: every one of its
//! six `%(...)` placeholders is either a fixed-shape, git-computed value
//! (`%(objecttype)` is one of a small closed enum; `%(objectname)`/
//! `%(*objectname)` are always exactly 40 lowercase hex characters;
//! `%(HEAD)` is always exactly `"*"` or `" "`) or a **ref name**
//! (`%(refname)`/`%(upstream)`) — and git's own ref-name grammar
//! (`git-check-ref-format(1)`) unconditionally forbids every ASCII control
//! byte (any byte `< 0x20`) anywhere in a ref name, which includes **both**
//! `0x00` (this format string's own field separator, written as the literal
//! `%00` below) and `0x1f` (the separator this domain's `log`/`blame`
//! commands must instead work around). Confirmed empirically, as a real
//! control group rather than an assumption (`tests.rs`'s
//! `a_ref_name_containing_the_unit_separator_or_a_nul_byte_is_impossible_to_construct_confirming_the_delimiter_is_structurally_unreachable`):
//! attempting to `git update-ref` a ref whose name contains a literal `0x1f`
//! byte fails outright (`fatal: ... refusing to update ref with bad name`,
//! exit 128) — the exact same rejection `git check-ref-format` itself gives
//! that byte directly — and a literal NUL byte cannot even be *encoded* as a
//! single process argument at all (attempting it raises before a process is
//! even spawned). This is a **structural** safety property of this specific
//! command's field set (multi-field-safe by construction), not the "single
//! absorbing field" workaround `log`/`blame` need for their own,
//! genuinely-attacker-reachable free-text fields — [`parse_refs`] therefore
//! splits every record into all six fields directly (no `splitn`/"absorb the
//! remainder" trick needed), and still separately validates the fixed-shape
//! fields' exact expected shape (hex40, `"tag"`/anything-else, `"*"`/`" "`)
//! defensively, rather than assuming the impossible-by-grammar cases are the
//! *only* things that could ever appear there.
//!
//! Ref names themselves **can** still legally contain non-ASCII bytes (and
//! several ASCII punctuation characters most callers would not expect —
//! confirmed empirically against a real branch named
//! `weird,name"with#stuff$and%percent`, alongside a real non-ASCII/emoji
//! branch name), so [`RefEntry::full_name`]/[`RefEntry::short_name`]/
//! [`RefEntry::upstream`] are still modeled as [`GitPathBuf`] (arbitrary
//! bytes, not assumed-UTF-8 `String`) — the same "byte-safe, not
//! UTF-8-assumed" discipline this domain's path fields already use, applied
//! here to ref names instead of paths, per this slice's own mandate that ref
//! names are an equally attacker-influenceable byte string.
//!
//! # No `-c core.quotePath=false` — confirmed empirically unlike `blame`
//!
//! [`super::blame`]'s own module doc comment establishes that
//! `core.quotePath=false` is *necessary* (though not sufficient on its own)
//! for `git blame`'s `filename`/`previous` path fields to come back
//! unescaped. `for-each-ref`'s `%(refname)` is **not** a path in that sense
//! at all, and `core.quotePath` does not apply to it: confirmed empirically
//! (this slice's own report) that a real non-ASCII branch name
//! (`分支-emoji-🎉`) comes back **byte-identical**, raw and unquoted, from
//! `git for-each-ref --format='%(refname)'` whether or not `-c
//! core.quotePath=false` is also passed — `tests.rs`'s
//! `for_each_ref_refname_output_is_unaffected_by_core_quote_path_confirming_it_never_applies_to_ref_names`
//! reproduces both invocations side by side and asserts they are identical,
//! the control-group half of this finding (the other half already being
//! this module's very existence: if quoting *did* apply and needed
//! suppressing, dropping the flag entirely — as this module does — would be
//! the wrong, undisclosed choice). [`GIT_FOR_EACH_REF_ARGS`] therefore has no
//! `-c core.quotePath=...` override at all, unlike [`super::blame::GIT_BLAME_BASE_ARGS`].
//!
//! # Record separator: plain LF, not `-z`
//!
//! `for-each-ref` has no `-z`/NUL-record-terminator option at all (confirmed
//! by `git for-each-ref -h`); its records are always LF-terminated. This is
//! safe for exactly the reason the intra-record fields above are: a ref name
//! can never legally contain a literal LF (also `< 0x20`), so a plain
//! `output.split(|&b| b == b'\n')` can never split a real field in half —
//! mirroring [`super::blame::parse_line_porcelain`]'s own identical
//! "LF-splitting is safe here because this format's fields are
//! grammar-guaranteed LF-free" reasoning, independently re-derived for this
//! module's own, differently-shaped format.
//!
//! # Annotated vs. lightweight tags, and the `refs/stash`/`--all` scope decision
//!
//! `%(objecttype)` distinguishes the two: `"tag"` for a real, independent tag
//! *object* (an annotated tag — `%(*objectname)` then gives the commit it
//! ultimately points at), `"commit"` for a lightweight tag (a plain ref
//! pointing directly at a commit, `%(*objectname)` then empty) — confirmed
//! empirically against both a real `git tag -a`/`git tag` pair in the same
//! fixture repository (`tests.rs`'s
//! `list_refs_distinguishes_an_annotated_tag_from_a_lightweight_tag`).
//! [`GIT_FOR_EACH_REF_ARGS`]' three explicit patterns
//! (`refs/heads`/`refs/tags`/`refs/remotes`) are the same deliberate,
//! `refs/stash`-excluding scope [`super::log::GIT_LOG_GRAPH_ARGS`] uses (see
//! that constant's own doc comment) — confirmed empirically here too
//! (`tests.rs`'s `list_refs_excludes_a_real_stash_entry`).

use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::resolve_repo_toplevel;
use super::wire::GitPathBuf;

/// The exact, audited `for-each-ref` argument list — locked by
/// `scripts/plain/boundary-contracts.mjs`'s
/// `validateGitRefsFieldSafetyBoundary`. See this module's own doc comment
/// for the full field-safety rationale (why `%00` is safe here without the
/// "single absorbing field" workaround `log`/`blame` need) and for why
/// `refs/stash` is deliberately excluded.
pub(crate) const GIT_FOR_EACH_REF_ARGS: &[&str] = &[
    "for-each-ref",
    "--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objectname)%00%(upstream)%00%(HEAD)",
    "refs/heads",
    "refs/tags",
    "refs/remotes",
];

/// Defensive ceiling on how many refs a single [`list_refs`] call ever
/// returns — mirrors [`super::log::MAX_HISTORY_ENTRIES`]'s identical "bound a
/// pathological response size" rationale for this domain.
const MAX_REF_ENTRIES: usize = 10_000;

fn git_refs_list_failed() -> CommandError {
    CommandError::new(
        "GIT_REFS_LIST_FAILED",
        "git for-each-ref did not complete successfully.",
    )
}

fn git_refs_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_REFS_PARSE_FAILED",
        "The git for-each-ref output could not be parsed.",
    )
}

/// Mirrors `log::is_lowercase_hex40`/`blame::is_lowercase_hex40` — this
/// module's own independent copy, per this codebase's established
/// per-domain-function duplication convention.
fn is_lowercase_hex40(bytes: &[u8]) -> bool {
    bytes.len() == 40
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

/// Which of the three requested namespaces a [`RefEntry`] came from — derived
/// from which of `refs/heads/`/`refs/tags/`/`refs/remotes/` its own
/// `%(refname)` was prefixed with (see [`classify_ref_name`]), never from a
/// separate query.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RefGroupKind {
    Branch,
    RemoteBranch,
    Tag,
}

/// One `for-each-ref` record. `peeled_sha`/`is_annotated_tag` are only ever
/// meaningfully populated together (see this module's own doc comment's
/// "Annotated vs. lightweight tags" section); `upstream` is `None` for both
/// "no upstream configured" and "not a local branch at all" — this command
/// never distinguishes those two (a caller already knows `kind` for the
/// latter).
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RefEntry {
    pub(crate) kind: RefGroupKind,
    /// The full ref path, e.g. `refs/heads/main` — see this module's own doc
    /// comment for why this is [`GitPathBuf`], not `String`.
    pub(crate) full_name: GitPathBuf,
    /// `full_name` with its matched `refs/heads/`/`refs/tags/`/
    /// `refs/remotes/` prefix stripped, e.g. `main` — computed here, not via
    /// git's own `%(refname:short)` (whose own abbreviation rules are a
    /// separate, less-predictable convention this command does not need).
    pub(crate) short_name: GitPathBuf,
    /// `%(objectname)` — the ref's own target object id (a commit for a
    /// branch/lightweight tag, the tag object itself for an annotated tag).
    pub(crate) target_sha: String,
    pub(crate) is_annotated_tag: bool,
    /// `%(*objectname)` — the dereferenced commit id, `Some` only for an
    /// annotated tag (`None`, never an empty-string sentinel, for every
    /// other case).
    pub(crate) peeled_sha: Option<String>,
    /// `%(upstream)` — `None` for "no upstream configured", a deliberate
    /// choice (not `Some("")`) matching `status.rs`'s own `BranchInfo`
    /// upstream modeling convention for this same "absent" concept, per the
    /// frozen research doc's own risk item asking this be decided explicitly.
    pub(crate) upstream: Option<GitPathBuf>,
    /// `%(HEAD)` — `true` exactly for the one `refs/heads/*` entry the
    /// current (attached) HEAD symbolically points to. Always `false` for
    /// every entry while HEAD is detached (see `tests.rs`'s own
    /// `list_refs_marks_no_entry_as_head_while_head_is_detached`) — a caller
    /// distinguishing "no current branch shown" from "a repository truly has
    /// no branches" must cross-reference `git::status`'s own
    /// `BranchHead::Detached` rather than infer detachment from this alone.
    pub(crate) is_head: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct RefList {
    pub(crate) entries: Vec<RefEntry>,
    /// `true` when more refs actually matched than were returned — the same
    /// "capped, not exhaustive" meaning this domain's other list results
    /// (e.g. `log::HistoryList::truncated`) already carry.
    pub(crate) truncated: bool,
}

/// Splits `full_name` on whichever of the three requested namespace prefixes
/// it starts with, returning `(kind, short_name_bytes)` — `None` only if
/// `full_name` matches none of the three, which should never happen for a
/// well-formed [`GIT_FOR_EACH_REF_ARGS`] response (git itself only ever
/// returns refs under the exact patterns requested) but is checked rather
/// than assumed, exactly like every other "should never happen, but verify"
/// parse step in this domain.
fn classify_ref_name(full_name: &[u8]) -> Option<(RefGroupKind, Vec<u8>)> {
    const PREFIXES: [(&[u8], RefGroupKind); 3] = [
        (b"refs/heads/", RefGroupKind::Branch),
        (b"refs/tags/", RefGroupKind::Tag),
        (b"refs/remotes/", RefGroupKind::RemoteBranch),
    ];
    for (prefix, kind) in PREFIXES {
        if let Some(rest) = full_name.strip_prefix(prefix) {
            return Some((kind, rest.to_vec()));
        }
    }
    None
}

/// Parses [`GIT_FOR_EACH_REF_ARGS`]'s output: LF-terminated records, each a
/// fixed six NUL-separated fields — see this module's own doc comment for
/// why both separators are safe here without the "single absorbing field"
/// technique [`super::log::parse_history_entries`]/
/// [`super::log::parse_graph_entries`] need for their own, genuinely
/// attacker-reachable free-text fields.
fn parse_refs(output: &[u8], max_entries: usize) -> Result<RefList, CommandError> {
    let mut entries = Vec::new();
    for line in output.split(|&byte| byte == b'\n') {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&[u8]> = line.split(|&byte| byte == 0u8).collect();
        if fields.len() != 6 {
            return Err(git_refs_parse_failed());
        }
        let refname = fields[0];
        let objecttype = fields[1];
        let objectname = fields[2];
        let peeled = fields[3];
        let upstream = fields[4];
        let head_marker = fields[5];
        let (kind, short) = classify_ref_name(refname).ok_or_else(git_refs_parse_failed)?;
        if !is_lowercase_hex40(objectname) {
            return Err(git_refs_parse_failed());
        }
        let target_sha = String::from_utf8(objectname.to_vec()).expect("hex digits are ASCII");
        let is_annotated_tag = objecttype == b"tag";
        let peeled_sha = if peeled.is_empty() {
            None
        } else {
            if !is_lowercase_hex40(peeled) {
                return Err(git_refs_parse_failed());
            }
            Some(String::from_utf8(peeled.to_vec()).expect("hex digits are ASCII"))
        };
        let upstream_ref = if upstream.is_empty() {
            None
        } else {
            Some(GitPathBuf::from_bytes(upstream.to_vec()))
        };
        let is_head = match head_marker {
            b"*" => true,
            b" " => false,
            _ => return Err(git_refs_parse_failed()),
        };
        entries.push(RefEntry {
            kind,
            full_name: GitPathBuf::from_bytes(refname.to_vec()),
            short_name: GitPathBuf::from_bytes(short),
            target_sha,
            is_annotated_tag,
            peeled_sha,
            upstream: upstream_ref,
            is_head,
        });
    }
    let truncated = entries.len() > max_entries;
    if truncated {
        entries.truncate(max_entries);
    }
    Ok(RefList { entries, truncated })
}

/// `git for-each-ref --format=... refs/heads refs/tags refs/remotes
/// --count=<MAX_REF_ENTRIES+1>` — the refs sidebar's own data source, and the
/// graph view's own ref-badge join source (see this module's own doc
/// comment). Runs under [`GitExecMode::BackgroundRead`] through [`run_git`],
/// exactly like every other read in this domain — no new exec path. Confirmed
/// empirically (mirroring [`super::log::file_history`]'s own identical
/// finding for a path with no history) that a repository with zero refs
/// under any of the three requested namespaces exits `0` with empty output,
/// resolving to an empty, non-truncated [`RefList`] rather than an error.
pub(crate) async fn list_refs(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
) -> Result<RefList, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let mut args: Vec<String> = GIT_FOR_EACH_REF_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.push(format!("--count={}", MAX_REF_ENTRIES + 1));

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        return Err(git_refs_list_failed());
    }
    parse_refs(&output.stdout, MAX_REF_ENTRIES)
}

#[cfg(test)]
mod tests;
