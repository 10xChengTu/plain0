use std::path::Path;
use std::process::{Command, Output};
use std::sync::atomic::Ordering;

use tempfile::TempDir;

use super::{
    abort_operation, cherry_pick, continue_operation, merge, preview, rebase, reset, revert,
    GitHistoryOperationService, HistoryMutationOutcomeKind, HistoryOperation, PathProjection,
    SequencerKind, MAX_HISTORY_PATHS,
};
use crate::git::wire::GitPathBuf;
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

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
    std::fs::write(repo.path().join("tracked.txt"), b"base\n").unwrap();
    raw_git(repo.path(), &["add", "tracked.txt"]);
    raw_git(repo.path(), &["commit", "--quiet", "-m", "initial"]);
    repo
}

fn commit_file(repo: &Path, path: &str, content: &[u8], message: &str) -> String {
    std::fs::write(repo.join(path), content).unwrap();
    raw_git(repo, &["add", "--", path]);
    raw_git(repo, &["commit", "--quiet", "-m", message]);
    raw_git_text(repo, &["rev-parse", "HEAD"])
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

fn divergent_repo() -> (TempDir, String, String) {
    let repo = init_repo();
    raw_git(repo.path(), &["switch", "--quiet", "-c", "topic"]);
    let topic = commit_file(repo.path(), "tracked.txt", b"topic\n", "topic");
    raw_git(repo.path(), &["switch", "--quiet", "main"]);
    let main = commit_file(repo.path(), "tracked.txt", b"main\n", "main");
    (repo, main, topic)
}

#[test]
fn preview_is_bounded_path_aware_and_a_changed_worktree_invalidates_its_token() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let base = raw_git_text(repo.path(), &["rev-parse", "HEAD"]);
    let head = commit_file(repo.path(), "second.txt", b"second\n", "second");
    std::fs::write(repo.path().join("tracked.txt"), b"working\n").unwrap();
    std::fs::write(repo.path().join("staged.txt"), b"staged\n").unwrap();
    raw_git(repo.path(), &["add", "staged.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let service = GitHistoryOperationService::new();
    let first = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::ResetHard,
        &base,
    ))
    .unwrap();
    assert_eq!(first.head_sha, head);
    assert_eq!(first.target_sha, base);
    assert_eq!((first.ahead, first.behind), (1, 0));
    assert_eq!(
        first
            .working_tree_paths
            .iter()
            .map(GitPathBuf::as_bytes)
            .collect::<Vec<_>>(),
        vec![b"tracked.txt".as_slice()]
    );
    assert_eq!(
        first
            .staged_paths
            .iter()
            .map(GitPathBuf::as_bytes)
            .collect::<Vec<_>>(),
        vec![b"staged.txt".as_slice()]
    );
    assert!(first.conflicted_paths.is_empty());
    assert!(!first.paths_truncated);
    assert!(super::is_lowercase_hex(&first.preview_token, 64));

    std::fs::write(repo.path().join("tracked.txt"), b"changed again\n").unwrap();
    let error = block_on(reset(
        &trust,
        &workspace,
        &service,
        "main",
        HistoryOperation::ResetHard,
        &base,
        &first.preview_token,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "GIT_HISTORY_PREVIEW_STALE");
    assert_eq!(raw_git_text(repo.path(), &["rev-parse", "HEAD"]), head);
}

#[test]
fn untrusted_history_preview_fails_before_any_write() {
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
    let error = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::ResetHard,
        &head,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
    assert_eq!(raw_git_text(repo.path(), &["rev-parse", "HEAD"]), head);
}

#[test]
fn merge_conflict_reports_paths_and_continue_finishes_the_real_sequencer() {
    if !git_available() {
        return;
    }
    let (repo, _main, topic) = divergent_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let service = GitHistoryOperationService::new();
    let prepared = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::Merge,
        &topic,
    ))
    .unwrap();
    let outcome = block_on(merge(
        &trust,
        &workspace,
        &service,
        "main",
        &topic,
        &prepared.preview_token,
    ))
    .unwrap();
    assert_eq!(outcome.kind, HistoryMutationOutcomeKind::Conflicts);
    let sequencer = outcome.state.sequencer.unwrap();
    assert_eq!(sequencer.kind, SequencerKind::Merge);
    assert_eq!(sequencer.conflicted_paths[0].as_bytes(), b"tracked.txt");

    std::fs::write(repo.path().join("tracked.txt"), b"resolved\n").unwrap();
    raw_git(repo.path(), &["add", "tracked.txt"]);
    let continued = block_on(continue_operation(
        &trust,
        &workspace,
        &service,
        "main",
        SequencerKind::Merge,
    ))
    .unwrap();
    assert_eq!(continued.kind, HistoryMutationOutcomeKind::Completed);
    assert!(continued.state.sequencer.is_none());
    assert_eq!(
        raw_git_text(repo.path(), &["rev-list", "--count", "HEAD"]),
        "4"
    );
}

