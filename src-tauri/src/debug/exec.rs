//! `debug` domain hardened subprocess-spawn primitive (`F100` S0) — see the
//! module doc on [`super`] for this slice's overall scope. Structurally
//! mirrors `git::exec`'s trust-gate-then-spawn split
//! ([`spawn_adapter`]/[`spawn_adapter_sync`] play the same two roles as
//! `git::exec::run_git`'s public/private split), but the spawned process's
//! actual lifecycle borrows `terminal::service`'s long-lived-subprocess
//! model, not `git::exec`'s one-shot spawn-wait-capture-once model — see "Why
//! a long-lived model, not git's" below. There is no separate
//! `discovery.rs`/`service.rs` file for this domain yet in S0, so both the
//! trust-gated async entry point and the sync hardened spawn live in this one
//! file — expected to get refactored once S1 adds a real confirmation-gated
//! entry point that this becomes an implementation detail of.
//!
//! # Why `std::process::Command`, not `portable_pty::CommandBuilder`
//!
//! Unlike `terminal::` (an interactive PTY session a human types into), a DAP
//! adapter is driven purely by the `Content-Length`-framed wire protocol over
//! its own stdin/stdout — it has no legitimate reason to care whether it is
//! connected to a real terminal, so a plain pipe-based `std::process::Command`
//! (exactly like `git::exec`'s own choice, for the same "not an interactive
//! session" reason) is the right primitive here, not a pseudo-terminal. The
//! frozen research doc's own "需要新增的 AST 契约清单" item 7 flags this as
//! worth confirming empirically if a real adapter turns out to probe
//! `isatty()` and change behavior — not verified in this slice (no real
//! adapter is spawned here at all, only test fixtures), left as a named risk
//! for whichever later slice first talks to a real adapter.
//!
//! # Why a long-lived model, not `git::exec`'s one-shot model
//!
//! A DAP session is spawned once and stays alive for the session's entire
//! lifetime (unlike `git status`/`git diff`'s "run to completion, capture
//! output once" shape), so a literal port of `git::exec::run_git`'s
//! wait-to-exit-then-return contract would be wrong here: [`spawn_adapter`]
//! returns as soon as the process has *survived* a short startup grace window
//! (see [`DEBUG_ADAPTER_STARTUP_GRACE`]), handing back a live
//! [`AdapterHandle`] rather than a captured output buffer — the
//! `terminal::service::TerminalService::start`/`spawn_session` shape, not
//! `git::exec::run_git`'s. Full session machinery (a reader thread parsing
//! [`super::framing`] frames off stdout, a writer, request/response
//! correlation by `request_seq`) is explicitly S2's job per the frozen
//! research doc's own slice breakdown — [`AdapterHandle`] in this slice only
//! wraps the spawned [`Child`] plus the stderr-capture bookkeeping described
//! below; it has no reader/writer/waiter session threads yet.
//!
//! # What "timeout"/"cancel"/"output cap" concretely mean at this layer
//!
//! `git::exec::GIT_EXEC_TIMEOUT` (a whole-invocation timeout) and
//! `GIT_EXEC_OUTPUT_CAP_BYTES` (a whole-stdout/stderr-stream cap) both assume
//! a process that runs once and finishes — neither concept transfers
//! directly to a session meant to stay alive indefinitely. Per-DAP-*request*
//! timeouts need request/response correlation (`request_seq`) that does not
//! exist until S2's handshake orchestration, and a general "kill the whole
//! session after N seconds" would defeat the entire point of a long-lived
//! debug session — so this slice implements **neither** of those. What it
//! does implement, as the concrete and independently testable meaning of
//! each term at this layer only:
//!
//! - **"timeout" → startup-crash detection**: after spawning, poll (bounded,
//!   short sleep loop, mirroring `git::exec::GIT_EXEC_POLL_INTERVAL`'s 10ms
//!   cadence — see [`DEBUG_ADAPTER_POLL_INTERVAL`]) for up to
//!   [`DEBUG_ADAPTER_STARTUP_GRACE`] to see whether the child has already
//!   exited. 200ms is chosen to be long enough to reliably catch a "bad
//!   command/args/permission" failure — these manifest at or near
//!   `execve`/fork time, essentially instantly, not after any meaningful
//!   delay — while staying short enough not to perceptibly delay every real,
//!   healthy launch (imperceptible against any human-facing "start debugging"
//!   interaction). If the child has already exited, this is reported as a
//!   structured [`super::debug_adapter_startup_crashed`] error carrying the
//!   captured stderr tail — a real, useful, testable behavior distinct from
//!   "wait until it finishes" (which never happens for a healthy adapter). If
//!   the process is still running once the window elapses, it is treated as
//!   launched and [`AdapterHandle`] is handed back.
//! - **"cancel" → cooperative cancellation of the grace-window wait**: the
//!   caller-supplied `cancel: Arc<AtomicBool>` is checked on the same poll
//!   cadence as the startup-crash check (mirroring `git::exec`'s own
//!   cancellation check cadence), killing and reaping the child if set; plus
//!   [`AdapterHandle::kill`] for terminating an already-handed-back session at
//!   any later point (S2's session teardown is expected to call this;
//!   exercised today only by this module's own tests — see its
//!   `#[allow(dead_code)]` note).
//! - **"output cap" → the stderr capture cap** ([`DEBUG_ADAPTER_STDERR_CAP_BYTES`]):
//!   stderr here is adapter diagnostic/error text only — the actual DAP
//!   protocol channel is stdout, already separately bounded per-message by
//!   [`super::framing::MAX_DAP_MESSAGE_BYTES`] — so 1,000,000 bytes is
//!   generous for any plausible startup error/traceback while bounding a
//!   runaway/malicious adapter that floods stderr forever.
//!   [`spawn_stderr_capture`] ports `git::exec::spawn_capped_reader`'s
//!   bounded-drain-on-cap technique (never allocate past the cap; keep
//!   draining-and-discarding once it is reached, so the child's own write end
//!   never blocks on a full pipe buffer) rather than re-deriving it — but,
//!   unlike that one-shot function, runs for the process's whole lifetime and
//!   continuously updates a shared buffer instead of reporting once (over an
//!   `mpsc` channel) at the end of a single bounded invocation: there is no
//!   "end of a single invocation" for a long-lived DAP session the way there
//!   is for a one-shot `git` command.
//!
//! # Deliberately not implemented in this slice
//!
//! Per-request timeouts, session termination on an adapter crashing *after*
//! the startup grace window (i.e. mid-session), and `output`-event
//! backpressure are all S2/S5's job (frozen research doc "决策 4") — there is
//! no request/response machinery or event stream to bound yet, only a spawn
//! primitive.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use crate::error::CommandError;
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;

