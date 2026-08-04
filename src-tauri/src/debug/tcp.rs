//! `debug` domain TCP transport (`F100` S1) — "Plain 主动连出去"
//! (`docs/research/2026-07-28-generic-dap.md`'s "主导会话裁定" item 3):
//! [`connect_adapter`]/[`connect_adapter_sync`] are the TCP-transport
//! counterpart of [`super::exec`]'s `spawn_adapter`/`spawn_adapter_sync`,
//! sharing the identical trust/root/confirmation gate but performing a
//! `TcpStream::connect` instead of a `Command::spawn`.
//!
//! # Why "connect out" only, never "listen and accept"
//!
//! ADR 0003 says DAP transport is "stdio/TCP" without specifying direction.
//! The frozen research doc's "主导会话裁定" item 3 settles it: v1 implements
//! only the direction where *Plain* decides to open a connection to a
//! `host:port` a trusted, confirmed adapter configuration names — never a
//! mode where Plain listens on a local port and accepts whatever process
//! happens to connect to it. A listening, unauthenticated local socket is a
//! **strictly weaker** trust boundary than either spawning a named executable
//! or connecting out to a named address: any other local process could
//! connect to it and pretend to be the debug adapter, silently taking over
//! the session. Connecting out, by contrast, is bound to a specific
//! `host:port` the user's own (trusted, confirmed) configuration named, the
//! same "we picked this target, not an anonymous caller" property spawning a
//! named executable already has.
//!
//! # Same trust/root/confirmation gate as `spawn_adapter`
//!
//! "对任意 host:port 说 DAP" 和 "spawn 任意程序" 是同等级的信任委托 — connecting
//! out is not a lesser privilege than spawning just because it skips
//! `Command::new`. [`connect_adapter`] therefore calls
//! `TrustService::require_trusted` first, validates the selected `root_id`
//! second, then calls `ConfirmationService::require_confirmed`, exactly
//! mirroring [`super::exec::spawn_adapter`]'s four-statement prefix —
//! `scripts/plain/boundary-contracts.mjs`'s `validateDebugAdapterConnectBoundary`
//! mechanically locks this ordering, the connect-side sibling of
//! `validateDebugAdapterSpawnBoundary`.
//!
//! # The confirmation subject still carries `command`/`args`, even though this function never spawns them
//!
//! [`connect_adapter`] takes both a [`super::dto::AdapterSpawnDescriptor`]
//! (`command`/`args` — identifying *which configured adapter* this connection
//! is for) and a [`super::dto::TcpConnectDescriptor`] (`host`/`port` — *where*
//! to connect). Per the adapter-config format's own shape
//! (`docs/research/2026-07-28-generic-dap.md`'s "决策 1"), a `"tcp"`-transport
//! registry entry always carries `command`/`args` alongside `host`/`port`
//! precisely because the common real-world shape is "Plain spawns the
//! configured command (which brings up a TCP-listening adapter, e.g.
//! `debugpy.adapter --port N`), then connects to the port it opened" — this
//! slice's confirmation dialog shows the *full* command line the user is
//! trusting, matching that real shape. **Actually sequencing "spawn, then
//! connect" is explicitly out of scope for this slice** (S2's session
//! lifecycle orchestrates that); [`connect_adapter`] only proves the
//! confirmation-gated *connect* half in isolation — a disclosed narrowing,
//! not an oversight. A "connect only, adapter already running externally"
//! configuration (no local spawn at all) is equally well served by this same
//! primitive: nothing here requires the command to have actually been
//! spawned by Plain.
//!
//! # Why `std::net::TcpStream`, no new dependency
//!
//! The standard library's blocking TCP client is sufficient — this domain
//! does not need non-blocking I/O or an async runtime's own socket type for a
//! one-shot connect performed inside `spawn_blocking`, exactly mirroring
//! `exec.rs`'s own "no new spawn-related dependency" stance.
//!
//! # Cancellation is checked between address candidates, not preemptable mid-attempt
//!
//! [`connect_adapter_sync`] checks `cancel` before resolving the address and
//! again before each individual connect attempt (there can be more than one
//! candidate address for a hostname), but a single in-flight
//! `TcpStream::connect_timeout` call cannot itself be interrupted early by a
//! cooperative flag the way `exec.rs`'s poll-loop can kill a child process —
//! the timeout itself is the only bound on how long one attempt can take.
//! This is a disclosed limitation, not a silent gap: [`DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT`]
//! keeps any single attempt's worst case small.

