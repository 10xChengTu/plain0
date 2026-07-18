//! Bounded, capability-relative directory copy.
//!
//! The complete source tree is described and revalidated before a detached
//! staging tree is created.  Publication is the only operation that gives the
//! copied tree its requested name.

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

use cap_fs_ext::DirExt;
use cap_std::fs::{Dir, DirBuilder, File, Metadata, OpenOptions, Permissions};
use uuid::Uuid;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::writer::{
    copy_conflict, copy_failed, create_symlink_exact, entry_type_mismatch, file_too_large,
    map_workspace_copy_error, open_copy_parent, open_copy_source, publish_no_replace,
    read_symlink_payload, split_entry_path, stage_cleanup_failed, symlink_too_large,
    transfer_bounded_count, verify_staged_contents, FileIdentity, SourceSnapshot, SymlinkSnapshot,
    MAX_COPY_FILE_BYTES, MAX_COPY_SYMLINK_BYTES,
};
use super::WorkspaceRootLease;

pub(super) const MAX_COPY_TREE_ENTRIES: usize = 10_000;
pub(super) const MAX_COPY_ENTRY_NAME_BYTES: usize = 1_024;
pub(super) const MAX_COPY_TREE_NAME_BYTES: usize = 2 * 1_024 * 1_024;
pub(super) const MAX_COPY_TREE_DEPTH: usize = 256;
pub(super) const MAX_COPY_TREE_SYMLINK_BYTES: u64 = 2 * 1_024 * 1_024;
pub(super) const MAX_COPY_TREE_BYTES: u64 = 256 * 1_024 * 1_024;
const MAX_DIRECTORY_STAGING_ATTEMPTS: usize = 16;
const DIRECTORY_STAGING_PREFIX: &str = ".plain-copy-";

#[derive(Clone, Copy)]
struct DirectoryCopyLimits {
    descendants: usize,
    name_bytes: usize,
    name_aggregate_bytes: usize,
    depth: usize,
    link_bytes: usize,
    link_aggregate_bytes: u64,
    file_bytes: u64,
    file_aggregate_bytes: u64,
}

