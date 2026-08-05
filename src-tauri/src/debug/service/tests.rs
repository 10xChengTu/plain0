//! Real-subprocess and real-socket integration tests for
//! `debug::service::DebugSessionService` — proving the exact same handshake/
//! correlation/event-dispatch logic `debug::session::tests` already proves
//! against an in-memory mock adapter *also* works end to end over (a) a
//! genuinely spawned child process's real stdin/stdout pipes (via a small,
//! self-contained Python mock adapter script — no `debugpy` dependency, just
//! the same wire protocol implemented directly) and (b) a genuine loopback
//! TCP socket. This file's name ends in `tests.rs`, the same domain-wide
//! carve-out `debug::exec::tests`/`debug::tcp::tests` already document and
//! rely on for their own real subprocess/socket fixtures.
//!
//! # Why Python for the stdio mock adapter, not the in-memory harness again
//!
//! `debug::session::tests`'s in-memory mock adapter proves the session/
//! protocol logic itself is correct in isolation. It does not exercise
//! `debug::exec::spawn_adapter`'s real `Command::spawn`, real OS pipes, or
//! `AdapterHandle::take_io`'s real `Child::stdin`/`stdout` — a real, if
//! small, external process is the only way to prove *that* wiring holds up,
//! mirroring this project's own research methodology (real `lldb-dap`/
//! `debugpy` sessions via `python3`, not just synthetic fixtures) at the
//! integration-test layer. If `python3` cannot be found, the affected test
//! skips with an explicit message rather than fabricating a result — see
//! [`resolve_python3`].

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tempfile::TempDir;

use crate::debug::commands::handle_run_in_terminal_reverse_request;
use crate::debug::confirm::ConfirmationService;
use crate::debug::dto::{
    AdapterSpawnDescriptor, AdapterTransportKind, DebugSessionId, SessionTransportRequest,
};
use crate::debug::framing::FrameDecoder;
use crate::debug::protocol::{encode_response, parse_incoming_message, IncomingMessage};
use crate::debug::session::{
    DebugEventSink, LaunchRequestKind, ReverseRequestHandler, ReverseRequestOutcome,
    SessionEndReason,
};
use crate::remote::session::RemoteSessionService;
use crate::terminal::service::{TerminalOutputSink, TerminalService};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

use super::DebugSessionService;

/// A no-op [`ReverseRequestHandler`] — recognizes nothing, matching
/// `debug::session`'s own `NullReverseRequestHandler` (private to that
/// module) for every test in this file that is not itself exercising real
/// reverse-request handling.
struct NoopReverseRequestHandler;

impl ReverseRequestHandler for NoopReverseRequestHandler {
    fn handle(
        &self,
        _session_id: DebugSessionId,
        _command: &str,
        _arguments: Option<&Value>,
    ) -> Option<ReverseRequestOutcome> {
        None
    }
}

fn noop_reverse_requests() -> std::sync::Arc<dyn ReverseRequestHandler> {
    std::sync::Arc::new(NoopReverseRequestHandler)
}

/// Real `runInTerminal` handling, exercised end to end against a real
/// `TerminalService` this test constructs directly (no live Tauri `App`
/// running) — delegates to the exact same
/// `debug::commands::handle_run_in_terminal_reverse_request` production code
/// calls, proving this integration test is not a parallel reimplementation.
/// See `debug::commands::RunInTerminalReverseRequestHandler`'s own doc
/// comment for why the production `AppHandle`-backed handler is a thin
/// wrapper around the exact same free function.
struct TestRunInTerminalHandler {
    terminal: std::sync::Arc<TerminalService>,
    trust: std::sync::Arc<TrustService>,
    workspace: std::sync::Arc<WorkspaceService>,
    remote: std::sync::Arc<RemoteSessionService>,
    window_label: String,
    root_id: RootId,
    sink: std::sync::Arc<dyn TerminalOutputSink>,
}

impl ReverseRequestHandler for TestRunInTerminalHandler {
    fn handle(
        &self,
        _session_id: DebugSessionId,
        command: &str,
        arguments: Option<&Value>,
    ) -> Option<ReverseRequestOutcome> {
        if command != "runInTerminal" {
            return None;
        }
        Some(handle_run_in_terminal_reverse_request(
            &self.terminal,
            &self.trust,
            &self.workspace,
            &self.remote,
            &self.window_label,
            self.root_id,
            arguments,
            std::sync::Arc::clone(&self.sink),
        ))
    }
}

/// Records every frame/exit a [`TerminalOutputSink`] receives — this test's
/// own proof that the `runInTerminal`-launched session is a real,
/// `TerminalService`-backed PTY session actually producing output, not a
/// fabricated/no-op one.
#[derive(Default)]
struct RecordingTerminalSink {
    frames: std::sync::Mutex<Vec<crate::terminal::dto::TerminalSessionId>>,
}

impl TerminalOutputSink for RecordingTerminalSink {
    fn emit_frame(
        &self,
        session_id: crate::terminal::dto::TerminalSessionId,
        _sequence: u64,
        _frame: crate::terminal::vt::DirtyFrame,
    ) {
        self.frames
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(session_id);
    }

    fn emit_exit(
        &self,
        _session_id: crate::terminal::dto::TerminalSessionId,
        _status: crate::terminal::service::TerminalExitStatus,
    ) {
    }
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<PathBuf>,
}

impl FakePicker {
    fn selected(paths: Vec<PathBuf>) -> Self {
        Self { paths }
    }
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn workspace_with_roots(window_label: &str, root_paths: Vec<PathBuf>) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(root_paths);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("roots authorize");
    workspace
}

fn workspace_with_root(window_label: &str, root_path: &Path) -> WorkspaceService {
    workspace_with_roots(window_label, vec![root_path.to_path_buf()])
}

fn root_id_at(workspace: &WorkspaceService, window_label: &str, index: usize) -> RootId {
    workspace.snapshot(window_label).unwrap().roots()[index].root_id()
}

/// Holds every temp resource + service handle a trusted-and-confirmed test
/// fixture needs alive for its duration.
struct TrustedConfirmedFixture {
    _root: TempDir,
    _trust_base: TempDir,
    _confirm_base: TempDir,
    _remote_base: TempDir,
    workspace: WorkspaceService,
    trust: TrustService,
    confirmation: ConfirmationService,
    /// `F220` S7 — every existing (local-root) test in this file passes this
    /// through unused: `DebugSessionService::start_session`'s new `remote`
    /// parameter is only ever consulted for a *remote*-backed `root_id` (see
    /// `DebugSessionService::start_session_with_tcp_spawn_budget`'s own
    /// `workspace.remote_context` dispatch) — a freshly constructed, never-
    /// connected [`RemoteSessionService`] is exactly as inert here as an
    /// unused `&TrustService`/`&WorkspaceService` reference would be for a
    /// code path that never reaches it.
    remote: RemoteSessionService,
    root_id: RootId,
}

