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

/// Independently reproduces the stable roots identity backup uses as its
/// on-disk subdirectory name, from the same ambient paths a test authorized.
/// Canonicalizes each path itself (mirroring what root authorization does
/// internally) so this stays correct even when a platform's temp directory
/// is itself a symlink (macOS's `/tmp` -> `/private/tmp`, for example).
fn expected_identity_dir_name(ambient_paths: &[&std::path::Path]) -> String {
    let canonical: Vec<PathBuf> = ambient_paths
        .iter()
        .map(|path| std::fs::canonicalize(path).expect("path canonicalizes"))
        .collect();
    crate::workspace::stable_roots_identity(&canonical).expect("non-empty root set has an identity")
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
    let identity_dir_name = expected_identity_dir_name(&[root.path()]);

    block_on(backup.write(&workspace, "main", key("alpha"), b"kept".to_vec())).unwrap();
    backup.close_window("main");
    workspace.close_window("main");

    let on_disk = base
        .path()
        .join("backups")
        .join(&identity_dir_name)
        .join("alpha");
    assert_eq!(std::fs::read(on_disk).unwrap(), b"kept");
}

/// Directory-key assertion: the on-disk subdirectory name is exactly the
/// stable roots identity — a 64-character lowercase hex SHA-256 digest of
/// the sorted canonical root paths — never the window's per-session random
/// `WorkspaceId`.
#[test]
fn the_backup_subdirectory_is_named_after_the_stable_roots_identity_not_the_session_workspace_id() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());
    let identity_dir_name = expected_identity_dir_name(&[root.path()]);
    let session_workspace_id = workspace.snapshot("main").unwrap().workspace_id().as_wire();

    block_on(backup.write(&workspace, "main", key("alpha"), b"kept".to_vec())).unwrap();

    assert_eq!(identity_dir_name.len(), 64);
    assert!(identity_dir_name
        .bytes()
        .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')));
    assert_ne!(identity_dir_name, session_workspace_id);
    assert!(base
        .path()
        .join("backups")
        .join(&identity_dir_name)
        .join("alpha")
        .is_file());
    assert!(!base
        .path()
        .join("backups")
        .join(&session_workspace_id)
        .exists());
}

/// Restart simulation: a brand-new `WorkspaceService` (a fresh per-session
/// random `WorkspaceId`, exactly like a fresh app launch) that reopens the
/// exact same root reproduces the exact same identity/backup directory, so
/// previously written content is found again with no additional wiring.
#[test]
fn reopening_the_same_root_in_a_fresh_service_reproduces_the_same_identity_and_backup_directory() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();

    let first_session = workspace_with_root("main", root.path());
    let first_session_snapshot = first_session.snapshot("main").unwrap();
    let backup = BackupService::new(base.path().to_path_buf());
    block_on(backup.write(&first_session, "main", key("alpha"), b"kept".to_vec())).unwrap();
    backup.close_window("main");
    first_session.close_window("main");

    // A fresh service/session, as if the whole application had restarted.
    // Its per-session `WorkspaceId` and `RootId` are freshly random, so the
    // raw snapshot differs from the first session's even though it is the
    // exact same root directory.
    let second_session = workspace_with_root("main", root.path());
    assert_ne!(
        first_session_snapshot,
        second_session.snapshot("main").unwrap()
    );

    assert_eq!(
        block_on(backup.read_all(&second_session, "main")).unwrap(),
        vec![("alpha".to_owned(), b"kept".to_vec())],
    );
}

/// Identity changes whenever the authorized root set changes (add, remove,
/// replace), and a backup written under a superseded identity becomes
/// unreachable through the new one — mirroring upstream's "workspace
/// identity changed" semantics for hot-exit backups.
#[test]
fn the_stable_identity_changes_whenever_the_authorized_root_set_changes() {
    let base = TempDir::new().unwrap();
    let root_a = TempDir::new().unwrap();
    let root_b = TempDir::new().unwrap();
    let backup = BackupService::new(base.path().to_path_buf());

    let workspace = workspace_with_root("main", root_a.path());
    block_on(backup.write(&workspace, "main", key("alpha"), b"under-a".to_vec())).unwrap();
    let identity_with_a_only = expected_identity_dir_name(&[root_a.path()]);

    // Add a second root: the identity must change, and the previously
    // written entry must not be visible through the new identity.
    let picker = FakePicker::selected(vec![root_b.path().to_path_buf()]);
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add)).unwrap();
    let identity_with_a_and_b = expected_identity_dir_name(&[root_a.path(), root_b.path()]);
    assert_ne!(identity_with_a_only, identity_with_a_and_b);
    assert!(block_on(backup.read_all(&workspace, "main"))
        .unwrap()
        .is_empty());

    block_on(backup.write(&workspace, "main", key("beta"), b"under-a-and-b".to_vec())).unwrap();

    // Replace back down to just `root_b`: the identity must change again,
    // distinct from both prior identities.
    let picker = FakePicker::selected(vec![root_b.path().to_path_buf()]);
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Replace)).unwrap();
    let identity_with_b_only = expected_identity_dir_name(&[root_b.path()]);
    assert_ne!(identity_with_b_only, identity_with_a_only);
    assert_ne!(identity_with_b_only, identity_with_a_and_b);
    assert!(block_on(backup.read_all(&workspace, "main"))
        .unwrap()
        .is_empty());

    // Every identity's own on-disk content is untouched and independently
    // reachable by reauthorizing its exact root set.
    assert_eq!(
        std::fs::read(
            base.path()
                .join("backups")
                .join(&identity_with_a_only)
                .join("alpha")
        )
        .unwrap(),
        b"under-a"
    );
    assert_eq!(
        std::fs::read(
            base.path()
                .join("backups")
                .join(&identity_with_a_and_b)
                .join("beta")
        )
        .unwrap(),
        b"under-a-and-b"
    );
}

/// Concatenation-ambiguity adversarial case: two root sets whose paths
/// concatenate to the same raw bytes (`["/a/b", "/c"]` vs. `["/a", "/b/c"]`)
/// must never collide, because each path is hashed with its own explicit
/// length prefix rather than joined by a separator character.
#[test]
fn root_sets_that_would_naively_concatenate_identically_never_collide() {
    let left = [PathBuf::from("/a/b"), PathBuf::from("/c")];
    let right = [PathBuf::from("/a"), PathBuf::from("/b/c")];
    let naive_concat = |paths: &[PathBuf]| -> String {
        paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    };
    assert_eq!(
        naive_concat(&left),
        naive_concat(&right),
        "test fixture sanity: the two sets really do share a naive concatenation"
    );

    let left_identity =
        crate::workspace::stable_roots_identity(&left).expect("non-empty set has an identity");
    let right_identity =
        crate::workspace::stable_roots_identity(&right).expect("non-empty set has an identity");
    assert_ne!(left_identity, right_identity);
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
