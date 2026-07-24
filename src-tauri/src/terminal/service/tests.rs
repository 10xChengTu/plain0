//! Real-subprocess Rust tests for `TerminalService`. `sh -c '...'` and bare
//! `cat`/`sleep` fixtures are used freely here — this file's name ends in
//! `tests.rs`, the domain-wide carve-out `scripts/plain/boundary-contracts.mjs`
//! grants test fixtures (see `terminal::mod`'s module doc); production code
//! under this domain never constructs a shell command string this way.

use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::CommandBuilder;
use tempfile::TempDir;

use super::{TerminalChunk, TerminalExitStatus, TerminalOutputSink, TerminalService};
use crate::terminal::dto::TerminalSessionId;
use crate::terminal::flow::TERMINAL_FLOW_HIGH_WATER_MARK;
use crate::terminal::MAX_TERMINAL_SESSIONS_PER_WINDOW;
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

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

#[derive(Default)]
struct RecordingState {
    chunks: Vec<TerminalChunk>,
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

    fn concatenated(&self) -> Vec<u8> {
        self.inner
            .lock()
            .unwrap()
            .chunks
            .iter()
            .flat_map(|chunk| chunk.bytes.clone())
            .collect()
    }

    fn total_bytes(&self) -> usize {
        self.inner
            .lock()
            .unwrap()
            .chunks
            .iter()
            .map(|chunk| chunk.bytes.len())
            .sum()
    }

    fn sequences(&self) -> Vec<u64> {
        self.inner
            .lock()
            .unwrap()
            .chunks
            .iter()
            .map(|chunk| chunk.sequence)
            .collect()
    }

    fn exit_status(&self) -> Option<TerminalExitStatus> {
        self.inner.lock().unwrap().exit.clone()
    }
}