fn trusted_and_confirmed(
    window_label: &str,
    descriptor: &AdapterSpawnDescriptor,
    transport: AdapterTransportKind,
) -> TrustedConfirmedFixture {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let confirm_base = TempDir::new().unwrap();
    let remote_base = TempDir::new().unwrap();
    let workspace = workspace_with_root(window_label, root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    let confirmation = ConfirmationService::new(confirm_base.path().to_path_buf());
    block_on(confirmation.grant(
        &workspace,
        window_label,
        &descriptor.confirmation_subject(transport),
    ))
    .expect("confirmation grant succeeds");
    let remote = RemoteSessionService::new(remote_base.path().to_path_buf());
    let root_id = root_id_at(&workspace, window_label, 0);
    TrustedConfirmedFixture {
        _root: root,
        _trust_base: trust_base,
        _confirm_base: confirm_base,
        _remote_base: remote_base,
        workspace,
        trust,
        confirmation,
        remote,
        root_id,
    }
}

#[derive(Default)]
struct RecordingSink {
    events: std::sync::Mutex<Vec<(DebugSessionId, String, Option<Value>)>>,
    ended: std::sync::Mutex<Vec<(DebugSessionId, SessionEndReason)>>,
}

impl DebugEventSink for RecordingSink {
    fn emit_event(&self, session_id: DebugSessionId, event: String, body: Option<Value>) {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((session_id, event, body));
    }

    fn emit_session_ended(&self, session_id: DebugSessionId, reason: SessionEndReason) {
        self.ended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((session_id, reason));
    }
}

impl RecordingSink {
    fn events_snapshot(&self) -> Vec<(DebugSessionId, String, Option<Value>)> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

fn recording_sink() -> (
    std::sync::Arc<RecordingSink>,
    std::sync::Arc<dyn DebugEventSink>,
) {
    let sink = std::sync::Arc::new(RecordingSink::default());
    let for_session: std::sync::Arc<dyn DebugEventSink> = sink.clone();
    (sink, for_session)
}

fn wait_until(mut condition: impl FnMut() -> bool, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if condition() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Resolves an absolute `python3` path via `command -v` — test-setup only
/// (never the SUT's own code path); `None` if not found, so the affected
/// test can skip explicitly instead of failing on an environment quirk.
fn resolve_python3() -> Option<PathBuf> {
    let output = Command::new("/bin/sh")
        .args(["-c", "command -v python3"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

/// A minimal, self-contained mock DAP adapter — no `debugpy` dependency,
/// just this project's own wire protocol implemented directly in ~50 lines
/// of Python standard library. Scripts the exact real-world handshake
/// ordering `docs/research/2026-07-28-generic-dap.md` captured from real
/// `debugpy`: `initialized` fires (and the `launch`/`attach` response is
/// withheld) until *after* `configurationDone`'s own response.
const PYTHON_MOCK_ADAPTER_SCRIPT: &str = r#"
import sys, json

def read_message():
    headers = {}
    first = True
    while True:
        line = sys.stdin.buffer.readline()
        if line == b"":
            if first:
                return None
            break
        first = False
        if line in (b"\r\n", b"\n"):
            break
        if b":" in line:
            name, _, value = line.partition(b":")
            headers[name.strip().lower()] = value.strip()
    length = int(headers[b"content-length"])
    body = sys.stdin.buffer.read(length)
    return json.loads(body)

def write_message(obj):
    body = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(("Content-Length: %d\r\n\r\n" % len(body)).encode("ascii"))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()

counter = [1000]

def next_seq():
    counter[0] += 1
    return counter[0]

pending_launch_seq = None
pending_launch_command = None
# `F100` S4: mirrors a real adapter's own execution-state bookkeeping —
# continue/pause flip it, next/stepIn/stepOut only succeed while stopped
# (mirroring real single-threaded stepping semantics), letting the Rust test
# exercise a step request issued while the session is *not* stopped as a
# real, adapter-rejected `success: false` reply (this project's own
# "步进请求在会话未 stopped 时发出" coverage requirement) rather than a
# fabricated one.
stopped = {"value": True}

# `F100` S3: five synthetic stack frames (for `stackTrace` pagination),
# two scopes for frame 1 and zero for frame 2 (the "genuinely empty scopes"
# scenario), and a 5000-element synthetic "big" collection under
# `variablesReference: 300` (the large-array/pagination scenario) — all
# scripted directly in this same real subprocess so the interactive-command
# tests below exercise a real spawned process, not just the in-memory mock
# `debug::session::tests` already covers.
STACK_FRAMES = [
    {"id": i, "name": "frame%d" % i, "line": i * 10, "column": 1,
     "source": {"path": "/tmp/prog.py", "name": "prog.py"}}
    for i in range(1, 6)
]

while True:
    message = read_message()
    if message is None:
        break
    command = message.get("command")
    request_seq = message.get("seq")
    arguments = message.get("arguments") or {}
    if command == "initialize":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "initialize",
            "body": {"supportsConfigurationDoneRequest": True, "supportsConditionalBreakpoints": True},
        })
    elif command in ("launch", "attach"):
        pending_launch_seq = request_seq
        pending_launch_command = command
        write_message({"seq": next_seq(), "type": "event", "event": "initialized"})
    elif command == "setBreakpoints":
        # Real-adapter-like reply: a requested line of 5 gets moved to the
        # nearest executable line (105); a requested line of 999 is rejected
        # outright (`verified: false`); everything else verifies as-is —
        # exactly the two adversarial behaviors this project's own research
        # doc calls out by name ("adapter 回传的 verified 状态与实际落点行号
        # 可能与请求不同——真实 adapter 会移动断点到最近可执行行").
        reported = []
        for entry in arguments.get("breakpoints", []):
            line = entry.get("line")
            if line == 5:
                reported.append({"verified": True, "line": 105})
            elif line == 999:
                reported.append({"verified": False, "message": "no code on this line"})
            else:
                reported.append({"verified": True, "line": line})
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "setBreakpoints", "body": {"breakpoints": reported},
        })
    elif command == "configurationDone":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "configurationDone",
        })
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": pending_launch_seq,
            "success": True, "command": pending_launch_command,
        })
        write_message({"seq": next_seq(), "type": "event", "event": "stopped", "body": {"reason": "entry", "threadId": 1}})
    elif command == "stackTrace":
        start_frame = arguments.get("startFrame", 0)
        levels = arguments.get("levels")
        # `F100` S5's own real large-object benchmark: `threadId: 999999` is a
        # sentinel this mock alone understands (never sent by any production
        # code path — real thread ids come from the adapter's own `stopped`/
        # `thread` events), requesting a genuinely deep (2000-frame) call
        # stack in one response rather than the 5-frame default above.
        if arguments.get("threadId") == 999999:
            total = 2000
            end = min(start_frame + levels, total) if levels else total
            frames = [
                {"id": i, "name": "deep_frame_%d" % i, "line": i, "column": 1,
                 "source": {"path": "/tmp/deep.py", "name": "deep.py"}}
                for i in range(start_frame, end)
            ]
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": True, "command": "stackTrace",
                "body": {"stackFrames": frames, "totalFrames": total},
            })
        else:
            end = start_frame + levels if levels else len(STACK_FRAMES)
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": True, "command": "stackTrace",
                "body": {"stackFrames": STACK_FRAMES[start_frame:end], "totalFrames": len(STACK_FRAMES)},
            })
    elif command == "scopes":
        frame_id = arguments.get("frameId")
        if frame_id == 1:
            scopes = [
                {"name": "Locals", "variablesReference": 100, "namedVariables": 2, "expensive": False},
                {"name": "Globals", "variablesReference": 200, "namedVariables": 1, "expensive": False},
            ]
        else:
            scopes = []
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "scopes", "body": {"scopes": scopes},
        })
    elif command == "variables":
        reference = arguments.get("variablesReference")
        if reference == 100:
            variables = [
                {"name": "a", "value": "3", "type": "int", "variablesReference": 0},
                {"name": "big", "value": "list[5000]", "variablesReference": 300, "indexedVariables": 5000},
            ]
        elif reference == 200:
            variables = [{"name": "PI", "value": "3.14", "type": "float", "variablesReference": 0}]
        elif reference == 300:
            start = arguments.get("start", 0) or 0
            count = arguments.get("count")
            end = start + count if count else 5000
            variables = [
                {"name": "item_%d" % i, "value": str(i), "variablesReference": 0}
                for i in range(start, min(end, 5000))
            ]
        elif reference == 999999:
            # `F100` S5's own real large-object benchmark: a 50,000-element
            # synthetic array under a sentinel reference this mock alone
            # understands, well beyond the 5,000-element pagination scenario
            # `F100` S3 already covers above.
            start = arguments.get("start", 0) or 0
            count = arguments.get("count")
            total = 50000
            end = min(start + count, total) if count else total
            variables = [
                {"name": "item_%d" % i, "value": str(i), "variablesReference": 0}
                for i in range(start, end)
            ]
        else:
            variables = []
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "variables", "body": {"variables": variables},
        })
    elif command == "evaluate":
        expression = arguments.get("expression")
        if expression == "raise NameError":
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": False, "command": "evaluate",
                "message": "NameError: name 'raise' is not defined",
            })
        elif expression == "a + b" and arguments.get("context") == "watch":
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": True, "command": "evaluate",
                "body": {"result": "7", "type": "int", "variablesReference": 0},
            })
        else:
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": True, "command": "evaluate",
                "body": {"result": repr(expression), "variablesReference": 0},
            })
    elif command == "continue":
        if not stopped["value"]:
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": False, "command": "continue", "message": "already running",
            })
        else:
            stopped["value"] = False
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": True, "command": "continue",
                "body": {"allThreadsContinued": True, "receivedCommand": "continue"},
            })
    elif command in ("next", "stepIn", "stepOut"):
        if not stopped["value"]:
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": False, "command": command, "message": "not stopped",
            })
        else:
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": True, "command": command,
                "body": {"receivedCommand": command},
            })
    elif command == "pause":
        if stopped["value"]:
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": False, "command": "pause", "message": "already stopped",
            })
        else:
            stopped["value"] = True
            write_message({
                "seq": next_seq(), "type": "response", "request_seq": request_seq,
                "success": True, "command": "pause",
                "body": {"receivedCommand": "pause"},
            })
    elif command == "disconnect":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "disconnect",
        })
        break
    elif command == "floodOutput":
        # `F100` S5's own real backpressure benchmark: a custom, non-DAP
        # command this test-only mock alone understands (never a real DAP
        # request), fired directly via `send_request_with_timeout_for_test`
        # rather than any production command — floods `count` real `output`
        # events of `lineBytes` bytes each *before* ever replying, exactly
        # the "adapter writes to stdout in a tight loop" scenario
        # `output_gate`'s own module doc names.
        count = arguments.get("count", 0)
        line_bytes = arguments.get("lineBytes", 8)
        line = ("x" * max(line_bytes - 1, 0)) + "\n"
        for _ in range(count):
            write_message({"seq": next_seq(), "type": "event", "event": "output", "body": {"category": "stdout", "output": line}})
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "floodOutput",
        })
    elif command == "neverReplies":
        # `F100` S5's own real per-request-timeout benchmark/proof: a
        # deliberately unanswered command — the adapter process stays alive
        # and responsive to *other* requests, it simply never answers this
        # one, mirroring a genuinely slow/hung single request rather than a
        # dead adapter.
        pass
    else:
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": command,
        })
"#;

#[test]
fn debug_launch_over_a_real_spawned_stdio_process_drives_the_full_handshake_end_to_end() {
    let Some(python3) = resolve_python3() else {
        eprintln!(
            "skipping debug_launch_over_a_real_spawned_stdio_process_drives_the_full_handshake_end_to_end: \
             python3 not found via `command -v python3`; cannot construct the real stdio mock adapter subprocess"
        );
        return;
    };

    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec!["-c".to_owned(), PYTHON_MOCK_ADAPTER_SCRIPT.to_owned()],
    };
    let window_label = "main";
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Stdio);
    let service = DebugSessionService::new();
    let (sink, sink_for_session) = recording_sink();

    let result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Stdio {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
        },
        "mock-python".to_owned(),
        json!({"program": "does-not-matter.py"}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));

    let (session_id, capabilities) =
        result.expect("a real spawned python mock adapter completes the full handshake");
    assert_eq!(
        capabilities
            .get("supportsConfigurationDoneRequest")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(service.session_count_for_test(window_label), 1);

    assert!(
        wait_until(
            || sink
                .events_snapshot()
                .iter()
                .any(|(id, name, _)| *id == session_id && name == "stopped"),
            Duration::from_secs(5)
        ),
        "expected the real subprocess's post-handshake `stopped` event to be forwarded"
    );

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
    assert_eq!(service.session_count_for_test(window_label), 0);
}

/// `F220` S7 — every fixture piece a remote-root `DebugSessionService::start_session`
/// hermetic test needs alive for its duration: a real loopback sshd serving
/// eagerly-spawned `exec` requests (`test_support::DapExecFixture`), the
/// `RemoteSessionService` connected to it, and a `WorkspaceService` whose one
/// root is authorized as `RemoteSsh` against that exact live session (never
/// the test-only `authorize_remote_root_for_test`, which mints an
/// unconnected random session id — this must be the *real* one the exec
/// channel actually opens against).
struct RemoteDebugFixture {
    _remote_base: TempDir,
    _repo_dir: TempDir,
    _trust_base: TempDir,
    _confirm_base: TempDir,
    remote: RemoteSessionService,
    workspace: WorkspaceService,
    trust: TrustService,
    confirmation: ConfirmationService,
    root_id: RootId,
    host_key_fingerprint: String,
    session_id: crate::remote::dto::RemoteSessionId,
}

