use std::collections::VecDeque;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Barrier, Mutex};
use std::time::{Duration, Instant};

use tempfile::TempDir;

use super::WorkspaceService;
use crate::error::CommandError;
use crate::path_policy::RelativePath;
use crate::remote::session::RemoteSessionService;
use crate::workspace::dto::{
    WorkspaceDeleteIncompleteReason, WorkspaceDeleteResult, WorkspaceEntryKind,
    WorkspacePickRootsMode, WorkspacePickRootsStatus, WorkspaceRestoreStatus,
};
#[cfg(target_os = "macos")]
use crate::workspace::dto::{WorkspaceTrashIncompleteReason, WorkspaceTrashResult};
use crate::workspace::picker::{
    DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult, FilePicker, FilePickerFuture,
    FilePickerResult, SaveFilePicker, SaveFilePickerFuture, SaveFilePickerResult,
};
#[cfg(target_os = "macos")]
use crate::workspace::trash::{PlatformTrash, PlatformTrashOutcome, PlatformTrashRequest};
use crate::workspace::{RootId, MAX_WORKSPACE_ROOTS};

/// `F220` S3: every workspace FS/delete `WorkspaceService` method now takes
/// a `&RemoteSessionService` (to dispatch a remote-backed root — see
/// `WorkspaceService::remote_context`); this whole file's tests exercise
/// only *local* roots, so each call site gets its own throwaway instance
/// via this helper, exactly the same way every other test call constructs
/// throwaway fixtures rather than sharing state across tests. The
/// known-hosts base path is never actually touched (created lazily, only
/// by a real connect/pin/list call, none of which any test in this file
/// performs) — an arbitrary, guaranteed-unique path is enough.
fn remote_service_for_test() -> RemoteSessionService {
    RemoteSessionService::new(std::env::temp_dir().join(format!(
        "plain-workspace-service-tests-remote-{}",
        uuid::Uuid::new_v4()
    )))
}

enum FakeOutcome {
    Selected(Vec<PathBuf>),
    Cancelled,
}

struct FakePicker {
    outcomes: Mutex<VecDeque<FakeOutcome>>,
}

impl FakePicker {
    fn selected(paths: Vec<PathBuf>) -> Self {
        Self {
            outcomes: Mutex::new(VecDeque::from([FakeOutcome::Selected(paths)])),
        }
    }

    fn cancelled() -> Self {
        Self {
            outcomes: Mutex::new(VecDeque::from([FakeOutcome::Cancelled])),
        }
    }
}

struct ModeCheckingPicker {
    expected_allow_multiple: bool,
    paths: Vec<PathBuf>,
}

impl ModeCheckingPicker {
    fn new(expected_allow_multiple: bool, paths: Vec<PathBuf>) -> Self {
        Self {
            expected_allow_multiple,
            paths,
        }
    }
}

impl DirectoryPicker for ModeCheckingPicker {
    fn pick_directories(&self, allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        assert_eq!(allow_multiple, self.expected_allow_multiple);
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let outcome = self
            .outcomes
            .lock()
            .expect("fake picker lock")
            .pop_front()
            .expect("fake picker outcome");
        Box::pin(async move {
            Ok(match outcome {
                FakeOutcome::Selected(paths) => DirectoryPickerResult::Selected(paths),
                FakeOutcome::Cancelled => DirectoryPickerResult::Cancelled,
            })
        })
    }
}

struct FakeFilePicker {
    outcome: Mutex<Option<FilePickerResult>>,
}

impl FakeFilePicker {
    fn selected(paths: Vec<PathBuf>) -> Self {
        Self {
            outcome: Mutex::new(Some(FilePickerResult::Selected(paths))),
        }
    }

    fn cancelled() -> Self {
        Self {
            outcome: Mutex::new(Some(FilePickerResult::Cancelled)),
        }
    }
}

impl FilePicker for FakeFilePicker {
    fn pick_files(&self) -> FilePickerFuture<'_> {
        let outcome = self.outcome.lock().unwrap().take().unwrap();
        Box::pin(async move { Ok(outcome) })
    }
}

struct FakeSaveFilePicker {
    expected_suggested_name: String,
    outcome: Mutex<Option<SaveFilePickerResult>>,
}

impl FakeSaveFilePicker {
    fn selected(expected_suggested_name: &str, path: PathBuf) -> Self {
        Self {
            expected_suggested_name: expected_suggested_name.to_owned(),
            outcome: Mutex::new(Some(SaveFilePickerResult::Selected(path))),
        }
    }

    fn cancelled(expected_suggested_name: &str) -> Self {
        Self {
            expected_suggested_name: expected_suggested_name.to_owned(),
            outcome: Mutex::new(Some(SaveFilePickerResult::Cancelled)),
        }
    }
}

impl SaveFilePicker for FakeSaveFilePicker {
    fn pick_file(&self, suggested_name: &str) -> SaveFilePickerFuture<'_> {
        assert_eq!(suggested_name, self.expected_suggested_name);
        let outcome = self.outcome.lock().unwrap().take().unwrap();
        Box::pin(async move { Ok(outcome) })
    }
}

#[derive(Clone)]
struct GatedPicker {
    entered: Arc<Barrier>,
    release: Arc<Barrier>,
    paths: Vec<PathBuf>,
}

impl DirectoryPicker for GatedPicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let entered = Arc::clone(&self.entered);
        let release = Arc::clone(&self.release);
        let paths = self.paths.clone();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || {
                entered.wait();
                release.wait();
                DirectoryPickerResult::Selected(paths)
            })
            .await
            .map_err(|_| CommandError::new("TEST_FAILED", "The fake picker failed."))
        })
    }
}

#[test]
fn cancellation_preserves_the_exact_snapshot() {
    let service = WorkspaceService::new();
    let before = service.snapshot("main").unwrap();
    let result =
        block_on(service.pick_roots("main", FakePicker::cancelled(), WorkspacePickRootsMode::Add))
            .unwrap();

    assert_eq!(result.status(), WorkspacePickRootsStatus::Cancelled);
    assert_eq!(result.snapshot(), &before);
    assert_eq!(service.snapshot("main").unwrap(), before);
}

#[test]
fn initial_snapshot_restores_the_complete_ordered_root_set_once() {
    let temp = TempDir::new().unwrap();
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let service = WorkspaceService::new();
    let restored = block_on(service.initial_snapshot_with_restore(
        "main",
        Ok(Some(vec![first, second])),
        Arc::new(|_| {}),
    ))
    .unwrap();
    assert_eq!(restored.revision(), 1);
    assert_eq!(restored.roots().len(), 2);
    assert_eq!(restored.roots()[0].display_name(), "first");
    assert_eq!(restored.roots()[1].display_name(), "second");
    assert_eq!(
        service.restore_status("main").unwrap(),
        WorkspaceRestoreStatus::Restored
    );

    let ignored_second_attempt =
        block_on(service.initial_snapshot_with_restore("main", Ok(None), Arc::new(|_| {})))
            .unwrap();
    assert_eq!(ignored_second_attempt, restored);
}

