use std::path::Path;
use std::process::{Command, Output};

use tempfile::TempDir;

use super::{
    add_remote, create_branch, create_tag, delete_branch, delete_tag, remove_remote, rename_branch,
    rename_remote, set_remote_url, set_upstream, switch_branch, unset_upstream,
    BranchDeleteOutcome, RemoteUrlKind,
};
use crate::git::remote::list_remotes;
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

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .status()
        .is_ok_and(|status| status.success())
}

fn raw_git_output(dir: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap()
}

fn raw_git(dir: &Path, args: &[&str]) {
    let output = raw_git_output(dir, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn raw_git_text(dir: &Path, args: &[&str]) -> String {
    let output = raw_git_output(dir, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn init_repo() -> TempDir {
    let repo = TempDir::new().unwrap();
    raw_git(repo.path(), &["init", "--quiet", "-b", "main"]);
    raw_git(repo.path(), &["config", "user.name", "Plain Test"]);
    raw_git(
        repo.path(),
        &["config", "user.email", "plain@example.invalid"],
    );
    std::fs::write(repo.path().join("tracked.txt"), b"initial\n").unwrap();
    raw_git(repo.path(), &["add", "tracked.txt"]);
    raw_git(repo.path(), &["commit", "--quiet", "-m", "initial"]);
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
fn branch_create_switch_rename_and_confirmed_force_delete_are_real() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let head = raw_git_text(repo.path(), &["rev-parse", "HEAD"]);
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());

    block_on(create_branch(
        &trust,
        &workspace,
        "main",
        "topic/nested",
        &head,
    ))
    .unwrap();
    block_on(switch_branch(&trust, &workspace, "main", "topic/nested")).unwrap();
    block_on(rename_branch(
        &trust,
        &workspace,
        "main",
        "topic/nested",
        "renamed",
    ))
    .unwrap();
    assert_eq!(
        raw_git_text(repo.path(), &["branch", "--show-current"]),
        "renamed"
    );

    let error = block_on(delete_branch(&trust, &workspace, "main", "renamed", true)).unwrap_err();
    assert_eq!(error.code(), "GIT_BRANCH_IS_CURRENT");

    std::fs::write(repo.path().join("topic.txt"), b"topic\n").unwrap();
    raw_git(repo.path(), &["add", "topic.txt"]);
    raw_git(repo.path(), &["commit", "--quiet", "-m", "topic"]);
    block_on(switch_branch(&trust, &workspace, "main", "main")).unwrap();
    assert_eq!(
        block_on(delete_branch(&trust, &workspace, "main", "renamed", false,)).unwrap(),
        BranchDeleteOutcome::NeedsForce
    );
    assert_eq!(
        block_on(delete_branch(&trust, &workspace, "main", "renamed", true,)).unwrap(),
        BranchDeleteOutcome::Deleted
    );
    assert!(!raw_git_output(
        repo.path(),
        &["show-ref", "--verify", "--quiet", "refs/heads/renamed"]
    )
    .status
    .success());
}

#[test]
fn branch_switch_reports_local_changes_that_would_be_overwritten() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let first = raw_git_text(repo.path(), &["rev-parse", "HEAD"]);
    raw_git(repo.path(), &["branch", "alternate", &first]);
    std::fs::write(repo.path().join("tracked.txt"), b"main committed\n").unwrap();
    raw_git(repo.path(), &["commit", "--quiet", "-am", "main change"]);
    std::fs::write(repo.path().join("tracked.txt"), b"dirty local\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let error = block_on(switch_branch(&trust, &workspace, "main", "alternate")).unwrap_err();
    assert_eq!(error.code(), "GIT_BRANCH_SWITCH_WOULD_OVERWRITE");
    assert_eq!(
        raw_git_text(repo.path(), &["branch", "--show-current"]),
        "main"
    );
    assert_eq!(
        std::fs::read(repo.path().join("tracked.txt")).unwrap(),
        b"dirty local\n"
    );
}

#[test]
fn lightweight_and_annotated_tags_use_exact_commit_targets_and_delete_cleanly() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let head = raw_git_text(repo.path(), &["rev-parse", "HEAD"]);
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());

    block_on(create_tag(
        &trust, &workspace, "main", "v1/light", &head, None,
    ))
    .unwrap();
    block_on(create_tag(
        &trust,
        &workspace,
        "main",
        "v1/annotated",
        &head,
        Some("release\nbody"),
    ))
    .unwrap();
    assert_eq!(
        raw_git_text(repo.path(), &["cat-file", "-t", "refs/tags/v1/light"]),
        "commit"
    );
    assert_eq!(
        raw_git_text(repo.path(), &["cat-file", "-t", "refs/tags/v1/annotated"]),
        "tag"
    );
    assert_eq!(
        raw_git_text(
            repo.path(),
            &[
                "for-each-ref",
                "--format=%(contents)",
                "refs/tags/v1/annotated"
            ]
        ),
        "release\nbody"
    );
    block_on(delete_tag(&trust, &workspace, "main", "v1/annotated")).unwrap();
    block_on(delete_tag(&trust, &workspace, "main", "v1/light")).unwrap();
}

#[test]
fn remote_workflow_redacts_credentials_and_removes_tracking_refs() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());

    block_on(add_remote(
        &trust,
        &workspace,
        "main",
        "origin",
        "https://token:secret@example.invalid/org/repo.git?private=yes",
    ))
    .unwrap();
    raw_git(
        repo.path(),
        &["update-ref", "refs/remotes/origin/main", "HEAD"],
    );
    block_on(set_remote_url(
        &trust,
        &workspace,
        "main",
        "origin",
        RemoteUrlKind::Push,
        "ssh://user@example.invalid/org/repo.git",
    ))
    .unwrap();
    block_on(rename_remote(
        &trust, &workspace, "main", "origin", "upstream",
    ))
    .unwrap();
    block_on(set_remote_url(
        &trust,
        &workspace,
        "main",
        "upstream",
        RemoteUrlKind::Fetch,
        "https://new-token@example.invalid/new/repo.git#secret",
    ))
    .unwrap();

    let remotes = block_on(list_remotes(&trust, &workspace, "main")).unwrap();
    assert_eq!(remotes.entries.len(), 1);
    assert_eq!(remotes.entries[0].name, "upstream");
    assert_eq!(
        remotes.entries[0].fetch_urls,
        ["https://<redacted>@example.invalid/new/repo.git?<redacted>"]
    );
    assert_eq!(
        remotes.entries[0].push_urls,
        ["ssh://<redacted>@example.invalid/org/repo.git"]
    );

    block_on(remove_remote(&trust, &workspace, "main", "upstream")).unwrap();
    assert!(block_on(list_remotes(&trust, &workspace, "main"))
        .unwrap()
        .entries
        .is_empty());
    assert!(!raw_git_output(
        repo.path(),
        &[
            "show-ref",
            "--verify",
            "--quiet",
            "refs/remotes/upstream/main"
        ]
    )
    .status
    .success());
}

