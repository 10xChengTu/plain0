use std::cell::Cell;
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tempfile::TempDir;

use super::{
    directory_journal, directory_state_mut, prepare_batch, remove_alias_index,
    verify_member_stream, AliasJournal, DeleteBudget, DeleteHooks, DeleteSelection, DirectoryIndex,
    DirectoryReceipt, ManifestEntry, ManifestEntryKind, NodeKind, NodeSnapshot,
    MAX_DELETE_DESCENDANTS, MAX_DELETE_ENTRY_NAME_BYTES, MAX_DELETE_SYMLINK_BYTES,
    MAX_DELETE_TREE_NAME_BYTES, MAX_DELETE_TREE_SYMLINK_BYTES,
};
use crate::path_policy::RelativePath;
use crate::workspace::dto::{WorkspaceDeleteIncompleteReason, WorkspaceDeleteResult};
use crate::workspace::writer::FileIdentity;
use crate::workspace::WorkspaceScope;

struct ChmodParentAfterFirstRemove {
    parent: PathBuf,
}

impl DeleteHooks for ChmodParentAfterFirstRemove {
    fn after_remove(&mut self, _entry_index: usize, removed_entries: u32) {
        if removed_entries == 1 {
            set_mode(&self.parent, 0o700);
        }
    }
}

struct FailNthRemove {
    fail_at: u32,
}

impl DeleteHooks for FailNthRemove {
    fn fail_before_remove(&mut self, _entry_index: usize, next_removed_entries: u32) -> bool {
        next_removed_entries == self.fail_at
    }
}

struct AddUnknownMemberAfterFirstRemove {
    member: PathBuf,
}

#[test]
fn delete_namespace_and_link_budgets_accept_exact_limits_and_reject_plus_one() {
    let mut descendants = DeleteBudget::default();
    for _ in 0..MAX_DELETE_DESCENDANTS {
        descendants.reserve_name(1).unwrap();
    }
    assert_eq!(
        descendants.reserve_name(1).unwrap_err().code(),
        "DIRECTORY_TOO_LARGE"
    );

    let mut names = DeleteBudget::default();
    for _ in 0..(MAX_DELETE_TREE_NAME_BYTES / MAX_DELETE_ENTRY_NAME_BYTES) {
        names.reserve_name(MAX_DELETE_ENTRY_NAME_BYTES).unwrap();
    }
    assert_eq!(
        names.reserve_name(1).unwrap_err().code(),
        "DIRECTORY_TOO_LARGE"
    );
    assert_eq!(
        DeleteBudget::default()
            .reserve_name(MAX_DELETE_ENTRY_NAME_BYTES + 1)
            .unwrap_err()
            .code(),
        "PATH_ENCODING_UNSUPPORTED"
    );

    let mut links = DeleteBudget::default();
    for _ in 0..(MAX_DELETE_TREE_SYMLINK_BYTES / MAX_DELETE_SYMLINK_BYTES) {
        links.reserve_link(MAX_DELETE_SYMLINK_BYTES).unwrap();
    }
    assert_eq!(links.reserve_link(1).unwrap_err().code(), "FILE_TOO_LARGE");
    assert_eq!(
        DeleteBudget::default()
            .reserve_link(MAX_DELETE_SYMLINK_BYTES + 1)
            .unwrap_err()
            .code(),
        "FILE_TOO_LARGE"
    );
}

#[test]
fn compact_manifest_stores_each_basename_once_for_deep_prefix_and_wide_leaves() {
    let mut entries = Vec::with_capacity(MAX_DELETE_DESCENDANTS);
    let mut parent = DirectoryIndex::Root;
    let deep_name = "d".repeat(255);
    for index in 0..255 {
        entries.push(ManifestEntry {
            name: deep_name.clone(),
            parent,
            kind: ManifestEntryKind::Directory(snapshot(NodeKind::Directory, index as u64 + 2)),
        });
        parent = DirectoryIndex::Entry(index);
    }
    for index in 255..MAX_DELETE_DESCENDANTS {
        entries.push(ManifestEntry {
            name: format!("leaf-{index:04}"),
            parent,
            kind: ManifestEntryKind::File(snapshot(NodeKind::File, index as u64 + 2)),
        });
    }
    let receipt = DirectoryReceipt {
        root: snapshot(NodeKind::Directory, 1),
        entries,
    };
    let stored_name_bytes = receipt
        .entries
        .iter()
        .map(|entry| entry.name.len())
        .sum::<usize>();
    let expanded_leaf_prefix_bytes = 255 * 255 * (MAX_DELETE_DESCENDANTS - 255);

    assert!(stored_name_bytes <= MAX_DELETE_TREE_NAME_BYTES);
    assert!(expanded_leaf_prefix_bytes > MAX_DELETE_TREE_NAME_BYTES * 100);
    let journal = directory_journal(&receipt).unwrap();
    assert_eq!(journal.entries.len(), MAX_DELETE_DESCENDANTS);
    assert_eq!(journal.root.members.len(), 1);
    assert_eq!(
        journal.entries[254].as_ref().unwrap().members.len(),
        MAX_DELETE_DESCENDANTS - 255
    );
}

