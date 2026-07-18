use std::io;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use cap_std::fs::{Dir, OpenOptions};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use cap_std::fs::{File, Metadata, Permissions};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use sha2::{Digest, Sha256};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use uuid::Uuid;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

#[cfg(any(target_os = "linux", target_os = "macos"))]
use super::move_entry::{PublishedCopyReceipt, PublishedFileReceipt, PublishedSymlinkReceipt};
use super::WorkspaceRootLease;

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) const MAX_COPY_FILE_BYTES: usize = 8 * 1_024 * 1_024;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) const MAX_COPY_SYMLINK_BYTES: usize = 4 * 1_024;
#[cfg(any(target_os = "linux", target_os = "macos"))]
const COPY_BUFFER_BYTES: usize = 64 * 1_024;
#[cfg(any(target_os = "linux", target_os = "macos"))]
const MAX_STAGING_ATTEMPTS: usize = 16;
#[cfg(any(target_os = "linux", target_os = "macos"))]
const MAX_STAGE_IDENTITY_ATTEMPTS: usize = 3;
#[cfg(any(target_os = "linux", target_os = "macos"))]
const STAGING_PREFIX: &str = ".plain-copy-";

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct PublishedFileSnapshot {
    pub(super) identity: FileIdentity,
    pub(super) len: u64,
    pub(super) mode: u32,
    pub(super) mtime: i64,
    pub(super) mtime_nsec: i64,
    pub(super) nlink: u64,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct PublishedSymlinkSnapshot {
    pub(super) identity: FileIdentity,
    pub(super) len: u64,
    pub(super) mtime: i64,
    pub(super) mtime_nsec: i64,
    pub(super) nlink: u64,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl PublishedSymlinkSnapshot {
    pub(super) const fn from_source(snapshot: SymlinkSnapshot) -> Self {
        Self {
            identity: snapshot.identity,
            len: snapshot.len,
            mtime: snapshot.mtime,
            mtime_nsec: snapshot.mtime_nsec,
            nlink: snapshot.nlink,
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl PublishedFileSnapshot {
    pub(super) fn from_metadata(metadata: &Metadata) -> Result<Self, CommandError> {
        use cap_std::fs::MetadataExt;

        validate_copy_source(metadata)?;
        Ok(Self {
            identity: FileIdentity::from_metadata(metadata),
            len: metadata.len(),
            mode: metadata.mode(),
            mtime: metadata.mtime(),
            mtime_nsec: metadata.mtime_nsec(),
            nlink: metadata.nlink(),
        })
    }
}

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

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
pub(crate) fn copy_regular_file(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
) -> Result<(), CommandError> {
    validate_copy_paths(source_lease, source_path, target_lease, target_path)?;
    let mut hooks = NoopTransferHooks;
    transfer_regular_file(
        source_lease,
        source_path,
        target_lease,
        target_path,
        &mut hooks,
    )
    .map(drop)
}

pub(crate) fn copy_entry(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
) -> Result<(), CommandError> {
    validate_copy_paths(source_lease, source_path, target_lease, target_path)?;
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        dispatch_copy_without_receipt(source_lease, source_path, target_lease, target_path)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        dispatch_copy(source_lease, source_path, target_lease, target_path)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn dispatch_copy_without_receipt(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
) -> Result<(), CommandError> {
    let (source_parent_path, source_name) = split_entry_path(source_path)?;
    let source_parent = open_copy_parent(source_lease.directory(), &source_parent_path)?;
    let source_metadata = source_parent
        .symlink_metadata(&source_name)
        .map_err(map_workspace_copy_error)?;
    if source_metadata.is_dir() {
        super::directory_copy::copy_directory(source_lease, source_path, target_lease, target_path)
    } else {
        dispatch_copy(source_lease, source_path, target_lease, target_path).map(drop)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn copy_entry_with_receipt(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
) -> Result<PublishedCopyReceipt, CommandError> {
    validate_copy_paths(source_lease, source_path, target_lease, target_path)?;
    dispatch_copy(source_lease, source_path, target_lease, target_path)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn dispatch_copy(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
) -> Result<PublishedCopyReceipt, CommandError> {
    let (source_parent_path, source_name) = split_entry_path(source_path)?;
    let source_parent = open_copy_parent(source_lease.directory(), &source_parent_path)?;
    let source_metadata = source_parent
        .symlink_metadata(&source_name)
        .map_err(map_workspace_copy_error)?;

    if source_metadata.is_file() {
        let mut hooks = NoopTransferHooks;
        return transfer_regular_file(
            source_lease,
            source_path,
            target_lease,
            target_path,
            &mut hooks,
        )
        .map(PublishedCopyReceipt::File);
    }
    if source_metadata.is_dir() {
        return super::directory_copy::copy_directory_with_receipt(
            source_lease,
            source_path,
            target_lease,
            target_path,
        )
        .map(PublishedCopyReceipt::Directory);
    }
    if !source_metadata.file_type().is_symlink() {
        return Err(entry_type_mismatch());
    }

    let source_before = SymlinkSnapshot::from_metadata(&source_metadata)?;
    let mut hooks = NoopSymlinkTransferHooks;
    transfer_symlink(
        &source_parent,
        &source_name,
        source_parent_path,
        source_before,
        target_lease,
        target_path,
        &mut hooks,
    )
    .map(PublishedCopyReceipt::Symlink)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn dispatch_copy(
    _source_lease: &WorkspaceRootLease,
    _source_path: &RelativePath,
    _target_lease: &WorkspaceRootLease,
    _target_path: &RelativePath,
) -> Result<(), CommandError> {
    Err(copy_unsupported())
}

fn validate_copy_paths(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
) -> Result<(), CommandError> {
    ensure_entry_path(source_path)?;
    ensure_entry_path(target_path)?;
    if source_lease.root_id() != target_lease.root_id() {
        return Ok(());
    }
    if source_path == target_path {
        return Err(entry_already_exists());
    }
    if target_path.as_path().starts_with(source_path.as_path()) {
        return Err(copy_conflict());
    }
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
trait TransferHooks {
    fn before_source_open(&mut self) {}
    fn after_source_open(&mut self) {}
    fn after_transfer(&mut self) {}
    fn after_stage_sync(&mut self) {}
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
struct NoopTransferHooks;

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl TransferHooks for NoopTransferHooks {}

#[cfg(any(target_os = "linux", target_os = "macos"))]
trait SymlinkTransferHooks {
    fn after_source_read(&mut self) {}
    fn after_stage_create(&mut self) {}
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
struct NoopSymlinkTransferHooks;

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl SymlinkTransferHooks for NoopSymlinkTransferHooks {}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn transfer_regular_file<H: TransferHooks>(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
    hooks: &mut H,
) -> Result<PublishedFileReceipt, CommandError> {
    let (source_parent_path, source_name) = split_entry_path(source_path)?;
    let source_parent = open_copy_parent(source_lease.directory(), &source_parent_path)?;
    let source_preflight = source_parent
        .symlink_metadata(&source_name)
        .map_err(map_workspace_copy_error)?;
    validate_copy_source(&source_preflight)?;

    hooks.before_source_open();
    let mut source = open_copy_source(&source_parent, &source_name)?;
    let source_before =
        SourceSnapshot::from_metadata(&source.metadata().map_err(map_workspace_copy_error)?)?;
    hooks.after_source_open();

    let (target_parent_path, target_name) = split_entry_path(target_path)?;
    let target_parent = open_copy_parent(target_lease.directory(), &target_parent_path)?;
    let mut staged = StagedFile::create(&target_parent, &target_name)?;

    let prepared = (|| {
        transfer_bounded(&mut source, staged.file_mut())?;
        hooks.after_transfer();
        let source_after =
            SourceSnapshot::from_metadata(&source.metadata().map_err(map_workspace_copy_error)?)?;
        let source_name_still_identifies_handle =
            source_name_identifies_handle(&source_parent, &source_name, source_before.identity)?;
        if !source_before.is_stable_after(source_after, source_name_still_identifies_handle) {
            return Err(copy_conflict());
        }
        staged.set_mode(source_before.mode & 0o777)?;
        staged.sync_all()?;
        hooks.after_stage_sync();

        // Re-read the opened source and the completed stage immediately before
        // publication. Metadata alone cannot detect a same-length rewrite when
        // another process restores mtime, especially after the original
        // basename has been replaced and ctime-only changes are intentionally
        // tolerated to preserve opened-handle semantics.
        let verification_before =
            SourceSnapshot::from_metadata(&source.metadata().map_err(map_workspace_copy_error)?)?;
        let source_name_before_verification =
            source_name_identifies_handle(&source_parent, &source_name, source_before.identity)?;
        if !source_before.is_stable_after(verification_before, source_name_before_verification) {
            return Err(copy_conflict());
        }
        let digest = verify_staged_contents_digest(&mut source, staged.file_mut())?;
        let verification_after =
            SourceSnapshot::from_metadata(&source.metadata().map_err(map_workspace_copy_error)?)?;
        let source_name_after_verification =
            source_name_identifies_handle(&source_parent, &source_name, source_before.identity)?;
        if verification_before != verification_after
            || !source_before.is_stable_after(verification_after, source_name_after_verification)
        {
            return Err(copy_conflict());
        }
        let source_parent_identity = FileIdentity::from_metadata(
            &source_parent
                .dir_metadata()
                .map_err(map_workspace_copy_error)?,
        );
        let target_parent_identity = FileIdentity::from_metadata(
            &target_parent
                .dir_metadata()
                .map_err(map_workspace_copy_error)?,
        );
        let target_file = staged.file.try_clone().map_err(map_workspace_copy_error)?;
        let target_snapshot = PublishedFileSnapshot::from_metadata(
            &target_file.metadata().map_err(map_workspace_copy_error)?,
        )?;
        let target_parent_receipt = target_parent
            .try_clone()
            .map_err(map_workspace_copy_error)?;
        Ok(PublishedFileReceipt {
            source_parent_path,
            source_name,
            source_parent,
            source_parent_identity,
            source_file: source,
            source_snapshot: source_before,
            target_parent_path,
            target_name: target_name.clone(),
            target_parent: target_parent_receipt,
            target_parent_identity,
            target_file,
            target_snapshot,
            digest,
        })
    })();

    let prepared = match prepared {
        Ok(prepared) => prepared,
        Err(error) => return fail_with_stage_cleanup(&mut staged, error).map(|()| unreachable!()),
    };
    if let Err(error) = staged.publish(&target_name) {
        return fail_with_stage_cleanup(&mut staged, error).map(|()| unreachable!());
    }
    Ok(prepared)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn transfer_symlink<H: SymlinkTransferHooks>(
    source_parent: &Dir,
    source_name: &Path,
    source_parent_path: PathBuf,
    source_before: SymlinkSnapshot,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
    hooks: &mut H,
) -> Result<PublishedSymlinkReceipt, CommandError> {
    let source_payload =
        read_source_symlink_stably(source_parent, source_name, source_before, hooks)?;

    let (target_parent_path, target_name) = split_entry_path(target_path)?;
    let target_parent = open_copy_parent(target_lease.directory(), &target_parent_path)?;
    let mut staged = StagedSymlink::create(&target_parent, &target_name, source_payload.clone())?;
    hooks.after_stage_create();

    if let Err(error) =
        ensure_source_symlink_unchanged(source_parent, source_name, source_before, &source_payload)
    {
        return fail_with_symlink_stage_cleanup(&mut staged, error).map(|()| unreachable!());
    }
    let prepared = (|| {
        let source_parent_receipt = source_parent
            .try_clone()
            .map_err(map_workspace_copy_error)?;
        let source_parent_identity = FileIdentity::from_metadata(
            &source_parent
                .dir_metadata()
                .map_err(map_workspace_copy_error)?,
        );
        let target_parent_receipt = target_parent
            .try_clone()
            .map_err(map_workspace_copy_error)?;
        let target_parent_identity = FileIdentity::from_metadata(
            &target_parent
                .dir_metadata()
                .map_err(map_workspace_copy_error)?,
        );
        let target_snapshot = PublishedSymlinkSnapshot::from_source(symlink_snapshot_at(
            &target_parent,
            &staged.name,
        )?);
        Ok(PublishedSymlinkReceipt {
            source_parent_path,
            source_name: source_name.to_owned(),
            source_parent: source_parent_receipt,
            source_parent_identity,
            source_snapshot: source_before,
            payload: source_payload,
            target_parent_path,
            target_name: target_name.clone(),
            target_parent: target_parent_receipt,
            target_parent_identity,
            target_snapshot,
        })
    })();
    let prepared = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            return fail_with_symlink_stage_cleanup(&mut staged, error).map(|()| unreachable!());
        }
    };
    if let Err(error) = staged.publish(&target_name) {
        return fail_with_symlink_stage_cleanup(&mut staged, error).map(|()| unreachable!());
    }
    Ok(prepared)
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
fn copy_regular_file_with_hooks<A, B, C>(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
    after_source_open: A,
    after_transfer: B,
    after_stage_sync: C,
) -> Result<(), CommandError>
where
    A: FnOnce(),
    B: FnOnce(),
    C: FnOnce(),
{
    struct TestHooks<A, B, C> {
        after_source_open: Option<A>,
        after_transfer: Option<B>,
        after_stage_sync: Option<C>,
    }

    impl<A: FnOnce(), B: FnOnce(), C: FnOnce()> TransferHooks for TestHooks<A, B, C> {
        fn after_source_open(&mut self) {
            if let Some(hook) = self.after_source_open.take() {
                hook();
            }
        }

        fn after_transfer(&mut self) {
            if let Some(hook) = self.after_transfer.take() {
                hook();
            }
        }

        fn after_stage_sync(&mut self) {
            if let Some(hook) = self.after_stage_sync.take() {
                hook();
            }
        }
    }

    validate_copy_paths(source_lease, source_path, target_lease, target_path)?;
    let mut hooks = TestHooks {
        after_source_open: Some(after_source_open),
        after_transfer: Some(after_transfer),
        after_stage_sync: Some(after_stage_sync),
    };
    transfer_regular_file(
        source_lease,
        source_path,
        target_lease,
        target_path,
        &mut hooks,
    )
    .map(drop)
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
fn copy_regular_file_with_pre_open_hook<F>(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
    before_source_open: F,
) -> Result<(), CommandError>
where
    F: FnOnce(),
{
    struct PreOpenHook<F>(Option<F>);

    impl<F: FnOnce()> TransferHooks for PreOpenHook<F> {
        fn before_source_open(&mut self) {
            if let Some(hook) = self.0.take() {
                hook();
            }
        }
    }

    validate_copy_paths(source_lease, source_path, target_lease, target_path)?;
    let mut hooks = PreOpenHook(Some(before_source_open));
    transfer_regular_file(
        source_lease,
        source_path,
        target_lease,
        target_path,
        &mut hooks,
    )
    .map(drop)
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
fn copy_symlink_with_hooks<A, B>(
    source_lease: &WorkspaceRootLease,
    source_path: &RelativePath,
    target_lease: &WorkspaceRootLease,
    target_path: &RelativePath,
    after_source_read: A,
    after_stage_create: B,
) -> Result<(), CommandError>
where
    A: FnOnce(),
    B: FnOnce(),
{
    struct TestHooks<A, B> {
        after_source_read: Option<A>,
        after_stage_create: Option<B>,
    }

    impl<A: FnOnce(), B: FnOnce()> SymlinkTransferHooks for TestHooks<A, B> {
        fn after_source_read(&mut self) {
            if let Some(hook) = self.after_source_read.take() {
                hook();
            }
        }

        fn after_stage_create(&mut self) {
            if let Some(hook) = self.after_stage_create.take() {
                hook();
            }
        }
    }

    validate_copy_paths(source_lease, source_path, target_lease, target_path)?;
    let (source_parent_path, source_name) = split_entry_path(source_path)?;
    let source_parent = open_copy_parent(source_lease.directory(), &source_parent_path)?;
    let source_metadata = source_parent
        .symlink_metadata(&source_name)
        .map_err(map_workspace_copy_error)?;
    let source_before = SymlinkSnapshot::from_metadata(&source_metadata)?;
    let mut hooks = TestHooks {
        after_source_read: Some(after_source_read),
        after_stage_create: Some(after_stage_create),
    };
    transfer_symlink(
        &source_parent,
        &source_name,
        source_parent_path,
        source_before,
        target_lease,
        target_path,
        &mut hooks,
    )
    .map(drop)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(super) struct FileIdentity {
    pub(super) device: u64,
    pub(super) inode: u64,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl FileIdentity {
    pub(super) fn from_metadata(metadata: &Metadata) -> Self {
        use cap_std::fs::MetadataExt;

        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct SourceSnapshot {
    pub(super) identity: FileIdentity,
    pub(super) len: u64,
    pub(super) mode: u32,
    pub(super) mtime: i64,
    pub(super) mtime_nsec: i64,
    pub(super) ctime: i64,
    pub(super) ctime_nsec: i64,
    pub(super) nlink: u64,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl SourceSnapshot {
    pub(super) fn from_metadata(metadata: &Metadata) -> Result<Self, CommandError> {
        use cap_std::fs::MetadataExt;

        validate_copy_source(metadata)?;
        Ok(Self {
            identity: FileIdentity::from_metadata(metadata),
            len: metadata.len(),
            mode: metadata.mode(),
            mtime: metadata.mtime(),
            mtime_nsec: metadata.mtime_nsec(),
            ctime: metadata.ctime(),
            ctime_nsec: metadata.ctime_nsec(),
            nlink: metadata.nlink(),
        })
    }

    pub(super) fn is_stable_after(
        self,
        after: Self,
        source_name_still_identifies_handle: bool,
    ) -> bool {
        let data_and_mode_are_stable = self.identity == after.identity
            && self.len == after.len
            && self.mode == after.mode
            && self.mtime == after.mtime
            && self.mtime_nsec == after.mtime_nsec
            && self.nlink == after.nlink;
        data_and_mode_are_stable
            && (!source_name_still_identifies_handle
                || (self.ctime == after.ctime && self.ctime_nsec == after.ctime_nsec))
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct SymlinkSnapshot {
    pub(super) identity: FileIdentity,
    pub(super) len: u64,
    pub(super) mtime: i64,
    pub(super) mtime_nsec: i64,
    pub(super) ctime: i64,
    pub(super) ctime_nsec: i64,
    pub(super) nlink: u64,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl SymlinkSnapshot {
    pub(super) fn from_metadata(metadata: &Metadata) -> Result<Self, CommandError> {
        use cap_std::fs::MetadataExt;

        if !metadata.file_type().is_symlink() {
            return Err(entry_type_mismatch());
        }
        if metadata.len() > MAX_COPY_SYMLINK_BYTES as u64 {
            return Err(symlink_too_large());
        }
        Ok(Self {
            identity: FileIdentity::from_metadata(metadata),
            len: metadata.len(),
            mtime: metadata.mtime(),
            mtime_nsec: metadata.mtime_nsec(),
            ctime: metadata.ctime(),
            ctime_nsec: metadata.ctime_nsec(),
            nlink: metadata.nlink(),
        })
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn source_name_identifies_handle(
    source_parent: &Dir,
    source_name: &Path,
    source_identity: FileIdentity,
) -> Result<bool, CommandError> {
    source_parent
        .symlink_metadata(source_name)
        .map(|metadata| {
            metadata.is_file() && FileIdentity::from_metadata(&metadata) == source_identity
        })
        .or_else(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                Ok(false)
            } else {
                Err(error)
            }
        })
        .map_err(map_workspace_copy_error)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
/// A newly created named stage whose file identity has not been captured yet.
///
/// This type deliberately has no path-based Drop cleanup. If every metadata
/// attempt fails, the basename can no longer be proven to identify the file
/// handle we created; leaking a high-entropy artifact is safer than deleting a
/// path another process may have replaced.
struct UnidentifiedStagedFile<'parent> {
    parent: &'parent Dir,
    name: PathBuf,
    file: File,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl<'parent> UnidentifiedStagedFile<'parent> {
    fn identify(self) -> Result<StagedFile<'parent>, CommandError> {
        for _ in 0..MAX_STAGE_IDENTITY_ATTEMPTS {
            if let Ok(metadata) = self.file.metadata() {
                if !metadata.is_file() {
                    return Err(stage_identity_failed());
                }
                return Ok(StagedFile {
                    parent: self.parent,
                    name: self.name,
                    identity: FileIdentity::from_metadata(&metadata),
                    file: self.file,
                    active: true,
                });
            }
        }
        Err(stage_identity_failed())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
struct StagedFile<'parent> {
    parent: &'parent Dir,
    name: PathBuf,
    file: File,
    identity: FileIdentity,
    active: bool,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl<'parent> StagedFile<'parent> {
    fn create(parent: &'parent Dir, target_name: &Path) -> Result<Self, CommandError> {
        for _ in 0..MAX_STAGING_ATTEMPTS {
            let name = PathBuf::from(format!("{STAGING_PREFIX}{}.tmp", Uuid::new_v4().simple()));
            if name == target_name {
                continue;
            }

            let mut options = OpenOptions::new();
            options.read(true).write(true).create_new(true);
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o600);

            match parent.open_with(&name, &options) {
                Ok(file) => return UnidentifiedStagedFile { parent, name, file }.identify(),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(map_workspace_copy_error(error)),
            }
        }
        Err(copy_failed())
    }

    fn file_mut(&mut self) -> &mut File {
        &mut self.file
    }

    fn set_mode(&self, mode: u32) -> Result<(), CommandError> {
        use cap_std::fs::PermissionsExt;

        self.file
            .set_permissions(Permissions::from_mode(mode))
            .map_err(map_workspace_copy_error)
    }

    fn sync_all(&self) -> Result<(), CommandError> {
        self.file.sync_all().map_err(map_workspace_copy_error)
    }

    fn publish(&mut self, target_name: &Path) -> Result<(), CommandError> {
        self.ensure_owned_name()?;
        publish_no_replace(self.parent, &self.name, target_name)?;
        self.active = false;
        Ok(())
    }

    fn cleanup(&mut self) -> Result<(), CommandError> {
        if !self.active {
            return Ok(());
        }
        let metadata = match self.parent.symlink_metadata(&self.name) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.active = false;
                return Ok(());
            }
            Err(_) => return Err(stage_cleanup_failed()),
        };
        if !metadata.is_file() || FileIdentity::from_metadata(&metadata) != self.identity {
            return Err(stage_cleanup_failed());
        }
        self.parent
            .remove_file(&self.name)
            .map_err(|_| stage_cleanup_failed())?;
        self.active = false;
        Ok(())
    }

    fn ensure_owned_name(&self) -> Result<(), CommandError> {
        let metadata = self
            .parent
            .symlink_metadata(&self.name)
            .map_err(|_| copy_failed())?;
        if metadata.is_file() && FileIdentity::from_metadata(&metadata) == self.identity {
            Ok(())
        } else {
            Err(copy_failed())
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl Drop for StagedFile<'_> {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn fail_with_stage_cleanup(
    staged: &mut StagedFile<'_>,
    original: CommandError,
) -> Result<(), CommandError> {
    match staged.cleanup() {
        Ok(()) => Err(original),
        Err(_) => Err(stage_cleanup_failed()),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
/// A newly created symlink stage before its pathname identity is proven.
///
/// There is intentionally no Drop cleanup here: without a captured identity,
/// removing the pathname could delete a replacement created by another actor.
struct UnidentifiedStagedSymlink<'parent> {
    parent: &'parent Dir,
    name: PathBuf,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl<'parent> UnidentifiedStagedSymlink<'parent> {
    fn identify(self, payload: Vec<u8>) -> Result<StagedSymlink<'parent>, CommandError> {
        let before =
            symlink_snapshot_at(self.parent, &self.name).map_err(|_| stage_identity_failed())?;
        let observed = read_symlink_payload(self.parent, &self.name, map_stage_symlink_read_error)
            .map_err(|_| stage_identity_failed())?;
        let after =
            symlink_snapshot_at(self.parent, &self.name).map_err(|_| stage_identity_failed())?;
        if before != after || observed != payload {
            return Err(stage_identity_failed());
        }
        Ok(StagedSymlink {
            parent: self.parent,
            name: self.name,
            identity: before.identity,
            payload,
            active: true,
        })
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
struct StagedSymlink<'parent> {
    parent: &'parent Dir,
    name: PathBuf,
    identity: FileIdentity,
    payload: Vec<u8>,
    active: bool,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl<'parent> StagedSymlink<'parent> {
    fn create(
        parent: &'parent Dir,
        target_name: &Path,
        payload: Vec<u8>,
    ) -> Result<Self, CommandError> {
        for _ in 0..MAX_STAGING_ATTEMPTS {
            let name = PathBuf::from(format!("{STAGING_PREFIX}{}.tmp", Uuid::new_v4().simple()));
            if name == target_name {
                continue;
            }
            match create_symlink_exact(parent, &name, payload.as_slice()) {
                Ok(()) => {
                    return UnidentifiedStagedSymlink { parent, name }.identify(payload);
                }
                Err(error) if stage_name_already_exists(&error) => continue,
                Err(error) => return Err(error),
            }
        }
        Err(copy_failed())
    }

    fn publish(&mut self, target_name: &Path) -> Result<(), CommandError> {
        self.ensure_owned_name()?;
        publish_no_replace(self.parent, &self.name, target_name)?;
        self.active = false;
        Ok(())
    }

    fn cleanup(&mut self) -> Result<(), CommandError> {
        if !self.active {
            return Ok(());
        }
        let before_metadata = match self.parent.symlink_metadata(&self.name) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.active = false;
                return Ok(());
            }
            Err(_) => return Err(stage_cleanup_failed()),
        };
        let before =
            SymlinkSnapshot::from_metadata(&before_metadata).map_err(|_| stage_cleanup_failed())?;
        if before.identity != self.identity {
            return Err(stage_cleanup_failed());
        }
        let payload = read_symlink_payload(self.parent, &self.name, map_stage_symlink_read_error)
            .map_err(|_| stage_cleanup_failed())?;
        let after =
            symlink_snapshot_at(self.parent, &self.name).map_err(|_| stage_cleanup_failed())?;
        if before != after || payload != self.payload {
            return Err(stage_cleanup_failed());
        }
        self.parent
            .remove_file(&self.name)
            .map_err(|_| stage_cleanup_failed())?;
        self.active = false;
        Ok(())
    }

    fn ensure_owned_name(&self) -> Result<(), CommandError> {
        let before = symlink_snapshot_at(self.parent, &self.name).map_err(|_| copy_failed())?;
        if before.identity != self.identity {
            return Err(copy_failed());
        }
        let payload = read_symlink_payload(self.parent, &self.name, map_stage_symlink_read_error)
            .map_err(|_| copy_failed())?;
        let after = symlink_snapshot_at(self.parent, &self.name).map_err(|_| copy_failed())?;
        if before == after && payload == self.payload {
            Ok(())
        } else {
            Err(copy_failed())
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl Drop for StagedSymlink<'_> {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn fail_with_symlink_stage_cleanup(
    staged: &mut StagedSymlink<'_>,
    original: CommandError,
) -> Result<(), CommandError> {
    match staged.cleanup() {
        Ok(()) => Err(original),
        Err(_) => Err(stage_cleanup_failed()),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn read_source_symlink_stably<H: SymlinkTransferHooks>(
    parent: &Dir,
    name: &Path,
    source_before: SymlinkSnapshot,
    hooks: &mut H,
) -> Result<Vec<u8>, CommandError> {
    let payload = read_symlink_payload(parent, name, map_source_symlink_read_error)?;
    hooks.after_source_read();
    let source_after = current_source_symlink_snapshot(parent, name)?;
    if source_before != source_after {
        return Err(copy_conflict());
    }

    let confirmed_payload = read_symlink_payload(parent, name, map_source_symlink_read_error)?;
    let source_confirmed = current_source_symlink_snapshot(parent, name)?;
    if source_after != source_confirmed || payload != confirmed_payload {
        return Err(copy_conflict());
    }
    Ok(payload)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn ensure_source_symlink_unchanged(
    parent: &Dir,
    name: &Path,
    expected_snapshot: SymlinkSnapshot,
    expected_payload: &[u8],
) -> Result<(), CommandError> {
    let before = current_source_symlink_snapshot(parent, name)?;
    if before != expected_snapshot {
        return Err(copy_conflict());
    }
    let payload = read_symlink_payload(parent, name, map_source_symlink_read_error)?;
    let after = current_source_symlink_snapshot(parent, name)?;
    if before == after && payload == expected_payload {
        Ok(())
    } else {
        Err(copy_conflict())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn current_source_symlink_snapshot(
    parent: &Dir,
    name: &Path,
) -> Result<SymlinkSnapshot, CommandError> {
    let metadata = parent.symlink_metadata(name).map_err(|_| copy_conflict())?;
    SymlinkSnapshot::from_metadata(&metadata).map_err(|_| copy_conflict())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn symlink_snapshot_at(parent: &Dir, name: &Path) -> Result<SymlinkSnapshot, CommandError> {
    let metadata = parent
        .symlink_metadata(name)
        .map_err(map_workspace_copy_error)?;
    SymlinkSnapshot::from_metadata(&metadata)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn read_symlink_payload<F>(
    parent: &Dir,
    name: &Path,
    map_error: F,
) -> Result<Vec<u8>, CommandError>
where
    F: FnOnce(rustix::io::Errno) -> CommandError,
{
    use rustix::fs::readlinkat_raw;

    let mut buffer = [0_u8; MAX_COPY_SYMLINK_BYTES + 1];
    let length = readlinkat_raw(parent, name, &mut buffer).map_err(map_error)?;
    bounded_symlink_payload(&buffer, length)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn create_symlink_exact(
    parent: &Dir,
    name: &Path,
    payload: &[u8],
) -> Result<(), CommandError> {
    use rustix::fs::symlinkat;

    symlinkat(payload, parent, name).map_err(map_symlink_stage_create_error)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn stage_name_already_exists(error: &CommandError) -> bool {
    error.code() == "ENTRY_ALREADY_EXISTS"
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn bounded_symlink_payload(buffer: &[u8], length: usize) -> Result<Vec<u8>, CommandError> {
    if length > MAX_COPY_SYMLINK_BYTES || length > buffer.len() {
        return Err(symlink_too_large());
    }
    Ok(buffer[..length].to_vec())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn open_copy_source(parent: &Dir, name: &Path) -> Result<File, CommandError> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};

    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    parent
        .open_with(name, &options)
        .map_err(map_copy_source_open_error)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn validate_copy_source(metadata: &Metadata) -> Result<(), CommandError> {
    if !metadata.is_file() {
        return Err(entry_type_mismatch());
    }
    if metadata.len() > MAX_COPY_FILE_BYTES as u64 {
        return Err(file_too_large());
    }
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn transfer_bounded(source: &mut File, target: &mut File) -> Result<(), CommandError> {
    transfer_bounded_count(source, target, MAX_COPY_FILE_BYTES as u64).map(|_| ())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn transfer_bounded_count(
    source: &mut File,
    target: &mut File,
    aggregate_remaining: u64,
) -> Result<u64, CommandError> {
    let mut buffer = [0u8; COPY_BUFFER_BYTES];
    let mut transferred = 0usize;
    let aggregate_probe = aggregate_remaining
        .checked_add(1)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(directory_too_large)?;
    let maximum_probe = MAX_COPY_FILE_BYTES
        .checked_add(1)
        .ok_or_else(file_too_large)?
        .min(aggregate_probe);
    loop {
        let remaining_probe = maximum_probe.checked_sub(transferred).ok_or_else(|| {
            if transferred > MAX_COPY_FILE_BYTES {
                file_too_large()
            } else {
                directory_too_large()
            }
        })?;
        let read_len = remaining_probe.min(buffer.len());
        let read = source
            .read(&mut buffer[..read_len])
            .map_err(map_workspace_copy_error)?;
        if read == 0 {
            return u64::try_from(transferred).map_err(|_| file_too_large());
        }
        transferred = transferred.checked_add(read).ok_or_else(file_too_large)?;
        if transferred > MAX_COPY_FILE_BYTES {
            return Err(file_too_large());
        }
        if transferred as u64 > aggregate_remaining {
            return Err(directory_too_large());
        }
        target
            .write_all(&buffer[..read])
            .map_err(map_workspace_copy_error)?;
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn verify_staged_contents_digest(
    source: &mut File,
    staged: &mut File,
) -> Result<[u8; 32], CommandError> {
    source
        .seek(SeekFrom::Start(0))
        .map_err(map_workspace_copy_error)?;
    staged
        .seek(SeekFrom::Start(0))
        .map_err(map_workspace_copy_error)?;

    let mut source_buffer = [0u8; COPY_BUFFER_BYTES];
    let mut staged_buffer = [0u8; COPY_BUFFER_BYTES];
    let mut source_hasher = Sha256::new();
    let mut staged_hasher = Sha256::new();
    let mut compared = 0usize;
    loop {
        let remaining_probe = MAX_COPY_FILE_BYTES
            .checked_add(1)
            .and_then(|limit| limit.checked_sub(compared))
            .ok_or_else(file_too_large)?;
        let read_len = remaining_probe.min(source_buffer.len());
        let source_read = source
            .read(&mut source_buffer[..read_len])
            .map_err(map_workspace_copy_error)?;
        if source_read == 0 {
            let staged_read = staged
                .read(&mut staged_buffer[..1])
                .map_err(map_workspace_copy_error)?;
            return if staged_read == 0 {
                let source_digest: [u8; 32] = source_hasher.finalize().into();
                let staged_digest: [u8; 32] = staged_hasher.finalize().into();
                if source_digest == staged_digest {
                    Ok(source_digest)
                } else {
                    Err(copy_conflict())
                }
            } else {
                Err(copy_conflict())
            };
        }

        compared = compared
            .checked_add(source_read)
            .ok_or_else(file_too_large)?;
        if compared > MAX_COPY_FILE_BYTES {
            return Err(file_too_large());
        }

        let mut staged_read = 0usize;
        while staged_read < source_read {
            let read = staged
                .read(&mut staged_buffer[staged_read..source_read])
                .map_err(map_workspace_copy_error)?;
            if read == 0 {
                return Err(copy_conflict());
            }
            staged_read = staged_read.checked_add(read).ok_or_else(copy_failed)?;
        }
        if source_buffer[..source_read] != staged_buffer[..source_read] {
            return Err(copy_conflict());
        }
        source_hasher.update(&source_buffer[..source_read]);
        staged_hasher.update(&staged_buffer[..source_read]);
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn publish_no_replace(
    parent: &Dir,
    staging_name: &Path,
    target_name: &Path,
) -> Result<(), CommandError> {
    use rustix::fs::{renameat_with, RenameFlags};

    renameat_with(
        parent,
        staging_name,
        parent,
        target_name,
        RenameFlags::NOREPLACE,
    )
    .map_err(map_copy_publish_error)
}

pub(super) fn split_entry_path(
    relative_path: &RelativePath,
) -> Result<(PathBuf, PathBuf), CommandError> {
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
pub(super) fn open_copy_parent(root: &Dir, relative_parent: &Path) -> Result<Dir, CommandError> {
    let path = if relative_parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        relative_parent
    };
    root.open_dir(path).map_err(map_workspace_copy_error)
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

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn map_workspace_copy_error(error: io::Error) -> CommandError {
    map_workspace_error(error, copy_failed)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn map_copy_source_open_error(error: io::Error) -> CommandError {
    if matches!(
        error.raw_os_error(),
        Some(libc::ELOOP) | Some(libc::ENXIO) | Some(libc::ENODEV)
    ) {
        entry_type_mismatch()
    } else {
        map_workspace_copy_error(error)
    }
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

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn map_copy_publish_error(error: rustix::io::Errno) -> CommandError {
    use rustix::io::Errno;

    match error {
        Errno::EXIST | Errno::NOTEMPTY => entry_already_exists(),
        Errno::ACCESS | Errno::PERM | Errno::ROFS => permission_denied(),
        _ => copy_failed(),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn map_source_symlink_read_error(error: rustix::io::Errno) -> CommandError {
    use rustix::io::Errno;

    match error {
        Errno::NOENT | Errno::NOTDIR | Errno::INVAL => copy_conflict(),
        Errno::ACCESS | Errno::PERM | Errno::ROFS => permission_denied(),
        _ => copy_failed(),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn map_stage_symlink_read_error(_error: rustix::io::Errno) -> CommandError {
    copy_failed()
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn map_symlink_stage_create_error(error: rustix::io::Errno) -> CommandError {
    use rustix::io::Errno;

    match error {
        Errno::EXIST => entry_already_exists(),
        Errno::ACCESS | Errno::PERM | Errno::ROFS => permission_denied(),
        _ => copy_failed(),
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

pub(super) fn entry_type_mismatch() -> CommandError {
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

pub(super) fn copy_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace copy conflicts with the source path.",
    )
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace file exceeds the supported copy limit.",
    )
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn symlink_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace symbolic link exceeds the supported copy limit.",
    )
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn copy_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be copied.")
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn stage_cleanup_failed() -> CommandError {
    CommandError::new(
        "IO_FAILED",
        "The workspace staging entry could not be cleaned up safely.",
    )
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn directory_too_large() -> CommandError {
    CommandError::new(
        "DIRECTORY_TOO_LARGE",
        "The workspace directory exceeds the supported copy limits.",
    )
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn stage_identity_failed() -> CommandError {
    CommandError::new(
        "IO_FAILED",
        "The workspace staging entry identity could not be verified.",
    )
}

fn rename_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be renamed.")
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn copy_unsupported() -> CommandError {
    CommandError::new(
        "IO_FAILED",
        "Atomic workspace copy is not supported on this platform.",
    )
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
