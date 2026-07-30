//! Real DAP session lifecycle (`F100` S2) — the reader thread, request/
//! response correlation, handshake orchestration and event dispatch this
//! domain's own module doc (`debug/mod.rs`) has been pointing to since S0/S1
//! ("No production caller exists yet — S2 adds the real session lifecycle").
//! This module is transport-agnostic by construction: [`DebugSession::start`]
//! takes any `Box<dyn Read + Send>`/`Box<dyn Write + Send>` pair, so the same
//! code drives a spawned stdio adapter's `ChildStdout`/`ChildStdin`
//! ([`super::exec::spawn_adapter`]) or a `TcpStream` split via `try_clone`
//! ([`super::tcp::connect_adapter`]) identically — see
//! `super::service::DebugSessionService` for where each transport's reader/
//! writer/teardown triple is actually assembled.
//!
//! # The handshake ordering this module exists to get right
//!
//! `docs/research/2026-07-28-generic-dap.md`'s real captured `debugpy`
//! session proved the naive "await every request's response before sending
//! the next request" approach deadlocks: the adapter's real message order was
//! `initialize` response → (client sends `launch`, does **not** wait) →
//! `initialized` event → `setBreakpoints` response → `configurationDone`
//! response → **only now** does `launch`'s own response arrive. [`Session`]'s
//! request/response correlation is built so this is a natural consequence of
//! the design, not a special case: [`DebugSession::send_request`] returns a
//! [`PendingResponse`] the caller may choose *when* to await — [`run_handshake`]
//! sends `launch`/`attach` and holds onto its `PendingResponse` without
//! calling [`DebugSession::wait_for_response`] on it until after
//! `configurationDone`'s own response has already been observed. Because
//! `wait_for_response` is just a blocking receive on a channel the reader
//! thread will eventually fill (or drop, on session end), a response that
//! physically arrives before it is awaited simply sits in the channel until
//! then — there is no ordering hazard from "answering out of turn".
//!
//! # Why correlation only ever keys on `request_seq`
//!
//! See `super::protocol`'s own module doc for the full reasoning
//! (`lldb-dap`'s real `seq: 0` response). [`PendingTable`] is keyed
//! exclusively by the `i64` **Plain itself** assigned when it sent the
//! request ([`DebugSession::next_seq`]) — an incoming response is looked up
//! by its `request_seq` field alone, and the adapter's own `seq` field on
//! that response, or on any other message, is never consulted for anything.
//!
//! # Two independent "the session is over" signals, not one
//!
//! `docs/research/2026-07-28-generic-dap.md`'s "决策 4" requires
//! distinguishing an adapter's own `terminated` DAP *event* (a normal,
//! protocol-level notification, forwarded to the frontend like any other
//! event via [`DebugEventSink::emit_event`]) from Plain's own inference that
//! the underlying transport died (EOF, an I/O error, or an unrecoverable
//! framing error) — the latter is reported through the *separate*
//! [`DebugEventSink::emit_session_ended`] method, under the reserved
//! [`SESSION_ENDED_EVENT_NAME`] when surfaced to the frontend (see
//! `super::commands`'s `DebugWindowEventSink`), which no real DAP adapter can
//! ever emit (DAP event names are bare identifiers; this one deliberately
//! contains a `/`). A real `terminated` event and a real transport death can
//! both happen for the same session (typically in that order), and both get
//! reported — they are not conflated into one signal.
//!
//! # `F100` S5 — per-request timeouts, classified, not one-size-fits-all
//!
//! Every wait that can block forever if the adapter is merely unresponsive
//! (not dead — the session-end path already handles that) now has a finite
//! bound, closing the gap the module doc above used to disclose as
//! deliberately unimplemented. The classification is not a single global
//! timeout because `docs/research/2026-07-28-generic-dap.md`'s own real
//! `debugpy` capture proved one specific wait is *legitimately* long-lived:
//! `launch`/`attach`'s own response is deferred by spec until after
//! `configurationDone`'s response arrives (see "handshake ordering" above) —
//! applying the same short budget to it as to an ordinary request would fail
//! a healthy adapter simply because starting the debuggee itself
//! (compiling, container startup, attaching to a remote process, …)
//! legitimately takes longer than one interactive round trip. So there are
//! exactly two named budgets, never a bare literal `Duration` at a call site:
//!
//! - [`DEBUG_REQUEST_TIMEOUT`] (30s, matching `git::exec::GIT_EXEC_TIMEOUT`'s
//!   own magnitude) — every step [`run_handshake`] does *not* defer
//!   (`initialize`, the `initialized` event wait, each `setBreakpoints`,
//!   `configurationDone`) and every post-handshake interactive/step-control
//!   request `super::service::DebugSessionService::send_request` issues
//!   (`stackTrace`/`scopes`/`variables`/`evaluate`/`continue`/…). See
//!   `debug::mod`'s own S5 report for the real large-payload benchmark
//!   numbers backing 30s as generous headroom, not a value picked to just
//!   clear measured latency.
//! - [`DEBUG_LAUNCH_TIMEOUT`] (300s) — `launch`/`attach`'s own response only,
//!   awaited last in [`run_handshake`], per the paragraph above. Still
//!   finite: this slice's own requirement is that *every* pending request
//!   fails deterministically, never hangs forever, even the one whose
//!   response is expected to be slow.
//!
//! Both are threaded through [`HandshakeConfig`] as explicit fields (not
//! hardcoded inside [`run_handshake`] itself) so `session::tests` can exercise
//! the real classification logic with real (tiny) durations instead of
//! waiting out the real production values — see that module's own
//! `basic_handshake_config` and the classification control-group pair
//! (`only_launchs_own_response_gets_the_generous_timeout_budget`/
//! `every_other_handshake_step_still_gets_the_ordinary_short_timeout_budget`).
//! A timed-out request's [`PendingTable`] entry is proactively discarded (see
//! [`DebugSession::wait_for_response_with_timeout`]) so a late reply arriving
//! afterward is simply an unmatched stray (the same outcome
//! [`PendingTable::resolve`]'s own doc comment already describes for any
//! other unmatched reply) rather than leaking memory for the rest of a
//! long-lived session.
//!
//! `output`-event backpressure ([`super::output_gate`]) and mid-session
//! large-object benchmarking are the other two pieces of `F100` S5 — see that
//! module's own doc for the gate, and `debug::mod`'s S5 report for the real
//! benchmark numbers.
//!
//! # `F100` S4 — real reverse-request handling, without touching every
//! existing `DebugSession::start` call site
//!
//! S2/S3 left every reverse request (`runInTerminal` chief among them) with
//! only an automatic decline — see [`DebugSession::decline_reverse_request`]
//! — purely to keep an adapter's own request/response state machine from
//! hanging forever on a reply Plain would otherwise never send. This slice
//! adds a real, pluggable [`ReverseRequestHandler`] seam: [`dispatch_message`]
//! consults it first, and only falls back to the automatic decline when the
//! handler itself reports it does not recognize the command (`None`) — see
//! `super::commands`'s `handle_run_in_terminal_reverse_request` for the one
//! real implementation this slice adds (`runInTerminal`, wired to Plain's own
//! `TerminalService`). [`DebugSession::start`] keeps its exact existing
//! signature (still installing a null handler that recognizes nothing,
//! preserving every prior test call site in `tests.rs` unchanged) —
//! [`DebugSession::start_with_reverse_requests`] is the one new entry point
//! `super::service::DebugSessionService::start_session` (this slice's only
//! production caller) switches to.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

