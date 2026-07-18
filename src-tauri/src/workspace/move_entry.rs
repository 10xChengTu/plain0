//! Cross-root move as published copy plus capability-relative verified delete.
//!
//! Publication is the commit point. Everything after it returns a structured
//! result describing the observed disk state; the published target is never
//! rolled back.

use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use cap_fs_ext::DirExt;
use cap_std::fs::{Dir, File, Metadata, OpenOptions};
use sha2::{Digest, Sha256};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::directory_copy::{self, PublishedDirectoryReceipt};
use super::dto::{WorkspaceMoveIncompleteReason, WorkspaceMoveResult};
use super::writer::{
    self, FileIdentity, PublishedFileSnapshot, PublishedSymlinkSnapshot, SourceSnapshot,
    SymlinkSnapshot, MAX_COPY_FILE_BYTES,
};
use super::WorkspaceRootLease;

pub(super) enum PublishedCopyReceipt {
    File(PublishedFileReceipt),
    Symlink(PublishedSymlinkReceipt),
    Directory(Box<PublishedDirectoryReceipt>),
}

pub(super) struct PublishedFileReceipt {
    pub(super) source_parent_path: PathBuf,
    pub(super) source_name: PathBuf,
    pub(super) source_parent: Dir,
    pub(super) source_parent_identity: FileIdentity,
    pub(super) source_file: File,
    pub(super) source_snapshot: SourceSnapshot,
    pub(super) target_parent_path: PathBuf,
    pub(super) target_name: PathBuf,
    pub(super) target_parent: Dir,
    pub(super) target_parent_identity: FileIdentity,
    pub(super) target_file: File,
    pub(super) target_snapshot: PublishedFileSnapshot,
    pub(super) digest: [u8; 32],
}

pub(super) struct PublishedSymlinkReceipt {
    pub(super) source_parent_path: PathBuf,
    pub(super) source_name: PathBuf,
    pub(super) source_parent: Dir,
    pub(super) source_parent_identity: FileIdentity,
    pub(super) source_snapshot: SymlinkSnapshot,
    pub(super) payload: Vec<u8>,
    pub(super) target_parent_path: PathBuf,
    pub(super) target_name: PathBuf,
    pub(super) target_parent: Dir,
    pub(super) target_parent_identity: FileIdentity,
    pub(super) target_snapshot: PublishedSymlinkSnapshot,
}

pub(crate) fn move_entry(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
) -> Result<WorkspaceMoveResult, CommandError> {
    let mut hooks = NoopMoveHooks;
    move_entry_with_hooks(
        source_lease,
        source_path,
        target_lease,
        target_path,
        &mut hooks,
    )
}

fn move_entry_with_hooks<H: MoveHooks>(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
    hooks: &mut H,
) -> Result<WorkspaceMoveResult, CommandError> {
    if source_lease.root_id() == target_lease.root_id() {
        return Err(CommandError::new(
            "WORKSPACE_CONFLICT",
            "A cross-root move requires two different workspace roots.",
        ));
    }
    let receipt =
        writer::copy_entry_with_receipt(source_lease, source_path, target_lease, target_path)?;
    hooks.after_publication();
    Ok(consume_published_copy_receipt(
        receipt,
        source_lease,
        target_lease,
        hooks,
    ))
}

fn consume_published_copy_receipt<H: MoveHooks>(
    receipt: PublishedCopyReceipt,
    source_lease: &WorkspaceRootLease,
    target_lease: &WorkspaceRootLease,
    hooks: &mut H,
) -> WorkspaceMoveResult {
    match receipt {
        PublishedCopyReceipt::File(receipt) => {
            consume_file_receipt(receipt, source_lease, target_lease, hooks)
        }
        PublishedCopyReceipt::Symlink(receipt) => {
            consume_symlink_receipt(receipt, source_lease, target_lease, hooks)
        }
        PublishedCopyReceipt::Directory(receipt) => directory_copy::consume_directory_move_receipt(
            *receipt,
            source_lease,
            target_lease,
            hooks,
        ),
    }
}

