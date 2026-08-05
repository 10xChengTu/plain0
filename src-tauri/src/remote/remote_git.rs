//! `F220` S6: SSH-`exec`-channel-backed git transport — the sole owner of
//! this domain's `channel.exec(..)` sequencing, and the *only* file in the
//! whole crate permitted to call [`super::shell_escape::encode_posix_command_line`]
//! (mechanically locked by `scripts/plain/boundary-contracts.mjs`'s
//! `validateShellEscapeSoleCallerBoundary` — see that guard's own doc
//! comment). Exposes a narrow, `russh`-free interface to `git::remote_route`
//! (this module's sole caller): [`RemoteGitExecMode`]/[`RemoteGitExecOutcome`]/
//! [`RemoteGitExecFailure`] are all plain enums/structs of primitive types
//! (`i32`, `Vec<u8>`, `String`) — no `Channel`, `ChannelMsg`, or any other
//! `russh` type ever appears in this module's public signatures, exactly
//! like `remote::remote_terminal`'s own five-narrow-struct interface to
//! `terminal::service` (see that module's own doc comment for the mirrored
//! "sole owner of the channel handle" design this one repeats for a
//! non-interactive, one-shot exec instead of an interactive pty session).
//!
//! # Why `exec`, not `pty-req`/`shell`
//!
//! Git's core plumbing/porcelain commands are one-shot, capture-to-completion
//! invocations — exactly `git::exec::run_git`'s own local shape — never an
//! interactive session. SSH's `exec` request
//! (`channel.exec(want_reply, command)`) is the wire-protocol analogue of
//! that: a single command line, run once, whose stdout/stderr/exit status
//! this module collects and hands back as one [`RemoteGitExecOutcome`] — the
//! remote-transport twin of [`super::super::git::exec::GitExecOutput`]
//! (never referenced directly — this module has no dependency on `git::` at
//! all, see the module doc's "narrow interface" note above; `git::
//! remote_route` is what reshapes [`RemoteGitExecOutcome`] into that type).
//!
//! # The `command` string: this module builds it, [`super::shell_escape`] encodes it
//!
//! SSH's `exec` request carries exactly one opaque byte string, not an argv
//! array — there is no protocol-level place to put "git", "-C", the
//! repository path, and every subcommand argument as separate wire fields the
//! way a local `std::process::Command::args(..)` call would. [`build_argv`]
//! assembles the *real* argv array this invocation represents — starting with
//! `"env"` and the hardening environment-variable overrides
//! [`RemoteGitExecMode`] selects (SSH `exec` has no structured environment
//! channel of its own — see [`RemoteGitExecMode`]'s own doc comment), then
//! `"git"`, `"-C"`, the repository path, any mode-specific `-c` config
//! overrides, and finally the caller-supplied git subcommand and its
//! arguments — and hands that array, unmodified, to
//! [`super::shell_escape::encode_posix_command_line`], which is the *only*
//! thing in this whole path that ever produces a shell-syntax string. Every
//! element of that array — including a value like
//! `"core.hooksPath=/dev/null"` that happens to look like it contains shell
//! syntax — is a single, whole token to the encoder; nothing in this module
//! ever concatenates a caller-supplied string into a command line by hand.
//!
//! # Cancellation and timeout: `tokio::select!` racing the channel against a poll clock
//!
//! Every one of this domain's six routed git commands now involves a real
//! network round trip (unlike their local counterparts' `GitExecMode::
//! BackgroundRead`/`Write`, which are `git::network::GitNetworkService`-free
//! by design — see that service's own module doc for why), so
//! [`run_remote_git`] gives every call a real, bounded timeout
//! ([`REMOTE_GIT_EXEC_TIMEOUT`]) and a real, caller-driven cancellation flag
//! — `git::remote_route` wires this to the exact same
//! `GitNetworkService::begin_for_root`/`request_cancel_for_root`/`end_for_root`
//! machinery `git::network`'s fetch/pull/push already exposed to the
//! frontend's `git_network_cancel` IPC command, so no new cancel entry point
//! is needed. The read loop's `tokio::select!` races "wait for the next
//! channel message" against a `tokio::time::interval` tick at
//! [`REMOTE_GIT_EXEC_POLL_INTERVAL`] (the same 10ms cadence
//! `git::exec::GIT_EXEC_POLL_INTERVAL` uses for its own thread-based poll
//! loop, translated to this module's `async`/`tokio::select!` shape) that
//! checks the cancel flag and the deadline. Either firing sends `eof`+`close`
//! on the channel's write half and returns immediately — this module never
//! waits for the remote peer to acknowledge before releasing its own local
//! resources (mirrors `remote::remote_terminal::RemoteTerminalKiller::shutdown`'s
//! "kill = signal, then unconditional local release" stance, simplified here
//! because an exec channel has no pty/kill concept to reconcile, only "stop
//! waiting for this invocation").

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use russh::client::Msg;
use russh::{Channel, ChannelMsg, ChannelWriteHalf};

