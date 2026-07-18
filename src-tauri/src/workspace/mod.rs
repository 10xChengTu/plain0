use std::collections::HashMap;
use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

pub(crate) mod commands;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) mod directory_copy;
pub mod dto;
pub mod picker;
pub(crate) mod reader;
pub mod service;
pub(crate) mod writer;

use dto::{WorkspaceRootSnapshot, WorkspaceSnapshot};

const MAX_WORKSPACE_ROOTS: usize = 256;

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RootId(Uuid);

impl RootId {
    fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct WorkspaceId(Uuid);

impl WorkspaceId {
    fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

impl fmt::Debug for WorkspaceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("WorkspaceId")
            .field(&self.as_wire())
            .finish()
    }
}

impl Serialize for WorkspaceId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl fmt::Debug for RootId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("RootId")
            .field(&self.as_wire())
            .finish()
    }
}

impl fmt::Display for RootId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.0.hyphenated())
    }
}

impl Serialize for RootId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for RootId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        let value = Uuid::parse_str(&wire).map_err(|_| D::Error::custom("invalid root id"))?;
        if value.hyphenated().to_string() != wire {
            return Err(D::Error::custom("invalid root id"));
        }
        Ok(Self(value))
    }
}

pub struct ResolvedWorkspacePath<'scope> {
    root_id: RootId,
    directory: &'scope Dir,
    relative_path: PathBuf,
}

pub(crate) struct WorkspaceRootLease {
    root_id: RootId,
    directory: Dir,
}

impl fmt::Debug for WorkspaceRootLease {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WorkspaceRootLease")
            .field("root_id", &self.root_id)
            .finish_non_exhaustive()
    }
}

impl WorkspaceRootLease {
    pub const fn root_id(&self) -> RootId {
        self.root_id
    }

    pub fn directory(&self) -> &Dir {
        &self.directory
    }
}

impl fmt::Debug for ResolvedWorkspacePath<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ResolvedWorkspacePath")
            .field("root_id", &self.root_id)
            .field("relative_path", &self.relative_path)
            .finish_non_exhaustive()
    }
}

impl ResolvedWorkspacePath<'_> {
    pub const fn root_id(&self) -> RootId {
        self.root_id
    }

    pub fn directory(&self) -> &Dir {
        self.directory
    }

    pub fn relative_path(&self) -> &Path {
        &self.relative_path
    }
}

pub struct WorkspaceScope {
    workspace_id: WorkspaceId,
    revision: u64,
    roots: HashMap<RootId, WorkspaceRoot>,
    order: Vec<RootId>,
}

impl Default for WorkspaceScope {
    fn default() -> Self {
        Self {
            workspace_id: WorkspaceId::new(),
            revision: 0,
            roots: HashMap::new(),
            order: Vec::new(),
        }
    }
}

impl WorkspaceScope {
    pub fn new() -> Self {
        Self::default()
    }

    /// Opens and validates every selected path before changing the scope.
    pub(crate) fn authorize_roots_atomically(
        &mut self,
        ambient_paths: &[PathBuf],
    ) -> Result<Vec<RootId>, CommandError> {
        if ambient_paths.len() > MAX_WORKSPACE_ROOTS {
            return Err(workspace_root_limit_exceeded());
        }

        let prepared = ambient_paths
            .iter()
            .map(|ambient_path| prepare_workspace_root(ambient_path))
            .collect::<Result<Vec<_>, CommandError>>()?;

        let mut additions = Vec::new();
        let mut selected_ids = Vec::with_capacity(prepared.len());
        for candidate in prepared {
            if let Some(root_id) = self
                .roots
                .iter()
                .find(|(_, root)| root.identity == candidate.identity)
                .map(|(root_id, _)| *root_id)
            {
                selected_ids.push(root_id);
                continue;
            }
            if let Some(root_id) = additions
                .iter()
                .find(|(_, root): &&(RootId, PreparedWorkspaceRoot)| {
                    root.identity == candidate.identity
                })
                .map(|(root_id, _)| *root_id)
            {
                selected_ids.push(root_id);
                continue;
            }
            let root_id = RootId::new();
            selected_ids.push(root_id);
            additions.push((root_id, candidate));
        }

        let resulting_root_count = self
            .roots
            .len()
            .checked_add(additions.len())
            .ok_or_else(workspace_root_limit_exceeded)?;
        if resulting_root_count > MAX_WORKSPACE_ROOTS {
            return Err(workspace_root_limit_exceeded());
        }

        if additions.is_empty() {
            return Ok(selected_ids);
        }
        let next_revision = next_revision(self.revision)?;
        for (root_id, candidate) in additions {
            self.roots.insert(
                root_id,
                WorkspaceRoot {
                    directory: candidate.directory,
                    display_name: candidate.display_name,
                    identity: candidate.identity,
                },
            );
            self.order.push(root_id);
        }
        self.revision = next_revision;
        Ok(selected_ids)
    }

