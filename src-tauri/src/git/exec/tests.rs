//! `exec::run_git` contract tests, including the hostile-fixture evidence
//! `docs/decisions/0003-native-git-and-generic-dap.md` requires: "fixture
//! 必须用恶意 core.fsmonitor、diff.external、textconv/filter、hooks、
//! credential helper 和 core.sshCommand 证明未信任与后台读取不会执行它们。"
//!
//! Every hostile-fixture test below (all `#[cfg(unix)]` — see that section's
//! own doc for why) is paired with a *control* variant that runs the exact
//! same malicious repository configuration through a bare, unhardened `git`
//! invocation first, asserting the marker file *does* get created. Without
//! that control, a passing hardened-side assertion would be ambiguous
//! evidence — it could mean "hardening works" just as easily as "this
//! fixture never does anything, hardened or not". Every one of these was
//! additionally verified by hand against the real `git` binary in this
//! workspace (`/usr/bin/git`, `git version 2.50.1`) before being encoded
//! here — see the report accompanying this slice for the exact transcripts.
//!
//! `git config core.fsmonitor true` was *not* used for the hooks fixture:
//! on this modern git version (macOS), `true` enables the *built-in*
//! fsmonitor daemon (`git-fsmonitor--daemon`), not the legacy
//! `<hooksPath>/fsmonitor-watchman` hook script — confirmed empirically to
//! never invoke a hook script at all. The `hooksPath` fixture instead uses
//! the `post-index-change` hook (fires whenever `git status` rewrites the
//! on-disk index, e.g. after a tracked file's mtime changes), which *is*
//! reliably invoked and *is* neutralized by the `-c core.hooksPath=<disabled>`
//! override.
//!
//! `diff.external`/textconv are **not** disabled by an unconditional `-c`
//! override (see `harden_background_read`'s own doc for why `-c
//! diff.external=` actively breaks `git diff` instead of gracefully
//! disabling it); the test below instead proves the *caller-supplied*
//! `--no-ext-diff`/`--no-textconv` flags do the job, matching what a later
//! slice's diff/show command builder must always include.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tempfile::TempDir;

use super::{
    run_git, run_git_network_with_limits_for_test, run_git_with_limits_for_test,
    run_git_with_stdin, run_git_with_stdin_and_limits_for_test, GitExecMode,
    GIT_EXEC_NETWORK_TIMEOUT, GIT_EXEC_TIMEOUT,
};

/// Whether a `git` binary is reachable on `PATH` at all — every test in
/// this module is a no-op skip (not a failure) when it is not, per the
/// task's explicit "先确认本机与 `pnpm check` 环境有无 git...若无则测试需
/// gate" requirement. On this workspace's own dev/CI environment `git` is
/// present (`/usr/bin/git`, 2.50.1), so in practice every test below runs
/// for real here.
fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// Runs a raw, *unhardened* `git` invocation for fixture setup (`init`,
/// `config`, `add`, `commit`, …) or for a "control" run proving a hostile
/// config genuinely fires absent this domain's hardening. Exempt from the
/// spawn guard by this file's `tests.rs` suffix (see
/// `scripts/plain/boundary-contracts.mjs`'s `WORKSPACE_TEST_SOURCE_PATTERN`).
fn raw_git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("raw git fixture command spawns")
}

fn raw_git_ok(dir: &Path, args: &[&str]) {
    let output = raw_git(dir, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_repo() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    raw_git_ok(dir.path(), &["init", "--quiet"]);
    raw_git_ok(
        dir.path(),
        &["config", "user.email", "plain-test@example.invalid"],
    );
    raw_git_ok(dir.path(), &["config", "user.name", "Plain Test"]);
    dir
}

#[test]
fn run_git_executes_a_simple_read_only_command_successfully() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let cancel = AtomicBool::new(false);
    let output = run_git(
        repo.path(),
        &["rev-parse".to_owned(), "--show-toplevel".to_owned()],
        GitExecMode::BackgroundRead,
        &cancel,
    )
    .expect("run_git succeeds for a simple read-only command");
    assert_eq!(output.exit_code, 0);
    let toplevel = String::from_utf8_lossy(&output.stdout);
    assert!(toplevel.trim_end().ends_with(
        repo.path()
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
    ));
}

#[test]
fn a_non_zero_git_exit_code_is_reported_as_data_not_an_error() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    // A plain (non-repository) directory: `git rev-parse --show-toplevel`
    // exits non-zero with a stderr message — this must surface as ordinary
    // `GitExecOutput` data, never a `CommandError`.
    let not_a_repo = TempDir::new().expect("tempdir");
    let cancel = AtomicBool::new(false);
    let output = run_git(
        not_a_repo.path(),
        &["rev-parse".to_owned(), "--show-toplevel".to_owned()],
        GitExecMode::BackgroundRead,
        &cancel,
    )
    .expect("run_git itself succeeds even though git's own exit code is non-zero");
    assert_ne!(output.exit_code, 0);
    assert!(!output.stderr.is_empty());
}

#[test]
fn nonexistent_repo_dir_is_rejected_as_cwd_invalid() {
    let missing = PathBuf::from("/plain-git-exec-test-path-that-does-not-exist");
    let cancel = AtomicBool::new(false);
    let error = run_git(
        &missing,
        &["status".to_owned()],
        GitExecMode::BackgroundRead,
        &cancel,
    )
    .expect_err("a nonexistent cwd must be rejected before ever spawning");
    assert_eq!(error.code(), "GIT_CWD_INVALID");
}

#[test]
fn write_mode_executes_a_simple_command_successfully() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    // `F080` S3 activates `GitExecMode::Write` (S0 only ever rejected it) —
    // this is the write-mode analogue of
    // `run_git_executes_a_simple_read_only_command_successfully`.
    let repo = init_repo();
    let cancel = AtomicBool::new(false);
    let output = run_git(
        repo.path(),
        &["status".to_owned(), "--porcelain=v2".to_owned()],
        GitExecMode::Write,
        &cancel,
    )
    .expect("Write mode executes a simple command successfully");
    assert_eq!(output.exit_code, 0);
}

#[test]
fn run_git_with_stdin_writes_the_full_payload_to_the_child() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let cancel = AtomicBool::new(false);
    // `git hash-object --stdin` echoes the SHA-1 of whatever it reads from
    // stdin — a direct, content-addressed proof the full payload (not a
    // truncated prefix) reached the child, exercising the exact stdin path
    // `git::stage::stage_blob` (`F080` S3) depends on.
    let payload = b"hello from run_git_with_stdin\n".repeat(1000);
    let output = run_git_with_stdin(
        repo.path(),
        &["hash-object".to_owned(), "--stdin".to_owned()],
        GitExecMode::Write,
        &cancel,
        &payload,
    )
    .expect("run_git_with_stdin succeeds");
    assert_eq!(output.exit_code, 0);
    let reported_hash = String::from_utf8_lossy(&output.stdout).trim().to_owned();

    let independent_hash_output = raw_git_hash_object_stdin(repo.path(), &payload);
    assert_eq!(reported_hash, independent_hash_output);
}

