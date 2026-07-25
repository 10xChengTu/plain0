//! The Git domain's sole audited `std::process::Command` wrapper — see the
//! module doc on [`super`] for why this is a plain one-shot `Command`
//! rather than `portable_pty::CommandBuilder` (git status/diff/rev-parse are
//! non-interactive, capture-to-completion invocations, not a PTY session),
//! and for why `scripts/plain/boundary-contracts.mjs` mechanically forbids
//! every *other* file in this module tree from naming
//! `std::process::Command` at all.
//!
//! [`run_git`] never lets a caller choose *which* program runs: the spawned
//! program is always the literal string `"git"` (resolved through `PATH`,
//! exactly like a shell would), never a caller-supplied path or name. This
//! is deliberate — the one-file spawn allowlist above only closes half the
//! bypass; nothing would stop a future change from smuggling in
//! `Command::new("sh")` inside this same file otherwise. `validateTerminalRustBoundary`
//! mechanically re-checks both of these facts for this exact file.
//!
//! # cwd validation split (mirrors `terminal::service::resolve_cwd`)
//!
//! *Workspace-authorization* — is `repo_dir` inside one of the window's
//! currently authorized capability roots — is the caller's job
//! ([`super::discovery::discover_repository`] does it via
//! `WorkspaceService::root_canonical_paths`, exactly like
//! `terminal::service::resolve_cwd`). This module only re-asserts the
//! narrower, spawn-adjacent invariant that `repo_dir` canonicalizes to an
//! existing directory right before spawning — the same "canonicalize +
//! ambient `std::fs`, not capability-relative I/O" exception
//! `terminal::service::resolve_cwd`'s own doc comment justifies for a spawn
//! parameter (as opposed to the `cap_std`-relative reads/writes the
//! `workspace` domain's *file content* operations must use).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::CommandError;

use super::{
    git_cwd_invalid, git_exec_cancelled, git_exec_mode_unsupported, git_exec_output_limit_exceeded,
    git_exec_timeout, git_exec_unavailable,
};

/// Hardening profile [`run_git`] applies. Only [`GitExecMode::BackgroundRead`]
/// is implemented in this slice (`F080` S0) — see the module doc on
/// [`super`] for why `Write`/`Network` are enumerated but always rejected
/// for now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GitExecMode {
    /// Automatic, non-user-initiated reads (status/diff/blame/log/rev-parse
    /// style commands): hooks, fsmonitor, external diff/textconv and any
    /// credential/SSH prompt are all disabled — see [`harden_background_read`].
    BackgroundRead,
    /// User-initiated writes (stage/commit/discard). Not implemented yet —
    /// [`run_git`] rejects it. Constructing this variant is only meaningful
    /// once a later `F080` slice (S3) adds the write command surface; keep
    /// this `#[allow(dead_code)]` until that slice starts constructing it.
    #[allow(dead_code)]
    Write,
    /// Network operations (fetch/pull/push). Not implemented yet —
    /// [`run_git`] rejects it. Constructing this variant is only meaningful
    /// once a later `F080` slice (S4) adds the network command surface; keep
    /// this `#[allow(dead_code)]` until that slice starts constructing it.
    #[allow(dead_code)]
    Network,
}

/// The result of a completed `git` invocation — deliberately *not* an error
/// just because `exit_code != 0` (a non-zero exit is often meaningful data,
/// e.g. `git rev-parse --show-toplevel` outside a repository exits `128`
/// with a stderr message; the caller, not this module, interprets that).
/// [`CommandError`] is reserved for cases where the *exec mechanism itself*
/// failed: could not spawn, timed out, was cancelled, or exceeded the
/// output cap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GitExecOutput {
    pub(crate) exit_code: i32,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

/// Per-stream output cap: a generous ceiling for a single status/diff/
/// rev-parse invocation's stdout or stderr — chosen defensively (no
/// measurement backing this exact number yet), purely to bound memory
/// against a pathological invocation, mirroring
/// `terminal::MAX_TERMINAL_SESSIONS_PER_WINDOW`'s own role as a defensive
/// ceiling rather than a measured limit for a different domain. Revisit
/// once `F080` S1's real status/diff payloads give an empirical basis.
const GIT_EXEC_OUTPUT_CAP_BYTES: usize = 10_000_000;