use super::dto;
use super::{
    debug_adapter_cancelled, debug_adapter_spawn_unavailable, debug_adapter_startup_crashed,
};

/// The exact, audited environment-variable passthrough closed set applied
/// (after `env_clear()`) when spawning an adapter process. Unlike
/// `terminal::shell::TERMINAL_ENV_PASSTHROUGH_NAMES` (locked by
/// `validateTerminalRustBoundary`) or `git::exec::GIT_NETWORK_ENV_PASSTHROUGH_NAMES`
/// (locked by `validateGitRustBoundary`), this slice's frozen task scope adds
/// exactly three new AST contracts and no more —
/// `validateDebugAdapterSpawnBoundary`/`validateDebugSpawnConstructionShape`/
/// `validateDebugFramingBounds` — none of which locks this specific constant.
/// Widening this list is therefore only guarded today by code review and this
/// doc comment, not by a mechanical AST check; adding one is a reasonable,
/// separately-scoped follow-up in the same spirit as the existing
/// `TERMINAL_ENV_PASSTHROUGH_NAMES_LOCK`/`GIT_NETWORK_ENV_PASSTHROUGH_NAMES`
/// checks, not something this slice invents on its own initiative.
/// Deliberately a narrower set than either existing domain's own list — not
/// an oversight, see below.
///
/// - **`PATH`**: the adapter's own executable is always spawned via a
///   caller-supplied absolute path (never `PATH`-resolved — the config
///   format hands us `descriptor.command` as an absolute path per the frozen
///   research doc's "决策 1"), so `PATH` is never needed to *find* the
///   adapter itself. It is still passed through because the adapter process
///   commonly re-execs or shells out to companion tools/interpreters/OS
///   utilities internally (a Python-based adapter invoking `python3`, a
///   native debugger invoking `otool`/`nm`/a symbol server helper, …), and
///   those child-of-the-adapter lookups do need `PATH` to resolve.
/// - **`HOME`**: user-level config/cache/rc-file resolution many debuggers
///   and language runtimes do on their own (an `~/.lldbinit`-style file, a
///   language runtime's user-site config, …) — this is about the *adapter
///   process's own* environment, not the debuggee's. The debuggee's
///   environment is a separate, adapter-specific concern carried inside the
///   DAP `launch` request's own `env` field (per ADR 0003's "adapter-specific
///   配置透明透传"), nothing to do with this spawn-time allowlist.
/// - **`TMPDIR`**: scratch-file creation many tools do by default, mirroring
///   `terminal::shell::TERMINAL_ENV_PASSTHROUGH_NAMES`'s own inclusion of
///   `TMPDIR` for the identical class of need.
/// - **Deliberately not forced: `LANG`/`LC_ALL`.** `git::exec`'s hardening
///   forces these because this codebase itself parses locale-sensitive
///   free-text output *from git subcommands* and needs that parsing stable.
///   The DAP wire protocol is strict `Content-Length`-framed UTF-8 JSON that
///   this domain parses structurally ([`super::framing`]'s state machine),
///   never by scraping human-formatted numbers/dates out of free text — there
///   is no analogous parsing-stability problem locale hardening would solve
///   here, so this deliberately does not carry that rationale over just to
///   mirror git's shape.
/// - **Deliberately not passed: `SSH_AUTH_SOCK`/`SHELL`/`USER`/`LOGNAME`.** No
///   networking-auth need exists for a DAP adapter process (unlike
///   `git::exec::GIT_NETWORK_ENV_PASSTHROUGH_NAMES`'s `SSH_AUTH_SOCK`, which
///   exists specifically for `fetch`/`pull`/`push` authenticating over
///   `ssh://`) and no interactive-shell-identity need exists either (unlike
///   `terminal::shell::TERMINAL_ENV_PASSTHROUGH_NAMES`, which spawns a real
///   login shell a human types into). This is a deliberately narrower set
///   than either existing domain's own passthrough list, not an oversight.
pub(crate) const DEBUG_ADAPTER_ENV_PASSTHROUGH_NAMES: &[&str] = &["PATH", "HOME", "TMPDIR"];

