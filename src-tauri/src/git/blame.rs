//! `git blame --line-porcelain --root -c core.quotePath=false [-L<range>] --
//! <path>` (`F090` S0 of `docs/research/2026-07-26-git-history.md`) and the
//! batch `git log --no-walk -z --format=%H%x1f%B <sha>...` commit-message
//! fetch backing the hover feature's "full commit body" need (blame's own
//! `summary` header is only the first line — see [`blame_commit_messages`]).
//!
//! # Deviation from the frozen research doc (disclosed, verified empirically)
//!
//! The frozen plan's `GIT_BLAME_BASE_ARGS` sketch placed `"-c"`/
//! `"core.quotePath=false"` *after* `"blame"` in the argument list. Real git
//! 2.50.1 rejects that: `-c` positioned after the `blame` subcommand token is
//! blame's *own* `-c`/`--incremental`-adjacent flag (annotate-compatibility
//! output mode — see `git help blame`'s `-c` entry), not the global
//! config-override flag — `git blame -c core.quotePath=false -- <path>`
//! fails with `fatal: bad revision 'core.quotePath=false'` (confirmed
//! empirically). `-c key=value` must be a *global* option, positioned before
//! the subcommand name, exactly like [`super::exec::harden_background_read`]'s
//! own `-c core.hooksPath=...`/`-c core.fsmonitor=` overrides already are.
//! [`GIT_BLAME_BASE_ARGS`] below is therefore ordered `["-c",
//! "core.quotePath=false", "blame", "--line-porcelain", "--root"]` — verified
//! empirically to combine correctly with [`super::exec::harden_background_read`]'s
//! own leading `-c` overrides (multiple global `-c` options before the
//! subcommand token compose without issue).
//!
//! # `-c core.quotePath=false` is necessary but *not sufficient* (a second,
//! independently discovered correction)
//!
//! The research doc frames `-c core.quotePath=false` as "the only way to get
//! raw bytes" out of blame's `filename`/`previous` path fields. Verified
//! empirically that this is incomplete: `core.quotePath=false` only stops
//! git from octal-escaping bytes `>= 0x80` — a literal double-quote,
//! backslash, tab, or other control byte in a filename is **always**
//! C-quoted (wrapped in `"..."` with `\\`/`\"`/`\t`/`\ooo`-style escapes),
//! *regardless* of `core.quotePath` (confirmed against real filenames
//! containing each of `"`, `\`, a literal tab, a literal `0x01` control byte,
//! and — via a raw-byte `OsStr` construction, since normal shell tooling
//! cannot represent it as an argument — a literal LF; see `tests.rs`'s
//! `blame_quote_path_hardening` module). There is no git flag that fully
//! suppresses blame's path quoting the way `-z` does for `status`/`diff`
//! (`-z` was independently confirmed empirically to have **no effect at all**
//! on blame's own porcelain format, unlike those two commands — see the
//! research doc's own "关键陷阱" note, which this parser's design fully
//! agrees with, but takes one step further: since *no* combination of flags
//! avoids quoting entirely, [`parse_git_quoted_path`] below implements full
//! C-style dequoting — matching `git`'s own `quote.c` escape set (named
//! escapes plus 3-digit octal) — as the actual correctness mechanism, with
//! `-c core.quotePath=false` valued only for keeping the common non-ASCII
//! case simpler/smaller on the wire, never assumed to make dequoting
//! optional.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::dto::is_valid_mutate_path;
use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};
use super::wire::{split_nul_records, GitPathBuf};

/// The exact, audited base `git blame` argument list — locked by
/// `scripts/plain/boundary-contracts.mjs`'s `validateGitBlameHardeningArgs`.
/// `-c core.quotePath=false` **must** be a global option (before `"blame"`),
/// not a `blame`-specific one — see this module's own doc comment's first
/// section for why. `--root` treats a root (parentless) commit as an
/// ordinary one rather than a "boundary" commit (confirmed empirically: the
/// `boundary` porcelain header line is present for a root commit's lines
/// without `--root`, and absent with it) — chosen so a file's very first
/// commit's lines are attributed normally rather than needing a
/// caller-visible boundary special case. `--line-porcelain` (not
/// `--porcelain`) is chosen over the shorter format because it repeats every
/// header field for every line rather than only the first line of a
/// same-commit run — see [`parse_line_porcelain`]'s own doc comment for why
/// that self-contained-per-line shape is what makes this parser's simple
/// "read lines until the next tab-prefixed content line" state machine
/// correct without tracking cross-line state.
pub(crate) const GIT_BLAME_BASE_ARGS: &[&str] = &[
    "-c",
    "core.quotePath=false",
    "blame",
    "--line-porcelain",
    "--root",
];

