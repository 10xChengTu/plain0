use std::ffi::OsString;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[cfg(unix)]
use cap_fs_ext::DirExt;
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
#[cfg(unix)]
use cap_std::fs::File;
use cap_std::fs::{Dir, FileType, Metadata, OpenOptions};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{
    WorkspaceDirectoryEntry, WorkspaceEntryKind, WorkspaceEntryStat, WorkspaceReadDirectoryResult,
};
use super::version::is_version_token;
#[cfg(unix)]
use super::version::{
    version_token, writable_filesystem_kind, writer_eligibility, FileSystemKind,
    UnixMetadataSnapshot,
};
use super::WorkspaceRootLease;

const MAX_DIRECTORY_ENTRIES: usize = 10_000;
const MAX_ENTRY_NAME_BYTES: usize = 1_024;
const MAX_DIRECTORY_NAME_PAYLOAD_BYTES: usize = 2 * 1_024 * 1_024;
const MAX_FILE_BYTES: usize = 8 * 1_024 * 1_024;
const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const PLR1_HEADER_BYTES: usize = 36;
const PLR1_MAGIC: &[u8; 4] = b"PLR1";
const PLR1_FILE_KIND: u8 = 1;
const PLR1_SYMLINK_FILE_KIND: u8 = 2;

#[derive(Clone, Copy)]
struct ReaderLimits {
    max_entries: usize,
    max_name_bytes: usize,
    max_name_payload_bytes: usize,
}

const READER_LIMITS: ReaderLimits = ReaderLimits {
    max_entries: MAX_DIRECTORY_ENTRIES,
    max_name_bytes: MAX_ENTRY_NAME_BYTES,
    max_name_payload_bytes: MAX_DIRECTORY_NAME_PAYLOAD_BYTES,
};

#[derive(Debug)]
pub(crate) struct WorkspaceReadFileReceipt {
    stat: WorkspaceEntryStat,
    content: Vec<u8>,
}

impl WorkspaceReadFileReceipt {
    /// `pub(crate)` (rather than private) because `F220` S3's remote backend
    /// (`workspace::remote_backend::read_file`) also needs to produce the
    /// exact same validated receipt — and therefore the exact same `PLR1`
    /// wire frame via [`Self::into_plr1_frame`] — for a remote-backed read,
    /// so the frontend's decoder stays identical across both backends.
    pub(crate) fn new(stat: WorkspaceEntryStat, content: Vec<u8>) -> Result<Self, CommandError> {
        let content_size = u64::try_from(content.len()).map_err(|_| file_too_large())?;
        if content.len() > MAX_FILE_BYTES {
            return Err(file_too_large());
        }
        if stat.size() != content_size
            || !matches!(
                stat.kind(),
                WorkspaceEntryKind::File | WorkspaceEntryKind::SymlinkFile
            )
            || !valid_receipt_version(stat.kind(), stat.version())
        {
            return Err(io_failed());
        }
        Ok(Self { stat, content })
    }

    #[cfg(test)]
    pub(crate) fn stat(&self) -> &WorkspaceEntryStat {
        &self.stat
    }

    #[cfg(test)]
    pub(crate) fn content(&self) -> &[u8] {
        &self.content
    }

    pub(crate) fn into_plr1_frame(self) -> Result<Vec<u8>, CommandError> {
        if self.content.len() > MAX_FILE_BYTES {
            return Err(file_too_large());
        }
        let kind = match self.stat.kind() {
            WorkspaceEntryKind::File => PLR1_FILE_KIND,
            WorkspaceEntryKind::SymlinkFile => PLR1_SYMLINK_FILE_KIND,
            _ => return Err(io_failed()),
        };
        let version = self.stat.version().unwrap_or("");
        if !valid_receipt_version(self.stat.kind(), self.stat.version())
            || (kind == PLR1_SYMLINK_FILE_KIND && !version.is_empty())
        {
            return Err(io_failed());
        }
        let version_length = u8::try_from(version.len()).map_err(|_| io_failed())?;
        let content_length = u32::try_from(self.content.len()).map_err(|_| file_too_large())?;
        let total_length = PLR1_HEADER_BYTES
            .checked_add(version.len())
            .and_then(|length| length.checked_add(self.content.len()))
            .ok_or_else(file_too_large)?;
        let mut frame = Vec::with_capacity(total_length);
        frame.extend_from_slice(PLR1_MAGIC);
        frame.push(kind);
        frame.push(version_length);
        frame.extend_from_slice(&0_u16.to_be_bytes());
        frame.extend_from_slice(&content_length.to_be_bytes());
        frame.extend_from_slice(&self.stat.size().to_be_bytes());
        frame.extend_from_slice(&self.stat.mtime().to_be_bytes());
        frame.extend_from_slice(&self.stat.ctime().to_be_bytes());
        frame.extend_from_slice(version.as_bytes());
        frame.extend_from_slice(&self.content);
        if frame.len() != total_length {
            return Err(io_failed());
        }
        Ok(frame)
    }

