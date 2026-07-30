//! Pure in-memory Rust tests for `debug::session` — the real DAP session
//! lifecycle (handshake orchestration, `request_seq` correlation, event
//! dispatch, session-end handling). No subprocess, no real socket: every
//! test here drives [`DebugSession`] against a programmable **mock
//! adapter** built on two plain `std::sync::mpsc` byte-chunk channels (see
//! [`duplex_pair`]/[`MockAdapterIo`]) — the "in-memory" half of this
//! project's mock-adapter requirement (the real-subprocess/real-socket half
//! lives in `debug::service::tests`, proving the exact same session code
//! also works end to end over a genuine spawned process and a genuine TCP
//! socket).
//!
//! # What this mock adapter can do that a real one might
//!
//! [`MockAdapterIo`] is a thin script driven directly by each test's own
//! code, not a fixed scenario — so every test below scripts a *different*
//! adversarial (or ordinary) real-world adapter behavior this project's own
//! research doc catalogued as something a real implementation should not
//! assume away: a literal `seq: 0` response
//! ([`responses_correlate_by_request_seq_even_when_the_adapters_own_seq_is_always_zero_and_replies_arrive_out_of_order`]),
//! out-of-order replies (same test), the `launch`/`attach` response arriving
//! after `configurationDone`'s
//! ([`handshake_completes_even_when_the_launch_response_is_deliberately_withheld_until_after_configuration_done`]),
//! `initialized` firing before `initialize`'s own response
//! ([`initialized_event_arriving_before_the_initialize_response_does_not_break_the_handshake`]),
//! a completely empty capabilities body
//! ([`a_handshake_with_no_capabilities_body_at_all_still_succeeds_with_every_capability_reported_false`]),
//! going silent forever mid-handshake
//! ([`silence_after_initialize_leaves_the_handshake_blocked_until_the_transport_closes_then_fails_cleanly`]),
//! sending only responses and never any event
//! (the same test, up to the point the transport is dropped), and hostile
//! malformed input — both a single malformed-JSON message
//! ([`a_single_malformed_json_message_is_surfaced_as_a_diagnostic_and_does_not_end_the_session`])
//! and a hostile `Content-Length`
//! ([`a_hostile_content_length_ends_the_session_with_a_distinct_malformed_frame_reason`]).

use std::io::{Read, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::debug::dto::DebugSessionId;
use crate::debug::framing::FrameDecoder;
use crate::debug::protocol::{
    encode_response, parse_incoming_message, IncomingMessage, ResponseEnvelope,
};
use crate::error::CommandError;

use super::{
    run_handshake, DebugEventSink, DebugSession, HandshakeConfig, LaunchRequestKind,
    ReverseRequestHandler, ReverseRequestOutcome, SessionEndReason, SourceBreakpoints,
};

// ---------------------------------------------------------------------
// Mock adapter plumbing: two `mpsc` byte-chunk channels stand in for a real
// bidirectional transport. Neither end ever touches the filesystem, a real
// process or a real socket — see `debug::service::tests` for the real-world
// counterparts of these same scenarios.
// ---------------------------------------------------------------------

struct ChannelReader {
    rx: Receiver<Vec<u8>>,
    buffer: Vec<u8>,
}

impl Read for ChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.buffer.is_empty() {
            match self.rx.recv() {
                Ok(chunk) => self.buffer = chunk,
                // The peer's sender was dropped — the real-transport
                // equivalent of EOF (adapter process exited / socket
                // closed).
                Err(_) => return Ok(0),
            }
        }
        let len = buf.len().min(self.buffer.len());
        buf[..len].copy_from_slice(&self.buffer[..len]);
        self.buffer.drain(..len);
        Ok(len)
    }
}

struct ChannelWriter {
    tx: Sender<Vec<u8>>,
}

impl Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.tx.send(buf.to_vec()).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::BrokenPipe, "mock adapter gone")
        })?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// The test's own handle onto "being the adapter": reads and decodes
/// whatever the client ([`DebugSession`]) under test writes, and writes
/// arbitrary scripted bytes back — including deliberately malformed ones via
/// [`Self::send_raw`].
struct MockAdapterIo {
    reader: ChannelReader,
    writer: ChannelWriter,
    decoder: FrameDecoder,
}

impl MockAdapterIo {
    fn recv_any(&mut self) -> IncomingMessage {
        let mut buffer = [0_u8; 4096];
        loop {
            let read = self
                .reader
                .read(&mut buffer)
                .expect("an in-memory channel read never errors");
            if read == 0 {
                panic!("the client-to-adapter channel closed before an expected message arrived");
            }
            let messages = self
                .decoder
                .feed(&buffer[..read])
                .expect("this test's own scripted frames are always well-formed");
            if let Some(message) = messages.into_iter().next() {
                return parse_incoming_message(&message.body)
                    .expect("this test's own scripted frames are always well-formed JSON");
            }
        }
    }

