use std::collections::HashMap;
use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

pub(crate) mod commands;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) mod delete;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) mod directory_copy;
pub mod dto;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) mod move_entry;
pub mod picker;
pub(crate) mod reader;
pub mod service;
pub(crate) mod version;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) mod versioned_writer;
pub(crate) mod watcher;
pub(crate) mod write_frame;
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

    #[cfg(unix)]
    pub(crate) const fn as_bytes(&self) -> &[u8; 16] {
        self.0.as_bytes()
    }

    pub(crate) fn parse_v4_wire(wire: &str) -> Result<Self, CommandError> {
        let value = Uuid::parse_str(wire).map_err(|_| invalid_root_id())?;
        if value.hyphenated().to_string() != wire
            || value.get_version() != Some(uuid::Version::Random)
            || value.get_variant() != uuid::Variant::RFC4122
        {
            return Err(invalid_root_id());
        }
        Ok(Self(value))
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

/// A stable identity derived from the sorted canonical filesystem paths of
/// every currently authorized workspace root.
///
/// Unlike [`WorkspaceId`] (a random identifier minted once per window/session
/// and never persisted), this identity is a pure function of *which
/// directories are open*: reopening the exact same set of roots — in any
/// window, in any process, after a restart — always reproduces the same
/// value, and changing the root set (add/remove/replace) always changes it.
/// It carries no `Serialize` implementation and is never sent to the
/// WebView; it exists purely to key Rust-internal, root-set-scoped storage
/// (currently: the hot-exit backup directory).
#[derive(Clone, Eq, PartialEq)]
pub(crate) struct WorkspaceRootsIdentity(String);

impl WorkspaceRootsIdentity {
    /// The identity rendered as a lowercase hex string, safe to use verbatim
    /// as a single filesystem directory name (`[0-9a-f]{64}`).
    pub(crate) fn as_dir_name(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for WorkspaceRootsIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("WorkspaceRootsIdentity")
            .field(&self.0)
            .finish()
    }
}

/// Domain separator for [`stable_roots_identity`], so this hash can never
/// collide with a digest computed for an unrelated purpose even if the input
/// framing were ever reused.
const ROOTS_IDENTITY_DOMAIN: &[u8] = b"plain.workspace.roots-identity.v1\0";

/// Hashes a set of canonical root paths into a single stable, order- and
/// ambiguity-free digest: `None` for an empty set (there is no stable
/// identity for zero roots), otherwise the lowercase hex SHA-256 of the
/// domain-separated, length-prefixed, lexicographically sorted paths.
///
/// Sorting first makes the result independent of authorization order (the
/// same set of roots always hashes the same way regardless of which order
/// they were opened in). Prefixing every path with its own byte length
/// before hashing — rather than joining paths with a separator character —
/// means two different root sets can never be confused by where one path
/// ends and the next begins: `["/a/b", "/c"]` and `["/a", "/b/c"]` hash
/// differently even though their naive concatenations are identical.
pub(crate) fn stable_roots_identity(canonical_paths: &[PathBuf]) -> Option<String> {
    if canonical_paths.is_empty() {
        return None;
    }
    let mut sorted: Vec<&Path> = canonical_paths.iter().map(PathBuf::as_path).collect();
    sorted.sort();

    let mut hasher = Sha256::new();
    hasher.update(ROOTS_IDENTITY_DOMAIN);
    let path_count = u32::try_from(sorted.len()).unwrap_or(u32::MAX);
    hasher.update(path_count.to_be_bytes());
    for path in sorted {
        let bytes = path_bytes(path);
        let length = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        hasher.update(length.to_be_bytes());
        hasher.update(&bytes);
    }
    Some(hex_encode(hasher.finalize().into()))
}

/// A lossless byte representation of a path, used only as hash input (never
/// written to disk or a filename): raw OS bytes on Unix, raw UTF-16 code
/// units (as little-endian byte pairs) on Windows, so no two distinct
/// `OsString` values can ever collide.
#[cfg(unix)]
fn path_bytes(path: &Path) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    path.as_os_str().as_bytes().to_vec()
}

#[cfg(windows)]
fn path_bytes(path: &Path) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect()
}

