//! `F220` S6 hermetic tests for `remote::remote_git` — a real `russh::server`
//! on loopback serving real `exec` requests forwarded to a real `sh -c`
//! (`test_support::GitExecFixture`), a real agent server, and this module's
//! own `run_remote_git`/`run_remote_git_for_test` client calls against a
//! real `git` repository. Nothing about the `exec` sequencing, the encoded
//! command line, or git's own output is mocked — see
//! `test_support::GitExecTestSshHandler`'s own doc comment for why forwarding
//! to a real shell (rather than mocking a fixed response) is this fixture's
//! chosen verification strategy.
//!
//! `git::remote_route::tests` is the sibling suite that exercises the full
//! six-routed-command pipeline (trust → route resolution → this module) end
//! to end; this file stays one layer lower, proving `run_remote_git` itself
//! — argv assembly, transport success/failure mapping, timeout, cancellation,
//! and the output cap — independent of anything `git::` owns.

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use crate::remote::session::RemoteSessionService;
use crate::remote::test_support::{self, GitExecFixture};

use super::{run_remote_git, run_remote_git_for_test, RemoteGitExecFailure, RemoteGitExecMode};

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

fn git_available() -> bool {
    std::process::Command::new("git")
        .arg("--version")
        .status()
        .is_ok_and(|status| status.success())
}

fn raw_git_ok(dir: &std::path::Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git fixture command spawns");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Initializes a real, minimal git repository directly inside `fixture`'s own
/// served directory — mirrors `git::status::tests`' `init_repo` exactly,
/// just targeting an already-provided directory instead of minting a fresh
/// `TempDir` of its own.
fn init_repo(fixture: &GitExecFixture) {
    raw_git_ok(fixture.repo_dir.path(), &["init", "--quiet", "-b", "main"]);
    raw_git_ok(
        fixture.repo_dir.path(),
        &["config", "user.email", "plain-test@example.invalid"],
    );
    raw_git_ok(
        fixture.repo_dir.path(),
        &["config", "user.name", "Plain Test"],
    );
}

/// The repository path this fixture's real `git -C <path> …` invocations
/// must agree with — canonicalized exactly like `std::fs::canonicalize`
/// would resolve it (mirrors `git::exec::build_git_command`'s own
/// canonicalization of `repo_dir` before spawning, and
/// `remote::remote_fs`'s own SFTP `realpath` re-validation for the same
/// underlying reason: this workspace's own macOS dev environment has a real
/// `/var` -> `/private/var` symlink, so an un-canonicalized `TempDir` path
/// would not byte-for-byte match what `git rev-parse --show-toplevel` itself
/// reports).
fn canonical_repo_path(fixture: &GitExecFixture) -> String {
    std::fs::canonicalize(fixture.repo_dir.path())
        .expect("repo dir canonicalizes")
        .to_string_lossy()
        .into_owned()
}

async fn connected_fixture(
    artificial_delay: Duration,
) -> (
    tempfile::TempDir,
    RemoteSessionService,
    GitExecFixture,
    crate::remote::dto::RemoteSessionId,
) {
    let base = tempfile::TempDir::new().unwrap();
    let service = RemoteSessionService::new(base.path().to_path_buf());
    let identity = test_support::generate_key();
    let fixture = test_support::start_git_exec_fixture(&identity, artificial_delay).await;
    let session_id = test_support::connect_git_exec_test_session(&service, "main", &fixture).await;
    (base, service, fixture, session_id)
}

// --- `build_argv` (pure) ----------------------------------------------------

#[test]
fn build_argv_for_background_read_carries_the_exact_audited_overrides() {
    let argv = super::build_argv(
        "/srv/repo",
        RemoteGitExecMode::BackgroundRead,
        &["status".to_owned(), "--porcelain=v2".to_owned()],
    );
    assert_eq!(
        argv,
        vec![
            "env",
            "GIT_LITERAL_PATHSPECS=1",
            "GIT_OPTIONAL_LOCKS=0",
            "GIT_TERMINAL_PROMPT=0",
            "GIT_ASKPASS=/usr/bin/false",
            "LANG=en_US.UTF-8",
            "LC_ALL=en_US.UTF-8",
            "git",
            "-C",
            "/srv/repo",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=",
            "status",
            "--porcelain=v2",
        ]
    );
}

#[test]
fn build_argv_for_write_omits_the_optional_locks_and_hooks_overrides() {
    let argv = super::build_argv(
        "/srv/repo",
        RemoteGitExecMode::Write,
        &["add".to_owned(), "-A".to_owned(), "--".to_owned()],
    );
    assert_eq!(
        argv,
        vec![
            "env",
            "GIT_LITERAL_PATHSPECS=1",
            "GIT_TERMINAL_PROMPT=0",
            "GIT_ASKPASS=/usr/bin/false",
            "LANG=en_US.UTF-8",
            "LC_ALL=en_US.UTF-8",
            "git",
            "-C",
            "/srv/repo",
            "add",
            "-A",
            "--",
        ]
    );
    assert!(
        !argv.contains(&"GIT_OPTIONAL_LOCKS=0".to_owned()),
        "GIT_OPTIONAL_LOCKS must not be overridden for a user-initiated write"
    );
    assert!(
        !argv.iter().any(|arg| arg.starts_with("core.hooksPath")),
        "hooks must not be neutralized for a user-initiated write"
    );
}

// --- Real transport, real git binary ---------------------------------------

#[test]
fn a_real_rev_parse_show_toplevel_round_trips_through_the_real_exec_channel() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture(Duration::ZERO).await;
        init_repo(&fixture);
        let repo_path = canonical_repo_path(&fixture);
        let cancel = AtomicBool::new(false);

        let outcome = run_remote_git(
            &service,
            "main",
            session_id,
            &repo_path,
            RemoteGitExecMode::BackgroundRead,
            &["rev-parse".to_owned(), "--show-toplevel".to_owned()],
            None,
            &cancel,
        )
        .await
        .expect("a real rev-parse succeeds over the exec channel");

        assert_eq!(outcome.exit_code, 0);
        let toplevel = String::from_utf8_lossy(&outcome.stdout)
            .trim_end_matches(['\n', '\r'])
            .to_owned();
        assert_eq!(toplevel, repo_path);
    });
}

