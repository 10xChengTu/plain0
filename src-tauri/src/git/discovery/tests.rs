//! `discovery::discover_repository` contract tests: the untrusted
//! filesystem-marker-only branch (never spawns), the trusted
//! `git rev-parse --show-toplevel`-confirmed branch, workspace-root
//! authorization, and the marker walk's root-floor boundary.

use std::future::Future;
use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{discover_repository, RepositoryDiscovery};
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

impl FakePicker {
    fn selected(paths: Vec<std::path::PathBuf>) -> Self {
        Self { paths }
    }
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn workspace_with_root(window_label: &str, root_path: &Path) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(vec![root_path.to_path_buf()]);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

/// Authorizes and grants trust for `window_label` in one call — mirrors
/// `terminal::service::tests::trusted_workspace`'s exact precedent.
fn trusted_workspace(
    window_label: &str,
    root: &Path,
    trust_base: &Path,
) -> (WorkspaceService, TrustService) {
    let workspace = workspace_with_root(window_label, root);
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
fn an_untrusted_workspace_reports_the_filesystem_marker_without_ever_spawning() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    // A `.git` *file* is enough to count as a marker (linked worktrees and
    // submodules use a gitdir-pointer file, not a directory) — deliberately
    // not a real repository, to prove this branch never actually spawns
    // `git` to confirm it.
    std::fs::write(root.path().join(".git"), "gitdir: /nowhere\n").unwrap();

    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let result = block_on(discover_repository(&trust, &workspace, "main", root.path()))
        .expect("discovery succeeds even when untrusted");
    assert_eq!(
        result,
        RepositoryDiscovery::UnconfirmedMarker {
            has_git_marker: true
        }
    );
}

#[test]
fn an_untrusted_workspace_without_a_marker_reports_false() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let result = block_on(discover_repository(&trust, &workspace, "main", root.path()))
        .expect("discovery succeeds even when untrusted");
    assert_eq!(
        result,
        RepositoryDiscovery::UnconfirmedMarker {
            has_git_marker: false
        }
    );
}

#[test]
fn the_empty_workspace_is_rejected_before_ever_checking_trust_or_the_marker() {
    // The `EMPTY` workspace authorizes zero roots, so there is no root to
    // validate `candidate_dir` against (and, symmetrically, no root-floor
    // to bound an untrusted marker walk against) — `authorize_candidate_dir`
    // rejects it up front, before this function ever asks whether the
    // workspace is trusted. This is a deliberate difference from
    // `terminal::service::TerminalService::start` (which rejects the
    // `EMPTY` workspace via `WORKSPACE_NOT_TRUSTED` from `require_trusted`
    // directly): here, cwd-authorization is a prerequisite for *either*
    // discovery branch, not just the trusted one, so it runs first.
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(discover_repository(&trust, &workspace, "main", root.path()))
        .expect_err("the EMPTY workspace has no root to authorize candidate_dir against");
    assert_eq!(error.code(), "GIT_CWD_INVALID");
}

#[test]
fn candidate_dir_outside_any_authorized_root_is_rejected() {
    let root = TempDir::new().unwrap();
    let outsider = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(discover_repository(
        &trust,
        &workspace,
        "main",
        outsider.path(),
    ))
    .expect_err("a directory outside every authorized root must be rejected");
    assert_eq!(error.code(), "GIT_CWD_INVALID");
}

#[test]
fn the_marker_walk_never_crosses_above_the_authorized_root() {
    // The authorized root's *parent* has a `.git` marker (an unrelated
    // "outer" repository the workspace root happens to sit inside), but
    // the root itself does not. An untrusted lookup must report `false`,
    // never leaking whether anything above the authorized root exists.
    let parent = TempDir::new().unwrap();
    std::fs::write(parent.path().join(".git"), "gitdir: /nowhere\n").unwrap();
    let root = parent.path().join("workspace-root");
    std::fs::create_dir(&root).unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", &root);
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let result = block_on(discover_repository(&trust, &workspace, "main", &root))
        .expect("discovery succeeds even when untrusted");
    assert_eq!(
        result,
        RepositoryDiscovery::UnconfirmedMarker {
            has_git_marker: false
        }
    );
}

#[test]
fn a_marker_at_the_root_is_found_by_walking_up_from_a_nested_candidate() {
    let root = TempDir::new().unwrap();
    std::fs::write(root.path().join(".git"), "gitdir: /nowhere\n").unwrap();
    let nested = root.path().join("a").join("b");
    std::fs::create_dir_all(&nested).unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let result = block_on(discover_repository(&trust, &workspace, "main", &nested))
        .expect("discovery succeeds even when untrusted");
    assert_eq!(
        result,
        RepositoryDiscovery::UnconfirmedMarker {
            has_git_marker: true
        }
    );
}

#[test]
fn a_trusted_workspace_spawns_git_and_confirms_a_real_repository() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let root = TempDir::new().unwrap();
    init_real_repo(root.path());
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());

    let result = block_on(discover_repository(&trust, &workspace, "main", root.path()))
        .expect("discovery succeeds for a real repository");
    let expected = std::fs::canonicalize(root.path()).unwrap();
    assert_eq!(
        result,
        RepositoryDiscovery::Confirmed {
            toplevel: Some(expected)
        }
    );
}

#[test]
fn a_trusted_workspace_does_not_trust_a_fake_filesystem_marker() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    // A `.git` file/dir that is *not* actually a valid git repository (no
    // real `git init` ran) — once trusted, discovery must actually spawn
    // `git rev-parse` and get the real (negative) answer, never just trust
    // the filesystem marker the way the untrusted branch does.
    let root = TempDir::new().unwrap();
    std::fs::create_dir(root.path().join(".git")).unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());

    let result = block_on(discover_repository(&trust, &workspace, "main", root.path()))
        .expect("discovery succeeds even though git reports this is not a repository");
    assert_eq!(result, RepositoryDiscovery::Confirmed { toplevel: None });
}
