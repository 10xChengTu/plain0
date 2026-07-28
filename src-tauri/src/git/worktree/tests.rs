//! `git::worktree` contract tests (`F090` S5). Every fixture spawns a *real*
//! `git` binary, mirroring `stash::tests`'s/`refs::tests`'s own rationale for
//! never hand-typing wire bytes for an end-to-end assertion — except where a
//! pure parsing edge case (truncation, malformed shape) is cheaper and
//! clearer to construct by hand, exactly like `stash::tests`'s own
//! `parse_stash_list_truncates_and_reports_truncated_when_more_than_max_entries_exist`.
//! Several tests below are *control-group* fixtures: they run the same real
//! repository through both a raw/differently-shaped invocation and this
//! module's actual production path, and assert the two genuinely differ —
//! never merely that the chosen path happens to pass.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use tempfile::TempDir;

use super::{
    add_worktree, list_worktrees, parse_worktree_list, remove_worktree, WorktreeAddOutcome,
    WorktreeHeadState, WorktreeRemoveOutcome,
};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<PathBuf>,
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

struct CancelledPicker;

impl DirectoryPicker for CancelledPicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        Box::pin(async move { Ok(DirectoryPickerResult::Cancelled) })
    }
}

/// A picker that panics if ever invoked — used to prove a rejection happens
/// *before* [`super::add_worktree`] ever pops the native dialog (e.g. an
/// untrusted workspace, or an invalid child segment/commit-ish).
struct PanickingPicker;

impl DirectoryPicker for PanickingPicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        Box::pin(async move { panic!("picker must not be invoked for this case") })
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

fn untrusted_workspace(
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
    (workspace, trust)
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .status()
        .is_ok_and(|status| status.success())
}

fn raw_git_ok(dir: &Path, args: &[&str]) {
    let output = raw_git(dir, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn raw_git(dir: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git fixture command spawns")
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

fn commit_file(repo: &Path, name: &str, contents: &str) {
    std::fs::write(repo.join(name), contents).unwrap();
    raw_git_ok(repo, &["add", name]);
    raw_git_ok(repo, &["commit", "--quiet", "-m", &format!("add {name}")]);
}

// --- list_worktrees (real fixtures) -----------------------------------------

#[test]
fn list_worktrees_of_a_fresh_repo_has_exactly_the_main_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(list_worktrees(&trust, &workspace, "main")).expect("list_worktrees succeeds");
    assert_eq!(result.entries.len(), 1);
    assert!(!result.truncated);
    let main = &result.entries[0];
    assert!(main.is_main);
    assert!(matches!(main.head_state, WorktreeHeadState::Branch { .. }));
    assert!(main.head_sha.is_some());
    assert!(main.locked_reason.is_none());
    assert!(main.prunable_reason.is_none());
}

#[test]
fn list_worktrees_distinguishes_main_from_a_linked_worktree_and_orders_main_first() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let linked_path = parent.path().join("linked");
    raw_git_ok(
        repo.path(),
        &[
            "worktree",
            "add",
            "--quiet",
            linked_path.to_str().unwrap(),
            "-b",
            "linked-branch",
        ],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(list_worktrees(&trust, &workspace, "main")).expect("list_worktrees succeeds");
    assert_eq!(result.entries.len(), 2);
    assert!(result.entries[0].is_main);
    assert!(!result.entries[1].is_main);
    match &result.entries[1].head_state {
        WorktreeHeadState::Branch { ref_name } => {
            assert_eq!(ref_name.to_wire_lossy(), "refs/heads/linked-branch");
        }
        other => panic!("expected a branch head state, got {other:?}"),
    }
}

#[test]
fn list_worktrees_reports_a_detached_head_worktree_correctly() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let detached_path = parent.path().join("detached");
    raw_git_ok(
        repo.path(),
        &[
            "worktree",
            "add",
            "--quiet",
            "--detach",
            detached_path.to_str().unwrap(),
            "HEAD",
        ],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(list_worktrees(&trust, &workspace, "main")).expect("list_worktrees succeeds");
    let detached_entry = result
        .entries
        .iter()
        .find(|entry| !entry.is_main)
        .expect("linked entry present");
    assert!(matches!(
        detached_entry.head_state,
        WorktreeHeadState::Detached
    ));
    assert!(detached_entry.head_sha.is_some());
}

#[test]
fn list_worktrees_of_an_unborn_head_repo_models_head_sha_as_none() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(list_worktrees(&trust, &workspace, "main")).expect("list_worktrees succeeds");
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].head_sha, None);
    assert!(matches!(
        result.entries[0].head_state,
        WorktreeHeadState::Branch { .. }
    ));
}