#[test]
fn rebase_cherry_pick_and_revert_conflicts_are_detected_and_abort_is_kind_bound() {
    if !git_available() {
        return;
    }

    for (operation, expected_kind) in [
        (HistoryOperation::Rebase, SequencerKind::Rebase),
        (HistoryOperation::CherryPick, SequencerKind::CherryPick),
    ] {
        let (repo, main, topic) = divergent_repo();
        let trust_base = TempDir::new().unwrap();
        let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
        let service = GitHistoryOperationService::new();
        let prepared = block_on(preview(&trust, &workspace, "main", operation, &topic)).unwrap();
        let outcome = match operation {
            HistoryOperation::Rebase => block_on(rebase(
                &trust,
                &workspace,
                &service,
                "main",
                &topic,
                &prepared.preview_token,
            )),
            HistoryOperation::CherryPick => block_on(cherry_pick(
                &trust,
                &workspace,
                &service,
                "main",
                &topic,
                &prepared.preview_token,
            )),
            _ => unreachable!(),
        }
        .unwrap();
        assert_eq!(outcome.kind, HistoryMutationOutcomeKind::Conflicts);
        assert_eq!(outcome.state.sequencer.unwrap().kind, expected_kind);

        let wrong_kind = if expected_kind == SequencerKind::Rebase {
            SequencerKind::CherryPick
        } else {
            SequencerKind::Rebase
        };
        let error = block_on(abort_operation(
            &trust, &workspace, &service, "main", wrong_kind,
        ))
        .unwrap_err();
        assert_eq!(error.code(), "GIT_HISTORY_OPERATION_KIND_CHANGED");

        let aborted = block_on(abort_operation(
            &trust,
            &workspace,
            &service,
            "main",
            expected_kind,
        ))
        .unwrap();
        assert_eq!(aborted.kind, HistoryMutationOutcomeKind::Completed);
        assert!(aborted.state.sequencer.is_none());
        assert_eq!(raw_git_text(repo.path(), &["rev-parse", "HEAD"]), main);
    }

    let repo = init_repo();
    let to_revert = commit_file(repo.path(), "tracked.txt", b"one\n", "one");
    let current = commit_file(repo.path(), "tracked.txt", b"two\n", "two");
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let service = GitHistoryOperationService::new();
    let prepared = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::Revert,
        &to_revert,
    ))
    .unwrap();
    let outcome = block_on(revert(
        &trust,
        &workspace,
        &service,
        "main",
        &to_revert,
        &prepared.preview_token,
    ))
    .unwrap();
    assert_eq!(outcome.kind, HistoryMutationOutcomeKind::Conflicts);
    assert_eq!(outcome.state.sequencer.unwrap().kind, SequencerKind::Revert);
    block_on(abort_operation(
        &trust,
        &workspace,
        &service,
        "main",
        SequencerKind::Revert,
    ))
    .unwrap();
    assert_eq!(raw_git_text(repo.path(), &["rev-parse", "HEAD"]), current);
}

