//! `git::commit` contract tests (`F080` S3). Every fixture spawns a real
//! `git` binary. [`commit_runs_the_repositorys_own_pre_commit_hook`] is the
//! write-mode/background-read hook contrast this slice's report is built
//! around — see `exec::tests::hostile_fixtures::
//! write_mode_allows_the_repositorys_own_hooks_path_hook_to_fire` for the
//! lower-level, `exec`-only half of the same evidence.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::commit;
use crate::git::network::GitNetworkService;
use crate::remote::session::RemoteSessionService;
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<std::path::PathBuf>,
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn trusted_workspace(
    window_label: &str,
    root: &Path,
    trust_base: &Path,
) -> (WorkspaceService, TrustService) {
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root.to_path_buf()],
    };
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.to_path_buf());
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    (workspace, trust)
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .status()
        .is_ok_and(|status| status.success())
}

fn raw_git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git fixture command spawns")
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
    raw_git_ok(dir.path(), &["init", "--quiet", "-b", "main"]);
    raw_git_ok(
        dir.path(),
        &["config", "user.email", "plain-test@example.invalid"],
    );
    raw_git_ok(dir.path(), &["config", "user.name", "Plain Test"]);
    dir
}

fn last_commit_message(dir: &Path) -> String {
    let output = raw_git(dir, &["log", "-1", "--format=%B"]);
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned()
}

#[test]
fn commit_writes_a_message_supplied_over_stdin() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    // A message beginning with `-` — proves it travels over stdin, never a
    // command-line argument (which would otherwise be misread as a flag).
    block_on(commit(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        "-not-a-flag: message via stdin",
        false,
    ))
    .expect("commit succeeds");

    assert_eq!(
        last_commit_message(repo.path()),
        "-not-a-flag: message via stdin"
    );
}

#[test]
fn commit_amend_replaces_the_previous_message() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "original message"],
    );
    let original_head = raw_git(repo.path(), &["rev-parse", "HEAD"]);
    let original_oid = String::from_utf8_lossy(&original_head.stdout)
        .trim()
        .to_owned();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(commit(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        "amended message",
        true,
    ))
    .expect("amend commit succeeds");

    assert_eq!(last_commit_message(repo.path()), "amended message");
    let amended_head = raw_git(repo.path(), &["rev-parse", "HEAD"]);
    let amended_oid = String::from_utf8_lossy(&amended_head.stdout)
        .trim()
        .to_owned();
    assert_ne!(
        original_oid, amended_oid,
        "amend must produce a new commit oid, not append one"
    );
    let log_count = raw_git(repo.path(), &["log", "--oneline"]);
    assert_eq!(
        String::from_utf8_lossy(&log_count.stdout).lines().count(),
        1,
        "amend must not add a second commit"
    );
}

#[test]
fn commit_rejects_an_empty_message() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(commit(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        "   ",
        false,
    ))
    .expect_err("a whitespace-only message must be rejected");
    assert_eq!(error.code(), "GIT_COMMIT_EMPTY_MESSAGE");
}

#[test]
fn commit_reports_nothing_to_commit_when_no_changes_are_staged() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "init"],
    );
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(commit(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        "nothing staged",
        false,
    ))
    .expect_err("commit with nothing staged must fail");
    assert_eq!(error.code(), "GIT_COMMIT_NOTHING_TO_COMMIT");
}

/// The write-mode/background-read hook contrast at the full `commit::commit`
/// call level (see `exec::tests::hostile_fixtures::
/// write_mode_allows_the_repositorys_own_hooks_path_hook_to_fire` for the
/// lower-level `exec`-only half): a real `pre-commit` hook must actually run
/// and can actually block the commit (a non-zero-exit hook) — proving
/// `GitExecMode::Write` respects repository hooks all the way through this
/// domain function, not just at the raw `exec::run_git` layer.
#[test]
fn commit_runs_the_repositorys_own_pre_commit_hook() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    use std::io::Write as _;
    use std::os::unix::fs::PermissionsExt;

    let repo = init_repo();
    let hook_path = repo.path().join(".git/hooks/pre-commit");
    let marker_path = repo.path().join("pre-commit-fired");
    let mut hook_file = std::fs::File::create(&hook_path).unwrap();
    writeln!(hook_file, "#!/bin/sh").unwrap();
    writeln!(
        hook_file,
        "touch \"$(git rev-parse --show-toplevel)/pre-commit-fired\""
    )
    .unwrap();
    writeln!(hook_file, "exit 0").unwrap();
    drop(hook_file);
    let mut perms = std::fs::metadata(&hook_path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&hook_path, perms).unwrap();

    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    assert!(!marker_path.exists());
    block_on(commit(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        "hook test",
        false,
    ))
    .expect("commit succeeds with a well-behaved pre-commit hook");
    assert!(
        marker_path.exists(),
        "GitExecMode::Write must run the repository's own pre-commit hook"
    );
}

/// A `pre-commit` hook that exits non-zero must actually block the commit —
/// further proof the hook genuinely ran under real git semantics, not merely
/// that a marker file happened to appear.
#[test]
fn a_failing_pre_commit_hook_blocks_the_commit() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    use std::io::Write as _;
    use std::os::unix::fs::PermissionsExt;

    let repo = init_repo();
    let hook_path = repo.path().join(".git/hooks/pre-commit");
    let mut hook_file = std::fs::File::create(&hook_path).unwrap();
    writeln!(hook_file, "#!/bin/sh\nexit 1").unwrap();
    drop(hook_file);
    let mut perms = std::fs::metadata(&hook_path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&hook_path, perms).unwrap();

    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(commit(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        "should be blocked",
        false,
    ))
    .expect_err("a failing pre-commit hook must block the commit");
    assert_eq!(error.code(), "GIT_COMMIT_FAILED");

    let log = raw_git(repo.path(), &["log", "--oneline"]);
    assert!(
        String::from_utf8_lossy(&log.stdout).trim().is_empty(),
        "no commit must have been created"
    );
}

#[test]
fn commit_rejects_when_workspace_is_not_trusted() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(commit(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        "message",
        false,
    ))
    .expect_err("untrusted workspace must reject commit");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}