/// `grant_trust`/`grant_confirmation` are independent switches so
/// untrusted-workspace and unconfirmed-subject rejection tests can each start
/// from an otherwise-identical, fully-wired remote root.
fn remote_debug_fixture(
    window_label: &str,
    descriptor: &AdapterSpawnDescriptor,
    grant_trust: bool,
    grant_confirmation: bool,
) -> RemoteDebugFixture {
    let remote_base = TempDir::new().unwrap();
    let remote = RemoteSessionService::new(remote_base.path().to_path_buf());
    let identity = crate::remote::test_support::generate_key();
    let fixture = block_on(crate::remote::test_support::start_dap_exec_fixture(
        &identity,
    ));
    let session_id = block_on(crate::remote::test_support::connect_dap_exec_test_session(
        &remote,
        window_label,
        &fixture,
    ));
    let host_key_fingerprint = remote
        .session_host_key_fingerprint(window_label, session_id)
        .expect("a just-connected session reports its own live fingerprint");

    // The hermetic fixture's "remote" host is this same test machine (see
    // `test_support::DapExecTestSshHandler`'s own doc comment) — a real,
    // existing local directory is what `cd '<base_path>' && exec …` needs to
    // succeed against.
    let repo_dir = TempDir::new().unwrap();
    let canonical_base_path = std::fs::canonicalize(repo_dir.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();

    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let workspace = WorkspaceService::new();
    let (root_id, _snapshot) = workspace
        .authorize_remote_root(
            window_label,
            session_id,
            &host_key_fingerprint,
            &canonical_base_path,
            "remote-debug-test-root",
        )
        .expect("remote root authorizes against the real live session");
    if grant_trust {
        block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    }

    let confirm_base = TempDir::new().unwrap();
    let confirmation = ConfirmationService::new(confirm_base.path().to_path_buf());
    if grant_confirmation {
        let subject = descriptor
            .confirmation_subject_remote(AdapterTransportKind::Stdio, host_key_fingerprint.clone());
        block_on(confirmation.grant(&workspace, window_label, &subject))
            .expect("remote confirmation grant succeeds");
    }

    RemoteDebugFixture {
        _remote_base: remote_base,
        _repo_dir: repo_dir,
        _trust_base: trust_base,
        _confirm_base: confirm_base,
        remote,
        workspace,
        trust,
        confirmation,
        root_id,
        host_key_fingerprint,
        session_id,
    }
}

/// `F220` S7 — the remote-root twin of
/// `debug_launch_over_a_real_spawned_stdio_process_drives_the_full_handshake_end_to_end`:
/// the exact same real Python mock adapter script, but launched over a real
/// SSH `exec` channel against a real loopback sshd instead of a local
/// `Command::spawn`, driven through the exact same production
/// `DebugSessionService::start_session` entry point (`SessionTransportRequest::Stdio`
/// — the frontend never distinguishes "local" from "remote" transport
/// requests; only `root_id`'s own backend decides). Proves the full chain:
/// trust → remote-context dispatch → remote confirmation gate → real exec
/// channel → real handshake → a real runtime `setBreakpoints` sync → the
/// adapter's own post-handshake `stopped` event → a clean disconnect leaving
/// zero sessions.
#[test]
fn debug_launch_over_a_real_remote_exec_channel_drives_the_full_handshake_breakpoints_and_stopped_event(
) {
    let Some(python3) = resolve_python3() else {
        eprintln!(
            "skipping debug_launch_over_a_real_remote_exec_channel_drives_the_full_handshake_breakpoints_and_stopped_event: \
             python3 not found via `command -v python3`; cannot construct the real remote mock adapter subprocess"
        );
        return;
    };
    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec!["-c".to_owned(), PYTHON_MOCK_ADAPTER_SCRIPT.to_owned()],
    };
    let window_label = "main";
    let fixture = remote_debug_fixture(window_label, &descriptor, true, true);
    let service = DebugSessionService::new();
    let (sink, sink_for_session) = recording_sink();

    let result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Stdio {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
        },
        "mock-python".to_owned(),
        json!({"program": "does-not-matter.py"}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));

    let (session_id, capabilities) =
        result.expect("a real remote exec-channel adapter completes the full handshake");
    assert_eq!(
        capabilities
            .get("supportsConfigurationDoneRequest")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(service.session_count_for_test(window_label), 1);

    let breakpoints_body = block_on(service.send_request_for_root(
        window_label,
        session_id,
        fixture.root_id,
        "setBreakpoints",
        json!({
            "source": { "path": "main.py" },
            "breakpoints": [{ "line": 6 }],
        }),
    ))
    .expect("setBreakpoints succeeds over the real remote channel");
    assert_eq!(
        breakpoints_body
            .get("breakpoints")
            .and_then(Value::as_array)
            .and_then(|entries| entries.first())
            .and_then(|entry| entry.get("verified"))
            .and_then(Value::as_bool),
        Some(true)
    );

    assert!(
        wait_until(
            || sink
                .events_snapshot()
                .iter()
                .any(|(id, name, _)| *id == session_id && name == "stopped"),
            Duration::from_secs(5)
        ),
        "expected the real remote subprocess's post-handshake `stopped` event to be forwarded"
    );

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
    assert_eq!(service.session_count_for_test(window_label), 0);
}

/// `F220` S7 — research doc "架构裁定 §4"/v1 narrowing: a `tcp`/`tcpSpawn`
/// transport request against a remote root fails closed with the dedicated
/// `DEBUG_REMOTE_TRANSPORT_UNSUPPORTED` code — never silently downgraded to
/// `stdio`, never the generic `ROOT_BACKEND_UNSUPPORTED`, and (proven here by
/// never granting the `tcp` confirmation identity at all) rejected *before*
/// the confirmation gate, not because of it.
#[test]
fn debug_launch_rejects_tcp_and_tcp_spawn_transports_for_a_remote_root() {
    let descriptor = AdapterSpawnDescriptor {
        command: "/usr/bin/lldb-dap".to_owned(),
        args: Vec::new(),
    };
    let window_label = "main";
    let fixture = remote_debug_fixture(window_label, &descriptor, true, false);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    let tcp_result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Tcp {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
            host: "127.0.0.1".to_owned(),
            port: 5678,
        },
        "lldb".to_owned(),
        json!({}),
        Vec::new(),
        std::sync::Arc::clone(&sink_for_session),
        noop_reverse_requests(),
    ));
    let tcp_error = tcp_result.expect_err("tcp transport must be rejected for a remote root");
    assert_eq!(tcp_error.code(), "DEBUG_REMOTE_TRANSPORT_UNSUPPORTED");

    let tcp_spawn_result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::TcpSpawn {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
            port: 5678,
        },
        "lldb".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));
    let tcp_spawn_error =
        tcp_spawn_result.expect_err("tcpSpawn transport must be rejected for a remote root");
    assert_eq!(tcp_spawn_error.code(), "DEBUG_REMOTE_TRANSPORT_UNSUPPORTED");

    assert_eq!(service.session_count_for_test(window_label), 0);
}

/// `F220` S7 — an untrusted workspace fails closed before ever reaching the
/// remote-context dispatch, the confirmation gate, or the SSH exec channel —
/// exactly like `spawn_adapter`'s own local trust gate, now proven for the
/// remote branch specifically.
#[test]
fn debug_launch_over_a_remote_root_fails_closed_when_the_workspace_is_untrusted() {
    let descriptor = AdapterSpawnDescriptor {
        command: "/usr/bin/python3".to_owned(),
        args: vec!["-m".to_owned(), "debugpy.adapter".to_owned()],
    };
    let window_label = "main";
    // Neither trust nor confirmation granted — trust must fail first.
    let fixture = remote_debug_fixture(window_label, &descriptor, false, false);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    let result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Stdio {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
        },
        "python".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));
    let error = result.expect_err("an untrusted workspace must never reach the exec channel");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
    assert_eq!(service.session_count_for_test(window_label), 0);
}

/// `F220` S7 — the exact `(command, args, transport)` triple confirmed for a
/// *local* root must not silently cover the identical triple on a *remote*
/// one: `AdapterConfirmationSubject::remote_host_fingerprint` is an
/// independent dimension of the confirmation key (see that field's own doc
/// comment). Reuses `remote_debug_fixture`'s already-live remote session, but
/// grants confirmation only under the *local*-shaped subject (no
/// `remote_host_fingerprint`) — a real `start_session` attempt against the
/// remote root must still report `DEBUG_ADAPTER_NOT_CONFIRMED`.
#[test]
fn a_confirmation_granted_for_the_local_identity_does_not_cover_the_identical_remote_one() {
    let descriptor = AdapterSpawnDescriptor {
        command: "/usr/bin/python3".to_owned(),
        args: vec!["-m".to_owned(), "debugpy.adapter".to_owned()],
    };
    let window_label = "main";
    let fixture = remote_debug_fixture(window_label, &descriptor, true, false);
    // Grants the *local* identity only — mirrors exactly what
    // `descriptor.confirmation_subject(AdapterTransportKind::Stdio)` (the
    // plain local constructor `exec::spawn_adapter` itself uses) produces.
    block_on(fixture.confirmation.grant(
        &fixture.workspace,
        window_label,
        &descriptor.confirmation_subject(AdapterTransportKind::Stdio),
    ))
    .expect("local-shaped confirmation grant succeeds");

    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();
    let result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Stdio {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
        },
        "python".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));
    let error = result
        .expect_err("a local-only confirmation grant must not satisfy the remote root's own gate");
    assert_eq!(error.code(), "DEBUG_ADAPTER_NOT_CONFIRMED");

    // Sanity check on the fixture itself: the *remote*-shaped subject really
    // is a different key from the one just granted (never coincidentally the
    // same JSON) — `fixture.host_key_fingerprint` is not empty for this real
    // connected session, so this is a real, non-trivial second identity.
    assert!(!fixture.host_key_fingerprint.is_empty());
    assert_ne!(
        descriptor.confirmation_subject(AdapterTransportKind::Stdio),
        descriptor.confirmation_subject_remote(
            AdapterTransportKind::Stdio,
            fixture.host_key_fingerprint.clone()
        ),
    );
    let _ = fixture.session_id;
}