    pub(crate) fn into_parts(self) -> (WorkspaceEntryStat, Vec<u8>) {
        (self.stat, self.content)
    }
}

fn valid_receipt_version(kind: WorkspaceEntryKind, version: Option<&str>) -> bool {
    match (kind, version) {
        (WorkspaceEntryKind::File, None) | (WorkspaceEntryKind::SymlinkFile, None) => true,
        (WorkspaceEntryKind::File, Some(version)) => is_version_token(version),
        _ => false,
    }
}

#[cfg(unix)]
#[derive(Clone, Debug, Eq, PartialEq)]
struct SymlinkReceipt {
    path: PathBuf,
    metadata: UnixMetadataSnapshot,
    payload: Vec<u8>,
}

#[cfg(unix)]
struct OpenedTarget {
    parent_chain: Vec<UnixMetadataSnapshot>,
    parent: Dir,
    name: PathBuf,
    file: File,
    metadata: Metadata,
    snapshot: UnixMetadataSnapshot,
    filesystem: Option<FileSystemKind>,
}

pub(crate) fn stat(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
) -> Result<WorkspaceEntryStat, CommandError> {
    let directory = lease.directory();
    let (kind, metadata) = if relative_path.is_root() {
        let metadata = directory.dir_metadata().map_err(map_workspace_io_error)?;
        (WorkspaceEntryKind::Directory, metadata)
    } else {
        let metadata = directory
            .symlink_metadata(relative_path.as_path())
            .map_err(map_workspace_io_error)?;
        classify_metadata(directory, relative_path.as_path(), metadata)
    };

    if matches!(
        kind,
        WorkspaceEntryKind::File | WorkspaceEntryKind::SymlinkFile
    ) {
        let (kind, metadata, version) = stat_file_receipt(lease, relative_path)?;
        return stat_from_metadata(kind, &metadata, version);
    }
    stat_from_metadata(kind, &metadata, None)
}

pub(crate) fn read_directory(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
) -> Result<WorkspaceReadDirectoryResult, CommandError> {
    read_directory_with_limits(lease, relative_path, READER_LIMITS)
}

pub(crate) fn read_file(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
) -> Result<WorkspaceReadFileReceipt, CommandError> {
    read_file_with_limit(lease, relative_path, MAX_FILE_BYTES)
}

fn read_file_with_limit(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    max_bytes: usize,
) -> Result<WorkspaceReadFileReceipt, CommandError> {
    read_file_with_limit_and_hook(lease, relative_path, max_bytes, || {})
}

fn read_file_with_limit_and_hook<F>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    max_bytes: usize,
    before_open: F,
) -> Result<WorkspaceReadFileReceipt, CommandError>
where
    F: FnOnce(),
{
    read_file_with_limit_and_hooks(lease, relative_path, max_bytes, before_open, || {})
}

fn read_file_with_limit_and_hooks<B, A>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    max_bytes: usize,
    before_open: B,
    after_read: A,
) -> Result<WorkspaceReadFileReceipt, CommandError>
where
    B: FnOnce(),
    A: FnOnce(),
{
    if relative_path.is_root() {
        return Err(entry_type_mismatch());
    }
    // Reject FIFOs/devices before canonicalization. Some platform resolver
    // implementations may open the terminal component while canonicalizing;
    // a pathname-only metadata probe is non-blocking and is repeated against
    // the final opened handle below.
    let preflight = lease
        .directory()
        .metadata(relative_path.as_path())
        .map_err(map_workspace_io_error)?;
    validate_readable_file(&preflight, max_bytes)?;

    #[cfg(unix)]
    {
        read_file_unix(lease, relative_path, max_bytes, before_open, after_read)
    }

    #[cfg(not(unix))]
    {
        read_file_portable(lease, relative_path, max_bytes, before_open, after_read)
    }
}

