//! Single-file, staged-atomic-write persistence for the trust domain: the
//! whole trusted-identity set lives in one `trusted.plain.json` file inside
//! the trust storage root, containing a JSON array of
//! [`crate::workspace::WorkspaceRootsIdentity`] hex strings.
//!
//! A single file (rather than one file per identity, `backup::store`'s own
//! per-key layout) was chosen because the *contents* here are never large or
//! independently-sized like a backup entry's editor content: every entry is
//! exactly one fixed-width 64-character SHA-256 hex string, so even a
//! generously large number of ever-granted identities stays a tiny file, and
//! grant/revoke are always whole-set read-modify-write operations anyway (an
//! identity is either in the trusted set or it is not — there is no
//! per-identity content to update independently). This keeps the on-disk
//! layout to exactly one file to reason about, at the cost of every
//! grant/revoke rewriting the whole (tiny) file — an explicit trade-off
//! recorded here rather than left implicit.
//!
//! Persistence reuses the exact staged-atomic-write idiom already audited in
//! `backup::store::write_entry` (stage into a fresh high-entropy name,
//! `sync_all`, read back and hash-verify, then publish with a portable
//! overwrite-capable rename) rather than a shared abstraction: the two
//! staging bodies are a handful of lines each and the two domains' recovery
//! semantics on read differ (backup surfaces `IO_FAILED` on read corruption;
//! trust *fails closed to "distrust everything"* on read corruption instead,
//! see [`read_trusted`]), so factoring out a generic "staged writer" that
//! both callers configure would add more indirection than the duplication it
//! would remove — the same call `text_search.rs`'s module doc makes for its
//! own traversal-loop duplication.

use std::collections::BTreeSet;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, OpenOptions};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::trust_unavailable;
use crate::error::CommandError;

const TRUST_FILE_NAME: &str = "trusted.plain.json";
const STAGE_PREFIX: &str = ".plain-trust-";
const MAX_STAGING_ATTEMPTS: usize = 16;
/// Generous ceiling given each entry is a fixed 64-character hex string: this
/// bounds even a pathologically large trusted-identity set (tens of
/// thousands of distinct root sets ever granted) far below any realistic
/// value, purely as a defensive read/parse ceiling.
const MAX_TRUST_FILE_BYTES: u64 = 1024 * 1024;
const IDENTITY_HEX_LENGTH: usize = 64;

/// Reads the trusted-identity set. Any failure to open, read or parse the
/// file — including a file that exists but contains anything other than a
/// JSON array of well-formed 64-character lowercase hex strings — is treated
/// as an **empty set**, never as an error: this domain's whole safety
/// property is "unclear means untrusted", so a missing file (first run), a
/// torn write from a hard crash between `create_new` and the publishing
/// rename (impossible with this module's own staged-write path, but not
/// something a corrupted external edit is bound to respect), or a foreign
/// edit are all indistinguishable from "nothing has been trusted yet" rather
/// than surfaced as a fatal I/O error that would block the whole domain.
pub(crate) fn read_trusted(dir: &Dir) -> BTreeSet<String> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let Ok(mut file) = dir.open_with(TRUST_FILE_NAME, &options) else {
        return BTreeSet::new();
    };
    let Ok(metadata) = file.metadata() else {
        return BTreeSet::new();
    };
    if !metadata.is_file() || metadata.len() > MAX_TRUST_FILE_BYTES {
        return BTreeSet::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return BTreeSet::new();
    }
    parse_trusted(&bytes).unwrap_or_default()
}

fn parse_trusted(bytes: &[u8]) -> Option<BTreeSet<String>> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let array = value.as_array()?;
    let mut identities = BTreeSet::new();
    for entry in array {
        let identity = entry.as_str()?;
        if !is_valid_identity_hex(identity) {
            // Any single malformed entry invalidates the whole file rather
            // than being skipped: a partially-parseable file is exactly the
            // kind of ambiguous state this module's doc comment says must
            // fail closed to "distrust everything", not silently keep
            // whatever entries happened to look well-formed.
            return None;
        }
        identities.insert(identity.to_owned());
    }
    Some(identities)
}

fn is_valid_identity_hex(value: &str) -> bool {
    value.len() == IDENTITY_HEX_LENGTH
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// Publishes `trusted` as the new whole-set contents, replacing whatever
/// previously existed. Caller must already hold the domain's write gate (see
/// `service::TrustState::gate`) — this function alone does not serialize
/// concurrent writers.
pub(crate) fn write_trusted(dir: &Dir, trusted: &BTreeSet<String>) -> Result<(), CommandError> {
    let payload: Vec<&str> = trusted.iter().map(String::as_str).collect();
    let content = serde_json::to_vec(&payload).map_err(|_| trust_unavailable())?;
    if content.len() as u64 > MAX_TRUST_FILE_BYTES {
        return Err(trust_unavailable());
    }

    let mut stage = create_stage(dir)?;
    stage
        .file
        .write_all(&content)
        .map_err(|_| trust_unavailable())?;
    stage.file.sync_all().map_err(|_| trust_unavailable())?;
    verify_stage(&mut stage.file, &content)?;

    dir.rename(&stage.name, dir, TRUST_FILE_NAME)
        .map_err(|_| trust_unavailable())?;
    stage.published = true;
    Ok(())
}

/// Owns a staged file that is removed on drop unless explicitly published —
/// identical shape to `backup::store`'s own `Stage`.
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
            Err(_) => return Err(trust_unavailable()),
        }
    }
    Err(trust_unavailable())
}

