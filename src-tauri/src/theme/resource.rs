//! `F050` S3's whitelisted resource read: given a package id and a
//! package-relative path, serves the exact bytes of that resource — but only
//! when the path appears in that package's own [`StoredThemePackageManifest::resources`]
//! whitelist (see that field's own doc comment for what populates it and
//! why). This is deliberately narrower than "any file under the package
//! directory": `package.json` (the unpacked package's raw manifest) and
//! `manifest.plain.json` (this domain's own stored record) both live inside
//! the same directory but are never in `resources`, so neither is ever
//! servable through this path.

use std::io::Read;

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::record::{read_single_package, validate_package_id};
use super::{theme_resource_not_found, MAX_THEME_ENTRY_BYTES};

/// Reads `relative`'s bytes out of `package_id`'s finalized package
/// directory under `root` (the theme library root), after confirming
/// `relative` is a member of that exact package's validated resource
/// whitelist. Every failure mode — unknown package, malformed package id,
/// path not in the whitelist, whitelisted path missing or unreadable, path
/// larger than the original per-entry import cap — collapses to
/// [`theme_resource_not_found`] (see that function's own doc comment for why
/// "not whitelisted" and "unreadable" are never distinguished).
pub(crate) fn read_resource(
    root: &Dir,
    package_id: &str,
    relative: &RelativePath,
) -> Result<Vec<u8>, CommandError> {
    let record = read_single_package(root, package_id).map_err(|_| theme_resource_not_found())?;
    if !record
        .resources
        .iter()
        .any(|entry| entry == relative.as_wire())
    {
        return Err(theme_resource_not_found());
    }

    // `validate_package_id` was already run by `read_single_package` above;
    // re-deriving the directory name here keeps this function's own
    // capability-relative open independent of that call's internal details.
    let package_name = validate_package_id(package_id).map_err(|_| theme_resource_not_found())?;
    let package_dir = root
        .open_dir_nofollow(&package_name)
        .map_err(|_| theme_resource_not_found())?;

    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let file = package_dir
        .open_with(relative.as_path(), &options)
        .map_err(|_| theme_resource_not_found())?;
    let metadata = file.metadata().map_err(|_| theme_resource_not_found())?;
    if !metadata.is_file() || metadata.len() > MAX_THEME_ENTRY_BYTES {
        return Err(theme_resource_not_found());
    }

    let capacity = usize::try_from(metadata.len()).unwrap_or(0);
    let mut bytes = Vec::with_capacity(capacity);
    let read_limit = MAX_THEME_ENTRY_BYTES
        .checked_add(1)
        .ok_or_else(theme_resource_not_found)?;
    file.take(read_limit)
        .read_to_end(&mut bytes)
        .map_err(|_| theme_resource_not_found())?;
    if bytes.len() as u64 > MAX_THEME_ENTRY_BYTES {
        return Err(theme_resource_not_found());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests;
