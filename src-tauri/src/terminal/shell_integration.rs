//! Audited shell-integration injection (F190 S4 "Ghostty metadata and
//! links", `docs/research/2026-08-03-complete-terminal.md` §3). This module
//! decides — per resolved shell executable — how to make the user's *real*
//! interactive shell startup additionally emit the OSC 7 (cwd) / OSC 133
//! (prompt semantics) sequences `terminal::vt` already knows how to project
//! (see that module's `parse_osc7_pwd_uri` and `frame_from_snapshot`'s
//! per-cell semantic projection), **without** writing a second OSC parser
//! and **without** ever rewriting a user's own dotfiles.
//!
//! # What this does *not* do
//!
//! - It never runs the shell via `-c` (`terminal::mod`'s "参数数组、禁止拼接
//!   shell 字符串" boundary applies here exactly as everywhere else in this
//!   domain) — every plan below only adds environment variables and/or a
//!   normal CLI flag (`--rcfile`) to the *same* direct, argv-array
//!   `portable_pty::CommandBuilder::new(&shell_path)` invocation
//!   `shell::resolve_profile` already produces.
//! - It never edits, truncates, or replaces any file the user owns
//!   (`~/.zshrc`, `~/.bashrc`, …). Every injected file below is written
//!   exactly once per `ensure_integration_files` call into a Plain-owned
//!   directory under the OS temp dir ([`integration_base_dir`]) and only
//!   *sources* the user's real files from their real, unmodified paths.
//! - It never executes a script whose *content* is chosen at runtime by
//!   anything other than the fixed constants in this file — the five
//!   `const` strings below are the entire, auditable content ever written
//!   to disk; nothing here reads a path or byte from the webview/IPC
//!   boundary, a workspace file, or any other untrusted input.
//!
//! # Degrade, don't fake success
//!
//! [`plan_for_shell`] returns a [`ShellIntegrationStatus`] alongside the
//! plan, and that status is what `terminal::commands::terminal_start`
//! ultimately reports back to the frontend (`TerminalStartResult::shell_integration`)
//! — an unsupported shell family or a failed [`ensure_integration_files`]
//! write is always reported as such, never silently reported as
//! `Injected`. A degraded session still starts (running the user's real
//! shell exactly as before this slice); it just does not additionally emit
//! OSC 7/133, and says so.

use std::io;
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

/// This domain's fixed subdirectory name under the OS temp dir — versioned
/// by the crate's own version so an upgrade never reuses (and potentially
/// misinterprets) a stale prior build's injected scripts. Never derived
/// from any ambient/user-controlled input.
fn integration_dir_name() -> String {
    format!(
        "plain-terminal-shell-integration-{}",
        env!("CARGO_PKG_VERSION")
    )
}

/// The fixed, Plain-owned directory [`ensure_integration_files`] writes
/// into and [`plan_for_shell`] points shell startup at. Always a
/// subdirectory of [`std::env::temp_dir`] — never a path influenced by
/// workspace content, IPC input, or anything else this process does not
/// already fully control.
pub(crate) fn integration_base_dir() -> PathBuf {
    std::env::temp_dir().join(integration_dir_name())
}

/// Shell-integration injection's own observable outcome — see the module
/// doc's "Degrade, don't fake success" section. Every variant is a real,
/// user-facing status (via `TerminalStartResult::shell_integration`), never
/// an internal implementation detail the frontend cannot see.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ShellIntegrationStatus {
    /// The resolved shell is one of the audited families (zsh/bash/fish)
    /// and its integration files were confirmed present on disk — the
    /// spawned session's environment/args do carry the injection.
    Injected,
    /// The resolved shell is not one of the audited families (e.g. `sh`, or
    /// an arbitrary `$SHELL` this domain does not recognize), or the
    /// integration files could not be written (e.g. an unwritable temp
    /// dir) — the session still starts, running the user's real shell
    /// exactly as it would without this slice, it just never emits OSC
    /// 7/133 on its own (an external program can still emit them directly).
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShellFamily {
    Zsh,
    Bash,
    Fish,
    Unsupported,
}