use std::net::{Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

use super::confirm::ConfirmationService;
use super::dto::{self, AdapterTransportKind};
use super::{
    debug_adapter_cancelled, debug_adapter_connect_failed,
    debug_adapter_tcp_companion_connect_timed_out, debug_adapter_tcp_companion_exited,
};

/// Wall-clock ceiling on a single `TcpStream::connect` attempt — generous for
/// a real local-loopback DAP adapter (the only realistic target this
/// transport is designed for; see the module doc) while still bounding a
/// hung/unresponsive endpoint. Deliberately much shorter than
/// `exec.rs::DEBUG_ADAPTER_STARTUP_GRACE`'s spawn-crash-detection window
/// serves a different purpose: this bounds one blocking network call, not a
/// "did the process survive" observation window. `F210` S6 also reuses this
/// exact constant as [`connect_loopback_companion_with_retry_sync`]'s own
/// default *total* retry-loop budget (not a single-attempt bound there — see
/// that function's own doc comment) — `pub(crate)` so
/// `service::DebugSessionService::start_session`'s `TcpSpawn` branch can name
/// it explicitly rather than this module silently reaching for its own
/// constant from outside.
pub(crate) const DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// `F210` S6 — [`connect_loopback_companion_with_retry_sync`]'s starting
/// backoff between connect attempts. A bare `TcpStream::connect` against a
/// loopback port nothing is listening on yet observes `ECONNREFUSED`
/// near-instantly rather than blocking, so a fixed sleep between attempts is
/// the only way to avoid a tight busy-loop while still promptly noticing the
/// moment the companion process's listener comes up.
const DEBUG_ADAPTER_TCP_SPAWN_RETRY_INITIAL_BACKOFF: Duration = Duration::from_millis(50);

/// `F210` S6 — the ceiling [`connect_loopback_companion_with_retry_sync`]'s
/// exponential backoff never exceeds, doubling from
/// [`DEBUG_ADAPTER_TCP_SPAWN_RETRY_INITIAL_BACKOFF`] up to this value each
/// retry — bounds how late a late-arriving listener can still be caught
/// before the shared [`DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT`] budget itself runs
/// out (at 500ms, several retries still fit inside the 5s production budget
/// even in the worst case).
const DEBUG_ADAPTER_TCP_SPAWN_RETRY_MAX_BACKOFF: Duration = Duration::from_millis(500);

/// Trust → selected-root → confirmation-gated entry point — see the module
/// doc for the full rationale. Calls [`TrustService::require_trusted`] first,
/// resolves the selected authorized root second, then calls
/// [`ConfirmationService::require_confirmed`], all before any
/// `TcpStream`/connect-related identifier appears anywhere in this function's
/// body —
/// `scripts/plain/boundary-contracts.mjs`'s `validateDebugAdapterConnectBoundary`
/// mechanically locks exactly this ordering.
///
/// Real production caller: `super::service::DebugSessionService::start_session`'s
/// TCP-transport branch (`F100` S2).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn connect_adapter(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    root_id: RootId,
    confirmation: &ConfirmationService,
    descriptor: &dto::AdapterSpawnDescriptor,
    tcp: &dto::TcpConnectDescriptor,
    cancel: Arc<AtomicBool>,
) -> Result<TcpStream, CommandError> {
    trust.require_trusted(workspace, window_label).await?;
    let _selected_root = workspace.root_canonical_path(window_label, root_id)?;
    let subject = descriptor.confirmation_subject(AdapterTransportKind::Tcp);
    confirmation
        .require_confirmed(workspace, window_label, &subject)
        .await?;
    let tcp = tcp.clone();
    tauri::async_runtime::spawn_blocking(move || connect_adapter_sync(&tcp, &cancel))
        .await
        .map_err(|_| debug_adapter_connect_failed())?
}

/// The actual hardened connect step — see the module doc's "cancellation"
/// section for the exact interruption contract. Resolves `descriptor.host`
/// via the standard library's blocking `ToSocketAddrs` (permitting a hostname
/// like `"localhost"`, not only a literal IP), then tries each candidate
/// address in turn within the shared [`DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT`]
/// budget.
///
/// Real production caller: [`connect_adapter`].
fn connect_adapter_sync(
    descriptor: &dto::TcpConnectDescriptor,
    cancel: &AtomicBool,
) -> Result<TcpStream, CommandError> {
    if cancel.load(Ordering::SeqCst) {
        return Err(debug_adapter_cancelled());
    }
    let addresses: Vec<_> = (descriptor.host.as_str(), descriptor.port)
        .to_socket_addrs()
        .map_err(|_| debug_adapter_connect_failed())?
        .collect();
    if addresses.is_empty() {
        return Err(debug_adapter_connect_failed());
    }

    let deadline = Instant::now() + DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT;
    for address in addresses {
        if cancel.load(Ordering::SeqCst) {
            return Err(debug_adapter_cancelled());
        }
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            break;
        };
        if remaining.is_zero() {
            break;
        }
        if let Ok(stream) = TcpStream::connect_timeout(&address, remaining) {
            return Ok(stream);
        }
    }
    Err(debug_adapter_connect_failed())
}

