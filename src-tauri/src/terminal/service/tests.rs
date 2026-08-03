//! Real-subprocess Rust tests for `TerminalService`. `sh -c '...'` and bare
//! `cat`/`sleep` fixtures are used freely here — this file's name ends in
//! `tests.rs`, the domain-wide carve-out `scripts/plain/boundary-contracts.mjs`
//! grants test fixtures (see `terminal::mod`'s module doc); production code
//! under this domain never constructs a shell command string this way.

use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use libghostty_vt::key;
use portable_pty::CommandBuilder;
use tempfile::TempDir;

use super::{FrameEmitGate, TerminalExitStatus, TerminalOutputSink, TerminalService};
use crate::terminal::dto::TerminalSessionId;
use crate::terminal::flow::TERMINAL_FLOW_HIGH_WATER_MARK;
use crate::terminal::vt;
use crate::terminal::MAX_TERMINAL_SESSIONS_PER_WINDOW;
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

const VALID_ROOT_ID: &str = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<std::path::PathBuf>,
}

impl FakePicker {
    fn selected(paths: Vec<std::path::PathBuf>) -> Self {
        Self { paths }
    }
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn workspace_with_root(window_label: &str, root_path: &Path) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(vec![root_path.to_path_buf()]);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

/// Authorizes and grants trust for `window_label` in one call — every
/// spawn-behavior test needs this; only the trust-gate tests deliberately
/// skip the grant.
fn trusted_workspace(
    window_label: &str,
    root: &Path,
    trust_base: &Path,
) -> (WorkspaceService, TrustService) {
    let workspace = workspace_with_root(window_label, root);
    let trust = TrustService::new(trust_base.to_path_buf());
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    (workspace, trust)
}

fn root_id_at(workspace: &WorkspaceService, window_label: &str, index: usize) -> RootId {
    workspace.snapshot(window_label).unwrap().roots()[index].root_id()
}

fn arbitrary_root_id() -> RootId {
    RootId::parse_v4_wire(VALID_ROOT_ID).unwrap()
}

/// Records every `(sequence, frame)` this session's vt thread emitted, plus
/// its exit status — the frame-based counterpart to F070 S2's raw-byte
/// `RecordingSink`.
#[derive(Default)]
struct RecordingState {
    frames: Vec<(u64, vt::DirtyFrame)>,
    exit: Option<TerminalExitStatus>,
}

struct RecordingSink {
    inner: Mutex<RecordingState>,
}

impl RecordingSink {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(RecordingState::default()),
        })
    }

    fn frame_count(&self) -> usize {
        self.inner.lock().unwrap().frames.len()
    }

    fn sequences(&self) -> Vec<u64> {
        self.inner
            .lock()
            .unwrap()
            .frames
            .iter()
            .map(|(sequence, _)| *sequence)
            .collect()
    }

    fn exit_status(&self) -> Option<TerminalExitStatus> {
        self.inner.lock().unwrap().exit.clone()
    }

    /// Reconstructs the current screen text by applying every recorded
    /// frame's dirty rows onto a virtual grid, in delivery order — exactly
    /// what a real renderer consuming this event stream would do. Rows
    /// never reported dirty by any frame simply do not appear.
    fn rendered_screen_text(&self) -> String {
        let state = self.inner.lock().unwrap();
        let mut grid: std::collections::BTreeMap<usize, String> = std::collections::BTreeMap::new();
        for (_, frame) in &state.frames {
            for row in &frame.rows_data {
                let text: String = row
                    .cells
                    .iter()
                    .flat_map(|cell| cell.graphemes.iter())
                    .collect();
                grid.insert(row.row_index, text);
            }
        }
        grid.into_values().collect::<Vec<_>>().join("\n")
    }
}

impl TerminalOutputSink for RecordingSink {
    fn emit_frame(&self, _session_id: TerminalSessionId, sequence: u64, frame: vt::DirtyFrame) {
        self.inner.lock().unwrap().frames.push((sequence, frame));
    }

    fn emit_exit(&self, _session_id: TerminalSessionId, status: TerminalExitStatus) {
        self.inner.lock().unwrap().exit = Some(status);
    }
}