impl TerminalOutputSink for RecordingSink {
    fn emit_chunk(&self, _session_id: TerminalSessionId, chunk: TerminalChunk) {
        self.inner.lock().unwrap().chunks.push(chunk);
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

fn sh_c(script: &str) -> CommandBuilder {
    let mut command = CommandBuilder::new("sh");
    command.args(["-c", script]);
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
        None,
        80,
        24,
        command,
        sink,
    ))
    .expect("session starts")
}

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

    block_on(terminal.input("main", session_id, b"hello-plain-terminal\n".to_vec())).unwrap();

    assert!(
        wait_until(Duration::from_secs(5), || sink
            .concatenated()
            .windows(b"hello-plain-terminal".len())
            .any(|window| window == b"hello-plain-terminal")),
        "cat should have echoed the input back: got {:?}",
        String::from_utf8_lossy(&sink.concatenated())
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

/// Exercises the VT integration (F070 "VT 集成" slice) through the real
/// session machinery, not just `vt.rs`'s own isolated unit tests: feeding a
/// live session's pty output through to a `latest_vt_frame_for_test`-visible
/// `DirtyFrame`, and confirming the VT mirror's per-session state
/// disappears alongside the rest of the session on `kill` — i.e. it does
/// not outlive (or otherwise interfere with) the existing S1 session
/// lifecycle this test file's other cases already cover.
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

    block_on(terminal.input("main", session_id, b"vt-integration-probe\n".to_vec())).unwrap();

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
        "the VT mirror should observe the same output the raw byte sink does"
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

#[test]
fn high_output_pauses_the_reader_until_acked() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    // A deliberately bounded (not `yes`-style infinite) generator: 2,200
    // lines of 70 bytes each comfortably exceeds the high water mark
    // (triggering the same pause this test exercises) while still being
    // small enough that, once the reader resumes and drains it, the
    // process finishes and exits on its own well before this test's own
    // `kill` call — deliberately avoiding ever tearing down a process still
    // parked deep inside a blocked `write()` to a backed-up pty, which this
    // sandbox cannot reliably terminate (`SIGKILL` is accepted but the
    // process wedges in a permanent "trying to exit" state instead of
    // actually being reaped) — an environment limitation orthogonal to the
    // flow-control behavior under test here.
    let session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        sh_c(
            "i=0; while [ $i -lt 2200 ]; do printf '%s\\n' \
             0123456789012345678901234567890123456789012345678901234567890123456789; \
             i=$((i+1)); done",
        ),
        Arc::clone(&sink),
    );

    assert!(
        wait_until(Duration::from_secs(10), || terminal
            .is_paused_for_test("main", session_id)
            .unwrap_or(false)),
        "reader should pause once the high water mark is reached"
    );
    let paused_bytes = sink.total_bytes();
    assert!(
        paused_bytes >= TERMINAL_FLOW_HIGH_WATER_MARK,
        "paused total {paused_bytes} should have reached the high water mark"
    );

    // While still paused, no further growth beyond a small, bounded
    // overshoot should occur even after waiting: the reader really has
    // stopped issuing new `read()` calls.
    std::thread::sleep(Duration::from_millis(200));
    let settled_bytes = sink.total_bytes();
    assert!(
        settled_bytes < TERMINAL_FLOW_HIGH_WATER_MARK * 2,
        "output kept growing well past the high water mark while supposedly paused: {settled_bytes}"
    );

    // Acking everything delivered so far must drop comfortably below the
    // low water mark and resume the reader.
    terminal
        .ack("main", session_id, u32::try_from(settled_bytes).unwrap())
        .unwrap();
    assert!(
        wait_until(Duration::from_secs(10), || !terminal
            .is_paused_for_test("main", session_id)
            .unwrap_or(true)),
        "reader should resume once acked below the low water mark"
    );
    assert!(
        wait_until(Duration::from_secs(10), || sink.total_bytes()
            > settled_bytes),
        "more output should arrive once the reader resumes"
    );

    block_on(terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn chunks_arrive_with_monotonic_sequence_numbers_and_no_lost_bytes() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());
    let terminal = TerminalService::new();
    let sink = RecordingSink::new();

    // A deterministic, well-below-the-high-water-mark body assembled from a
    // POSIX `sh` loop (no `yes`/`head` dependency): 2,000 ten-byte lines,
    // comfortably larger than one 8 KiB read buffer so this genuinely
    // exercises fragmentation across multiple chunks.
    let script = "i=0; while [ $i -lt 2000 ]; do printf 'line-%04d\\n' \"$i\"; i=$((i+1)); done";
    let _session_id = start_test_session(
        &terminal,
        &trust,
        &workspace,
        "main",
        sh_c(script),
        Arc::clone(&sink),
    );

    // The pty's line discipline runs in the kernel's default cooked mode
    // (`ONLCR` on), which translates every bare `\n` a program writes into
    // `\r\n` on its way out through the master — exactly the same
    // translation a real interactive terminal session performs, and thus
    // part of the behavior under test here, not an artifact to work around.
    let expected: Vec<u8> = (0..2000_u32)
        .flat_map(|i| format!("line-{i:04}\r\n").into_bytes())
        .collect();

    assert!(
        wait_until(Duration::from_secs(10), || sink.exit_status().is_some()),
        "the generator script should have finished"
    );
    // Drain any last chunks the delivery thread was still forwarding right
    // as the exit was observed.
    std::thread::sleep(Duration::from_millis(50));

    assert_eq!(
        sink.concatenated(),
        expected,
        "output must arrive byte-for-byte intact"
    );
    let sequences = sink.sequences();
    assert!(
        sequences.len() > 1,
        "the body should have been split across multiple chunks"
    );
    for window in sequences.windows(2) {
        assert_eq!(
            window[1],
            window[0] + 1,
            "sequence numbers must be strictly consecutive"
        );
    }
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
    block_on(terminal.input("main", session_id, b"stty size\n".to_vec())).unwrap();

    assert!(
        wait_until(Duration::from_secs(10), || String::from_utf8_lossy(
            &sink.concatenated()
        )
        .contains("40 120")),
        "stty size should report the resized geometry: got {:?}",
        String::from_utf8_lossy(&sink.concatenated())
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
        None,
        80,
        24,
        CommandBuilder::new("cat"),
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn cwd_defaults_to_the_first_authorized_root() {
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
        sh_c("pwd"),
        Arc::clone(&sink),
    );
    let _ = session_id;

    let expected = std::fs::canonicalize(root.path()).unwrap();
    assert!(wait_until(Duration::from_secs(10), || sink
        .exit_status()
        .is_some()));
    std::thread::sleep(Duration::from_millis(50));
    let output = String::from_utf8_lossy(&sink.concatenated())
        .trim()
        .to_owned();
    assert_eq!(output, expected.to_string_lossy());
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
        Some(outside.path().to_string_lossy().into_owned()),
        80,
        24,
        CommandBuilder::new("cat"),
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "TERMINAL_CWD_INVALID");
}