/// `F100` S3: the interactive debugging surface (`send_request` — the
/// generic seam `debug_set_breakpoints`/`debug_stack_trace`/`debug_scopes`/
/// `debug_variables`/`debug_evaluate` all resolve to), exercised end to end
/// against the *same* real spawned Python subprocess mock adapter the S2
/// handshake test above uses (extended with `stackTrace`/`scopes`/
/// `variables`/`evaluate` handling — see the script's own comments), proving
/// this is real production wiring, not just the in-memory harness
/// `debug::session::tests` already covers. Exercises every adversarial
/// behavior this project's own research doc and this slice's task both call
/// out by name: a breakpoint the adapter moves to a different line, one it
/// rejects outright (`verified: false`), a genuinely empty `scopes` array,
/// `variablesReference` pagination/slicing (`start`/`count`) against a
/// synthetic 5000-element collection, and an adapter `success: false` reply
/// mapped to `DEBUG_REQUEST_FAILED`.
#[test]
fn interactive_debugging_commands_work_end_to_end_over_a_real_spawned_stdio_process() {
    let Some(python3) = resolve_python3() else {
        eprintln!(
            "skipping interactive_debugging_commands_work_end_to_end_over_a_real_spawned_stdio_process: \
             python3 not found via `command -v python3`; cannot construct the real stdio mock adapter subprocess"
        );
        return;
    };

    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec!["-c".to_owned(), PYTHON_MOCK_ADAPTER_SCRIPT.to_owned()],
    };
    let window_label = "main";
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Stdio);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    let (session_id, _capabilities) = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Stdio {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
        },
        "mock-python".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ))
    .expect("handshake succeeds");

    // A session is immutably bound to the root that started it: presenting
    // the same live session id with a different root must fail before any DAP
    // request reaches the adapter.
    let foreign_root_id = RootId::parse_v4_wire("22222222-2222-4222-8222-222222222222").unwrap();
    let mismatch = block_on(service.send_request_for_root(
        window_label,
        session_id,
        foreign_root_id,
        "setBreakpoints",
        json!({"source": {"path": "foreign.py"}, "breakpoints": []}),
    ))
    .expect_err("a foreign root must not address the live session");
    assert_eq!(mismatch.code(), "DEBUG_SESSION_NOT_FOUND");

    // --- setBreakpoints: a moved line and a rejected one, in one request. ---
    let set_breakpoints_body = block_on(service.send_request_for_root(
        window_label,
        session_id,
        fixture.root_id,
        "setBreakpoints",
        json!({
            "source": {"path": "/tmp/prog.py"},
            "breakpoints": [{"line": 5}, {"line": 999}, {"line": 10}],
        }),
    ))
    .expect("setBreakpoints succeeds");
    let set_breakpoints = crate::debug::dto::parse_set_breakpoints_response(&set_breakpoints_body)
        .expect("well-formed setBreakpoints response");
    assert!(set_breakpoints.breakpoints[0].verified);
    assert_eq!(set_breakpoints.breakpoints[0].line, Some(105));
    assert!(!set_breakpoints.breakpoints[1].verified);
    assert!(set_breakpoints.breakpoints[1]
        .message
        .as_deref()
        .unwrap()
        .contains("no code"));
    assert!(set_breakpoints.breakpoints[2].verified);
    assert_eq!(set_breakpoints.breakpoints[2].line, Some(10));

    // --- stackTrace: pagination via startFrame/levels. ---
    let full_stack_body = block_on(service.send_request(
        window_label,
        session_id,
        "stackTrace",
        json!({"threadId": 1}),
    ))
    .expect("stackTrace succeeds");
    let full_stack = crate::debug::dto::parse_stack_trace_response(&full_stack_body)
        .expect("well-formed stackTrace response");
    assert_eq!(full_stack.stack_frames.len(), 5);
    assert_eq!(full_stack.total_frames, Some(5));

    let paged_stack_body = block_on(service.send_request(
        window_label,
        session_id,
        "stackTrace",
        json!({"threadId": 1, "startFrame": 2, "levels": 2}),
    ))
    .expect("paginated stackTrace succeeds");
    let paged_stack = crate::debug::dto::parse_stack_trace_response(&paged_stack_body)
        .expect("well-formed paginated stackTrace response");
    assert_eq!(paged_stack.stack_frames.len(), 2);
    assert_eq!(
        paged_stack.stack_frames[0].id,
        full_stack.stack_frames[2].id
    );
    assert_eq!(paged_stack.total_frames, Some(5));

    // --- scopes: real content for frame 1, genuinely empty for frame 2. ---
    let scopes_body =
        block_on(service.send_request(window_label, session_id, "scopes", json!({"frameId": 1})))
            .expect("scopes succeeds");
    let scopes = crate::debug::dto::parse_scopes_response(&scopes_body)
        .expect("well-formed scopes response");
    assert_eq!(scopes.scopes.len(), 2);
    assert_eq!(scopes.scopes[0].name, "Locals");
    let locals_reference = scopes.scopes[0].variables_reference;

    let empty_scopes_body =
        block_on(service.send_request(window_label, session_id, "scopes", json!({"frameId": 2})))
            .expect("scopes for a frame with no scopes still succeeds");
    let empty_scopes = crate::debug::dto::parse_scopes_response(&empty_scopes_body)
        .expect("well-formed empty scopes response");
    assert!(empty_scopes.scopes.is_empty());

    // --- variables: a leaf, a further-expandable nested reference, and real
    //     start/count pagination against a synthetic 5000-element collection.
    let locals_variables_body = block_on(service.send_request(
        window_label,
        session_id,
        "variables",
        json!({"variablesReference": locals_reference}),
    ))
    .expect("variables succeeds");
    let locals_variables = crate::debug::dto::parse_variables_response(&locals_variables_body)
        .expect("well-formed variables response");
    assert_eq!(locals_variables.variables[0].name, "a");
    assert_eq!(locals_variables.variables[0].variables_reference, 0);
    let big_reference = locals_variables.variables[1].variables_reference;
    assert_eq!(locals_variables.variables[1].indexed_variables, Some(5000));

    let big_page_body = block_on(service.send_request(
        window_label,
        session_id,
        "variables",
        json!({"variablesReference": big_reference, "start": 4990, "count": 10}),
    ))
    .expect("paginated variables succeeds");
    let big_page = crate::debug::dto::parse_variables_response(&big_page_body)
        .expect("well-formed paginated variables response");
    assert_eq!(big_page.variables.len(), 10);
    assert_eq!(big_page.variables[0].name, "item_4990");
    assert_eq!(big_page.variables[9].name, "item_4999");

    // --- evaluate: a successful watch expression and an adapter-rejected one. ---
    let evaluate_body = block_on(service.send_request(
        window_label,
        session_id,
        "evaluate",
        json!({"expression": "a + b", "context": "watch"}),
    ))
    .expect("evaluate succeeds");
    let evaluate = crate::debug::dto::parse_evaluate_response(&evaluate_body)
        .expect("well-formed evaluate response");
    assert_eq!(evaluate.result, "7");
    assert_eq!(evaluate.kind.as_deref(), Some("int"));

    let failed_evaluate = block_on(service.send_request(
        window_label,
        session_id,
        "evaluate",
        json!({"expression": "raise NameError", "context": "watch"}),
    ));
    let error = failed_evaluate.expect_err("an adapter `success: false` reply must fail");
    assert_eq!(error.code(), "DEBUG_REQUEST_FAILED");
    assert!(error.message().contains("NameError"));

    // --- an unknown session id is DEBUG_SESSION_NOT_FOUND, not a hang/panic. ---
    let unknown_session = DebugSessionId::new();
    let unknown_result = block_on(service.send_request(
        window_label,
        unknown_session,
        "evaluate",
        json!({"expression": "1", "context": "watch"}),
    ));
    assert_eq!(
        unknown_result.unwrap_err().code(),
        "DEBUG_SESSION_NOT_FOUND"
    );

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
}

/// `F100` S4's execution/step-control surface
/// (`continue`/`next`/`stepIn`/`stepOut`/`pause`), exercised end to end
/// against the same real spawned Python mock adapter the S3 tests above use
/// (now extended with a `stopped`/running state machine — see
/// `PYTHON_MOCK_ADAPTER_SCRIPT`'s own comment). Proves two things the AST
/// command-registration contract alone cannot (masking every string literal,
/// including each command's own distinguishing DAP name, means
/// `debug_next`/`debug_step_in`/`debug_step_out`/`debug_pause` all reduce to
/// an *identical* normalized body there): (1) each Rust command really does
/// send its own distinct literal DAP command name — verified via the
/// adapter's own `receivedCommand` echo in its reply body, not merely our own
/// side's belief about what it sent — and (2) a step request issued while the
/// session is genuinely **not** stopped surfaces as a real, adapter-rejected
/// `DEBUG_REQUEST_FAILED` (this project's own explicit "步进请求在会话未
/// stopped 时发出" coverage requirement), not a hang or a silently-ignored
/// no-op.
#[test]
fn step_control_commands_send_their_own_distinct_dap_command_and_surface_a_not_stopped_rejection() {
    let Some(python3) = resolve_python3() else {
        eprintln!(
            "skipping step_control_commands_send_their_own_distinct_dap_command_and_surface_a_not_stopped_rejection: \
             python3 not found via `command -v python3`; cannot construct the real stdio mock adapter subprocess"
        );
        return;
    };

    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec!["-c".to_owned(), PYTHON_MOCK_ADAPTER_SCRIPT.to_owned()],
    };
    let window_label = "main";
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Stdio);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    let (session_id, _capabilities) = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Stdio {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
        },
        "mock-python".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ))
    .expect("handshake succeeds");

    // --- Stopped (post-`configurationDone`): `next` succeeds and echoes its
    //     own distinct literal DAP command name back. ---
    let next_body =
        block_on(service.send_request(window_label, session_id, "next", json!({"threadId": 1})))
            .expect("next succeeds while stopped");
    assert_eq!(
        next_body.get("receivedCommand").and_then(Value::as_str),
        Some("next")
    );

    // --- `continue`: succeeds, reports `allThreadsContinued`, flips the mock
    //     adapter's own state to "running". ---
    let continue_body = block_on(service.send_request(
        window_label,
        session_id,
        "continue",
        json!({"threadId": 1}),
    ))
    .expect("continue succeeds while stopped");
    let continue_result = crate::debug::dto::parse_continue_response(&continue_body)
        .expect("well-formed continue response");
    assert!(continue_result.all_threads_continued);
    assert_eq!(
        continue_body.get("receivedCommand").and_then(Value::as_str),
        Some("continue")
    );

    // --- The headline adversarial case: `next` while genuinely running (not
    //     stopped) is a real adapter rejection, not a hang or a silent no-op. ---
    let not_stopped_result =
        block_on(service.send_request(window_label, session_id, "next", json!({"threadId": 1})));
    let error = not_stopped_result.expect_err("the adapter genuinely rejects a step while running");
    assert_eq!(error.code(), "DEBUG_REQUEST_FAILED");
    assert!(error.message().contains("not stopped"));

    // Same adversarial shape for `stepIn`/`stepOut` — each independently,
    // not just `next`.
    for command in ["stepIn", "stepOut"] {
        let result = block_on(service.send_request(
            window_label,
            session_id,
            command,
            json!({"threadId": 1}),
        ));
        assert_eq!(
            result.expect_err("rejected while running").code(),
            "DEBUG_REQUEST_FAILED"
        );
    }

    // --- `pause`: succeeds only while running, echoes its own command name,
    //     flips the mock back to stopped. ---
    let pause_body =
        block_on(service.send_request(window_label, session_id, "pause", json!({"threadId": 1})))
            .expect("pause succeeds while running");
    assert_eq!(
        pause_body.get("receivedCommand").and_then(Value::as_str),
        Some("pause")
    );

    // Now stopped again: `stepIn`/`stepOut` each succeed and echo their own
    // distinct command name — proving all five commands are individually
    // wired to their own literal DAP request, not just `next`/`continue`.
    for command in ["stepIn", "stepOut"] {
        let body = block_on(service.send_request(
            window_label,
            session_id,
            command,
            json!({"threadId": 1}),
        ))
        .expect("succeeds while stopped");
        assert_eq!(
            body.get("receivedCommand").and_then(Value::as_str),
            Some(command)
        );
    }

    // `pause` while already stopped is itself an adversarial rejection.
    let pause_again =
        block_on(service.send_request(window_label, session_id, "pause", json!({"threadId": 1})));
    assert_eq!(
        pause_again.expect_err("already stopped").code(),
        "DEBUG_REQUEST_FAILED"
    );

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
}

