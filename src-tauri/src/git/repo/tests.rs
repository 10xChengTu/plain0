//! `repo::resolve_repo_toplevel` contract tests — trust is checked first
//! and hard-fails (unlike `discovery::discover_repository`'s own soft
//! untrusted branch), and a trusted non-repository root reports
//! `GIT_NO_REPOSITORY` rather than propagating `discover_repository`'s
//! `Confirmed { toplevel: None }` as a distinct shape.

use std::future::Future;
use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{resolve_repo_toplevel, SelectedGitRoot};
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

fn workspace_with_roots(window_label: &str, root_paths: &[&Path]) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: root_paths.iter().map(|path| path.to_path_buf()).collect(),
    };
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("roots authorize");
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

/// `F220` S2 (ADR 0007 §1 §5) representative test: a remote-backed
/// `rootId` fails closed with `ROOT_BACKEND_UNSUPPORTED` after trust already
/// passed (a local root's presence makes the whole-workspace identity
/// trusted — see `WorkspaceScope::stable_identity`'s own doc comment for why
/// a remote root does not perturb that local-only identity), proving the
/// two gates are genuinely independent: this is not merely an untrusted-
/// workspace rejection wearing a different label.
#[test]
fn an_explicit_remote_backed_root_fails_closed_after_trust_passes() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let remote_root_id = workspace
        .authorize_remote_root_for_test(
            "main",
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/srv/project",
            "Remote Project",
        )
        .expect("remote root registers for test");
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");

    let error = block_on(resolve_repo_toplevel(
        &trust,
        &SelectedGitRoot::new(&workspace, remote_root_id),
        "main",
    ))
    .expect_err("a remote-backed root must fail closed");
    assert_eq!(error.code(), "ROOT_BACKEND_UNSUPPORTED");
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

#[test]
fn an_implicit_multi_root_git_scope_fails_closed_instead_of_using_root_zero() {
    let first = TempDir::new().unwrap();
    let second = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_roots("main", &[first.path(), second.path()]);
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");

    let error = block_on(resolve_repo_toplevel(&trust, &workspace, "main"))
        .expect_err("a multi-root caller must identify the target root");
    assert_eq!(error.code(), "GIT_ROOT_REQUIRED");
}

#[test]
fn an_explicit_root_identity_resolves_the_matching_repository_in_a_multi_root_workspace() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let first = TempDir::new().unwrap();
    let second = TempDir::new().unwrap();
    init_real_repo(second.path());
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_roots("main", &[first.path(), second.path()]);
    let second_root_id = workspace.snapshot("main").unwrap().roots()[1].root_id();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let scope = SelectedGitRoot::new(&workspace, second_root_id);

    let toplevel = block_on(resolve_repo_toplevel(&trust, &scope, "main"))
        .expect("the selected second root resolves");
    assert_eq!(toplevel, std::fs::canonicalize(second.path()).unwrap());
}

#[test]
fn an_explicit_root_identity_from_another_window_is_not_authorized() {
    let main_root = TempDir::new().unwrap();
    let other_root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", main_root.path());
    let other_picker = FakePicker {
        paths: vec![other_root.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("other", other_picker, WorkspacePickRootsMode::Add))
        .expect("other-window root authorizes");
    let other_root_id = workspace.snapshot("other").unwrap().roots()[0].root_id();
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let scope = SelectedGitRoot::new(&workspace, other_root_id);

    let error = block_on(resolve_repo_toplevel(&trust, &scope, "main"))
        .expect_err("another window's root identity must fail closed");
    assert_eq!(error.code(), "ROOT_NOT_AUTHORIZED");
}

#[test]
fn a_repository_toplevel_above_the_selected_root_is_rejected() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repository = TempDir::new().unwrap();
    init_real_repo(repository.path());
    let child = repository.path().join("opened-child");
    std::fs::create_dir(&child).unwrap();
    let workspace = workspace_with_root("main", &child);
    let root_id = workspace.snapshot("main").unwrap().roots()[0].root_id();
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let scope = SelectedGitRoot::new(&workspace, root_id);

    let error = block_on(resolve_repo_toplevel(&trust, &scope, "main"))
        .expect_err("repository-wide Git access may not escape above the root");
    assert_eq!(error.code(), "GIT_REPOSITORY_OUTSIDE_ROOT");
}