/// Independently hashes `payload` via a raw, unhardened `git hash-object
/// --stdin` invocation (never `-w`, so nothing is written to the object
/// database) — used only to cross-check
/// [`run_git_with_stdin_writes_the_full_payload_to_the_child`]'s result
/// against a ground truth computed a completely different way.
fn raw_git_hash_object_stdin(dir: &Path, payload: &[u8]) -> String {
    let mut child = Command::new("git")
        .current_dir(dir)
        .args(["hash-object", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("raw git hash-object spawns");
    child
        .stdin
        .take()
        .expect("stdin piped")
        .write_all(payload)
        .expect("write payload");
    let output = child.wait_with_output().expect("raw git hash-object waits");
    assert!(output.status.success());
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

#[test]
fn network_mode_executes_a_simple_command_successfully() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    // `F080` S4 activates `GitExecMode::Network` (S0 through S3 only ever
    // rejected it with `GIT_EXEC_MODE_UNSUPPORTED`) — this is the
    // network-mode analogue of `write_mode_executes_a_simple_command_successfully`.
    // A plain local `rev-parse` never touches a remote, so this only proves
    // the hardening profile itself does not break an ordinary invocation —
    // the network-specific hardening (SSH/credential/hook behavior, longer
    // timeout) is covered by the dedicated tests below.
    let repo = init_repo();
    let cancel = AtomicBool::new(false);
    let output = run_git(
        repo.path(),
        &["rev-parse".to_owned(), "--show-toplevel".to_owned()],
        GitExecMode::Network,
        &cancel,
    )
    .expect("Network mode executes a simple command successfully");
    assert_eq!(output.exit_code, 0);
}

/// Guards every test below that mutates process-wide environment variables
/// (`std::env::set_var`/`remove_var` affect the whole process, and `cargo
/// test` runs tests on multiple threads within one process): serializes them
/// against each other so none can observe another's in-flight mutation. No
/// other test in this codebase reads or writes `SSH_AUTH_SOCK` or the
/// synthetic key used below, so this mutex only ever needs to coordinate
/// with itself.
static NETWORK_ENV_MUTATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Runs `body` with every `(name, value)` pair in `overrides` applied to the
/// process environment (`Some(value)` sets it, `None` removes it), restoring
/// each name's exact prior state (present-with-value, or absent) once `body`
/// returns — including when `body` panics, via the lock's own poison
/// recovery on the *next* call, not a `Drop` guard (kept intentionally
/// simple: every caller below is a single straight-line test body, none
/// early-returns before reaching the restore step).
fn with_env_vars<R>(overrides: &[(&str, Option<&str>)], body: impl FnOnce() -> R) -> R {
    let _guard = NETWORK_ENV_MUTATION_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let previous: Vec<(String, Option<String>)> = overrides
        .iter()
        .map(|(name, _)| ((*name).to_owned(), std::env::var(name).ok()))
        .collect();
    for (name, value) in overrides {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }
    let result = body();
    for (name, value) in previous {
        match value {
            Some(value) => std::env::set_var(&name, value),
            None => std::env::remove_var(&name),
        }
    }
    result
}

/// Direct introspection of [`super::build_git_command`]'s constructed
/// [`std::process::Command`] (no subprocess spawn needed) — proves
/// [`GitExecMode::Network`]'s environment passthrough is *exactly*
/// [`super::GIT_NETWORK_ENV_PASSTHROUGH_NAMES`]'s three names plus the fixed
/// `GIT_TERMINAL_PROMPT`/`GIT_ASKPASS`/`LANG`/`LC_ALL` overrides — neither a
/// synthetic ambient variable outside that list, nor `SSH_AGENT_PID` (the
/// name [`super::harden_network`]'s own doc comment explains is deliberately
/// excluded), ever reaches the child. The real end-to-end proof that
/// `SSH_AUTH_SOCK` specifically reaches a genuine spawned `git` subprocess —
/// this test only proves the `Command` is *built* correctly — is
/// `network_mode_fixtures::ssh_auth_sock_reaches_a_real_git_subprocess_via_core_ssh_command`
/// below.
#[test]
fn network_mode_env_passthrough_is_exactly_the_closed_set() {
    with_env_vars(
        &[
            ("SSH_AUTH_SOCK", Some("/tmp/plain-test-fake-agent.sock")),
            ("SSH_AGENT_PID", Some("424242")),
            ("PLAIN_TEST_NETWORK_ENV_LEAK_CHECK", Some("should-not-leak")),
        ],
        || {
            let repo = TempDir::new().expect("tempdir");
            let command = super::build_git_command(
                repo.path(),
                &["status".to_owned()],
                GitExecMode::Network,
                false,
            )
            .expect("build_git_command succeeds for Network mode");
            let envs: std::collections::HashMap<String, Option<String>> = command
                .get_envs()
                .map(|(key, value)| {
                    (
                        key.to_string_lossy().into_owned(),
                        value.map(|value| value.to_string_lossy().into_owned()),
                    )
                })
                .collect();
            assert_eq!(
                envs.get("SSH_AUTH_SOCK").and_then(|value| value.as_deref()),
                Some("/tmp/plain-test-fake-agent.sock"),
                "Network mode must pass SSH_AUTH_SOCK through when present"
            );
            assert!(
                !envs.contains_key("SSH_AGENT_PID"),
                "Network mode must not pass through SSH_AGENT_PID — the SSH client itself \
                 never reads it, only ssh-agent's own shell-eval output does (see \
                 harden_network's own doc comment)"
            );
            assert!(
                !envs.contains_key("PLAIN_TEST_NETWORK_ENV_LEAK_CHECK"),
                "Network mode must not pass through a variable outside its audited closed set"
            );
            assert_eq!(
                envs.get("GIT_TERMINAL_PROMPT").and_then(|v| v.as_deref()),
                Some("0")
            );
            assert!(envs.contains_key("GIT_ASKPASS"));
            assert_eq!(
                envs.get("LANG").and_then(|v| v.as_deref()),
                Some("en_US.UTF-8")
            );
            assert_eq!(
                envs.get("LC_ALL").and_then(|v| v.as_deref()),
                Some("en_US.UTF-8")
            );
        },
    );
}

/// Locale regression evidence for acceptance criterion 2 ("Git output
/// parsing is independent of locale"), applying to all three exec modes —
/// not only `Network`, since the fixed `LANG`/`LC_ALL` override is common
/// code shared by [`harden_background_read`]/[`harden_write`]/
/// [`harden_network`].
///
/// **Why this test exists instead of asserting on real localized `git`
/// output**: this workspace's own `git` binary (`/usr/bin/git`, Apple Git
/// 2.50.1) is a real, verified negative — `git version --build-options`
/// lists no `gettext` feature, and forcing `LANG=fr_FR.UTF-8`/
/// `LC_ALL=fr_FR.UTF-8` on a real invocation produces byte-identical English
/// output (confirmed by hand while writing this test: `git status
/// --porcelain=v2` and `git help` are both unaffected). So this binary
/// cannot produce a genuinely localized message to parse either correctly or
/// incorrectly — a test that ran a real command and merely asserted the
/// output was still English would be vacuous here, not evidence.
///
/// What *is* real and testable on any machine, regardless of whether the
/// local `git` binary has i18n compiled in: this module's own
/// `LANG`/`LC_ALL` handling is an **unconditional override**, not a
/// conditional passthrough like `PATH`/`HOME`/`SSH_AUTH_SOCK` (which only
/// forward an ambient value when present, see
/// `network_mode_env_passthrough_is_exactly_the_closed_set` above). This
/// test proves exactly that distinction: it sets a hostile, non-English
/// ambient `LANG`/`LC_ALL` in the *test process itself* (mimicking a real
/// end user's own machine locale, e.g. `fr_FR.UTF-8`/`de_DE.UTF-8`), then
/// confirms every one of the three `GitExecMode`s still builds a command
/// with exactly `LANG=en_US.UTF-8`/`LC_ALL=en_US.UTF-8` — proving the
/// override is not merely coincidentally correct on this developer's own
/// already-English-locale machine, but genuinely independent of whatever
/// locale the end user's real OS is configured with (a Linux distro's git,
/// which very commonly *does* ship gettext, would otherwise localize
/// `git`'s stderr — exactly what `network::pull`/`network::push`'s stderr
/// substring matching, e.g. `git_pull_needs_strategy`/`git_push_rejected`,
/// depends on never happening).
#[test]
fn every_exec_mode_forces_english_locale_regardless_of_a_hostile_ambient_locale() {
    // `GitExecMode::BackgroundRead` now genuinely spawns a real
    // `git config --list -z` bootstrap subprocess as part of
    // `build_git_command` (see `harden_background_read`'s own doc comment),
    // so — unlike when this test was first written — it now needs a real
    // `git` binary too, not just for `write_mode_forces_english_locale_in_a_
    // real_spawned_subprocess` below.
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    with_env_vars(
        &[
            ("LANG", Some("fr_FR.UTF-8")),
            ("LC_ALL", Some("de_DE.UTF-8")),
        ],
        || {
            let repo = TempDir::new().expect("tempdir");
            for mode in [
                GitExecMode::BackgroundRead,
                GitExecMode::Write,
                GitExecMode::Network,
            ] {
                let command =
                    super::build_git_command(repo.path(), &["status".to_owned()], mode, false)
                        .expect("build_git_command succeeds");
                let envs: std::collections::HashMap<String, Option<String>> = command
                    .get_envs()
                    .map(|(key, value)| {
                        (
                            key.to_string_lossy().into_owned(),
                            value.map(|value| value.to_string_lossy().into_owned()),
                        )
                    })
                    .collect();
                assert_eq!(
                    envs.get("LANG").and_then(|value| value.as_deref()),
                    Some("en_US.UTF-8"),
                    "{mode:?} must force LANG=en_US.UTF-8 regardless of a hostile ambient LANG"
                );
                assert_eq!(
                    envs.get("LC_ALL").and_then(|value| value.as_deref()),
                    Some("en_US.UTF-8"),
                    "{mode:?} must force LC_ALL=en_US.UTF-8 regardless of a hostile ambient LC_ALL"
                );
            }
        },
    );
}

/// Introspection-only complement to the discard/stage-level real-fixture
/// tests (those are the tests that matter — they prove the actual attack
/// surface is closed; this one only proves the underlying mechanism reaches
/// every mode's built [`Command`], mirroring
/// `network_mode_env_passthrough_is_exactly_the_closed_set`'s own
/// introspection-only style): [`super::apply_universal_hardening`]'s
/// `GIT_LITERAL_PATHSPECS=1` must be present for all three [`GitExecMode`]s,
/// not narrowed to a subset — this is the same universal-hardening
/// guarantee `scripts/plain/boundary-contracts.mjs`'s AST lock enforces
/// statically, checked here dynamically against the real built `Command`.
#[test]
fn every_exec_mode_sets_git_literal_pathspecs() {
    // Unlike the pure in-memory introspection tests above,
    // `GitExecMode::BackgroundRead` now genuinely spawns a real
    // `git config --list -z` bootstrap subprocess as part of
    // `build_git_command` (see `harden_background_read`'s own doc comment),
    // so this test needs a real `git` binary too.
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = TempDir::new().expect("tempdir");
    for mode in [
        GitExecMode::BackgroundRead,
        GitExecMode::Write,
        GitExecMode::Network,
    ] {
        let command = super::build_git_command(repo.path(), &["status".to_owned()], mode, false)
            .expect("build_git_command succeeds");
        let envs: std::collections::HashMap<String, Option<String>> = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert_eq!(
            envs.get("GIT_LITERAL_PATHSPECS").and_then(|v| v.as_deref()),
            Some("1"),
            "{mode:?} must set GIT_LITERAL_PATHSPECS=1 — this is the universal, unconditional \
             hardening every GitExecMode shares, not something only one mode applies"
        );
    }
}

/// Real-subprocess complement to the introspection-only test above: proves
/// the forced `LANG`/`LC_ALL` actually reach a genuine spawned `git` child
/// (not just the `Command` value this module builds in memory), reusing
/// `hostile_fixtures`'s own `core.hooksPath` hook technique — a
/// `post-index-change` hook script that echoes its own `$LANG`/`$LC_ALL`
/// into a marker file, invoked by a real `git status` under
/// [`GitExecMode::Write`] (hooks only fire under `Write`/`Network`, not
/// `BackgroundRead` — see `harden_write`'s own doc comment; `Write` is used
/// here purely because it is the mode `hostile_fixtures` already has a
/// working hook fixture for, and `harden_write`/`harden_network` set
/// `LANG`/`LC_ALL` identically, so this evidence transfers directly to
/// `Network` — already proven independently by the introspection test
/// above).
#[cfg(unix)]
#[test]
fn write_mode_forces_english_locale_in_a_real_spawned_subprocess() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    with_env_vars(
        &[
            ("LANG", Some("fr_FR.UTF-8")),
            ("LC_ALL", Some("de_DE.UTF-8")),
        ],
        || {
            let repo = init_repo();
            let scripts = TempDir::new().expect("tempdir");
            let hooks_dir = scripts.path().join("hooks");
            std::fs::create_dir_all(&hooks_dir).expect("create hooks dir");
            let marker = scripts.path().join("locale-seen");
            let script_path = hooks_dir.join("post-index-change");
            let mut file = std::fs::File::create(&script_path).expect("create hook script");
            std::io::Write::write_all(
                &mut file,
                format!(
                    "#!/bin/sh\necho \"LANG=$LANG LC_ALL=$LC_ALL\" > '{}'\n",
                    marker.display()
                )
                .as_bytes(),
            )
            .expect("write hook script");
            drop(file);
            {
                use std::os::unix::fs::PermissionsExt as _;
                let mut perms = std::fs::metadata(&script_path)
                    .expect("script metadata")
                    .permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&script_path, perms).expect("chmod hook executable");
            }
            let cancel = AtomicBool::new(false);
            std::fs::write(repo.path().join("tracked.txt"), "content").unwrap();
            raw_git_ok(repo.path(), &["add", "tracked.txt"]);
            raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
            raw_git_ok(
                repo.path(),
                &["config", "core.hooksPath", hooks_dir.to_str().unwrap()],
            );
            // Bump the tracked file's mtime so `git status` genuinely
            // rewrites the index and fires `post-index-change` — same
            // technique `hostile_fixtures::background_read_disables_a_
            // malicious_hooks_path_hook` already establishes.
            let touch_status = Command::new("touch")
                .arg(repo.path().join("tracked.txt"))
                .status()
                .expect("touch spawns");
            assert!(touch_status.success());

            let output = run_git(
                repo.path(),
                &["status".to_owned(), "--porcelain=v2".to_owned()],
                GitExecMode::Write,
                &cancel,
            )
            .expect("write-mode status succeeds");
            assert_eq!(output.exit_code, 0);
            let recorded = std::fs::read_to_string(&marker)
                .expect("hook fired and wrote the marker file under Write mode");
            assert_eq!(recorded.trim(), "LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8");
        },
    );
}