/// Polls `condition` until it is true or `timeout` elapses, returning
/// whether it ever became true. Generous timeouts below exist only to
/// absorb real OS scheduling jitter around genuinely fast operations (a
/// process spawn, a few bytes through a pty) — none of these tests rely on
/// any specific wall-clock *duration* being met, only on an eventual state
/// change, so this is not a source of flakiness in the way a fixed `sleep`
/// race would be.
fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if condition() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Repeatedly acks whatever frame sequence the sink has most recently
/// recorded (simulating a real frontend rendering and acking each frame as
/// it arrives) until `predicate` is satisfied against the reconstructed
/// screen text, or `timeout` elapses. Necessary because the vt thread's
/// single-frame-in-flight emission credit (see `service.rs`'s module doc)
/// means content beyond the first frame is never emitted unless something
/// acks — exactly like a real frontend would.
fn wait_for_rendered_text(
    terminal: &TerminalService,
    window_label: &str,
    session_id: TerminalSessionId,
    sink: &RecordingSink,
    timeout: Duration,
    predicate: impl Fn(&str) -> bool,
) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if predicate(&sink.rendered_screen_text()) {
            return true;
        }
        if let Some(&latest) = sink.sequences().last() {
            let _ = terminal.ack(window_label, session_id, latest);
        }
        if Instant::now() >= deadline {
            return predicate(&sink.rendered_screen_text());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn sh_c(script: &str) -> CommandBuilder {
    let mut command = CommandBuilder::new("sh");
    command.args(["-c", script]);
    command
}

/// `cat -v` displays non-printing bytes (including C0 controls like ESC) in
/// caret notation (e.g. ESC → `^[`) instead of the plain `cat` behavior of
/// either passing them through invisibly or (for a real terminal emulator)
/// having them reinterpreted as VT control sequences once echoed back
/// through the VT mirror — exactly what a raw-byte-injection test (key
/// encoding, focus events) needs in order to assert on visible rendered
/// text.
fn cat_v() -> CommandBuilder {
    let mut command = CommandBuilder::new("cat");
    command.args(["-v"]);
    command
}

#[allow(clippy::too_many_arguments)]
fn start_test_session(
    terminal: &TerminalService,
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    command: CommandBuilder,
    sink: Arc<RecordingSink>,
) -> TerminalSessionId {
    block_on(terminal.start_with_command_for_test(
        trust,
        workspace,
        window_label,
        root_id_at(workspace, window_label, 0),
        None,
        80,
        24,
        command,
        sink,
    ))
    .expect("session starts")
}

// -----------------------------------------------------------------------
// FrameEmitGate: pure, deterministic unit tests (no subprocess involved)
// -----------------------------------------------------------------------

#[test]
fn frame_emit_gate_single_credit_and_tolerant_ack_semantics() {
    let mut session = vt::VtSession::new(10, 3).unwrap();
    let mut gate = FrameEmitGate::new();

    // A brand new `VtSession`'s very first `dirty_frame()` call always
    // reports `Dirty::Full` (nothing has been rendered yet — see
    // `vt/tests.rs`'s own `feeding_sgr_and_newlines_produces_correct_dirty_row_content`
    // comment), regardless of whether anything has been fed yet. Consume
    // and ack that initial frame first so the rest of this test can reason
    // about the gate's steady-state behavior from a clean slate.
    let (seq_initial, _initial_frame) = gate
        .try_take_frame(&mut session)
        .expect("construction itself produces an initial full-redraw frame");
    assert_eq!(seq_initial, 0);
    gate.ack(seq_initial);

    session.feed(b"one");
    let (seq0, _frame0) = gate
        .try_take_frame(&mut session)
        .expect("first content frame available");
    assert_eq!(seq0, 1);

    // Credit is now exhausted: feeding more must not yield a second frame,
    // even though the terminal's own state keeps advancing underneath.
    session.feed(b"two");
    assert!(
        gate.try_take_frame(&mut session).is_none(),
        "no frame should emit while the previous one is unacknowledged"
    );

    // Acking the outstanding frame frees the credit; the content fed while
    // credit was exhausted is exactly what the coalesced next frame reports.
    gate.ack(seq0);
    let (seq1, frame1) = gate
        .try_take_frame(&mut session)
        .expect("credit freed by the matching ack");
    assert_eq!(seq1, 2);
    let text: String = frame1
        .rows_data
        .iter()
        .flat_map(|row| row.cells.iter())
        .flat_map(|cell| cell.graphemes.iter())
        .collect();
    assert!(text.contains("two"), "got {text:?}");

    // Credit is exhausted again by the frame we just took.
    session.feed(b"three");
    assert!(gate.try_take_frame(&mut session).is_none());

    // A stale ack (the *previous* frame's sequence, already consumed) must
    // not free the new credit.
    gate.ack(seq0);
    assert!(
        gate.try_take_frame(&mut session).is_none(),
        "a stale ack must not free credit for a later, still-outstanding frame"
    );

    // Acking the actually-outstanding sequence does free it.
    gate.ack(seq1);
    let (seq2, _frame2) = gate
        .try_take_frame(&mut session)
        .expect("credit freed by the correct ack");
    assert_eq!(seq2, 3);
}

#[test]
fn frame_emit_gate_does_not_spend_credit_or_a_sequence_number_on_a_clean_snapshot() {
    let mut session = vt::VtSession::new(10, 3).unwrap();
    let mut gate = FrameEmitGate::new();

    session.feed(b"content");
    let (seq0, _) = gate.try_take_frame(&mut session).unwrap();
    assert_eq!(seq0, 0);
    gate.ack(seq0);

    // Nothing fed since the last drain: the snapshot is clean, so this must
    // not advance the sequence counter or spend credit.
    assert!(gate.try_take_frame(&mut session).is_none());

    session.feed(b"more");
    let (seq1, _) = gate.try_take_frame(&mut session).unwrap();
    assert_eq!(
        seq1, 1,
        "the skipped clean attempt must not have consumed a sequence number"
    );
}

// -----------------------------------------------------------------------
// Integration: raw byte round trip, VT mirror, resize, cwd, lifecycle
// -----------------------------------------------------------------------

#[test]
fn echo_round_trip_through_cat() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        CommandBuilder::new("cat"),
        Arc::clone(&sink),
    );

    block_on(terminal.input_text("main", session_id, "hello-plain-terminal\n".to_owned())).unwrap();

    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(5),
            |text| text.contains("hello-plain-terminal"),
        ),
        "cat should have echoed the input back: got {:?}",
        sink.rendered_screen_text()
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