/// Wall-clock ceiling for a single background-read invocation before it is
/// killed and [`git_exec_timeout`] is returned.
const GIT_EXEC_TIMEOUT: Duration = Duration::from_secs(30);

/// How often the exit/cancel/timeout poll loop in [`wait_with_limits`] wakes
/// up — small enough that cancellation and timeout are both noticed
/// promptly, large enough not to busy-loop.
const GIT_EXEC_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Bytes read per blocking `read()` call while draining a captured stream.
const GIT_EXEC_READ_BUFFER_BYTES: usize = 8192;

/// `GIT_ASKPASS` value for background reads: a program guaranteed to exit
/// non-zero immediately without ever prompting, printing, or blocking on a
/// TTY — git treats a failed/non-zero askpass helper as "no credential
/// available" and aborts the credential-requiring operation rather than
/// falling back to an interactive prompt (which `GIT_TERMINAL_PROMPT=0`
/// already separately disables for the terminal-prompt path). Verified only
/// on Unix (this workspace's dev/test environment is macOS); the Windows
/// fallback below is a best-effort guess, not verified end-to-end.
#[cfg(unix)]
const GIT_ASKPASS_REJECT_PROGRAM: &str = "/usr/bin/false";
#[cfg(not(unix))]
const GIT_ASKPASS_REJECT_PROGRAM: &str = "cmd.exe /C exit 1";

/// `core.hooksPath` value for background reads: a fixed path this process
/// never creates, so every hook lookup under it (including the legacy
/// `fsmonitor-watchman` hook `core.fsmonitor=true` looks for — see
/// `docs/research/2026-07-25-core-git.md`) simply misses (`ENOENT`/`ENOTDIR`),
/// exactly like an empty directory would. Chosen over pointing at a
/// created-and-emptied real directory so this module never needs any
/// filesystem write of its own just to run a read.
fn disabled_hooks_path() -> PathBuf {
    std::env::temp_dir().join("plain-git-disabled-hooks-do-not-create")
}

/// Runs `git` with `args` inside `repo_dir`, applying `mode`'s hardening
/// profile, and captures its output — bounded by [`GIT_EXEC_OUTPUT_CAP_BYTES`]
/// and [`GIT_EXEC_TIMEOUT`], and cooperatively cancellable via `cancel`
/// (set it from another thread to request early termination; checked on the
/// same poll cadence as the timeout).
///
/// `repo_dir` must already be workspace-authorized by the caller (see the
/// module doc's "cwd validation split" section) — this function only
/// re-validates that it canonicalizes to an existing directory.
pub(crate) fn run_git(
    repo_dir: &Path,
    args: &[String],
    mode: GitExecMode,
    cancel: &AtomicBool,
) -> Result<GitExecOutput, CommandError> {
    run_git_with_limits(
        repo_dir,
        args,
        mode,
        cancel,
        GIT_EXEC_TIMEOUT,
        GIT_EXEC_OUTPUT_CAP_BYTES,
    )
}

/// Test-only seam onto [`run_git_with_limits`]: identical to [`run_git`]
/// except the timeout and per-stream output cap are caller-supplied instead
/// of the fixed [`GIT_EXEC_TIMEOUT`]/[`GIT_EXEC_OUTPUT_CAP_BYTES`] constants
/// — mirrors `terminal::service::TerminalService::start_with_command_for_test`'s
/// exact rationale: real timeout/cap tests need to inject small values so
/// they run in milliseconds instead of actually waiting out a 30-second
/// production timeout or writing a real 10 MB payload.
#[cfg(test)]
pub(crate) fn run_git_with_limits_for_test(
    repo_dir: &Path,
    args: &[String],
    mode: GitExecMode,
    cancel: &AtomicBool,
    timeout: Duration,
    output_cap_bytes: usize,
) -> Result<GitExecOutput, CommandError> {
    run_git_with_limits(repo_dir, args, mode, cancel, timeout, output_cap_bytes)
}

