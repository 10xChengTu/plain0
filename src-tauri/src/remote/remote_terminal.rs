//! `F220` S5: SSH-channel-backed terminal transport — the sole owner of the
//! `pty-req`/`shell` channel sequencing this domain exposes to
//! `terminal::service` through a narrow, `russh`-free interface (ADR 0006
//! §4 / the research doc's "架构裁定 §4"; see `remote::mod`'s own "russh is
//! this module's alone to import" doc section for the mechanical guard this
//! keeps satisfied automatically — every non-`remote::` file is forbidden
//! from naming `russh`/`russh_sftp` at all). None of the five structs below
//! expose `Channel`, `ChannelMsg`, or `russh::client::Msg` in any public
//! signature — every field that holds one is private, so `terminal::service`
//! reaches this backend only through plain `std::io::Read`/`Write` and the
//! narrow inherent methods below.
//!
//! # Channel ownership split
//!
//! [`open_remote_terminal_channel`] opens one session channel, drives
//! `pty-req` then `shell` to completion (each awaiting the server's
//! `SSH_MSG_CHANNEL_SUCCESS`/`_FAILURE` reply before the next — a request
//! that never gets confirmed fails this call closed rather than silently
//! degrading), then [`russh::Channel::split`]s it: the write half is wrapped
//! in an `Arc` and shared by [`RemoteTerminalWriter`]/[`RemoteTerminalResizer`]/
//! [`RemoteTerminalKiller`] — every one of `ChannelWriteHalf`'s methods this
//! module uses takes `&self` (see `russh::channels`), so no `Mutex` is
//! needed to let those three coexist. The read half is moved into a single
//! dedicated background task ([`pump`]) that is the *only* thing that ever
//! calls `wait()` on it, forwarding data chunks into a bounded channel
//! [`RemoteTerminalReader`] blocks on and recording the terminal outcome
//! (`exit-status`/`exit-signal`/neither) for [`RemoteTerminalWaiter`].
//!
//! # Two-layer backpressure (mirrors `terminal::flow::FlowControl`)
//!
//! The bounded `tokio::sync::mpsc` channel between [`pump`] and
//! [`RemoteTerminalReader`] is this backend's own inner layer: once it fills
//! (the reader thread — gated by `terminal::flow::FlowControl`'s own
//! high/low water marks exactly as it always has for a local pty — is not
//! calling `read()` fast enough), `pump`'s `send(...).await` stalls, which in
//! turn stops `pump` from calling `wait()` again, which lets russh's own
//! per-channel flow-control window do the rest: the remote peer is not
//! offered more window until this side is actually ready to drain it. A
//! remote process producing output far faster than the frontend acknowledges
//! frames therefore cannot grow unbounded memory here any more than a local
//! pty session's own reader can.
//!
//! # Kill = graceful signal, then unconditional local release
//!
//! [`RemoteTerminalKiller::shutdown`] sends `eof`/`close` (a request the
//! remote peer may or may not act on promptly) and waits, bounded by
//! [`REMOTE_TERMINAL_KILL_GRACE`], for [`pump`] to observe the channel fully
//! close on its own; whether or not that happens in time, it then
//! unconditionally aborts `pump`. Aborting drops `pump`'s own sender halves,
//! which is what lets [`RemoteTerminalReader::read`] return `Ok(0)` (EOF) and
//! [`RemoteTerminalWaiter::wait_exit`] resolve to
//! [`RemoteTerminalExitOutcome::Disconnected`] promptly even if the remote
//! peer never cooperates at all — "kill" here always means *this side's*
//! resources release on a bounded schedule, never "wait indefinitely on a
//! peer this domain no longer trusts to answer."

use std::collections::VecDeque;
use std::io::{self, Read, Write};
use std::sync::Arc;
use std::time::Duration;

use russh::client::Msg;
use russh::{Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Sig};
use tokio::sync::{mpsc, oneshot};

use crate::error::CommandError;

use super::dto::RemoteSessionId;
use super::session::RemoteSessionService;

