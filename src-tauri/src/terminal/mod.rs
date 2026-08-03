//! Rust PTY terminal domain (F070 S1 "决策 2" of
//! `docs/research/2026-07-24-pty-terminal.md`). This slice is pure Rust: the
//! five commands below are registered in `lib.rs` so their signatures are
//! locked in, but nothing in `app/` consumes them yet (the strict IPC codec
//! and Tauri event bridge are F070 S2).
//!
//! # Subprocess spawning is `portable_pty::CommandBuilder`-only
//!
//! Every subprocess this domain spawns goes through `portable_pty`'s
//! `openpty`/`CommandBuilder`/`SlavePty::spawn_command` path — never
//! `std::process::Command` directly, and never by asking a shell to
//! interpret a concatenated command string (no `.arg("-c")`, no hardcoded
//! `sh`/`bash`/`zsh` executable literal). `scripts/plain/boundary-contracts.mjs`
//! enforces this mechanically over every non-test `.rs` file in this module
//! (and the future `git::` domain); see `validateSpawnGuardBoundary`. Test
//! fixtures are the one place this is relaxed — see `service/tests.rs`,
//! which is exempt because its filename matches the domain's existing
//! `tests.rs`-suffix carve-out.

use crate::error::CommandError;

pub(crate) mod commands;
pub(crate) mod dto;
mod flow;
pub(crate) mod service;
mod shell;
// `F100` S4: `pub(crate)` (rather than private) since
// `debug::service::tests`'s own real-`TerminalService` `runInTerminal`
// integration test needs to name `vt::DirtyFrame` to implement
// `service::TerminalOutputSink` there — the same cross-domain reachability
// `service`/`dto` already have, extended to this module purely so that one
// data type is nameable from outside `terminal::`; `vt`'s actual VT-session
// machinery remains this domain's own internal implementation detail
// regardless of this path's visibility.
pub(crate) mod vt;

/// Maximum number of terminal sessions a single window may have open at
/// once (running or already-exited but not yet cleaned up — see
/// `service`'s module doc for why an exited session still occupies a slot
/// until explicitly killed). Chosen generously above any realistic tab/split
/// count a human would open in one window, purely as a defensive ceiling —
/// mirrors `workspace::MAX_WORKSPACE_ROOTS`'s own role for a different
/// domain.
pub(crate) const MAX_TERMINAL_SESSIONS_PER_WINDOW: usize = 16;

pub(crate) fn terminal_session_limit_exceeded() -> CommandError {
    CommandError::new(
        "TERMINAL_SESSION_LIMIT",
        "This window already has the maximum number of terminal sessions open.",
    )
}

pub(crate) fn terminal_session_not_found() -> CommandError {
    CommandError::new(
        "TERMINAL_SESSION_NOT_FOUND",
        "The requested terminal session does not exist for this window.",
    )
}

pub(crate) fn terminal_cwd_invalid() -> CommandError {
    CommandError::new(
        "TERMINAL_CWD_INVALID",
        "The requested working directory is not inside an authorized workspace root.",
    )
}

pub(crate) fn terminal_profile_invalid() -> CommandError {
    CommandError::new(
        "TERMINAL_PROFILE_INVALID",
        "The requested terminal profile is not available on this computer.",
    )
}

pub(crate) fn terminal_unavailable() -> CommandError {
    CommandError::new(
        "TERMINAL_UNAVAILABLE",
        "The terminal session could not be started.",
    )
}

pub(crate) fn terminal_io_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The terminal session could not be used.")
}

#[cfg(test)]
mod tests {
    use super::{
        terminal_cwd_invalid, terminal_io_failed, terminal_profile_invalid,
        terminal_session_limit_exceeded, terminal_session_not_found, terminal_unavailable,
        MAX_TERMINAL_SESSIONS_PER_WINDOW,
    };

    #[test]
    fn error_constructors_have_stable_codes() {
        assert_eq!(
            terminal_session_limit_exceeded().code(),
            "TERMINAL_SESSION_LIMIT"
        );
        assert_eq!(
            terminal_session_not_found().code(),
            "TERMINAL_SESSION_NOT_FOUND"
        );
        assert_eq!(terminal_cwd_invalid().code(), "TERMINAL_CWD_INVALID");
        assert_eq!(
            terminal_profile_invalid().code(),
            "TERMINAL_PROFILE_INVALID"
        );
        assert_eq!(terminal_unavailable().code(), "TERMINAL_UNAVAILABLE");
        assert_eq!(terminal_io_failed().code(), "IO_FAILED");
    }

    #[test]
    fn session_limit_constant_is_frozen_at_sixteen() {
        assert_eq!(MAX_TERMINAL_SESSIONS_PER_WINDOW, 16);
    }
}
