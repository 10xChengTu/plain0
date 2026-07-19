//! Bounded, capability-relative permanent delete receipts.
//!
//! A receipt never crosses IPC and never retains a directory handle across the
//! user-confirmation gap. Every begin/commit reopens the requested namespace
//! through the currently authorized root and compares it with the receipt.

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::io;
use std::path::{Component, Path};
use std::time::Instant;

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, File, Metadata, OpenOptions};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{
    DeleteConfirmationId, DeleteEntryId, WorkspaceDeleteBatchPlan, WorkspaceDeleteEntryKind,
    WorkspaceDeleteEntryPlan, WorkspaceDeleteIncompleteReason, WorkspaceDeleteResult,
};
use super::writer::{read_symlink_payload, FileIdentity};
use super::{RootId, WorkspaceRootLease};

pub(super) const MAX_DELETE_BATCH_ENTRIES: usize = 64;
pub(super) const MAX_DELETE_DESCENDANTS: usize = 10_000;
pub(super) const MAX_DELETE_TREE_DEPTH: usize = 256;
pub(super) const MAX_DELETE_ENTRY_NAME_BYTES: usize = 1_024;
pub(super) const MAX_DELETE_TREE_NAME_BYTES: usize = 2 * 1_024 * 1_024;
pub(super) const MAX_DELETE_SYMLINK_BYTES: usize = 4 * 1_024;
pub(super) const MAX_DELETE_TREE_SYMLINK_BYTES: usize = 2 * 1_024 * 1_024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct DeleteSelection {
    root_id: RootId,
    relative_path: RelativePath,
    recursive: bool,
}

impl DeleteSelection {
    pub(super) fn new(root_id: RootId, relative_path: RelativePath, recursive: bool) -> Self {
        Self {
            root_id,
            relative_path,
            recursive,
        }
    }

    pub(super) const fn root_id(&self) -> RootId {
        self.root_id
    }
}

