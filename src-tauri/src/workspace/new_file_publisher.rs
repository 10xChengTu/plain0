use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, File, OpenOptions};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{
    WorkspaceEntryStat, WorkspaceWriteDirectorySyncObservation, WorkspaceWriteResult,
};
use super::version::{
    mode_bits, writable_filesystem_kind, FileSystemKind, UnixMetadataSnapshot,
    MAX_VERSIONED_FILE_BYTES,
};
use super::WorkspaceRootLease;

const MAX_STAGING_ATTEMPTS: usize = 16;
const STAGING_PREFIX: &str = ".plain-new-";
const READ_BUFFER_BYTES: usize = 64 * 1_024;

pub(crate) fn publish_file(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    content: &[u8],
) -> Result<WorkspaceWriteResult, CommandError> {
    publish_file_with_hooks(lease, relative_path, content, || {}, |_, _| {})
}

#[cfg(test)]
fn publish_file_with_hook<F>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    content: &[u8],
    before_publish: F,
) -> Result<WorkspaceWriteResult, CommandError>
where
    F: FnOnce(&Dir, &Path),
{
    publish_file_with_hooks(lease, relative_path, content, || {}, before_publish)
}

fn publish_file_with_hooks<B, F>(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    content: &[u8],
    before_parent_reopen: B,
    before_publish: F,
) -> Result<WorkspaceWriteResult, CommandError>
where
    B: FnOnce(),
    F: FnOnce(&Dir, &Path),
{
    if relative_path.is_root() {
        return Err(invalid_publish_request());
    }
    if content.len() > MAX_VERSIONED_FILE_BYTES as usize {
        return Err(file_too_large());
    }

    let initial_parent = open_parent_chain(lease.directory(), relative_path)?;
    ensure_target_absent(&initial_parent.parent, &initial_parent.name)?;
    let mut stage = NewFileStage::create(&initial_parent)?;
    stage.write_and_verify(content, initial_parent.filesystem)?;

    before_parent_reopen();
    let publication_parent =
        open_parent_chain(lease.directory(), relative_path).map_err(|_| workspace_conflict())?;
    if !parent_chain_matches(&initial_parent, &publication_parent) {
        return Err(workspace_conflict());
    }
    ensure_target_absent(&publication_parent.parent, &publication_parent.name)
        .map_err(|_| workspace_conflict())?;
    stage
        .verify(content, publication_parent.filesystem)
        .map_err(|_| workspace_conflict())?;

    before_publish(&publication_parent.parent, &publication_parent.name);
    stage.disable_cleanup();
    if let Err(error) = publish_no_replace(
        &publication_parent.parent,
        &stage.name,
        &publication_parent.name,
    ) {
        if stage.cleanup_after_failed_publish().is_err() {
            return Err(stage_cleanup_failed());
        }
        return Err(map_publish_error(error));
    }

    let directory_sync = if sync_directory_handle(&publication_parent.parent).is_ok() {
        WorkspaceWriteDirectorySyncObservation::Synced
    } else {
        WorkspaceWriteDirectorySyncObservation::Failed
    };
    match postcheck(lease, relative_path, content) {
        Postcheck::Matches(stat)
            if directory_sync == WorkspaceWriteDirectorySyncObservation::Synced =>
        {
            Ok(WorkspaceWriteResult::written(stat))
        }
        Postcheck::Matches(_) => {
            Ok(WorkspaceWriteResult::rename_succeeded_sync_failed_with_written_target())
        }
        Postcheck::Changed => Ok(WorkspaceWriteResult::rename_succeeded_with_changed_target(
            directory_sync,
        )),
        Postcheck::Unverifiable => {
            Ok(WorkspaceWriteResult::rename_succeeded_with_unverifiable_target(directory_sync))
        }
    }
}

struct ParentChain {
    snapshots: Vec<UnixMetadataSnapshot>,
    parent: Dir,
    name: PathBuf,
    filesystem: FileSystemKind,
}

