use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, File, OpenOptions, Permissions};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{
    WorkspaceEntryStat, WorkspaceWriteDirectorySyncObservation, WorkspaceWriteResult,
    WorkspaceWriteTargetObservation,
};
use super::version::{
    mode_bits, version_token, writable_filesystem_kind, writer_eligibility, FileSystemKind,
    UnixMetadataSnapshot, MAX_VERSIONED_FILE_BYTES,
};
use super::WorkspaceRootLease;

const MAX_STAGING_ATTEMPTS: usize = 16;
const STAGING_PREFIX: &str = ".plain-write-";
const WRITE_BUFFER_BYTES: usize = 64 * 1_024;

pub(crate) fn write_file(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    expected_version: &str,
    content: &[u8],
) -> Result<WorkspaceWriteResult, CommandError> {
    let mut hooks = SystemWriteHooks;
    write_file_with_hooks(lease, relative_path, expected_version, content, &mut hooks)
}

fn write_file_with_hooks<H: WriteHooks>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    expected_version: &str,
    content: &[u8],
    hooks: &mut H,
) -> Result<WorkspaceWriteResult, CommandError> {
    if relative_path.is_root() {
        return Err(invalid_write_request());
    }
    if content.len() > MAX_VERSIONED_FILE_BYTES as usize {
        return Err(file_too_large());
    }

    let initial_parent = open_parent_chain(lease.directory(), relative_path)?;
    let initial_target =
        open_eligible_target(lease, relative_path, &initial_parent, expected_version)?;
    hooks.after_initial_target();

    let mut stage = StagedWrite::create(
        &initial_parent.parent,
        &initial_parent.name,
        initial_parent.filesystem,
        initial_target.snapshot,
        hooks,
    )?;
    hooks.after_stage_created(&stage.parent, &stage.name);

    let prepared = (|| {
        stage.write_all(content)?;
        stage.set_mode(initial_target.snapshot.mode & 0o777)?;
        hooks
            .sync_stage(&stage.file)
            .map_err(map_prepublication_io_error)?;
        stage.receipt = Some(verify_stage(
            &stage.parent,
            &stage.name,
            &mut stage.file,
            initial_parent.filesystem,
            initial_target.snapshot,
            content.len(),
            digest(content),
        )?);
        hooks.after_stage_synced(&stage.parent, &stage.name);
        hooks.before_prepublication_rewalk();

        let publication_parent = open_parent_chain(lease.directory(), relative_path)
            .map_err(|_| workspace_conflict())?;
        if !parent_chain_matches(&initial_parent, &publication_parent) {
            return Err(workspace_conflict());
        }
        let current_target =
            open_eligible_target(lease, relative_path, &publication_parent, expected_version)
                .map_err(|_| workspace_conflict())?;
        if current_target.snapshot != initial_target.snapshot {
            return Err(workspace_conflict());
        }
        let stage_receipt = stage.receipt.ok_or_else(stage_verification_failed)?;
        let verified_stage = verify_stage(
            &publication_parent.parent,
            &stage.name,
            &mut stage.file,
            publication_parent.filesystem,
            initial_target.snapshot,
            content.len(),
            stage_receipt.digest,
        )
        .map_err(|_| workspace_conflict())?;
        if stage_receipt != verified_stage {
            return Err(workspace_conflict());
        }
        Ok(publication_parent)
    })();

    let publication_parent = match prepared {
        Ok(parent) => parent,
        Err(error) => return fail_prepublication(&mut stage, error, hooks),
    };

    publish_and_classify(
        lease,
        relative_path,
        initial_parent,
        initial_target,
        publication_parent,
        stage,
        hooks,
    )
}