/// The complete Rust-only authorization and disk snapshot for one confirmation.
///
/// Deliberately does not implement `Serialize` or `Deserialize`.
pub(super) struct DeleteBatchReceipt {
    confirmation_id: DeleteConfirmationId,
    workspace_revision: u64,
    phase: DeleteBatchPhase,
    idle_deadline: Instant,
    entries: Vec<DeleteBatchEntry>,
    next_entry: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DeleteBatchPhase {
    Prepared,
    Executing,
}

struct DeleteBatchEntry {
    entry_id: DeleteEntryId,
    selection: DeleteSelection,
    receipt: DeleteEntryReceipt,
}

#[derive(Debug, Eq, PartialEq)]
struct DeleteEntryReceipt {
    parent_chain: Vec<FileIdentity>,
    kind: DeleteReceiptKind,
}

#[derive(Debug, Eq, PartialEq)]
enum DeleteReceiptKind {
    File(NodeSnapshot),
    Symlink {
        snapshot: NodeSnapshot,
        payload: Vec<u8>,
    },
    Directory(DirectoryReceipt),
}

#[derive(Debug, Eq, PartialEq)]
struct DirectoryReceipt {
    root: NodeSnapshot,
    entries: Vec<ManifestEntry>,
}

#[derive(Debug, Eq, PartialEq)]
struct ManifestEntry {
    name: String,
    parent: DirectoryIndex,
    kind: ManifestEntryKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DirectoryIndex {
    Root,
    Entry(usize),
}

#[derive(Debug, Eq, PartialEq)]
enum ManifestEntryKind {
    File(NodeSnapshot),
    Symlink {
        snapshot: NodeSnapshot,
        payload: Vec<u8>,
    },
    Directory(NodeSnapshot),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NodeKind {
    File,
    Directory,
    Symlink,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct NodeSnapshot {
    identity: FileIdentity,
    kind: NodeKind,
    len: u64,
    mode: u32,
    mtime: i64,
    mtime_nsec: i64,
    ctime: i64,
    ctime_nsec: i64,
    nlink: u64,
}

impl NodeSnapshot {
    fn from_metadata(metadata: &Metadata) -> Result<Self, CommandError> {
        use cap_std::fs::MetadataExt;

        let kind = if metadata.is_file() {
            NodeKind::File
        } else if metadata.is_dir() {
            NodeKind::Directory
        } else if metadata.file_type().is_symlink() {
            NodeKind::Symlink
        } else {
            return Err(entry_type_mismatch());
        };
        Ok(Self {
            identity: FileIdentity::from_metadata(metadata),
            kind,
            len: metadata.len(),
            mode: metadata.mode(),
            mtime: metadata.mtime(),
            mtime_nsec: metadata.mtime_nsec(),
            ctime: metadata.ctime(),
            ctime_nsec: metadata.ctime_nsec(),
            nlink: metadata.nlink(),
        })
    }

    fn directory_identity_matches(self, metadata: &Metadata) -> bool {
        metadata.is_dir() && FileIdentity::from_metadata(metadata) == self.identity
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct DeleteBudget {
    descendants: usize,
    name_bytes: usize,
    link_bytes: usize,
}

impl DeleteBudget {
    fn reserve_name(&mut self, bytes: usize) -> Result<(), CommandError> {
        if bytes > MAX_DELETE_ENTRY_NAME_BYTES {
            return Err(path_encoding_unsupported());
        }
        self.descendants = self
            .descendants
            .checked_add(1)
            .filter(|count| *count <= MAX_DELETE_DESCENDANTS)
            .ok_or_else(directory_too_large)?;
        self.name_bytes = self
            .name_bytes
            .checked_add(bytes)
            .filter(|count| *count <= MAX_DELETE_TREE_NAME_BYTES)
            .ok_or_else(directory_too_large)?;
        Ok(())
    }

    fn reserve_link(&mut self, bytes: usize) -> Result<(), CommandError> {
        if bytes > MAX_DELETE_SYMLINK_BYTES {
            return Err(file_too_large());
        }
        self.link_bytes = self
            .link_bytes
            .checked_add(bytes)
            .filter(|count| *count <= MAX_DELETE_TREE_SYMLINK_BYTES)
            .ok_or_else(file_too_large)?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DeleteFailure {
    Changed,
    Unverifiable,
    DeleteFailed,
}

trait DeleteHooks {
    fn fail_before_remove(&mut self, _entry_index: usize, _next_removed_entries: u32) -> bool {
        false
    }

    fn after_remove(&mut self, _entry_index: usize, _removed_entries: u32) {}
}

struct NoopDeleteHooks;

impl DeleteHooks for NoopDeleteHooks {}

pub(super) fn prepare_batch(
    workspace_revision: u64,
    idle_deadline: Instant,
    selected: Vec<(DeleteSelection, WorkspaceRootLease)>,
) -> Result<DeleteBatchReceipt, CommandError> {
    if selected.is_empty() || selected.len() > MAX_DELETE_BATCH_ENTRIES {
        return Err(batch_size_invalid());
    }
    reject_wire_duplicates_and_overlaps(&selected)?;

    // Resolve every selected top-level pathname identity before scanning any
    // directory manifest. A case/normalization alias or top-level hardlink
    // must deterministically report conflict rather than consuming the shared
    // descendant budget twice and accidentally surfacing a size error.
    let mut top_identities = BTreeSet::new();
    let mut inspected_identities = Vec::with_capacity(selected.len());
    for (selection, lease) in &selected {
        let identity = inspect_top_identity(lease, selection)?;
        if !top_identities.insert(identity) {
            return Err(workspace_conflict());
        }
        inspected_identities.push(identity);
    }

    let mut budget = DeleteBudget::default();
    let mut prepared = Vec::with_capacity(selected.len());
    for ((selection, lease), inspected_identity) in selected.iter().zip(inspected_identities) {
        let receipt = build_entry_receipt(lease, selection, &mut budget)?;
        if receipt.top_identity() != inspected_identity {
            return Err(workspace_conflict());
        }
        prepared.push(receipt);
    }
    reject_identity_aliases_and_overlaps(&prepared)?;

    // Register nothing until every selected entry has survived one complete,
    // zero-side-effect rebuild after the first batch scan.
    let mut verification_budget = DeleteBudget::default();
    for ((selection, lease), expected) in selected.iter().zip(&prepared) {
        let observed = build_entry_receipt(lease, selection, &mut verification_budget)?;
        if &observed != expected {
            return Err(workspace_conflict());
        }
    }

    let entries = selected
        .into_iter()
        .zip(prepared)
        .map(|((selection, _), receipt)| DeleteBatchEntry {
            entry_id: DeleteEntryId::new(),
            selection,
            receipt,
        })
        .collect();
    Ok(DeleteBatchReceipt {
        confirmation_id: DeleteConfirmationId::new(),
        workspace_revision,
        phase: DeleteBatchPhase::Prepared,
        idle_deadline,
        entries,
        next_entry: 0,
    })
}

impl DeleteBatchReceipt {
    pub(super) const fn confirmation_id(&self) -> DeleteConfirmationId {
        self.confirmation_id
    }

    pub(super) const fn workspace_revision(&self) -> u64 {
        self.workspace_revision
    }

    pub(super) fn is_expired(&self, now: Instant) -> bool {
        now >= self.idle_deadline
    }

    pub(super) fn is_prepared(&self) -> bool {
        self.phase == DeleteBatchPhase::Prepared
    }

    pub(super) fn is_executing(&self) -> bool {
        self.phase == DeleteBatchPhase::Executing
    }

    pub(super) fn begin(&mut self) {
        self.phase = DeleteBatchPhase::Executing;
    }

    pub(super) fn refresh_deadline(&mut self, idle_deadline: Instant) {
        self.idle_deadline = idle_deadline;
    }

    pub(super) fn plan(&self) -> Result<WorkspaceDeleteBatchPlan, CommandError> {
        let entries = self
            .entries
            .iter()
            .map(|entry| {
                let (kind, descendants) = entry.receipt.summary()?;
                Ok(WorkspaceDeleteEntryPlan::new(
                    entry.entry_id,
                    kind,
                    descendants,
                ))
            })
            .collect::<Result<Vec<_>, CommandError>>()?;
        Ok(WorkspaceDeleteBatchPlan::new(self.confirmation_id, entries))
    }

    pub(super) fn selections(&self) -> impl Iterator<Item = &DeleteSelection> {
        self.entries.iter().map(|entry| &entry.selection)
    }

    pub(super) fn next_root_id(&self) -> Option<RootId> {
        self.entries
            .get(self.next_entry)
            .map(|entry| entry.selection.root_id)
    }

    pub(super) fn matches_next(
        &self,
        entry_id: DeleteEntryId,
        root_id: RootId,
        relative_path: &RelativePath,
        recursive: bool,
    ) -> bool {
        self.entries.get(self.next_entry).is_some_and(|entry| {
            entry.entry_id == entry_id
                && entry.selection.root_id == root_id
                && &entry.selection.relative_path == relative_path
                && entry.selection.recursive == recursive
        })
    }

    pub(super) fn is_complete(&self) -> bool {
        self.next_entry == self.entries.len()
    }

    pub(super) fn revalidate_all(
        &self,
        leases: &BTreeMap<RootId, WorkspaceRootLease>,
    ) -> Result<(), CommandError> {
        let mut budget = DeleteBudget::default();
        for entry in &self.entries {
            let lease = leases
                .get(&entry.selection.root_id)
                .ok_or_else(delete_batch_unverifiable)?;
            let observed =
                build_entry_receipt(lease, &entry.selection, &mut budget).map_err(|error| {
                    match classify_command_error(error) {
                        DeleteFailure::Changed => delete_batch_changed(),
                        DeleteFailure::Unverifiable | DeleteFailure::DeleteFailed => {
                            delete_batch_unverifiable()
                        }
                    }
                })?;
            if observed != entry.receipt {
                return Err(delete_batch_changed());
            }
        }
        Ok(())
    }

    pub(super) fn commit_next(&mut self, lease: &WorkspaceRootLease) -> WorkspaceDeleteResult {
        let mut hooks = NoopDeleteHooks;
        self.commit_next_with_hooks(lease, &mut hooks)
    }

    fn commit_next_with_hooks(
        &mut self,
        lease: &WorkspaceRootLease,
        hooks: &mut impl DeleteHooks,
    ) -> WorkspaceDeleteResult {
        let Some(entry) = self.entries.get(self.next_entry) else {
            return WorkspaceDeleteResult::incomplete(
                WorkspaceDeleteIncompleteReason::EntryUnverifiable,
                0,
            );
        };
        let result = delete_verified_entry(lease, &entry.selection, &entry.receipt, hooks);
        if result.is_deleted() {
            // This cannot fail: the current entry existed above and the batch
            // is bounded by 64. Advancing occurs only after the root remove has
            // succeeded, so no fallible post-root disk operation can rewrite
            // the terminal result.
            self.next_entry += 1;
        }
        result
    }
}

impl DeleteEntryReceipt {
    fn summary(&self) -> Result<(WorkspaceDeleteEntryKind, u32), CommandError> {
        match &self.kind {
            DeleteReceiptKind::File(_) => Ok((WorkspaceDeleteEntryKind::File, 0)),
            DeleteReceiptKind::Symlink { .. } => Ok((WorkspaceDeleteEntryKind::Symlink, 0)),
            DeleteReceiptKind::Directory(receipt) => Ok((
                WorkspaceDeleteEntryKind::Directory,
                u32::try_from(receipt.entries.len()).map_err(|_| directory_too_large())?,
            )),
        }
    }

    fn top_identity(&self) -> FileIdentity {
        match &self.kind {
            DeleteReceiptKind::File(snapshot) => snapshot.identity,
            DeleteReceiptKind::Symlink { snapshot, .. } => snapshot.identity,
            DeleteReceiptKind::Directory(receipt) => receipt.root.identity,
        }
    }

    fn identities(&self) -> BTreeSet<FileIdentity> {
        let mut identities = BTreeSet::from([self.top_identity()]);
        if let DeleteReceiptKind::Directory(receipt) = &self.kind {
            for entry in &receipt.entries {
                let identity = match &entry.kind {
                    ManifestEntryKind::File(snapshot)
                    | ManifestEntryKind::Directory(snapshot)
                    | ManifestEntryKind::Symlink { snapshot, .. } => snapshot.identity,
                };
                identities.insert(identity);
            }
        }
        identities
    }
}

fn reject_wire_duplicates_and_overlaps(
    selected: &[(DeleteSelection, WorkspaceRootLease)],
) -> Result<(), CommandError> {
    for (index, (left, _)) in selected.iter().enumerate() {
        for (right, _) in &selected[index + 1..] {
            if left.root_id != right.root_id {
                continue;
            }
            if left.relative_path == right.relative_path
                || left
                    .relative_path
                    .as_path()
                    .starts_with(right.relative_path.as_path())
                || right
                    .relative_path
                    .as_path()
                    .starts_with(left.relative_path.as_path())
            {
                return Err(workspace_conflict());
            }
        }
    }
    Ok(())
}

fn reject_identity_aliases_and_overlaps(
    receipts: &[DeleteEntryReceipt],
) -> Result<(), CommandError> {
    let mut batch_identities = BTreeSet::new();
    for receipt in receipts {
        for identity in receipt.identities() {
            if !batch_identities.insert(identity) {
                return Err(workspace_conflict());
            }
        }
    }
    Ok(())
}

fn build_entry_receipt(
    lease: &WorkspaceRootLease,
    selection: &DeleteSelection,
    budget: &mut DeleteBudget,
) -> Result<DeleteEntryReceipt, CommandError> {
    if selection.relative_path.is_root() {
        return Err(entry_type_mismatch());
    }
    let basename = selection
        .relative_path
        .as_path()
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(path_encoding_unsupported)?;
    if basename.len() > MAX_DELETE_ENTRY_NAME_BYTES {
        return Err(path_encoding_unsupported());
    }

    let parent_path = selection
        .relative_path
        .as_path()
        .parent()
        .ok_or_else(entry_type_mismatch)?;
    let (parent, parent_chain) = open_parent_chain(lease.directory(), parent_path, None)?;
    let name = Path::new(basename);
    let before = parent.symlink_metadata(name).map_err(map_prepare_io)?;
    let snapshot = NodeSnapshot::from_metadata(&before)?;
    let kind = match snapshot.kind {
        NodeKind::File => {
            verify_open_file(&parent, name, snapshot).map_err(map_prepare_failure)?;
            DeleteReceiptKind::File(snapshot)
        }
        NodeKind::Symlink => {
            let payload = read_delete_symlink(&parent, name)?;
            budget.reserve_link(payload.len())?;
            let after = NodeSnapshot::from_metadata(
                &parent.symlink_metadata(name).map_err(map_prepare_io)?,
            )?;
            if after != snapshot {
                return Err(workspace_conflict());
            }
            DeleteReceiptKind::Symlink { snapshot, payload }
        }
        NodeKind::Directory => {
            let directory = parent.open_dir_nofollow(name).map_err(map_prepare_io)?;
            let handle =
                NodeSnapshot::from_metadata(&directory.dir_metadata().map_err(map_prepare_io)?)?;
            if handle != snapshot {
                return Err(workspace_conflict());
            }
            let entries = if selection.recursive {
                scan_directory(&directory, budget)?
            } else {
                let mut probe = directory.entries().map_err(map_prepare_io)?;
                match probe.next() {
                    None => Vec::new(),
                    Some(Ok(_)) => return Err(directory_not_empty()),
                    Some(Err(error)) => return Err(map_prepare_io(error)),
                }
            };
            let after = NodeSnapshot::from_metadata(
                &parent.symlink_metadata(name).map_err(map_prepare_io)?,
            )?;
            let handle_after =
                NodeSnapshot::from_metadata(&directory.dir_metadata().map_err(map_prepare_io)?)?;
            if after != snapshot || handle_after != snapshot {
                return Err(workspace_conflict());
            }
            DeleteReceiptKind::Directory(DirectoryReceipt {
                root: snapshot,
                entries,
            })
        }
    };
    Ok(DeleteEntryReceipt { parent_chain, kind })
}

fn inspect_top_identity(
    lease: &WorkspaceRootLease,
    selection: &DeleteSelection,
) -> Result<FileIdentity, CommandError> {
    if selection.relative_path.is_root() {
        return Err(entry_type_mismatch());
    }
    let basename = selection
        .relative_path
        .as_path()
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(path_encoding_unsupported)?;
    if basename.len() > MAX_DELETE_ENTRY_NAME_BYTES {
        return Err(path_encoding_unsupported());
    }
    let parent_path = selection
        .relative_path
        .as_path()
        .parent()
        .ok_or_else(entry_type_mismatch)?;
    let (parent, _) = open_parent_chain(lease.directory(), parent_path, None)?;
    let before = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(Path::new(basename))
            .map_err(map_prepare_io)?,
    )?;
    let after = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(Path::new(basename))
            .map_err(map_prepare_io)?,
    )?;
    if before == after {
        Ok(before.identity)
    } else {
        Err(workspace_conflict())
    }
}

fn open_parent_chain(
    root: &Dir,
    relative_parent: &Path,
    expected: Option<&[FileIdentity]>,
) -> Result<(Dir, Vec<FileIdentity>), CommandError> {
    let mut current = root.try_clone().map_err(map_prepare_io)?;
    let mut identities = Vec::new();
    let root_metadata = current.dir_metadata().map_err(map_prepare_io)?;
    identities.push(FileIdentity::from_metadata(&root_metadata));
    for component in relative_parent.components() {
        let Component::Normal(name) = component else {
            return Err(entry_type_mismatch());
        };
        let path = Path::new(name);
        let pathname = current.symlink_metadata(path).map_err(map_prepare_io)?;
        let child = current.open_dir_nofollow(path).map_err(map_prepare_io)?;
        let handle = child.dir_metadata().map_err(map_prepare_io)?;
        let pathname_identity = FileIdentity::from_metadata(&pathname);
        let handle_identity = FileIdentity::from_metadata(&handle);
        if !pathname.is_dir() || !handle.is_dir() || pathname_identity != handle_identity {
            return Err(workspace_conflict());
        }
        identities.push(handle_identity);
        current = child;
    }
    if expected.is_some_and(|expected| expected != identities.as_slice()) {
        return Err(workspace_conflict());
    }
    Ok((current, identities))
}

struct ScanFrame {
    directory: Dir,
    parent: DirectoryIndex,
    depth: usize,
    names: std::vec::IntoIter<String>,
}

fn scan_directory(
    directory: &Dir,
    budget: &mut DeleteBudget,
) -> Result<Vec<ManifestEntry>, CommandError> {
    let root = directory.try_clone().map_err(map_prepare_io)?;
    let names = collect_names(&root, budget)?.into_iter();
    let mut frames = vec![ScanFrame {
        directory: root,
        parent: DirectoryIndex::Root,
        depth: 0,
        names,
    }];
    let mut output = Vec::new();
    while let Some(frame) = frames.last_mut() {
        let Some(name) = frame.names.next() else {
            frames.pop();
            continue;
        };
        let depth = frame
            .depth
            .checked_add(1)
            .filter(|depth| *depth <= MAX_DELETE_TREE_DEPTH)
            .ok_or_else(directory_too_large)?;
        let name_path = Path::new(&name);
        let before = frame
            .directory
            .symlink_metadata(name_path)
            .map_err(map_prepare_io)?;
        let snapshot = NodeSnapshot::from_metadata(&before)?;
        let mut child = None;
        let kind = match snapshot.kind {
            NodeKind::File => {
                verify_open_file(&frame.directory, name_path, snapshot)
                    .map_err(map_prepare_failure)?;
                ManifestEntryKind::File(snapshot)
            }
            NodeKind::Symlink => {
                let payload = read_delete_symlink(&frame.directory, name_path)?;
                budget.reserve_link(payload.len())?;
                let after = NodeSnapshot::from_metadata(
                    &frame
                        .directory
                        .symlink_metadata(name_path)
                        .map_err(map_prepare_io)?,
                )?;
                if after != snapshot {
                    return Err(workspace_conflict());
                }
                ManifestEntryKind::Symlink { snapshot, payload }
            }
            NodeKind::Directory => {
                let opened = frame
                    .directory
                    .open_dir_nofollow(name_path)
                    .map_err(map_prepare_io)?;
                let handle =
                    NodeSnapshot::from_metadata(&opened.dir_metadata().map_err(map_prepare_io)?)?;
                if handle != snapshot {
                    return Err(workspace_conflict());
                }
                child = Some(opened);
                ManifestEntryKind::Directory(snapshot)
            }
        };
        let entry_index = output.len();
        output.push(ManifestEntry {
            name,
            parent: frame.parent,
            kind,
        });
        if let Some(directory) = child {
            let names = collect_names(&directory, budget)?.into_iter();
            frames.push(ScanFrame {
                directory,
                parent: DirectoryIndex::Entry(entry_index),
                depth,
                names,
            });
        }
    }
    Ok(output)
}

fn collect_names(directory: &Dir, budget: &mut DeleteBudget) -> Result<Vec<String>, CommandError> {
    let mut names = Vec::new();
    for entry in directory.entries().map_err(map_prepare_io)? {
        let entry = entry.map_err(map_prepare_io)?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| path_encoding_unsupported())?;
        validate_portable_name(&name)?;
        budget.reserve_name(name.len())?;
        names.push(name);
    }
    names.sort_unstable_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    Ok(names)
}

fn validate_portable_name(name: &str) -> Result<(), CommandError> {
    let probe = RelativePath::parse_wire(name).map_err(|_| path_encoding_unsupported())?;
    if probe.is_root() || probe.as_path().components().count() != 1 {
        Err(path_encoding_unsupported())
    } else {
        Ok(())
    }
}

fn verify_open_file(
    parent: &Dir,
    name: &Path,
    expected: NodeSnapshot,
) -> Result<File, DeleteFailure> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = parent
        .open_with(name, &options)
        .map_err(|error| classify_io(&error))?;
    let handle =
        NodeSnapshot::from_metadata(&file.metadata().map_err(|error| classify_io(&error))?)
            .map_err(|_| DeleteFailure::Changed)?;
    let after = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(name)
            .map_err(|error| classify_io(&error))?,
    )
    .map_err(|_| DeleteFailure::Changed)?;
    if handle == expected && after == expected {
        Ok(file)
    } else {
        Err(DeleteFailure::Changed)
    }
}

fn read_delete_symlink(parent: &Dir, name: &Path) -> Result<Vec<u8>, CommandError> {
    read_symlink_payload(parent, name, map_delete_symlink_error)
}

fn map_delete_symlink_error(error: rustix::io::Errno) -> CommandError {
    use rustix::io::Errno;

    match error {
        Errno::NOENT | Errno::NOTDIR | Errno::INVAL => workspace_conflict(),
        Errno::ACCESS | Errno::PERM | Errno::ROFS => permission_denied(),
        _ => io_failed(),
    }
}

fn delete_verified_entry(
    lease: &WorkspaceRootLease,
    selection: &DeleteSelection,
    expected: &DeleteEntryReceipt,
    hooks: &mut impl DeleteHooks,
) -> WorkspaceDeleteResult {
    let mut budget = DeleteBudget::default();
    let observed = match build_entry_receipt(lease, selection, &mut budget) {
        Ok(observed) => observed,
        Err(error) => return incomplete(classify_command_error(error), 0),
    };
    if &observed != expected {
        return incomplete(DeleteFailure::Changed, 0);
    }
    drop(observed);

    match &expected.kind {
        DeleteReceiptKind::File(snapshot) => {
            delete_top_leaf(lease, selection, expected, *snapshot, None)
        }
        DeleteReceiptKind::Symlink { snapshot, payload } => {
            delete_top_leaf(lease, selection, expected, *snapshot, Some(payload))
        }
        DeleteReceiptKind::Directory(receipt) => {
            delete_directory(lease, selection, expected, receipt, hooks)
        }
    }
}

fn delete_top_leaf(
    lease: &WorkspaceRootLease,
    selection: &DeleteSelection,
    expected: &DeleteEntryReceipt,
    snapshot: NodeSnapshot,
    symlink_payload: Option<&[u8]>,
) -> WorkspaceDeleteResult {
    let parent_path = match selection.relative_path.as_path().parent() {
        Some(parent) => parent,
        None => return incomplete(DeleteFailure::Changed, 0),
    };
    let name = match selection.relative_path.as_path().file_name() {
        Some(name) => Path::new(name),
        None => return incomplete(DeleteFailure::Changed, 0),
    };
    let parent =
        match open_parent_chain(lease.directory(), parent_path, Some(&expected.parent_chain)) {
            Ok((parent, _)) => parent,
            Err(error) => return incomplete(classify_command_error(error), 0),
        };
    let verification = if let Some(payload) = symlink_payload {
        verify_symlink(&parent, name, snapshot, payload)
    } else {
        verify_open_file(&parent, name, snapshot).map(drop)
    };
    if let Err(failure) = verification {
        return incomplete(failure, 0);
    }
    match remove_verified_entry(&parent, name, snapshot.kind) {
        Ok(()) => WorkspaceDeleteResult::Deleted,
        Err(_) => incomplete(DeleteFailure::DeleteFailed, 0),
    }
}

struct AliasJournal {
    nlink: u64,
    ctime: i64,
    ctime_nsec: i64,
    remaining_indices: BTreeSet<usize>,
}

struct DirectoryJournal {
    root: DirectoryState,
    entries: Vec<Option<DirectoryState>>,
}

struct DirectoryState {
    snapshot: NodeSnapshot,
    members: BTreeSet<OsString>,
}

fn delete_directory(
    lease: &WorkspaceRootLease,
    selection: &DeleteSelection,
    expected: &DeleteEntryReceipt,
    receipt: &DirectoryReceipt,
    hooks: &mut impl DeleteHooks,
) -> WorkspaceDeleteResult {
    let mut directories = match directory_journal(receipt) {
        Ok(directories) => directories,
        Err(failure) => return incomplete(failure, 0),
    };
    let mut aliases = alias_journal(receipt);
    let mut removed_entries = 0_u32;

    for index in (0..receipt.entries.len()).rev() {
        let result = delete_manifest_entry(
            lease,
            selection,
            expected,
            receipt,
            index,
            &mut directories,
            &mut aliases,
            &mut removed_entries,
            hooks,
        );
        if let Err(failure) = result {
            return incomplete(failure, removed_entries);
        }
    }

    let parent_path = match selection.relative_path.as_path().parent() {
        Some(parent) => parent,
        None => return incomplete(DeleteFailure::Changed, removed_entries),
    };
    let name = match selection.relative_path.as_path().file_name() {
        Some(name) => Path::new(name),
        None => return incomplete(DeleteFailure::Changed, removed_entries),
    };
    let parent =
        match open_parent_chain(lease.directory(), parent_path, Some(&expected.parent_chain)) {
            Ok((parent, _)) => parent,
            Err(error) => return incomplete(classify_command_error(error), removed_entries),
        };
    let root = match open_verified_directory(&parent, name, directories.root.snapshot) {
        Ok(directory) => directory,
        Err(failure) => return incomplete(failure, removed_entries),
    };
    if let Err(failure) = verify_exact_members(&root, &directories.root.members) {
        return incomplete(failure, removed_entries);
    }
    match remove_verified_entry(&parent, name, NodeKind::Directory) {
        Ok(()) => WorkspaceDeleteResult::Deleted,
        Err(_) => incomplete(DeleteFailure::DeleteFailed, removed_entries),
    }
}

#[allow(clippy::too_many_arguments)]
fn delete_manifest_entry(
    lease: &WorkspaceRootLease,
    selection: &DeleteSelection,
    top_receipt: &DeleteEntryReceipt,
    receipt: &DirectoryReceipt,
    index: usize,
    directories: &mut DirectoryJournal,
    aliases: &mut BTreeMap<FileIdentity, AliasJournal>,
    removed_entries: &mut u32,
    hooks: &mut impl DeleteHooks,
) -> Result<(), DeleteFailure> {
    let entry = receipt
        .entries
        .get(index)
        .ok_or(DeleteFailure::Unverifiable)?;
    let top = open_top_directory(lease, selection, top_receipt, directories.root.snapshot)?;
    let parent = open_owned_directory(&top, entry.parent, receipt, directories)?;
    let name = Path::new(&entry.name);

    match &entry.kind {
        ManifestEntryKind::File(snapshot) => {
            verify_journal_file(&parent, name, *snapshot, aliases)?;
            if hooks.fail_before_remove(index, next_removed_count(*removed_entries)?) {
                return Err(DeleteFailure::DeleteFailed);
            }
            remove_verified_entry(&parent, name, NodeKind::File)
                .map_err(|_| DeleteFailure::DeleteFailed)?;
            record_descendant_remove(removed_entries)?;
            hooks.after_remove(index, *removed_entries);
            remove_member(directories, entry.parent, &entry.name)?;
            rebaseline_parent(&top, receipt, entry.parent, directories)?;
            rebaseline_aliases(
                &top,
                receipt,
                index,
                snapshot.identity,
                directories,
                aliases,
            )?;
        }
        ManifestEntryKind::Symlink { snapshot, payload } => {
            verify_journal_symlink(&parent, name, *snapshot, payload, aliases)?;
            if hooks.fail_before_remove(index, next_removed_count(*removed_entries)?) {
                return Err(DeleteFailure::DeleteFailed);
            }
            remove_verified_entry(&parent, name, NodeKind::Symlink)
                .map_err(|_| DeleteFailure::DeleteFailed)?;
            record_descendant_remove(removed_entries)?;
            hooks.after_remove(index, *removed_entries);
            remove_member(directories, entry.parent, &entry.name)?;
            rebaseline_parent(&top, receipt, entry.parent, directories)?;
            rebaseline_aliases(
                &top,
                receipt,
                index,
                snapshot.identity,
                directories,
                aliases,
            )?;
        }
        ManifestEntryKind::Directory(_) => {
            let child_state = directory_state(directories, DirectoryIndex::Entry(index))?;
            let directory = open_verified_directory(&parent, name, child_state.snapshot)?;
            let expected_members = &child_state.members;
            verify_exact_members(&directory, expected_members)?;
            if !expected_members.is_empty() {
                return Err(DeleteFailure::Changed);
            }
            if hooks.fail_before_remove(index, next_removed_count(*removed_entries)?) {
                return Err(DeleteFailure::DeleteFailed);
            }
            remove_verified_entry(&parent, name, NodeKind::Directory)
                .map_err(|_| DeleteFailure::DeleteFailed)?;
            record_descendant_remove(removed_entries)?;
            hooks.after_remove(index, *removed_entries);
            remove_member(directories, entry.parent, &entry.name)?;
            directories.entries[index] = None;
            rebaseline_parent(&top, receipt, entry.parent, directories)?;
        }
    }
    Ok(())
}

fn record_descendant_remove(removed_entries: &mut u32) -> Result<(), DeleteFailure> {
    *removed_entries = next_removed_count(*removed_entries)?;
    Ok(())
}

fn next_removed_count(removed_entries: u32) -> Result<u32, DeleteFailure> {
    removed_entries
        .checked_add(1)
        .filter(|count| *count <= MAX_DELETE_DESCENDANTS as u32)
        .ok_or(DeleteFailure::Unverifiable)
}

fn open_top_directory(
    lease: &WorkspaceRootLease,
    selection: &DeleteSelection,
    top_receipt: &DeleteEntryReceipt,
    expected: NodeSnapshot,
) -> Result<Dir, DeleteFailure> {
    let parent_path = selection
        .relative_path
        .as_path()
        .parent()
        .ok_or(DeleteFailure::Changed)?;
    let name = selection
        .relative_path
        .as_path()
        .file_name()
        .map(Path::new)
        .ok_or(DeleteFailure::Changed)?;
    let (parent, _) = open_parent_chain(
        lease.directory(),
        parent_path,
        Some(&top_receipt.parent_chain),
    )
    .map_err(classify_command_error)?;
    open_verified_directory(&parent, name, expected)
}

fn open_owned_directory(
    root: &Dir,
    directory_index: DirectoryIndex,
    receipt: &DirectoryReceipt,
    journal: &DirectoryJournal,
) -> Result<Dir, DeleteFailure> {
    let root_metadata = root.dir_metadata().map_err(|error| classify_io(&error))?;
    let root_observed =
        NodeSnapshot::from_metadata(&root_metadata).map_err(|_| DeleteFailure::Changed)?;
    if root_observed != journal.root.snapshot {
        return Err(DeleteFailure::Changed);
    }
    let mut current = root.try_clone().map_err(|error| classify_io(&error))?;
    let mut chain = Vec::new();
    let mut next = directory_index;
    while let DirectoryIndex::Entry(index) = next {
        if chain.len() >= MAX_DELETE_TREE_DEPTH {
            return Err(DeleteFailure::Unverifiable);
        }
        let entry = receipt
            .entries
            .get(index)
            .ok_or(DeleteFailure::Unverifiable)?;
        if !matches!(entry.kind, ManifestEntryKind::Directory(_)) {
            return Err(DeleteFailure::Unverifiable);
        }
        chain.push(index);
        next = entry.parent;
    }
    for index in chain.into_iter().rev() {
        let entry = &receipt.entries[index];
        let expected = directory_state(journal, DirectoryIndex::Entry(index))?.snapshot;
        current = open_verified_directory(&current, Path::new(&entry.name), expected)?;
    }
    Ok(current)
}

fn open_verified_directory(
    parent: &Dir,
    name: &Path,
    expected: NodeSnapshot,
) -> Result<Dir, DeleteFailure> {
    let pathname = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    let pathname = NodeSnapshot::from_metadata(&pathname).map_err(|_| DeleteFailure::Changed)?;
    let directory = parent
        .open_dir_nofollow(name)
        .map_err(|error| classify_io(&error))?;
    let handle = NodeSnapshot::from_metadata(
        &directory
            .dir_metadata()
            .map_err(|error| classify_io(&error))?,
    )
    .map_err(|_| DeleteFailure::Changed)?;
    if pathname == expected && handle == expected {
        Ok(directory)
    } else {
        Err(DeleteFailure::Changed)
    }
}

fn verify_symlink(
    parent: &Dir,
    name: &Path,
    expected: NodeSnapshot,
    expected_payload: &[u8],
) -> Result<(), DeleteFailure> {
    let before = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(name)
            .map_err(|error| classify_io(&error))?,
    )
    .map_err(|_| DeleteFailure::Changed)?;
    if before != expected {
        return Err(DeleteFailure::Changed);
    }
    let payload = read_delete_symlink(parent, name).map_err(classify_command_error)?;
    let after = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(name)
            .map_err(|error| classify_io(&error))?,
    )
    .map_err(|_| DeleteFailure::Changed)?;
    if after == expected && payload == expected_payload {
        Ok(())
    } else {
        Err(DeleteFailure::Changed)
    }
}

fn verify_journal_file(
    parent: &Dir,
    name: &Path,
    expected: NodeSnapshot,
    aliases: &BTreeMap<FileIdentity, AliasJournal>,
) -> Result<(), DeleteFailure> {
    let expected = apply_alias_journal(expected, aliases)?;
    verify_open_file(parent, name, expected).map(drop)
}

fn verify_journal_symlink(
    parent: &Dir,
    name: &Path,
    expected: NodeSnapshot,
    payload: &[u8],
    aliases: &BTreeMap<FileIdentity, AliasJournal>,
) -> Result<(), DeleteFailure> {
    verify_symlink(
        parent,
        name,
        apply_alias_journal(expected, aliases)?,
        payload,
    )
}

fn apply_alias_journal(
    mut expected: NodeSnapshot,
    aliases: &BTreeMap<FileIdentity, AliasJournal>,
) -> Result<NodeSnapshot, DeleteFailure> {
    let alias = aliases
        .get(&expected.identity)
        .ok_or(DeleteFailure::Unverifiable)?;
    expected.nlink = alias.nlink;
    expected.ctime = alias.ctime;
    expected.ctime_nsec = alias.ctime_nsec;
    Ok(expected)
}

fn rebaseline_aliases(
    root: &Dir,
    receipt: &DirectoryReceipt,
    removed_index: usize,
    identity: FileIdentity,
    directories: &DirectoryJournal,
    aliases: &mut BTreeMap<FileIdentity, AliasJournal>,
) -> Result<(), DeleteFailure> {
    let (expected_nlink, previous_ctime, previous_ctime_nsec, remaining_index) = {
        let current = aliases
            .get_mut(&identity)
            .ok_or(DeleteFailure::Unverifiable)?;
        let remaining_index = remove_alias_index(current, removed_index)?;
        (
            current.nlink,
            current.ctime,
            current.ctime_nsec,
            remaining_index,
        )
    };
    let Some(remaining_index) = remaining_index else {
        return Ok(());
    };
    let remaining = receipt
        .entries
        .get(remaining_index)
        .ok_or(DeleteFailure::Unverifiable)?;
    let parent = open_owned_directory(root, remaining.parent, receipt, directories)?;
    let name = Path::new(&remaining.name);
    let observed = match &remaining.kind {
        ManifestEntryKind::File(snapshot) => {
            let mut relaxed = *snapshot;
            relaxed.nlink = expected_nlink;
            relaxed.ctime = previous_ctime;
            relaxed.ctime_nsec = previous_ctime_nsec;
            let file = verify_open_file_relaxed_ctime(&parent, name, relaxed)?;
            NodeSnapshot::from_metadata(&file.metadata().map_err(|error| classify_io(&error))?)
                .map_err(|_| DeleteFailure::Changed)?
        }
        ManifestEntryKind::Symlink { snapshot, payload } => {
            verify_symlink_relaxed_ctime(&parent, name, *snapshot, expected_nlink, payload)?
        }
        ManifestEntryKind::Directory(_) => return Err(DeleteFailure::Unverifiable),
    };
    let current = aliases
        .get_mut(&identity)
        .ok_or(DeleteFailure::Unverifiable)?;
    current.ctime = observed.ctime;
    current.ctime_nsec = observed.ctime_nsec;
    Ok(())
}

fn remove_alias_index(
    journal: &mut AliasJournal,
    removed_index: usize,
) -> Result<Option<usize>, DeleteFailure> {
    journal.nlink = journal
        .nlink
        .checked_sub(1)
        .ok_or(DeleteFailure::Unverifiable)?;
    if !journal.remaining_indices.remove(&removed_index) {
        return Err(DeleteFailure::Unverifiable);
    }
    Ok(journal.remaining_indices.iter().next_back().copied())
}

fn verify_open_file_relaxed_ctime(
    parent: &Dir,
    name: &Path,
    expected: NodeSnapshot,
) -> Result<File, DeleteFailure> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = parent
        .open_with(name, &options)
        .map_err(|error| classify_io(&error))?;
    let handle =
        NodeSnapshot::from_metadata(&file.metadata().map_err(|error| classify_io(&error))?)
            .map_err(|_| DeleteFailure::Changed)?;
    let pathname = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(name)
            .map_err(|error| classify_io(&error))?,
    )
    .map_err(|_| DeleteFailure::Changed)?;
    if metadata_matches_except_ctime(handle, expected)
        && metadata_matches_except_ctime(pathname, expected)
        && handle.ctime == pathname.ctime
        && handle.ctime_nsec == pathname.ctime_nsec
    {
        Ok(file)
    } else {
        Err(DeleteFailure::Changed)
    }
}