    /// Blocks until the next request arrives, asserting it is exactly
    /// `expected_command` — the common case almost every test below uses.
    fn expect_request(&mut self, expected_command: &str) -> (i64, Option<Value>) {
        match self.recv_any() {
            IncomingMessage::Request(request) => {
                assert_eq!(
                    request.command, expected_command,
                    "unexpected next request from the client under test"
                );
                (request.seq, request.arguments)
            }
            other => panic!("expected a request, got {other:?}"),
        }
    }

    fn recv_request(&mut self) -> (i64, String, Option<Value>) {
        match self.recv_any() {
            IncomingMessage::Request(request) => (request.seq, request.command, request.arguments),
            other => panic!("expected a request, got {other:?}"),
        }
    }

    /// Reads the client's reply to a reverse request this mock just sent.
    fn recv_response(&mut self) -> ResponseEnvelope {
        match self.recv_any() {
            IncomingMessage::Response(response) => response,
            other => panic!("expected a response, got {other:?}"),
        }
    }

    fn send_response(
        &mut self,
        seq: i64,
        request_seq: i64,
        command: &str,
        success: bool,
        message: Option<&str>,
        body: Option<Value>,
    ) {
        let framed = encode_response(seq, request_seq, command, success, message, body);
        self.writer
            .write_all(&framed)
            .expect("mock adapter write succeeds");
    }

    fn send_event(&mut self, seq: i64, event: &str, body: Option<Value>) {
        self.send_raw(&encode_envelope("event", seq, None, Some(event), body));
    }

    fn send_reverse_request(&mut self, seq: i64, command: &str, arguments: Option<Value>) {
        self.send_raw(&encode_request_shaped_envelope(seq, command, arguments));
    }

    /// Writes bytes exactly as given — used both by the event/reverse-request
    /// helpers above and directly by tests constructing deliberately hostile
    /// input (malformed JSON, a hostile `Content-Length`).
    fn send_raw(&mut self, bytes: &[u8]) {
        self.writer
            .write_all(bytes)
            .expect("mock adapter write succeeds");
    }
}

fn encode_envelope(
    kind: &str,
    seq: i64,
    command: Option<&str>,
    event: Option<&str>,
    body: Option<Value>,
) -> Vec<u8> {
    let mut object = serde_json::Map::new();
    object.insert("seq".to_owned(), Value::from(seq));
    object.insert("type".to_owned(), Value::from(kind));
    if let Some(command) = command {
        object.insert("command".to_owned(), Value::from(command));
    }
    if let Some(event) = event {
        object.insert("event".to_owned(), Value::from(event));
    }
    if let Some(body) = body {
        object.insert("body".to_owned(), body);
    }
    frame(&Value::Object(object))
}

fn encode_request_shaped_envelope(seq: i64, command: &str, arguments: Option<Value>) -> Vec<u8> {
    let mut object = serde_json::Map::new();
    object.insert("seq".to_owned(), Value::from(seq));
    object.insert("type".to_owned(), Value::from("request"));
    object.insert("command".to_owned(), Value::from(command));
    if let Some(arguments) = arguments {
        object.insert("arguments".to_owned(), arguments);
    }
    frame(&Value::Object(object))
}

fn frame(value: &Value) -> Vec<u8> {
    let json_bytes = serde_json::to_vec(value).unwrap();
    let mut framed = format!("Content-Length: {}\r\n\r\n", json_bytes.len()).into_bytes();
    framed.extend_from_slice(&json_bytes);
    framed
}

/// The client-side reader/writer handed to [`DebugSession::start`] —
/// factored into a type alias purely to keep [`duplex_pair`]'s signature
/// readable.
type ClientTransport = (Box<dyn Read + Send>, Box<dyn Write + Send>);

/// Builds a connected client/mock-adapter pair — `client_reader`/
/// `client_writer` are handed to [`DebugSession::start`]; `MockAdapterIo` is
/// this test's own handle onto the other end.
fn duplex_pair() -> (ClientTransport, MockAdapterIo) {
    let (client_to_adapter_tx, client_to_adapter_rx) = channel::<Vec<u8>>();
    let (adapter_to_client_tx, adapter_to_client_rx) = channel::<Vec<u8>>();
    let client_reader: Box<dyn Read + Send> = Box::new(ChannelReader {
        rx: adapter_to_client_rx,
        buffer: Vec::new(),
    });
    let client_writer: Box<dyn Write + Send> = Box::new(ChannelWriter {
        tx: client_to_adapter_tx,
    });
    let adapter = MockAdapterIo {
        reader: ChannelReader {
            rx: client_to_adapter_rx,
            buffer: Vec::new(),
        },
        writer: ChannelWriter {
            tx: adapter_to_client_tx,
        },
        decoder: FrameDecoder::new(),
    };
    ((client_reader, client_writer), adapter)
}

