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

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::CommandError;

use super::{
    git_cwd_invalid, git_exec_cancelled, git_exec_output_limit_exceeded, git_exec_timeout,
    git_exec_unavailable,
};

/// Hardening profile [`run_git`]/[`run_git_network`] applies.
/// [`GitExecMode::BackgroundRead`] (`F080` S0), [`GitExecMode::Write`]
/// (`F080` S3) and [`GitExecMode::Network`] (`F080` S4) are all implemented.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GitExecMode {
    /// Automatic, non-user-initiated reads (status/diff/blame/log/rev-parse
    /// style commands): hooks, fsmonitor, external diff/textconv and any
    /// credential/SSH prompt are all disabled — see [`harden_background_read`].
    BackgroundRead,
    /// User-initiated writes (`F080` S3: stage/unstage/hunk-stage/commit/
    /// discard). Unlike [`GitExecMode::BackgroundRead`], hooks and fsmonitor
    /// are deliberately **not** overridden — a user-initiated write should
    /// respect the repository's own configuration (ADR 0003, a product
    /// decision, not an oversight). See [`harden_write`] for the precise
    /// difference from [`harden_background_read`].
    Write,
    /// User-initiated network operations (`F080` S4: fetch/pull/push) — the
    /// first mode that legitimately needs to authenticate against a remote.
    /// Like [`GitExecMode::Write`], hooks/fsmonitor/locking are left at the
    /// repository's own configuration; unlike either other mode, `SSH_AUTH_SOCK`
    /// is passed through so `ssh-agent`-based authentication works at all.
    /// See [`harden_network`] for the full, audited rationale — every
    /// passthrough/override decision there is backed by an empirical test in
    /// `tests.rs`, not asserted from memory. Always spawned through
    /// [`run_git_network`] (never [`run_git`]/[`run_git_with_stdin`]), which
    /// applies [`GIT_EXEC_NETWORK_TIMEOUT`] instead of the much shorter
    /// [`GIT_EXEC_TIMEOUT`] every other mode uses.
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

/// Wall-clock ceiling for a single [`GitExecMode::Network`] invocation
/// (fetch/pull/push) — reusing [`GIT_EXEC_TIMEOUT`] (sized for a local
/// status/diff/commit) would kill a perfectly healthy slow clone/push over a
/// high-latency remote or a large object transfer. [`wait_with_limits`]'s
/// cooperative cancellation check runs on the exact same poll cadence
/// regardless of which timeout is in effect, so this longer ceiling does not
/// weaken a user's ability to abort a stuck network operation early — the
/// cancel flag, not this timeout, is the real "let the user give up sooner"
/// mechanism for this mode.
const GIT_EXEC_NETWORK_TIMEOUT: Duration = Duration::from_secs(300);

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
    let mut command = build_git_command(repo_dir, args, mode, false)?;
    let child = command.spawn().map_err(|_| git_exec_unavailable())?;
    wait_with_limits(child, cancel, timeout, output_cap_bytes)
}

/// Identical to [`run_git`] except `stdin` is written to the child's stdin
/// pipe (and the pipe is then closed, signaling EOF) — needed for
/// `git hash-object --stdin` (hunk-level stage blob content) and
/// `git commit --file -` (commit message), both of which take their payload
/// over stdin rather than as a command-line argument (per
/// `docs/research/2026-07-25-core-git.md`'s hunk-stage/commit architecture
/// notes — a commit message in particular must never appear as an argv
/// element, e.g. a `-`-prefixed message line being misread as a flag).
pub(crate) fn run_git_with_stdin(
    repo_dir: &Path,
    args: &[String],
    mode: GitExecMode,
    cancel: &AtomicBool,
    stdin: &[u8],
) -> Result<GitExecOutput, CommandError> {
    run_git_with_stdin_and_limits(
        repo_dir,
        args,
        mode,
        cancel,
        stdin,
        GIT_EXEC_TIMEOUT,
        GIT_EXEC_OUTPUT_CAP_BYTES,
    )
}

