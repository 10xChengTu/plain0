//! `F220` S7: SSH-`exec`-channel-backed DAP transport — the sole owner
//! (alongside `remote::remote_git`) of a real `channel.exec(..)` sequencing
//! in this crate, and one of exactly two files permitted to call
//! [`super::shell_escape::encode_posix_command_line`] (mechanically locked by
//! `scripts/plain/boundary-contracts.mjs`'s `validateShellEscapeSoleCallerBoundary`
//! — see that guard's own doc comment). Exposes a narrow, `russh`-free
//! interface to `debug::service`/`terminal::service` (this module's two
//! callers): [`RemoteDapAdapterHandles`]/[`RemoteDapReader`]/[`RemoteDapWriter`]/
//! [`RemoteDapKiller`] are plain `std::io::Read`/`Write` + inherent methods —
//! no `Channel`, `ChannelMsg`, or any other `russh` type ever appears in this
//! module's public signatures, exactly mirroring `remote::remote_terminal`/
//! `remote::remote_git`'s own identical "sole owner of the channel handle"
//! design (see either module's own doc comment).
//!
//! # Two independent things this module launches over `exec`, both via the same `cd && exec` command-line shape
//!
//! 1. [`open_remote_dap_adapter_channel`] — the remote twin of
//!    `debug::exec::spawn_adapter`: launches the configured DAP adapter
//!    executable on a plain (no-pty) `exec` channel, whose `stdout`/`stdin`
//!    *are* the DAP wire transport `debug::framing`/`debug::session` consume
//!    directly (no local process, no local pipes — the channel's own data
//!    stream stands in for `ChildStdout`/`ChildStdin`), and whose stderr
//!    (SSH extended-data stream 1) is captured, bounded, exactly like
//!    `debug::exec::AdapterHandle`'s own `stderr_tail`.
//! 2. [`open_remote_run_in_terminal_channel`] — the remote twin of
//!    `terminal::service::TerminalService::start_program`: routes a debug
//!    adapter's `runInTerminal` reverse request to the *same SSH session's*
//!    remote terminal, per the research doc's "架构裁定 §4" ("`runInTerminal`
//!    反向请求路由到同会话的远程终端"). Unlike (1), this attaches a `pty-req`
//!    first (a `runInTerminal` session is meant to be a real, visible
//!    terminal a human can watch/interact with, exactly like its local
//!    counterpart's real pty) — built on
//!    `remote::remote_terminal::open_remote_terminal_exec_channel` (`F220`
//!    S7's own small addition to that module), reusing every piece of its
//!    channel machinery (backpressure, kill grace, exit-outcome typing)
//!    unchanged.
//!
//! Both need a working directory an SSH `exec`/`pty-req`+`exec` request has
//! no wire-level parameter for (mirrors `remote::remote_terminal`'s own
//! "shell 请求没有 cwd 参数" observation for the plain-shell case) — both
//! therefore go through [`build_cd_and_exec_command_line`], this module's one
//! shared "cd `<dir>` && exec `<program>` `<args…>`" command-line builder:
//! *every* element (the directory, the program, each argument) is a single,
//! whole token to [`super::shell_escape::encode_posix_command_line`] — this
//! module never concatenates a caller-supplied string into a command line by
//! hand, exactly like `remote::remote_git::build_argv`'s own discipline. If
//! the directory does not exist (or is not a directory), the remote shell's
//! own `cd` fails and short-circuits the `&&` — `exec` never runs, and the
//! failure surfaces as an ordinary non-zero exit / early stream close, never
//! a silent "ran anyway, in the wrong place" — this is this module's own
//! "honest degrade" for an unsatisfiable cwd (research doc S7 "架构裁定 §4":
//! "cwd 尽力（不可满足则如实降级）").
//!
//! # Why `exec`, not the local `spawn_adapter_sync`-style startup-grace poll
//!
//! `debug::exec::spawn_adapter_sync` polls for up to `DEBUG_ADAPTER_STARTUP_GRACE`
//! after spawning to turn a near-instant local crash into a precise,
//! captured-stderr [`super::super::debug::debug_adapter_startup_crashed`]-style
//! error *before* a session ever exists. This module deliberately does not
//! replicate that: `debug::session::run_reader`'s reader thread already
//! treats an immediate transport EOF (a "`cd` failed", "adapter binary not
//! found", or any other near-instant remote failure) as
//! `SessionEndReason::TransportClosed`, failing every pending handshake
//! request (`debug::session::PendingTable::fail_all`) the instant it
//! happens — this is the exact "adapter-died" path the research doc's own
//! S7 vertical-slice description calls for ("生命周期：会话断连 → DAP 会话按既
//! 有 adapter-died 路径终结（reader EOF 语义）"), and it already produces a
//! clean, immediate failure with no additional polling machinery needed here.
//! A disclosed narrowing, not an oversight: a remote launch failure surfaces
//! as a session that starts and immediately ends (with this module's own
//! captured stderr recoverable via [`RemoteDapAdapterHandles::stderr_tail`],
//! for a later slice wanting to surface it), rather than `debug_launch`
//! itself failing outright the way a local startup crash does.
//!
//! # No cancel/timeout plumbing around the channel-open round trip itself
//!
//! Mirrors `remote::remote_terminal::open_remote_terminal_channel`'s own
//! identical choice (`F220` S5): the `channel_open_session` → `exec` →
//! `SSH_MSG_CHANNEL_SUCCESS` round trip is a single, already-bounded-by-the-
//! live-SSH-connection network exchange, not a long-running operation this
//! domain's callers can meaningfully cancel mid-flight — every existing
//! per-request timeout (`debug::session::DEBUG_REQUEST_TIMEOUT`/
//! `DEBUG_LAUNCH_TIMEOUT`) still applies to every DAP request sent over the
//! resulting session exactly as it does for a local/TCP transport, since
//! those operate on `DebugSession`'s own pending-request table, transport-
//! agnostically.