#[test]
fn list_worktrees_reports_a_locked_worktree_with_its_reason() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let locked_path = parent.path().join("locked");
    raw_git_ok(
        repo.path(),
        &[
            "worktree",
            "add",
            "--quiet",
            locked_path.to_str().unwrap(),
            "-b",
            "locked-branch",
        ],
    );
    raw_git_ok(
        repo.path(),
        &[
            "worktree",
            "lock",
            locked_path.to_str().unwrap(),
            "--reason",
            "editing right now",
        ],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(list_worktrees(&trust, &workspace, "main")).expect("list_worktrees succeeds");
    let locked_entry = result
        .entries
        .iter()
        .find(|entry| !entry.is_main)
        .expect("linked entry present");
    assert_eq!(
        locked_entry.locked_reason.as_deref(),
        Some("editing right now")
    );
}

#[test]
fn list_worktrees_reports_a_prunable_stale_worktree_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let gone_path = parent.path().join("gone");
    raw_git_ok(
        repo.path(),
        &[
            "worktree",
            "add",
            "--quiet",
            gone_path.to_str().unwrap(),
            "-b",
            "gone-branch",
        ],
    );
    // Delete the worktree's own directory out from under git, without going
    // through `git worktree remove` at all — this is exactly how a
    // "prunable" entry arises in practice (e.g. the user `rm -rf`'d it
    // directly), not something this test needs `git worktree remove` itself
    // to produce.
    std::fs::remove_dir_all(&gone_path).unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(list_worktrees(&trust, &workspace, "main")).expect("list_worktrees succeeds");
    let stale_entry = result
        .entries
        .iter()
        .find(|entry| !entry.is_main)
        .expect("linked entry present");
    assert!(stale_entry.prunable_reason.is_some());
}

#[test]
fn list_worktrees_handles_a_non_ascii_and_special_character_worktree_path() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let weird_path = parent.path().join("分支-🎉-weird,name");
    raw_git_ok(
        repo.path(),
        &[
            "worktree",
            "add",
            "--quiet",
            weird_path.to_str().unwrap(),
            "-b",
            "weird-branch",
        ],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(list_worktrees(&trust, &workspace, "main")).expect("list_worktrees succeeds");
    let weird_entry = result
        .entries
        .iter()
        .find(|entry| !entry.is_main)
        .expect("linked entry present");
    assert!(weird_entry
        .path
        .to_wire_lossy()
        .ends_with("分支-🎉-weird,name"));
}

