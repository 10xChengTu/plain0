//! Session lifecycle and host-key trust enforcement — `F220` S1, ADR 0006
//! §§1–5. [`RemoteSessionService`] is `.manage()`d exactly once by `lib.rs`
//! and owns two independent pieces of state per the module layout: the
//! window-scoped live-session table (mirrors `debug::service::DebugSessionService`'s
//! `Mutex<HashMap<window label, HashMap<session id, …>>>` shape) and the
//! domain-wide, staged-atomic-write known-hosts store (mirrors
//! `trust::service::TrustService`'s single-gated-root shape).
//!
//! # Two-phase connect, not a mid-handshake pause
//!
//! An unknown or changed host key cannot be confirmed *during* the live
//! `russh::client::connect` call — there is no way to suspend a live async
//! handshake for a Tauri round trip to the WebView and back. Instead,
//! [`RemoteClientHandler::check_server_key`] always returns `Ok(false)` for
//! anything other than an exact pin match (an unknown host, or a changed
//! one), which aborts that one handshake attempt; the *reason* is recorded
//! into a shared [`HostKeyOutcome`] slot the handler and the caller both hold
//! a reference to, and [`RemoteSessionService::connect`] inspects that slot
//! once `russh::client::connect` returns its (otherwise generic) error to
//! turn it into either a normal [`RemoteSessionConnectResult::HostKeyPendingConfirmation`]
//! result (not an error at all — see that variant's own doc comment) or the
//! hard [`super::remote_host_key_changed`] failure. [`RemoteSessionService::confirm_host_key`]
//! is the second phase: pin the exact `(algorithm, fingerprint)` the caller
//! names, then run the *entire* connect flow again from scratch — a fresh
//! TCP connection and a fresh live handshake, which will only actually
//! authenticate if the server's *live* key still matches what was just
//! pinned (closing the TOCTOU window between "user saw this fingerprint" and
//! "Plain trusts it" as tightly as a second real handshake allows).
//!
//! # Disclosed limitation: a timed-out/cancelled handshake may leave a short-lived background task
//!
//! [`connect_with_agent_socket`] bounds the whole `russh::client::connect`
//! call (TCP connect through host-key check) with [`REMOTE_CONNECT_TIMEOUT`],
//! and races it against an explicit cancellation flag. `russh::client::connect`
//! itself, once past the initial `TcpStream::connect`, hands the socket to an
//! internally spawned background task (`session.run`) that our own timeout/
//! cancellation cannot reach or abort — only the *caller's* wait for that
//! task's own kex-completion signal is what gets abandoned. In the ordinary
//! failure mode (an unreachable/firewalled host), the plain `TcpStream::connect`
//! phase itself fails or times out with zero background task ever spawned, so
//! there is no leak. Only a peer that completes the TCP handshake but then
//! stalls or hangs mid-SSH-protocol — an unusual, non-default failure mode
//! for the loopback/user-named hosts this domain targets — can leave that
//! task running until it independently notices the stream is dead. This
//! mirrors `debug::tcp`'s own disclosed "a single in-flight connect attempt
//! cannot itself be interrupted early" limitation; closing it fully would
//! need `russh::client::connect_stream` reimplemented against a socket this
//! module owns and can forcibly close, which is left to a later slice if it
//! proves necessary in practice.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use russh::client::{Handle, Handler};
use russh::keys::ssh_key::{HashAlg, PublicKey};

use crate::error::CommandError;

use super::agent::authenticate_with_agent;
use super::dto::MAX_REMOTE_SESSIONS_PER_WINDOW;
use super::dto::{
    RemoteConnectTarget, RemoteHostKeyConfirmParts, RemoteHostKeyEntry, RemoteHostKeyListResult,
    RemoteSessionConnectResult, RemoteSessionDisconnectReason, RemoteSessionEventPayload,
    RemoteSessionId, RemoteSessionStateEntry, RemoteSessionStateResult,
};
use super::known_hosts::{self, KnownHostEntry};
use super::{
    remote_connect_cancelled, remote_connect_failed, remote_connect_timed_out,
    remote_host_key_changed, remote_host_key_store_unavailable, remote_session_limit_reached,
    remote_session_not_found,
};

