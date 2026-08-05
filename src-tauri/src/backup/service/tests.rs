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

fn test_root_id() -> crate::workspace::RootId {
    crate::workspace::RootId::parse_v4_wire("00000000-0000-4000-8000-000000000001")
        .expect("valid test root id")
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

fn only_root_id(workspace: &WorkspaceService, window_label: &str) -> crate::workspace::RootId {
    let snapshot = workspace
        .snapshot(window_label)
        .expect("workspace snapshot");
    assert_eq!(snapshot.roots().len(), 1, "test helper requires one root");
    snapshot.roots()[0].root_id()
}

#[test]
fn write_then_read_all_round_trips_through_the_service() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());

    let root_id = only_root_id(&workspace, "main");
    block_on(backup.write(&workspace, "main", root_id, key("alpha"), b"one".to_vec())).unwrap();
    block_on(backup.write(&workspace, "main", root_id, key("beta"), b"two".to_vec())).unwrap();

    let mut entries = block_on(backup.read_all(&workspace, "main")).unwrap();
    entries.sort_by(|left, right| left.1.cmp(&right.1));
    assert_eq!(
        entries,
        vec![
            (root_id, "alpha".to_owned(), b"one".to_vec()),
            (root_id, "beta".to_owned(), b"two".to_vec()),
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

    let root_id = only_root_id(&workspace, "main");
    block_on(backup.write(&workspace, "main", root_id, key("one"), b"1".to_vec())).unwrap();
    block_on(backup.write(&workspace, "main", root_id, key("two"), b"2".to_vec())).unwrap();

    block_on(backup.discard(&workspace, "main", root_id, key("one"))).unwrap();
    block_on(backup.discard(&workspace, "main", root_id, key("one"))).unwrap();
    assert_eq!(
        block_on(backup.read_all(&workspace, "main")).unwrap(),
        vec![(root_id, "two".to_owned(), b"2".to_vec())]
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

    let root_id = only_root_id(&workspace, "main");
    block_on(backup.discard(&workspace, "main", root_id, key("never-written"))).unwrap();
    block_on(backup.discard_all(&workspace, "main")).unwrap();
}

#[test]
fn every_operation_reports_backup_unavailable_before_any_workspace_root_is_open() {
    let base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let backup = BackupService::new(base.path().to_path_buf());

    assert_eq!(
        block_on(backup.write(&workspace, "main", test_root_id(), key("k"), b"v".to_vec(),))
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
        block_on(backup.discard(&workspace, "main", test_root_id(), key("k")))
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

    let root_id = only_root_id(&workspace, "main");
    block_on(backup.write(&workspace, "main", root_id, key("alpha"), b"kept".to_vec())).unwrap();

    // Simulate `WindowEvent::Destroyed`: only the backup domain's own
    // pending handle is dropped, the workspace itself is untouched.
    backup.close_window("main");

    // A fresh call for the same window/workspace must reconstruct the
    // capability from disk and observe the exact same content.
    assert_eq!(
        block_on(backup.read_all(&workspace, "main")).unwrap(),
        vec![(root_id, "alpha".to_owned(), b"kept".to_vec())]
    );
}

#[test]
fn backup_content_survives_on_disk_even_after_the_workspace_window_itself_is_closed() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());
    let identity_dir_name = expected_identity_dir_name(&[root.path()]);

    let root_id = only_root_id(&workspace, "main");
    block_on(backup.write(&workspace, "main", root_id, key("alpha"), b"kept".to_vec())).unwrap();
    backup.close_window("main");
    workspace.close_window("main");

    let on_disk = base
        .path()
        .join("backups")
        .join("roots")
        .join(&identity_dir_name)
        .join("alpha");
    assert_eq!(std::fs::read(on_disk).unwrap(), b"kept");
}

/// Directory-key assertion: the on-disk subdirectory name is exactly the
/// stable roots identity — a 64-character lowercase hex SHA-256 digest of
/// the sorted canonical root paths — never the window's per-session random
/// `WorkspaceId`.
#[test]
fn the_backup_subdirectory_is_named_after_the_stable_root_identity_not_the_session_ids() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let backup = BackupService::new(base.path().to_path_buf());
    let identity_dir_name = expected_identity_dir_name(&[root.path()]);
    let session_workspace_id = workspace.snapshot("main").unwrap().workspace_id().as_wire();
    let root_id = only_root_id(&workspace, "main");

    block_on(backup.write(&workspace, "main", root_id, key("alpha"), b"kept".to_vec())).unwrap();

    assert_eq!(identity_dir_name.len(), 64);
    assert!(identity_dir_name
        .bytes()
        .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')));
    assert_ne!(identity_dir_name, session_workspace_id);
    assert!(base
        .path()
        .join("backups")
        .join("roots")
        .join(&identity_dir_name)
        .join("alpha")
        .is_file());
    assert!(!base
        .path()
        .join("backups")
        .join("roots")
        .join(&session_workspace_id)
        .exists());
    assert!(!base
        .path()
        .join("backups")
        .join("roots")
        .join(root_id.as_wire())
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
    let first_root_id = only_root_id(&first_session, "main");
    block_on(backup.write(
        &first_session,
        "main",
        first_root_id,
        key("alpha"),
        b"kept".to_vec(),
    ))
    .unwrap();
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
        vec![(
            only_root_id(&second_session, "main"),
            "alpha".to_owned(),
            b"kept".to_vec()
        )],
    );
}

/// `F220` S4: the remote-root twin of
/// `reopening_the_same_root_in_a_fresh_service_reproduces_the_same_identity_and_backup_directory`
/// above — proves the `RootBackend::RemoteSsh` identity digest
/// (`workspace::stable_remote_root_identity`, wired into
/// `WorkspaceScope::root_storage_identities` back in `F220` S2) still
/// resolves to the exact same on-disk storage partition across a **full
/// service restart** (a brand-new `WorkspaceService` *and* a brand-new
/// `BackupService`, both pointed at the same `base_path` — not just a fresh
/// `WorkspaceService` reusing the original `BackupService` like the local
/// test above does), which is the closer analogue of a real cold start.
/// Uses `authorize_remote_root_for_test` (no live SSH session needed — this
/// test is purely about the identity/storage-digest contract, not the
/// network transport) to construct the remote root, exactly like `F220` S2's
/// own remote-identity tests already do.
#[test]
fn a_remote_roots_backup_identity_survives_a_full_service_restart() {
    let base = TempDir::new().unwrap();
    let fingerprint = "SHA256:remote-identity-restart-test-fingerprint";
    let remote_path = "/srv/remote-project";

    let first_workspace = WorkspaceService::new();
    let first_backup = BackupService::new(base.path().to_path_buf());
    let first_root_id = first_workspace
        .authorize_remote_root_for_test("main", fingerprint, remote_path, "Remote Project")
        .unwrap();
    block_on(first_backup.write(
        &first_workspace,
        "main",
        first_root_id,
        key("alpha"),
        b"remote kept".to_vec(),
    ))
    .unwrap();
    first_backup.close_window("main");
    first_workspace.close_window("main");

    // A wholly new `WorkspaceService`/`BackupService` pair pointed at the
    // same `base_path` — simulating a full process restart, not merely a
    // new window within the same still-running process. Re-authorizing the
    // *same* remote identity (same fingerprint, same canonical path) mints a
    // fresh, unrelated `RootId` (proven below), but must still resolve to
    // the exact same on-disk storage partition.
    let second_workspace = WorkspaceService::new();
    let second_backup = BackupService::new(base.path().to_path_buf());
    let second_root_id = second_workspace
        .authorize_remote_root_for_test("main", fingerprint, remote_path, "Remote Project")
        .unwrap();
    assert_ne!(first_root_id, second_root_id);

    assert_eq!(
        block_on(second_backup.read_all(&second_workspace, "main")).unwrap(),
        vec![(second_root_id, "alpha".to_owned(), b"remote kept".to_vec())],
    );
}

#[test]
fn legacy_single_root_entries_are_mapped_exactly_and_removed_by_root_bound_discard() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let root_id = only_root_id(&workspace, "main");
    let identity = expected_identity_dir_name(&[root.path()]);
    let legacy_dir = base.path().join("backups").join(identity);
    std::fs::create_dir_all(&legacy_dir).unwrap();
    std::fs::write(legacy_dir.join("legacy-key"), b"legacy-content").unwrap();

    let backup = BackupService::new(base.path().to_path_buf());
    assert_eq!(
        block_on(backup.read_all(&workspace, "main")).unwrap(),
        vec![(root_id, "legacy-key".to_owned(), b"legacy-content".to_vec())]
    );

    block_on(backup.discard(&workspace, "main", root_id, key("legacy-key"))).unwrap();
    assert!(!legacy_dir.join("legacy-key").exists());
}