/// Exercises the VT integration through the real session machinery, not
/// just `vt.rs`'s own isolated unit tests: feeding a live session's pty
/// output through to a `latest_vt_frame_for_test`-visible `DirtyFrame`, and
/// confirming the VT mirror's per-session state disappears alongside the
/// rest of the session on `kill` — i.e. it does not outlive (or otherwise
/// interfere with) the existing session lifecycle this test file's other
/// cases already cover.
#[test]
fn vt_dirty_frame_reflects_real_session_output_and_is_gone_after_kill() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        CommandBuilder::new("cat"),
        Arc::clone(&sink),
    );

    block_on(terminal.input_text("main", session_id, "vt-integration-probe\n".to_owned())).unwrap();

    assert!(
        wait_until(Duration::from_secs(5), || {
            terminal
                .latest_vt_frame_for_test("main", session_id)
                .ok()
                .flatten()
                .is_some_and(|frame| {
                    frame.rows_data.iter().any(|row| {
                        row.cells
                            .iter()
                            .flat_map(|cell| cell.graphemes.iter())
                            .collect::<String>()
                            .contains("vt-integration-probe")
                    })
                })
        }),
        "the VT mirror should observe the same output that eventually gets emitted"
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();

    assert_eq!(
        terminal
            .latest_vt_frame_for_test("main", session_id)
            .unwrap_err()
            .code(),
        "TERMINAL_SESSION_NOT_FOUND",
        "the VT mirror's state must not outlive the killed session"
    );
}

