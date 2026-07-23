//! Streaming, capability-relative full-text search background task (F040 S3
//! of `docs/research/2026-07-23-search-quickopen.md`).
//!
//! # Traversal reuse
//!
//! This module reuses `search::file_search`'s bounded traversal *primitives*
//! (the entries/depth budgets, `.gitignore` layering, exclude-glob matching
//! and entry-name validation, via [`super::file_search::collect_entries`],
//! [`super::file_search::compile_exclude_globs`],
//! [`super::file_search::read_gitignore`] and
//! [`super::file_search::matched_gitignore`]) rather than re-implementing any
//! of that logic — `file_search.rs`'s own tests already cover it and nothing
//! here changes its behavior (only its visibility was widened to
//! `pub(crate)`). The outer directory-frame *loop* below is a fresh, small
//! state machine rather than a further-shared abstraction: Rust has no
//! first-class generator/coroutine that can yield a candidate file mid-DFS to
//! two different per-file actions ("collect a name into a `Vec`" for file
//! search vs. "open the file and stream matches through it" for text search)
//! without unsafe code or a heap-allocated trait-object callback threaded
//! through every stack frame, so the deliberate choice here is: share the
//! hard, previously-audited parts, duplicate only the thin orchestration
//! loop around them.
//!
//! # Streaming protocol
//!
//! [`start`] spawns one dedicated OS thread per search (mirroring
//! `workspace::watcher::WindowWatcher`'s per-window worker thread precedent)
//! that walks every requested root, greps each candidate file and pushes one
//! [`WorkspaceSearchTextBatch`] per matching file into a bounded
//! `std::sync::mpsc::sync_channel`. That channel *is* the backpressure
//! mechanism: `SyncSender::send` blocks the producer once
//! [`SEARCH_BATCH_QUEUE_CAPACITY`] batches are sitting unconsumed, and
//! unblocks the instant [`TextSearchHandle::poll`] drains some of them — no
//! hand-rolled condvar/mutex bookkeeping is needed because the standard
//! library's bounded channel already gives exactly this semantics. Dropping
//! the [`TextSearchHandle`] (which owns the `Receiver`) is *also* the
//! cancellation mechanism: a blocked `send` on a disconnected channel returns
//! immediately, so a producer waiting on a full queue notices cancellation
//! without polling a flag. For a producer that is *not* currently blocked on
//! `send` (mid-traversal, mid-file), an `Arc<AtomicBool>` cancellation flag is
//! additionally checked once per directory entry visited — the same
//! granularity `file_search`'s own budget check uses — so a large,
//! match-free subtree does not delay cancellation until the next file with a
//! hit.
//!
//! # Non-UTF-8 line handling
//!
//! A line that is not valid UTF-8 is skipped (that one match is dropped, the
//! rest of the file keeps searching) rather than lossily converted. This
//! aligns with the rest of the search domain's established policy of
//! "skip the one unrepresentable thing, do not fail the whole operation" —
//! `file_search.rs` already skips non-UTF-8 *filenames* the same way. Lossy
//! conversion was considered and rejected: `String::from_utf8_lossy` can
//! collapse a run of invalid bytes into a single replacement character using
//! a "maximal subpart" strategy that does not correspond 1:1 with the
//! original byte length, which would make the returned `column`/`length`
//! (computed against the *original* bytes matched by the regex) index into a
//! different string than the one actually sent to the Workbench —
//! attractive-looking but silently wrong highlighting. Skipping avoids ever
//! constructing that mismatch.
//!
//! # Preview windowing
//!
//! `previewText` is capped at
//! [`super::dto::TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS`] UTF-16 code units (not
//! bytes — Monaco's own column unit), independent of whatever windowing the
//! Workbench's own `TextSearchMatch`/`ITextSearchPreviewOptions` machinery
//! layers on top: this is a defense-in-depth payload-size bound against an
//! adversarial or merely huge single-line file, not a UX feature. The window
//! is *anchored so the match is always inside it*: if the whole match fits
//! within the first [`TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS`] units of the
//! line, the preview starts at the line's beginning (the common case, and
//! stable if the user later widens their view); otherwise the window starts
//! exactly at the match, and `column` is rebased to be relative to that
//! window. This keeps the invariant `column + length <= previewText.len()`
//! (in UTF-16 units) always true — a match is never reported outside the
//! text a caller is given to render it against.

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::Arc;
use std::thread::JoinHandle;

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use globset::GlobSet;
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};

