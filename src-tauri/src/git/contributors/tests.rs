use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{list_contributors, parse_contributors};
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

fn commit_as(repo: &Path, file: &str, name: &str, email: &str, message: &str) {
    std::fs::write(repo.join(file), format!("{message}\n")).unwrap();
    raw_git(repo, &["add", file]);
    raw_git(
        repo,
        &[
            "-c",
            &format!("user.name={name}"),
            "-c",
            &format!("user.email={email}"),
            "commit",
            "--quiet",
            "-m",
            message,
        ],
    );
}

#[test]
fn real_contributor_inventory_aggregates_and_sorts_by_commit_count() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    commit_as(
        repo.path(),
        "a.txt",
        "Alice",
        "alice@example.invalid",
        "one",
    );
    commit_as(repo.path(), "b.txt", "Bob", "bob@example.invalid", "two");
    commit_as(
        repo.path(),
        "c.txt",
        "Alice",
        "alice@example.invalid",
        "three",
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let result = block_on(list_contributors(&trust, &workspace, "main")).unwrap();
    assert!(!result.truncated);
    assert_eq!(result.entries.len(), 2);
    assert_eq!(result.entries[0].name, "Alice");
    assert_eq!(result.entries[0].email, "alice@example.invalid");
    assert_eq!(result.entries[0].commits, 2);
    assert_eq!(result.entries[1].commits, 1);
}

#[test]
fn contributor_parser_rejects_an_odd_number_of_nul_fields_and_reports_caps() {
    let error = parse_contributors(b"Alice\0", 10, 10).unwrap_err();
    assert_eq!(error.code(), "GIT_CONTRIBUTORS_PARSE_FAILED");

    let error = parse_contributors(b"Alice\0a@example.invalid", 10, 10).unwrap_err();
    assert_eq!(error.code(), "GIT_CONTRIBUTORS_PARSE_FAILED");

    let result =
        parse_contributors(b"Alice\0a@example.invalid\0Bob\0b@example.invalid\0", 1, 10).unwrap();
    assert!(result.truncated);
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].name, "Alice");
}

#[test]
fn contributor_parser_preserves_empty_fields_without_shifting_pairs() {
    let result = parse_contributors(b"\0unknown@example.invalid\0Named\0\0", 10, 10).unwrap();
    assert_eq!(result.entries.len(), 2);
    assert!(result
        .entries
        .iter()
        .any(|entry| entry.name.is_empty() && entry.email == "unknown@example.invalid"));
    assert!(result
        .entries
        .iter()
        .any(|entry| entry.name == "Named" && entry.email.is_empty()));
}

#[test]
fn an_initial_repository_has_no_contributors() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    assert_eq!(
        block_on(list_contributors(&trust, &workspace, "main")).unwrap(),
        Default::default()
    );
}
