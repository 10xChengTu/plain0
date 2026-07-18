use std::io;
use std::path::{Path, PathBuf};

use cap_std::fs::{Dir, OpenOptions};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::WorkspaceRootLease;

pub(crate) fn create_file(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
) -> Result<(), CommandError> {
    ensure_entry_path(relative_path)?;

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    lease
        .directory()
        .open_with(relative_path.as_path(), &options)
        .map(|_| ())
        .map_err(map_workspace_mutation_error)
}

pub(crate) fn create_directory(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
) -> Result<(), CommandError> {
    ensure_entry_path(relative_path)?;
    lease
        .directory()
        .create_dir(relative_path.as_path())
        .map_err(map_workspace_mutation_error)
}

pub(crate) fn rename(
    lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_path: &RelativePath,
) -> Result<(), CommandError> {
    ensure_entry_path(source_path)?;
    ensure_entry_path(target_path)?;

    if source_path == target_path {
        return Err(entry_already_exists());
    }
    if target_path.as_path().starts_with(source_path.as_path()) {
        return Err(workspace_conflict());
    }

    let (source_parent_path, source_name) = split_entry_path(source_path)?;
    let (target_parent_path, target_name) = split_entry_path(target_path)?;
    let source_parent = open_parent(lease.directory(), &source_parent_path)?;
    if source_parent_path == target_parent_path {
        rename_no_replace(&source_parent, &source_name, &source_parent, &target_name)
    } else {
        let target_parent = open_parent(lease.directory(), &target_parent_path)?;
        rename_no_replace(&source_parent, &source_name, &target_parent, &target_name)
    }
}

fn split_entry_path(relative_path: &RelativePath) -> Result<(PathBuf, PathBuf), CommandError> {
    let path = relative_path.as_path();
    let parent = path.parent().ok_or_else(entry_type_mismatch)?;
    let name = path.file_name().ok_or_else(entry_type_mismatch)?;
    Ok((parent.to_owned(), PathBuf::from(name)))
}

fn open_parent(root: &Dir, relative_parent: &Path) -> Result<Dir, CommandError> {
    let path = if relative_parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        relative_parent
    };
    root.open_dir(path).map_err(map_workspace_rename_error)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn rename_no_replace(
    source_parent: &Dir,
    source_name: &Path,
    target_parent: &Dir,
    target_name: &Path,
) -> Result<(), CommandError> {
    use rustix::fs::{renameat_with, RenameFlags};

    renameat_with(
        source_parent,
        source_name,
        target_parent,
        target_name,
        RenameFlags::NOREPLACE,
    )
    .map_err(map_rename_error)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn rename_no_replace(
    _source_parent: &Dir,
    _source_name: &Path,
    _target_parent: &Dir,
    _target_name: &Path,
) -> Result<(), CommandError> {
    Err(rename_unsupported())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn map_rename_error(error: rustix::io::Errno) -> CommandError {
    use rustix::io::Errno;

    match error {
        Errno::NOENT => entry_not_found(),
        Errno::EXIST | Errno::NOTEMPTY => entry_already_exists(),
        Errno::NOTDIR | Errno::ISDIR => entry_type_mismatch(),
        Errno::ACCESS | Errno::PERM | Errno::ROFS => permission_denied(),
        _ => rename_failed(),
    }
}

fn ensure_entry_path(relative_path: &RelativePath) -> Result<(), CommandError> {
    if relative_path.is_root() {
        Err(entry_type_mismatch())
    } else {
        Ok(())
    }
}

fn map_workspace_mutation_error(error: io::Error) -> CommandError {
    map_workspace_error(error, io_failed)
}

fn map_workspace_rename_error(error: io::Error) -> CommandError {
    map_workspace_error(error, rename_failed)
}

fn map_workspace_error(error: io::Error, fallback: fn() -> CommandError) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => entry_not_found(),
        io::ErrorKind::AlreadyExists => entry_already_exists(),
        io::ErrorKind::NotADirectory | io::ErrorKind::IsADirectory => entry_type_mismatch(),
        io::ErrorKind::PermissionDenied if error.raw_os_error().is_none() => path_outside_root(),
        io::ErrorKind::PermissionDenied => permission_denied(),
        io::ErrorKind::InvalidInput if error.raw_os_error().is_none() => path_outside_root(),
        _ => fallback(),
    }
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

fn entry_already_exists() -> CommandError {
    CommandError::new(
        "ENTRY_ALREADY_EXISTS",
        "The workspace entry already exists.",
    )
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

fn io_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be created.")
}

fn workspace_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace rename conflicts with the source path.",
    )
}

fn rename_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be renamed.")
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn rename_unsupported() -> CommandError {
    CommandError::new(
        "IO_FAILED",
        "Atomic workspace rename is not supported on this platform.",
    )
}

#[cfg(test)]
mod tests;