fn verify_symlink_relaxed_ctime(
    parent: &Dir,
    name: &Path,
    expected: NodeSnapshot,
    expected_nlink: u64,
    payload: &[u8],
) -> Result<NodeSnapshot, DeleteFailure> {
    let before = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(name)
            .map_err(|error| classify_io(&error))?,
    )
    .map_err(|_| DeleteFailure::Changed)?;
    let mut relaxed = expected;
    relaxed.nlink = expected_nlink;
    if !metadata_matches_except_ctime(before, relaxed) {
        return Err(DeleteFailure::Changed);
    }
    let observed_payload = read_delete_symlink(parent, name).map_err(classify_command_error)?;
    let after = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(name)
            .map_err(|error| classify_io(&error))?,
    )
    .map_err(|_| DeleteFailure::Changed)?;
    if metadata_matches_except_ctime(after, relaxed)
        && before.ctime == after.ctime
        && before.ctime_nsec == after.ctime_nsec
        && observed_payload == payload
    {
        Ok(after)
    } else {
        Err(DeleteFailure::Changed)
    }
}

fn metadata_matches_except_ctime(observed: NodeSnapshot, expected: NodeSnapshot) -> bool {
    observed.identity == expected.identity
        && observed.kind == expected.kind
        && observed.len == expected.len
        && observed.mode == expected.mode
        && observed.mtime == expected.mtime
        && observed.mtime_nsec == expected.mtime_nsec
        && observed.nlink == expected.nlink
}