/// Bounded capacity of the channel between [`pump`] and
/// [`RemoteTerminalReader`] — see the module doc's "Two-layer backpressure"
/// section. Each slot holds one already-chunked `Vec<u8>` (whatever size a
/// single inbound `SSH_MSG_CHANNEL_DATA` happened to carry), not a fixed byte
/// count, mirroring how the local backend's own pty `read()` calls are
/// chunked by the OS rather than by this domain.
const REMOTE_TERMINAL_CHANNEL_CAPACITY: usize = 64;

/// How long [`RemoteTerminalKiller::shutdown`] waits for the remote peer to
/// acknowledge `eof`/`close` before forcing local release regardless — see
/// the module doc's "Kill = graceful signal, then unconditional local
/// release" section.
const REMOTE_TERMINAL_KILL_GRACE: Duration = Duration::from_secs(3);

/// The fixed `TERM` a remote `pty-req` advertises — matches
/// `terminal::shell::TERMINAL_ENV_TERM`'s own local-session value (the
/// research doc's "架构裁定 §4": "term 名沿用本地 TERM 语义"). Duplicated here
/// (rather than imported) so this module never depends on `terminal::` at
/// all — it stays a narrow, terminal-domain-agnostic transport, exactly like
/// `remote::remote_fs` never depends on `workspace::`.
const REMOTE_TERMINAL_TERM: &str = "xterm-256color";

/// This session's terminal outcome, as observed by [`pump`] — the
/// remote-backend analogue of `terminal::service::TerminalExitStatus`,
/// deliberately a distinct type (this module never imports anything from
/// `terminal::`). `Exited`/`Signaled` mirror a real `exit-status`/
/// `exit-signal` channel request; `Disconnected` is reported whenever the
/// channel closed (including a forced release via
/// [`RemoteTerminalKiller::shutdown`]'s grace-timeout path) without either
/// ever arriving — the channel-level, not-a-normal-exit outcome the S5
/// contract requires be distinguishable from a real exit, never silently
/// reported as one.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RemoteTerminalExitOutcome {
    Exited { code: u32 },
    Signaled { signal: String },
    Disconnected,
}

/// `Sig` carries no public name accessor of its own (only a private
/// `name()`) — this is this module's own readable projection, used only for
/// [`RemoteTerminalExitOutcome::Signaled`]'s `signal` string.
fn signal_display(signal: &Sig) -> String {
    match signal {
        Sig::ABRT => "ABRT".to_owned(),
        Sig::ALRM => "ALRM".to_owned(),
        Sig::FPE => "FPE".to_owned(),
        Sig::HUP => "HUP".to_owned(),
        Sig::ILL => "ILL".to_owned(),
        Sig::INT => "INT".to_owned(),
        Sig::KILL => "KILL".to_owned(),
        Sig::PIPE => "PIPE".to_owned(),
        Sig::QUIT => "QUIT".to_owned(),
        Sig::SEGV => "SEGV".to_owned(),
        Sig::TERM => "TERM".to_owned(),
        Sig::USR1 => "USR1".to_owned(),
        Sig::Custom(name) => name.clone(),
    }
}

/// Blocking byte source for `terminal::service`'s reader thread — see the
/// module doc's "Channel ownership split" section. `leftover` holds whatever
/// tail of the most recently received chunk a caller's smaller `buf` could
/// not fit into in one `read()` call.
pub(crate) struct RemoteTerminalReader {
    data_rx: mpsc::Receiver<Vec<u8>>,
    leftover: VecDeque<u8>,
}

