//! The on-disk stored manifest record (`manifest.plain.json`) every
//! finalized theme package directory carries, and the `theme_list`-shaped
//! library enumeration function that reads them back.
//!
//! No timestamp field is stored at all — not "imported at" via filesystem
//! mtime, not any other clock reading. `theme::import` is a pure,
//! deterministic function of its inputs; recording *when* an import
//! happened would be the one piece of state in this whole domain that is
//! not reproducible from the package bytes plus the validation rules, and
//! nothing in `F050`'s three acceptance criteria needs it. If a later slice
//! needs import provenance, it can add the field then with its own tests
//! for whatever clock source it picks.

use std::path::{Path, PathBuf};

use cap_fs_ext::DirExt;
use cap_std::fs::Dir;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::manifest::UiTheme;
use super::{theme_package_not_found, theme_unavailable};

/// The manifest record's fixed filename inside a finalized package
/// directory. Deliberately distinct from `package.json` (the *unpacked
/// package's own* manifest, still present alongside this file) so the two
/// are never confused.
pub(crate) const RECORD_FILE_NAME: &str = "manifest.plain.json";

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct StoredThemeContribution {
    pub(crate) label: Option<String>,
    pub(crate) ui_theme: UiTheme,
    /// Package-relative wire path (`/`-separated), e.g. `"themes/dark.json"`.
    pub(crate) path: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct StoredThemePackageManifest {
    /// The package's semantic identity — also the package directory's own
    /// name, but stored here too so a record is entirely self-describing.
    pub(crate) id: String,
    pub(crate) publisher: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) themes: Vec<StoredThemeContribution>,
    #[serde(default)]
    pub(crate) icon_themes: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) product_icon_themes: Option<serde_json::Value>,
    pub(crate) contains_code: bool,
    /// Every package-relative wire path `theme::import` actually opened and
    /// validated while checking this package's `contributes.themes[]` —
    /// every top-level `path`, every file reached through an `include`
    /// chain, and every `.tmTheme` file reached through a `tokenColors`
    /// string reference (see `theme_json`'s `resources` out-parameter).
    /// Sorted, deduplicated. This is `F050` S3's read whitelist:
    /// `theme_read_resource` only ever serves a relative path that appears
    /// here — never an arbitrary member of the unpacked package (which would
    /// include `package.json` and this domain's own `manifest.plain.json`,
    /// neither of which any consumer needs or should be able to fetch raw).
    pub(crate) resources: Vec<String>,
}

/// The result of enumerating the theme library: every package whose record
/// parsed cleanly, plus a count of everything else (a corrupt record, a
/// leftover `.plain-theme-*.tmp` staging directory from a crashed import, an
/// unreadable entry, ...). A single bad entry never fails the whole listing.
pub(crate) struct ThemeLibraryListing {
    pub(crate) packages: Vec<StoredThemePackageManifest>,
    pub(crate) skipped: usize,
}

/// Enumerates every finalized package directly under `root` (the theme
/// library root), reading each one's [`RECORD_FILE_NAME`]. Corrupt or
/// unreadable entries are counted in `skipped`, never surfaced as an error —
/// one damaged package must never hide every other package from the list.
pub(crate) fn list_theme_packages(root: &Dir) -> Result<ThemeLibraryListing, CommandError> {
    let mut packages = Vec::new();
    let mut skipped = 0_usize;

    let entries = root.entries().map_err(|_| theme_unavailable())?;
    for entry in entries {
        let Ok(entry) = entry else {
            skipped += 1;
            continue;
        };
        let name = entry.file_name();
        let Ok(metadata) = root.symlink_metadata(Path::new(&name)) else {
            skipped += 1;
            continue;
        };
        if !metadata.is_dir() {
            // Not a directory at all (or a symlink masquerading as one,
            // which `symlink_metadata` — unlike `metadata` — does not
            // follow): never a package this domain itself created.
            skipped += 1;
            continue;
        }
        match read_record(root, Path::new(&name)) {
            Ok(record) => packages.push(record),
            Err(_) => skipped += 1,
        }
    }

    packages.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(ThemeLibraryListing { packages, skipped })
}

fn read_record(
    root: &Dir,
    package_name: &Path,
) -> Result<StoredThemePackageManifest, CommandError> {
    let package_dir = root
        .open_dir_nofollow(package_name)
        .map_err(|_| theme_unavailable())?;
    let text = package_dir
        .read_to_string(RECORD_FILE_NAME)
        .map_err(|_| theme_unavailable())?;
    serde_json::from_str(&text).map_err(|_| theme_unavailable())
}

/// Validates that `package_id` is safe to use as a single library-root child
/// directory name: exactly one [`RelativePath`] segment (no `/`, no `..`,
/// none of the other rejected shapes `RelativePath::parse_wire` already
/// guards). A hostile or malformed id is rejected with the exact same
/// [`theme_package_not_found`] a merely-nonexistent id gets — see that
/// function's own doc comment for why the two are never distinguished.
pub(crate) fn validate_package_id(package_id: &str) -> Result<PathBuf, CommandError> {
    let parsed = RelativePath::parse_wire(package_id).map_err(|_| theme_package_not_found())?;
    if parsed.is_root() || package_id.contains('/') {
        return Err(theme_package_not_found());
    }
    Ok(parsed.as_path().to_owned())
}

/// Reads exactly one package's stored record by id, validating the id shape
/// first and rejecting a symlink masquerading as a package directory (same
/// discipline as [`list_theme_packages`]'s own per-entry check). Every
/// failure — malformed id, no such directory, a symlink, a non-directory, an
/// unreadable or corrupt record — collapses to [`theme_package_not_found`].
pub(crate) fn read_single_package(
    root: &Dir,
    package_id: &str,
) -> Result<StoredThemePackageManifest, CommandError> {
    let name = validate_package_id(package_id)?;
    let metadata = root
        .symlink_metadata(&name)
        .map_err(|_| theme_package_not_found())?;
    if !metadata.is_dir() {
        return Err(theme_package_not_found());
    }
    read_record(root, &name).map_err(|_| theme_package_not_found())
}

#[cfg(test)]
mod tests;
