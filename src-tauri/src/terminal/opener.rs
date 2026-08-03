//! Audited external-link opener (F190 S4 "Ghostty metadata and links",
//! `docs/research/2026-08-03-complete-terminal.md` §3). This is the *only*
//! file in the terminal domain allowed to call `std::process::Command`
//! directly — mirrors `git::exec`'s and `debug::exec`'s identical narrow,
//! individually-audited carve-outs from the same domain-wide
//! `portable_pty::CommandBuilder`-only ban (see
//! `scripts/plain/boundary-contracts.mjs`'s `validateTerminalRustBoundary`,
//! which names this file as the terminal domain's own exemption alongside
//! those two).
//!
//! # Why not `portable_pty`
//!
//! Every other spawn in this domain attaches a long-lived interactive
//! program to a pty. Opening a link is the opposite shape: a short-lived,
//! fire-and-forget hand-off to the OS's own already-registered default
//! handler for `http`/`https` (the user's actual browser) — no pty, no
//! stdin/stdout capture, no session bookkeeping. Forcing that through
//! `portable_pty::CommandBuilder`/`openpty` would add a fake pty pair with
//! no purpose.
//!
//! # What this does *not* do
//!
//! - Never invoked from terminal output alone. The sole caller,
//!   `terminal::commands::terminal_open_external_link`, is only ever reached
//!   from an explicit user Cmd/Ctrl+Click the renderer already restricted to
//!   an `http:`/`https:` cell hyperlink (see that command's own doc) — a
//!   terminal *writing* an OSC 8 link never itself opens anything.
//! - Never a shell: each platform below spawns one fixed, hardcoded program
//!   name via an argv array, with the URL as its own single argument —
//!   never a concatenated command string, never `-c`.
//! - Never any scheme but `http`/`https` — enforced twice (once in
//!   `dto::TerminalOpenExternalLinkRequest::into_parts`, again here) so a
//!   caller mistake can never turn this into "run an arbitrary local file or
//!   `file://` URI".

use std::process::Command;

use crate::error::CommandError;

use super::terminal_link_invalid;

/// Matches `dto::MAX_TERMINAL_EXTERNAL_LINK_BYTES` — kept as this module's
/// own independent constant (rather than importing the `dto` one) since
/// this is a second, defense-in-depth check, not this module trusting its
/// caller already did it.
const MAX_EXTERNAL_LINK_BYTES: usize = 8_192;

/// Hands `url` off to the OS's own default handler for it. Fails closed
/// (`Err(terminal_link_invalid())`) for anything empty, oversized, carrying
/// a NUL byte, or not `http://`/`https://` — never falls back to a
/// different scheme or a best-effort guess.
pub(crate) fn open_external_link(url: &str) -> Result<(), CommandError> {
    if url.is_empty() || url.len() > MAX_EXTERNAL_LINK_BYTES || url.contains('\0') {
        return Err(terminal_link_invalid());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(terminal_link_invalid());
    }
    spawn_opener(url).map_err(|_| terminal_link_invalid())
}

#[cfg(target_os = "macos")]
fn spawn_opener(url: &str) -> std::io::Result<()> {
    Command::new("open").arg(url).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_opener(url: &str) -> std::io::Result<()> {
    Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

// Windows (and any other non-Unix target) is not yet audited/verified for
// this domain (see `docs/architecture.md`'s current real-E2E scope, macOS-
// only so far) — this fails closed with an accurate error rather than
// reaching for a `cmd`/`rundll32` invocation this slice has not reviewed.
#[cfg(not(unix))]
fn spawn_opener(_url: &str) -> std::io::Result<()> {
    Err(std::io::Error::other("no external opener on this platform"))
}

#[cfg(test)]
mod tests {
    use super::open_external_link;

    #[test]
    fn rejects_every_non_http_https_scheme() {
        for url in [
            "",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.com",
            "httpx://example.com",
            "http:/example.com",
        ] {
            assert_eq!(
                open_external_link(url).unwrap_err().code(),
                "TERMINAL_LINK_INVALID"
            );
        }
    }

    #[test]
    fn rejects_a_nul_byte_or_an_oversized_url() {
        assert_eq!(
            open_external_link("http://example.com/\0")
                .unwrap_err()
                .code(),
            "TERMINAL_LINK_INVALID"
        );
        let oversized = format!(
            "https://example.com/{}",
            "a".repeat(super::MAX_EXTERNAL_LINK_BYTES)
        );
        assert_eq!(
            open_external_link(&oversized).unwrap_err().code(),
            "TERMINAL_LINK_INVALID"
        );
    }
}