/// `F210` S6 — the bounded, backing-off retry loop that composes a spawned
/// companion process's TCP listener coming up with this domain's own
/// loopback connect primitive. See `debug::mod`'s own module doc ("S1's open
/// spawn-then-connect question") for why this exists at all —
/// `service::DebugSessionService::start_session`'s `TcpSpawn` branch is the
/// sole production caller, always immediately after
/// `exec::spawn_adapter_as_tcp_companion` has already passed the
/// `Tcp`-confirmed trust/confirmation gate for this exact `(command, args)`.
///
/// # Why this does not re-run the trust/confirmation gate
///
/// Connecting to the loopback port the just-spawned child itself is expected
/// to open is a continuation of the single already-gated spawn-then-connect
/// operation, not an independent connect decision the way [`connect_adapter`]'s
/// own caller-chosen, arbitrary `host:port` target is — re-checking
/// confirmation on every retry attempt would also mean a blocking disk read
/// on this domain's own backoff cadence, for no additional safety: the port
/// is not, and was never, part of the confirmed identity (see
/// [`dto::TcpConnectDescriptor`]'s own doc comment for why `host`/`port`
/// are excluded from [`dto::AdapterConfirmationSubject`] in the first place).
///
/// # Retry contract
///
/// `probe_exit_code` is polled at the *start* of every iteration (including
/// the first) — a companion that has already died (after surviving
/// `exec::DEBUG_ADAPTER_STARTUP_GRACE` — an earlier exit is instead reported
/// as [`super::debug_adapter_startup_crashed`], inside
/// `exec::spawn_adapter_sync` itself, before this loop is ever reached) fails
/// immediately with [`super::debug_adapter_tcp_companion_exited`], never
/// spending any part of `budget` on a doomed connection attempt. Each
/// connect attempt is itself bounded by whatever remains of `budget`
/// (`TcpStream::connect_timeout`, exactly like [`connect_adapter_sync`]'s own
/// per-attempt bound); a real loopback refusal returns near-instantly rather
/// than consuming that bound, so the effective pacing between attempts comes
/// from the sleep after each failed one — starting at
/// [`DEBUG_ADAPTER_TCP_SPAWN_RETRY_INITIAL_BACKOFF`] and doubling up to
/// [`DEBUG_ADAPTER_TCP_SPAWN_RETRY_MAX_BACKOFF`] each time, never past what
/// remains of `budget`. Once `budget` elapses with the process still alive
/// but never having accepted a connection,
/// [`super::debug_adapter_tcp_companion_connect_timed_out`] is returned —
/// see that function's own doc comment for why it is a distinct code from
/// the exited-process case above, and from the ordinary
/// [`super::debug_adapter_connect_failed`] (which never applies here — this
/// loop has its own, more specific pair of failure codes). The caller (not
/// this function) is responsible for killing the still-running companion
/// process on any `Err` this returns — see
/// `service::DebugSessionService::start_session`'s `TcpSpawn` arm.
///
/// `budget` is an explicit parameter (not the hardcoded
/// [`DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT`] constant) purely for testability —
/// mirrors `service::DebugSessionService::send_request_with_timeout`'s own
/// injected-timeout precedent; the sole production caller always passes
/// [`DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT`] itself.
pub(crate) fn connect_loopback_companion_with_retry_sync(
    port: u16,
    budget: Duration,
    probe_exit_code: impl Fn() -> Option<Option<i32>>,
    cancel: &AtomicBool,
) -> Result<TcpStream, CommandError> {
    let deadline = Instant::now() + budget;
    let mut backoff = DEBUG_ADAPTER_TCP_SPAWN_RETRY_INITIAL_BACKOFF;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(debug_adapter_cancelled());
        }
        if let Some(exit_code) = probe_exit_code() {
            return Err(debug_adapter_tcp_companion_exited(exit_code));
        }
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            return Err(debug_adapter_tcp_companion_connect_timed_out());
        };
        if remaining.is_zero() {
            return Err(debug_adapter_tcp_companion_connect_timed_out());
        }
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        if let Ok(stream) = TcpStream::connect_timeout(&address, remaining) {
            return Ok(stream);
        }
        let Some(remaining_before_sleep) = deadline.checked_duration_since(Instant::now()) else {
            return Err(debug_adapter_tcp_companion_connect_timed_out());
        };
        if remaining_before_sleep.is_zero() {
            return Err(debug_adapter_tcp_companion_connect_timed_out());
        }
        let sleep_for = backoff.min(remaining_before_sleep);
        std::thread::sleep(sleep_for);
        backoff = (backoff * 2).min(DEBUG_ADAPTER_TCP_SPAWN_RETRY_MAX_BACKOFF);
    }
}

#[cfg(test)]
mod tests;
