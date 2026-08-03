use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use serde_json::json;
use tempfile::TempDir;

use super::{
    prepare_batch, PlatformTrash, PlatformTrashOutcome, PlatformTrashRequest, TrashSelection,
};
use crate::path_policy::RelativePath;
use crate::workspace::dto::{WorkspaceTrashIncompleteReason, WorkspaceTrashResult};
use crate::workspace::{RootId, WorkspaceRootLease};

fn lease(root_id: RootId, path: &Path) -> WorkspaceRootLease {
    WorkspaceRootLease {
        root_id,
        directory: Dir::open_ambient_dir(path, ambient_authority()).unwrap(),
        canonical_path: path.canonicalize().unwrap(),
    }
}

fn selected(
    root_id: RootId,
    root: &Path,
    paths: &[&str],
) -> Vec<(TrashSelection, WorkspaceRootLease)> {
    paths
        .iter()
        .map(|path| {
            (
                TrashSelection::new(root_id, RelativePath::parse_wire(path).unwrap()),
                lease(root_id, root),
            )
        })
        .collect()
}

fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(60)
}

struct FakePlatform {
    outcomes: VecDeque<PlatformTrashOutcome>,
    remove_after_attempt: bool,
    seen: Vec<PathBuf>,
}

impl FakePlatform {
    fn new(outcomes: impl IntoIterator<Item = PlatformTrashOutcome>) -> Self {
        Self {
            outcomes: outcomes.into_iter().collect(),
            remove_after_attempt: false,
            seen: Vec::new(),
        }
    }
}

impl PlatformTrash for FakePlatform {
    fn move_to_trash(&mut self, request: &PlatformTrashRequest) -> PlatformTrashOutcome {
        self.seen.push(request.target_path.clone());
        let outcome = self.outcomes.pop_front().unwrap();
        if self.remove_after_attempt && outcome == PlatformTrashOutcome::FailedAfterAttempt {
            if request.target_path.is_dir() {
                std::fs::remove_dir_all(&request.target_path).unwrap();
            } else {
                std::fs::remove_file(&request.target_path).unwrap();
            }
        }
        outcome
    }
}

#[test]
fn plan_is_path_free_and_keeps_file_directory_and_symlink_kinds() {
    let temp = TempDir::new().unwrap();
    std::fs::write(temp.path().join("file.txt"), b"file").unwrap();
    std::fs::create_dir(temp.path().join("folder")).unwrap();
    std::os::unix::fs::symlink("file.txt", temp.path().join("link")).unwrap();
    let root_id = RootId::new();
    let receipt = prepare_batch(
        9,
        deadline(),
        selected(root_id, temp.path(), &["file.txt", "folder", "link"]),
    )
    .unwrap();

    let value = serde_json::to_value(receipt.plan()).unwrap();
    assert_eq!(
        value,
        json!({
            "confirmationId": value["confirmationId"].clone(),
            "entries": [
                { "entryId": value["entries"][0]["entryId"].clone(), "kind": "file" },
                { "entryId": value["entries"][1]["entryId"].clone(), "kind": "directory" },
                { "entryId": value["entries"][2]["entryId"].clone(), "kind": "symlink" }
            ]
        })
    );
    let wire = serde_json::to_string(&value).unwrap();
    assert!(!wire.contains(temp.path().to_string_lossy().as_ref()));
    assert!(!wire.contains("file.txt"));
}

#[test]
fn preparation_rejects_path_overlap_and_hardlink_aliases() {
    let temp = TempDir::new().unwrap();
    std::fs::create_dir(temp.path().join("folder")).unwrap();
    std::fs::write(temp.path().join("folder/child.txt"), b"child").unwrap();
    let root_id = RootId::new();
    assert_eq!(
        prepare_batch(
            1,
            deadline(),
            selected(root_id, temp.path(), &["folder", "folder/child.txt"]),
        )
        .err()
        .unwrap()
        .code(),
        "WORKSPACE_CONFLICT"
    );

    std::fs::write(temp.path().join("first.txt"), b"same inode").unwrap();
    std::fs::hard_link(
        temp.path().join("first.txt"),
        temp.path().join("second.txt"),
    )
    .unwrap();
    assert_eq!(
        prepare_batch(
            1,
            deadline(),
            selected(root_id, temp.path(), &["first.txt", "second.txt"]),
        )
        .err()
        .unwrap()
        .code(),
        "WORKSPACE_CONFLICT"
    );
}

