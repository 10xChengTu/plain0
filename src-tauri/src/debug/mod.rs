//! Rust generic Debug Adapter Protocol (DAP) client domain (`F100` of
//! `docs/research/2026-07-28-generic-dap.md`, itself building on ADR
//! `docs/decisions/0003-native-git-and-generic-dap.md`'s "Rust 实现编辑器侧
//! DAP client" decision).
//!
//! # Scope of this slice (`F100` S1)
//!
//! S1 builds three things on top of S0's frame decoder + hardened spawn
//! primitive — still no real session/handshake orchestration (S2's job) and
//! still no `app/` UI (S3/S4's job):
//!
//! 1. [`tcp`] — the "Plain 主动连出去" TCP transport
//!    ([`tcp::connect_adapter`]), reusing [`framing::FrameDecoder`] verbatim
//!    (only the byte source changes — a `TcpStream` instead of a pipe) and
//!    the identical trust-then-confirmation double gate [`exec::spawn_adapter`]
//!    uses. "Plain 监听、等 adapter 连进来" is deliberately **not**
//!    implemented — see [`tcp`]'s own module doc for why ("主导会话裁定" item
//!    3: an unauthenticated local listen socket is a strictly weaker trust
//!    model than either spawning or connecting out).
//! 2. [`confirm`] — the first-run confirmation gate
//!    ([`confirm::ConfirmationService`]), keyed on the exact
//!    [`dto::AdapterConfirmationSubject`] `(command, args, transport)` triple
//!    ("主导会话裁定" item 2), persisted per
//!    [`crate::workspace::WorkspaceRootsIdentity`] and revocable — now wired
//!    as the literal second statement (immediately after the trust check) in
//!    both [`exec::spawn_adapter`] and [`tcp::connect_adapter`].
//! 3. [`commands`] — the three real `#[tauri::command]`s this slice adds
//!    (`debug_adapter_confirmation_state`/`_grant`/`_revoke`, all registered
//!    in `lib.rs`'s `generate_handler!`) — see that module's own doc comment
//!    for why these three, and *only* these three, are safe to expose ahead
//!    of S2's real session lifecycle.
//!
//! Adapter-config parsing (`.plain/debug-adapters.json`/`.vscode/launch.json`'s
//! inline `plainAdapter` block) is frontend-only per the frozen doc's own
//! "决策 1" ("读取这两份配置完全复用既有的 `workspace_read_file` 能力,不新增任
//! 何 Rust 端文件读取代码") — see `app/features/debug/plain-debug-adapter-config.ts`.
//!
//! # `commands.rs` still does not expose `debug_launch`/`debug_attach`
//!
//! Real session orchestration — actually driving [`exec::spawn_adapter`]/
//! [`tcp::connect_adapter`] to hold a live, running debug session — is S2's
//! job. This slice's three new commands only let the frontend query/grant/
//! revoke a confirmation *decision*; they never themselves spawn or connect
//! to anything. See [`commands`]'s own doc comment.
//!
//! # Subprocess spawning is `exec::spawn_adapter`-only; TCP connecting is `tcp::connect_adapter`-only
//!
//! Exactly like `git::` (whose own module doc makes the same claim for
//! `exec::run_git`), every subprocess this domain ever spawns goes through
//! [`exec::spawn_adapter`]/[`exec::spawn_adapter_sync`], and every TCP
//! connection through [`tcp::connect_adapter`]/[`tcp::connect_adapter_sync`]
//! — never `std::process::Command`/`std::net::TcpStream::connect` directly
//! anywhere else in this module tree, and never by asking a shell to
//! interpret a concatenated command string.
//! `scripts/plain/boundary-contracts.mjs`'s `validateDebugSpawnConstructionShape`
//! mechanically locks the exact `Command::new(&descriptor.command)
//! .args(&descriptor.args)` construction shape; `validateDebugAdapterSpawnBoundary`/
//! `validateDebugAdapterConnectBoundary` lock that the trust-then-confirmation
//! gate runs, in that literal order, before any of it.
//!
//! # Trust *then* confirmation, before spawn or connect
//!
//! [`exec::spawn_adapter`]/[`tcp::connect_adapter`] both call
//! `TrustService::require_trusted` as their literal first statement (exactly
//! like `terminal::service::TerminalService::start`/
//! `git::discovery::discover_repository` — `trust::mod`'s own module doc
//! already names `F100`/DAP as the third consumer of this gate), then
//! `ConfirmationService::require_confirmed` as their literal second — the
//! second, independent gate ADR 0003 requires. Unlike inventing a new
//! domain-specific "not trusted" error code, this domain propagates
//! `require_trusted`'s own `WORKSPACE_NOT_TRUSTED` error verbatim (mirroring
//! what `git`/`terminal` actually do today), but the confirmation gate *does*
//! get its own domain-specific code
//! ([`debug_adapter_not_confirmed`]/`DEBUG_ADAPTER_NOT_CONFIRMED`) — unlike
//! "not trusted", this is a genuinely new concept neither `git` nor
//! `terminal` has a precedent for, so there is no existing verbatim error to
//! reuse.
//!
//! # The dead-code annotations below are deliberate, not stray
//!
//! Because nothing outside this domain's own `#[cfg(test)]` fixtures calls
//! into [`framing`]'s decoder, [`exec`]'s spawn primitive or [`tcp`]'s connect
//! primitive yet (there is no session reader loop — S2's job), the plain
//! `pub(crate)` items here would be flagged as dead code by
//! `cargo clippy --all-targets -- -D warnings`: `#[cfg(test)]` code does not
//! exist at all in the non-test compilation unit dead-code analysis runs
//! against. Every `#[allow(dead_code)]` in this module tree names, in an
//! adjacent comment, which future slice adds the real caller — mirroring the
//! existing precedent at `workspace::version::FileSystemKind`,
//! `terminal::vt`'s several encoder/field annotations and
//! `theme::unpack::unpack_directory`/`UnpackedTheme::publish`.

