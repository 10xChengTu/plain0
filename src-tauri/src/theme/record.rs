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

use std::path::Path;

use cap_fs_ext::DirExt;
use cap_std::fs::Dir;

use crate::error::CommandError;

use super::manifest::UiTheme;
use super::theme_unavailable;

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

#[cfg(test)]
mod tests;
