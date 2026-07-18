use std::collections::VecDeque;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Barrier, Mutex};
use std::time::Duration;

use tempfile::TempDir;

use super::WorkspaceService;
use crate::error::CommandError;
use crate::path_policy::RelativePath;
use crate::workspace::dto::{WorkspaceEntryKind, WorkspacePickRootsMode, WorkspacePickRootsStatus};
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::MAX_WORKSPACE_ROOTS;

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
    ))
    .unwrap();
    assert_eq!(stat.kind(), WorkspaceEntryKind::File);
    assert_eq!(stat.size(), 5);
    assert_eq!(
        block_on(service.stat(
            "second",
            first_id,
            RelativePath::parse_wire("identity.txt").unwrap(),
        ))
        .unwrap_err()
        .code(),
        "ROOT_NOT_AUTHORIZED"
    );
    assert!(block_on(service.read_directory(
        "second",
        second_id,
        RelativePath::parse_wire("").unwrap(),
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

    block_on(service.create_file(
        "main",
        first_id,
        RelativePath::parse_wire("created.txt").unwrap(),
    ))
    .unwrap();
    block_on(service.create_directory(
        "main",
        second_id,
        RelativePath::parse_wire("created-dir").unwrap(),
    ))
    .unwrap();

    assert!(first_root.join("created.txt").is_file());
    assert!(!second_root.join("created.txt").exists());
    assert!(second_root.join("created-dir").is_dir());
    assert!(!first_root.join("created-dir").exists());

    let wrong_window = block_on(service.create_file(
        "other-window",
        first_id,
        RelativePath::parse_wire("private.txt").unwrap(),
    ))
    .unwrap_err();
    assert_eq!(wrong_window.code(), "ROOT_NOT_AUTHORIZED");
    assert!(!first_root.join("private.txt").exists());

    service.remove_root("main", first_id).unwrap();
    let revoked = block_on(service.create_file(
        "main",
        first_id,
        RelativePath::parse_wire("revoked.txt").unwrap(),
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

    block_on(service.rename("main", first_id, relative("source"), relative("renamed"))).unwrap();
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
    ))
    .unwrap_err();
    assert_eq!(wrong_window.code(), "ROOT_NOT_AUTHORIZED");
    assert!(!second_root.join("private").exists());

    service.remove_root("main", second_id).unwrap();
    let revoked =
        block_on(service.rename("main", second_id, relative("source"), relative("revoked")))
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
fn read_file_returns_binary_bytes_and_rejects_wrong_or_revoked_roots() {
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

    let bytes = block_on(service.read_file(
        "main",
        root_id,
        RelativePath::parse_wire("binary.bin").unwrap(),
    ))
    .unwrap();
    assert_eq!(bytes, binary);

    let wrong_window = block_on(service.read_file(
        "other-window",
        root_id,
        RelativePath::parse_wire("binary.bin").unwrap(),
    ))
    .unwrap_err();
    assert_eq!(wrong_window.code(), "ROOT_NOT_AUTHORIZED");

    let unknown_root: crate::workspace::RootId =
        serde_json::from_str(r#""00000000-0000-4000-8000-000000000000""#).unwrap();
    let wrong_root = block_on(service.read_file(
        "main",
        unknown_root,
        RelativePath::parse_wire("binary.bin").unwrap(),
    ))
    .unwrap_err();
    assert_eq!(wrong_root.code(), "ROOT_NOT_AUTHORIZED");

    service.remove_root("main", root_id).unwrap();
    let error = match block_on(service.read_file(
        "main",
        root_id,
        RelativePath::parse_wire("binary.bin").unwrap(),
    )) {
        Ok(_) => panic!("revoked roots must not remain readable"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "ROOT_NOT_AUTHORIZED");
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

fn create_directory(temp: &TempDir, name: &str) -> PathBuf {
    let path = temp.path().join(name);
    std::fs::create_dir(&path).unwrap();
    path
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn relative(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).unwrap()
}

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}