/// The exact, audited base `git log` argument list for
/// [`blame_commit_messages`]'s batch hover-metadata fetch — locked by
/// `scripts/plain/boundary-contracts.mjs`. `--no-walk` preserves the
/// caller-supplied sha order rather than re-sorting by commit date/topology
/// (confirmed empirically); `-z` NUL-terminates each record.
///
/// # Format string: only `%H` and the literal `%x1f` separator before `%B`
///
/// The frozen research doc sketches a multi-field format
/// (`%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b`) with free-form fields
/// (`%an`/`%ae`, author name/email) positioned *before* the message body.
/// Verified empirically that this is unsafe: `git config user.name`/
/// `user.email` accept **completely arbitrary bytes** through entirely
/// normal, no-special-tooling-required `git commit` — including a literal
/// `0x1f` (Unit Separator) byte, the exact delimiter the sketch's own format
/// string uses (confirmed against a real commit: `git log
/// --format=%H%x1f%an%x1f...` for an author name containing a raw `0x1f`
/// byte would shift every field after `%an` by one delimiter, corrupting
/// `%ae`/`%aI`/the body). This is a strictly *more* reachable attack surface
/// than blame's own quoting question above — no `--literally`-style object
/// corruption is needed, just a hostile contributor's own repository-local
/// git config.
///
/// [`blame_commit_messages`]'s actual need is narrower than the sketch's
/// general-purpose format: blame's own per-line/per-commit header (already
/// parsed by [`parse_line_porcelain`]) already carries author/committer
/// name/mail/time/tz and the message's first line (`summary`) — the *only*
/// thing missing for a hover tooltip is the message's full body. This format
/// string is therefore just `%H%x1f%B`: [`parse_commit_messages`] splits
/// each record on the **first** `0x1f` byte only (`splitn(2, ..)`, exactly
/// like [`super::diff::parse_numstat`]'s own "capture the untouched
/// remainder verbatim" technique for a path field that might itself contain
/// the tokenizer's own separator byte) — `%H` is always exactly 40 lowercase
/// hex bytes (safe to match positionally, never attacker-influenced), and
/// the body absorbs every remaining byte of the record regardless of what it
/// contains, including a raw `0x1f` the message itself might embed. There is
/// no field after the body for a shift to corrupt.
pub(crate) const GIT_LOG_BLAME_MESSAGE_ARGS: &[&str] =
    &["log", "--no-walk", "-z", "--format=%H%x1f%B"];

/// The sentinel `git blame` reports as a line's commit sha when that line
/// reflects an uncommitted working-tree change (confirmed empirically:
/// author/committer both read `"Not Committed Yet"`/`<not.committed.yet>`,
/// `summary` reads `"Version of <path> from <path>"`, and a `previous` line
/// still points at the real prior commit). Wire-boundary code derives
/// `isUncommitted` from comparing a line's `commit_sha` against this
/// constant — see `dto.rs`'s `GitBlameLineEntryWire`.
pub(crate) const BLAME_UNCOMMITTED_SHA: &str = "0000000000000000000000000000000000000000";

/// Defensive ceiling on how many shas one [`blame_commit_messages`] call may
/// request — mirrors `dto::MAX_GIT_MUTATE_PATHS`'s exact "reject a
/// structurally hostile/runaway batch" rationale for this domain.
pub(crate) const MAX_BLAME_COMMIT_MESSAGE_SHAS: usize = 4_096;

fn blame_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_BLAME_PARSE_FAILED",
        "The git blame output could not be parsed.",
    )
}

fn blame_invalid_path() -> CommandError {
    CommandError::new(
        "GIT_BLAME_INVALID_PATH",
        "The requested path is empty, too large, or invalid.",
    )
}

fn blame_invalid_range() -> CommandError {
    CommandError::new(
        "GIT_BLAME_INVALID_RANGE",
        "The requested line range is invalid (start must be >= 1 and <= end).",
    )
}

fn blame_path_not_found() -> CommandError {
    CommandError::new(
        "GIT_BLAME_PATH_NOT_FOUND",
        "The requested path does not exist in the repository's history or working tree.",
    )
}

fn blame_range_out_of_bounds() -> CommandError {
    CommandError::new(
        "GIT_BLAME_RANGE_OUT_OF_BOUNDS",
        "The requested line range is outside the file's current line count.",
    )
}