use serde_json::{json, Value};

use crate::error::CommandError;

use super::dto::DebugSessionId;
use super::framing::FrameDecoder;
use super::output_gate::{OutputGate, OutputGateOutcome};
use super::protocol::{self, Capabilities, IncomingMessage, ProtocolError, ResponseEnvelope};
use super::{
    debug_handshake_failed, debug_request_timed_out, debug_session_ended,
    debug_transport_unavailable,
};

/// Wall-clock bound on an ordinary (non-`launch`/`attach`) DAP request's
/// response — see the module doc's "`F100` S5" section for the full
/// classification rationale and why this is 30s (matching
/// `git::exec::GIT_EXEC_TIMEOUT`'s own magnitude).
pub(crate) const DEBUG_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Wall-clock bound on `launch`/`attach`'s *own* response only — see the
/// module doc's "`F100` S5" section for why this is deliberately much longer
/// than [`DEBUG_REQUEST_TIMEOUT`], not the same budget applied everywhere.
pub(crate) const DEBUG_LAUNCH_TIMEOUT: Duration = Duration::from_secs(300);

/// Bytes requested per blocking `read()` call against the session's
/// transport — mirrors `terminal::service::TERMINAL_READ_BUFFER_BYTES`'s
/// exact value and rationale (a generously sized, unremarkable buffer; the
/// per-message size ceiling lives in [`super::framing::MAX_DAP_MESSAGE_BYTES`],
/// not here).
const DEBUG_SESSION_READ_BUFFER_BYTES: usize = 8192;

/// Reserved event name [`DebugEventSink::emit_session_ended`] is delivered
/// under when surfaced to the frontend — see the module doc's "two
/// independent signals" section for why this can never collide with a real
/// DAP event name (every real DAP event name is a bare identifier like
/// `stopped`/`output`; none contains a `/`).
pub(crate) const SESSION_ENDED_EVENT_NAME: &str = "plain/sessionEnded";

/// Why the reader loop ended — always reported once per session via
/// [`DebugEventSink::emit_session_ended`], regardless of which case applies.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SessionEndReason {
    /// The transport reached EOF or a hard I/O error — the adapter process
    /// exited (stdio) or the socket closed (TCP), detected independently of
    /// whether the adapter *also* sent its own `terminated` DAP event first.
    TransportClosed,
    /// [`FrameDecoder::feed`] returned an unrecoverable framing error (a
    /// malformed/hostile `Content-Length`, an oversized message, header
    /// growth past its cap, …) — per `framing`'s own module doc, this
    /// decoder defines no resynchronization-after-error semantics, so the
    /// session cannot continue.
    MalformedFrame,
}

impl SessionEndReason {
    pub(crate) fn as_wire(self) -> &'static str {
        match self {
            Self::TransportClosed => "transportClosed",
            Self::MalformedFrame => "malformedFrame",
        }
    }
}

