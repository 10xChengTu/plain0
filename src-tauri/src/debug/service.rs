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

use super::confirm::ConfirmationService;
use super::dto::{self, DebugSessionId, SessionTransportRequest};
use super::session::{self, DebugEventSink, DebugSession, HandshakeConfig, LaunchRequestKind};
use super::{debug_session_not_found, debug_transport_unavailable};

/// Rust-authoritative live-session table, `.manage()`d exactly once by
/// `lib.rs`. See the module doc for the overall shape.
pub struct DebugSessionService {
    state: Arc<DebugSessionState>,
}

struct DebugSessionState {
    windows: Mutex<HashMap<String, HashMap<DebugSessionId, Arc<DebugSession>>>>,
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
    /// [`super::exec::spawn_adapter`]/[`super::tcp::connect_adapter`] — both
    /// already trust-then-confirmation-gated; this function never bypasses
    /// either), starts a [`DebugSession`] over it, and runs the full
    /// handshake — returning the session id and negotiated capabilities only
    /// once `launch`/`attach` has actually succeeded. On any handshake
    /// failure the session is torn down and its reader thread joined before
    /// the error is returned — a caller never has to separately clean up a
    /// session that failed to become ready.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_session(
        &self,
        trust: &TrustService,
        workspace: &WorkspaceService,
        window_label: &str,
        confirmation: &ConfirmationService,
        request: LaunchRequestKind,
        transport: SessionTransportRequest,
        adapter_id: String,
        arguments: Value,
        breakpoints: Vec<session::SourceBreakpoints>,
        sink: Arc<dyn DebugEventSink>,
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
        };

        let session_id = DebugSessionId::new();
        let debug_session = DebugSession::start(session_id, reader, writer, sink, teardown);

        let handshake_session = Arc::clone(&debug_session);
        let handshake_config = HandshakeConfig {
            adapter_id,
            request,
            arguments,
            breakpoints,
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
            windows
                .entry(window_label.to_owned())
                .or_default()
                .insert(session_id, debug_session);
        }

        Ok((session_id, capabilities.as_value()))
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
                .map(|table| table.into_values().collect())
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