#[test]
fn begin_revalidation_detects_changed_bytes_without_calling_platform_trash() {
    let temp = TempDir::new().unwrap();
    std::fs::write(temp.path().join("note.txt"), b"before").unwrap();
    let root_id = RootId::new();
    let receipt =
        prepare_batch(4, deadline(), selected(root_id, temp.path(), &["note.txt"])).unwrap();
    std::fs::write(temp.path().join("note.txt"), b"after with another length").unwrap();
    let leases = BTreeMap::from([(root_id, lease(root_id, temp.path()))]);
    assert_eq!(
        receipt.revalidate_all(&leases).unwrap_err().code(),
        "WORKSPACE_TRASH_BATCH_CHANGED"
    );
}

#[test]
fn sequential_receipt_stops_on_first_retained_entry_and_never_invokes_another_surface() {
    let temp = TempDir::new().unwrap();
    std::fs::write(temp.path().join("first.txt"), b"first").unwrap();
    std::fs::write(temp.path().join("second.txt"), b"second").unwrap();
    let root_id = RootId::new();
    let mut receipt = prepare_batch(
        7,
        deadline(),
        selected(root_id, temp.path(), &["first.txt", "second.txt"]),
    )
    .unwrap();
    receipt.begin();
    let mut platform = FakePlatform::new([
        PlatformTrashOutcome::Trashed,
        PlatformTrashOutcome::FailedBeforeAttempt,
    ]);
    let root_lease = lease(root_id, temp.path());

    assert_eq!(
        receipt.commit_next_with_platform(&root_lease, &mut platform),
        WorkspaceTrashResult::Trashed
    );
    assert_eq!(
        receipt.commit_next_with_platform(&root_lease, &mut platform),
        WorkspaceTrashResult::EntryRetained {
            reason: WorkspaceTrashIncompleteReason::TrashFailed,
        }
    );
    assert!(!receipt.is_complete());
    let canonical_root = temp.path().canonicalize().unwrap();
    assert_eq!(
        platform.seen,
        [
            canonical_root.join("first.txt"),
            canonical_root.join("second.txt")
        ]
    );
}

#[test]
fn attempted_platform_failure_distinguishes_proven_retained_from_unknown() {
    let temp = TempDir::new().unwrap();
    std::fs::write(temp.path().join("retained.txt"), b"retained").unwrap();
    let root_id = RootId::new();
    let mut retained_receipt = prepare_batch(
        1,
        deadline(),
        selected(root_id, temp.path(), &["retained.txt"]),
    )
    .unwrap();
    retained_receipt.begin();
    let mut retained_platform = FakePlatform::new([PlatformTrashOutcome::FailedAfterAttempt]);
    assert_eq!(
        retained_receipt
            .commit_next_with_platform(&lease(root_id, temp.path()), &mut retained_platform),
        WorkspaceTrashResult::EntryRetained {
            reason: WorkspaceTrashIncompleteReason::TrashFailed,
        }
    );

    std::fs::write(temp.path().join("unknown.txt"), b"unknown").unwrap();
    let mut unknown_receipt = prepare_batch(
        2,
        deadline(),
        selected(root_id, temp.path(), &["unknown.txt"]),
    )
    .unwrap();
    unknown_receipt.begin();
    let mut unknown_platform = FakePlatform::new([PlatformTrashOutcome::FailedAfterAttempt]);
    unknown_platform.remove_after_attempt = true;
    assert_eq!(
        unknown_receipt
            .commit_next_with_platform(&lease(root_id, temp.path()), &mut unknown_platform),
        WorkspaceTrashResult::OutcomeUnknown
    );
}

#[test]
fn receipt_phase_deadline_and_exact_next_entry_are_one_shot() {
    let temp = TempDir::new().unwrap();
    std::fs::write(temp.path().join("note.txt"), b"note").unwrap();
    let root_id = RootId::new();
    let now = Instant::now();
    let mut receipt = prepare_batch(
        11,
        now + Duration::from_secs(1),
        selected(root_id, temp.path(), &["note.txt"]),
    )
    .unwrap();
    let plan = receipt.plan();
    let entry_id = plan.entries()[0].entry_id();
    let path = RelativePath::parse_wire("note.txt").unwrap();

    assert!(receipt.is_prepared());
    assert!(!receipt.is_executing());
    assert!(!receipt.is_expired(now));
    assert!(receipt.is_expired(now + Duration::from_secs(1)));
    assert!(receipt.matches_next(entry_id, root_id, &path));
    receipt.begin();
    assert!(receipt.is_executing());
    assert!(!receipt.matches_next(TrashEntryIdForTest::different(), root_id, &path));
}

struct TrashEntryIdForTest;

impl TrashEntryIdForTest {
    fn different() -> crate::workspace::dto::TrashEntryId {
        serde_json::from_str("\"00000000-0000-4000-8000-000000000001\"").unwrap()
    }
}
