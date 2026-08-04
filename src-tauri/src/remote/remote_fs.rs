//! `F220` S3: the remote-SSH workspace filesystem implementation — every
//! `russh_sftp` client call in the crate lives here (ADR 0007 §1's "SFTP 使用
//! 唯一归属 remote 域" guard), exposing a small set of plain, backend-agnostic
//! async functions that `workspace::remote_backend` converts to/from the
//! existing `workspace::dto` wire types. This module never imports anything
//! from `workspace::` and never touches `std::fs`/`tokio::fs` — every byte in
//! and out crosses the live SFTP channel [`session::RemoteSessionService::open_sftp`]
//! opens on demand for exactly one operation (see that method's own doc
//! comment for the chosen "one channel per operation" shape).
//!
//! # Path re-validation (ADR 0007 §1)
//!
//! Every operation resolves its target by joining the root's canonical
//! `base_path` with the caller's already-validated [`RelativePath`] (which
//! can never itself contain `..`, an absolute component, or a NUL byte —
//! see `path_policy::RelativePath::parse_wire`), then re-validates the
//! result with the SFTP server's own `realpath`, requiring it to still land
//! under `base_path`. This is what actually catches a symlink *inside* the
//! tree that points outside it — the syntactic check on the wire path alone
//! cannot. [`resolve_existing`] handles the common "the full target must
//! already exist" case; [`resolve_new_leaf`] handles the create/rename-
//! target/publish case where only the *parent* is guaranteed to exist yet.
//!
//! # Disclosed limitation: weaker version tokens and non-atomic overwrite
//!
//! SFTP exposes no inode, device, mode, or link-count — only `size` and a
//! one-second-resolution `mtime`. [`remote_version_token`] is therefore a
//! coarser, `(host-key fingerprint, base path, relative path, size, mtime)`
//! hash rather than local's full identity+mode+ownership binding
//! ([`super::super::workspace::version`] is local-only and never imported
//! here) — two distinct writes landing on the same path with the same size
//! within the same wall-clock second are indistinguishable to this scheme.
//! Overwriting an existing file also cannot use local's single atomic
//! `renameat` publish: SFTP v3's `SSH_FXP_RENAME` fails outright if the
//! destination exists, so [`write_file`] stages the new content under a
//! temporary name, removes the existing target, then renames the stage into
//! place — a real (if narrow) window between the remove and the rename
//! where the path does not exist, unlike local's single-syscall swap. This
//! is exactly the difference ADR 0007 §3's own research doc asked to be
//! "如实记录" rather than hidden behind a false atomicity claim. Creating a
//! brand-new file ([`create_file`]/[`publish_file`]) and directory
//! ([`create_directory`]) and [`rename_entry`] all stay genuinely atomic:
//! each is implemented with the one SFTP primitive (`OpenFlags::EXCLUDE`,
//! `mkdir`, or `rename`) that already fails outright if the target exists,
//! exactly like local's own `create_new`/`renameat`-without-`RENAME_EXCHANGE`
//! primitives.

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::fs::Metadata as SftpMetadata;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{OpenFlags, StatusCode};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::RemoteSessionId;
use super::session::RemoteSessionService;

/// Mirrors `workspace::reader::MAX_FILE_BYTES` — the read/version-eligible
/// write ceiling is kept numerically identical across both backends even
/// though the two modules never share a constant (crossing the `remote`/
/// `workspace` boundary for a bare `usize` is not worth the coupling).
pub(crate) const MAX_FILE_BYTES: u64 = 8 * 1_024 * 1_024;
/// Mirrors `workspace::reader::MAX_DIRECTORY_ENTRIES`.
const MAX_DIRECTORY_ENTRIES: usize = 10_000;
/// Mirrors `workspace::reader::MAX_ENTRY_NAME_BYTES`.
const MAX_ENTRY_NAME_BYTES: usize = 1_024;
/// Mirrors `workspace::reader::MAX_DIRECTORY_NAME_PAYLOAD_BYTES`.
const MAX_DIRECTORY_NAME_PAYLOAD_BYTES: usize = 2 * 1_024 * 1_024;
/// A defensive ceiling on any single remote absolute-path string this module
/// ever holds (a `realpath` result, a picker-supplied absolute path) — well
/// above any real filesystem's own path-length limit, purely a hostile-input
/// backstop against an SFTP server that returns something absurd.
const MAX_REMOTE_PATH_CHARS: usize = 8_192;
/// Ceiling on how many descendant entries one recursive delete may remove —
/// bounds the recursion's total work against a hostile/huge remote tree.
const MAX_DELETE_ENTRIES: u32 = 20_000;
/// The largest JS-safe integer — matches `workspace::reader`'s own
/// `MAX_JS_SAFE_INTEGER` ceiling for a size/time value crossing IPC as an
/// `f64`-backed `number`.
const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

