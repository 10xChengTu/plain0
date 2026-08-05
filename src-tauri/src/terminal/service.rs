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
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use libghostty_vt::focus;
use libghostty_vt::render::Dirty;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::backup::{store as backup_store, BackupKey};
use crate::error::CommandError;
use crate::remote::remote_terminal::{
    self, RemoteTerminalExitOutcome, RemoteTerminalKiller, RemoteTerminalResizer,
    RemoteTerminalWaiter,
};
use crate::remote::session::RemoteSessionService;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;
use crate::workspace::{RemoteRootContext, RootId};

use super::dto::TerminalSessionId;
use super::flow::FlowControl;
use super::shell;
use super::shell_integration::{self, ShellIntegrationStatus};
use super::vt;
use super::{
    terminal_cwd_invalid, terminal_io_failed, terminal_profile_invalid,
    terminal_session_limit_exceeded, terminal_session_not_found, terminal_unavailable,
    MAX_TERMINAL_SESSIONS_PER_WINDOW,
};

/// `F220` S5: the fixed placeholder `signal` text an emitted
/// `plain://terminal-exit` carries whenever a remote terminal's SSH channel
/// closed (or was force-released — see `remote::remote_terminal`'s own doc)
/// without ever reporting a real `exit-status`/`exit-signal` — the
/// "断连型退出状态,不伪装成正常退出" the S5 contract requires. Reuses
/// [`TerminalExitStatus`]'s existing `signal` field rather than widening the
/// wire DTO at all (`terminal::dto::TerminalExitEvent` already treats any
/// non-`null` `signal` as "not a normal exit, `exitCode` is not meaningful
/// on its own" — see that type's own doc comment — so this reads correctly
/// in the exit banner with zero frontend changes).
pub(crate) const REMOTE_TERMINAL_DISCONNECTED_SIGNAL: &str = "SSH session disconnected";

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
    /// The raw (pre-relativization — see [`relativize_pwd`]) `pwd` of the
    /// last frame this gate actually emitted. Compared against each new
    /// snapshot's `pwd` so a pure OSC 7 write (metadata only, no cell
    /// writes at all) still gets emitted even though `libghostty-vt`'s own
    /// `Dirty` tracking would otherwise report `Clean` for it — without
    /// this, `pwd` could go stale until the next unrelated screen update.
    last_pwd: Option<String>,
}

impl FrameEmitGate {
    fn new() -> Self {
        Self {
            next_sequence: 0,
            last_emitted_sequence: None,
            awaiting_ack: false,
            last_pwd: None,
        }
    }