/// Wall-clock ceiling on the TCP-connect-through-host-key-check phase —
/// independent of `agent::REMOTE_AGENT_AUTH_TIMEOUT`'s own budget, per ADR
/// 0006 §5.
pub(crate) const REMOTE_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Sink for `plain://remote-session-event` deliveries — mirrors
/// `debug::session::DebugEventSink`'s identical "small trait so a test can
/// inject a recording fake instead of needing a live Tauri window" shape.
pub(crate) trait RemoteSessionEventSink: Send + Sync {
    fn emit(&self, payload: RemoteSessionEventPayload);
}

/// A no-op sink — used wherever a caller does not need to observe events
/// (most hermetic tests exercise the `Result` each call already returns).
/// Test-only: production always builds a real `commands::RemoteWindowEventSink`.
#[cfg(test)]
pub(crate) struct NullRemoteSessionEventSink;

#[cfg(test)]
impl RemoteSessionEventSink for NullRemoteSessionEventSink {
    fn emit(&self, _payload: RemoteSessionEventPayload) {}
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum HostKeyOutcome {
    PendingConfirmation {
        algorithm: String,
        fingerprint: String,
        known_hosts_hit: bool,
    },
    FingerprintChanged {
        algorithm: String,
        old_fingerprint: String,
        new_fingerprint: String,
    },
}

/// `russh::client::Handler` whose only real job is host-key enforcement — see
/// the module doc's "Two-phase connect" section. Every other `Handler` method
/// keeps its default (harmless) implementation: this domain never opens a
/// channel or exchanges data during connect, so no other callback ever fires
/// in practice during S1's own connect flow.
struct RemoteClientHandler {
    host: String,
    port: u16,
    expected: Option<KnownHostEntry>,
    outcome: Arc<Mutex<Option<HostKeyOutcome>>>,
}

impl Handler for RemoteClientHandler {
    type Error = CommandError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let algorithm = server_public_key.algorithm().to_string();
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        if let Some(pinned) = &self.expected {
            if pinned.algorithm == algorithm && pinned.sha256_fingerprint == fingerprint {
                return Ok(true);
            }
            let mut outcome = lock(&self.outcome);
            *outcome = Some(HostKeyOutcome::FingerprintChanged {
                algorithm,
                old_fingerprint: pinned.sha256_fingerprint.clone(),
                new_fingerprint: fingerprint,
            });
            return Ok(false);
        }
        // ADR 0006 §3: a read-only reference check against the user's own
        // `~/.ssh/known_hosts` — purely informational (`known_hosts_hit`),
        // never written to, and never itself a trust decision. Any failure
        // (no such file, unreadable, host absent) is indistinguishable from
        // "no hit" here — this call can never fail this handshake.
        let known_hosts_hit =
            russh::keys::check_known_hosts(&self.host, self.port, server_public_key)
                .unwrap_or(false);
        let mut outcome = lock(&self.outcome);
        *outcome = Some(HostKeyOutcome::PendingConfirmation {
            algorithm,
            fingerprint,
            known_hosts_hit,
        });
        Ok(false)
    }
}

impl From<russh::Error> for CommandError {
    fn from(error: russh::Error) -> Self {
        CommandError::new("REMOTE_SESSION_TRANSPORT_ERROR", error.to_string())
    }
}

struct RemoteSessionRecord {
    host: String,
    port: u16,
    user: String,
    handle: Handle<RemoteClientHandler>,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct InFlightKey {
    window_label: String,
    host: String,
    port: u16,
}

pub struct RemoteSessionService {
    state: Arc<RemoteSessionState>,
}

struct RemoteSessionState {
    base_path: PathBuf,
    windows: Mutex<HashMap<String, HashMap<RemoteSessionId, RemoteSessionRecord>>>,
    inflight: Mutex<HashMap<InFlightKey, Arc<AtomicBool>>>,
    /// Serializes every known-hosts read-modify-write cycle — mirrors
    /// `trust::service::TrustState::gate`'s identical rationale (plain reads
    /// do not take this gate; the staged-atomic-write publish already
    /// guarantees a concurrent reader only ever observes a fully-written old
    /// or new file).
    known_hosts_gate: Mutex<()>,
    known_hosts_root: Mutex<Option<Dir>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl RemoteSessionService {
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(RemoteSessionState {
                base_path,
                windows: Mutex::new(HashMap::new()),
                inflight: Mutex::new(HashMap::new()),
                known_hosts_gate: Mutex::new(()),
                known_hosts_root: Mutex::new(None),
            }),
        }
    }

