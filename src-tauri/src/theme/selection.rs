//! `F050` S4: cross-session persistence of the user's currently selected
//! color theme id (upstream's `ColorThemeData#settingsId` — a built-in
//! theme's manifest `id`, e.g. `"Dark Modern"`, or an imported package's own
//! resolved theme label), stored at `<library root>/selection.plain.json` —
//! a sibling of every imported package directory inside the very same
//! [`super::library::ThemeLibrary`] root that already gates every other
//! theme-domain mutation.
//!
//! This is deliberately not a package artifact itself: [`super::record::
//! list_theme_packages`] already tolerates (and counts toward `skipped`) any
//! non-directory entry directly in the library root — the exact same
//! leftover-staging-directory tolerance documented on
//! [`super::record::ThemeLibraryListing`] covers this file too, so no
//! special-casing is added there for it.
//!
//! Unlike a package directory (immutable once published — a second import
//! at the same identity is rejected outright, see [`super::unpack::Staging::
//! publish_as`]), this is ordinary mutable state: writing a new selection
//! always replaces whatever was there before via a portable, overwrite-
//! capable rename — the same one [`crate::backup::store::write_entry`]
//! already uses for its own always-replaces semantics, since there is no
//! prior value to preserve or version to gate on here either. Clearing the
//! selection (`theme_id: None`) removes the file outright (mirrors
//! [`crate::backup::store::discard_entry`]'s own idempotent-remove
//! contract) rather than persisting an explicit "empty" JSON document — the
//! file's mere absence already means "no selection", so there is nothing
//! else to encode.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, OpenOptions};
use uuid::Uuid;

use crate::error::CommandError;

use super::{theme_io_failed, theme_selection_invalid};

/// The persisted selection's fixed filename inside the theme library root.
/// Deliberately distinct from [`super::record::RECORD_FILE_NAME`] (which
/// lives one level down, inside each package's own directory) — this file
/// is the library-wide "which theme is active" pointer, not part of any one
/// package.
pub(crate) const SELECTION_FILE_NAME: &str = "selection.plain.json";

/// Maximum byte length of a persisted theme selection id. Generous relative
/// to every real `settingsId` Plain can produce today (a built-in
/// manifest's own `id` is a short ASCII string; an imported package's
/// fallback id is a resource path basename already bounded by
/// [`super::MAX_THEME_ENTRY_NAME_BYTES`] = 255) — this is a defense-in-depth
/// ceiling, not a tight fit to any one source.
pub(crate) const MAX_THEME_SELECTION_ID_BYTES: usize = 256;

const STAGE_PREFIX: &str = ".plain-theme-selection-";
const MAX_STAGING_ATTEMPTS: usize = 16;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
struct StoredThemeSelection {
    #[serde(default)]
    theme_id: Option<String>,
}

/// Validates a theme selection id: non-empty, at most
/// [`MAX_THEME_SELECTION_ID_BYTES`] UTF-8 bytes, and free of every control
/// character (`char::is_control` — this rejects NUL, newlines, escapes and
/// every other C0/C1 control code in one pass, which is exactly the
/// dangerous subset "printable ASCII plus common Unicode" is meant to
/// exclude). This id is never used to name a filesystem entry or otherwise
/// interpreted as a path — it is an opaque string the frontend compares
/// against `ColorThemeData#settingsId` values — so unlike [`crate::
/// path_policy::RelativePath`]/[`super::record::validate_package_id`] there
/// is no `/`, `..`, or Windows-reserved-name concern to enforce here.
fn validate_theme_selection_id(theme_id: &str) -> Result<(), CommandError> {
    if theme_id.is_empty()
        || theme_id.len() > MAX_THEME_SELECTION_ID_BYTES
        || theme_id.chars().any(char::is_control)
    {
        return Err(theme_selection_invalid());
    }
    Ok(())
}

/// Reads the current persisted selection. Returns `None` — this function
/// cannot fail — for every reason there might be nothing usable to report: a
/// missing file, a file that exists but is not a regular file (e.g. a
/// directory or symlink someone else dropped at this exact name), an
/// unreadable file, malformed JSON, an absent/null `themeId` field, or a
/// `themeId` value that itself fails [`validate_theme_selection_id`]. This is
/// deliberate defense in depth against a hand-edited or otherwise corrupted
/// file — this domain's own writer, [`write_selection`], never produces such
/// a value — mirroring how [`super::record::list_theme_packages`] treats a
/// damaged package record as something to skip, never something that fails
/// the whole read.
pub(crate) fn read_selection(root: &Dir) -> Option<String> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut file = root.open_with(SELECTION_FILE_NAME, &options).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    let stored = serde_json::from_str::<StoredThemeSelection>(&text).ok()?;
    let theme_id = stored.theme_id?;
    validate_theme_selection_id(&theme_id).ok()?;
    Some(theme_id)
}

/// Writes (`Some`) or clears (`None`) the persisted selection.
///
/// `Some(theme_id)` validates the id first, then stages a fresh temp file
/// and publishes it over [`SELECTION_FILE_NAME`] with a portable,
/// overwrite-capable rename — a selection write always wins over whatever
/// was there before, so unlike every package-directory publish in this
/// domain there is no "already exists" case to reject.
///
/// `None` removes the file outright; removing an already-absent file is
/// success, matching [`crate::backup::store::discard_entry`]'s own
/// idempotent contract.
pub(crate) fn write_selection(root: &Dir, theme_id: Option<&str>) -> Result<(), CommandError> {
    let Some(theme_id) = theme_id else {
        return match root.remove_file(SELECTION_FILE_NAME) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(theme_io_failed()),
        };
    };
    validate_theme_selection_id(theme_id)?;
    let stored = StoredThemeSelection {
        theme_id: Some(theme_id.to_owned()),
    };
    let content = serde_json::to_vec(&stored).map_err(|_| theme_io_failed())?;

    let mut stage = create_stage(root)?;
    stage
        .file
        .write_all(&content)
        .map_err(|_| theme_io_failed())?;
    stage.file.sync_all().map_err(|_| theme_io_failed())?;
    verify_stage(&mut stage.file, &content)?;

    root.rename(&stage.name, root, SELECTION_FILE_NAME)
        .map_err(|_| theme_io_failed())?;
    stage.published = true;
    Ok(())
}

/// Owns a staged file that is removed on drop unless explicitly published.
/// Mirrors [`crate::backup::store::Stage`] exactly (same fields, same
/// creation-attempt loop, same drop-cleans-up-unless-published contract) —
/// this domain's own persisted content is small enough (well under a
/// kilobyte) that it does not need that type's streaming/hashed
/// verification, so a plain read-back-and-compare is enough in
/// [`verify_stage`] below.
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
            Err(_) => return Err(theme_io_failed()),
        }
    }
    Err(theme_io_failed())
}

fn verify_stage(file: &mut File, expected: &[u8]) -> Result<(), CommandError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| theme_io_failed())?;
    let mut actual = Vec::with_capacity(expected.len());
    file.read_to_end(&mut actual)
        .map_err(|_| theme_io_failed())?;
    if actual == expected {
        Ok(())
    } else {
        Err(theme_io_failed())
    }
}

#[cfg(test)]
mod tests;