fn rebaseline_parent(
    root: &Dir,
    receipt: &DirectoryReceipt,
    directory_index: DirectoryIndex,
    directories: &mut DirectoryJournal,
) -> Result<(), DeleteFailure> {
    let expected = directory_state(directories, directory_index)?.snapshot;
    let parent =
        reopen_directory_for_rebaseline(root, directory_index, expected, receipt, directories)?;
    let metadata = parent.dir_metadata().map_err(|error| classify_io(&error))?;
    let observed = NodeSnapshot::from_metadata(&metadata).map_err(|_| DeleteFailure::Changed)?;
    if !expected.directory_identity_matches(&metadata) || observed.mode != expected.mode {
        return Err(DeleteFailure::Changed);
    }
    directory_state_mut(directories, directory_index)?.snapshot = observed;
    Ok(())
}

fn reopen_directory_for_rebaseline(
    root: &Dir,
    directory_index: DirectoryIndex,
    expected: NodeSnapshot,
    receipt: &DirectoryReceipt,
    directories: &DirectoryJournal,
) -> Result<Dir, DeleteFailure> {
    if directory_index == DirectoryIndex::Root {
        let directory = root.try_clone().map_err(|error| classify_io(&error))?;
        let metadata = directory
            .dir_metadata()
            .map_err(|error| classify_io(&error))?;
        if expected.directory_identity_matches(&metadata) {
            return Ok(directory);
        }
        return Err(DeleteFailure::Changed);
    }

    let DirectoryIndex::Entry(index) = directory_index else {
        return Err(DeleteFailure::Unverifiable);
    };
    let entry = receipt
        .entries
        .get(index)
        .ok_or(DeleteFailure::Unverifiable)?;
    if !matches!(entry.kind, ManifestEntryKind::Directory(_)) {
        return Err(DeleteFailure::Unverifiable);
    }
    let parent = open_owned_directory(root, entry.parent, receipt, directories)?;
    let name = Path::new(&entry.name);
    let pathname = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    let directory = parent
        .open_dir_nofollow(name)
        .map_err(|error| classify_io(&error))?;
    let handle = directory
        .dir_metadata()
        .map_err(|error| classify_io(&error))?;
    if expected.directory_identity_matches(&pathname)
        && expected.directory_identity_matches(&handle)
        && NodeSnapshot::from_metadata(&pathname)
            .is_ok_and(|snapshot| snapshot.mode == expected.mode)
        && NodeSnapshot::from_metadata(&handle).is_ok_and(|snapshot| snapshot.mode == expected.mode)
    {
        Ok(directory)
    } else {
        Err(DeleteFailure::Changed)
    }
}