fn git_blame_failed() -> CommandError {
    CommandError::new(
        "GIT_BLAME_FAILED",
        "git blame did not complete successfully.",
    )
}

fn blame_commit_messages_invalid_request() -> CommandError {
    CommandError::new(
        "GIT_BLAME_COMMIT_MESSAGES_INVALID_REQUEST",
        "The commit sha list is empty, too large, or contains an invalid entry.",
    )
}

fn git_blame_commit_messages_failed() -> CommandError {
    CommandError::new(
        "GIT_BLAME_COMMIT_MESSAGES_FAILED",
        "git log did not complete successfully.",
    )
}

/// A 1-based, inclusive `-L<start>,<end>` viewport range — see
/// [`GIT_BLAME_BASE_ARGS`]'s doc comment for why whole-file blame is the
/// default (no range) and this exists only for a caller wanting to bound a
/// large file's cost to a visible viewport.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct BlameLineRange {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

/// Commit-level fields `--line-porcelain` repeats for every line attributed
/// to a given commit — deduplicated into [`BlameResult::commits`] (keyed by
/// sha) rather than kept duplicated per line, since (unlike `filename`/
/// `previous`, which really can vary within one blame run across a rename —
/// see [`BlameLineEntry`]'s own doc comment) these fields are properties of
/// the commit object itself, invariant across every line/file-path context a
/// single sha is ever seen under in one run.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BlameCommitHeader {
    pub(crate) author: String,
    pub(crate) author_mail: String,
    pub(crate) author_time: i64,
    pub(crate) author_tz: String,
    pub(crate) committer: String,
    pub(crate) committer_mail: String,
    pub(crate) committer_time: i64,
    pub(crate) committer_tz: String,
    /// First line of the commit message only — `git log`'s `%s`/blame's own
    /// `summary` convention. [`blame_commit_messages`] fetches the full body
    /// separately, on demand, for the hover feature.
    pub(crate) summary: String,
}

/// The commit-and-path a line's blame trace continues into when walked one
/// step further back — present for every line except one from the very
/// first (root, thanks to `--root`) commit that introduced the file.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BlamePrevious {
    pub(crate) sha: String,
    pub(crate) path: GitPathBuf,
}

/// One `--line-porcelain` record. `filename` (and `previous`'s path) are
/// deliberately kept **per line**, not deduplicated into
/// [`BlameCommitHeader`]: verified empirically that a rename-and-edit
/// commit's own lines can span two different `filename` values within a
/// single blame run (the pre-rename lines still show the old path, the
/// commit's newly-added lines show the new path) — modeling `filename` as a
/// commit-level property would silently lose or corrupt this real
/// same-commit split. See this module's `tests.rs`'s
/// `blame_reports_the_old_filename_for_lines_that_predate_a_rename_and_the_new_filename_after_it`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BlameLineEntry {
    pub(crate) commit_sha: String,
    pub(crate) orig_line: u32,
    pub(crate) final_line: u32,
    /// Always `false` in practice for this domain's own invocations (always
    /// spawned with `--root` — see [`GIT_BLAME_BASE_ARGS`]'s doc comment),
    /// parsed defensively anyway rather than assumed impossible, in case a
    /// future git version's behavior around `--root` narrows.
    pub(crate) is_boundary: bool,
    pub(crate) filename: GitPathBuf,
    pub(crate) previous: Option<BlamePrevious>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct BlameResult {
    pub(crate) entries: Vec<BlameLineEntry>,
    pub(crate) commits: HashMap<String, BlameCommitHeader>,
}

/// Runs [`GIT_BLAME_BASE_ARGS`] (plus an optional `-L<range>`) against
/// `path` and parses the result. `path` is validated with the same
/// empty/oversized/absolute/`..`-segment rule every other mutate-path
/// request in this domain uses (see `dto::is_valid_mutate_path`'s own doc
/// comment) — blame is read-only, but a caller-controlled path string still
/// deserves the same defensive floor before it becomes a spawn argument.
pub(crate) async fn blame_file(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    path: &str,
    range: Option<BlameLineRange>,
) -> Result<BlameResult, CommandError> {
    if !is_valid_mutate_path(path) {
        return Err(blame_invalid_path());
    }
    if let Some(range) = range {
        if range.start == 0 || range.end < range.start {
            return Err(blame_invalid_range());
        }
    }
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let mut args: Vec<String> = GIT_BLAME_BASE_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    if let Some(range) = range {
        args.push(format!("-L{},{}", range.start, range.end));
    }
    args.push("--".to_owned());
    args.push(path.to_owned());

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("no such path") {
            return Err(blame_path_not_found());
        }
        if stderr.contains("has only") {
            return Err(blame_range_out_of_bounds());
        }
        return Err(git_blame_failed());
    }
    parse_line_porcelain(&output.stdout)
}

