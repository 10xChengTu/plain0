//! Byte-level backpressure gate between one terminal session's pty reader
//! thread and its consumer, independent of (and a layer beneath) the bounded
//! `sync_channel` `service.rs` also puts between the reader and delivery
//! threads as a structural defense-in-depth backstop. This is the *real*,
//! protocol-level flow control: the consumer (frontend, in the eventual S2
//! wiring; a test harness here in S1) must explicitly [`FlowControl::ack`]
//! bytes it has processed, exactly mirroring the upstream ack-based protocol
//! `docs/research/2026-07-24-pty-terminal.md`'s "调研结论" section documents
//! (`FlowControlConstants`: high 100000 / low 5000).
//!
//! # Hysteresis
//!
//! Pausing and resuming use two different thresholds (rather than one) on
//! purpose: without this, a reader hovering exactly at one shared threshold
//! could pause and resume every single read, thrashing. Once
//! [`TERMINAL_FLOW_HIGH_WATER_MARK`] is reached the reader stays paused
//! until the unacknowledged count drops all the way down to
//! [`TERMINAL_FLOW_LOW_WATER_MARK`] (not merely "below high") — the `paused`
//! flag in [`FlowInner`], not a direct comparison against
//! `TERMINAL_FLOW_HIGH_WATER_MARK`, is what the reader's wait loop actually
//! checks.

use std::sync::{Condvar, Mutex};

/// Unacknowledged-byte high-water mark: reaching or exceeding this pauses
/// the reader (it will not issue another `read()` until the count drops to
/// [`TERMINAL_FLOW_LOW_WATER_MARK`]). Matches upstream's own
/// `FlowControlConstants.HIGH_WATER_MARK` magnitude.
pub(crate) const TERMINAL_FLOW_HIGH_WATER_MARK: usize = 100_000;
/// Unacknowledged-byte low-water mark: a paused reader resumes once the
/// count drops to or below this. Matches upstream's own
/// `FlowControlConstants.LOW_WATER_MARK` magnitude.
pub(crate) const TERMINAL_FLOW_LOW_WATER_MARK: usize = 5_000;

#[derive(Default)]
struct FlowInner {
    unacked_bytes: usize,
    paused: bool,
    cancelled: bool,
}

/// Shared flow-control state for exactly one terminal session. The reader
/// thread is the sole caller of [`Self::wait_until_clear_to_read`] and
/// [`Self::record_read`]; any other thread (an `ack`/`kill`/`close_window`
/// caller) calls [`Self::ack`]/[`Self::cancel`].
pub(crate) struct FlowControl {
    inner: Mutex<FlowInner>,
    condvar: Condvar,
}

impl FlowControl {
    pub(crate) fn new() -> Self {
        Self {
            inner: Mutex::new(FlowInner::default()),
            condvar: Condvar::new(),
        }
    }

    /// Blocks the calling thread while paused, waking only once the reader
    /// is clear to issue its next `read()` (or the session is cancelled).
    /// Returns `false` when the wait ended because of cancellation — the
    /// caller must stop reading and exit its loop rather than attempt
    /// another read.
    pub(crate) fn wait_until_clear_to_read(&self) -> bool {
        let mut state = lock(&self.inner);
        while !state.cancelled && state.paused {
            state = self
                .condvar
                .wait(state)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        !state.cancelled
    }

    /// Records that the reader thread has just read `bytes` more from the
    /// pty master and is now waiting on them to be acknowledged; pauses
    /// (for the *next* call to [`Self::wait_until_clear_to_read`]) once the
    /// running total reaches the high-water mark.
    pub(crate) fn record_read(&self, bytes: usize) {
        let mut state = lock(&self.inner);
        state.unacked_bytes = state.unacked_bytes.saturating_add(bytes);
        if state.unacked_bytes >= TERMINAL_FLOW_HIGH_WATER_MARK {
            state.paused = true;
        }
    }

    /// Reduces the unacknowledged byte count by `bytes`, saturating at
    /// zero: an over-generous or duplicate ack is tolerated rather than
    /// treated as an error, matching the upstream protocol's own tolerant
    /// `acknowledgeDataEvent` contract. Resumes (and wakes) a paused reader
    /// once the count has dropped to or below the low-water mark.
    pub(crate) fn ack(&self, bytes: usize) {
        let mut state = lock(&self.inner);
        state.unacked_bytes = state.unacked_bytes.saturating_sub(bytes);
        if state.paused && state.unacked_bytes <= TERMINAL_FLOW_LOW_WATER_MARK {
            state.paused = false;
            drop(state);
            self.condvar.notify_all();
        }
    }

    /// Marks the session cancelled and wakes any reader currently paused,
    /// so `kill`/`close_window` cleanup never has to wait out a natural
    /// low-water-mark ack that may never come.
    pub(crate) fn cancel(&self) {
        let mut state = lock(&self.inner);
        state.cancelled = true;
        drop(state);
        self.condvar.notify_all();
    }

    #[cfg(test)]
    pub(crate) fn unacked_bytes(&self) -> usize {
        lock(&self.inner).unacked_bytes
    }

    #[cfg(test)]
    pub(crate) fn is_paused(&self) -> bool {
        lock(&self.inner).paused
    }
}

fn lock(mutex: &Mutex<FlowInner>) -> std::sync::MutexGuard<'_, FlowInner> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::{FlowControl, TERMINAL_FLOW_HIGH_WATER_MARK, TERMINAL_FLOW_LOW_WATER_MARK};