const VERSION_DOMAIN: &[u8] = b"plain.workspace.file-version.remote-ssh.v1\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RemoteEntryKind {
    File,
    Directory,
    Symlink,
    SymlinkFile,
    SymlinkDirectory,
    Other,
}

#[derive(Clone, Debug)]
pub(crate) struct RemoteEntryStat {
    pub(crate) kind: RemoteEntryKind,
    pub(crate) size: u64,
    pub(crate) mtime_ms: u64,
    /// Always `0` — SFTP v3 exposes no creation time. Mirrors
    /// `workspace::reader::stat_from_metadata`'s own `unwrap_or(0)`
    /// "unavailable" sentinel rather than inventing a new convention.
    pub(crate) ctime_ms: u64,
    pub(crate) version: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct RemoteDirEntry {
    pub(crate) name: String,
    pub(crate) kind: RemoteEntryKind,
}

#[derive(Debug)]
pub(crate) struct RemoteReadFileResult {
    pub(crate) stat: RemoteEntryStat,
    pub(crate) content: Vec<u8>,
}

#[derive(Debug)]
pub(crate) struct RemoteDeleteReport {
    /// `true` when the named entry (and, for a directory, every descendant)
    /// was removed.
    pub(crate) fully_deleted: bool,
    pub(crate) removed_entries: u32,
}

#[derive(Debug)]
pub(crate) struct RemotePickedEntry {
    pub(crate) name: String,
    /// Always [`RemoteEntryKind::Directory`] by construction (only
    /// directories are ever pushed into a page) — kept as a field rather
    /// than dropped so a future richer picker (e.g. showing files too) has
    /// somewhere to put a real value without a wire-shape change; the
    /// current `remote_workspace_pick_directory` response intentionally
    /// omits it (see `remote::commands::remote_workspace_pick_directory`).
    #[allow(dead_code)]
    pub(crate) kind: RemoteEntryKind,
}

#[derive(Debug)]
pub(crate) struct RemoteDirectoryPage {
    pub(crate) canonical_path: String,
    /// `None` only when `canonical_path` is the filesystem root (`"/"`).
    pub(crate) parent_path: Option<String>,
    pub(crate) entries: Vec<RemotePickedEntry>,
    pub(crate) total: usize,
    pub(crate) offset: usize,
    pub(crate) has_more: bool,
}

/// Root of every remote filesystem operation: opens exactly one SFTP
/// channel, performs one logical operation, then lets the channel close
/// (see `RemoteSessionService::open_sftp`'s own doc comment).
async fn open(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
) -> Result<SftpSession, CommandError> {
    remote.open_sftp(window_label, session_id).await
}

fn map_sftp_error(error: SftpError) -> CommandError {
    match error {
        SftpError::Status(status) => match status.status_code {
            StatusCode::NoSuchFile => super::remote_entry_not_found(),
            StatusCode::PermissionDenied => CommandError::new(
                "PERMISSION_DENIED",
                "The workspace entry cannot be accessed.",
            ),
            _ => super::remote_io_failed(),
        },
        _ => super::remote_sftp_unavailable(),
    }
}

fn validate_remote_path_shape(path: &str) -> Result<(), CommandError> {
    if path.is_empty() || path.len() > MAX_REMOTE_PATH_CHARS || path.contains('\0') {
        return Err(super::remote_path_request_invalid());
    }
    Ok(())
}

/// Joins `base_path` with an already-validated workspace-relative path using
/// SFTP's own `/`-separator convention (SFTP is always POSIX-style on the
/// wire, regardless of the connecting client's own platform).
fn join_remote_path(base_path: &str, relative: &RelativePath) -> String {
    if relative.is_root() {
        return base_path.to_owned();
    }
    let trimmed = base_path.trim_end_matches('/');
    if trimmed.is_empty() {
        format!("/{}", relative.as_wire())
    } else {
        format!("{trimmed}/{}", relative.as_wire())
    }
}

/// `true` when `candidate` is `base_path` itself or a proper descendant of
/// it — a plain string-prefix check with an explicit separator boundary so
/// `/home/user2` is never mistaken for being under `/home/user`.
fn is_within_base(base_path: &str, candidate: &str) -> bool {
    if candidate == base_path {
        return true;
    }
    let trimmed = base_path.trim_end_matches('/');
    let prefix = if trimmed.is_empty() {
        "/".to_owned()
    } else {
        format!("{trimmed}/")
    };
    candidate.starts_with(&prefix)
}

/// The ADR 0007 §1 re-validation chokepoint: `realpath`s `path` (which must
/// already exist) and fails closed with [`super::remote_path_outside_root`]
/// unless the result is still under `base_path`.
async fn realpath_within_base(
    sftp: &SftpSession,
    base_path: &str,
    path: &str,
) -> Result<String, CommandError> {
    validate_remote_path_shape(path)?;
    let real = sftp.canonicalize(path).await.map_err(map_sftp_error)?;
    if real.is_empty() || real.len() > MAX_REMOTE_PATH_CHARS || real.contains('\0') {
        return Err(super::remote_path_outside_root());
    }
    if !is_within_base(base_path, &real) {
        return Err(super::remote_path_outside_root());
    }
    Ok(real)
}

/// Resolves and re-validates a target that must already exist.
async fn resolve_existing(
    sftp: &SftpSession,
    base_path: &str,
    relative: &RelativePath,
) -> Result<String, CommandError> {
    let candidate = join_remote_path(base_path, relative);
    realpath_within_base(sftp, base_path, &candidate).await
}

/// Resolves a target whose leaf need not exist yet (create/mkdir/publish/
/// rename-target/write-staging): re-validates only the *parent* (which must
/// already exist and be a directory) via `realpath`, then appends the
/// syntactically-validated leaf name without realpath'ing it. Returns
/// `(canonical_parent, leaf_name, full_target_path)`.
async fn resolve_new_leaf(
    sftp: &SftpSession,
    base_path: &str,
    relative: &RelativePath,
) -> Result<(String, String, String), CommandError> {
    let wire = relative.as_wire();
    let (parent_wire, leaf) = wire.rsplit_once('/').unwrap_or(("", wire));
    let parent_relative =
        RelativePath::parse_wire(parent_wire).map_err(|_| super::remote_path_outside_root())?;
    let candidate_parent = join_remote_path(base_path, &parent_relative);
    let canonical_parent = realpath_within_base(sftp, base_path, &candidate_parent).await?;
    let parent_attrs = sftp
        .metadata(canonical_parent.clone())
        .await
        .map_err(map_sftp_error)?;
    if !parent_attrs.is_dir() {
        return Err(super::remote_entry_type_mismatch());
    }
    let trimmed = canonical_parent.trim_end_matches('/');
    let target = if trimmed.is_empty() {
        format!("/{leaf}")
    } else {
        format!("{trimmed}/{leaf}")
    };
    Ok((canonical_parent, leaf.to_owned(), target))
}

fn remote_version_token(
    host_key_fingerprint: &str,
    base_path: &str,
    relative_wire: &str,
    size: u64,
    mtime_seconds: u32,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(VERSION_DOMAIN);
    for field in [host_key_fingerprint, base_path, relative_wire] {
        let bytes = field.as_bytes();
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
    hasher.update(size.to_be_bytes());
    hasher.update(mtime_seconds.to_be_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(68);
    token.push_str("wv1:");
    for byte in digest {
        token.push(char::from(HEX[usize::from(byte >> 4)]));
        token.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    token
}

fn classify_attrs(attrs: &SftpMetadata) -> RemoteEntryKind {
    if attrs.is_dir() {
        RemoteEntryKind::Directory
    } else if attrs.is_regular() {
        RemoteEntryKind::File
    } else if attrs.is_symlink() {
        RemoteEntryKind::Symlink
    } else {
        RemoteEntryKind::Other
    }
}

/// lstat's, then (only for a symlink) stat's through it — mirrors
/// `workspace::reader::classify_metadata`'s identical two-step shape, so a
/// broken symlink degrades to `Symlink` rather than erroring.
async fn kind_and_attrs(
    sftp: &SftpSession,
    path: &str,
) -> Result<(RemoteEntryKind, SftpMetadata), CommandError> {
    let link_attrs = sftp
        .symlink_metadata(path.to_owned())
        .await
        .map_err(map_sftp_error)?;
    if !link_attrs.is_symlink() {
        return Ok((classify_attrs(&link_attrs), link_attrs));
    }
    match sftp.metadata(path.to_owned()).await {
        Ok(target_attrs) if target_attrs.is_dir() => {
            Ok((RemoteEntryKind::SymlinkDirectory, target_attrs))
        }
        Ok(target_attrs) if target_attrs.is_regular() => {
            Ok((RemoteEntryKind::SymlinkFile, target_attrs))
        }
        _ => Ok((RemoteEntryKind::Symlink, link_attrs)),
    }
}

fn entry_stat_from_attrs(
    kind: RemoteEntryKind,
    attrs: &SftpMetadata,
    host_key_fingerprint: &str,
    base_path: &str,
    relative: &RelativePath,
) -> Result<RemoteEntryStat, CommandError> {
    let size = attrs.size.unwrap_or(0);
    if size > MAX_JS_SAFE_INTEGER {
        return Err(super::remote_io_failed());
    }
    let mtime_seconds = attrs.mtime.unwrap_or(0);
    let mtime_ms = u64::from(mtime_seconds)
        .saturating_mul(1_000)
        .min(MAX_JS_SAFE_INTEGER);
    let version = matches!(kind, RemoteEntryKind::File).then(|| {
        remote_version_token(
            host_key_fingerprint,
            base_path,
            relative.as_wire(),
            size,
            mtime_seconds,
        )
    });
    Ok(RemoteEntryStat {
        kind,
        size,
        mtime_ms,
        ctime_ms: 0,
        version,
    })
}

pub(crate) async fn stat(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    host_key_fingerprint: &str,
    relative: &RelativePath,
) -> Result<RemoteEntryStat, CommandError> {
    let sftp = open(remote, window_label, session_id).await?;
    let target = join_remote_path(base_path, relative);
    let canonical = realpath_within_base(&sftp, base_path, &target).await?;
    let (kind, attrs) = kind_and_attrs(&sftp, &canonical).await?;
    entry_stat_from_attrs(kind, &attrs, host_key_fingerprint, base_path, relative)
}

pub(crate) async fn read_directory(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    relative: &RelativePath,
) -> Result<Vec<RemoteDirEntry>, CommandError> {
    read_directory_with_limit(
        remote,
        window_label,
        session_id,
        base_path,
        relative,
        MAX_DIRECTORY_ENTRIES,
    )
    .await
}

/// Test-only twin of [`read_directory`] that lets `remote_fs::tests` inject
/// a small `max_entries` so the "directory listing exceeds the bounded
/// entry-count ceiling" scenario does not need to actually create
/// [`MAX_DIRECTORY_ENTRIES`] real files on disk — the identical injected-
/// small-value-for-testability rationale `remote::session::RemoteSessionService::connect_for_test_with_timeout`
/// documents for itself. No non-test caller ever reaches this.
#[cfg(test)]
pub(crate) async fn read_directory_for_test_with_limit(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    relative: &RelativePath,
    max_entries: usize,
) -> Result<Vec<RemoteDirEntry>, CommandError> {
    read_directory_with_limit(
        remote,
        window_label,
        session_id,
        base_path,
        relative,
        max_entries,
    )
    .await
}

async fn read_directory_with_limit(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    relative: &RelativePath,
    max_entries: usize,
) -> Result<Vec<RemoteDirEntry>, CommandError> {
    let sftp = open(remote, window_label, session_id).await?;
    let target = join_remote_path(base_path, relative);
    let canonical = realpath_within_base(&sftp, base_path, &target).await?;
    let attrs = sftp
        .metadata(canonical.clone())
        .await
        .map_err(map_sftp_error)?;
    if !attrs.is_dir() {
        return Err(super::remote_entry_type_mismatch());
    }
    let read_dir = sftp
        .read_dir(canonical.clone())
        .await
        .map_err(map_sftp_error)?;
    let mut entries = Vec::new();
    let mut name_payload_bytes = 0_usize;
    for dir_entry in read_dir {
        if entries.len() >= max_entries {
            return Err(super::remote_directory_too_large());
        }
        let name = dir_entry.file_name();
        if name.is_empty() || name.len() > MAX_ENTRY_NAME_BYTES {
            return Err(super::remote_directory_too_large());
        }
        let parsed = RelativePath::parse_wire(&name).map_err(|_| {
            CommandError::new(
                "PATH_ENCODING_UNSUPPORTED",
                "The workspace entry name cannot be represented safely.",
            )
        })?;
        if parsed.is_root() || parsed.as_wire() != name || name.contains('/') {
            return Err(CommandError::new(
                "PATH_ENCODING_UNSUPPORTED",
                "The workspace entry name cannot be represented safely.",
            ));
        }
        name_payload_bytes = name_payload_bytes
            .checked_add(name.len())
            .ok_or_else(super::remote_directory_too_large)?;
        if name_payload_bytes > MAX_DIRECTORY_NAME_PAYLOAD_BYTES {
            return Err(super::remote_directory_too_large());
        }
        let metadata = dir_entry.metadata();
        let kind = if metadata.is_symlink() {
            let child_path = dir_entry.path();
            let (kind, _) = kind_and_attrs(&sftp, &child_path).await?;
            kind
        } else {
            classify_attrs(&metadata)
        };
        entries.push(RemoteDirEntry { name, kind });
    }
    entries.sort_unstable_by(|left, right| left.name.as_bytes().cmp(right.name.as_bytes()));
    Ok(entries)
}

pub(crate) async fn read_file(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    host_key_fingerprint: &str,
    relative: &RelativePath,
) -> Result<RemoteReadFileResult, CommandError> {
    read_file_with_limit(
        remote,
        window_label,
        session_id,
        base_path,
        host_key_fingerprint,
        relative,
        MAX_FILE_BYTES,
    )
    .await
}

/// Test-only twin of [`read_file`] that lets `remote_fs::tests` inject a
/// small `max_bytes` so the "read exceeds the bounded file-size ceiling"
/// scenario does not need to actually create an
/// [`MAX_FILE_BYTES`]-sized file on disk — see
/// [`read_directory_for_test_with_limit`]'s identical rationale.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn read_file_for_test_with_limit(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    host_key_fingerprint: &str,
    relative: &RelativePath,
    max_bytes: u64,
) -> Result<RemoteReadFileResult, CommandError> {
    read_file_with_limit(
        remote,
        window_label,
        session_id,
        base_path,
        host_key_fingerprint,
        relative,
        max_bytes,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn read_file_with_limit(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    host_key_fingerprint: &str,
    relative: &RelativePath,
    max_bytes: u64,
) -> Result<RemoteReadFileResult, CommandError> {
    if relative.is_root() {
        return Err(super::remote_entry_type_mismatch());
    }
    let sftp = open(remote, window_label, session_id).await?;
    let canonical = resolve_existing(&sftp, base_path, relative).await?;
    let (kind, attrs) = kind_and_attrs(&sftp, &canonical).await?;
    if !matches!(kind, RemoteEntryKind::File | RemoteEntryKind::SymlinkFile) {
        return Err(super::remote_entry_type_mismatch());
    }
    let size = attrs.size.unwrap_or(0);
    if size > max_bytes {
        return Err(super::remote_file_too_large());
    }
    let mut file = sftp
        .open_with_flags(canonical.clone(), OpenFlags::READ)
        .await
        .map_err(map_sftp_error)?;
    let read_limit = max_bytes
        .checked_add(1)
        .ok_or_else(super::remote_file_too_large)?;
    let mut content = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
    let read = (&mut file)
        .take(read_limit)
        .read_to_end(&mut content)
        .await
        .map_err(|_| super::remote_io_failed())?;
    if read as u64 > max_bytes {
        return Err(super::remote_file_too_large());
    }
    let stat = entry_stat_from_attrs(kind, &attrs, host_key_fingerprint, base_path, relative)?;
    if stat.size != content.len() as u64 {
        return Err(super::remote_file_modified());
    }
    Ok(RemoteReadFileResult { stat, content })
}

async fn write_staged(sftp: &SftpSession, path: &str, content: &[u8]) -> Result<(), CommandError> {
    let mut file = sftp
        .open_with_flags(
            path.to_owned(),
            OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
        )
        .await
        .map_err(map_sftp_error)?;
    file.write_all(content)
        .await
        .map_err(|_| super::remote_io_failed())?;
    file.shutdown()
        .await
        .map_err(|_| super::remote_io_failed())?;
    Ok(())
}

fn staging_name() -> String {
    format!(".plain-write-{}.tmp", Uuid::new_v4().simple())
}

/// Overwrites an existing remote file — the versioned-write path. See the
/// module doc's "Disclosed limitation" section for the staged-then-remove-
/// then-rename publish sequence this uses in place of local's single atomic
/// `renameat`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn write_file(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    host_key_fingerprint: &str,
    relative: &RelativePath,
    expected_version: &str,
    content: &[u8],
) -> Result<RemoteEntryStat, CommandError> {
    if relative.is_root() {
        return Err(super::remote_invalid_write_request());
    }
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(super::remote_file_too_large());
    }
    let sftp = open(remote, window_label, session_id).await?;
    let (canonical_parent, _leaf, target) = resolve_new_leaf(&sftp, base_path, relative).await?;

    let verify_current = |attrs: &SftpMetadata| -> bool {
        attrs.is_regular()
            && remote_version_token(
                host_key_fingerprint,
                base_path,
                relative.as_wire(),
                attrs.size.unwrap_or(0),
                attrs.mtime.unwrap_or(0),
            ) == expected_version
    };

    let initial_attrs = sftp
        .symlink_metadata(target.clone())
        .await
        .map_err(|_| super::remote_file_modified())?;
    if !verify_current(&initial_attrs) {
        return Err(super::remote_file_modified());
    }

    let staged_name = staging_name();
    let staged_path = format!("{}/{staged_name}", canonical_parent.trim_end_matches('/'));
    write_staged(&sftp, &staged_path, content).await?;

    let recheck_attrs = match sftp.symlink_metadata(target.clone()).await {
        Ok(attrs) => attrs,
        Err(_) => {
            let _ = sftp.remove_file(staged_path).await;
            return Err(super::remote_file_modified());
        }
    };
    if !verify_current(&recheck_attrs) {
        let _ = sftp.remove_file(staged_path).await;
        return Err(super::remote_file_modified());
    }

    if sftp.remove_file(target.clone()).await.is_err() {
        let _ = sftp.remove_file(staged_path).await;
        return Err(super::remote_io_failed());
    }
    if sftp.rename(staged_path, target.clone()).await.is_err() {
        // The prior target is gone and the stage failed to publish — an
        // honest `IO_FAILED` rather than a false "written" claim; the
        // frontend already treats this the same way local's own
        // `native_unknown` outcome is treated (refresh and let the user
        // re-check), see `file-system-provider.ts`'s `mapWriteError`.
        return Err(super::remote_io_failed());
    }

    let published = sftp
        .symlink_metadata(target)
        .await
        .map_err(map_sftp_error)?;
    if published.size.unwrap_or(0) != content.len() as u64 {
        return Err(super::remote_io_failed());
    }
    entry_stat_from_attrs(
        RemoteEntryKind::File,
        &published,
        host_key_fingerprint,
        base_path,
        relative,
    )
}

/// Atomically publishes brand-new file content — used by `workspacePublishFile`
/// (no existing target may be present). Uses a staged temp name + rename,
/// which — unlike the overwrite case — stays genuinely atomic: SFTP's
/// `rename` already fails outright if `target` exists, so no remove step is
/// needed here.
pub(crate) async fn publish_file(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    host_key_fingerprint: &str,
    relative: &RelativePath,
    content: &[u8],
) -> Result<RemoteEntryStat, CommandError> {
    if relative.is_root() {
        return Err(super::remote_invalid_write_request());
    }
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(super::remote_file_too_large());
    }
    let sftp = open(remote, window_label, session_id).await?;
    let (canonical_parent, _leaf, target) = resolve_new_leaf(&sftp, base_path, relative).await?;
    let staged_name = staging_name();
    let staged_path = format!("{}/{staged_name}", canonical_parent.trim_end_matches('/'));
    write_staged(&sftp, &staged_path, content).await?;

    if sftp
        .rename(staged_path.clone(), target.clone())
        .await
        .is_err()
    {
        let _ = sftp.remove_file(staged_path).await;
        return Err(match sftp.symlink_metadata(target).await {
            Ok(_) => super::remote_entry_already_exists(),
            Err(_) => super::remote_io_failed(),
        });
    }
    let published = sftp
        .symlink_metadata(target)
        .await
        .map_err(map_sftp_error)?;
    if published.size.unwrap_or(0) != content.len() as u64 {
        return Err(super::remote_io_failed());
    }
    entry_stat_from_attrs(
        RemoteEntryKind::File,
        &published,
        host_key_fingerprint,
        base_path,
        relative,
    )
}

/// Atomically creates a new, empty remote file — `OpenFlags::EXCLUDE`
/// mirrors local's own `create_new(true)` primitive exactly.
pub(crate) async fn create_file(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    relative: &RelativePath,
) -> Result<RemoteEntryStat, CommandError> {
    if relative.is_root() {
        return Err(super::remote_entry_type_mismatch());
    }
    let sftp = open(remote, window_label, session_id).await?;
    let (_parent, _leaf, target) = resolve_new_leaf(&sftp, base_path, relative).await?;
    let opened = sftp
        .open_with_flags(
            target.clone(),
            OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
        )
        .await;
    match opened {
        Ok(mut file) => {
            let _ = file.shutdown().await;
        }
        Err(_) => {
            return Err(match sftp.symlink_metadata(target).await {
                Ok(_) => super::remote_entry_already_exists(),
                Err(_) => super::remote_io_failed(),
            });
        }
    }
    // Mirrors `workspace::writer::created_entry_stat`'s own conservative
    // receipt: the entry is known-empty at the moment of creation, no
    // follow-up stat round trip needed.
    Ok(RemoteEntryStat {
        kind: RemoteEntryKind::File,
        size: 0,
        mtime_ms: 0,
        ctime_ms: 0,
        version: None,
    })
}

pub(crate) async fn create_directory(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    relative: &RelativePath,
) -> Result<RemoteEntryStat, CommandError> {
    if relative.is_root() {
        return Err(super::remote_entry_type_mismatch());
    }
    let sftp = open(remote, window_label, session_id).await?;
    let (_parent, _leaf, target) = resolve_new_leaf(&sftp, base_path, relative).await?;
    if sftp.create_dir(target.clone()).await.is_err() {
        return Err(match sftp.symlink_metadata(target).await {
            Ok(_) => super::remote_entry_already_exists(),
            Err(_) => super::remote_io_failed(),
        });
    }
    Ok(RemoteEntryStat {
        kind: RemoteEntryKind::Directory,
        size: 0,
        mtime_ms: 0,
        ctime_ms: 0,
        version: None,
    })
}

pub(crate) async fn rename_entry(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    source: &RelativePath,
    target: &RelativePath,
) -> Result<(), CommandError> {
    if source.is_root() || target.is_root() {
        return Err(super::remote_entry_type_mismatch());
    }
    if source == target {
        return Err(super::remote_entry_already_exists());
    }
    let sftp = open(remote, window_label, session_id).await?;
    let source_path = resolve_existing(&sftp, base_path, source).await?;
    let (_parent, _leaf, target_path) = resolve_new_leaf(&sftp, base_path, target).await?;
    if sftp.rename(source_path, target_path.clone()).await.is_err() {
        return Err(match sftp.symlink_metadata(target_path).await {
            Ok(_) => super::remote_entry_already_exists(),
            Err(_) => super::remote_io_failed(),
        });
    }
    Ok(())
}

fn recursive_delete<'a>(
    sftp: &'a SftpSession,
    path: String,
    removed: &'a mut u32,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<bool, CommandError>> + Send + 'a>> {
    Box::pin(async move {
        let attrs = match sftp.symlink_metadata(path.clone()).await {
            Ok(attrs) => attrs,
            Err(_) => return Ok(true), // already gone: vacuously fully deleted
        };
        if attrs.is_dir() {
            let read_dir = sftp.read_dir(path.clone()).await.map_err(map_sftp_error)?;
            let mut all_ok = true;
            for entry in read_dir {
                if *removed >= MAX_DELETE_ENTRIES {
                    return Err(super::remote_directory_too_large());
                }
                let child_ok = recursive_delete(sftp, entry.path(), removed).await?;
                all_ok &= child_ok;
            }
            if !all_ok {
                return Ok(false);
            }
            match sftp.remove_dir(path).await {
                Ok(()) => {
                    *removed = removed.saturating_add(1);
                    Ok(true)
                }
                Err(_) => Ok(false),
            }
        } else {
            match sftp.remove_file(path).await {
                Ok(()) => {
                    *removed = removed.saturating_add(1);
                    Ok(true)
                }
                Err(_) => Ok(false),
            }
        }
    })
}

pub(crate) async fn delete_entry(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    base_path: &str,
    relative: &RelativePath,
    recursive: bool,
) -> Result<RemoteDeleteReport, CommandError> {
    if relative.is_root() {
        return Err(super::remote_entry_type_mismatch());
    }
    let sftp = open(remote, window_label, session_id).await?;
    let target = resolve_existing(&sftp, base_path, relative).await?;
    let attrs = sftp
        .symlink_metadata(target.clone())
        .await
        .map_err(map_sftp_error)?;
    if attrs.is_dir() {
        if !recursive {
            return Ok(match sftp.remove_dir(target).await {
                Ok(()) => RemoteDeleteReport {
                    fully_deleted: true,
                    removed_entries: 1,
                },
                Err(_) => RemoteDeleteReport {
                    fully_deleted: false,
                    removed_entries: 0,
                },
            });
        }
        let mut removed = 0_u32;
        let fully_deleted = recursive_delete(&sftp, target, &mut removed).await?;
        Ok(RemoteDeleteReport {
            fully_deleted,
            removed_entries: removed,
        })
    } else {
        Ok(match sftp.remove_file(target).await {
            Ok(()) => RemoteDeleteReport {
                fully_deleted: true,
                removed_entries: 1,
            },
            Err(_) => RemoteDeleteReport {
                fully_deleted: false,
                removed_entries: 0,
            },
        })
    }
}

/// The remote directory picker's own data source (ADR "远程目录选择与 root
/// 授权流") — lists only directories (including symlinks that resolve to
/// one) under `path`, sliced to `[offset, offset + limit)`. Deliberately
/// **not** confined to any `base_path`: this is what the user browses to
/// *choose* a base path in the first place, so it may reach anywhere the
/// connected account can (bounded only by the SFTP server's own OS
/// permissions) — exactly like a native folder picker.
pub(crate) async fn pick_directory(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    path: &str,
    offset: usize,
    limit: usize,
) -> Result<RemoteDirectoryPage, CommandError> {
    validate_remote_path_shape(path)?;
    let sftp = open(remote, window_label, session_id).await?;
    let canonical = sftp
        .canonicalize(path.to_owned())
        .await
        .map_err(map_sftp_error)?;
    if canonical.is_empty() || canonical.len() > MAX_REMOTE_PATH_CHARS {
        return Err(super::remote_path_request_invalid());
    }
    let attrs = sftp
        .metadata(canonical.clone())
        .await
        .map_err(map_sftp_error)?;
    if !attrs.is_dir() {
        return Err(super::remote_entry_type_mismatch());
    }
    let read_dir = sftp
        .read_dir(canonical.clone())
        .await
        .map_err(map_sftp_error)?;
    let mut directories = Vec::new();
    let mut scanned = 0_usize;
    for entry in read_dir {
        scanned += 1;
        if scanned > MAX_DIRECTORY_ENTRIES {
            return Err(super::remote_directory_too_large());
        }
        let name = entry.file_name();
        if name.is_empty() || name.len() > MAX_ENTRY_NAME_BYTES || name.contains('/') {
            continue;
        }
        let metadata = entry.metadata();
        let is_directory = if metadata.is_symlink() {
            sftp.metadata(entry.path())
                .await
                .map(|target| target.is_dir())
                .unwrap_or(false)
        } else {
            metadata.is_dir()
        };
        if is_directory {
            directories.push(RemotePickedEntry {
                name,
                kind: RemoteEntryKind::Directory,
            });
        }
    }
    directories.sort_unstable_by(|left, right| left.name.cmp(&right.name));
    let total = directories.len();
    let bounded_offset = offset.min(total);
    let page_end = bounded_offset.saturating_add(limit).min(total);
    let entries = directories
        .into_iter()
        .skip(bounded_offset)
        .take(page_end - bounded_offset)
        .collect::<Vec<_>>();
    let parent_path = if canonical == "/" {
        None
    } else {
        Some(
            canonical
                .rsplit_once('/')
                .map(|(parent, _)| if parent.is_empty() { "/" } else { parent })
                .unwrap_or("/")
                .to_owned(),
        )
    };
    Ok(RemoteDirectoryPage {
        canonical_path: canonical,
        parent_path,
        entries,
        total,
        offset: bounded_offset,
        has_more: page_end < total,
    })
}

/// Canonicalizes and validates `path` as a candidate remote workspace root —
/// used by `remote_workspace_add_root`. Requires the resolved path to be a
/// directory; returns the canonical absolute path (the future root's
/// `base_path`).
pub(crate) async fn canonicalize_for_root(
    remote: &RemoteSessionService,
    window_label: &str,
    session_id: RemoteSessionId,
    path: &str,
) -> Result<String, CommandError> {
    validate_remote_path_shape(path)?;
    let sftp = open(remote, window_label, session_id).await?;
    let canonical = sftp
        .canonicalize(path.to_owned())
        .await
        .map_err(map_sftp_error)?;
    if canonical.is_empty() || canonical.len() > MAX_REMOTE_PATH_CHARS {
        return Err(super::remote_path_request_invalid());
    }
    let attrs = sftp
        .metadata(canonical.clone())
        .await
        .map_err(map_sftp_error)?;
    if !attrs.is_dir() {
        return Err(super::remote_entry_type_mismatch());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests;
