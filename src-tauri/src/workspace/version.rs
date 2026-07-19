use sha2::{Digest, Sha256};

use crate::path_policy::RelativePath;

use super::RootId;

pub(crate) const MAX_VERSIONED_FILE_BYTES: u64 = 8 * 1_024 * 1_024;
const VERSION_DOMAIN: &[u8] = b"plain.workspace.file-version.v1\0";
const SPECIAL_MODE_BITS: u32 = 0o7000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
#[allow(dead_code)] // The closed wire set includes kinds from both supported OS families.
pub(crate) enum FileSystemKind {
    Apfs = 1,
    Ext = 2,
    Xfs = 3,
    Btrfs = 4,
    Tmpfs = 5,
    Overlayfs = 6,
}

impl FileSystemKind {
    const fn code(self) -> u32 {
        self as u32
    }
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct UnixMetadataSnapshot {
    pub(crate) device: u64,
    pub(crate) inode: u64,
    pub(crate) length: u64,
    pub(crate) mode: u32,
    pub(crate) uid: u32,
    pub(crate) gid: u32,
    pub(crate) rdev: u64,
    pub(crate) mtime_seconds: i64,
    pub(crate) mtime_nanoseconds: i64,
    pub(crate) ctime_seconds: i64,
    pub(crate) ctime_nanoseconds: i64,
    pub(crate) link_count: u64,
}

#[cfg(unix)]
impl UnixMetadataSnapshot {
    pub(crate) fn from_metadata(metadata: &cap_std::fs::Metadata) -> Self {
        use cap_std::fs::MetadataExt;

        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            length: metadata.len(),
            mode: metadata.mode(),
            uid: metadata.uid(),
            gid: metadata.gid(),
            rdev: metadata.rdev(),
            mtime_seconds: metadata.mtime(),
            mtime_nanoseconds: metadata.mtime_nsec(),
            ctime_seconds: metadata.ctime(),
            ctime_nanoseconds: metadata.ctime_nsec(),
            link_count: metadata.nlink(),
        }
    }

    const fn has_valid_times(self) -> bool {
        self.mtime_nanoseconds >= 0
            && self.mtime_nanoseconds <= 999_999_999
            && self.ctime_nanoseconds >= 0
            && self.ctime_nanoseconds <= 999_999_999
    }
}

#[cfg(unix)]
pub(crate) fn version_token(
    root_id: RootId,
    relative_path: &RelativePath,
    filesystem: FileSystemKind,
    metadata: UnixMetadataSnapshot,
) -> Option<String> {
    version_token_from_parts(
        root_id.as_bytes(),
        relative_path.as_wire(),
        filesystem,
        metadata,
    )
}

#[cfg(unix)]
fn version_token_from_parts(
    root_id: &[u8; 16],
    relative_path: &str,
    filesystem: FileSystemKind,
    metadata: UnixMetadataSnapshot,
) -> Option<String> {
    if relative_path.is_empty() || !metadata.has_valid_times() {
        return None;
    }
    let path_length = u32::try_from(relative_path.len()).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(VERSION_DOMAIN);
    hasher.update(root_id);
    hasher.update(path_length.to_be_bytes());
    hasher.update(relative_path.as_bytes());
    hasher.update(filesystem.code().to_be_bytes());
    hasher.update(metadata.device.to_be_bytes());
    hasher.update(metadata.inode.to_be_bytes());
    hasher.update(metadata.length.to_be_bytes());
    hasher.update(metadata.mode.to_be_bytes());
    hasher.update(metadata.uid.to_be_bytes());
    hasher.update(metadata.gid.to_be_bytes());
    hasher.update(metadata.rdev.to_be_bytes());
    hasher.update(metadata.mtime_seconds.to_be_bytes());
    hasher.update(
        u32::try_from(metadata.mtime_nanoseconds)
            .ok()?
            .to_be_bytes(),
    );
    hasher.update(metadata.ctime_seconds.to_be_bytes());
    hasher.update(
        u32::try_from(metadata.ctime_nanoseconds)
            .ok()?
            .to_be_bytes(),
    );
    hasher.update(metadata.link_count.to_be_bytes());
    Some(format_digest(hasher.finalize().into()))
}