/// Wall-clock window [`spawn_adapter_sync`] waits after spawning before
/// treating the process as successfully launched — see the module doc's
/// "timeout" section for the full reasoning (long enough to reliably catch a
/// near-instant bad-command/args/permission failure, short enough not to
/// perceptibly delay a real launch).
const DEBUG_ADAPTER_STARTUP_GRACE: Duration = Duration::from_millis(200);

/// How often the startup-grace poll loop in [`spawn_adapter_sync`] wakes up —
/// mirrors `git::exec::GIT_EXEC_POLL_INTERVAL`'s exact 10ms cadence and
/// rationale (small enough that both the crash-detection and cancellation
/// checks are noticed promptly, large enough not to busy-loop).
const DEBUG_ADAPTER_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Bounded pause between observing the child has already exited and
/// snapshotting [`spawn_stderr_capture`]'s shared buffer for the startup-crash
/// error — gives the background reader thread a brief window to finish
/// copying whatever final chunk of stderr the dying process had already
/// written to its pipe before this function reads the buffer back out,
/// exactly the same "let the concurrent reader catch up" concern
/// `git::exec::GIT_EXEC_READER_DRAIN_GRACE` documents (scaled down from that
/// constant's own 500ms: this is a best-effort UX nicety for a diagnostic
/// message, not a correctness requirement the way git's drain grace is for
/// output completeness — losing the last few bytes of a crash message would
/// be an acceptable, non-corrupting degradation here, unlike a truncated git
/// diff). 100ms is generous headroom over the single already-buffered
/// `read()` call this normally takes even under a loaded, parallel test run,
/// while staying two orders of magnitude below
/// [`DEBUG_ADAPTER_STARTUP_GRACE`]'s own 200ms.
const DEBUG_ADAPTER_STDERR_DRAIN_GRACE: Duration = Duration::from_millis(100);

/// Stderr capture cap — see the module doc's "output cap" section for the
/// full rationale (stderr is diagnostic text only; the real protocol channel
/// is stdout, already bounded per-message elsewhere).
const DEBUG_ADAPTER_STDERR_CAP_BYTES: usize = 1_000_000;

/// Bytes read per blocking `read()` call while draining the adapter's stderr
/// — mirrors `git::exec::GIT_EXEC_READ_BUFFER_BYTES`'s exact value.
const DEBUG_ADAPTER_STDERR_READ_BUFFER_BYTES: usize = 8192;

