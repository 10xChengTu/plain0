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
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::{RootId, WorkspaceScope};
    use crate::path_policy::RelativePath;

    #[test]
    fn isolates_multiple_roots_and_reuses_only_the_same_directory() {
        let temp = TempDir::new().expect("temporary directory");
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("shared.txt"), b"first").unwrap();
        fs::write(second.join("shared.txt"), b"second").unwrap();

        let mut scope = WorkspaceScope::new();
        let first_id = scope.authorize_root(&first).unwrap();
        let first_again = scope.authorize_root(&first).unwrap();
        let second_id = scope.authorize_root(&second).unwrap();
        let first_after_second = scope.authorize_root(&first).unwrap();
        assert_eq!(first_id, first_again);
        assert_eq!(first_id, first_after_second);
        assert_ne!(first_id, second_id);
        let snapshot = scope.snapshot();
        assert_eq!(snapshot.roots().len(), 2);
        assert_eq!(snapshot.roots()[0].root_id(), first_id);
        assert_eq!(snapshot.roots()[1].root_id(), second_id);

        let path = RelativePath::parse_wire("shared.txt").unwrap();
        assert_eq!(read_resolved(&scope, first_id, &path), b"first");
        assert_eq!(read_resolved(&scope, second_id, &path), b"second");

        scope.remove(first_id).unwrap();
        let snapshot = scope.snapshot();
        assert_eq!(snapshot.roots().len(), 1);
        assert_eq!(snapshot.roots()[0].root_id(), second_id);
    }

    #[test]
    fn rejects_unknown_and_revoked_roots() {
        let temp = TempDir::new().unwrap();
        let mut scope = WorkspaceScope::new();
        let authorized = scope.authorize_root(temp.path()).unwrap();
        let unknown: RootId =
            serde_json::from_str("\"00000000-0000-4000-8000-000000000000\"").unwrap();
        let root = RelativePath::parse_wire("").unwrap();

        assert_eq!(
            scope.resolve(unknown, &root).unwrap_err().code(),
            "ROOT_NOT_AUTHORIZED"
        );
        scope.remove(authorized).unwrap();
        assert_eq!(
            scope.resolve(authorized, &root).unwrap_err().code(),
            "ROOT_NOT_AUTHORIZED"
        );
        assert_eq!(
            scope.remove(authorized).unwrap_err().code(),
            "ROOT_NOT_AUTHORIZED"
        );
    }

    #[cfg(unix)]
    #[test]
    fn held_directory_handle_does_not_jump_when_the_ambient_root_is_replaced() {
        let temp = TempDir::new().unwrap();
        let selected = temp.path().join("selected");
        let original = temp.path().join("original-moved");
        fs::create_dir(&selected).unwrap();
        fs::write(selected.join("identity.txt"), b"original").unwrap();

        let mut scope = WorkspaceScope::new();
        let root_id = scope.authorize_root(&selected).unwrap();
        fs::rename(&selected, &original).unwrap();
        fs::create_dir(&selected).unwrap();
        fs::write(selected.join("identity.txt"), b"replacement").unwrap();

        let path = RelativePath::parse_wire("identity.txt").unwrap();
        assert_eq!(read_resolved(&scope, root_id, &path), b"original");
        let replacement_id = scope.authorize_root(&selected).unwrap();
        assert_ne!(root_id, replacement_id);
        assert_eq!(read_resolved(&scope, replacement_id, &path), b"replacement");
    }

    #[cfg(windows)]
    #[test]
    fn held_directory_handle_prevents_ambient_root_replacement() {
        let temp = TempDir::new().unwrap();
        let selected = temp.path().join("selected");
        let replacement_target = temp.path().join("replacement-target");
        fs::create_dir(&selected).unwrap();
        fs::write(selected.join("identity.txt"), b"original").unwrap();

        let mut scope = WorkspaceScope::new();
        let root_id = scope.authorize_root(&selected).unwrap();
        assert!(fs::rename(&selected, &replacement_target).is_err());

        let path = RelativePath::parse_wire("identity.txt").unwrap();
        assert_eq!(read_resolved(&scope, root_id, &path), b"original");
    }

    #[cfg(unix)]
    #[test]
    fn follows_internal_symlinks_but_rejects_external_symlinks() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let root = temp.path().join("root");
        let outside = temp.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(root.join("inside.txt"), b"inside").unwrap();
        fs::write(outside.join("secret.txt"), b"secret").unwrap();
        symlink("inside.txt", root.join("inside-link")).unwrap();
        symlink(outside.join("secret.txt"), root.join("outside-link")).unwrap();

        let mut scope = WorkspaceScope::new();
        let root_id = scope.authorize_root(&root).unwrap();
        let internal = RelativePath::parse_wire("inside-link").unwrap();
        assert_eq!(read_resolved(&scope, root_id, &internal), b"inside");

        let external = RelativePath::parse_wire("outside-link").unwrap();
        let error = scope.resolve(root_id, &external).unwrap_err();
        assert_eq!(error.code(), "PATH_OUTSIDE_ROOT");
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains(temp.path().to_str().unwrap()));
    }

    #[test]
    fn authorization_and_resolution_errors_do_not_expose_ambient_paths() {
        let temp = TempDir::new().unwrap();
        let secret = temp.path().join("private-user-name").join("missing-root");
        let mut scope = WorkspaceScope::new();
        let error = scope.authorize_root(&secret).unwrap_err();
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(error.code(), "ROOT_UNAVAILABLE");
        assert!(!json.contains("private-user-name"));
        assert!(!json.contains(temp.path().to_str().unwrap()));
        assert!(!json.contains("No such file"));
    }

    #[cfg(unix)]
    #[test]
    fn distinguishes_os_permission_errors_from_capability_escape_errors() {
        let os_denied = super::map_resolve_error(std::io::Error::from_raw_os_error(13));
        assert_eq!(os_denied.code(), "PERMISSION_DENIED");

        let capability_denied = super::map_resolve_error(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "capability escape",
        ));
        assert_eq!(capability_denied.code(), "PATH_OUTSIDE_ROOT");
    }

    fn read_resolved(scope: &WorkspaceScope, root_id: RootId, path: &RelativePath) -> Vec<u8> {
        let resolved = scope.resolve(root_id, path).expect("path resolves");
        assert_eq!(resolved.root_id(), root_id);
        resolved
            .directory()
            .read(resolved.relative_path())
            .expect("resolved entry reads")
    }
}