use crate::error::CommandError;
use crate::workspace::WorkspaceRootLease;

use super::dto::{
    invalid_search_regex, WorkspaceSearchTextBatch, WorkspaceSearchTextMatch,
    WorkspaceSearchTextPollResult, WorkspaceSearchTextQuery, WorkspaceSearchTextSkipped,
    TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS,
};
use super::file_search::{
    collect_entries, compile_exclude_globs, matched_gitignore, read_gitignore, BudgetExceeded,
    EntryKind, MAX_SEARCH_TREE_DEPTH,
};

/// How many produced-but-not-yet-polled batches may sit in the channel before
/// the background thread's `send` blocks — the streaming protocol's
/// backpressure bound. Each batch is one file's matches, so this bounds
/// worst-case buffered memory to a few hundred files' worth of matches
/// regardless of how slowly the frontend polls.
pub(crate) const SEARCH_BATCH_QUEUE_CAPACITY: usize = 512;

/// A compiled, ready-to-run text search query: the wire request's flags have
/// already been turned into a real matcher (or rejected as an invalid
/// pattern) and exclude globs.
#[derive(Debug)]
pub(crate) struct CompiledTextQuery {
    matcher: RegexMatcher,
    exclude_set: GlobSet,
    max_results: usize,
    max_file_size: u64,
}

/// Compiles a validated [`WorkspaceSearchTextQuery`] into a
/// [`CompiledTextQuery`]. A regex syntax error is reported as
/// `INVALID_SEARCH_REGEX` with the underlying parser message (not a generic
/// wire-shape rejection) so the Workbench can show the caller what is wrong
/// with their pattern. `isWordMatch`/`isCaseSensitive` are applied by the
/// matcher builder regardless of `isRegExp` (word-boundary wrapping and case
/// folding both make sense for a literal search too); PCRE2-only syntax
/// (lookaround, backreferences) is not supported — an attempt to use it
/// surfaces as the same linear-engine `INVALID_SEARCH_REGEX` any other
/// unsupported syntax would, which is an intentional, narrower-than-upstream
/// scope documented in `docs/research/2026-07-23-search-quickopen.md`.
pub(crate) fn compile_query(
    query: &WorkspaceSearchTextQuery,
) -> Result<CompiledTextQuery, CommandError> {
    let exclude_set = compile_exclude_globs(&query.exclude_globs)?;
    let mut builder = RegexMatcherBuilder::new();
    builder
        .case_insensitive(!query.is_case_sensitive)
        .fixed_strings(!query.is_reg_exp)
        .word(query.is_word_match)
        .multi_line(false)
        .line_terminator(Some(b'\n'))
        .ban_byte(Some(0));
    let matcher = builder
        .build(&query.pattern)
        .map_err(|error| invalid_search_regex(error.to_string()))?;
    Ok(CompiledTextQuery {
        matcher,
        exclude_set,
        max_results: query.max_results,
        max_file_size: query.max_file_size,
    })
}

#[derive(Default)]
struct TextSearchOutcomeCounters {
    skipped_binary: AtomicU32,
    skipped_oversize: AtomicU32,
    limit_hit: AtomicBool,
    done: AtomicBool,
}

/// One active (or just-finished-and-lingering) streaming text search task.
/// Owned by exactly one window's state; see `workspace::service` for the
/// window-scoped lifecycle (single active slot, cancel-supersedes-previous,
/// TTL after natural completion).
pub(crate) struct TextSearchHandle {
    cancelled: Arc<AtomicBool>,
    receiver: Receiver<WorkspaceSearchTextBatch>,
    counters: Arc<TextSearchOutcomeCounters>,
    worker: Option<JoinHandle<()>>,
    delivered: u64,
}