use super::dto::RemoteSessionId;
use super::session::RemoteSessionService;
use super::shell_escape::encode_posix_command_line;

/// Per-stream output cap for a single remote git invocation's stdout or
/// stderr — the exact same numeric ceiling `git::exec::GIT_EXEC_OUTPUT_CAP_BYTES`
/// uses for the local exec path, deliberately **not** referenced from there
/// (that constant is private to `git::exec`, and this module must not
/// introduce a cross-domain dependency on `git::` at all — see the module
/// doc's "narrow interface" note): defined independently here, at the same
/// value, because the two ceilings protect the identical thing (bounding
/// memory against a pathological invocation's output) for the identical
/// class of command, so there is no reason for a remote status/diff/log to
/// tolerate a different-sized payload than its local counterpart would.
const REMOTE_GIT_EXEC_OUTPUT_CAP_BYTES: usize = 10_000_000;

/// Wall-clock ceiling for a single remote git invocation. Sized larger than
/// `git::exec::GIT_EXEC_TIMEOUT`'s 30 seconds (a purely local invocation with
/// no network latency of any kind) but far smaller than
/// `git::exec::GIT_EXEC_NETWORK_TIMEOUT`'s 300 seconds (`fetch`/`pull`/`push`,
/// which may need to transfer an arbitrarily large object pack): every
/// command this module ever runs (status/diff/log/stage/unstage/commit) is a
/// metadata-and-small-payload operation with no object-transfer negotiation
/// of its own, so it only needs to absorb one extra SSH round trip's worth of
/// latency (channel open + exec + reply) on top of the local ceiling, not a
/// large-transfer budget.
const REMOTE_GIT_EXEC_TIMEOUT: Duration = Duration::from_secs(60);

/// How often the cancellation/timeout arm of [`run_remote_git_with_timeout`]'s
/// `tokio::select!` wakes up — the same 10ms cadence
/// `git::exec::GIT_EXEC_POLL_INTERVAL` uses for its own (thread-based, not
/// `tokio::select!`-based) poll loop; see the module doc.
const REMOTE_GIT_EXEC_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// SSH extended-data stream 1 is `SSH_EXTENDED_DATA_STDERR` per RFC 4254 §5.2
/// — the one and only extended-data stream this domain (or any ordinary
/// `exec` session) ever receives.
const SSH_EXTENDED_DATA_STDERR: u32 = 1;

/// `askpass` value baked into every hardening profile below — an absolute
/// path this module assumes exists on the remote host and exits non-zero
/// immediately without prompting. Unlike `git::exec::GIT_ASKPASS_REJECT_PROGRAM`
/// (which is `cfg`-selected per *this* process's own target OS, since it
/// spawns `git` locally), the remote host's OS is unknown and unknowable
/// ahead of connection — but every Plain remote-workspace target is reached
/// over SSH, which in practice means a POSIX host, so a fixed POSIX path is
/// the right default (mirrors `git::exec`'s own already-audited unix value,
/// deliberately not made configurable for this first slice).
const REMOTE_GIT_ASKPASS_REJECT_PROGRAM: &str = "/usr/bin/false";