#[test]
fn late_directory_with_wide_children_uses_direct_index_journal_updates() {
    let directory_index = MAX_DELETE_DESCENDANTS / 2;
    let mut entries = Vec::with_capacity(MAX_DELETE_DESCENDANTS);
    for index in 0..directory_index {
        entries.push(ManifestEntry {
            name: format!("root-leaf-{index:04}"),
            parent: DirectoryIndex::Root,
            kind: ManifestEntryKind::File(snapshot(NodeKind::File, index as u64 + 2)),
        });
    }
    entries.push(ManifestEntry {
        name: "late-directory".to_owned(),
        parent: DirectoryIndex::Root,
        kind: ManifestEntryKind::Directory(snapshot(
            NodeKind::Directory,
            directory_index as u64 + 2,
        )),
    });
    for index in directory_index + 1..MAX_DELETE_DESCENDANTS {
        entries.push(ManifestEntry {
            name: format!("wide-{index:04}"),
            parent: DirectoryIndex::Entry(directory_index),
            kind: ManifestEntryKind::File(snapshot(NodeKind::File, index as u64 + 2)),
        });
    }
    let receipt = DirectoryReceipt {
        root: snapshot(NodeKind::Directory, 1),
        entries,
    };
    let mut journal = directory_journal(&receipt).unwrap();
    assert_eq!(
        journal.entries[directory_index]
            .as_ref()
            .unwrap()
            .members
            .len(),
        MAX_DELETE_DESCENDANTS - directory_index - 1
    );
    for ctime in 0..MAX_DELETE_DESCENDANTS as i64 {
        directory_state_mut(&mut journal, DirectoryIndex::Entry(directory_index))
            .unwrap()
            .snapshot
            .ctime = ctime;
    }
    assert_eq!(
        journal.entries[directory_index]
            .as_ref()
            .unwrap()
            .snapshot
            .ctime,
        MAX_DELETE_DESCENDANTS as i64 - 1
    );
}

#[test]
fn ten_thousand_alias_indices_transition_in_place_without_set_clones() {
    let mut journal = AliasJournal {
        nlink: MAX_DELETE_DESCENDANTS as u64,
        ctime: 1,
        ctime_nsec: 2,
        remaining_indices: (0..MAX_DELETE_DESCENDANTS).collect(),
    };
    for index in (0..MAX_DELETE_DESCENDANTS).rev() {
        let next = remove_alias_index(&mut journal, index).unwrap();
        assert_eq!(journal.remaining_indices.len(), index);
        assert_eq!(next, index.checked_sub(1));
    }
    assert_eq!(journal.nlink, 0);
    assert!(journal.remaining_indices.is_empty());
}

#[test]
fn member_stream_stops_at_the_first_unknown_without_collecting_the_flood() {
    let expected = BTreeSet::from([OsString::from("known")]);
    let visits = Cell::new(0_usize);
    let observed = std::iter::from_fn(|| {
        let visit = visits.get() + 1;
        visits.set(visit);
        if visit == 1 {
            Some(Ok(OsString::from("unknown")))
        } else {
            panic!("unknown-member verification must stop at the first mismatch")
        }
    });
    assert_eq!(
        verify_member_stream(&expected, observed).unwrap_err(),
        super::DeleteFailure::Changed
    );
    assert_eq!(visits.get(), 1);
}

#[test]
fn indexed_manifest_reopens_and_deletes_a_deep_chain_with_wide_leaves() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    let tree = root.join("tree");
    fs::create_dir_all(&tree).unwrap();
    let mut deepest = tree.clone();
    for depth in 0..64 {
        deepest.push(format!("d-{depth:02}"));
        fs::create_dir(&deepest).unwrap();
    }
    for index in 0..128 {
        fs::write(deepest.join(format!("leaf-{index:03}")), b"plain").unwrap();
    }
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(&root).unwrap();
    let lease = scope.lease(root_id).unwrap();
    let selection = DeleteSelection::new(root_id, RelativePath::parse_wire("tree").unwrap(), true);
    let mut receipt = prepare_batch(
        1,
        Instant::now() + Duration::from_secs(120),
        vec![(selection, lease)],
    )
    .unwrap();
    let lease = scope.lease(root_id).unwrap();

    assert_eq!(receipt.commit_next(&lease), WorkspaceDeleteResult::Deleted);
    assert!(!tree.exists());
}

