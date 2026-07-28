//! Rust generic Debug Adapter Protocol (DAP) client domain (`F100` of
//! `docs/research/2026-07-28-generic-dap.md`, itself building on ADR
//! `docs/decisions/0003-native-git-and-generic-dap.md`'s "Rust 实现编辑器侧
//! DAP client" decision).
//!
//! # Scope of this slice (`F100` S0)
//!
//! S0 builds exactly three things, all exercised only by `#[cfg(test)]`
//! fixtures — no real adapter interaction, no frontend/`app/` code, no
//! adapter-config parsing, no first-run confirmation gate, no TCP transport,
//! and no session/handshake orchestration. Every one of those is a later
//! slice per the frozen research doc's own "切片拆分" section (S1 adds TCP
//! transport + config parsing + the confirmation gate; S2 adds the real
//! session lifecycle):
//!
//! 1. [`framing`] — the stdio/TCP-agnostic `Content-Length` framing state
//!    machine ([`framing::FrameDecoder`]) that every later slice's reader
//!    loop will drive.
//! 2. [`exec`] — this domain's hardened subprocess-spawn primitive
//!    ([`exec::spawn_adapter`]), mirroring `git::exec`'s trust-gate-then-spawn
//!    discipline and `terminal::service`'s long-lived-subprocess model (see
//!    that module's own doc comment for the precise mix and why neither
//!    existing domain's model transfers unmodified).
//! 3. The trust gate itself, wired through [`exec::spawn_adapter`] — see that
//!    function's doc comment for why `trust.require_trusted` is its literal
//!    first statement.
//!
//! # `commands.rs` is intentionally commandless in S0
//!
//! The frozen research doc's own "决策 1" explicitly assigns adapter-config
//! parsing (`.plain/debug-adapters.json`/`.vscode/launch.json`'s inline
//! `plainAdapter` block) and the first-run confirmation gate to S1, and says
//! S0 only needs to "把接口留好并在注释里写明边界" (leave the interface in
//! place, documented). Exposing a real `#[tauri::command]` in S0 would let a
//! frontend reach an actual adapter spawn before anything has built the
//! confirmation gate that must sit between "user asked to start a debug
//! session" and "we actually spawn the adapter" — so [`commands`] is
//! module-doc-only in this slice: zero `#[tauri::command]` functions, nothing
//! registered in `lib.rs`'s `generate_handler!`. See that module's own doc
//! comment for what S1 is expected to add there.
//!
//! # Subprocess spawning is `exec::spawn_adapter`-only
//!
//! Exactly like `git::` (whose own module doc makes the same claim for
//! `exec::run_git`), every subprocess this domain ever spawns goes through
//! [`exec::spawn_adapter`]/[`exec::spawn_adapter_sync`] — never
//! `std::process::Command` directly anywhere else in this module tree, and
//! never by asking a shell to interpret a concatenated command string.
//! `scripts/plain/boundary-contracts.mjs`'s `validateDebugSpawnConstructionShape`
//! mechanically locks the exact `Command::new(&descriptor.command)
//! .args(&descriptor.args)` construction shape; `validateDebugAdapterSpawnBoundary`
//! locks that the trust gate runs before any of it.
//!
//! # Trust gate before spawn
//!
//! [`exec::spawn_adapter`] calls `TrustService::require_trusted` as its
//! literal first statement, exactly like
//! `terminal::service::TerminalService::start` and
//! `git::discovery::discover_repository` — `trust::mod`'s own module doc
//! already names `F100`/DAP as the third consumer of this gate. Unlike
//! inventing a new domain-specific "not trusted" error code, this domain
//! propagates `require_trusted`'s own `WORKSPACE_NOT_TRUSTED` error verbatim
//! — see [`exec::spawn_adapter`]'s own doc comment for why (this mirrors what
//! `git`/`terminal` actually do today; neither of them wraps it either).
//!
//! # The dead-code annotations below are deliberate, not stray
//!
//! Because nothing outside this domain's own `#[cfg(test)]` fixtures calls
//! into [`framing`]'s decoder or [`exec`]'s spawn primitive yet (there is no
//! session reader loop — S2's job — and no confirmation-gated command — S1's
//! job), the plain `pub(crate)` items here would be flagged as dead code by
//! `cargo clippy --all-targets -- -D warnings`: `#[cfg(test)]` code does not
//! exist at all in the non-test compilation unit dead-code analysis runs
//! against. Every `#[allow(dead_code)]` in this module tree names, in an
//! adjacent comment, which future slice adds the real caller — mirroring the
//! existing precedent at `workspace::version::FileSystemKind`,
//! `terminal::vt`'s several encoder/field annotations and
//! `theme::unpack::unpack_directory`/`UnpackedTheme::publish`.