pub(super) trait MoveHooks {
    fn after_publication(&mut self) {}
    fn before_delete(&mut self) {}
    fn after_target_entry(&mut self, _verified_entries: u32) {}
    fn before_remove_entry(&mut self, _next_removed_entries: u32) {}
    fn after_delete_entry(&mut self, _removed_entries: u32) {}
}

struct NoopMoveHooks;

impl MoveHooks for NoopMoveHooks {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum MoveSideFailure {
    Changed,
    Unverifiable,
}

fn consume_file_receipt<H: MoveHooks>(
    mut receipt: PublishedFileReceipt,
    source_lease: &WorkspaceRootLease,
    target_lease: &WorkspaceRootLease,
    hooks: &mut H,
) -> WorkspaceMoveResult {
    if let Err(reason) = verify_file_pair(&mut receipt, source_lease, target_lease, 0) {
        return WorkspaceMoveResult::incomplete(reason, 0);
    }
    hooks.before_delete();
    let source_parent = match verify_file_pair(&mut receipt, source_lease, target_lease, 0) {
        Ok(parent) => parent,
        Err(reason) => {
            return WorkspaceMoveResult::incomplete(reason, 0);
        }
    };
    let source_basename = receipt.source_name.as_path();
    hooks.before_remove_entry(1);
    match remove_verified_source_file(&source_parent, source_basename) {
        Ok(()) => {
            hooks.after_delete_entry(1);
            WorkspaceMoveResult::Moved
        }
        Err(_) => WorkspaceMoveResult::incomplete(WorkspaceMoveIncompleteReason::DeleteFailed, 0),
    }
}

fn consume_symlink_receipt<H: MoveHooks>(
    receipt: PublishedSymlinkReceipt,
    source_lease: &WorkspaceRootLease,
    target_lease: &WorkspaceRootLease,
    hooks: &mut H,
) -> WorkspaceMoveResult {
    if let Err(reason) = verify_symlink_pair(&receipt, source_lease, target_lease, 0) {
        return WorkspaceMoveResult::incomplete(reason, 0);
    }
    hooks.before_delete();
    let source_parent = match verify_symlink_pair(&receipt, source_lease, target_lease, 0) {
        Ok(parent) => parent,
        Err(reason) => {
            return WorkspaceMoveResult::incomplete(reason, 0);
        }
    };
    let source_basename = receipt.source_name.as_path();
    hooks.before_remove_entry(1);
    match remove_verified_source_file(&source_parent, source_basename) {
        Ok(()) => {
            hooks.after_delete_entry(1);
            WorkspaceMoveResult::Moved
        }
        Err(_) => WorkspaceMoveResult::incomplete(WorkspaceMoveIncompleteReason::DeleteFailed, 0),
    }
}

fn verify_file_pair(
    receipt: &mut PublishedFileReceipt,
    source_lease: &WorkspaceRootLease,
    target_lease: &WorkspaceRootLease,
    removed_source_aliases: u64,
) -> Result<Dir, WorkspaceMoveIncompleteReason> {
    let source_parent = reopen_parent(
        source_lease.directory(),
        &receipt.source_parent_path,
        receipt.source_parent_identity,
        &receipt.source_parent,
    )
    .map_err(source_reason)?;
    verify_source_file(
        &source_parent,
        &receipt.source_name,
        &mut receipt.source_file,
        receipt.source_snapshot,
        receipt.digest,
        removed_source_aliases,
    )
    .map_err(source_reason)?;

    let target_parent = reopen_parent(
        target_lease.directory(),
        &receipt.target_parent_path,
        receipt.target_parent_identity,
        &receipt.target_parent,
    )
    .map_err(target_reason)?;
    verify_target_file(
        &target_parent,
        &receipt.target_name,
        &mut receipt.target_file,
        receipt.target_snapshot,
        receipt.digest,
    )
    .map_err(target_reason)?;
    Ok(source_parent)
}

fn verify_symlink_pair(
    receipt: &PublishedSymlinkReceipt,
    source_lease: &WorkspaceRootLease,
    target_lease: &WorkspaceRootLease,
    removed_source_aliases: u64,
) -> Result<Dir, WorkspaceMoveIncompleteReason> {
    let source_parent = reopen_parent(
        source_lease.directory(),
        &receipt.source_parent_path,
        receipt.source_parent_identity,
        &receipt.source_parent,
    )
    .map_err(source_reason)?;
    verify_symlink(
        &source_parent,
        &receipt.source_name,
        receipt.source_snapshot,
        &receipt.payload,
        removed_source_aliases,
    )
    .map_err(source_reason)?;

    let target_parent = reopen_parent(
        target_lease.directory(),
        &receipt.target_parent_path,
        receipt.target_parent_identity,
        &receipt.target_parent,
    )
    .map_err(target_reason)?;
    verify_target_symlink(
        &target_parent,
        &receipt.target_name,
        receipt.target_snapshot,
        &receipt.payload,
    )
    .map_err(target_reason)?;
    Ok(source_parent)
}

pub(super) fn reopen_parent(
    root: &Dir,
    relative_parent: &Path,
    expected_identity: FileIdentity,
    retained_parent: &Dir,
) -> Result<Dir, MoveSideFailure> {
    let retained = retained_parent
        .dir_metadata()
        .map_err(|error| classify_io(&error))?;
    if !retained.is_dir() || FileIdentity::from_metadata(&retained) != expected_identity {
        return Err(MoveSideFailure::Changed);
    }
    let mut parent = root.try_clone().map_err(|error| classify_io(&error))?;
    for component in relative_parent.components() {
        use std::path::Component;
        let Component::Normal(name) = component else {
            return Err(MoveSideFailure::Changed);
        };
        parent = parent
            .open_dir_nofollow(Path::new(name))
            .map_err(|error| classify_io(&error))?;
    }
    let current = parent.dir_metadata().map_err(|error| classify_io(&error))?;
    if current.is_dir() && FileIdentity::from_metadata(&current) == expected_identity {
        Ok(parent)
    } else {
        Err(MoveSideFailure::Changed)
    }
}

pub(super) fn verify_source_file(
    parent: &Dir,
    name: &Path,
    retained_file: &mut File,
    expected: SourceSnapshot,
    expected_digest: [u8; 32],
    removed_aliases: u64,
) -> Result<(), MoveSideFailure> {
    let retained_metadata = retained_file
        .metadata()
        .map_err(|error| classify_io(&error))?;
    if FileIdentity::from_metadata(&retained_metadata) != expected.identity {
        return Err(MoveSideFailure::Changed);
    }
    let before = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    if !source_file_metadata_matches(&before, expected, removed_aliases) {
        return Err(MoveSideFailure::Changed);
    }
    let mut current = open_regular_no_follow(parent, name)?;
    let handle_before = current.metadata().map_err(|error| classify_io(&error))?;
    if !source_file_metadata_matches(&handle_before, expected, removed_aliases) {
        return Err(MoveSideFailure::Changed);
    }
    let digest = hash_bounded_file(&mut current)?;
    let handle_after = current.metadata().map_err(|error| classify_io(&error))?;
    let pathname_after = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    if !source_file_metadata_matches(&handle_after, expected, removed_aliases)
        || !source_file_metadata_matches(&pathname_after, expected, removed_aliases)
        || digest != expected_digest
    {
        return Err(MoveSideFailure::Changed);
    }
    Ok(())
}

pub(super) fn verify_target_file(
    parent: &Dir,
    name: &Path,
    retained_file: &mut File,
    expected: PublishedFileSnapshot,
    expected_digest: [u8; 32],
) -> Result<(), MoveSideFailure> {
    let retained_metadata = retained_file
        .metadata()
        .map_err(|error| classify_io(&error))?;
    if FileIdentity::from_metadata(&retained_metadata) != expected.identity {
        return Err(MoveSideFailure::Changed);
    }
    let before = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    if !target_file_metadata_matches(&before, expected) {
        return Err(MoveSideFailure::Changed);
    }
    let mut current = open_regular_no_follow(parent, name)?;
    let handle_before = current.metadata().map_err(|error| classify_io(&error))?;
    if !target_file_metadata_matches(&handle_before, expected) {
        return Err(MoveSideFailure::Changed);
    }
    let digest = hash_bounded_file(&mut current)?;
    let handle_after = current.metadata().map_err(|error| classify_io(&error))?;
    let pathname_after = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    if !target_file_metadata_matches(&handle_after, expected)
        || !target_file_metadata_matches(&pathname_after, expected)
        || digest != expected_digest
    {
        return Err(MoveSideFailure::Changed);
    }
    Ok(())
}

pub(super) fn verify_symlink(
    parent: &Dir,
    name: &Path,
    expected: SymlinkSnapshot,
    expected_payload: &[u8],
    removed_aliases: u64,
) -> Result<(), MoveSideFailure> {
    let before = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    let before = SymlinkSnapshot::from_metadata(&before).map_err(|_| MoveSideFailure::Changed)?;
    if !source_symlink_snapshot_matches(before, expected, removed_aliases) {
        return Err(MoveSideFailure::Changed);
    }
    let payload = writer::read_symlink_payload(parent, name, map_symlink_verify_error)
        .map_err(|error| classify_command_error(&error))?;
    let after = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    let after = SymlinkSnapshot::from_metadata(&after).map_err(|_| MoveSideFailure::Changed)?;
    if source_symlink_snapshot_matches(after, expected, removed_aliases)
        && payload == expected_payload
    {
        Ok(())
    } else {
        Err(MoveSideFailure::Changed)
    }
}

pub(super) fn verify_target_symlink(
    parent: &Dir,
    name: &Path,
    expected: PublishedSymlinkSnapshot,
    expected_payload: &[u8],
) -> Result<(), MoveSideFailure> {
    let before = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    let before = SymlinkSnapshot::from_metadata(&before).map_err(|_| MoveSideFailure::Changed)?;
    if !target_symlink_snapshot_matches(before, expected) {
        return Err(MoveSideFailure::Changed);
    }
    let payload = writer::read_symlink_payload(parent, name, map_symlink_verify_error)
        .map_err(|error| classify_command_error(&error))?;
    let after = parent
        .symlink_metadata(name)
        .map_err(|error| classify_io(&error))?;
    let after = SymlinkSnapshot::from_metadata(&after).map_err(|_| MoveSideFailure::Changed)?;
    if target_symlink_snapshot_matches(after, expected) && payload == expected_payload {
        Ok(())
    } else {
        Err(MoveSideFailure::Changed)
    }
}

fn source_file_metadata_matches(
    metadata: &Metadata,
    expected: SourceSnapshot,
    removed_aliases: u64,
) -> bool {
    use cap_std::fs::MetadataExt;

    let Some(expected_nlink) = expected.nlink.checked_sub(removed_aliases) else {
        return false;
    };
    metadata.is_file()
        && FileIdentity::from_metadata(metadata) == expected.identity
        && metadata.len() == expected.len
        && metadata.mode() == expected.mode
        && metadata.mtime() == expected.mtime
        && metadata.mtime_nsec() == expected.mtime_nsec
        && metadata.nlink() == expected_nlink
        && (removed_aliases > 0
            || (metadata.ctime() == expected.ctime && metadata.ctime_nsec() == expected.ctime_nsec))
}

fn target_file_metadata_matches(metadata: &Metadata, expected: PublishedFileSnapshot) -> bool {
    use cap_std::fs::MetadataExt;

    metadata.is_file()
        && FileIdentity::from_metadata(metadata) == expected.identity
        && metadata.len() == expected.len
        && metadata.mode() == expected.mode
        && metadata.mtime() == expected.mtime
        && metadata.mtime_nsec() == expected.mtime_nsec
        && metadata.nlink() == expected.nlink
}

fn source_symlink_snapshot_matches(
    observed: SymlinkSnapshot,
    expected: SymlinkSnapshot,
    removed_aliases: u64,
) -> bool {
    let Some(expected_nlink) = expected.nlink.checked_sub(removed_aliases) else {
        return false;
    };
    observed.identity == expected.identity
        && observed.len == expected.len
        && observed.mtime == expected.mtime
        && observed.mtime_nsec == expected.mtime_nsec
        && observed.nlink == expected_nlink
        && (removed_aliases > 0
            || (observed.ctime == expected.ctime && observed.ctime_nsec == expected.ctime_nsec))
}

fn target_symlink_snapshot_matches(
    observed: SymlinkSnapshot,
    expected: PublishedSymlinkSnapshot,
) -> bool {
    observed.identity == expected.identity
        && observed.len == expected.len
        && observed.mtime == expected.mtime
        && observed.mtime_nsec == expected.mtime_nsec
        && observed.nlink == expected.nlink
}

fn open_regular_no_follow(parent: &Dir, name: &Path) -> Result<File, MoveSideFailure> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};

    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    parent
        .open_with(name, &options)
        .map_err(|error| classify_io(&error))
}