/// Directly tests the new VT → frontend frame delivery backpressure through
/// a real session (rather than only `FrameEmitGate`'s own pure unit tests
/// above): a second frame must not appear until the first is acked, and
/// once it is, the coalesced content fed in the meantime is what the next
/// frame reports.
#[test]
fn frame_emission_is_gated_until_the_previous_frame_is_acked() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        CommandBuilder::new("cat"),
        Arc::clone(&sink),
    );

    block_on(terminal.input_text("main", session_id, "first\n".to_owned())).unwrap();
    assert!(
        wait_until(Duration::from_secs(5), || sink.frame_count() >= 1),
        "the first frame should emit without needing any ack"
    );
    assert_eq!(sink.frame_count(), 1);
    let first_sequence = sink.sequences()[0];

    block_on(terminal.input_text("main", session_id, "second\n".to_owned())).unwrap();
    // Give the vt thread every reasonable chance to (incorrectly) emit a
    // second frame before asserting it did not.
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        sink.frame_count(),
        1,
        "no further frame should emit until the outstanding one is acked"
    );

    terminal.ack("main", session_id, first_sequence).unwrap();
    assert!(
        wait_until(Duration::from_secs(5), || sink.frame_count() >= 2),
        "acking the outstanding frame should free credit for the coalesced next one"
    );
    let rendered = sink.rendered_screen_text();
    assert!(
        rendered.contains("second"),
        "the coalesced frame should contain the content fed while credit was exhausted: got {rendered:?}"
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

/// Keeps acking whatever frame sequence the sink most recently recorded
/// until nothing new appears for a short settle window, or `timeout`
/// elapses — draining every frame the vt thread is willing to emit,
/// including trailing content that only became emittable after the
/// process already exited (see `service.rs`'s module doc for why credit-
/// gated content can arrive "late" like that).
fn drain_pending_frames(
    terminal: &TerminalService,
    window_label: &str,
    session_id: TerminalSessionId,
    sink: &RecordingSink,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    let mut last_acked: Option<u64> = None;
    loop {
        let latest = sink.sequences().last().copied();
        if let Some(sequence) = latest {
            if latest != last_acked {
                terminal.ack(window_label, session_id, sequence).unwrap();
                last_acked = latest;
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
        }
        if Instant::now() >= deadline {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// PTY → VT byte-level backpressure (unchanged in spirit from F070 S1/S2,
/// just re-pointed at the vt thread's own ack — see `service.rs`'s module
/// doc). This is a liveness test rather than a directly-observed-pause
/// test: were the vt thread's `flow.ack(bytes.len())` call ever removed or
/// broken, a generator producing well beyond the high water mark would
/// permanently stall the reader once it paused (nothing would ever ack the
/// backlog), and this test would time out rather than observe the full,
/// byte-perfect content arriving. `flow::FlowControl`'s own unit tests
/// (`flow.rs`) separately cover the high/low water mark pause/resume
/// mechanism in isolation.
///
/// Verifying "nothing was lost" cannot mean "every one of 2,200 lines is
/// still retrievable at the end": `vt.rs`'s own
/// `scrollback_retention_is_bounded_by_an_internal_budget_not_only_the_configured_line_cap`
/// test independently established that this crate's actual scrollback
/// retention is governed by an internal memory/page budget, not simply the
/// configured line cap — wide, highly-distinct-content lines like this
/// test's are retained in significantly smaller quantity than the
/// configured `TERMINAL_VT_MAX_SCROLLBACK_LINES` alone would suggest, and
/// the *oldest* lines are what get evicted. This test therefore checks the
/// property that is actually guaranteed instead: the most recent lines (the
/// current viewport's tail) arrive completely and byte-for-byte correct,
/// and every frame's sequence number is strictly consecutive with no gaps —
/// i.e. the high-throughput byte stream was never corrupted or silently
/// reordered/dropped by the byte-level backpressure loop, even though the
/// terminal's own scrollback naturally aged out the oldest content per its
/// own bounded-retention contract.
#[test]
fn output_well_beyond_the_high_water_mark_still_arrives_completely_and_in_order() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    // 2,200 ~51-byte lines (~112 KiB total): comfortably larger than the
    // high water mark (100,000 bytes) and than one 8 KiB read buffer, so
    // this genuinely exercises both the byte-level pause/resume gate and
    // fragmentation across many reads/feeds — the same scale F070 S1's own
    // `high_output_pauses_the_reader_until_acked` precedent used, here with
    // a unique per-line prefix so content, not just total byte count, can
    // be verified. Deliberately well under the 80-column viewport width
    // (unlike an exact-80-byte line) so this test does not also have to
    // reason about deferred-autowrap edge cases at the last column.
    let line_count = 2_200_u32;
    let script = "i=0; while [ $i -lt 2200 ]; do printf \
         'line-%04d-0123456789012345678901234567890123456789\\n' \
         \"$i\"; i=$((i+1)); done";
    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        sh_c(script),
        Arc::clone(&sink),
    );

    // Continuously drain frames (as a real frontend would) while the
    // generator is still running, so the byte-level pause/resume gate is
    // genuinely exercised rather than immediately wedged behind the
    // single-frame emission credit. Also observes whether the reader was
    // ever actually paused: a real, if best-effort (timing-dependent),
    // check that the high water mark is reachable in practice, not only in
    // `flow.rs`'s own isolated unit tests.
    let mut observed_paused = false;
    let drain_deadline = Instant::now() + Duration::from_secs(20);
    while sink.exit_status().is_none() && Instant::now() < drain_deadline {
        if let Some(&latest) = sink.sequences().last() {
            let _ = terminal.ack("main", session_id, latest);
        }
        if terminal
            .is_paused_for_test("main", session_id)
            .unwrap_or(false)
        {
            observed_paused = true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        sink.exit_status().is_some(),
        "the generator script should have finished"
    );
    if !observed_paused {
        eprintln!(
            "note: reader was never observed paused during this run (timing-dependent; \
             the vt thread's own ack may simply have kept pace with this build's throughput)"
        );
    }
    // Final drain round: trailing content may only become emittable after
    // the process already exited.
    drain_pending_frames(&terminal, "main", session_id, &sink, Duration::from_secs(5));

    let rendered = sink.rendered_screen_text();
    // The last 23 content lines fed end up in the final viewport (the 24th
    // row is the cursor's new, not-yet-written blank line after the last
    // fed `\r\n` — see `vt/tests.rs`'s
    // `scrollback_retention_is_bounded_by_an_internal_budget_not_only_the_configured_line_cap`
    // for the same off-by-one, verified independently there); no
    // scrollback lookup is needed for these, they never left the viewport.
    for i in (line_count - 23)..line_count {
        assert!(
            rendered.contains(&format!("line-{i:04}-")),
            "missing line-{i:04}- from the final viewport: got {rendered:?}"
        );
    }

    let sequences = sink.sequences();
    assert!(
        sequences.len() > 1,
        "the body should have been split across multiple frames"
    );
    for window in sequences.windows(2) {
        assert_eq!(
            window[1],
            window[0] + 1,
            "frame sequence numbers must be strictly consecutive"
        );
    }

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn resize_takes_effect_and_is_observed_by_stty_size() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    // An interactive `sh` reads commands from its stdin (the pty) rather
    // than exiting immediately, which is exactly what is needed to resize
    // the pty *before* asking the shell to report its own window size.
    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        CommandBuilder::new("sh"),
        Arc::clone(&sink),
    );

    block_on(terminal.resize("main", session_id, 120, 40)).unwrap();
    block_on(terminal.input_text("main", session_id, "stty size\n".to_owned())).unwrap();

    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(10),
            |text| text.contains("40 120"),
        ),
        "stty size should report the resized geometry: got {:?}",
        sink.rendered_screen_text()
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn kill_immediate_tears_down_synchronously_and_captures_a_signal_exit() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        sh_c("sleep 30"),
        Arc::clone(&sink),
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();

    // `immediate: true` joins every session thread before returning, so the
    // exit must already be recorded — no polling needed.
    assert!(sink.exit_status().is_some());
    assert_eq!(
        terminal.ack("main", session_id, 0).unwrap_err().code(),
        "TERMINAL_SESSION_NOT_FOUND"
    );
}

#[test]
fn a_normal_exit_code_is_captured() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        sh_c("exit 7"),
        Arc::clone(&sink),
    );
    let _ = session_id;

    assert!(wait_until(Duration::from_secs(10), || sink
        .exit_status()
        .is_some()));
    assert_eq!(sink.exit_status().unwrap().exit_code, 7);
}