    /// Resolves the real production agent socket path from `SSH_AUTH_SOCK`
    /// — the *only* place in this crate that reads this environment
    /// variable for the SSH agent's own address (the terminal domain also
    /// reads it, but only to pass it through unexamined to a spawned shell —
    /// see `terminal::mod`'s own env-passthrough allowlist). Kept as its own
    /// tiny function so every real command entry point resolves it exactly
    /// once, the same place, rather than each reaching for `std::env::var`
    /// independently.
    pub(crate) fn resolve_agent_socket_path() -> Result<PathBuf, CommandError> {
        std::env::var_os("SSH_AUTH_SOCK")
            .map(PathBuf::from)
            .ok_or_else(super::remote_agent_unavailable)
    }

    /// First phase of a connect: a fresh TCP+SSH handshake against whatever
    /// the known-hosts store currently has pinned for `(host, port)` (or
    /// nothing, for a never-seen host). See the module doc for the full
    /// two-phase design.
    pub(crate) async fn connect(
        &self,
        window_label: &str,
        target: RemoteConnectTarget,
        agent_socket_path: &Path,
        sink: &dyn RemoteSessionEventSink,
    ) -> Result<RemoteSessionConnectResult, CommandError> {
        self.session_capacity_gate(window_label)?;
        let pinned = self.lookup_host_key(&target.host, target.port).await?;
        self.connect_with_expected(
            window_label,
            target,
            pinned,
            agent_socket_path,
            sink,
            REMOTE_CONNECT_TIMEOUT,
        )
        .await
    }

    /// Test-only twin of [`Self::connect`] that lets `session::tests` inject
    /// a small `connect_timeout` for a "the connect budget is genuinely
    /// exhausted" scenario, so that test does not need to wait out the real
    /// 10-second production budget — the identical injected-small-value-for-
    /// testability rationale `debug::service::DebugSessionService`'s own
    /// `start_session_with_tcp_spawn_budget` documents for itself. No
    /// non-test caller ever reaches this; [`Self::connect`] always passes
    /// the one named production constant.
    #[cfg(test)]
    pub(crate) async fn connect_for_test_with_timeout(
        &self,
        window_label: &str,
        target: RemoteConnectTarget,
        agent_socket_path: &Path,
        sink: &dyn RemoteSessionEventSink,
        connect_timeout: Duration,
    ) -> Result<RemoteSessionConnectResult, CommandError> {
        self.session_capacity_gate(window_label)?;
        let pinned = self.lookup_host_key(&target.host, target.port).await?;
        self.connect_with_expected(
            window_label,
            target,
            pinned,
            agent_socket_path,
            sink,
            connect_timeout,
        )
        .await
    }

    /// Second phase: pins the caller-confirmed `(algorithm, fingerprint)`
    /// then immediately re-runs the full connect flow — see the module doc.
    /// The result is a real [`RemoteSessionConnectResult::HostKeyPendingConfirmation`]
    /// only in the (benign, if surprising) race where the live server key
    /// changed again between the first pending response and this call — it
    /// can never be silently swallowed into a `Connected` result it does not
    /// deserve, because [`RemoteClientHandler::check_server_key`] always
    /// re-validates against whatever is actually pinned, freshly read, not
    /// against anything cached from the first attempt.
    pub(crate) async fn confirm_host_key(
        &self,
        window_label: &str,
        parts: RemoteHostKeyConfirmParts,
        agent_socket_path: &Path,
        sink: &dyn RemoteSessionEventSink,
    ) -> Result<RemoteSessionConnectResult, CommandError> {
        self.session_capacity_gate(window_label)?;
        self.pin_host_key(
            &parts.target.host,
            parts.target.port,
            &parts.algorithm,
            &parts.sha256_fingerprint,
        )
        .await?;
        let pinned = self
            .lookup_host_key(&parts.target.host, parts.target.port)
            .await?;
        self.connect_with_expected(
            window_label,
            parts.target,
            pinned,
            agent_socket_path,
            sink,
            REMOTE_CONNECT_TIMEOUT,
        )
        .await
    }