/// Which hardening profile [`run_remote_git`] applies — the remote-transport
/// counterpart to `git::exec::GitExecMode`'s `BackgroundRead`/`Write`
/// variants (this module never handles `Network`: `git::network`'s
/// `fetch`/`pull`/`push` fail closed for a remote root entirely, before ever
/// reaching this module — see `git::remote_route`'s own doc comment). This is
/// an independent type, not a re-export or wrapper of `git::exec::GitExecMode`
/// — `git::remote_route` maps one to the other at its own call site, keeping
/// this module free of any dependency on `git::` (see the module doc).
///
/// # Why every hardening override rides as `argv[0..]` `"env" "KEY=VALUE"` pairs
///
/// SSH's `exec` request has no structured per-invocation environment channel
/// the way `std::process::Command::env(..)` does locally — the closest SSH
/// primitive, `SetEnv`, is a *separate* channel request most `sshd`
/// configurations reject by default for non-allowlisted variable names (and
/// this domain deliberately never relies on it — see
/// `remote::remote_terminal`'s own module doc for the identical "does not
/// forward local environment" stance for the sibling terminal transport).
/// [`build_argv`] instead prepends `"env"` as the actual program to invoke,
/// with each `"KEY=VALUE"` override as one of *its* arguments (`env`'s own
/// documented behavior: set each named variable, then exec the remaining
/// argv) — every one of these remains a single, whole token through
/// [`super::shell_escape::encode_posix_command_line`], so this technique
/// introduces no shell-syntax risk of its own; it is just one more argv
/// element.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteGitExecMode {
    /// Remote twin of `git::exec::GitExecMode::BackgroundRead` — status/diff/log,
    /// the three read-only commands this slice routes remotely. Applies
    /// `GIT_OPTIONAL_LOCKS=0`/`GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS`/`LANG`/
    /// `LC_ALL` (mirroring the local profile's own env overrides) plus two
    /// `-c` config overrides on the `git` invocation itself:
    /// `core.hooksPath=/dev/null` and `core.fsmonitor=`.
    ///
    /// **Disclosed narrowing, not an oversight**: unlike
    /// `git::exec::harden_background_read`, this profile does **not**
    /// neutralize `.gitattributes`-configured `filter.<name>.{clean,smudge,
    /// process}` content-filter drivers — doing so locally requires a
    /// bootstrap `git config --list -z` round trip to discover configured
    /// filter names before the real command runs (see that function's own
    /// doc comment), and this slice does not implement a second remote exec
    /// round trip purely to enumerate filter names before every
    /// status/diff/log call. The threat model differs from the local case
    /// too: a malicious filter neutralized here would otherwise execute *on
    /// the remote host*, which — unlike an untrusted local repository
    /// polluting *this* machine — is already the "远程主机是不受信任的输入源"
    /// endpoint the user explicitly chose to connect to and trust a live SSH
    /// session against (ADR 0006 §4); it is a real, disclosed reduction in
    /// depth-of-defense on that host, not a bypass of Plain's own local trust
    /// boundary. `core.hooksPath`/`core.fsmonitor` are still neutralized
    /// (fixed keys, zero extra round trips, and are the more commonly
    /// hostile vector — an arbitrary hook binary versus a repository having
    /// to *also* configure a matching `.gitattributes` filter driver).
    /// `/dev/null` (rather than local's own "a path this process never
    /// creates") is this profile's own equivalent hooksPath sentinel: it
    /// almost always exists on a POSIX remote host and is never a directory,
    /// so any hook lookup underneath it fails with `ENOTDIR`/`ENOENT`
    /// exactly like local's sentinel does, without this module needing to
    /// create anything on a filesystem it has no ambient access to at all.
    BackgroundRead,
    /// Remote twin of `git::exec::GitExecMode::Write` — stage/unstage/commit,
    /// the three write commands this slice routes remotely. Deliberately
    /// does **not** override `core.hooksPath`/`core.fsmonitor` (ADR 0003's
    /// "用户发起的写操作应该尊重远程仓库自己的 hooks 配置" — ratified for the
    /// local `Write` profile, applied identically here): a real
    /// `pre-commit`/`commit-msg`/`post-commit` hook the remote repository
    /// configures genuinely fires. Still applies
    /// `GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS`/`LANG`/`LC_ALL` (defense in
    /// depth — none of stage/unstage/commit ever touch a remote-of-the-remote
    /// network endpoint, so this costs nothing while still closing off an
    /// unexpected hang if some unusual hook tried to).
    Write,
}

