use std::collections::VecDeque;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Barrier, Mutex};

use tempfile::TempDir;

use super::WorkspaceService;
use crate::error::CommandError;
use crate::workspace::dto::WorkspacePickRootsStatus;
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
    let result = block_on(service.pick_roots("main", FakePicker::cancelled(), true)).unwrap();

    assert_eq!(result.status(), WorkspacePickRootsStatus::Cancelled);
    assert_eq!(result.snapshot(), &before);
    assert_eq!(service.snapshot("main").unwrap(), before);
}

#[test]
fn multi_selection_registers_roots_in_stable_authorization_order() {
    let temp = TempDir::new().unwrap();
    let first = create_directory(&temp, "first");
    let second = create_directory(&temp, "second");
    let service = WorkspaceService::new();

    let result =
        block_on(service.pick_roots("main", FakePicker::selected(vec![first, second]), true))
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
        true,
    ))
    .unwrap_err();
    assert_eq!(error.code(), "ROOT_UNAVAILABLE");
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains(temp.path().to_str().unwrap()));

    let unchanged = service.snapshot("main").unwrap();
    assert_eq!(unchanged.revision(), 0);
    assert!(unchanged.roots().is_empty());

    let retried =
        block_on(service.pick_roots("main", FakePicker::selected(vec![valid]), false)).unwrap();
    assert_eq!(retried.snapshot().revision(), 1);
    assert_eq!(retried.snapshot().roots().len(), 1);
}

#[test]
fn picker_paths_must_be_absolute_native_selections() {
    let service = WorkspaceService::new();
    let error = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![PathBuf::from("relative-root")]),
        false,
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
        true,
    ))
    .unwrap();
    assert_eq!(first.snapshot().revision(), 1);
    assert_eq!(first.snapshot().roots().len(), 1);
    let root_id = first.snapshot().roots()[0].root_id();

    let duplicate =
        block_on(service.pick_roots("main", FakePicker::selected(vec![root]), false)).unwrap();
    assert_eq!(duplicate.status(), WorkspacePickRootsStatus::Selected);
    assert_eq!(duplicate.snapshot().revision(), 1);
    assert_eq!(duplicate.snapshot().roots()[0].root_id(), root_id);
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

    let initial =
        block_on(service.pick_roots("main", FakePicker::selected(initial_roots), true)).unwrap();
    assert_eq!(initial.snapshot().revision(), 1);
    assert_eq!(initial.snapshot().roots().len(), 255);

    let boundary = block_on(service.pick_roots(
        "main",
        FakePicker::selected(vec![
            existing_duplicate.clone(),
            boundary_root.clone(),
            boundary_root,
        ]),
        true,
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
        true,
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
        true,
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
        false,
    ))
    .unwrap()
    .snapshot()
    .clone();
    let second =
        block_on(service.pick_roots("second-window", FakePicker::selected(vec![root]), false))
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
        first_service.pick_roots("main", picker, false).await
    });
    entered.wait();

    let conflict =
        block_on(service.pick_roots("main", FakePicker::cancelled(), false)).unwrap_err();
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
    let pending =
        tauri::async_runtime::spawn(
            async move { pick_service.pick_roots("main", picker, false).await },
        );
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
    let result =
        block_on(service.pick_roots("main", FakePicker::selected(vec![root]), false)).unwrap();

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

    let error =
        block_on(service.pick_roots("main", FakePicker::selected(vec![root]), false)).unwrap_err();
    assert_eq!(error.code(), "PATH_ENCODING_UNSUPPORTED");
    let serialized = serde_json::to_string(&error).unwrap();
    assert!(!serialized.contains("private"));
    assert_eq!(service.snapshot("main").unwrap().revision(), 0);
}

fn create_directory(temp: &TempDir, name: &str) -> PathBuf {
    let path = temp.path().join(name);
    std::fs::create_dir(&path).unwrap();
    path
}

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}