#[test]
fn session_limit_is_enforced_and_independent_per_window() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();

    let mut sessions = Vec::new();
    for _ in 0..MAX_TERMINAL_SESSIONS_PER_WINDOW {
        sessions.push(start_test_session(
            &terminal,
            &trust,
            &workspace,
            "main",
            sh_c("sleep 30"),
            RecordingSink::new(),
        ));
    }

    let rejected = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        None,
        80,
        24,
        sh_c("sleep 30"),
        RecordingSink::new(),
    ));
    assert_eq!(rejected.unwrap_err().code(), "TERMINAL_SESSION_LIMIT");

    for session_id in sessions {
        block_on(terminal.kill("main", session_id, true)).unwrap();
    }
}

#[test]
fn close_window_kills_and_removes_every_session_for_that_window() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sinks: Vec<Arc<RecordingSink>> = (0..3).map(|_| RecordingSink::new()).collect();
    let session_ids: Vec<TerminalSessionId> = sinks
        .iter()
        .map(|sink| {
            start_test_session(
                &terminal,
                &trust,
                &workspace,
                "main",
                sh_c("sleep 30"),
                Arc::clone(sink),
            )
        })
        .collect();

    assert_eq!(terminal.session_count_for_test("main"), 3);
    terminal.close_window("main");
    assert_eq!(terminal.session_count_for_test("main"), 0);
    for sink in &sinks {
        assert!(
            sink.exit_status().is_some(),
            "close_window joins every thread synchronously"
        );
    }
    for session_id in session_ids {
        assert_eq!(
            terminal.ack("main", session_id, 0).unwrap_err().code(),
            "TERMINAL_SESSION_NOT_FOUND"
        );
    }
}

#[test]
fn an_untrusted_workspace_rejects_start() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let terminal = TerminalService::new();

    let result = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        None,
        80,
        24,
        CommandBuilder::new("cat"),
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn the_empty_workspace_rejects_start() {
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let terminal = TerminalService::new();

    let result = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        arbitrary_root_id(),
        None,
        80,
        24,
        CommandBuilder::new("cat"),
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn cwd_defaults_to_the_explicitly_selected_authorized_root() {
    let first_root = TempDir::new().unwrap();
    let selected_root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    block_on(workspace.pick_roots(
        "main",
        FakePicker::selected(vec![
            first_root.path().to_path_buf(),
            selected_root.path().to_path_buf(),
        ]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).unwrap();
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 1),
        None,
        80,
        24,
        sh_c("pwd"),
        sink.clone(),
    ))
    .unwrap();

    let expected = std::fs::canonicalize(selected_root.path()).unwrap();
    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(10),
            |text| {
                text.lines().map(str::trim_end).collect::<String>()
                    == expected.to_string_lossy().as_ref()
            },
        ),
        "got {:?}",
        sink.rendered_screen_text()
    );
    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn a_relative_cwd_is_resolved_inside_the_explicitly_selected_root() {
    let root = TempDir::new().unwrap();
    let nested = root.path().join("nested").join("project");
    std::fs::create_dir_all(&nested).unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        Some("nested/project".to_owned()),
        80,
        24,
        sh_c("pwd"),
        sink.clone(),
    ))
    .unwrap();

    let expected = std::fs::canonicalize(nested).unwrap();
    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(10),
            |text| {
                text.lines().map(str::trim_end).collect::<String>()
                    == expected.to_string_lossy().as_ref()
            },
        ),
        "expected {}, got {:?}",
        expected.display(),
        sink.rendered_screen_text()
    );
    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn cwd_in_another_authorized_root_is_rejected_for_the_selected_root() {
    let selected_root = TempDir::new().unwrap();
    let other_root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    block_on(workspace.pick_roots(
        "main",
        FakePicker::selected(vec![
            selected_root.path().to_path_buf(),
            other_root.path().to_path_buf(),
        ]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).unwrap();
    let terminal = TerminalService::new();

    let result = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        Some(format!(
            "../{}",
            other_root.path().file_name().unwrap().to_string_lossy()
        )),
        80,
        24,
        CommandBuilder::new("cat"),
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "TERMINAL_CWD_INVALID");
}

#[test]
fn a_foreign_window_root_id_is_rejected_before_spawn() {
    let root = TempDir::new().unwrap();
    let foreign_root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    block_on(workspace.pick_roots(
        "other",
        FakePicker::selected(vec![foreign_root.path().to_path_buf()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).unwrap();
    let terminal = TerminalService::new();

    let result = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "other", 0),
        None,
        80,
        24,
        CommandBuilder::new("cat"),
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "ROOT_NOT_AUTHORIZED");
}

#[test]
fn a_cwd_outside_every_authorized_root_is_rejected() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();

    let result = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        Some(format!(
            "../{}",
            outside.path().file_name().unwrap().to_string_lossy()
        )),
        80,
        24,
        CommandBuilder::new("cat"),
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "TERMINAL_CWD_INVALID");
}