/// A second, dedicated mock adapter script (deliberately **not** sharing/
/// mutating [`PYTHON_MOCK_ADAPTER_SCRIPT`] — bolting a `runInTerminal`
/// reverse request onto the shared script risked interleaving an
/// unsolicited reverse request into the two tests above's own expected
/// command sequences, for no real coverage benefit) — issues a real
/// `runInTerminal` reverse request right after `configurationDone`, then
/// re-emits our own reply to it as a `mockRunInTerminalAck` event, so this
/// test can observe (from the *adapter's own point of view*) that it
/// actually received a well-formed `success: true` reply carrying a real
/// `processId` — not just that our side believes it sent one.
const RUN_IN_TERMINAL_MOCK_ADAPTER_SCRIPT: &str = r#"
import sys, json

def read_message():
    headers = {}
    first = True
    while True:
        line = sys.stdin.buffer.readline()
        if line == b"":
            if first:
                return None
            break
        first = False
        if line in (b"\r\n", b"\n"):
            break
        if b":" in line:
            name, _, value = line.partition(b":")
            headers[name.strip().lower()] = value.strip()
    length = int(headers[b"content-length"])
    body = sys.stdin.buffer.read(length)
    return json.loads(body)

def write_message(obj):
    body = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(("Content-Length: %d\r\n\r\n" % len(body)).encode("ascii"))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()

counter = [2000]

def next_seq():
    counter[0] += 1
    return counter[0]

pending_launch_seq = None
pending_launch_command = None

while True:
    message = read_message()
    if message is None:
        break
    if message.get("type") == "response":
        # Our own reply to the runInTerminal reverse request this script
        # sent below — re-emitted as an event so the Rust test can observe
        # what the adapter itself actually received.
        write_message({
            "seq": next_seq(), "type": "event", "event": "mockRunInTerminalAck",
            "body": {"success": message.get("success"), "body": message.get("body")},
        })
        continue
    command = message.get("command")
    request_seq = message.get("seq")
    if command == "initialize":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "initialize", "body": {},
        })
    elif command in ("launch", "attach"):
        pending_launch_seq = request_seq
        pending_launch_command = command
        write_message({"seq": next_seq(), "type": "event", "event": "initialized"})
    elif command == "configurationDone":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "configurationDone",
        })
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": pending_launch_seq,
            "success": True, "command": pending_launch_command,
        })
        write_message({
            "seq": next_seq(), "type": "request", "command": "runInTerminal",
            "arguments": {
                "kind": "integrated",
                "title": "Run Program",
                "args": ["/bin/sh", "-c", "pwd > run-in-terminal-cwd.txt; echo hello-from-run-in-terminal"],
                "env": {"MOCK_RUN_IN_TERMINAL": "1"},
            },
        })
    elif command == "disconnect":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "disconnect",
        })
        break
    else:
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": command,
        })
"#;

/// The headline `runInTerminal` proof this project's own task instructions
/// call for: a real spawned Python mock adapter issues a real `runInTerminal`
/// reverse request; this asserts (1) the adapter itself receives a
/// well-formed `success: true` reply carrying a real, positive `processId`
/// (from the adapter's own point of view, via `mockRunInTerminalAck` above —
/// not merely that our side believes it replied), (2) a real
/// `TerminalService` session was created (`session_count_for_test`, and a
/// real frame was actually emitted by the spawned shell — proving this is a
/// genuine, running PTY session, not a fabricated no-op), (3) the frontend
/// notification our reverse-request handler emits carries the exact same
/// `terminalSessionId`, and (4) that session is independently killable
/// through `TerminalService`'s own ordinary API — proving it is a normal,
/// user-manageable terminal, not a hidden side channel the debug domain
/// privately owns. `handle_run_in_terminal_reverse_request` (the function
/// under test here, via [`TestRunInTerminalHandler`]) is the *exact* function
/// `debug::commands::RunInTerminalReverseRequestHandler` calls in
/// production — this is not a parallel reimplementation.
#[test]
fn run_in_terminal_reverse_request_spawns_a_real_terminal_service_session_with_no_hidden_spawn_path(
) {
    let Some(python3) = resolve_python3() else {
        eprintln!(
            "skipping run_in_terminal_reverse_request_spawns_a_real_terminal_service_session_with_no_hidden_spawn_path: \
             python3 not found via `command -v python3`; cannot construct the real stdio mock adapter subprocess"
        );
        return;
    };

    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec![
            "-c".to_owned(),
            RUN_IN_TERMINAL_MOCK_ADAPTER_SCRIPT.to_owned(),
        ],
    };
    let window_label = "main";

    let primary_root = TempDir::new().unwrap();
    let selected_root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let confirm_base = TempDir::new().unwrap();
    let remote_base = TempDir::new().unwrap();
    // `Arc`-wrapped (unlike `trusted_and_confirmed`'s own owned fields) —
    // `TestRunInTerminalHandler` must outlive this function's own call to
    // `start_session` (a reverse request can arrive at any later point in
    // the session's life), so it needs a `'static`-safe, shared handle onto
    // the *same* `TrustService`/`WorkspaceService` instances `start_session`
    // itself is called with — not merely ones pointed at the same on-disk
    // trust file, and (for `WorkspaceService`, whose authorized-roots state
    // is purely in-memory, never persisted) not merely a fresh instance that
    // happens to exist, which would report zero authorized roots for this
    // window and fail `TerminalService::start_program`'s own trust check.
    let workspace = std::sync::Arc::new(workspace_with_roots(
        window_label,
        vec![
            primary_root.path().to_path_buf(),
            selected_root.path().to_path_buf(),
        ],
    ));
    let trust = std::sync::Arc::new(TrustService::new(trust_base.path().to_path_buf()));
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    let confirmation = ConfirmationService::new(confirm_base.path().to_path_buf());
    block_on(confirmation.grant(
        &workspace,
        window_label,
        &descriptor.confirmation_subject(AdapterTransportKind::Stdio),
    ))
    .expect("confirmation grant succeeds");
    let remote = std::sync::Arc::new(RemoteSessionService::new(remote_base.path().to_path_buf()));

    let service = DebugSessionService::new();
    let (sink, sink_for_session) = recording_sink();

    let terminal_base = TempDir::new().unwrap();
    let terminal = std::sync::Arc::new(TerminalService::new(terminal_base.path().to_path_buf()));
    let terminal_sink = std::sync::Arc::new(RecordingTerminalSink::default());
    let terminal_sink_for_handler: std::sync::Arc<dyn TerminalOutputSink> = terminal_sink.clone();
    let selected_root_id = root_id_at(&workspace, window_label, 1);
    let reverse_requests: std::sync::Arc<dyn ReverseRequestHandler> =
        std::sync::Arc::new(TestRunInTerminalHandler {
            terminal: std::sync::Arc::clone(&terminal),
            trust: std::sync::Arc::clone(&trust),
            workspace: std::sync::Arc::clone(&workspace),
            remote: std::sync::Arc::clone(&remote),
            window_label: window_label.to_owned(),
            root_id: selected_root_id,
            sink: terminal_sink_for_handler,
        });

    let (session_id, _capabilities) = block_on(service.start_session(
        &trust,
        &remote,
        &workspace,
        window_label,
        selected_root_id,
        &confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Stdio {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
        },
        "mock-run-in-terminal".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        reverse_requests,
    ))
    .expect("handshake succeeds");

    // --- (1) the adapter itself received a real, successful reply. ---
    assert!(
        wait_until(
            || sink
                .events_snapshot()
                .iter()
                .any(|(_, name, _)| name == "mockRunInTerminalAck"),
            Duration::from_secs(5)
        ),
        "expected the mock adapter to receive and re-emit our runInTerminal reply"
    );
    let ack = sink
        .events_snapshot()
        .into_iter()
        .find(|(_, name, _)| name == "mockRunInTerminalAck")
        .expect("present per the assertion above");
    let ack_body = ack.2.expect("mockRunInTerminalAck always carries a body");
    assert_eq!(ack_body.get("success").and_then(Value::as_bool), Some(true));
    let acked_process_id = ack_body
        .get("body")
        .and_then(|body| body.get("processId"))
        .and_then(Value::as_u64)
        .expect("the adapter's own view of our reply carries a real processId");
    assert!(acked_process_id > 0);

    // --- (3) our own frontend-facing notification carries the same session. ---
    let notification = sink
        .events_snapshot()
        .into_iter()
        .find(|(_, name, _)| name == "plain/runInTerminal")
        .expect("the runInTerminal handler's notify event was forwarded to the sink");
    let notification_body = notification
        .2
        .expect("plain/runInTerminal always carries a body");
    assert_eq!(
        notification_body.get("processId").and_then(Value::as_u64),
        Some(acked_process_id),
        "the frontend notification and the adapter's own acked reply must report the same real pid"
    );
    let terminal_session_wire = notification_body
        .get("terminalSessionId")
        .and_then(Value::as_str)
        .expect("a real terminal session id string")
        .to_owned();

    // --- (2) a real, running `TerminalService` session was created. ---
    assert_eq!(terminal.session_count_for_test(window_label), 1);
    assert!(
        wait_until(
            || selected_root
                .path()
                .join("run-in-terminal-cwd.txt")
                .is_file(),
            Duration::from_secs(5),
        ),
        "a missing cwd from the real debugpy-shaped request must resolve to the selected second root"
    );
    assert!(
        !primary_root.path().join("run-in-terminal-cwd.txt").exists(),
        "the first root must remain untouched"
    );
    assert!(
        wait_until(
            || !terminal_sink
                .frames
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .is_empty(),
            Duration::from_secs(5)
        ),
        "expected the real spawned shell to actually produce PTY output"
    );

    // --- (4) that session is independently killable via `TerminalService`'s
    //     own ordinary API — the same one `Plain: Kill Terminal` uses for any
    //     other terminal tab, proving no hidden, debug-domain-only spawn path.
    let terminal_session_id: crate::terminal::dto::TerminalSessionId =
        serde_json::from_value(Value::String(terminal_session_wire))
            .expect("a well-formed terminal session id");
    block_on(terminal.kill(window_label, terminal_session_id, true)).expect(
        "the runInTerminal-launched session is killable through the ordinary TerminalService API",
    );
    assert_eq!(terminal.session_count_for_test(window_label), 0);

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
}