/// A live spawned adapter process handle — see the module doc for why this
/// intentionally has no reader/writer/waiter session machinery yet (S2's
/// job). Holds the [`Child`] (so [`Self::kill`] can terminate it at any
/// later point) plus the shared, continuously-updated stderr-capture buffer
/// described in the module doc.
///
/// No production caller exists yet in this slice — S1 adds the first real
/// caller of [`spawn_adapter`], which is what actually produces one of these;
/// exercised today only by this module's own tests.
#[allow(dead_code)] // No production caller until S1 adds the confirmation-gated entry point.
#[derive(Debug)]
pub(crate) struct AdapterHandle {
    child: Mutex<Child>,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
}

#[allow(dead_code)] // No production caller until S1 adds the confirmation-gated entry point.
impl AdapterHandle {
    /// Terminates the adapter process immediately and waits for it to be
    /// reaped. No production caller yet — S2's session teardown is where this
    /// is expected to get wired in (mirroring
    /// `terminal::service::terminate_session`'s own kill step); exercised
    /// today only by this module's own tests.
    pub(crate) fn kill(&self) {
        let mut child = lock(&self.child);
        let _ = child.kill();
        let _ = child.wait();
    }

    /// The stderr capture buffer's current contents, up to
    /// [`DEBUG_ADAPTER_STDERR_CAP_BYTES`] — exposed for tests (and, later,
    /// for a real caller wanting to surface adapter diagnostic output to the
    /// user).
    pub(crate) fn stderr_tail(&self) -> Vec<u8> {
        lock(&self.stderr_tail).clone()
    }
}

/// Trust-gated entry point — see the module doc's "Why a long-lived model"
/// section for the overall shape this returns. Calls
/// [`TrustService::require_trusted`] as its literal first statement, before
/// any `Command`/spawn-related identifier appears anywhere in this function's
/// body — `scripts/plain/boundary-contracts.mjs`'s
/// `validateDebugAdapterSpawnBoundary` mechanically locks exactly this
/// ordering. Propagates `require_trusted`'s own `WORKSPACE_NOT_TRUSTED` error
/// verbatim rather than wrapping it in a debug-domain-specific code — this
/// mirrors what `git::discovery::discover_repository` and
/// `terminal::service::TerminalService::start` actually do today (neither of
/// them wraps it either); inventing a new, never-actually-returned
/// `DEBUG_ADAPTER_NOT_TRUSTED`-style code here purely to have a
/// domain-flavored name would be decorative, not honest.
///
/// Dispatches (once trust is confirmed) to [`spawn_adapter_sync`] via
/// `tauri::async_runtime::spawn_blocking`, exactly like
/// `TerminalService::start`/`spawn_session` do for their own blocking spawn
/// work.
///
/// No production caller exists yet in this slice (S1 adds the first real
/// caller, gated behind adapter-config parsing and the first-run
/// confirmation gate — see the module doc on [`super`]); exercised today only
/// by this module's own tests.
#[allow(dead_code)] // No production caller until S1 adds the confirmation-gated entry point.
pub(crate) async fn spawn_adapter(
    trust: &TrustService,
    workspace: &WorkspaceService,
    window_label: &str,
    descriptor: &dto::AdapterSpawnDescriptor,
    cancel: Arc<AtomicBool>,
) -> Result<AdapterHandle, CommandError> {
    trust.require_trusted(workspace, window_label).await?;
    let descriptor = descriptor.clone();
    tauri::async_runtime::spawn_blocking(move || spawn_adapter_sync(&descriptor, &cancel))
        .await
        .map_err(|_| debug_adapter_spawn_unavailable())?
}

