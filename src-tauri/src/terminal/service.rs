//! `TerminalService`: per-window PTY session lifecycle, background threads
//! and two-level backpressure. See the module doc on `terminal::mod` for the
//! subprocess-spawning security contract.
//!
//! # Per-session thread model
//!
//! Every session owns three dedicated OS threads, mirroring
//! `search::text_search`'s "one dedicated thread per streaming task"
//! precedent but split into three roles because a PTY session has three
//! independent things that can each block indefinitely on their own:
//!
//! 1. **reader** (`plain-terminal-<id>`) — the only thread that ever calls
//!    the blocking `read()` on the pty master. Before every read it calls
//!    [`flow::FlowControl::wait_until_clear_to_read`] (see "PTY → VT byte
//!    backpressure" below), then forwards each chunk it reads to the vt
//!    thread as a [`VtCommand::Feed`]. The thread ends the moment `read()`
//!    returns `0` (EOF, which happens naturally once every process holding
//!    the pty slave — the spawned child, chiefly — has exited or been
//!    killed; see [`spawn_session`]'s doc for why the parent process's own
//!    slave handle is dropped immediately after spawn) or a genuine error.
//! 2. **vt** (`plain-terminal-vt-<id>`) — the sole owner, for the session's
//!    whole lifetime, of a [`vt::VtSession`] (a `libghostty-vt` terminal fed
//!    every byte the reader thread produces). See "VT integration" and the
//!    two backpressure sections below for what it actually does with them.
//! 3. **waiter** (`plain-terminal-wait-<id>`) — owns the `Child` and calls
//!    its blocking `wait()`. `Child::kill`/`wait` cannot both be called
//!    through the same object from different threads without one blocking
//!    the other (both take `&mut self`), so a `ChildKiller` obtained via
//!    `Child::clone_killer` *before* handing `Child` to this thread is what
//!    lets [`TerminalService::kill`] terminate the process concurrently.
//!    Once `wait()` returns, this thread reports the exit status via
//!    [`TerminalOutputSink::emit_exit`]. It deliberately does **not** cancel
//!    the reader's flow gate: the exited child may still have unread bytes
//!    buffered in the pty, and the reader must drain those bytes through the
//!    VT thread before it observes the real EOF. Explicit kill/teardown uses
//!    [`terminate_session`], which still cancels the gate before joining.
//!
//!    **Known ordering caveat** (documented, not fixed): this thread's
//!    `emit_exit` call is *not* synchronized with the vt thread having
//!    drained and emitted every chunk the reader ever produced — `wait()`
//!    returning and the reader thread observing real pty EOF are woken by
//!    the same underlying "child has exited" kernel event through two
//!    independent syscalls (`waitpid` vs `read`) with no ordering primitive
//!    between them, so a real emitted `plain://terminal-exit` can in
//!    principle reach the frontend interleaved with (or fractionally before)
//!    the session's very last `plain://terminal-data` frame. The mitigation
//!    lives in `app/platform/tauri/terminal-stream.ts` instead, which does
//!    not treat "exit observed" as "no more data will arrive".
//!
//! Earlier revisions of this domain (F070 S2) also had a fourth, dedicated
//! **delivery** thread relaying raw pty bytes to the frontend. That role no
//! longer exists: since `plain://terminal-data` now carries render-state
//! frames the vt thread itself produces (see "IPC 改造" below), the vt
//! thread *is* the thing that both consumes reader output and produces what
//! gets delivered — a fourth thread doing nothing but relaying bytes nobody
//! reads anymore would be pure overhead. This is a deliberate simplification
//! stemming directly from the raw-bytes → dirty-frames semantic change, not
//! an oversight.
//!
//! # VT integration
//!
//! The vt thread is the sole owner, for the session's whole lifetime, of a
//! [`vt::VtSession`] (a `libghostty-vt` terminal mirroring the same bytes
//! the reader thread reads off the pty). `libghostty-vt`'s types are not
//! `Send`/`Sync` (see `vt.rs`'s module doc), so `VtSession` must be confined
//! to exactly one thread; this is a *separate* thread from the reader — not
//! the reader itself — for a load-bearing reason: real `libghostty-vt`
//! `feed`/render calls measured multiple milliseconds *per call* under a
//! debug-mode Zig build (`cargo test`'s default profile — see `build.rs`'s
//! `zig_optimize_mode()`), which is negligible for a human typing but easily
//! adds up to whole seconds against the high-throughput byte volumes this
//! domain's own flow-control/throughput tests deliberately generate. Doing
//! this work inline in the reader thread's loop measurably slowed the
//! *entire* pty read cycle and broke those tests' timing assumptions in
//! practice (confirmed by running them before settling on this design).
//! Giving the VT mirror its own thread means the reader's loop is completely
//! unaffected by how fast or slow VT processing happens to be.
//!
//! All communication with the vt thread goes through one channel of
//! [`VtCommand`] messages — bytes to feed, a resize, a frontend frame ack, or
//! a request/reply round trip for reading live terminal modes or scrollback
//! (both of which need the live, thread-confined `Terminal` the vt thread
//! alone holds). Unifying every input into one channel (rather than a
//! separate byte channel plus a separate synchronization primitive for
//! acks) means the vt thread's blocking `recv()` naturally wakes for
//! *anything* that might newly make it eligible to emit a frame, with no
//! extra condvar needed.
//!
//! # PTY → VT byte backpressure (unchanged in spirit from F070 S1/S2)
//!
//! [`flow::FlowControl`]'s high/low water mark still gates the reader
//! thread's `read()` calls exactly as it always has. What changed is *who
//! acks*: F070 S2 had the frontend ack raw bytes it had received over IPC;
//! since raw bytes are no longer sent to the frontend at all, that leg's
//! `ack` is now called by the **vt thread itself**, immediately after it
//! finishes `feed`-ing a chunk (`VtCommand::Feed`'s handler). This keeps the
//! same purpose the byte-level gate always had — protecting against the
//! reader racing arbitrarily far ahead of whatever actually consumes pty
//! output — just re-pointed at the vt thread's own processing pace (the
//! only real "downstream consumer" of raw bytes left in this domain) instead
//! of the frontend's.
//!
//! # VT → frontend frame delivery backpressure (new in this slice)
//!
//! A second, independent gate governs whether the vt thread actually
//! *snapshots and emits* a frame at all: at most one emitted frame may be
//! unacknowledged at a time (see [`FrameEmitGate`]). `terminal_ack` now acks
//! a **frame sequence number**, not a byte count — the frontend's
//! consumption unit changed from bytes to frames, so the ack unit follows
//! it. While a frame is outstanding, the vt thread still calls
//! [`vt::VtSession::feed`] for every chunk it receives (terminal state stays
//! current), it just does not call [`vt::VtSession::dirty_frame`] — which is
//! *destructive* (it drains dirty tracking) — until credit is available
//! again. This is what makes coalescing free: several intervening feeds
//! while credit is exhausted simply accumulate inside libghostty-vt's own
//! dirty tracking, and the next eligible `dirty_frame` call reports their
//! *union* as a single frame, with no separate buffering logic needed here.
//! This directly answers "how do we avoid the vt thread's own queue growing
//! unbounded if the frontend stalls": feeding never stalls (the channel
//! from the reader is unbounded and every `Feed` is processed as it
//! arrives), only *emission* is throttled, and libghostty-vt's own grid
//! state — not a growing list of buffered frames — is where the "backlog"
//! lives, bounded by the terminal's own viewport/scrollback size rather
//! than by how much output has accumulated.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;

