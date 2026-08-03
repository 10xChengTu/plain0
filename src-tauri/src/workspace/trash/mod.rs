//! Bounded Rust-only receipts for moving authorized workspace entries to the
//! operating-system Trash.
//!
//! This is deliberately separate from `workspace::delete`: the platform API
//! is pathname-based, can report an uncertain outcome, and must never fall
//! back to capability-relative permanent removal. Absolute paths remain
//! private to the platform adapter and never cross IPC.

pub(super) mod macos;

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, Metadata, OpenOptions};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{
    TrashConfirmationId, TrashEntryId, WorkspaceTrashBatchPlan, WorkspaceTrashEntryKind,
    WorkspaceTrashEntryPlan, WorkspaceTrashIncompleteReason, WorkspaceTrashResult,
};
use super::writer::{read_symlink_payload, FileIdentity};
use super::{RootId, WorkspaceRootLease};

pub(super) const MAX_TRASH_BATCH_ENTRIES: usize = 64;
const MAX_TRASH_ENTRY_NAME_BYTES: usize = 1_024;
const MAX_TRASH_SYMLINK_BYTES: usize = 4 * 1_024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct TrashSelection {
    root_id: RootId,
    relative_path: RelativePath,
}

impl TrashSelection {
    pub(super) fn new(root_id: RootId, relative_path: RelativePath) -> Self {
        Self {
            root_id,
            relative_path,
        }
    }

    pub(super) const fn root_id(&self) -> RootId {
        self.root_id
    }
}

/// Complete Rust-only authority for one user confirmation. The receipt never
/// serializes, and it retains neither an ambient target path nor an open
/// target handle across the confirmation gap.
pub(super) struct TrashBatchReceipt {
    confirmation_id: TrashConfirmationId,
    workspace_revision: u64,
    phase: TrashBatchPhase,
    idle_deadline: Instant,
    entries: Vec<TrashBatchEntry>,
    next_entry: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrashBatchPhase {
    Prepared,
    Executing,
}

struct TrashBatchEntry {
    entry_id: TrashEntryId,
    selection: TrashSelection,
    receipt: TrashEntryReceipt,
}

#[derive(Debug, Eq, PartialEq)]
struct TrashEntryReceipt {
    parent_chain: Vec<FileIdentity>,
    snapshot: NodeSnapshot,
    kind: WorkspaceTrashEntryKind,
    symlink_payload: Option<Vec<u8>>,
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
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrashFailure {
    Changed,
    Unverifiable,
    TrashFailed,
}

pub(super) struct PlatformTrashRequest {
    root_path: PathBuf,
    target_path: PathBuf,
    root_identity: FileIdentity,
    target_identity: FileIdentity,
    target_kind: WorkspaceTrashEntryKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PlatformTrashOutcome {
    Trashed,
    FailedBeforeAttempt,
    FailedAfterAttempt,
}

pub(super) trait PlatformTrash {
    fn move_to_trash(&mut self, request: &PlatformTrashRequest) -> PlatformTrashOutcome;
}

pub(super) fn prepare_batch(
    workspace_revision: u64,
    idle_deadline: Instant,
    selected: Vec<(TrashSelection, WorkspaceRootLease)>,
) -> Result<TrashBatchReceipt, CommandError> {
    if selected.is_empty() || selected.len() > MAX_TRASH_BATCH_ENTRIES {
        return Err(batch_size_invalid());
    }
    reject_wire_duplicates_and_overlaps(&selected)?;

    let mut identities = BTreeSet::new();
    let mut prepared = Vec::with_capacity(selected.len());
    for (selection, lease) in &selected {
        let receipt = build_entry_receipt(lease, selection)?;
        if !identities.insert(receipt.snapshot.identity) {
            return Err(workspace_conflict());
        }
        prepared.push(receipt);
    }

    // Publish no confirmation until the complete top-level selection has
    // survived a second zero-side-effect observation.
    for ((selection, lease), expected) in selected.iter().zip(&prepared) {
        if build_entry_receipt(lease, selection)? != *expected {
            return Err(workspace_conflict());
        }
    }

    let entries = selected
        .into_iter()
        .zip(prepared)
        .map(|((selection, _), receipt)| TrashBatchEntry {
            entry_id: TrashEntryId::new(),
            selection,
            receipt,
        })
        .collect();
    Ok(TrashBatchReceipt {
        confirmation_id: TrashConfirmationId::new(),
        workspace_revision,
        phase: TrashBatchPhase::Prepared,
        idle_deadline,
        entries,
        next_entry: 0,
    })
}

impl TrashBatchReceipt {
    pub(super) const fn confirmation_id(&self) -> TrashConfirmationId {
        self.confirmation_id
    }