fn format_digest(digest: [u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(68);
    token.push_str("wv1:");
    for byte in digest {
        token.push(char::from(HEX[usize::from(byte >> 4)]));
        token.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    token
}

#[cfg(unix)]
pub(crate) fn writer_eligibility(
    target: UnixMetadataSnapshot,
    parent: UnixMetadataSnapshot,
) -> bool {
    let effective_uid = unsafe { libc::geteuid() };
    let effective_gid = unsafe { libc::getegid() };
    target.length <= MAX_VERSIONED_FILE_BYTES
        && target.link_count == 1
        && target.mode & u32::from(libc::S_IFMT) == u32::from(libc::S_IFREG)
        && target.mode & SPECIAL_MODE_BITS == 0
        && target.uid == effective_uid
        && target.gid == effective_gid
        && target.mode & 0o200 != 0
        && parent.mode & u32::from(libc::S_IFMT) == u32::from(libc::S_IFDIR)
        && parent.mode & SPECIAL_MODE_BITS == 0
        && parent.uid == effective_uid
        && parent.gid == effective_gid
        && parent.mode & 0o300 == 0o300
        && parent.mode & 0o022 == 0
        && target.has_valid_times()
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) fn writable_filesystem_kind<Fd: std::os::fd::AsFd>(
    descriptor: &Fd,
) -> Option<FileSystemKind> {
    use rustix::fs::{fstatfs, fstatvfs, StatVfsMountFlags};

    let vfs = fstatvfs(descriptor).ok()?;
    if vfs.f_flag.contains(StatVfsMountFlags::RDONLY) {
        return None;
    }
    let filesystem = fstatfs(descriptor).ok()?;
    classify_filesystem(&filesystem)
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
pub(crate) fn writable_filesystem_kind<Fd: std::os::fd::AsFd>(
    _descriptor: &Fd,
) -> Option<FileSystemKind> {
    None
}

#[cfg(target_os = "linux")]
fn classify_filesystem(filesystem: &rustix::fs::StatFs) -> Option<FileSystemKind> {
    // Linux filesystem magic values are 32-bit even where `f_type` is a
    // signed machine word. Mask before matching so Btrfs remains recognizable
    // on 32-bit targets instead of being sign-extended.
    classify_linux_magic(filesystem.f_type as u64)
}

#[cfg(any(target_os = "linux", test))]
fn classify_linux_magic(raw: u64) -> Option<FileSystemKind> {
    match raw & u64::from(u32::MAX) {
        0x0000_ef53 => Some(FileSystemKind::Ext),
        0x5846_5342 => Some(FileSystemKind::Xfs),
        0x9123_683e => Some(FileSystemKind::Btrfs),
        0x0102_1994 => Some(FileSystemKind::Tmpfs),
        0x794c_7630 => Some(FileSystemKind::Overlayfs),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn classify_filesystem(filesystem: &rustix::fs::StatFs) -> Option<FileSystemKind> {
    let name = filesystem
        .f_fstypename
        .iter()
        .copied()
        .take_while(|byte| *byte != 0)
        .map(|byte| byte as u8)
        .collect::<Vec<_>>();
    (name.as_slice() == b"apfs").then_some(FileSystemKind::Apfs)
}

#[cfg(all(test, unix))]
mod tests {
    use serde::Deserialize;

    use super::{version_token_from_parts, FileSystemKind, UnixMetadataSnapshot};

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionFixture {
        root_id: String,
        relative_path: String,
        file_system_kind: String,
        metadata: MetadataFixture,
        version: String,
        read: ReadFixture,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReadFixture {
        version: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MetadataFixture {
        device: String,
        inode: String,
        length: u64,
        mode: String,
        uid: u32,
        gid: u32,
        rdev: u64,
        mtime_seconds: i64,
        mtime_nanoseconds: i64,
        ctime_seconds: i64,
        ctime_nanoseconds: i64,
        link_count: u64,
    }

    fn fixture() -> VersionFixture {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/workspace-version-v1.json"
        ))
        .expect("workspace version fixture must parse")
    }

    fn parse_prefixed_u64(value: &str, prefix: &str, radix: u32) -> u64 {
        u64::from_str_radix(value.strip_prefix(prefix).expect("fixture prefix"), radix)
            .expect("fixture number")
    }

    #[test]
    fn golden_version_digest_matches_shared_fixture() {
        let fixture = fixture();
        let root_id = uuid::Uuid::parse_str(&fixture.root_id).unwrap();
        assert_eq!(fixture.file_system_kind, "apfs");
        let metadata = UnixMetadataSnapshot {
            device: parse_prefixed_u64(&fixture.metadata.device, "0x", 16),
            inode: parse_prefixed_u64(&fixture.metadata.inode, "0x", 16),
            length: fixture.metadata.length,
            mode: parse_prefixed_u64(&fixture.metadata.mode, "0o", 8) as u32,
            uid: fixture.metadata.uid,
            gid: fixture.metadata.gid,
            rdev: fixture.metadata.rdev,
            mtime_seconds: fixture.metadata.mtime_seconds,
            mtime_nanoseconds: fixture.metadata.mtime_nanoseconds,
            ctime_seconds: fixture.metadata.ctime_seconds,
            ctime_nanoseconds: fixture.metadata.ctime_nanoseconds,
            link_count: fixture.metadata.link_count,
        };
        assert_eq!(
            version_token_from_parts(
                root_id.as_bytes(),
                &fixture.relative_path,
                FileSystemKind::Apfs,
                metadata,
            )
            .as_deref(),
            Some(fixture.version.as_str())
        );
    }

    #[test]
    fn invalid_nanoseconds_do_not_produce_a_token() {
        let fixture = fixture();
        let root_id = uuid::Uuid::parse_str(&fixture.root_id).unwrap();
        let metadata = UnixMetadataSnapshot {
            device: 1,
            inode: 2,
            length: 3,
            mode: 0o100600,
            uid: 0,
            gid: 0,
            rdev: 0,
            mtime_seconds: 0,
            mtime_nanoseconds: 1_000_000_000,
            ctime_seconds: 0,
            ctime_nanoseconds: 0,
            link_count: 1,
        };
        assert!(version_token_from_parts(
            root_id.as_bytes(),
            &fixture.relative_path,
            FileSystemKind::Apfs,
            metadata,
        )
        .is_none());
    }

    #[test]
    fn read_snapshot_length_produces_its_distinct_shared_version() {
        let fixture = fixture();
        let root_id = uuid::Uuid::parse_str(&fixture.root_id).unwrap();
        let metadata = UnixMetadataSnapshot {
            device: parse_prefixed_u64(&fixture.metadata.device, "0x", 16),
            inode: parse_prefixed_u64(&fixture.metadata.inode, "0x", 16),
            length: 4,
            mode: parse_prefixed_u64(&fixture.metadata.mode, "0o", 8) as u32,
            uid: fixture.metadata.uid,
            gid: fixture.metadata.gid,
            rdev: fixture.metadata.rdev,
            mtime_seconds: fixture.metadata.mtime_seconds,
            mtime_nanoseconds: fixture.metadata.mtime_nanoseconds,
            ctime_seconds: fixture.metadata.ctime_seconds,
            ctime_nanoseconds: fixture.metadata.ctime_nanoseconds,
            link_count: fixture.metadata.link_count,
        };
        assert_eq!(
            version_token_from_parts(
                root_id.as_bytes(),
                &fixture.relative_path,
                FileSystemKind::Apfs,
                metadata,
            )
            .as_deref(),
            Some(fixture.read.version.as_str())
        );
    }

    #[test]
    fn versions_are_bound_to_root_path_and_filesystem_kind() {
        let metadata = UnixMetadataSnapshot {
            device: 1,
            inode: 2,
            length: 3,
            mode: 0o100600,
            uid: 4,
            gid: 5,
            rdev: 0,
            mtime_seconds: 6,
            mtime_nanoseconds: 7,
            ctime_seconds: 8,
            ctime_nanoseconds: 9,
            link_count: 1,
        };
        let root_a = [0_u8; 16];
        let mut root_b = root_a;
        root_b[15] = 1;
        let baseline =
            version_token_from_parts(&root_a, "src/a.rs", FileSystemKind::Apfs, metadata).unwrap();
        assert_ne!(
            baseline,
            version_token_from_parts(&root_b, "src/a.rs", FileSystemKind::Apfs, metadata).unwrap()
        );
        assert_ne!(
            baseline,
            version_token_from_parts(&root_a, "src/b.rs", FileSystemKind::Apfs, metadata).unwrap()
        );
        assert_ne!(
            baseline,
            version_token_from_parts(&root_a, "src/a.rs", FileSystemKind::Ext, metadata).unwrap()
        );
    }

    #[test]
    fn writer_eligibility_fails_closed_for_every_static_gate() {
        let uid = unsafe { libc::geteuid() };
        let gid = unsafe { libc::getegid() };
        let target = UnixMetadataSnapshot {
            device: 1,
            inode: 2,
            length: 4,
            mode: u32::from(libc::S_IFREG) | 0o600,
            uid,
            gid,
            rdev: 0,
            mtime_seconds: 1,
            mtime_nanoseconds: 2,
            ctime_seconds: 3,
            ctime_nanoseconds: 4,
            link_count: 1,
        };
        let parent = UnixMetadataSnapshot {
            device: 1,
            inode: 1,
            length: 0,
            mode: u32::from(libc::S_IFDIR) | 0o700,
            uid,
            gid,
            rdev: 0,
            mtime_seconds: 1,
            mtime_nanoseconds: 2,
            ctime_seconds: 3,
            ctime_nanoseconds: 4,
            link_count: 1,
        };
        assert!(super::writer_eligibility(target, parent));

        let rejected = vec![
            (
                UnixMetadataSnapshot {
                    length: super::MAX_VERSIONED_FILE_BYTES + 1,
                    ..target
                },
                parent,
            ),
            (
                UnixMetadataSnapshot {
                    link_count: 2,
                    ..target
                },
                parent,
            ),
            (
                UnixMetadataSnapshot {
                    mode: target.mode | 0o4000,
                    ..target
                },
                parent,
            ),
            (
                UnixMetadataSnapshot {
                    mode: target.mode & !0o200,
                    ..target
                },
                parent,
            ),
            (
                UnixMetadataSnapshot {
                    uid: uid.wrapping_add(1),
                    ..target
                },
                parent,
            ),
            (
                target,
                UnixMetadataSnapshot {
                    mode: parent.mode & !0o100,
                    ..parent
                },
            ),
            (
                target,
                UnixMetadataSnapshot {
                    mode: parent.mode | 0o2000,
                    ..parent
                },
            ),
            (
                target,
                UnixMetadataSnapshot {
                    mode: u32::from(libc::S_IFDIR) | 0o770,
                    ..parent
                },
            ),
            (
                target,
                UnixMetadataSnapshot {
                    mode: u32::from(libc::S_IFDIR) | 0o777,
                    ..parent
                },
            ),
            (
                target,
                UnixMetadataSnapshot {
                    gid: gid.wrapping_add(1),
                    ..parent
                },
            ),
        ];
        for (target, parent) in rejected {
            assert!(!super::writer_eligibility(target, parent));
        }
    }

    #[test]
    fn linux_filesystem_allowlist_is_closed_and_masks_signed_words() {
        assert_eq!(
            super::classify_linux_magic(0x0000_ef53),
            Some(FileSystemKind::Ext)
        );
        assert_eq!(
            super::classify_linux_magic(0xffff_ffff_9123_683e),
            Some(FileSystemKind::Btrfs)
        );
        assert_eq!(
            super::classify_linux_magic(0x794c_7630),
            Some(FileSystemKind::Overlayfs)
        );
        assert_eq!(super::classify_linux_magic(0x6969), None);
    }
}
