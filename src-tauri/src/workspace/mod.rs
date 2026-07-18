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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootSnapshot {
    root_id: RootId,
}

impl WorkspaceRootSnapshot {
    pub const fn root_id(&self) -> RootId {
        self.root_id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct WorkspaceSnapshot {
    roots: Vec<WorkspaceRootSnapshot>,
}

impl WorkspaceSnapshot {
    pub fn roots(&self) -> &[WorkspaceRootSnapshot] {
        &self.roots
    }
}

pub struct ResolvedWorkspacePath<'scope> {
    root_id: RootId,
    directory: &'scope Dir,
    relative_path: PathBuf,
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

#[derive(Default)]
pub struct WorkspaceScope {
    roots: HashMap<RootId, WorkspaceRoot>,
    order: Vec<RootId>,
}

impl WorkspaceScope {
    pub fn new() -> Self {
        Self::default()
    }

    /// This ambient path entry point is intentionally crate-private. A future
    /// native picker adapter is the only layer allowed to call it.
    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "the native picker adapter lands in the next vertical slice"
        )
    )]
    pub(crate) fn authorize_root(&mut self, ambient_path: &Path) -> Result<RootId, CommandError> {
        let directory = Dir::open_ambient_dir(ambient_path, ambient_authority())
            .map_err(map_root_authorization_error)?;
        let identity =
            directory_identity(&directory, ambient_path).map_err(map_root_authorization_error)?;

        if let Some((root_id, _)) = self
            .roots
            .iter()
            .find(|(_, root)| root.identity == identity)
        {
            return Ok(*root_id);
        }

        let root_id = RootId::new();
        self.roots.insert(
            root_id,
            WorkspaceRoot {
                directory,
                identity,
            },
        );
        self.order.push(root_id);
        Ok(root_id)
    }

    pub fn snapshot(&self) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            roots: self
                .order
                .iter()
                .copied()
                .map(|root_id| WorkspaceRootSnapshot { root_id })
                .collect(),
        }
    }

    pub fn remove(&mut self, root_id: RootId) -> Result<(), CommandError> {
        if self.roots.remove(&root_id).is_none() {
            return Err(root_not_authorized());
        }
        self.order.retain(|candidate| *candidate != root_id);
        Ok(())
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

fn map_root_authorization_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::PermissionDenied => CommandError::new(
            "PERMISSION_DENIED",
            "The selected workspace root cannot be opened.",
        ),
        _ => CommandError::new(
            "ROOT_UNAVAILABLE",
            "The selected workspace root is unavailable.",
        ),
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

fn path_outside_root() -> CommandError {
    CommandError::new(
        "PATH_OUTSIDE_ROOT",
        "The workspace path is outside the authorized root.",
    )
}

#[cfg(test)]
mod tests;