impl TextSearchHandle {
    /// Drains every batch currently sitting in the channel (never blocks) and
    /// reports the search's current cumulative counters. `cursor` from the
    /// caller must equal how many batches this handle has already delivered
    /// — a mismatch means the caller lost track of the stream and is a
    /// programming error, not a recoverable race (only one consumer ever
    /// polls a given search).
    pub(crate) fn poll(
        &mut self,
        cursor: u64,
    ) -> Result<WorkspaceSearchTextPollResult, CommandError> {
        if cursor != self.delivered {
            return Err(super::dto::invalid_search_text_request());
        }
        let mut batches = Vec::new();
        while let Ok(batch) = self.receiver.try_recv() {
            batches.push(batch);
        }
        self.delivered = self
            .delivered
            .checked_add(batches.len() as u64)
            .ok_or_else(super::dto::invalid_search_text_request)?;
        let done = self.counters.done.load(Ordering::Acquire);
        let limit_hit = self.counters.limit_hit.load(Ordering::Acquire);
        let skipped = WorkspaceSearchTextSkipped::new(
            self.counters.skipped_binary.load(Ordering::Acquire),
            self.counters.skipped_oversize.load(Ordering::Acquire),
        );
        Ok(WorkspaceSearchTextPollResult::new(
            batches,
            self.delivered,
            done,
            limit_hit,
            skipped,
        ))
    }

    /// Idempotently terminates the task and reclaims its worker thread and
    /// queue. Safe to call more than once (a second call is a no-op: the
    /// worker is already joined and taken).
    pub(crate) fn close(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            if worker.thread().id() == std::thread::current().id() {
                drop(worker);
            } else {
                let _ = worker.join();
            }
        }
    }
}

impl Drop for TextSearchHandle {
    fn drop(&mut self) {
        self.close();
    }
}

/// Starts one streaming text search over `leases` using `compiled`. Never
/// blocks: the traversal and grep both run on a dedicated background thread.
/// `wake` is called once after every batch is pushed (so the frontend's wake
/// listener has something to pull) and once more right before the task ends
/// naturally, so the final `done: true` poll does not have to wait for the
/// frontend's own lost-wake fallback timer.
pub(crate) fn start(
    leases: Vec<WorkspaceRootLease>,
    compiled: CompiledTextQuery,
    wake: Arc<dyn Fn() + Send + Sync>,
) -> TextSearchHandle {
    start_with_seams(
        leases,
        compiled,
        wake,
        SEARCH_BATCH_QUEUE_CAPACITY,
        Arc::new(|| {}),
    )
}

/// Test-only seam: identical to [`start`] but with an injectable queue
/// capacity, so backpressure can be exercised deterministically with a
/// handful of fixture files instead of [`SEARCH_BATCH_QUEUE_CAPACITY`] of
/// them.
#[cfg(test)]
pub(crate) fn start_with_capacity_for_test(
    leases: Vec<WorkspaceRootLease>,
    compiled: CompiledTextQuery,
    wake: Arc<dyn Fn() + Send + Sync>,
    capacity: usize,
) -> TextSearchHandle {
    start_with_seams(leases, compiled, wake, capacity, Arc::new(|| {}))
}

/// Test-only seam: like [`start_with_capacity_for_test`], but also calls
/// `before_send` synchronously right before every attempt to push a batch
/// into the (possibly full) channel — including attempts that are about to
/// block. This lets a test observe the producer's exact progress through the
/// candidate files via a rendezvous channel instead of racing a `sleep`
/// against the real, unpredictable OS-scheduling gap between "capacity freed
/// up" and "blocked sender resumes and is rescheduled".
#[cfg(test)]
pub(crate) fn start_with_capacity_and_before_send_hook_for_test(
    leases: Vec<WorkspaceRootLease>,
    compiled: CompiledTextQuery,
    wake: Arc<dyn Fn() + Send + Sync>,
    capacity: usize,
    before_send: Arc<dyn Fn() + Send + Sync>,
) -> TextSearchHandle {
    start_with_seams(leases, compiled, wake, capacity, before_send)
}

fn start_with_seams(
    leases: Vec<WorkspaceRootLease>,
    compiled: CompiledTextQuery,
    wake: Arc<dyn Fn() + Send + Sync>,
    capacity: usize,
    before_send: Arc<dyn Fn() + Send + Sync>,
) -> TextSearchHandle {
    let cancelled = Arc::new(AtomicBool::new(false));
    let counters = Arc::new(TextSearchOutcomeCounters::default());
    let (sender, receiver) = mpsc::sync_channel(capacity);
    let worker_cancelled = Arc::clone(&cancelled);
    let worker_counters = Arc::clone(&counters);
    let worker = std::thread::Builder::new()
        .name("plain-text-search".to_owned())
        .spawn(move || {
            run_search(
                leases,
                compiled,
                &sender,
                &worker_cancelled,
                &worker_counters,
                wake.as_ref(),
                before_send.as_ref(),
            );
        })
        .ok();
    if worker.is_none() {
        // A thread that could not even be spawned will never produce a
        // batch; report the search as immediately (vacuously) done rather
        // than leaving the caller polling forever.
        counters.done.store(true, Ordering::Release);
    }
    TextSearchHandle {
        cancelled,
        receiver,
        counters,
        worker,
        delivered: 0,
    }
}