#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<(DebugSessionId, String, Option<Value>)>>,
    ended: Mutex<Vec<(DebugSessionId, SessionEndReason)>>,
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

    fn ended_snapshot(&self) -> Vec<(DebugSessionId, SessionEndReason)> {
        self.ended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
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

/// Every test in this file that does not specifically exercise `F100` S5's
/// timeout classification uses generous (but still finite — see the module
/// doc's own "every pending request must fail deterministically" requirement)
/// 5-second budgets for both, matching `run_handshake_within`'s own outer
/// 5-second safety net below — real production code always uses
/// [`super::DEBUG_REQUEST_TIMEOUT`]/[`super::DEBUG_LAUNCH_TIMEOUT`] instead
/// (see `service.rs`'s `start_session`).
const TEST_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const TEST_LAUNCH_TIMEOUT: Duration = Duration::from_secs(5);

fn basic_handshake_config(arguments: Value) -> HandshakeConfig {
    HandshakeConfig {
        adapter_id: "mock".to_owned(),
        request: LaunchRequestKind::Launch,
        arguments,
        breakpoints: Vec::new(),
        request_timeout: TEST_REQUEST_TIMEOUT,
        launch_timeout: TEST_LAUNCH_TIMEOUT,
    }
}

/// Runs [`run_handshake`] on a dedicated thread and waits up to `timeout` for
/// it to finish — `None` means it did not finish in time (a genuine
/// deadlock, if the implementation under test were wrong), distinct from
/// `Some(Err(..))` (it finished, with an error). Used so a real bug that
/// reintroduces the "await launch before continuing" deadlock fails the test
/// promptly instead of hanging `cargo test` forever.
fn run_handshake_within(
    session: Arc<DebugSession>,
    config: HandshakeConfig,
    timeout: Duration,
) -> Option<Result<crate::debug::protocol::Capabilities, CommandError>> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let result = run_handshake(&session, config);
        let _ = tx.send(result);
    });
    rx.recv_timeout(timeout).ok()
}

fn sink_pair() -> (Arc<RecordingSink>, Arc<dyn DebugEventSink>) {
    let sink = Arc::new(RecordingSink::default());
    let for_session: Arc<dyn DebugEventSink> = sink.clone();
    (sink, for_session)
}

// ---------------------------------------------------------------------
// Handshake ordering — the core contract this slice exists to get right.
// ---------------------------------------------------------------------

#[test]
fn handshake_completes_even_when_the_launch_response_is_deliberately_withheld_until_after_configuration_done(
) {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        adapter.send_response(
            1,
            init_seq,
            "initialize",
            true,
            None,
            Some(json!({"supportsConfigurationDoneRequest": true})),
        );

        let (launch_seq, _) = adapter.expect_request("launch");
        // Deliberately NOT responding to `launch` yet — the real `debugpy`
        // ordering `docs/research/2026-07-28-generic-dap.md` captured.

        adapter.send_event(2, "initialized", None);

        let (config_done_seq, _) = adapter.expect_request("configurationDone");
        adapter.send_response(3, config_done_seq, "configurationDone", true, None, None);

        // Only now does `launch`'s own response arrive.
        adapter.send_response(4, launch_seq, "launch", true, None, None);
    });

    let config = basic_handshake_config(json!({"program": "main.py"}));
    let capabilities = run_handshake_within(session, config, Duration::from_secs(5))
        .expect(
            "the handshake must not deadlock waiting for the deliberately-delayed launch response",
        )
        .expect("handshake succeeds");
    assert!(capabilities.supports("supportsConfigurationDoneRequest"));

    adapter_thread.join().expect("adapter thread completes");
}

#[test]
fn initialized_event_arriving_before_the_initialize_response_does_not_break_the_handshake() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        // Adversarial ordering: fire `initialized` before even replying to
        // `initialize`.
        adapter.send_event(1, "initialized", None);
        adapter.send_response(2, init_seq, "initialize", true, None, Some(json!({})));

        let (launch_seq, _) = adapter.expect_request("launch");
        let (config_done_seq, _) = adapter.expect_request("configurationDone");
        adapter.send_response(3, config_done_seq, "configurationDone", true, None, None);
        adapter.send_response(4, launch_seq, "launch", true, None, None);
    });

    let config = basic_handshake_config(json!({}));
    run_handshake_within(session, config, Duration::from_secs(5))
        .expect("the handshake must not hang")
        .expect("handshake succeeds despite the adversarial event ordering");
    adapter_thread.join().unwrap();
}

#[test]
fn attach_requests_send_the_literal_attach_command_not_launch() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        adapter.send_response(1, init_seq, "initialize", true, None, Some(json!({})));
        let (attach_seq, arguments) = adapter.expect_request("attach");
        assert_eq!(arguments, Some(json!({"processId": 1234})));
        adapter.send_event(2, "initialized", None);
        let (config_done_seq, _) = adapter.expect_request("configurationDone");
        adapter.send_response(3, config_done_seq, "configurationDone", true, None, None);
        adapter.send_response(4, attach_seq, "attach", true, None, None);
    });

    let config = HandshakeConfig {
        adapter_id: "mock".to_owned(),
        request: LaunchRequestKind::Attach,
        arguments: json!({"processId": 1234}),
        breakpoints: Vec::new(),
        request_timeout: TEST_REQUEST_TIMEOUT,
        launch_timeout: TEST_LAUNCH_TIMEOUT,
    };
    run_handshake_within(session, config, Duration::from_secs(5))
        .expect("the handshake must not hang")
        .expect("handshake succeeds");
    adapter_thread.join().unwrap();
}