use std::collections::VecDeque;
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::Msg;
use russh::{Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf};
use tokio::sync::mpsc;

use crate::error::CommandError;

use super::dto::RemoteSessionId;
use super::remote_terminal::{self, RemoteTerminalHandles};
use super::session::RemoteSessionService;
use super::shell_escape::encode_posix_command_line;

/// Bounded capacity of the channel between [`pump`] and [`RemoteDapReader`] —
/// mirrors `remote::remote_terminal::REMOTE_TERMINAL_CHANNEL_CAPACITY`'s
/// identical two-layer-backpressure rationale (see that constant's own doc
/// comment): once full, `pump`'s `send(...).await` stalls, which stops it
/// from calling `wait()` again, which lets russh's own per-channel flow-
/// control window do the rest.
const REMOTE_DAP_CHANNEL_CAPACITY: usize = 64;

/// Stderr capture cap — the exact same numeric ceiling
/// `debug::exec::DEBUG_ADAPTER_STDERR_CAP_BYTES` uses for the local exec
/// path, deliberately **not** referenced from there (that constant is
/// private to `debug::exec`, and this module must not introduce a cross-
/// domain dependency on `debug::` at all — see the module doc's "narrow
/// interface" framing): defined independently here, at the same value,
/// because the two ceilings protect the identical thing (bounding memory
/// against a pathological/hostile adapter flooding stderr) for the identical
/// class of process.
const REMOTE_DAP_STDERR_CAP_BYTES: usize = 1_000_000;

/// How long [`RemoteDapKiller::shutdown`] waits for the remote peer to
/// acknowledge `eof`/`close` before forcing local release regardless —
/// mirrors `remote::remote_terminal::REMOTE_TERMINAL_KILL_GRACE`'s identical
/// "kill = graceful signal, then unconditional local release" contract and
/// value.
const REMOTE_DAP_KILL_GRACE: Duration = Duration::from_secs(3);

/// SSH extended-data stream 1 is `SSH_EXTENDED_DATA_STDERR` per RFC 4254
/// §5.2 — the one and only extended-data stream a plain `exec` channel ever
/// receives (mirrors `remote::remote_git::SSH_EXTENDED_DATA_STDERR`,
/// independently defined here for the identical "no cross-domain/cross-file
/// dependency for a shared protocol constant" reason as the cap above).
const SSH_EXTENDED_DATA_STDERR: u32 = 1;