    pub(super) const fn workspace_revision(&self) -> u64 {
        self.workspace_revision
    }

    pub(super) fn is_expired(&self, now: Instant) -> bool {
        now >= self.idle_deadline
    }

    pub(super) fn is_prepared(&self) -> bool {
        self.phase == TrashBatchPhase::Prepared
    }

    pub(super) fn is_executing(&self) -> bool {
        self.phase == TrashBatchPhase::Executing
    }

    pub(super) fn begin(&mut self) {
        self.phase = TrashBatchPhase::Executing;
    }

    pub(super) fn refresh_deadline(&mut self, idle_deadline: Instant) {
        self.idle_deadline = idle_deadline;
    }

    pub(super) fn plan(&self) -> WorkspaceTrashBatchPlan {
        WorkspaceTrashBatchPlan::new(
            self.confirmation_id,
            self.entries
                .iter()
                .map(|entry| WorkspaceTrashEntryPlan::new(entry.entry_id, entry.receipt.kind))
                .collect(),
        )
    }

    pub(super) fn selections(&self) -> impl Iterator<Item = &TrashSelection> {
        self.entries.iter().map(|entry| &entry.selection)
    }

    pub(super) fn next_root_id(&self) -> Option<RootId> {
        self.entries
            .get(self.next_entry)
            .map(|entry| entry.selection.root_id)
    }

    pub(super) fn matches_next(
        &self,
        entry_id: TrashEntryId,
        root_id: RootId,
        relative_path: &RelativePath,
    ) -> bool {
        self.entries.get(self.next_entry).is_some_and(|entry| {
            entry.entry_id == entry_id
                && entry.selection.root_id == root_id
                && &entry.selection.relative_path == relative_path
        })
    }

    pub(super) fn is_complete(&self) -> bool {
        self.next_entry == self.entries.len()
    }

    pub(super) fn revalidate_all(
        &self,
        leases: &BTreeMap<RootId, WorkspaceRootLease>,
    ) -> Result<(), CommandError> {
        for entry in &self.entries {
            let lease = leases
                .get(&entry.selection.root_id)
                .ok_or_else(trash_batch_unverifiable)?;
            let observed = build_entry_receipt(lease, &entry.selection).map_err(|error| {
                match classify_command_error(error) {
                    TrashFailure::Changed => trash_batch_changed(),
                    TrashFailure::Unverifiable | TrashFailure::TrashFailed => {
                        trash_batch_unverifiable()
                    }
                }
            })?;
            if observed != entry.receipt {
                return Err(trash_batch_changed());
            }
        }
        Ok(())
    }