impl RemoteGitExecMode {
    /// The `"KEY=VALUE"` environment overrides this profile prepends after
    /// `"env"` — see this type's own doc comment for why they ride as argv
    /// elements rather than a structured SSH environment channel.
    fn env_overrides(self) -> Vec<String> {
        let mut overrides = vec!["GIT_LITERAL_PATHSPECS=1".to_owned()];
        if matches!(self, Self::BackgroundRead) {
            overrides.push("GIT_OPTIONAL_LOCKS=0".to_owned());
        }
        overrides.push("GIT_TERMINAL_PROMPT=0".to_owned());
        overrides.push(format!("GIT_ASKPASS={REMOTE_GIT_ASKPASS_REJECT_PROGRAM}"));
        overrides.push("LANG=en_US.UTF-8".to_owned());
        overrides.push("LC_ALL=en_US.UTF-8".to_owned());
        overrides
    }

    /// The `-c key=value` config overrides this profile appends immediately
    /// after `"-C" "<repo_path>"`, before the caller's own subcommand and
    /// arguments — see [`Self::BackgroundRead`]'s own doc comment for the
    /// disclosed filter-neutralization narrowing.
    fn config_overrides(self) -> Vec<String> {
        match self {
            Self::BackgroundRead => vec![
                "-c".to_owned(),
                "core.hooksPath=/dev/null".to_owned(),
                "-c".to_owned(),
                "core.fsmonitor=".to_owned(),
            ],
            Self::Write => Vec::new(),
        }
    }
}

/// The remote-transport twin of `git::exec::GitExecOutput` — deliberately not
/// that type itself (see the module doc's "narrow interface" note); a
/// non-zero `exit_code` is not itself an error here for the exact same reason
/// it is not one locally (`git rev-parse --show-toplevel` outside a
/// repository, or `git commit` with nothing staged, are meaningful data, not
/// exec-mechanism failures) — [`RemoteGitExecFailure`] is reserved for a
/// failure of the *transport* itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteGitExecOutcome {
    pub(crate) exit_code: i32,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

/// Every distinguishable way [`run_remote_git`] can fail *as a transport* —
/// `git::remote_route` maps each variant onto one of `git::`'s own existing
/// `GIT_EXEC_*` codes (or, for [`Self::Disconnected`], the more precise
/// `remote::remote_session_disconnected` — see that module's own doc
/// comment), so a caller of the routed `git::` functions never has to know
/// whether a given exec ran locally or remotely to interpret a transport
/// failure. Contains no `russh` type — see the module doc.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteGitExecFailure {
    /// The channel could not be opened, the `exec` request itself failed to
    /// send, the server replied `SSH_MSG_CHANNEL_FAILURE` (or something
    /// other than `SSH_MSG_CHANNEL_SUCCESS`) to it, or a write (stdin data/
    /// eof) failed — every "the exec mechanism itself could not even start
    /// or complete its handshake" outcome. Also covers
    /// [`super::shell_escape::encode_posix_command_line`] itself failing
    /// (which in practice cannot happen for the argv this module builds —
    /// see [`build_argv`] — since it never embeds a NUL byte or exceeds the
    /// encoder's length ceiling, but is still handled rather than unwrapped).
    Unavailable,
    /// [`REMOTE_GIT_EXEC_TIMEOUT`] elapsed before the invocation completed.
    TimedOut,
    /// The caller's cancellation flag was observed set.
    Cancelled,
    /// Accumulated stdout or stderr exceeded [`REMOTE_GIT_EXEC_OUTPUT_CAP_BYTES`].
    OutputLimitExceeded,
    /// The channel closed (or the session was already gone when this call
    /// tried to open it) without ever reporting an `exit-status` — a
    /// transport-level disconnect, not a normal (even a non-zero) exit.
    Disconnected,
}