/// Batch-fetches the full commit message body for each (deduplicated) sha in
/// `shas` via [`GIT_LOG_BLAME_MESSAGE_ARGS`] — see that constant's own doc
/// comment for the exact format/safety rationale. Every sha must be exactly
/// 40 lowercase hex characters and must **not** be
/// [`BLAME_UNCOMMITTED_SHA`] — callers (the hover feature) already know
/// locally which lines are uncommitted (from `BlameResult`'s own
/// `is_uncommitted`/`commit_sha`) and must filter that sentinel out before
/// calling, since `git log` has no real commit object to look up for it.
///
/// Trust/repository resolution ([`resolve_repo_toplevel`]) always runs, even
/// for an empty or fully-deduplicated-to-nothing `shas` — this call never
/// silently bypasses the trust gate just because its input happens to need
/// zero actual `git` work; only the *spawn* itself is skipped once nothing
/// remains to look up.
pub(crate) async fn blame_commit_messages(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    shas: &[String],
) -> Result<HashMap<String, String>, CommandError> {
    if shas.len() > MAX_BLAME_COMMIT_MESSAGE_SHAS {
        return Err(blame_commit_messages_invalid_request());
    }
    let mut deduped: Vec<String> = Vec::with_capacity(shas.len());
    for sha in shas {
        if !is_lowercase_hex40(sha.as_bytes()) || sha == BLAME_UNCOMMITTED_SHA {
            return Err(blame_commit_messages_invalid_request());
        }
        if !deduped.iter().any(|existing| existing == sha) {
            deduped.push(sha.clone());
        }
    }

    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    if deduped.is_empty() {
        return Ok(HashMap::new());
    }
    let mut args: Vec<String> = GIT_LOG_BLAME_MESSAGE_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
    args.extend(deduped);

    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        return Err(git_blame_commit_messages_failed());
    }
    parse_commit_messages(&output.stdout)
}

