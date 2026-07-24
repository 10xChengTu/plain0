//! `TerminalService`: per-window PTY session lifecycle, background threads
//! and byte-level backpressure. See the module doc on `terminal::mod` for
//! the subprocess-spawning security contract.
//!
//! # Per-session thread model
//!
//! Every session owns exactly three dedicated OS threads, mirroring
//! `search::text_search`'s "one dedicated thread per streaming task"
//! precedent but split into three roles because a PTY session has three
//! independent things that can each block indefinitely on their own:
//!
//! 1. **reader** (`plain-terminal-<id>`) — the only thread that ever calls
//!    the blocking `read()` on the pty master. Before every read it calls
//!    [`flow::FlowControl::wait_until_clear_to_read`] (the real, ack-based
//!    backpressure gate: see `flow.rs`), then pushes each chunk it reads
//!    into a small bounded `sync_channel` — a second, structural
//!    defense-in-depth backstop independent of the byte-level gate (if the
//!    delivery side ever stalls for a transient reason despite the
//!    application-level flow control being satisfied, this channel's bound
//!    is what stops memory from growing without limit; see
//!    `TERMINAL_CHUNK_QUEUE_CAPACITY`). The thread ends the moment `read()`
//!    returns `0` (EOF, which happens naturally once every process holding
//!    the pty slave — the spawned child, chiefly — has exited or been
//!    killed; see [`spawn_session`]'s doc for why the parent process's own
//!    slave handle is dropped immediately after spawn) or a genuine error.
//! 2. **delivery** (`plain-terminal-emit-<id>`) — drains the channel and
//!    calls [`TerminalOutputSink::emit_chunk`] for each chunk. F070 S2 wires
//!    this to a real `app.emit_to(...)` (`terminal::commands::WindowEmitSink`)
//!    — the thread/channel structure itself did not change, only what
//!    "delivery" means. Ends once the channel disconnects (the reader thread
//!    ended) and is fully drained.
//! 3. **waiter** (`plain-terminal-wait-<id>`) — owns the `Child` and calls
//!    its blocking `wait()`. `Child::kill`/`wait` cannot both be called
//!    through the same object from different threads without one blocking
//!    the other (both take `&mut self`), so a `ChildKiller` obtained via
//!    `Child::clone_killer` *before* handing `Child` to this thread is what
//!    lets [`TerminalService::kill`] terminate the process concurrently.
//!    Once `wait()` returns, this thread also calls
//!    [`flow::FlowControl::cancel`] as a belt-and-suspenders wake for the
//!    reader (normally redundant with the EOF it will already see) and
//!    reports the exit status via [`TerminalOutputSink::emit_exit`].
//!
//!    **Known ordering caveat** (documented, not fixed, in F070 S2): this
//!    thread's `emit_exit` call is *not* synchronized with the delivery
//!    thread having drained every chunk the reader ever produced — `wait()`
//!    returning and the reader thread observing real pty EOF are woken by
//!    the same underlying "child has exited" kernel event through two
//!    independent syscalls (`waitpid` vs `read`) with no ordering primitive
//!    between them, so a real emitted `plain://terminal-exit` can in
//!    principle reach the frontend interleaved with (or fractionally before)
//!    the session's very last `plain://terminal-data` chunk. Fixing this
//!    would mean the waiter joining the reader's own completion before
//!    emitting exit, which is a thread-model change out of this slice's
//!    scope (see `terminal::commands` module doc); the mitigation lives in
//!    `app/platform/tauri/terminal-stream.ts` instead, which does not treat
//!    "exit observed" as "no more data will arrive".

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::dto::TerminalSessionId;
use super::flow::FlowControl;
use super::shell;
use super::{
    terminal_cwd_invalid, terminal_io_failed, terminal_session_limit_exceeded,
    terminal_session_not_found, terminal_unavailable, MAX_TERMINAL_SESSIONS_PER_WINDOW,
};

/// Bound on how many produced-but-not-yet-delivered output chunks may sit in
/// the channel between a session's reader and delivery threads before the
/// reader's `send` blocks — see the module doc's "reader" bullet.
const TERMINAL_CHUNK_QUEUE_CAPACITY: usize = 256;
/// Bytes requested per blocking `read()` call against the pty master.
const TERMINAL_READ_BUFFER_BYTES: usize = 8192;

