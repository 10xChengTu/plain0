use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use cap_std::ambient_authority;
use cap_std::fs::Dir;

use crate::error::CommandError;

use super::theme_unavailable;

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

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::ThemeLibrary;

    #[test]
    fn ensure_root_bootstraps_once_and_is_capability_relative_thereafter() {
        let temp = TempDir::new().expect("tempdir creates");
        let base_path = temp.path().join("app-local-data");
        let library = ThemeLibrary::new(base_path.clone());

        let first = library.ensure_root().expect("root bootstraps");
        let second = library.ensure_root().expect("root reuses cache");

        first
            .create_dir("marker")
            .expect("write through first handle");
        assert!(
            second.is_dir("marker"),
            "second handle must observe writes made through the first, proving \
             both come from the same bootstrapped root"
        );
        assert!(base_path.join("themes").is_dir());
    }

    #[test]
    fn ensure_root_creates_missing_multi_level_app_local_data_dir() {
        let temp = TempDir::new().expect("tempdir creates");
        let base_path = temp.path().join("a").join("b").join("c");
        let library = ThemeLibrary::new(base_path.clone());

        library
            .ensure_root()
            .expect("root bootstraps through missing ancestors");
        assert!(base_path.join("themes").is_dir());
    }

    #[test]
    fn lock_serializes_and_is_reentrant_safe_across_calls() {
        let temp = TempDir::new().expect("tempdir creates");
        let library = ThemeLibrary::new(temp.path().to_path_buf());
        {
            let _guard = library.lock().expect("gate locks");
        }
        let _guard = library.lock().expect("gate locks again after release");
    }
}