#[cfg(not(unix))]
fn read_file_portable<B, A>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    max_bytes: usize,
    before_open: B,
    after_read: A,
) -> Result<WorkspaceReadFileReceipt, CommandError>
where
    B: FnOnce(),
    A: FnOnce(),
{
    let directory = lease.directory();
    let link_metadata = directory
        .symlink_metadata(relative_path.as_path())
        .map_err(map_workspace_io_error)?;
    let resolved = canonical_relative_path(directory, relative_path.as_path())?;
    let metadata = directory
        .metadata(&resolved)
        .map_err(map_workspace_io_error)?;
    validate_readable_file(&metadata, max_bytes)?;

    before_open();
    let mut file = open_file_for_bounded_read(directory, &resolved)?;
    let opened_metadata = file.metadata().map_err(map_handle_io_error)?;
    validate_readable_file(&opened_metadata, max_bytes)?;
    let content = read_bounded(&mut file, opened_metadata.len(), max_bytes)?;
    after_read();
    let after = file.metadata().map_err(map_handle_io_error)?;
    if opened_metadata.len() != after.len()
        || opened_metadata.modified().ok() != after.modified().ok()
        || !after.is_file()
        || canonical_relative_path(directory, relative_path.as_path())? != resolved
    {
        return Err(workspace_changed());
    }
    let kind = if link_metadata.file_type().is_symlink() {
        WorkspaceEntryKind::SymlinkFile
    } else {
        WorkspaceEntryKind::File
    };
    let stat = stat_from_metadata(kind, &after, None)?;
    WorkspaceReadFileReceipt::new(stat, content)
}

#[cfg(unix)]
fn read_file_unix<B, A>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    max_bytes: usize,
    before_open: B,
    after_read: A,
) -> Result<WorkspaceReadFileReceipt, CommandError>
where
    B: FnOnce(),
    A: FnOnce(),
{
    let root = lease.directory();
    let symlinks_before = capture_symlink_receipts(root, relative_path.as_path())?;
    let resolved_before = canonical_relative_path(root, relative_path.as_path())?;
    before_open();

    let mut opened = open_resolved_target(root, &resolved_before, max_bytes)?;
    let snapshot_before = opened.snapshot;
    let content = read_bounded(&mut opened.file, snapshot_before.length, max_bytes)?;
    after_read();
    let metadata_after = opened.file.metadata().map_err(map_handle_io_error)?;
    let snapshot_after = UnixMetadataSnapshot::from_metadata(&metadata_after);
    validate_readable_file(&metadata_after, max_bytes)?;
    if snapshot_before != snapshot_after {
        return Err(workspace_changed());
    }

    verify_resolved_target(root, &resolved_before, &opened, max_bytes)?;
    let resolved_after = canonical_relative_path(root, relative_path.as_path())?;
    let symlinks_after = capture_symlink_receipts(root, relative_path.as_path())?;
    if resolved_before != resolved_after || symlinks_before != symlinks_after {
        return Err(workspace_changed());
    }

    let final_is_symlink = symlinks_before
        .last()
        .is_some_and(|receipt| receipt.path == relative_path.as_path());
    let kind = if final_is_symlink {
        WorkspaceEntryKind::SymlinkFile
    } else {
        WorkspaceEntryKind::File
    };
    let version = eligible_version(
        lease,
        relative_path,
        symlinks_before.is_empty(),
        &opened,
        snapshot_after,
    );
    let stat = stat_from_metadata(kind, &metadata_after, version)?;
    WorkspaceReadFileReceipt::new(stat, content)
}