#[test]
fn successful_cherry_pick_revert_rebase_and_all_reset_modes_use_exact_targets() {
    if !git_available() {
        return;
    }
    let repo = init_repo();
    let base = raw_git_text(repo.path(), &["rev-parse", "HEAD"]);
    raw_git(repo.path(), &["switch", "--quiet", "-c", "topic"]);
    let topic = commit_file(repo.path(), "topic.txt", b"topic\n", "topic");
    raw_git(repo.path(), &["switch", "--quiet", "main"]);
    let main = commit_file(repo.path(), "main.txt", b"main\n", "main");

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let service = GitHistoryOperationService::new();

    let cherry_preview = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::CherryPick,
        &topic,
    ))
    .unwrap();
    let cherry = block_on(cherry_pick(
        &trust,
        &workspace,
        &service,
        "main",
        &topic,
        &cherry_preview.preview_token,
    ))
    .unwrap();
    assert_eq!(cherry.kind, HistoryMutationOutcomeKind::Completed);
    let cherry_head = cherry.state.head_sha;
    assert!(repo.path().join("topic.txt").is_file());

    let revert_preview = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::Revert,
        &cherry_head,
    ))
    .unwrap();
    let reverted = block_on(revert(
        &trust,
        &workspace,
        &service,
        "main",
        &cherry_head,
        &revert_preview.preview_token,
    ))
    .unwrap();
    assert_eq!(reverted.kind, HistoryMutationOutcomeKind::Completed);
    assert!(!repo.path().join("topic.txt").exists());

    let soft_preview = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::ResetSoft,
        &base,
    ))
    .unwrap();
    block_on(reset(
        &trust,
        &workspace,
        &service,
        "main",
        HistoryOperation::ResetSoft,
        &base,
        &soft_preview.preview_token,
    ))
    .unwrap();
    assert_eq!(raw_git_text(repo.path(), &["rev-parse", "HEAD"]), base);
    assert!(!raw_git_text(repo.path(), &["diff", "--cached", "--name-only"]).is_empty());

    let mixed_preview = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::ResetMixed,
        &base,
    ))
    .unwrap();
    block_on(reset(
        &trust,
        &workspace,
        &service,
        "main",
        HistoryOperation::ResetMixed,
        &base,
        &mixed_preview.preview_token,
    ))
    .unwrap();
    assert_eq!(raw_git_text(repo.path(), &["rev-parse", "HEAD"]), base);
    assert!(raw_git_text(repo.path(), &["diff", "--cached", "--name-only"]).is_empty());
    assert!(!raw_git_text(repo.path(), &["status", "--porcelain"]).is_empty());

    let hard_preview = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::ResetHard,
        &main,
    ))
    .unwrap();
    block_on(reset(
        &trust,
        &workspace,
        &service,
        "main",
        HistoryOperation::ResetHard,
        &main,
        &hard_preview.preview_token,
    ))
    .unwrap();
    assert_eq!(raw_git_text(repo.path(), &["rev-parse", "HEAD"]), main);
    assert!(raw_git_text(repo.path(), &["status", "--porcelain"]).is_empty());

    raw_git(repo.path(), &["switch", "--quiet", "-c", "rebased", &base]);
    let rebased_old = commit_file(repo.path(), "rebased.txt", b"rebased\n", "rebased");
    let rebase_preview = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::Rebase,
        &main,
    ))
    .unwrap();
    let rebased = block_on(rebase(
        &trust,
        &workspace,
        &service,
        "main",
        &main,
        &rebase_preview.preview_token,
    ))
    .unwrap();
    assert_eq!(rebased.kind, HistoryMutationOutcomeKind::Completed);
    assert_ne!(rebased.state.head_sha, rebased_old);
    assert!(
        raw_git_output(repo.path(), &["merge-base", "--is-ancestor", &main, "HEAD"])
            .status
            .success()
    );
}

