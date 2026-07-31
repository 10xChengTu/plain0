use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tempfile::TempDir;

use super::{
    compile_query, start, start_with_capacity_and_before_send_hook_for_test,
    start_with_capacity_for_test,
};
use crate::search::dto::WorkspaceSearchTextQuery;
use crate::workspace::{RootId, WorkspaceRootLease, WorkspaceScope};

fn authorized_lease(root: &Path) -> WorkspaceRootLease {
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(root).unwrap();
    scope.lease(root_id).unwrap()
}

fn query(roots: Vec<RootId>, pattern: &str) -> WorkspaceSearchTextQuery {
    WorkspaceSearchTextQuery {
        roots,
        pattern: pattern.to_owned(),
        is_reg_exp: false,
        is_case_sensitive: false,
        is_word_match: false,
        exclude_globs: Vec::new(),
        max_results: 20_000,
        max_file_size: 8 * 1_024 * 1_024,
    }
}

fn noop_wake() -> Arc<dyn Fn() + Send + Sync> {
    Arc::new(|| {})
}

/// Polls until `done`, sleeping briefly between attempts; panics past a
/// generous overall deadline so a real regression hangs the test suite
/// visibly rather than looping forever. Returns the final poll's own
/// cumulative `limitHit`/`skipped` alongside every batch collected across
/// every poll in the loop.
fn poll_until_done(
    handle: &mut super::TextSearchHandle,
) -> crate::search::dto::WorkspaceSearchTextPollResult {
    poll_until_done_from(handle, 0)
}

fn poll_until_done_from(
    handle: &mut super::TextSearchHandle,
    start_cursor: u64,
) -> crate::search::dto::WorkspaceSearchTextPollResult {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut cursor = start_cursor;
    let mut batches = Vec::new();
    loop {
        let result = handle.poll(cursor).unwrap();
        cursor = result.next_cursor();
        batches.extend(result.batches().iter().cloned());
        if result.done() {
            return crate::search::dto::WorkspaceSearchTextPollResult::new(
                batches,
                cursor,
                true,
                result.limit_hit(),
                result.skipped(),
            );
        }
        assert!(Instant::now() < deadline, "search never completed");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn streams_matches_across_multiple_files_in_separate_batches() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "needle here\nplain line\n").unwrap();
    fs::write(temp.path().join("b.txt"), "another needle\n").unwrap();
    fs::write(temp.path().join("c.txt"), "nothing to see\n").unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);

    assert!(result.done());
    assert!(!result.limit_hit());
    assert_eq!(result.batches().len(), 2);
    let mut paths = result
        .batches()
        .iter()
        .map(|batch| batch.path().to_owned())
        .collect::<Vec<_>>();
    paths.sort();
    assert_eq!(paths, ["a.txt", "b.txt"]);
    let a_batch = result
        .batches()
        .iter()
        .find(|batch| batch.path() == "a.txt")
        .unwrap();
    assert_eq!(a_batch.matches().len(), 1);
    assert_eq!(a_batch.matches()[0].line(), 1);
    assert_eq!(a_batch.matches()[0].column(), 1);
    assert_eq!(a_batch.matches()[0].length(), 6);
    assert_eq!(a_batch.matches()[0].preview_text(), "needle here");
}

#[test]
fn case_insensitive_by_default_and_case_sensitive_when_requested() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "Needle\n").unwrap();

    let insensitive_lease = authorized_lease(temp.path());
    let insensitive = compile_query(&query(vec![insensitive_lease.root_id()], "needle")).unwrap();
    let mut handle = start(vec![insensitive_lease], insensitive, noop_wake());
    let result = poll_until_done(&mut handle);
    assert_eq!(result.batches().len(), 1);

    let sensitive_lease = authorized_lease(temp.path());
    let mut sensitive_query = query(vec![sensitive_lease.root_id()], "needle");
    sensitive_query.is_case_sensitive = true;
    let compiled = compile_query(&sensitive_query).unwrap();
    let mut handle = start(vec![sensitive_lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    assert_eq!(result.batches().len(), 0);
}

#[test]
fn word_match_only_matches_whole_words() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "needles and needle\n").unwrap();
    let lease = authorized_lease(temp.path());
    let mut word_query = query(vec![lease.root_id()], "needle");
    word_query.is_word_match = true;
    let compiled = compile_query(&word_query).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    assert_eq!(result.batches().len(), 1);
    assert_eq!(result.batches()[0].matches().len(), 1);
    // Only the standalone "needle" (not the "needle" inside "needles") matches.
    assert_eq!(result.batches()[0].matches()[0].column(), 13);
}