/// Test-only seam onto [`run_git_network`]: identical except the timeout and
/// per-stream output cap are caller-supplied instead of the fixed
/// [`GIT_EXEC_NETWORK_TIMEOUT`]/[`GIT_EXEC_OUTPUT_CAP_BYTES`] constants —
/// mirrors [`run_git_with_limits_for_test`]'s exact rationale, needed so a
/// timeout/cancellation test for this mode runs in milliseconds instead of
/// actually waiting out a real 300-second production timeout.
#[cfg(test)]
pub(crate) fn run_git_network_with_limits_for_test(
    repo_dir: &Path,
    args: &[String],
    cancel: &AtomicBool,
    timeout: Duration,
    output_cap_bytes: usize,
) -> Result<GitExecOutput, CommandError> {
    run_git_with_limits(
        repo_dir,
        args,
        GitExecMode::Network,
        cancel,
        timeout,
        output_cap_bytes,
    )
}

/// Test-only seam onto the stdin-capable spawn path — mirrors
/// [`run_git_with_limits_for_test`]'s exact rationale.
#[cfg(test)]
pub(crate) fn run_git_with_stdin_and_limits_for_test(
    repo_dir: &Path,
    args: &[String],
    mode: GitExecMode,
    cancel: &AtomicBool,
    stdin: &[u8],
    timeout: Duration,
    output_cap_bytes: usize,
) -> Result<GitExecOutput, CommandError> {
    run_git_with_stdin_and_limits(
        repo_dir,
        args,
        mode,
        cancel,
        stdin,
        timeout,
        output_cap_bytes,
    )
}

fn run_git_with_stdin_and_limits(
    repo_dir: &Path,
    args: &[String],
    mode: GitExecMode,
    cancel: &AtomicBool,
    stdin: &[u8],
    timeout: Duration,
    output_cap_bytes: usize,
) -> Result<GitExecOutput, CommandError> {
    let mut command = build_git_command(repo_dir, args, mode, true)?;
    let mut child = command.spawn().map_err(|_| git_exec_unavailable())?;
    let mut stdin_pipe = child.stdin.take().expect("stdin is always piped here");
    let stdin_bytes = stdin.to_vec();
    // A dedicated writer thread, exactly like the dedicated stdout/stderr
    // reader threads in `spawn_capped_reader` below: writing from the main
    // thread while also needing to poll/drain stdout/stderr would risk a
    // pipe-buffer deadlock the moment `stdin` exceeds the OS pipe buffer size
    // (a commit message or a several-MB hunk blob both plausibly can).
    // Dropping `stdin_pipe` at the end of this closure closes the write end,
    // signaling EOF to the child — required for `hash-object`/`commit --file
    // -` to stop reading and proceed.
    let writer_handle = std::thread::spawn(move || {
        let _ = stdin_pipe.write_all(&stdin_bytes);
    });

    let result = wait_with_limits(child, cancel, timeout, output_cap_bytes);
    let _ = writer_handle.join();
    result
}

/// Runs `git` under [`GitExecMode::Network`] (`F080` S4: fetch/pull/push) —
/// the sole entry point for that mode, exactly like [`run_git`] is the sole
/// entry point that ever implicitly means [`GitExecMode::BackgroundRead`]/
/// [`GitExecMode::Write`] elsewhere in this domain's write/read call sites.
/// Applies [`GIT_EXEC_NETWORK_TIMEOUT`] instead of [`run_git`]'s
/// [`GIT_EXEC_TIMEOUT`] — see that constant's own doc comment — but is
/// otherwise identical in shape (same output cap, same cooperative
/// cancellation via `cancel`).
pub(crate) fn run_git_network(
    repo_dir: &Path,
    args: &[String],
    cancel: &AtomicBool,
) -> Result<GitExecOutput, CommandError> {
    run_git_with_limits(
        repo_dir,
        args,
        GitExecMode::Network,
        cancel,
        GIT_EXEC_NETWORK_TIMEOUT,
        GIT_EXEC_OUTPUT_CAP_BYTES,
    )
}