#[derive(Debug)]
struct ParentChain {
    chain: Vec<UnixMetadataSnapshot>,
    parent: Dir,
    name: PathBuf,
    filesystem: FileSystemKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TargetReceipt {
    snapshot: UnixMetadataSnapshot,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct StageReceipt {
    snapshot: UnixMetadataSnapshot,
    digest: [u8; 32],
}

fn open_parent_chain(
    root: &Dir,
    relative_path: &RelativePath,
) -> Result<ParentChain, CommandError> {
    let parent_path = relative_path
        .as_path()
        .parent()
        .ok_or_else(invalid_write_request)?;
    let name = relative_path
        .as_path()
        .file_name()
        .map(PathBuf::from)
        .ok_or_else(invalid_write_request)?;
    let mut parent = root.try_clone().map_err(map_prepublication_io_error)?;
    let root_metadata = parent.dir_metadata().map_err(map_prepublication_io_error)?;
    if !root_metadata.is_dir() {
        return Err(write_unsupported());
    }
    let mut chain = vec![UnixMetadataSnapshot::from_metadata(&root_metadata)];
    let mut filesystem = writable_filesystem_kind(&parent).ok_or_else(write_unsupported)?;

    for component in parent_path.components() {
        let Component::Normal(segment) = component else {
            return Err(invalid_write_request());
        };
        parent = parent
            .open_dir_nofollow(segment)
            .map_err(map_parent_open_error)?;
        let metadata = parent.dir_metadata().map_err(map_prepublication_io_error)?;
        if !metadata.is_dir() {
            return Err(write_unsupported());
        }
        chain.push(UnixMetadataSnapshot::from_metadata(&metadata));
        let current = writable_filesystem_kind(&parent).ok_or_else(write_unsupported)?;
        if current != filesystem {
            return Err(write_unsupported());
        }
        filesystem = current;
    }

    Ok(ParentChain {
        chain,
        parent,
        name,
        filesystem,
    })
}

fn open_eligible_target(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    parent: &ParentChain,
    expected_version: &str,
) -> Result<TargetReceipt, CommandError> {
    let pathname = parent
        .parent
        .symlink_metadata(&parent.name)
        .map_err(map_target_open_error)?;
    if !pathname.is_file() {
        return Err(write_unsupported());
    }
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = parent
        .parent
        .open_with(&parent.name, &options)
        .map_err(map_target_open_error)?;
    let metadata = file.metadata().map_err(map_prepublication_io_error)?;
    if !metadata.is_file() {
        return Err(write_unsupported());
    }
    let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
    let pathname_snapshot = UnixMetadataSnapshot::from_metadata(&pathname);
    if snapshot != pathname_snapshot {
        return Err(workspace_file_modified());
    }
    let target_filesystem = writable_filesystem_kind(&file).ok_or_else(write_unsupported)?;
    if target_filesystem != parent.filesystem {
        return Err(write_unsupported());
    }
    let parent_snapshot = parent.chain.last().copied().ok_or_else(write_unsupported)?;
    if !writer_eligibility(snapshot, parent_snapshot) {
        return Err(write_unsupported());
    }
    let current_version =
        version_token(lease.root_id(), relative_path, parent.filesystem, snapshot)
            .ok_or_else(write_unsupported)?;
    if current_version != expected_version {
        return Err(workspace_file_modified());
    }
    Ok(TargetReceipt { snapshot })
}

fn parent_chain_matches(expected: &ParentChain, current: &ParentChain) -> bool {
    expected.name == current.name
        && expected.filesystem == current.filesystem
        && expected.chain.len() == current.chain.len()
        && expected
            .chain
            .iter()
            .zip(&current.chain)
            .all(|(expected, current)| {
                expected.device == current.device && expected.inode == current.inode
            })
        && expected
            .chain
            .last()
            .zip(current.chain.last())
            .is_some_and(|(expected, current)| parent_writer_fields_match(*expected, *current))
}

fn parent_writer_fields_match(
    expected: UnixMetadataSnapshot,
    current: UnixMetadataSnapshot,
) -> bool {
    expected.device == current.device
        && expected.inode == current.inode
        && expected.mode == current.mode
        && expected.uid == current.uid
        && expected.gid == current.gid
}

struct StagedWrite {
    parent: Dir,
    name: PathBuf,
    file: File,
    identity: Option<(u64, u64)>,
    receipt: Option<StageReceipt>,
    cleanup_allowed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StageCleanupOutcome {
    Removed,
    NamespaceChanged,
}

impl StagedWrite {
    fn create<H: WriteHooks>(
        parent: &Dir,
        target_name: &Path,
        filesystem: FileSystemKind,
        target: UnixMetadataSnapshot,
        hooks: &mut H,
    ) -> Result<Self, CommandError> {
        // Clone before the first create_new side effect. A clone failure must
        // never strand a stage that does not yet have an identity receipt.
        let stage_parent = hooks
            .clone_stage_parent(parent)
            .map_err(map_prepublication_io_error)?;
        for attempt in 0..MAX_STAGING_ATTEMPTS {
            let name = hooks.stage_name(attempt);
            if name == target_name || !is_single_normal_name(&name) {
                return Err(stage_creation_failed());
            }
            let mut options = OpenOptions::new();
            options
                .read(true)
                .write(true)
                .create_new(true)
                .follow(FollowSymlinks::No)
                .nonblock(true);
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o600);
            match parent.open_with(&name, &options) {
                Ok(file) => {
                    // Install the cleanup guard immediately after create_new.
                    // If identity acquisition or initial verification fails,
                    // Drop only removes a pathname that can still be proven to
                    // identify this exact handle.
                    let mut stage = Self {
                        parent: stage_parent,
                        name,
                        file,
                        identity: None,
                        receipt: None,
                        cleanup_allowed: true,
                    };
                    let metadata = stage.file.metadata().map_err(map_prepublication_io_error)?;
                    let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
                    stage.identity = Some((snapshot.device, snapshot.inode));
                    hooks.after_stage_identity(&stage.parent, &stage.name);
                    let pathname = stage
                        .parent
                        .symlink_metadata(&stage.name)
                        .map_err(map_prepublication_io_error)?;
                    let pathname_snapshot = UnixMetadataSnapshot::from_metadata(&pathname);
                    if snapshot != pathname_snapshot
                        || !valid_stage_metadata(
                            snapshot,
                            filesystem,
                            &stage.file,
                            target,
                            0,
                            0o600,
                        )
                    {
                        return Err(stage_verification_failed());
                    }
                    return Ok(stage);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(map_prepublication_io_error(error)),
            }
        }
        Err(stage_creation_failed())
    }

    fn write_all(&mut self, content: &[u8]) -> Result<(), CommandError> {
        self.file
            .write_all(content)
            .map_err(map_prepublication_io_error)
    }

    fn set_mode(&self, mode: u32) -> Result<(), CommandError> {
        use cap_std::fs::PermissionsExt;
        self.file
            .set_permissions(Permissions::from_mode(mode))
            .map_err(map_prepublication_io_error)
    }

    fn disable_cleanup(&mut self) {
        self.cleanup_allowed = false;
    }

    fn cleanup(&mut self) -> Result<StageCleanupOutcome, CommandError> {
        self.cleanup_with(remove_owned_stage)
    }

    fn cleanup_with_hooks<H: WriteHooks>(
        &mut self,
        hooks: &mut H,
    ) -> Result<StageCleanupOutcome, CommandError> {
        self.cleanup_with(|parent, name| hooks.remove_stage(parent, name))
    }

    fn cleanup_with<F>(&mut self, remove: F) -> Result<StageCleanupOutcome, CommandError>
    where
        F: FnOnce(&Dir, &Path) -> io::Result<()>,
    {
        if !self.cleanup_allowed {
            return Err(stage_cleanup_failed());
        }
        let identity = match self.identity {
            Some(identity) => identity,
            None => {
                let metadata = self.file.metadata().map_err(|_| stage_cleanup_failed())?;
                let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
                let identity = (snapshot.device, snapshot.inode);
                self.identity = Some(identity);
                identity
            }
        };
        let metadata = match self.parent.symlink_metadata(&self.name) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.cleanup_allowed = false;
                return Ok(StageCleanupOutcome::NamespaceChanged);
            }
            Err(_) => return Err(stage_cleanup_failed()),
        };
        let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
        if !metadata.is_file() || (snapshot.device, snapshot.inode) != identity {
            self.cleanup_allowed = false;
            return Ok(StageCleanupOutcome::NamespaceChanged);
        }
        match remove(&self.parent, &self.name) {
            Ok(()) => {
                self.cleanup_allowed = false;
                if self.opened_handle_is_unlinked()? {
                    Ok(StageCleanupOutcome::Removed)
                } else {
                    Ok(StageCleanupOutcome::NamespaceChanged)
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound
                        | io::ErrorKind::NotADirectory
                        | io::ErrorKind::IsADirectory
                ) =>
            {
                self.cleanup_allowed = false;
                Ok(StageCleanupOutcome::NamespaceChanged)
            }
            Err(_) => Err(stage_cleanup_failed()),
        }
    }

    fn opened_handle_is_unlinked(&self) -> Result<bool, CommandError> {
        let Some(identity) = self.identity else {
            return Err(stage_cleanup_failed());
        };
        let metadata = self.file.metadata().map_err(|_| stage_cleanup_failed())?;
        let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
        Ok(metadata.is_file()
            && (snapshot.device, snapshot.inode) == identity
            && snapshot.link_count == 0)
    }
}

impl Drop for StagedWrite {
    fn drop(&mut self) {
        if self.cleanup_allowed {
            let _ = self.cleanup();
        }
    }
}

fn is_single_normal_name(name: &Path) -> bool {
    let mut components = name.components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

fn sync_directory_handle(parent: &Dir) -> rustix::io::Result<()> {
    use rustix::fs::{Mode, OFlags};

    let syncable = rustix::fs::openat(
        parent,
        ".",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
        Mode::empty(),
    )?;
    rustix::fs::fsync(&syncable)
}

fn valid_stage_metadata(
    snapshot: UnixMetadataSnapshot,
    filesystem: FileSystemKind,
    file: &File,
    target: UnixMetadataSnapshot,
    expected_length: usize,
    expected_mode: u32,
) -> bool {
    snapshot.mode & mode_bits(libc::S_IFMT) == mode_bits(libc::S_IFREG)
        && snapshot.mode & 0o7000 == 0
        && snapshot.mode & 0o777 == expected_mode
        && snapshot.link_count == 1
        && snapshot.length == expected_length as u64
        && snapshot.uid == target.uid
        && snapshot.gid == target.gid
        && writable_filesystem_kind(file) == Some(filesystem)
}

fn verify_stage(
    parent: &Dir,
    name: &Path,
    file: &mut File,
    filesystem: FileSystemKind,
    target: UnixMetadataSnapshot,
    expected_length: usize,
    expected_digest: [u8; 32],
) -> Result<StageReceipt, CommandError> {
    let expected_mode = target.mode & 0o777;
    let metadata_before = file.metadata().map_err(map_prepublication_io_error)?;
    let snapshot_before = UnixMetadataSnapshot::from_metadata(&metadata_before);
    let pathname_before = parent
        .symlink_metadata(name)
        .map_err(map_prepublication_io_error)?;
    if snapshot_before != UnixMetadataSnapshot::from_metadata(&pathname_before)
        || !valid_stage_metadata(
            snapshot_before,
            filesystem,
            file,
            target,
            expected_length,
            expected_mode,
        )
        || writable_filesystem_kind(parent) != Some(filesystem)
    {
        return Err(stage_verification_failed());
    }

    file.seek(SeekFrom::Start(0))
        .map_err(map_prepublication_io_error)?;
    let observed_digest = hash_bounded(file, expected_length)?;
    if observed_digest != expected_digest {
        return Err(stage_verification_failed());
    }
    let metadata_after = file.metadata().map_err(map_prepublication_io_error)?;
    let snapshot_after = UnixMetadataSnapshot::from_metadata(&metadata_after);
    let pathname_after = parent
        .symlink_metadata(name)
        .map_err(map_prepublication_io_error)?;
    if snapshot_before != snapshot_after
        || snapshot_after != UnixMetadataSnapshot::from_metadata(&pathname_after)
    {
        return Err(stage_verification_failed());
    }
    Ok(StageReceipt {
        snapshot: snapshot_after,
        digest: expected_digest,
    })
}

fn hash_bounded(file: &mut File, expected_length: usize) -> Result<[u8; 32], CommandError> {
    let limit = MAX_VERSIONED_FILE_BYTES
        .checked_add(1)
        .ok_or_else(file_too_large)?;
    let mut remaining = limit;
    let mut observed = 0usize;
    let mut buffer = [0_u8; WRITE_BUFFER_BYTES];
    let mut hasher = Sha256::new();
    while remaining > 0 {
        let allowed = usize::try_from(remaining)
            .unwrap_or(buffer.len())
            .min(buffer.len());
        let read = file
            .read(&mut buffer[..allowed])
            .map_err(map_prepublication_io_error)?;
        if read == 0 {
            break;
        }
        observed = observed.checked_add(read).ok_or_else(file_too_large)?;
        if observed > MAX_VERSIONED_FILE_BYTES as usize {
            return Err(file_too_large());
        }
        hasher.update(&buffer[..read]);
        remaining -= read as u64;
    }
    if observed != expected_length {
        return Err(stage_verification_failed());
    }
    Ok(hasher.finalize().into())
}

fn digest(content: &[u8]) -> [u8; 32] {
    Sha256::digest(content).into()
}

fn fail_prepublication(
    stage: &mut StagedWrite,
    original: CommandError,
    hooks: &mut impl WriteHooks,
) -> Result<WorkspaceWriteResult, CommandError> {
    match stage.cleanup_with_hooks(hooks) {
        Ok(StageCleanupOutcome::Removed) => Err(original),
        Ok(StageCleanupOutcome::NamespaceChanged) if original.code() == "WORKSPACE_CONFLICT" => {
            Err(original)
        }
        Err(_) => Err(stage_cleanup_failed()),
        Ok(StageCleanupOutcome::NamespaceChanged) => Err(stage_cleanup_failed()),
    }
}

enum Postcheck {
    Matches(WorkspaceEntryStat),
    Changed,
    Unverifiable,
}

enum RenameFailureCheck {
    NotPublishedProof,
    ObservedWritten,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RenameFailureTarget {
    OldTarget,
    ObservedWritten,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StrictStageRemoval {
    Removed,
    NotRemoved,
}

/// The only helper allowed to cross the overwrite publication boundary.
///
/// `stage.cleanup_allowed` is disabled before `renameat` is dispatched. From
/// that point forward this function contains no fallible propagation or
/// rollback path: every observation is converted into a closed terminal state.
fn publish_and_classify<H: WriteHooks>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    initial_parent: ParentChain,
    initial_target: TargetReceipt,
    publication_parent: ParentChain,
    mut stage: StagedWrite,
    hooks: &mut H,
) -> Result<WorkspaceWriteResult, CommandError> {
    hooks.before_rename(
        &publication_parent.parent,
        &stage.name,
        &publication_parent.name,
    );
    stage.disable_cleanup();
    let rename_result = hooks.rename(
        &publication_parent.parent,
        &stage.name,
        &publication_parent.name,
    );
    hooks.after_rename(rename_result.is_ok());

    match rename_result {
        Ok(()) => {
            let directory_sync = if hooks.sync_directory(&publication_parent.parent).is_ok() {
                WorkspaceWriteDirectorySyncObservation::Synced
            } else {
                WorkspaceWriteDirectorySyncObservation::Failed
            };
            hooks.before_postcheck();
            let postcheck = postcheck_written_target(lease, relative_path, &initial_parent, &stage);
            match (directory_sync, postcheck) {
                (WorkspaceWriteDirectorySyncObservation::Synced, Postcheck::Matches(stat)) => {
                    Ok(WorkspaceWriteResult::written(stat))
                }
                (WorkspaceWriteDirectorySyncObservation::Failed, Postcheck::Matches(_)) => {
                    Ok(WorkspaceWriteResult::rename_succeeded_sync_failed_with_written_target())
                }
                (directory_sync, Postcheck::Changed) => Ok(
                    WorkspaceWriteResult::rename_succeeded_with_changed_target(directory_sync),
                ),
                (directory_sync, Postcheck::Unverifiable) => Ok(
                    WorkspaceWriteResult::rename_succeeded_with_unverifiable_target(directory_sync),
                ),
            }
        }
        Err(rename_error) => {
            hooks.before_postcheck();
            match check_reported_rename_failure(
                lease,
                relative_path,
                &initial_parent,
                initial_target,
                &mut stage,
            ) {
                RenameFailureCheck::NotPublishedProof => {
                    hooks.after_not_published_proof(
                        &publication_parent.parent,
                        &stage.name,
                        &publication_parent.name,
                    );
                    let removal = strict_remove_stage_after_rename(
                        &initial_parent,
                        initial_target,
                        &mut stage,
                        hooks,
                    );
                    match observe_rename_failure_target(
                        lease,
                        relative_path,
                        &initial_parent,
                        initial_target,
                        &stage,
                    ) {
                        RenameFailureTarget::OldTarget
                            if removal == StrictStageRemoval::Removed =>
                        {
                            Err(map_rename_failure(rename_error))
                        }
                        RenameFailureTarget::ObservedWritten => {
                            Ok(classify_reported_failure_after_observed_write(
                                lease,
                                relative_path,
                                &initial_parent,
                                &publication_parent,
                                &stage,
                                hooks,
                            ))
                        }
                        RenameFailureTarget::OldTarget | RenameFailureTarget::Unknown => {
                            Ok(WorkspaceWriteResult::native_unknown())
                        }
                    }
                }
                RenameFailureCheck::ObservedWritten => {
                    Ok(classify_reported_failure_after_observed_write(
                        lease,
                        relative_path,
                        &initial_parent,
                        &publication_parent,
                        &stage,
                        hooks,
                    ))
                }
                RenameFailureCheck::Unknown => Ok(WorkspaceWriteResult::native_unknown()),
            }
        }
    }
}

fn check_reported_rename_failure(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    initial_parent: &ParentChain,
    initial_target: TargetReceipt,
    stage: &mut StagedWrite,
) -> RenameFailureCheck {
    let current_parent = match open_parent_chain(lease.directory(), relative_path) {
        Ok(parent) if parent_chain_matches(initial_parent, &parent) => parent,
        _ => return RenameFailureCheck::Unknown,
    };
    match observe_rename_failure_target_at_parent(
        lease,
        relative_path,
        &current_parent,
        initial_target,
        stage,
    ) {
        RenameFailureTarget::ObservedWritten => return RenameFailureCheck::ObservedWritten,
        RenameFailureTarget::Unknown => return RenameFailureCheck::Unknown,
        RenameFailureTarget::OldTarget => {}
    }
    if stage_receipt_matches_at(&current_parent, initial_target, stage) {
        RenameFailureCheck::NotPublishedProof
    } else {
        RenameFailureCheck::Unknown
    }
}

fn observe_rename_failure_target(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    initial_parent: &ParentChain,
    initial_target: TargetReceipt,
    stage: &StagedWrite,
) -> RenameFailureTarget {
    let current_parent = match open_parent_chain(lease.directory(), relative_path) {
        Ok(parent) if parent_chain_matches(initial_parent, &parent) => parent,
        _ => return RenameFailureTarget::Unknown,
    };
    observe_rename_failure_target_at_parent(
        lease,
        relative_path,
        &current_parent,
        initial_target,
        stage,
    )
}

fn observe_rename_failure_target_at_parent(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    current_parent: &ParentChain,
    initial_target: TargetReceipt,
    stage: &StagedWrite,
) -> RenameFailureTarget {
    match postcheck_at_parent(lease, relative_path, current_parent, stage) {
        Postcheck::Matches(_) => return RenameFailureTarget::ObservedWritten,
        Postcheck::Unverifiable => return RenameFailureTarget::Unknown,
        Postcheck::Changed => {}
    }

    let current_target = match observe_target_snapshot(current_parent) {
        Ok(Some(snapshot)) => snapshot,
        _ => return RenameFailureTarget::Unknown,
    };
    if current_target != initial_target.snapshot {
        RenameFailureTarget::Unknown
    } else {
        RenameFailureTarget::OldTarget
    }
}

fn stage_receipt_matches_at(
    current_parent: &ParentChain,
    initial_target: TargetReceipt,
    stage: &mut StagedWrite,
) -> bool {
    let stage_receipt = match stage.receipt {
        Some(receipt) => receipt,
        None => return false,
    };
    verify_stage(
        &current_parent.parent,
        &stage.name,
        &mut stage.file,
        current_parent.filesystem,
        initial_target.snapshot,
        stage_receipt.snapshot.length as usize,
        stage_receipt.digest,
    ) == Ok(stage_receipt)
}

fn strict_remove_stage_after_rename<H: WriteHooks>(
    initial_parent: &ParentChain,
    initial_target: TargetReceipt,
    stage: &mut StagedWrite,
    hooks: &mut H,
) -> StrictStageRemoval {
    if !stage_receipt_matches_at(initial_parent, initial_target, stage) {
        return StrictStageRemoval::NotRemoved;
    }
    // Cleanup remains disabled after the publication syscall. This explicit
    // verified removal is the only unlink attempt, so Drop cannot turn an
    // ambiguous post-rename result into an unobserved retry.
    match hooks.remove_stage(&stage.parent, &stage.name) {
        Ok(()) if stage.opened_handle_is_unlinked() == Ok(true) => StrictStageRemoval::Removed,
        Ok(()) => StrictStageRemoval::NotRemoved,
        Err(_) => StrictStageRemoval::NotRemoved,
    }
}

fn classify_reported_failure_after_observed_write<H: WriteHooks>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    initial_parent: &ParentChain,
    publication_parent: &ParentChain,
    stage: &StagedWrite,
    hooks: &mut H,
) -> WorkspaceWriteResult {
    let directory_sync = if hooks.sync_directory(&publication_parent.parent).is_ok() {
        WorkspaceWriteDirectorySyncObservation::Synced
    } else {
        WorkspaceWriteDirectorySyncObservation::Failed
    };
    let final_target = postcheck_written_target(lease, relative_path, initial_parent, stage);
    let target = match final_target {
        Postcheck::Matches(_) => WorkspaceWriteTargetObservation::MatchesWritten,
        Postcheck::Changed => WorkspaceWriteTargetObservation::Changed,
        Postcheck::Unverifiable => WorkspaceWriteTargetObservation::Unverifiable,
    };
    WorkspaceWriteResult::rename_failed_with_observed_target(directory_sync, target)
}

fn postcheck_written_target(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    initial_parent: &ParentChain,
    stage: &StagedWrite,
) -> Postcheck {
    let current_parent = match open_parent_chain(lease.directory(), relative_path) {
        Ok(parent) if parent_chain_matches(initial_parent, &parent) => parent,
        Ok(_) => return Postcheck::Unverifiable,
        Err(_) => return Postcheck::Unverifiable,
    };
    postcheck_at_parent(lease, relative_path, &current_parent, stage)
}

fn postcheck_at_parent(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    parent: &ParentChain,
    stage: &StagedWrite,
) -> Postcheck {
    let expected = match stage.receipt {
        Some(receipt) => receipt,
        None => return Postcheck::Unverifiable,
    };
    let pathname = match parent.parent.symlink_metadata(&parent.name) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Postcheck::Changed,
        Err(_) => return Postcheck::Unverifiable,
    };
    if !pathname.is_file() {
        return Postcheck::Changed;
    }
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let mut file = match parent.parent.open_with(&parent.name, &options) {
        Ok(file) => file,
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound
                    | io::ErrorKind::NotADirectory
                    | io::ErrorKind::IsADirectory
            ) =>
        {
            return Postcheck::Changed;
        }
        Err(_) => return Postcheck::Unverifiable,
    };
    let metadata_before = match file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return Postcheck::Unverifiable,
    };
    let snapshot_before = UnixMetadataSnapshot::from_metadata(&metadata_before);
    if !published_fields_match(snapshot_before, expected.snapshot)
        || snapshot_before != UnixMetadataSnapshot::from_metadata(&pathname)
        || writable_filesystem_kind(&file) != Some(parent.filesystem)
    {
        return Postcheck::Changed;
    }
    if file.seek(SeekFrom::Start(0)).is_err() {
        return Postcheck::Unverifiable;
    }
    let digest = match hash_bounded(&mut file, expected.snapshot.length as usize) {
        Ok(digest) => digest,
        Err(_) => return Postcheck::Changed,
    };
    if digest != expected.digest {
        return Postcheck::Changed;
    }
    let metadata_after = match file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return Postcheck::Unverifiable,
    };
    let pathname_after = match parent.parent.symlink_metadata(&parent.name) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Postcheck::Changed,
        Err(_) => return Postcheck::Unverifiable,
    };
    let snapshot_after = UnixMetadataSnapshot::from_metadata(&metadata_after);
    if snapshot_after != snapshot_before
        || snapshot_after != UnixMetadataSnapshot::from_metadata(&pathname_after)
    {
        return Postcheck::Changed;
    }
    let version = match version_token(
        lease.root_id(),
        relative_path,
        parent.filesystem,
        snapshot_after,
    ) {
        Some(version) => version,
        None => return Postcheck::Unverifiable,
    };
    match super::reader::stat_from_metadata(
        super::dto::WorkspaceEntryKind::File,
        &metadata_after,
        Some(version),
    ) {
        Ok(stat) => Postcheck::Matches(stat),
        Err(_) => Postcheck::Unverifiable,
    }
}