    /// Attempts to claim the next sequence number and snapshot a frame.
    /// Returns `None` — without touching `session`'s dirty state at all —
    /// when a previously emitted frame is still unacknowledged, or when the
    /// snapshot turns out clean *and* `pwd` did not change (nothing changed
    /// since the last successful drain, so there is nothing worth spending
    /// the credit on).
    fn try_take_frame(&mut self, session: &mut vt::VtSession) -> Option<(u64, vt::DirtyFrame)> {
        if self.awaiting_ack {
            return None;
        }
        let frame = session.dirty_frame().ok()?;
        let pwd_changed = frame.pwd != self.last_pwd;
        if frame.dirty == Dirty::Clean && !pwd_changed {
            return None;
        }
        self.last_pwd = frame.pwd.clone();
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

/// `F220` S5: the closed, two-variant PTY-control backend a session's
/// [`TerminalService::resize`] dispatches through — `Local` is byte-for-byte
/// the pre-S5 shape (`portable_pty`'s own `MasterPty::resize`); `Remote`
/// defers to `remote::remote_terminal::RemoteTerminalResizer::window_change`
/// (an SSH `window-change` channel request). Neither the reader/vt/waiter
/// thread model nor `FlowControl`'s backpressure gate above this needs to
/// know which variant a given session holds — resize is the *only* thing
/// this abstraction exists for, exactly like the pre-S5 `master` field it
/// replaces was.
enum PtyResizer {
    Local(Box<dyn MasterPty + Send>),
    Remote(RemoteTerminalResizer),
}

impl PtyResizer {
    fn resize(&self, cols: u16, rows: u16) -> Result<(), CommandError> {
        match self {
            Self::Local(master) => master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|_| terminal_io_failed()),
            Self::Remote(resizer) => resizer.window_change(cols, rows),
        }
    }
}

/// `F220` S5: the closed, two-variant kill backend [`terminate_session`]
/// dispatches through — `Local` is byte-for-byte the pre-S5 shape
/// (`portable_pty`'s own `ChildKiller::kill`, a `SIGKILL`-equivalent signal
/// to the child process); `Remote` defers to
/// `remote::remote_terminal::RemoteTerminalKiller::shutdown` (`eof`/`close`
/// then a bounded-grace forced local release — see that method's own doc
/// comment for why a remote kill can never simply "wait for the process to
/// die" the way a local one's `wait()` companion thread does).
enum PtyKiller {
    Local(Box<dyn ChildKiller + Send + Sync>),
    Remote(RemoteTerminalKiller),
}

impl PtyKiller {
    fn kill(&mut self) -> Result<(), CommandError> {
        match self {
            Self::Local(killer) => killer.kill().map_err(|_| terminal_io_failed()),
            Self::Remote(killer) => killer.shutdown(),
        }
    }
}

/// `F220` S5: the closed, two-variant waiter-thread backend [`run_waiter`]
/// dispatches through — `Local` mirrors this file's pre-S5 `run_waiter` body
/// exactly (a real `portable_pty::Child::wait()`, mapped through
/// [`TerminalExitStatus::from`]); `Remote` maps
/// `remote::remote_terminal::RemoteTerminalExitOutcome` (see that type's own
/// doc comment) onto the exact same [`TerminalExitStatus`] shape — a real
/// `exit-status`/`exit-signal` channel request maps to the equivalent
/// `exit_code`/`signal` pair a local exit would produce, while
/// `Disconnected` (channel closed, or force-released, without either) maps
/// to [`REMOTE_TERMINAL_DISCONNECTED_SIGNAL`] — a non-`null` `signal`, so the
/// existing exit banner renders it as an abnormal termination, never a
/// disguised normal exit.
enum PtyWaiter {
    Local(Box<dyn Child + Send + Sync>),
    Remote(RemoteTerminalWaiter),
}

impl PtyWaiter {
    fn wait(&mut self) -> TerminalExitStatus {
        match self {
            Self::Local(child) => match child.wait() {
                Ok(status) => TerminalExitStatus::from(status),
                Err(_) => TerminalExitStatus {
                    exit_code: u32::MAX,
                    signal: None,
                },
            },
            Self::Remote(waiter) => match waiter.wait_exit() {
                RemoteTerminalExitOutcome::Exited { code } => TerminalExitStatus {
                    exit_code: code,
                    signal: None,
                },
                RemoteTerminalExitOutcome::Signaled { signal } => TerminalExitStatus {
                    exit_code: 1,
                    signal: Some(signal),
                },
                RemoteTerminalExitOutcome::Disconnected => TerminalExitStatus {
                    exit_code: u32::MAX,
                    signal: Some(REMOTE_TERMINAL_DISCONNECTED_SIGNAL.to_owned()),
                },
            },
        }
    }
}

struct TerminalSession {
    flow: Arc<FlowControl>,
    resizer: Mutex<PtyResizer>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<PtyKiller>,
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
    /// `F190` S6 "跨进程不伪造 session restore" — see
    /// [`TerminalLifecycleMarkerStore`]'s own doc comment.
    lifecycle: TerminalLifecycleMarkerStore,
}

impl TerminalService {
    /// `base_path` is the same app-local state directory every other
    /// persisted domain (`backup`, `scratch`, `recent`, `user_data`, …)
    /// receives from `lib.rs`'s `.setup()` — used only for this service's
    /// own `F190` S6 lifecycle marker (see [`TerminalLifecycleMarkerStore`]);
    /// every other part of this domain remains purely in-memory, matching
    /// its pre-`F190`-S6 shape (`不伪造 session restore` — a session's own
    /// PTY/threads are never themselves persisted or reconnected).
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(TerminalState {
                windows: Mutex::new(HashMap::new()),
                lifecycle: TerminalLifecycleMarkerStore::new(base_path),
            }),
        }
    }

    /// Starts a new session running the detected default shell (see
    /// `shell::detect_shell`) as an interactive session. Checks
    /// `trust.require_trusted` before ever touching `portable_pty` — "trust
    /// gate before spawn", exactly as `docs/research/2026-07-24-pty-terminal.md`
    /// requires. `sink` is the caller-supplied (production: real `emit_to`;
    /// tests: recording) output destination for this one session — see
    /// [`TerminalOutputSink`]'s doc for why the command layer, not this
    /// method, is what constructs it.
    /// Also decides and applies this session's shell-integration injection
    /// plan (F190 S4, `terminal::shell_integration`) — the returned
    /// [`ShellIntegrationStatus`] is what `terminal_start` hands back to the
    /// frontend as `TerminalStartResult::shell_integration`, so a degraded
    /// (unsupported shell, or the injected files could not be written)
    /// outcome is always observable rather than silently reported as
    /// success. `root_id`'s canonical path is threaded through to the vt
    /// thread purely for OSC 7 pwd projection (see [`relativize_pwd`]) — it
    /// is never itself exposed to the frontend.
    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        &self,
        trust: &TrustService,
        workspace: &WorkspaceService,
        remote: &RemoteSessionService,
        window_label: &str,
        root_id: RootId,
        profile_id: String,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        sink: Arc<dyn TerminalOutputSink>,
    ) -> Result<(TerminalSessionId, ShellIntegrationStatus), CommandError> {
        trust.require_trusted(workspace, window_label).await?;
        // `F220` S5: a remote-backed root routes to `remote::remote_terminal`
        // *before* any of the local-only calls below — `root_canonical_path`
        // itself fails closed with `ROOT_BACKEND_UNSUPPORTED` for a remote
        // root, so this check must come first, exactly like
        // `workspace::remote_backend`'s own dispatch precedent for every
        // other domain that grew a remote twin.
        if let Some(context) = workspace.remote_context(window_label, root_id)? {
            return self
                .start_remote(
                    remote,
                    window_label,
                    context,
                    profile_id,
                    cwd,
                    cols,
                    rows,
                    sink,
                )
                .await;
        }
        let root_canonical = workspace.root_canonical_path(window_label, root_id)?;
        let resolved_cwd = resolve_cwd(workspace, window_label, root_id, cwd)?;
        let shell_path =
            shell::resolve_profile(&profile_id, std::env::var("SHELL").ok().as_deref())?;

        let integration_base = shell_integration::integration_base_dir();
        let files_ready = shell_integration::ensure_integration_files(&integration_base).is_ok();
        let plan = shell_integration::plan_for_shell(
            &shell_path,
            std::env::var("ZDOTDIR").ok().as_deref(),
            std::env::var("XDG_DATA_DIRS").ok().as_deref(),
            &integration_base,
            files_ready,
        );

        // Applies only `plan`'s *args* immediately (harmless w.r.t. env
        // timing); its *env* additions are folded into `shell_env` below
        // instead of applied directly here, because `spawn_session` calls
        // `shell::apply_env_allowlist` — which starts with `env_clear()` —
        // *after* this point. Env set before that call would simply be
        // wiped out again; env_allowlist's own `extra_env` parameter is the
        // seam meant for exactly this ("applied after the fixed allowlist"
        // — see `spawn_session`'s own comment).
        let mut command = CommandBuilder::new(&shell_path);
        if !plan.args().is_empty() {
            command.args(plan.args());
        }
        let mut shell_env = vec![(
            "SHELL".to_owned(),
            Some(shell_path.to_string_lossy().into_owned()),
        )];
        shell_env.extend(
            plan.env()
                .iter()
                .map(|(key, value)| (key.clone(), Some(value.clone()))),
        );
        let (session_id, _pid) = self
            .spawn_session(
                window_label,
                resolved_cwd,
                Some(root_canonical),
                command,
                &shell_env,
                cols,
                rows,
                sink,
            )
            .await?;
        Ok((session_id, plan.status))
    }

    /// `F220` S5: the remote-root twin of [`Self::start`] — routes to
    /// `remote::remote_terminal` instead of `portable_pty` (`trust` has
    /// already been checked by [`Self::start`], the sole caller, before this
    /// runs). Two deliberate v1 narrowings, both fail-closed rather than
    /// best-effort (see the research doc's "架构裁定 §4"):
    ///
    /// - `profile_id` must be exactly [`shell::SYSTEM_DEFAULT_PROFILE_ID`] —
    ///   v1 does no remote profile enumeration at all (the frontend disables
    ///   its own profile control for a remote root and always sends this
    ///   value; a request naming anything else is rejected rather than
    ///   silently coerced).
    /// - `cwd` must be `None` — a remote terminal always starts at the
    ///   remote user's own home directory (`remote::remote_terminal`'s own
    ///   doc comment explains why no shell-string `cd &&` workaround is
    ///   used); the frontend disables its own cwd control for a remote root
    ///   for the same reason, and a request naming one is rejected rather
    ///   than silently ignored.
    ///
    /// Shell integration is always reported [`ShellIntegrationStatus::Unsupported`]:
    /// v1 never uploads the injection files to a remote host at all (research
    /// doc: "不上传注入文件"), so there is nothing to have injected.
    #[allow(clippy::too_many_arguments)]
    async fn start_remote(
        &self,
        remote: &RemoteSessionService,
        window_label: &str,
        context: RemoteRootContext,
        profile_id: String,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        sink: Arc<dyn TerminalOutputSink>,
    ) -> Result<(TerminalSessionId, ShellIntegrationStatus), CommandError> {
        if profile_id != shell::SYSTEM_DEFAULT_PROFILE_ID {
            return Err(terminal_profile_invalid());
        }
        if cwd.is_some() {
            return Err(terminal_cwd_invalid());
        }
        self.session_capacity_gate(window_label)?;
        let handles = remote_terminal::open_remote_terminal_channel(
            remote,
            window_label,
            context.session_id,
            cols,
            rows,
        )
        .await?;
        let window_label_owned = window_label.to_owned();
        let state = Arc::clone(&self.state);
        let session_id = tauri::async_runtime::spawn_blocking(move || {
            finish_spawn_sync(
                &state,
                &window_label_owned,
                Box::new(handles.reader),
                Box::new(handles.writer),
                PtyResizer::Remote(handles.resizer),
                PtyKiller::Remote(handles.killer),
                PtyWaiter::Remote(handles.waiter),
                // No workspace-root-relative pwd projection for a remote
                // session — v1 never injects shell integration remotely (see
                // this method's own doc comment), so no OSC 7 pwd is ever
                // reported for it to project in the first place; `None`
                // mirrors `start_program`'s own identical "no workspace root
                // concept" case.
                None,
                cols,
                rows,
                sink,
            )
        })
        .await
        .map_err(|_| terminal_unavailable())??;
        Ok((session_id, ShellIntegrationStatus::Unsupported))
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
        root_id: RootId,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        command: CommandBuilder,
        sink: Arc<dyn TerminalOutputSink>,
    ) -> Result<TerminalSessionId, CommandError> {
        trust.require_trusted(workspace, window_label).await?;
        let root_canonical = workspace.root_canonical_path(window_label, root_id)?;
        let resolved_cwd = resolve_cwd(workspace, window_label, root_id, cwd)?;
        let (session_id, _pid) = self
            .spawn_session(
                window_label,
                resolved_cwd,
                Some(root_canonical),
                command,
                &[],
                cols,
                rows,
                sink,
            )
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
            // No workspace-root concept for a `runInTerminal`-launched
            // session (see this method's own doc comment) — pwd projection
            // for it is therefore always `None` (display-only info that
            // never crosses the IPC boundary for it either, since there is
            // no possible split-cwd-candidate use of it here).
            None,
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
        root_canonical: Option<PathBuf>,
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
            let child = pair
                .slave
                .spawn_command(command)
                .map_err(|_| terminal_unavailable())?;
            // Captured before `child` is moved into `PtyWaiter::Local` below
            // — `Child::process_id` only ever needs `&self`, but the waiter
            // thread takes ownership for its whole lifetime (see
            // [`run_waiter`]), so this is the last point this value is
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

            let session_id = finish_spawn_sync(
                &state,
                &window_label,
                Box::new(reader),
                Box::new(writer),
                PtyResizer::Local(pair.master),
                PtyKiller::Local(killer),
                PtyWaiter::Local(child),
                root_canonical,
                cols,
                rows,
                sink,
            )?;
            Ok((session_id, child_pid))
        })
        .await
        .map_err(|_| terminal_unavailable())?
    }

    /// `F220` S5: a cheap, best-effort pre-check against
    /// `MAX_TERMINAL_SESSIONS_PER_WINDOW` — called before either backend
    /// does its own expensive spawn work (`openpty`+`spawn_command` locally,
    /// an SSH channel-open/`pty-req`/`shell` round trip remotely), purely to
    /// avoid paying for that work in the common "already at the cap" case.
    /// [`finish_spawn_sync`]'s own check-and-insert (taken under the same
    /// `state.windows` lock the insert itself uses) remains the sole
    /// authoritative enforcement — this gate can race a concurrent spawn for
    /// the same window and let both proceed past it, exactly as
    /// `remote::session::RemoteSessionService::session_capacity_gate`
    /// already accepts for the identical reason (see that method's own
    /// precedent) — but no more than `MAX_TERMINAL_SESSIONS_PER_WINDOW`
    /// sessions can ever actually be *inserted*, local and remote sharing
    /// the exact same `state.windows` table and limit.
    fn session_capacity_gate(&self, window_label: &str) -> Result<(), CommandError> {
        let windows = lock(&self.state.windows);
        let count = windows.get(window_label).map_or(0, HashMap::len);
        if count >= MAX_TERMINAL_SESSIONS_PER_WINDOW {
            return Err(terminal_session_limit_exceeded());
        }
        Ok(())
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
                let resizer = lock(&session.resizer);
                resizer.resize(cols, rows)?;
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
            // `F190` S6: this call is, by construction, always an *explicit*
            // close — the frontend never calls `terminal_kill` on its own
            // initiative for a session it did not itself decide to tear
            // down (a pane/tab close button, `Plain: Kill Terminal`, or a
            // window's own `close_window` sweep below) — so this is exactly
            // the "正常显式关闭...应把 marker 归零或相应递减" half of the
            // marker's contract; see `TerminalLifecycleMarkerStore`'s own
            // doc comment.
            state.lifecycle.record_ended(&window_label, 1);
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
    /// single slowest session's teardown rather than their sum. `F190` S6:
    /// also clears this window's own lifecycle marker entirely — a real
    /// window close is the other "正常显式关闭" case the marker's contract
    /// covers (see [`TerminalLifecycleMarkerStore`]'s own doc comment); every
    /// session this call reaps is, by definition, one this call itself is
    /// about to kill+join, so there is nothing left for a later view to
    /// report as unreachable.
    pub fn close_window(&self, window_label: &str) {
        reap_window_sessions(&self.state, window_label);
        self.state.lifecycle.clear(window_label);
    }

    /// `F190` S6 "跨进程不伪造 session restore": called once by a freshly
    /// mounted terminal view, before it starts any session of its own — see
    /// `docs/research/2026-08-03-complete-terminal.md`'s "架构裁定 §6".
    /// Reads and unconditionally clears `window_label`'s durable marker,
    /// returning whatever value it held: a value surviving from before this
    /// call means the previous frontend generation left that many sessions
    /// un-explicitly-closed, whether because this whole process crashed (a
    /// fresh process's `TerminalState.windows` starts empty regardless, but
    /// the marker's last successful disk write survives it) or because a
    /// `WebView` reload discarded the frontend's own memory of them while
    /// this window (and this table) stayed alive. A second call for the same
    /// window within the same process run (e.g. the Terminal panel closed
    /// and reopened later, with no further reload/crash in between) reports
    /// `0` — this call *claims* whatever it reports, exactly once.
    ///
    /// Deliberately does **not** also reap (kill) whatever
    /// `TerminalState.windows` still holds for `window_label`: unlike the
    /// window-destruction case `close_window` handles (where every
    /// remaining session is unambiguously abandoned), a session can
    /// legitimately be inserted into this exact table *concurrently* with
    /// this call — `debug::commands::handle_run_in_terminal_reverse_request`
    /// spawns a `runInTerminal` session and only *afterward* notifies the
    /// frontend, which may itself be what causes this view to be constructed
    /// (and this method to run) for the very first time (see
    /// `PlainDebugTerminalIntegration`'s own doc comment for that
    /// "可见性兜底" flow) — reaping indiscriminately here could kill that
    /// brand new, fully legitimate session before the frontend ever gets to
    /// attach to it. A session left behind by a genuine stale reload
    /// therefore simply stays alive (exactly as it always has, pre-`F190`
    /// S6) until this window's own eventual `close_window` reaps it — this
    /// is a deliberate, documented scope boundary, not an oversight: it
    /// trades away *immediate* reclamation of a reload-orphaned session's
    /// thread/fd resources in exchange for never risking a live, wanted
    /// session.
    pub async fn claim_lifecycle_marker(&self, window_label: &str) -> u32 {
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || state.lifecycle.claim(&window_label))
            .await
            .unwrap_or(0)
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

/// Resolves and validates `cwd` against one exact, caller-selected workspace
/// root. If omitted, that root itself is used. If provided, it must
/// resolve relative to and canonicalize inside (or exactly equal to) the same root — never merely
/// some other authorized root. See [`WorkspaceService::root_canonical_path`]
/// for the stale/foreign authority check and why this specific
/// `canonicalize` + `starts_with` check is sanctioned here (a spawn
/// parameter, not capability-relative file I/O).
fn resolve_cwd(
    workspace: &WorkspaceService,
    window_label: &str,
    root_id: RootId,
    cwd: Option<String>,
) -> Result<PathBuf, CommandError> {
    let selected_root = workspace.root_canonical_path(window_label, root_id)?;
    match cwd {
        None => Ok(selected_root),
        Some(candidate) => {
            let candidate = PathBuf::from(candidate);
            if candidate.is_absolute() {
                return Err(terminal_cwd_invalid());
            }
            let canonical = std::fs::canonicalize(selected_root.join(candidate))
                .map_err(|_| terminal_cwd_invalid())?;
            if canonical == selected_root || canonical.starts_with(&selected_root) {
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
///
/// `root_canonical` is `Some` for an ordinary `terminal_start`-issued
/// session (the workspace root it was bound to) and `None` for a
/// `start_program`-issued (`runInTerminal`) session, which has no workspace
/// root concept at all — see [`relativize_pwd`]'s doc for what that governs.
#[allow(clippy::too_many_arguments)]
fn run_vt(
    cols: u16,
    rows: u16,
    receiver: &Receiver<VtCommand>,
    flow: &FlowControl,
    vt_frame: &Mutex<Option<vt::DirtyFrame>>,
    session_id: TerminalSessionId,
    root_canonical: Option<PathBuf>,
    sink: &dyn TerminalOutputSink,
) {
    let Ok(mut session) = vt::VtSession::new(cols, rows) else {
        return;
    };
    let mut gate = FrameEmitGate::new();
    let mut pwd_cache = PwdCache::new(root_canonical);
    while let Ok(command) = receiver.recv() {
        match command {
            VtCommand::Shutdown => return,
            VtCommand::Feed(bytes) => {
                session.feed(&bytes);
                // PTY → VT backpressure — see the module doc's "PTY → VT
                // byte backpressure" section for why the vt thread (rather
                // than the frontend) is what acks here now.
                flow.ack(bytes.len());
                attempt_emit(
                    &mut session,
                    &mut gate,
                    &mut pwd_cache,
                    vt_frame,
                    session_id,
                    sink,
                );
            }
            VtCommand::Resize { cols, rows } => {
                if session.resize(cols, rows).is_ok() {
                    attempt_emit(
                        &mut session,
                        &mut gate,
                        &mut pwd_cache,
                        vt_frame,
                        session_id,
                        sink,
                    );
                }
            }
            VtCommand::Ack(sequence) => {
                gate.ack(sequence);
                attempt_emit(
                    &mut session,
                    &mut gate,
                    &mut pwd_cache,
                    vt_frame,
                    session_id,
                    sink,
                );
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
    pwd_cache: &mut PwdCache,
    vt_frame: &Mutex<Option<vt::DirtyFrame>>,
    session_id: TerminalSessionId,
    sink: &dyn TerminalOutputSink,
) {
    if let Some((sequence, mut frame)) = gate.try_take_frame(session) {
        frame.pwd = pwd_cache.relativize(frame.pwd.as_deref());
        *lock(vt_frame) = Some(frame.clone());
        sink.emit_frame(session_id, sequence, frame);
    }
}

/// Caches the last raw→root-relative `pwd` translation so a high-throughput
/// session (many emitted frames while `pwd` itself never changes) does not
/// pay a `std::fs::canonicalize` syscall on every single frame — only when
/// the *raw* pwd string actually changes (an OSC 7 write, far rarer than a
/// `feed`/emit cycle) is [`relativize_pwd`] actually called again.
struct PwdCache {
    root_canonical: Option<PathBuf>,
    last_raw: Option<String>,
    last_relative: Option<String>,
}

impl PwdCache {
    fn new(root_canonical: Option<PathBuf>) -> Self {
        Self {
            root_canonical,
            last_raw: None,
            last_relative: None,
        }
    }

    fn relativize(&mut self, raw_pwd: Option<&str>) -> Option<String> {
        if raw_pwd == self.last_raw.as_deref() {
            return self.last_relative.clone();
        }
        self.last_raw = raw_pwd.map(str::to_owned);
        self.last_relative = relativize_pwd(self.root_canonical.as_deref(), raw_pwd);
        self.last_relative.clone()
    }
}

/// Turns `vt::DirtyFrame::pwd`'s raw absolute path (see that field's doc)
/// into the root-relative value `TerminalFrame::pwd` actually carries over
/// IPC — `None` unless the session has a workspace root at all, a pwd has
/// actually been reported, *and* that pwd canonicalizes to somewhere inside
/// (or exactly at) that root. This is the exact same canonicalize +
/// containment check [`resolve_cwd`] performs the other way around (a
/// candidate cwd string → an authorized absolute path); here it runs in the
/// read direction (a live absolute path → a value safe to hand back to the
/// frontend), which is why a value coming out of this function is safe to
/// feed straight back into a future `TerminalStartRequest::cwd` — `resolve_cwd`
/// re-validates it again at that point regardless (defense in depth against
/// a TOCTOU: the directory could be deleted/replaced between this read and
/// that future start). Never exposes the absolute root path itself to the
/// frontend, mirroring `workspace::dto::WorkspaceRootSnapshot` only ever
/// exposing a `display_name`, never a canonical path.
fn relativize_pwd(root_canonical: Option<&Path>, raw_pwd: Option<&str>) -> Option<String> {
    let root = root_canonical?;
    let raw_pwd = raw_pwd?;
    let canonical = std::fs::canonicalize(raw_pwd).ok()?;
    if canonical == root {
        return Some(String::new());
    }
    let relative = canonical.strip_prefix(root).ok()?;
    Some(relative.to_string_lossy().into_owned())
}

/// `F220` S5: dispatches through [`PtyWaiter`] — see that enum's own doc
/// comment for exactly what each backend's `wait()` blocks on and how its
/// outcome maps onto [`TerminalExitStatus`].
fn run_waiter(
    session_id: TerminalSessionId,
    waiter: &mut PtyWaiter,
    sink: &dyn TerminalOutputSink,
) {
    let exit_status = waiter.wait();
    sink.emit_exit(session_id, exit_status);
}

/// `F220` S5: the shared tail of both backends' spawn path — session-limit
/// check, [`TerminalSession`] construction, reader/vt/waiter thread spawn,
/// window-table insert and `F190` S6 lifecycle-marker recording, all under
/// one hold of `state.windows` (the atomic "check-and-insert" half of the
/// session-limit contract — see [`TerminalService::session_capacity_gate`]'s
/// own doc comment for the other, best-effort half). The local
/// `spawn_session` closure calls this synchronously from inside its own
/// `spawn_blocking` (after `openpty`+`spawn_command`, still off the async
/// executor); `TerminalService::start_remote` calls it from inside its own,
/// separate `spawn_blocking` (after the async SSH channel-open/`pty-req`/
/// `shell` round trip has already completed) — see that method's own doc
/// comment. Deliberately a free function, not a method: it needs no `&self`
/// beyond the `state` it is explicitly handed, exactly like every other
/// free helper in this file (`run_reader`/`run_vt`/`terminate_session`/…).
#[allow(clippy::too_many_arguments)]
fn finish_spawn_sync(
    state: &TerminalState,
    window_label: &str,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    resizer: PtyResizer,
    killer: PtyKiller,
    mut waiter: PtyWaiter,
    root_canonical: Option<PathBuf>,
    cols: u16,
    rows: u16,
    sink: Arc<dyn TerminalOutputSink>,
) -> Result<TerminalSessionId, CommandError> {
    let mut windows = lock(&state.windows);
    let sessions = windows.entry(window_label.to_owned()).or_default();
    if sessions.len() >= MAX_TERMINAL_SESSIONS_PER_WINDOW {
        return Err(terminal_session_limit_exceeded());
    }

    let session_id = TerminalSessionId::new();
    let flow = Arc::new(FlowControl::new());
    let vt_frame = Arc::new(Mutex::new(None));
    let (vt_sender, vt_receiver) = mpsc::channel::<VtCommand>();
    let session = Arc::new(TerminalSession {
        flow: Arc::clone(&flow),
        resizer: Mutex::new(resizer),
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
        .spawn(move || run_waiter(session_id, &mut waiter, waiter_sink.as_ref()))
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
                root_canonical,
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
    // `F190` S6: dropped explicitly (rather than just letting the function
    // end) so the marker's own best-effort file I/O below never runs while
    // `state.windows` is still locked — it does not need that lock at all
    // (it has its own, independent one), and there is no reason to hold
    // every other window's `start`/`kill` calls behind it for the duration
    // of an unrelated write.
    drop(windows);
    state.lifecycle.record_started(window_label);
    Ok(session_id)
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

/// Removes every session `window_label` currently holds and kills+joins each
/// of them in parallel, exactly like [`TerminalService::close_window`]
/// always has — shared by that method and `F190` S6's
/// [`TerminalService::claim_lifecycle_marker`], the latter of which needs
/// the identical "reap everything this window's table still holds" step for
/// an unreachable-orphan sweep rather than a real window close. A no-op
/// (zero threads spawned) when `window_label` has no table at all.
fn reap_window_sessions(state: &TerminalState, window_label: &str) {
    let sessions: Vec<Arc<TerminalSession>> = {
        let mut windows = lock(&state.windows);
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

/// `F190` S6 "跨进程不伪造 session restore": a durable,
/// `window_label`-keyed count of however many terminal sessions
/// `TerminalState.windows` currently holds for that window — whether or not
/// each one's underlying process has already exited (a pane showing a real
/// exit banner is still "open" from the user's perspective until they
/// explicitly close it; see `docs/research/2026-08-03-complete-terminal.md`'s
/// "架构裁定 §6"). Kept in exact sync with that live count at every mutation
/// (`record_started` right after an insert, `record_ended`/`clear` right
/// before/after a removal), so — regardless of *why* a later read observes a
/// stale, nonzero value (this process's own window table still holding
/// sessions a reloaded frontend has no memory of, or a full process crash
/// that lost the in-memory table entirely but not this store's last
/// successful disk write) — that value always means the same thing: "this
/// many sessions were open the moment nothing more explicit happened to
/// them".
///
/// Reads/writes here are **best-effort**: any I/O failure (a missing
/// directory, a permissions error, …) is silently treated as "0"/a no-op —
/// this store exists purely to drive a one-time UX notice, never to gate
/// whether a real session can start, resize, or be killed. Backed by
/// `crate::backup::store`'s own audited stage-verify-rename primitives
/// (the same atomic-write machinery `scratch`/`backup` already build on),
/// storing one small entry per window label (`main`, `plain-window-<uuid>`,
/// …) under this service's own `terminal-lifecycle/` subdirectory of the
/// shared app-local state root — a fresh subdirectory, not
/// `backup`'s/`scratch`'s own, since a window label means something
/// entirely different from either of those domains' own key spaces.
struct TerminalLifecycleMarkerStore {
    base_path: PathBuf,
    gate: Mutex<()>,
    root: Mutex<Option<Dir>>,
}

impl TerminalLifecycleMarkerStore {
    fn new(base_path: PathBuf) -> Self {
        Self {
            base_path,
            gate: Mutex::new(()),
            root: Mutex::new(None),
        }
    }

    /// Records that one more session started in `window_label` (the count
    /// stored on disk was already in sync with the live table *before* this
    /// insert, so "+1" is always correct regardless of how many other
    /// windows exist).
    fn record_started(&self, window_label: &str) {
        let _gate = lock(&self.gate);
        let Some(key) = lifecycle_key(window_label) else {
            return;
        };
        let Some(root) = self.ensure_root(true) else {
            return;
        };
        let current = read_marker(&root, &key).unwrap_or(0);
        let _ = write_marker(&root, &key, current.saturating_add(1));
    }

    /// Records that `count` sessions ended (an explicit `terminal_kill`
    /// always passes `1`) in `window_label` — floors at zero and discards
    /// the entry entirely once it reaches zero (an absent entry and a
    /// stored `0` mean the same thing to [`Self::claim`], but not writing a
    /// `0` avoids this directory accumulating one file per window label for
    /// the lifetime of a long-running app that opens and closes many
    /// windows).
    fn record_ended(&self, window_label: &str, count: u32) {
        let _gate = lock(&self.gate);
        let Some(key) = lifecycle_key(window_label) else {
            return;
        };
        let Some(root) = self.ensure_root(false) else {
            return;
        };
        let current = read_marker(&root, &key).unwrap_or(0);
        let next = current.saturating_sub(count);
        if next == 0 {
            let _ = backup_store::discard_entry(&root, &key);
        } else {
            let _ = write_marker(&root, &key, next);
        }
    }

    /// Discards `window_label`'s entry outright — used by
    /// [`TerminalService::close_window`], which is about to kill+join every
    /// session that entry could possibly still be counting, so there is
    /// nothing left to decrement one at a time.
    fn clear(&self, window_label: &str) {
        let _gate = lock(&self.gate);
        let Some(key) = lifecycle_key(window_label) else {
            return;
        };
        let Some(root) = self.ensure_root(false) else {
            return;
        };
        let _ = backup_store::discard_entry(&root, &key);
    }

    /// Reads and clears `window_label`'s current value in one step — see
    /// [`TerminalService::claim_lifecycle_marker`]'s own doc comment for the
    /// full "read-once, then it is claimed" contract this backs.
    fn claim(&self, window_label: &str) -> u32 {
        let _gate = lock(&self.gate);
        let Some(key) = lifecycle_key(window_label) else {
            return 0;
        };
        let Some(root) = self.ensure_root(false) else {
            return 0;
        };
        let value = read_marker(&root, &key).unwrap_or(0);
        if value != 0 {
            let _ = backup_store::discard_entry(&root, &key);
        }
        value
    }

    /// Lazily opens (and caches) this store's own `terminal-lifecycle/`
    /// directory — `create: false` never creates it (a fresh install with no
    /// terminal ever started yet has nothing to open, and every read path
    /// above already treats "directory absent" as "0"), mirroring
    /// `scratch::service::ScratchState::ensure_root`'s identical precedent.
    fn ensure_root(&self, create: bool) -> Option<Dir> {
        let mut slot = lock(&self.root);
        if let Some(root) = slot.as_ref() {
            return root.try_clone().ok();
        }
        let path = self.base_path.join("terminal-lifecycle");
        if create {
            ensure_directory_ambiently(&path).ok()?;
        } else if !path.exists() {
            return None;
        }
        let root = Dir::open_ambient_dir(&path, ambient_authority()).ok()?;
        let clone = root.try_clone().ok()?;
        *slot = Some(root);
        Some(clone)
    }
}

fn lifecycle_key(window_label: &str) -> Option<BackupKey> {
    BackupKey::parse(window_label).ok()
}

/// This store's entries hold nothing but a plain ASCII decimal count —
/// simpler than a JSON envelope for a single `u32`, and just as easy to
/// audit by hand on disk.
fn read_marker(root: &Dir, key: &BackupKey) -> Option<u32> {
    let bytes = backup_store::read_entry(root, key).ok().flatten()?;
    std::str::from_utf8(&bytes).ok()?.trim().parse::<u32>().ok()
}

fn write_marker(root: &Dir, key: &BackupKey, value: u32) -> Result<(), CommandError> {
    backup_store::write_entry(root, key, value.to_string().as_bytes())
}

/// Mirrors `scratch::service`'s own identically-named, identically-shaped
/// helper (recursively creates every missing path component, tolerating
/// "already exists" at any level) — duplicated here rather than shared,
/// since each of this crate's app-local-state domains already independently
/// owns this same handful of lines rather than depending on one another.
fn ensure_directory_ambiently(path: &Path) -> std::io::Result<()> {
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

#[cfg(test)]
mod remote_tests;
#[cfg(test)]
mod tests;
