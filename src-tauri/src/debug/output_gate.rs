//! `F100` S5 — `output`-event backpressure gate. `docs/research/2026-07-28-generic-dap.md`'s
//! own "决策 4" named this as the one event kind needing a bound: a debuggee
//! that writes to stdout/stderr in a tight loop can make its adapter forward
//! `output` events far faster than a real user can read the Debug Console, or
//! faster than the frontend's own JS event loop can keep up with acking —
//! unlike `stackTrace`/`variables` (already bounded by DAP's own
//! `levels`/`start`/`count` pagination and [`super::framing::MAX_DAP_MESSAGE_BYTES`]'s
//! per-message cap), nothing else in this domain bounds a *stream* of many
//! small events.
//!
//! # Why this is not `terminal::flow::FlowControl` reused verbatim
//!
//! `flow::FlowControl` gates a **blocking reader thread**: pausing means
//! parking a real OS thread on a condvar until an ack arrives, which is why
//! it needs two watermarks (high/low) for hysteresis — thrashing there would
//! mean repeatedly parking and waking that thread. This gate does not block
//! anything: [`super::session::dispatch_message`] calls [`OutputGate::on_output`]
//! synchronously, on the reader thread, once per already-arrived `output`
//! event, and must return immediately either way (there is no legitimate
//! reason to make the reader thread itself wait — that would stall dispatch
//! of every *other* message kind sharing the same reader loop, including
//! request responses and `stopped`/`terminated` events, which must never be
//! held hostage by a chatty debuggee). So the "gate" here is a same-thread
//! decision — emit now, or merge into a bounded per-category buffer instead —
//! not a pause/resume of anything. A single high-water mark on the count of
//! emitted-but-not-yet-acked events, combined with "once anything is merged,
//! stay merging until an ack frees enough credit to drain it", already gives
//! the same one-way transition property hysteresis exists to provide,
//! without a second watermark: there is no blocking wait to thrash.
//!
//! # Merge, don't drop outright — but cap the merge buffer too
//!
//! Once gated, further `output` text for the same `category` is concatenated
//! into a bounded ring buffer (oldest bytes dropped first once
//! [`DEBUG_OUTPUT_MERGE_CAP_BYTES`] is exceeded — the most *recent* context is
//! judged more useful than the oldest, the same "keep the tail" intuition
//! ordinary terminal scrollback caps already embody) rather than being
//! discarded the instant the gate engages, and rather than accumulating
//! without bound. Every dropped byte is counted
//! ([`FlushedOutput::elided_bytes`]/[`FlushedOutput::elided_lines`]) and
//! surfaced to the user once the merged buffer is finally flushed — see
//! [`super::session::DebugSession::ack_output`]'s own doc comment for the
//! `plain/outputElided` notice this drives. Silently dropping output with no
//! trace at all is exactly what this feature's own task instructions call out
//! as unacceptable.
//!
//! # Category buckets are themselves bounded ([`DEBUG_OUTPUT_MAX_CATEGORIES`])
//!
//! `category` is an adapter-supplied string, not a closed enum this module
//! controls — a hostile/malformed adapter emitting a distinct `category`
//! value on every single `output` event would otherwise let the merge map
//! grow one entry per distinct string forever, defeating the per-category
//! byte cap by multiplying it by an unbounded number of buckets. Once
//! [`DEBUG_OUTPUT_MAX_CATEGORIES`] distinct categories are already tracked, a
//! new, never-seen-before category is folded into a single shared overflow
//! bucket instead of minting a new one — bounding total worst-case merged
//! memory to `DEBUG_OUTPUT_MAX_CATEGORIES * DEBUG_OUTPUT_MERGE_CAP_BYTES`
//! regardless of how many distinct category strings an adapter sends.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Emitted-but-not-yet-acked event count at (or above) which a fresh
/// `output` event stops being emitted immediately and starts being merged
/// instead. Deliberately generous for a real, healthy session (a normal
/// Debug Console session acks within one JS event-loop turn of receiving
/// each event, so this threshold is essentially never reached in ordinary
/// use) while still bounding a genuinely chatty debuggee — see `debug::mod`'s
/// own S5 report for the real flood benchmark this was validated against.
pub(crate) const DEBUG_OUTPUT_HIGH_WATER_EVENTS: u64 = 64;