use crate::error::CommandError;

pub(crate) mod commands;
pub(crate) mod confirm;
mod confirm_store;
pub mod dto;
pub(crate) mod exec;
pub(crate) mod framing;
pub(crate) mod tcp;

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

/// Returned by [`confirm::ConfirmationService::require_confirmed`] when the
/// caller's `(command, args, transport)` triple has not yet been confirmed
/// for the current workspace — the actionable, structured failure mode
/// `docs/research/2026-07-28-generic-dap.md`'s acceptance criterion 4 ("缺失
/// 或未信任的 adapter 以可操作的确认失败") calls for on the confirmation side
/// (missing/untrusted adapters get their own codes: `WORKSPACE_NOT_TRUSTED`
/// propagated verbatim, and the config-resolution "adapter type not found"
/// case the frontend config module reports). A caller seeing this code knows
/// exactly what to do next: run the confirmation flow
/// (`app/features/debug/plain-debug-adapter-confirmation.ts`'s
/// `resolveDebugAdapterConfirmation`), then retry.
pub(crate) fn debug_adapter_not_confirmed() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_NOT_CONFIRMED",
        "This exact adapter command has not been confirmed for this workspace yet.",
    )
}

/// Covers every confirmation-store failure mode: no stable workspace identity
/// to key a grant/revoke against (the `EMPTY` workspace), and any I/O/
/// (de)serialization failure reading or writing `confirm_store`'s persisted
/// entries — mirroring `trust::trust_unavailable`/`backup::backup_unavailable`'s
/// identical "fold every unrecoverable-differently case into one caller-facing
/// code" precedent.
pub(crate) fn confirmation_unavailable() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE",
        "The debug adapter confirmation store is not available for this window.",
    )
}

/// Returned when [`tcp::connect_adapter_sync`]'s own `TcpStream::connect`
/// attempt fails outright (connection refused, DNS resolution failure, no
/// route) — the TCP-transport analogue of [`debug_adapter_spawn_unavailable`].
pub(crate) fn debug_adapter_connect_failed() -> CommandError {
    CommandError::new(
        "DEBUG_ADAPTER_CONNECT_FAILED",
        "Could not connect to the debug adapter's TCP endpoint.",
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
        confirmation_unavailable, debug_adapter_cancelled, debug_adapter_connect_failed,
        debug_adapter_not_confirmed, debug_adapter_spawn_unavailable,
        debug_adapter_startup_crashed,
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
        assert_eq!(
            debug_adapter_not_confirmed().code(),
            "DEBUG_ADAPTER_NOT_CONFIRMED"
        );
        assert_eq!(
            confirmation_unavailable().code(),
            "DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE"
        );
        assert_eq!(
            debug_adapter_connect_failed().code(),
            "DEBUG_ADAPTER_CONNECT_FAILED"
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