#[cfg(unix)]
fn stat_file_receipt(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
) -> Result<(WorkspaceEntryKind, Metadata, Option<String>), CommandError> {
    let symlinks_before = capture_symlink_receipts(lease.directory(), relative_path.as_path())?;
    let resolved = canonical_relative_path(lease.directory(), relative_path.as_path())?;
    let stat_limit = usize::try_from(MAX_JS_SAFE_INTEGER).unwrap_or(usize::MAX);
    let opened = open_resolved_target(lease.directory(), &resolved, stat_limit)?;
    verify_resolved_target(lease.directory(), &resolved, &opened, stat_limit)?;
    let symlinks_after = capture_symlink_receipts(lease.directory(), relative_path.as_path())?;
    let resolved_after = canonical_relative_path(lease.directory(), relative_path.as_path())?;
    if symlinks_before != symlinks_after || resolved != resolved_after {
        return Err(workspace_changed());
    }
    let final_is_symlink = symlinks_before
        .last()
        .is_some_and(|receipt| receipt.path == relative_path.as_path());
    let kind = if final_is_symlink {
        WorkspaceEntryKind::SymlinkFile
    } else {
        WorkspaceEntryKind::File
    };
    let version = eligible_version(
        lease,
        relative_path,
        symlinks_before.is_empty(),
        &opened,
        opened.snapshot,
    );
    Ok((kind, opened.metadata, version))
}

#[cfg(unix)]
fn eligible_version(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    has_direct_path: bool,
    opened: &OpenedTarget,
    target: UnixMetadataSnapshot,
) -> Option<String> {
    if !has_direct_path {
        return None;
    }
    opened.filesystem.and_then(|filesystem| {
        let parent = opened.parent_chain.last().copied()?;
        writer_eligibility(target, parent)
            .then(|| version_token(lease.root_id(), relative_path, filesystem, target))
            .flatten()
    })
}

#[cfg(not(unix))]
fn stat_file_receipt(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
) -> Result<(WorkspaceEntryKind, Metadata, Option<String>), CommandError> {
    let directory = lease.directory();
    let link = directory
        .symlink_metadata(relative_path.as_path())
        .map_err(map_workspace_io_error)?;
    let resolved = canonical_relative_path(directory, relative_path.as_path())?;
    let file = open_file_for_bounded_read(directory, &resolved)?;
    let metadata = file.metadata().map_err(map_handle_io_error)?;
    validate_readable_file(
        &metadata,
        usize::try_from(MAX_JS_SAFE_INTEGER).unwrap_or(usize::MAX),
    )?;
    let kind = if link.file_type().is_symlink() {
        WorkspaceEntryKind::SymlinkFile
    } else {
        WorkspaceEntryKind::File
    };
    Ok((kind, metadata, None))
}

#[cfg(unix)]
fn capture_symlink_receipts(
    root: &Dir,
    relative_path: &Path,
) -> Result<Vec<SymlinkReceipt>, CommandError> {
    let mut prefix = PathBuf::new();
    let mut receipts = Vec::new();
    for component in relative_path.components() {
        let Component::Normal(segment) = component else {
            return Err(path_outside_root());
        };
        prefix.push(segment);
        let metadata = root
            .symlink_metadata(&prefix)
            .map_err(map_workspace_io_error)?;
        if metadata.file_type().is_symlink() {
            let payload = super::writer::read_symlink_payload(root, &prefix, |_| io_failed())?;
            receipts.push(SymlinkReceipt {
                path: prefix.clone(),
                metadata: UnixMetadataSnapshot::from_metadata(&metadata),
                payload,
            });
        }
    }
    Ok(receipts)
}

fn canonical_relative_path(root: &Dir, path: &Path) -> Result<PathBuf, CommandError> {
    let resolved = root.canonicalize(path).map_err(map_workspace_io_error)?;
    if resolved.as_os_str().is_empty() || !is_capability_relative(&resolved) {
        return Err(path_outside_root());
    }
    Ok(resolved)
}