/// Assembles the real argv array this invocation represents — see the module
/// doc's "The `command` string" section for why this is the only place that
/// shape is ever decided, and [`RemoteGitExecMode`]'s own doc comment for
/// exactly which overrides each profile contributes.
fn build_argv(repo_path: &str, mode: RemoteGitExecMode, git_args: &[String]) -> Vec<String> {
    let mut argv = vec!["env".to_owned()];
    argv.extend(mode.env_overrides());
    argv.push("git".to_owned());
    argv.push("-C".to_owned());
    argv.push(repo_path.to_owned());
    argv.extend(mode.config_overrides());
    argv.extend(git_args.iter().cloned());
    argv
}

/// Runs one remote git invocation under production timing — the sole
/// production entry point every one of `git::remote_route`'s six routed
/// commands (plus its own internal toplevel-discovery call) reaches through.
/// `git_args` is the git subcommand and its arguments only (e.g.
/// `["status", "--porcelain=v2", "-z", "--branch", "--ignored"]`) — never
/// including `"git"`, `"-C"`, the repository path, or any hardening override,
/// all of which [`build_argv`] adds. `stdin`, when `Some`, is written to the
/// channel and followed by `eof` before this function ever starts reading a
/// reply — used only by `commit`'s message-over-stdin call.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_remote_git(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    repo_path: &str,
    mode: RemoteGitExecMode,
    git_args: &[String],
    stdin: Option<&[u8]>,
    cancel: &AtomicBool,
) -> Result<RemoteGitExecOutcome, RemoteGitExecFailure> {
    run_remote_git_with_timeout(
        remote,
        window_label,
        session_id,
        repo_path,
        mode,
        git_args,
        stdin,
        cancel,
        REMOTE_GIT_EXEC_TIMEOUT,
    )
    .await
}