/// Required control-group proof for this module's own doc comment's
/// `core.quotePath` finding: the exact same real, non-ASCII worktree path
/// comes back byte-identical whether or not `-c core.quotePath=false` is
/// also passed to `git worktree list --porcelain -z`.
#[test]
fn worktree_list_path_quoting_is_unaffected_by_core_quote_path() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let weird_path = parent.path().join("分支-🎉-weird\"quote");
    raw_git_ok(
        repo.path(),
        &[
            "worktree",
            "add",
            "--quiet",
            weird_path.to_str().unwrap(),
            "-b",
            "weird-quote-branch",
        ],
    );

    let without_override = raw_git(repo.path(), &["worktree", "list", "--porcelain", "-z"]);
    let with_override = Command::new("git")
        .current_dir(repo.path())
        .args([
            "-c",
            "core.quotePath=false",
            "worktree",
            "list",
            "--porcelain",
            "-z",
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git spawns");
    assert!(without_override.status.success());
    assert!(with_override.status.success());
    assert_eq!(
        without_override.stdout, with_override.stdout,
        "core.quotePath must not affect worktree list --porcelain -z output at all"
    );
}

#[test]
fn list_worktrees_rejects_when_workspace_is_not_trusted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = untrusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(list_worktrees(&trust, &workspace, "main")).expect_err("must reject");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

// --- parse_worktree_list (pure function edge cases) -------------------------

#[test]
fn parse_worktree_list_of_empty_output_is_zero_entries_not_truncated() {
    let result = parse_worktree_list(b"", 10).expect("parses");
    assert_eq!(result.entries.len(), 0);
    assert!(!result.truncated);
}

#[test]
fn parse_worktree_list_caps_at_the_defensive_ceiling_and_reports_truncated() {
    let mut output = Vec::new();
    for index in 0..3 {
        output.extend_from_slice(format!("worktree /tmp/wt{index}\0").as_bytes());
        output.extend_from_slice(b"HEAD ");
        output.extend_from_slice("c".repeat(40).as_bytes());
        output.push(0);
        output.extend_from_slice(b"branch refs/heads/main\0");
        output.push(0);
    }
    let result = parse_worktree_list(&output, 2).expect("parses");
    assert!(result.truncated);
    assert_eq!(result.entries.len(), 2);
}

#[test]
fn parse_worktree_list_rejects_an_unrecognized_field() {
    let mut output = Vec::new();
    output.extend_from_slice(b"worktree /tmp/wt\0");
    output.extend_from_slice(b"HEAD ");
    output.extend_from_slice("c".repeat(40).as_bytes());
    output.push(0);
    output.extend_from_slice(b"something-unexpected\0");
    output.push(0);
    let error = parse_worktree_list(&output, 10).expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_LIST_PARSE_FAILED");
}

#[test]
fn parse_worktree_list_rejects_a_block_missing_a_head_state_field() {
    let mut output = Vec::new();
    output.extend_from_slice(b"worktree /tmp/wt\0");
    output.extend_from_slice(b"HEAD ");
    output.extend_from_slice("c".repeat(40).as_bytes());
    output.push(0);
    output.push(0);
    let error = parse_worktree_list(&output, 10).expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_LIST_PARSE_FAILED");
}

#[test]
fn parse_worktree_list_rejects_a_malformed_head_sha() {
    let mut output = Vec::new();
    output.extend_from_slice(b"worktree /tmp/wt\0");
    output.extend_from_slice(b"HEAD not-a-sha\0");
    output.extend_from_slice(b"branch refs/heads/main\0");
    output.push(0);
    let error = parse_worktree_list(&output, 10).expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_LIST_PARSE_FAILED");
}

/// Real-fixture proof that a bare repository's own "no `HEAD` field at all,
/// just `bare`" shape is tolerated by the parser — see this module's own
/// module doc comment for why this state is structurally unreachable via
/// [`super::list_worktrees`]'s own `resolve_repo_toplevel` gate in practice,
/// so this test calls [`parse_worktree_list`] directly against real bytes
/// captured from a real bare repository rather than routing through
/// `list_worktrees` itself.
#[test]
fn parse_worktree_list_tolerates_a_real_bare_repositorys_own_administrative_worktree_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let bare_parent = TempDir::new().unwrap();
    let bare_path = bare_parent.path().join("bare.git");
    let status = Command::new("git")
        .args(["init", "--quiet", "--bare", bare_path.to_str().unwrap()])
        .status()
        .expect("git init --bare spawns");
    assert!(status.success());
    let output = raw_git(&bare_path, &["worktree", "list", "--porcelain", "-z"]);
    assert!(output.status.success());
    let result = parse_worktree_list(&output.stdout, 10).expect("parses a real bare repo shape");
    assert_eq!(result.entries.len(), 1);
    assert!(result.entries[0].is_main);
    assert_eq!(result.entries[0].head_sha, None);
    assert!(matches!(
        result.entries[0].head_state,
        WorktreeHeadState::Bare
    ));
}