fn published_fields_match(current: UnixMetadataSnapshot, staged: UnixMetadataSnapshot) -> bool {
    current.device == staged.device
        && current.inode == staged.inode
        && current.length == staged.length
        && current.mode == staged.mode
        && current.uid == staged.uid
        && current.gid == staged.gid
        && current.rdev == staged.rdev
        && current.mtime_seconds == staged.mtime_seconds
        && current.mtime_nanoseconds == staged.mtime_nanoseconds
        && current.link_count == staged.link_count
}

fn observe_target_snapshot(parent: &ParentChain) -> Result<Option<UnixMetadataSnapshot>, ()> {
    let pathname = match parent.parent.symlink_metadata(&parent.name) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if !pathname.is_file() {
        return Ok(None);
    }
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = parent
        .parent
        .open_with(&parent.name, &options)
        .map_err(|_| ())?;
    let metadata = file.metadata().map_err(|_| ())?;
    let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
    if snapshot == UnixMetadataSnapshot::from_metadata(&pathname)
        && writable_filesystem_kind(&file) == Some(parent.filesystem)
    {
        Ok(Some(snapshot))
    } else {
        Ok(None)
    }
}

trait WriteHooks {
    fn stage_name(&mut self, _attempt: usize) -> PathBuf {
        PathBuf::from(format!("{STAGING_PREFIX}{}.tmp", Uuid::new_v4().simple()))
    }