    #[test]
    fn stays_clear_below_the_high_water_mark() {
        let flow = FlowControl::new();
        flow.record_read(TERMINAL_FLOW_HIGH_WATER_MARK - 1);
        assert!(!flow.is_paused());
        assert!(flow.wait_until_clear_to_read());
    }

    #[test]
    fn reaching_the_high_water_mark_pauses_until_the_low_water_mark() {
        let flow = FlowControl::new();
        flow.record_read(TERMINAL_FLOW_HIGH_WATER_MARK);
        assert!(flow.is_paused());

        // Acking down to just above the low water mark must NOT resume yet
        // (hysteresis): only dropping to *at or below* the low water mark
        // does. Leaves `unacked_bytes == TERMINAL_FLOW_LOW_WATER_MARK + 1`
        // (strictly above the low mark), so this ack alone must not resume.
        let above_low = TERMINAL_FLOW_HIGH_WATER_MARK - (TERMINAL_FLOW_LOW_WATER_MARK + 1);
        flow.ack(above_low);
        assert!(
            flow.is_paused(),
            "must stay paused above the low water mark"
        );

        flow.ack(1);
        assert!(!flow.is_paused(), "must resume at the low water mark");
    }

    #[test]
    fn wait_until_clear_to_read_blocks_while_paused_and_unblocks_on_ack() {
        let flow = Arc::new(FlowControl::new());
        flow.record_read(TERMINAL_FLOW_HIGH_WATER_MARK);
        assert!(flow.is_paused());

        let waiter_flow = Arc::clone(&flow);
        let waiter = std::thread::spawn(move || waiter_flow.wait_until_clear_to_read());

        // Give the waiter thread every reasonable chance to actually reach
        // the condvar wait before we ack — if it raced ahead and returned
        // early despite still being paused, that would itself be the bug
        // under test, not a flaky harness.
        std::thread::sleep(Duration::from_millis(50));
        assert!(
            !waiter.is_finished(),
            "reader must still be parked while paused"
        );

        flow.ack(TERMINAL_FLOW_HIGH_WATER_MARK);
        assert!(waiter.join().unwrap());
    }

    #[test]
    fn cancel_wakes_a_paused_waiter_and_reports_cancelled() {
        let flow = Arc::new(FlowControl::new());
        flow.record_read(TERMINAL_FLOW_HIGH_WATER_MARK);

        let waiter_flow = Arc::clone(&flow);
        let waiter = std::thread::spawn(move || waiter_flow.wait_until_clear_to_read());
        std::thread::sleep(Duration::from_millis(50));

        flow.cancel();
        assert!(
            !waiter.join().unwrap(),
            "cancellation reports not-clear-to-read"
        );
    }

    #[test]
    fn an_over_generous_ack_saturates_at_zero_rather_than_underflowing() {
        let flow = FlowControl::new();
        flow.record_read(10);
        flow.ack(1_000_000);
        assert_eq!(flow.unacked_bytes(), 0);
    }
}