/// Delivery seam for everything a live session ever reports to the outside
/// world — mirrors `terminal::service::TerminalOutputSink`'s exact
/// production-vs-test-recording split. See the module doc's "two independent
/// signals" section for why these are two methods, not one.
pub(crate) trait DebugEventSink: Send + Sync {
    /// A real DAP event, forwarded with its event name and body exactly as
    /// the adapter sent them — including reverse-request diagnostics and
    /// protocol-error diagnostics this module itself synthesizes (both under
    /// a `plain/`-prefixed name, for the same "can never collide with a real
    /// DAP event name" reason [`SESSION_ENDED_EVENT_NAME`] documents).
    fn emit_event(&self, session_id: DebugSessionId, event: String, body: Option<Value>);
    /// Plain's own inferred "this session's transport is gone" signal — see
    /// the module doc.
    fn emit_session_ended(&self, session_id: DebugSessionId, reason: SessionEndReason);
}

/// `F100` S4's real reverse-request delivery seam — see the module doc's own
/// "real reverse-request handling" section. Implemented once, in
/// `super::commands` (`RunInTerminalReverseRequestHandler`, wrapping the
/// free function `handle_run_in_terminal_reverse_request` so the exact same
/// logic is reachable from both a real `AppHandle`-backed production caller
/// and a plain, `AppHandle`-free integration test); every existing/future
/// unrecognized command simply falls back to
/// [`DebugSession::decline_reverse_request`] via [`NullReverseRequestHandler`].
pub(crate) trait ReverseRequestHandler: Send + Sync {
    /// Returns `None` for any `command` this handler does not implement —
    /// the caller ([`dispatch_message`]) then falls back to
    /// [`DebugSession::decline_reverse_request`]'s existing behavior. Runs on
    /// the reader thread itself (synchronously) — a handler that needs to
    /// call an `async` service (e.g. `TerminalService::start_program`) is
    /// expected to bridge via `tauri::async_runtime::block_on`, exactly as
    /// `RunInTerminalReverseRequestHandler` does.
    fn handle(
        &self,
        session_id: DebugSessionId,
        command: &str,
        arguments: Option<&Value>,
    ) -> Option<ReverseRequestOutcome>;
}

/// One reverse request's real, considered outcome — distinct from the
/// automatic decline: `success: false` here still means a handler actually
/// looked at the request and rejected it (e.g. a structurally invalid
/// `runInTerminal` request, or the spawn itself failing), not "Plain does not
/// implement this yet".
pub(crate) struct ReverseRequestOutcome {
    pub(crate) success: bool,
    pub(crate) body: Option<Value>,
    pub(crate) message: Option<String>,
    /// An additional frontend-facing notification to emit via
    /// [`DebugEventSink::emit_event`] alongside the adapter-facing reply
    /// above, under a `plain/`-prefixed event name (same "cannot collide with
    /// a real DAP event name" reasoning as [`SESSION_ENDED_EVENT_NAME`]) —
    /// e.g. `runInTerminal`'s own successful outcome also tells the frontend
    /// which already-`TerminalService`-backed terminal session it should
    /// surface as a visible tab. `None` when a handler's outcome needs no
    /// separate frontend notification.
    pub(crate) notify: Option<(String, Value)>,
}

/// The default reverse-request handler [`DebugSession::start`] installs —
/// recognizes nothing, so every reverse request keeps going through the
/// pre-existing automatic-decline path. This is what lets every prior
/// `DebugSession::start` call site in `tests.rs` (S2's own in-memory mock
/// adapter fixtures) keep compiling and behaving identically, unaware this
/// slice added a real handling path at all. `#[allow(dead_code)]`: this
/// struct and [`DebugSession::start`] itself have no *production* caller in a
/// non-test build (the sole production caller,
/// `super::service::DebugSessionService::start_session`, always uses
/// [`DebugSession::start_with_reverse_requests`] with a real handler) — every
/// caller of the plain `start` is a `#[cfg(test)]` fixture in `session::tests`.
#[allow(dead_code)]
struct NullReverseRequestHandler;

impl ReverseRequestHandler for NullReverseRequestHandler {
    fn handle(
        &self,
        _session_id: DebugSessionId,
        _command: &str,
        _arguments: Option<&Value>,
    ) -> Option<ReverseRequestOutcome> {
        None
    }
}

/// One still-outstanding request's reply channel — created by
/// [`DebugSession::send_request`], resolved by the reader thread (a real
/// reply), dropped wholesale on session end (every blocked
/// [`DebugSession::wait_for_response_with_timeout`] then observes a
/// disconnected channel, mapped to [`debug_session_ended`] — see
/// [`PendingTable::fail_all`]), or timed out (see that method's own doc
/// comment) — `seq` is kept alongside the receiver purely so a timed-out wait
/// can discard its own now-useless table entry.
pub(crate) struct PendingResponse {
    seq: i64,
    receiver: Receiver<ResponseEnvelope>,
}

struct PendingTable {
    entries: Mutex<HashMap<i64, SyncSender<ResponseEnvelope>>>,
}

impl PendingTable {
    fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn register(&self, seq: i64) -> PendingResponse {
        let (sender, receiver) = sync_channel(1);
        lock(&self.entries).insert(seq, sender);
        PendingResponse { seq, receiver }
    }