/// Per-category merge buffer cap, in UTF-8 bytes — see the module doc's
/// "merge, don't drop outright" section. Generous enough to hold a
/// meaningful amount of recent context (a few thousand lines of ordinary log
/// text) while still bounding worst-case memory for a single category.
pub(crate) const DEBUG_OUTPUT_MERGE_CAP_BYTES: usize = 1_048_576; // 1 MiB

/// Distinct `category` buckets tracked at once — see the module doc's
/// "category buckets are themselves bounded" section. The real DAP spec
/// defines exactly five (`console`/`important`/`stdout`/`stderr`/`telemetry`)
/// — 16 is generous headroom for a handful of unrecognized-but-legitimate
/// extension values while still bounding a hostile adapter minting an
/// unbounded number of distinct category strings.
pub(crate) const DEBUG_OUTPUT_MAX_CATEGORIES: usize = 16;

/// The shared overflow bucket every category beyond
/// [`DEBUG_OUTPUT_MAX_CATEGORIES`] folds into — chosen to never collide with
/// a real DAP `OutputEvent.category` value (the spec's own enum is a closed,
/// short set of lowercase words; this contains characters no real category
/// uses) and to be visually obviously synthetic if it ever reaches a UI.
const OUTPUT_OVERFLOW_CATEGORY: &str = "plain/outputOverflow";

struct MergedCategory {
    text: String,
    elided_bytes: u64,
    elided_lines: u64,
}

impl MergedCategory {
    fn new() -> Self {
        Self {
            text: String::new(),
            elided_bytes: 0,
            elided_lines: 0,
        }
    }

    /// Appends `text`, then trims from the front (oldest first) down to
    /// [`DEBUG_OUTPUT_MERGE_CAP_BYTES`] if needed — always trims on a `char`
    /// boundary (this text is real UTF-8 `output` content, never raw bytes
    /// this module invented) so the retained remainder is always valid
    /// `String` content, never a byte sequence split mid-codepoint.
    fn push(&mut self, text: &str) {
        self.text.push_str(text);
        if self.text.len() <= DEBUG_OUTPUT_MERGE_CAP_BYTES {
            return;
        }
        let overflow = self.text.len() - DEBUG_OUTPUT_MERGE_CAP_BYTES;
        let mut boundary = overflow;
        while boundary < self.text.len() && !self.text.is_char_boundary(boundary) {
            boundary += 1;
        }
        let dropped: String = self.text.drain(..boundary).collect();
        self.elided_bytes += dropped.len() as u64;
        self.elided_lines += dropped.bytes().filter(|byte| *byte == b'\n').count() as u64;
    }
}

/// One merged category's flush, produced by [`OutputGate::ack`] — see
/// [`super::session::DebugSession::ack_output`] for how each of these becomes
/// a (possibly preceded-by-`plain/outputElided`) real `output` event.
pub(crate) struct FlushedOutput {
    pub(crate) category: String,
    pub(crate) text: String,
    pub(crate) sequence: u64,
    pub(crate) elided_bytes: u64,
    pub(crate) elided_lines: u64,
}

/// [`OutputGate::on_output`]'s result: either the event is clear to emit
/// immediately (carrying the sequence number [`super::session::DebugSession::handle_output_event`]
/// attaches to it) or it has been merged and nothing should be emitted right
/// now.
pub(crate) enum OutputGateOutcome {
    Emit(u64),
    Buffered,
}

struct OutputGateState {
    next_sequence: u64,
    highest_emitted: u64,
    highest_acked: u64,
    merged: HashMap<String, MergedCategory>,
}

impl OutputGateState {
    fn unacked(&self) -> u64 {
        self.highest_emitted.saturating_sub(self.highest_acked)
    }

