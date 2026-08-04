//! Plain's own versioned, pinned known-hosts store — ADR 0006 §3. One flat
//! JSON array of `(host, port, algorithm, sha256Fingerprint)` records lives
//! in `<app_local_data_dir>/remote/known-hosts.plain.json`, written with the
//! exact staged-atomic-write idiom `trust::store`/`backup::store` already
//! audit (stage into a fresh high-entropy name, `sync_all`, read back and
//! hash-verify, then publish with a portable overwrite-capable rename).
//!
//! An array of records (not a `{"host:port": …}` map) is deliberate: `host`
//! may itself legitimately contain `:` (an IPv6 literal), so a composite
//! string key would need its own escaping discipline for no real benefit —
//! `read_known_hosts`/`write_known_hosts` always deal in the whole small
//! list, exactly like `trust::store`'s own whole-set read-modify-write
//! precedent, and every real query is a linear scan over what is expected to
//! be a handful of pinned hosts.
//!
//! Corruption fails closed to an **empty** store, not a hard I/O error — the
//! identical safety direction `trust::store::read_trusted`'s own doc comment
//! explains: an unreadable/malformed file must never be silently treated as
//! "every host is still pinned" (that would be a false sense of continuity
//! after an external edit), so it instead becomes "every host is unknown
//! again", which only ever costs the user one extra confirmation dialog, not
//! a silently-bypassed trust decision.

use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::CommandError;

use super::remote_host_key_store_unavailable;

const KNOWN_HOSTS_FILE_NAME: &str = "known-hosts.plain.json";
const STAGE_PREFIX: &str = ".plain-remote-known-hosts-";
const MAX_STAGING_ATTEMPTS: usize = 16;
/// Generous ceiling given each entry is a handful of short strings: bounds
/// even a pathologically large pinned-host set far below any realistic
/// value, purely as a defensive read/parse ceiling — mirrors
/// `trust::store::MAX_TRUST_FILE_BYTES`'s identical purpose.
const MAX_KNOWN_HOSTS_FILE_BYTES: u64 = 1024 * 1024;
/// Bounds how many distinct `(host, port)` pins this store ever holds —
/// enforced on write, so a pathological caller cannot grow the file
/// unboundedly one pin at a time.
const MAX_KNOWN_HOSTS_ENTRIES: usize = 4_096;

/// One pinned entry — the on-disk record shape (`snake_case` in the JSON
/// file; this store is Plain's own internal format, not a wire DTO, so it
/// does not need to match [`super::dto::RemoteHostKeyEntry`]'s `camelCase`
/// IPC shape).
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct KnownHostEntry {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) algorithm: String,
    pub(crate) sha256_fingerprint: String,
}

fn known_hosts_key(host: &str, port: u16) -> (String, u16) {
    (host.to_owned(), port)
}

/// Reads every pinned entry, keyed by `(host, port)` — see the module doc for
/// the fail-closed-to-empty contract on any read/parse failure.
pub(crate) fn read_known_hosts(dir: &Dir) -> BTreeMap<(String, u16), KnownHostEntry> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let Ok(mut file) = dir.open_with(KNOWN_HOSTS_FILE_NAME, &options) else {
        return BTreeMap::new();
    };
    let Ok(metadata) = file.metadata() else {
        return BTreeMap::new();
    };
    if !metadata.is_file() || metadata.len() > MAX_KNOWN_HOSTS_FILE_BYTES {
        return BTreeMap::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return BTreeMap::new();
    }
    parse_known_hosts(&bytes).unwrap_or_default()
}