    /// Removes a registration nobody will ever resolve — either the write
    /// that was supposed to prompt a reply itself failed, or (`F100` S5) a
    /// caller gave up waiting once [`DEBUG_REQUEST_TIMEOUT`]/[`DEBUG_LAUNCH_TIMEOUT`]
    /// elapsed. Without this, either case would otherwise leak an entry for
    /// the rest of the session's lifetime — a real risk once every wait is no
    /// longer unbounded (a chatty caller issuing many requests a slow adapter
    /// never answers could otherwise accumulate one stale entry per timeout,
    /// for as long as the session itself stays alive).
    fn discard(&self, seq: i64) {
        lock(&self.entries).remove(&seq);
    }

    /// Resolves the pending entry for `response.request_seq`, if any — a
    /// response with no matching pending entry (a stray/duplicate/late
    /// reply, one for a request whose caller already gave up on disconnect,
    /// or one that arrives after [`Self::discard`] already timed it out) is
    /// simply not delivered anywhere; the reader thread's caller decides
    /// whether that itself is worth a diagnostic (see [`run_reader`]).
    fn resolve(&self, response: ResponseEnvelope) -> bool {
        let sender = lock(&self.entries).remove(&response.request_seq);
        match sender {
            Some(sender) => sender.send(response).is_ok(),
            None => false,
        }
    }

    /// Drops every still-pending sender. Every blocked
    /// [`DebugSession::wait_for_response_with_timeout`] then observes a
    /// disconnected channel (`Err`) immediately, rather than waiting out its
    /// own timeout — session end is a strictly faster, independent path to
    /// the same "stop waiting" outcome, not a replacement for per-request
    /// timeouts (a live session with an unresponsive adapter never reaches
    /// this at all).
    fn fail_all(&self) {
        lock(&self.entries).clear();
    }
}

struct SignalState {
    initialized: bool,
    ended: Option<SessionEndReason>,
}

/// A single condvar-guarded latch serving two purposes at once: "has the
/// `initialized` event fired yet" and "has the session ended" — unified into
/// one structure (rather than two separate primitives) specifically so
/// [`Self::wait_for_initialized`] can wake on *either* condition with a
/// single `Condvar::wait` loop, which is what lets a transport death during
/// the handshake's `initialized`-wait unblock deterministically instead of
/// hanging forever (see the module doc's adversarial "mid-session silence"
/// scenario, exercised in `tests`).
struct SessionSignal {
    state: Mutex<SignalState>,
    condvar: Condvar,
}

impl SessionSignal {
    fn new() -> Self {
        Self {
            state: Mutex::new(SignalState {
                initialized: false,
                ended: None,
            }),
            condvar: Condvar::new(),
        }
    }

    fn fire_initialized(&self) {
        let mut state = lock(&self.state);
        state.initialized = true;
        self.condvar.notify_all();
    }

    fn mark_ended(&self, reason: SessionEndReason) {
        let mut state = lock(&self.state);
        if state.ended.is_none() {
            state.ended = Some(reason);
        }
        self.condvar.notify_all();
    }

    /// Blocks until `initialized` fires, the session ends, or `timeout`
    /// elapses first — `F100` S5 added `timeout` (see the module doc's own
    /// "`F100` S5" section: this wait risked hanging forever against a live-
    /// but-unresponsive adapter exactly like an unbounded
    /// [`DebugSession::wait_for_response_with_timeout`] would have). Uses
    /// [`Condvar::wait_timeout_while`] rather than the previous plain
    /// `wait` loop so a real `mark_ended`/`fire_initialized` notification
    /// still wakes this immediately, regardless of how much of `timeout`
    /// remains — the timeout is a ceiling on "stuck with nothing happening
    /// at all", never a floor on how fast a real signal is observed.
    fn wait_for_initialized(&self, timeout: Duration) -> Result<(), CommandError> {
        let state = lock(&self.state);
        let (state, wait_result) = self
            .condvar
            .wait_timeout_while(state, timeout, |state| {
                !state.initialized && state.ended.is_none()
            })
            .unwrap_or_else(PoisonError::into_inner);
        if state.initialized {
            Ok(())
        } else if state.ended.is_some() {
            Err(debug_session_ended())
        } else {
            debug_assert!(wait_result.timed_out());
            Err(debug_request_timed_out("initialized"))
        }
    }
}

/// A live DAP session: owns the write half of the transport, the outgoing
/// seq counter, the pending-response table, the negotiated [`Capabilities`]
/// (once known) and the reader thread's join handle. See the module doc for
/// the overall design; [`DebugSession::start`] is the only constructor.
pub(crate) struct DebugSession {
    writer: Mutex<Box<dyn Write + Send>>,
    next_seq: AtomicI64,
    pending: PendingTable,
    capabilities: Mutex<Option<Capabilities>>,
    signal: SessionSignal,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    teardown: Box<dyn Fn() + Send + Sync>,
    reverse_requests: Arc<dyn ReverseRequestHandler>,
    /// `F100` S5's `output`-event backpressure gate (see [`super::output_gate`]'s
    /// own module doc) — one per session, consulted by [`dispatch_message`]
    /// for every real `output` event and drained by [`Self::ack_output`].
    output_gate: OutputGate,
    /// A second, session-owned clone of the same sink [`run_reader`]'s
    /// closure already holds — needed *only* by [`Self::ack_output`], which
    /// runs on an unrelated call stack (a `debug_output_ack` command
    /// invocation, not the reader thread) and therefore cannot reach the
    /// `sink` parameter [`run_reader`]/[`dispatch_message`] were given
    /// directly; every other event-emission path in this module keeps using
    /// the threaded-through `sink` parameter unchanged.
    sink: Arc<dyn DebugEventSink>,
}