/// The real-socket counterpart of a mock adapter, scripted directly against
/// a genuine `TcpStream` — mirrors `debug::tcp::tests`'s own real-socket
/// technique, extended here to a full scripted handshake rather than just a
/// framing proof.
struct RealSocketMockAdapter {
    stream: TcpStream,
    decoder: FrameDecoder,
}

impl RealSocketMockAdapter {
    fn recv_message(&mut self) -> IncomingMessage {
        let mut buffer = [0_u8; 4096];
        loop {
            let read = self
                .stream
                .read(&mut buffer)
                .expect("a real loopback socket read succeeds");
            assert!(read > 0, "peer closed before an expected message arrived");
            let messages = self
                .decoder
                .feed(&buffer[..read])
                .expect("this test's own scripted frames are well-formed");
            if let Some(message) = messages.into_iter().next() {
                return parse_incoming_message(&message.body)
                    .expect("this test's own scripted frames are well-formed JSON");
            }
        }
    }

    fn send_response(&mut self, seq: i64, request_seq: i64, command: &str, body: Option<Value>) {
        let framed = encode_response(seq, request_seq, command, true, None, body);
        self.stream
            .write_all(&framed)
            .expect("real socket write succeeds");
    }

    fn send_event(&mut self, seq: i64, event: &str, body: Option<Value>) {
        let mut object = serde_json::Map::new();
        object.insert("seq".to_owned(), Value::from(seq));
        object.insert("type".to_owned(), Value::from("event"));
        object.insert("event".to_owned(), Value::from(event));
        if let Some(body) = body {
            object.insert("body".to_owned(), body);
        }
        let json_bytes = serde_json::to_vec(&Value::Object(object)).unwrap();
        let mut framed = format!("Content-Length: {}\r\n\r\n", json_bytes.len()).into_bytes();
        framed.extend_from_slice(&json_bytes);
        self.stream
            .write_all(&framed)
            .expect("real socket write succeeds");
    }
}

fn expect_request(message: IncomingMessage, expected_command: &str) -> i64 {
    match message {
        IncomingMessage::Request(request) => {
            assert_eq!(request.command, expected_command);
            request.seq
        }
        other => panic!("expected a {expected_command} request, got {other:?}"),
    }
}

#[test]
fn debug_launch_over_a_real_tcp_socket_drives_the_full_handshake_end_to_end() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("binds an ephemeral loopback port");
    let port = listener.local_addr().unwrap().port();

    let adapter_thread = std::thread::spawn(move || {
        let (stream, _addr) = listener
            .accept()
            .expect("accepts the client's real connection");
        let mut adapter = RealSocketMockAdapter {
            stream,
            decoder: FrameDecoder::new(),
        };
        let init_seq = expect_request(adapter.recv_message(), "initialize");
        adapter.send_response(
            1,
            init_seq,
            "initialize",
            Some(json!({"supportsDataBreakpoints": true})),
        );

        let launch_seq = expect_request(adapter.recv_message(), "launch");
        adapter.send_event(2, "initialized", None);

        let config_done_seq = expect_request(adapter.recv_message(), "configurationDone");
        adapter.send_response(3, config_done_seq, "configurationDone", None);
        adapter.send_response(4, launch_seq, "launch", None);
    });

    // `command`/`args` are only ever used for the confirmation subject's
    // identity in connect-only mode — never actually executed (see
    // `debug::mod`'s own module doc for this slice's connect-only decision).
    let descriptor = AdapterSpawnDescriptor {
        command: "/usr/bin/true".to_owned(),
        args: Vec::new(),
    };
    let window_label = "main";
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Tcp);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    let result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Tcp {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
            host: "127.0.0.1".to_owned(),
            port,
        },
        "mock-tcp".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));

    let (session_id, capabilities) =
        result.expect("a real TCP mock adapter completes the full handshake");
    assert_eq!(
        capabilities
            .get("supportsDataBreakpoints")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(service.session_count_for_test(window_label), 1);

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
    assert_eq!(service.session_count_for_test(window_label), 0);
    adapter_thread.join().expect("adapter thread completes");
}

#[test]
fn close_window_tears_down_every_live_session_and_the_peer_observes_the_connection_close() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("binds an ephemeral loopback port");
    let port = listener.local_addr().unwrap().port();

    let adapter_thread = std::thread::spawn(move || {
        let (stream, _addr) = listener
            .accept()
            .expect("accepts the client's real connection");
        let mut adapter = RealSocketMockAdapter {
            stream,
            decoder: FrameDecoder::new(),
        };
        let init_seq = expect_request(adapter.recv_message(), "initialize");
        adapter.send_response(1, init_seq, "initialize", Some(json!({})));
        let launch_seq = expect_request(adapter.recv_message(), "launch");
        adapter.send_event(2, "initialized", None);
        let config_done_seq = expect_request(adapter.recv_message(), "configurationDone");
        adapter.send_response(3, config_done_seq, "configurationDone", None);
        adapter.send_response(4, launch_seq, "launch", None);

        // Block on a further read — proves `close_window` actually closes
        // the real socket from the client side (this returns once it does,
        // whether as `Ok(0)` or an error, rather than blocking forever).
        let mut buffer = [0_u8; 16];
        let _ = adapter.stream.read(&mut buffer);
    });

    let descriptor = AdapterSpawnDescriptor {
        command: "/usr/bin/true".to_owned(),
        args: Vec::new(),
    };
    let window_label = "main";
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Tcp);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    let (_session_id, _capabilities) = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Tcp {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
            host: "127.0.0.1".to_owned(),
            port,
        },
        "mock".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ))
    .expect("handshake succeeds");
    assert_eq!(service.session_count_for_test(window_label), 1);

    service.close_window(window_label);
    assert_eq!(service.session_count_for_test(window_label), 0);

    adapter_thread
        .join()
        .expect("the adapter thread observes the real connection close and exits");
}

#[test]
fn start_session_still_requires_confirmation_before_ever_attempting_to_connect() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let confirm_base = TempDir::new().unwrap();
    let remote_base = TempDir::new().unwrap();
    let window_label = "main";
    let workspace = workspace_with_root(window_label, root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    // Deliberately never confirmed.
    let confirmation = ConfirmationService::new(confirm_base.path().to_path_buf());
    let remote = RemoteSessionService::new(remote_base.path().to_path_buf());

    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();
    let result = block_on(service.start_session(
        &trust,
        &remote,
        &workspace,
        window_label,
        root_id_at(&workspace, window_label, 0),
        &confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Tcp {
            command: "/usr/bin/true".to_owned(),
            args: Vec::new(),
            host: "127.0.0.1".to_owned(),
            // Deliberately never listened on — proves this fails purely on
            // the confirmation gate, without ever attempting a connection.
            port: 1,
        },
        "mock".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_NOT_CONFIRMED");
    assert_eq!(service.session_count_for_test(window_label), 0);
}

// ---------------------------------------------------------------------
// `F210` S6 — `SessionTransportRequest::TcpSpawn`: real end-to-end
// spawn-then-connect orchestration. Every test below spawns a genuine
// `python3` subprocess (skips with an explicit message if `python3` is not
// found, matching this file's own `resolve_python3` precedent) — no test
// here uses a synthetic probe closure the way `debug::tcp::tests`'s own
// lower-level `connect_loopback_companion_with_retry_sync` tests do; those
// already prove the retry/backoff primitive in isolation, so this file's own
// job is proving `start_session`'s real *composition* of
// `exec::spawn_adapter_as_tcp_companion` with that primitive against a real
// process and a real loopback socket.
// ---------------------------------------------------------------------

/// Binds an ephemeral loopback port, immediately frees it, and hands back
/// just the port number — the exact same "reserve a likely-free port number,
/// then let the real fixture rebind it" idiom `debug::tcp::tests`'s own
/// `free_loopback_port` uses.
fn free_loopback_port_for_test() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("binds an ephemeral loopback port");
    listener.local_addr().unwrap().port()
}

/// A minimal, self-contained TCP-speaking mock DAP adapter — deliberately
/// much smaller than [`PYTHON_MOCK_ADAPTER_SCRIPT`] above (only the three
/// handshake steps `session::run_handshake` actually requires:
/// `initialize` → `launch`/`attach` → `configurationDone`), since this
/// slice's own tests only need to prove the *transport* composition, not
/// re-exercise interactive-command coverage those other, already-passing
/// tests own. Two `argv` values: the exact loopback port to bind (chosen by
/// the test ahead of time, mirroring a real `debugpy --listen <port>`
/// adapter's own fixed-port contract) and a heartbeat file path this script
/// appends one line to every 20ms for as long as it is alive — the test's
/// own "was this real OS process actually killed, not merely abandoned"
/// proof (a killed process cannot keep appending to that file; a merely
/// disconnected-but-still-running one would).
const TCP_SPAWN_MOCK_ADAPTER_SCRIPT: &str = r#"
import sys, socket, json, time, threading

port = int(sys.argv[1])
heartbeat_path = sys.argv[2]
listen_delay_seconds = float(sys.argv[3])

def heartbeat():
    with open(heartbeat_path, "a") as f:
        while True:
            f.write("x\n")
            f.flush()
            time.sleep(0.02)

threading.Thread(target=heartbeat, daemon=True).start()
time.sleep(listen_delay_seconds)

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", port))
server.listen(1)
conn, _ = server.accept()
rfile = conn.makefile("rb")
wfile = conn.makefile("wb")

def read_message():
    headers = {}
    first = True
    while True:
        line = rfile.readline()
        if line == b"":
            if first:
                return None
            break
        first = False
        if line in (b"\r\n", b"\n"):
            break
        if b":" in line:
            name, _, value = line.partition(b":")
            headers[name.strip().lower()] = value.strip()
    length = int(headers[b"content-length"])
    body = rfile.read(length)
    return json.loads(body)

def write_message(obj):
    body = json.dumps(obj).encode("utf-8")
    wfile.write(("Content-Length: %d\r\n\r\n" % len(body)).encode("ascii"))
    wfile.write(body)
    wfile.flush()

counter = [1000]
def next_seq():
    counter[0] += 1
    return counter[0]

pending_launch_seq = None
while True:
    message = read_message()
    if message is None:
        break
    command = message.get("command")
    request_seq = message.get("seq")
    if command == "initialize":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "initialize",
            "body": {"supportsConfigurationDoneRequest": True},
        })
    elif command in ("launch", "attach"):
        pending_launch_seq = request_seq
        write_message({"seq": next_seq(), "type": "event", "event": "initialized"})
    elif command == "configurationDone":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "configurationDone",
        })
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": pending_launch_seq,
            "success": True, "command": "launch",
        })
    else:
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": command,
        })