#[test]
fn operation_service_is_single_slot_root_scoped_and_cancel_sets_only_the_matching_flag() {
    let service = GitHistoryOperationService::new();
    let first_root = RootId::parse_v4_wire("00000000-0000-4000-8000-000000000101").unwrap();
    let second_root = RootId::parse_v4_wire("00000000-0000-4000-8000-000000000102").unwrap();
    let first = service.begin("main", Some(first_root)).unwrap();
    let second = service.begin("main", Some(second_root)).unwrap();
    let error = match service.begin("main", Some(first_root)) {
        Ok(_) => panic!("a second operation must not acquire the same slot"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "GIT_HISTORY_OPERATION_BUSY");
    service.request_cancel("other", Some(first_root));
    assert!(!first.flag.load(Ordering::SeqCst));
    service.request_cancel("main", Some(second_root));
    assert!(!first.flag.load(Ordering::SeqCst));
    assert!(second.flag.load(Ordering::SeqCst));
    service.request_cancel("main", Some(first_root));
    assert!(first.flag.load(Ordering::SeqCst));
    drop(first);
    assert!(service.begin("main", Some(first_root)).is_ok());
}

#[test]
fn path_projection_caps_each_display_list_and_sets_one_conservative_truncation_bit() {
    let mut projection = PathProjection::default();
    for index in 0..=MAX_HISTORY_PATHS {
        super::push_bounded(
            &mut projection.working_tree,
            &GitPathBuf::from_bytes(format!("file-{index}").into_bytes()),
            &mut projection.truncated,
        );
    }
    assert_eq!(projection.working_tree.len(), MAX_HISTORY_PATHS);
    assert!(projection.truncated);
}

#[cfg(unix)]
#[test]
fn cancel_reaches_the_real_inflight_merge_and_returns_fresh_not_rollback_state() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, Instant};

    if !git_available() {
        return;
    }
    let repo = init_repo();
    raw_git(repo.path(), &["switch", "--quiet", "-c", "topic"]);
    let topic = commit_file(repo.path(), "topic.txt", b"topic\n", "topic");
    raw_git(repo.path(), &["switch", "--quiet", "main"]);
    commit_file(repo.path(), "main.txt", b"main\n", "main");

    let started = repo.path().join("hook-started");
    let stop = repo.path().join("hook-stop");
    let hook = repo.path().join(".git/hooks/pre-merge-commit");
    std::fs::write(
        &hook,
        b"#!/bin/sh\ntouch hook-started\nwhile [ ! -f hook-stop ]; do sleep 0.01; done\nsleep 1\n",
    )
    .unwrap();
    let mut permissions = std::fs::metadata(&hook).unwrap().permissions();
    permissions.set_mode(0o700);
    std::fs::set_permissions(&hook, permissions).unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace(repo.path(), trust_base.path());
    let service = GitHistoryOperationService::new();
    let prepared = block_on(preview(
        &trust,
        &workspace,
        "main",
        HistoryOperation::Merge,
        &topic,
    ))
    .unwrap();

    let outcome = std::thread::scope(|scope| {
        scope.spawn(|| {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !started.exists() {
                assert!(Instant::now() < deadline, "merge hook did not start");
                std::thread::sleep(Duration::from_millis(5));
            }
            service.request_cancel("main", None);
            std::fs::write(&stop, b"stop").unwrap();
        });
        block_on(merge(
            &trust,
            &workspace,
            &service,
            "main",
            &topic,
            &prepared.preview_token,
        ))
        .unwrap()
    });
    assert_eq!(outcome.kind, HistoryMutationOutcomeKind::Cancelled);
    assert_eq!(
        outcome.state.head_sha,
        raw_git_text(repo.path(), &["rev-parse", "HEAD"])
    );
    if let Some(sequencer) = outcome.state.sequencer {
        assert_eq!(sequencer.kind, SequencerKind::Merge);
    }
}