/// Builds `"cd <cwd> && exec <command> <args…>"`, every element a single,
/// whole token through [`encode_posix_command_line`] — see the module doc's
/// "Two independent things" section for the full rationale (shared by both
/// of this module's public entry points). `encode_posix_command_line` is
/// called once for `cwd` alone (a one-element argv reduces to exactly one
/// quoted token, with no trailing content) and once for the real
/// `command`/`args` argv, rather than trying to quote the two independently
/// assembled shell clauses as a single call — the `&&` between them is the
/// only unquoted shell syntax this module ever emits, and it is a fixed
/// literal this module writes itself, never built from caller-supplied
/// content.
fn build_cd_and_exec_command_line(
    cwd: &str,
    command: &str,
    args: &[String],
) -> Result<String, CommandError> {
    let quoted_cwd = encode_posix_command_line(std::slice::from_ref(&cwd.to_owned()))?;
    let mut argv = vec![command.to_owned()];
    argv.extend(args.iter().cloned());
    let quoted_argv = encode_posix_command_line(&argv)?;
    Ok(format!("cd {quoted_cwd} && exec {quoted_argv}"))
}

/// Blocking byte source for `debug::session::run_reader`'s reader thread —
/// see the module doc's "Why `exec`" section for what an immediate EOF here
/// (a `cd`/`exec` failure, or the process exiting instantly) means to that
/// caller. Structurally identical to
/// `remote::remote_terminal::RemoteTerminalReader` (see that type's own doc
/// comment) — a distinct type, not a reuse, because this one's `data_rx`
/// carries *only* `ChannelMsg::Data` (the DAP wire stream) — `ExtendedData`
/// (stderr) is routed to [`RemoteDapAdapterHandles::stderr_tail`]'s shared
/// buffer instead by [`pump`], never mixed into the framed byte stream
/// `debug::framing::FrameDecoder` consumes.
pub(crate) struct RemoteDapReader {
    data_rx: mpsc::Receiver<Vec<u8>>,
    leftover: VecDeque<u8>,
}

impl Read for RemoteDapReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.leftover.is_empty() {
            match tauri::async_runtime::block_on(self.data_rx.recv()) {
                Some(chunk) => self.leftover.extend(chunk),
                // The pump task ended (channel closed, or force-released by
                // `RemoteDapKiller::shutdown`) with nothing left buffered —
                // real end-of-file, exactly like a local adapter's own
                // `ChildStdout` reporting `Ok(0)` once the process exits.
                None => return Ok(0),
            }
        }
        let mut written = 0;
        while written < buf.len() {
            let Some(byte) = self.leftover.pop_front() else {
                break;
            };
            buf[written] = byte;
            written += 1;
        }
        Ok(written)
    }
}

/// Blocking sink for `debug::session::DebugSession`'s DAP request writer —
/// structurally identical to `remote::remote_terminal::RemoteTerminalWriter`
/// (see that type's own doc comment for why sharing one
/// `Arc<ChannelWriteHalf>` with [`RemoteDapKiller`] needs no additional
/// synchronization).
pub(crate) struct RemoteDapWriter {
    write_half: Arc<ChannelWriteHalf<Msg>>,
}

impl Write for RemoteDapWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let len = buf.len();
        tauri::async_runtime::block_on(self.write_half.data_bytes(buf.to_vec()))
            .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
        Ok(len)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// `debug::service::DebugSessionService`'s teardown entry point for a
/// remote-launched adapter — `&self`, not `&mut self` (unlike
/// `remote::remote_terminal::RemoteTerminalKiller::shutdown`), so this can be
/// captured directly inside the `Box<dyn Fn() + Send + Sync>` teardown
/// closure `debug::service::DebugSessionService::start_session_with_tcp_spawn_budget`
/// wires into every transport variant (mirrors
/// `debug::exec::AdapterHandle::kill`'s identical `&self` shape for the
/// exact same reason). See the module doc's "Kill = graceful signal, then
/// unconditional local release" precedent (shared with
/// `remote::remote_terminal::RemoteTerminalKiller`) for the exact contract.
pub(crate) struct RemoteDapKiller {
    write_half: Arc<ChannelWriteHalf<Msg>>,
    pump: tauri::async_runtime::JoinHandle<()>,
}