#[test]
fn regex_mode_supports_real_patterns_and_reports_syntax_errors() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "foo123bar\n").unwrap();
    let lease = authorized_lease(temp.path());
    let mut regex_query = query(vec![lease.root_id()], r"\d+");
    regex_query.is_reg_exp = true;
    let compiled = compile_query(&regex_query).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    assert_eq!(result.batches()[0].matches()[0].preview_text(), "foo123bar");
    assert_eq!(result.batches()[0].matches()[0].length(), 3);

    let temp2 = TempDir::new().unwrap();
    let lease2 = authorized_lease(temp2.path());
    let mut invalid_query = query(vec![lease2.root_id()], "(unclosed");
    invalid_query.is_reg_exp = true;
    let error = compile_query(&invalid_query).unwrap_err();
    assert_eq!(error.code(), "INVALID_SEARCH_REGEX");
}

#[test]
fn max_results_truncates_and_reports_limit_hit() {
    let temp = TempDir::new().unwrap();
    for name in ["a.txt", "b.txt", "c.txt"] {
        fs::write(temp.path().join(name), "needle\nneedle\n").unwrap();
    }
    let lease = authorized_lease(temp.path());
    let mut capped = query(vec![lease.root_id()], "needle");
    capped.max_results = 2;
    let compiled = compile_query(&capped).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    assert!(result.limit_hit());
    let total_matches: usize = result
        .batches()
        .iter()
        .map(|batch| batch.matches().len())
        .sum();
    assert_eq!(total_matches, 2);
}

#[test]
fn oversized_and_binary_files_are_skipped_and_counted_not_reported() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("normal.txt"), "needle\n").unwrap();
    fs::write(temp.path().join("huge.txt"), "needle\n".repeat(10)).unwrap();
    // A NUL byte after a would-otherwise-match "needle": proves a binary
    // file reports zero matches even for text found before the NUL, not
    // just that it is excluded overall. Kept under `max_file_size` so it is
    // rejected specifically by binary detection, not the size check below.
    fs::write(temp.path().join("binary.bin"), b"needle\0").unwrap();
    let lease = authorized_lease(temp.path());
    let mut small_cap = query(vec![lease.root_id()], "needle");
    small_cap.max_file_size = 10;
    let compiled = compile_query(&small_cap).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    assert_eq!(result.batches().len(), 1);
    assert_eq!(result.batches()[0].path(), "normal.txt");
    assert_eq!(result.skipped().oversize(), 1);
    assert_eq!(result.skipped().binary(), 1);
}

#[test]
fn multi_root_search_reports_matches_from_every_root() {
    let temp_a = TempDir::new().unwrap();
    let temp_b = TempDir::new().unwrap();
    fs::write(temp_a.path().join("a.txt"), "needle\n").unwrap();
    fs::write(temp_b.path().join("b.txt"), "needle\n").unwrap();
    let lease_a = authorized_lease(temp_a.path());
    let lease_b = authorized_lease(temp_b.path());
    let compiled =
        compile_query(&query(vec![lease_a.root_id(), lease_b.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease_a, lease_b], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    let mut paths = result
        .batches()
        .iter()
        .map(|batch| batch.path().to_owned())
        .collect::<Vec<_>>();
    paths.sort();
    assert_eq!(paths, ["a.txt", "b.txt"]);
}

#[test]
fn non_utf8_lines_are_skipped_without_failing_the_rest_of_the_file() {
    let temp = TempDir::new().unwrap();
    // An invalid UTF-8 byte (0xff) inside an otherwise plain-text line,
    // followed by a genuinely matching, valid line: the whole file must not
    // be dropped, only the unrepresentable line's match.
    let mut content = Vec::new();
    content.extend_from_slice(b"needle \xffbroken\n");
    content.extend_from_slice(b"needle valid\n");
    fs::write(temp.path().join("mixed.txt"), &content).unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    assert_eq!(result.batches().len(), 1);
    let matches = result.batches()[0].matches();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].line(), 2);
}

#[test]
fn preview_window_stays_anchored_on_the_match_for_a_very_long_line() {
    let temp = TempDir::new().unwrap();
    let padding = "x".repeat(400);
    let content = format!("{padding}needle{padding}\n");
    fs::write(temp.path().join("long.txt"), &content).unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    let matched = &result.batches()[0].matches()[0];
    let preview = matched.preview_text();
    assert!(preview.len() <= 256);
    let start = matched.column() as usize - 1;
    let end = start + matched.length() as usize;
    assert_eq!(&preview[start..end], "needle");
}

