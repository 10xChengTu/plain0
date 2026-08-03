use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{list_reflog, parse_reflog};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker(std::path::PathBuf);

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let path = self.0.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(vec![path])) })
    }
}

fn raw_git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .status()
        .is_ok_and(|status| status.success())
}

fn init_repo() -> TempDir {
    let repo = TempDir::new().unwrap();
    raw_git(repo.path(), &["init", "--quiet", "-b", "main"]);
    raw_git(
        repo.path(),
        &["config", "user.email", "plain-test@example.invalid"],
    );
    raw_git(repo.path(), &["config", "user.name", "Plain Test"]);
    repo
}

fn trusted_workspace(repo: &Path, trust_base: &Path) -> (WorkspaceService, TrustService) {
    let workspace = WorkspaceService::new();
    block_on(workspace.pick_roots(
        "main",
        FakePicker(repo.to_path_buf()),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let trust = TrustService::new(trust_base.to_path_buf());
    block_on(trust.grant(&workspace, "main")).unwrap();
    (workspace, trust)
}

#[test]
fn real_reflog_is_newest_first_and_keeps_a_unit_separator_inside_the_summary() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git(repo.path(), &["add", "a.txt"]);
    raw_git(repo.path(), &["commit", "--quiet", "-m", "first"]);
    std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();
    raw_git(repo.path(), &["add", "a.txt"]);
    raw_git(
        repo.path(),
        &["commit", "--quiet", "-m", "second\u{1f}still-summary"],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let result = block_on(list_reflog(&trust, &workspace, "main")).unwrap();
    assert!(!result.truncated);
    assert!(result.entries.len() >= 2);
    assert_eq!(result.entries[0].selector, "HEAD@{0}");
    assert!(result.entries[0]
        .summary
        .contains("second\u{1f}still-summary"));
}

#[test]
fn an_initial_repository_has_an_empty_reflog_instead_of_a_parse_error() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    assert_eq!(
        block_on(list_reflog(&trust, &workspace, "main")).unwrap(),
        Default::default()
    );
}

#[test]
fn parser_redacts_a_clone_source_and_rejects_a_bad_sha() {
    let sha = b"0123456789abcdef0123456789abcdef01234567";
    let mut record = sha.to_vec();
    record.extend_from_slice(b"\x1fHEAD@{0}\x1f1\x1fclone: from /Users/private/repo\0");
    let result = parse_reflog(&record, 10).unwrap();
    assert_eq!(result.entries[0].summary, "clone: from <local-path>");

    let error = parse_reflog(b"bad\x1fHEAD@{0}\x1f1\x1fmessage\0", 10).unwrap_err();
    assert_eq!(error.code(), "GIT_REFLOG_PARSE_FAILED");
}