"#;

/// `sys.exit`s without ever binding a socket — but only after
/// `exit_delay_seconds` (`argv[1]`), chosen by every caller below to be
/// safely longer than `exec::DEBUG_ADAPTER_STARTUP_GRACE` (200ms) so the
/// process genuinely survives `spawn_adapter_as_tcp_companion`'s own
/// startup-crash check and this test exercises the retry loop's own
/// mid-retry exit detection — not `exec.rs`'s already-covered startup-crash
/// path (`debug::exec::tests` owns that).
const TCP_SPAWN_EXITS_BEFORE_LISTENING_SCRIPT: &str = r#"
import sys, time
time.sleep(float(sys.argv[1]))
sys.exit(0)
"#;

/// Never binds a socket at all and loops forever, appending to the same
/// heartbeat file [`TCP_SPAWN_MOCK_ADAPTER_SCRIPT`] uses — the fixture for
/// the connect-budget-exhausted scenario below.
const TCP_SPAWN_NEVER_LISTENS_SCRIPT: &str = r#"
import sys, time
heartbeat_path = sys.argv[1]
with open(heartbeat_path, "a") as f:
    while True:
        f.write("x\n")
        f.flush()
        time.sleep(0.02)
"#;

/// Polls `path`'s current byte length; used both to observe real growth (the
/// process is alive and writing) and, after the fact, to observe it has
/// genuinely stopped growing (the process was actually killed, not merely
/// abandoned to keep running in the background) — the exact same
/// "black-box, no direct pid access needed" zero-residue technique
/// `docs/research/2026-08-04-complete-debug.md`'s "架构裁定 §6" calls for
/// ("进程 wait" — proven here, since a `Child::kill`+`wait` pair is exactly
/// what `exec::AdapterHandle::kill` performs, and this heartbeat file is the
/// only way this black-box test can observe that it genuinely happened).
fn heartbeat_len(path: &std::path::Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

#[test]
fn tcp_spawn_completes_the_handshake_over_a_delayed_listener_and_tears_down_both_channels_with_zero_residue(
) {
    let Some(python3) = resolve_python3() else {
        eprintln!(
            "skipping tcp_spawn_completes_the_handshake_over_a_delayed_listener_and_tears_down_both_channels_with_zero_residue: \
             python3 not found via `command -v python3`"
        );
        return;
    };
    let scratch = TempDir::new().unwrap();
    let heartbeat_path = scratch.path().join("heartbeat.txt");
    let port = free_loopback_port_for_test();

    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec![
            "-c".to_owned(),
            TCP_SPAWN_MOCK_ADAPTER_SCRIPT.to_owned(),
            port.to_string(),
            heartbeat_path.to_string_lossy().into_owned(),
            // Deliberately longer than the retry loop's own 50ms initial
            // backoff — a real proof the retry loop survives more than one
            // failed attempt, not a same-tick race, mirroring
            // `debug::tcp::tests`'s own `retry_succeeds_once_a_delayed_listener_comes_up_on_the_exact_port`
            // rationale, this time against a genuinely spawned process.
            "0.5".to_owned(),
        ],
    };
    let window_label = "main";
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Tcp);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    let start = Instant::now();
    let result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::TcpSpawn {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
            port,
        },
        "mock-tcp-spawn".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));
    let (session_id, capabilities) = result.expect(
        "a real spawned companion that starts listening well inside the connect budget must \
         complete the full handshake",
    );
    assert_eq!(
        capabilities
            .get("supportsConfigurationDoneRequest")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(service.session_count_for_test(window_label), 1);
    assert!(
        start.elapsed() >= Duration::from_millis(500),
        "must genuinely have waited out the companion's own 500ms listen delay, not raced past it"
    );

    // A real heartbeat write must have already landed — proves the process
    // this session is holding onto is genuinely alive right now, the
    // positive control for the post-teardown assertion below.
    assert!(
        wait_until(
            || heartbeat_len(&heartbeat_path) > 0,
            Duration::from_secs(2)
        ),
        "the spawned companion process must be alive and writing its heartbeat before teardown"
    );
    let heartbeat_len_before_disconnect = heartbeat_len(&heartbeat_path);

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
    assert_eq!(service.session_count_for_test(window_label), 0);

    // Zero-residue proof 1: the process was really killed (`Child::kill` +
    // `wait`, inside `AdapterHandle::kill`), not merely disconnected — the
    // heartbeat file must stop growing shortly after `disconnect` returns.
    std::thread::sleep(Duration::from_millis(150));
    let heartbeat_len_shortly_after = heartbeat_len(&heartbeat_path);
    std::thread::sleep(Duration::from_millis(300));
    let heartbeat_len_well_after = heartbeat_len(&heartbeat_path);
    assert_eq!(
        heartbeat_len_shortly_after, heartbeat_len_well_after,
        "the companion process must have genuinely stopped running after disconnect — a still-\
         running orphan would keep appending to the heartbeat file"
    );
    assert!(
        heartbeat_len_well_after >= heartbeat_len_before_disconnect,
        "sanity: the heartbeat file must never shrink"
    );

    // Zero-residue proof 2: the port itself was released — a fresh listener
    // must be able to rebind the exact same port shortly after teardown.
    assert!(
        wait_until(
            || TcpListener::bind(("127.0.0.1", port)).is_ok(),
            Duration::from_secs(2)
        ),
        "the loopback port must be free again once the companion process and its socket are torn down"
    );
}

#[test]
fn tcp_spawn_fails_immediately_with_the_exited_code_when_the_companion_exits_before_ever_listening()
{
    let Some(python3) = resolve_python3() else {
        eprintln!(
            "skipping tcp_spawn_fails_immediately_with_the_exited_code_when_the_companion_exits_before_ever_listening: \
             python3 not found via `command -v python3`"
        );
        return;
    };
    let port = free_loopback_port_for_test();
    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec![
            "-c".to_owned(),
            TCP_SPAWN_EXITS_BEFORE_LISTENING_SCRIPT.to_owned(),
            // Safely longer than `exec::DEBUG_ADAPTER_STARTUP_GRACE` (200ms)
            // — this process must be observed as "successfully spawned" by
            // `spawn_adapter_as_tcp_companion` before it exits, exercising
            // the retry loop's own exit detection, not `exec.rs`'s earlier
            // startup-crash path.
            "0.3".to_owned(),
        ],
    };
    let window_label = "main";
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Tcp);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    let result = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::TcpSpawn {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
            port,
        },
        "mock-tcp-spawn".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ));
    let error =
        result.expect_err("a companion that exits before ever listening must fail the session");
    assert_eq!(error.code(), "DEBUG_ADAPTER_TCP_COMPANION_EXITED");
    assert_eq!(
        service.session_count_for_test(window_label),
        0,
        "a failed TcpSpawn start must leave zero live sessions behind"
    );
}

#[test]
fn tcp_spawn_kills_the_never_listening_companion_and_reports_timed_out_once_the_injected_budget_elapses(
) {
    let Some(python3) = resolve_python3() else {
        eprintln!(
            "skipping tcp_spawn_kills_the_never_listening_companion_and_reports_timed_out_once_the_injected_budget_elapses: \
             python3 not found via `command -v python3`"
        );
        return;
    };
    let scratch = TempDir::new().unwrap();
    let heartbeat_path = scratch.path().join("heartbeat.txt");
    let port = free_loopback_port_for_test();
    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec![
            "-c".to_owned(),
            TCP_SPAWN_NEVER_LISTENS_SCRIPT.to_owned(),
            heartbeat_path.to_string_lossy().into_owned(),
        ],
    };
    let window_label = "main";
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Tcp);
    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();

    // Injects a small connect budget (`start_session_with_tcp_spawn_budget_for_test`,
    // `F210` S6's own test-only twin of `start_session` — see its own doc
    // comment) so this test proves the real, production `TcpSpawn`
    // orchestration's timeout-and-kill behavior without waiting out the real
    // 5-second production `DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT` budget.
    let injected_budget = Duration::from_millis(300);
    let start = Instant::now();
    let result = block_on(service.start_session_with_tcp_spawn_budget_for_test(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::TcpSpawn {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
            port,
        },
        "mock-tcp-spawn".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
        injected_budget,
    ));
    let error = result.expect_err("nothing ever listens on this port in this test");
    assert_eq!(
        error.code(),
        "DEBUG_ADAPTER_TCP_COMPANION_CONNECT_TIMED_OUT"
    );
    assert!(
        start.elapsed() >= injected_budget,
        "must not report timed-out before the injected budget actually elapsed"
    );
    assert_eq!(
        service.session_count_for_test(window_label),
        0,
        "a failed TcpSpawn start must leave zero live sessions behind"
    );

    // Zero-residue proof: the still-running companion must have been killed
    // once the connect budget ran out — the heartbeat file must stop
    // growing shortly after `start_session_with_tcp_spawn_budget_for_test`
    // returns its error.
    let heartbeat_len_at_return = heartbeat_len(&heartbeat_path);
    assert!(
        heartbeat_len_at_return > 0,
        "positive control: the companion must genuinely have been alive and writing its \
         heartbeat while the connect budget was being spent — otherwise the 'stops growing' \
         assertion below would be vacuous"
    );
    std::thread::sleep(Duration::from_millis(150));
    let heartbeat_len_shortly_after = heartbeat_len(&heartbeat_path);
    std::thread::sleep(Duration::from_millis(300));
    let heartbeat_len_well_after = heartbeat_len(&heartbeat_path);
    assert_eq!(
        heartbeat_len_shortly_after, heartbeat_len_well_after,
        "the companion process must have genuinely been killed once the connect budget ran out \
         — a still-running orphan would keep appending to the heartbeat file"
    );
    assert!(heartbeat_len_well_after >= heartbeat_len_at_return);

    assert!(
        wait_until(
            || TcpListener::bind(("127.0.0.1", port)).is_ok(),
            Duration::from_secs(2)
        ),
        "the loopback port must be free again once the killed companion's process has exited"
    );
}