struct TextScanFrame {
    directory: Dir,
    wire: String,
    depth: usize,
    gitignores: Vec<ignore::gitignore::Gitignore>,
    names: std::vec::IntoIter<(String, EntryKind)>,
}

fn run_search(
    leases: Vec<WorkspaceRootLease>,
    compiled: CompiledTextQuery,
    sender: &SyncSender<WorkspaceSearchTextBatch>,
    cancelled: &AtomicBool,
    counters: &TextSearchOutcomeCounters,
    wake: &(dyn Fn() + Send + Sync),
    before_send: &(dyn Fn() + Send + Sync),
) {
    let mut remaining_budget = compiled.max_results;
    let mut visited = 0_usize;
    // Memory maps are never configured here: every file is searched via
    // `Searcher::search_reader` (a `cap_std`-opened, capability-relative
    // handle converted with `into_std()`), and mmap only ever applies to
    // `search_file`/`search_path`'s own internal fast path — leaving the
    // default in place has no effect on this code path.
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(0))
        .line_number(true)
        .multi_line(false)
        .build();

    'roots: for lease in &leases {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        let Ok(root) = lease.directory().try_clone() else {
            continue;
        };
        let root_is_dir = root
            .dir_metadata()
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false);
        if !root_is_dir {
            continue;
        }

        let root_gitignore = read_gitignore(&root, "");
        let names = match collect_entries(&root, &mut visited) {
            Ok(names) => names,
            Err(BudgetExceeded) => {
                counters.limit_hit.store(true, Ordering::Release);
                break 'roots;
            }
        };
        let mut frames = vec![TextScanFrame {
            directory: root,
            wire: String::new(),
            depth: 0,
            gitignores: vec![root_gitignore],
            names: names.into_iter(),
        }];

        while let Some(frame) = frames.last_mut() {
            if cancelled.load(Ordering::Acquire) {
                break 'roots;
            }
            let Some((name, kind)) = frame.names.next() else {
                frames.pop();
                continue;
            };
            let child_wire = if frame.wire.is_empty() {
                name.clone()
            } else {
                format!("{}/{name}", frame.wire)
            };
            let is_dir = kind == EntryKind::Directory;
            let excluded = compiled.exclude_set.is_match(&child_wire)
                || matched_gitignore(&frame.gitignores, &child_wire, is_dir);

            match kind {
                EntryKind::Directory => {
                    if excluded {
                        continue;
                    }
                    let depth = frame.depth + 1;
                    if depth > MAX_SEARCH_TREE_DEPTH {
                        counters.limit_hit.store(true, Ordering::Release);
                        continue;
                    }
                    let Ok(child) = frame.directory.open_dir_nofollow(Path::new(&name)) else {
                        continue;
                    };
                    let child_gitignore = read_gitignore(&child, &child_wire);
                    let child_names = match collect_entries(&child, &mut visited) {
                        Ok(names) => names,
                        Err(BudgetExceeded) => {
                            counters.limit_hit.store(true, Ordering::Release);
                            break 'roots;
                        }
                    };
                    let mut gitignores = frame.gitignores.clone();
                    gitignores.push(child_gitignore);
                    frames.push(TextScanFrame {
                        directory: child,
                        wire: child_wire,
                        depth,
                        gitignores,
                        names: child_names.into_iter(),
                    });
                }
                EntryKind::File => {
                    if excluded {
                        continue;
                    }
                    let outcome = search_one_file(
                        &frame.directory,
                        &name,
                        &child_wire,
                        &compiled,
                        &mut searcher,
                        &mut remaining_budget,
                        counters,
                    );
                    if let FileOutcome::Batch(batch) = outcome {
                        before_send();
                        if sender.send(batch).is_err() {
                            // The handle (and its Receiver) was dropped:
                            // cancellation or window teardown. Stop
                            // immediately without touching `counters` again —
                            // nobody can observe it now.
                            return;
                        }
                        wake();
                    }
                    // Checked after every candidate (not only when a batch
                    // was produced): the budget can also be exhausted by a
                    // file whose matches were reported in a *previous*
                    // batch, and the search must still stop the moment no
                    // budget remains, even if the file that used the last of
                    // it happened to be the very last candidate in the whole
                    // traversal (there would otherwise be no later iteration
                    // left to notice and flag `limitHit`).
                    if remaining_budget == 0 {
                        counters.limit_hit.store(true, Ordering::Release);
                        break 'roots;
                    }
                }
                EntryKind::Symlink | EntryKind::Other => {
                    // Never followed, matching file_search's traversal
                    // policy: dereferencing a symlink to search its target
                    // would violate the capability-relative, nofollow rule.
                }
            }
        }
    }

    counters.done.store(true, Ordering::Release);
    wake();
}