fn hash_bounded_file(file: &mut File) -> Result<[u8; 32], MoveSideFailure> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| MoveSideFailure::Unverifiable)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1_024];
    let mut hashed = 0_usize;
    loop {
        let remaining = MAX_COPY_FILE_BYTES
            .checked_add(1)
            .and_then(|limit| limit.checked_sub(hashed))
            .ok_or(MoveSideFailure::Changed)?;
        let read_len = remaining.min(buffer.len());
        let read = file
            .read(&mut buffer[..read_len])
            .map_err(|_| MoveSideFailure::Unverifiable)?;
        if read == 0 {
            return Ok(hasher.finalize().into());
        }
        hashed = hashed.checked_add(read).ok_or(MoveSideFailure::Changed)?;
        if hashed > MAX_COPY_FILE_BYTES {
            return Err(MoveSideFailure::Changed);
        }
        hasher.update(&buffer[..read]);
    }
}

fn map_symlink_verify_error(error: rustix::io::Errno) -> CommandError {
    use rustix::io::Errno;

    if matches!(error, Errno::NOENT | Errno::NOTDIR | Errno::INVAL) {
        CommandError::new("WORKSPACE_CONFLICT", "The workspace symlink changed.")
    } else {
        CommandError::new("IO_FAILED", "The workspace symlink could not be verified.")
    }
}

