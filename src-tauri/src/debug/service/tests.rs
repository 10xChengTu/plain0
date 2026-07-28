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

use crate::debug::confirm::ConfirmationService;
use crate::debug::dto::{
    AdapterSpawnDescriptor, AdapterTransportKind, DebugSessionId, SessionTransportRequest,
};
use crate::debug::framing::FrameDecoder;
use crate::debug::protocol::{encode_response, parse_incoming_message, IncomingMessage};
use crate::debug::session::{DebugEventSink, LaunchRequestKind, SessionEndReason};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

use super::DebugSessionService;

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

fn workspace_with_root(window_label: &str, root_path: &Path) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(vec![root_path.to_path_buf()]);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

/// Holds every temp resource + service handle a trusted-and-confirmed test
/// fixture needs alive for its duration.
struct TrustedConfirmedFixture {
    _root: TempDir,
    _trust_base: TempDir,
    _confirm_base: TempDir,
    workspace: WorkspaceService,
    trust: TrustService,
    confirmation: ConfirmationService,
}

fn trusted_and_confirmed(
    window_label: &str,
    descriptor: &AdapterSpawnDescriptor,
    transport: AdapterTransportKind,
) -> TrustedConfirmedFixture {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let confirm_base = TempDir::new().unwrap();
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
    TrustedConfirmedFixture {
        _root: root,
        _trust_base: trust_base,
        _confirm_base: confirm_base,
        workspace,
        trust,
        confirmation,
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
        &fixture.workspace,
        window_label,
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
        &fixture.workspace,
        window_label,
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
    ))
    .expect("handshake succeeds");

    // --- setBreakpoints: a moved line and a rejected one, in one request. ---
    let set_breakpoints_body = block_on(service.send_request(
        window_label,
        session_id,
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
        &fixture.workspace,
        window_label,
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
        &fixture.workspace,
        window_label,
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
    let window_label = "main";
    let workspace = workspace_with_root(window_label, root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    // Deliberately never confirmed.
    let confirmation = ConfirmationService::new(confirm_base.path().to_path_buf());

    let service = DebugSessionService::new();
    let (_sink, sink_for_session) = recording_sink();
    let result = block_on(service.start_session(
        &trust,
        &workspace,
        window_label,
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
    ));
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_NOT_CONFIRMED");
    assert_eq!(service.session_count_for_test(window_label), 0);
}