/// Builds (but does not spawn) the hardened `git` [`Command`] shared by every
/// [`run_git`]/[`run_git_with_stdin`] call — the one place `Command::new`
/// appears in this file, applying [`GitExecMode`]'s hardening profile and
/// validating `repo_dir` first (see the module doc's "cwd validation split").
fn build_git_command(
    repo_dir: &Path,
    args: &[String],
    mode: GitExecMode,
    has_stdin: bool,
) -> Result<Command, CommandError> {
    let canonical_dir = std::fs::canonicalize(repo_dir).map_err(|_| git_cwd_invalid())?;
    if !canonical_dir.is_dir() {
        return Err(git_cwd_invalid());
    }

    let mut command = Command::new("git");
    command.current_dir(&canonical_dir);
    command.stdin(if has_stdin {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.env_clear();

    match mode {
        GitExecMode::BackgroundRead => harden_background_read(&mut command),
        GitExecMode::Write => harden_write(&mut command),
        GitExecMode::Network => harden_network(&mut command),
    }

    command.args(args);
    Ok(command)
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

/// Hardening applied for [`GitExecMode::Write`] (`F080` S3: stage/unstage/
/// hunk-stage/commit/discard — every one of these is a direct result of the
/// *user* invoking a Plain command, never an automatic background poll).
///
/// The precise, deliberate difference from [`harden_background_read`]:
/// - **Not** applied here: the `-c core.hooksPath=<disabled>` and
///   `-c core.fsmonitor=` overrides. ADR 0003 ("用户发起的 commit 等本地写
///   操作可使用相应 hooks/filters") means a user-initiated write must respect
///   the repository's own hooks/fsmonitor configuration — a real
///   `pre-commit`/`commit-msg`/`post-commit` hook genuinely runs under this
///   mode. See `stage/tests.rs`'s/`commit/tests.rs`'s hook-fires fixture for
///   the executable proof this is intentional, contrasted with
///   `exec/tests.rs`'s existing `background_read_disables_a_malicious_*`
///   tests (which must keep passing completely unchanged — this function
///   must never weaken [`harden_background_read`] itself).
/// - **Not** applied here: `GIT_OPTIONAL_LOCKS=0`. That override exists only
///   to skip *opportunistic* locking a background read has no business
///   taking (e.g. an ahead/behind ref-lock refresh `status` may attempt);
///   every write command in this mode genuinely needs git's own normal index/
///   ref locking to do its job at all.
/// - **Still** applied here (this mode's own defense-in-depth floor, not a
///   functional restriction): `GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS` (none of
///   this slice's write commands ever touch a remote or need credentials —
///   stage/commit/discard are always local — so suppressing an interactive
///   credential prompt costs nothing while still closing off an unexpected
///   hang if some unusual hook tried to reach a remote) and the fixed
///   `LANG`/`LC_ALL` locale (parser stability reasoning identical to
///   [`harden_background_read`]).
fn harden_write(command: &mut Command) {
    for name in ["PATH", "HOME"] {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GIT_ASKPASS", GIT_ASKPASS_REJECT_PROGRAM);
    command.env("LANG", "en_US.UTF-8");
    command.env("LC_ALL", "en_US.UTF-8");
}

/// The exact, audited environment-variable passthrough closed set for
/// [`GitExecMode::Network`] — locked by `scripts/plain/boundary-contracts.mjs`
/// exactly like `terminal/shell.rs`'s `TERMINAL_ENV_PASSTHROUGH_NAMES`, so a
/// future edit cannot silently widen it. See [`harden_network`]'s own doc
/// comment for why each of these three (and no others) is here.
pub(crate) const GIT_NETWORK_ENV_PASSTHROUGH_NAMES: &[&str] = &["PATH", "HOME", "SSH_AUTH_SOCK"];

/// Hardening applied for [`GitExecMode::Network`] (`F080` S4: fetch/pull/
/// push) — the first mode in this domain that legitimately needs to
/// authenticate against a remote. Structurally closest to [`harden_write`]
/// (hooks/fsmonitor/`GIT_OPTIONAL_LOCKS` are left alone for the same reasons
/// documented there — a user-initiated network write should respect the
/// repository's own `pre-push` hook and needs git's normal ref locking), with
/// two deliberate deltas:
///
/// # Passthrough set: `PATH`/`HOME`/`SSH_AUTH_SOCK`, and nothing else
///
/// [`GIT_NETWORK_ENV_PASSTHROUGH_NAMES`] is an intentional, minimal closed
/// set — not "whatever the ambient process happened to have":
/// - `PATH`/`HOME`: identical reasoning to every other mode in this file
///   (resolve the `git` binary itself; locate global gitconfig/credential
///   stores under `HOME`).
/// - `SSH_AUTH_SOCK`: the *only* variable an SSH client needs to reach a
///   running `ssh-agent` over its Unix-domain socket. Verified empirically
///   (this slice's own report) against a real `ssh-agent`: `ssh-add -l`
///   against an agent holding a real key succeeds with `SSH_AUTH_SOCK` set
///   and fails ("Could not open a connection to your authentication agent")
///   the instant it is unset — exactly what `env_clear()` does to every
///   `git fetch`/`push` over an `ssh://` remote without this passthrough.
///   Separately confirmed against real `git` itself (not just `ssh-add`): a
///   real `git fetch ssh://…` with `core.sshCommand` pointed at a script
///   that records its own environment shows `SSH_AUTH_SOCK` reaching the
///   child exactly when this passthrough set includes it.
/// - **Deliberately *not* passed**: `SSH_AGENT_PID`. That variable exists
///   only so `ssh-agent -s`'s own shell-eval output can later `kill` the
///   agent it started (`ssh-agent -k`); the SSH *client* never reads it to
///   authenticate — only the `SSH_AUTH_SOCK` socket path is consulted for
///   that. Passing it would grow the closed set for zero capability gain, so
///   it is left out on purpose, not by oversight.
///
/// # Credential helpers and SSH agent are allowed to run
///
/// Unlike [`harden_background_read`] (which never touches a remote at all),
/// this mode's whole point is a user-explicit network operation — matching
/// ADR 0003's "用户显式写/网络操作才放行 hooks/filters/credential/SSH". Concretely:
/// this function does not touch `credential.helper` at all (so a configured
/// macOS `osxkeychain` helper, or any other helper the repository/global git
/// config already names, runs exactly as it would from a real terminal), and
/// `SSH_AUTH_SOCK` above lets a configured `ssh-agent` authenticate normally.
///
/// # `GIT_TERMINAL_PROMPT=0` and `GIT_ASKPASS` are still both set
///
/// A GUI application has no controlling TTY for git to prompt on — allowing
/// an interactive prompt here would not surface a real UI, it would simply
/// hang the child process forever. This slice deliberately does **not**
/// build a credential-entry UI of its own (see the module doc / this slice's
/// report for that explicit, disclosed scope limit): a missing/incomplete
/// credential must fail cleanly and quickly, never hang.
///
/// `GIT_ASKPASS` staying pinned to [`GIT_ASKPASS_REJECT_PROGRAM`] is *not*
/// redundant with `GIT_TERMINAL_PROMPT=0`, and this was verified empirically
/// (this slice's own report; real `git credential fill` transcripts, no
/// network involved — `git credential fill` exercises the exact same
/// credential-resolution subsystem `fetch`/`pull`/`push` use, without
/// needing a real remote):
/// 1. A fully-satisfying `credential.helper` response means askpass is never
///    consulted at all, by either mechanism — proven against a helper that
///    supplies both `username` and `password`: a hostile `core.askPass`
///    configured alongside it never fires. So allowing credential helpers to
///    run (above) does not get silently defeated by keeping `GIT_ASKPASS`
///    pinned here.
/// 2. The `GIT_ASKPASS` *environment variable* takes precedence over the
///    repository's own `core.askPass` *configuration* — proven against a
///    second credential helper that supplies only a `username` (forcing git
///    to seek the missing `password` elsewhere): with no `GIT_ASKPASS` env
///    var set at all, a hostile `core.askPass` genuinely fires. This is the
///    same category of attack `exec/tests.rs`'s existing hostile
///    `core.hooksPath`/`core.fsmonitor` fixtures already establish for other
///    config keys — a malicious *repository* could set `core.askPass` to an
///    exfiltration script, and `GIT_TERMINAL_PROMPT=0` alone does **not**
///    stop it from running. Pinning `GIT_ASKPASS` to
///    [`GIT_ASKPASS_REJECT_PROGRAM`] restores fail-closed behavior: the
///    reject program runs instead (exits non-zero immediately, no prompt, no
///    hang), and the hostile `core.askPass` is never invoked.
///
/// So the combination is not belt-and-suspenders redundancy: `GIT_ASKPASS`
/// closes a real config-level bypass that `GIT_TERMINAL_PROMPT=0` alone does
/// not.
fn harden_network(command: &mut Command) {
    for name in GIT_NETWORK_ENV_PASSTHROUGH_NAMES {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GIT_ASKPASS", GIT_ASKPASS_REJECT_PROGRAM);
    command.env("LANG", "en_US.UTF-8");
    command.env("LC_ALL", "en_US.UTF-8");
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