pub(super) fn classify_command_error(error: &CommandError) -> MoveSideFailure {
    match error.code() {
        "WORKSPACE_CONFLICT"
        | "ENTRY_NOT_FOUND"
        | "ENTRY_TYPE_MISMATCH"
        | "FILE_TOO_LARGE"
        | "DIRECTORY_TOO_LARGE" => MoveSideFailure::Changed,
        _ => MoveSideFailure::Unverifiable,
    }
}

pub(super) fn classify_io(error: &io::Error) -> MoveSideFailure {
    if matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory | io::ErrorKind::IsADirectory
    ) || matches!(error.raw_os_error(), Some(libc::ELOOP))
    {
        MoveSideFailure::Changed
    } else {
        MoveSideFailure::Unverifiable
    }
}

pub(super) const fn source_reason(failure: MoveSideFailure) -> WorkspaceMoveIncompleteReason {
    match failure {
        MoveSideFailure::Changed => WorkspaceMoveIncompleteReason::SourceChanged,
        MoveSideFailure::Unverifiable => WorkspaceMoveIncompleteReason::SourceUnverifiable,
    }
}

pub(super) const fn target_reason(failure: MoveSideFailure) -> WorkspaceMoveIncompleteReason {
    match failure {
        MoveSideFailure::Changed => WorkspaceMoveIncompleteReason::TargetChanged,
        MoveSideFailure::Unverifiable => WorkspaceMoveIncompleteReason::TargetUnverifiable,
    }
}

pub(super) fn remove_verified_source_file(parent: &Dir, basename: &Path) -> io::Result<()> {
    parent.remove_file(basename)
}

pub(super) fn remove_verified_source_directory(parent: &Dir, basename: &Path) -> io::Result<()> {
    parent.remove_dir(basename)
}

#[cfg(test)]
mod tests;