    /// Opens and validates the selected path before replacing the scope. An
    /// already-authorized directory keeps its root id, display name and held
    /// capability; every other capability is revoked in the same mutation.
    pub(crate) fn replace_root_atomically(
        &mut self,
        ambient_path: &Path,
    ) -> Result<RootId, CommandError> {
        let candidate = prepare_workspace_root(ambient_path)?;
        if let Some(root_id) = self
            .roots
            .iter()
            .find(|(_, root)| root.identity == candidate.identity)
            .map(|(root_id, _)| *root_id)
        {
            if self.roots.len() == 1 && self.order.as_slice() == [root_id] {
                return Ok(root_id);
            }

            let next_revision = next_revision(self.revision)?;
            self.roots
                .retain(|candidate_id, _| *candidate_id == root_id);
            self.order.clear();
            self.order.push(root_id);
            self.revision = next_revision;
            return Ok(root_id);
        }

        let next_revision = next_revision(self.revision)?;
        let root_id = RootId::new();
        self.roots.clear();
        self.order.clear();
        self.roots.insert(
            root_id,
            WorkspaceRoot {
                directory: candidate.directory,
                display_name: candidate.display_name,
                identity: candidate.identity,
            },
        );
        self.order.push(root_id);
        self.revision = next_revision;
        Ok(root_id)
    }

    #[cfg(test)]
    pub(crate) fn authorize_root(&mut self, ambient_path: &Path) -> Result<RootId, CommandError> {
        self.authorize_roots_atomically(&[ambient_path.to_path_buf()])?
            .into_iter()
            .next()
            .ok_or_else(workspace_conflict)
    }

    pub fn snapshot(&self) -> WorkspaceSnapshot {
        WorkspaceSnapshot::new(
            self.workspace_id,
            self.revision,
            self.order
                .iter()
                .filter_map(|root_id| {
                    self.roots
                        .get(root_id)
                        .map(|root| WorkspaceRootSnapshot::new(*root_id, root.display_name.clone()))
                })
                .collect(),
        )
    }

    pub fn remove(&mut self, root_id: RootId) -> Result<(), CommandError> {
        if !self.roots.contains_key(&root_id) {
            return Err(root_not_authorized());
        }
        let next_revision = next_revision(self.revision)?;
        self.roots.remove(&root_id);
        self.order.retain(|candidate| *candidate != root_id);
        self.revision = next_revision;
        Ok(())
    }

    pub(crate) fn lease(&self, root_id: RootId) -> Result<WorkspaceRootLease, CommandError> {
        let root = self.roots.get(&root_id).ok_or_else(root_not_authorized)?;
        let directory = root
            .directory
            .try_clone()
            .map_err(|_| root_capability_clone_failed())?;
        Ok(WorkspaceRootLease { root_id, directory })
    }

    pub(crate) fn contains_root(&self, root_id: RootId) -> bool {
        self.roots.contains_key(&root_id)
    }

    pub fn resolve<'scope>(
        &'scope self,
        root_id: RootId,
        relative_path: &RelativePath,
    ) -> Result<ResolvedWorkspacePath<'scope>, CommandError> {
        let root = self.roots.get(&root_id).ok_or_else(root_not_authorized)?;
        let resolved = if relative_path.is_root() {
            PathBuf::new()
        } else {
            root.directory
                .canonicalize(relative_path.as_path())
                .map_err(map_resolve_error)?
        };

        if !is_capability_relative(&resolved) {
            return Err(path_outside_root());
        }

        Ok(ResolvedWorkspacePath {
            root_id,
            directory: &root.directory,
            relative_path: resolved,
        })
    }
}

struct WorkspaceRoot {
    directory: Dir,
    display_name: String,
    identity: DirectoryIdentity,
}

struct PreparedWorkspaceRoot {
    directory: Dir,
    display_name: String,
    identity: DirectoryIdentity,
}

