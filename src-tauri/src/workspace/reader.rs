use std::ffi::OsString;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use cap_std::fs::{FileType, Metadata, OpenOptions};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{
    WorkspaceDirectoryEntry, WorkspaceEntryKind, WorkspaceEntryStat, WorkspaceReadDirectoryResult,
};
use super::WorkspaceRootLease;

const MAX_DIRECTORY_ENTRIES: usize = 10_000;
const MAX_ENTRY_NAME_BYTES: usize = 1_024;
const MAX_DIRECTORY_NAME_PAYLOAD_BYTES: usize = 2 * 1_024 * 1_024;
const MAX_FILE_BYTES: usize = 8 * 1_024 * 1_024;
const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

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

    stat_from_metadata(kind, &metadata)
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
) -> Result<Vec<u8>, CommandError> {
    read_file_with_limit(lease, relative_path, MAX_FILE_BYTES)
}

fn read_file_with_limit(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    max_bytes: usize,
) -> Result<Vec<u8>, CommandError> {
    read_file_with_limit_and_hook(lease, relative_path, max_bytes, || {})
}

fn read_file_with_limit_and_hook<F>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    max_bytes: usize,
    before_open: F,
) -> Result<Vec<u8>, CommandError>
where
    F: FnOnce(),
{
    if relative_path.is_root() {
        return Err(entry_type_mismatch());
    }

    let directory = lease.directory();
    let metadata = directory
        .metadata(relative_path.as_path())
        .map_err(map_workspace_io_error)?;
    validate_readable_file(&metadata, max_bytes)?;

    before_open();
    let mut file = open_file_for_bounded_read(directory, relative_path.as_path())?;
    let opened_metadata = file.metadata().map_err(map_handle_io_error)?;
    validate_readable_file(&opened_metadata, max_bytes)?;
    read_bounded(&mut file, opened_metadata.len(), max_bytes)
}

fn open_file_for_bounded_read(
    directory: &cap_std::fs::Dir,
    path: &Path,
) -> Result<cap_std::fs::File, CommandError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;

        options.custom_flags(libc::O_NONBLOCK);
    }
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

fn stat_from_metadata(
    kind: WorkspaceEntryKind,
    metadata: &Metadata,
) -> Result<WorkspaceEntryStat, CommandError> {
    let size = safe_size(metadata.len())?;
    let mtime = metadata
        .modified()
        .ok()
        .map(system_time_millis)
        .unwrap_or(0);
    let ctime = metadata.created().ok().map(system_time_millis).unwrap_or(0);
    Ok(WorkspaceEntryStat::new(kind, size, mtime, ctime))
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

fn io_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be read.")
}

#[cfg(test)]
mod tests;