// ---------------------------------------------------------------------
// The remaining tests all configure a hostile shell-script hook/filter and
// therefore depend on POSIX shebang execution and executable permission
// bits — hence `#[cfg(unix)]`. This workspace's dev/test environment is
// macOS (Darwin); these are not verified on Windows.
// ---------------------------------------------------------------------

#[cfg(unix)]
mod hostile_fixtures {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn write_executable_script(path: &Path, body: &str) {
        let mut file = std::fs::File::create(path).expect("create script file");
        file.write_all(format!("#!/bin/sh\n{body}\n").as_bytes())
            .expect("write script body");
        drop(file);
        let mut perms = std::fs::metadata(path)
            .expect("script metadata")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).expect("chmod script executable");
    }

    /// A marker script that exits non-zero: fine for hooks git treats as
    /// best-effort (fsmonitor, `post-index-change`) — git proceeds normally
    /// either way — but *not* suitable as `diff.external`/textconv, where a
    /// non-zero exit makes the whole `git diff` invocation itself fail
    /// (`external diff died` / `unable to read files to diff`); see
    /// [`marker_script_exit_zero`] for those.
    fn marker_script(scripts_dir: &Path, name: &str, marker: &Path) -> PathBuf {
        let script_path = scripts_dir.join(name);
        write_executable_script(
            &script_path,
            &format!("touch '{}'\nexit 1", marker.display()),
        );
        script_path
    }

    /// Like [`marker_script`], but exits zero and prints a line of content
    /// — required for a `diff.external`/textconv marker script, so the
    /// control run's `git diff` still completes successfully instead of
    /// failing outright on the external helper's own exit code.
    fn marker_script_exit_zero(scripts_dir: &Path, name: &str, marker: &Path) -> PathBuf {
        let script_path = scripts_dir.join(name);
        write_executable_script(
            &script_path,
            &format!("touch '{}'\necho converted", marker.display()),
        );
        script_path
    }

    #[test]
    fn background_read_disables_a_malicious_core_fsmonitor_command() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("fsmonitor-fired");
        let script = marker_script(scripts.path(), "fsmonitor.sh", &marker);
        raw_git_ok(
            repo.path(),
            &["config", "core.fsmonitor", script.to_str().unwrap()],
        );

        // Control: an unhardened `git status` genuinely invokes the
        // configured fsmonitor command — proves the fixture is real.
        assert!(!marker.exists());
        raw_git_ok(repo.path(), &["status"]);
        assert!(
            marker.exists(),
            "control run must prove the malicious core.fsmonitor fires absent hardening"
        );
        std::fs::remove_file(&marker).unwrap();

        // Hardened: `run_git`'s BackgroundRead mode overrides
        // `core.fsmonitor` to empty, so the malicious command must never
        // run.
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &["status".to_owned(), "--porcelain=v2".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
        )
        .expect("hardened status still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            !marker.exists(),
            "hardened background read must not invoke the malicious core.fsmonitor command"
        );
    }

    #[test]
    fn background_read_disables_a_malicious_hooks_path_hook() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let hooks_dir = scripts.path().join("hooks");
        std::fs::create_dir_all(&hooks_dir).expect("create hooks dir");
        let marker = scripts.path().join("post-index-change-fired");
        marker_script(&hooks_dir, "post-index-change", &marker);

        // Commit the tracked file *before* pointing `core.hooksPath` at the
        // malicious directory — `git add`/`git commit` also rewrite the
        // index (and would otherwise fire `post-index-change` themselves,
        // confusing this fixture's before/after evidence).
        std::fs::write(repo.path().join("tracked.txt"), "content").unwrap();
        raw_git_ok(repo.path(), &["add", "tracked.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        raw_git_ok(
            repo.path(),
            &["config", "core.hooksPath", hooks_dir.to_str().unwrap()],
        );

        // Control: touching the file and running an unhardened `git
        // status` genuinely invokes the hooksPath hook — proves the
        // fixture is real.
        filetime_touch(&repo.path().join("tracked.txt"));
        assert!(!marker.exists());
        raw_git_ok(repo.path(), &["status"]);
        assert!(
            marker.exists(),
            "control run must prove the malicious core.hooksPath hook fires absent hardening"
        );
        std::fs::remove_file(&marker).unwrap();

        // Hardened.
        filetime_touch(&repo.path().join("tracked.txt"));
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &["status".to_owned(), "--porcelain=v2".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
        )
        .expect("hardened status still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            !marker.exists(),
            "hardened background read must not invoke the malicious core.hooksPath hook"
        );
    }

    /// Bumps a file's mtime to "now" via the plain POSIX `touch` command
    /// (portable across the macOS/Linux unix flavors this module targets,
    /// unlike BSD-`touch`-specific `-t`/`-v` timestamp flags) so git's
    /// stat-based change detection treats it as possibly-changed and
    /// rewrites the index on the next `status` — which is what actually
    /// triggers `post-index-change`.
    fn filetime_touch(path: &Path) {
        let status = Command::new("touch")
            .arg(path)
            .status()
            .expect("touch spawns");
        assert!(status.success(), "touch must succeed");
    }

    /// The safety-core contrast this slice's report is built around:
    /// the *exact same* hostile `core.hooksPath` fixture
    /// [`background_read_disables_a_malicious_hooks_path_hook`] proves is
    /// neutralized under [`GitExecMode::BackgroundRead`] must, under
    /// [`GitExecMode::Write`] (`F080` S3), actually fire — because for a
    /// write, that "malicious" hook is just the repository's own configured
    /// hook, and ADR 0003 says a user-initiated write must respect it.
    #[test]
    fn write_mode_allows_the_repositorys_own_hooks_path_hook_to_fire() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let hooks_dir = scripts.path().join("hooks");
        std::fs::create_dir_all(&hooks_dir).expect("create hooks dir");
        let marker = scripts.path().join("post-index-change-fired");
        marker_script(&hooks_dir, "post-index-change", &marker);

        std::fs::write(repo.path().join("tracked.txt"), "content").unwrap();
        raw_git_ok(repo.path(), &["add", "tracked.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        raw_git_ok(
            repo.path(),
            &["config", "core.hooksPath", hooks_dir.to_str().unwrap()],
        );

        filetime_touch(&repo.path().join("tracked.txt"));
        assert!(!marker.exists());
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &["status".to_owned(), "--porcelain=v2".to_owned()],
            GitExecMode::Write,
            &cancel,
        )
        .expect("write-mode status still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            marker.exists(),
            "GitExecMode::Write must respect the repository's own core.hooksPath hook — \
             this is the deliberate contrast with background_read_disables_a_malicious_hooks_path_hook"
        );
    }

    // -----------------------------------------------------------------
    // Attribute-driven content filters (`filter.<name>.clean`/`.smudge`/
    // `.process`) — the vector `harden_background_read`'s filter-
    // neutralization step closes. See that function's own doc comment for
    // the full design; these tests mirror the `core.hooksPath` contrast
    // pair above exactly (hardened-disables / write-mode-still-respects),
    // plus the `include.path`-precedence and fail-closed-bootstrap
    // properties specific to this fix.
    // -----------------------------------------------------------------

    #[test]
    fn background_read_disables_a_malicious_filter_clean_command() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("filter-clean-fired");
        let script = marker_script_exit_zero(scripts.path(), "filter-clean.sh", &marker);

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join(".gitattributes"), "*.txt filter=hostile\n").unwrap();
        raw_git_ok(repo.path(), &["add", ".gitattributes"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "attrs"]);
        raw_git_ok(
            repo.path(),
            &["config", "filter.hostile.clean", script.to_str().unwrap()],
        );

        // Bumping the tracked file's mtime makes `git status` genuinely
        // re-hash (and therefore re-`clean`) it — the exact same technique
        // `background_read_disables_a_malicious_hooks_path_hook` uses for
        // `post-index-change`, and exactly the real-world trigger (a normal
        // editor save) this slice's report is built around.
        filetime_touch(&repo.path().join("a.txt"));

        // Control: an unhardened `git status` genuinely invokes the
        // configured clean filter.
        assert!(!marker.exists());
        raw_git_ok(repo.path(), &["status"]);
        assert!(
            marker.exists(),
            "control run must prove the malicious filter.hostile.clean fires absent hardening"
        );
        std::fs::remove_file(&marker).unwrap();

        // Hardened: `run_git`'s BackgroundRead mode discovers
        // `filter.hostile.clean` via its config-list bootstrap and
        // neutralizes it, so the malicious command must never run.
        filetime_touch(&repo.path().join("a.txt"));
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &["status".to_owned(), "--porcelain=v2".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
        )
        .expect("hardened status still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            !marker.exists(),
            "hardened background read must not invoke the malicious filter.hostile.clean command"
        );
    }

    /// The safety-core contrast this fix's evidence is built around,
    /// mirroring `write_mode_allows_the_repositorys_own_hooks_path_hook_to_fire`:
    /// the exact same hostile `filter.hostile.clean` fixture must, under
    /// `GitExecMode::Write`, actually fire — a real user-initiated write
    /// (e.g. `git commit`, which re-hashes working-tree content the same
    /// way `git status` does) must respect the repository's own configured
    /// filters (ADR 0003), and git-lfs itself is exactly this shape of
    /// filter.
    #[test]
    fn write_mode_allows_the_repositorys_own_filter_clean_command_to_fire() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("filter-clean-fired");
        let script = marker_script_exit_zero(scripts.path(), "filter-clean.sh", &marker);

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join(".gitattributes"), "*.txt filter=hostile\n").unwrap();
        raw_git_ok(repo.path(), &["add", ".gitattributes"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "attrs"]);
        raw_git_ok(
            repo.path(),
            &["config", "filter.hostile.clean", script.to_str().unwrap()],
        );

        filetime_touch(&repo.path().join("a.txt"));
        assert!(!marker.exists());
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &["status".to_owned(), "--porcelain=v2".to_owned()],
            GitExecMode::Write,
            &cancel,
        )
        .expect("write-mode status still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            marker.exists(),
            "GitExecMode::Write must respect the repository's own filter.hostile.clean command — \
             this is the deliberate contrast with background_read_disables_a_malicious_filter_clean_command"
        );
    }

    /// Smudge fires in the opposite direction from clean — object database
    /// content being *populated into* the working tree (`checkout`, `reset
    /// --hard`, a fresh `clone`), not on `status`/`diff`/`show`'s own
    /// re-hash-and-compare path (confirmed empirically: neither fires
    /// smudge — see this slice's report). No command this domain's own
    /// higher-level modules ever issue under `GitExecMode::BackgroundRead`
    /// populates working-tree content from the object database at all —
    /// `discard::discard_paths`'s `checkout -q --` (the one command in this
    /// domain that *would* trigger smudge) only ever runs under
    /// `GitExecMode::Write`. So this test calls `run_git` directly with raw
    /// `checkout` arguments under `BackgroundRead` — exactly like every
    /// other test in this module calls `run_git` with raw args rather than
    /// through a higher-level domain module — to prove `exec.rs`'s own
    /// hardening is complete at the *mechanism* level (defense-in-depth
    /// against a future BackgroundRead caller that populates content),
    /// rather than claiming this is a live, currently-reachable attack
    /// surface today (it is not, and this doc comment says so plainly).
    #[test]
    fn background_read_disables_a_malicious_filter_smudge_command_via_checkout() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("filter-smudge-fired");
        let script = marker_script_exit_zero(scripts.path(), "filter-smudge.sh", &marker);

        raw_git_ok(repo.path(), &["config", "filter.hostile.clean", "cat"]);
        raw_git_ok(
            repo.path(),
            &["config", "filter.hostile.smudge", script.to_str().unwrap()],
        );
        std::fs::write(repo.path().join(".gitattributes"), "*.txt filter=hostile\n").unwrap();
        raw_git_ok(repo.path(), &["add", ".gitattributes"]);
        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

        // Control: deleting the working-tree file and running an
        // unhardened `git checkout -- a.txt` to repopulate it genuinely
        // invokes the configured smudge filter.
        std::fs::remove_file(repo.path().join("a.txt")).unwrap();
        assert!(!marker.exists());
        raw_git_ok(repo.path(), &["checkout", "--", "a.txt"]);
        assert!(
            marker.exists(),
            "control run must prove the malicious filter.hostile.smudge fires absent hardening"
        );
        std::fs::remove_file(&marker).unwrap();

        // Hardened.
        std::fs::remove_file(repo.path().join("a.txt")).unwrap();
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &["checkout".to_owned(), "--".to_owned(), "a.txt".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
        )
        .expect("hardened checkout still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            !marker.exists(),
            "hardened BackgroundRead must not invoke the malicious filter.hostile.smudge command"
        );
        assert_eq!(
            std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
            "one\n"
        );
    }

    /// Command-line `-c` overrides beat every other config source,
    /// including an `include.path`-included file — confirmed here against a
    /// filter defined *only* in an included config file (never in the
    /// repository's own local `.git/config`), proving `run_git`'s
    /// discovery-then-neutralize mechanism (`git config --list -z`, which
    /// itself also honors `include.path`, then a command-line `-c` override
    /// for whatever it finds) is not fooled by a hostile repository hiding
    /// its filter definition behind an include.
    #[test]
    fn background_read_neutralizes_a_filter_defined_only_in_an_included_config_file() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("included-filter-clean-fired");
        let script = marker_script_exit_zero(scripts.path(), "included-filter-clean.sh", &marker);

        // `.gitattributes`/`a.txt` are added and committed *before* the
        // filter is configured at all — mirroring
        // `background_read_disables_a_malicious_filter_clean_command`'s own
        // ordering — so this setup's own `git add`/`git commit` calls never
        // themselves invoke the (not-yet-configured) clean filter and
        // prematurely create `marker`.
        std::fs::write(repo.path().join(".gitattributes"), "*.txt filter=hostile\n").unwrap();
        raw_git_ok(repo.path(), &["add", ".gitattributes"]);
        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

        let included_config = scripts.path().join("included.gitconfig");
        raw_git_ok(
            scripts.path(),
            &[
                "config",
                "-f",
                included_config.to_str().unwrap(),
                "filter.hostile.clean",
                script.to_str().unwrap(),
            ],
        );
        raw_git_ok(
            repo.path(),
            &[
                "config",
                "--add",
                "include.path",
                included_config.to_str().unwrap(),
            ],
        );

        // Control: unhardened status genuinely invokes the include.path-
        // included filter (the repository's *own* local .git/config never
        // mentions `filter.hostile` at all).
        filetime_touch(&repo.path().join("a.txt"));
        assert!(!marker.exists());
        raw_git_ok(repo.path(), &["status"]);
        assert!(
            marker.exists(),
            "control run must prove the include.path-included filter.hostile.clean fires absent hardening"
        );
        std::fs::remove_file(&marker).unwrap();

        // Hardened.
        filetime_touch(&repo.path().join("a.txt"));
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &["status".to_owned(), "--porcelain=v2".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
        )
        .expect("hardened status still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            !marker.exists(),
            "hardened background read must neutralize a filter defined only in an \
             include.path-included config file, not just the repository's own local config"
        );
    }

    /// A non-zero exit from the filter-discovery bootstrap (`git config
    /// --list -z`) must be a **hard failure**, never silently treated as "no
    /// filters configured" — the fail-open direction ADR 0003 forbids. A
    /// malformed `.git/config` line is a real, empirically confirmed way to
    /// make `git config --list` itself exit non-zero (`fatal: bad config
    /// line N`, exit 128 — verified against the real binary in this slice's
    /// report). There is no meaningful "unhardened control" for this
    /// specific property the way the hostile-filter tests above have one —
    /// this is not itself an executable vulnerability (a malformed config
    /// that breaks `git config --list` breaks *every* git invocation reading
    /// that same config identically, including the "real" command, so there
    /// is no config shape where the bootstrap fails but a hostile filter
    /// would otherwise still resolve and fire); it is a defensive-correctness
    /// property. The meaningful, observable assertion: before this fix,
    /// `run_git` on this exact fixture would have returned `Ok(GitExecOutput
    /// { exit_code: 128, .. })` (a non-zero exit is ordinary data — see this
    /// module's own `GitExecOutput` doc comment — since `git status` itself
    /// simply fails on the malformed config); after this fix, the bootstrap
    /// step's own failure is escalated to a structured `CommandError`
    /// *before* the real command is ever attempted.
    #[test]
    fn background_read_fails_closed_when_the_filter_discovery_bootstrap_itself_fails() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let config_path = repo.path().join(".git").join("config");
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&config_path)
            .expect("open .git/config for appending");
        writeln!(file, "[this is not valid ini !!!").expect("append malformed config line");
        drop(file);

        let cancel = AtomicBool::new(false);
        let error = run_git(
            repo.path(),
            &["status".to_owned(), "--porcelain=v2".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
        )
        .expect_err(
            "a BackgroundRead call must fail closed with a structured CommandError when its own \
             filter-discovery bootstrap cannot read repository config, rather than silently \
             proceeding as if no filters were configured",
        );
        assert_eq!(error.code(), "GIT_EXEC_FILTER_DISCOVERY_FAILED");
    }

    /// Config-key reachability enumeration finding (this slice's report):
    /// confirms empirically that real git 2.50.1 does **not** let
    /// `alias.<name>` shadow an *already-existing builtin* subcommand of the
    /// same name — every literal first argument this domain's own source
    /// ever passes to `run_git` is exercised here (grepped from every
    /// `GIT_*_ARGS` constant and every dynamically built `args` vector across
    /// `src-tauri/src/git/*.rs`). `git <builtin> --help` is used as the
    /// no-side-effect probe for each (git intercepts `--help` before running
    /// the subcommand's own logic, for both a real builtin and a shadowing
    /// alias, so this is a safe, non-destructive way to observe which one
    /// actually ran). `alias.mystatus` (a genuinely non-builtin name) is a
    /// positive control proving the fixture's aliasing mechanism itself does
    /// work — without it, "no marker fired" could just as easily mean
    /// "aliasing is broken in this fixture" as "aliasing cannot shadow
    /// builtins". No neutralization was added for `alias.*` because there is
    /// nothing to neutralize: this vector is not reachable at all for any
    /// command this domain issues.
    #[test]
    fn git_aliases_do_not_shadow_this_domains_builtin_subcommands() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        std::fs::write(repo.path().join("a.txt"), "hi\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

        const BUILTIN_NAMES: &[&str] = &[
            "status",
            "diff",
            "rev-parse",
            "ls-files",
            "show",
            "config",
            "add",
            "reset",
            "hash-object",
            "update-index",
            "commit",
            "checkout",
            "fetch",
            "pull",
            "push",
        ];
        for name in BUILTIN_NAMES {
            raw_git_ok(
                repo.path(),
                &[
                    "config",
                    &format!("alias.{name}"),
                    &format!("!touch alias-{name}-fired.txt"),
                ],
            );
        }
        raw_git_ok(
            repo.path(),
            &[
                "config",
                "alias.mystatus",
                "!touch alias-mystatus-fired.txt",
            ],
        );

        // Positive control: a genuinely non-builtin alias name really does
        // fire, proving the fixture mechanism itself works.
        let _ = raw_git(repo.path(), &["mystatus"]);
        assert!(
            repo.path().join("alias-mystatus-fired.txt").exists(),
            "sanity: a non-builtin alias name must fire — otherwise this fixture proves nothing"
        );

        for name in BUILTIN_NAMES {
            let _ = raw_git(repo.path(), &[name, "--help"]);
        }
        for name in BUILTIN_NAMES {
            assert!(
                !repo.path().join(format!("alias-{name}-fired.txt")).exists(),
                "alias.{name} must not have shadowed the real builtin {name} subcommand"
            );
        }
    }

    #[test]
    fn caller_supplied_no_ext_diff_disables_a_malicious_diff_external() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("diff-external-fired");
        let script = marker_script_exit_zero(scripts.path(), "diff-external.sh", &marker);

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();
        raw_git_ok(
            repo.path(),
            &["config", "diff.external", script.to_str().unwrap()],
        );

        // Control: unhardened `git diff` genuinely shells out to the
        // configured external diff program.
        assert!(!marker.exists());
        raw_git_ok(repo.path(), &["diff"]);
        assert!(
            marker.exists(),
            "control run must prove the malicious diff.external fires absent --no-ext-diff"
        );
        std::fs::remove_file(&marker).unwrap();

        // Hardened: the caller passes `--no-ext-diff` (a later F080
        // slice's diff command builder always would for a diff-family
        // invocation) — `harden_background_read` cannot apply this
        // unconditionally (see its own doc comment for why), so this is
        // exactly the caller-responsibility path being exercised here.
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &["diff".to_owned(), "--no-ext-diff".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
        )
        .expect("hardened diff still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            !marker.exists(),
            "a caller-supplied --no-ext-diff must prevent the malicious diff.external from running"
        );
    }

    #[test]
    fn caller_supplied_no_textconv_disables_a_malicious_textconv_filter() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("textconv-fired");
        let script = marker_script_exit_zero(scripts.path(), "textconv.sh", &marker);

        std::fs::write(repo.path().join("bin.dat"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "bin.dat"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join(".gitattributes"), "*.dat diff=hostile\n").unwrap();
        raw_git_ok(
            repo.path(),
            &["config", "diff.hostile.textconv", script.to_str().unwrap()],
        );
        std::fs::write(repo.path().join("bin.dat"), "two\n").unwrap();

        // Control: unhardened `git diff` genuinely runs the configured
        // textconv filter to render the "text" version of the file.
        assert!(!marker.exists());
        raw_git_ok(repo.path(), &["diff", "--", "bin.dat"]);
        assert!(
            marker.exists(),
            "control run must prove the malicious textconv filter fires absent --no-textconv"
        );
        std::fs::remove_file(&marker).unwrap();

        // Hardened: caller-supplied `--no-textconv`.
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &[
                "diff".to_owned(),
                "--no-textconv".to_owned(),
                "--".to_owned(),
                "bin.dat".to_owned(),
            ],
            GitExecMode::BackgroundRead,
            &cancel,
        )
        .expect("hardened diff still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            !marker.exists(),
            "a caller-supplied --no-textconv must prevent the malicious textconv filter from running"
        );
    }

    /// Scope note (renamed from `background_read_never_reaches_a_malicious_
    /// credential_helper_or_ssh_command` — this slice's evidence-accuracy
    /// review flagged the old name as implying a hardening-vs-unhardened
    /// contrast that does not exist for this vector): unlike the four
    /// vectors above, a malicious `credential.helper`/`core.sshCommand`
    /// cannot be forced to fire through `GitExecMode::BackgroundRead`'s
    /// actual command surface at all — `status`/`diff`/`rev-parse` never
    /// touch a remote or ask for credentials regardless of hardening
    /// (confirmed empirically: they do not fire even *without* any
    /// override, so there is no meaningful "control" run to contrast
    /// against — this is not "hardening neutralizes a vector that would
    /// otherwise fire", it is "this vector is not reachable via this
    /// command surface at all". `GitExecMode::Network` — the one mode in
    /// this domain that legitimately does touch credentials/SSH, activated
    /// by a later `F080` slice after this test was originally written — is
    /// exercised separately and in full by `network_mode_fixtures` below,
    /// including real hostile-`core.askPass` control/hardened pairs
    /// (`control_hostile_core_askpass_fires_without_a_git_askpass_override`/
    /// `network_mode_git_askpass_blocks_a_hostile_core_askpass_when_credential_helper_is_incomplete`).
    #[test]
    fn credential_helper_and_ssh_command_are_unreachable_via_the_background_read_command_surface() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let credential_marker = scripts.path().join("credential-fired");
        let ssh_marker = scripts.path().join("ssh-fired");
        let credential_script = marker_script(scripts.path(), "credential.sh", &credential_marker);
        let ssh_script = marker_script(scripts.path(), "ssh.sh", &ssh_marker);
        raw_git_ok(
            repo.path(),
            &[
                "config",
                "credential.helper",
                credential_script.to_str().unwrap(),
            ],
        );
        raw_git_ok(
            repo.path(),
            &["config", "core.sshCommand", ssh_script.to_str().unwrap()],
        );

        let cancel = AtomicBool::new(false);
        for args in [
            vec!["status".to_owned(), "--porcelain=v2".to_owned()],
            vec!["diff".to_owned()],
            vec!["rev-parse".to_owned(), "--show-toplevel".to_owned()],
        ] {
            run_git(repo.path(), &args, GitExecMode::BackgroundRead, &cancel)
                .unwrap_or_else(|error| panic!("{args:?} must still succeed: {error:?}"));
        }
        assert!(!credential_marker.exists());
        assert!(!ssh_marker.exists());
    }

    #[test]
    fn cancellation_terminates_a_running_process_and_reports_cancelled() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let script_path = scripts.path().join("slow-diff-external.sh");
        write_executable_script(&script_path, "sleep 5\necho slow-diff-output");

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();
        raw_git_ok(
            repo.path(),
            &["config", "diff.external", script_path.to_str().unwrap()],
        );

        let repo_path = repo.path().to_path_buf();
        let cancel = AtomicBool::new(false);
        let start = std::time::Instant::now();
        std::thread::scope(|scope| {
            let handle = scope.spawn(|| {
                run_git_with_limits_for_test(
                    &repo_path,
                    &["diff".to_owned()],
                    GitExecMode::BackgroundRead,
                    &cancel,
                    Duration::from_secs(30),
                    10_000_000,
                )
            });
            std::thread::sleep(Duration::from_millis(200));
            cancel.store(true, Ordering::SeqCst);
            let result = handle.join().expect("worker thread does not panic");
            let error = result.expect_err("a cancelled invocation must be an error");
            assert_eq!(error.code(), "GIT_EXEC_CANCELLED");
        });
        // The load-bearing regression assertion for the `wait_with_limits`
        // reader-join fix (see that function's own doc comment): the
        // `diff.external` script here is a *grandchild* of the killed `git`
        // process (git execs it directly, its stdout wired straight to the
        // same piped fd our reader thread reads) and keeps sleeping for
        // ~4.8s more of its own `sleep 5` after `git` itself is killed and
        // reaped on cancellation ~200ms in. Before this fix, `wait_with_limits`'s
        // final `stdout_handle.join()`/`stderr_handle.join()` blocked on that
        // orphaned grandchild's own pipe close, and this exact test measured
        // ~5.56s real wall-clock (via `cargo test ... -- --nocapture`) despite
        // "cancelling" almost instantly. 4 seconds is a generous margin over
        // the ~200ms cancel delay plus [`super::GIT_EXEC_READER_DRAIN_GRACE`]
        // (500ms) plus scheduling slack observed under the full parallel
        // test suite (785+ tests forking subprocesses concurrently pushes
        // this measurably higher than an isolated single-test run) —
        // comfortably under the child's remaining ~4.8s sleep, so this
        // assertion only passes when the reader join is genuinely bounded,
        // not merely "eventually returns".
        let elapsed = start.elapsed();
        assert!(
            elapsed < Duration::from_secs(4),
            "cancellation must return within a small bounded window even though the orphaned \
             diff.external grandchild keeps the output pipe open for its own remaining ~4.8s \
             sleep — took {elapsed:?}"
        );
    }

    /// A dedicated test for the general shape of the `wait_with_limits`
    /// reader-join fix, deliberately *not* going through cancellation or a
    /// timeout at all: `diff.external` here forks a **detached** background
    /// subshell (`(sleep 8; echo …) &` then `exit 0`) that inherits the same
    /// piped stdout/stderr and keeps them open, while the immediate
    /// `diff.external` process itself — and therefore the top-level `git`
    /// process our Rust code spawns, which waits for it synchronously —
    /// exits almost instantly (confirmed with a standalone shell
    /// reproduction in this slice's report: well under a second of
    /// real overhead). So `run_git`'s own poll loop reaches a perfectly
    /// ordinary `ExecOutcome::Exited` almost immediately, with no cancel or
    /// timeout ever firing — proving the reader-join bound applies to *any*
    /// exit path, not just the cancel/timeout branches the test above
    /// exercises.
    #[test]
    fn run_git_returns_promptly_even_when_a_detached_grandchild_keeps_the_output_pipe_open() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let script_path = scripts.path().join("detaching-diff-external.sh");
        write_executable_script(
            &script_path,
            "(sleep 8; echo late-output-from-detached-grandchild) &\nexit 0",
        );

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();
        raw_git_ok(
            repo.path(),
            &["config", "diff.external", script_path.to_str().unwrap()],
        );

        let cancel = AtomicBool::new(false);
        let start = std::time::Instant::now();
        let output = run_git_with_limits_for_test(
            repo.path(),
            &["diff".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
            Duration::from_secs(30),
            10_000_000,
        )
        .expect("an ordinary, uncancelled diff must still succeed even with a detached grandchild");
        let elapsed = start.elapsed();
        assert_eq!(output.exit_code, 0);
        // 5s (not a tighter bound like 2s): measured in isolation this
        // returns in ~1.35s, but under the full parallel test suite (785+
        // tests, many concurrently forking subprocesses) scheduling
        // contention alone pushed this as high as ~3.5s in practice — still
        // comfortably bounded, just not as tight as a single-test run.
        // 5s stays well clear of that observed contention noise while
        // remaining sharply distinguishing from the unbounded-join bug this
        // test guards against (which would take close to the full 8s the
        // detached grandchild actually sleeps for).
        assert!(
            elapsed < Duration::from_secs(5),
            "run_git must return within a small bounded window despite a detached grandchild \
             holding the output pipe open for 8 more seconds in the background — took {elapsed:?}"
        );
    }

    #[test]
    fn exceeding_the_timeout_terminates_the_process_and_reports_timeout() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let script_path = scripts.path().join("slow-diff-external.sh");
        write_executable_script(&script_path, "sleep 5\necho slow-diff-output");

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();
        raw_git_ok(
            repo.path(),
            &["config", "diff.external", script_path.to_str().unwrap()],
        );

        let cancel = AtomicBool::new(false);
        let error = run_git_with_limits_for_test(
            repo.path(),
            &["diff".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
            Duration::from_millis(150),
            10_000_000,
        )
        .expect_err("a slow invocation must time out");
        assert_eq!(error.code(), "GIT_EXEC_TIMEOUT");
    }

    /// The stdin-writer code path (`run_git_with_stdin`/
    /// `run_git_with_stdin_and_limits`) shares `wait_with_limits` with the
    /// no-stdin path — this proves the timeout/kill machinery still applies
    /// correctly when a stdin-writer thread is also in flight (not just that
    /// the writer thread itself doesn't hang the caller).
    #[test]
    fn run_git_with_stdin_also_times_out_a_slow_child() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let script_path = scripts.path().join("slow-diff-external.sh");
        write_executable_script(&script_path, "sleep 5\necho slow-diff-output");

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();
        raw_git_ok(
            repo.path(),
            &["config", "diff.external", script_path.to_str().unwrap()],
        );

        let cancel = AtomicBool::new(false);
        // `git diff` never reads stdin, so this payload is simply never
        // consumed — proving the writer thread completing (or not) has no
        // bearing on the timeout firing correctly.
        let error = run_git_with_stdin_and_limits_for_test(
            repo.path(),
            &["diff".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
            b"unread stdin payload",
            Duration::from_millis(150),
            10_000_000,
        )
        .expect_err("a slow invocation must time out even on the stdin-capable path");
        assert_eq!(error.code(), "GIT_EXEC_TIMEOUT");
    }

    #[test]
    fn exceeding_the_output_cap_terminates_the_process_and_reports_the_limit_error() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let script_path = scripts.path().join("noisy-diff-external.sh");
        write_executable_script(&script_path, "head -c 200000 /dev/zero");

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();
        raw_git_ok(
            repo.path(),
            &["config", "diff.external", script_path.to_str().unwrap()],
        );

        let cancel = AtomicBool::new(false);
        let error = run_git_with_limits_for_test(
            repo.path(),
            &["diff".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
            Duration::from_secs(30),
            100,
        )
        .expect_err("output exceeding the cap must be rejected");
        assert_eq!(error.code(), "GIT_EXEC_OUTPUT_LIMIT_EXCEEDED");
    }

    /// The normal-case complement to the two orphan/detached-grandchild
    /// tests above: proves [`super::GIT_EXEC_READER_DRAIN_GRACE`]'s bounded
    /// wait never truncates a large, entirely legitimate payload with no
    /// grandchild involved at all. 9,000,000 bytes is deliberately just
    /// under the real production [`super::GIT_EXEC_OUTPUT_CAP_BYTES`]
    /// ceiling (10,000,000) — the exact shape the grace window must never
    /// interfere with in ordinary operation.
    #[test]
    fn large_legitimate_output_is_captured_in_full_without_truncation() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let script_path = scripts.path().join("large-diff-external.sh");
        write_executable_script(&script_path, "head -c 9000000 /dev/zero");

        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();
        raw_git_ok(
            repo.path(),
            &["config", "diff.external", script_path.to_str().unwrap()],
        );

        let cancel = AtomicBool::new(false);
        let start = std::time::Instant::now();
        let output = run_git_with_limits_for_test(
            repo.path(),
            &["diff".to_owned()],
            GitExecMode::BackgroundRead,
            &cancel,
            Duration::from_secs(30),
            10_000_000,
        )
        .expect("a large but under-cap legitimate payload must succeed");
        let elapsed = start.elapsed();
        assert_eq!(output.exit_code, 0);
        assert_eq!(
            output.stdout.len(),
            9_000_000,
            "the full legitimate payload must be captured, not truncated by the bounded \
             reader-join grace period"
        );
        eprintln!(
            "large_legitimate_output_is_captured_in_full_without_truncation: 9,000,000 bytes \
             drained in {elapsed:?} (no grandchild involved)"
        );
    }
}