use libghostty_vt::focus;
use libghostty_vt::render::Dirty;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::dto::TerminalSessionId;
use super::flow::FlowControl;
use super::shell;
use super::vt;
use super::{
    terminal_cwd_invalid, terminal_io_failed, terminal_session_limit_exceeded,
    terminal_session_not_found, terminal_unavailable, MAX_TERMINAL_SESSIONS_PER_WINDOW,
};

/// Bytes requested per blocking `read()` call against the pty master.
const TERMINAL_READ_BUFFER_BYTES: usize = 8192;

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
/// (`terminal::commands::WindowEmitSink`) calls the real Tauri `emit_to` for
/// both methods below (see the module doc); tests inject a recording
/// implementation instead, to observe frames/exit deterministically without
/// a live `AppHandle`. The command layer builds the production sink (it is
/// the one place with access to a `WebviewWindow`/`AppHandle`) and passes it
/// into [`TerminalService::start`] — mirroring exactly how
/// `search::commands::workspace_search_text_start` builds its own `wake_sink`
/// closure and hands it to `WorkspaceService::search_text_start`.
pub(crate) trait TerminalOutputSink: Send + Sync {
    fn emit_frame(&self, session_id: TerminalSessionId, sequence: u64, frame: vt::DirtyFrame);
    fn emit_exit(&self, session_id: TerminalSessionId, status: TerminalExitStatus);
}