    pub(super) fn commit_next_with_platform(
        &mut self,
        lease: &WorkspaceRootLease,
        platform: &mut impl PlatformTrash,
    ) -> WorkspaceTrashResult {
        let Some(entry) = self.entries.get(self.next_entry) else {
            return retained(TrashFailure::Unverifiable);
        };
        let observed = match build_entry_receipt(lease, &entry.selection) {
            Ok(observed) => observed,
            Err(error) => return retained(classify_command_error(error)),
        };
        if observed != entry.receipt {
            return retained(TrashFailure::Changed);
        }

        let root_identity = match lease.directory().dir_metadata() {
            Ok(metadata) => FileIdentity::from_metadata(&metadata),
            Err(_) => return retained(TrashFailure::Unverifiable),
        };
        let root_path = lease.platform_root_path().to_path_buf();
        let target_path = root_path.join(entry.selection.relative_path.as_path());
        let request = PlatformTrashRequest {
            root_path,
            target_path,
            root_identity,
            target_identity: entry.receipt.snapshot.identity,
            target_kind: entry.receipt.kind,
        };
        match platform.move_to_trash(&request) {
            PlatformTrashOutcome::Trashed => {
                self.next_entry += 1;
                WorkspaceTrashResult::Trashed
            }
            PlatformTrashOutcome::FailedBeforeAttempt => retained(TrashFailure::TrashFailed),
            PlatformTrashOutcome::FailedAfterAttempt => {
                match build_entry_receipt(lease, &entry.selection) {
                    Ok(after) if after == entry.receipt => retained(TrashFailure::TrashFailed),
                    Ok(_) | Err(_) => WorkspaceTrashResult::OutcomeUnknown,
                }
            }
        }
    }
}

fn reject_wire_duplicates_and_overlaps(
    selected: &[(TrashSelection, WorkspaceRootLease)],
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

fn build_entry_receipt(
    lease: &WorkspaceRootLease,
    selection: &TrashSelection,
) -> Result<TrashEntryReceipt, CommandError> {
    if selection.relative_path.is_root() {
        return Err(entry_type_mismatch());
    }
    let basename = selection
        .relative_path
        .as_path()
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(path_encoding_unsupported)?;
    if basename.len() > MAX_TRASH_ENTRY_NAME_BYTES {
        return Err(path_encoding_unsupported());
    }
    let parent_path = selection
        .relative_path
        .as_path()
        .parent()
        .ok_or_else(entry_type_mismatch)?;
    let (parent, parent_chain) = open_parent_chain(lease.directory(), parent_path)?;
    let name = Path::new(basename);
    let before = parent.symlink_metadata(name).map_err(map_prepare_io)?;
    let snapshot = NodeSnapshot::from_metadata(&before)?;
    let symlink_payload = match snapshot.kind {
        NodeKind::File => {
            verify_open_file(&parent, name, snapshot).map_err(map_prepare_failure)?;
            None
        }
        NodeKind::Directory => {
            let directory = parent.open_dir_nofollow(name).map_err(map_prepare_io)?;
            let handle =
                NodeSnapshot::from_metadata(&directory.dir_metadata().map_err(map_prepare_io)?)?;
            if handle != snapshot {
                return Err(workspace_conflict());
            }
            None
        }
        NodeKind::Symlink => {
            let payload = read_trash_symlink(&parent, name)?;
            if payload.len() > MAX_TRASH_SYMLINK_BYTES {
                return Err(file_too_large());
            }
            Some(payload)
        }
    };
    let after =
        NodeSnapshot::from_metadata(&parent.symlink_metadata(name).map_err(map_prepare_io)?)?;
    if after != snapshot {
        return Err(workspace_conflict());
    }
    Ok(TrashEntryReceipt {
        parent_chain,
        snapshot,
        kind: match snapshot.kind {
            NodeKind::File => WorkspaceTrashEntryKind::File,
            NodeKind::Directory => WorkspaceTrashEntryKind::Directory,
            NodeKind::Symlink => WorkspaceTrashEntryKind::Symlink,
        },
        symlink_payload,
    })
}

fn open_parent_chain(
    root: &Dir,
    relative_parent: &Path,
) -> Result<(Dir, Vec<FileIdentity>), CommandError> {
    let mut current = root.try_clone().map_err(map_prepare_io)?;
    let mut identities = Vec::new();
    identities.push(FileIdentity::from_metadata(
        &current.dir_metadata().map_err(map_prepare_io)?,
    ));
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
    Ok((current, identities))
}

fn verify_open_file(parent: &Dir, name: &Path, expected: NodeSnapshot) -> Result<(), TrashFailure> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = parent
        .open_with(name, &options)
        .map_err(|error| classify_io(&error))?;
    let handle =
        NodeSnapshot::from_metadata(&file.metadata().map_err(|error| classify_io(&error))?)
            .map_err(|_| TrashFailure::Changed)?;
    let pathname = NodeSnapshot::from_metadata(
        &parent
            .symlink_metadata(name)
            .map_err(|error| classify_io(&error))?,
    )
    .map_err(|_| TrashFailure::Changed)?;
    if handle == expected && pathname == expected {
        Ok(())
    } else {
        Err(TrashFailure::Changed)
    }
}

fn read_trash_symlink(parent: &Dir, name: &Path) -> Result<Vec<u8>, CommandError> {
    read_symlink_payload(parent, name, map_trash_symlink_error)
}

fn map_trash_symlink_error(error: rustix::io::Errno) -> CommandError {
    use rustix::io::Errno;

    match error {
        Errno::NOENT | Errno::NOTDIR | Errno::INVAL => workspace_conflict(),
        Errno::ACCESS | Errno::PERM | Errno::ROFS => permission_denied(),
        _ => io_failed(),
    }
}

fn retained(failure: TrashFailure) -> WorkspaceTrashResult {
    let reason = match failure {
        TrashFailure::Changed => WorkspaceTrashIncompleteReason::EntryChanged,
        TrashFailure::Unverifiable => WorkspaceTrashIncompleteReason::EntryUnverifiable,
        TrashFailure::TrashFailed => WorkspaceTrashIncompleteReason::TrashFailed,
    };
    WorkspaceTrashResult::EntryRetained { reason }
}

fn classify_command_error(error: CommandError) -> TrashFailure {
    match error.code() {
        "ENTRY_NOT_FOUND"
        | "ENTRY_TYPE_MISMATCH"
        | "FILE_TOO_LARGE"
        | "PATH_ENCODING_UNSUPPORTED"
        | "WORKSPACE_CONFLICT" => TrashFailure::Changed,
        _ => TrashFailure::Unverifiable,
    }
}

fn classify_io(error: &io::Error) -> TrashFailure {
    if matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory | io::ErrorKind::IsADirectory
    ) || matches!(error.raw_os_error(), Some(libc::ELOOP))
    {
        TrashFailure::Changed
    } else {
        TrashFailure::Unverifiable
    }
}

fn map_prepare_failure(failure: TrashFailure) -> CommandError {
    match failure {
        TrashFailure::Changed => workspace_conflict(),
        TrashFailure::Unverifiable | TrashFailure::TrashFailed => io_failed(),
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
        "A Trash batch must contain between one and 64 entries.",
    )
}

fn workspace_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace entry changed while the Trash plan was prepared.",
    )
}

fn entry_not_found() -> CommandError {
    CommandError::new("ENTRY_NOT_FOUND", "The workspace entry does not exist.")
}

fn entry_type_mismatch() -> CommandError {
    CommandError::new(
        "ENTRY_TYPE_MISMATCH",
        "The workspace entry type is not supported by system Trash.",
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

fn file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace symlink exceeds the Trash planning limit.",
    )
}

fn path_encoding_unsupported() -> CommandError {
    CommandError::new(
        "PATH_ENCODING_UNSUPPORTED",
        "The workspace entry name cannot be represented safely.",
    )
}

fn trash_batch_changed() -> CommandError {
    CommandError::new(
        "WORKSPACE_TRASH_BATCH_CHANGED",
        "The Trash selection changed before the operation began.",
    )
}

fn trash_batch_unverifiable() -> CommandError {
    CommandError::new(
        "WORKSPACE_TRASH_BATCH_UNVERIFIABLE",
        "The Trash selection could not be verified before the operation began.",
    )
}

#[cfg(test)]
mod tests;