#[test]
fn the_handshake_sends_one_set_breakpoints_request_per_configured_source_before_configuration_done()
{
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let breakpoints = vec![
        SourceBreakpoints {
            arguments: json!({"source": {"path": "/tmp/a.py"}, "breakpoints": [{"line": 3}]}),
        },
        SourceBreakpoints {
            arguments: json!({"source": {"path": "/tmp/b.py"}, "breakpoints": [{"line": 7}, {"line": 9}]}),
        },
    ];

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        adapter.send_response(1, init_seq, "initialize", true, None, Some(json!({})));
        let (launch_seq, _) = adapter.expect_request("launch");
        adapter.send_event(2, "initialized", None);

        let (first_seq, first_arguments) = adapter.expect_request("setBreakpoints");
        assert_eq!(first_arguments.unwrap()["source"]["path"], "/tmp/a.py");
        adapter.send_response(
            3,
            first_seq,
            "setBreakpoints",
            true,
            None,
            Some(json!({"breakpoints": [{"verified": true}]})),
        );

        let (second_seq, second_arguments) = adapter.expect_request("setBreakpoints");
        assert_eq!(second_arguments.unwrap()["source"]["path"], "/tmp/b.py");
        adapter.send_response(
            4,
            second_seq,
            "setBreakpoints",
            true,
            None,
            Some(json!({"breakpoints": [{"verified": true}, {"verified": true}]})),
        );

        let (config_done_seq, _) = adapter.expect_request("configurationDone");
        adapter.send_response(5, config_done_seq, "configurationDone", true, None, None);
        adapter.send_response(6, launch_seq, "launch", true, None, None);
    });

    let config = HandshakeConfig {
        adapter_id: "mock".to_owned(),
        request: LaunchRequestKind::Launch,
        arguments: json!({}),
        breakpoints,
        request_timeout: TEST_REQUEST_TIMEOUT,
        launch_timeout: TEST_LAUNCH_TIMEOUT,
    };
    run_handshake_within(session, config, Duration::from_secs(5))
        .expect("the handshake must not hang")
        .expect("handshake succeeds");
    adapter_thread.join().unwrap();
}

#[test]
fn a_failed_initialize_response_fails_the_handshake_with_the_adapters_message() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        adapter.send_response(1, init_seq, "initialize", false, Some("nope"), None);
    });

    let config = basic_handshake_config(json!({}));
    let error = run_handshake_within(session, config, Duration::from_secs(5))
        .expect("the handshake must not hang")
        .expect_err("a failed initialize response must fail the handshake");
    assert_eq!(error.code(), "DEBUG_HANDSHAKE_FAILED");
    assert!(error.message().contains("nope"));
    adapter_thread.join().unwrap();
}

// ---------------------------------------------------------------------
// `request_seq` correlation — immune to the adapter's own `seq` semantics.
// ---------------------------------------------------------------------

#[test]
fn responses_correlate_by_request_seq_even_when_the_adapters_own_seq_is_always_zero_and_replies_arrive_out_of_order(
) {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let first_pending = session
        .send_request("threads", None)
        .expect("write succeeds");
    let second_pending = session
        .send_request("stackTrace", Some(json!({"threadId": 1})))
        .expect("write succeeds");

    let (first_seq, first_command, _) = adapter.recv_request();
    assert_eq!(first_command, "threads");
    let (second_seq, second_command, _) = adapter.recv_request();
    assert_eq!(second_command, "stackTrace");

    // Reply to the SECOND request first, and — the real `lldb-dap`
    // behavior — with a literal `seq` of 0 on both replies.
    adapter.send_response(
        0,
        second_seq,
        "stackTrace",
        true,
        None,
        Some(json!({"stackFrames": []})),
    );
    adapter.send_response(
        0,
        first_seq,
        "threads",
        true,
        None,
        Some(json!({"threads": []})),
    );

    let first_response = session
        .wait_for_response_with_timeout(first_pending, Duration::from_secs(5), "threads")
        .expect("resolves to the threads response, not the stackTrace one");
    let second_response = session
        .wait_for_response_with_timeout(second_pending, Duration::from_secs(5), "stackTrace")
        .expect("resolves to the stackTrace response, not the threads one");
    assert_eq!(first_response.command, "threads");
    assert_eq!(second_response.command, "stackTrace");
}

#[test]
fn a_handshake_with_no_capabilities_body_at_all_still_succeeds_with_every_capability_reported_false(
) {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        adapter.send_response(1, init_seq, "initialize", true, None, None); // no body at all
        let (launch_seq, _) = adapter.expect_request("launch");
        adapter.send_event(2, "initialized", None);
        let (config_done_seq, _) = adapter.expect_request("configurationDone");
        adapter.send_response(3, config_done_seq, "configurationDone", true, None, None);
        adapter.send_response(4, launch_seq, "launch", true, None, None);
    });

    let config = basic_handshake_config(json!({}));
    let capabilities = run_handshake_within(session, config, Duration::from_secs(5))
        .expect("the handshake must not hang")
        .expect("handshake succeeds even with no capabilities body at all");
    assert!(!capabilities.supports("supportsConditionalBreakpoints"));
    assert!(!capabilities.supports("anythingAtAll"));
    adapter_thread.join().unwrap();
}