#[test]
fn close_folder_revokes_all_roots_once_and_keeps_other_windows_isolated() {
    let temp = TempDir::new().unwrap();
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let other = create_directory(&temp, "other");
    let service = WorkspaceService::new();
    let main = block_on(service.replace_roots_with_watch_sink(
        "main",
        vec![first, second],
        Arc::new(|_| {}),
    ))
    .unwrap();
    let other_window = block_on(service.pick_roots(
        "plain-window-test",
        FakePicker::selected(vec![other]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let before_revision = main.revision();
    let revoked_ids = main
        .roots()
        .iter()
        .map(|root| root.root_id())
        .collect::<Vec<_>>();

    let (cleared, changed) = service.close_folder("main").unwrap();
    assert!(changed);
    assert_eq!(cleared.revision(), before_revision + 1);
    assert!(cleared.roots().is_empty());
    for root_id in revoked_ids {
        assert_eq!(
            service
                .root_canonical_path("main", root_id)
                .unwrap_err()
                .code(),
            "ROOT_NOT_AUTHORIZED"
        );
    }
    assert_eq!(
        service.snapshot("plain-window-test").unwrap(),
        *other_window.snapshot()
    );

    let (unchanged, changed_again) = service.close_folder("main").unwrap();
    assert!(!changed_again);
    assert_eq!(unchanged, cleared);
}

#[test]
fn close_folder_cancels_the_active_text_search() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("a.txt"), b"needle").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let start = service
        .search_text_start("main", text_query(root_id, "needle"), noop_search_wake())
        .unwrap();
    let search_id = extract_search_id(&start);

    assert!(service.close_folder("main").unwrap().1);
    assert_eq!(
        service
            .search_text_poll("main", search_id, 0)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND"
    );
}

#[test]
fn failed_initial_restore_is_path_free_empty_and_does_not_guess_another_root() {
    let temp = TempDir::new().unwrap();
    let valid = create_directory(&temp, "valid-but-not-last");
    let missing = temp.path().join("missing-last");
    let service = WorkspaceService::new();
    let restored = block_on(service.initial_snapshot_with_restore(
        "main",
        Ok(Some(vec![missing])),
        Arc::new(|_| {}),
    ))
    .unwrap();
    assert!(restored.roots().is_empty());
    assert_eq!(restored.revision(), 0);
    assert_eq!(
        service.restore_status("main").unwrap(),
        WorkspaceRestoreStatus::Failed
    );
    assert!(valid.exists());
}

#[test]
fn recent_replacement_is_all_or_nothing_and_preserves_order() {
    let temp = TempDir::new().unwrap();
    let current = create_directory(&temp, "current");
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let missing = temp.path().join("missing");
    let service = WorkspaceService::new();
    let initial = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![current]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();

    let replaced = block_on(service.replace_roots_with_watch_sink(
        "main",
        vec![second, first],
        Arc::new(|_| {}),
    ))
    .unwrap();
    assert_eq!(replaced.revision(), initial.snapshot().revision() + 1);
    assert_eq!(replaced.roots()[0].display_name(), "second");
    assert_eq!(replaced.roots()[1].display_name(), "first");

    let before_failure = service.snapshot("main").unwrap();
    let error = block_on(service.replace_roots_with_watch_sink(
        "main",
        vec![temp.path().join("first"), missing],
        Arc::new(|_| {}),
    ))
    .unwrap_err();
    assert_eq!(error.code(), "ROOT_UNAVAILABLE");
    assert_eq!(service.snapshot("main").unwrap(), before_failure);
}

#[test]
fn open_file_cancel_preserves_topology_and_selected_parents_are_explicit_roots() {
    let temp = TempDir::new().unwrap();
    let first_parent = create_directory(&temp, "first-parent");
    let second_parent = create_directory(&temp, "second-parent");
    let first = first_parent.join("first.txt");
    let sibling = first_parent.join("sibling.txt");
    let second = second_parent.join("second.txt");
    std::fs::write(&first, b"first").unwrap();
    std::fs::write(&sibling, b"sibling").unwrap();
    std::fs::write(&second, b"second").unwrap();
    let service = WorkspaceService::new();

    let cancelled = block_on(service.pick_files_with_watch_sink(
        "main",
        FakeFilePicker::cancelled(),
        Arc::new(|_| {}),
    ))
    .unwrap();
    assert_eq!(cancelled.status(), WorkspacePickRootsStatus::Cancelled);
    assert!(cancelled.snapshot().roots().is_empty());
    assert!(cancelled.files().is_empty());

    let opened = block_on(service.pick_files_with_watch_sink(
        "main",
        FakeFilePicker::selected(vec![first, sibling, second]),
        Arc::new(|_| {}),
    ))
    .unwrap();
    assert_eq!(opened.status(), WorkspacePickRootsStatus::Selected);
    assert_eq!(opened.snapshot().roots().len(), 2);
    assert_eq!(opened.files().len(), 3);
    assert_eq!(opened.files()[0].relative_path().as_wire(), "first.txt");
    assert_eq!(opened.files()[1].relative_path().as_wire(), "sibling.txt");
    assert_eq!(opened.files()[2].relative_path().as_wire(), "second.txt");
    assert_eq!(opened.files()[0].root_id(), opened.files()[1].root_id());
    assert_ne!(opened.files()[0].root_id(), opened.files()[2].root_id());
}

#[test]
fn one_invalid_open_file_rejects_the_complete_parent_adoption() {
    let temp = TempDir::new().unwrap();
    let parent = create_directory(&temp, "parent");
    let valid = parent.join("valid.txt");
    std::fs::write(&valid, b"valid").unwrap();
    let missing = parent.join("missing.txt");
    let service = WorkspaceService::new();

    let error = block_on(service.pick_files_with_watch_sink(
        "main",
        FakeFilePicker::selected(vec![valid, missing]),
        Arc::new(|_| {}),
    ))
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_FILE_UNAVAILABLE");
    assert!(service.snapshot("main").unwrap().roots().is_empty());
}

#[test]
fn save_target_cancel_preserves_topology_and_selection_adopts_only_the_parent() {
    let temp = TempDir::new().unwrap();
    let parent = create_directory(&temp, "save-parent");
    let service = WorkspaceService::new();
    let before = service.snapshot("main").unwrap();

    let cancelled = block_on(service.pick_save_target_with_watch_sink(
        "main",
        FakeSaveFilePicker::cancelled("Untitled-1.txt"),
        "Untitled-1.txt".to_owned(),
        Arc::new(|_| {}),
    ))
    .unwrap();
    assert_eq!(cancelled.status(), WorkspacePickRootsStatus::Cancelled);
    assert_eq!(cancelled.snapshot(), &before);
    assert!(cancelled.target().is_none());

    let selected = block_on(service.pick_save_target_with_watch_sink(
        "main",
        FakeSaveFilePicker::selected("Untitled-1.txt", parent.join("draft.txt")),
        "Untitled-1.txt".to_owned(),
        Arc::new(|_| {}),
    ))
    .unwrap();
    let target = selected.target().unwrap();
    assert_eq!(selected.status(), WorkspacePickRootsStatus::Selected);
    assert_eq!(selected.snapshot().roots().len(), 1);
    assert_eq!(target.root_id(), selected.snapshot().roots()[0].root_id());
    assert_eq!(target.relative_path().as_wire(), "draft.txt");
    assert!(target.existing_stat().is_none());
    assert!(!parent.join("draft.txt").exists());
}

#[test]
fn save_target_returns_the_existing_version_receipt_without_writing() {
    let temp = TempDir::new().unwrap();
    let parent = create_directory(&temp, "save-parent");
    let target_path = parent.join("existing.txt");
    std::fs::write(&target_path, b"old bytes").unwrap();
    let service = WorkspaceService::new();

    let selected = block_on(service.pick_save_target_with_watch_sink(
        "main",
        FakeSaveFilePicker::selected("existing.txt", target_path.clone()),
        "existing.txt".to_owned(),
        Arc::new(|_| {}),
    ))
    .unwrap();
    let target = selected.target().unwrap();
    let stat = target.existing_stat().unwrap();
    assert_eq!(stat.kind(), WorkspaceEntryKind::File);
    assert!(stat.version().is_some());
    assert_eq!(std::fs::read(target_path).unwrap(), b"old bytes");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn save_target_new_file_publication_is_exact_and_no_replace() {
    let temp = TempDir::new().unwrap();
    let parent = create_directory(&temp, "save-parent");
    let target_path = parent.join("draft.bin");
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_save_target_with_watch_sink(
        "main",
        FakeSaveFilePicker::selected("draft.bin", target_path.clone()),
        "draft.bin".to_owned(),
        Arc::new(|_| {}),
    ))
    .unwrap();
    let target = selected.target().unwrap();
    let content = vec![0, 0x41, 0xff, 0x0a];

    let result = block_on(service.publish_file(
        "main",
        target.root_id(),
        target.relative_path().clone(),
        content.clone(),
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(result.written_stat().unwrap().size(), content.len() as u64);
    assert_eq!(std::fs::read(&target_path).unwrap(), content);

    let error = block_on(service.publish_file(
        "main",
        target.root_id(),
        target.relative_path().clone(),
        b"replacement".to_vec(),
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(error.code(), "ENTRY_ALREADY_EXISTS");
    assert_eq!(std::fs::read(target_path).unwrap(), [0, 0x41, 0xff, 0x0a]);
}

#[test]
fn picker_multiplicity_is_derived_from_the_explicit_mode() {
    let temp = TempDir::new().unwrap();
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let service = WorkspaceService::new();

    block_on(service.pick_roots(
        "main",
        ModeCheckingPicker::new(false, vec![first]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    block_on(service.pick_roots(
        "main",
        ModeCheckingPicker::new(true, vec![second]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
}

#[test]
fn multi_selection_registers_roots_in_stable_authorization_order() {
    let temp = TempDir::new().unwrap();
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let service = WorkspaceService::new();

    let result = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![first, second]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();

    assert_eq!(result.status(), WorkspacePickRootsStatus::Selected);
    assert_eq!(result.snapshot().revision(), 1);
    assert_eq!(result.snapshot().roots().len(), 2);
    assert_eq!(result.snapshot().roots()[0].display_name(), "first");
    assert_eq!(result.snapshot().roots()[1].display_name(), "second");
}

#[test]
fn watcher_sync_is_sticky_window_scoped_and_rescans_after_resume() {
    let temp = TempDir::new().unwrap();
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let service = WorkspaceService::new();
    let (wake_sender, wake_receiver) = mpsc::channel();

    let selected = block_on(service.pick_roots_with_watch_sink(
        "main",
        FakePicker::selected(vec![first, second]),
        WorkspacePickRootsMode::Add,
        Arc::new(move |workspace_id| {
            let _ = wake_sender.send(workspace_id);
        }),
    ))
    .unwrap();
    let workspace_id = selected.snapshot().workspace_id();
    let first_root_id = selected.snapshot().roots()[0].root_id();
    let second_root_id = selected.snapshot().roots()[1].root_id();
    assert_eq!(
        wake_receiver.recv_timeout(Duration::from_secs(3)).unwrap(),
        workspace_id
    );

    let first_pending = block_on(service.watch_sync("main", vec![(first_root_id, None)])).unwrap();
    assert_eq!(first_pending.workspace_id(), workspace_id);
    assert_eq!(first_pending.roots().len(), 1);
    let first_generation = first_pending.roots()[0].generation();
    assert_eq!(first_pending.roots()[0].root_id(), first_root_id);
    assert!(first_pending.roots()[0].rescan_required());

    let sticky = block_on(service.watch_sync("main", vec![(first_root_id, None)])).unwrap();
    assert_eq!(sticky, first_pending);

    let second_pending =
        block_on(service.watch_sync("main", vec![(second_root_id, None)])).unwrap();
    assert_eq!(second_pending.roots().len(), 1);
    let second_generation = second_pending.roots()[0].generation();
    assert_eq!(second_pending.roots()[0].root_id(), second_root_id);
    assert!(second_pending.roots()[0].rescan_required());

    let unknown = block_on(service.watch_sync("main", vec![(RootId::new(), None)])).unwrap();
    assert!(unknown.roots().is_empty());
    assert!(
        block_on(service.watch_sync("main", vec![(first_root_id, Some(first_generation))]))
            .unwrap()
            .roots()
            .is_empty()
    );
    assert!(
        block_on(service.watch_sync("main", vec![(second_root_id, Some(second_generation))]))
            .unwrap()
            .roots()
            .is_empty()
    );

    while wake_receiver.try_recv().is_ok() {}
    service.mark_all_watchers_rescan();
    assert_eq!(
        wake_receiver.recv_timeout(Duration::from_secs(3)).unwrap(),
        workspace_id
    );
    let resumed = block_on(service.watch_sync(
        "main",
        vec![
            (first_root_id, Some(first_generation)),
            (second_root_id, Some(second_generation)),
        ],
    ))
    .unwrap();
    assert_eq!(resumed.roots().len(), 2);
    for root in resumed.roots() {
        assert!(root.rescan_required());
        if root.root_id() == first_root_id {
            assert!(root.generation() > first_generation);
        } else {
            assert_eq!(root.root_id(), second_root_id);
            assert!(root.generation() > second_generation);
        }
    }

    service.remove_root("main", second_root_id).unwrap();
    let removed =
        block_on(service.watch_sync("main", vec![(second_root_id, Some(second_generation))]))
            .unwrap();
    assert!(removed.roots().is_empty());
}

#[test]
fn a_failed_multi_selection_registers_none_of_its_roots() {
    let temp = TempDir::new().unwrap();
    let valid = create_directory(&temp, "valid");
    let missing = temp.path().join("private-name-missing");
    let service = WorkspaceService::new();

    let error = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![valid.clone(), missing]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "ROOT_UNAVAILABLE");
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains(temp.path().to_str().unwrap()));

    let unchanged = service.snapshot("main").unwrap();
    assert_eq!(unchanged.revision(), 0);
    assert!(unchanged.roots().is_empty());

    let retried = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![valid]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(retried.snapshot().revision(), 1);
    assert_eq!(retried.snapshot().roots().len(), 1);
}

#[test]
fn picker_paths_must_be_absolute_native_selections() {
    let service = WorkspaceService::new();
    let error = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![PathBuf::from("relative-root")]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap_err();

    assert_eq!(error.code(), "ROOT_UNAVAILABLE");
    assert_eq!(service.snapshot("main").unwrap().revision(), 0);
}

#[test]
fn duplicate_directory_identities_reuse_the_first_root_and_revision() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = WorkspaceService::new();

    let first = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone(), root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    assert_eq!(first.snapshot().revision(), 1);
    assert_eq!(first.snapshot().roots().len(), 1);
    let root_id = first.snapshot().roots()[0].root_id();

    let duplicate = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(duplicate.status(), WorkspacePickRootsStatus::Selected);
    assert_eq!(duplicate.snapshot().revision(), 1);
    assert_eq!(duplicate.snapshot().roots()[0].root_id(), root_id);
}

#[test]
fn replace_with_an_existing_root_revokes_others_and_reuses_identity() {
    let temp = TempDir::new().unwrap();
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let service = WorkspaceService::new();

    let added = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![first.clone(), second]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let first_id = added.snapshot().roots()[0].root_id();
    let second_id = added.snapshot().roots()[1].root_id();

    let replaced = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![first.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(replaced.snapshot().revision(), 2);
    assert_eq!(replaced.snapshot().roots().len(), 1);
    assert_eq!(replaced.snapshot().roots()[0].root_id(), first_id);
    assert_eq!(replaced.snapshot().roots()[0].display_name(), "first");
    assert_eq!(
        service.remove_root("main", second_id).unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );

    let reopened = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![first]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(reopened.snapshot(), replaced.snapshot());
}

#[test]
fn replace_with_a_new_root_revokes_the_old_root_atomically() {
    let temp = TempDir::new().unwrap();
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let service = WorkspaceService::new();

    let initial = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![first]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let first_id = initial.snapshot().roots()[0].root_id();

    let replaced = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![second]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(replaced.snapshot().revision(), 2);
    assert_eq!(replaced.snapshot().roots().len(), 1);
    assert_ne!(replaced.snapshot().roots()[0].root_id(), first_id);
    assert_eq!(
        service.remove_root("main", first_id).unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );
}

#[test]
fn replace_cancel_empty_and_authorization_failure_preserve_the_exact_snapshot() {
    let temp = TempDir::new().unwrap();
    let existing = create_directory(&temp, "existing");
    let missing = temp.path().join("private-missing-root");
    let service = WorkspaceService::new();
    block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![existing]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let before = service.snapshot("main").unwrap();

    let cancelled = block_on(service.pick_roots(
        "main",
        FakePicker::cancelled(),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(cancelled.status(), WorkspacePickRootsStatus::Cancelled);
    assert_eq!(cancelled.snapshot(), &before);

    let empty = block_on(service.pick_roots(
        "main",
        FakePicker::selected(Vec::new()),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(empty.status(), WorkspacePickRootsStatus::Cancelled);
    assert_eq!(empty.snapshot(), &before);

    let error = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![missing]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "ROOT_UNAVAILABLE");
    assert_eq!(service.snapshot("main").unwrap(), before);
}

#[test]
fn replace_rejects_multiple_picker_paths_without_state_or_path_disclosure() {
    let temp = TempDir::new().unwrap();
    let existing = create_directory(&temp, "existing");
    let private_first = create_directory(&temp, "private-first");
    let private_second = create_directory(&temp, "private-second");
    let service = WorkspaceService::new();
    block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![existing.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let before = service.snapshot("main").unwrap();

    let error = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![private_first, private_second]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_PICK_INVALID_SELECTION");
    assert_eq!(
        error.message(),
        "The workspace folder picker returned an invalid selection."
    );
    let serialized = serde_json::to_string(&error).unwrap();
    assert!(!serialized.contains("private-first"));
    assert!(!serialized.contains("private-second"));
    assert!(!serialized.contains(temp.path().to_str().unwrap()));
    assert_eq!(service.snapshot("main").unwrap(), before);

    let retry = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![existing]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(retry.snapshot(), &before);
}

#[test]
fn root_limit_counts_existing_and_deduplicated_selections_atomically() {
    let temp = TempDir::new().unwrap();
    let initial_roots = (0..255)
        .map(|index| create_directory(&temp, &format!("initial-{index}")))
        .collect::<Vec<_>>();
    let existing_duplicate = initial_roots[0].clone();
    let boundary_root = create_directory(&temp, "boundary-root");
    let overflow_root = create_directory(&temp, "private-overflow-root");
    let service = WorkspaceService::new();

    let initial = block_on(service.pick_roots(
        "main",
        FakePicker::selected(initial_roots),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    assert_eq!(initial.snapshot().revision(), 1);
    assert_eq!(initial.snapshot().roots().len(), 255);

    let boundary = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![
            existing_duplicate.clone(),
            boundary_root.clone(),
            boundary_root,
        ]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    assert_eq!(boundary.snapshot().revision(), 2);
    assert_eq!(boundary.snapshot().roots().len(), 256);
    let before_overflow = boundary.snapshot().clone();

    let error = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![
            existing_duplicate,
            overflow_root.clone(),
            overflow_root,
        ]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_ROOT_LIMIT_EXCEEDED");
    assert_eq!(
        error.message(),
        "The workspace root limit has been exceeded."
    );
    let serialized = serde_json::to_string(&error).unwrap();
    assert!(!serialized.contains("private-overflow-root"));
    assert!(!serialized.contains(temp.path().to_str().unwrap()));
    assert_eq!(service.snapshot("main").unwrap(), before_overflow);
}

#[test]
fn root_limit_rejects_oversized_picker_results_before_authorization() {
    let temp = TempDir::new().unwrap();
    let duplicate = create_directory(&temp, "private-repeated-root");
    let service = WorkspaceService::new();
    let before = service.snapshot("main").unwrap();

    let error = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![duplicate; MAX_WORKSPACE_ROOTS + 1]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap_err();

    assert_eq!(error.code(), "WORKSPACE_ROOT_LIMIT_EXCEEDED");
    assert_eq!(service.snapshot("main").unwrap(), before);
}

#[test]
fn windows_have_independent_scopes_and_revocation() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "shared-root");
    let service = WorkspaceService::new();

    let first = block_on(service.pick_roots(
        "first-window",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap()
    .snapshot()
    .clone();
    let second = block_on(service.pick_roots(
        "second-window",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap()
    .snapshot()
    .clone();

    assert_ne!(first.workspace_id(), second.workspace_id());
    assert_ne!(first.roots()[0].root_id(), second.roots()[0].root_id());
    let removed = service
        .remove_root("first-window", first.roots()[0].root_id())
        .unwrap();
    assert!(removed.roots().is_empty());
    assert_eq!(removed.revision(), 2);
    assert_eq!(service.snapshot("second-window").unwrap(), second);
}

#[test]
fn only_one_picker_can_be_active_per_window() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = Arc::new(WorkspaceService::new());
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let picker = GatedPicker {
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
        paths: vec![root],
    };

    let first_service = Arc::clone(&service);
    let first = tauri::async_runtime::spawn(async move {
        first_service
            .pick_roots("main", picker, WorkspacePickRootsMode::Replace)
            .await
    });
    entered.wait();

    let conflict = block_on(service.pick_roots(
        "main",
        FakePicker::cancelled(),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap_err();
    assert_eq!(conflict.code(), "WORKSPACE_CONFLICT");
    release.wait();
    let completed = block_on(first).unwrap().unwrap();
    assert_eq!(completed.snapshot().roots().len(), 1);
}

#[test]
fn a_picker_result_arriving_after_window_close_is_discarded() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "late-root");
    let service = Arc::new(WorkspaceService::new());
    let original_workspace_id = service.snapshot("main").unwrap().workspace_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let picker = GatedPicker {
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
        paths: vec![root],
    };

    let pick_service = Arc::clone(&service);
    let pending = tauri::async_runtime::spawn(async move {
        pick_service
            .pick_roots("main", picker, WorkspacePickRootsMode::Replace)
            .await
    });
    entered.wait();
    service.close_window("main");
    release.wait();

    let error = block_on(pending).unwrap().unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_WINDOW_CLOSED");
    let replacement = service.snapshot("main").unwrap();
    assert_ne!(replacement.workspace_id(), original_workspace_id);
    assert_eq!(replacement.revision(), 0);
    assert!(replacement.roots().is_empty());
}

#[test]
fn serialized_snapshots_contain_only_owned_opaque_root_fields() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "private-root-name");
    let service = WorkspaceService::new();
    let result = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();

    let value = serde_json::to_value(&result).unwrap();
    let serialized = serde_json::to_string(&value).unwrap();
    assert!(!serialized.contains(temp.path().to_str().unwrap()));
    assert_eq!(value["status"], "selected");
    let root = value["snapshot"]["roots"][0].as_object().unwrap();
    let mut keys = root.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(keys, ["displayName", "rootId", "uri"]);
    assert_eq!(root["displayName"], "private-root-name");
    let root_id = root["rootId"].as_str().unwrap();
    assert_eq!(root["uri"], format!("plain-workspace://{root_id}/"));
}

#[cfg(unix)]
#[test]
fn non_utf8_selected_paths_fail_with_a_sanitized_encoding_error() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let temp = TempDir::new().unwrap();
    let root = temp
        .path()
        .join(OsString::from_vec(b"private-\xFF-root".to_vec()));
    let service = WorkspaceService::new();

    let error = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "PATH_ENCODING_UNSUPPORTED");
    let serialized = serde_json::to_string(&error).unwrap();
    assert!(!serialized.contains("private"));
    assert_eq!(service.snapshot("main").unwrap().revision(), 0);
}

#[test]
fn readers_are_isolated_by_window_and_root_id() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "shared-root");
    std::fs::write(root.join("identity.txt"), b"plain").unwrap();
    let service = WorkspaceService::new();

    let first = block_on(service.pick_roots(
        "first",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let second = block_on(service.pick_roots(
        "second",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let first_id = first.snapshot().roots()[0].root_id();
    let second_id = second.snapshot().roots()[0].root_id();

    let stat = block_on(service.stat(
        "first",
        first_id,
        RelativePath::parse_wire("identity.txt").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(stat.kind(), WorkspaceEntryKind::File);
    assert_eq!(stat.size(), 5);
    assert_eq!(
        block_on(service.stat(
            "second",
            first_id,
            RelativePath::parse_wire("identity.txt").unwrap(),
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "ROOT_NOT_AUTHORIZED"
    );
    assert!(block_on(service.read_directory(
        "second",
        second_id,
        RelativePath::parse_wire("").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap()
    .entries()
    .iter()
    .any(|entry| entry.name() == "identity.txt"));
}

#[test]
fn creators_are_isolated_by_window_and_root_id() {
    let temp = TempDir::new().unwrap();
    let first_root = create_directory(&temp, "first-root");
    let second_root = create_directory(&temp, "second-root");
    let service = WorkspaceService::new();

    let first = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![first_root.clone(), second_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let first_id = first.snapshot().roots()[0].root_id();
    let second_id = first.snapshot().roots()[1].root_id();

    let file_receipt = block_on(service.create_file(
        "main",
        first_id,
        RelativePath::parse_wire("created.txt").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap();
    let directory_receipt = block_on(service.create_directory(
        "main",
        second_id,
        RelativePath::parse_wire("created-dir").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap();

    assert_eq!(
        file_receipt.kind(),
        crate::workspace::dto::WorkspaceEntryKind::File
    );
    assert_eq!(
        directory_receipt.kind(),
        crate::workspace::dto::WorkspaceEntryKind::Directory
    );
    assert_eq!(file_receipt.size(), 0);
    assert_eq!(directory_receipt.size(), 0);
    assert_eq!(file_receipt.version(), None);
    assert_eq!(directory_receipt.version(), None);

    assert!(first_root.join("created.txt").is_file());
    assert!(!second_root.join("created.txt").exists());
    assert!(second_root.join("created-dir").is_dir());
    assert!(!first_root.join("created-dir").exists());

    let wrong_window = block_on(service.create_file(
        "other-window",
        first_id,
        RelativePath::parse_wire("private.txt").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(wrong_window.code(), "ROOT_NOT_AUTHORIZED");
    assert!(!first_root.join("private.txt").exists());

    service.remove_root("main", first_id).unwrap();
    let revoked = block_on(service.create_file(
        "main",
        first_id,
        RelativePath::parse_wire("revoked.txt").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(revoked.code(), "ROOT_NOT_AUTHORIZED");
    assert!(!first_root.join("revoked.txt").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn renames_are_isolated_by_window_and_root_id() {
    let temp = TempDir::new().unwrap();
    let first_root = create_directory(&temp, "first-root");
    let second_root = create_directory(&temp, "second-root");
    std::fs::write(first_root.join("source"), b"first").unwrap();
    std::fs::write(second_root.join("source"), b"second").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![first_root.clone(), second_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let first_id = selected.snapshot().roots()[0].root_id();
    let second_id = selected.snapshot().roots()[1].root_id();

    block_on(service.rename(
        "main",
        first_id,
        relative("source"),
        relative("renamed"),
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(std::fs::read(first_root.join("renamed")).unwrap(), b"first");
    assert_eq!(
        std::fs::read(second_root.join("source")).unwrap(),
        b"second"
    );

    let wrong_window = block_on(service.rename(
        "other-window",
        second_id,
        relative("source"),
        relative("private"),
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(wrong_window.code(), "ROOT_NOT_AUTHORIZED");
    assert!(!second_root.join("private").exists());

    service.remove_root("main", second_id).unwrap();
    let revoked = block_on(service.rename(
        "main",
        second_id,
        relative("source"),
        relative("revoked"),
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(revoked.code(), "ROOT_NOT_AUTHORIZED");
    assert_eq!(
        std::fs::read(second_root.join("source")).unwrap(),
        b"second"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn root_revocation_winning_the_gate_prevents_rename() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("source"), b"source").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation_with_hook(
                "main",
                root_id,
                move || {
                    pending_entered.wait();
                    pending_release.wait();
                },
                move |lease| {
                    crate::workspace::writer::rename(
                        &lease,
                        &relative("source"),
                        &relative("target"),
                    )
                },
            )
            .await
    });
    entered.wait();

    assert!(service
        .remove_root("main", root_id)
        .unwrap()
        .roots()
        .is_empty());
    release.wait();

    assert_eq!(
        block_on(pending).unwrap().unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );
    assert_eq!(std::fs::read(root.join("source")).unwrap(), b"source");
    assert!(!root.join("target").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn rename_winning_the_gate_completes_before_root_revocation() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("source"), b"source").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation("main", root_id, move |lease| {
                pending_entered.wait();
                pending_release.wait();
                crate::workspace::writer::rename(&lease, &relative("source"), &relative("target"))
            })
            .await
    });
    entered.wait();

    let remove_service = Arc::clone(&service);
    let (removed_tx, removed_rx) = mpsc::channel();
    let remover = std::thread::spawn(move || {
        removed_tx
            .send(remove_service.remove_root("main", root_id))
            .unwrap();
    });
    assert!(removed_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release.wait();

    block_on(pending).unwrap().unwrap();
    assert!(removed_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap()
        .roots()
        .is_empty());
    remover.join().unwrap();
    assert_eq!(std::fs::read(root.join("target")).unwrap(), b"source");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn window_close_winning_the_gate_prevents_rename() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("source"), b"source").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation_with_hook(
                "main",
                root_id,
                move || {
                    pending_entered.wait();
                    pending_release.wait();
                },
                move |lease| {
                    crate::workspace::writer::rename(
                        &lease,
                        &relative("source"),
                        &relative("target"),
                    )
                },
            )
            .await
    });
    entered.wait();

    service.close_window("main");
    release.wait();

    assert_eq!(
        block_on(pending).unwrap().unwrap_err().code(),
        "WORKSPACE_WINDOW_CLOSED"
    );
    assert_eq!(std::fs::read(root.join("source")).unwrap(), b"source");
    assert!(!root.join("target").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn rename_winning_the_gate_completes_before_window_close() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("source"), b"source").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation("main", root_id, move |lease| {
                pending_entered.wait();
                pending_release.wait();
                crate::workspace::writer::rename(&lease, &relative("source"), &relative("target"))
            })
            .await
    });
    entered.wait();

    let close_service = Arc::clone(&service);
    let (closed_tx, closed_rx) = mpsc::channel();
    let closer = std::thread::spawn(move || {
        close_service.close_window("main");
        closed_tx.send(()).unwrap();
    });
    assert!(closed_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release.wait();

    block_on(pending).unwrap().unwrap();
    closed_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    closer.join().unwrap();
    assert_eq!(std::fs::read(root.join("target")).unwrap(), b"source");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn copies_are_isolated_by_window_and_both_root_ids() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let source_root = create_directory(&temp, "source-root");
    let target_root = create_directory(&temp, "target-root");
    std::fs::write(source_root.join("source"), b"source").unwrap();
    symlink("missing-payload", source_root.join("source-link")).unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![source_root.clone(), target_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let source_id = selected.snapshot().roots()[0].root_id();
    let target_id = selected.snapshot().roots()[1].root_id();

    block_on(service.copy_entry(
        "main",
        source_id,
        relative("source"),
        target_id,
        relative("target"),
    ))
    .unwrap();
    assert_eq!(
        std::fs::read(target_root.join("target")).unwrap(),
        b"source"
    );
    assert_eq!(
        std::fs::read(source_root.join("source")).unwrap(),
        b"source"
    );

    block_on(service.copy_entry(
        "main",
        source_id,
        relative("source-link"),
        target_id,
        relative("target-link"),
    ))
    .unwrap();
    assert_eq!(
        std::fs::read_link(target_root.join("target-link")).unwrap(),
        PathBuf::from("missing-payload")
    );

    let wrong_window = block_on(service.copy_entry(
        "other-window",
        source_id,
        relative("source"),
        target_id,
        relative("private"),
    ))
    .unwrap_err();
    assert_eq!(wrong_window.code(), "ROOT_NOT_AUTHORIZED");
    assert!(!target_root.join("private").exists());

    service.remove_root("main", target_id).unwrap();
    let revoked = block_on(service.copy_entry(
        "main",
        source_id,
        relative("source"),
        target_id,
        relative("revoked"),
    ))
    .unwrap_err();
    assert_eq!(revoked.code(), "ROOT_NOT_AUTHORIZED");
    assert!(!target_root.join("revoked").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn moves_require_different_authorized_roots_and_return_the_terminal_state() {
    use crate::workspace::dto::WorkspaceMoveResult;

    let temp = TempDir::new().unwrap();
    let source_root = create_directory(&temp, "move-source-root");
    let target_root = create_directory(&temp, "move-target-root");
    std::fs::write(source_root.join("source"), b"source").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![source_root.clone(), target_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let source_id = selected.snapshot().roots()[0].root_id();
    let target_id = selected.snapshot().roots()[1].root_id();

    let same_root = block_on(service.move_entry(
        "main",
        source_id,
        relative("source"),
        source_id,
        relative("same-root"),
    ))
    .unwrap_err();
    assert_eq!(same_root.code(), "WORKSPACE_CONFLICT");
    assert!(!source_root.join("same-root").exists());

    let moved = block_on(service.move_entry(
        "main",
        source_id,
        relative("source"),
        target_id,
        relative("target"),
    ))
    .unwrap();
    assert_eq!(moved, WorkspaceMoveResult::Moved);
    assert!(!source_root.join("source").exists());
    assert_eq!(
        std::fs::read(target_root.join("target")).unwrap(),
        b"source"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn target_revocation_winning_the_gate_prevents_dual_root_copy() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let source_root = create_directory(&temp, "source-root");
    let target_root = create_directory(&temp, "target-root");
    symlink("source-payload", source_root.join("source")).unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![source_root, target_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let source_id = selected.snapshot().roots()[0].root_id();
    let target_id = selected.snapshot().roots()[1].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_dual_root_mutation_with_hook(
                "main",
                source_id,
                target_id,
                move || {
                    pending_entered.wait();
                    pending_release.wait();
                },
                move |source_lease, target_lease| {
                    crate::workspace::writer::copy_entry(
                        &source_lease,
                        &relative("source"),
                        &target_lease,
                        &relative("target"),
                    )
                },
            )
            .await
    });
    entered.wait();

    service.remove_root("main", target_id).unwrap();
    release.wait();

    assert_eq!(
        block_on(pending).unwrap().unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );
    assert_entry_absent(&target_root.join("target"));
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn root_replacement_winning_the_gate_prevents_dual_root_copy() {
    let temp = TempDir::new().unwrap();
    let source_root = create_directory(&temp, "source-root");
    let target_root = create_directory(&temp, "target-root");
    let replacement_root = create_directory(&temp, "replacement-root");
    std::fs::write(source_root.join("source"), b"source").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![source_root, target_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let source_id = selected.snapshot().roots()[0].root_id();
    let target_id = selected.snapshot().roots()[1].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_dual_root_mutation_with_hook(
                "main",
                source_id,
                target_id,
                move || {
                    pending_entered.wait();
                    pending_release.wait();
                },
                move |source_lease, target_lease| {
                    crate::workspace::writer::copy_regular_file(
                        &source_lease,
                        &relative("source"),
                        &target_lease,
                        &relative("target"),
                    )
                },
            )
            .await
    });
    entered.wait();

    let replaced = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![replacement_root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(replaced.snapshot().roots().len(), 1);
    release.wait();

    assert_eq!(
        block_on(pending).unwrap().unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );
    assert!(!target_root.join("target").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn window_close_winning_the_gate_prevents_dual_root_copy() {
    let temp = TempDir::new().unwrap();
    let source_root = create_directory(&temp, "source-root");
    let target_root = create_directory(&temp, "target-root");
    std::fs::write(source_root.join("source"), b"source").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![source_root, target_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let source_id = selected.snapshot().roots()[0].root_id();
    let target_id = selected.snapshot().roots()[1].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_dual_root_mutation_with_hook(
                "main",
                source_id,
                target_id,
                move || {
                    pending_entered.wait();
                    pending_release.wait();
                },
                move |source_lease, target_lease| {
                    crate::workspace::writer::copy_regular_file(
                        &source_lease,
                        &relative("source"),
                        &target_lease,
                        &relative("target"),
                    )
                },
            )
            .await
    });
    entered.wait();

    service.close_window("main");
    release.wait();

    assert_eq!(
        block_on(pending).unwrap().unwrap_err().code(),
        "WORKSPACE_WINDOW_CLOSED"
    );
    assert!(!target_root.join("target").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn dual_root_copy_winning_the_gate_finishes_before_revocation() {
    let temp = TempDir::new().unwrap();
    let source_root = create_directory(&temp, "source-root");
    let target_root = create_directory(&temp, "target-root");
    std::fs::write(source_root.join("source"), b"source").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![source_root, target_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let source_id = selected.snapshot().roots()[0].root_id();
    let target_id = selected.snapshot().roots()[1].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_dual_root_mutation(
                "main",
                source_id,
                target_id,
                move |source_lease, target_lease| {
                    pending_entered.wait();
                    pending_release.wait();
                    crate::workspace::writer::copy_regular_file(
                        &source_lease,
                        &relative("source"),
                        &target_lease,
                        &relative("target"),
                    )
                },
            )
            .await
    });
    entered.wait();

    let remove_service = Arc::clone(&service);
    let (removed_tx, removed_rx) = mpsc::channel();
    let remover = std::thread::spawn(move || {
        removed_tx
            .send(remove_service.remove_root("main", target_id))
            .unwrap();
    });
    assert!(removed_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release.wait();

    block_on(pending).unwrap().unwrap();
    assert!(removed_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap()
        .roots()
        .iter()
        .all(|root| root.root_id() != target_id));
    remover.join().unwrap();
    assert_eq!(
        std::fs::read(target_root.join("target")).unwrap(),
        b"source"
    );
}

#[test]
fn a_revocation_that_wins_the_mutation_gate_prevents_the_write() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation_with_hook(
                "main",
                root_id,
                move || {
                    pending_entered.wait();
                    pending_release.wait();
                },
                move |lease| {
                    crate::workspace::writer::create_file(
                        &lease,
                        &RelativePath::parse_wire("blocked.txt").unwrap(),
                    )
                },
            )
            .await
    });
    entered.wait();

    let removed = service.remove_root("main", root_id).unwrap();
    assert!(removed.roots().is_empty());
    release.wait();

    let error = block_on(pending).unwrap().unwrap_err();
    assert_eq!(error.code(), "ROOT_NOT_AUTHORIZED");
    assert!(!root.join("blocked.txt").exists());
}

#[test]
fn a_mutation_that_wins_the_gate_completes_before_root_revocation() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation("main", root_id, move |lease| {
                pending_entered.wait();
                pending_release.wait();
                crate::workspace::writer::create_file(
                    &lease,
                    &RelativePath::parse_wire("committed.txt").unwrap(),
                )
            })
            .await
    });
    entered.wait();

    let remove_service = Arc::clone(&service);
    let (removed_tx, removed_rx) = mpsc::channel();
    let remover = std::thread::spawn(move || {
        removed_tx
            .send(remove_service.remove_root("main", root_id))
            .unwrap();
    });
    assert!(removed_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release.wait();

    block_on(pending).unwrap().unwrap();
    let removed = removed_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    remover.join().unwrap();
    assert!(removed.unwrap().roots().is_empty());
    assert!(root.join("committed.txt").is_file());
}

#[test]
fn root_replacement_waits_for_a_mutation_that_already_holds_the_gate() {
    let temp = TempDir::new().unwrap();
    let original_root = create_directory(&temp, "original-root");
    let replacement_root = create_directory(&temp, "replacement-root");
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![original_root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation("main", root_id, move |lease| {
                pending_entered.wait();
                pending_release.wait();
                crate::workspace::writer::create_file(
                    &lease,
                    &RelativePath::parse_wire("before-replace.txt").unwrap(),
                )
            })
            .await
    });
    entered.wait();

    let replace_service = Arc::clone(&service);
    let (replaced_tx, replaced_rx) = mpsc::channel();
    let replacement = tauri::async_runtime::spawn(async move {
        let result = replace_service
            .pick_roots(
                "main",
                FakePicker::selected(vec![replacement_root]),
                WorkspacePickRootsMode::Replace,
            )
            .await;
        replaced_tx.send(result).unwrap();
    });
    assert!(replaced_rx
        .recv_timeout(Duration::from_millis(100))
        .is_err());
    release.wait();

    block_on(pending).unwrap().unwrap();
    let replaced = replaced_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    block_on(replacement).unwrap();
    assert!(original_root.join("before-replace.txt").is_file());
    assert_ne!(replaced.unwrap().snapshot().roots()[0].root_id(), root_id);
}

#[test]
fn a_mutation_that_owns_the_gate_completes_before_window_close() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = Arc::new(WorkspaceService::new());
    let original_workspace_id = service.snapshot("main").unwrap().workspace_id();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation("main", root_id, move |lease| {
                pending_entered.wait();
                pending_release.wait();
                crate::workspace::writer::create_file(
                    &lease,
                    &RelativePath::parse_wire("before-close.txt").unwrap(),
                )
            })
            .await
    });
    entered.wait();

    let close_service = Arc::clone(&service);
    let (started_tx, started_rx) = mpsc::channel();
    let (closed_tx, closed_rx) = mpsc::channel();
    let closer = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        close_service.close_window("main");
        closed_tx.send(()).unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(closed_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release.wait();

    block_on(pending).unwrap().unwrap();
    closed_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    closer.join().unwrap();
    assert!(root.join("before-close.txt").is_file());
    assert_ne!(
        service.snapshot("main").unwrap().workspace_id(),
        original_workspace_id
    );
}

#[test]
fn a_waiting_window_close_does_not_block_other_window_operations() {
    let temp = TempDir::new().unwrap();
    let first_root = create_directory(&temp, "first-root");
    let second_root = create_directory(&temp, "second-root");
    let service = Arc::new(WorkspaceService::new());
    let first = block_on(service.pick_roots(
        "first",
        FakePicker::selected(vec![first_root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let second = block_on(service.pick_roots(
        "second",
        FakePicker::selected(vec![second_root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let first_id = first.snapshot().roots()[0].root_id();
    let second_id = second.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation("first", first_id, move |lease| {
                pending_entered.wait();
                pending_release.wait();
                crate::workspace::writer::create_file(
                    &lease,
                    &RelativePath::parse_wire("first.txt").unwrap(),
                )
            })
            .await
    });
    entered.wait();

    let close_service = Arc::clone(&service);
    let (detached_tx, detached_rx) = mpsc::channel();
    let (closed_tx, closed_rx) = mpsc::channel();
    let closer = std::thread::spawn(move || {
        close_service.close_window_with_hook("first", || {
            detached_tx.send(()).unwrap();
        });
        closed_tx.send(()).unwrap();
    });
    detached_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(closed_rx.recv_timeout(Duration::from_millis(100)).is_err());

    let other_service = Arc::clone(&service);
    let (other_tx, other_rx) = mpsc::channel();
    let other = tauri::async_runtime::spawn(async move {
        let snapshot = other_service.snapshot("second");
        let created = other_service
            .create_file(
                "second",
                second_id,
                RelativePath::parse_wire("second.txt").unwrap(),
                &remote_service_for_test(),
            )
            .await;
        other_tx.send((snapshot, created)).unwrap();
    });
    let other_result = other_rx.recv_timeout(Duration::from_secs(2));
    release.wait();

    let (snapshot, created) = other_result.expect("another window must not wait for close");
    assert_eq!(snapshot.unwrap().roots()[0].root_id(), second_id);
    created.unwrap();
    block_on(other).unwrap();
    block_on(pending).unwrap().unwrap();
    closed_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    closer.join().unwrap();
    assert!(first_root.join("first.txt").is_file());
    assert!(second_root.join("second.txt").is_file());
}

#[test]
fn a_window_close_that_wins_the_mutation_gate_prevents_the_write() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_mutation_with_hook(
                "main",
                root_id,
                move || {
                    pending_entered.wait();
                    pending_release.wait();
                },
                move |lease| {
                    crate::workspace::writer::create_directory(
                        &lease,
                        &RelativePath::parse_wire("blocked-dir").unwrap(),
                    )
                },
            )
            .await
    });
    entered.wait();

    service.close_window("main");
    release.wait();

    let error = block_on(pending).unwrap().unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_WINDOW_CLOSED");
    assert!(!root.join("blocked-dir").exists());
}

#[test]
fn read_file_returns_a_binary_plr1_receipt_and_rejects_wrong_or_revoked_roots() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let binary = [0, 255, 128, 1, 0, 42];
    std::fs::write(root.join("binary.bin"), binary).unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let frame = block_on(service.read_file(
        "main",
        root_id,
        RelativePath::parse_wire("binary.bin").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(plr1_content(&frame), binary);

    let wrong_window = block_on(service.read_file(
        "other-window",
        root_id,
        RelativePath::parse_wire("binary.bin").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(wrong_window.code(), "ROOT_NOT_AUTHORIZED");

    let unknown_root: crate::workspace::RootId =
        serde_json::from_str(r#""00000000-0000-4000-8000-000000000000""#).unwrap();
    let wrong_root = block_on(service.read_file(
        "main",
        unknown_root,
        RelativePath::parse_wire("binary.bin").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(wrong_root.code(), "ROOT_NOT_AUTHORIZED");

    service.remove_root("main", root_id).unwrap();
    let error = match block_on(service.read_file(
        "main",
        root_id,
        RelativePath::parse_wire("binary.bin").unwrap(),
        &remote_service_for_test(),
    )) {
        Ok(_) => panic!("revoked roots must not remain readable"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "ROOT_NOT_AUTHORIZED");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn versioned_write_uses_the_mutation_gate_and_returns_the_publication_stat() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("target.txt"), b"old").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let path = RelativePath::parse_wire("target.txt").unwrap();
    let expected =
        block_on(service.stat("main", root_id, path.clone(), &remote_service_for_test()))
            .unwrap()
            .version()
            .unwrap()
            .to_owned();

    let result = block_on(service.write_file(
        "main",
        root_id,
        path,
        expected.clone(),
        b"new".to_vec(),
        &remote_service_for_test(),
    ))
    .unwrap();
    let written_version = result
        .written_stat()
        .unwrap_or_else(|| panic!("expected written, got {result:?}"))
        .version()
        .unwrap()
        .to_owned();
    assert_ne!(written_version, expected);
    assert_eq!(std::fs::read(root.join("target.txt")).unwrap(), b"new");

    assert_eq!(
        block_on(service.write_file(
            "main",
            root_id,
            RelativePath::parse_wire("target.txt").unwrap(),
            expected,
            b"replay".to_vec(),
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_FILE_MODIFIED"
    );
}

#[test]
fn versioned_write_panic_is_response_unavailable_without_poisoning_the_mutation_gate() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let error = block_on(service.run_versioned_write("main", root_id, |_lease| {
        panic!("injected versioned write panic")
    }))
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_WRITE_RESPONSE_UNAVAILABLE");
    block_on(service.create_file(
        "main",
        root_id,
        RelativePath::parse_wire("after-panic.txt").unwrap(),
        &remote_service_for_test(),
    ))
    .unwrap();
    assert!(root.join("after-panic.txt").is_file());
}

#[test]
fn versioned_write_join_error_is_response_unavailable() {
    let joined = block_on(tauri::async_runtime::spawn_blocking(
        || -> Result<crate::workspace::dto::WorkspaceWriteResult, CommandError> {
            panic!("injected task-level versioned write panic")
        },
    ));

    let error = super::classify_versioned_write_join(joined).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_WRITE_RESPONSE_UNAVAILABLE");
}

#[test]
fn blocking_read_file_releases_the_window_lock_and_discards_a_revoked_root_result() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("identity.txt"), b"plain").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_reader("main", root_id, move |lease| {
                pending_entered.wait();
                pending_release.wait();
                crate::workspace::reader::read_file(
                    &lease,
                    &RelativePath::parse_wire("identity.txt").unwrap(),
                )
            })
            .await
    });
    entered.wait();

    let remove_service = Arc::clone(&service);
    let (removed_tx, removed_rx) = mpsc::channel();
    let remover = std::thread::spawn(move || {
        removed_tx
            .send(remove_service.remove_root("main", root_id))
            .unwrap();
    });
    let removed = removed_rx.recv_timeout(Duration::from_secs(2));
    release.wait();
    remover.join().unwrap();
    let pending_result = block_on(pending).unwrap();

    let removed = removed.expect("root removal must not wait for blocking I/O");
    assert!(removed.unwrap().roots().is_empty());
    assert_eq!(pending_result.unwrap_err().code(), "ROOT_NOT_AUTHORIZED");
}

#[test]
fn blocking_reader_discards_a_result_after_its_window_closes() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let pending_service = Arc::clone(&service);
    let pending_entered = Arc::clone(&entered);
    let pending_release = Arc::clone(&release);
    let pending = tauri::async_runtime::spawn(async move {
        pending_service
            .run_reader("main", root_id, move |_lease| {
                pending_entered.wait();
                pending_release.wait();
                Ok(())
            })
            .await
    });
    entered.wait();
    let close_service = Arc::clone(&service);
    let (closed_tx, closed_rx) = mpsc::channel();
    let closer = std::thread::spawn(move || {
        close_service.close_window("main");
        closed_tx.send(()).unwrap();
    });
    let closed = closed_rx.recv_timeout(Duration::from_secs(2));
    release.wait();
    closer.join().unwrap();
    let pending_result = block_on(pending).unwrap();

    closed.expect("window close must not wait for blocking I/O");
    assert_eq!(
        pending_result.unwrap_err().code(),
        "WORKSPACE_WINDOW_CLOSED"
    );
}

#[cfg(target_os = "macos")]
struct FakeSystemTrash {
    outcomes: VecDeque<PlatformTrashOutcome>,
    calls: usize,
}

#[cfg(target_os = "macos")]
impl FakeSystemTrash {
    fn new(outcomes: impl IntoIterator<Item = PlatformTrashOutcome>) -> Self {
        Self {
            outcomes: outcomes.into_iter().collect(),
            calls: 0,
        }
    }
}

#[cfg(target_os = "macos")]
impl PlatformTrash for FakeSystemTrash {
    fn move_to_trash(&mut self, _request: &PlatformTrashRequest) -> PlatformTrashOutcome {
        self.calls += 1;
        self.outcomes.pop_front().expect("fake Trash outcome")
    }
}

#[cfg(target_os = "macos")]
#[test]
fn trash_and_permanent_delete_receipts_are_distinct_and_mutually_exclusive_per_window() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("entry"), b"plain").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let trash =
        block_on(service.prepare_trash("main", vec![(root_id, relative("entry"))])).unwrap();
    assert_eq!(
        block_on(service.prepare_delete(
            "main",
            vec![(root_id, relative("entry"), false)],
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_CONFLICT"
    );
    block_on(service.cancel_trash("main", trash.confirmation_id())).unwrap();

    let permanent = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(
        block_on(service.prepare_trash("main", vec![(root_id, relative("entry"))]))
            .unwrap_err()
            .code(),
        "WORKSPACE_CONFLICT"
    );
    block_on(service.cancel_delete(
        "main",
        permanent.confirmation_id(),
        &remote_service_for_test(),
    ))
    .unwrap();
}

#[cfg(target_os = "macos")]
#[test]
fn trash_begin_revalidates_every_entry_before_any_platform_attempt() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("first"), b"first").unwrap();
    std::fs::write(root.join("second"), b"second").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_trash(
        "main",
        vec![(root_id, relative("first")), (root_id, relative("second"))],
    ))
    .unwrap();
    std::fs::write(root.join("second"), b"changed after prepare").unwrap();

    assert_eq!(
        block_on(service.begin_trash("main", plan.confirmation_id()))
            .unwrap_err()
            .code(),
        "WORKSPACE_TRASH_BATCH_CHANGED"
    );
    assert_eq!(std::fs::read(root.join("first")).unwrap(), b"first");
    assert_eq!(
        block_on(service.begin_trash("main", plan.confirmation_id()))
            .unwrap_err()
            .code(),
        "WORKSPACE_TRASH_PLAN_INVALID"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn trash_commit_is_ordered_one_shot_and_stops_after_first_non_success() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("first"), b"first").unwrap();
    std::fs::write(root.join("second"), b"second").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_trash(
        "main",
        vec![(root_id, relative("first")), (root_id, relative("second"))],
    ))
    .unwrap();
    block_on(service.begin_trash("main", plan.confirmation_id())).unwrap();
    let workspace = service.scope_for_window("main").unwrap();
    let mut platform = FakeSystemTrash::new([
        PlatformTrashOutcome::Trashed,
        PlatformTrashOutcome::FailedBeforeAttempt,
    ]);

    assert_eq!(
        workspace
            .commit_trash_entry_with_platform(
                plan.confirmation_id(),
                plan.entries()[0].entry_id(),
                root_id,
                relative("first"),
                &mut platform,
            )
            .unwrap(),
        WorkspaceTrashResult::Trashed
    );
    assert_eq!(
        workspace
            .commit_trash_entry_with_platform(
                plan.confirmation_id(),
                plan.entries()[1].entry_id(),
                root_id,
                relative("second"),
                &mut platform,
            )
            .unwrap(),
        WorkspaceTrashResult::EntryRetained {
            reason: WorkspaceTrashIncompleteReason::TrashFailed,
        }
    );
    assert_eq!(platform.calls, 2);
    assert_eq!(
        workspace
            .commit_trash_entry_with_platform(
                plan.confirmation_id(),
                plan.entries()[1].entry_id(),
                root_id,
                relative("second"),
                &mut platform,
            )
            .unwrap_err()
            .code(),
        "WORKSPACE_TRASH_PLAN_INVALID"
    );
    assert_eq!(std::fs::read(root.join("first")).unwrap(), b"first");
    assert_eq!(std::fs::read(root.join("second")).unwrap(), b"second");
}

#[cfg(target_os = "macos")]
#[test]
fn root_lifecycle_and_exact_deadline_invalidate_trash_without_touching_files() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("entry"), b"plain").unwrap();
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock_now = Arc::clone(&now);
    let service = WorkspaceService::with_delete_clock(Arc::new(move || {
        *clock_now.lock().expect("test clock")
    }));
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let expired =
        block_on(service.prepare_trash("main", vec![(root_id, relative("entry"))])).unwrap();
    let base = *now.lock().unwrap();
    *now.lock().unwrap() = base + Duration::from_secs(120);
    assert_eq!(
        block_on(service.begin_trash("main", expired.confirmation_id()))
            .unwrap_err()
            .code(),
        "WORKSPACE_TRASH_PLAN_INVALID"
    );

    *now.lock().unwrap() = base;
    let revoked =
        block_on(service.prepare_trash("main", vec![(root_id, relative("entry"))])).unwrap();
    service.remove_root("main", root_id).unwrap();
    assert_eq!(
        block_on(service.begin_trash("main", revoked.confirmation_id()))
            .unwrap_err()
            .code(),
        "WORKSPACE_TRASH_PLAN_INVALID"
    );
    assert_eq!(std::fs::read(root.join("entry")).unwrap(), b"plain");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn confirmed_delete_consumes_file_authorization_once() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("delete.txt"), b"plain").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("delete.txt"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    let confirmation_id = plan.confirmation_id();
    let entry_id = plan.entries()[0].entry_id();
    block_on(service.begin_delete("main", confirmation_id, &remote_service_for_test())).unwrap();
    let result = block_on(service.commit_delete_entry(
        "main",
        confirmation_id,
        entry_id,
        root_id,
        relative("delete.txt"),
        false,
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(result, WorkspaceDeleteResult::Deleted);
    assert_entry_absent(&root.join("delete.txt"));

    let replay = block_on(service.commit_delete_entry(
        "main",
        confirmation_id,
        entry_id,
        root_id,
        relative("delete.txt"),
        false,
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(replay.code(), "WORKSPACE_DELETE_PLAN_INVALID");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn delete_cancel_and_second_batch_have_zero_file_side_effects() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("first"), b"first").unwrap();
    std::fs::write(root.join("second"), b"second").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("first"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    let conflict = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("second"), false)],
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(conflict.code(), "WORKSPACE_CONFLICT");

    block_on(service.cancel_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    assert_eq!(std::fs::read(root.join("first")).unwrap(), b"first");
    let replay =
        block_on(service.cancel_delete("main", plan.confirmation_id(), &remote_service_for_test()))
            .unwrap_err();
    assert_eq!(replay.code(), "WORKSPACE_DELETE_PLAN_INVALID");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn begin_revalidates_the_whole_batch_before_any_remove() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("first"), b"first").unwrap();
    std::fs::write(root.join("last"), b"last").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![
            (root_id, relative("first"), false),
            (root_id, relative("last"), false),
        ],
        &remote_service_for_test(),
    ))
    .unwrap();
    std::fs::write(root.join("last"), b"changed").unwrap();

    let error =
        block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
            .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_DELETE_BATCH_CHANGED");
    assert_eq!(std::fs::read(root.join("first")).unwrap(), b"first");
    assert_eq!(std::fs::read(root.join("last")).unwrap(), b"changed");
    assert_eq!(
        block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
            .unwrap_err()
            .code(),
        "WORKSPACE_DELETE_PLAN_INVALID"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn recursive_delete_handles_mixed_tree_raw_symlink_and_hardlink_journal() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::create_dir_all(root.join("tree/nested")).unwrap();
    std::fs::write(root.join("tree/data"), b"plain").unwrap();
    std::fs::hard_link(root.join("tree/data"), root.join("tree/nested/alias")).unwrap();
    symlink("../../outside-sentinel", root.join("tree/nested/link")).unwrap();
    std::fs::write(root.join("outside-sentinel"), b"outside").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("tree"), true)],
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(plan.entries().len(), 1);
    let entry_id = plan.entries()[0].entry_id();
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    let result = block_on(service.commit_delete_entry(
        "main",
        plan.confirmation_id(),
        entry_id,
        root_id,
        relative("tree"),
        true,
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(result, WorkspaceDeleteResult::Deleted);
    assert_entry_absent(&root.join("tree"));
    assert_eq!(
        std::fs::read(root.join("outside-sentinel")).unwrap(),
        b"outside"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn delete_rejects_nonrecursive_nonempty_and_overlapping_selections() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::create_dir(root.join("tree")).unwrap();
    std::fs::write(root.join("tree/child"), b"child").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    assert_eq!(
        block_on(service.prepare_delete(
            "main",
            vec![(root_id, relative("tree"), false)],
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "DIRECTORY_NOT_EMPTY"
    );
    assert_eq!(
        block_on(service.prepare_delete(
            "main",
            vec![
                (root_id, relative("tree"), true),
                (root_id, relative("tree/child"), false),
            ],
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_CONFLICT"
    );
    std::fs::write(root.join("hardlink-source"), b"same inode").unwrap();
    std::fs::hard_link(root.join("hardlink-source"), root.join("hardlink-alias")).unwrap();
    assert_eq!(
        block_on(service.prepare_delete(
            "main",
            vec![
                (root_id, relative("hardlink-source"), false),
                (root_id, relative("hardlink-alias"), false),
            ],
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_CONFLICT"
    );
    std::fs::create_dir(root.join("first-tree")).unwrap();
    std::fs::create_dir(root.join("second-tree")).unwrap();
    std::fs::write(root.join("first-tree/shared"), b"shared inode").unwrap();
    std::fs::hard_link(
        root.join("first-tree/shared"),
        root.join("second-tree/shared"),
    )
    .unwrap();
    assert_eq!(
        block_on(service.prepare_delete(
            "main",
            vec![
                (root_id, relative("first-tree"), true),
                (root_id, relative("second-tree"), true),
            ],
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_CONFLICT"
    );
    assert!(root.join("tree/child").is_file());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn delete_plan_expires_at_the_exact_monotonic_deadline() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("entry"), b"plain").unwrap();
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock_now = Arc::clone(&now);
    let service = WorkspaceService::with_delete_clock(Arc::new(move || {
        *clock_now.lock().expect("test clock")
    }));
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let before_boundary = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    let base = *now.lock().unwrap();
    *now.lock().unwrap() = base + Duration::from_secs(119);
    block_on(service.begin_delete(
        "main",
        before_boundary.confirmation_id(),
        &remote_service_for_test(),
    ))
    .unwrap();
    block_on(service.cancel_delete(
        "main",
        before_boundary.confirmation_id(),
        &remote_service_for_test(),
    ))
    .unwrap();

    let at_boundary = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    *now.lock().unwrap() = base + Duration::from_secs(239);

    let error = block_on(service.begin_delete(
        "main",
        at_boundary.confirmation_id(),
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_DELETE_PLAN_INVALID");
    assert_eq!(std::fs::read(root.join("entry")).unwrap(), b"plain");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn root_lifecycle_invalidates_delete_plan_without_touching_files() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("entry"), b"plain").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    service.remove_root("main", root_id).unwrap();
    assert_eq!(
        block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
            .unwrap_err()
            .code(),
        "WORKSPACE_DELETE_PLAN_INVALID"
    );
    assert_eq!(std::fs::read(root.join("entry")).unwrap(), b"plain");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn picker_replacement_and_window_close_invalidate_delete_receipts() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let replacement = create_directory(&temp, "replacement");
    std::fs::write(root.join("entry"), b"plain").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let replaced_plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![replacement]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    assert_eq!(
        block_on(service.begin_delete(
            "main",
            replaced_plan.confirmation_id(),
            &remote_service_for_test()
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_DELETE_PLAN_INVALID"
    );

    let restored = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let restored_id = restored.snapshot().roots()[0].root_id();
    let closed_plan = block_on(service.prepare_delete(
        "main",
        vec![(restored_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    service.close_window("main");
    assert_eq!(
        block_on(service.begin_delete(
            "main",
            closed_plan.confirmation_id(),
            &remote_service_for_test()
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_DELETE_PLAN_INVALID"
    );
    assert_eq!(std::fs::read(root.join("entry")).unwrap(), b"plain");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn each_deleted_entry_refreshes_the_executing_batch_idle_deadline() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("first"), b"first").unwrap();
    std::fs::write(root.join("second"), b"second").unwrap();
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock_now = Arc::clone(&now);
    let service = WorkspaceService::with_delete_clock(Arc::new(move || {
        *clock_now.lock().expect("test clock")
    }));
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![
            (root_id, relative("first"), false),
            (root_id, relative("second"), false),
        ],
        &remote_service_for_test(),
    ))
    .unwrap();
    let base = *now.lock().unwrap();
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    *now.lock().unwrap() = base + Duration::from_secs(119);
    assert_eq!(
        block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            plan.entries()[0].entry_id(),
            root_id,
            relative("first"),
            false,
            &remote_service_for_test(),
        ))
        .unwrap(),
        WorkspaceDeleteResult::Deleted
    );
    *now.lock().unwrap() = base + Duration::from_secs(121);
    assert_eq!(
        block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            plan.entries()[1].entry_id(),
            root_id,
            relative("second"),
            false,
            &remote_service_for_test(),
        ))
        .unwrap(),
        WorkspaceDeleteResult::Deleted
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn a_changed_entry_returns_retained_and_invalidates_remaining_batch() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("first"), b"first").unwrap();
    std::fs::write(root.join("second"), b"second").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![
            (root_id, relative("first"), false),
            (root_id, relative("second"), false),
        ],
        &remote_service_for_test(),
    ))
    .unwrap();
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    std::fs::write(root.join("first"), b"changed").unwrap();
    let result = block_on(service.commit_delete_entry(
        "main",
        plan.confirmation_id(),
        plan.entries()[0].entry_id(),
        root_id,
        relative("first"),
        false,
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(
        result,
        WorkspaceDeleteResult::EntryRetained {
            reason: WorkspaceDeleteIncompleteReason::EntryChanged,
        }
    );
    assert_eq!(std::fs::read(root.join("first")).unwrap(), b"changed");
    assert_eq!(std::fs::read(root.join("second")).unwrap(), b"second");
    assert_eq!(
        block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            plan.entries()[1].entry_id(),
            root_id,
            relative("second"),
            false,
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_DELETE_PLAN_INVALID"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn delete_accepts_a_full_64_entry_batch_in_exact_input_order() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let entries = (0..64)
        .map(|index| {
            let name = format!("entry-{index:02}");
            std::fs::write(root.join(&name), name.as_bytes()).unwrap();
            (root_id, relative(&name), false)
        })
        .collect::<Vec<_>>();
    let plan =
        block_on(service.prepare_delete("main", entries.clone(), &remote_service_for_test()))
            .unwrap();
    assert_eq!(plan.entries().len(), 64);
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    for (entry, (root_id, path, recursive)) in plan.entries().iter().zip(entries) {
        let result = block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            entry.entry_id(),
            root_id,
            path,
            recursive,
            &remote_service_for_test(),
        ))
        .unwrap();
        assert_eq!(result, WorkspaceDeleteResult::Deleted);
    }
    assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn delete_plans_large_files_without_copy_content_limits() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let large = root.join("large.bin");
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&large)
        .unwrap();
    file.set_len(9 * 1_024 * 1_024).unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("large.bin"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    assert_eq!(
        block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            plan.entries()[0].entry_id(),
            root_id,
            relative("large.bin"),
            false,
            &remote_service_for_test(),
        ))
        .unwrap(),
        WorkspaceDeleteResult::Deleted
    );
    assert_entry_absent(&large);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn delete_rejects_special_files_before_any_batch_side_effect() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let special = root.join("pipe");
    let wire = CString::new(special.as_os_str().as_bytes()).unwrap();
    // SAFETY: `wire` is a NUL-terminated copy of the temporary test path.
    assert_eq!(unsafe { libc::mkfifo(wire.as_ptr(), 0o600) }, 0);
    std::fs::write(root.join("ordinary"), b"ordinary").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let error = block_on(service.prepare_delete(
        "main",
        vec![
            (root_id, relative("ordinary"), false),
            (root_id, relative("pipe"), false),
        ],
        &remote_service_for_test(),
    ))
    .unwrap_err();
    assert_eq!(error.code(), "ENTRY_TYPE_MISMATCH");
    assert_eq!(std::fs::read(root.join("ordinary")).unwrap(), b"ordinary");
    assert!(std::fs::symlink_metadata(special).is_ok());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn delete_tokens_are_window_bound_and_wrong_entry_options_invalidate_the_batch() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("entry"), b"plain").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    assert_eq!(
        block_on(service.begin_delete("other", plan.confirmation_id(), &remote_service_for_test()))
            .unwrap_err()
            .code(),
        "WORKSPACE_DELETE_PLAN_INVALID"
    );
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    assert_eq!(
        block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            plan.entries()[0].entry_id(),
            root_id,
            relative("entry"),
            true,
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_DELETE_PLAN_INVALID"
    );
    assert_eq!(std::fs::read(root.join("entry")).unwrap(), b"plain");
    assert_eq!(
        block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            plan.entries()[0].entry_id(),
            root_id,
            relative("entry"),
            false,
            &remote_service_for_test(),
        ))
        .unwrap_err()
        .code(),
        "WORKSPACE_DELETE_PLAN_INVALID"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn confirmed_delete_consumes_a_cross_root_batch_in_input_order() {
    let temp = TempDir::new().unwrap();
    let first_root = create_directory(&temp, "first-root");
    let second_root = create_directory(&temp, "second-root");
    std::fs::write(first_root.join("file"), b"first").unwrap();
    std::fs::create_dir(second_root.join("empty")).unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![first_root.clone(), second_root.clone()]),
        WorkspacePickRootsMode::Add,
    ))
    .unwrap();
    let first_id = selected.snapshot().roots()[0].root_id();
    let second_id = selected.snapshot().roots()[1].root_id();
    let requests = vec![
        (first_id, relative("file"), false),
        (second_id, relative("empty"), false),
    ];
    let plan =
        block_on(service.prepare_delete("main", requests.clone(), &remote_service_for_test()))
            .unwrap();
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();

    for (entry, (root_id, path, recursive)) in plan.entries().iter().zip(requests) {
        assert_eq!(
            block_on(service.commit_delete_entry(
                "main",
                plan.confirmation_id(),
                entry.entry_id(),
                root_id,
                path,
                recursive,
                &remote_service_for_test(),
            ))
            .unwrap(),
            WorkspaceDeleteResult::Deleted
        );
    }
    assert_entry_absent(&first_root.join("file"));
    assert_entry_absent(&second_root.join("empty"));
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn confirmed_delete_rejects_a_same_identity_basename_round_trip() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let entry = root.join("entry");
    let temporary = root.join("temporary");
    std::fs::write(&entry, b"plain").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    let before = std::fs::metadata(&entry).unwrap();
    let original_permissions = before.permissions();

    std::thread::sleep(Duration::from_millis(2));
    std::fs::rename(&entry, &temporary).unwrap();
    let mut toggled = original_permissions.clone();
    toggled.set_mode(original_permissions.mode() ^ 0o100);
    std::fs::set_permissions(&temporary, toggled).unwrap();
    std::fs::set_permissions(&temporary, original_permissions).unwrap();
    std::fs::rename(&temporary, &entry).unwrap();
    let after = std::fs::metadata(&entry).unwrap();
    assert_eq!(before.ino(), after.ino());
    assert_ne!(
        (before.ctime(), before.ctime_nsec()),
        (after.ctime(), after.ctime_nsec())
    );

    assert_eq!(
        block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
            .unwrap_err()
            .code(),
        "WORKSPACE_DELETE_BATCH_CHANGED"
    );
    assert_eq!(std::fs::read(entry).unwrap(), b"plain");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn confirmed_delete_rejects_external_hardlink_count_changes_after_begin() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let entry = root.join("entry");
    let alias = root.join("outside-alias");
    std::fs::write(&entry, b"plain").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    std::fs::hard_link(&entry, &alias).unwrap();

    assert_eq!(
        block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            plan.entries()[0].entry_id(),
            root_id,
            relative("entry"),
            false,
            &remote_service_for_test(),
        ))
        .unwrap(),
        WorkspaceDeleteResult::EntryRetained {
            reason: WorkspaceDeleteIncompleteReason::EntryChanged,
        }
    );
    assert_eq!(std::fs::read(entry).unwrap(), b"plain");
    assert_eq!(std::fs::read(alias).unwrap(), b"plain");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn top_level_delete_ignores_special_and_unrepresentable_parent_siblings() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let target = root.join("target");
    std::fs::write(&target, b"plain").unwrap();
    #[cfg(target_os = "linux")]
    let non_utf8_sibling = {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let path = root.join(OsString::from_vec(vec![b'n', 0xff]));
        std::fs::write(&path, b"outside").unwrap();
        path
    };
    let fifo = root.join("outside-pipe");
    let fifo_wire = CString::new(fifo.as_os_str().as_bytes()).unwrap();
    // SAFETY: `fifo_wire` is a NUL-terminated copy of the temporary test path.
    assert_eq!(unsafe { libc::mkfifo(fifo_wire.as_ptr(), 0o600) }, 0);

    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("target"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    block_on(service.begin_delete("main", plan.confirmation_id(), &remote_service_for_test()))
        .unwrap();
    assert_eq!(
        block_on(service.commit_delete_entry(
            "main",
            plan.confirmation_id(),
            plan.entries()[0].entry_id(),
            root_id,
            relative("target"),
            false,
            &remote_service_for_test(),
        ))
        .unwrap(),
        WorkspaceDeleteResult::Deleted
    );
    assert_entry_absent(&target);
    #[cfg(target_os = "linux")]
    {
        assert_eq!(std::fs::read(non_utf8_sibling).unwrap(), b"outside");
    }
    assert!(std::fs::symlink_metadata(fifo).is_ok());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn concurrent_identical_delete_commits_consume_at_most_once() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    let entry = root.join("entry");
    std::fs::write(&entry, b"plain").unwrap();
    let service = Arc::new(WorkspaceService::new());
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();
    let plan = block_on(service.prepare_delete(
        "main",
        vec![(root_id, relative("entry"), false)],
        &remote_service_for_test(),
    ))
    .unwrap();
    let confirmation_id = plan.confirmation_id();
    let entry_id = plan.entries()[0].entry_id();
    block_on(service.begin_delete("main", confirmation_id, &remote_service_for_test())).unwrap();

    let first_service = Arc::clone(&service);
    let first = tauri::async_runtime::spawn(async move {
        first_service
            .commit_delete_entry(
                "main",
                confirmation_id,
                entry_id,
                root_id,
                relative("entry"),
                false,
                &remote_service_for_test(),
            )
            .await
    });
    let second_service = Arc::clone(&service);
    let second = tauri::async_runtime::spawn(async move {
        second_service
            .commit_delete_entry(
                "main",
                confirmation_id,
                entry_id,
                root_id,
                relative("entry"),
                false,
                &remote_service_for_test(),
            )
            .await
    });
    let results = [block_on(first).unwrap(), block_on(second).unwrap()];

    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Ok(WorkspaceDeleteResult::Deleted)))
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result
                .as_ref()
                .is_err_and(|error| { error.code() == "WORKSPACE_DELETE_PLAN_INVALID" }))
            .count(),
        1
    );
    assert_entry_absent(&entry);
}

// --- Streaming text search (F040 S3) ----------------------------------------

fn text_query(root_id: RootId, pattern: &str) -> crate::search::dto::WorkspaceSearchTextQuery {
    crate::search::dto::WorkspaceSearchTextQuery {
        roots: vec![root_id],
        pattern: pattern.to_owned(),
        is_reg_exp: false,
        is_case_sensitive: false,
        is_word_match: false,
        exclude_globs: Vec::new(),
        max_results: 20_000,
        max_file_size: 8 * 1_024 * 1_024,
    }
}

fn noop_search_wake() -> Arc<dyn Fn(crate::search::dto::SearchId) + Send + Sync> {
    Arc::new(|_| {})
}

fn poll_search_until_done(
    service: &WorkspaceService,
    window_label: &str,
    search_id: crate::search::dto::SearchId,
) -> crate::search::dto::WorkspaceSearchTextPollResult {
    let mut cursor = 0_u64;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let result = service
            .search_text_poll(window_label, search_id, cursor)
            .unwrap();
        cursor = result.next_cursor();
        if result.done() {
            return result;
        }
        assert!(Instant::now() < deadline, "search never completed");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_new_search_supersedes_the_previous_one_for_the_same_window() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("a.txt"), b"needle").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let first = service
        .search_text_start("main", text_query(root_id, "needle"), noop_search_wake())
        .unwrap();
    let second = service
        .search_text_start("main", text_query(root_id, "needle"), noop_search_wake())
        .unwrap();

    assert_ne!(
        extract_search_id(&first),
        extract_search_id(&second),
        "each start must mint a fresh search id"
    );
    assert_eq!(
        service
            .search_text_poll("main", extract_search_id(&first), 0)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND",
        "the superseded search must no longer be pollable"
    );
    let result = poll_search_until_done(&service, "main", extract_search_id(&second));
    assert_eq!(result.batches().len(), 1);
}

#[test]
fn root_revocation_terminates_the_active_search() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("a.txt"), b"needle").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let start = service
        .search_text_start("main", text_query(root_id, "needle"), noop_search_wake())
        .unwrap();
    let search_id = extract_search_id(&start);
    service.remove_root("main", root_id).unwrap();

    assert_eq!(
        service
            .search_text_poll("main", search_id, 0)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND"
    );
}

/// `F220` S3 (ADR 0007 §1) representative test: a remote-backed root now
/// really dispatches to `remote::remote_fs` (superseding `F220` S2's own
/// blanket `ROOT_BACKEND_UNSUPPORTED` stub — see that slice's now-updated
/// doc history). With no live session behind it (this test's
/// `authorize_remote_root_for_test` mints a random, never-connected
/// `RemoteSessionId`, and `remote_service_for_test()` starts with zero
/// registered sessions), every dispatched operation still fails closed —
/// now with `REMOTE_SESSION_NOT_FOUND`, the accurate reason, rather than a
/// generic "this backend isn't supported yet" — exercising exactly the
/// [`super::WorkspaceScope::remote_context`] chokepoint every remote-capable
/// operation now funnels through.
#[test]
fn stat_and_read_file_fail_closed_for_a_remote_backed_root() {
    let service = WorkspaceService::new();
    let remote_id = service
        .authorize_remote_root_for_test(
            "main",
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/srv/project",
            "Remote Project",
        )
        .expect("remote root registers for test");

    let stat_error = block_on(service.stat(
        "main",
        remote_id,
        RelativePath::parse_wire("").unwrap(),
        &remote_service_for_test(),
    ))
    .expect_err("stat on a remote-backed root with no live session must fail closed");
    assert_eq!(stat_error.code(), "REMOTE_SESSION_NOT_FOUND");

    let read_error = block_on(service.read_file(
        "main",
        remote_id,
        RelativePath::parse_wire("anything.txt").unwrap(),
        &remote_service_for_test(),
    ))
    .expect_err("read_file on a remote-backed root with no live session must fail closed");
    assert_eq!(read_error.code(), "REMOTE_SESSION_NOT_FOUND");
}

/// `F220` S2 representative test for the search domain: multi-root search
/// leases every named root up front via the same [`super::WorkspaceScope::
/// lease`] chokepoint `stat`/`read_file` use, so a remote-backed root in the
/// query fails closed before any traversal starts.
#[test]
fn search_text_start_fails_closed_for_a_remote_backed_root() {
    let service = WorkspaceService::new();
    let remote_id = service
        .authorize_remote_root_for_test(
            "main",
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/srv/project",
            "Remote Project",
        )
        .expect("remote root registers for test");

    let error = service
        .search_text_start("main", text_query(remote_id, "needle"), noop_search_wake())
        .expect_err("a remote-backed root must fail closed before any traversal starts");
    assert_eq!(error.code(), "ROOT_BACKEND_UNSUPPORTED");
}

#[test]
fn window_close_reclaims_the_active_search() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("a.txt"), b"needle").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let start = service
        .search_text_start("main", text_query(root_id, "needle"), noop_search_wake())
        .unwrap();
    let search_id = extract_search_id(&start);
    service.close_window("main");

    // The window itself no longer exists, so this creates a brand new,
    // empty one — observably identical to "the search is gone", which is
    // exactly the guarantee window close must provide.
    assert_eq!(
        service
            .search_text_poll("main", search_id, 0)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND"
    );
}

#[test]
fn cancel_is_idempotent_and_rejects_unknown_or_already_cancelled_ids() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("a.txt"), b"needle").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let start = service
        .search_text_start("main", text_query(root_id, "needle"), noop_search_wake())
        .unwrap();
    let search_id = extract_search_id(&start);

    service.search_text_cancel("main", search_id).unwrap();
    assert_eq!(
        service
            .search_text_cancel("main", search_id)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND",
        "cancelling an already-cancelled search must not silently succeed"
    );
    assert_eq!(
        service
            .search_text_poll("main", search_id, 0)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND"
    );

    let never_started = crate::search::dto::SearchId::new();
    assert_eq!(
        service
            .search_text_cancel("main", never_started)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND"
    );
}

#[test]
fn a_search_id_is_scoped_to_the_window_that_started_it() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("a.txt"), b"needle").unwrap();
    let service = WorkspaceService::new();
    let first_selected = block_on(service.pick_roots(
        "first",
        FakePicker::selected(vec![root.clone()]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let first_root_id = first_selected.snapshot().roots()[0].root_id();
    block_on(service.pick_roots(
        "second",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();

    let start = service
        .search_text_start(
            "first",
            text_query(first_root_id, "needle"),
            noop_search_wake(),
        )
        .unwrap();
    let search_id = extract_search_id(&start);

    assert_eq!(
        service
            .search_text_poll("second", search_id, 0)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND",
        "a search id from one window must not be pollable from another"
    );
    let result = poll_search_until_done(&service, "first", search_id);
    assert_eq!(result.batches().len(), 1);
}

#[test]
fn a_naturally_completed_search_lingers_until_its_idle_ttl_then_is_reclaimed() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("a.txt"), b"needle").unwrap();
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock_now = Arc::clone(&now);
    let service =
        WorkspaceService::with_search_clock(Arc::new(move || *clock_now.lock().expect("clock")));
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let start = service
        .search_text_start("main", text_query(root_id, "needle"), noop_search_wake())
        .unwrap();
    let search_id = extract_search_id(&start);
    let result = poll_search_until_done(&service, "main", search_id);
    assert!(result.done());
    let cursor = result.next_cursor();

    // Still well within the TTL: the completed search must remain pollable.
    let base = *now.lock().unwrap();
    *now.lock().unwrap() = base + Duration::from_secs(119);
    let still_there = service.search_text_poll("main", search_id, cursor).unwrap();
    assert!(still_there.done());
    assert!(still_there.batches().is_empty());

    // Past the TTL measured from that last poll: reclaimed.
    *now.lock().unwrap() = base + Duration::from_secs(119 + 121);
    assert_eq!(
        service
            .search_text_poll("main", search_id, cursor)
            .unwrap_err()
            .code(),
        "WORKSPACE_SEARCH_NOT_FOUND"
    );
}

#[test]
fn the_wake_sink_is_invoked_with_the_search_id_the_start_call_returned() {
    let temp = TempDir::new().unwrap();
    let root = create_directory(&temp, "root");
    std::fs::write(root.join("a.txt"), b"needle").unwrap();
    let service = WorkspaceService::new();
    let selected = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![root]),
        WorkspacePickRootsMode::Replace,
    ))
    .unwrap();
    let root_id = selected.snapshot().roots()[0].root_id();

    let (tx, rx) = mpsc::channel::<crate::search::dto::SearchId>();
    let start = service
        .search_text_start(
            "main",
            text_query(root_id, "needle"),
            Arc::new(move |woken_id| {
                let _ = tx.send(woken_id);
            }),
        )
        .unwrap();
    let search_id = extract_search_id(&start);

    let woken = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the wake sink should fire at least once for a matching search");
    assert_eq!(woken, search_id);
    let _ = poll_search_until_done(&service, "main", search_id);
}

/// `WorkspaceSearchTextStartResult`'s only field is a private, redacted
/// `SearchId` — the public API deliberately gives tests no direct accessor
/// (mirroring how delete confirmation ids are treated), so this helper
/// extracts it the one way available from outside `search::dto`: decoding
/// the serialized wire form, which is exactly what the real IPC boundary
/// does too.
fn extract_search_id(
    start: &crate::search::dto::WorkspaceSearchTextStartResult,
) -> crate::search::dto::SearchId {
    let value = serde_json::to_value(start).unwrap();
    let wire = value["searchId"].as_str().unwrap();
    serde_json::from_value(serde_json::json!(wire)).unwrap()
}

fn create_directory(temp: &TempDir, name: &str) -> PathBuf {
    let path = temp.path().join(name);
    std::fs::create_dir(&path).unwrap();
    path
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn assert_entry_absent(path: &std::path::Path) {
    let error =
        std::fs::symlink_metadata(path).expect_err("entry must not exist, including as a symlink");
    assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn relative(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).unwrap()
}

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

fn plr1_content(frame: &[u8]) -> &[u8] {
    assert!(frame.len() >= 36);
    assert_eq!(&frame[..4], b"PLR1");
    let version_length = usize::from(frame[5]);
    let content_length = u32::from_be_bytes(frame[8..12].try_into().unwrap()) as usize;
    let content_offset = 36 + version_length;
    assert_eq!(frame.len(), content_offset + content_length);
    &frame[content_offset..]
}