    /// The bucket key `category` should merge into — `category` itself, if
    /// either already tracked or there is still room for a new bucket;
    /// [`OUTPUT_OVERFLOW_CATEGORY`] otherwise. See the module doc's "category
    /// buckets are themselves bounded" section. One slot is always reserved
    /// for the overflow bucket itself once it is ever needed — without this,
    /// admitting a brand new *real* category bucket right up to the full cap
    /// could leave no room left for the overflow bucket the very next
    /// never-seen-before category would need to fall back to, letting total
    /// tracked buckets briefly exceed [`DEBUG_OUTPUT_MAX_CATEGORIES`] by one.
    fn bucket_key(&self, category: &str) -> String {
        if self.merged.contains_key(category) {
            return category.to_owned();
        }
        let real_category_capacity = if self.merged.contains_key(OUTPUT_OVERFLOW_CATEGORY) {
            DEBUG_OUTPUT_MAX_CATEGORIES
        } else {
            DEBUG_OUTPUT_MAX_CATEGORIES - 1
        };
        if self.merged.len() < real_category_capacity {
            category.to_owned()
        } else {
            OUTPUT_OVERFLOW_CATEGORY.to_owned()
        }
    }
}

/// Per-session `output`-event backpressure gate — see the module doc for the
/// full design. One instance lives on every [`super::session::DebugSession`].
pub(crate) struct OutputGate {
    state: Mutex<OutputGateState>,
}

impl OutputGate {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(OutputGateState {
                next_sequence: 1,
                highest_emitted: 0,
                highest_acked: 0,
                merged: HashMap::new(),
            }),
        }
    }

    /// Called once per real DAP `output` event, in the reader thread's own
    /// arrival order. Emits immediately only when there is no already-merged
    /// backlog for *any* category and credit remains — merging while any
    /// backlog exists at all (even for a different category) is what keeps
    /// this gate from ever reordering a category's own output relative to
    /// itself (a freshly-arriving chunk for a category that already has
    /// merged, not-yet-flushed content must never overtake it).
    pub(crate) fn on_output(&self, category: &str, text: &str) -> OutputGateOutcome {
        let mut state = lock(&self.state);
        if state.merged.is_empty() && state.unacked() < DEBUG_OUTPUT_HIGH_WATER_EVENTS {
            let sequence = state.next_sequence;
            state.next_sequence += 1;
            state.highest_emitted = sequence;
            return OutputGateOutcome::Emit(sequence);
        }
        let key = state.bucket_key(category);
        state
            .merged
            .entry(key)
            .or_insert_with(MergedCategory::new)
            .push(text);
        OutputGateOutcome::Buffered
    }

    /// Acknowledges every emitted event through `acked_sequence` (tolerant of
    /// a stale, duplicate, or out-of-order-arriving ack — only ever moves
    /// [`OutputGateState::highest_acked`] forward, and only up to
    /// `highest_emitted`, mirroring `flow::FlowControl::ack`'s identical
    /// tolerant contract), then drains as many merged categories as credit
    /// now allows (each becomes one [`FlushedOutput`], consuming one more
    /// unit of credit) — possibly zero, possibly all of them, depending on
    /// how much credit the ack actually freed and how many categories are
    /// currently merged.
    pub(crate) fn ack(&self, acked_sequence: u64) -> Vec<FlushedOutput> {
        let mut state = lock(&self.state);
        let highest_emitted = state.highest_emitted;
        state.highest_acked = state.highest_acked.max(acked_sequence.min(highest_emitted));

        let mut flushed = Vec::new();
        while state.unacked() < DEBUG_OUTPUT_HIGH_WATER_EVENTS {
            // Pop an arbitrary (but deterministic per-call) entry — draining
            // order across *different* categories carries no ordering
            // requirement (each category's own internal order is preserved
            // by `MergedCategory::push`'s simple append; nothing here ever
            // reorders bytes within one category).
            let Some(key) = state.merged.keys().next().cloned() else {
                break;
            };
            let entry = state
                .merged
                .remove(&key)
                .expect("key was just read from this same map");
            let sequence = state.next_sequence;
            state.next_sequence += 1;
            state.highest_emitted = sequence;
            flushed.push(FlushedOutput {
                category: key,
                text: entry.text,
                sequence,
                elided_bytes: entry.elided_bytes,
                elided_lines: entry.elided_lines,
            });
        }
        flushed
    }

    #[cfg(test)]
    pub(crate) fn merged_category_count_for_test(&self) -> usize {
        lock(&self.state).merged.len()
    }

    #[cfg(test)]
    pub(crate) fn unacked_for_test(&self) -> u64 {
        lock(&self.state).unacked()
    }
}

fn lock(mutex: &Mutex<OutputGateState>) -> MutexGuard<'_, OutputGateState> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests;