/// Backup ownership follows each stable root independently: adding another
/// root keeps the first root's entry visible, replacing the topology with
/// only the second root exposes only its entry, and re-adding the first root
/// restores both without relying on authorization order or old random ids.
#[test]
fn root_bound_backups_survive_topology_changes_without_cross_attachment() {
    let base = TempDir::new().unwrap();
    let root_a = TempDir::new().unwrap();
    let root_b = TempDir::new().unwrap();
    let backup = BackupService::new(base.path().to_path_buf());

    let workspace = workspace_with_root("main", root_a.path());
    let root_a_id = only_root_id(&workspace, "main");
    block_on(backup.write(
        &workspace,
        "main",
        root_a_id,
        key("same-key"),
        b"under-a".to_vec(),
    ))
    .unwrap();
    let identity_a = expected_identity_dir_name(&[root_a.path()]);

    let picker = FakePicker::selected(vec![root_b.path().to_path_buf()]);
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add)).unwrap();
    let roots = workspace.snapshot("main").unwrap();
    let root_b_id = roots.roots()[1].root_id();
    assert_eq!(
        block_on(backup.read_all(&workspace, "main")).unwrap(),
        vec![(root_a_id, "same-key".to_owned(), b"under-a".to_vec())]
    );

    block_on(backup.write(
        &workspace,
        "main",
        root_b_id,
        key("same-key"),
        b"under-b".to_vec(),
    ))
    .unwrap();
    let identity_b = expected_identity_dir_name(&[root_b.path()]);

    let picker = FakePicker::selected(vec![root_b.path().to_path_buf()]);
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Replace)).unwrap();
    let reopened_b_id = only_root_id(&workspace, "main");
    assert_eq!(
        block_on(backup.read_all(&workspace, "main")).unwrap(),
        vec![(reopened_b_id, "same-key".to_owned(), b"under-b".to_vec())]
    );

    let picker = FakePicker::selected(vec![root_a.path().to_path_buf()]);
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add)).unwrap();
    let current = workspace.snapshot("main").unwrap();
    let reopened_a_id = current.roots()[1].root_id();
    let mut entries = block_on(backup.read_all(&workspace, "main")).unwrap();
    entries.sort_by(|left, right| left.2.cmp(&right.2));
    assert_eq!(
        entries,
        vec![
            (reopened_a_id, "same-key".to_owned(), b"under-a".to_vec()),
            (reopened_b_id, "same-key".to_owned(), b"under-b".to_vec()),
        ]
    );

    assert_eq!(
        std::fs::read(
            base.path()
                .join("backups")
                .join("roots")
                .join(&identity_a)
                .join("same-key")
        )
        .unwrap(),
        b"under-a"
    );
    assert_eq!(
        std::fs::read(
            base.path()
                .join("backups")
                .join("roots")
                .join(&identity_b)
                .join("same-key")
        )
        .unwrap(),
        b"under-b"
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

    block_on(backup.write(&workspace, "main", root_id, key("alpha"), b"kept".to_vec())).unwrap();
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
    let root_id = only_root_id(&workspace, "main");

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
                        root_id,
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
    let mut observed: std::collections::BTreeMap<String, Vec<u8>> = entries
        .into_iter()
        .map(|(entry_root_id, key, content)| {
            assert_eq!(entry_root_id, root_id);
            (key, content)
        })
        .collect();
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
    let root_id = only_root_id(&workspace, "main");

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
                    .write(&workspace, "main", root_id, key("shared"), candidate)
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
    let (entry_root_id, name, bytes) = &entries[0];
    assert_eq!(*entry_root_id, root_id);
    assert_eq!(name, "shared");
    assert!(
        candidates.contains(bytes),
        "the surviving content must be exactly one uncorrupted candidate"
    );
}