// ---------------------------------------------------------------------
// Session-end handling — transport death unblocks every in-flight wait.
// ---------------------------------------------------------------------

#[test]
fn silence_after_initialize_leaves_the_handshake_blocked_until_the_transport_closes_then_fails_cleanly(
) {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let (result_tx, result_rx) = channel();
    let handshake_session = Arc::clone(&session);
    std::thread::spawn(move || {
        let config = basic_handshake_config(json!({}));
        let result = run_handshake(&handshake_session, config);
        let _ = result_tx.send(result);
    });

    // Adapter answers `initialize`, observes the `launch` request, then goes
    // silent forever — it never sends `initialized`, and never sends any
    // other event either.
    let (init_seq, _) = adapter.expect_request("initialize");
    adapter.send_response(1, init_seq, "initialize", true, None, Some(json!({})));
    let _ = adapter.expect_request("launch");

    assert_eq!(
        result_rx.recv_timeout(Duration::from_millis(300)),
        Err(RecvTimeoutError::Timeout),
        "the handshake must still be genuinely blocked waiting for `initialized`, not spuriously done"
    );

    // Simulate the adapter disappearing entirely: dropping it drops its
    // sender half, so the client's reader thread observes a real EOF.
    drop(adapter);

    let result = result_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("the handshake must unblock once the transport closes, not hang forever");
    let error = result.expect_err(
        "a session-ended transport close must fail the handshake, not silently succeed",
    );
    assert_eq!(error.code(), "DEBUG_SESSION_ENDED");
}

#[test]
fn dropping_the_transport_fails_every_pending_request_and_notifies_the_sink_exactly_once() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (sink, sink_for_session) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink_for_session,
        Box::new(|| {}),
    );

    let pending = session
        .send_request("threads", None)
        .expect("write succeeds");
    let _ = adapter.recv_request(); // observed, never answered
    drop(adapter);

    let error = session
        .wait_for_response_with_timeout(pending, Duration::from_secs(5), "threads")
        .expect_err("a dropped transport must fail the pending request, not hang");
    assert_eq!(error.code(), "DEBUG_SESSION_ENDED");

    assert!(
        wait_until(|| !sink.ended_snapshot().is_empty(), Duration::from_secs(2)),
        "expected exactly one session-ended notification"
    );
    let ended = sink.ended_snapshot();
    assert_eq!(ended.len(), 1);
    assert_eq!(ended[0].1, SessionEndReason::TransportClosed);
}

#[test]
fn a_hostile_content_length_ends_the_session_with_a_distinct_malformed_frame_reason() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (sink, sink_for_session) = sink_pair();
    let _session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink_for_session,
        Box::new(|| {}),
    );

    // Far beyond `framing::MAX_DAP_MESSAGE_BYTES` — an unrecoverable framing
    // error, distinct from an ordinary transport close.
    adapter.send_raw(b"Content-Length: 99999999999999\r\n\r\n{}");

    assert!(wait_until(
        || !sink.ended_snapshot().is_empty(),
        Duration::from_secs(2)
    ));
    let ended = sink.ended_snapshot();
    assert_eq!(ended[0].1, SessionEndReason::MalformedFrame);
}

// ---------------------------------------------------------------------
// Event dispatch and reverse requests.
// ---------------------------------------------------------------------

#[test]
fn every_required_event_type_is_forwarded_verbatim_in_order() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (sink, sink_for_session) = sink_pair();
    let _session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink_for_session,
        Box::new(|| {}),
    );

    // `output`'s own body is asserted separately below — `F100` S5's
    // backpressure gate (`super::super::output_gate`) attaches a `sequence`
    // field to every real `output` event it actually emits, so its body is
    // no longer byte-for-byte what the adapter itself sent (every *other*
    // event kind here is still forwarded completely verbatim, unmodified by
    // the gate — see `dispatch_message`'s own "only `output` is special-
    // cased" branch).
    let expected = [
        ("stopped", json!({"reason": "breakpoint", "threadId": 1})),
        (
            "continued",
            json!({"threadId": 1, "allThreadsContinued": true}),
        ),
        ("output", json!({"category": "stdout", "output": "sum=7\n"})),
        ("thread", json!({"reason": "exited", "threadId": 1})),
        ("exited", json!({"exitCode": 0})),
        ("terminated", json!({})),
    ];
    for (index, (name, body)) in expected.iter().enumerate() {
        adapter.send_event(index as i64, name, Some(body.clone()));
    }

    assert!(wait_until(
        || sink.events_snapshot().len() >= expected.len(),
        Duration::from_secs(2)
    ));
    let events = sink.events_snapshot();
    for (recorded, (name, body)) in events.iter().zip(expected.iter()) {
        assert_eq!(&recorded.1, name);
        if *name == "output" {
            assert_eq!(
                recorded.2.as_ref(),
                Some(&json!({"category": "stdout", "output": "sum=7\n", "sequence": 1}))
            );
        } else {
            assert_eq!(recorded.2.as_ref(), Some(body));
        }
    }
}