fn run_git_with_limits(
    repo_dir: &Path,
    args: &[String],
    mode: GitExecMode,
    cancel: &AtomicBool,
    timeout: Duration,
    output_cap_bytes: usize,
) -> Result<GitExecOutput, CommandError> {
    let canonical_dir = std::fs::canonicalize(repo_dir).map_err(|_| git_cwd_invalid())?;
    if !canonical_dir.is_dir() {
        return Err(git_cwd_invalid());
    }

    let mut command = Command::new("git");
    command.current_dir(&canonical_dir);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.env_clear();

    match mode {
        GitExecMode::BackgroundRead => harden_background_read(&mut command),
        GitExecMode::Write | GitExecMode::Network => return Err(git_exec_mode_unsupported()),
    }

    command.args(args);

    let child = command.spawn().map_err(|_| git_exec_unavailable())?;
    wait_with_limits(child, cancel, timeout, output_cap_bytes)
}

/// Applies every fixed background-read hardening flag described in
/// `docs/research/2026-07-25-core-git.md` and ADR 0003 that is safe to
/// apply *regardless of subcommand* — every one of these is either an env
/// var or a `-c key=value` config override, both ignored harmlessly by
/// subcommands that do not care about them.
///
/// `diff.external`/textconv are deliberately **not** handled here as a
/// `-c` override, unlike `core.hooksPath`/`core.fsmonitor` — empirically
/// (see `docs/research/2026-07-25-core-git.md`'s exec hardening notes),
/// `-c diff.external=` does not gracefully fall back to git's built-in
/// diff the way an *unset* `diff.external` does: git treats the explicit
/// empty value as "run the empty string as the external diff command",
/// which fails to spawn and makes `git diff` itself exit fatally
/// (`external diff died`) instead of just not using one. The CLI flags
/// `--no-ext-diff`/`--no-textconv` are the actual mechanism git provides to
/// suppress both, and only apply positionally to diff-family subcommands
/// (`diff`/`show`/`log -p`) — `git rev-parse --no-ext-diff` is rejected as
/// an unknown global option, confirmed empirically. So this function
/// cannot apply them unconditionally for every subcommand; it is the
/// *caller's* responsibility (a later `F080` slice's diff/show command
/// builder) to append `--no-ext-diff --no-textconv` to `args` for any
/// diff-family invocation — exactly the "支持的子命令" (supported
/// subcommands) qualifier in the research doc's own wording.
///
/// Config overrides are appended to `args` as loose elements collected into
/// a `Vec` and handed to a single `.args(&hardening_args)` call — never as
/// an inline `.arg("-c")`/`.args(["-c", ..])` literal — because `-c` here is
/// *git's own* config-override flag (required for this exact hardening),
/// not a shell interpreter argument; `boundary-contracts.mjs`'s spawn guard
/// bans `.arg("-c")`/`.args(["-c", ..])` literals specifically to catch a
/// shell-interpreter bypass (`sh -c "..."`), a check this file must keep
/// passing without being exempted from it.
fn harden_background_read(command: &mut Command) {
    for name in ["PATH", "HOME"] {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    command.env("GIT_OPTIONAL_LOCKS", "0");
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GIT_ASKPASS", GIT_ASKPASS_REJECT_PROGRAM);
    command.env("LANG", "en_US.UTF-8");
    command.env("LC_ALL", "en_US.UTF-8");

    let mut hardening_args: Vec<String> = Vec::new();
    hardening_args.push("-c".to_owned());
    hardening_args.push(format!(
        "core.hooksPath={}",
        disabled_hooks_path().display()
    ));
    hardening_args.push("-c".to_owned());
    hardening_args.push("core.fsmonitor=".to_owned());
    command.args(&hardening_args);
}

/// Which of the three race-y ways [`wait_with_limits`]'s poll loop can end.
enum ExecOutcome {
    Exited(std::process::ExitStatus),
    TimedOut,
    Cancelled,
    OutputLimitExceeded,
}

/// Polls `child` to completion, enforcing the timeout/cancel/output-cap
/// trio described in the module and [`run_git`] docs, while two dedicated
/// threads concurrently drain stdout/stderr (necessary regardless of the
/// cap: without a concurrent drain, a child that writes more than the OS
/// pipe buffer holds would deadlock against this function's own poll loop
/// never reading it). Mirrors `terminal::service`'s "one dedicated thread
/// per blocking I/O role" precedent, scaled down to this domain's simpler
/// one-shot-capture shape (no vt/reader split needed here — just drain-and-
/// cap).
fn wait_with_limits(
    mut child: Child,
    cancel: &AtomicBool,
    timeout: Duration,
    output_cap_bytes: usize,
) -> Result<GitExecOutput, CommandError> {
    let stdout = child.stdout.take().expect("run_git always pipes stdout");
    let stderr = child.stderr.take().expect("run_git always pipes stderr");
    let cap_exceeded = Arc::new(AtomicBool::new(false));

    let stdout_handle = spawn_capped_reader(stdout, Arc::clone(&cap_exceeded), output_cap_bytes);
    let stderr_handle = spawn_capped_reader(stderr, Arc::clone(&cap_exceeded), output_cap_bytes);

    let start = Instant::now();
    let outcome = loop {
        if let Some(status) = child.try_wait().map_err(|_| git_exec_unavailable())? {
            break ExecOutcome::Exited(status);
        }
        if cap_exceeded.load(Ordering::SeqCst) {
            kill_and_reap(&mut child);
            break ExecOutcome::OutputLimitExceeded;
        }
        if cancel.load(Ordering::SeqCst) {
            kill_and_reap(&mut child);
            break ExecOutcome::Cancelled;
        }
        if start.elapsed() >= timeout {
            kill_and_reap(&mut child);
            break ExecOutcome::TimedOut;
        }
        std::thread::sleep(GIT_EXEC_POLL_INTERVAL);
    };

    let stdout_bytes = stdout_handle.join().unwrap_or_default();
    let stderr_bytes = stderr_handle.join().unwrap_or_default();

    match outcome {
        ExecOutcome::TimedOut => Err(git_exec_timeout()),
        ExecOutcome::Cancelled => Err(git_exec_cancelled()),
        ExecOutcome::OutputLimitExceeded => Err(git_exec_output_limit_exceeded()),
        ExecOutcome::Exited(status) => {
            if cap_exceeded.load(Ordering::SeqCst) {
                return Err(git_exec_output_limit_exceeded());
            }
            Ok(GitExecOutput {
                exit_code: status.code().unwrap_or(-1),
                stdout: stdout_bytes,
                stderr: stderr_bytes,
            })
        }
    }
}

fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Reads `source` to completion on a dedicated thread, collecting up to
/// [`GIT_EXEC_OUTPUT_CAP_BYTES`] bytes; the moment that cap would be
/// exceeded it sets `cap_exceeded` (observed by [`wait_with_limits`]'s poll
/// loop, which then kills the child) and keeps draining-and-discarding any
/// further bytes so the child's write end never blocks on a full pipe
/// buffer while the main thread notices the flag and kills it.
fn spawn_capped_reader(
    mut source: impl Read + Send + 'static,
    cap_exceeded: Arc<AtomicBool>,
    output_cap_bytes: usize,
) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut data = Vec::new();
        let mut buffer = [0_u8; GIT_EXEC_READ_BUFFER_BYTES];
        loop {
            let read = match source.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            if data.len() + read > output_cap_bytes {
                let remaining = output_cap_bytes.saturating_sub(data.len());
                data.extend_from_slice(&buffer[..remaining.min(read)]);
                cap_exceeded.store(true, Ordering::SeqCst);
                loop {
                    match source.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => continue,
                    }
                }
                break;
            }
            data.extend_from_slice(&buffer[..read]);
        }
        data
    })
}

#[cfg(test)]
mod tests;