#[derive(Eq, PartialEq)]
enum DirectoryIdentity {
    #[cfg(unix)]
    Unix { device: u64, inode: u64 },
    #[cfg(windows)]
    Windows { volume: u32, file_index: u64 },
    #[cfg(not(unix))]
    Canonical(PathBuf),
}

#[cfg(unix)]
fn directory_identity(directory: &Dir, _ambient_path: &Path) -> io::Result<DirectoryIdentity> {
    use cap_std::fs::MetadataExt;

    let metadata = directory.dir_metadata()?;
    Ok(DirectoryIdentity::Unix {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(windows)]
fn directory_identity(directory: &Dir, ambient_path: &Path) -> io::Result<DirectoryIdentity> {
    use std::os::windows::fs::MetadataExt;

    let metadata = directory.try_clone()?.into_std_file().metadata()?;
    match (metadata.volume_serial_number(), metadata.file_index()) {
        (Some(volume), Some(file_index)) => Ok(DirectoryIdentity::Windows { volume, file_index }),
        _ => std::fs::canonicalize(ambient_path).map(DirectoryIdentity::Canonical),
    }
}

#[cfg(not(any(unix, windows)))]
fn directory_identity(_directory: &Dir, ambient_path: &Path) -> io::Result<DirectoryIdentity> {
    std::fs::canonicalize(ambient_path).map(DirectoryIdentity::Canonical)
}

fn is_capability_relative(path: &Path) -> bool {
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn root_display_name(ambient_path: &Path) -> Result<String, CommandError> {
    if ambient_path.as_os_str().is_empty() || !ambient_path.is_absolute() {
        return Err(root_unavailable());
    }
    if ambient_path.to_str().is_none() {
        return Err(path_encoding_unsupported());
    }
    match ambient_path.file_name() {
        Some(name) => name
            .to_str()
            .map(ToOwned::to_owned)
            .ok_or_else(path_encoding_unsupported),
        None => Ok("Workspace Root".to_owned()),
    }
}

fn prepare_workspace_root(ambient_path: &Path) -> Result<PreparedWorkspaceRoot, CommandError> {
    let display_name = root_display_name(ambient_path)?;
    let directory = Dir::open_ambient_dir(ambient_path, ambient_authority())
        .map_err(map_root_authorization_error)?;
    let identity =
        directory_identity(&directory, ambient_path).map_err(map_root_authorization_error)?;
    Ok(PreparedWorkspaceRoot {
        directory,
        display_name,
        identity,
    })
}

fn next_revision(current: u64) -> Result<u64, CommandError> {
    current.checked_add(1).ok_or_else(workspace_conflict)
}

fn map_root_authorization_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::PermissionDenied => CommandError::new(
            "PERMISSION_DENIED",
            "The selected workspace root cannot be opened.",
        ),
        _ => root_unavailable(),
    }
}

fn map_resolve_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => {
            CommandError::new("ENTRY_NOT_FOUND", "The workspace entry does not exist.")
        }
        io::ErrorKind::PermissionDenied if error.raw_os_error().is_none() => path_outside_root(),
        io::ErrorKind::PermissionDenied => CommandError::new(
            "PERMISSION_DENIED",
            "The workspace entry cannot be accessed.",
        ),
        io::ErrorKind::InvalidInput => path_outside_root(),
        _ => CommandError::new("IO_FAILED", "The workspace entry could not be resolved."),
    }
}

fn root_not_authorized() -> CommandError {
    CommandError::new(
        "ROOT_NOT_AUTHORIZED",
        "The workspace root is not authorized.",
    )
}

fn root_capability_clone_failed() -> CommandError {
    CommandError::new(
        "ROOT_UNAVAILABLE",
        "The authorized workspace root is unavailable.",
    )
}

fn root_unavailable() -> CommandError {
    CommandError::new(
        "ROOT_UNAVAILABLE",
        "The selected workspace root is unavailable.",
    )
}

fn path_outside_root() -> CommandError {
    CommandError::new(
        "PATH_OUTSIDE_ROOT",
        "The workspace path is outside the authorized root.",
    )
}

fn path_encoding_unsupported() -> CommandError {
    CommandError::new(
        "PATH_ENCODING_UNSUPPORTED",
        "The selected workspace path cannot be represented safely.",
    )
}

fn workspace_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace changed while the operation was in progress.",
    )
}

fn workspace_root_limit_exceeded() -> CommandError {
    CommandError::new(
        "WORKSPACE_ROOT_LIMIT_EXCEEDED",
        "The workspace root limit has been exceeded.",
    )
}

#[cfg(test)]
mod tests;