/// The actual hardened build-and-spawn step — see the module doc for the
/// startup-crash-detection/stderr-cap contract this implements.
/// `scripts/plain/boundary-contracts.mjs`'s
/// `validateDebugSpawnConstructionShape` mechanically locks that the child
/// process is built exactly as `Command::new(&descriptor.command)
/// .args(&descriptor.args)` — never a shell interpreter, never a
/// `format!`/string-concatenated command line — even though (unlike every
/// `GIT_*_ARGS` constant in `git::exec`) the program and args here come from
/// caller-supplied configuration content, not a fixed list Plain itself
/// writes. See the frozen research doc's "决策 1" for why that is a
/// deliberate, already-settled design decision (workspace trust plus the
/// first-run confirmation gate are the real security boundary here, not a
/// path allowlist a hostile edit could pretend to add) rather than an
/// oversight this file should "fix" by trying to restrict `descriptor.command`
/// itself.
///
/// Applies [`DEBUG_ADAPTER_ENV_PASSTHROUGH_NAMES`] to `command`: `env_clear()`
/// first, then only the allowlisted names actually present in `ambient`.
/// `ambient` is injected (rather than this function reading
/// `std::env::vars()` itself) purely for testability — mirrors
/// `terminal::shell::apply_env_allowlist`'s identical injection rationale;
/// the sole production caller ([`spawn_adapter_sync`]) passes
/// `std::env::vars()` verbatim.
///
/// No production caller exists yet in this slice — see
/// [`spawn_adapter_sync`]'s own doc comment; exercised today only by this
/// module's own tests.
#[allow(dead_code)] // No production caller until spawn_adapter_sync itself has one.
fn apply_env_passthrough(
    command: &mut Command,
    ambient: impl IntoIterator<Item = (String, String)>,
) {
    command.env_clear();
    let ambient: Vec<(String, String)> = ambient.into_iter().collect();
    for name in DEBUG_ADAPTER_ENV_PASSTHROUGH_NAMES {
        if let Some((_, value)) = ambient.iter().find(|(key, _)| key == name) {
            command.env(*name, value);
        }
    }
}

/// No production caller exists yet in this slice — see [`spawn_adapter`]'s
/// own doc comment; exercised today only by this module's own tests.
#[allow(dead_code)] // No production caller until spawn_adapter's own caller exists (see its doc).
fn spawn_adapter_sync(
    descriptor: &dto::AdapterSpawnDescriptor,
    cancel: &AtomicBool,
) -> Result<AdapterHandle, CommandError> {
    let mut command = Command::new(&descriptor.command);
    command.args(&descriptor.args);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    apply_env_passthrough(&mut command, std::env::vars());

    let mut child = command
        .spawn()
        .map_err(|_| debug_adapter_spawn_unavailable())?;
    let stderr = child
        .stderr
        .take()
        .expect("spawn_adapter_sync always pipes stderr");
    let stderr_tail = spawn_stderr_capture(stderr);

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                std::thread::sleep(DEBUG_ADAPTER_STDERR_DRAIN_GRACE);
                let tail = lock(&stderr_tail).clone();
                return Err(debug_adapter_startup_crashed(status.code(), &tail));
            }
            Ok(None) => {}
            Err(_) => return Err(debug_adapter_spawn_unavailable()),
        }
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(debug_adapter_cancelled());
        }
        if start.elapsed() >= DEBUG_ADAPTER_STARTUP_GRACE {
            break;
        }
        std::thread::sleep(DEBUG_ADAPTER_POLL_INTERVAL);
    }

    Ok(AdapterHandle {
        child: Mutex::new(child),
        stderr_tail,
    })
}

/// Ports `git::exec::spawn_capped_reader`'s bounded-drain-on-cap technique
/// (never allocate past the cap; keep draining-and-discarding once it is
/// reached, so the child's stderr write end never blocks on a full pipe
/// buffer) rather than re-deriving it — see the module doc's "output cap"
/// section for why this runs for the process's whole lifetime and
/// continuously updates a shared buffer, unlike that function's one-shot,
/// channel-reported-once shape.
///
/// No production caller exists yet in this slice — see [`spawn_adapter_sync`]'s
/// own doc comment; exercised today only by this module's own tests.
#[allow(dead_code)] // No production caller until spawn_adapter_sync itself has one.
fn spawn_stderr_capture(mut source: impl Read + Send + 'static) -> Arc<Mutex<Vec<u8>>> {
    let tail = Arc::new(Mutex::new(Vec::new()));
    let thread_tail = Arc::clone(&tail);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; DEBUG_ADAPTER_STDERR_READ_BUFFER_BYTES];
        loop {
            let read = match source.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(read) => read,
            };
            let mut tail = lock(&thread_tail);
            if tail.len() < DEBUG_ADAPTER_STDERR_CAP_BYTES {
                let remaining = DEBUG_ADAPTER_STDERR_CAP_BYTES - tail.len();
                tail.extend_from_slice(&buffer[..remaining.min(read)]);
            }
        }
    });
    tail
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests;