    fn after_initial_target(&mut self) {}
    fn clone_stage_parent(&mut self, parent: &Dir) -> io::Result<Dir> {
        parent.try_clone()
    }
    fn after_stage_identity(&mut self, _parent: &Dir, _name: &Path) {}
    fn after_stage_created(&mut self, _parent: &Dir, _name: &Path) {}
    fn sync_stage(&mut self, file: &File) -> io::Result<()> {
        file.sync_all()
    }
    fn after_stage_synced(&mut self, _parent: &Dir, _name: &Path) {}
    fn before_prepublication_rewalk(&mut self) {}
    fn before_rename(&mut self, _parent: &Dir, _stage: &Path, _target: &Path) {}
    fn rename(&mut self, parent: &Dir, stage: &Path, target: &Path) -> rustix::io::Result<()> {
        rustix::fs::renameat(parent, stage, parent, target)
    }
    fn after_rename(&mut self, _reported_success: bool) {}
    fn sync_directory(&mut self, parent: &Dir) -> rustix::io::Result<()> {
        sync_directory_handle(parent)
    }
    fn before_postcheck(&mut self) {}
    fn after_not_published_proof(&mut self, _parent: &Dir, _stage: &Path, _target: &Path) {}
    fn remove_stage(&mut self, parent: &Dir, stage: &Path) -> io::Result<()> {
        remove_owned_stage(parent, stage)
    }
}