/// Test-only seam onto [`run_remote_git_with_timeout`]: identical to
/// [`run_remote_git`] except the timeout is caller-supplied instead of the
/// fixed [`REMOTE_GIT_EXEC_TIMEOUT`] — mirrors
/// `git::exec::run_git_with_limits_for_test`'s exact rationale, needed so a
/// timeout/cancellation test runs in milliseconds instead of waiting out the
/// real 60-second production budget.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_remote_git_for_test(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    repo_path: &str,
    mode: RemoteGitExecMode,
    git_args: &[String],
    stdin: Option<&[u8]>,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<RemoteGitExecOutcome, RemoteGitExecFailure> {
    run_remote_git_with_timeout(
        remote,
        window_label,
        session_id,
        repo_path,
        mode,
        git_args,
        stdin,
        cancel,
        timeout,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn run_remote_git_with_timeout(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    repo_path: &str,
    mode: RemoteGitExecMode,
    git_args: &[String],
    stdin: Option<&[u8]>,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<RemoteGitExecOutcome, RemoteGitExecFailure> {
    let argv = build_argv(repo_path, mode, git_args);
    let command_line =
        encode_posix_command_line(&argv).map_err(|_| RemoteGitExecFailure::Unavailable)?;

    let mut channel = remote
        .open_git_exec_channel(window_label, session_id)
        .await
        .map_err(|error| {
            if error.code() == "REMOTE_SESSION_NOT_FOUND" {
                RemoteGitExecFailure::Disconnected
            } else {
                RemoteGitExecFailure::Unavailable
            }
        })?;

    channel
        .exec(true, command_line.into_bytes())
        .await
        .map_err(|_| RemoteGitExecFailure::Unavailable)?;
    expect_success(&mut channel).await?;

    let (mut read_half, write_half) = channel.split();
    if let Some(bytes) = stdin {
        if write_half.data_bytes(bytes.to_vec()).await.is_err() {
            return Err(RemoteGitExecFailure::Unavailable);
        }
    }
    if write_half.eof().await.is_err() {
        return Err(RemoteGitExecFailure::Unavailable);
    }

    let deadline = tokio::time::Instant::now() + timeout;
    let mut ticker = tokio::time::interval(REMOTE_GIT_EXEC_POLL_INTERVAL);
    // The first tick of a freshly constructed `interval` fires immediately —
    // consumed here so the loop below's ticks are actually spaced by
    // `REMOTE_GIT_EXEC_POLL_INTERVAL`, not fired once with zero delay first.
    ticker.tick().await;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code: Option<i32> = None;

    loop {
        tokio::select! {
            biased;
            message = read_half.wait() => {
                match message {
                    Some(ChannelMsg::Data { data }) => {
                        stdout.extend_from_slice(&data);
                        if stdout.len() > REMOTE_GIT_EXEC_OUTPUT_CAP_BYTES {
                            release(&write_half).await;
                            return Err(RemoteGitExecFailure::OutputLimitExceeded);
                        }
                    }
                    Some(ChannelMsg::ExtendedData { data, ext }) if ext == SSH_EXTENDED_DATA_STDERR => {
                        stderr.extend_from_slice(&data);
                        if stderr.len() > REMOTE_GIT_EXEC_OUTPUT_CAP_BYTES {
                            release(&write_half).await;
                            return Err(RemoteGitExecFailure::OutputLimitExceeded);
                        }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        exit_code = Some(exit_status as i32);
                    }
                    Some(_) => {}
                    None => break,
                }
            }
            _ = ticker.tick() => {
                if cancel.load(Ordering::SeqCst) {
                    release(&write_half).await;
                    return Err(RemoteGitExecFailure::Cancelled);
                }
                if tokio::time::Instant::now() >= deadline {
                    release(&write_half).await;
                    return Err(RemoteGitExecFailure::TimedOut);
                }
            }
        }
    }

    match exit_code {
        Some(exit_code) => Ok(RemoteGitExecOutcome {
            exit_code,
            stdout,
            stderr,
        }),
        None => Err(RemoteGitExecFailure::Disconnected),
    }
}

/// Best-effort local release on the cancel/timeout/output-cap paths — see the
/// module doc's "Cancellation and timeout" section for why this never waits
/// for the peer to acknowledge before this function returns.
async fn release(write_half: &ChannelWriteHalf<Msg>) {
    let _ = write_half.eof().await;
    let _ = write_half.close().await;
}

/// Awaits exactly the next message and requires it to be a
/// `SSH_MSG_CHANNEL_SUCCESS` — the identical discipline
/// `remote::remote_terminal::expect_success` applies after `request_pty`/
/// `request_shell`, applied here after `exec`: a `Failure` reply, an
/// unrelated message, or the channel closing before either is a fail-closed
/// [`RemoteGitExecFailure::Unavailable`], never a silent downgrade.
async fn expect_success(channel: &mut Channel<Msg>) -> Result<(), RemoteGitExecFailure> {
    match channel.wait().await {
        Some(ChannelMsg::Success) => Ok(()),
        _ => Err(RemoteGitExecFailure::Unavailable),
    }
}

#[cfg(test)]
mod tests;