fn parse_known_hosts(bytes: &[u8]) -> Option<BTreeMap<(String, u16), KnownHostEntry>> {
    let entries: Vec<KnownHostEntry> = serde_json::from_slice(bytes).ok()?;
    if entries.len() > MAX_KNOWN_HOSTS_ENTRIES {
        return None;
    }
    let mut map = BTreeMap::new();
    for entry in entries {
        if entry.host.is_empty()
            || entry.algorithm.is_empty()
            || entry.sha256_fingerprint.is_empty()
        {
            // A single malformed record invalidates the whole file, mirroring
            // `trust::store::parse_trusted`'s identical "partially parseable
            // is still ambiguous, fail closed" discipline.
            return None;
        }
        let key = known_hosts_key(&entry.host, entry.port);
        if map.insert(key, entry).is_some() {
            // A duplicate (host, port) pair can never be produced by this
            // module's own writer (`write_known_hosts` always replaces
            // in-place) — a foreign edit that introduces one is exactly the
            // kind of ambiguous state the module doc says must fail closed.
            return None;
        }
    }
    Some(map)
}

/// Publishes `entries` as the new whole-set contents, replacing whatever
/// previously existed. Caller must already hold the domain's write gate (see
/// `session::RemoteSessionState::known_hosts_gate`) — this function alone
/// does not serialize concurrent writers.
pub(crate) fn write_known_hosts(
    dir: &Dir,
    entries: &BTreeMap<(String, u16), KnownHostEntry>,
) -> Result<(), CommandError> {
    if entries.len() > MAX_KNOWN_HOSTS_ENTRIES {
        return Err(remote_host_key_store_unavailable());
    }
    let payload: Vec<&KnownHostEntry> = entries.values().collect();
    let content = serde_json::to_vec(&payload).map_err(|_| remote_host_key_store_unavailable())?;
    if content.len() as u64 > MAX_KNOWN_HOSTS_FILE_BYTES {
        return Err(remote_host_key_store_unavailable());
    }

    let mut stage = create_stage(dir)?;
    stage
        .file
        .write_all(&content)
        .map_err(|_| remote_host_key_store_unavailable())?;
    stage
        .file
        .sync_all()
        .map_err(|_| remote_host_key_store_unavailable())?;
    verify_stage(&mut stage.file, &content)?;

    dir.rename(&stage.name, dir, KNOWN_HOSTS_FILE_NAME)
        .map_err(|_| remote_host_key_store_unavailable())?;
    stage.published = true;
    Ok(())
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
            Err(_) => return Err(remote_host_key_store_unavailable()),
        }
    }
    Err(remote_host_key_store_unavailable())
}

fn verify_stage(file: &mut File, expected: &[u8]) -> Result<(), CommandError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| remote_host_key_store_unavailable())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 4096];
    let mut observed = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| remote_host_key_store_unavailable())?;
        if read == 0 {
            break;
        }
        observed = observed
            .checked_add(read as u64)
            .ok_or_else(remote_host_key_store_unavailable)?;
        if observed > MAX_KNOWN_HOSTS_FILE_BYTES {
            return Err(remote_host_key_store_unavailable());
        }
        hasher.update(&buffer[..read]);
    }
    let matches = observed == expected.len() as u64
        && hasher.finalize().as_slice() == Sha256::digest(expected).as_slice();
    if matches {
        Ok(())
    } else {
        Err(remote_host_key_store_unavailable())
    }
}

#[cfg(test)]
mod tests {
    use cap_std::ambient_authority;
    use cap_std::fs::Dir;
    use tempfile::TempDir;

    use super::{read_known_hosts, write_known_hosts, KnownHostEntry};

    fn open_temp_dir() -> (TempDir, Dir) {
        let temp = TempDir::new().expect("tempdir creates");
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open tempdir");
        (temp, dir)
    }

    fn entry(host: &str, port: u16) -> KnownHostEntry {
        KnownHostEntry {
            host: host.to_owned(),
            port,
            algorithm: "ssh-ed25519".to_owned(),
            sha256_fingerprint: "SHA256:abc".to_owned(),
        }
    }

    #[test]
    fn read_of_a_missing_file_is_empty() {
        let (_temp, dir) = open_temp_dir();
        assert!(read_known_hosts(&dir).is_empty());
    }