#[test]
fn a_single_malformed_json_message_is_surfaced_as_a_diagnostic_and_does_not_end_the_session() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (sink, sink_for_session) = sink_pair();
    let _session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink_for_session,
        Box::new(|| {}),
    );

    // Well-formed framing, but a body that is not valid JSON at all.
    adapter.send_raw(b"Content-Length: 11\r\n\r\nnot json {}");
    // Sent right after — proves the session survives one bad message.
    adapter.send_event(
        1,
        "output",
        Some(json!({"category": "stdout", "output": "hi\n"})),
    );

    assert!(wait_until(
        || sink.events_snapshot().len() >= 2,
        Duration::from_secs(2)
    ));
    let events = sink.events_snapshot();
    assert_eq!(events[0].1, "plain/protocolError");
    assert_eq!(events[1].1, "output");
    // `sequence: 1` — the first (and, in this test, only) real `output`
    // event this fresh session's backpressure gate ever emits — see
    // `every_required_event_type_is_forwarded_verbatim_in_order`'s own
    // comment for why `output` alone carries this extra field.
    assert_eq!(
        events[1].2,
        Some(json!({"category": "stdout", "output": "hi\n", "sequence": 1}))
    );
    assert!(
        sink.ended_snapshot().is_empty(),
        "one malformed message must not end the session"
    );
}

#[test]
fn a_reverse_request_is_surfaced_to_the_sink_and_answered_so_the_adapter_is_never_left_hanging() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (sink, sink_for_session) = sink_pair();
    let _session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink_for_session,
        Box::new(|| {}),
    );

    adapter.send_reverse_request(
        7,
        "runInTerminal",
        Some(json!({"cwd": "/tmp", "args": ["python3"]})),
    );

    assert!(wait_until(
        || !sink.events_snapshot().is_empty(),
        Duration::from_secs(2)
    ));
    let events = sink.events_snapshot();
    assert_eq!(events[0].1, "plain/reverseRequest/runInTerminal");

    // The mock, playing the adapter that issued the reverse request, must
    // receive an actual reply correlated by `request_seq` — proving the
    // client never leaves an adapter's own request/response machinery
    // hanging, even though real `runInTerminal` handling is a later slice's
    // job (see the module doc).
    let response = adapter.recv_response();
    assert_eq!(response.request_seq, 7);
    assert_eq!(response.command, "runInTerminal");
    assert!(!response.success);
}

/// A test-only [`ReverseRequestHandler`] proving [`DebugSession`]'s own
/// dispatch wiring (not `runInTerminal`'s real `TerminalService` logic,
/// which is `debug::service::tests`'s job — see that file's own real-
/// subprocess `runInTerminal` integration test) — recognizes exactly one
/// command and returns a scripted [`ReverseRequestOutcome`], letting this
/// test assert `dispatch_message` (1) actually calls the handler rather than
/// unconditionally declining, (2) writes the handler's real `success`/`body`
/// back to the adapter, and (3) forwards the handler's `notify` event to the
/// frontend sink — all without needing a real `TerminalService`.
struct ScriptedReverseRequestHandler {
    recognized_command: &'static str,
    outcome_body: Value,
    notify: (String, Value),
}

impl ReverseRequestHandler for ScriptedReverseRequestHandler {
    fn handle(
        &self,
        _session_id: DebugSessionId,
        command: &str,
        _arguments: Option<&Value>,
    ) -> Option<ReverseRequestOutcome> {
        if command != self.recognized_command {
            return None;
        }
        Some(ReverseRequestOutcome {
            success: true,
            body: Some(self.outcome_body.clone()),
            message: None,
            notify: Some(self.notify.clone()),
        })
    }
}

#[test]
fn a_recognized_reverse_request_gets_a_real_reply_and_a_frontend_notification() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (sink, sink_for_session) = sink_pair();
    let handler = Arc::new(ScriptedReverseRequestHandler {
        recognized_command: "runInTerminal",
        outcome_body: json!({"processId": 4242}),
        notify: (
            "plain/runInTerminal".to_owned(),
            json!({"terminalSessionId": "fake-terminal-session"}),
        ),
    });
    let _session = DebugSession::start_with_reverse_requests(
        session_id,
        client_reader,
        client_writer,
        sink_for_session,
        Box::new(|| {}),
        handler,
    );

    adapter.send_reverse_request(
        9,
        "runInTerminal",
        Some(json!({"cwd": "/tmp", "args": ["python3"]})),
    );

    let response = adapter.recv_response();
    assert_eq!(response.request_seq, 9);
    assert_eq!(response.command, "runInTerminal");
    assert!(
        response.success,
        "a recognized reverse request must succeed"
    );
    assert_eq!(response.body, Some(json!({"processId": 4242})));

    assert!(wait_until(
        || sink
            .events_snapshot()
            .iter()
            .any(|(_, name, _)| name == "plain/runInTerminal"),
        Duration::from_secs(2)
    ));
    let events = sink.events_snapshot();
    let notification = events
        .iter()
        .find(|(_, name, _)| name == "plain/runInTerminal")
        .expect("the handler's notify event was forwarded to the frontend sink");
    assert_eq!(
        notification.2,
        Some(json!({"terminalSessionId": "fake-terminal-session"}))
    );
}

