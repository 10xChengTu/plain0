use std::io;

use cap_std::fs::OpenOptions;

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

fn ensure_entry_path(relative_path: &RelativePath) -> Result<(), CommandError> {
    if relative_path.is_root() {
        Err(entry_type_mismatch())
    } else {
        Ok(())
    }
}

fn map_workspace_mutation_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => entry_not_found(),
        io::ErrorKind::AlreadyExists => entry_already_exists(),
        io::ErrorKind::NotADirectory | io::ErrorKind::IsADirectory => entry_type_mismatch(),
        io::ErrorKind::PermissionDenied if error.raw_os_error().is_none() => path_outside_root(),
        io::ErrorKind::PermissionDenied => permission_denied(),
        io::ErrorKind::InvalidInput if error.raw_os_error().is_none() => path_outside_root(),
        _ => io_failed(),
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

#[cfg(test)]
mod tests;
