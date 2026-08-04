//! Per-window live debug session table (`F100` S2) — mirrors
//! `terminal::service::TerminalService`'s exact shape (a `Mutex<HashMap<window
//! label, HashMap<session id, Arc<session>>>>`, the same `close_window`
//! contract) for the same reason: a debug session, like a PTY session, is a
//! long-lived, spawned-once thing that outlives any single Tauri command
//! call, not a one-shot "run to completion" operation like `git::exec::run_git`.
//!
//! [`DebugSessionService::start_session`] is where this domain's two
//! previously-uncalled entry points — [`super::exec::spawn_adapter`] (stdio)
//! and [`super::tcp::connect_adapter`] (TCP) — finally get a real production
//! caller: it resolves a [`super::dto::SessionTransportRequest`] into
//! whichever one applies, assembles the resulting reader/writer/teardown
//! triple [`super::session::DebugSession::start`] needs, and runs
//! [`super::session::run_handshake`] before ever handing the session id back
//! to the caller — a `debug_launch`/`debug_attach` response only ever names a
//! session that has *already* completed its handshake, never a half-started
//! one still waiting on `initialized`.
//!
//! See `super::mod`'s own module doc for this slice's concrete,
//! already-decided answer to S1's open "does TCP compose with spawning"
//! question (connect-only, with a recorded reason and a recommendation for a
//! follow-up) — this module's TCP branch is deliberately connect-only,
//! matching that decision.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;

use serde_json::Value;

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

use super::confirm::ConfirmationService;
use super::dto::{self, DebugSessionId, SessionTransportRequest};
use super::session::{
    self, DebugEventSink, DebugSession, HandshakeConfig, LaunchRequestKind, ReverseRequestHandler,
};
use super::{debug_request_failed, debug_session_not_found, debug_transport_unavailable};

/// Rust-authoritative live-session table, `.manage()`d exactly once by
/// `lib.rs`. See the module doc for the overall shape.
pub struct DebugSessionService {
    state: Arc<DebugSessionState>,
}

struct DebugSessionState {
    windows: Mutex<HashMap<String, HashMap<DebugSessionId, DebugSessionRecord>>>,
}

struct DebugSessionRecord {
    root_id: RootId,
    session: Arc<DebugSession>,
}