impl DebugSession {
    /// Starts a session over `reader`/`writer` (already-connected — this
    /// module never spawns or connects anything itself; see
    /// `super::service::DebugSessionService` for that), spawning its
    /// dedicated reader thread (`plain-debug-reader-<id>`) and returning a
    /// shared handle immediately (this does **not** wait for `initialize` or
    /// anything else — see [`run_handshake`] for that). `teardown` is called
    /// exactly once by [`Self::shutdown`] to actually tear down the
    /// underlying transport (kill the child process, or shut down the TCP
    /// socket) — kept as an opaque closure so this module never needs to
    /// know which transport kind it is holding. Installs
    /// [`NullReverseRequestHandler`] — every existing caller (S2/S3's own
    /// in-memory mock-adapter tests) keeps its exact prior "every reverse
    /// request is declined" behavior; [`Self::start_with_reverse_requests`]
    /// is the new entry point a caller wanting real reverse-request handling
    /// (`F100` S4's `super::service::DebugSessionService::start_session`)
    /// uses instead. `#[allow(dead_code)]`: no production caller in a
    /// non-test build (see [`NullReverseRequestHandler`]'s own doc comment) —
    /// every call site is a `#[cfg(test)]` fixture in `session::tests`.
    #[allow(dead_code)]
    pub(crate) fn start(
        session_id: DebugSessionId,
        reader: Box<dyn Read + Send>,
        writer: Box<dyn Write + Send>,
        sink: Arc<dyn DebugEventSink>,
        teardown: Box<dyn Fn() + Send + Sync>,
    ) -> Arc<DebugSession> {
        Self::start_with_reverse_requests(
            session_id,
            reader,
            writer,
            sink,
            teardown,
            Arc::new(NullReverseRequestHandler),
        )
    }

    /// Identical to [`Self::start`], except `reverse_requests` is a real
    /// handler (rather than the null one) — see the module doc's "real
    /// reverse-request handling" section.
    pub(crate) fn start_with_reverse_requests(
        session_id: DebugSessionId,
        reader: Box<dyn Read + Send>,
        writer: Box<dyn Write + Send>,
        sink: Arc<dyn DebugEventSink>,
        teardown: Box<dyn Fn() + Send + Sync>,
        reverse_requests: Arc<dyn ReverseRequestHandler>,
    ) -> Arc<DebugSession> {
        let session = Arc::new(DebugSession {
            writer: Mutex::new(writer),
            next_seq: AtomicI64::new(1),
            pending: PendingTable::new(),
            capabilities: Mutex::new(None),
            signal: SessionSignal::new(),
            reader_thread: Mutex::new(None),
            teardown,
            reverse_requests,
            output_gate: OutputGate::new(),
            sink: Arc::clone(&sink),
        });

        let reader_session = Arc::clone(&session);
        let handle = std::thread::Builder::new()
            .name(format!("plain-debug-reader-{}", session_id.as_wire()))
            .spawn(move || run_reader(reader_session, reader, sink, session_id))
            .ok();
        *lock(&session.reader_thread) = handle;
        session
    }

    /// Allocates the next outgoing seq, registers a pending-response slot for
    /// it, writes the framed request, and returns a [`PendingResponse`] the
    /// caller may await immediately or hold onto — see the module doc's
    /// "handshake ordering" section for why that choice matters. A write
    /// failure discards the just-registered pending slot (nobody will ever
    /// resolve it) before propagating [`debug_transport_unavailable`].
    pub(crate) fn send_request(
        &self,
        command: &str,
        arguments: Option<Value>,
    ) -> Result<PendingResponse, CommandError> {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let pending = self.pending.register(seq);
        let framed = protocol::encode_request(seq, command, arguments);
        if let Err(error) = self.write_framed(&framed) {
            self.pending.discard(seq);
            return Err(error);
        }
        Ok(pending)
    }

    /// Blocks until `pending`'s response arrives, the session ends first
    /// (mapped to [`debug_session_ended`]), or `timeout` elapses first
    /// (mapped to [`debug_request_timed_out`], carrying `command` so a
    /// caller gets an actionable "which request timed out" diagnostic) — see
    /// the module doc's "`F100` S5" section for why every call site passes
    /// one of exactly two named durations
    /// ([`DEBUG_REQUEST_TIMEOUT`]/[`DEBUG_LAUNCH_TIMEOUT`]), never a bare
    /// literal. On timeout, `pending`'s own table entry is proactively
    /// discarded — see [`PendingTable::discard`]'s own doc comment for why
    /// (a live session must not accumulate one stale entry per timed-out
    /// request for the rest of its lifetime).
    pub(crate) fn wait_for_response_with_timeout(
        &self,
        pending: PendingResponse,
        timeout: Duration,
        command: &str,
    ) -> Result<ResponseEnvelope, CommandError> {
        match pending.receiver.recv_timeout(timeout) {
            Ok(response) => Ok(response),
            Err(RecvTimeoutError::Timeout) => {
                self.pending.discard(pending.seq);
                Err(debug_request_timed_out(command))
            }
            Err(RecvTimeoutError::Disconnected) => Err(debug_session_ended()),
        }
    }

