use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{list_remotes, parse_remote_config, redact_remote_location};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    path: std::path::PathBuf,
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let path = self.path.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(vec![path])) })
    }
}

fn raw_git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
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
        FakePicker {
            path: repo.to_path_buf(),
        },
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let trust = TrustService::new(trust_base.to_path_buf());
    block_on(trust.grant(&workspace, "main")).unwrap();
    (workspace, trust)
}

#[test]
fn real_remote_inventory_preserves_names_and_redacts_secrets_and_local_paths() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    raw_git(
        repo.path(),
        &[
            "remote",
            "add",
            "origin",
            "https://token:secret@example.invalid/org/repo.git?access=private",
        ],
    );
    raw_git(
        repo.path(),
        &[
            "remote",
            "set-url",
            "--add",
            "--push",
            "origin",
            "git@example.invalid:org/repo.git",
        ],
    );
    raw_git(
        repo.path(),
        &["remote", "add", "local", repo.path().to_str().unwrap()],
    );
    raw_git(
        repo.path(),
        &[
            "config",
            "remote.empty.fetch",
            "+refs/heads/*:refs/remotes/empty/*",
        ],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let result = block_on(list_remotes(&trust, &workspace, "main")).unwrap();
    assert!(!result.truncated);

    let origin = result
        .entries
        .iter()
        .find(|entry| entry.name == "origin")
        .unwrap();
    assert_eq!(
        origin.fetch_urls,
        ["https://<redacted>@example.invalid/org/repo.git?<redacted>"]
    );
    assert_eq!(
        origin.push_urls,
        ["<redacted>@example.invalid:org/repo.git"]
    );
    let local = result
        .entries
        .iter()
        .find(|entry| entry.name == "local")
        .unwrap();
    assert_eq!(local.fetch_urls, ["<local-path>"]);
    assert!(result.entries.iter().any(|entry| entry.name == "empty"));
}

#[test]
fn remote_parser_rejects_records_without_the_audited_key_newline_value_shape() {
    let error =
        parse_remote_config(vec![b"origin".to_vec()], b"remote.origin.url=value\0").unwrap_err();
    assert_eq!(error.code(), "GIT_REMOTE_PARSE_FAILED");
}

#[test]
fn remote_parser_omits_empty_urls_but_keeps_the_named_remote() {
    let result = parse_remote_config(
        vec![b"origin".to_vec()],
        b"remote.origin.url\n\0remote.origin.pushurl\n\0",
    )
    .unwrap();
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].name, "origin");
    assert!(result.entries[0].fetch_urls.is_empty());
    assert!(result.entries[0].push_urls.is_empty());
}

#[test]
fn remote_redaction_handles_file_urls_windows_paths_and_plain_network_urls() {
    assert_eq!(
        redact_remote_location(b"file:///Users/private/repo"),
        "file://<local-path>"
    );
    assert_eq!(redact_remote_location(br"C:\private\repo"), "<local-path>");
    assert_eq!(
        redact_remote_location(b"ssh://example.invalid/org/repo.git"),
        "ssh://example.invalid/org/repo.git"
    );
}

#[test]
fn remote_inventory_refuses_an_untrusted_workspace_before_git_reads() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let workspace = WorkspaceService::new();
    block_on(workspace.pick_roots(
        "main",
        FakePicker {
            path: repo.path().to_path_buf(),
        },
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(list_remotes(&trust, &workspace, "main")).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}