fn shell_family(shell_path: &Path) -> ShellFamily {
    match shell_path.file_name().and_then(|name| name.to_str()) {
        Some("zsh") => ShellFamily::Zsh,
        Some("bash") => ShellFamily::Bash,
        Some("fish") => ShellFamily::Fish,
        _ => ShellFamily::Unsupported,
    }
}

/// One resolved plan: the environment variables and/or CLI args
/// [`apply_to_command`] adds to the direct shell invocation, plus the
/// resulting observable [`ShellIntegrationStatus`]. Both `env`/`args` are
/// empty whenever `status` is [`ShellIntegrationStatus::Unsupported`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ShellIntegrationPlan {
    pub(crate) status: ShellIntegrationStatus,
    env: Vec<(String, String)>,
    args: Vec<String>,
}

impl ShellIntegrationPlan {
    /// Environment variables the caller must add *after* its own
    /// `env_clear`-then-allowlist step (see `service::TerminalService::start`'s
    /// own comment for why the ordering matters) — empty whenever `status`
    /// is [`ShellIntegrationStatus::Unsupported`].
    pub(crate) fn env(&self) -> &[(String, String)] {
        &self.env
    }

    /// Extra CLI args (today: only bash's `--rcfile <path>`) the caller
    /// should add to the `CommandBuilder` — empty whenever `status` is
    /// [`ShellIntegrationStatus::Unsupported`].
    pub(crate) fn args(&self) -> &[String] {
        &self.args
    }
}

/// Decides the injection plan for `shell_path` — pure and I/O-free (the
/// caller has already attempted [`ensure_integration_files`] and reports
/// whether it succeeded via `files_ready`, so this function itself never
/// touches the filesystem and stays trivially unit-testable).
/// `ambient_zdotdir`/`ambient_xdg_data_dirs` are Plain's *own* process
/// environment (never the sandboxed spawned shell's — those two names are
/// deliberately not part of `shell::TERMINAL_ENV_PASSTHROUGH_NAMES`), read
/// only to preserve a customized zsh `ZDOTDIR` / fish `XDG_DATA_DIRS`
/// rather than silently discarding it.
pub(crate) fn plan_for_shell(
    shell_path: &Path,
    ambient_zdotdir: Option<&str>,
    ambient_xdg_data_dirs: Option<&str>,
    base_dir: &Path,
    files_ready: bool,
) -> ShellIntegrationPlan {
    let family = shell_family(shell_path);
    if family == ShellFamily::Unsupported || !files_ready {
        return ShellIntegrationPlan {
            status: ShellIntegrationStatus::Unsupported,
            env: Vec::new(),
            args: Vec::new(),
        };
    }
    let plan = match family {
        ShellFamily::Zsh => {
            let mut env = vec![(
                "ZDOTDIR".to_owned(),
                base_dir.join("zsh").to_string_lossy().into_owned(),
            )];
            if let Some(original) = ambient_zdotdir.filter(|value| !value.is_empty()) {
                env.push((
                    "PLAIN_TERM_ORIGINAL_ZDOTDIR".to_owned(),
                    original.to_owned(),
                ));
            }
            ShellIntegrationPlan {
                status: ShellIntegrationStatus::Injected,
                env,
                args: Vec::new(),
            }
        }
        ShellFamily::Bash => ShellIntegrationPlan {
            status: ShellIntegrationStatus::Injected,
            env: Vec::new(),
            args: vec![
                "--rcfile".to_owned(),
                base_dir
                    .join("bash")
                    .join("bashrc")
                    .to_string_lossy()
                    .into_owned(),
            ],
        },
        ShellFamily::Fish => {
            let existing = ambient_xdg_data_dirs
                .filter(|value| !value.is_empty())
                .unwrap_or("/usr/local/share:/usr/share");
            ShellIntegrationPlan {
                status: ShellIntegrationStatus::Injected,
                env: vec![(
                    "XDG_DATA_DIRS".to_owned(),
                    format!("{}:{existing}", base_dir.to_string_lossy()),
                )],
                args: Vec::new(),
            }
        }
        ShellFamily::Unsupported => unreachable!("filtered above"),
    };
    plan
}