fn verify_stage(file: &mut File, expected: &[u8]) -> Result<(), CommandError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| trust_unavailable())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 4096];
    let mut observed = 0_u64;
    loop {
        let read = file.read(&mut buffer).map_err(|_| trust_unavailable())?;
        if read == 0 {
            break;
        }
        observed = observed
            .checked_add(read as u64)
            .ok_or_else(trust_unavailable)?;
        if observed > MAX_TRUST_FILE_BYTES {
            return Err(trust_unavailable());
        }
        hasher.update(&buffer[..read]);
    }
    let matches = observed == expected.len() as u64
        && hasher.finalize().as_slice() == Sha256::digest(expected).as_slice();
    if matches {
        Ok(())
    } else {
        Err(trust_unavailable())
    }
}

#[cfg(test)]
mod tests {
    use cap_std::ambient_authority;
    use cap_std::fs::Dir;
    use tempfile::TempDir;

    use super::{read_trusted, write_trusted};

    fn open_temp_dir() -> (TempDir, Dir) {
        let temp = TempDir::new().expect("tempdir creates");
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open tempdir");
        (temp, dir)
    }

    /// A well-formed, 64-character lowercase hex identity string built by
    /// repeating one byte 32 times — a convenient deterministic stand-in for
    /// a real `WorkspaceRootsIdentity` (which this module treats as an
    /// opaque validated string, never re-deriving it from paths).
    fn identity(byte: u8) -> String {
        let mut out = String::with_capacity(64);
        for _ in 0..32 {
            out.push_str(&format!("{byte:02x}"));
        }
        out
    }

    #[test]
    fn read_of_a_missing_file_is_an_empty_set() {
        let (_temp, dir) = open_temp_dir();
        assert!(read_trusted(&dir).is_empty());
    }

    #[test]
    fn write_then_read_round_trips_and_leaves_no_stage_residue() {
        let (temp, dir) = open_temp_dir();
        let mut set = std::collections::BTreeSet::new();
        set.insert(identity(0x01));
        set.insert(identity(0x02));
        write_trusted(&dir, &set).unwrap();

        assert_eq!(read_trusted(&dir), set);

        let names: Vec<String> = std::fs::read_dir(temp.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["trusted.plain.json".to_owned()]);
    }

    #[test]
    fn writing_twice_replaces_rather_than_accumulates() {
        let (_temp, dir) = open_temp_dir();
        let mut first = std::collections::BTreeSet::new();
        first.insert(identity(0x01));
        write_trusted(&dir, &first).unwrap();

        let mut second = std::collections::BTreeSet::new();
        second.insert(identity(0x02));
        write_trusted(&dir, &second).unwrap();

        assert_eq!(read_trusted(&dir), second);
    }

    #[test]
    fn empty_set_writes_and_reads_back_empty() {
        let (_temp, dir) = open_temp_dir();
        write_trusted(&dir, &std::collections::BTreeSet::new()).unwrap();
        assert!(read_trusted(&dir).is_empty());
    }

    #[test]
    fn a_file_with_a_malformed_entry_falls_back_to_an_empty_set() {
        let (temp, dir) = open_temp_dir();
        std::fs::write(
            temp.path().join("trusted.plain.json"),
            br#"["not-a-valid-hex-identity"]"#,
        )
        .unwrap();
        assert!(read_trusted(&dir).is_empty());
    }

    #[test]
    fn a_file_that_is_not_json_at_all_falls_back_to_an_empty_set() {
        let (temp, dir) = open_temp_dir();
        std::fs::write(temp.path().join("trusted.plain.json"), b"not json").unwrap();
        assert!(read_trusted(&dir).is_empty());
    }

    #[test]
    fn a_file_that_is_a_json_object_rather_than_an_array_falls_back_to_an_empty_set() {
        let (temp, dir) = open_temp_dir();
        std::fs::write(temp.path().join("trusted.plain.json"), br#"{"a":1}"#).unwrap();
        assert!(read_trusted(&dir).is_empty());
    }

    #[test]
    fn an_oversized_file_falls_back_to_an_empty_set() {
        let (temp, dir) = open_temp_dir();
        let oversized = vec![b' '; super::MAX_TRUST_FILE_BYTES as usize + 1];
        std::fs::write(temp.path().join("trusted.plain.json"), oversized).unwrap();
        assert!(read_trusted(&dir).is_empty());
    }

    #[test]
    fn a_directory_at_the_expected_filename_falls_back_to_an_empty_set() {
        let (temp, dir) = open_temp_dir();
        std::fs::create_dir(temp.path().join("trusted.plain.json")).unwrap();
        assert!(read_trusted(&dir).is_empty());
    }
}