#[test]
fn an_unrecognized_command_still_falls_back_to_the_automatic_decline_even_with_a_real_handler_installed(
) {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink_for_session) = sink_pair();
    let handler = Arc::new(ScriptedReverseRequestHandler {
        recognized_command: "runInTerminal",
        outcome_body: json!({}),
        notify: ("plain/runInTerminal".to_owned(), json!({})),
    });
    let _session = DebugSession::start_with_reverse_requests(
        session_id,
        client_reader,
        client_writer,
        sink_for_session,
        Box::new(|| {}),
        handler,
    );

    // A command the installed handler does not recognize — proves the
    // fallback to the automatic decline is per-command, not "a real handler
    // is installed, so nothing is ever declined again".
    adapter.send_reverse_request(3, "startDebugging", Some(json!({})));
    let response = adapter.recv_response();
    assert_eq!(response.request_seq, 3);
    assert_eq!(response.command, "startDebugging");
    assert!(!response.success);
}

// ---------------------------------------------------------------------
// `F100` S5 — per-request timeout classification. See the module doc's own
// "`F100` S5" section for the full rationale; the pair of tests below
// (`only_launchs_own_response_gets_the_generous_timeout_budget`/
// `every_other_handshake_step_still_gets_the_ordinary_short_timeout_budget`)
// is the control-group proof the classification is real and bidirectional —
// same mock harness, same short `request_timeout`, only *which* step is
// delayed differs, with the opposite outcome each time.
// ---------------------------------------------------------------------

#[test]
fn wait_for_response_with_timeout_fails_deterministically_when_no_reply_ever_arrives_but_the_session_stays_alive(
) {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let pending = session
        .send_request("threads", None)
        .expect("write succeeds");
    let _ = adapter.recv_request(); // observed by the mock adapter, deliberately never answered

    let start = Instant::now();
    let error = session
        .wait_for_response_with_timeout(pending, Duration::from_millis(80), "threads")
        .expect_err("a request the adapter never answers must time out, not hang forever");
    let elapsed = start.elapsed();
    assert_eq!(error.code(), "DEBUG_REQUEST_TIMED_OUT");
    assert!(error.message().contains("threads"));
    assert!(
        elapsed >= Duration::from_millis(80),
        "must actually wait out the full timeout, not fire early"
    );
    assert!(
        elapsed < Duration::from_secs(2),
        "must not wait meaningfully longer than the timeout either"
    );

    // The adapter (never dropped — the session is still alive) is free to
    // keep running; this session simply never uses it again.
    drop(adapter);
}

#[test]
fn a_timed_out_requests_pending_entry_is_discarded_so_a_later_request_is_unaffected() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let stale_pending = session
        .send_request("threads", None)
        .expect("write succeeds");
    let (stale_seq, stale_command, _) = adapter.recv_request();
    assert_eq!(stale_command, "threads");
    let error = session
        .wait_for_response_with_timeout(stale_pending, Duration::from_millis(50), "threads")
        .expect_err("never-answered request times out");
    assert_eq!(error.code(), "DEBUG_REQUEST_TIMED_OUT");

    // A brand new request, sent after the timeout, must resolve normally —
    // proving the timed-out entry's cleanup did not corrupt the table for
    // anything sent afterward.
    let fresh_pending = session
        .send_request("stackTrace", Some(json!({"threadId": 1})))
        .expect("write succeeds");
    let (fresh_seq, fresh_command, _) = adapter.recv_request();
    assert_eq!(fresh_command, "stackTrace");
    assert_ne!(stale_seq, fresh_seq);

    // The adapter now replies to the *stale* (already timed-out) request
    // first — a stray late reply that must simply be unmatched — and only
    // then to the fresh one.
    adapter.send_response(
        0,
        stale_seq,
        "threads",
        true,
        None,
        Some(json!({"threads": []})),
    );
    adapter.send_response(
        0,
        fresh_seq,
        "stackTrace",
        true,
        None,
        Some(json!({"stackFrames": []})),
    );

    let fresh_response = session
        .wait_for_response_with_timeout(fresh_pending, Duration::from_secs(5), "stackTrace")
        .expect("the fresh request must still resolve to its own real reply");
    assert_eq!(fresh_response.command, "stackTrace");
}

