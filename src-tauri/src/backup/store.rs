use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, OpenOptions};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::CommandError;

use super::{
    backup_io_failed, backup_too_large, BackupKey, MAX_BACKUP_ENTRIES, MAX_BACKUP_ENTRY_BYTES,
};

const STAGE_PREFIX: &str = ".plain-backup-";
const MAX_STAGING_ATTEMPTS: usize = 16;
const READ_BUFFER_BYTES: usize = 64 * 1_024;

/// Stages `content` into a fresh high-entropy name inside `dir`, verifies the
/// staged bytes by reading them back and hashing them, then publishes over
/// `key` with a portable overwrite-capable rename (there is no version token
/// to gate on: a backup write always replaces whatever previously existed
/// for the same key). Any failure removes the stage before returning; if
/// this function returns early in a way it did not anticipate, `Drop` still
/// removes an unpublished stage.
pub(crate) fn write_entry(dir: &Dir, key: &BackupKey, content: &[u8]) -> Result<(), CommandError> {
    if content.len() as u64 > MAX_BACKUP_ENTRY_BYTES {
        return Err(backup_too_large());
    }

    let mut stage = create_stage(dir)?;
    stage
        .file
        .write_all(content)
        .map_err(|_| backup_io_failed())?;
    stage.file.sync_all().map_err(|_| backup_io_failed())?;
    verify_stage(&mut stage.file, content)?;

    dir.rename(&stage.name, dir, key.as_str())
        .map_err(|_| backup_io_failed())?;
    stage.published = true;
    Ok(())
}

/// Owns a staged file that is removed on drop unless explicitly published.
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
            Err(_) => return Err(backup_io_failed()),
        }
    }
    Err(backup_io_failed())
}

fn verify_stage(file: &mut File, expected: &[u8]) -> Result<(), CommandError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| backup_io_failed())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; READ_BUFFER_BYTES];
    let mut observed = 0_u64;
    loop {
        let read = file.read(&mut buffer).map_err(|_| backup_io_failed())?;
        if read == 0 {
            break;
        }
        observed = observed
            .checked_add(read as u64)
            .ok_or_else(backup_too_large)?;
        if observed > MAX_BACKUP_ENTRY_BYTES {
            return Err(backup_too_large());
        }
        hasher.update(&buffer[..read]);
    }
    let matches = observed == expected.len() as u64
        && hasher.finalize().as_slice() == Sha256::digest(expected).as_slice();
    if matches {
        Ok(())
    } else {
        Err(backup_io_failed())
    }
}