fn directory_journal(receipt: &DirectoryReceipt) -> Result<DirectoryJournal, DeleteFailure> {
    let mut journal = DirectoryJournal {
        root: DirectoryState {
            snapshot: receipt.root,
            members: BTreeSet::new(),
        },
        entries: std::iter::repeat_with(|| None)
            .take(receipt.entries.len())
            .collect(),
    };
    for (index, entry) in receipt.entries.iter().enumerate() {
        if let ManifestEntryKind::Directory(snapshot) = entry.kind {
            journal.entries[index] = Some(DirectoryState {
                snapshot,
                members: BTreeSet::new(),
            });
        }
    }
    for (index, entry) in receipt.entries.iter().enumerate() {
        if matches!(entry.parent, DirectoryIndex::Entry(parent) if parent >= index) {
            return Err(DeleteFailure::Unverifiable);
        }
        let parent = directory_state_mut(&mut journal, entry.parent)?;
        if !parent.members.insert(OsString::from(&entry.name)) {
            return Err(DeleteFailure::Unverifiable);
        }
    }
    Ok(journal)
}

fn directory_state(
    journal: &DirectoryJournal,
    index: DirectoryIndex,
) -> Result<&DirectoryState, DeleteFailure> {
    match index {
        DirectoryIndex::Root => Ok(&journal.root),
        DirectoryIndex::Entry(index) => journal
            .entries
            .get(index)
            .and_then(Option::as_ref)
            .ok_or(DeleteFailure::Unverifiable),
    }
}