fn is_lowercase_hex40(bytes: &[u8]) -> bool {
    bytes.len() == 40
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn parse_commit_messages(output: &[u8]) -> Result<HashMap<String, String>, CommandError> {
    let mut messages = HashMap::new();
    for record in split_nul_records(output) {
        if record.is_empty() {
            continue;
        }
        let mut parts = record.splitn(2, |&byte| byte == 0x1f);
        let sha_bytes = parts.next().ok_or_else(blame_parse_failed)?;
        let body_bytes = parts.next().ok_or_else(blame_parse_failed)?;
        if !is_lowercase_hex40(sha_bytes) {
            return Err(blame_parse_failed());
        }
        let sha = String::from_utf8(sha_bytes.to_vec()).expect("hex digits are ASCII");
        messages.insert(sha, String::from_utf8_lossy(body_bytes).into_owned());
    }
    Ok(messages)
}

// --- `--line-porcelain` parser -------------------------------------------

#[derive(Default)]
struct HeaderAccumulator {
    author: Option<String>,
    author_mail: Option<String>,
    author_time: Option<i64>,
    author_tz: Option<String>,
    committer: Option<String>,
    committer_mail: Option<String>,
    committer_time: Option<i64>,
    committer_tz: Option<String>,
    summary: Option<String>,
    previous: Option<BlamePrevious>,
    is_boundary: bool,
    filename: Option<GitPathBuf>,
}

/// Parses a complete `--line-porcelain` invocation's stdout into a flat line
/// list plus a deduplicated per-commit metadata map.
///
/// # Why splitting the whole buffer on raw `LF` (`0x0a`) bytes is safe here
///
/// Unlike `status`/`diff`'s `-z` output (NUL-delimited specifically *because*
/// a legal filename can contain a literal LF — see `wire.rs`'s own module
/// doc), every header line in this format is guaranteed LF-free by git's own
/// quoting rules: a `filename`/`previous` value containing a literal LF is
/// *always* C-quoted, and inside a quoted value LF is escaped as the
/// two-byte sequence `\`+`n`, never a raw `0x0a` byte (confirmed empirically
/// — see this module's own doc comment and `tests.rs`'s raw-LF-filename
/// fixture). A content line's own text (after its leading tab) likewise
/// cannot contain a raw LF: it is by definition one already-delimited line
/// of the blamed file. So a plain `output.split(|&b| b == b'\n')`, unlike a
/// hypothetical naive split of `status`/`diff`'s own format, cannot ever
/// split a real field in half.
pub(crate) fn parse_line_porcelain(output: &[u8]) -> Result<BlameResult, CommandError> {
    let mut lines: Vec<&[u8]> = output.split(|&byte| byte == b'\n').collect();
    // A well-formed non-empty invocation's output always ends with a
    // terminating LF after the final content line; splitting on `\n`
    // therefore always leaves exactly one trailing empty element, which is
    // dropped here — mirrors `wire::split_nul_records`'s identical handling
    // of `-z`'s own trailing terminator for a different domain's format.
    if lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }

    let mut entries = Vec::new();
    let mut commits: HashMap<String, BlameCommitHeader> = HashMap::new();
    let mut iter = lines.into_iter();

    while let Some(first_line) = iter.next() {
        let (sha, orig_line, final_line) = parse_first_line(first_line)?;
        let mut header = HeaderAccumulator::default();
        loop {
            let line = iter.next().ok_or_else(blame_parse_failed)?;
            if line.first() == Some(&b'\t') {
                // Content line — its text is not retained (the caller
                // already has the buffer's own content; this parser only
                // needs commit/line attribution). Consuming it here is what
                // advances past it to the next record.
                break;
            }
            parse_header_field(line, &mut header)?;
        }

        let filename = header.filename.ok_or_else(blame_parse_failed)?;
        entries.push(BlameLineEntry {
            commit_sha: sha.clone(),
            orig_line,
            final_line,
            is_boundary: header.is_boundary,
            filename,
            previous: header.previous,
        });

        if let std::collections::hash_map::Entry::Vacant(vacant) = commits.entry(sha) {
            vacant.insert(BlameCommitHeader {
                author: header.author.ok_or_else(blame_parse_failed)?,
                author_mail: header.author_mail.ok_or_else(blame_parse_failed)?,
                author_time: header.author_time.ok_or_else(blame_parse_failed)?,
                author_tz: header.author_tz.ok_or_else(blame_parse_failed)?,
                committer: header.committer.ok_or_else(blame_parse_failed)?,
                committer_mail: header.committer_mail.ok_or_else(blame_parse_failed)?,
                committer_time: header.committer_time.ok_or_else(blame_parse_failed)?,
                committer_tz: header.committer_tz.ok_or_else(blame_parse_failed)?,
                summary: header.summary.ok_or_else(blame_parse_failed)?,
            });
        }
    }

    Ok(BlameResult { entries, commits })
}

/// Parses `<sha> <orig-line> <final-line> [<group-size>]` — the group size
/// (present only on the first line of a same-commit run) is validated as a
/// well-formed integer when present but not retained: this parser's own DTO
/// does not need it (a consumer can trivially recompute "same commit as the
/// previous line" by comparing consecutive `commit_sha`s).
fn parse_first_line(line: &[u8]) -> Result<(String, u32, u32), CommandError> {
    let text = std::str::from_utf8(line).map_err(|_| blame_parse_failed())?;
    let mut parts = text.split(' ');
    let sha = parts.next().ok_or_else(blame_parse_failed)?;
    if !is_lowercase_hex40(sha.as_bytes()) {
        return Err(blame_parse_failed());
    }
    let orig_line: u32 = parts
        .next()
        .ok_or_else(blame_parse_failed)?
        .parse()
        .map_err(|_| blame_parse_failed())?;
    let final_line: u32 = parts
        .next()
        .ok_or_else(blame_parse_failed)?
        .parse()
        .map_err(|_| blame_parse_failed())?;
    if let Some(group_size_token) = parts.next() {
        let _group_size: u32 = group_size_token.parse().map_err(|_| blame_parse_failed())?;
    }
    if parts.next().is_some() {
        return Err(blame_parse_failed());
    }
    Ok((sha.to_owned(), orig_line, final_line))
}