#[cfg(unix)]
#[test]
fn a_relative_cwd_symlink_that_resolves_outside_the_selected_root_is_rejected() {
    use std::os::unix::fs::symlink;

    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    symlink(outside.path(), root.path().join("outside-link")).unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();

    let result = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        Some("outside-link".to_owned()),
        80,
        24,
        CommandBuilder::new("cat"),
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "TERMINAL_CWD_INVALID");
}

// -----------------------------------------------------------------------
// F190 S4 "Ghostty metadata and links": OSC 7 pwd → root-relative
// projection (`relativize_pwd`/`PwdCache`). Uses a deterministic `sh -c`
// fixture that emits exactly one OSC 7 sequence itself (rather than
// depending on the real shell-integration scripts, which are covered
// separately by `shell_integration::tests` — this is purely about
// `VtSession`/`TerminalService`'s own projection of whatever OSC 7 payload
// a real shell integration would have produced).
// -----------------------------------------------------------------------

#[test]
fn an_osc7_pwd_inside_the_selected_root_is_relativized_and_reaches_the_live_frame() {
    let root = TempDir::new().unwrap();
    let nested = root.path().join("nested").join("project");
    std::fs::create_dir_all(&nested).unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        Some("nested/project".to_owned()),
        80,
        24,
        sh_c("printf '\\033]7;file://localhost%s\\033\\\\' \"$(pwd)\"; sleep 5"),
        sink,
    ))
    .unwrap();

    assert!(
        wait_until(Duration::from_secs(10), || {
            terminal
                .latest_vt_frame_for_test("main", session_id)
                .ok()
                .flatten()
                .and_then(|frame| frame.pwd)
                .as_deref()
                == Some("nested/project")
        }),
        "expected the live frame's pwd to become the root-relative \"nested/project\""
    );
    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn an_osc7_pwd_at_exactly_the_selected_root_relativizes_to_an_empty_string() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        None,
        80,
        24,
        sh_c("printf '\\033]7;file://localhost%s\\033\\\\' \"$(pwd)\"; sleep 5"),
        sink,
    ))
    .unwrap();

    assert!(wait_until(Duration::from_secs(10), || {
        terminal
            .latest_vt_frame_for_test("main", session_id)
            .ok()
            .flatten()
            .and_then(|frame| frame.pwd)
            .as_deref()
            == Some("")
    }));
    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn an_osc7_pwd_outside_the_selected_root_never_reaches_the_frame_as_an_absolute_path() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let outside_canonical = std::fs::canonicalize(outside.path()).unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = block_on(terminal.start_with_command_for_test(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        None,
        80,
        24,
        sh_c(&format!(
            "printf '\\033]7;file://localhost%s\\033\\\\' {}; printf done; sleep 5",
            shell_quote(&outside_canonical.to_string_lossy())
        )),
        sink.clone(),
    ))
    .unwrap();

    // Waits for the literal "done" marker to actually render — proof the
    // OSC 7 sequence (immediately before it in the same byte stream) has
    // already been fully processed — rather than asserting on `pwd.is_some()`
    // directly, which this scenario expects to stay `false` throughout (a
    // session whose frame simply never set `pwd` at all would otherwise
    // trivially, and wrongly, satisfy that same assertion).
    assert!(wait_for_rendered_text(
        &terminal,
        "main",
        session_id,
        &sink,
        Duration::from_secs(10),
        |text| text.contains("done"),
    ));
    let frame = terminal
        .latest_vt_frame_for_test("main", session_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        frame.pwd, None,
        "a pwd outside the authorized root must project to None, never an absolute path"
    );
    block_on(terminal.kill("main", session_id, true)).unwrap();
}