#[cfg(unix)]
fn open_resolved_target(
    root: &Dir,
    resolved_path: &Path,
    max_bytes: usize,
) -> Result<OpenedTarget, CommandError> {
    let parent_path = resolved_path.parent().ok_or_else(path_outside_root)?;
    let name = resolved_path
        .file_name()
        .map(PathBuf::from)
        .ok_or_else(entry_type_mismatch)?;
    let mut parent = root.try_clone().map_err(map_workspace_io_error)?;
    let root_metadata = parent.dir_metadata().map_err(map_workspace_io_error)?;
    if !root_metadata.is_dir() {
        return Err(entry_type_mismatch());
    }
    let mut parent_chain = vec![UnixMetadataSnapshot::from_metadata(&root_metadata)];
    let mut filesystem = writable_filesystem_kind(&parent);

    for component in parent_path.components() {
        let Component::Normal(segment) = component else {
            return Err(path_outside_root());
        };
        parent = parent
            .open_dir_nofollow(segment)
            .map_err(map_workspace_io_error)?;
        let metadata = parent.dir_metadata().map_err(map_workspace_io_error)?;
        if !metadata.is_dir() {
            return Err(entry_type_mismatch());
        }
        parent_chain.push(UnixMetadataSnapshot::from_metadata(&metadata));
        filesystem = matching_filesystem(filesystem, writable_filesystem_kind(&parent));
    }

    let pathname_metadata = parent
        .symlink_metadata(&name)
        .map_err(map_workspace_io_error)?;
    if !pathname_metadata.is_file() {
        return Err(entry_type_mismatch());
    }
    let file = open_file_for_bounded_read(&parent, &name)?;
    let metadata = file.metadata().map_err(map_handle_io_error)?;
    validate_readable_file(&metadata, max_bytes)?;
    let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
    let pathname_snapshot = UnixMetadataSnapshot::from_metadata(&pathname_metadata);
    if snapshot != pathname_snapshot {
        return Err(workspace_changed());
    }
    filesystem = matching_filesystem(filesystem, writable_filesystem_kind(&file));
    Ok(OpenedTarget {
        parent_chain,
        parent,
        name,
        file,
        metadata,
        snapshot,
        filesystem,
    })
}

#[cfg(unix)]
fn verify_resolved_target(
    root: &Dir,
    resolved_path: &Path,
    expected: &OpenedTarget,
    max_bytes: usize,
) -> Result<(), CommandError> {
    let current = open_resolved_target(root, resolved_path, max_bytes)?;
    if !parent_chain_matches(&current.parent_chain, &expected.parent_chain)
        || current.snapshot != expected.snapshot
        || current.name != expected.name
        || current.filesystem != expected.filesystem
    {
        return Err(workspace_changed());
    }
    let expected_parent = UnixMetadataSnapshot::from_metadata(
        &expected
            .parent
            .dir_metadata()
            .map_err(map_workspace_io_error)?,
    );
    if current
        .parent_chain
        .last()
        .zip(expected.parent_chain.last())
        .is_none_or(|(current, original)| {
            !writer_parent_fields_match(*current, *original)
                || !writer_parent_fields_match(*current, expected_parent)
        })
    {
        return Err(workspace_changed());
    }
    Ok(())
}

#[cfg(unix)]
fn parent_chain_matches(
    current: &[UnixMetadataSnapshot],
    expected: &[UnixMetadataSnapshot],
) -> bool {
    current.len() == expected.len()
        && current.iter().zip(expected).all(|(current, expected)| {
            current.device == expected.device && current.inode == expected.inode
        })
        && current
            .last()
            .zip(expected.last())
            .is_some_and(|(current, expected)| writer_parent_fields_match(*current, *expected))
}

#[cfg(unix)]
fn writer_parent_fields_match(
    current: UnixMetadataSnapshot,
    expected: UnixMetadataSnapshot,
) -> bool {
    current.device == expected.device
        && current.inode == expected.inode
        && current.mode == expected.mode
        && current.uid == expected.uid
        && current.gid == expected.gid
}

#[cfg(unix)]
fn matching_filesystem(
    expected: Option<FileSystemKind>,
    current: Option<FileSystemKind>,
) -> Option<FileSystemKind> {
    match (expected, current) {
        (Some(expected), Some(current)) if expected == current => Some(expected),
        _ => None,
    }
}

fn open_file_for_bounded_read(
    directory: &cap_std::fs::Dir,
    path: &Path,
) -> Result<cap_std::fs::File, CommandError> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    directory
        .open_with(path, &options)
        .map_err(map_workspace_io_error)
}

fn validate_readable_file(metadata: &Metadata, max_bytes: usize) -> Result<(), CommandError> {
    if !metadata.is_file() {
        return Err(entry_type_mismatch());
    }
    if metadata.len() > max_bytes as u64 {
        return Err(file_too_large());
    }
    Ok(())
}

