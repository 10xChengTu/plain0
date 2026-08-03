//! Shell detection and environment allowlist construction: pure,
//! spawn-free logic kept in its own module so it is unit-testable without
//! ever touching a real pty or subprocess (unlike `service.rs`, this module
//! never needs a real child process fixture, so its tests stay inline here
//! rather than in a separate `tests.rs`).

use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

use crate::error::CommandError;

use super::terminal_profile_invalid;

pub(crate) const SYSTEM_DEFAULT_PROFILE_ID: &str = "systemDefault";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ShellProfile {
    pub(crate) id: &'static str,
    pub(crate) label: String,
}

#[derive(Clone, Copy)]
struct ShellProfileSpec {
    id: &'static str,
    label: &'static str,
    candidates: &'static [&'static str],
}

#[cfg(target_os = "macos")]
const SHELL_PROFILE_SPECS: &[ShellProfileSpec] = &[
    ShellProfileSpec {
        id: "zsh",
        label: "zsh",
        candidates: &["/bin/zsh", "/opt/homebrew/bin/zsh", "/usr/local/bin/zsh"],
    },
    ShellProfileSpec {
        id: "bash",
        label: "bash",
        candidates: &["/bin/bash", "/opt/homebrew/bin/bash", "/usr/local/bin/bash"],
    },
    ShellProfileSpec {
        id: "fish",
        label: "fish",
        candidates: &[
            "/opt/homebrew/bin/fish",
            "/usr/local/bin/fish",
            "/usr/bin/fish",
        ],
    },
    ShellProfileSpec {
        id: "sh",
        label: "sh",
        candidates: &["/bin/sh"],
    },
];

#[cfg(all(unix, not(target_os = "macos")))]
const SHELL_PROFILE_SPECS: &[ShellProfileSpec] = &[
    ShellProfileSpec {
        id: "bash",
        label: "bash",
        candidates: &["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"],
    },
    ShellProfileSpec {
        id: "zsh",
        label: "zsh",
        candidates: &["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"],
    },
    ShellProfileSpec {
        id: "fish",
        label: "fish",
        candidates: &["/usr/bin/fish", "/bin/fish", "/usr/local/bin/fish"],
    },
    ShellProfileSpec {
        id: "sh",
        label: "sh",
        candidates: &["/bin/sh", "/usr/bin/sh"],
    },
];

#[cfg(not(unix))]
const SHELL_PROFILE_SPECS: &[ShellProfileSpec] = &[];

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

pub(crate) fn available_profiles(ambient_shell: Option<&str>) -> Vec<ShellProfile> {
    available_profiles_with(ambient_shell, |path| path.is_file())
}

fn available_profiles_with(
    ambient_shell: Option<&str>,
    is_file: impl Fn(&Path) -> bool,
) -> Vec<ShellProfile> {
    let system_shell = detect_shell(ambient_shell);
    let system_label = system_shell
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && name.len() <= 128 && !name.chars().any(char::is_control))
        .unwrap_or("System shell");
    let mut profiles = vec![ShellProfile {
        id: SYSTEM_DEFAULT_PROFILE_ID,
        label: format!("{system_label} (System Default)"),
    }];
    profiles.extend(SHELL_PROFILE_SPECS.iter().filter_map(|spec| {
        first_available_path(spec, &is_file).map(|_| ShellProfile {
            id: spec.id,
            label: spec.label.to_owned(),
        })
    }));
    profiles
}

pub(crate) fn resolve_profile(
    profile_id: &str,
    ambient_shell: Option<&str>,
) -> Result<PathBuf, CommandError> {
    resolve_profile_with(profile_id, ambient_shell, |path| path.is_file())
}

fn resolve_profile_with(
    profile_id: &str,
    ambient_shell: Option<&str>,
    is_file: impl Fn(&Path) -> bool,
) -> Result<PathBuf, CommandError> {
    if profile_id == SYSTEM_DEFAULT_PROFILE_ID {
        return Ok(detect_shell(ambient_shell));
    }
    SHELL_PROFILE_SPECS
        .iter()
        .find(|spec| spec.id == profile_id)
        .and_then(|spec| first_available_path(spec, &is_file))
        .ok_or_else(terminal_profile_invalid)
}

