//! `repo::resolve_repo_toplevel` contract tests — trust is checked first
//! and hard-fails (unlike `discovery::discover_repository`'s own soft
//! untrusted branch), and a trusted non-repository root reports
//! `GIT_NO_REPOSITORY` rather than propagating `discover_repository`'s
//! `Confirmed { toplevel: None }` as a distinct shape.

use std::future::Future;
use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::resolve_repo_toplevel;
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

fn block_on<F: Future>(future: F) -> F::Output {
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

fn workspace_with_root(window_label: &str, root_path: &Path) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root_path.to_path_buf()],
    };
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .status()
        .is_ok_and(|status| status.success())
}

fn init_real_repo(dir: &Path) {
    let run = |args: &[&str]| {
        let status = Command::new("git")
            .current_dir(dir)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .status()
            .expect("git fixture command spawns");
        assert!(
            status.success(),
            "git {args:?} must succeed in fixture setup"
        );
    };
    run(&["init", "--quiet"]);
    run(&["config", "user.email", "plain-test@example.invalid"]);
    run(&["config", "user.name", "Plain Test"]);
}

#[test]
fn an_untrusted_workspace_is_rejected_before_ever_spawning() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(resolve_repo_toplevel(&trust, &workspace, "main"))
        .expect_err("an untrusted workspace must be rejected");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn the_empty_workspace_is_rejected_as_not_trusted_before_looking_at_roots() {
    let workspace = WorkspaceService::new();
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(resolve_repo_toplevel(&trust, &workspace, "main"))
        .expect_err("the EMPTY workspace has nothing to grant trust to");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn a_trusted_non_repository_root_reports_git_no_repository() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");

    let error = block_on(resolve_repo_toplevel(&trust, &workspace, "main"))
        .expect_err("a plain directory is not a repository");
    assert_eq!(error.code(), "GIT_NO_REPOSITORY");
}

#[test]
fn a_trusted_repository_root_resolves_to_its_canonical_toplevel() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let root = TempDir::new().unwrap();
    init_real_repo(root.path());
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");

    let toplevel = block_on(resolve_repo_toplevel(&trust, &workspace, "main"))
        .expect("a real repository resolves");
    assert_eq!(toplevel, std::fs::canonicalize(root.path()).unwrap());
}