impl DeleteHooks for AddUnknownMemberAfterFirstRemove {
    fn after_remove(&mut self, _entry_index: usize, removed_entries: u32) {
        if removed_entries == 1 {
            fs::write(&self.member, b"outside receipt").unwrap();
        }
    }
}

#[test]
fn a_post_remove_journal_failure_counts_the_successful_syscall() {
    let (temp, root, lease, selection) = prepared_tree(&["only"]);
    let tree = root.join("tree");
    set_mode(&tree, 0o755);
    let mut receipt = prepare_batch(
        1,
        Instant::now() + Duration::from_secs(120),
        vec![(selection, lease)],
    )
    .unwrap();
    let lease = authorized_lease(&root);
    let mut hooks = ChmodParentAfterFirstRemove {
        parent: tree.clone(),
    };

    let result = receipt.commit_next_with_hooks(&lease, &mut hooks);
    assert_eq!(
        result,
        WorkspaceDeleteResult::EntryPartiallyDeleted {
            reason: WorkspaceDeleteIncompleteReason::EntryChanged,
            removed_entries: 1,
        }
    );
    assert!(tree.is_dir());
    assert!(!tree.join("only").exists());
    drop(temp);
}

#[test]
fn nth_remove_failure_reports_the_exact_irreversible_count() {
    let (_temp, root, lease, selection) = prepared_tree(&["first", "second"]);
    let mut receipt = prepare_batch(
        1,
        Instant::now() + Duration::from_secs(120),
        vec![(selection, lease)],
    )
    .unwrap();
    let lease = authorized_lease(&root);
    let mut hooks = FailNthRemove { fail_at: 2 };

    let result = receipt.commit_next_with_hooks(&lease, &mut hooks);
    assert_eq!(
        result,
        WorkspaceDeleteResult::EntryPartiallyDeleted {
            reason: WorkspaceDeleteIncompleteReason::DeleteFailed,
            removed_entries: 1,
        }
    );
    assert!(root.join("tree").is_dir());
    assert_eq!(fs::read_dir(root.join("tree")).unwrap().count(), 1);
}

#[test]
fn an_unknown_member_is_preserved_and_stops_the_root_remove() {
    let (_temp, root, lease, selection) = prepared_tree(&["first", "second"]);
    let mut receipt = prepare_batch(
        1,
        Instant::now() + Duration::from_secs(120),
        vec![(selection, lease)],
    )
    .unwrap();
    let lease = authorized_lease(&root);
    let unknown = root.join("tree/unknown");
    let mut hooks = AddUnknownMemberAfterFirstRemove {
        member: unknown.clone(),
    };

    let result = receipt.commit_next_with_hooks(&lease, &mut hooks);
    assert_eq!(
        result,
        WorkspaceDeleteResult::EntryPartiallyDeleted {
            reason: WorkspaceDeleteIncompleteReason::EntryChanged,
            removed_entries: 2,
        }
    );
    assert_eq!(fs::read(unknown).unwrap(), b"outside receipt");
}

fn prepared_tree(
    names: &[&str],
) -> (
    TempDir,
    PathBuf,
    crate::workspace::WorkspaceRootLease,
    DeleteSelection,
) {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("tree")).unwrap();
    for name in names {
        fs::write(root.join("tree").join(name), name.as_bytes()).unwrap();
    }
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(&root).unwrap();
    let lease = scope.lease(root_id).unwrap();
    let selection = DeleteSelection::new(root_id, RelativePath::parse_wire("tree").unwrap(), true);
    (temp, root, lease, selection)
}

fn authorized_lease(root: &Path) -> crate::workspace::WorkspaceRootLease {
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(root).unwrap();
    scope.lease(root_id).unwrap()
}

fn snapshot(kind: NodeKind, inode: u64) -> NodeSnapshot {
    NodeSnapshot {
        identity: FileIdentity { device: 1, inode },
        kind,
        len: 0,
        mode: 0o755,
        mtime: 0,
        mtime_nsec: 0,
        ctime: 0,
        ctime_nsec: 0,
        nlink: 1,
    }
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}