impl Default for DebugSessionService {
    fn default() -> Self {
        Self {
            state: Arc::new(DebugSessionState {
                windows: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl DebugSessionService {
    pub fn new() -> Self {
        Self::default()
    }

    /// Resolves `transport` into a live, connected transport (via
    /// [`super::exec::spawn_adapter`]/[`super::tcp::connect_adapter`]/`F210`
    /// S6's own [`super::exec::spawn_adapter_as_tcp_companion`] +
    /// [`super::tcp::connect_loopback_companion_with_retry_sync`] pair —
    /// every one already trust-then-confirmation-gated; this function never
    /// bypasses any of them), starts a [`DebugSession`] over it, and runs the
    /// full handshake — returning the session id and negotiated capabilities
    /// only once `launch`/`attach` has actually succeeded. On any handshake
    /// failure the session is torn down and its reader thread joined before
    /// the error is returned — a caller never has to separately clean up a
    /// session that failed to become ready. `reverse_requests` (`F100` S4) is
    /// installed via [`DebugSession::start_with_reverse_requests`] rather
    /// than the plain [`DebugSession::start`] every prior slice used — see
    /// that method's own doc comment.
    ///
    /// Thin wrapper over [`Self::start_session_with_tcp_spawn_budget`],
    /// always passing the real production
    /// [`super::tcp::DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT`] budget for a
    /// `TcpSpawn`-transport request — see that method's own doc comment for
    /// why the budget is a parameter at all.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_session(
        &self,
        trust: &TrustService,
        workspace: &WorkspaceService,
        window_label: &str,
        root_id: RootId,
        confirmation: &ConfirmationService,
        request: LaunchRequestKind,
        transport: SessionTransportRequest,
        adapter_id: String,
        arguments: Value,
        breakpoints: Vec<session::SourceBreakpoints>,
        sink: Arc<dyn DebugEventSink>,
        reverse_requests: Arc<dyn ReverseRequestHandler>,
    ) -> Result<(DebugSessionId, Value), CommandError> {
        self.start_session_with_tcp_spawn_budget(
            trust,
            workspace,
            window_label,
            root_id,
            confirmation,
            request,
            transport,
            adapter_id,
            arguments,
            breakpoints,
            sink,
            reverse_requests,
            super::tcp::DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT,
        )
        .await
    }

    /// `F210` S6 — test-only twin of [`Self::start_session`] that lets
    /// `service::tests` inject a small `tcp_spawn_connect_budget` for a
    /// `TcpSpawn`-transport request, so a "the connect budget is exhausted"
    /// integration test can prove the real, production `TcpSpawn` orchestration
    /// (including the real spawned-process kill on failure) without actually
    /// waiting out the real 5-second production budget — the identical
    /// injected-small-value-for-testability rationale
    /// [`Self::send_request_with_timeout_for_test`] already documents for
    /// itself. Every non-test caller only ever reaches the underlying
    /// implementation through [`Self::start_session`], which always passes
    /// the one named production constant; this has no production caller.
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn start_session_with_tcp_spawn_budget_for_test(
        &self,
        trust: &TrustService,
        workspace: &WorkspaceService,
        window_label: &str,
        root_id: RootId,
        confirmation: &ConfirmationService,
        request: LaunchRequestKind,
        transport: SessionTransportRequest,
        adapter_id: String,
        arguments: Value,
        breakpoints: Vec<session::SourceBreakpoints>,
        sink: Arc<dyn DebugEventSink>,
        reverse_requests: Arc<dyn ReverseRequestHandler>,
        tcp_spawn_connect_budget: std::time::Duration,
    ) -> Result<(DebugSessionId, Value), CommandError> {
        self.start_session_with_tcp_spawn_budget(
            trust,
            workspace,
            window_label,
            root_id,
            confirmation,
            request,
            transport,
            adapter_id,
            arguments,
            breakpoints,
            sink,
            reverse_requests,
            tcp_spawn_connect_budget,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn start_session_with_tcp_spawn_budget(
        &self,
        trust: &TrustService,
        workspace: &WorkspaceService,
        window_label: &str,
        root_id: RootId,
        confirmation: &ConfirmationService,
        request: LaunchRequestKind,
        transport: SessionTransportRequest,
        adapter_id: String,
        arguments: Value,
        breakpoints: Vec<session::SourceBreakpoints>,
        sink: Arc<dyn DebugEventSink>,
        reverse_requests: Arc<dyn ReverseRequestHandler>,
        tcp_spawn_connect_budget: std::time::Duration,
    ) -> Result<(DebugSessionId, Value), CommandError> {
        let cancel = Arc::new(AtomicBool::new(false));
        let (reader, writer, teardown) = match transport {
            SessionTransportRequest::Stdio { command, args } => {
                let descriptor = dto::AdapterSpawnDescriptor { command, args };
                let handle = Arc::new(
                    super::exec::spawn_adapter(
                        trust,
                        workspace,
                        window_label,
                        root_id,
                        confirmation,
                        &descriptor,
                        Arc::clone(&cancel),
                    )
                    .await?,
                );
                let (stdin, stdout) = handle.take_io().ok_or_else(debug_transport_unavailable)?;
                let teardown_handle = Arc::clone(&handle);
                let reader: Box<dyn Read + Send> = Box::new(stdout);
                let writer: Box<dyn Write + Send> = Box::new(stdin);
                let teardown: Box<dyn Fn() + Send + Sync> =
                    Box::new(move || teardown_handle.kill());
                (reader, writer, teardown)
            }
            SessionTransportRequest::Tcp {
                command,
                args,
                host,
                port,
            } => {
                let descriptor = dto::AdapterSpawnDescriptor { command, args };
                let tcp_descriptor = dto::TcpConnectDescriptor { host, port };
                let stream = super::tcp::connect_adapter(
                    trust,
                    workspace,
                    window_label,
                    root_id,
                    confirmation,
                    &descriptor,
                    &tcp_descriptor,
                    Arc::clone(&cancel),
                )
                .await?;
                let writer_stream = stream
                    .try_clone()
                    .map_err(|_| debug_transport_unavailable())?;
                let teardown_stream = stream
                    .try_clone()
                    .map_err(|_| debug_transport_unavailable())?;
                let reader: Box<dyn Read + Send> = Box::new(stream);
                let writer: Box<dyn Write + Send> = Box::new(writer_stream);
                let teardown: Box<dyn Fn() + Send + Sync> = Box::new(move || {
                    let _ = teardown_stream.shutdown(std::net::Shutdown::Both);
                });
                (reader, writer, teardown)
            }
            SessionTransportRequest::TcpSpawn {
                command,
                args,
                port,
            } => {
                // `F210` S6 — confirm (as `Tcp`, per `exec::spawn_adapter_as_tcp_companion`'s
                // own doc comment) → spawn the companion (reusing the same
                // 200ms early-crash grace `spawn_adapter`/`spawn_adapter_sync`
                // already give every spawn) → bounded, backing-off retry
                // connect to the fixed loopback port it is expected to open.
                // Any failure past the spawn step kills the already-spawned
                // process before this match arm returns — see `debug::mod`'s
                // own module doc for the full composition.
                let descriptor = dto::AdapterSpawnDescriptor { command, args };
                let handle = Arc::new(
                    super::exec::spawn_adapter_as_tcp_companion(
                        trust,
                        workspace,
                        window_label,
                        root_id,
                        confirmation,
                        &descriptor,
                        Arc::clone(&cancel),
                    )
                    .await?,
                );
                let probe_handle = Arc::clone(&handle);
                let connect_cancel = Arc::clone(&cancel);
                let connect_result = tauri::async_runtime::spawn_blocking(move || {
                    super::tcp::connect_loopback_companion_with_retry_sync(
                        port,
                        tcp_spawn_connect_budget,
                        move || probe_handle.probe_exit_code(),
                        &connect_cancel,
                    )
                })
                .await
                .map_err(|_| debug_transport_unavailable())?;
                let stream = match connect_result {
                    Ok(stream) => stream,
                    Err(error) => {
                        // The connect budget ran out or the companion exited
                        // mid-retry — either way, nothing must survive this
                        // failed session start: kill the still-spawned (or
                        // already-exited, harmlessly re-killed) process
                        // before propagating the error.
                        handle.kill();
                        return Err(error);
                    }
                };
                let writer_stream = stream
                    .try_clone()
                    .map_err(|_| debug_transport_unavailable())?;
                let teardown_stream = stream
                    .try_clone()
                    .map_err(|_| debug_transport_unavailable())?;
                let teardown_handle = Arc::clone(&handle);
                let reader: Box<dyn Read + Send> = Box::new(stream);
                let writer: Box<dyn Write + Send> = Box::new(writer_stream);
                // Both channels this variant owns are torn down here, in
                // order: shut the TCP stream down first (so the adapter's own
                // blocking read/accept observes the close promptly), then
                // kill+reap the spawned process — never the reverse, and
                // never only one of the two.
                let teardown: Box<dyn Fn() + Send + Sync> = Box::new(move || {
                    let _ = teardown_stream.shutdown(std::net::Shutdown::Both);
                    teardown_handle.kill();
                });
                (reader, writer, teardown)
            }
        };

        let session_id = DebugSessionId::new();
        let debug_session = DebugSession::start_with_reverse_requests(
            session_id,
            reader,
            writer,
            sink,
            teardown,
            reverse_requests,
        );

        let handshake_session = Arc::clone(&debug_session);
        let handshake_config = HandshakeConfig {
            adapter_id,
            request,
            arguments,
            breakpoints,
            request_timeout: session::DEBUG_REQUEST_TIMEOUT,
            launch_timeout: session::DEBUG_LAUNCH_TIMEOUT,
        };
        let handshake_result = tauri::async_runtime::spawn_blocking(move || {
            session::run_handshake(&handshake_session, handshake_config)
        })
        .await
        .map_err(|_| debug_transport_unavailable())?;

        let capabilities = match handshake_result {
            Ok(capabilities) => capabilities,
            Err(error) => {
                debug_session.shutdown();
                debug_session.join_reader();
                return Err(error);
            }
        };

        {
            let mut windows = lock(&self.state.windows);
            windows.entry(window_label.to_owned()).or_default().insert(
                session_id,
                DebugSessionRecord {
                    root_id,
                    session: debug_session,
                },
            );
        }

        Ok((session_id, capabilities.as_value()))
    }

    /// Looks up a still-live session by window + id — the shared lookup
    /// [`Self::send_request`] and [`Self::disconnect`] both need. Returns a
    /// cheap `Arc` clone (never holds the table lock beyond this call), so a
    /// caller may use the returned session freely (including across an
    /// `.await`) without risking a lock-ordering issue against a concurrent
    /// `close_window`/`disconnect`.
    fn session_for(
        &self,
        window_label: &str,
        session_id: DebugSessionId,
    ) -> Result<Arc<DebugSession>, CommandError> {
        lock(&self.state.windows)
            .get(window_label)
            .and_then(|sessions| sessions.get(&session_id))
            .map(|record| Arc::clone(&record.session))
            .ok_or_else(debug_session_not_found)
    }

    fn session_for_root(
        &self,
        window_label: &str,
        session_id: DebugSessionId,
        root_id: RootId,
    ) -> Result<Arc<DebugSession>, CommandError> {
        lock(&self.state.windows)
            .get(window_label)
            .and_then(|sessions| sessions.get(&session_id))
            .filter(|record| record.root_id == root_id)
            .map(|record| Arc::clone(&record.session))
            .ok_or_else(debug_session_not_found)
    }

    /// `F100` S3's generic interactive-request seam — every one of
    /// `debug_set_breakpoints`/`debug_stack_trace`/`debug_scopes`/
    /// `debug_variables`/`debug_evaluate` (`super::commands`) resolves its own
    /// typed DTO into a `(command, arguments)` pair and calls this exactly
    /// once, rather than each reimplementing "look up the session, send,
    /// wait, map failure". `command` is always a literal DAP command name
    /// supplied by this crate's own call sites (never caller-controlled) —
    /// this is *not* a generic "send arbitrary DAP request" escape hatch (see
    /// `debug/mod.rs`'s own module doc for why that distinction matters here,
    /// mirroring `git`'s "no generic `git_run`" principle). Runs the blocking
    /// send/receive on a `spawn_blocking` thread, exactly like
    /// [`Self::start_session`]'s own handshake step, since
    /// [`DebugSession::send_request`]/`wait_for_response` are synchronous.
    /// Maps an adapter `success: false` reply to [`debug_request_failed`],
    /// carrying the adapter's own message if it sent one — the post-handshake
    /// analogue of [`run_handshake`]'s own per-step failure mapping.
    pub async fn send_request(
        &self,
        window_label: &str,
        session_id: DebugSessionId,
        command: &'static str,
        arguments: Value,
    ) -> Result<Value, CommandError> {
        self.send_request_with_timeout(
            window_label,
            session_id,
            command,
            arguments,
            session::DEBUG_REQUEST_TIMEOUT,
        )
        .await
    }

    pub async fn send_request_for_root(
        &self,
        window_label: &str,
        session_id: DebugSessionId,
        root_id: RootId,
        command: &'static str,
        arguments: Value,
    ) -> Result<Value, CommandError> {
        let session = self.session_for_root(window_label, session_id, root_id)?;
        Self::send_request_on_session(session, command, arguments, session::DEBUG_REQUEST_TIMEOUT)
            .await
    }

    /// The shared implementation behind [`Self::send_request`] — factored out
    /// purely so `service::tests` can exercise the exact same production
    /// request/timeout/response-mapping logic with a small, injected timeout
    /// (proving `DEBUG_REQUEST_TIMED_OUT` really does surface end to end
    /// through a real spawned adapter) without waiting out
    /// [`session::DEBUG_REQUEST_TIMEOUT`]'s real 30-second production value —
    /// `#[cfg(test)]`-only callers use this directly; every non-test caller
    /// only ever reaches this through [`Self::send_request`], which always
    /// passes the one named production constant.
    async fn send_request_with_timeout(
        &self,
        window_label: &str,
        session_id: DebugSessionId,
        command: &'static str,
        arguments: Value,
        timeout: std::time::Duration,
    ) -> Result<Value, CommandError> {
        let session = self.session_for(window_label, session_id)?;
        Self::send_request_on_session(session, command, arguments, timeout).await
    }

    async fn send_request_on_session(
        session: Arc<DebugSession>,
        command: &'static str,
        arguments: Value,
        timeout: std::time::Duration,
    ) -> Result<Value, CommandError> {
        let response = tauri::async_runtime::spawn_blocking(move || {
            let pending = session.send_request(command, Some(arguments))?;
            session.wait_for_response_with_timeout(pending, timeout, command)
        })
        .await
        .map_err(|_| debug_transport_unavailable())??;
        if !response.success {
            return Err(debug_request_failed(
                &response.command,
                response.message.as_deref(),
            ));
        }
        Ok(response.body.unwrap_or(Value::Null))
    }

    #[cfg(test)]
    pub(crate) async fn send_request_with_timeout_for_test(
        &self,
        window_label: &str,
        session_id: DebugSessionId,
        command: &'static str,
        arguments: Value,
        timeout: std::time::Duration,
    ) -> Result<Value, CommandError> {
        self.send_request_with_timeout(window_label, session_id, command, arguments, timeout)
            .await
    }

    /// `F100` S5 — acknowledges a gated `output` event (see
    /// [`super::output_gate`]'s own module doc) through `sequence`, forwarding
    /// to [`DebugSession::ack_output`]. Silently a no-op for a session that no
    /// longer exists (already disconnected, or ended on its own) — an ack
    /// racing a session's own natural end is expected, not an error a caller
    /// needs to handle specially, mirroring `terminal_ack`'s own tolerant
    /// precedent for the identical race.
    pub async fn ack_output(&self, window_label: &str, session_id: DebugSessionId, sequence: u64) {
        if let Ok(session) = self.session_for(window_label, session_id) {
            session.ack_output(session_id, sequence);
        }
    }

    /// Tears down a live session and removes it from this window's table.
    /// Blocks until the session's reader thread has fully exited.
    pub async fn disconnect(
        &self,
        window_label: &str,
        session_id: DebugSessionId,
    ) -> Result<(), CommandError> {
        let session = {
            let mut windows = lock(&self.state.windows);
            windows
                .get_mut(window_label)
                .and_then(|sessions| sessions.remove(&session_id))
                .map(|record| record.session)
        }
        .ok_or_else(debug_session_not_found)?;
        tauri::async_runtime::spawn_blocking(move || {
            session.shutdown();
            session.join_reader();
        })
        .await
        .map_err(|_| debug_transport_unavailable())?;
        Ok(())
    }

    /// Tears down every live session belonging to `window_label` and joins
    /// every one of their reader threads before returning — the
    /// `DebugSessionService::close_window` cleanup call `lib.rs` wires
    /// alongside `WorkspaceService`/`BackupService`/`TerminalService`/
    /// `ConfirmationService`'s own `close_window`s. Mirrors
    /// `TerminalService::close_window`'s "one thread per session, bounded by
    /// the slowest session's teardown" shape.
    pub fn close_window(&self, window_label: &str) {
        let sessions: Vec<Arc<DebugSession>> = {
            let mut windows = lock(&self.state.windows);
            windows
                .remove(window_label)
                .map(|table| table.into_values().map(|record| record.session).collect())
                .unwrap_or_default()
        };
        let joiners: Vec<JoinHandle<()>> = sessions
            .into_iter()
            .map(|session| {
                std::thread::spawn(move || {
                    session.shutdown();
                    session.join_reader();
                })
            })
            .collect();
        for joiner in joiners {
            let _ = joiner.join();
        }
    }

    #[cfg(test)]
    pub(crate) fn session_count_for_test(&self, window_label: &str) -> usize {
        lock(&self.state.windows)
            .get(window_label)
            .map_or(0, HashMap::len)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests;
