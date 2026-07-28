//! Low-level, per-`(command, args, transport)`-triple persistence for the
//! `debug` domain's first-run confirmation gate (`F100` S1). One file per
//! confirmed [`AdapterConfirmationSubject`], named by its
//! [`confirmation_key`] (a SHA-256 hex digest of the subject's own canonical
//! JSON encoding) inside a caller-supplied, workspace-identity-scoped
//! directory — the exact per-identity-subdirectory layout
//! `backup::service::BackupState`/`BackupService` already establish for
//! per-workspace content (unlike `trust::store`'s single flat
//! `trusted.plain.json`, which is right for a whole-workspace yes/no fact but
//! wrong here: a workspace can have many independently-confirmed adapter
//! descriptors, each needing its own on/off state).
//!
//! # Why the key is a hash of canonical JSON, not a naive joined string
//!
//! A key built by joining `command`/`args`/`transport` with a plain delimiter
//! (e.g. NUL- or space-separated) is ambiguous: `command="a"`,
//! `args=["b","c"]` and `command="ab"`, `args=["c"]` could collide under a
//! careless join. Serializing the subject through `serde_json` first gives an
//! unambiguous, injective encoding (JSON string escaping makes each field's
//! boundary and content unambiguous — this is the same reasoning
//! `workspace::stable_roots_identity`'s own domain-separated hash uses, just
//! via structural JSON encoding rather than length-prefixing) before hashing,
//! so no two distinct subjects can ever produce the same key.
//!
//! # Fail-closed on any anomaly, mirroring `trust::store`
//!
//! [`entry_exists`] treats anything other than "a regular file exists at
//! exactly this key" — I/O errors, a directory where a file was expected, a
//! symlink — as **not confirmed**, never as an error to propagate. This is
//! the same "unclear means untrusted" doctrine `trust::store::read_trusted`'s
//! own doc comment documents: a corrupted or foreign entry must never be
//! silently treated as an affirmative confirmation.

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, OpenOptions};
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use uuid::Uuid;

use crate::error::CommandError;

use super::confirmation_unavailable;
use super::dto::AdapterConfirmationSubject;

const STAGE_PREFIX: &str = ".plain-debug-confirm-";
const MAX_STAGING_ATTEMPTS: usize = 16;
/// An `AdapterConfirmationSubject`'s canonical JSON encoding is bounded only
/// by how many/how long `args` are — real adapter argv lists are a handful of
/// short flags, so this is a generous defensive ceiling against a
/// pathological/hostile config, not an expected value.
const MAX_CONFIRMATION_ENTRY_BYTES: usize = 64 * 1024;

/// The exact on-disk filename for a confirmed subject: a lowercase SHA-256
/// hex digest of the subject's canonical JSON encoding — see the module doc's
/// "why a hash" section. Never derived from user-controlled text directly
/// (JSON serialization happens first), so this is always a safe, fixed
/// `[0-9a-f]{64}` filename component.
pub(crate) fn confirmation_key(
    subject: &AdapterConfirmationSubject,
) -> Result<String, CommandError> {
    let json = serde_json::to_vec(subject).map_err(|_| confirmation_unavailable())?;
    let mut hasher = Sha256::new();
    hasher.update(&json);
    Ok(format!("{:x}", hasher.finalize()))
}

/// `true` only if a regular file exists at exactly this subject's key — see
/// the module doc's "fail-closed" section for why every anomaly (missing,
/// wrong type, unreadable) collapses to `false` rather than an error.
pub(crate) fn entry_exists(dir: &Dir, subject: &AdapterConfirmationSubject) -> bool {
    let Ok(key) = confirmation_key(subject) else {
        return false;
    };
    dir.metadata(&key)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

/// Stages the subject's own canonical JSON, verifies it by reading the staged
/// bytes back and hashing them, then publishes at its key with a portable
/// overwrite-capable rename — the exact `backup::store::write_entry`/
/// `trust::store::write_trusted` staged-atomic-write idiom. Granting an
/// already-granted subject is a harmless no-op overwrite (idempotent, same as
/// every other grant/revoke pair in this codebase).
pub(crate) fn write_entry(
    dir: &Dir,
    subject: &AdapterConfirmationSubject,
) -> Result<(), CommandError> {
    let key = confirmation_key(subject)?;
    let content = serde_json::to_vec(subject).map_err(|_| confirmation_unavailable())?;
    if content.len() > MAX_CONFIRMATION_ENTRY_BYTES {
        return Err(confirmation_unavailable());
    }

    let mut stage = create_stage(dir)?;
    stage
        .file
        .write_all(&content)
        .map_err(|_| confirmation_unavailable())?;
    stage
        .file
        .sync_all()
        .map_err(|_| confirmation_unavailable())?;
    verify_stage(&mut stage.file, &content)?;

    dir.rename(&stage.name, dir, &key)
        .map_err(|_| confirmation_unavailable())?;
    stage.published = true;
    Ok(())
}

/// Removing an already-absent key is success, not an error — revoke is
/// idempotent, mirroring `backup::store::discard_entry`/
/// `trust::service::TrustService::revoke`.
pub(crate) fn discard_entry(
    dir: &Dir,
    subject: &AdapterConfirmationSubject,
) -> Result<(), CommandError> {
    let key = confirmation_key(subject)?;
    match dir.remove_file(&key) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(confirmation_unavailable()),
    }
}

/// Owns a staged file that is removed on drop unless explicitly published —
/// identical shape to `backup::store`/`trust::store`'s own `Stage`.
struct Stage<'a> {
    dir: &'a Dir,
    name: PathBuf,
    file: File,
    published: bool,
}

impl Drop for Stage<'_> {
    fn drop(&mut self) {
        if !self.published {
            let _ = self.dir.remove_file(&self.name);
        }
    }
}

fn create_stage(dir: &Dir) -> Result<Stage<'_>, CommandError> {
    for _ in 0..MAX_STAGING_ATTEMPTS {
        let name = PathBuf::from(format!("{STAGE_PREFIX}{}.tmp", Uuid::new_v4().simple()));
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        match dir.open_with(&name, &options) {
            Ok(file) => {
                return Ok(Stage {
                    dir,
                    name,
                    file,
                    published: false,
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(confirmation_unavailable()),
        }
    }
    Err(confirmation_unavailable())
}

fn verify_stage(file: &mut File, expected: &[u8]) -> Result<(), CommandError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| confirmation_unavailable())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 4096];
    let mut observed = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| confirmation_unavailable())?;
        if read == 0 {
            break;
        }
        observed = observed
            .checked_add(read as u64)
            .ok_or_else(confirmation_unavailable)?;
        if observed > MAX_CONFIRMATION_ENTRY_BYTES as u64 {
            return Err(confirmation_unavailable());
        }
        hasher.update(&buffer[..read]);
    }
    let matches = observed == expected.len() as u64
        && hasher.finalize().as_slice() == Sha256::digest(expected).as_slice();
    if matches {
        Ok(())
    } else {
        Err(confirmation_unavailable())
    }
}

#[cfg(test)]
mod tests;