struct SystemWriteHooks;
impl WriteHooks for SystemWriteHooks {}

fn remove_owned_stage(parent: &Dir, stage: &Path) -> io::Result<()> {
    parent.remove_file(stage)
}

fn map_parent_open_error(error: io::Error) -> CommandError {
    if matches!(
        error.raw_os_error(),
        Some(libc::ELOOP) | Some(libc::ENOTDIR)
    ) {
        write_unsupported()
    } else {
        map_prepublication_io_error(error)
    }
}

fn map_target_open_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => workspace_file_modified(),
        _ if matches!(
            error.raw_os_error(),
            Some(libc::ELOOP) | Some(libc::ENXIO) | Some(libc::ENODEV)
        ) =>
        {
            write_unsupported()
        }
        _ => map_prepublication_io_error(error),
    }
}

fn map_prepublication_io_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => workspace_file_modified(),
        io::ErrorKind::PermissionDenied => permission_denied(),
        _ => write_failed(),
    }
}

fn map_rename_failure(error: rustix::io::Errno) -> CommandError {
    use rustix::io::Errno;
    match error {
        Errno::ACCESS | Errno::PERM | Errno::ROFS => permission_denied(),
        _ => write_failed(),
    }
}

fn invalid_write_request() -> CommandError {
    CommandError::new(
        "INVALID_WORKSPACE_WRITE_REQUEST",
        "The workspace write request is invalid.",
    )
}

fn workspace_file_modified() -> CommandError {
    CommandError::new(
        "WORKSPACE_FILE_MODIFIED",
        "The workspace file changed before it could be written.",
    )
}

fn workspace_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace changed while the file was being prepared.",
    )
}

fn write_unsupported() -> CommandError {
    CommandError::new(
        "WORKSPACE_WRITE_UNSUPPORTED",
        "The workspace file cannot be written safely on this filesystem.",
    )
}

fn file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace file exceeds the supported write limit.",
    )
}

fn permission_denied() -> CommandError {
    CommandError::new("PERMISSION_DENIED", "The workspace file cannot be written.")
}

fn stage_creation_failed() -> CommandError {
    CommandError::new(
        "IO_FAILED",
        "The workspace staging file could not be created safely.",
    )
}

fn stage_verification_failed() -> CommandError {
    CommandError::new(
        "IO_FAILED",
        "The workspace staging file could not be verified safely.",
    )
}

fn stage_cleanup_failed() -> CommandError {
    CommandError::new(
        "IO_FAILED",
        "The workspace staging file could not be cleaned up safely.",
    )
}

fn write_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace file could not be written.")
}

#[cfg(test)]
mod tests;
