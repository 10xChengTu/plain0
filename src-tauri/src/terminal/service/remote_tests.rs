//! `F220` S5 hermetic, full-stack tests for `TerminalService::start`'s
//! remote-root routing (`start_remote`) — a real `russh::server` fixture
//! (`remote::test_support::TerminalFixture`), a real `RemoteSessionService`
//! session connected to it, a real workspace remote root bound to that
//! session, and this domain's real production `TerminalService` (reader/vt/
//! waiter threads, `FlowControl` backpressure, the `FrameEmitGate`) —
//! exactly the path `terminal_start` reaches in production for a remote
//! root, unlike `tests.rs`' own `start_with_command_for_test` seam (which
//! stays local-only by design; see that method's own doc comment). Kept in
//! its own file (not folded into the large existing `tests.rs`) so neither
//! file's own fixtures/helpers have to change to accommodate the other —
//! mirrors `remote::test_support`'s own "kept in its own module" rationale.
//!
//! No `sh`/shell-string fixture commands here (this file's name does not
//! match `WORKSPACE_TEST_SOURCE_PATTERN`'s `tests.rs`/`test_support.rs`
//! spawn-guard exemption) — the local "filler" sessions
//! [`the_session_limit_is_shared_between_local_and_remote_sessions`] needs
//! use a plain `sleep` argv instead.

use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::CommandBuilder;
use tempfile::TempDir;

use super::{TerminalExitStatus, TerminalOutputSink, TerminalService};
use crate::remote::session::RemoteSessionService;
use crate::remote::test_support::{self, TerminalFixture};
use crate::terminal::dto::TerminalSessionId;
use crate::terminal::vt;
use crate::terminal::MAX_TERMINAL_SESSIONS_PER_WINDOW;
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<std::path::PathBuf>,
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

/// A trusted workspace with one *local* root — needed only by
/// [`the_session_limit_is_shared_between_local_and_remote_sessions`]'s
/// filler sessions (`start_with_command_for_test` still requires a resolved
/// local root, exactly like `tests.rs`'s own identical helper).
fn trusted_local_workspace(
    window_label: &str,
    trust_base: &std::path::Path,
) -> (TempDir, WorkspaceService, TrustService) {
    let root = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root.path().to_path_buf()],
    };
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("local root authorizes");
    let trust = TrustService::new(trust_base.to_path_buf());
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    (root, workspace, trust)
}

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

/// Bundles everything one remote-terminal test needs: a connected fixture, a
/// live `RemoteSessionService` session against it, a trusted workspace with
/// one remote root bound to that live session, and a fresh `TerminalService`.
///
/// **Historical scope boundary, closed by `F220` S6** (kept here, unchanged
/// in shape, as the realistic "mixed local+remote workspace" case —
/// [`purely_remote_workspace_can_grant_trust_and_start_a_remote_terminal`],
/// below, is the dedicated test for the *zero*-local-root case this doc
/// comment used to describe as unreachable): at S5 time,
/// `trust::service::TrustService::grant`'s stable identity
/// (`WorkspaceScope::stable_identity`) was computed from *local* root
/// canonical paths only, so a workspace with zero local roots could not be
/// granted trust at all, and so could not start a remote terminal either —
/// this harness worked around that by keeping this window's pre-existing
/// local root too, exactly like `trusted_local_workspace`'s own local-only
/// sibling. `F220` S6 widened `stable_identity` to also fold in remote roots
/// (see `workspace::WorkspaceScope::stable_identity`'s own doc comment), so
/// this workaround is no longer load-bearing for *this* harness's own tests
/// — it is kept anyway because a mixed workspace is itself a realistic,
/// worth-covering shape, distinct from the purely-remote one.
struct RemoteHarness {
    _local_root: TempDir,
    _remote_base: TempDir,
    _trust_base: TempDir,
    _terminal_base: TempDir,
    fixture: TerminalFixture,
    remote: RemoteSessionService,
    workspace: WorkspaceService,
    trust: TrustService,
    terminal: TerminalService,
    root_id: RootId,
}