/// Applies a [`ShellIntegrationPlan`]'s environment/args onto `command` —
/// **must** be called after `shell::apply_env_allowlist` (which calls
/// `CommandBuilder::env_clear` first), never before, or these additions
/// would be wiped out again. `service::TerminalService::start` does *not*
/// call this directly for exactly that timing reason (see its own comment);
/// this helper exists for this module's own tests, which apply a plan to a
/// bare `CommandBuilder` with no allowlist step in the way at all.
#[allow(dead_code)]
pub(crate) fn apply_to_command(command: &mut CommandBuilder, plan: &ShellIntegrationPlan) {
    for (name, value) in &plan.env {
        command.env(name, value);
    }
    if !plan.args.is_empty() {
        command.args(&plan.args);
    }
}

const ZSHENV: &str = r#"if [ -n "$PLAIN_TERM_ORIGINAL_ZDOTDIR" ]; then
  __plain_user_zdotdir="$PLAIN_TERM_ORIGINAL_ZDOTDIR"
else
  __plain_user_zdotdir="$HOME"
fi
unset PLAIN_TERM_ORIGINAL_ZDOTDIR
[ -f "$__plain_user_zdotdir/.zshenv" ] && . "$__plain_user_zdotdir/.zshenv"
"#;

const ZPROFILE: &str = r#"[ -f "$__plain_user_zdotdir/.zprofile" ] && . "$__plain_user_zdotdir/.zprofile"
"#;

// Runs last for a plain interactive (non-login) shell — the common case for
// a terminal tab — after zsh has already sourced `.zshenv` and (if login)
// `.zprofile` from this same injected `ZDOTDIR`. Sources the user's real
// `.zshrc` first, so any prompt theme has fully configured itself before
// this installs its own `precmd`/`preexec` hooks (appended, not replacing,
// via `add-zsh-hook`) — then restores `ZDOTDIR` to the user's real value so
// nested/child shells never inherit this injected directory. Known,
// accepted limitation: a non-interactive login zsh (rare; Plain never
// spawns one) would read `.zlogin` from the real `ZDOTDIR` directly (since
// it is restored here before `.zlogin` is looked up) without ever reaching
// this file at all, which is harmless — it simply means no hooks are
// installed for that unusual combination.
const ZSHRC: &str = r#"[ -f "$__plain_user_zdotdir/.zshrc" ] && . "$__plain_user_zdotdir/.zshrc"

if [[ $- == *i* ]]; then
  __plain_command_running=""
  __plain_osc7() {
    printf '\e]7;file://%s%s\e\\' "${HOST:-$(hostname 2>/dev/null)}" "$PWD"
  }
  __plain_precmd() {
    local __plain_exit=$?
    if [ -n "$__plain_command_running" ]; then
      printf '\e]133;D;%s\e\\' "$__plain_exit"
      __plain_command_running=""
    fi
    __plain_osc7
    printf '\e]133;A\e\\'
  }
  __plain_preexec() {
    __plain_command_running=1
    printf '\e]133;C\e\\'
  }
  autoload -Uz add-zsh-hook 2>/dev/null
  if typeset -f add-zsh-hook >/dev/null 2>&1; then
    add-zsh-hook precmd __plain_precmd
    add-zsh-hook preexec __plain_preexec
  fi
fi

export ZDOTDIR="$__plain_user_zdotdir"
unset __plain_user_zdotdir
"#;