#[test]
fn a_nonzero_git_exit_is_reported_as_data_not_a_transport_failure() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture(Duration::ZERO).await;
        init_repo(&fixture);
        let repo_path = canonical_repo_path(&fixture);
        let cancel = AtomicBool::new(false);

        // `git status` for an unknown flag exits non-zero with a usage
        // message on stderr — a real, meaningful outcome this module must
        // hand back as data (`RemoteGitExecOutcome`), not fail the transport.
        let outcome = run_remote_git(
            &service,
            "main",
            session_id,
            &repo_path,
            RemoteGitExecMode::BackgroundRead,
            &["status".to_owned(), "--this-flag-does-not-exist".to_owned()],
            None,
            &cancel,
        )
        .await
        .expect("the exec transport itself succeeds even though git exits non-zero");

        assert_ne!(outcome.exit_code, 0);
        assert!(!outcome.stderr.is_empty());
    });
}

#[test]
fn write_mode_stdin_reaches_a_real_git_commit_message() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture(Duration::ZERO).await;
        init_repo(&fixture);
        std::fs::write(fixture.repo_dir.path().join("file.txt"), b"content\n").unwrap();
        raw_git_ok(fixture.repo_dir.path(), &["add", "file.txt"]);
        let repo_path = canonical_repo_path(&fixture);
        let cancel = AtomicBool::new(false);

        let outcome = run_remote_git(
            &service,
            "main",
            session_id,
            &repo_path,
            RemoteGitExecMode::Write,
            &[
                "-c".to_owned(),
                "user.useConfigOnly=true".to_owned(),
                "commit".to_owned(),
                "--quiet".to_owned(),
                "--file".to_owned(),
                "-".to_owned(),
            ],
            Some(b"remote exec commit message"),
            &cancel,
        )
        .await
        .expect("commit over the exec channel succeeds");
        assert_eq!(
            outcome.exit_code,
            0,
            "commit failed: {}",
            String::from_utf8_lossy(&outcome.stderr)
        );

        let log = std::process::Command::new("git")
            .current_dir(fixture.repo_dir.path())
            .args(["log", "-1", "--format=%B"])
            .output()
            .expect("git log spawns");
        assert_eq!(
            String::from_utf8_lossy(&log.stdout).trim(),
            "remote exec commit message"
        );
    });
}