// ---------------------------------------------------------------------
// `F100` S5 — per-request timeout, `output`-event backpressure, and real
// large-object benchmarks, all exercised over a real spawned Python
// subprocess (not just `debug::session::tests`'s in-memory mock) — see
// `PYTHON_MOCK_ADAPTER_SCRIPT`'s own `floodOutput`/`neverReplies`/sentinel
// `threadId: 999999`/`variablesReference: 999999` additions for what this
// section's tests actually drive.
// ---------------------------------------------------------------------

/// Starts a real handshake against a fresh Python subprocess and returns
/// everything the tests below need — factored out purely because every test
/// in this section needs the identical setup and none of them care about the
/// negotiated capabilities. Returns `None` (never panics) when `python3`
/// cannot be found, mirroring every other real-subprocess test's own skip
/// convention.
fn start_real_python_session(
    window_label: &str,
) -> Option<(
    TrustedConfirmedFixture,
    DebugSessionService,
    std::sync::Arc<RecordingSink>,
    DebugSessionId,
)> {
    let python3 = resolve_python3()?;
    let descriptor = AdapterSpawnDescriptor {
        command: python3.to_string_lossy().into_owned(),
        args: vec!["-c".to_owned(), PYTHON_MOCK_ADAPTER_SCRIPT.to_owned()],
    };
    let fixture = trusted_and_confirmed(window_label, &descriptor, AdapterTransportKind::Stdio);
    let service = DebugSessionService::new();
    let (sink, sink_for_session) = recording_sink();
    let (session_id, _capabilities) = block_on(service.start_session(
        &fixture.trust,
        &fixture.remote,
        &fixture.workspace,
        window_label,
        fixture.root_id,
        &fixture.confirmation,
        LaunchRequestKind::Launch,
        SessionTransportRequest::Stdio {
            command: descriptor.command.clone(),
            args: descriptor.args.clone(),
        },
        "mock-python".to_owned(),
        json!({}),
        Vec::new(),
        sink_for_session,
        noop_reverse_requests(),
    ))
    .expect("handshake succeeds");
    // The fixture (its temp trust/confirmation directories) is handed back
    // to the caller so it stays alive for the rest of that test — dropping
    // it early would not affect the *already-granted* in-memory trust/
    // confirmation state these services hold, but keeping it alive avoids
    // relying on that implementation detail.
    Some((fixture, service, sink, session_id))
}

#[test]
fn debug_request_timed_out_surfaces_end_to_end_over_a_real_spawned_process_when_the_adapter_never_replies(
) {
    let window_label = "main";
    let Some((_fixture, service, _sink, session_id)) = start_real_python_session(window_label)
    else {
        eprintln!(
            "skipping debug_request_timed_out_surfaces_end_to_end_over_a_real_spawned_process_when_the_adapter_never_replies: \
             python3 not found"
        );
        return;
    };

    let start = Instant::now();
    let error = block_on(service.send_request_with_timeout_for_test(
        window_label,
        session_id,
        "neverReplies",
        json!({}),
        Duration::from_millis(200),
    ))
    .expect_err("a request the real adapter process never answers must time out");
    let elapsed = start.elapsed();
    assert_eq!(error.code(), "DEBUG_REQUEST_TIMED_OUT");
    eprintln!(
        "[F100 S5 benchmark] real-subprocess request timeout: waited {elapsed:?} for a 200ms \
         budget against a genuinely unresponsive (but alive) real adapter process"
    );
    assert!(
        elapsed < Duration::from_secs(3),
        "must not wait meaningfully longer than the timeout"
    );

    // The adapter process is still alive and responsive to *other* requests
    // (`neverReplies` only ever ignores that one specific command) — proving
    // the timeout did not corrupt the session or leave it unusable.
    let evaluate_body = block_on(service.send_request(
        window_label,
        session_id,
        "evaluate",
        json!({"expression": "1", "context": "repl"}),
    ))
    .expect("the session remains fully usable after an earlier request timed out");
    assert!(evaluate_body.get("result").is_some());

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
}

/// `F100` S5's own real, measured large-object benchmark numbers — a
/// 2000-frame call stack and a 50,000-element variables array, both fetched
/// in a single unpaginated response from a real spawned process (not a
/// synthetic in-Rust construction), reporting real elapsed milliseconds
/// rather than citing third-party numbers. Bounded by generous (not
/// tight-fitted-to-measurement) assertions so this stays a real regression
/// guard rather than a flaky benchmark.
#[test]
fn real_large_call_stack_and_large_variables_array_benchmark() {
    let window_label = "main";
    let Some((_fixture, service, _sink, session_id)) = start_real_python_session(window_label)
    else {
        eprintln!(
            "skipping real_large_call_stack_and_large_variables_array_benchmark: python3 not found"
        );
        return;
    };

    let stack_start = Instant::now();
    let stack_body = block_on(service.send_request(
        window_label,
        session_id,
        "stackTrace",
        json!({"threadId": 999999}),
    ))
    .expect("deep stackTrace succeeds");
    let stack_elapsed = stack_start.elapsed();
    let stack = crate::debug::dto::parse_stack_trace_response(&stack_body)
        .expect("well-formed stackTrace response");
    assert_eq!(stack.stack_frames.len(), 2000);
    assert_eq!(stack.total_frames, Some(2000));
    eprintln!(
        "[F100 S5 benchmark] real 2000-frame stackTrace round trip (real spawned Python \
         subprocess, real pipe, real Rust parse): {stack_elapsed:?}"
    );
    assert!(
        stack_elapsed < Duration::from_secs(5),
        "a 2000-frame stack trace must not take multiple seconds on this machine"
    );

    let variables_start = Instant::now();
    let variables_body = block_on(service.send_request(
        window_label,
        session_id,
        "variables",
        json!({"variablesReference": 999999}),
    ))
    .expect("large variables page succeeds");
    let variables_elapsed = variables_start.elapsed();
    let variables = crate::debug::dto::parse_variables_response(&variables_body)
        .expect("well-formed variables response");
    assert_eq!(variables.variables.len(), 50_000);
    eprintln!(
        "[F100 S5 benchmark] real 50,000-element variables round trip (real spawned Python \
         subprocess, real pipe, real Rust parse): {variables_elapsed:?}"
    );
    assert!(
        variables_elapsed < Duration::from_secs(5),
        "a 50,000-element variables response must not take multiple seconds on this machine"
    );

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
}

/// Real, end-to-end proof of `output_gate::OutputGate`'s backpressure — a
/// real spawned Python process floods 6,000 `output` events of 200 bytes
/// each (≈1.2 MiB, deliberately past [`crate::debug::output_gate::DEBUG_OUTPUT_MERGE_CAP_BYTES`]'s
/// 1 MiB cap) *before* this test ever acks a single one, then acks and
/// observes the merged, capped flush plus a `plain/outputElided` notice —
/// exactly the "如实呈现,不静默丢数据" contract this gate exists to provide.
#[test]
fn output_backpressure_gate_holds_a_real_flood_and_reports_elision_on_ack() {
    let window_label = "main";
    let Some((_fixture, service, sink, session_id)) = start_real_python_session(window_label)
    else {
        eprintln!("skipping output_backpressure_gate_holds_a_real_flood_and_reports_elision_on_ack: python3 not found");
        return;
    };

    let flood_start = Instant::now();
    block_on(service.send_request_with_timeout_for_test(
        window_label,
        session_id,
        "floodOutput",
        json!({"count": 6000, "lineBytes": 200}),
        Duration::from_secs(15),
    ))
    .expect("the real adapter process floods every event and then still replies");
    let flood_elapsed = flood_start.elapsed();
    eprintln!(
        "[F100 S5 benchmark] real 6,000-event (~1.2 MiB) output flood from a real spawned \
         process, through the real reader thread and backpressure gate: {flood_elapsed:?}"
    );

    // The gate must have held the vast majority of those 6,000 events back —
    // only up to the high-water mark's worth of *real* `output` sink
    // deliveries should have happened, proving the frontend-facing channel
    // was never asked to carry anywhere near 6,000 IPC events for one flood.
    let output_events_before_ack = sink
        .events_snapshot()
        .into_iter()
        .filter(|(id, name, _)| *id == session_id && name == "output")
        .count();
    assert!(
        output_events_before_ack
            <= crate::debug::output_gate::DEBUG_OUTPUT_HIGH_WATER_EVENTS as usize,
        "expected at most {} real output deliveries before any ack, got {output_events_before_ack}",
        crate::debug::output_gate::DEBUG_OUTPUT_HIGH_WATER_EVENTS
    );
    eprintln!(
        "[F100 S5 benchmark] {output_events_before_ack} real output deliveries reached the \
         sink for a 6,000-event flood (the rest were merged/held by the backpressure gate)"
    );

    // Ack through the highest sequence emitted so far, freeing credit for the
    // gate to flush its merged backlog.
    block_on(service.ack_output(
        window_label,
        session_id,
        crate::debug::output_gate::DEBUG_OUTPUT_HIGH_WATER_EVENTS,
    ));

    assert!(
        wait_until(
            || sink
                .events_snapshot()
                .iter()
                .any(|(id, name, _)| *id == session_id && name == "plain/outputElided"),
            Duration::from_secs(5)
        ),
        "expected an honest elision notice once the merged backlog (which exceeded the 1 MiB \
         per-category cap) is finally flushed — silently dropping the excess without telling \
         the user is exactly what this gate exists to avoid"
    );
    let events = sink.events_snapshot();
    let elided = events
        .iter()
        .find(|(id, name, _)| *id == session_id && name == "plain/outputElided")
        .expect("elision notice present")
        .2
        .clone()
        .expect("elision notice carries a body");
    let elided_bytes = elided
        .get("elidedBytes")
        .and_then(Value::as_u64)
        .expect("elidedBytes present");
    assert!(
        elided_bytes > 0,
        "some bytes must genuinely have been elided at this scale"
    );
    eprintln!(
        "[F100 S5 benchmark] elision notice reported {elided_bytes} elided bytes for a flood \
         that exceeded the per-category merge cap"
    );

    block_on(service.disconnect(window_label, session_id)).expect("disconnect succeeds");
}