fn read_bounded<R: Read>(
    reader: &mut R,
    prechecked_size: u64,
    max_bytes: usize,
) -> Result<Vec<u8>, CommandError> {
    if prechecked_size > max_bytes as u64 {
        return Err(file_too_large());
    }
    let read_limit = u64::try_from(max_bytes)
        .ok()
        .and_then(|value| value.checked_add(1))
        .ok_or_else(file_too_large)?;
    let capacity = usize::try_from(prechecked_size)
        .unwrap_or(max_bytes)
        .min(max_bytes);
    let mut bytes = Vec::with_capacity(capacity);
    reader
        .take(read_limit)
        .read_to_end(&mut bytes)
        .map_err(map_handle_io_error)?;
    if bytes.len() > max_bytes {
        return Err(file_too_large());
    }
    Ok(bytes)
}

fn read_directory_with_limits(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    limits: ReaderLimits,
) -> Result<WorkspaceReadDirectoryResult, CommandError> {
    let directory = lease.directory();
    let resolved_path = resolve_directory(directory, relative_path)?;
    let read_dir = if relative_path.is_root() {
        directory.entries().map_err(map_workspace_io_error)?
    } else {
        directory
            .read_dir(&resolved_path)
            .map_err(map_workspace_io_error)?
    };
    let mut entries = Vec::new();
    let mut name_payload_bytes = 0usize;

    for entry in read_dir {
        if entries.len() == limits.max_entries {
            return Err(directory_too_large());
        }
        let entry = entry.map_err(map_workspace_io_error)?;
        let name = decode_entry_name(entry.file_name())?;
        validate_entry_name(relative_path, &name, limits.max_name_bytes)?;
        name_payload_bytes = name_payload_bytes
            .checked_add(name.len())
            .ok_or_else(directory_too_large)?;
        if name_payload_bytes > limits.max_name_payload_bytes {
            return Err(directory_too_large());
        }

        let file_type = entry.file_type().map_err(map_workspace_io_error)?;
        let entry_path = resolved_path.join(&name);
        let kind = classify_file_type(directory, &entry_path, file_type);
        entries.push(WorkspaceDirectoryEntry::new(name, kind));
    }

    entries.sort_unstable_by(|left, right| left.name().as_bytes().cmp(right.name().as_bytes()));
    Ok(WorkspaceReadDirectoryResult::new(entries))
}

fn resolve_directory(
    directory: &cap_std::fs::Dir,
    relative_path: &RelativePath,
) -> Result<PathBuf, CommandError> {
    if relative_path.is_root() {
        let metadata = directory.dir_metadata().map_err(map_workspace_io_error)?;
        if !metadata.is_dir() {
            return Err(entry_type_mismatch());
        }
        return Ok(PathBuf::new());
    }

    let resolved = directory
        .canonicalize(relative_path.as_path())
        .map_err(map_workspace_io_error)?;
    if !is_capability_relative(&resolved) {
        return Err(path_outside_root());
    }
    let metadata = directory
        .metadata(&resolved)
        .map_err(map_workspace_io_error)?;
    if !metadata.is_dir() {
        return Err(entry_type_mismatch());
    }
    Ok(resolved)
}

fn classify_metadata(
    directory: &cap_std::fs::Dir,
    path: &Path,
    metadata: Metadata,
) -> (WorkspaceEntryKind, Metadata) {
    let file_type = metadata.file_type();
    if !file_type.is_symlink() {
        return (classify_plain_file_type(file_type), metadata);
    }

    match directory.metadata(path) {
        Ok(target) if target.is_file() => (WorkspaceEntryKind::SymlinkFile, target),
        Ok(target) if target.is_dir() => (WorkspaceEntryKind::SymlinkDirectory, target),
        _ => (WorkspaceEntryKind::Symlink, metadata),
    }
}

fn classify_file_type(
    directory: &cap_std::fs::Dir,
    path: &Path,
    file_type: FileType,
) -> WorkspaceEntryKind {
    if !file_type.is_symlink() {
        return classify_plain_file_type(file_type);
    }

    match directory.metadata(path) {
        Ok(target) if target.is_file() => WorkspaceEntryKind::SymlinkFile,
        Ok(target) if target.is_dir() => WorkspaceEntryKind::SymlinkDirectory,
        _ => WorkspaceEntryKind::Symlink,
    }
}

