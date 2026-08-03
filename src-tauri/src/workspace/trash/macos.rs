use std::os::unix::fs::MetadataExt;

use objc2::rc::autoreleasepool;
use objc2_foundation::{NSFileManager, NSURL};

use super::{
    FileIdentity, PlatformTrash, PlatformTrashOutcome, PlatformTrashRequest,
    WorkspaceTrashEntryKind,
};

pub(in crate::workspace) struct MacOsSystemTrash;

impl PlatformTrash for MacOsSystemTrash {
    fn move_to_trash(&mut self, request: &PlatformTrashRequest) -> PlatformTrashOutcome {
        // Foundation is necessarily pathname-based. Recheck that the private
        // canonical root and final pathname still name the same identities as
        // the capability observations immediately before entering the OS API.
        // The same-UID namespace race after this check is the explicit system
        // Trash boundary documented by ADR 0005.
        if !request.target_path.starts_with(&request.root_path)
            || request.target_path == request.root_path
            || !ambient_identity_matches(
                std::fs::metadata(&request.root_path),
                request.root_identity,
                Some(WorkspaceTrashEntryKind::Directory),
            )
            || !ambient_identity_matches(
                std::fs::symlink_metadata(&request.target_path),
                request.target_identity,
                Some(request.target_kind),
            )
        {
            return PlatformTrashOutcome::FailedBeforeAttempt;
        }

        autoreleasepool(|_| {
            let Some(url) = NSURL::from_file_path(&request.target_path) else {
                return PlatformTrashOutcome::FailedBeforeAttempt;
            };
            let manager = NSFileManager::defaultManager();
            match manager.trashItemAtURL_resultingItemURL_error(&url, None) {
                Ok(()) => PlatformTrashOutcome::Trashed,
                Err(_) => PlatformTrashOutcome::FailedAfterAttempt,
            }
        })
    }
}

fn ambient_identity_matches(
    metadata: std::io::Result<std::fs::Metadata>,
    expected: FileIdentity,
    expected_kind: Option<WorkspaceTrashEntryKind>,
) -> bool {
    let Ok(metadata) = metadata else {
        return false;
    };
    let kind_matches = match expected_kind {
        Some(WorkspaceTrashEntryKind::File) => metadata.is_file(),
        Some(WorkspaceTrashEntryKind::Directory) => metadata.is_dir(),
        Some(WorkspaceTrashEntryKind::Symlink) => metadata.file_type().is_symlink(),
        None => true,
    };
    kind_matches
        && FileIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        } == expected
}