/// Minimal POSIX single-quote wrapping for a fixture-only shell argument —
/// this domain never builds a shell command string in production code (see
/// this file's own module doc); this exists purely so a `TempDir`'s real
/// path (which can never itself contain a `'`) is passed to `printf`
/// unambiguously regardless of what characters a temp path happens to
/// contain.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[test]
fn an_unknown_profile_id_is_rejected_before_spawn() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();

    let result = block_on(terminal.start(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        "attacker".to_owned(),
        None,
        80,
        24,
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "TERMINAL_PROFILE_INVALID");
}

// -----------------------------------------------------------------------
// `F100` S4: `TerminalService::start_program` — the `runInTerminal`
// entry point. Real `debug::commands::handle_run_in_terminal_reverse_request`
// end-to-end coverage lives in `debug::service::tests`; these are this
// domain's own, more focused tests of `start_program`'s three actual
// divergences from `start`/`start_with_command_for_test`.
// -----------------------------------------------------------------------

/// Proves `start_program` runs `program`/`args` directly (no shell in
/// between) and returns the real spawned process's own pid — an argv element
/// containing shell metacharacters (`$(pwd)`) must appear *literally* in the
/// child's own argv (visible via `echo "$1"`, which only echoes what its
/// shell-script wrapper received as a single already-tokenized argument),
/// never expanded, mirroring `debug::exec::tests`'s identical
/// `argv_elements_containing_shell_metacharacters_are_never_shell_interpreted`
/// proof for adapter spawning.
#[test]
fn start_program_runs_the_named_program_directly_and_reports_a_real_pid() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let (session_id, pid) = block_on(terminal.start_program(
        &trust,
        &workspace,
        "main",
        root.path().to_string_lossy().into_owned(),
        "/bin/echo".to_owned(),
        vec!["literal:$(pwd):end".to_owned()],
        Vec::new(),
        80,
        24,
        sink.clone(),
    ))
    .expect("start_program succeeds");
    assert!(
        pid.is_some_and(|pid| pid > 0),
        "expected a real, positive pid, got {pid:?}"
    );

    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(10),
            |text| text.contains("literal:$(pwd):end"),
        ),
        "expected the shell-metacharacter-laden arg to appear literal, unexpanded; got {:?}",
        sink.rendered_screen_text()
    );

    block_on(terminal.kill("main", session_id, true)).expect("kill succeeds");
}

/// **Deliberate contrast with [`a_cwd_outside_every_authorized_root_is_rejected`]
/// above** (the control group): the exact same "root only, `cwd` points
/// somewhere else entirely" setup that `start_with_command_for_test` rejects
/// with `TERMINAL_CWD_INVALID` must *succeed* through `start_program` — see
/// [`TerminalService::start_program`]'s own doc comment for why this
/// divergence is deliberate (the containment check exists to bound a
/// webview-reachable `cwd`; `runInTerminal`'s `cwd` never crosses that
/// boundary).
#[test]
fn start_program_accepts_a_cwd_outside_every_workspace_root_unlike_the_ordinary_start_path() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let (session_id, _pid) = block_on(terminal.start_program(
        &trust,
        &workspace,
        "main",
        outside.path().to_string_lossy().into_owned(),
        "/bin/sh".to_owned(),
        vec!["-c".to_owned(), "pwd".to_owned()],
        Vec::new(),
        80,
        24,
        sink.clone(),
    ))
    .expect("start_program accepts a cwd outside every authorized workspace root");

    let expected = std::fs::canonicalize(outside.path()).unwrap();
    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(10),
            |text| text.trim() == expected.to_string_lossy().as_ref(),
        ),
        "got {:?}",
        sink.rendered_screen_text()
    );

    block_on(terminal.kill("main", session_id, true)).expect("kill succeeds");
}

/// `env_overrides` apply *after* (on top of, per DAP's own "added to or
/// removed from" `env` semantics — never replacing) the fixed allowlist:
/// this test both adds a name the allowlist would never forward on its own
/// and removes one the allowlist normally does forward.
#[test]
fn start_program_env_overrides_apply_on_top_of_the_fixed_allowlist() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let (session_id, _pid) = block_on(terminal.start_program(
        &trust,
        &workspace,
        "main",
        root.path().to_string_lossy().into_owned(),
        "/bin/sh".to_owned(),
        vec![
            "-c".to_owned(),
            "echo ADDED=$MOCK_RUN_IN_TERMINAL_VAR REMOVED=[$HOME]".to_owned(),
        ],
        vec![
            (
                "MOCK_RUN_IN_TERMINAL_VAR".to_owned(),
                Some("hello".to_owned()),
            ),
            ("HOME".to_owned(), None),
        ],
        80,
        24,
        sink.clone(),
    ))
    .expect("start_program succeeds");

    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(10),
            |text| text.contains("ADDED=hello") && text.contains("REMOVED=[]"),
        ),
        "got {:?}",
        sink.rendered_screen_text()
    );

    block_on(terminal.kill("main", session_id, true)).expect("kill succeeds");
}