    fn session_capacity_gate(&self, window_label: &str) -> Result<(), CommandError> {
        let windows = lock(&self.state.windows);
        let count = windows.get(window_label).map_or(0, HashMap::len);
        if count >= MAX_REMOTE_SESSIONS_PER_WINDOW {
            return Err(remote_session_limit_reached());
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn connect_with_expected(
        &self,
        window_label: &str,
        target: RemoteConnectTarget,
        expected: Option<KnownHostEntry>,
        agent_socket_path: &Path,
        sink: &dyn RemoteSessionEventSink,
        connect_timeout: Duration,
    ) -> Result<RemoteSessionConnectResult, CommandError> {
        let key = InFlightKey {
            window_label: window_label.to_owned(),
            host: target.host.clone(),
            port: target.port,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&self.state.inflight).insert(key.clone(), Arc::clone(&cancel));

        let result = self
            .connect_with_expected_inner(
                window_label,
                target,
                expected,
                agent_socket_path,
                &cancel,
                sink,
                connect_timeout,
            )
            .await;

        lock(&self.state.inflight).remove(&key);
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn connect_with_expected_inner(
        &self,
        window_label: &str,
        target: RemoteConnectTarget,
        expected: Option<KnownHostEntry>,
        agent_socket_path: &Path,
        cancel: &AtomicBool,
        sink: &dyn RemoteSessionEventSink,
        connect_timeout: Duration,
    ) -> Result<RemoteSessionConnectResult, CommandError> {
        let outcome: Arc<Mutex<Option<HostKeyOutcome>>> = Arc::new(Mutex::new(None));
        let handler = RemoteClientHandler {
            host: target.host.clone(),
            port: target.port,
            expected,
            outcome: Arc::clone(&outcome),
        };
        let config = Arc::new(russh::client::Config::default());
        let address = (target.host.as_str(), target.port);

        let attempt = tokio::select! {
            biased;
            () = wait_for_cancel(cancel) => Err(ConnectAttemptFailure::Cancelled),
            timed = tokio::time::timeout(connect_timeout, russh::client::connect(config, address, handler)) => {
                match timed {
                    Ok(Ok(handle)) => Ok(handle),
                    Ok(Err(_)) => Err(ConnectAttemptFailure::HandshakeFailed),
                    Err(_) => Err(ConnectAttemptFailure::TimedOut),
                }
            }
        };

        let mut handle = match attempt {
            Ok(handle) => handle,
            Err(ConnectAttemptFailure::Cancelled) => return Err(remote_connect_cancelled()),
            Err(ConnectAttemptFailure::TimedOut) => return Err(remote_connect_timed_out()),
            Err(ConnectAttemptFailure::HandshakeFailed) => {
                let recorded = lock(&outcome).clone();
                return match recorded {
                    Some(HostKeyOutcome::PendingConfirmation {
                        algorithm,
                        fingerprint,
                        known_hosts_hit,
                    }) => Ok(RemoteSessionConnectResult::HostKeyPendingConfirmation {
                        algorithm,
                        sha256_fingerprint: fingerprint,
                        known_hosts_hit,
                    }),
                    Some(HostKeyOutcome::FingerprintChanged {
                        algorithm,
                        old_fingerprint,
                        new_fingerprint,
                    }) => Err(remote_host_key_changed(
                        &target.host,
                        target.port,
                        &algorithm,
                        &old_fingerprint,
                        &new_fingerprint,
                    )),
                    None => Err(remote_connect_failed()),
                };
            }
        };

        // Unlike the TCP+handshake phase above, a failure here already
        // carries its own specific, correctly-coded `CommandError` (agent
        // unavailable/no identities/rejected/timed out — see `agent`'s own
        // module doc) — this phase never needs `ConnectAttemptFailure`'s own
        // generic mapping, it only adds cancellation as a third possible
        // outcome alongside `authenticate_with_agent`'s own `Ok`/`Err`.
        let auth_result: Result<(), CommandError> = tokio::select! {
            biased;
            () = wait_for_cancel(cancel) => Err(remote_connect_cancelled()),
            result = authenticate_with_agent(&mut handle, agent_socket_path, &target.user) => result,
        };
        if let Err(error) = auth_result {
            shut_down(handle).await;
            return Err(error);
        }

        let session_id = RemoteSessionId::new();
        let record = RemoteSessionRecord {
            host: target.host.clone(),
            port: target.port,
            user: target.user.clone(),
            handle,
        };
        lock(&self.state.windows)
            .entry(window_label.to_owned())
            .or_default()
            .insert(session_id, record);

        sink.emit(RemoteSessionEventPayload::Connected {
            session_id,
            host: target.host,
            port: target.port,
            user: target.user,
        });

        Ok(RemoteSessionConnectResult::Connected { session_id })
    }

    pub(crate) async fn disconnect(
        &self,
        window_label: &str,
        session_id: RemoteSessionId,
        sink: &dyn RemoteSessionEventSink,
    ) -> Result<(), CommandError> {
        let record = {
            let mut windows = lock(&self.state.windows);
            windows
                .get_mut(window_label)
                .and_then(|sessions| sessions.remove(&session_id))
        }
        .ok_or_else(remote_session_not_found)?;
        let host = record.host.clone();
        let port = record.port;
        let user = record.user.clone();
        shut_down(record.handle).await;
        sink.emit(RemoteSessionEventPayload::Disconnected {
            session_id,
            host,
            port,
            user,
            reason: RemoteSessionDisconnectReason::UserRequested,
        });
        Ok(())
    }

    pub(crate) fn state(&self, window_label: &str) -> RemoteSessionStateResult {
        let windows = lock(&self.state.windows);
        let mut sessions: Vec<RemoteSessionStateEntry> = windows
            .get(window_label)
            .map(|table| {
                table
                    .iter()
                    .map(|(session_id, record)| RemoteSessionStateEntry {
                        session_id: *session_id,
                        host: record.host.clone(),
                        port: record.port,
                        user: record.user.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        sessions.sort_by(|left, right| {
            (left.host.as_str(), left.port, left.user.as_str()).cmp(&(
                right.host.as_str(),
                right.port,
                right.user.as_str(),
            ))
        });
        RemoteSessionStateResult { sessions }
    }

    /// Best-effort: flips the cancel flag for whatever connect attempt is
    /// currently in flight for this exact `(window, host, port)` — a no-op
    /// if none is. Never itself resolves the in-flight call.
    pub(crate) fn request_cancel_connect(&self, window_label: &str, host: &str, port: u16) {
        let key = InFlightKey {
            window_label: window_label.to_owned(),
            host: host.to_owned(),
            port,
        };
        if let Some(flag) = lock(&self.state.inflight).get(&key) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// Drops every live session belonging to `window_label` (closing their
    /// SSH connections — see the module doc: closing is simply dropping the
    /// `Handle`, no thread/join needed) and forgets any in-flight-connect
    /// bookkeeping for it. Synchronous: called directly from `lib.rs`'s
    /// `WindowEvent::Destroyed` hook, which has no async context to await
    /// from — the same constraint every other domain's own `close_window`
    /// already accepts.
    pub fn close_window(&self, window_label: &str) {
        lock(&self.state.windows).remove(window_label);
        lock(&self.state.inflight).retain(|key, _| key.window_label != window_label);
    }

    async fn lookup_host_key(
        &self,
        host: &str,
        port: u16,
    ) -> Result<Option<KnownHostEntry>, CommandError> {
        let state = Arc::clone(&self.state);
        let host = host.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let dir = ensure_known_hosts_root(&state)?;
            Ok(known_hosts::read_known_hosts(&dir)
                .get(&(host, port))
                .cloned())
        })
        .await
        .map_err(|_| remote_host_key_store_unavailable())?
    }

    async fn pin_host_key(
        &self,
        host: &str,
        port: u16,
        algorithm: &str,
        sha256_fingerprint: &str,
    ) -> Result<(), CommandError> {
        let state = Arc::clone(&self.state);
        let host = host.to_owned();
        let algorithm = algorithm.to_owned();
        let sha256_fingerprint = sha256_fingerprint.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.known_hosts_gate);
            let dir = ensure_known_hosts_root(&state)?;
            let mut entries = known_hosts::read_known_hosts(&dir);
            entries.insert(
                (host.clone(), port),
                KnownHostEntry {
                    host,
                    port,
                    algorithm,
                    sha256_fingerprint,
                },
            );
            known_hosts::write_known_hosts(&dir, &entries)
        })
        .await
        .map_err(|_| remote_host_key_store_unavailable())?
    }

    /// Deletes a pinned entry — idempotent, mirrors `backup::store::discard_entry`.
    pub(crate) async fn forget_host_key(&self, host: &str, port: u16) -> Result<(), CommandError> {
        let state = Arc::clone(&self.state);
        let host = host.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.known_hosts_gate);
            let dir = ensure_known_hosts_root(&state)?;
            let mut entries = known_hosts::read_known_hosts(&dir);
            entries.remove(&(host, port));
            known_hosts::write_known_hosts(&dir, &entries)
        })
        .await
        .map_err(|_| remote_host_key_store_unavailable())?
    }