#[test]
fn upstream_can_only_be_set_to_a_live_configured_remote_tracking_ref() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let head = raw_git_text(repo.path(), &["rev-parse", "HEAD"]);
    raw_git(
        repo.path(),
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    );
    raw_git(
        repo.path(),
        &["update-ref", "refs/remotes/origin/main", &head],
    );
    raw_git(repo.path(), &["branch", "topic", &head]);
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());

    block_on(set_upstream(
        &trust,
        &workspace,
        "main",
        "topic",
        "origin/main",
    ))
    .unwrap();
    assert_eq!(
        raw_git_text(
            repo.path(),
            &[
                "for-each-ref",
                "--format=%(upstream:short)",
                "refs/heads/topic"
            ]
        ),
        "origin/main"
    );
    block_on(unset_upstream(&trust, &workspace, "main", "topic")).unwrap();
    assert_eq!(
        raw_git_text(
            repo.path(),
            &["for-each-ref", "--format=%(upstream)", "refs/heads/topic"]
        ),
        ""
    );

    let error = block_on(set_upstream(
        &trust,
        &workspace,
        "main",
        "topic",
        "origin/missing",
    ))
    .unwrap_err();
    assert_eq!(error.code(), "GIT_UPSTREAM_NOT_FOUND");
    let error = block_on(unset_upstream(&trust, &workspace, "main", "topic")).unwrap_err();
    assert_eq!(error.code(), "GIT_UPSTREAM_NOT_CONFIGURED");
}

#[test]
fn validators_reject_namespace_forgery_controls_and_non_commit_targets_without_writes() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let blob = raw_git_text(repo.path(), &["hash-object", "tracked.txt"]);
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());

    for (name, code) in [
        ("refs/tags/forged", "GIT_BRANCH_NAME_INVALID"),
        ("-option", "GIT_BRANCH_NAME_INVALID"),
        ("bad\nname", "GIT_BRANCH_NAME_INVALID"),
    ] {
        let error = block_on(create_branch(
            &trust,
            &workspace,
            "main",
            name,
            &"0".repeat(40),
        ))
        .unwrap_err();
        assert_eq!(error.code(), code);
    }
    let error = block_on(create_branch(
        &trust,
        &workspace,
        "main",
        "from-blob",
        &blob,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "GIT_MANAGEMENT_COMMIT_INVALID");
    let error = block_on(create_tag(
        &trust,
        &workspace,
        "main",
        "tag",
        &"0".repeat(40),
        Some("   "),
    ))
    .unwrap_err();
    assert_eq!(error.code(), "GIT_TAG_MESSAGE_INVALID");
    let error = block_on(add_remote(
        &trust,
        &workspace,
        "main",
        "nested/name",
        "https://example.invalid/repo.git",
    ))
    .unwrap_err();
    assert_eq!(error.code(), "GIT_REMOTE_NAME_INVALID");
    let error = block_on(add_remote(
        &trust,
        &workspace,
        "main",
        "safe",
        "https://example.invalid/repo.git\ncredential",
    ))
    .unwrap_err();
    assert_eq!(error.code(), "GIT_REMOTE_URL_INVALID");
    assert_eq!(
        raw_git_text(repo.path(), &["branch", "--format=%(refname)"]),
        "refs/heads/main"
    );
    assert_eq!(raw_git_text(repo.path(), &["remote"]), "");
}

#[test]
fn management_refuses_an_untrusted_workspace_before_any_mutation() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let head = raw_git_text(repo.path(), &["rev-parse", "HEAD"]);
    let workspace = WorkspaceService::new();
    block_on(workspace.pick_roots(
        "main",
        FakePicker(repo.path().to_path_buf()),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(create_branch(
        &trust,
        &workspace,
        "main",
        "never-created",
        &head,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
    assert!(!raw_git_output(
        repo.path(),
        &[
            "show-ref",
            "--verify",
            "--quiet",
            "refs/heads/never-created"
        ]
    )
    .status
    .success());
}