const DIRECTORY_COPY_LIMITS: DirectoryCopyLimits = DirectoryCopyLimits {
    descendants: MAX_COPY_TREE_ENTRIES,
    name_bytes: MAX_COPY_ENTRY_NAME_BYTES,
    name_aggregate_bytes: MAX_COPY_TREE_NAME_BYTES,
    depth: MAX_COPY_TREE_DEPTH,
    link_bytes: MAX_COPY_SYMLINK_BYTES,
    link_aggregate_bytes: MAX_COPY_TREE_SYMLINK_BYTES,
    file_bytes: MAX_COPY_FILE_BYTES as u64,
    file_aggregate_bytes: MAX_COPY_TREE_BYTES,
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct ManifestBudget {
    descendants: usize,
    name_bytes: usize,
    link_bytes: u64,
    file_bytes: u64,
}

impl ManifestBudget {
    fn reserve_entry_name(
        &mut self,
        name_bytes: usize,
        limits: DirectoryCopyLimits,
    ) -> Result<(), CommandError> {
        self.descendants = checked_limited_usize(self.descendants, 1, limits.descendants)?;
        self.name_bytes =
            checked_limited_usize(self.name_bytes, name_bytes, limits.name_aggregate_bytes)?;
        Ok(())
    }

    fn add_leaf_payload(
        &mut self,
        link_bytes: u64,
        file_bytes: u64,
        limits: DirectoryCopyLimits,
    ) -> Result<(), CommandError> {
        self.link_bytes =
            checked_limited_u64(self.link_bytes, link_bytes, limits.link_aggregate_bytes)?;
        self.file_bytes =
            checked_limited_u64(self.file_bytes, file_bytes, limits.file_aggregate_bytes)?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct DirectorySnapshot {
    identity: FileIdentity,
    mode: u32,
    mtime: i64,
    mtime_nsec: i64,
    ctime: i64,
    ctime_nsec: i64,
}

impl DirectorySnapshot {
    fn from_metadata(metadata: &Metadata) -> Result<Self, CommandError> {
        use cap_std::fs::MetadataExt;

        if !metadata.is_dir() {
            return Err(entry_type_mismatch());
        }
        Ok(Self {
            identity: FileIdentity::from_metadata(metadata),
            mode: metadata.mode(),
            mtime: metadata.mtime(),
            mtime_nsec: metadata.mtime_nsec(),
            ctime: metadata.ctime(),
            ctime_nsec: metadata.ctime_nsec(),
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum ManifestEntryKind {
    Directory(DirectorySnapshot),
    File(SourceSnapshot),
    Symlink {
        snapshot: SymlinkSnapshot,
        payload: Vec<u8>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ManifestEntry {
    relative: PathBuf,
    wire: String,
    depth: usize,
    kind: ManifestEntryKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DirectoryManifest {
    root: DirectorySnapshot,
    entries: Vec<ManifestEntry>,
    budget: ManifestBudget,
}

impl DirectoryManifest {
    fn directory_map(&self) -> Result<BTreeMap<&Path, DirectorySnapshot>, CommandError> {
        let mut directories = BTreeMap::new();
        directories.insert(Path::new(""), self.root);
        for entry in &self.entries {
            if let ManifestEntryKind::Directory(snapshot) = entry.kind {
                if directories
                    .insert(entry.relative.as_path(), snapshot)
                    .is_some()
                {
                    return Err(copy_failed());
                }
            }
        }
        Ok(directories)
    }
}

struct OpenSourceRoot {
    parent: Dir,
    name: PathBuf,
    directory: Dir,
    snapshot: DirectorySnapshot,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReceiptKind {
    Directory { source_mode: u32 },
    File,
    Symlink,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StageReceipt {
    relative: PathBuf,
    identity: FileIdentity,
    kind: ReceiptKind,
    symlink_payload: Option<Vec<u8>>,
}

struct StagedTree<'parent> {
    parent: &'parent Dir,
    name: PathBuf,
    root: Dir,
    receipts: Vec<StageReceipt>,
    receipt_index: BTreeMap<PathBuf, usize>,
    active: bool,
}

trait DirectoryCopyHooks {
    fn after_manifest(&mut self) {}
    fn after_target_parent_open(&mut self) {}
    fn after_stage_created(&mut self, _stage_name: &Path) {}
    fn after_stage_built(&mut self, _stage_name: &Path) {}
    fn after_file_open(&mut self, _relative: &Path) {}
    fn after_stage_file_open(&mut self, _stage_name: &Path, _relative: &Path) {}
    fn after_stage_symlink_read(&mut self, _stage_name: &Path, _relative: &Path) {}
    fn before_publish(&mut self, _stage_name: &Path) {}
}

struct NoopDirectoryCopyHooks;

impl DirectoryCopyHooks for NoopDirectoryCopyHooks {}

pub(crate) fn copy_directory(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
) -> Result<(), CommandError> {
    let mut hooks = NoopDirectoryCopyHooks;
    copy_directory_with_limits_and_hooks(
        source_lease,
        source_path,
        target_lease,
        target_path,
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
}

fn copy_directory_with_limits_and_hooks<H: DirectoryCopyHooks>(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
    limits: DirectoryCopyLimits,
    hooks: &mut H,
) -> Result<(), CommandError> {
    validate_root_basename(source_path, limits.name_bytes)?;
    validate_root_basename(target_path, limits.name_bytes)?;

    let source = open_source_root(source_lease, source_path)?;
    let manifest = build_manifest(&source, source_path, target_path, limits)?;
    hooks.after_manifest();
    ensure_manifest_unchanged(&source, source_path, target_path, limits, &manifest)?;

    let (target_parent_path, target_name) = split_entry_path(target_path)?;
    let target_parent = open_copy_parent(target_lease.directory(), &target_parent_path)?;
    let target_parent_identity = FileIdentity::from_metadata(
        &target_parent
            .dir_metadata()
            .map_err(map_workspace_copy_error)?,
    );
    if source_directory_identities(&manifest).any(|identity| identity == target_parent_identity) {
        return Err(copy_conflict());
    }
    hooks.after_target_parent_open();

    let mut staged = StagedTree::create(&target_parent, &target_name, manifest.root.mode)?;
    hooks.after_stage_created(&staged.name);

    let prepared = (|| {
        staged.build(&source, &manifest, limits, hooks)?;
        hooks.after_stage_built(&staged.name);
        ensure_manifest_unchanged(&source, source_path, target_path, limits, &manifest)?;
        staged.verify(&source, &manifest, hooks)?;
        hooks.before_publish(&staged.name);
        // Hooks model the last same-UID race windows exercised by tests.  Once
        // every hook has run, recheck every detached receipt, file byte and
        // raw link payload without hooks, then rebuild the complete source
        // manifest before chmod or publication. Directory chmod only changes
        // stage metadata whose receipts are identity-only; it performs no
        // source-side operation.
        let mut final_verification = NoopDirectoryCopyHooks;
        staged.verify(&source, &manifest, &mut final_verification)?;
        ensure_manifest_unchanged(&source, source_path, target_path, limits, &manifest)?;
        staged.apply_directory_modes()?;
        staged.ensure_root_identity()?;
        Ok(())
    })();

    if let Err(error) = prepared {
        return staged.fail_with_cleanup(error);
    }
    if let Err(error) = staged.publish(&target_name) {
        return staged.fail_with_cleanup(error);
    }
    Ok(())
}

fn open_source_root(
    lease: &WorkspaceRootLease,
    source_path: &RelativePath,
) -> Result<OpenSourceRoot, CommandError> {
    let (parent_path, name) = split_entry_path(source_path)?;
    let parent = open_copy_parent(lease.directory(), &parent_path)?;
    let pathname_snapshot = DirectorySnapshot::from_metadata(
        &parent
            .symlink_metadata(&name)
            .map_err(map_workspace_copy_error)?,
    )?;
    let directory = parent
        .open_dir_nofollow(&name)
        .map_err(map_workspace_copy_error)?;
    let handle_snapshot = DirectorySnapshot::from_metadata(
        &directory.dir_metadata().map_err(map_workspace_copy_error)?,
    )?;
    if pathname_snapshot != handle_snapshot {
        return Err(copy_conflict());
    }
    Ok(OpenSourceRoot {
        parent,
        name,
        directory,
        snapshot: handle_snapshot,
    })
}

fn build_manifest(
    source: &OpenSourceRoot,
    source_path: &RelativePath,
    target_path: &RelativePath,
    limits: DirectoryCopyLimits,
) -> Result<DirectoryManifest, CommandError> {
    ensure_source_root_named(source)?;
    let mut entries = Vec::new();
    let mut budget = ManifestBudget::default();
    scan_directory(
        &source.directory,
        source_path,
        target_path,
        limits,
        &mut budget,
        &mut entries,
    )?;
    ensure_source_root_named(source)?;
    Ok(DirectoryManifest {
        root: source.snapshot,
        entries,
        budget,
    })
}

struct ScanFrame {
    directory: Dir,
    relative: PathBuf,
    wire: String,
    depth: usize,
    names: Vec<String>,
    next_name: usize,
}

fn scan_directory(
    directory: &Dir,
    source_path: &RelativePath,
    target_path: &RelativePath,
    limits: DirectoryCopyLimits,
    budget: &mut ManifestBudget,
    output: &mut Vec<ManifestEntry>,
) -> Result<(), CommandError> {
    let root = directory.try_clone().map_err(map_workspace_copy_error)?;
    let root_names = collect_bounded_names(&root, limits, budget)?;
    let mut frames = vec![ScanFrame {
        directory: root,
        relative: PathBuf::new(),
        wire: String::new(),
        depth: 0,
        names: root_names,
        next_name: 0,
    }];

    while let Some(frame) = frames.last_mut() {
        if frame.next_name == frame.names.len() {
            frames.pop();
            continue;
        }
        let name = frame.names[frame.next_name].clone();
        frame.next_name = frame
            .next_name
            .checked_add(1)
            .ok_or_else(directory_too_large)?;
        let depth = frame.depth.checked_add(1).ok_or_else(directory_too_large)?;
        if depth > limits.depth {
            return Err(directory_too_large());
        }
        let child_wire = if frame.wire.is_empty() {
            name.clone()
        } else {
            format!("{}/{name}", frame.wire)
        };
        validate_descendant_wire(source_path, target_path, &child_wire)?;
        let child_relative = frame.relative.join(&name);
        let metadata = frame
            .directory
            .symlink_metadata(Path::new(&name))
            .map_err(map_workspace_copy_error)?;

        let mut child_directory = None;
        let kind = if metadata.is_dir() {
            let pathname = DirectorySnapshot::from_metadata(&metadata)?;
            let child = frame
                .directory
                .open_dir_nofollow(Path::new(&name))
                .map_err(map_workspace_copy_error)?;
            let handle = DirectorySnapshot::from_metadata(
                &child.dir_metadata().map_err(map_workspace_copy_error)?,
            )?;
            if pathname != handle {
                return Err(copy_conflict());
            }
            child_directory = Some(child);
            ManifestEntryKind::Directory(handle)
        } else if metadata.is_file() {
            let snapshot = SourceSnapshot::from_metadata(&metadata)?;
            if snapshot.len > limits.file_bytes {
                return Err(file_too_large());
            }
            ManifestEntryKind::File(snapshot)
        } else if metadata.file_type().is_symlink() {
            let snapshot = SymlinkSnapshot::from_metadata(&metadata)?;
            if snapshot.len > limits.link_bytes as u64 {
                return Err(symlink_too_large());
            }
            let payload =
                read_symlink_payload(&frame.directory, Path::new(&name), |_| copy_failed())?;
            if payload.len() > limits.link_bytes {
                return Err(symlink_too_large());
            }
            let after = SymlinkSnapshot::from_metadata(
                &frame
                    .directory
                    .symlink_metadata(Path::new(&name))
                    .map_err(map_workspace_copy_error)?,
            )?;
            if snapshot != after {
                return Err(copy_conflict());
            }
            ManifestEntryKind::Symlink { snapshot, payload }
        } else {
            return Err(entry_type_mismatch());
        };

        let (link_bytes, file_bytes) = match &kind {
            ManifestEntryKind::Symlink { payload, .. } => (payload.len() as u64, 0),
            ManifestEntryKind::File(snapshot) => (0, snapshot.len),
            ManifestEntryKind::Directory(_) => (0, 0),
        };
        budget.add_leaf_payload(link_bytes, file_bytes, limits)?;
        output.push(ManifestEntry {
            relative: child_relative.clone(),
            wire: child_wire.clone(),
            depth,
            kind,
        });

        if let Some(child) = child_directory {
            let child_names = collect_bounded_names(&child, limits, budget)?;
            frames.push(ScanFrame {
                directory: child,
                relative: child_relative,
                wire: child_wire,
                depth,
                names: child_names,
                next_name: 0,
            });
        }
    }
    Ok(())
}

fn collect_bounded_names(
    directory: &Dir,
    limits: DirectoryCopyLimits,
    budget: &mut ManifestBudget,
) -> Result<Vec<String>, CommandError> {
    let mut names = Vec::new();
    for entry in directory.entries().map_err(map_workspace_copy_error)? {
        let entry = entry.map_err(map_workspace_copy_error)?;
        let name = decode_name(entry.file_name(), limits.name_bytes)?;
        budget.reserve_entry_name(name.len(), limits)?;
        names.push(name);
    }
    names.sort_unstable_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    Ok(names)
}

fn ensure_manifest_unchanged(
    source: &OpenSourceRoot,
    source_path: &RelativePath,
    target_path: &RelativePath,
    limits: DirectoryCopyLimits,
    expected: &DirectoryManifest,
) -> Result<(), CommandError> {
    let observed =
        build_manifest(source, source_path, target_path, limits).map_err(|_| copy_conflict())?;
    if &observed == expected {
        Ok(())
    } else {
        Err(copy_conflict())
    }
}

fn ensure_source_root_named(source: &OpenSourceRoot) -> Result<(), CommandError> {
    let observed = source
        .parent
        .symlink_metadata(&source.name)
        .map_err(|_| copy_conflict())?;
    let snapshot = DirectorySnapshot::from_metadata(&observed).map_err(|_| copy_conflict())?;
    let handle = DirectorySnapshot::from_metadata(
        &source
            .directory
            .dir_metadata()
            .map_err(|_| copy_conflict())?,
    )
    .map_err(|_| copy_conflict())?;
    if snapshot == source.snapshot && handle == source.snapshot {
        Ok(())
    } else {
        Err(copy_conflict())
    }
}

fn source_directory_identities(
    manifest: &DirectoryManifest,
) -> impl Iterator<Item = FileIdentity> + '_ {
    std::iter::once(manifest.root.identity).chain(manifest.entries.iter().filter_map(|entry| {
        if let ManifestEntryKind::Directory(snapshot) = entry.kind {
            Some(snapshot.identity)
        } else {
            None
        }
    }))
}

impl<'parent> StagedTree<'parent> {
    fn create(
        parent: &'parent Dir,
        target_name: &Path,
        source_mode: u32,
    ) -> Result<Self, CommandError> {
        for _ in 0..MAX_DIRECTORY_STAGING_ATTEMPTS {
            let name = PathBuf::from(format!(
                "{DIRECTORY_STAGING_PREFIX}{}.tmp",
                Uuid::new_v4().simple()
            ));
            if name == target_name {
                continue;
            }
            match create_private_directory(parent, &name) {
                Ok(()) => {
                    let pathname = parent.symlink_metadata(&name).map_err(|_| copy_failed())?;
                    let root = parent.open_dir_nofollow(&name).map_err(|_| copy_failed())?;
                    let handle = root.dir_metadata().map_err(|_| copy_failed())?;
                    let pathname_identity = FileIdentity::from_metadata(&pathname);
                    let handle_identity = FileIdentity::from_metadata(&handle);
                    if !pathname.is_dir()
                        || !handle.is_dir()
                        || pathname_identity != handle_identity
                    {
                        return Err(copy_failed());
                    }
                    let mut staged = Self {
                        parent,
                        name,
                        root,
                        receipts: vec![StageReceipt {
                            relative: PathBuf::new(),
                            identity: handle_identity,
                            kind: ReceiptKind::Directory { source_mode },
                            symlink_payload: None,
                        }],
                        receipt_index: BTreeMap::from([(PathBuf::new(), 0)]),
                        active: true,
                    };
                    if let Err(error) = set_directory_mode(&staged.root, 0o700) {
                        return match staged.cleanup() {
                            Ok(()) => Err(error),
                            Err(_) => Err(stage_cleanup_failed()),
                        };
                    }
                    return Ok(staged);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(map_workspace_copy_error(error)),
            }
        }
        Err(copy_failed())
    }

    fn build<H: DirectoryCopyHooks>(
        &mut self,
        source: &OpenSourceRoot,
        manifest: &DirectoryManifest,
        limits: DirectoryCopyLimits,
        hooks: &mut H,
    ) -> Result<(), CommandError> {
        let mut actual_file_bytes = 0_u64;
        let mut actual_link_bytes = 0_u64;
        let source_directories = manifest.directory_map()?;
        for entry in &manifest.entries {
            let source_parent =
                open_source_parent(&source.directory, &source_directories, &entry.relative)?;
            let stage_parent =
                self.open_receipted_directory(entry.relative.parent().unwrap_or(Path::new("")))?;
            let name = entry.relative.file_name().ok_or_else(copy_failed)?;
            let name_path = Path::new(name);

            match &entry.kind {
                ManifestEntryKind::Directory(expected) => {
                    let source_directory = source_parent
                        .open_dir_nofollow(name)
                        .map_err(|_| copy_conflict())?;
                    let source_snapshot = DirectorySnapshot::from_metadata(
                        &source_directory
                            .dir_metadata()
                            .map_err(|_| copy_conflict())?,
                    )
                    .map_err(|_| copy_conflict())?;
                    let pathname_snapshot = DirectorySnapshot::from_metadata(
                        &source_parent
                            .symlink_metadata(name)
                            .map_err(|_| copy_conflict())?,
                    )
                    .map_err(|_| copy_conflict())?;
                    if source_snapshot != *expected || pathname_snapshot != *expected {
                        return Err(copy_conflict());
                    }

                    create_private_directory(&stage_parent, name_path)
                        .map_err(map_workspace_copy_error)?;
                    let staged_directory = stage_parent
                        .open_dir_nofollow(name)
                        .map_err(|_| copy_failed())?;
                    let identity = FileIdentity::from_metadata(
                        &staged_directory.dir_metadata().map_err(|_| copy_failed())?,
                    );
                    let pathname = stage_parent
                        .symlink_metadata(name)
                        .map_err(|_| copy_failed())?;
                    if !pathname.is_dir() || FileIdentity::from_metadata(&pathname) != identity {
                        return Err(copy_failed());
                    }
                    self.record_receipt(StageReceipt {
                        relative: entry.relative.clone(),
                        identity,
                        kind: ReceiptKind::Directory {
                            source_mode: expected.mode,
                        },
                        symlink_payload: None,
                    })?;
                    set_directory_mode(&staged_directory, 0o700)?;
                }
                ManifestEntryKind::File(expected) => {
                    let mut source_file = open_expected_file(&source_parent, name_path, *expected)?;
                    hooks.after_file_open(&entry.relative);
                    let remaining = limits
                        .file_aggregate_bytes
                        .checked_sub(actual_file_bytes)
                        .ok_or_else(directory_too_large)?;
                    if expected.len > remaining {
                        return Err(directory_too_large());
                    }
                    let mut options = OpenOptions::new();
                    options.read(true).write(true).create_new(true);
                    use cap_std::fs::OpenOptionsExt;
                    options.mode(0o600);
                    let mut staged_file = stage_parent
                        .open_with(name, &options)
                        .map_err(map_workspace_copy_error)?;
                    let handle_metadata = staged_file.metadata().map_err(|_| copy_failed())?;
                    let pathname_metadata = stage_parent
                        .symlink_metadata(name)
                        .map_err(|_| copy_failed())?;
                    let staged_identity = FileIdentity::from_metadata(&handle_metadata);
                    if !handle_metadata.is_file()
                        || !pathname_metadata.is_file()
                        || FileIdentity::from_metadata(&pathname_metadata) != staged_identity
                    {
                        return Err(copy_failed());
                    }
                    self.record_receipt(StageReceipt {
                        relative: entry.relative.clone(),
                        identity: staged_identity,
                        kind: ReceiptKind::File,
                        symlink_payload: None,
                    })?;
                    let transferred =
                        transfer_bounded_count(&mut source_file, &mut staged_file, remaining)?;
                    if transferred != expected.len {
                        return Err(copy_conflict());
                    }
                    actual_file_bytes = checked_limited_u64(
                        actual_file_bytes,
                        transferred,
                        limits.file_aggregate_bytes,
                    )?;
                    use cap_std::fs::PermissionsExt;
                    staged_file
                        .set_permissions(Permissions::from_mode(expected.mode & 0o777))
                        .map_err(map_workspace_copy_error)?;
                    staged_file.sync_all().map_err(map_workspace_copy_error)?;
                    verify_staged_contents(&mut source_file, &mut staged_file)?;
                    ensure_expected_file(&source_parent, name_path, &source_file, *expected)?;
                }
                ManifestEntryKind::Symlink { snapshot, payload } => {
                    ensure_expected_symlink(&source_parent, name_path, *snapshot, payload)?;
                    actual_link_bytes = checked_limited_u64(
                        actual_link_bytes,
                        payload.len() as u64,
                        limits.link_aggregate_bytes,
                    )?;
                    create_symlink_exact(&stage_parent, name_path, payload)?;
                    let before = SymlinkSnapshot::from_metadata(
                        &stage_parent
                            .symlink_metadata(name)
                            .map_err(|_| copy_failed())?,
                    )?;
                    let observed =
                        read_symlink_payload(&stage_parent, name_path, |_| copy_failed())?;
                    let after = SymlinkSnapshot::from_metadata(
                        &stage_parent
                            .symlink_metadata(name)
                            .map_err(|_| copy_failed())?,
                    )?;
                    if before != after || &observed != payload {
                        return Err(copy_failed());
                    }
                    self.record_receipt(StageReceipt {
                        relative: entry.relative.clone(),
                        identity: before.identity,
                        kind: ReceiptKind::Symlink,
                        symlink_payload: Some(payload.clone()),
                    })?;
                }
            }
        }
        Ok(())
    }

    fn verify<H: DirectoryCopyHooks>(
        &self,
        source: &OpenSourceRoot,
        manifest: &DirectoryManifest,
        hooks: &mut H,
    ) -> Result<(), CommandError> {
        ensure_source_root_named(source)?;
        self.ensure_root_identity()?;
        self.verify_member_sets()?;
        let source_directories = manifest.directory_map()?;
        for entry in &manifest.entries {
            let receipt = self.receipt(entry.relative.as_path())?;
            let stage_parent =
                self.open_receipted_directory(entry.relative.parent().unwrap_or(Path::new("")))?;
            let source_parent =
                open_source_parent(&source.directory, &source_directories, &entry.relative)?;
            let name = entry.relative.file_name().ok_or_else(copy_failed)?;
            let name_path = Path::new(name);
            match (&entry.kind, receipt.kind) {
                (ManifestEntryKind::Directory(expected), ReceiptKind::Directory { .. }) => {
                    let staged = stage_parent
                        .open_dir_nofollow(name)
                        .map_err(|_| copy_failed())?;
                    let staged_metadata = staged.dir_metadata().map_err(|_| copy_failed())?;
                    let pathname = stage_parent
                        .symlink_metadata(name)
                        .map_err(|_| copy_failed())?;
                    if !staged_metadata.is_dir()
                        || !pathname.is_dir()
                        || FileIdentity::from_metadata(&staged_metadata) != receipt.identity
                        || FileIdentity::from_metadata(&pathname) != receipt.identity
                    {
                        return Err(copy_failed());
                    }
                    let pathname_after = stage_parent
                        .symlink_metadata(name)
                        .map_err(|_| copy_failed())?;
                    if !pathname_after.is_dir()
                        || FileIdentity::from_metadata(&pathname_after) != receipt.identity
                    {
                        return Err(copy_failed());
                    }
                    let source_directory = source_parent
                        .open_dir_nofollow(name)
                        .map_err(|_| copy_conflict())?;
                    let source_handle = DirectorySnapshot::from_metadata(
                        &source_directory
                            .dir_metadata()
                            .map_err(|_| copy_conflict())?,
                    )
                    .map_err(|_| copy_conflict())?;
                    let source_pathname = DirectorySnapshot::from_metadata(
                        &source_parent
                            .symlink_metadata(name)
                            .map_err(|_| copy_conflict())?,
                    )
                    .map_err(|_| copy_conflict())?;
                    if source_handle != *expected || source_pathname != *expected {
                        return Err(copy_conflict());
                    }
                }
                (ManifestEntryKind::File(expected), ReceiptKind::File) => {
                    let mut source_file = open_expected_file(&source_parent, name_path, *expected)?;
                    let staged_before = stage_parent
                        .symlink_metadata(name)
                        .map_err(|_| copy_failed())?;
                    if !staged_before.is_file()
                        || FileIdentity::from_metadata(&staged_before) != receipt.identity
                    {
                        return Err(copy_failed());
                    }
                    let mut staged_file = open_copy_source(&stage_parent, name_path)?;
                    if FileIdentity::from_metadata(
                        &staged_file.metadata().map_err(|_| copy_failed())?,
                    ) != receipt.identity
                    {
                        return Err(copy_failed());
                    }
                    hooks.after_stage_file_open(&self.name, &entry.relative);
                    verify_staged_contents(&mut source_file, &mut staged_file)?;
                    ensure_expected_file(&source_parent, name_path, &source_file, *expected)?;
                    let staged_after = stage_parent
                        .symlink_metadata(name)
                        .map_err(|_| copy_failed())?;
                    if !staged_after.is_file()
                        || FileIdentity::from_metadata(&staged_after) != receipt.identity
                    {
                        return Err(copy_failed());
                    }
                }
                (ManifestEntryKind::Symlink { snapshot, payload }, ReceiptKind::Symlink) => {
                    ensure_expected_symlink(&source_parent, name_path, *snapshot, payload)?;
                    let staged_snapshot = SymlinkSnapshot::from_metadata(
                        &stage_parent
                            .symlink_metadata(name)
                            .map_err(|_| copy_failed())?,
                    )?;
                    let staged_payload =
                        read_symlink_payload(&stage_parent, name_path, |_| copy_failed())?;
                    hooks.after_stage_symlink_read(&self.name, &entry.relative);
                    let staged_after = SymlinkSnapshot::from_metadata(
                        &stage_parent
                            .symlink_metadata(name)
                            .map_err(|_| copy_failed())?,
                    )?;
                    if staged_snapshot != staged_after
                        || staged_snapshot.identity != receipt.identity
                        || staged_payload != *payload
                        || receipt.symlink_payload.as_deref() != Some(payload.as_slice())
                    {
                        return Err(copy_failed());
                    }
                }
                _ => return Err(copy_failed()),
            }
        }
        ensure_source_root_named(source)
    }

    fn apply_directory_modes(&self) -> Result<(), CommandError> {
        let mut directories = self
            .receipts
            .iter()
            .filter(|receipt| matches!(receipt.kind, ReceiptKind::Directory { .. }))
            .collect::<Vec<_>>();
        directories
            .sort_unstable_by_key(|receipt| std::cmp::Reverse(path_depth(&receipt.relative)));
        for receipt in directories {
            let directory = self.open_receipted_directory(&receipt.relative)?;
            if FileIdentity::from_metadata(&directory.dir_metadata().map_err(|_| copy_failed())?)
                != receipt.identity
            {
                return Err(copy_failed());
            }
            let ReceiptKind::Directory { source_mode } = receipt.kind else {
                unreachable!();
            };
            set_directory_mode(&directory, source_mode & 0o777)?;
        }
        Ok(())
    }

    fn publish(&mut self, target_name: &Path) -> Result<(), CommandError> {
        self.ensure_root_identity()?;
        publish_no_replace(self.parent, &self.name, target_name)?;
        self.active = false;
        Ok(())
    }

    fn ensure_root_identity(&self) -> Result<(), CommandError> {
        let root_receipt = self.receipts.first().ok_or_else(copy_failed)?;
        let pathname = self
            .parent
            .symlink_metadata(&self.name)
            .map_err(|_| copy_failed())?;
        let handle = self.root.dir_metadata().map_err(|_| copy_failed())?;
        if pathname.is_dir()
            && handle.is_dir()
            && FileIdentity::from_metadata(&pathname) == root_receipt.identity
            && FileIdentity::from_metadata(&handle) == root_receipt.identity
        {
            Ok(())
        } else {
            Err(copy_failed())
        }
    }

    fn record_receipt(&mut self, receipt: StageReceipt) -> Result<(), CommandError> {
        if self.receipt_index.contains_key(&receipt.relative) {
            return Err(copy_failed());
        }
        let index = self.receipts.len();
        self.receipt_index.insert(receipt.relative.clone(), index);
        self.receipts.push(receipt);
        Ok(())
    }

    fn receipt(&self, relative: &Path) -> Result<&StageReceipt, CommandError> {
        self.receipt_index
            .get(relative)
            .and_then(|index| self.receipts.get(*index))
            .ok_or_else(copy_failed)
    }

    fn open_receipted_directory(&self, relative: &Path) -> Result<Dir, CommandError> {
        let root_receipt = self.receipt(Path::new(""))?;
        if !matches!(root_receipt.kind, ReceiptKind::Directory { .. })
            || FileIdentity::from_metadata(&self.root.dir_metadata().map_err(|_| copy_failed())?)
                != root_receipt.identity
        {
            return Err(copy_failed());
        }

        let mut current = self.root.try_clone().map_err(|_| copy_failed())?;
        let mut walked = PathBuf::new();
        for component in relative.components() {
            use std::path::Component;
            let Component::Normal(name) = component else {
                return Err(copy_failed());
            };
            walked.push(name);
            let receipt = self.receipt(walked.as_path())?;
            if !matches!(receipt.kind, ReceiptKind::Directory { .. }) {
                return Err(copy_failed());
            }
            let pathname = current
                .symlink_metadata(Path::new(name))
                .map_err(|_| copy_failed())?;
            let child = current
                .open_dir_nofollow(Path::new(name))
                .map_err(|_| copy_failed())?;
            let handle = child.dir_metadata().map_err(|_| copy_failed())?;
            if !pathname.is_dir()
                || !handle.is_dir()
                || FileIdentity::from_metadata(&pathname) != receipt.identity
                || FileIdentity::from_metadata(&handle) != receipt.identity
            {
                return Err(copy_failed());
            }
            current = child;
        }
        Ok(current)
    }

    fn verify_member_sets(&self) -> Result<(), CommandError> {
        let mut expected: BTreeMap<PathBuf, BTreeSet<OsString>> = BTreeMap::new();
        for receipt in self.receipts.iter().skip(1) {
            let parent = receipt.relative.parent().unwrap_or(Path::new(""));
            let name = receipt.relative.file_name().ok_or_else(copy_failed)?;
            expected
                .entry(parent.to_owned())
                .or_default()
                .insert(name.to_owned());
        }
        for receipt in self
            .receipts
            .iter()
            .filter(|receipt| matches!(receipt.kind, ReceiptKind::Directory { .. }))
        {
            let directory = self.open_receipted_directory(&receipt.relative)?;
            if FileIdentity::from_metadata(&directory.dir_metadata().map_err(|_| copy_failed())?)
                != receipt.identity
            {
                return Err(copy_failed());
            }
            let expected_names = expected.remove(&receipt.relative).unwrap_or_default();
            let mut observed = BTreeSet::new();
            for entry in directory.entries().map_err(|_| copy_failed())? {
                let name = entry.map_err(|_| copy_failed())?.file_name();
                if observed.len() == expected_names.len() {
                    return Err(copy_failed());
                }
                observed.insert(name);
            }
            if observed != expected_names {
                return Err(copy_failed());
            }
        }
        if expected.is_empty() {
            Ok(())
        } else {
            Err(copy_failed())
        }
    }

    fn cleanup(&mut self) -> Result<(), CommandError> {
        if !self.active {
            return Ok(());
        }
        self.ensure_root_identity()
            .map_err(|_| stage_cleanup_failed())?;

        let mut directories = self
            .receipts
            .iter()
            .filter(|receipt| matches!(receipt.kind, ReceiptKind::Directory { .. }))
            .collect::<Vec<_>>();
        directories.sort_unstable_by_key(|receipt| path_depth(&receipt.relative));
        for receipt in &directories {
            let directory = self
                .open_receipted_directory(&receipt.relative)
                .map_err(|_| stage_cleanup_failed())?;
            if FileIdentity::from_metadata(
                &directory
                    .dir_metadata()
                    .map_err(|_| stage_cleanup_failed())?,
            ) != receipt.identity
            {
                return Err(stage_cleanup_failed());
            }
            set_directory_mode(&directory, 0o700).map_err(|_| stage_cleanup_failed())?;
        }
        self.verify_member_sets()
            .map_err(|_| stage_cleanup_failed())?;

        for receipt in self
            .receipts
            .iter()
            .rev()
            .filter(|receipt| matches!(receipt.kind, ReceiptKind::File | ReceiptKind::Symlink))
        {
            let parent = self
                .open_receipted_directory(receipt.relative.parent().unwrap_or(Path::new("")))
                .map_err(|_| stage_cleanup_failed())?;
            let name = receipt
                .relative
                .file_name()
                .ok_or_else(stage_cleanup_failed)?;
            let name_path = Path::new(name);
            let metadata = parent
                .symlink_metadata(name)
                .map_err(|_| stage_cleanup_failed())?;
            if FileIdentity::from_metadata(&metadata) != receipt.identity {
                return Err(stage_cleanup_failed());
            }
            match receipt.kind {
                ReceiptKind::File if metadata.is_file() => {}
                ReceiptKind::Symlink if metadata.file_type().is_symlink() => {
                    let payload =
                        read_symlink_payload(&parent, name_path, |_| stage_cleanup_failed())?;
                    if receipt.symlink_payload.as_deref() != Some(payload.as_slice()) {
                        return Err(stage_cleanup_failed());
                    }
                }
                _ => return Err(stage_cleanup_failed()),
            }
            parent
                .remove_file(name)
                .map_err(|_| stage_cleanup_failed())?;
        }

        directories
            .sort_unstable_by_key(|receipt| std::cmp::Reverse(path_depth(&receipt.relative)));
        for receipt in directories {
            if receipt.relative.as_os_str().is_empty() {
                continue;
            }
            let parent = self
                .open_receipted_directory(receipt.relative.parent().unwrap_or(Path::new("")))
                .map_err(|_| stage_cleanup_failed())?;
            let name = receipt
                .relative
                .file_name()
                .ok_or_else(stage_cleanup_failed)?;
            let metadata = parent
                .symlink_metadata(name)
                .map_err(|_| stage_cleanup_failed())?;
            if !metadata.is_dir() || FileIdentity::from_metadata(&metadata) != receipt.identity {
                return Err(stage_cleanup_failed());
            }
            parent
                .remove_dir(name)
                .map_err(|_| stage_cleanup_failed())?;
        }

        self.ensure_root_identity()
            .map_err(|_| stage_cleanup_failed())?;
        self.parent
            .remove_dir(&self.name)
            .map_err(|_| stage_cleanup_failed())?;
        self.active = false;
        Ok(())
    }

    fn fail_with_cleanup(&mut self, original: CommandError) -> Result<(), CommandError> {
        match self.cleanup() {
            Ok(()) => Err(original),
            Err(_) => Err(stage_cleanup_failed()),
        }
    }
}

impl Drop for StagedTree<'_> {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn open_expected_file(
    parent: &Dir,
    name: &Path,
    expected: SourceSnapshot,
) -> Result<File, CommandError> {
    let pathname =
        SourceSnapshot::from_metadata(&parent.symlink_metadata(name).map_err(|_| copy_conflict())?)
            .map_err(|_| copy_conflict())?;
    if pathname != expected {
        return Err(copy_conflict());
    }
    let file = open_copy_source(parent, name).map_err(|_| copy_conflict())?;
    let handle = SourceSnapshot::from_metadata(&file.metadata().map_err(|_| copy_conflict())?)
        .map_err(|_| copy_conflict())?;
    if handle == expected {
        Ok(file)
    } else {
        Err(copy_conflict())
    }
}

fn open_source_parent(
    root: &Dir,
    directories: &BTreeMap<&Path, DirectorySnapshot>,
    relative: &Path,
) -> Result<Dir, CommandError> {
    let root_expected = directories.get(Path::new("")).ok_or_else(copy_conflict)?;
    let mut current = root.try_clone().map_err(|_| copy_conflict())?;
    if DirectorySnapshot::from_metadata(&current.dir_metadata().map_err(|_| copy_conflict())?)
        .map_err(|_| copy_conflict())?
        != *root_expected
    {
        return Err(copy_conflict());
    }

    let mut walked = PathBuf::new();
    for component in relative.parent().unwrap_or(Path::new("")).components() {
        use std::path::Component;
        let Component::Normal(name) = component else {
            return Err(copy_conflict());
        };
        walked.push(name);
        let expected = directories
            .get(walked.as_path())
            .ok_or_else(copy_conflict)?;
        let pathname = DirectorySnapshot::from_metadata(
            &current
                .symlink_metadata(Path::new(name))
                .map_err(|_| copy_conflict())?,
        )
        .map_err(|_| copy_conflict())?;
        let child = current
            .open_dir_nofollow(Path::new(name))
            .map_err(|_| copy_conflict())?;
        let handle =
            DirectorySnapshot::from_metadata(&child.dir_metadata().map_err(|_| copy_conflict())?)
                .map_err(|_| copy_conflict())?;
        if pathname != *expected || handle != *expected {
            return Err(copy_conflict());
        }
        current = child;
    }
    Ok(current)
}

fn ensure_expected_file(
    parent: &Dir,
    name: &Path,
    file: &File,
    expected: SourceSnapshot,
) -> Result<(), CommandError> {
    let pathname =
        SourceSnapshot::from_metadata(&parent.symlink_metadata(name).map_err(|_| copy_conflict())?)
            .map_err(|_| copy_conflict())?;
    let handle = SourceSnapshot::from_metadata(&file.metadata().map_err(|_| copy_conflict())?)
        .map_err(|_| copy_conflict())?;
    if pathname == expected && handle == expected {
        Ok(())
    } else {
        Err(copy_conflict())
    }
}

fn ensure_expected_symlink(
    parent: &Dir,
    name: &Path,
    expected: SymlinkSnapshot,
    expected_payload: &[u8],
) -> Result<(), CommandError> {
    let before = SymlinkSnapshot::from_metadata(
        &parent.symlink_metadata(name).map_err(|_| copy_conflict())?,
    )
    .map_err(|_| copy_conflict())?;
    if before != expected {
        return Err(copy_conflict());
    }
    let payload = read_symlink_payload(parent, name, |_| copy_conflict())?;
    let after = SymlinkSnapshot::from_metadata(
        &parent.symlink_metadata(name).map_err(|_| copy_conflict())?,
    )
    .map_err(|_| copy_conflict())?;
    if before == after && payload == expected_payload {
        Ok(())
    } else {
        Err(copy_conflict())
    }
}

fn set_directory_mode(directory: &Dir, mode: u32) -> Result<(), CommandError> {
    use cap_std::fs::PermissionsExt;
    directory
        .set_permissions(".", Permissions::from_mode(mode))
        .map_err(map_workspace_copy_error)
}

fn create_private_directory(parent: &Dir, name: &Path) -> io::Result<()> {
    use cap_std::fs::DirBuilderExt;

    let mut builder = DirBuilder::new();
    builder.mode(0o700);
    parent.create_dir_with(name, &builder)
}

fn validate_root_basename(path: &RelativePath, max_name_bytes: usize) -> Result<(), CommandError> {
    let name = path
        .as_path()
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(path_encoding_unsupported)?;
    if name.len() > max_name_bytes {
        return Err(directory_too_large());
    }
    validate_portable_name(name)
}

fn decode_name(name: OsString, max_name_bytes: usize) -> Result<String, CommandError> {
    let name = name
        .into_string()
        .map_err(|_| path_encoding_unsupported())?;
    if name.len() > max_name_bytes {
        return Err(directory_too_large());
    }
    validate_portable_name(&name)?;
    Ok(name)
}

fn validate_portable_name(name: &str) -> Result<(), CommandError> {
    RelativePath::parse_wire(name)
        .map(|_| ())
        .map_err(|_| path_encoding_unsupported())
}

fn validate_descendant_wire(
    source_path: &RelativePath,
    target_path: &RelativePath,
    child_wire: &str,
) -> Result<(), CommandError> {
    let source = format!("{}/{child_wire}", source_path.as_wire());
    let target = format!("{}/{child_wire}", target_path.as_wire());
    RelativePath::parse_wire(&source).map_err(|_| path_encoding_unsupported())?;
    RelativePath::parse_wire(&target).map_err(|_| path_encoding_unsupported())?;
    Ok(())
}

fn path_depth(path: &Path) -> usize {
    path.components().count()
}

fn checked_limited_usize(
    current: usize,
    increment: usize,
    maximum: usize,
) -> Result<usize, CommandError> {
    let next = current
        .checked_add(increment)
        .ok_or_else(directory_too_large)?;
    if next > maximum {
        Err(directory_too_large())
    } else {
        Ok(next)
    }
}

fn checked_limited_u64(current: u64, increment: u64, maximum: u64) -> Result<u64, CommandError> {
    let next = current
        .checked_add(increment)
        .ok_or_else(directory_too_large)?;
    if next > maximum {
        Err(directory_too_large())
    } else {
        Ok(next)
    }
}

fn directory_too_large() -> CommandError {
    CommandError::new(
        "DIRECTORY_TOO_LARGE",
        "The workspace directory exceeds the supported copy limits.",
    )
}

fn path_encoding_unsupported() -> CommandError {
    CommandError::new(
        "PATH_ENCODING_UNSUPPORTED",
        "The workspace entry name cannot be represented safely.",
    )
}

#[cfg(test)]
mod tests;
