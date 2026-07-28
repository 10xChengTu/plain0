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
            "body": {"supportsConfigurationDoneRequest": True, "supportsConditionalBreakpoints": True},
        })
    elif command in ("launch", "attach"):
        pending_launch_seq = request_seq
        pending_launch_command = command
        write_message({"seq": next_seq(), "type": "event", "event": "initialized"})
    elif command == "setBreakpoints":
        write_message({
            "seq": next_seq(), "type": "response", "request_seq": request_seq,
            "success": True, "command": "setBreakpoints", "body": {"breakpoints": []},
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