// --- add_worktree ------------------------------------------------------------

#[test]
fn add_worktree_with_no_commit_ish_creates_a_new_branch_named_after_the_leaf_directory() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let picker = FakePicker {
        paths: vec![parent.path().to_path_buf()],
    };
    let outcome = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &picker,
        "new-child",
        false,
        None,
    ))
    .expect("add_worktree succeeds");
    match outcome {
        WorktreeAddOutcome::Added { path } => {
            let expected = parent.path().canonicalize().unwrap().join("new-child");
            assert_eq!(PathBuf::from(&path), expected);
            assert!(Path::new(&path).is_dir());
        }
        other => panic!("expected Added, got {other:?}"),
    }
    let branches =
        String::from_utf8(raw_git(repo.path(), &["branch", "--list", "new-child"]).stdout).unwrap();
    assert!(branches.contains("new-child"));
}

#[test]
fn add_worktree_with_an_explicit_commit_ish_and_detach_creates_a_detached_worktree() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let picker = FakePicker {
        paths: vec![parent.path().to_path_buf()],
    };
    let outcome = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &picker,
        "detached-child",
        true,
        Some("main"),
    ))
    .expect("add_worktree succeeds");
    assert!(matches!(outcome, WorktreeAddOutcome::Added { .. }));

    let result = block_on(list_worktrees(&trust, &workspace, "main")).expect("list succeeds");
    let entry = result
        .entries
        .iter()
        .find(|entry| !entry.is_main)
        .expect("linked entry present");
    assert!(matches!(entry.head_state, WorktreeHeadState::Detached));
}

#[test]
fn add_worktree_reports_picker_cancelled_and_creates_nothing() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let outcome = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &CancelledPicker,
        "never-created",
        false,
        None,
    ))
    .expect("add_worktree succeeds");
    assert!(matches!(outcome, WorktreeAddOutcome::PickerCancelled));
    let result = block_on(list_worktrees(&trust, &workspace, "main")).expect("list succeeds");
    assert_eq!(result.entries.len(), 1, "no linked worktree was created");
}

#[test]
fn add_worktree_rejects_a_child_segment_that_already_exists_as_a_non_empty_directory() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    std::fs::create_dir(parent.path().join("existing")).unwrap();
    std::fs::write(parent.path().join("existing").join("f.txt"), "x").unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let picker = FakePicker {
        paths: vec![parent.path().to_path_buf()],
    };
    let error = block_on(add_worktree(
        &trust, &workspace, "main", &picker, "existing", false, None,
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_ADD_TARGET_EXISTS");
}

#[test]
fn add_worktree_rejects_a_child_segment_that_already_exists_as_a_plain_file() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    std::fs::write(parent.path().join("existing-file"), "x").unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let picker = FakePicker {
        paths: vec![parent.path().to_path_buf()],
    };
    let error = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &picker,
        "existing-file",
        false,
        None,
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_ADD_TARGET_EXISTS");
}

#[test]
fn add_worktree_tolerates_a_child_segment_that_already_exists_as_an_empty_directory() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    std::fs::create_dir(parent.path().join("empty-existing")).unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let picker = FakePicker {
        paths: vec![parent.path().to_path_buf()],
    };
    let outcome = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &picker,
        "empty-existing",
        false,
        None,
    ))
    .expect("git tolerates a pre-existing empty target directory");
    assert!(matches!(outcome, WorktreeAddOutcome::Added { .. }));
}

#[test]
fn add_worktree_rejects_a_branch_already_checked_out_in_another_worktree() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let picker = FakePicker {
        paths: vec![parent.path().to_path_buf()],
    };
    // `main` is already checked out in the main worktree itself.
    let error = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &picker,
        "dup-child",
        false,
        Some("main"),
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_ADD_BRANCH_IN_USE");
}