fn classify_plain_file_type(file_type: FileType) -> WorkspaceEntryKind {
    if file_type.is_file() {
        WorkspaceEntryKind::File
    } else if file_type.is_dir() {
        WorkspaceEntryKind::Directory
    } else {
        WorkspaceEntryKind::Other
    }
}

pub(crate) fn stat_from_metadata(
    kind: WorkspaceEntryKind,
    metadata: &Metadata,
    version: Option<String>,
) -> Result<WorkspaceEntryStat, CommandError> {
    let size = safe_size(metadata.len())?;
    let mtime = metadata
        .modified()
        .ok()
        .map(system_time_millis)
        .unwrap_or(0);
    let ctime = metadata.created().ok().map(system_time_millis).unwrap_or(0);
    Ok(WorkspaceEntryStat::new(kind, size, mtime, ctime, version))
}

fn safe_size(size: u64) -> Result<u64, CommandError> {
    if size <= MAX_JS_SAFE_INTEGER {
        Ok(size)
    } else {
        Err(io_failed())
    }
}

fn system_time_millis(time: cap_std::time::SystemTime) -> u64 {
    let Some(millis) = time
        .into_std()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
    else {
        return 0;
    };
    safe_time_millis(millis)
}

fn safe_time_millis(millis: u128) -> u64 {
    u64::try_from(millis)
        .ok()
        .filter(|value| *value <= MAX_JS_SAFE_INTEGER)
        .unwrap_or(0)
}

fn decode_entry_name(name: OsString) -> Result<String, CommandError> {
    name.into_string().map_err(|_| path_encoding_unsupported())
}

fn validate_entry_name(
    parent: &RelativePath,
    name: &str,
    max_name_bytes: usize,
) -> Result<(), CommandError> {
    if name.is_empty() {
        return Err(path_encoding_unsupported());
    }
    if name.len() > max_name_bytes {
        return Err(directory_too_large());
    }
    let parsed = RelativePath::parse_wire(name).map_err(|_| path_encoding_unsupported())?;
    if parsed.is_root() || parsed.as_wire() != name {
        return Err(path_encoding_unsupported());
    }
    parent
        .join_child(name)
        .map_err(|_| path_encoding_unsupported())?;
    Ok(())
}

fn is_capability_relative(path: &Path) -> bool {
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn map_workspace_io_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => entry_not_found(),
        io::ErrorKind::NotADirectory | io::ErrorKind::IsADirectory => entry_type_mismatch(),
        io::ErrorKind::PermissionDenied if error.raw_os_error().is_none() => path_outside_root(),
        io::ErrorKind::PermissionDenied => permission_denied(),
        io::ErrorKind::InvalidInput => path_outside_root(),
        _ => io_failed(),
    }
}

fn map_handle_io_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::PermissionDenied => permission_denied(),
        _ => io_failed(),
    }
}

fn path_encoding_unsupported() -> CommandError {
    CommandError::new(
        "PATH_ENCODING_UNSUPPORTED",
        "The workspace entry name cannot be represented safely.",
    )
}

fn path_outside_root() -> CommandError {
    CommandError::new(
        "PATH_OUTSIDE_ROOT",
        "The workspace path is outside the authorized root.",
    )
}

fn entry_not_found() -> CommandError {
    CommandError::new("ENTRY_NOT_FOUND", "The workspace entry does not exist.")
}

fn entry_type_mismatch() -> CommandError {
    CommandError::new(
        "ENTRY_TYPE_MISMATCH",
        "The workspace entry has an incompatible type.",
    )
}

fn permission_denied() -> CommandError {
    CommandError::new(
        "PERMISSION_DENIED",
        "The workspace entry cannot be accessed.",
    )
}

fn directory_too_large() -> CommandError {
    CommandError::new(
        "DIRECTORY_TOO_LARGE",
        "The workspace directory exceeds the supported listing limits.",
    )
}

fn file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace file exceeds the supported read limit.",
    )
}

fn workspace_changed() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace entry changed while it was being read.",
    )
}

fn io_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be read.")
}

#[cfg(test)]
mod tests;