impl Read for RemoteTerminalReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.leftover.is_empty() {
            match tauri::async_runtime::block_on(self.data_rx.recv()) {
                Some(chunk) => self.leftover.extend(chunk),
                // The pump task ended (channel closed, or force-released by
                // `RemoteTerminalKiller::shutdown`) with nothing left
                // buffered — real end-of-file, exactly like a local pty
                // master's own `read()` returning `Ok(0)` once every writer
                // is gone.
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

/// Blocking sink for `terminal::service`'s pty stdin writes — see the module
/// doc's "Channel ownership split" section for why sharing one
/// `Arc<ChannelWriteHalf>` across this, [`RemoteTerminalResizer`] and
/// [`RemoteTerminalKiller`] needs no additional synchronization.
pub(crate) struct RemoteTerminalWriter {
    write_half: Arc<ChannelWriteHalf<Msg>>,
}

impl Write for RemoteTerminalWriter {
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

/// `terminal::service`'s resize entry point — `window_change` is this
/// backend's SSH-level equivalent of a local pty's `TIOCSWINSZ` resize (v1
/// never re-sends `pty-req`, only `window_change`, exactly once per resize).
pub(crate) struct RemoteTerminalResizer {
    write_half: Arc<ChannelWriteHalf<Msg>>,
}

impl RemoteTerminalResizer {
    pub(crate) fn window_change(&self, cols: u16, rows: u16) -> Result<(), CommandError> {
        tauri::async_runtime::block_on(self.write_half.window_change(
            u32::from(cols),
            u32::from(rows),
            0,
            0,
        ))
        .map_err(|_| super::remote_terminal_unavailable())
    }
}

/// `terminal::service`'s kill entry point — see the module doc's "Kill =
/// graceful signal, then unconditional local release" section.
pub(crate) struct RemoteTerminalKiller {
    write_half: Arc<ChannelWriteHalf<Msg>>,
    pump: tauri::async_runtime::JoinHandle<()>,
}

impl RemoteTerminalKiller {
    pub(crate) fn shutdown(&mut self) -> Result<(), CommandError> {
        tauri::async_runtime::block_on(async {
            let _ = self.write_half.eof().await;
            let _ = self.write_half.close().await;
            tokio::select! {
                _ = &mut self.pump => {}
                () = tokio::time::sleep(REMOTE_TERMINAL_KILL_GRACE) => {}
            }
        });
        // Idempotent and harmless on an already-finished task — see the
        // module doc: this is the unconditional "force release" half of the
        // contract, independent of whether the `select!` above resolved via
        // the pump finishing on its own or the grace timeout.
        self.pump.abort();
        Ok(())
    }
}

/// `terminal::service`'s waiter-thread entry point — see
/// [`RemoteTerminalExitOutcome`]'s own doc comment for what each outcome
/// means.
pub(crate) struct RemoteTerminalWaiter {
    exit_rx: oneshot::Receiver<RemoteTerminalExitOutcome>,
}

impl RemoteTerminalWaiter {
    pub(crate) fn wait_exit(&mut self) -> RemoteTerminalExitOutcome {
        tauri::async_runtime::block_on(async { (&mut self.exit_rx).await })
            .unwrap_or(RemoteTerminalExitOutcome::Disconnected)
    }
}

/// Every handle [`open_remote_terminal_channel`] hands back — one per real
/// backend role, exactly mirroring the four things `terminal::service`
/// extracts from a local `portable_pty` session (reader/writer/resizer/
/// killer) plus the waiter role `terminal::service` spawns its own thread
/// around.
pub(crate) struct RemoteTerminalHandles {
    pub(crate) reader: RemoteTerminalReader,
    pub(crate) writer: RemoteTerminalWriter,
    pub(crate) resizer: RemoteTerminalResizer,
    pub(crate) killer: RemoteTerminalKiller,
    pub(crate) waiter: RemoteTerminalWaiter,
}

/// Opens one session channel on `session_id`'s live connection and drives it
/// to a running remote shell — see the module doc. `cols`/`rows` seed the
/// initial `pty-req` geometry; a later resize is
/// [`RemoteTerminalResizer::window_change`]'s job, never a second `pty-req`.
/// v1 scope (research doc "架构裁定 §4"): always the remote user's default
/// login shell at their home directory — no cwd is ever applied here (SSH's
/// `shell` request has no cwd parameter, and this domain never resorts to a
/// shell-string `cd && …` workaround); no local environment is forwarded
/// (`set_env` is never called — most `sshd`s reject it by default, and
/// forwarding Plain's own ambient environment across a trust boundary is
/// exactly what this domain's "远程主机是不受信任的输入源" stance rules out
/// in the injection direction too).
///
/// `F220` S4 parity: a `session_id` that no longer names a live session
/// reports [`super::remote_session_disconnected`] here — the exact same
/// translation `remote::remote_fs::open` already performs for the SFTP path
/// (see that function's own doc comment) — rather than the raw "never
/// existed" `REMOTE_SESSION_NOT_FOUND`, since a remote terminal's
/// `session_id` can only ever have come from an already-authorized root's
/// live binding.
pub(crate) async fn open_remote_terminal_channel(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    cols: u16,
    rows: u16,
) -> Result<RemoteTerminalHandles, CommandError> {
    let mut channel = remote
        .open_terminal_session_channel(window_label, session_id)
        .await
        .map_err(|error| {
            if error.code() == "REMOTE_SESSION_NOT_FOUND" {
                super::remote_session_disconnected()
            } else {
                error
            }
        })?;

    channel
        .request_pty(
            true,
            REMOTE_TERMINAL_TERM,
            u32::from(cols),
            u32::from(rows),
            0,
            0,
            &[],
        )
        .await
        .map_err(|_| super::remote_terminal_unavailable())?;
    expect_success(&mut channel).await?;

    channel
        .request_shell(true)
        .await
        .map_err(|_| super::remote_terminal_unavailable())?;
    expect_success(&mut channel).await?;

    let (read_half, write_half) = channel.split();
    let write_half = Arc::new(write_half);
    let (data_tx, data_rx) = mpsc::channel(REMOTE_TERMINAL_CHANNEL_CAPACITY);
    let (exit_tx, exit_rx) = oneshot::channel();
    let pump = tauri::async_runtime::spawn(pump(read_half, data_tx, exit_tx));

    Ok(RemoteTerminalHandles {
        reader: RemoteTerminalReader {
            data_rx,
            leftover: VecDeque::new(),
        },
        writer: RemoteTerminalWriter {
            write_half: Arc::clone(&write_half),
        },
        resizer: RemoteTerminalResizer {
            write_half: Arc::clone(&write_half),
        },
        killer: RemoteTerminalKiller { write_half, pump },
        waiter: RemoteTerminalWaiter { exit_rx },
    })
}

/// Awaits exactly the next message and requires it to be a
/// `SSH_MSG_CHANNEL_SUCCESS` — used right after `request_pty`/`request_shell`
/// (both sent with `want_reply: true`), before `channel.split()` ever hands
/// the read half off to [`pump`]. Fails closed on a `Failure` reply, an
/// unrelated message arriving first, or the channel closing before either.
async fn expect_success(channel: &mut Channel<Msg>) -> Result<(), CommandError> {
    match channel.wait().await {
        Some(ChannelMsg::Success) => Ok(()),
        _ => Err(super::remote_terminal_unavailable()),
    }
}

/// The sole reader of this channel's [`ChannelReadHalf`] for its whole
/// lifetime — see the module doc's "Channel ownership split" section.
async fn pump(
    mut read_half: ChannelReadHalf,
    data_tx: mpsc::Sender<Vec<u8>>,
    exit_tx: oneshot::Sender<RemoteTerminalExitOutcome>,
) {
    let mut outcome: Option<RemoteTerminalExitOutcome> = None;
    while let Some(message) = read_half.wait().await {
        match message {
            ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                if data_tx.send(data.to_vec()).await.is_err() {
                    // `RemoteTerminalReader` was dropped — nothing left to
                    // forward to; the loop below only matters for the exit
                    // outcome now, which is still recorded normally.
                    break;
                }
            }
            ChannelMsg::ExitStatus { exit_status } => {
                outcome = Some(RemoteTerminalExitOutcome::Exited { code: exit_status });
            }
            ChannelMsg::ExitSignal { signal_name, .. } => {
                outcome = Some(RemoteTerminalExitOutcome::Signaled {
                    signal: signal_display(&signal_name),
                });
            }
            _ => {}
        }
    }
    // Dropping the sender is what lets `RemoteTerminalReader::read` observe
    // real end-of-file — see that impl's own comment.
    drop(data_tx);
    let _ = exit_tx.send(outcome.unwrap_or(RemoteTerminalExitOutcome::Disconnected));
}

#[cfg(test)]
mod tests;