#[test]
fn add_worktree_rejects_a_nonexistent_commit_ish() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let picker = FakePicker {
        paths: vec![parent.path().to_path_buf()],
    };
    let error = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &picker,
        "bogus-child",
        false,
        Some("totally-bogus-ref-xyz"),
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_ADD_INVALID_REFERENCE");
}

#[test]
fn add_worktree_rejects_a_child_segment_containing_a_path_separator_before_ever_touching_git() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    // `PanickingPicker` proves this rejection happens before the native
    // folder picker is ever invoked at all.
    let error = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &PanickingPicker,
        "a/b",
        false,
        None,
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_ADD_INVALID_CHILD_SEGMENT");
}

#[test]
fn add_worktree_rejects_a_traversal_shaped_child_segment_via_relative_path_join_child() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    for hostile_segment in ["..", ".", ""] {
        let error = block_on(add_worktree(
            &trust,
            &workspace,
            "main",
            &PanickingPicker,
            hostile_segment,
            false,
            None,
        ))
        .expect_err("must reject");
        assert_eq!(error.code(), "GIT_WORKTREE_ADD_INVALID_CHILD_SEGMENT");
    }
}

#[test]
fn add_worktree_rejects_a_commit_ish_that_begins_with_a_hyphen_before_ever_touching_git() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &PanickingPicker,
        "child",
        false,
        Some("-not-a-real-flag"),
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_ADD_INVALID_COMMIT_ISH");
}