/// F040 S4: `column` is rebased relative to the truncated preview window for
/// a long line, but `absoluteColumn` must still point at the match's real
/// position within the *full* line — the exact correctness point a replace
/// edit range depends on. Proves both that `absoluteColumn` differs from
/// `column` here (the window really did rebase) and that it independently
/// locates "needle" in the untruncated original content.
#[test]
fn absolute_column_locates_the_match_in_the_full_line_even_when_the_preview_window_is_rebased() {
    let temp = TempDir::new().unwrap();
    let padding = "x".repeat(400);
    let content = format!("{padding}needle{padding}\n");
    fs::write(temp.path().join("long.txt"), &content).unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    let matched = &result.batches()[0].matches()[0];

    // The preview window was rebased to start at the match (proven by the
    // sibling test above), so the preview-relative column must not equal the
    // absolute one here.
    assert_ne!(matched.column(), matched.absolute_column());

    let full_line = format!("{padding}needle{padding}");
    let start = matched.absolute_column() as usize - 1;
    let end = start + matched.length() as usize;
    assert_eq!(&full_line[start..end], "needle");
    assert_eq!(start, padding.len());
}

/// A short line never truncates the preview window (it starts at column 1),
/// so `column` and `absoluteColumn` must coincide exactly — the common case.
#[test]
fn absolute_column_matches_preview_column_for_a_short_line() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "needle here\n").unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    let matched = &result.batches()[0].matches()[0];
    assert_eq!(matched.column(), matched.absolute_column());
    assert_eq!(matched.absolute_column(), 1);
}

/// A multi-byte UTF-8 line (each `é` is 2 bytes but 1 UTF-16 code unit):
/// proves `absoluteColumn` is computed in UTF-16 units against the full
/// line, not raw bytes — an off-by-encoding error here would silently
/// corrupt every replace on a non-ASCII line.
#[test]
fn absolute_column_is_utf16_code_units_not_bytes_on_a_multibyte_line() {
    let temp = TempDir::new().unwrap();
    // "café " is 5 chars / 6 bytes ('é' is 2 bytes) / 5 UTF-16 units.
    fs::write(temp.path().join("a.txt"), "café needle\n").unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    let matched = &result.batches()[0].matches()[0];
    // 1-indexed UTF-16 column: "café " is 5 UTF-16 units, so "needle" starts
    // at column 6 — not 7, which a naive byte-offset-based column would
    // report instead.
    assert_eq!(matched.absolute_column(), 6);
    assert_eq!(matched.column(), matched.absolute_column());
}

#[test]
fn cancelling_an_in_progress_search_stops_the_worker_and_frees_the_receiver() {
    let temp = TempDir::new().unwrap();
    for index in 0..20 {
        fs::write(temp.path().join(format!("f{index}.txt")), "needle\n").unwrap();
    }
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    // Capacity 1 keeps the producer thread alive and likely still working
    // (or blocked) when we cancel by dropping the handle immediately.
    let handle = start_with_capacity_for_test(vec![lease], compiled, noop_wake(), 1);
    drop(handle); // Drop::drop -> close(): cancel flag + join, must not hang.
}

#[test]
fn cancelling_while_the_bounded_queue_is_full_disconnects_before_joining() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "needle\n").unwrap();
    fs::write(temp.path().join("b.txt"), "needle\n").unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();
    let (attempt_tx, attempt_rx) = std::sync::mpsc::channel::<()>();
    let handle = start_with_capacity_and_before_send_hook_for_test(
        vec![lease],
        compiled,
        noop_wake(),
        1,
        Arc::new(move || {
            let _ = attempt_tx.send(());
        }),
    );

    let long_timeout = Duration::from_secs(5);
    attempt_rx
        .recv_timeout(long_timeout)
        .expect("producer should fill the queue with batch a");
    attempt_rx
        .recv_timeout(long_timeout)
        .expect("producer should attempt batch b and block on the full queue");

    let (closed_tx, closed_rx) = std::sync::mpsc::channel::<()>();
    let closer = std::thread::spawn(move || {
        drop(handle);
        closed_tx.send(()).unwrap();
    });
    closed_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("dropping a full-queue search must disconnect send before joining");
    closer.join().unwrap();
}