// Passed via `--rcfile` (never `-c`) to a normally-interactive bash — see
// `plan_for_shell`'s `ShellFamily::Bash` arm. `--rcfile` replaces bash's own
// `~/.bashrc` lookup entirely, so this sources the user's real `.bashrc`
// itself before installing hooks. Bash has no native precmd/preexec, so
// this uses the same `PROMPT_COMMAND` + `DEBUG` trap technique
// `bash-preexec`/Ghostty/VS Code's own bash integration use, simplified: a
// `__plain_in_prompt_command` guard skips the DEBUG trap firing for
// commands the *existing* `PROMPT_COMMAND` chain itself runs (including our
// own final entry), so only a real user-typed command counts as "preexec".
const BASHRC: &str = r#"[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

if [ -z "$__plain_prompt_command_installed" ]; then
  __plain_prompt_command_installed=1
  __plain_in_prompt_command=""
  __plain_command_running=""
  __plain_osc7() {
    printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-$(hostname 2>/dev/null)}" "$PWD"
  }
  __plain_precmd() {
    local __plain_exit=$?
    if [ -n "$__plain_command_running" ]; then
      printf '\e]133;D;%s\e\\' "$__plain_exit"
      __plain_command_running=""
    fi
    __plain_osc7
    printf '\e]133;A\e\\'
    __plain_in_prompt_command=""
  }
  __plain_preexec() {
    if [ -n "$__plain_in_prompt_command" ]; then
      return
    fi
    __plain_command_running=1
    printf '\e]133;C\e\\'
  }
  trap '__plain_preexec' DEBUG
  PROMPT_COMMAND="__plain_in_prompt_command=1
${PROMPT_COMMAND-}
__plain_precmd"
fi
"#;

// Discovered automatically by *every* fish shell (interactive or not) via
// fish's own vendor `conf.d` mechanism — `plan_for_shell`'s `ShellFamily::Fish`
// arm only prepends this file's parent-of-parent directory to
// `XDG_DATA_DIRS`; fish does the rest, no `ZDOTDIR`/`--rcfile`-style
// wrapping needed. Fish has native `fish_prompt`/`fish_preexec`/
// `fish_postexec` events, so no DEBUG-trap-style guard is needed either.
const FISH_INTEGRATION: &str = r#"if status is-interactive
    function __plain_precmd --on-event fish_prompt
        printf '\e]7;file://%s%s\e\\' (hostname 2>/dev/null; or echo localhost) (pwd)
        printf '\e]133;A\e\\'
    end
    function __plain_preexec --on-event fish_preexec
        printf '\e]133;C\e\\'
    end
    function __plain_postexec --on-event fish_postexec
        printf '\e]133;D;%s\e\\' $status
    end
end
"#;

/// Writes every injected script constant into `base_dir`, creating parent
/// directories as needed — idempotent (safe to call once per session
/// start; always overwrites with the exact same fixed content, never reads
/// or merges anything already there). The only function in this module that
/// touches the filesystem.
pub(crate) fn ensure_integration_files(base_dir: &Path) -> io::Result<()> {
    let zsh_dir = base_dir.join("zsh");
    std::fs::create_dir_all(&zsh_dir)?;
    std::fs::write(zsh_dir.join(".zshenv"), ZSHENV)?;
    std::fs::write(zsh_dir.join(".zprofile"), ZPROFILE)?;
    std::fs::write(zsh_dir.join(".zshrc"), ZSHRC)?;

    let bash_dir = base_dir.join("bash");
    std::fs::create_dir_all(&bash_dir)?;
    std::fs::write(bash_dir.join("bashrc"), BASHRC)?;

    let fish_vendor_dir = base_dir.join("fish").join("vendor_conf.d");
    std::fs::create_dir_all(&fish_vendor_dir)?;
    std::fs::write(
        fish_vendor_dir.join("plain-integration.fish"),
        FISH_INTEGRATION,
    )?;

    Ok(())
}

#[cfg(test)]
mod tests;