impl RemoteDapKiller {
    pub(crate) fn shutdown(&self) {
        tauri::async_runtime::block_on(async {
            let _ = self.write_half.eof().await;
            let _ = self.write_half.close().await;
            tokio::select! {
                () = wait_for_pump(&self.pump) => {}
                () = tokio::time::sleep(REMOTE_DAP_KILL_GRACE) => {}
            }
        });
        // Idempotent and harmless on an already-finished task — the
        // unconditional "force release" half of the contract, independent of
        // whether the `select!` above resolved via the pump finishing on its
        // own or the grace timeout.
        self.pump.abort();
    }
}

/// `tauri::async_runtime::JoinHandle::abort`/`inner` both only need `&self`
/// — `inner()` hands back the real `tokio::task::JoinHandle`, whose own
/// `is_finished` this polls — unlike
/// `remote::remote_terminal::RemoteTerminalKiller::shutdown` (which takes
/// `&mut self` and awaits `&mut self.pump` directly), this small poll loop is
/// what lets [`RemoteDapKiller::shutdown`] stay a `&self` method (see its own
/// doc comment for why that matters here).
async fn wait_for_pump(pump: &tauri::async_runtime::JoinHandle<()>) {
    while !pump.inner().is_finished() {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// Every handle a remote DAP adapter launch hands back — the remote-
/// transport twin of `debug::exec::AdapterHandle`: [`reader`]/[`writer`] feed
/// `debug::session::DebugSession::start_with_reverse_requests` exactly like a
/// local adapter's `ChildStdout`/`ChildStdin` would, [`killer`] is the
/// teardown closure's target, and `stderr_tail` mirrors
/// `debug::exec::AdapterHandle`'s own identically-capped, continuously-
/// updated stderr buffer.
pub(crate) struct RemoteDapAdapterHandles {
    pub(crate) reader: RemoteDapReader,
    pub(crate) writer: RemoteDapWriter,
    pub(crate) killer: RemoteDapKiller,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
}

impl RemoteDapAdapterHandles {
    /// The stderr capture buffer's current contents, up to
    /// [`REMOTE_DAP_STDERR_CAP_BYTES`] — mirrors
    /// `debug::exec::AdapterHandle::stderr_tail`'s identical "no caller yet"
    /// disclosure: kept for a later slice wanting to surface a remote
    /// adapter's stderr diagnostics (e.g. folded into a session-ended
    /// notification), not read anywhere in this slice — see the module doc's
    /// "Why `exec`, not the local startup-grace poll" section for why this
    /// slice relies on the reader-EOF path instead of an upfront captured-
    /// stderr error the way the local transport does.
    #[allow(dead_code)]
    pub(crate) fn stderr_tail(&self) -> Vec<u8> {
        self.stderr_tail
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

/// `F220` S7 — the remote twin of `debug::exec::spawn_adapter_sync`: opens a
/// plain (no-pty) `exec` channel on `session_id`'s live connection and runs
/// `command`/`args` there via [`build_cd_and_exec_command_line`], with
/// `base_path` as the working directory. The channel's own data stream *is*
/// the DAP wire transport — no local process, no local pipes.
///
/// `F220` S4 parity: a `session_id` that no longer names a live session
/// reports [`super::remote_session_disconnected`] here, the same translation
/// `remote::remote_fs::open`/`remote::remote_terminal::open_remote_terminal_channel`
/// already perform for their own transports (see either's own doc comment).
pub(crate) async fn open_remote_dap_adapter_channel(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    command: &str,
    args: &[String],
) -> Result<RemoteDapAdapterHandles, CommandError> {
    let command_line = build_cd_and_exec_command_line(base_path, command, args)?;

    let mut channel = remote
        .open_dap_exec_channel(window_label, session_id)
        .await
        .map_err(|error| {
            if error.code() == "REMOTE_SESSION_NOT_FOUND" {
                super::remote_session_disconnected()
            } else {
                error
            }
        })?;

    channel
        .exec(true, command_line.into_bytes())
        .await
        .map_err(|_| super::remote_dap_exec_unavailable())?;
    expect_dap_exec_success(&mut channel).await?;

    let (read_half, write_half) = channel.split();
    let write_half = Arc::new(write_half);
    let (data_tx, data_rx) = mpsc::channel(REMOTE_DAP_CHANNEL_CAPACITY);
    let stderr_tail = Arc::new(Mutex::new(Vec::new()));
    let pump_stderr_tail = Arc::clone(&stderr_tail);
    let pump = tauri::async_runtime::spawn(pump_dap_exec(read_half, data_tx, pump_stderr_tail));

    Ok(RemoteDapAdapterHandles {
        reader: RemoteDapReader {
            data_rx,
            leftover: VecDeque::new(),
        },
        writer: RemoteDapWriter {
            write_half: Arc::clone(&write_half),
        },
        killer: RemoteDapKiller { write_half, pump },
        stderr_tail,
    })
}

/// `F220` S7 — routes a live debug session's `runInTerminal` reverse request
/// to the *same SSH session's* remote terminal (research doc S7 "架构裁定
/// §4") — see the module doc's "Two independent things" section for the full
/// design. Built on `remote::remote_terminal::open_remote_terminal_exec_channel`
/// (this module's own thin, `cd`-prefixing wrapper around it), so it inherits
/// that channel's `pty-req` attachment and every piece of its backpressure/
/// kill/exit-outcome machinery unchanged — the returned
/// [`RemoteTerminalHandles`] is `terminal::service::TerminalService::start_program_remote`'s
/// sole input, exactly like `remote::remote_terminal::open_remote_terminal_channel`'s
/// own return value already is for `TerminalService::start_remote`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn open_remote_run_in_terminal_channel(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    program: &str,
    args: &[String],
    cwd: &str,
    cols: u16,
    rows: u16,
) -> Result<RemoteTerminalHandles, CommandError> {
    let command_line = build_cd_and_exec_command_line(cwd, program, args)?;
    remote_terminal::open_remote_terminal_exec_channel(
        remote,
        window_label,
        session_id,
        &command_line,
        cols,
        rows,
    )
    .await
}

/// Awaits exactly the next message and requires it to be a
/// `SSH_MSG_CHANNEL_SUCCESS` — the identical discipline
/// `remote::remote_git::expect_success`/`remote::remote_terminal::expect_success`
/// each apply after their own channel request (this module's own copy,
/// per this codebase's established per-module "duplicate this tiny helper"
/// precedent — see either sibling's own doc comment). A `Failure` reply, an
/// unrelated message, or the channel closing before either is a fail-closed
/// [`super::remote_dap_exec_unavailable`], never a silent downgrade.
async fn expect_dap_exec_success(channel: &mut Channel<Msg>) -> Result<(), CommandError> {
    match channel.wait().await {
        Some(ChannelMsg::Success) => Ok(()),
        _ => Err(super::remote_dap_exec_unavailable()),
    }
}

/// The sole reader of this channel's [`ChannelReadHalf`] for its whole
/// lifetime — see the module doc for the overall "no local process" design.
/// `ChannelMsg::Data` (the DAP wire stream) is forwarded to `data_tx`;
/// `ChannelMsg::ExtendedData` on [`SSH_EXTENDED_DATA_STDERR`] is appended
/// directly into `stderr_tail`, bounded at [`REMOTE_DAP_STDERR_CAP_BYTES`] —
/// ports `debug::exec::spawn_stderr_capture`'s bounded-drain-on-cap technique
/// (never allocate past the cap; keep draining-and-discarding once reached,
/// so the remote process's own stderr write never blocks on a full SSH
/// channel window) rather than re-deriving it, exactly like that function's
/// own module doc discloses for the local transport.
async fn pump_dap_exec(
    mut read_half: ChannelReadHalf,
    data_tx: mpsc::Sender<Vec<u8>>,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
) {
    while let Some(message) = read_half.wait().await {
        match message {
            ChannelMsg::Data { data } => {
                if data_tx.send(data.to_vec()).await.is_err() {
                    // `RemoteDapReader` was dropped — nothing left to
                    // forward the DAP stream to; stderr capture below still
                    // continues normally until the channel itself closes.
                    continue;
                }
            }
            ChannelMsg::ExtendedData { data, ext } if ext == SSH_EXTENDED_DATA_STDERR => {
                let mut tail = stderr_tail
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if tail.len() < REMOTE_DAP_STDERR_CAP_BYTES {
                    let remaining = REMOTE_DAP_STDERR_CAP_BYTES - tail.len();
                    let take = remaining.min(data.len());
                    tail.extend_from_slice(&data[..take]);
                }
            }
            _ => {}
        }
    }
    // Dropping the sender is what lets `RemoteDapReader::read` observe real
    // end-of-file — see that impl's own comment.
    drop(data_tx);
}

#[cfg(test)]
mod tests;
