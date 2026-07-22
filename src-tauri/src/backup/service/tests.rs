use std::future::Future;
use std::path::PathBuf;

use tempfile::TempDir;

use super::BackupService;
use crate::backup::BackupKey;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

struct FakePicker {
    paths: Vec<PathBuf>,
}

impl FakePicker {
    fn selected(paths: Vec<PathBuf>) -> Self {
        Self { paths }
    }
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

fn key(wire: &str) -> BackupKey {
    BackupKey::parse(wire).expect("valid key")
}

/// Authorizes `window_label` with a single root at `root_path` and returns
/// the fresh `WorkspaceService`.
fn workspace_with_root(window_label: &str, root_path: &std::path::Path) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(vec![root_path.to_path_buf()]);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

#[test]
fn write_then_read_all_round_trips_through_the_service() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());

    block_on(backup.write(&workspace, "main", key("alpha"), b"one".to_vec())).unwrap();
    block_on(backup.write(&workspace, "main", key("beta"), b"two".to_vec())).unwrap();

    let mut entries = block_on(backup.read_all(&workspace, "main")).unwrap();
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    assert_eq!(
        entries,
        vec![
            ("alpha".to_owned(), b"one".to_vec()),
            ("beta".to_owned(), b"two".to_vec()),
        ]
    );
}

#[test]
fn read_all_is_empty_for_an_authorized_workspace_with_no_backups() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());

    assert!(block_on(backup.read_all(&workspace, "main"))
        .unwrap()
        .is_empty());
}

#[test]
fn discard_is_idempotent_and_discard_all_clears_every_entry() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());

    block_on(backup.write(&workspace, "main", key("one"), b"1".to_vec())).unwrap();
    block_on(backup.write(&workspace, "main", key("two"), b"2".to_vec())).unwrap();

    block_on(backup.discard(&workspace, "main", key("one"))).unwrap();
    block_on(backup.discard(&workspace, "main", key("one"))).unwrap();
    assert_eq!(
        block_on(backup.read_all(&workspace, "main")).unwrap(),
        vec![("two".to_owned(), b"2".to_vec())]
    );

    block_on(backup.discard_all(&workspace, "main")).unwrap();
    block_on(backup.discard_all(&workspace, "main")).unwrap();
    assert!(block_on(backup.read_all(&workspace, "main"))
        .unwrap()
        .is_empty());
}

#[test]
fn discard_on_a_workspace_with_no_backup_directory_yet_is_a_no_op() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());

    block_on(backup.discard(&workspace, "main", key("never-written"))).unwrap();
    block_on(backup.discard_all(&workspace, "main")).unwrap();
}

#[test]
fn every_operation_reports_backup_unavailable_before_any_workspace_root_is_open() {
    let base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let backup = BackupService::new(base.path().to_path_buf());

    assert_eq!(
        block_on(backup.write(&workspace, "main", key("k"), b"v".to_vec()))
            .unwrap_err()
            .code(),
        "BACKUP_UNAVAILABLE"
    );
    assert_eq!(
        block_on(backup.read_all(&workspace, "main"))
            .unwrap_err()
            .code(),
        "BACKUP_UNAVAILABLE"
    );
    assert_eq!(
        block_on(backup.discard(&workspace, "main", key("k")))
            .unwrap_err()
            .code(),
        "BACKUP_UNAVAILABLE"
    );
    assert_eq!(
        block_on(backup.discard_all(&workspace, "main"))
            .unwrap_err()
            .code(),
        "BACKUP_UNAVAILABLE"
    );
}

#[test]
fn backup_content_survives_on_disk_after_the_window_is_closed() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());

    block_on(backup.write(&workspace, "main", key("alpha"), b"kept".to_vec())).unwrap();

    // Simulate `WindowEvent::Destroyed`: only the backup domain's own
    // pending handle is dropped, the workspace itself is untouched.
    backup.close_window("main");

    // A fresh call for the same window/workspace must reconstruct the
    // capability from disk and observe the exact same content.
    assert_eq!(
        block_on(backup.read_all(&workspace, "main")).unwrap(),
        vec![("alpha".to_owned(), b"kept".to_vec())]
    );
}

#[test]
fn backup_content_survives_on_disk_even_after_the_workspace_window_itself_is_closed() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());
    let workspace_id = workspace.snapshot("main").unwrap().workspace_id().as_wire();

    block_on(backup.write(&workspace, "main", key("alpha"), b"kept".to_vec())).unwrap();
    backup.close_window("main");
    workspace.close_window("main");

    let on_disk = base
        .path()
        .join("backups")
        .join(&workspace_id)
        .join("alpha");
    assert_eq!(std::fs::read(on_disk).unwrap(), b"kept");
}

#[test]
fn a_window_with_zero_authorized_roots_after_removal_reports_backup_unavailable() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());
    let snapshot = workspace.snapshot("main").unwrap();
    let root_id = snapshot.roots()[0].root_id();

    block_on(backup.write(&workspace, "main", key("alpha"), b"kept".to_vec())).unwrap();
    workspace.remove_root("main", root_id).unwrap();

    assert_eq!(
        block_on(backup.read_all(&workspace, "main"))
            .unwrap_err()
            .code(),
        "BACKUP_UNAVAILABLE"
    );
}

#[test]
fn concurrent_writes_to_distinct_keys_are_all_observable_afterward() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = std::sync::Arc::new(workspace_with_root("main", root.path()));
    let backup = std::sync::Arc::new(BackupService::new(base.path().to_path_buf()));

    block_on(async {
        let mut handles = Vec::new();
        for index in 0..16 {
            let workspace = std::sync::Arc::clone(&workspace);
            let backup = std::sync::Arc::clone(&backup);
            handles.push(tauri::async_runtime::spawn(async move {
                backup
                    .write(
                        &workspace,
                        "main",
                        key(&format!("k{index}")),
                        format!("v{index}").into_bytes(),
                    )
                    .await
                    .unwrap();
            }));
        }
        for handle in handles {
            handle.await.unwrap();
        }
    });

    let entries = block_on(backup.read_all(&workspace, "main")).unwrap();
    let mut observed: std::collections::BTreeMap<String, Vec<u8>> = entries.into_iter().collect();
    assert_eq!(observed.len(), 16);
    for index in 0..16 {
        assert_eq!(
            observed.remove(&format!("k{index}")),
            Some(format!("v{index}").into_bytes())
        );
    }
}

#[test]
fn racing_writes_to_the_same_key_are_serialized_into_exactly_one_clean_winner() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = std::sync::Arc::new(workspace_with_root("main", root.path()));
    let backup = std::sync::Arc::new(BackupService::new(base.path().to_path_buf()));

    let candidates: Vec<Vec<u8>> = (0..12)
        .map(|index| format!("candidate-{index}").into_bytes())
        .collect();

    block_on(async {
        let mut handles = Vec::new();
        for candidate in candidates.clone() {
            let workspace = std::sync::Arc::clone(&workspace);
            let backup = std::sync::Arc::clone(&backup);
            handles.push(tauri::async_runtime::spawn(async move {
                backup
                    .write(&workspace, "main", key("shared"), candidate)
                    .await
                    .unwrap();
            }));
        }
        for handle in handles {
            handle.await.unwrap();
        }
    });

    let entries = block_on(backup.read_all(&workspace, "main")).unwrap();
    assert_eq!(entries.len(), 1);
    let (name, bytes) = &entries[0];
    assert_eq!(name, "shared");
    assert!(
        candidates.contains(bytes),
        "the surviving content must be exactly one uncorrupted candidate"
    );
}