enum FileOutcome {
    Continue,
    Batch(WorkspaceSearchTextBatch),
}

#[allow(clippy::too_many_arguments)]
fn search_one_file(
    parent: &Dir,
    name: &str,
    wire: &str,
    compiled: &CompiledTextQuery,
    searcher: &mut Searcher,
    remaining_budget: &mut usize,
    counters: &TextSearchOutcomeCounters,
) -> FileOutcome {
    if *remaining_budget == 0 {
        return FileOutcome::Continue;
    }
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let Ok(file) = parent.open_with(Path::new(name), &options) else {
        return FileOutcome::Continue;
    };
    let Ok(metadata) = file.metadata() else {
        return FileOutcome::Continue;
    };
    if !metadata.is_file() {
        return FileOutcome::Continue;
    }
    if metadata.len() > compiled.max_file_size {
        counters.skipped_oversize.fetch_add(1, Ordering::Relaxed);
        return FileOutcome::Continue;
    }

    let mut collector = MatchCollector {
        matcher: &compiled.matcher,
        matches: Vec::new(),
        remaining_budget: *remaining_budget,
        saw_binary: false,
    };
    let std_file = file.into_std();
    let _ = searcher.search_reader(&compiled.matcher, std_file, &mut collector);
    *remaining_budget = collector.remaining_budget;

    if collector.saw_binary {
        // A file that trips binary detection is excluded entirely, even if
        // some matches were collected before the NUL byte that triggered it
        // — see the module doc: a binary file must not appear in results at
        // all, matching `file_search`'s "skip the whole thing" precedent for
        // unrepresentable entries.
        counters.skipped_binary.fetch_add(1, Ordering::Relaxed);
        return FileOutcome::Continue;
    }
    // `*remaining_budget` above already reflects the post-file budget (0 if
    // this file's own matches exhausted it); the caller checks that value
    // itself right after this call returns, so no separate "hit the limit"
    // signal is needed here.
    if collector.matches.is_empty() {
        FileOutcome::Continue
    } else {
        FileOutcome::Batch(WorkspaceSearchTextBatch::new(
            wire.to_owned(),
            collector.matches,
        ))
    }
}

struct MatchCollector<'q> {
    matcher: &'q RegexMatcher,
    matches: Vec<WorkspaceSearchTextMatch>,
    /// Remaining global match budget, synced back into the traversal loop's
    /// own counter after this file's search completes (see
    /// `search_one_file`). Reaching zero here always means the whole search
    /// must stop; the traversal loop detects that by reading the synced-back
    /// value itself rather than this struct carrying a separate "did we hit
    /// the limit" flag.
    remaining_budget: usize,
    saw_binary: bool,
}