    pub(crate) async fn list_host_keys(&self) -> Result<RemoteHostKeyListResult, CommandError> {
        let state = Arc::clone(&self.state);
        let entries = tauri::async_runtime::spawn_blocking(move || {
            let dir = ensure_known_hosts_root(&state)?;
            Ok::<_, CommandError>(known_hosts::read_known_hosts(&dir))
        })
        .await
        .map_err(|_| remote_host_key_store_unavailable())??;
        Ok(RemoteHostKeyListResult {
            entries: entries
                .into_values()
                .map(|entry| RemoteHostKeyEntry {
                    host: entry.host,
                    port: entry.port,
                    algorithm: entry.algorithm,
                    sha256_fingerprint: entry.sha256_fingerprint,
                })
                .collect(),
        })
    }

    #[cfg(test)]
    pub(crate) fn session_count_for_test(&self, window_label: &str) -> usize {
        lock(&self.state.windows)
            .get(window_label)
            .map_or(0, HashMap::len)
    }
}

/// The sole ambient directory open for the whole known-hosts store: created
/// (if missing) and opened once, then cached — identical pattern to
/// `trust::service::TrustState::ensure_root`.
fn ensure_known_hosts_root(state: &RemoteSessionState) -> Result<Dir, CommandError> {
    let mut root = lock(&state.known_hosts_root);
    if let Some(dir) = root.as_ref() {
        return dir
            .try_clone()
            .map_err(|_| remote_host_key_store_unavailable());
    }
    let remote_path = state.base_path.join("remote");
    ensure_directory_ambiently(&remote_path).map_err(|_| remote_host_key_store_unavailable())?;
    let dir = Dir::open_ambient_dir(&remote_path, ambient_authority())
        .map_err(|_| remote_host_key_store_unavailable())?;
    let clone = dir
        .try_clone()
        .map_err(|_| remote_host_key_store_unavailable())?;
    *root = Some(dir);
    Ok(clone)
}