// -----------------------------------------------------------------------
// Structured key/focus input, scrollback
// -----------------------------------------------------------------------

#[test]
fn input_key_writes_the_libghostty_encoded_bytes_to_the_pty() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        cat_v(),
        Arc::clone(&sink),
    );

    // Ctrl-A encodes to the raw C0 control byte 0x01 (already verified
    // byte-for-byte in `vt/tests.rs`'s own encoding matrix for the
    // analogous Ctrl-C case) — deliberately not a termios special
    // character (unlike Ctrl-C/Ctrl-\/Ctrl-D), so it reaches the child
    // process as ordinary input instead of being intercepted as a signal.
    // This test's job is only to prove the IPC-level `input_key` plumbing
    // reaches the pty with that exact encoding, using `cat -v` so the raw
    // control byte survives as visible caret-notation text.
    let input = vt::KeyInput::new(key::Action::Press, key::Key::A, key::Mods::CTRL).with_utf8("a");
    block_on(terminal.input_key("main", session_id, input)).unwrap();

    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(5),
            |text| text.contains("^A"),
        ),
        "expected cat -v's caret notation for the Ctrl-A byte: got {:?}",
        sink.rendered_screen_text()
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn focus_writes_the_encoded_sequence_only_when_the_live_terminal_enabled_dec_1004() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    // Enables focus-reporting mode (DEC 1004) first, then behaves as a
    // caret-notation echo so a later focus event's escape bytes survive as
    // visible text instead of being reinterpreted as a VT control sequence
    // once echoed back through the VT mirror.
    let mut command = CommandBuilder::new("sh");
    command.args(["-c", "printf '\\033[?1004h'; cat -v"]);
    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        command,
        Arc::clone(&sink),
    );

    assert!(
        wait_until(Duration::from_secs(5), || terminal
            .modes_snapshot_for_test("main", session_id)
            .ok()
            .is_some_and(|modes| modes.focus_reporting_enabled)),
        "the VT mirror should observe DEC 1004 being enabled"
    );

    block_on(terminal.focus("main", session_id, true)).unwrap();
    assert!(
        wait_for_rendered_text(
            &terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(5),
            |text| text.contains("^[[I"),
        ),
        "focus gained should write the CSI I sequence once focus reporting is enabled: got {:?}",
        sink.rendered_screen_text()
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn focus_is_a_silent_no_op_when_the_live_terminal_has_not_enabled_dec_1004() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        cat_v(),
        Arc::clone(&sink),
    );

    block_on(terminal.focus("main", session_id, true)).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        sink.frame_count(),
        0,
        "no frame should have been produced from a gated-out focus event"
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn scrollback_reads_history_rows_scrolled_off_the_viewport() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    // 30 lines through the fixed 80x24 viewport `start_test_session` uses:
    // the 24th line's own trailing newline is what first triggers a scroll
    // (evicting line 0), and every line after that scrolls one more — so
    // `N` lines through an `R`-row viewport scrolls `N - R + 1` into
    // history (verified against the real crate's actual scroll behavior,
    // matching `vt/tests.rs`'s own `scrollback_rows_reads_lines_scrolled_off_the_active_area`
    // precedent: 5 lines through a 2-row viewport scrolls 4 = 5 - 2 + 1).
    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        sh_c("i=0; while [ $i -lt 30 ]; do printf 'row-%02d\\n' \"$i\"; i=$((i+1)); done"),
        Arc::clone(&sink),
    );

    assert!(wait_until(Duration::from_secs(10), || sink
        .exit_status()
        .is_some()));
    std::thread::sleep(Duration::from_millis(50));

    let rows = block_on(terminal.scrollback("main", session_id, 0, 100)).unwrap();
    assert_eq!(rows.len(), 30 - 24 + 1);
    for (i, row) in rows.iter().enumerate() {
        let text: String = row
            .cells
            .iter()
            .flat_map(|cell| cell.graphemes.iter())
            .collect();
        assert_eq!(text.trim_end(), format!("row-{i:02}"));
    }

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn scrollback_for_an_unknown_session_reports_not_found() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (_workspace, _trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();

    let unknown = TerminalSessionId::new();
    let result = block_on(terminal.scrollback("main", unknown, 0, 10));
    assert_eq!(result.unwrap_err().code(), "TERMINAL_SESSION_NOT_FOUND");
}

/// Documents (rather than merely assuming) that the byte-level high water
/// mark constant this domain locks is still the one `flow.rs`/the Harness
/// enforce, now that this test file's own throughput test above exercises
/// it indirectly rather than by directly withholding an external ack.
#[test]
fn high_water_mark_constant_used_by_the_throughput_test_is_the_locked_one() {
    assert_eq!(TERMINAL_FLOW_HIGH_WATER_MARK, 100_000);
}
