use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use cap_fs_ext::DirExt;
use cap_std::ambient_authority;
use cap_std::fs::Dir;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::record::{list_theme_packages, validate_package_id, ThemeLibraryListing};
use super::{
    resource, selection, theme_io_failed, theme_package_too_large, theme_unavailable,
    MAX_THEME_PACKAGE_ENTRIES,
};

/// Rust-authoritative theme package library rooted at
/// `<app_local_data_dir>/themes/`.
///
/// Mirrors `BackupService`'s bootstrap (`src-tauri/src/backup/service.rs`):
/// the storage root is created (if missing) and opened ambiently exactly
/// once, then cached; every later operation is capability-relative from the
/// cached handle. Unlike the backup domain there is no per-window scoping —
/// the theme library is a single process-wide store — so this type only
/// needs one root handle and one mutation gate.
pub(crate) struct ThemeLibrary {
    base_path: PathBuf,
    gate: Mutex<()>,
    root: Mutex<Option<Dir>>,
}

impl ThemeLibrary {
    pub(crate) fn new(base_path: PathBuf) -> Self {
        Self {
            base_path,
            gate: Mutex::new(()),
            root: Mutex::new(None),
        }
    }

    /// Serializes every import against every other import in this process.
    /// Callers should hold the returned guard for the full unpack-then-publish
    /// span so two concurrent imports cannot interleave their staging
    /// directory bookkeeping.
    pub(crate) fn lock(&self) -> Result<MutexGuard<'_, ()>, CommandError> {
        self.gate.lock().map_err(|_| theme_unavailable())
    }

    /// The sole ambient directory open for the whole theme domain: the
    /// library root is created (if missing) and opened once, then cached.
    /// Every subsequent operation is capability-relative from the cached
    /// handle.
    pub(crate) fn ensure_root(&self) -> Result<Dir, CommandError> {
        let mut root = self.root.lock().map_err(|_| theme_unavailable())?;
        if let Some(dir) = root.as_ref() {
            return dir.try_clone().map_err(|_| theme_unavailable());
        }
        let themes_path = self.base_path.join("themes");
        ensure_directory_ambiently(&themes_path).map_err(|_| theme_unavailable())?;
        let dir = Dir::open_ambient_dir(&themes_path, ambient_authority())
            .map_err(|_| theme_unavailable())?;
        let clone = dir.try_clone().map_err(|_| theme_unavailable())?;
        *root = Some(dir);
        Ok(clone)
    }

    /// The `theme_list`-shaped library enumeration: every finalized package
    /// with a readable `manifest.plain.json` record, plus a count of
    /// anything skipped (a corrupt record, a leftover staging directory
    /// from a crashed import, ...). See `record::list_theme_packages` for
    /// the actual walk.
    pub(crate) fn list_packages(&self) -> Result<ThemeLibraryListing, CommandError> {
        let _guard = self.lock()?;
        let root = self.ensure_root()?;
        list_theme_packages(&root)
    }

    /// `F050` S3's whitelisted resource read — see `resource::read_resource`
    /// for the full contract.
    pub(crate) fn read_resource(
        &self,
        package_id: &str,
        relative: &RelativePath,
    ) -> Result<Vec<u8>, CommandError> {
        let _guard = self.lock()?;
        let root = self.ensure_root()?;
        resource::read_resource(&root, package_id, relative)
    }

    /// Removes an imported package by id. Idempotent: removing an id that
    /// does not name any package (never imported, already removed, or a
    /// malformed selector) is a no-op success rather than an error — the
    /// caller's post-condition ("this package is gone") already holds.
    /// Shares this library's single process-wide gate with every import, so
    /// a remove can never interleave with an in-flight import's staging
    /// bookkeeping (or another remove's directory walk).
    pub(crate) fn remove_package(&self, package_id: &str) -> Result<(), CommandError> {
        let _guard = self.lock()?;
        let root = self.ensure_root()?;

        let Ok(name) = validate_package_id(package_id) else {
            return Ok(());
        };
        let metadata = match root.symlink_metadata(&name) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err(theme_io_failed()),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            // Never a package this domain itself created; refuse to touch
            // it rather than silently treating it as "already gone".
            return Err(theme_io_failed());
        }

        let mut entries_seen = 0_usize;
        remove_directory_contents(&root, &name, &mut entries_seen, 0)?;
        root.remove_dir(&name).map_err(|_| theme_io_failed())
    }

    /// `F050` S4's persisted-selection read — see [`selection::read_selection`]
    /// for the full contract. Shares this library's single gate with every
    /// other operation, so a concurrent import/remove can never observe a
    /// half-written selection file (not that a rename-based publish could
    /// produce one anyway — the gate is defense in depth here, not the sole
    /// safeguard).
    pub(crate) fn get_selection(&self) -> Result<Option<String>, CommandError> {
        let _guard = self.lock()?;
        let root = self.ensure_root()?;
        Ok(selection::read_selection(&root))
    }

    /// `F050` S4's persisted-selection write/clear — see
    /// [`selection::write_selection`] for the full contract.
    pub(crate) fn set_selection(&self, theme_id: Option<&str>) -> Result<(), CommandError> {
        let _guard = self.lock()?;
        let root = self.ensure_root()?;
        selection::write_selection(&root, theme_id)
    }
}