#[test]
fn add_worktree_rejects_when_workspace_is_not_trusted_before_ever_invoking_the_picker() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = untrusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(add_worktree(
        &trust,
        &workspace,
        "main",
        &PanickingPicker,
        "child",
        false,
        None,
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

/// Required control-group proof for this module's own doc comment's
/// "`<commit-ish>` needs an explicit `--` separator" finding: the exact same
/// hyphen-prefixed string is *misparsed as an option* by a raw invocation
/// with no `--`, but *safely rejected as a bad revision* once the literal
/// `--` this module's own [`super::GIT_WORKTREE_ADD_BASE_ARGS`] always
/// inserts is present — demonstrated with real `git`, not asserted from
/// memory.
#[test]
fn raw_git_worktree_add_without_a_double_dash_separator_misparses_a_hyphen_prefixed_commit_ish_as_an_option(
) {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();

    let without_separator = Command::new("git")
        .current_dir(repo.path())
        .args([
            "worktree",
            "add",
            parent.path().join("child1").to_str().unwrap(),
            "-not-a-real-flag",
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git spawns");
    assert!(
        !without_separator.status.success(),
        "control group: without `--`, this must fail"
    );
    let without_stderr = String::from_utf8_lossy(&without_separator.stderr);
    assert!(
        !without_stderr.contains("invalid reference"),
        "control group: without `--`, git must misparse this as an option, not a bad revision \
         (actual stderr: {without_stderr})"
    );

    let with_separator = Command::new("git")
        .current_dir(repo.path())
        .args([
            "worktree",
            "add",
            "--",
            parent.path().join("child2").to_str().unwrap(),
            "-not-a-real-flag",
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git spawns");
    assert!(!with_separator.status.success());
    let with_stderr = String::from_utf8_lossy(&with_separator.stderr);
    assert!(
        with_stderr.contains("invalid reference"),
        "production fix: with `--`, git must safely reject this as a bad revision \
         (actual stderr: {with_stderr})"
    );
}

// --- remove_worktree ---------------------------------------------------------

fn add_linked_worktree(repo: &Path, parent: &Path, name: &str, branch: &str) -> PathBuf {
    let path = parent.join(name);
    raw_git_ok(
        repo,
        &[
            "worktree",
            "add",
            "--quiet",
            path.to_str().unwrap(),
            "-b",
            branch,
        ],
    );
    path.canonicalize().unwrap()
}

#[test]
fn remove_worktree_on_a_clean_worktree_succeeds_without_force() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let path = add_linked_worktree(repo.path(), parent.path(), "clean", "clean-branch");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let outcome = block_on(remove_worktree(
        &trust,
        &workspace,
        "main",
        path.to_str().unwrap(),
        false,
    ))
    .expect("remove_worktree succeeds");
    assert!(matches!(outcome, WorktreeRemoveOutcome::Removed));
    assert!(!path.exists());
}

#[test]
fn remove_worktree_on_a_dirty_worktree_needs_force_and_is_not_an_error() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let path = add_linked_worktree(repo.path(), parent.path(), "dirty", "dirty-branch");
    std::fs::write(path.join("untracked.txt"), "oops").unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let outcome = block_on(remove_worktree(
        &trust,
        &workspace,
        "main",
        path.to_str().unwrap(),
        false,
    ))
    .expect("remove_worktree reports NeedsForce, not an error");
    assert!(matches!(outcome, WorktreeRemoveOutcome::NeedsForce));
    assert!(path.exists(), "the dirty worktree must not be touched yet");

    let forced = block_on(remove_worktree(
        &trust,
        &workspace,
        "main",
        path.to_str().unwrap(),
        true,
    ))
    .expect("forced remove_worktree succeeds");
    assert!(matches!(forced, WorktreeRemoveOutcome::Removed));
    assert!(!path.exists());
}

#[test]
fn remove_worktree_on_a_locked_worktree_is_rejected_and_a_single_force_does_not_help() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let parent = TempDir::new().unwrap();
    let path = add_linked_worktree(repo.path(), parent.path(), "locked", "locked-branch");
    raw_git_ok(
        repo.path(),
        &[
            "worktree",
            "lock",
            path.to_str().unwrap(),
            "--reason",
            "in use",
        ],
    );
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let error = block_on(remove_worktree(
        &trust,
        &workspace,
        "main",
        path.to_str().unwrap(),
        false,
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_REMOVE_LOCKED");

    // A single `--force` is confirmed empirically (this module's own doc
    // comment) *not* to override a lock — this module deliberately does not
    // auto-escalate to a second `--force`, so the caller-facing behavior with
    // `force: true` on a locked worktree must be the identical rejection.
    let error_with_single_force = block_on(remove_worktree(
        &trust,
        &workspace,
        "main",
        path.to_str().unwrap(),
        true,
    ))
    .expect_err("a single force must still be rejected for a locked worktree");
    assert_eq!(error_with_single_force.code(), "GIT_WORKTREE_REMOVE_LOCKED");
    assert!(path.exists());
}

#[test]
fn remove_worktree_on_the_main_worktree_is_defensively_rejected() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let canonical_repo = repo.path().canonicalize().unwrap();

    let error = block_on(remove_worktree(
        &trust,
        &workspace,
        "main",
        canonical_repo.to_str().unwrap(),
        false,
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_REMOVE_IS_MAIN_WORKTREE");
    assert!(canonical_repo.exists());
}

/// Required control-group proof for this module's own doc comment's "An
/// arbitrary/hostile path can never destroy unrelated data" claim: pointing
/// [`remove_worktree`] at a real, populated, entirely unrelated directory
/// that is not a registered worktree of this repository is safely refused,
/// and that directory's own contents are left completely untouched.
#[test]
fn remove_worktree_on_a_path_that_is_not_a_registered_worktree_is_safely_refused_not_silently_destructive(
) {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let unrelated = TempDir::new().unwrap();
    std::fs::write(unrelated.path().join("important.txt"), "do not delete").unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let error = block_on(remove_worktree(
        &trust,
        &workspace,
        "main",
        unrelated.path().canonicalize().unwrap().to_str().unwrap(),
        false,
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "GIT_WORKTREE_REMOVE_NOT_FOUND");
    assert_eq!(
        std::fs::read_to_string(unrelated.path().join("important.txt")).unwrap(),
        "do not delete",
        "an unrelated directory must be left completely untouched"
    );
}

#[test]
fn remove_worktree_rejects_when_workspace_is_not_trusted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    commit_file(repo.path(), "a.txt", "1\n");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = untrusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(remove_worktree(
        &trust,
        &workspace,
        "main",
        "/tmp/does-not-matter",
        false,
    ))
    .expect_err("must reject");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

// --- GIT_LITERAL_PATHSPECS control group (all three commands) ---------------

/// This domain's own `⚠ 跨切片必读` note (`GIT_LITERAL_PATHSPECS=1`,
/// unconditionally set for every command in every `GitExecMode` by
/// `exec::apply_universal_hardening`) requires every *new* command to be
/// individually checked against it in a real hardened environment, not
/// assumed safe by analogy — `F090` S4 found a real, costly bug in exactly
/// this spot for `stash push --include-untracked`. This test checks all
/// three of this module's own commands (`add`/`list`/`remove`) against a
/// worktree path segment containing literal glob-magic characters
/// (`a*b`), comparing real `git` behavior with and without the variable set
/// and asserting it is identical either way — the required real-environment
/// control-group proof that this module's own commands are unaffected,
/// mirroring `stash::tests`'s own bug-detection test's structure but for a
/// *negative* finding.
#[test]
fn worktree_add_list_and_remove_behavior_is_unaffected_by_git_literal_pathspecs() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let hardened_env = [
        ("GIT_LITERAL_PATHSPECS", "1"),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("LANG", "en_US.UTF-8"),
        ("LC_ALL", "en_US.UTF-8"),
    ];

    for literal_pathspecs in [true, false] {
        let repo = init_repo();
        commit_file(repo.path(), "a.txt", "1\n");
        let parent = TempDir::new().unwrap();
        let target = parent.path().join("a*b");

        let mut add_command = Command::new("git");
        add_command.current_dir(repo.path()).args([
            "worktree",
            "add",
            "-b",
            "glob-branch",
            "--",
            target.to_str().unwrap(),
        ]);
        if literal_pathspecs {
            add_command.envs(hardened_env);
        } else {
            add_command.env("GIT_TERMINAL_PROMPT", "0");
        }
        let add_output = add_command.output().expect("git spawns");
        assert!(
            add_output.status.success(),
            "worktree add with a literal glob-char path (GIT_LITERAL_PATHSPECS={literal_pathspecs}) \
             must succeed: {}",
            String::from_utf8_lossy(&add_output.stderr)
        );
        assert!(target.is_dir());

        let mut list_command = Command::new("git");
        list_command
            .current_dir(repo.path())
            .args(["worktree", "list", "--porcelain", "-z"]);
        if literal_pathspecs {
            list_command.envs(hardened_env);
        } else {
            list_command.env("GIT_TERMINAL_PROMPT", "0");
        }
        let list_output = list_command.output().expect("git spawns");
        assert!(list_output.status.success());
        assert!(
            String::from_utf8_lossy(&list_output.stdout).contains("a*b"),
            "the glob-char path must appear verbatim in the listing regardless of \
             GIT_LITERAL_PATHSPECS"
        );

        let mut remove_command = Command::new("git");
        remove_command.current_dir(repo.path()).args([
            "worktree",
            "remove",
            "--",
            target.to_str().unwrap(),
        ]);
        if literal_pathspecs {
            remove_command.envs(hardened_env);
        } else {
            remove_command.env("GIT_TERMINAL_PROMPT", "0");
        }
        let remove_output = remove_command.output().expect("git spawns");
        assert!(
            remove_output.status.success(),
            "worktree remove with a literal glob-char path (GIT_LITERAL_PATHSPECS={literal_pathspecs}) \
             must succeed: {}",
            String::from_utf8_lossy(&remove_output.stderr)
        );
        assert!(!target.exists());
    }
}