    #[test]
    fn write_then_read_round_trips_and_leaves_no_stage_residue() {
        let (temp, dir) = open_temp_dir();
        let mut entries = std::collections::BTreeMap::new();
        entries.insert(("example.com".to_owned(), 22), entry("example.com", 22));
        entries.insert(("example.com".to_owned(), 2222), entry("example.com", 2222));
        write_known_hosts(&dir, &entries).unwrap();

        assert_eq!(read_known_hosts(&dir), entries);

        let names: Vec<String> = std::fs::read_dir(temp.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["known-hosts.plain.json".to_owned()]);
    }

    #[test]
    fn a_host_containing_a_colon_ipv6_literal_round_trips_distinctly_from_its_port() {
        let (_temp, dir) = open_temp_dir();
        let mut entries = std::collections::BTreeMap::new();
        entries.insert(("2001:db8::1".to_owned(), 22), entry("2001:db8::1", 22));
        write_known_hosts(&dir, &entries).unwrap();
        assert_eq!(read_known_hosts(&dir), entries);
    }

    #[test]
    fn writing_twice_replaces_rather_than_accumulates() {
        let (_temp, dir) = open_temp_dir();
        let mut first = std::collections::BTreeMap::new();
        first.insert(("a.example".to_owned(), 22), entry("a.example", 22));
        write_known_hosts(&dir, &first).unwrap();

        let mut second = std::collections::BTreeMap::new();
        second.insert(("b.example".to_owned(), 22), entry("b.example", 22));
        write_known_hosts(&dir, &second).unwrap();

        assert_eq!(read_known_hosts(&dir), second);
    }

    #[test]
    fn a_file_that_is_not_json_at_all_falls_back_to_empty() {
        let (temp, dir) = open_temp_dir();
        std::fs::write(temp.path().join("known-hosts.plain.json"), b"not json").unwrap();
        assert!(read_known_hosts(&dir).is_empty());
    }

    #[test]
    fn a_record_with_an_empty_host_falls_back_to_empty() {
        let (temp, dir) = open_temp_dir();
        std::fs::write(
            temp.path().join("known-hosts.plain.json"),
            br#"[{"host":"","port":22,"algorithm":"ssh-ed25519","sha256_fingerprint":"SHA256:x"}]"#,
        )
        .unwrap();
        assert!(read_known_hosts(&dir).is_empty());
    }

    #[test]
    fn a_duplicate_host_port_pair_falls_back_to_empty() {
        let (temp, dir) = open_temp_dir();
        std::fs::write(
            temp.path().join("known-hosts.plain.json"),
            br#"[
                {"host":"a","port":22,"algorithm":"ssh-ed25519","sha256_fingerprint":"SHA256:x"},
                {"host":"a","port":22,"algorithm":"ssh-ed25519","sha256_fingerprint":"SHA256:y"}
            ]"#,
        )
        .unwrap();
        assert!(read_known_hosts(&dir).is_empty());
    }

    #[test]
    fn an_oversized_file_falls_back_to_empty() {
        let (temp, dir) = open_temp_dir();
        let oversized = vec![b' '; super::MAX_KNOWN_HOSTS_FILE_BYTES as usize + 1];
        std::fs::write(temp.path().join("known-hosts.plain.json"), oversized).unwrap();
        assert!(read_known_hosts(&dir).is_empty());
    }

    #[test]
    fn a_directory_at_the_expected_filename_falls_back_to_empty() {
        let (temp, dir) = open_temp_dir();
        std::fs::create_dir(temp.path().join("known-hosts.plain.json")).unwrap();
        assert!(read_known_hosts(&dir).is_empty());
    }

    #[test]
    fn removing_one_entry_leaves_the_others_intact() {
        let (_temp, dir) = open_temp_dir();
        let mut entries = std::collections::BTreeMap::new();
        entries.insert(("keep".to_owned(), 22), entry("keep", 22));
        entries.insert(("drop".to_owned(), 22), entry("drop", 22));
        write_known_hosts(&dir, &entries).unwrap();

        entries.remove(&("drop".to_owned(), 22));
        write_known_hosts(&dir, &entries).unwrap();

        let read = read_known_hosts(&dir);
        assert_eq!(read.len(), 1);
        assert!(read.contains_key(&("keep".to_owned(), 22)));
    }
}