    /// Blocks until the `initialized` event has fired, the session ends
    /// first, or `timeout` elapses first — see
    /// [`SessionSignal::wait_for_initialized`].
    pub(crate) fn wait_for_initialized(&self, timeout: Duration) -> Result<(), CommandError> {
        self.signal.wait_for_initialized(timeout)
    }

    /// `F100` S5 — acknowledges having processed a gated `output` event
    /// through `sequence` (see [`super::output_gate`]'s own module doc),
    /// flushing whatever content the gate is now able to release as real
    /// `output` events (each preceded by a `plain/outputElided` notice if any
    /// content was actually dropped while gated) via [`Self::sink`] — the
    /// one reason this session keeps its own `sink` clone alongside the one
    /// [`run_reader`] holds (this runs on a `debug_output_ack` command's own
    /// call stack, not the reader thread).
    pub(crate) fn ack_output(&self, session_id: DebugSessionId, sequence: u64) {
        for flushed in self.output_gate.ack(sequence) {
            if flushed.elided_bytes > 0 || flushed.elided_lines > 0 {
                self.sink.emit_event(
                    session_id,
                    "plain/outputElided".to_owned(),
                    Some(json!({
                        "category": flushed.category,
                        "elidedBytes": flushed.elided_bytes,
                        "elidedLines": flushed.elided_lines,
                    })),
                );
            }
            self.sink.emit_event(
                session_id,
                "output".to_owned(),
                Some(json!({
                    "category": flushed.category,
                    "output": flushed.text,
                    "sequence": flushed.sequence,
                })),
            );
        }
    }

    /// The negotiated [`Capabilities`] from the `initialize` response, once
    /// [`run_handshake`] has completed that step — `None` before then. No
    /// production caller yet: `super::service::DebugSessionService::start_session`
    /// already returns the negotiated capabilities directly from
    /// [`run_handshake`]'s own return value at session-start time, so nothing
    /// needs to re-query them off a live [`DebugSession`] later in this
    /// slice; kept for a later slice wanting to re-check capabilities against
    /// an already-running session (e.g. before sending a request whose
    /// support depends on one).
    #[allow(dead_code)] // No production caller yet — see the doc comment above.
    pub(crate) fn capabilities(&self) -> Option<Capabilities> {
        lock(&self.capabilities).clone()
    }

    fn store_capabilities(&self, capabilities: Capabilities) {
        *lock(&self.capabilities) = Some(capabilities);
    }

    /// Tears down the underlying transport (see [`Self::start`]'s `teardown`
    /// doc) — idempotent in effect (the transport's own teardown, e.g.
    /// `AdapterHandle::kill`, is already idempotent), but only ever called
    /// once in practice (`super::service::DebugSessionService::disconnect`/
    /// `close_window`). Does **not** itself join the reader thread — see
    /// [`Self::join_reader`].
    pub(crate) fn shutdown(&self) {
        (self.teardown)();
    }

    /// Blocks until the reader thread has fully exited — called after
    /// [`Self::shutdown`] so a caller (window-destroy cleanup, an explicit
    /// disconnect) can rely on every background thread this session ever
    /// spawned having wound down by the time this returns, mirroring
    /// `terminal::service::terminate_session`'s join step.
    pub(crate) fn join_reader(&self) {
        if let Some(handle) = lock(&self.reader_thread).take() {
            let _ = handle.join();
        }
    }

    fn write_framed(&self, framed: &[u8]) -> Result<(), CommandError> {
        let mut writer = lock(&self.writer);
        writer
            .write_all(framed)
            .map_err(|_| debug_transport_unavailable())?;
        writer.flush().map_err(|_| debug_transport_unavailable())
    }

    /// Replies to a reverse request neither [`Self::reverse_requests`] nor
    /// any earlier slice recognizes — the automatic decline, forwarded
    /// alongside the diagnostic event [`dispatch_message`] always emits
    /// first. Best-effort: a write failure here is not escalated (the reader
    /// loop's own next `read()` will surface any real transport death through
    /// the normal session-end path).
    fn decline_reverse_request(&self, request_seq: i64, command: &str) {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let framed = protocol::encode_response(
            seq,
            request_seq,
            command,
            false,
            Some("Plain does not yet handle this reverse request in this slice."),
            None,
        );
        let _ = self.write_framed(&framed);
    }

    /// Replies to a reverse request [`Self::reverse_requests`] actually
    /// handled — a real, considered `success`/`body`/`message`, not the
    /// automatic decline. Best-effort in the same way
    /// [`Self::decline_reverse_request`] is.
    fn reply_reverse_request(
        &self,
        request_seq: i64,
        command: &str,
        outcome: &ReverseRequestOutcome,
    ) {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let framed = protocol::encode_response(
            seq,
            request_seq,
            command,
            outcome.success,
            outcome.message.as_deref(),
            outcome.body.clone(),
        );
        let _ = self.write_framed(&framed);
    }

