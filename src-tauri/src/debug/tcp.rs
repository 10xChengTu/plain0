//! `debug` domain TCP transport (`F100` S1) — "Plain 主动连出去"
//! (`docs/research/2026-07-28-generic-dap.md`'s "主导会话裁定" item 3):
//! [`connect_adapter`]/[`connect_adapter_sync`] are the TCP-transport
//! counterpart of [`super::exec`]'s `spawn_adapter`/`spawn_adapter_sync`,
//! sharing the identical trust-then-confirmation double gate but performing a
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
//! # Same double gate as `spawn_adapter`, for the same reason
//!
//! "对任意 host:port 说 DAP" 和 "spawn 任意程序" 是同等级的信任委托 — connecting
//! out is not a lesser privilege than spawning just because it skips
//! `Command::new`. [`connect_adapter`] therefore calls
//! `TrustService::require_trusted` first, then
//! `ConfirmationService::require_confirmed` second, exactly mirroring
//! [`super::exec::spawn_adapter`]'s literal two-statement prefix —
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

use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::confirm::ConfirmationService;
use super::dto::{self, AdapterTransportKind};
use super::{debug_adapter_cancelled, debug_adapter_connect_failed};

/// Wall-clock ceiling on a single `TcpStream::connect` attempt — generous for
/// a real local-loopback DAP adapter (the only realistic target this
/// transport is designed for; see the module doc) while still bounding a
/// hung/unresponsive endpoint. Deliberately much shorter than
/// `exec.rs::DEBUG_ADAPTER_STARTUP_GRACE`'s spawn-crash-detection window
/// serves a different purpose: this bounds one blocking network call, not a
/// "did the process survive" observation window.
const DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Trust-*then*-confirmation-gated entry point — see the module doc for the
/// full rationale. Calls [`TrustService::require_trusted`] as its literal
/// first statement, then [`ConfirmationService::require_confirmed`] as its
/// literal second, both before any `TcpStream`/connect-related identifier
/// appears anywhere in this function's body —
/// `scripts/plain/boundary-contracts.mjs`'s `validateDebugAdapterConnectBoundary`
/// mechanically locks exactly this ordering.
///
/// Real production caller: `super::service::DebugSessionService::start_session`'s
/// TCP-transport branch (`F100` S2).
pub(crate) async fn connect_adapter(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    confirmation: &ConfirmationService,
    descriptor: &dto::AdapterSpawnDescriptor,
    tcp: &dto::TcpConnectDescriptor,
    cancel: Arc<AtomicBool>,
) -> Result<TcpStream, CommandError> {
    trust.require_trusted(workspace, window_label).await?;
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

#[cfg(test)]
mod tests;