fn directory_state_mut(
    journal: &mut DirectoryJournal,
    index: DirectoryIndex,
) -> Result<&mut DirectoryState, DeleteFailure> {
    match index {
        DirectoryIndex::Root => Ok(&mut journal.root),
        DirectoryIndex::Entry(index) => journal
            .entries
            .get_mut(index)
            .and_then(Option::as_mut)
            .ok_or(DeleteFailure::Unverifiable),
    }
}

fn alias_journal(receipt: &DirectoryReceipt) -> BTreeMap<FileIdentity, AliasJournal> {
    let mut output = BTreeMap::new();
    for (index, entry) in receipt.entries.iter().enumerate() {
        let snapshot = match entry.kind {
            ManifestEntryKind::File(snapshot) | ManifestEntryKind::Symlink { snapshot, .. } => {
                snapshot
            }
            ManifestEntryKind::Directory(_) => continue,
        };
        output
            .entry(snapshot.identity)
            .and_modify(|alias: &mut AliasJournal| {
                alias.remaining_indices.insert(index);
            })
            .or_insert_with(|| AliasJournal {
                nlink: snapshot.nlink,
                ctime: snapshot.ctime,
                ctime_nsec: snapshot.ctime_nsec,
                remaining_indices: BTreeSet::from([index]),
            });
    }
    output
}