fn open_parent_chain(
    root: &Dir,
    relative_path: &RelativePath,
) -> Result<ParentChain, CommandError> {
    let parent_path = relative_path
        .as_path()
        .parent()
        .ok_or_else(invalid_publish_request)?;
    let name = relative_path
        .as_path()
        .file_name()
        .map(PathBuf::from)
        .ok_or_else(invalid_publish_request)?;
    let mut parent = root.try_clone().map_err(map_prepublication_error)?;
    let root_metadata = parent.dir_metadata().map_err(map_prepublication_error)?;
    if !root_metadata.is_dir() {
        return Err(publish_unsupported());
    }
    let mut snapshots = vec![UnixMetadataSnapshot::from_metadata(&root_metadata)];
    let mut filesystem = writable_filesystem_kind(&parent).ok_or_else(publish_unsupported)?;
    for component in parent_path.components() {
        let Component::Normal(segment) = component else {
            return Err(invalid_publish_request());
        };
        parent = parent
            .open_dir_nofollow(segment)
            .map_err(map_parent_open_error)?;
        let metadata = parent.dir_metadata().map_err(map_prepublication_error)?;
        if !metadata.is_dir() {
            return Err(publish_unsupported());
        }
        snapshots.push(UnixMetadataSnapshot::from_metadata(&metadata));
        let current = writable_filesystem_kind(&parent).ok_or_else(publish_unsupported)?;
        if current != filesystem {
            return Err(publish_unsupported());
        }
        filesystem = current;
    }
    Ok(ParentChain {
        snapshots,
        parent,
        name,
        filesystem,
    })
}

fn parent_chain_matches(expected: &ParentChain, current: &ParentChain) -> bool {
    expected.name == current.name
        && expected.filesystem == current.filesystem
        && expected.snapshots.len() == current.snapshots.len()
        && expected
            .snapshots
            .iter()
            .zip(&current.snapshots)
            .all(|(left, right)| {
                left.mode == right.mode
                    && left.uid == right.uid
                    && left.gid == right.gid
                    && left.device == right.device
                    && left.inode == right.inode
            })
}

fn ensure_target_absent(parent: &Dir, name: &Path) -> Result<(), CommandError> {
    match parent.symlink_metadata(name) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(entry_already_exists()),
        Err(error) => Err(map_prepublication_error(error)),
    }
}

struct NewFileStage {
    parent: Dir,
    name: PathBuf,
    file: File,
    identity: (u64, u64),
    mode: u32,
    cleanup_allowed: bool,
}