/// One chunk of terminal output, in the order it was read from the pty
/// master. `sequence` starts at 0 for each session and increases by exactly
/// one per chunk — nothing in this slice's transport can itself reorder or
/// drop a chunk, but S2's real Tauri event bridge needs this guarantee to
/// defend against out-of-order IPC delivery, so it is established here
/// where the chunks are actually produced.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TerminalChunk {
    pub(crate) sequence: u64,
    pub(crate) bytes: Vec<u8>,
}

/// A terminal session's process exit outcome, decoupled from
/// `portable_pty::ExitStatus` so the rest of this domain (and its tests)
/// never need that crate's type directly.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TerminalExitStatus {
    pub(crate) exit_code: u32,
    pub(crate) signal: Option<String>,
}

impl From<portable_pty::ExitStatus> for TerminalExitStatus {
    fn from(status: portable_pty::ExitStatus) -> Self {
        Self {
            exit_code: status.exit_code(),
            signal: status.signal().map(str::to_owned),
        }
    }
}

/// Output-delivery seam: the real implementation
/// (`terminal::commands::WindowEmitSink`, F070 S2) calls the real Tauri
/// `emit_to` for both methods below (see the module doc); tests inject a
/// recording implementation instead, to observe chunks/exit deterministically
/// without a live `AppHandle`. The command layer builds the production sink
/// (it is the one place with access to a `WebviewWindow`/`AppHandle`) and
/// passes it into [`TerminalService::start`] — mirroring exactly how
/// `search::commands::workspace_search_text_start` builds its own `wake_sink`
/// closure and hands it to `WorkspaceService::search_text_start`.
pub(crate) trait TerminalOutputSink: Send + Sync {
    fn emit_chunk(&self, session_id: TerminalSessionId, chunk: TerminalChunk);
    fn emit_exit(&self, session_id: TerminalSessionId, status: TerminalExitStatus);
}

struct SessionThreads {
    reader: Option<JoinHandle<()>>,
    delivery: Option<JoinHandle<()>>,
    waiter: Option<JoinHandle<()>>,
}

struct TerminalSession {
    flow: Arc<FlowControl>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    threads: Mutex<SessionThreads>,
}

/// Rust-authoritative PTY terminal domain, `.manage()`d exactly once by
/// `lib.rs`. See the module doc for the per-session thread model.
pub struct TerminalService {
    state: Arc<TerminalState>,
}

struct TerminalState {
    windows: Mutex<HashMap<String, HashMap<TerminalSessionId, Arc<TerminalSession>>>>,
}