fn remove_member(
    journal: &mut DirectoryJournal,
    parent: DirectoryIndex,
    name: &str,
) -> Result<(), DeleteFailure> {
    if directory_state_mut(journal, parent)?
        .members
        .remove(&OsString::from(name))
    {
        Ok(())
    } else {
        Err(DeleteFailure::Unverifiable)
    }
}

fn verify_exact_members(
    directory: &Dir,
    expected: &BTreeSet<OsString>,
) -> Result<(), DeleteFailure> {
    let entries = directory
        .entries()
        .map_err(|error| classify_io(&error))?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name())
                .map_err(|error| classify_io(&error))
        });
    verify_member_stream(expected, entries)
}

fn verify_member_stream(
    expected: &BTreeSet<OsString>,
    observed: impl Iterator<Item = Result<OsString, DeleteFailure>>,
) -> Result<(), DeleteFailure> {
    let mut observed_count = 0_usize;
    for name in observed {
        let name = name?;
        if !expected.contains(&name) {
            return Err(DeleteFailure::Changed);
        }
        observed_count = observed_count
            .checked_add(1)
            .ok_or(DeleteFailure::Unverifiable)?;
        if observed_count > expected.len() {
            return Err(DeleteFailure::Changed);
        }
    }
    if observed_count == expected.len() {
        Ok(())
    } else {
        Err(DeleteFailure::Changed)
    }
}