/// Every message the vt thread's single inbound channel carries — see the
/// module doc's "VT integration" section for why these are unified into one
/// channel rather than a byte channel plus a separate synchronization
/// primitive.
enum VtCommand {
    /// A chunk of raw pty output to feed into the `libghostty-vt` terminal.
    Feed(Vec<u8>),
    /// A pty resize to mirror into the VT session (the real pty master
    /// resize itself happens independently in [`TerminalService::resize`]).
    Resize { cols: u16, rows: u16 },
    /// The frontend has applied every frame up through this sequence number
    /// — see the module doc's "VT → frontend frame delivery backpressure"
    /// section.
    Ack(u64),
    /// A request for the live terminal's current input-encoding modes (see
    /// [`vt::TerminalModesSnapshot`]), answered on the given reply channel.
    ModesRequest(SyncSender<vt::TerminalModesSnapshot>),
    /// A request for a range of scrollback rows (see
    /// [`vt::VtSession::scrollback_rows`]), answered on the given reply
    /// channel.
    ScrollbackRequest {
        start: usize,
        count: usize,
        reply: SyncSender<Vec<vt::ScrollbackRow>>,
    },
    /// Sent exactly once, by [`terminate_session`], to end the vt thread's
    /// loop deterministically — see [`terminate_session`]'s doc for why
    /// relying on channel disconnection alone is not sufficient here (the
    /// session itself keeps a live [`Sender`] for the whole session
    /// lifetime, for `ack`/`resize`/modes/scrollback requests).
    Shutdown,
}

/// Governs whether the vt thread may snapshot ([`vt::VtSession::dirty_frame`])
/// and emit a new frame right now: at most one emitted frame may be
/// unacknowledged at a time. See the module doc's "VT → frontend frame
/// delivery backpressure" section.
struct FrameEmitGate {
    next_sequence: u64,
    last_emitted_sequence: Option<u64>,
    awaiting_ack: bool,
}

impl FrameEmitGate {
    fn new() -> Self {
        Self {
            next_sequence: 0,
            last_emitted_sequence: None,
            awaiting_ack: false,
        }
    }

    /// Attempts to claim the next sequence number and snapshot a frame.
    /// Returns `None` — without touching `session`'s dirty state at all —
    /// when a previously emitted frame is still unacknowledged, or when the
    /// snapshot turns out clean (nothing changed since the last successful
    /// drain, so there is nothing worth spending the credit on).
    fn try_take_frame(&mut self, session: &mut vt::VtSession) -> Option<(u64, vt::DirtyFrame)> {
        if self.awaiting_ack {
            return None;
        }
        let frame = session.dirty_frame().ok()?;
        if frame.dirty == Dirty::Clean {
            return None;
        }
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.wrapping_add(1);
        self.last_emitted_sequence = Some(sequence);
        self.awaiting_ack = true;
        Some((sequence, frame))
    }

    /// Frees emission credit once the frontend has acked up through
    /// `acked_sequence`. Tolerant of a stale (already-superseded) or
    /// duplicate ack: only an ack that actually covers the last emitted
    /// frame clears the gate, mirroring `flow::FlowControl::ack`'s own
    /// tolerant contract for the separate byte-level leg.
    fn ack(&mut self, acked_sequence: u64) {
        if self
            .last_emitted_sequence
            .is_some_and(|last| acked_sequence >= last)
        {
            self.awaiting_ack = false;
        }
    }
}