fn hex_encode(digest: [u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(64);
    for byte in digest {
        token.push(char::from(HEX[usize::from(byte >> 4)]));
        token.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    token
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
        Self::parse_v4_wire(&wire).map_err(|_| D::Error::custom("invalid root id"))
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

    pub(crate) const fn revision(&self) -> u64 {
        self.revision
    }

    /// Opens and validates every selected path before changing the scope.
    #[cfg(test)]
    pub(crate) fn authorize_roots_atomically(
        &mut self,
        ambient_paths: &[PathBuf],
    ) -> Result<Vec<RootId>, CommandError> {
        self.authorize_roots_atomically_with(ambient_paths, |_, _, _| Ok(()))
    }

    pub(crate) fn authorize_roots_atomically_with<F>(
        &mut self,
        ambient_paths: &[PathBuf],
        mut prepare_watcher: F,
    ) -> Result<Vec<RootId>, CommandError>
    where
        F: FnMut(RootId, &Path, WorkspaceRootLease) -> Result<(), CommandError>,
    {
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
        for (root_id, candidate) in &additions {
            let lease = candidate.lease(*root_id)?;
            prepare_watcher(*root_id, &candidate.watch_path, lease)?;
        }
        for (root_id, candidate) in additions {
            self.roots.insert(
                root_id,
                WorkspaceRoot {
                    directory: candidate.directory,
                    display_name: candidate.display_name,
                    identity: candidate.identity,
                    canonical_path: candidate.watch_path,
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
    #[cfg(test)]
    pub(crate) fn replace_root_atomically(
        &mut self,
        ambient_path: &Path,
    ) -> Result<RootId, CommandError> {
        self.replace_root_atomically_with(ambient_path, |_, _, _| Ok(()))
    }

    pub(crate) fn replace_root_atomically_with<F>(
        &mut self,
        ambient_path: &Path,
        mut prepare_watcher: F,
    ) -> Result<RootId, CommandError>
    where
        F: FnMut(RootId, &Path, WorkspaceRootLease) -> Result<(), CommandError>,
    {
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
        let lease = candidate.lease(root_id)?;
        prepare_watcher(root_id, &candidate.watch_path, lease)?;
        self.roots.clear();
        self.order.clear();
        self.roots.insert(
            root_id,
            WorkspaceRoot {
                directory: candidate.directory,
                display_name: candidate.display_name,
                identity: candidate.identity,
                canonical_path: candidate.watch_path,
            },
        );
        self.order.push(root_id);
        self.revision = next_revision;
        Ok(root_id)
    }

    #[cfg(test)]
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

    pub(crate) const fn workspace_id(&self) -> WorkspaceId {
        self.workspace_id
    }

    /// The stable identity of the currently authorized root set (see
    /// [`WorkspaceRootsIdentity`]); `None` when zero roots are authorized.
    pub(crate) fn stable_identity(&self) -> Option<WorkspaceRootsIdentity> {
        let canonical_paths: Vec<PathBuf> = self
            .roots
            .values()
            .map(|root| root.canonical_path.clone())
            .collect();
        stable_roots_identity(&canonical_paths).map(WorkspaceRootsIdentity)
    }

    pub(crate) fn root_ids(&self) -> Vec<RootId> {
        self.order.clone()
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
    /// The canonicalized ambient path this root was authorized from. Used
    /// only to derive [`WorkspaceRootsIdentity`]; never exposed outside this
    /// module (in particular, never serialized to the WebView).
    canonical_path: PathBuf,
}

struct PreparedWorkspaceRoot {
    directory: Dir,
    display_name: String,
    identity: DirectoryIdentity,
    watch_path: PathBuf,
}

impl PreparedWorkspaceRoot {
    fn lease(&self, root_id: RootId) -> Result<WorkspaceRootLease, CommandError> {
        let directory = self
            .directory
            .try_clone()
            .map_err(|_| root_capability_clone_failed())?;
        Ok(WorkspaceRootLease { root_id, directory })
    }
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
fn directory_identity(directory: &Dir, canonical_path: &Path) -> io::Result<DirectoryIdentity> {
    use std::os::windows::fs::MetadataExt;

    let metadata = directory.try_clone()?.into_std_file().metadata()?;
    match (metadata.volume_serial_number(), metadata.file_index()) {
        (Some(volume), Some(file_index)) => Ok(DirectoryIdentity::Windows { volume, file_index }),
        _ => Ok(DirectoryIdentity::Canonical(canonical_path.to_path_buf())),
    }
}

#[cfg(not(any(unix, windows)))]
fn directory_identity(_directory: &Dir, canonical_path: &Path) -> io::Result<DirectoryIdentity> {
    Ok(DirectoryIdentity::Canonical(canonical_path.to_path_buf()))
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
    let watch_path = std::fs::canonicalize(ambient_path).map_err(map_root_authorization_error)?;
    let directory = Dir::open_ambient_dir(&watch_path, ambient_authority())
        .map_err(map_root_authorization_error)?;
    let identity =
        directory_identity(&directory, &watch_path).map_err(map_root_authorization_error)?;
    Ok(PreparedWorkspaceRoot {
        directory,
        display_name,
        identity,
        watch_path,
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

fn invalid_root_id() -> CommandError {
    CommandError::new(
        "INVALID_WORKSPACE_WRITE_REQUEST",
        "The workspace write request is invalid.",
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