// ---------------------------------------------------------------------
// `F080` S4: `GitExecMode::Network` hardening evidence — SSH agent
// passthrough, the `GIT_ASKPASS`/credential-helper precedence claim (verified
// empirically, not asserted from memory — see `harden_network`'s own doc
// comment), the repository's own `pre-push` hook being allowed to fire (the
// direct network-mode analogue of `hostile_fixtures`'s
// `write_mode_allows_the_repositorys_own_hooks_path_hook_to_fire`), and this
// mode's own longer timeout/cancellation. `#[cfg(unix)]` for the same reason
// as `hostile_fixtures`: every test here configures an executable shell
// script (hook, `core.sshCommand`, credential helper, or `core.askPass`) and
// depends on POSIX shebang execution and executable permission bits.
// ---------------------------------------------------------------------

#[cfg(unix)]
mod network_mode_fixtures {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn write_executable_script(path: &Path, body: &str) {
        let mut file = std::fs::File::create(path).expect("create script file");
        file.write_all(format!("#!/bin/sh\n{body}\n").as_bytes())
            .expect("write script body");
        drop(file);
        let mut perms = std::fs::metadata(path)
            .expect("script metadata")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).expect("chmod script executable");
    }

    /// A fake `ssh` replacement (`core.sshCommand` fully substitutes for the
    /// real `ssh` binary — git execs it directly with the connection
    /// arguments, no DNS lookup or real network I/O ever happens) that
    /// records whatever `SSH_AUTH_SOCK` it sees in its own environment to
    /// `marker`, then fails (there is no real remote at
    /// `ssh://git@example.invalid`) — exactly the technique
    /// `docs/research/2026-07-25-core-git.md`'s S4 section and this slice's
    /// own report describe for proving env passthrough reaches a real `git`
    /// subprocess without any actual network access.
    fn fake_ssh_recording_auth_sock(scripts_dir: &Path, marker: &Path) -> PathBuf {
        let script_path = scripts_dir.join("fake-ssh.sh");
        write_executable_script(
            &script_path,
            &format!(
                "echo \"SSH_AUTH_SOCK=$SSH_AUTH_SOCK\" > '{}'\nexit 1",
                marker.display()
            ),
        );
        script_path
    }

    fn repo_with_fake_ssh_remote(marker: &Path) -> (TempDir, TempDir) {
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let script = fake_ssh_recording_auth_sock(scripts.path(), marker);
        raw_git_ok(
            repo.path(),
            &[
                "remote",
                "add",
                "origin",
                "ssh://git@example.invalid/repo.git",
            ],
        );
        raw_git_ok(
            repo.path(),
            &["config", "core.sshCommand", script.to_str().unwrap()],
        );
        (repo, scripts)
    }

    #[test]
    fn ssh_auth_sock_reaches_a_real_git_subprocess_via_core_ssh_command() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        with_env_vars(
            &[("SSH_AUTH_SOCK", Some("/tmp/plain-test-marker-sock"))],
            || {
                let marker_dir = TempDir::new().expect("tempdir");
                let marker = marker_dir.path().join("ssh-auth-sock-seen");
                let (repo, _scripts) = repo_with_fake_ssh_remote(&marker);

                let cancel = AtomicBool::new(false);
                // The fetch itself always fails — `fake-ssh.sh` exits 1 and there
                // is no real remote — this test only cares about what
                // environment actually reached the subprocess `core.sshCommand`
                // invoked, proven by the marker file it writes.
                let _ = run_git(
                    repo.path(),
                    &["fetch".to_owned(), "origin".to_owned()],
                    GitExecMode::Network,
                    &cancel,
                );
                let recorded = std::fs::read_to_string(&marker).expect("marker file written");
                assert_eq!(recorded.trim(), "SSH_AUTH_SOCK=/tmp/plain-test-marker-sock");
            },
        );
    }

    /// Companion/control to the test above (same fixture, opposite ambient
    /// state): with no `SSH_AUTH_SOCK` in the environment at all, the fake
    /// `ssh` replacement must see it genuinely absent — proving the
    /// passthrough is conditional on ambient presence (matching
    /// `harden_background_read`/`harden_write`'s existing `PATH`/`HOME`
    /// passthrough pattern), not a hard-coded or invented value.
    #[test]
    fn network_mode_does_not_invent_an_ssh_auth_sock_when_ambient_env_has_none() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        with_env_vars(&[("SSH_AUTH_SOCK", None)], || {
            let marker_dir = TempDir::new().expect("tempdir");
            let marker = marker_dir.path().join("ssh-auth-sock-seen");
            let (repo, _scripts) = repo_with_fake_ssh_remote(&marker);

            let cancel = AtomicBool::new(false);
            let _ = run_git(
                repo.path(),
                &["fetch".to_owned(), "origin".to_owned()],
                GitExecMode::Network,
                &cancel,
            );
            let recorded = std::fs::read_to_string(&marker).expect("marker file written");
            assert_eq!(recorded.trim(), "SSH_AUTH_SOCK=");
        });
    }

    fn credential_helper_full(scripts_dir: &Path) -> PathBuf {
        let script_path = scripts_dir.join("cred-helper-full.sh");
        write_executable_script(
            &script_path,
            "echo username=bot\necho password=secret-from-helper",
        );
        script_path
    }

    fn credential_helper_partial(scripts_dir: &Path) -> PathBuf {
        let script_path = scripts_dir.join("cred-helper-partial.sh");
        write_executable_script(&script_path, "echo username=bot");
        script_path
    }

    /// A hostile `core.askPass` marker: touches `marker` and (unlike
    /// `hostile_fixtures::marker_script`) always exits *zero* with a
    /// plausible password line — so if it does fire, `git credential fill`
    /// completes rather than failing on the helper's own exit code, keeping
    /// "did it fire" (the marker file) and "did the whole command fail"
    /// independently observable.
    fn hostile_askpass_marker(scripts_dir: &Path, marker: &Path) -> PathBuf {
        let script_path = scripts_dir.join("askpass-marker.sh");
        write_executable_script(
            &script_path,
            &format!(
                "touch '{}'\necho password-from-hostile-askpass",
                marker.display()
            ),
        );
        script_path
    }

    /// Empirical control proving the fixture below is real: with **no**
    /// `GIT_ASKPASS` environment override at all (i.e. relying only on
    /// `GIT_TERMINAL_PROMPT=0`, exactly the gap this slice's report found), a
    /// hostile `core.askPass` **does** fire when the configured
    /// `credential.helper` supplies an incomplete credential (username only).
    /// This is the same category of attack `hostile_fixtures`'s
    /// `core.hooksPath`/`core.fsmonitor` fixtures already establish for other
    /// config keys — a malicious *repository* setting `core.askPass` to an
    /// exfiltration script — proven directly against the real `git 2.50.1`
    /// binary via `git credential fill` (no network involved).
    #[test]
    fn control_hostile_core_askpass_fires_without_a_git_askpass_override() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("askpass-fired");
        let helper = credential_helper_partial(scripts.path());
        let askpass = hostile_askpass_marker(scripts.path(), &marker);
        raw_git_ok(
            repo.path(),
            &["config", "credential.helper", helper.to_str().unwrap()],
        );
        raw_git_ok(
            repo.path(),
            &["config", "core.askPass", askpass.to_str().unwrap()],
        );

        assert!(!marker.exists());
        let output = Command::new("git")
            .current_dir(repo.path())
            .args(["credential", "fill"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .env_remove("GIT_ASKPASS")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write as _;
                child
                    .stdin
                    .take()
                    .expect("stdin piped")
                    .write_all(b"protocol=https\nhost=example.invalid\n")?;
                child.wait_with_output()
            })
            .expect("raw git credential fill spawns");
        assert!(output.status.success());
        assert!(
            marker.exists(),
            "control run must prove the hostile core.askPass fires when GIT_ASKPASS is unset \
             and the credential helper is incomplete"
        );
    }

    /// The hardened contrast to the control above: under
    /// [`GitExecMode::Network`], the same incomplete `credential.helper` +
    /// hostile `core.askPass` must **not** let the hostile script fire —
    /// `GIT_ASKPASS` pinned to the reject program takes precedence over
    /// `core.askPass` and fails the credential lookup cleanly instead.
    #[test]
    fn network_mode_git_askpass_blocks_a_hostile_core_askpass_when_credential_helper_is_incomplete()
    {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("askpass-fired");
        let helper = credential_helper_partial(scripts.path());
        let askpass = hostile_askpass_marker(scripts.path(), &marker);
        raw_git_ok(
            repo.path(),
            &["config", "credential.helper", helper.to_str().unwrap()],
        );
        raw_git_ok(
            repo.path(),
            &["config", "core.askPass", askpass.to_str().unwrap()],
        );

        assert!(!marker.exists());
        let cancel = AtomicBool::new(false);
        let output = run_git_with_stdin(
            repo.path(),
            &["credential".to_owned(), "fill".to_owned()],
            GitExecMode::Network,
            &cancel,
            b"protocol=https\nhost=example.invalid\n",
        )
        .expect("run_git_with_stdin itself succeeds even though git's own exit is non-zero");
        assert_ne!(
            output.exit_code, 0,
            "the credential lookup must fail cleanly, not hang or succeed with a hostile password"
        );
        assert!(
            !marker.exists(),
            "GitExecMode::Network's GIT_ASKPASS override must prevent the hostile core.askPass \
             from ever firing — this is the direct contrast with the control test above"
        );
    }

    /// Proves the other half of the claim in [`super::super::harden_network`]'s
    /// doc comment: when the configured `credential.helper` fully supplies a
    /// credential (both `username` and `password`), askpass — hostile or
    /// not — is never consulted at all, and the helper's own credential is
    /// what `git credential fill` reports. This is the "credential helpers
    /// are allowed to run and work normally" half of network-mode hardening;
    /// the two tests above are the "a hostile askpass config cannot bypass
    /// that" half.
    #[test]
    fn network_mode_never_invokes_askpass_when_credential_helper_fully_supplies_credentials() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let repo = init_repo();
        let scripts = TempDir::new().expect("tempdir");
        let marker = scripts.path().join("askpass-fired");
        let helper = credential_helper_full(scripts.path());
        let askpass = hostile_askpass_marker(scripts.path(), &marker);
        raw_git_ok(
            repo.path(),
            &["config", "credential.helper", helper.to_str().unwrap()],
        );
        raw_git_ok(
            repo.path(),
            &["config", "core.askPass", askpass.to_str().unwrap()],
        );

        assert!(!marker.exists());
        let cancel = AtomicBool::new(false);
        let output = run_git_with_stdin(
            repo.path(),
            &["credential".to_owned(), "fill".to_owned()],
            GitExecMode::Network,
            &cancel,
            b"protocol=https\nhost=example.invalid\n",
        )
        .expect("run_git_with_stdin succeeds");
        assert_eq!(output.exit_code, 0);
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("username=bot"));
        assert!(stdout.contains("password=secret-from-helper"));
        assert!(
            !marker.exists(),
            "a fully-satisfying credential.helper response must mean askpass is never invoked, \
             hostile or not"
        );
    }

    /// Direct network-mode analogue of
    /// `hostile_fixtures::write_mode_allows_the_repositorys_own_hooks_path_hook_to_fire`:
    /// a real (local, non-network) push to a real bare "remote" must let the
    /// repository's own configured `pre-push` hook fire — ADR 0003's "用户
    /// 显式写/网络操作才放行 hooks" applies to network mode exactly as it does to
    /// write mode.
    #[test]
    fn network_mode_allows_the_repositorys_own_pre_push_hook_to_fire() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let remote = TempDir::new().expect("tempdir");
        raw_git_ok(remote.path(), &["init", "--quiet", "--bare"]);

        let repo = init_repo();
        std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
        raw_git_ok(repo.path(), &["add", "a.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
        raw_git_ok(
            repo.path(),
            &[
                "remote",
                "add",
                "origin",
                remote.path().to_str().expect("utf8 tempdir path"),
            ],
        );

        let scripts = TempDir::new().expect("tempdir");
        let hooks_dir = scripts.path().join("hooks");
        std::fs::create_dir_all(&hooks_dir).expect("create hooks dir");
        let marker = scripts.path().join("pre-push-fired");
        write_executable_script(
            &hooks_dir.join("pre-push"),
            &format!("touch '{}'", marker.display()),
        );
        raw_git_ok(
            repo.path(),
            &["config", "core.hooksPath", hooks_dir.to_str().unwrap()],
        );

        assert!(!marker.exists());
        let cancel = AtomicBool::new(false);
        let output = run_git(
            repo.path(),
            &[
                "push".to_owned(),
                "origin".to_owned(),
                "HEAD:refs/heads/main".to_owned(),
            ],
            GitExecMode::Network,
            &cancel,
        )
        .expect("network-mode push to a local bare remote still succeeds");
        assert_eq!(output.exit_code, 0);
        assert!(
            marker.exists(),
            "GitExecMode::Network must respect the repository's own core.hooksPath pre-push hook"
        );
    }

    #[test]
    fn network_mode_can_be_cancelled_and_reports_cancelled() {
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let scripts = TempDir::new().expect("tempdir");
        let script_path = scripts.path().join("slow-ssh.sh");
        write_executable_script(&script_path, "sleep 5\nexit 1");
        let repo = init_repo();
        raw_git_ok(
            repo.path(),
            &[
                "remote",
                "add",
                "origin",
                "ssh://git@example.invalid/repo.git",
            ],
        );
        raw_git_ok(
            repo.path(),
            &["config", "core.sshCommand", script_path.to_str().unwrap()],
        );

        let repo_path = repo.path().to_path_buf();
        let cancel = AtomicBool::new(false);
        std::thread::scope(|scope| {
            let handle = scope.spawn(|| {
                run_git_network_with_limits_for_test(
                    &repo_path,
                    &["fetch".to_owned(), "origin".to_owned()],
                    &cancel,
                    Duration::from_secs(30),
                    10_000_000,
                )
            });
            std::thread::sleep(Duration::from_millis(200));
            cancel.store(true, Ordering::SeqCst);
            let result = handle.join().expect("worker thread does not panic");
            let error = result.expect_err("a cancelled invocation must be an error");
            assert_eq!(error.code(), "GIT_EXEC_CANCELLED");
        });
    }

    /// Renamed from `network_mode_uses_its_own_longer_timeout_not_the_local_
    /// ceiling` (this slice's evidence-accuracy review flagged the old name
    /// as overselling what the body actually proves): the body below only
    /// ever exercises an *injected* short timeout via
    /// [`run_git_network_with_limits_for_test`], which never touches
    /// [`GIT_EXEC_TIMEOUT`]/[`GIT_EXEC_NETWORK_TIMEOUT`] at all — it does
    /// not, by itself, compare Network mode's real default timeout against
    /// the shorter local-mode ceiling. This version keeps that generic
    /// timeout-mechanism proof (Network mode's `wait_with_limits` path
    /// genuinely honors whatever timeout it's given) and adds the actual,
    /// previously-missing comparison as a direct constant assertion —
    /// `GIT_EXEC_NETWORK_TIMEOUT` (300s) really is longer than
    /// `GIT_EXEC_TIMEOUT` (30s), the concrete claim the old name made
    /// without ever checking it.
    #[test]
    fn network_mode_accepts_an_injected_timeout_and_its_real_default_is_longer_than_the_local_ceiling(
    ) {
        assert!(
            GIT_EXEC_NETWORK_TIMEOUT > GIT_EXEC_TIMEOUT,
            "GitExecMode::Network's default timeout must genuinely be longer than every other \
             mode's — GIT_EXEC_NETWORK_TIMEOUT={GIT_EXEC_NETWORK_TIMEOUT:?}, \
             GIT_EXEC_TIMEOUT={GIT_EXEC_TIMEOUT:?}"
        );
        if !git_available() {
            eprintln!("skipping: git not found on PATH");
            return;
        }
        let scripts = TempDir::new().expect("tempdir");
        let script_path = scripts.path().join("slow-ssh.sh");
        write_executable_script(&script_path, "sleep 5\nexit 1");
        let repo = init_repo();
        raw_git_ok(
            repo.path(),
            &[
                "remote",
                "add",
                "origin",
                "ssh://git@example.invalid/repo.git",
            ],
        );
        raw_git_ok(
            repo.path(),
            &["config", "core.sshCommand", script_path.to_str().unwrap()],
        );

        let cancel = AtomicBool::new(false);
        let error = run_git_network_with_limits_for_test(
            repo.path(),
            &["fetch".to_owned(), "origin".to_owned()],
            &cancel,
            Duration::from_millis(150),
            10_000_000,
        )
        .expect_err(
            "a slow network invocation must still time out under an injected short ceiling",
        );
        assert_eq!(error.code(), "GIT_EXEC_TIMEOUT");
    }
}