fn remote_harness(window_label: &str) -> RemoteHarness {
    block_on(async {
        let local_root = TempDir::new().unwrap();
        let workspace = WorkspaceService::new();
        let picker = FakePicker {
            paths: vec![local_root.path().to_path_buf()],
        };
        workspace
            .pick_roots(window_label, picker, WorkspacePickRootsMode::Add)
            .await
            .expect("local root authorizes");

        let remote_base = TempDir::new().unwrap();
        let remote = RemoteSessionService::new(remote_base.path().to_path_buf());
        let identity = test_support::generate_key();
        let fixture = test_support::start_terminal_fixture(&identity).await;
        let session_id =
            test_support::connect_terminal_test_session(&remote, window_label, &fixture).await;
        let fingerprint = remote
            .session_host_key_fingerprint(window_label, session_id)
            .expect("live session reports its own pinned fingerprint");

        let (root_id, _snapshot) = workspace
            .authorize_remote_root(
                window_label,
                session_id,
                &fingerprint,
                "/srv/remote-terminal-test",
                "Remote Terminal Test",
            )
            .expect("remote root authorizes");
        let trust_base = TempDir::new().unwrap();
        let trust = TrustService::new(trust_base.path().to_path_buf());
        trust
            .grant(&workspace, window_label)
            .await
            .expect("grant succeeds");

        let terminal_base = TempDir::new().unwrap();
        let terminal = TerminalService::new(terminal_base.path().to_path_buf());

        RemoteHarness {
            _local_root: local_root,
            _remote_base: remote_base,
            _trust_base: trust_base,
            _terminal_base: terminal_base,
            fixture,
            remote,
            workspace,
            trust,
            terminal,
            root_id,
        }
    })
}

fn start_remote_session(
    harness: &RemoteHarness,
    window_label: &str,
    sink: Arc<RecordingSink>,
) -> TerminalSessionId {
    let (session_id, _shell_integration) = block_on(harness.terminal.start(
        &harness.trust,
        &harness.workspace,
        &harness.remote,
        window_label,
        harness.root_id,
        "systemDefault".to_owned(),
        None,
        80,
        24,
        sink,
    ))
    .expect("remote session starts");
    session_id
}

