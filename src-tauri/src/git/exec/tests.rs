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
    run_git, run_git_with_limits_for_test, run_git_with_stdin,
    run_git_with_stdin_and_limits_for_test, GitExecMode,
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
fn network_mode_is_rejected_without_spawning() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let cancel = AtomicBool::new(false);
    let error = run_git(
        repo.path(),
        &["status".to_owned()],
        GitExecMode::Network,
        &cancel,
    )
    .expect_err("Network mode is not implemented in F080 S0");
    assert_eq!(error.code(), "GIT_EXEC_MODE_UNSUPPORTED");
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

    /// Scope note: unlike the four vectors above, a malicious
    /// `credential.helper`/`core.sshCommand` cannot be forced to fire
    /// through this slice's actual command surface at all — `status`/
    /// `diff`/`rev-parse` never touch a remote or ask for credentials
    /// regardless of hardening (confirmed empirically: they do not fire
    /// even *without* any override), and the one git mode that *would*
    /// touch a remote (`GitExecMode::Network`) is deliberately stubbed to
    /// always fail closed without spawning in this slice (see
    /// `network_mode_is_rejected_without_spawning`). This test therefore
    /// proves the narrower, still-real claim: with both configured
    /// maliciously, this domain's actual background-read command surface
    /// never invokes either. Exercising `GIT_TERMINAL_PROMPT`/`GIT_ASKPASS`
    /// against a genuine credential negotiation is deferred to the slice
    /// that implements fetch/pull/push.
    #[test]
    fn background_read_never_reaches_a_malicious_credential_helper_or_ssh_command() {
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
}