    /// `F100` S5 — routes a real DAP `output` event through
    /// [`Self::output_gate`] instead of forwarding it straight to `sink` (the
    /// path every other event kind still takes) — see [`super::output_gate`]'s
    /// own module doc for the gate's merge/elide contract. A body this gate
    /// cannot make sense of at all (missing/non-string `output` field) is
    /// forwarded unmodified and ungated: this is "an event this module
    /// doesn't understand", not something to silently drop, mirroring
    /// `dispatch_message`'s own `Err(error)` branch's "surface a diagnostic,
    /// do not swallow" stance for a different kind of malformed input.
    fn handle_output_event(
        &self,
        sink: &Arc<dyn DebugEventSink>,
        session_id: DebugSessionId,
        body: Option<Value>,
    ) {
        let Some(text) = output_text_from_body(body.as_ref()) else {
            sink.emit_event(session_id, "output".to_owned(), body);
            return;
        };
        let category = output_category_from_body(body.as_ref());
        if let OutputGateOutcome::Emit(sequence) = self.output_gate.on_output(&category, &text) {
            sink.emit_event(
                session_id,
                "output".to_owned(),
                Some(json!({
                    "category": category,
                    "output": text,
                    "sequence": sequence,
                })),
            );
        }
    }
}

/// Per spec, an `OutputEvent.body` with no `category` at all defaults to
/// `"console"` — mirrors `app/features/debug/plain-debug-console-view.ts`'s
/// own `outputCategoryFromBody` on the frontend side of the exact same wire
/// shape.
fn output_category_from_body(body: Option<&Value>) -> String {
    body.and_then(Value::as_object)
        .and_then(|object| object.get("category"))
        .and_then(Value::as_str)
        .unwrap_or("console")
        .to_owned()
}

/// `None` when `body` is missing an `output` string entirely — the module
/// doc's "an event this gate cannot make sense of" case.
fn output_text_from_body(body: Option<&Value>) -> Option<String> {
    body.and_then(Value::as_object)?
        .get("output")?
        .as_str()
        .map(str::to_owned)
}

/// The reader thread body — see the module doc's overview. Reads arbitrarily
/// sized chunks from `reader`, feeds them through a private
/// [`FrameDecoder`], and dispatches every fully-decoded message by type.
/// Ends (for exactly one of two reasons — see [`SessionEndReason`]) when the
/// transport closes or a framing error occurs, at which point every pending
/// request is failed and [`DebugEventSink::emit_session_ended`] is called
/// exactly once.
fn run_reader(
    session: Arc<DebugSession>,
    mut reader: Box<dyn Read + Send>,
    sink: Arc<dyn DebugEventSink>,
    session_id: DebugSessionId,
) {
    let mut decoder = FrameDecoder::new();
    let mut buffer = [0_u8; DEBUG_SESSION_READ_BUFFER_BYTES];
    let end_reason = loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break SessionEndReason::TransportClosed,
            Ok(read) => read,
        };
        let messages = match decoder.feed(&buffer[..read]) {
            Ok(messages) => messages,
            Err(_) => break SessionEndReason::MalformedFrame,
        };
        for message in messages {
            dispatch_message(&session, &sink, session_id, &message.body);
        }
    };
    session.pending.fail_all();
    session.signal.mark_ended(end_reason);
    sink.emit_session_ended(session_id, end_reason);
}

fn dispatch_message(
    session: &Arc<DebugSession>,
    sink: &Arc<dyn DebugEventSink>,
    session_id: DebugSessionId,
    body: &[u8],
) {
    match protocol::parse_incoming_message(body) {
        Ok(IncomingMessage::Response(response)) => {
            session.pending.resolve(response);
        }
        Ok(IncomingMessage::Event(event)) => {
            if event.event == "initialized" {
                session.signal.fire_initialized();
            }
            if event.event == "output" {
                session.handle_output_event(sink, session_id, event.body);
            } else {
                sink.emit_event(session_id, event.event, event.body);
            }
        }
        Ok(IncomingMessage::Request(request)) => {
            sink.emit_event(
                session_id,
                format!("plain/reverseRequest/{}", request.command),
                Some(json!({ "seq": request.seq, "arguments": request.arguments })),
            );
            match session.reverse_requests.handle(
                session_id,
                &request.command,
                request.arguments.as_ref(),
            ) {
                Some(outcome) => {
                    if let Some((event, notify_body)) = &outcome.notify {
                        sink.emit_event(session_id, event.clone(), Some(notify_body.clone()));
                    }
                    session.reply_reverse_request(request.seq, &request.command, &outcome);
                }
                None => session.decline_reverse_request(request.seq, &request.command),
            }
        }
        Err(error) => {
            sink.emit_event(
                session_id,
                "plain/protocolError".to_owned(),
                Some(json!({ "error": protocol_error_label(error) })),
            );
        }
    }
}

fn protocol_error_label(error: ProtocolError) -> &'static str {
    match error {
        ProtocolError::InvalidUtf8 => "invalidUtf8",
        ProtocolError::InvalidJson => "invalidJson",
        ProtocolError::UnknownMessageType => "unknownMessageType",
        ProtocolError::MalformedResponse => "malformedResponse",
        ProtocolError::MalformedEvent => "malformedEvent",
        ProtocolError::MalformedRequest => "malformedRequest",
    }
}

/// One already-built `setBreakpoints` request's arguments — see
/// `super::dto::SourceBreakpointsRequest::to_arguments` for how a wire
/// request becomes one of these. Kept as an already-built [`Value`] (rather
/// than the DTO type itself) so this module stays agnostic to the wire
/// shape, mirroring how `arguments` below is already opaque JSON.
pub(crate) struct SourceBreakpoints {
    pub(crate) arguments: Value,
}