fn first_available_path(
    spec: &ShellProfileSpec,
    is_file: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    spec.candidates
        .iter()
        .map(PathBuf::from)
        .find(|path| is_file(path))
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
pub(crate) const TERMINAL_ENV_PASSTHROUGH_NAMES: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "TMPDIR",
    "SSH_AUTH_SOCK",
];

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
pub(crate) const TERMINAL_ENV_TERM_PROGRAM: (&str, &str) = ("TERM_PROGRAM", "Plain");
pub(crate) const TERMINAL_ENV_TERM_PROGRAM_VERSION: (&str, &str) =
    ("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));

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
    command.env(TERMINAL_ENV_TERM_PROGRAM.0, TERMINAL_ENV_TERM_PROGRAM.1);
    command.env(
        TERMINAL_ENV_TERM_PROGRAM_VERSION.0,
        TERMINAL_ENV_TERM_PROGRAM_VERSION.1,
    );
}

#[cfg(test)]
mod tests {
    use portable_pty::CommandBuilder;

    use super::{
        apply_env_allowlist, available_profiles_with, detect_shell, resolve_profile_with,
        SYSTEM_DEFAULT_PROFILE_ID, TERMINAL_ENV_COLORTERM, TERMINAL_ENV_TERM,
        TERMINAL_ENV_TERM_PROGRAM, TERMINAL_ENV_TERM_PROGRAM_VERSION,
    };

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

    #[test]
    fn profile_snapshot_is_bounded_to_system_default_and_existing_fixed_candidates() {
        let existing = ["/bin/zsh", "/bin/sh"];
        let profiles = available_profiles_with(Some("/custom/login-shell"), |path| {
            existing
                .iter()
                .any(|candidate| path == std::path::Path::new(candidate))
        });
        assert_eq!(profiles[0].id, SYSTEM_DEFAULT_PROFILE_ID);
        assert_eq!(profiles[0].label, "login-shell (System Default)");
        assert!(profiles.iter().all(|profile| {
            profile.id == SYSTEM_DEFAULT_PROFILE_ID || profile.id == "zsh" || profile.id == "sh"
        }));
        assert!(profiles.len() <= 1 + super::SHELL_PROFILE_SPECS.len());
    }

    #[test]
    fn profile_resolution_never_accepts_an_arbitrary_executable() {
        let exists = |path: &std::path::Path| path == std::path::Path::new("/bin/zsh");
        assert_eq!(
            resolve_profile_with(SYSTEM_DEFAULT_PROFILE_ID, Some("/custom/shell"), exists).unwrap(),
            std::path::PathBuf::from("/custom/shell")
        );
        assert_eq!(
            resolve_profile_with("zsh", Some("/custom/shell"), exists).unwrap(),
            std::path::PathBuf::from("/bin/zsh")
        );
        assert_eq!(
            resolve_profile_with("/tmp/attacker-shell", Some("/custom/shell"), exists)
                .unwrap_err()
                .code(),
            "TERMINAL_PROFILE_INVALID"
        );
        assert_eq!(
            resolve_profile_with("fish", Some("/custom/shell"), exists)
                .unwrap_err()
                .code(),
            "TERMINAL_PROFILE_INVALID"
        );
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
                ("SSH_AUTH_SOCK", "/tmp/agent.sock"),
                ("SECRET_TOKEN", "leaked-if-forwarded"),
                ("LC_CTYPE", "en_US.UTF-8"),
                ("RANDOM_VAR", "irrelevant"),
            ]),
        );
        assert_eq!(command.get_env("PATH").unwrap(), "/usr/bin");
        assert_eq!(command.get_env("HOME").unwrap(), "/home/plain");
        assert_eq!(command.get_env("SSH_AUTH_SOCK").unwrap(), "/tmp/agent.sock");
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
        assert_eq!(
            command.get_env(TERMINAL_ENV_TERM_PROGRAM.0).unwrap(),
            TERMINAL_ENV_TERM_PROGRAM.1
        );
        assert_eq!(
            command
                .get_env(TERMINAL_ENV_TERM_PROGRAM_VERSION.0)
                .unwrap(),
            TERMINAL_ENV_TERM_PROGRAM_VERSION.1
        );
    }
}