/// Creates `path`, and any missing ancestor, one level at a time — the exact
/// duplicate of `trust::service::ensure_directory_ambiently`/
/// `backup::service::ensure_directory_ambiently` (see either's own doc
/// comment for why this small a helper is not factored into a shared one).
fn ensure_directory_ambiently(path: &std::path::Path) -> std::io::Result<()> {
    match std::fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| std::io::Error::from(error.kind()))?;
            ensure_directory_ambiently(parent)?;
            match std::fs::create_dir(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(error) => Err(error),
            }
        }
        Err(error) => Err(error),
    }
}

enum ConnectAttemptFailure {
    Cancelled,
    TimedOut,
    HandshakeFailed,
}

async fn wait_for_cancel(flag: &AtomicBool) {
    loop {
        if flag.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(CANCEL_POLL_INTERVAL).await;
    }
}

/// Best-effort graceful shutdown: sends a real SSH disconnect message, then
/// drops the handle (which drops its `Msg` sender, causing the background
/// session task to notice, exit, and close the underlying socket — see the
/// module doc). A failure to send the disconnect message is not itself an
/// error this function reports — the handle is dropped either way, which
/// alone is sufficient to close the connection.
async fn shut_down(handle: Handle<RemoteClientHandler>) {
    let _ = handle
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;
}

#[cfg(test)]
mod tests;