/// Which DAP request starts the debuggee — `"launch"` or `"attach"`, per
/// `super::commands::debug_launch`/`debug_attach`. Not a richer enum because
/// these two literal strings are the entire closed set the DAP spec defines
/// for this purpose.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LaunchRequestKind {
    Launch,
    Attach,
}

impl LaunchRequestKind {
    fn as_command(self) -> &'static str {
        match self {
            Self::Launch => "launch",
            Self::Attach => "attach",
        }
    }
}

/// Everything [`run_handshake`] needs beyond the [`DebugSession`] itself.
pub(crate) struct HandshakeConfig {
    /// Becomes `initialize`'s `arguments.adapterID` — the adapter-config
    /// `type` string identifying which configured adapter this is, per
    /// `docs/research/2026-07-28-generic-dap.md`'s "决策 1" adapter-config
    /// shape.
    pub(crate) adapter_id: String,
    pub(crate) request: LaunchRequestKind,
    /// Opaque `launch`/`attach` arguments — ADR 0003's "adapter-specific 配置
    /// 透明透传", forwarded verbatim.
    pub(crate) arguments: Value,
    /// Zero or more `setBreakpoints` requests to send during configuration,
    /// each awaited in turn before `configurationDone` — see the module doc.
    pub(crate) breakpoints: Vec<SourceBreakpoints>,
    /// `F100` S5 — the bound applied to every handshake step *other than*
    /// `launch`/`attach`'s own response (`initialize`, the `initialized`
    /// event wait, each `setBreakpoints`, `configurationDone`). The real
    /// production caller (`super::service::DebugSessionService::start_session`)
    /// always passes [`DEBUG_REQUEST_TIMEOUT`]; `session::tests` passes small
    /// values directly to exercise the real classification logic without
    /// waiting out real production durations — see the module doc's "`F100`
    /// S5" section.
    pub(crate) request_timeout: Duration,
    /// `F100` S5 — the (deliberately much longer) bound applied only to
    /// awaiting `launch`/`attach`'s own response, per the module doc's
    /// "`F100` S5" section. The real production caller always passes
    /// [`DEBUG_LAUNCH_TIMEOUT`].
    pub(crate) launch_timeout: Duration,
}

/// Runs the full handshake this module exists to get right — see the module
/// doc's "handshake ordering" section. Returns the negotiated
/// [`Capabilities`] once `launch`/`attach` has actually succeeded (the
/// session is considered ready only at that point, matching the spec's own
/// "after `configurationDone` response, the adapter responds to `launch` or
/// `attach`, starting the session").
pub(crate) fn run_handshake(
    session: &DebugSession,
    config: HandshakeConfig,
) -> Result<Capabilities, CommandError> {
    let initialize_arguments = json!({
        "clientID": "plain",
        "clientName": "Plain",
        "adapterID": config.adapter_id,
        "pathFormat": "path",
        "linesStartAt1": true,
        "columnsStartAt1": true,
        "supportsRunInTerminalRequest": true,
        "locale": "en-US",
    });
    let initialize_pending = session.send_request("initialize", Some(initialize_arguments))?;
    let initialize_response = session.wait_for_response_with_timeout(
        initialize_pending,
        config.request_timeout,
        "initialize",
    )?;
    if !initialize_response.success {
        return Err(debug_handshake_failed(
            "initialize",
            initialize_response.message.as_deref(),
        ));
    }
    let capabilities = Capabilities::from_body(initialize_response.body);
    session.store_capabilities(capabilities.clone());

    // Sent, deliberately not awaited yet — see the module doc.
    let launch_command = config.request.as_command();
    let launch_pending = session.send_request(launch_command, Some(config.arguments))?;

    session.wait_for_initialized(config.request_timeout)?;

    for breakpoints in config.breakpoints {
        let pending = session.send_request("setBreakpoints", Some(breakpoints.arguments))?;
        let response = session.wait_for_response_with_timeout(
            pending,
            config.request_timeout,
            "setBreakpoints",
        )?;
        if !response.success {
            return Err(debug_handshake_failed(
                "setBreakpoints",
                response.message.as_deref(),
            ));
        }
    }

    let configuration_done_pending = session.send_request("configurationDone", None)?;
    let configuration_done_response = session.wait_for_response_with_timeout(
        configuration_done_pending,
        config.request_timeout,
        "configurationDone",
    )?;
    if !configuration_done_response.success {
        return Err(debug_handshake_failed(
            "configurationDone",
            configuration_done_response.message.as_deref(),
        ));
    }

    // Only now do we await `launch`/`attach`'s own response — it may
    // already be sitting in the channel (the real adapter behavior the
    // module doc describes), or it may arrive after this call starts
    // blocking; either way this is the exact same blocking receive, just
    // with the deliberately generous `launch_timeout` budget rather than
    // `request_timeout` — see the module doc's "`F100` S5" section.
    let launch_response = session.wait_for_response_with_timeout(
        launch_pending,
        config.launch_timeout,
        launch_command,
    )?;
    if !launch_response.success {
        return Err(debug_handshake_failed(
            launch_command,
            launch_response.message.as_deref(),
        ));
    }

    Ok(capabilities)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests;