fn remove_verified_entry(parent: &Dir, basename: &Path, kind: NodeKind) -> io::Result<()> {
    match kind {
        NodeKind::File | NodeKind::Symlink => parent.remove_file(basename),
        NodeKind::Directory => parent.remove_dir(basename),
    }
}

fn incomplete(failure: DeleteFailure, removed_entries: u32) -> WorkspaceDeleteResult {
    let reason = match failure {
        DeleteFailure::Changed => WorkspaceDeleteIncompleteReason::EntryChanged,
        DeleteFailure::Unverifiable => WorkspaceDeleteIncompleteReason::EntryUnverifiable,
        DeleteFailure::DeleteFailed => WorkspaceDeleteIncompleteReason::DeleteFailed,
    };
    WorkspaceDeleteResult::incomplete(reason, removed_entries)
}

fn classify_command_error(error: CommandError) -> DeleteFailure {
    match error.code() {
        "ENTRY_NOT_FOUND"
        | "ENTRY_TYPE_MISMATCH"
        | "DIRECTORY_NOT_EMPTY"
        | "DIRECTORY_TOO_LARGE"
        | "FILE_TOO_LARGE"
        | "PATH_ENCODING_UNSUPPORTED"
        | "WORKSPACE_CONFLICT" => DeleteFailure::Changed,
        _ => DeleteFailure::Unverifiable,
    }
}

fn classify_io(error: &io::Error) -> DeleteFailure {
    if matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory | io::ErrorKind::IsADirectory
    ) || matches!(error.raw_os_error(), Some(libc::ELOOP))
    {
        DeleteFailure::Changed
    } else {
        DeleteFailure::Unverifiable
    }
}

fn map_prepare_failure(failure: DeleteFailure) -> CommandError {
    match failure {
        DeleteFailure::Changed => workspace_conflict(),
        DeleteFailure::Unverifiable | DeleteFailure::DeleteFailed => io_failed(),
    }
}

fn map_prepare_io(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => entry_not_found(),
        io::ErrorKind::NotADirectory | io::ErrorKind::IsADirectory => entry_type_mismatch(),
        io::ErrorKind::PermissionDenied => permission_denied(),
        _ if matches!(error.raw_os_error(), Some(libc::ELOOP)) => entry_type_mismatch(),
        _ => io_failed(),
    }
}

fn batch_size_invalid() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "A delete batch must contain between one and 64 entries.",
    )
}

fn workspace_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace entry changed while the delete plan was prepared.",
    )
}

fn entry_not_found() -> CommandError {
    CommandError::new("ENTRY_NOT_FOUND", "The workspace entry does not exist.")
}

fn entry_type_mismatch() -> CommandError {
    CommandError::new(
        "ENTRY_TYPE_MISMATCH",
        "The workspace entry type is not supported for deletion.",
    )
}

fn directory_not_empty() -> CommandError {
    CommandError::new(
        "DIRECTORY_NOT_EMPTY",
        "The workspace directory is not empty.",
    )
}

fn permission_denied() -> CommandError {
    CommandError::new(
        "PERMISSION_DENIED",
        "The workspace entry cannot be accessed.",
    )
}

fn io_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be inspected.")
}

fn directory_too_large() -> CommandError {
    CommandError::new(
        "DIRECTORY_TOO_LARGE",
        "The workspace directory exceeds the delete planning limit.",
    )
}

fn file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace symlink exceeds the delete planning limit.",
    )
}

fn path_encoding_unsupported() -> CommandError {
    CommandError::new(
        "PATH_ENCODING_UNSUPPORTED",
        "The workspace entry name cannot be represented safely.",
    )
}

fn delete_batch_changed() -> CommandError {
    CommandError::new(
        "WORKSPACE_DELETE_BATCH_CHANGED",
        "The delete selection changed before deletion began.",
    )
}

fn delete_batch_unverifiable() -> CommandError {
    CommandError::new(
        "WORKSPACE_DELETE_BATCH_UNVERIFIABLE",
        "The delete selection could not be verified before deletion began.",
    )
}

#[cfg(test)]
mod tests;