impl Sink for MatchCollector<'_> {
    type Error = io::Error;

    fn binary_data(
        &mut self,
        _searcher: &Searcher,
        _binary_byte_offset: u64,
    ) -> Result<bool, io::Error> {
        self.saw_binary = true;
        Ok(false)
    }

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, io::Error> {
        if self.remaining_budget == 0 {
            return Ok(false);
        }
        let line_number = u32::try_from(mat.line_number().unwrap_or(0)).unwrap_or(u32::MAX);
        let raw = strip_line_terminator(mat.bytes());
        let Ok(line) = std::str::from_utf8(raw) else {
            // Non-UTF-8 line: skip this match, keep searching the rest of
            // the file (see module doc "Non-UTF-8 line handling").
            return Ok(true);
        };
        let offsets = build_utf16_offsets(line);
        let matcher = self.matcher;
        let matches = &mut self.matches;
        let remaining_budget = &mut self.remaining_budget;
        let mut stop = false;
        let _ = matcher.find_iter(raw, |candidate| {
            if *remaining_budget == 0 {
                stop = true;
                return false;
            }
            let start_u16 = utf16_offset_for_byte(&offsets, candidate.start());
            let end_u16 = utf16_offset_for_byte(&offsets, candidate.end());
            let length_u16 = end_u16.saturating_sub(start_u16);
            let (preview_text, column) = build_preview(line, &offsets, start_u16, length_u16);
            let (Ok(length), Ok(column)) = (u32::try_from(length_u16), u32::try_from(column))
            else {
                return true;
            };
            matches.push(WorkspaceSearchTextMatch::new(
                line_number,
                column.saturating_add(1),
                length,
                preview_text,
            ));
            *remaining_budget -= 1;
            if *remaining_budget == 0 {
                stop = true;
                return false;
            }
            true
        });
        Ok(!stop)
    }
}

/// Strips exactly one trailing line terminator (`\n`, or `\r\n`) from a
/// grep-searcher match's bytes, which always include it. `matched()` above
/// only ever runs `find_iter` and UTF-8 validation against the stripped
/// bytes, so neither can ever "match" the terminator itself.
fn strip_line_terminator(bytes: &[u8]) -> &[u8] {
    let without_lf = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    without_lf.strip_suffix(b"\r").unwrap_or(without_lf)
}

/// Builds a `(byte_offset, utf16_offset)` table for every char boundary in
/// `line`, plus a final sentinel entry for the end of the string. Regex
/// match boundaries over a valid UTF-8 haystack in Unicode mode always land
/// on a char boundary (a documented guarantee of the `regex` crate this
/// matcher is built on), so every lookup below always hits an exact table
/// entry for the *match* endpoints; only the preview window's synthetic
/// `+256` boundary (see `build_preview`) may fall strictly between two
/// entries and needs a floor search.
fn build_utf16_offsets(line: &str) -> Vec<(usize, usize)> {
    let mut offsets = Vec::with_capacity(line.len() + 1);
    let mut utf16 = 0_usize;
    for (byte_offset, ch) in line.char_indices() {
        offsets.push((byte_offset, utf16));
        utf16 += ch.len_utf16();
    }
    offsets.push((line.len(), utf16));
    offsets
}

fn utf16_offset_for_byte(offsets: &[(usize, usize)], byte_offset: usize) -> usize {
    offsets
        .binary_search_by_key(&byte_offset, |&(byte, _)| byte)
        .map(|index| offsets[index].1)
        .unwrap_or(0)
}

/// Floor lookup: the byte offset of the last table entry whose UTF-16 offset
/// is `<= target`. Used only for the preview window's synthetic boundary,
/// which (unlike a real match boundary) is not guaranteed to land exactly on
/// a char.
fn byte_offset_for_utf16_floor(offsets: &[(usize, usize)], target_utf16: usize) -> usize {
    match offsets.binary_search_by_key(&target_utf16, |&(_, utf16)| utf16) {
        Ok(index) => offsets[index].0,
        Err(0) => 0,
        Err(index) => offsets[index - 1].0,
    }
}

/// Builds the bounded preview window for one match: see the module doc
/// "Preview windowing" section for the invariant this maintains
/// (`column + length <= previewText.len()` in UTF-16 units, always).
fn build_preview(
    line: &str,
    offsets: &[(usize, usize)],
    match_start_utf16: usize,
    match_length_utf16: usize,
) -> (String, usize) {
    let match_end_utf16 = match_start_utf16.saturating_add(match_length_utf16);
    let total_utf16 = offsets.last().map(|&(_, utf16)| utf16).unwrap_or(0);
    let window_start_utf16 = if match_end_utf16 <= TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS {
        0
    } else {
        match_start_utf16
    };
    let window_end_utf16 =
        (window_start_utf16 + TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS).min(total_utf16);
    let start_byte = byte_offset_for_utf16_floor(offsets, window_start_utf16);
    let end_byte = byte_offset_for_utf16_floor(offsets, window_end_utf16);
    let preview = line
        .get(start_byte..end_byte.max(start_byte))
        .unwrap_or("")
        .to_owned();
    let column = match_start_utf16.saturating_sub(window_start_utf16);
    (preview, column)
}

#[cfg(test)]
mod tests;