use crate::error::CommandError;

pub(crate) mod commands;
pub mod dto;
pub(crate) mod exec;
pub(crate) mod framing;

/// Returned when [`exec::spawn_adapter_sync`]'s own `Command::spawn()` call
/// fails outright (bad executable path, missing execute permission, …) — the
/// DAP-domain analogue of `git::git_exec_unavailable`. Also used when the
/// `spawn_blocking` hop itself panics/is cancelled, mirroring every other
/// domain's `spawn_blocking` join-error mapping (e.g.
/// `terminal::terminal_unavailable`'s own use for the identical join-error
/// case), and when polling the child's exit status itself returns an OS
/// error during the startup grace window.
pub(crate) fn debug_adapter_spawn_unavailable() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_SPAWN_UNAVAILABLE",
        "The debug adapter subprocess could not be started.",
    )
}

/// Returned when [`exec::spawn_adapter_sync`]'s cooperative `cancel` flag is
/// observed during the startup grace-window wait — the caller asked to give
/// up before the adapter had a chance to prove it stayed alive. The child (if
/// it was actually spawned) is killed and reaped before this is returned.
pub(crate) fn debug_adapter_cancelled() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_CANCELLED",
        "Starting the debug adapter was cancelled.",
    )
}

/// Returned when the spawned adapter process exits on its own before
/// [`exec`]'s startup grace window has elapsed — see that module's doc
/// comment for why this is the concrete, testable meaning of "adapter
/// crashed at startup" for this slice (a real per-session "adapter crashed
/// later, mid-session" path needs the reader/waiter machinery S2 builds, and
/// is explicitly out of scope here). The message carries the process's exit
/// status and whatever stderr the capped background reader managed to
/// capture before this error is constructed, so a caller gets an actionable
/// diagnostic instead of a bare "it failed".
pub(crate) fn debug_adapter_startup_crashed(
    exit_code: Option<i32>,
    stderr_tail: &[u8],
) -> CommandError {
    let exit_description = match exit_code {
        Some(code) => format!("exit code {code}"),
        None => "no exit code (terminated by signal)".to_owned(),
    };
    let tail = String::from_utf8_lossy(stderr_tail);
    let trimmed_tail = tail.trim();
    CommandError::new(
        "DEBUG_ADAPTER_STARTUP_CRASHED",
        format!(
            "The debug adapter process exited ({exit_description}) before it was confirmed to \
             have started; captured stderr: {}",
            if trimmed_tail.is_empty() {
                "(empty)"
            } else {
                trimmed_tail
            }
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        debug_adapter_cancelled, debug_adapter_spawn_unavailable, debug_adapter_startup_crashed,
    };

    #[test]
    fn error_constructors_have_stable_codes() {
        assert_eq!(
            debug_adapter_spawn_unavailable().code(),
            "DEBUG_ADAPTER_SPAWN_UNAVAILABLE"
        );
        assert_eq!(debug_adapter_cancelled().code(), "DEBUG_ADAPTER_CANCELLED");
        assert_eq!(
            debug_adapter_startup_crashed(Some(1), b"boom").code(),
            "DEBUG_ADAPTER_STARTUP_CRASHED"
        );
    }

    #[test]
    fn startup_crashed_message_includes_exit_code_and_stderr_tail() {
        let error = debug_adapter_startup_crashed(Some(127), b"command not found");
        assert!(error.message().contains("127"));
        assert!(error.message().contains("command not found"));
    }

    #[test]
    fn startup_crashed_message_handles_missing_exit_code_and_empty_stderr() {
        let error = debug_adapter_startup_crashed(None, b"");
        assert!(error.message().contains("signal"));
        assert!(error.message().contains("(empty)"));
    }

    #[test]
    fn startup_crashed_message_trims_whitespace_only_stderr_to_empty() {
        let error = debug_adapter_startup_crashed(Some(1), b"   \n  ");
        assert!(error.message().contains("(empty)"));
    }
}