/// Bounded, capability-relative, post-order removal of `name`'s contents
/// (but not `name` itself — the caller removes the now-empty directory).
/// Mirrors `unpack::stage_directory`'s own walk discipline: every directory
/// is opened `nofollow`, a symlink anywhere in the tree is refused rather
/// than followed or blindly unlinked, and both the total entry count
/// ([`MAX_THEME_PACKAGE_ENTRIES`], the same cap import enforces — a package
/// this domain itself created can never legitimately exceed it) and the
/// recursion depth ([`crate::path_policy::MAX_RELATIVE_PATH_SEGMENTS`], the
/// same cap every member's own relative path was already validated against
/// at import time) are re-checked here rather than assumed from those
/// import-time invariants alone.
fn remove_directory_contents(
    parent: &Dir,
    name: &Path,
    entries_seen: &mut usize,
    depth: usize,
) -> Result<(), CommandError> {
    if depth > crate::path_policy::MAX_RELATIVE_PATH_SEGMENTS {
        return Err(theme_package_too_large());
    }
    let dir = parent
        .open_dir_nofollow(name)
        .map_err(|_| theme_io_failed())?;
    let mut child_names = Vec::new();
    for entry in dir.entries().map_err(|_| theme_io_failed())? {
        let entry = entry.map_err(|_| theme_io_failed())?;
        *entries_seen = entries_seen
            .checked_add(1)
            .ok_or_else(theme_package_too_large)?;
        if *entries_seen > MAX_THEME_PACKAGE_ENTRIES {
            return Err(theme_package_too_large());
        }
        child_names.push(entry.file_name());
    }

    for child_name in child_names {
        let child_path = Path::new(&child_name);
        let metadata = dir
            .symlink_metadata(child_path)
            .map_err(|_| theme_io_failed())?;
        if metadata.file_type().is_symlink() {
            return Err(theme_io_failed());
        }
        if metadata.is_dir() {
            remove_directory_contents(&dir, child_path, entries_seen, depth + 1)?;
            dir.remove_dir(child_path).map_err(|_| theme_io_failed())?;
        } else if metadata.is_file() {
            dir.remove_file(child_path).map_err(|_| theme_io_failed())?;
        } else {
            return Err(theme_io_failed());
        }
    }
    Ok(())
}

/// Creates `path`, and any missing ancestor, one level at a time. This is
/// deliberately not a call to an unbounded recursive helper: each level is
/// its own explicit, checked `create_dir` call, bounded by the path's actual
/// depth — mirrors `backup::service::ensure_directory_ambiently`.
fn ensure_directory_ambiently(path: &Path) -> std::io::Result<()> {
    match std::fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| std::io::Error::from(error.kind()))?;
            ensure_directory_ambiently(parent)?;
            match std::fs::create_dir(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(error) => Err(error),
            }
        }
        Err(error) => Err(error),
    }
}

// Kept as a separate `library/tests.rs` file (rather than an inline `mod
// tests { ... }` block, S1's original shape) specifically so a real
// `std::os::unix::fs::symlink` call in
// `remove_package_refuses_to_touch_a_symlink_masquerading_as_a_package`
// below — proving `remove_package` never follows or unlinks through a
// symlinked entry — lands in a file `scripts/plain/boundary-contracts.mjs`'s
// `WORKSPACE_TEST_SOURCE_PATTERN` (`tests.rs`) already exempts from the
// production "no broad symlink creation helpers" scan, exactly like every
// other `theme::*` submodule's own `*/tests.rs` file.
#[cfg(test)]
mod tests;