impl NewFileStage {
    fn create(parent: &ParentChain) -> Result<Self, CommandError> {
        let parent_snapshot = parent
            .snapshots
            .last()
            .copied()
            .ok_or_else(publish_unsupported)?;
        let stage_parent = parent
            .parent
            .try_clone()
            .map_err(map_prepublication_error)?;
        for _ in 0..MAX_STAGING_ATTEMPTS {
            let name = PathBuf::from(format!("{STAGING_PREFIX}{}.tmp", Uuid::new_v4().simple()));
            if name == parent.name {
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
            // The stage pathname exists before publication, so never request a
            // group/world-write bit even under a permissive process umask.
            options.mode(0o644);
            match parent.parent.open_with(&name, &options) {
                Ok(file) => {
                    let metadata = file.metadata().map_err(map_prepublication_error)?;
                    let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
                    let mut stage = Self {
                        parent: stage_parent,
                        name,
                        file,
                        identity: (snapshot.device, snapshot.inode),
                        mode: snapshot.mode & 0o777,
                        cleanup_allowed: true,
                    };
                    stage.verify_initial(parent_snapshot, parent.filesystem)?;
                    return Ok(stage);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(map_prepublication_error(error)),
            }
        }
        Err(stage_creation_failed())
    }

    fn verify_initial(
        &mut self,
        parent: UnixMetadataSnapshot,
        filesystem: FileSystemKind,
    ) -> Result<(), CommandError> {
        let metadata = self.file.metadata().map_err(map_prepublication_error)?;
        let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
        let pathname = self
            .parent
            .symlink_metadata(&self.name)
            .map_err(map_prepublication_error)?;
        if snapshot != UnixMetadataSnapshot::from_metadata(&pathname)
            || (snapshot.device, snapshot.inode) != self.identity
            || !valid_initial_stage(snapshot, parent, filesystem, &self.file)
        {
            return Err(stage_verification_failed());
        }
        Ok(())
    }

    fn write_and_verify(
        &mut self,
        content: &[u8],
        filesystem: FileSystemKind,
    ) -> Result<(), CommandError> {
        self.file
            .write_all(content)
            .map_err(map_prepublication_error)?;
        self.file.sync_all().map_err(map_prepublication_error)?;
        self.verify(content, filesystem)
    }

    fn verify(&mut self, content: &[u8], filesystem: FileSystemKind) -> Result<(), CommandError> {
        let metadata_before = self.file.metadata().map_err(map_prepublication_error)?;
        let before = UnixMetadataSnapshot::from_metadata(&metadata_before);
        let pathname = self
            .parent
            .symlink_metadata(&self.name)
            .map_err(map_prepublication_error)?;
        if before != UnixMetadataSnapshot::from_metadata(&pathname)
            || (before.device, before.inode) != self.identity
            || before.length != content.len() as u64
            || before.mode & 0o777 != self.mode
            || before.link_count != 1
            || before.mode & mode_bits(libc::S_IFMT) != mode_bits(libc::S_IFREG)
            || writable_filesystem_kind(&self.file) != Some(filesystem)
        {
            return Err(stage_verification_failed());
        }
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(map_prepublication_error)?;
        let expected_digest: [u8; 32] = Sha256::digest(content).into();
        if hash_bounded(&mut self.file, content.len())? != expected_digest {
            return Err(stage_verification_failed());
        }
        let after = UnixMetadataSnapshot::from_metadata(
            &self.file.metadata().map_err(map_prepublication_error)?,
        );
        if before != after {
            return Err(stage_verification_failed());
        }
        Ok(())
    }

    fn disable_cleanup(&mut self) {
        self.cleanup_allowed = false;
    }

    fn cleanup_after_failed_publish(&mut self) -> Result<(), CommandError> {
        self.cleanup_allowed = true;
        self.cleanup()
    }

    fn cleanup(&mut self) -> Result<(), CommandError> {
        if !self.cleanup_allowed {
            return Err(stage_cleanup_failed());
        }
        let metadata = self
            .parent
            .symlink_metadata(&self.name)
            .map_err(|_| stage_cleanup_failed())?;
        let snapshot = UnixMetadataSnapshot::from_metadata(&metadata);
        if !metadata.is_file() || (snapshot.device, snapshot.inode) != self.identity {
            self.cleanup_allowed = false;
            return Err(stage_cleanup_failed());
        }
        self.parent
            .remove_file(&self.name)
            .map_err(|_| stage_cleanup_failed())?;
        self.cleanup_allowed = false;
        let opened = UnixMetadataSnapshot::from_metadata(
            &self.file.metadata().map_err(|_| stage_cleanup_failed())?,
        );
        if (opened.device, opened.inode) == self.identity && opened.link_count == 0 {
            Ok(())
        } else {
            Err(stage_cleanup_failed())
        }
    }
}

impl Drop for NewFileStage {
    fn drop(&mut self) {
        if self.cleanup_allowed {
            let _ = self.cleanup();
        }
    }
}

fn valid_initial_stage(
    snapshot: UnixMetadataSnapshot,
    parent: UnixMetadataSnapshot,
    filesystem: FileSystemKind,
    file: &File,
) -> bool {
    let effective_uid = unsafe { libc::geteuid() };
    let effective_gid = unsafe { libc::getegid() };
    snapshot.mode & mode_bits(libc::S_IFMT) == mode_bits(libc::S_IFREG)
        && snapshot.mode & 0o7000 == 0
        && snapshot.link_count == 1
        && snapshot.length == 0
        && snapshot.uid == effective_uid
        && snapshot.gid == effective_gid
        && snapshot.mode & 0o600 == 0o600
        && snapshot.mode & 0o022 == 0
        && parent.mode & mode_bits(libc::S_IFMT) == mode_bits(libc::S_IFDIR)
        && parent.mode & 0o7000 == 0
        && parent.uid == effective_uid
        && parent.gid == effective_gid
        && parent.mode & 0o300 == 0o300
        && parent.mode & 0o022 == 0
        && writable_filesystem_kind(file) == Some(filesystem)
}

fn hash_bounded(file: &mut File, expected_length: usize) -> Result<[u8; 32], CommandError> {
    let mut hasher = Sha256::new();
    let mut observed = 0usize;
    let mut buffer = [0_u8; READ_BUFFER_BYTES];
    loop {
        let read = file.read(&mut buffer).map_err(map_prepublication_error)?;
        if read == 0 {
            break;
        }
        observed = observed.checked_add(read).ok_or_else(file_too_large)?;
        if observed > MAX_VERSIONED_FILE_BYTES as usize {
            return Err(file_too_large());
        }
        hasher.update(&buffer[..read]);
    }
    if observed != expected_length {
        return Err(stage_verification_failed());
    }
    Ok(hasher.finalize().into())
}

fn publish_no_replace(parent: &Dir, stage: &Path, target: &Path) -> rustix::io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags};
    renameat_with(parent, stage, parent, target, RenameFlags::NOREPLACE)
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

enum Postcheck {
    Matches(WorkspaceEntryStat),
    Changed,
    Unverifiable,
}

fn postcheck(
    lease: &WorkspaceRootLease,
    relative_path: &RelativePath,
    expected: &[u8],
) -> Postcheck {
    match super::reader::read_file(lease, relative_path) {
        Ok(receipt) => {
            let (stat, content) = receipt.into_parts();
            if content == expected {
                Postcheck::Matches(stat)
            } else {
                Postcheck::Changed
            }
        }
        Err(error) if error.code() == "ENTRY_NOT_FOUND" => Postcheck::Changed,
        Err(_) => Postcheck::Unverifiable,
    }
}

fn map_publish_error(error: rustix::io::Errno) -> CommandError {
    match error {
        rustix::io::Errno::EXIST => entry_already_exists(),
        _ => publish_failed(),
    }
}

fn map_parent_open_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => CommandError::new(
            "ENTRY_NOT_FOUND",
            "The parent workspace directory does not exist.",
        ),
        io::ErrorKind::PermissionDenied => CommandError::new(
            "PERMISSION_DENIED",
            "The parent workspace directory cannot be opened.",
        ),
        _ => publish_unsupported(),
    }
}