struct SessionThreads {
    reader: Option<JoinHandle<()>>,
    waiter: Option<JoinHandle<()>>,
    vt: Option<JoinHandle<()>>,
}

struct TerminalSession {
    flow: Arc<FlowControl>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    threads: Mutex<SessionThreads>,
    /// The vt thread's latest emitted [`vt::DirtyFrame`], if any yet — see
    /// the module doc's "VT integration" section. Written by the vt thread
    /// every time it emits; read today only by
    /// `TerminalService::latest_vt_frame_for_test` (`#[cfg(test)]`) — the
    /// real production reader is `WindowEmitSink::emit_frame`'s caller, the
    /// vt thread itself, which passes the frame straight to the sink rather
    /// than reading it back out of here.
    #[allow(dead_code)]
    vt_frame: Arc<Mutex<Option<vt::DirtyFrame>>>,
    /// The vt thread's inbound channel — see [`VtCommand`]. Kept alive for
    /// the session's whole lifetime (not just the reader thread's) so
    /// `ack`/`resize`/`input_key`/`focus`/`scrollback` can each send into it
    /// at any point in the session's life, not only while the reader thread
    /// is still running.
    vt_sender: Sender<VtCommand>,
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
        let (session_id, _pid) = self
            .spawn_session(window_label, resolved_cwd, command, &[], cols, rows, sink)
            .await?;
        Ok(session_id)
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
        let (session_id, _pid) = self
            .spawn_session(window_label, resolved_cwd, command, &[], cols, rows, sink)
            .await?;
        Ok(session_id)
    }

    /// `F100` S4's `runInTerminal` reverse-request entry point — **not** a
    /// Tauri command (`terminal_start` continues to only ever run the
    /// default shell); the sole caller is
    /// `debug::commands::handle_run_in_terminal_reverse_request`, itself
    /// invoked only from inside this crate's own reverse-request dispatch
    /// (never reachable from the webview/IPC boundary directly) — see that
    /// function's own doc comment for the full security reasoning (why no
    /// second confirmation dialog, why visibility is the substitute).
    ///
    /// Unlike [`Self::start`] (which always runs the ambient default shell),
    /// this runs `program`/`args` *directly* — DAP's `runInTerminal` names an
    /// actual executable to run in a visible terminal, not "open a shell
    /// here"; running it through a shell at all would be exactly the kind of
    /// shell-interpretation this codebase's spawn primitives never do (see
    /// `debug::dto::RunInTerminalArguments`'s own doc comment for why
    /// `argsCanBeInterpretedByShell` is deliberately never consulted).
    ///
    /// `cwd` is resolved via [`resolve_program_cwd`] — **not**
    /// [`resolve_cwd`]'s workspace-root containment check. This is a
    /// deliberate difference, not an oversight: `resolve_cwd`'s containment
    /// check exists to bound a `cwd` requested through the *webview-reachable*
    /// `terminal_start` IPC command (an untrusted-in-principle caller must not
    /// be able to name an arbitrary filesystem path as a spawn parameter).
    /// `runInTerminal`'s `cwd` never crosses that boundary at all — it comes
    /// from an adapter process this window has *already* spawned (past both
    /// the trust gate and the first-run confirmation gate), which by that
    /// point can already run anything, anywhere, as the current OS user
    /// regardless of what this function does; reusing the containment check
    /// here would only produce confusing failures for legitimate debuggees
    /// whose own working directory is not a currently-open workspace root
    /// (e.g. a globally installed script), without adding any real
    /// restriction on an already-fully-trusted adapter.
    ///
    /// `env_overrides` are applied *after* the fixed allowlist
    /// (`shell::apply_env_allowlist`) — additive/removing on top of it, per
    /// DAP's own `env` semantics ("added to or removed from the default
    /// environment"), never replacing it outright.
    ///
    /// Returns the new session id *and* the spawned child's own OS process id
    /// (`None` if the platform could not report one) — the latter answers
    /// DAP's `runInTerminal` response's `body.processId` with the debuggee's
    /// real PID (this function never wraps the program in a shell, so the
    /// immediate child *is* the debuggee itself — there is no separate "shell
    /// process" to also report as `shellProcessId`).
    #[allow(clippy::too_many_arguments)]
    pub async fn start_program(
        &self,
        trust: &TrustService,
        workspace: &WorkspaceService,
        window_label: &str,
        cwd: String,
        program: String,
        args: Vec<String>,
        env_overrides: Vec<(String, Option<String>)>,
        cols: u16,
        rows: u16,
        sink: Arc<dyn TerminalOutputSink>,
    ) -> Result<(TerminalSessionId, Option<u32>), CommandError> {
        trust.require_trusted(workspace, window_label).await?;
        let resolved_cwd = resolve_program_cwd(&cwd)?;
        let mut command = CommandBuilder::new(&program);
        command.args(&args);
        self.spawn_session(
            window_label,
            resolved_cwd,
            command,
            &env_overrides,
            cols,
            rows,
            sink,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn spawn_session(
        &self,
        window_label: &str,
        cwd: PathBuf,
        mut command: CommandBuilder,
        extra_env: &[(String, Option<String>)],
        cols: u16,
        rows: u16,
        sink: Arc<dyn TerminalOutputSink>,
    ) -> Result<(TerminalSessionId, Option<u32>), CommandError> {
        command.cwd(&cwd);
        shell::apply_env_allowlist(&mut command, std::env::vars());
        // Applied *after* the fixed allowlist, so a `runInTerminal` caller's
        // own `env` (additions/removals "on top of the default environment",
        // per DAP) can both add names the allowlist does not and remove ones
        // it does — never the other way around (the allowlist itself is not
        // weakened for the ordinary `start`/`start_with_command_for_test`
        // callers, which both pass an empty slice here).
        for (key, value) in extra_env {
            match value {
                Some(value) => command.env(key, value),
                None => command.env_remove(key),
            };
        }

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
            // Captured before `child` is moved into the waiter thread's
            // closure below — `Child::process_id` only ever needs `&self`,
            // but the waiter thread takes ownership for its whole lifetime
            // (see [`run_waiter`]), so this is the last point this value is
            // reachable at all. Since this session never wraps `command` in
            // a shell (every caller — `start`/`start_with_command_for_test`/
            // `start_program` — spawns the target program directly), this is
            // always the real, immediate child process's own OS pid, never a
            // shell's — the exact value `TerminalService::start_program`'s
            // callers need to answer DAP's `runInTerminal` response.
            let child_pid = child.process_id();
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
            let vt_frame = Arc::new(Mutex::new(None));
            let (vt_sender, vt_receiver) = mpsc::channel::<VtCommand>();
            let session = Arc::new(TerminalSession {
                flow: Arc::clone(&flow),
                master: Mutex::new(pair.master),
                writer: Mutex::new(writer),
                killer: Mutex::new(killer),
                threads: Mutex::new(SessionThreads {
                    reader: None,
                    waiter: None,
                    vt: None,
                }),
                vt_frame: Arc::clone(&vt_frame),
                vt_sender: vt_sender.clone(),
            });

            let reader_flow = Arc::clone(&flow);
            let reader_vt_sender = vt_sender;
            let reader_thread = std::thread::Builder::new()
                .name(format!("plain-terminal-{}", session_id.as_wire()))
                .spawn(move || run_reader(reader, &reader_flow, &reader_vt_sender))
                .ok();

            let waiter_sink = Arc::clone(&sink);
            let waiter_thread = std::thread::Builder::new()
                .name(format!("plain-terminal-wait-{}", session_id.as_wire()))
                .spawn(move || run_waiter(session_id, child.as_mut(), waiter_sink.as_ref()))
                .ok();

            let vt_flow = Arc::clone(&flow);
            let vt_thread = std::thread::Builder::new()
                .name(format!("plain-terminal-vt-{}", session_id.as_wire()))
                .spawn(move || {
                    run_vt(
                        cols,
                        rows,
                        &vt_receiver,
                        &vt_flow,
                        &vt_frame,
                        session_id,
                        sink.as_ref(),
                    )
                })
                .ok();

            {
                let mut threads = lock(&session.threads);
                threads.reader = reader_thread;
                threads.waiter = waiter_thread;
                threads.vt = vt_thread;
            }

            sessions.insert(session_id, session);
            Ok((session_id, child_pid))
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// Writes `text` (an IME composition commit, or a pasted block) to the
    /// session's pty master as its own UTF-8 bytes — no key encoding
    /// involved, unlike [`Self::input_key`].
    pub async fn input_text(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        text: String,
    ) -> Result<(), CommandError> {
        let session = self.get_session(window_label, session_id)?;
        tauri::async_runtime::spawn_blocking(move || write_bytes(&session, text.into_bytes()))
            .await
            .map_err(|_| terminal_unavailable())?
    }

    /// Encodes one structured key event through `libghostty-vt`'s own
    /// encoder — using a live-terminal-modes snapshot fetched from the vt
    /// thread (see [`vt::TerminalModesSnapshot`]) — and writes the resulting
    /// bytes to the session's pty master.
    pub async fn input_key(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        input: vt::KeyInput,
    ) -> Result<(), CommandError> {
        let session = self.get_session(window_label, session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            let modes = request_modes_snapshot(&session);
            let bytes =
                vt::encode_key_event(&input, modes.key).map_err(|_| terminal_io_failed())?;
            if bytes.is_empty() {
                return Ok(());
            }
            write_bytes(&session, bytes)
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// Reports a focus gained/lost transition. Writes the encoded focus
    /// escape sequence to the pty only if the session's live terminal
    /// currently has focus-reporting mode (DEC 1004) enabled — see
    /// [`vt::TerminalModesSnapshot::focus_reporting_enabled`]; otherwise this
    /// is a silent no-op (`Ok(())`), not an error.
    pub async fn focus(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        focused: bool,
    ) -> Result<(), CommandError> {
        let session = self.get_session(window_label, session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            let modes = request_modes_snapshot(&session);
            if !modes.focus_reporting_enabled {
                return Ok(());
            }
            let event = if focused {
                focus::Event::Gained
            } else {
                focus::Event::Lost
            };
            let bytes = vt::encode_focus_event(event).map_err(|_| terminal_io_failed())?;
            write_bytes(&session, bytes)
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// Resizes the pty (and signals the child, per `TIOCSWINSZ` semantics),
    /// then mirrors the new size into the VT session — the latter forces
    /// the next emitted frame to be a full redraw (see
    /// `vt::VtSession::resize`'s doc).
    pub async fn resize(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        cols: u16,
        rows: u16,
    ) -> Result<(), CommandError> {
        let session = self.get_session(window_label, session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            {
                let master = lock(&session.master);
                master
                    .resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    })
                    .map_err(|_| terminal_io_failed())?;
            }
            // Best-effort: a disconnected vt thread just means this
            // session's VT mirror is already gone (e.g. its `VtSession`
            // never constructed) — never a reason to fail the real pty
            // resize that already succeeded above.
            let _ = session.vt_sender.send(VtCommand::Resize { cols, rows });
            Ok(())
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// Acknowledges every `plain://terminal-data` frame up through
    /// `sequence`, freeing the vt thread's single-frame-in-flight emission
    /// credit — see the module doc's "VT → frontend frame delivery
    /// backpressure" section. Pure message hand-off (never blocks), so
    /// unlike the other operations this never needs `spawn_blocking`.
    pub fn ack(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        sequence: u64,
    ) -> Result<(), CommandError> {
        let session = self.get_session(window_label, session_id)?;
        let _ = session.vt_sender.send(VtCommand::Ack(sequence));
        Ok(())
    }

    /// Reads up to `count` scrollback rows starting at history row `start`
    /// — see `vt::VtSession::scrollback_rows`'s doc for the exact semantics.
    /// A disconnected/unavailable vt thread yields an empty result rather
    /// than an error, matching this domain's existing best-effort VT
    /// integration philosophy.
    pub async fn scrollback(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
        start: usize,
        count: usize,
    ) -> Result<Vec<vt::ScrollbackRow>, CommandError> {
        let session = self.get_session(window_label, session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            let (reply, reply_rx) = mpsc::sync_channel(1);
            if session
                .vt_sender
                .send(VtCommand::ScrollbackRequest {
                    start,
                    count,
                    reply,
                })
                .is_err()
            {
                return Ok(Vec::new());
            }
            Ok(reply_rx.recv().unwrap_or_default())
        })
        .await
        .map_err(|_| terminal_unavailable())?
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

    /// The vt thread's most recently emitted [`vt::DirtyFrame`] for this
    /// session, if it has emitted one yet — see the module doc's "VT
    /// integration" section. `None` either means no frame has been emitted
    /// yet (a benign race the caller should simply retry) or that this
    /// session's `VtSession` failed to construct.
    #[cfg(test)]
    pub(crate) fn latest_vt_frame_for_test(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
    ) -> Result<Option<vt::DirtyFrame>, CommandError> {
        let session = self.get_session(window_label, session_id)?;
        let frame = lock(&session.vt_frame).clone();
        Ok(frame)
    }

    /// Test-only seam onto [`request_modes_snapshot`] — production code
    /// only ever needs the modes snapshot as an internal step of
    /// [`Self::input_key`]/[`Self::focus`]; tests use this to observe the
    /// live-modes round trip (and gate conditions derived from it, like
    /// `focus_reporting_enabled`) directly.
    #[cfg(test)]
    pub(crate) fn modes_snapshot_for_test(
        &self,
        window_label: &str,
        session_id: TerminalSessionId,
    ) -> Result<vt::TerminalModesSnapshot, CommandError> {
        let session = self.get_session(window_label, session_id)?;
        Ok(request_modes_snapshot(&session))
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

/// [`TerminalService::start_program`]'s own `cwd` resolution — canonicalizes
/// (rejecting anything that does not exist) but, unlike [`resolve_cwd`],
/// deliberately does **not** check containment within any currently
/// authorized workspace root. See [`TerminalService::start_program`]'s own
/// doc comment for the full reasoning: that containment check exists to
/// bound a `cwd` reachable from the untrusted-in-principle webview/IPC
/// boundary, which a `runInTerminal` reverse request never crosses at all.
fn resolve_program_cwd(cwd: &str) -> Result<PathBuf, CommandError> {
    std::fs::canonicalize(cwd).map_err(|_| terminal_cwd_invalid())
}

/// Writes `data` to the session's pty master (i.e., feeds it to the child
/// process's stdin-equivalent) — the shared tail of
/// [`TerminalService::input_text`]/[`TerminalService::input_key`]/
/// [`TerminalService::focus`], all of which differ only in how they produce
/// `data`.
fn write_bytes(session: &TerminalSession, data: Vec<u8>) -> Result<(), CommandError> {
    let mut writer = lock(&session.writer);
    writer.write_all(&data).map_err(|_| terminal_io_failed())?;
    writer.flush().map_err(|_| terminal_io_failed())
}

/// Fetches the live terminal's current input-encoding modes from the vt
/// thread (see [`vt::TerminalModesSnapshot`]), falling back to the
/// terminal's own defaults (no modes enabled, focus-reporting off) if the
/// vt thread is unavailable (disconnected channel) or does not answer —
/// matching this domain's existing best-effort VT integration philosophy:
/// key/focus input must still work even without a live VT mirror, just
/// without terminal-mode-aware encoding.
fn request_modes_snapshot(session: &TerminalSession) -> vt::TerminalModesSnapshot {
    let fallback = vt::TerminalModesSnapshot {
        key: vt::KeyEncodeModes::default(),
        focus_reporting_enabled: false,
    };
    let (reply, reply_rx) = mpsc::sync_channel(1);
    if session
        .vt_sender
        .send(VtCommand::ModesRequest(reply))
        .is_err()
    {
        return fallback;
    }
    reply_rx.recv().unwrap_or(fallback)
}

fn run_reader(mut reader: Box<dyn Read + Send>, flow: &FlowControl, vt_sender: &Sender<VtCommand>) {
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
        if vt_sender
            .send(VtCommand::Feed(buffer[..read].to_vec()))
            .is_err()
        {
            return;
        }
    }
}

/// Owns this session's [`vt::VtSession`] for the session's whole lifetime —
/// see the module doc's "VT integration" section for why this lives on its
/// own thread. Ends when a [`VtCommand::Shutdown`] is received (sent
/// exactly once, by [`terminate_session`]) — see that function's doc for
/// why relying on channel disconnection alone is not enough here.
#[allow(clippy::too_many_arguments)]
fn run_vt(
    cols: u16,
    rows: u16,
    receiver: &Receiver<VtCommand>,
    flow: &FlowControl,
    vt_frame: &Mutex<Option<vt::DirtyFrame>>,
    session_id: TerminalSessionId,
    sink: &dyn TerminalOutputSink,
) {
    let Ok(mut session) = vt::VtSession::new(cols, rows) else {
        return;
    };
    let mut gate = FrameEmitGate::new();
    while let Ok(command) = receiver.recv() {
        match command {
            VtCommand::Shutdown => return,
            VtCommand::Feed(bytes) => {
                session.feed(&bytes);
                // PTY → VT backpressure — see the module doc's "PTY → VT
                // byte backpressure" section for why the vt thread (rather
                // than the frontend) is what acks here now.
                flow.ack(bytes.len());
                attempt_emit(&mut session, &mut gate, vt_frame, session_id, sink);
            }
            VtCommand::Resize { cols, rows } => {
                if session.resize(cols, rows).is_ok() {
                    attempt_emit(&mut session, &mut gate, vt_frame, session_id, sink);
                }
            }
            VtCommand::Ack(sequence) => {
                gate.ack(sequence);
                attempt_emit(&mut session, &mut gate, vt_frame, session_id, sink);
            }
            VtCommand::ModesRequest(reply) => {
                let _ = reply.send(session.modes_snapshot());
            }
            VtCommand::ScrollbackRequest {
                start,
                count,
                reply,
            } => {
                let rows = session.scrollback_rows(start, count).unwrap_or_default();
                let _ = reply.send(rows);
            }
        }
    }
}

/// Attempts to take and emit the next eligible frame — see
/// [`FrameEmitGate::try_take_frame`]. Updates [`TerminalSession::vt_frame`]
/// and calls [`TerminalOutputSink::emit_frame`] exactly once per successful
/// attempt; a no-op (no state touched at all) when the gate declines.
fn attempt_emit(
    session: &mut vt::VtSession,
    gate: &mut FrameEmitGate,
    vt_frame: &Mutex<Option<vt::DirtyFrame>>,
    session_id: TerminalSessionId,
    sink: &dyn TerminalOutputSink,
) {
    if let Some((sequence, frame)) = gate.try_take_frame(session) {
        *lock(vt_frame) = Some(frame.clone());
        sink.emit_frame(session_id, sequence, frame);
    }
}

fn run_waiter(session_id: TerminalSessionId, child: &mut dyn Child, sink: &dyn TerminalOutputSink) {
    let status = child.wait();
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
///
/// Explicitly sends [`VtCommand::Shutdown`] before ever attempting to join
/// the vt thread: unlike the F070 S2 design (where only the reader thread
/// held the vt channel's sending half, so the reader ending naturally
/// disconnected it), [`TerminalSession::vt_sender`] is now also kept alive
/// by the session itself for its whole lifetime (`ack`/`resize`/input/
/// scrollback all send through it), so the channel would never disconnect
/// on its own while this function still holds `&session` — an explicit
/// shutdown message is what lets the vt thread's blocking `recv()` return
/// deterministically instead of the `join` below deadlocking.
fn terminate_session(session: &TerminalSession, join: bool) {
    {
        let mut killer = lock(&session.killer);
        let _ = killer.kill();
    }
    session.flow.cancel();
    let _ = session.vt_sender.send(VtCommand::Shutdown);
    let mut threads = lock(&session.threads);
    if join {
        if let Some(handle) = threads.reader.take() {
            let _ = handle.join();
        }
        if let Some(handle) = threads.waiter.take() {
            let _ = handle.join();
        }
        if let Some(handle) = threads.vt.take() {
            let _ = handle.join();
        }
    } else {
        threads.reader = None;
        threads.waiter = None;
        threads.vt = None;
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests;