impl Default for TerminalService {
    fn default() -> Self {
        Self {
            state: Arc::new(TerminalState {
                windows: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl TerminalService {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts a new session running the detected default shell (see
    /// `shell::detect_shell`) as an interactive session. Checks
    /// `trust.require_trusted` before ever touching `portable_pty` — "trust
    /// gate before spawn", exactly as `docs/research/2026-07-24-pty-terminal.md`
    /// requires. `sink` is the caller-supplied (production: real `emit_to`;
    /// tests: recording) output destination for this one session — see
    /// [`TerminalOutputSink`]'s doc for why the command layer, not this
    /// method, is what constructs it.
    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        &self,
        trust: &TrustService,
        workspace: &WorkspaceService,
        window_label: &str,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        sink: Arc<dyn TerminalOutputSink>,
    ) -> Result<TerminalSessionId, CommandError> {
        trust.require_trusted(workspace, window_label).await?;
        let resolved_cwd = resolve_cwd(workspace, window_label, cwd)?;
        let shell_path = shell::detect_shell(std::env::var("SHELL").ok().as_deref());
        let command = CommandBuilder::new(&shell_path);
        self.spawn_session(window_label, resolved_cwd, command, cols, rows, sink)
            .await
    }

    /// Test-only seam: identical to [`Self::start`] except the caller
    /// supplies the exact `CommandBuilder` (program + args) to spawn and an
    /// injectable [`TerminalOutputSink`], so tests can drive a small,
    /// fully-deterministic fixture process (`cat`, `sh -c '...'`, …) instead
    /// of the ambient real login shell, and observe output/exit
    /// synchronously instead of needing a live Tauri `AppHandle`. Still goes
    /// through the exact same trust gate, `cwd` validation, env allowlist
    /// and session-limit/thread machinery as production `start` — only the
    /// spawned program and the sink are substituted.
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn start_with_command_for_test(
        &self,
        trust: &TrustService,
        workspace: &WorkspaceService,
        window_label: &str,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        command: CommandBuilder,
        sink: Arc<dyn TerminalOutputSink>,
    ) -> Result<TerminalSessionId, CommandError> {
        trust.require_trusted(workspace, window_label).await?;
        let resolved_cwd = resolve_cwd(workspace, window_label, cwd)?;
        self.spawn_session(window_label, resolved_cwd, command, cols, rows, sink)
            .await
    }

    async fn spawn_session(
        &self,
        window_label: &str,
        cwd: PathBuf,
        mut command: CommandBuilder,
        cols: u16,
        rows: u16,
        sink: Arc<dyn TerminalOutputSink>,
    ) -> Result<TerminalSessionId, CommandError> {
        command.cwd(&cwd);
        shell::apply_env_allowlist(&mut command, std::env::vars());

        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            // The whole spawn (limit check through thread creation) runs
            // while holding the single window table lock: this makes the
            // session-limit check and the eventual insert atomic (no two
            // concurrent `start` calls for the same window can both pass
            // the check and together exceed the limit), at the cost of
            // serializing concurrent starts across *every* window against
            // each other too. Acceptable: starting a terminal is a rare,
            // human-triggered action and `openpty`+spawn is fast.
            let mut windows = lock(&state.windows);
            let sessions = windows.entry(window_label).or_default();
            if sessions.len() >= MAX_TERMINAL_SESSIONS_PER_WINDOW {
                return Err(terminal_session_limit_exceeded());
            }

            let pty_system = native_pty_system();
            let size = PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            };
            let pair = pty_system
                .openpty(size)
                .map_err(|_| terminal_unavailable())?;
            let mut child = pair
                .slave
                .spawn_command(command)
                .map_err(|_| terminal_unavailable())?;
            // The parent no longer needs the slave end once the child has
            // it; dropping it *here* (rather than only when the whole pair
            // eventually drops) is what lets the master `read()` below
            // observe real end-of-file once the child exits, instead of
            // hanging forever behind our own otherwise-dangling slave
            // reference — see the module doc.
            drop(pair.slave);

            let killer = child.clone_killer();
            let reader = pair
                .master
                .try_clone_reader()
                .map_err(|_| terminal_unavailable())?;
            // `take_writer` may only ever be called once per master; doing
            // it eagerly here (rather than lazily inside `input`) is what
            // keeps the input path available for the session's whole
            // lifetime.
            let writer = pair
                .master
                .take_writer()
                .map_err(|_| terminal_unavailable())?;

            let session_id = TerminalSessionId::new();
            let flow = Arc::new(FlowControl::new());
            let session = Arc::new(TerminalSession {
                flow: Arc::clone(&flow),
                master: Mutex::new(pair.master),
                writer: Mutex::new(writer),
                killer: Mutex::new(killer),
                threads: Mutex::new(SessionThreads {
                    reader: None,
                    delivery: None,
                    waiter: None,
                }),
            });

            let (sender, receiver) =
                mpsc::sync_channel::<TerminalChunk>(TERMINAL_CHUNK_QUEUE_CAPACITY);

            let reader_flow = Arc::clone(&flow);
            let reader_thread = std::thread::Builder::new()
                .name(format!("plain-terminal-{}", session_id.as_wire()))
                .spawn(move || run_reader(reader, &reader_flow, &sender))
                .ok();

            let delivery_sink = Arc::clone(&sink);
            let delivery_thread = std::thread::Builder::new()
                .name(format!("plain-terminal-emit-{}", session_id.as_wire()))
                .spawn(move || run_delivery(session_id, &receiver, delivery_sink.as_ref()))
                .ok();

            let waiter_flow = Arc::clone(&flow);
            let waiter_sink = Arc::clone(&sink);
            let waiter_thread = std::thread::Builder::new()
                .name(format!("plain-terminal-wait-{}", session_id.as_wire()))
                .spawn(move || {
                    run_waiter(
                        session_id,
                        child.as_mut(),
                        &waiter_flow,
                        waiter_sink.as_ref(),
                    )
                })
                .ok();

            {
                let mut threads = lock(&session.threads);
                threads.reader = reader_thread;
                threads.delivery = delivery_thread;
                threads.waiter = waiter_thread;
            }

            sessions.insert(session_id, session);
            Ok(session_id)
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// Writes `data` to the session's pty master (i.e., feeds it to the
    /// child process's stdin-equivalent). Runs on a blocking thread: a full
    /// pty input buffer can make the underlying `write` genuinely block.
    pub async fn input(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        data: Vec<u8>,
    ) -> Result<(), CommandError> {
        let session = self.get_session(window_label, session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            let mut writer = lock(&session.writer);
            writer.write_all(&data).map_err(|_| terminal_io_failed())?;
            writer.flush().map_err(|_| terminal_io_failed())
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// Resizes the pty (and signals the child, per `TIOCSWINSZ` semantics).
    pub async fn resize(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        cols: u16,
        rows: u16,
    ) -> Result<(), CommandError> {
        let session = self.get_session(window_label, session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            let master = lock(&session.master);
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|_| terminal_io_failed())
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// Acknowledges `byte_count` bytes of previously-delivered output,
    /// reducing the session's unacknowledged count and resuming a paused
    /// reader once it drops to the low water mark — pure in-memory
    /// bookkeeping (see `flow::FlowControl::ack`), so unlike the other
    /// operations this never needs `spawn_blocking`.
    pub fn ack(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        byte_count: u32,
    ) -> Result<(), CommandError> {
        let session = self.get_session(window_label, session_id)?;
        session.flow.ack(byte_count as usize);
        Ok(())
    }

    /// Terminates a session: `immediate: true` blocks until the child is
    /// dead and every one of its threads has been joined (the caller can
    /// rely on full teardown having completed the instant this returns);
    /// `immediate: false` still signals the same kill immediately, but
    /// detaches (does not join) the session's threads, letting the natural
    /// EOF/exit sequence finish unwinding in the background while this call
    /// itself returns promptly. Either way the session is removed from the
    /// window's table before this returns — a killed session is gone from
    /// this window's perspective as soon as the kill has been requested,
    /// regardless of exactly when its background threads finish winding
    /// down.
    pub async fn kill(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        immediate: bool,
    ) -> Result<(), CommandError> {
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let session = {
                let mut windows = lock(&state.windows);
                let sessions = windows
                    .get_mut(&window_label)
                    .ok_or_else(terminal_session_not_found)?;
                sessions
                    .remove(&session_id)
                    .ok_or_else(terminal_session_not_found)?
            };
            terminate_session(&session, immediate);
            Ok(())
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// Kills every session belonging to `window_label` and joins every one
    /// of their threads before returning — the third `on_window_event`
    /// cleanup call `lib.rs` wires alongside `WorkspaceService::close_window`
    /// and `BackupService::close_window`. Every session's kill+join runs on
    /// its own thread so this call's own wall-clock cost is bounded by the
    /// single slowest session's teardown rather than their sum.
    pub fn close_window(&self, window_label: &str) {
        let sessions: Vec<Arc<TerminalSession>> = {
            let mut windows = lock(&self.state.windows);
            windows
                .remove(window_label)
                .map(|table| table.into_values().collect())
                .unwrap_or_default()
        };
        let joiners: Vec<JoinHandle<()>> = sessions
            .into_iter()
            .map(|session| std::thread::spawn(move || terminate_session(&session, true)))
            .collect();
        for joiner in joiners {
            let _ = joiner.join();
        }
    }

    fn get_session(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
    ) -> Result<Arc<TerminalSession>, CommandError> {
        let windows = lock(&self.state.windows);
        windows
            .get(window_label)
            .and_then(|sessions| sessions.get(&session_id))
            .cloned()
            .ok_or_else(terminal_session_not_found)
    }

    #[cfg(test)]
    pub(crate) fn session_count_for_test(&self, window_label: &str) -> usize {
        lock(&self.state.windows)
            .get(window_label)
            .map_or(0, HashMap::len)
    }

    #[cfg(test)]
    pub(crate) fn is_paused_for_test(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
    ) -> Result<bool, CommandError> {
        let session = self.get_session(window_label, session_id)?;
        Ok(session.flow.is_paused())
    }
}

/// Resolves and validates `cwd`: if provided, it must canonicalize to a path
/// inside (or exactly equal to) one of `window_label`'s currently authorized
/// workspace roots; if omitted, the first authorized root is used. See
/// `workspace::WorkspaceScope::root_canonical_paths`'s doc comment for why
/// this specific `canonicalize` + `starts_with` check is the sanctioned
/// boundary here (a spawn parameter, not capability-relative file I/O).
fn resolve_cwd(
    workspace: &WorkspaceService,
    window_label: &str,
    cwd: Option<String>,
) -> Result<PathBuf, CommandError> {
    let roots = workspace.root_canonical_paths(window_label)?;
    let Some((_, first_root)) = roots.first() else {
        // `require_trusted` already rejects the `EMPTY` workspace before
        // this is ever reached; an empty root list here would only mean
        // every root was revoked in the narrow window between that check
        // and this call. Fail closed the same way rather than assume it
        // cannot happen.
        return Err(terminal_cwd_invalid());
    };
    match cwd {
        None => Ok(first_root.clone()),
        Some(candidate) => {
            let canonical = std::fs::canonicalize(candidate).map_err(|_| terminal_cwd_invalid())?;
            let authorized = roots
                .iter()
                .any(|(_, root)| canonical == *root || canonical.starts_with(root));
            if authorized {
                Ok(canonical)
            } else {
                Err(terminal_cwd_invalid())
            }
        }
    }
}

fn run_reader(
    mut reader: Box<dyn Read + Send>,
    flow: &FlowControl,
    sender: &SyncSender<TerminalChunk>,
) {
    let mut sequence: u64 = 0;
    let mut buffer = [0_u8; TERMINAL_READ_BUFFER_BYTES];
    loop {
        if !flow.wait_until_clear_to_read() {
            return;
        }
        let read = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => read,
        };
        flow.record_read(read);
        let chunk = TerminalChunk {
            sequence,
            bytes: buffer[..read].to_vec(),
        };
        sequence = sequence.wrapping_add(1);
        if sender.send(chunk).is_err() {
            return;
        }
    }
}

fn run_delivery(
    session_id: TerminalSessionId,
    receiver: &Receiver<TerminalChunk>,
    sink: &dyn TerminalOutputSink,
) {
    while let Ok(chunk) = receiver.recv() {
        sink.emit_chunk(session_id, chunk);
    }
}

fn run_waiter(
    session_id: TerminalSessionId,
    child: &mut dyn Child,
    flow: &FlowControl,
    sink: &dyn TerminalOutputSink,
) {
    let status = child.wait();
    // Belt-and-suspenders wake for the reader — normally redundant with the
    // EOF it will already observe once the child (the only other holder of
    // the pty slave) has exited, but this closes the hypothetical gap where
    // it somehow does not, rather than leaving a paused reader parked
    // forever.
    flow.cancel();
    let exit_status = match status {
        Ok(status) => TerminalExitStatus::from(status),
        Err(_) => TerminalExitStatus {
            exit_code: u32::MAX,
            signal: None,
        },
    };
    sink.emit_exit(session_id, exit_status);
}

/// Sends the kill signal and either joins every one of the session's
/// threads (`join: true`) or detaches them (`join: false`) — see
/// [`TerminalService::kill`]'s doc for the exact contract.
fn terminate_session(session: &TerminalSession, join: bool) {
    {
        let mut killer = lock(&session.killer);
        let _ = killer.kill();
    }
    session.flow.cancel();
    let mut threads = lock(&session.threads);
    if join {
        if let Some(handle) = threads.reader.take() {
            let _ = handle.join();
        }
        if let Some(handle) = threads.delivery.take() {
            let _ = handle.join();
        }
        if let Some(handle) = threads.waiter.take() {
            let _ = handle.join();
        }
    } else {
        threads.reader = None;
        threads.delivery = None;
        threads.waiter = None;
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests;
