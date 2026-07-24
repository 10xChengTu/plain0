//! Shell detection and environment allowlist construction: pure,
//! spawn-free logic kept in its own module so it is unit-testable without
//! ever touching a real pty or subprocess (unlike `service.rs`, this module
//! never needs a real child process fixture, so its tests stay inline here
//! rather than in a separate `tests.rs`).

use std::path::PathBuf;

use portable_pty::CommandBuilder;

/// Resolves which shell program a freshly started terminal session should
/// run: the ambient `$SHELL` environment variable if set and non-empty,
/// otherwise a fixed per-OS fallback — exactly the policy
/// `docs/research/2026-07-24-pty-terminal.md`'s decision 2 settled on
/// (`getDefaultSystemShell` semantics reimplemented in Rust), and
/// deliberately *not* `portable_pty::CommandBuilder::new_default_prog`/
/// `get_shell`'s own fallback (a password-database lookup ending in
/// `/bin/sh`) — a different, less useful-for-an-interactive-tab policy.
pub(crate) fn detect_shell(ambient_shell: Option<&str>) -> PathBuf {
    match ambient_shell {
        Some(shell) if !shell.is_empty() => PathBuf::from(shell),
        _ => PathBuf::from(default_shell_fallback()),
    }
}

#[cfg(target_os = "macos")]
const fn default_shell_fallback() -> &'static str {
    "/bin/zsh"
}

#[cfg(not(target_os = "macos"))]
const fn default_shell_fallback() -> &'static str {
    "/bin/bash"
}

/// Fixed allowlist of environment variable *names* copied verbatim from
/// Plain's own ambient environment into a spawned terminal session (see
/// [`apply_env_allowlist`]). Every other ambient variable is invisible to
/// the spawned shell. Locked exactly by
/// `scripts/plain/boundary-contracts.mjs`'s `validateTerminalEnvAllowlist`,
/// so widening it can never be a silent, unreviewed change.
pub(crate) const TERMINAL_ENV_PASSTHROUGH_NAMES: &[&str] =
    &["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR"];

/// Prefix identifying the POSIX locale-category variables (`LC_ALL`,
/// `LC_CTYPE`, …) forwarded in addition to the fixed name list above: there
/// is an open-ended, locale-dependent set of `LC_*` names, so this is a
/// prefix match rather than another fixed name in the list.
pub(crate) const TERMINAL_ENV_LC_PREFIX: &str = "LC_";

/// Always exactly this value, never read from the ambient environment:
/// every spawned terminal session advertises the same modern terminal
/// capability regardless of what (if anything) Plain's own GUI process
/// happened to inherit.
pub(crate) const TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "xterm-256color");
pub(crate) const TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor");

/// Applies the fixed environment allowlist to `command`. `ambient` is
/// injected (rather than this function reading `std::env::vars()` itself)
/// purely for testability — the one production caller passes
/// `std::env::vars()` verbatim.
///
/// Order: explicit `env_clear()` first (defense-in-depth — `CommandBuilder`'s
/// own spawn path already clears the environment internally regardless, but
/// asserting the invariant this module actually needs is more robust than
/// silently depending on an undocumented dependency implementation detail);
/// then every allowlisted fixed name that is actually present in `ambient`;
/// then every `LC_*`-prefixed ambient name; then the two fixed overrides
/// last, so `TERM`/`COLORTERM` always win even though neither is currently
/// also a fixed-name or `LC_*` entry.
pub(crate) fn apply_env_allowlist(
    command: &mut CommandBuilder,
    ambient: impl IntoIterator<Item = (String, String)>,
) {
    command.env_clear();
    let ambient: Vec<(String, String)> = ambient.into_iter().collect();
    for name in TERMINAL_ENV_PASSTHROUGH_NAMES {
        if let Some((_, value)) = ambient.iter().find(|(key, _)| key == name) {
            command.env(*name, value);
        }
    }
    for (key, value) in &ambient {
        if key.starts_with(TERMINAL_ENV_LC_PREFIX) {
            command.env(key, value);
        }
    }
    command.env(TERMINAL_ENV_TERM.0, TERMINAL_ENV_TERM.1);
    command.env(TERMINAL_ENV_COLORTERM.0, TERMINAL_ENV_COLORTERM.1);
}

#[cfg(test)]
mod tests {
    use portable_pty::CommandBuilder;

    use super::{apply_env_allowlist, detect_shell, TERMINAL_ENV_COLORTERM, TERMINAL_ENV_TERM};

    #[test]
    fn a_non_empty_ambient_shell_wins() {
        assert_eq!(
            detect_shell(Some("/usr/local/bin/fish")),
            std::path::PathBuf::from("/usr/local/bin/fish")
        );
    }

    #[test]
    fn a_missing_or_empty_ambient_shell_falls_back_to_the_fixed_per_os_default() {
        let expected = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        };
        assert_eq!(detect_shell(None), std::path::PathBuf::from(expected));
        assert_eq!(detect_shell(Some("")), std::path::PathBuf::from(expected));
    }

    fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn only_allowlisted_names_and_the_lc_prefix_are_forwarded() {
        let mut command = CommandBuilder::new("test-fixture-program");
        apply_env_allowlist(
            &mut command,
            env(&[
                ("PATH", "/usr/bin"),
                ("HOME", "/home/plain"),
                ("SECRET_TOKEN", "leaked-if-forwarded"),
                ("LC_CTYPE", "en_US.UTF-8"),
                ("RANDOM_VAR", "irrelevant"),
            ]),
        );
        assert_eq!(command.get_env("PATH").unwrap(), "/usr/bin");
        assert_eq!(command.get_env("HOME").unwrap(), "/home/plain");
        assert_eq!(command.get_env("LC_CTYPE").unwrap(), "en_US.UTF-8");
        assert!(command.get_env("SECRET_TOKEN").is_none());
        assert!(command.get_env("RANDOM_VAR").is_none());
    }

    #[test]
    fn a_missing_allowlisted_name_is_simply_absent_not_a_blank_value() {
        let mut command = CommandBuilder::new("test-fixture-program");
        apply_env_allowlist(&mut command, env(&[]));
        for name in super::TERMINAL_ENV_PASSTHROUGH_NAMES {
            assert!(command.get_env(name).is_none(), "{name} should be absent");
        }
    }

    #[test]
    fn term_and_colorterm_are_always_the_fixed_values_never_the_ambient_ones() {
        let mut command = CommandBuilder::new("test-fixture-program");
        apply_env_allowlist(
            &mut command,
            env(&[("TERM", "dumb"), ("COLORTERM", "should-be-overridden")]),
        );
        assert_eq!(
            command.get_env(TERMINAL_ENV_TERM.0).unwrap(),
            TERMINAL_ENV_TERM.1
        );
        assert_eq!(
            command.get_env(TERMINAL_ENV_COLORTERM.0).unwrap(),
            TERMINAL_ENV_COLORTERM.1
        );
    }
}