#[test]
fn cancelling_an_already_completed_search_is_a_harmless_no_op() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "needle\n").unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let _ = poll_until_done(&mut handle);
    handle.close();
    handle.close(); // idempotent: a second close must not panic.
}

/// Uses `before_send`'s rendezvous instead of `sleep`-and-hope: the hook
/// fires synchronously right before the producer *attempts* every send
/// (including one that is about to block), so receiving the Nth signal on
/// `rx` is deterministic proof the producer has reached candidate N —
/// avoiding a real race the naive "sleep, then assert exactly one batch
/// arrived" version of this test has: `poll`'s own `try_recv` drain loop can,
/// after freeing one slot, keep looping fast enough to also observe a
/// just-unblocked second batch before returning, depending on how quickly
/// the OS reschedules the (now-unblocked) producer thread.
#[test]
fn backpressure_blocks_the_producer_until_the_consumer_drains_a_batch() {
    let temp = TempDir::new().unwrap();
    // Sorted-name order matches the traversal's own sorted iteration, so the
    // hook fires in this exact a/b/c order.
    fs::write(temp.path().join("a.txt"), "needle\n").unwrap();
    fs::write(temp.path().join("b.txt"), "needle\n").unwrap();
    fs::write(temp.path().join("c.txt"), "needle\n").unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let mut handle = start_with_capacity_and_before_send_hook_for_test(
        vec![lease],
        compiled,
        noop_wake(),
        1,
        Arc::new(move || {
            let _ = tx.send(());
        }),
    );

    let long_timeout = Duration::from_secs(5);
    rx.recv_timeout(long_timeout)
        .expect("producer should attempt to send batch a promptly");
    rx.recv_timeout(long_timeout)
        .expect("producer should attempt to send batch b right after a's send succeeds");
    // At this point batch b's send is either about to block or already
    // blocked (capacity 1, and a's batch has not been drained yet). Give the
    // scheduler a comfortably generous window and confirm the producer has
    // NOT been able to reach file c — the direct, deterministic signature of
    // a blocked send, not an inference from elapsed wall-clock time alone.
    assert_eq!(
        rx.recv_timeout(Duration::from_millis(300)),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout),
        "producer must still be blocked sending batch b while capacity is exhausted by batch a"
    );

    // Draining now must contain batch "a" (the only one structurally able to
    // be sitting in a capacity-1 channel up to this point) and must not
    // include "c" (confirmed above to not even have been attempted yet).
    // Whether "b"'s already-unblocked send also lands in this same drain is
    // an OS-scheduling race this test does not need to pin down either way —
    // once a slot is freed, the standard library's own bounded channel is
    // free to hand it to the parked sender immediately, so a batch beyond
    // "a" may or may not already be visible in this exact call. What matters
    // for backpressure is what was proven above: nothing reached "c" while
    // capacity was exhausted.
    let first = handle.poll(0).unwrap();
    assert!(!first.batches().is_empty());
    assert_eq!(first.batches()[0].path(), "a.txt");
    assert!(first.batches().iter().all(|batch| batch.path() != "c.txt"));
    assert!(!first.done());

    // Draining frees the one slot, which must unblock the pending send for
    // batch b (if it had not already landed above) and let the producer
    // reach (and signal for) c.
    rx.recv_timeout(long_timeout)
        .expect("draining the queue should unblock the pending send for batch c");

    let result = poll_until_done_from(&mut handle, first.next_cursor());
    let mut paths = first
        .batches()
        .iter()
        .chain(result.batches())
        .map(|batch| batch.path().to_owned())
        .collect::<Vec<_>>();
    paths.sort();
    assert_eq!(paths, ["a.txt", "b.txt", "c.txt"]);
}

#[test]
fn poll_rejects_a_cursor_that_does_not_match_what_was_already_delivered() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "needle\n").unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let _ = poll_until_done(&mut handle);
    let error = handle.poll(999).unwrap_err();
    assert_eq!(error.code(), "INVALID_SEARCH_REQUEST");
}

#[test]
fn empty_directory_completes_immediately_with_no_matches() {
    let temp = TempDir::new().unwrap();
    let lease = authorized_lease(temp.path());
    let compiled = compile_query(&query(vec![lease.root_id()], "needle")).unwrap();

    let mut handle = start(vec![lease], compiled, noop_wake());
    let result = poll_until_done(&mut handle);
    assert_eq!(result.batches().len(), 0);
    assert!(!result.limit_hit());
}
