use std::collections::HashMap;
use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
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
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) mod new_file_publisher;
pub mod picker;
pub(crate) mod publish_frame;
pub(crate) mod reader;
pub mod service;
#[cfg(target_os = "macos")]
pub(crate) mod trash;
pub(crate) mod version;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) mod versioned_writer;
pub(crate) mod watcher;
pub(crate) mod write_frame;
pub(crate) mod writer;

use dto::{WorkspaceRootSnapshot, WorkspaceSnapshot};

pub(crate) const MAX_WORKSPACE_ROOTS: usize = 256;
const MAX_OPEN_FILE_SELECTIONS: usize = 64;

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RootId(Uuid);

impl RootId {
    fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }

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
/// WebView; it keys Rust-internal root-set-scoped state such as workspace
/// trust and debug confirmation. Hot-exit now reuses this hash construction
/// in singleton form for an independently stable identity per root.
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
    /// Canonical ambient pathname retained strictly for platform APIs that
    /// cannot operate on directory handles (currently macOS system Trash).
    /// It never crosses IPC and ordinary workspace I/O must keep using
    /// `directory` capability-relative operations.
    canonical_path: PathBuf,
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

    #[cfg(target_os = "macos")]
    pub(super) fn platform_root_path(&self) -> &Path {
        &self.canonical_path
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
        prepare_watcher: F,
    ) -> Result<RootId, CommandError>
    where
        F: FnMut(RootId, &Path, WorkspaceRootLease) -> Result<(), CommandError>,
    {
        let paths = [ambient_path.to_path_buf()];
        self.replace_roots_atomically_with(&paths, prepare_watcher)?
            .into_iter()
            .next()
            .ok_or_else(workspace_conflict)
    }

    /// Opens and validates the complete ordered root set before changing any
    /// live capability. Duplicate directory identities collapse to their first
    /// occurrence; roots already held by this scope retain their ids and
    /// capabilities, while every omitted root is revoked in the same commit.
    pub(crate) fn replace_roots_atomically_with<F>(
        &mut self,
        ambient_paths: &[PathBuf],
        mut prepare_watcher: F,
    ) -> Result<Vec<RootId>, CommandError>
    where
        F: FnMut(RootId, &Path, WorkspaceRootLease) -> Result<(), CommandError>,
    {
        if ambient_paths.is_empty() || ambient_paths.len() > MAX_WORKSPACE_ROOTS {
            return Err(workspace_root_limit_exceeded());
        }

        let candidates = ambient_paths
            .iter()
            .map(|ambient_path| prepare_workspace_root(ambient_path))
            .collect::<Result<Vec<_>, CommandError>>()?;
        let mut unique_candidates: Vec<PreparedWorkspaceRoot> = Vec::new();
        for candidate in candidates {
            if unique_candidates
                .iter()
                .any(|existing| existing.identity == candidate.identity)
            {
                continue;
            }
            unique_candidates.push(candidate);
        }

        let mut selections = Vec::with_capacity(unique_candidates.len());
        for candidate in unique_candidates {
            let existing_id = self
                .roots
                .iter()
                .find(|(_, root)| root.identity == candidate.identity)
                .map(|(root_id, _)| *root_id);
            match existing_id {
                Some(root_id) => selections.push((root_id, None)),
                None => selections.push((RootId::new(), Some(candidate))),
            }
        }
        let selected_ids = selections
            .iter()
            .map(|(root_id, _)| *root_id)
            .collect::<Vec<_>>();
        if self.order == selected_ids && self.roots.len() == selected_ids.len() {
            return Ok(selected_ids);
        }

        let next_revision = next_revision(self.revision)?;
        for (root_id, candidate) in &selections {
            if let Some(candidate) = candidate {
                let lease = candidate.lease(*root_id)?;
                prepare_watcher(*root_id, &candidate.watch_path, lease)?;
            }
        }

        let mut previous_roots = std::mem::take(&mut self.roots);
        let mut next_roots = HashMap::with_capacity(selections.len());
        for (root_id, candidate) in selections {
            let root = match candidate {
                Some(candidate) => WorkspaceRoot {
                    directory: candidate.directory,
                    display_name: candidate.display_name,
                    identity: candidate.identity,
                    canonical_path: candidate.watch_path,
                },
                None => previous_roots
                    .remove(&root_id)
                    .ok_or_else(workspace_conflict)?,
            };
            next_roots.insert(root_id, root);
        }
        self.roots = next_roots;
        self.order = selected_ids.clone();
        self.revision = next_revision;
        Ok(selected_ids)
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

    /// The canonicalized ambient path backing each currently authorized
    /// root, in the same authorization order [`Self::root_ids`] reports
    /// (index 0 is "the first root", the fallback a caller that needs *some*
    /// default directory but was not given an explicit one can use).
    ///
    /// Used only by native domains that need to reason about "which real
    /// directories are currently open" for a purpose other than file
    /// capability I/O — currently: the terminal domain's `cwd` spawn-
    /// parameter validation (see `terminal::service::resolve_cwd`), which
    /// the F070 research doc's decision 2 documents as an intentionally
    /// different security boundary from capability-relative file access
    /// (spawning a subprocess with a given working directory is ambient
    /// process authority, not capability-relative I/O, so validating it via
    /// `canonicalize` + `starts_with` against this list is the sanctioned
    /// check here — never a template for bypassing the capability-relative
    /// rule elsewhere). Never serialized to the WebView.
    pub(crate) fn root_canonical_paths(&self) -> Vec<(RootId, PathBuf)> {
        self.order
            .iter()
            .filter_map(|root_id| {
                self.roots
                    .get(root_id)
                    .map(|root| (*root_id, root.canonical_path.clone()))
            })
            .collect()
    }

    pub(crate) fn history_roots(&self) -> Vec<(PathBuf, String)> {
        self.order
            .iter()
            .filter_map(|root_id| {
                self.roots
                    .get(root_id)
                    .map(|root| (root.canonical_path.clone(), root.display_name.clone()))
            })
            .collect()
    }

    /// Stable Rust-only identity for each independently authorized root.
    ///
    /// This deliberately reuses the ambiguity-free singleton form of
    /// [`stable_roots_identity`]: no canonical path or digest crosses IPC,
    /// while reopening the same directory with a fresh random [`RootId`]
    /// still reaches the same product-owned storage partition. Keeping the
    /// identity per root (rather than per current root set) is what lets
    /// hot-exit content survive add/remove/reorder topology changes without
    /// ever guessing which current root owns a backup.
    pub(crate) fn root_storage_identities(&self) -> Vec<(RootId, WorkspaceRootsIdentity)> {
        self.order
            .iter()
            .filter_map(|root_id| {
                let root = self.roots.get(root_id)?;
                let identity = stable_roots_identity(std::slice::from_ref(&root.canonical_path))?;
                Some((*root_id, WorkspaceRootsIdentity(identity)))
            })
            .collect()
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

    pub(crate) fn clear_roots(&mut self) -> Result<bool, CommandError> {
        if self.roots.is_empty() {
            return Ok(false);
        }
        self.revision = next_revision(self.revision)?;
        self.roots.clear();
        self.order.clear();
        Ok(true)
    }

    pub(crate) fn lease(&self, root_id: RootId) -> Result<WorkspaceRootLease, CommandError> {
        let root = self.roots.get(&root_id).ok_or_else(root_not_authorized)?;
        let directory = root
            .directory
            .try_clone()
            .map_err(|_| root_capability_clone_failed())?;
        Ok(WorkspaceRootLease {
            root_id,
            directory,
            canonical_path: root.canonical_path.clone(),
        })
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

pub(crate) struct PreparedOpenFileSelection {
    pub(crate) parent: PathBuf,
    pub(crate) relative_path: RelativePath,
}

pub(crate) struct PreparedSaveFileSelection {
    pub(crate) parent: PathBuf,
    pub(crate) relative_path: RelativePath,
}

impl PreparedWorkspaceRoot {
    fn lease(&self, root_id: RootId) -> Result<WorkspaceRootLease, CommandError> {
        let directory = self
            .directory
            .try_clone()
            .map_err(|_| root_capability_clone_failed())?;
        Ok(WorkspaceRootLease {
            root_id,
            directory,
            canonical_path: self.watch_path.clone(),
        })
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

pub(crate) fn prepare_open_file_selections(
    paths: Vec<PathBuf>,
) -> Result<Vec<PreparedOpenFileSelection>, CommandError> {
    if paths.is_empty() || paths.len() > MAX_OPEN_FILE_SELECTIONS {
        return Err(workspace_open_file_selection_invalid());
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut prepared = Vec::with_capacity(paths.len());
    for path in paths {
        if !path.is_absolute() {
            return Err(workspace_file_unavailable());
        }
        let canonical_file =
            std::fs::canonicalize(&path).map_err(|_| workspace_file_unavailable())?;
        if !seen.insert(canonical_file.clone()) {
            continue;
        }
        let parent = canonical_file
            .parent()
            .filter(|parent| parent.is_absolute())
            .ok_or_else(workspace_file_unavailable)?;
        let file_name = canonical_file
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .ok_or_else(workspace_file_unavailable)?;
        let relative_path =
            RelativePath::parse_wire(file_name).map_err(|_| workspace_file_unavailable())?;
        let candidate = prepare_workspace_root(parent)?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let file = candidate
            .directory
            .open_with(relative_path.as_path(), &options)
            .map_err(|_| workspace_file_unavailable())?;
        if !file
            .metadata()
            .map_err(|_| workspace_file_unavailable())?
            .is_file()
        {
            return Err(workspace_file_unavailable());
        }
        prepared.push(PreparedOpenFileSelection {
            parent: candidate.watch_path,
            relative_path,
        });
    }
    if prepared.is_empty() {
        return Err(workspace_open_file_selection_invalid());
    }
    Ok(prepared)
}

pub(crate) fn prepare_save_file_selection(
    path: PathBuf,
) -> Result<PreparedSaveFileSelection, CommandError> {
    if !path.is_absolute() {
        return Err(workspace_save_target_unavailable());
    }
    let parent = path
        .parent()
        .filter(|parent| parent.is_absolute())
        .ok_or_else(workspace_save_target_unavailable)?;
    let file_name = path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .ok_or_else(workspace_save_target_unavailable)?;
    let relative_path =
        RelativePath::parse_wire(file_name).map_err(|_| workspace_save_target_unavailable())?;
    if relative_path.is_root() || relative_path.as_wire().contains('/') {
        return Err(workspace_save_target_unavailable());
    }
    let candidate =
        prepare_workspace_root(parent).map_err(|_| workspace_save_target_unavailable())?;
    Ok(PreparedSaveFileSelection {
        parent: candidate.watch_path,
        relative_path,
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

fn workspace_open_file_selection_invalid() -> CommandError {
    CommandError::new(
        "WORKSPACE_OPEN_FILE_SELECTION_INVALID",
        "The selected file list is invalid.",
    )
}

fn workspace_file_unavailable() -> CommandError {
    CommandError::new(
        "WORKSPACE_FILE_UNAVAILABLE",
        "The selected file is unavailable.",
    )
}

fn workspace_save_target_unavailable() -> CommandError {
    CommandError::new(
        "WORKSPACE_SAVE_TARGET_UNAVAILABLE",
        "The selected save target is unavailable.",
    )
}

#[cfg(test)]
mod tests;