#[test]
fn a_remote_root_starts_and_echoes_input_end_to_end_through_the_real_vt_pipeline() {
    let harness = remote_harness("main");
    let sink = RecordingSink::new();
    let session_id = start_remote_session(&harness, "main", Arc::clone(&sink));

    block_on(
        harness
            .terminal
            .input_text("main", session_id, "hello ssh".to_owned()),
    )
    .expect("input_text succeeds");

    assert!(
        wait_for_rendered_text(
            &harness.terminal,
            "main",
            session_id,
            &sink,
            Duration::from_secs(10),
            |text| text.contains("hello ssh"),
        ),
        "the fixture's echoed bytes must reach the real VT pipeline and render"
    );

    block_on(harness.terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn shell_integration_is_always_reported_unsupported_for_a_remote_root() {
    let harness = remote_harness("main");
    let (_session_id, shell_integration) = block_on(harness.terminal.start(
        &harness.trust,
        &harness.workspace,
        &harness.remote,
        "main",
        harness.root_id,
        "systemDefault".to_owned(),
        None,
        80,
        24,
        RecordingSink::new(),
    ))
    .unwrap();
    assert_eq!(
        shell_integration,
        crate::terminal::shell_integration::ShellIntegrationStatus::Unsupported
    );
}

#[test]
fn a_non_default_profile_id_is_rejected_for_a_remote_root() {
    let harness = remote_harness("main");
    let result = block_on(harness.terminal.start(
        &harness.trust,
        &harness.workspace,
        &harness.remote,
        "main",
        harness.root_id,
        "zsh".to_owned(),
        None,
        80,
        24,
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "TERMINAL_PROFILE_INVALID");
}

#[test]
fn an_explicit_cwd_is_rejected_for_a_remote_root() {
    let harness = remote_harness("main");
    let result = block_on(harness.terminal.start(
        &harness.trust,
        &harness.workspace,
        &harness.remote,
        "main",
        harness.root_id,
        "systemDefault".to_owned(),
        Some("nested/project".to_owned()),
        80,
        24,
        RecordingSink::new(),
    ));
    assert_eq!(result.unwrap_err().code(), "TERMINAL_CWD_INVALID");
}

#[test]
fn resize_reaches_the_remote_channel_as_a_real_window_change_request() {
    let harness = remote_harness("main");
    let sink = RecordingSink::new();
    let session_id = start_remote_session(&harness, "main", sink);

    block_on(harness.terminal.resize("main", session_id, 132, 50)).unwrap();

    assert!(
        wait_until(Duration::from_secs(5), || {
            block_on(harness.fixture.last_window_change()) == Some((132, 50))
        }),
        "the fixture must observe a real window-change request for the new geometry"
    );

    block_on(harness.terminal.kill("main", session_id, true)).unwrap();
}

#[test]
fn a_real_remote_exit_status_reaches_the_sink_unchanged() {
    let harness = remote_harness("main");
    let sink = RecordingSink::new();
    let _session_id = start_remote_session(&harness, "main", Arc::clone(&sink));

    block_on(harness.fixture.exit_normally(7));

    assert!(
        wait_until(Duration::from_secs(5), || sink.exit_status().is_some()),
        "the sink must observe the exit event"
    );
    assert_eq!(
        sink.exit_status().unwrap(),
        TerminalExitStatus {
            exit_code: 7,
            signal: None,
        }
    );
}

#[test]
fn a_real_remote_exit_signal_reaches_the_sink_as_a_signal_terminated_exit() {
    let harness = remote_harness("main");
    let sink = RecordingSink::new();
    let _session_id = start_remote_session(&harness, "main", Arc::clone(&sink));

    block_on(harness.fixture.exit_with_signal("KILL"));

    assert!(
        wait_until(Duration::from_secs(5), || sink.exit_status().is_some()),
        "the sink must observe the exit event"
    );
    assert_eq!(
        sink.exit_status().unwrap(),
        TerminalExitStatus {
            exit_code: 1,
            signal: Some("KILL".to_owned()),
        }
    );
}

/// `F220` S5's own "断连型退出状态,不伪装成正常退出" contract: a whole-session
/// disconnect (no `exit-status`/`exit-signal` ever sent) must reach the sink
/// as a non-`null`-signal exit, never a disguised code-0 normal exit.
#[test]
fn a_whole_session_disconnect_reaches_the_sink_with_the_disconnected_signal_never_a_normal_exit() {
    let harness = remote_harness("main");
    let sink = RecordingSink::new();
    let _session_id = start_remote_session(&harness, "main", Arc::clone(&sink));

    block_on(harness.fixture.force_server_disconnect());

    assert!(
        wait_until(Duration::from_secs(5), || sink.exit_status().is_some()),
        "the sink must observe the exit event"
    );
    let status = sink.exit_status().unwrap();
    assert_eq!(
        status.signal.as_deref(),
        Some(super::REMOTE_TERMINAL_DISCONNECTED_SIGNAL),
        "a disconnect must never be reported as a normal (null-signal) exit"
    );
}

#[test]
fn kill_tears_down_the_remote_session_and_reports_the_disconnected_signal() {
    let harness = remote_harness("main");
    let sink = RecordingSink::new();
    let session_id = start_remote_session(&harness, "main", Arc::clone(&sink));

    block_on(harness.terminal.kill("main", session_id, true)).unwrap();

    let status = sink.exit_status().expect(
        "an immediate kill joins the waiter thread synchronously, so the exit is already recorded",
    );
    assert_eq!(
        status.signal.as_deref(),
        Some(super::REMOTE_TERMINAL_DISCONNECTED_SIGNAL),
        "an explicit kill was never a real remote exit-status/exit-signal"
    );
    assert_eq!(harness.terminal.session_count_for_test("main"), 0);
}

#[test]
fn close_window_tears_down_a_live_remote_session_too() {
    let harness = remote_harness("main");
    let sink = RecordingSink::new();
    let _session_id = start_remote_session(&harness, "main", sink);
    assert_eq!(harness.terminal.session_count_for_test("main"), 1);

    harness.terminal.close_window("main");

    assert_eq!(harness.terminal.session_count_for_test("main"), 0);
}

/// `F220` S5's own "16 会话上限本地远程共享" contract: fills the window with
/// `MAX_TERMINAL_SESSIONS_PER_WINDOW - 1` cheap local filler sessions (a
/// plain `sleep` argv — no shell string; see this file's own module doc),
/// then the one remote session this harness already provides, then proves a
/// 17th of *either* backend is rejected — the cap is one shared counter, not
/// one per backend.
#[test]
fn the_session_limit_is_shared_between_local_and_remote_sessions() {
    let harness = remote_harness("main");
    let trust_base = TempDir::new().unwrap();
    let (_local_root, local_workspace, local_trust) =
        trusted_local_workspace("main", trust_base.path());

    let mut local_sessions = Vec::new();
    for _ in 0..(MAX_TERMINAL_SESSIONS_PER_WINDOW - 1) {
        let mut command = CommandBuilder::new("sleep");
        command.arg("30");
        let session_id = block_on(harness.terminal.start_with_command_for_test(
            &local_trust,
            &local_workspace,
            "main",
            local_workspace.snapshot("main").unwrap().roots()[0].root_id(),
            None,
            80,
            24,
            command,
            RecordingSink::new(),
        ))
        .expect("local filler session starts");
        local_sessions.push(session_id);
    }
    assert_eq!(
        harness.terminal.session_count_for_test("main"),
        MAX_TERMINAL_SESSIONS_PER_WINDOW - 1
    );

    let remote_session_id = start_remote_session(&harness, "main", RecordingSink::new());
    assert_eq!(
        harness.terminal.session_count_for_test("main"),
        MAX_TERMINAL_SESSIONS_PER_WINDOW
    );

    let rejected = block_on(harness.terminal.start(
        &harness.trust,
        &harness.workspace,
        &harness.remote,
        "main",
        harness.root_id,
        "systemDefault".to_owned(),
        None,
        80,
        24,
        RecordingSink::new(),
    ));
    assert_eq!(rejected.unwrap_err().code(), "TERMINAL_SESSION_LIMIT");

    block_on(harness.terminal.kill("main", remote_session_id, true)).unwrap();
    for session_id in local_sessions {
        block_on(harness.terminal.kill("main", session_id, true)).unwrap();
    }
}

// --- `F220` S6: the purely-remote trust gap [`RemoteHarness`]'s own doc
// comment used to describe is now closed --------------------------------

/// A [`RemoteHarness`]-shaped bundle with **zero local roots** — the exact
/// shape [`RemoteHarness`]'s own doc comment says used to be unable to reach
/// a granted trust state at all. Deliberately not a variant of
/// [`remote_harness`] itself (that function's own local-root authorization
/// is load-bearing for its *other* callers, which intentionally want the
/// realistic mixed-workspace shape) — this is an independent, minimal
/// construction proving the zero-local-root case specifically.
struct PurelyRemoteHarness {
    _remote_base: TempDir,
    _trust_base: TempDir,
    _terminal_base: TempDir,
    fixture: TerminalFixture,
    remote: RemoteSessionService,
    workspace: WorkspaceService,
    trust: TrustService,
    terminal: TerminalService,
    root_id: RootId,
}

fn purely_remote_harness(window_label: &str) -> PurelyRemoteHarness {
    block_on(async {
        let workspace = WorkspaceService::new();
        // No local root is ever authorized for this workspace — proving the
        // chain below works from a workspace whose *only* root, of any kind,
        // is this one remote root.

        let remote_base = TempDir::new().unwrap();
        let remote = RemoteSessionService::new(remote_base.path().to_path_buf());
        let identity = test_support::generate_key();
        let fixture = test_support::start_terminal_fixture(&identity).await;
        let session_id =
            test_support::connect_terminal_test_session(&remote, window_label, &fixture).await;
        let fingerprint = remote
            .session_host_key_fingerprint(window_label, session_id)
            .expect("live session reports its own pinned fingerprint");

        let (root_id, _snapshot) = workspace
            .authorize_remote_root(
                window_label,
                session_id,
                &fingerprint,
                "/srv/purely-remote-terminal-test",
                "Purely Remote Terminal Test",
            )
            .expect("remote root authorizes");
        let trust_base = TempDir::new().unwrap();
        let trust = TrustService::new(trust_base.path().to_path_buf());

        let terminal_base = TempDir::new().unwrap();
        let terminal = TerminalService::new(terminal_base.path().to_path_buf());

        PurelyRemoteHarness {
            _remote_base: remote_base,
            _trust_base: trust_base,
            _terminal_base: terminal_base,
            fixture,
            remote,
            workspace,
            trust,
            terminal,
            root_id,
        }
    })
}

/// Proves, end to end and without any local-root workaround, that `F220` S5's
/// disclosed trust gap is now closed: a workspace whose only root is remote
/// can be granted execution trust (`TrustService::grant` no longer reports
/// `TRUST_UNAVAILABLE`), and a real remote terminal session can then be
/// started against it through production `TerminalService::start`/
/// `start_remote` — the identical call this file's other tests already make
/// against [`RemoteHarness`]'s mixed local+remote workspace, now proven to
/// also work with zero local roots. Before `F220` S6, granting trust here
/// would have failed with `TRUST_UNAVAILABLE` and this test could not have
/// been written at all (there would have been nothing to grant).
#[test]
fn purely_remote_workspace_can_grant_trust_and_start_a_remote_terminal() {
    let window_label = "main";
    let harness = purely_remote_harness(window_label);

    assert!(!block_on(harness.trust.is_trusted(&harness.workspace, window_label)).unwrap());
    block_on(harness.trust.grant(&harness.workspace, window_label))
        .expect("granting trust to a workspace whose only root is remote must succeed");
    assert!(block_on(harness.trust.is_trusted(&harness.workspace, window_label)).unwrap());

    let sink = RecordingSink::new();
    let (session_id, shell_integration) = block_on(harness.terminal.start(
        &harness.trust,
        &harness.workspace,
        &harness.remote,
        window_label,
        harness.root_id,
        "systemDefault".to_owned(),
        None,
        80,
        24,
        sink,
    ))
    .expect("a remote terminal starts against a purely-remote, now-trusted workspace");
    assert_eq!(
        shell_integration,
        crate::terminal::shell_integration::ShellIntegrationStatus::Unsupported
    );

    block_on(harness.terminal.kill(window_label, session_id, true)).unwrap();
    // `fixture` itself is never otherwise read in this test (unlike the
    // resize/exit/disconnect tests above, which call real methods on it) —
    // this keeps it alive for the fixture's own Drop (shutting down the
    // fixture sshd/agent tasks) without triggering a dead-code warning for
    // an entirely unread struct field.
    let _ = &harness.fixture;
}