#[test]
fn only_launchs_own_response_gets_the_generous_timeout_budget() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let short_request_timeout = Duration::from_millis(100);
    let long_launch_timeout = Duration::from_secs(2);
    // Longer than `launch`'s own deliberate delay below, comfortably bounding
    // a real bug (a regression back to "await launch's response immediately")
    // without making a correct implementation wait unreasonably long either.
    let launch_delay = Duration::from_millis(400);

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        adapter.send_response(1, init_seq, "initialize", true, None, Some(json!({})));
        let (launch_seq, _) = adapter.expect_request("launch");
        adapter.send_event(2, "initialized", None);
        let (config_done_seq, _) = adapter.expect_request("configurationDone");
        adapter.send_response(3, config_done_seq, "configurationDone", true, None, None);
        // Deliberately delayed past `short_request_timeout` but still well
        // within `long_launch_timeout` — the real `debugpy` shape this
        // domain's own handshake ordering exists to tolerate.
        std::thread::sleep(launch_delay);
        adapter.send_response(4, launch_seq, "launch", true, None, None);
    });

    let config = HandshakeConfig {
        adapter_id: "mock".to_owned(),
        request: LaunchRequestKind::Launch,
        arguments: json!({}),
        breakpoints: Vec::new(),
        request_timeout: short_request_timeout,
        launch_timeout: long_launch_timeout,
    };
    run_handshake_within(session, config, Duration::from_secs(5))
        .expect("the handshake must not hang")
        .expect(
            "launch's own response must be judged against the generous launch_timeout, not the \
             short request_timeout — a real, healthy adapter must not be failed here",
        );
    adapter_thread.join().unwrap();
}

#[test]
fn every_other_handshake_step_still_gets_the_ordinary_short_timeout_budget() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let short_request_timeout = Duration::from_millis(100);
    let long_launch_timeout = Duration::from_secs(2);
    // The exact same delay `only_launchs_own_response_gets_the_generous_timeout_budget`
    // applies to `launch` — but this time applied to `configurationDone`
    // instead, which must NOT be exempted from `short_request_timeout`. This
    // is the control-group half of the pair: identical harness, identical
    // delay, only *which* step is delayed (and therefore the outcome)
    // differs.
    let config_done_delay = Duration::from_millis(400);

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        adapter.send_response(1, init_seq, "initialize", true, None, Some(json!({})));
        let (launch_seq, _) = adapter.expect_request("launch");
        adapter.send_event(2, "initialized", None);
        let (config_done_seq, _) = adapter.expect_request("configurationDone");
        std::thread::sleep(config_done_delay);
        adapter.send_response(3, config_done_seq, "configurationDone", true, None, None);
        adapter.send_response(4, launch_seq, "launch", true, None, None);
    });

    let config = HandshakeConfig {
        adapter_id: "mock".to_owned(),
        request: LaunchRequestKind::Launch,
        arguments: json!({}),
        breakpoints: Vec::new(),
        request_timeout: short_request_timeout,
        launch_timeout: long_launch_timeout,
    };
    let error = run_handshake_within(session, config, Duration::from_secs(5))
        .expect("the handshake must not hang — it must fail with a timeout, not hang forever")
        .expect_err(
            "configurationDone is an ordinary step; it must be judged against the short \
             request_timeout, exactly like every other non-launch/attach step",
        );
    assert_eq!(error.code(), "DEBUG_REQUEST_TIMED_OUT");
    assert!(error.message().contains("configurationDone"));
    adapter_thread.join().unwrap();
}

#[test]
fn wait_for_initialized_times_out_independently_of_the_session_ending() {
    let ((client_reader, client_writer), mut adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(|| {}),
    );

    let adapter_thread = std::thread::spawn(move || {
        let (init_seq, _) = adapter.expect_request("initialize");
        adapter.send_response(1, init_seq, "initialize", true, None, Some(json!({})));
        let _ = adapter.expect_request("launch");
        // Deliberately never sends `initialized` and never drops the
        // transport either — the adapter (and the transport) both stay
        // alive; only this one event never arrives. The sleep is
        // comfortably longer than `request_timeout` below (so the timeout
        // genuinely fires while everything is still alive) but short enough
        // to keep this test fast.
        std::thread::sleep(Duration::from_millis(400));
    });

    let config = HandshakeConfig {
        adapter_id: "mock".to_owned(),
        request: LaunchRequestKind::Launch,
        arguments: json!({}),
        breakpoints: Vec::new(),
        request_timeout: Duration::from_millis(100),
        launch_timeout: Duration::from_secs(5),
    };
    let error = run_handshake_within(session, config, Duration::from_secs(5))
        .expect("the handshake must not hang")
        .expect_err("a missing `initialized` event, with the session still alive, must time out");
    assert_eq!(
        error.code(),
        "DEBUG_REQUEST_TIMED_OUT",
        "must be a timeout, not DEBUG_SESSION_ENDED — the transport never actually closed"
    );
    adapter_thread.join().unwrap();
}

// ---------------------------------------------------------------------
// Teardown.
// ---------------------------------------------------------------------

#[test]
fn shutdown_invokes_the_teardown_closure() {
    let ((client_reader, client_writer), _adapter) = duplex_pair();
    let session_id = DebugSessionId::new();
    let (_sink, sink) = sink_pair();
    let calls = Arc::new(AtomicUsize::new(0));
    let calls_for_teardown = Arc::clone(&calls);
    let session = DebugSession::start(
        session_id,
        client_reader,
        client_writer,
        sink,
        Box::new(move || {
            calls_for_teardown.fetch_add(1, Ordering::SeqCst);
        }),
    );
    session.shutdown();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