fn map_prepublication_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::PermissionDenied => {
            CommandError::new("PERMISSION_DENIED", "The workspace file cannot be created.")
        }
        _ => publish_failed(),
    }
}

fn invalid_publish_request() -> CommandError {
    CommandError::new(
        "INVALID_WORKSPACE_PUBLISH_REQUEST",
        "The workspace publish request is invalid.",
    )
}

fn file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace file exceeds the supported write limit.",
    )
}

fn publish_unsupported() -> CommandError {
    CommandError::new(
        "WORKSPACE_WRITE_UNSUPPORTED",
        "Atomic workspace file publication is not supported here.",
    )
}

fn entry_already_exists() -> CommandError {
    CommandError::new(
        "ENTRY_ALREADY_EXISTS",
        "The workspace entry already exists.",
    )
}

fn workspace_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace changed while the file was being created.",
    )
}

fn stage_creation_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_STAGE_CREATE_FAILED",
        "The workspace file staging area could not be created.",
    )
}

fn stage_verification_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_STAGE_VERIFY_FAILED",
        "The staged workspace file could not be verified.",
    )
}

fn stage_cleanup_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_STAGE_CLEANUP_FAILED",
        "The staged workspace file could not be cleaned up safely.",
    )
}

fn publish_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_WRITE_FAILED",
        "The workspace file could not be created.",
    )
}

#[cfg(test)]
mod tests;