fn parse_header_field(line: &[u8], header: &mut HeaderAccumulator) -> Result<(), CommandError> {
    if line == b"boundary" {
        header.is_boundary = true;
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"author-mail ") {
        header.author_mail = Some(String::from_utf8_lossy(rest).into_owned());
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"author-time ") {
        header.author_time = Some(parse_i64_field(rest)?);
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"author-tz ") {
        header.author_tz = Some(String::from_utf8_lossy(rest).into_owned());
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"author ") {
        header.author = Some(String::from_utf8_lossy(rest).into_owned());
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"committer-mail ") {
        header.committer_mail = Some(String::from_utf8_lossy(rest).into_owned());
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"committer-time ") {
        header.committer_time = Some(parse_i64_field(rest)?);
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"committer-tz ") {
        header.committer_tz = Some(String::from_utf8_lossy(rest).into_owned());
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"committer ") {
        header.committer = Some(String::from_utf8_lossy(rest).into_owned());
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"summary ") {
        header.summary = Some(String::from_utf8_lossy(rest).into_owned());
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"previous ") {
        if rest.len() < 41 || rest[40] != b' ' || !is_lowercase_hex40(&rest[..40]) {
            return Err(blame_parse_failed());
        }
        let sha = String::from_utf8(rest[..40].to_vec()).expect("hex digits are ASCII");
        let path = parse_git_quoted_path(&rest[41..])?;
        header.previous = Some(BlamePrevious { sha, path });
        return Ok(());
    }
    if let Some(rest) = line.strip_prefix(b"filename ") {
        header.filename = Some(parse_git_quoted_path(rest)?);
        return Ok(());
    }
    // An unrecognized header line (a future git version's new field, e.g.
    // `--show-stats`'s own extra lines this domain never requests) is
    // ignored rather than rejected — forward-compatible, mirroring
    // `status::parse_header_line`'s identical fallback for this codebase's
    // other porcelain parser.
    Ok(())
}

fn parse_i64_field(bytes: &[u8]) -> Result<i64, CommandError> {
    std::str::from_utf8(bytes)
        .ok()
        .and_then(|text| text.parse().ok())
        .ok_or_else(blame_parse_failed)
}

/// Dequotes a `filename`/`previous`-path value exactly like git's own
/// `quote.c` `quote_c_style` does: if `value` does not start with a literal
/// `"`, it is already the raw, unescaped bytes (the common case once
/// `core.quotePath=false` is set and the path contains nothing else that
/// forces quoting). Otherwise `value` is a fully C-quoted string — every
/// literal `"` byte anywhere in a real path unconditionally triggers this
/// form (confirmed empirically), so checking only the first byte is
/// unambiguous. See this module's own doc comment for why quoting can never
/// be fully disabled for blame the way `-z` disables it for `status`/`diff`,
/// and why this function (not the `-c core.quotePath=false` flag) is this
/// parser's actual correctness mechanism.
fn parse_git_quoted_path(value: &[u8]) -> Result<GitPathBuf, CommandError> {
    if value.first() != Some(&b'"') {
        return Ok(GitPathBuf::from_bytes(value.to_vec()));
    }
    if value.len() < 2 || *value.last().unwrap() != b'"' {
        return Err(blame_parse_failed());
    }
    let inner = &value[1..value.len() - 1];
    let mut out = Vec::with_capacity(inner.len());
    let mut index = 0;
    while index < inner.len() {
        let byte = inner[index];
        if byte != b'\\' {
            out.push(byte);
            index += 1;
            continue;
        }
        index += 1;
        let escape = *inner.get(index).ok_or_else(blame_parse_failed)?;
        match escape {
            b'\\' => {
                out.push(b'\\');
                index += 1;
            }
            b'"' => {
                out.push(b'"');
                index += 1;
            }
            b'a' => {
                out.push(0x07);
                index += 1;
            }
            b'b' => {
                out.push(0x08);
                index += 1;
            }
            b'f' => {
                out.push(0x0c);
                index += 1;
            }
            b'n' => {
                out.push(b'\n');
                index += 1;
            }
            b'r' => {
                out.push(b'\r');
                index += 1;
            }
            b't' => {
                out.push(b'\t');
                index += 1;
            }
            b'v' => {
                out.push(0x0b);
                index += 1;
            }
            b'0'..=b'7' => {
                let octal = inner.get(index..index + 3).ok_or_else(blame_parse_failed)?;
                if !octal.iter().all(|digit| (b'0'..=b'7').contains(digit)) {
                    return Err(blame_parse_failed());
                }
                let value = octal.iter().fold(0u32, |accumulator, digit| {
                    accumulator * 8 + u32::from(digit - b'0')
                });
                if value > 255 {
                    return Err(blame_parse_failed());
                }
                out.push(value as u8);
                index += 3;
            }
            _ => return Err(blame_parse_failed()),
        }
    }
    Ok(GitPathBuf::from_bytes(out))
}

#[cfg(test)]
mod tests;