/// Enumerates every entry directly inside `dir` whose filename is a valid
/// backup key, returned sorted by key. Anything else (the domain's own
/// leftover `.plain-backup-*.tmp` stage files, unrelated foreign entries,
/// oversized or unreadable files) is silently skipped rather than failing
/// the whole enumeration: this directory is Plain-owned, so an anomaly here
/// is best treated as noise, not a hard error.
pub(crate) fn read_all_entries(dir: &Dir) -> Result<Vec<(String, Vec<u8>)>, CommandError> {
    let mut entries = Vec::new();
    let listing = dir.entries().map_err(|_| backup_io_failed())?;
    for entry in listing {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if BackupKey::parse(name).is_err() {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let Ok(mut file) = dir.open_with(name, &options) else {
            continue;
        };
        let Ok(metadata) = file.metadata() else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_BACKUP_ENTRY_BYTES {
            continue;
        }
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_err() || bytes.len() as u64 > MAX_BACKUP_ENTRY_BYTES {
            continue;
        }
        entries.push((name.to_owned(), bytes));
        if entries.len() > MAX_BACKUP_ENTRIES {
            return Err(backup_io_failed());
        }
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(entries)
}

/// Removing an already-absent key is success, not an error: discard is
/// idempotent.
pub(crate) fn discard_entry(dir: &Dir, key: &BackupKey) -> Result<(), CommandError> {
    match dir.remove_file(key.as_str()) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(backup_io_failed()),
    }
}

/// Best-effort removal of every valid-key entry. A single stubborn entry
/// does not fail the whole call; it simply remains for a future
/// `read_all`/`discard` to observe.
pub(crate) fn discard_all_entries(dir: &Dir) -> Result<(), CommandError> {
    let listing = dir.entries().map_err(|_| backup_io_failed())?;
    for entry in listing {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if BackupKey::parse(name).is_err() {
            continue;
        }
        let _ = dir.remove_file(name);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use cap_std::ambient_authority;
    use cap_std::fs::Dir;
    use tempfile::TempDir;

    use super::{discard_all_entries, discard_entry, read_all_entries, write_entry};
    use crate::backup::BackupKey;

    fn open_temp_dir() -> (TempDir, Dir) {
        let temp = TempDir::new().expect("tempdir creates");
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open tempdir");
        (temp, dir)
    }

    fn key(wire: &str) -> BackupKey {
        BackupKey::parse(wire).expect("valid key")
    }

    #[test]
    fn write_then_read_all_round_trips_content_and_leaves_no_stage_residue() {
        let (temp, dir) = open_temp_dir();
        write_entry(&dir, &key("alpha"), b"hello").unwrap();
        write_entry(&dir, &key("beta"), b"world").unwrap();

        let entries = read_all_entries(&dir).unwrap();
        assert_eq!(
            entries,
            vec![
                ("alpha".to_owned(), b"hello".to_vec()),
                ("beta".to_owned(), b"world".to_vec()),
            ]
        );

        let names: Vec<String> = std::fs::read_dir(temp.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            {
                let mut sorted = names;
                sorted.sort();
                sorted
            },
            vec!["alpha".to_owned(), "beta".to_owned()],
            "no staging temp file should remain on disk"
        );
    }

    #[test]
    fn writing_the_same_key_twice_overwrites_rather_than_accumulating() {
        let (_temp, dir) = open_temp_dir();
        write_entry(&dir, &key("k"), b"first").unwrap();
        write_entry(&dir, &key("k"), b"second-and-longer").unwrap();
        let entries = read_all_entries(&dir).unwrap();
        assert_eq!(
            entries,
            vec![("k".to_owned(), b"second-and-longer".to_vec())]
        );
    }

    #[test]
    fn content_at_the_exact_byte_limit_is_accepted_and_one_byte_more_is_rejected() {
        let (_temp, dir) = open_temp_dir();
        let max_content = vec![0x5a; super::MAX_BACKUP_ENTRY_BYTES as usize];
        write_entry(&dir, &key("max"), &max_content).unwrap();
        assert_eq!(
            read_all_entries(&dir).unwrap(),
            vec![("max".to_owned(), max_content)]
        );

        let oversized = vec![0x5a; super::MAX_BACKUP_ENTRY_BYTES as usize + 1];
        assert_eq!(
            write_entry(&dir, &key("over"), &oversized)
                .unwrap_err()
                .code(),
            "BACKUP_TOO_LARGE"
        );
        assert!(read_all_entries(&dir)
            .unwrap()
            .iter()
            .all(|(name, _)| name != "over"));
    }

    #[test]
    fn read_all_ignores_leftover_stage_files_and_foreign_entries() {
        let (temp, dir) = open_temp_dir();
        write_entry(&dir, &key("kept"), b"payload").unwrap();
        std::fs::write(temp.path().join(".plain-backup-leaked.tmp"), b"leaked").unwrap();
        std::fs::write(temp.path().join("Uppercase"), b"foreign").unwrap();
        std::fs::create_dir(temp.path().join("a-directory")).unwrap();

        let entries = read_all_entries(&dir).unwrap();
        assert_eq!(entries, vec![("kept".to_owned(), b"payload".to_vec())]);
    }

    #[test]
    fn discard_is_idempotent_for_a_key_that_was_never_written() {
        let (_temp, dir) = open_temp_dir();
        discard_entry(&dir, &key("never-existed")).unwrap();
        discard_entry(&dir, &key("never-existed")).unwrap();
    }

    #[test]
    fn discard_removes_exactly_the_named_key() {
        let (_temp, dir) = open_temp_dir();
        write_entry(&dir, &key("keep"), b"a").unwrap();
        write_entry(&dir, &key("drop"), b"b").unwrap();
        discard_entry(&dir, &key("drop")).unwrap();
        assert_eq!(
            read_all_entries(&dir).unwrap(),
            vec![("keep".to_owned(), b"a".to_vec())]
        );
        discard_entry(&dir, &key("drop")).unwrap();
    }

    #[test]
    fn discard_all_removes_every_valid_entry_and_is_idempotent() {
        let (_temp, dir) = open_temp_dir();
        write_entry(&dir, &key("one"), b"1").unwrap();
        write_entry(&dir, &key("two"), b"2").unwrap();
        discard_all_entries(&dir).unwrap();
        assert!(read_all_entries(&dir).unwrap().is_empty());
        discard_all_entries(&dir).unwrap();
    }

    #[test]
    fn writes_from_independently_cloned_handles_leave_no_stage_residue() {
        // `BackupService` serializes concurrent writes with its own gate; this
        // only proves that two sequential writers sharing the same directory
        // capability (as the gate would hand out from its cache) do not leak
        // a stage into each other's way.
        let (temp, dir) = open_temp_dir();
        let first = dir.try_clone().unwrap();
        let second = dir.try_clone().unwrap();
        write_entry(&first, &key("a"), b"1").unwrap();
        write_entry(&second, &key("b"), b"2").unwrap();

        let mut entries = read_all_entries(&dir).unwrap();
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        assert_eq!(
            entries,
            vec![
                ("a".to_owned(), b"1".to_vec()),
                ("b".to_owned(), b"2".to_vec())
            ]
        );

        let residue = std::fs::read_dir(temp.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(super::STAGE_PREFIX)
            })
            .count();
        assert_eq!(residue, 0, "no staging temp file should remain on disk");
    }
}