#[test]
fn output_exceeding_the_cap_fails_closed_instead_of_being_silently_truncated() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture(Duration::ZERO).await;
        init_repo(&fixture);
        // 11 MB — comfortably over the 10,000,000-byte cap.
        let big_content = vec![b'x'; 11_000_000];
        std::fs::write(fixture.repo_dir.path().join("big.bin"), &big_content).unwrap();
        raw_git_ok(fixture.repo_dir.path(), &["add", "big.bin"]);
        raw_git_ok(
            fixture.repo_dir.path(),
            &["commit", "--quiet", "-m", "big file"],
        );
        let repo_path = canonical_repo_path(&fixture);
        let cancel = AtomicBool::new(false);

        let result = run_remote_git(
            &service,
            "main",
            session_id,
            &repo_path,
            RemoteGitExecMode::BackgroundRead,
            &["show".to_owned(), "HEAD:big.bin".to_owned()],
            None,
            &cancel,
        )
        .await;

        assert_eq!(result, Err(RemoteGitExecFailure::OutputLimitExceeded));
    });
}

#[test]
fn a_session_id_that_no_longer_exists_reports_disconnected() {
    block_on(async {
        let base = tempfile::TempDir::new().unwrap();
        let service = RemoteSessionService::new(base.path().to_path_buf());
        let bogus_session_id = crate::remote::dto::RemoteSessionId::new();
        let cancel = AtomicBool::new(false);

        let result = run_remote_git(
            &service,
            "main",
            bogus_session_id,
            "/srv/repo",
            RemoteGitExecMode::BackgroundRead,
            &["status".to_owned()],
            None,
            &cancel,
        )
        .await;

        assert_eq!(result, Err(RemoteGitExecFailure::Disconnected));
    });
}

#[test]
fn a_small_client_timeout_wins_against_a_slow_remote_and_returns_promptly() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture(Duration::from_secs(5)).await;
        init_repo(&fixture);
        let repo_path = canonical_repo_path(&fixture);
        let cancel = AtomicBool::new(false);

        let start = std::time::Instant::now();
        let result = run_remote_git_for_test(
            &service,
            "main",
            session_id,
            &repo_path,
            RemoteGitExecMode::BackgroundRead,
            &["rev-parse".to_owned(), "--show-toplevel".to_owned()],
            None,
            &cancel,
            Duration::from_millis(150),
        )
        .await;
        let elapsed = start.elapsed();

        assert_eq!(result, Err(RemoteGitExecFailure::TimedOut));
        assert!(
            elapsed < Duration::from_secs(2),
            "a 150ms client timeout must return promptly, not wait out the fixture's 5s \
             artificial delay — took {elapsed:?}"
        );
    });
}

#[test]
fn a_cancel_flag_flipped_mid_call_wins_against_a_slow_remote_and_returns_promptly() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture(Duration::from_secs(5)).await;
        init_repo(&fixture);
        let repo_path = canonical_repo_path(&fixture);
        let cancel = std::sync::Arc::new(AtomicBool::new(false));

        let cancel_for_flip = std::sync::Arc::clone(&cancel);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            cancel_for_flip.store(true, std::sync::atomic::Ordering::SeqCst);
        });

        let start = std::time::Instant::now();
        let result = run_remote_git_for_test(
            &service,
            "main",
            session_id,
            &repo_path,
            RemoteGitExecMode::BackgroundRead,
            &["rev-parse".to_owned(), "--show-toplevel".to_owned()],
            None,
            &cancel,
            Duration::from_secs(30),
        )
        .await;
        let elapsed = start.elapsed();

        assert_eq!(result, Err(RemoteGitExecFailure::Cancelled));
        assert!(
            elapsed < Duration::from_secs(2),
            "cancellation must return promptly, not wait out the fixture's 5s artificial \
             delay or the 30s injected timeout — took {elapsed:?}"
        );
    });
}
