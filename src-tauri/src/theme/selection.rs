//! `F050` S4: cross-session persistence of the user's currently selected
//! color theme id (upstream's `ColorThemeData#settingsId` — a built-in
//! theme's manifest `id`, e.g. `"Dark Modern"`, or an imported package's own
//! resolved theme label), stored at `<library root>/selection.plain.json` —
//! a sibling of every imported package directory inside the very same
//! [`super::library::ThemeLibrary`] root that already gates every other
//! theme-domain mutation.
//!
//! `F060` S3 extends this same file with two sibling optional fields,
//! `fileIconThemeId`/`productIconThemeId` (upstream's `FileIconThemeData`/
//! `ProductIconThemeData#settingsId` — see `plain-theme-registry.ts`'s own
//! doc comments on why those two axes' `settingsId` is always the
//! manifest's own `id` verbatim, never a label fallback like the color
//! axis). All three selections live in the *same* file and are published
//! through the *same* atomic rename — there is exactly one
//! `selection.plain.json` for the whole library, never three separate
//! files, so a reader always sees a single consistent snapshot of "what is
//! selected on every axis" rather than three independently-torn reads.
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
//! publish_as`]), this is ordinary mutable state: writing updates always
//! replaces whatever was there before via a portable, overwrite-capable
//! rename — the same one [`crate::backup::store::write_entry`] already
//! uses for its own always-replaces semantics, since there is no prior value
//! to preserve or version to gate on here either. Once every axis has been
//! cleared (all three fields `None`), the file is removed outright (mirrors
//! [`crate::backup::store::discard_entry`]'s own idempotent-remove
//! contract) rather than persisting an explicit "everything empty" JSON
//! document — the file's mere absence already means "nothing is selected on
//! any axis", so there is nothing else to encode.
//!
//! ## `theme_set_selection`'s per-field update semantics
//!
//! `ThemeSetSelectionRequest` (`dto.rs`) lets a caller update any subset of
//! the three axes in one request: a field the caller does not even include
//! in the JSON body leaves that axis's persisted value completely
//! untouched, an explicit `null` clears that one axis, and a string sets it
//! (subject to [`validate_theme_selection_id`]). This is the "per-field
//! partial update, merged and republished atomically" design (as opposed to
//! "the caller must always resend the full three-field state, replacing it
//! wholesale") — chosen because Plain's three theme pickers (color, file
//! icon, product icon — see `plain-theme-picker.ts`) each persist their own
//! axis independently, on their own Enter handler, with no reason to know or
//! resend the other two axes' current values. A whole-replace design would
//! force every picker to first `theme_get_selection` before it could
//! `theme_set_selection`, turning one atomic axis update into a
//! read-then-write round trip racy against a concurrent update to a
//! *different* axis from a different picker; the per-field design instead
//! does the read-merge-write entirely inside this one Rust-side call, behind
//! the same [`super::library::ThemeLibrary`] gate every other mutation
//! shares, so the merge itself is race-free.
//!
//! Distinguishing "this field was not included in the request at all" from
//! "this field was included with an explicit JSON `null`" is not something
//! `Option<String>` alone can express (`serde`'s blanket `Option<T>`
//! deserialize impl maps a present `null` to plain `None`, identical to a
//! missing key) — [`super::dto`] threads each field through as
//! `Option<Option<String>>` with a `deserialize_with` helper for exactly
//! this "double option" distinction (the well-known pattern for this
//! problem; see that module's own doc comment on
//! `deserialize_present_field`). [`SelectionUpdate`] below is this module's
//! own, `dto`-independent expression of the same three-way "leave/clear/set"
//! choice per axis, borrowed rather than owned so [`write_selection`] never
//! needs to allocate a fresh `String` for a value it is not actually
//! changing.

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
/// is the library-wide "which theme is active on every axis" pointer, not
/// part of any one package.
pub(crate) const SELECTION_FILE_NAME: &str = "selection.plain.json";

/// Maximum byte length of a persisted theme selection id, shared by all
/// three axes. Generous relative to every real `settingsId` Plain can
/// produce today (a built-in manifest's own `id` is a short ASCII string; an
/// imported package's fallback id is a resource path basename already
/// bounded by [`super::MAX_THEME_ENTRY_NAME_BYTES`] = 255) — this is a
/// defense-in-depth ceiling, not a tight fit to any one source.
pub(crate) const MAX_THEME_SELECTION_ID_BYTES: usize = 256;

const STAGE_PREFIX: &str = ".plain-theme-selection-";
const MAX_STAGING_ATTEMPTS: usize = 16;

// `F060` S3 fix-in-passing: the original `F050` S4 struct had no
// `rename_all`, so the on-disk key was the *Rust field name* verbatim
// (`theme_id`, snake_case) even though every doc comment/test on this file
// already talked about it as `themeId` — a latent inconsistency that never
// surfaced because reading back what this domain's own writer had just
// written is naturally self-consistent either way, and the one test that
// wrote a raw fixture by hand happened to only probe the "value fails
// validation" branch, which collapses to the exact same `None` as "field
// absent under the wrong key" would. Adding `rename_all` here now makes the
// on-disk shape textually match the wire DTO (`dto::ThemeSelectionResult`/
// `ThemeSetSelectionRequest`, both already `camelCase`) — safe to change
// with zero migration path because this is a from-scratch local library
// with no historical on-disk users to preserve compatibility with (the
// same reasoning `record::StoredThemePackageManifest`'s own doc comment
// gives for why it has no `#[serde(default)]` either).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredThemeSelection {
    #[serde(default)]
    theme_id: Option<String>,
    /// `F060` S3: absent entirely in every file a pre-`F060` session ever
    /// wrote — `#[serde(default)]` is exactly the backward-compatibility
    /// seam that makes such an old file still parse cleanly, falling back
    /// to `None` for both new fields rather than failing to deserialize.
    #[serde(default)]
    file_icon_theme_id: Option<String>,
    #[serde(default)]
    product_icon_theme_id: Option<String>,
}

/// The result of reading [`SELECTION_FILE_NAME`] back: the persisted id for
/// each of the three independent axes, or `None` for an axis whose value is
/// missing, was never stored, or itself fails [`validate_theme_selection_id`]
/// (see [`read_selection`]'s own doc comment for the exact per-axis
/// fallback rules).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PersistedThemeSelection {
    pub(crate) theme_id: Option<String>,
    pub(crate) file_icon_theme_id: Option<String>,
    pub(crate) product_icon_theme_id: Option<String>,
}

/// One `theme_set_selection` call's requested per-axis change: `None` means
/// "leave this axis exactly as currently persisted", `Some(None)` means
/// "clear this axis", and `Some(Some(id))` means "set this axis to `id`"
/// (subject to [`validate_theme_selection_id`]). See this module's own doc
/// comment for why this three-way distinction — not a plain `Option<&str>`
/// — is what `theme_set_selection`'s per-field semantics need.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SelectionUpdate<'a> {
    pub(crate) theme_id: Option<Option<&'a str>>,
    pub(crate) file_icon_theme_id: Option<Option<&'a str>>,
    pub(crate) product_icon_theme_id: Option<Option<&'a str>>,
}

impl SelectionUpdate<'_> {
    fn is_no_op(&self) -> bool {
        self.theme_id.is_none()
            && self.file_icon_theme_id.is_none()
            && self.product_icon_theme_id.is_none()
    }
}

/// Validates a theme selection id: non-empty, at most
/// [`MAX_THEME_SELECTION_ID_BYTES`] UTF-8 bytes, and free of every control
/// character (`char::is_control` — this rejects NUL, newlines, escapes and
/// every other C0/C1 control code in one pass, which is exactly the
/// dangerous subset "printable ASCII plus common Unicode" is meant to
/// exclude). This id is never used to name a filesystem entry or otherwise
/// interpreted as a path — it is an opaque string the frontend compares
/// against `ColorThemeData`/`FileIconThemeData`/`ProductIconThemeData`'s own
/// `settingsId` values — so unlike [`crate::path_policy::RelativePath`]/
/// [`super::record::validate_package_id`] there is no `/`, `..`, or
/// Windows-reserved-name concern to enforce here. Shared, unmodified, by all
/// three axes — see this module's own top-level doc comment.
pub(crate) fn validate_theme_selection_id(theme_id: &str) -> Result<(), CommandError> {
    if theme_id.is_empty()
        || theme_id.len() > MAX_THEME_SELECTION_ID_BYTES
        || theme_id.chars().any(char::is_control)
    {
        return Err(theme_selection_invalid());
    }
    Ok(())
}

/// Reads [`SELECTION_FILE_NAME`] back and, for the file as a whole, produces
/// an all-`None` [`PersistedThemeSelection`] — this function cannot fail —
/// for every reason there might be nothing at all usable to report: a
/// missing file, a file that exists but is not a regular file (e.g. a
/// directory or symlink someone else dropped at this exact name), an
/// unreadable file, or malformed JSON that does not even parse as the
/// stored shape. This is deliberate defense in depth against a hand-edited
/// or otherwise corrupted file — this domain's own writer, [`write_selection`],
/// never produces such a value — mirroring how [`super::record::
/// list_theme_packages`] treats a damaged package record as something to
/// skip, never something that fails the whole read.
///
/// Once the file *does* parse as the stored shape, each of the three axes
/// is then validated **independently**: an axis whose stored value is
/// `null`/absent, or itself fails [`validate_theme_selection_id`] (a
/// tampered file could hold a control character or an over-long string that
/// this domain's own writer would never have produced), collapses to `None`
/// for that one axis only — a corrupt/stale value on one axis never drags
/// down the other two, since the three are otherwise completely unrelated
/// identifiers.
pub(crate) fn read_selection(root: &Dir) -> PersistedThemeSelection {
    let Some(stored) = read_stored(root) else {
        return PersistedThemeSelection::default();
    };
    PersistedThemeSelection {
        theme_id: valid_or_none(stored.theme_id),
        file_icon_theme_id: valid_or_none(stored.file_icon_theme_id),
        product_icon_theme_id: valid_or_none(stored.product_icon_theme_id),
    }
}

fn valid_or_none(value: Option<String>) -> Option<String> {
    value.filter(|id| validate_theme_selection_id(id).is_ok())
}

fn read_stored(root: &Dir) -> Option<StoredThemeSelection> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut file = root.open_with(SELECTION_FILE_NAME, &options).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    serde_json::from_str::<StoredThemeSelection>(&text).ok()
}

/// Applies `update` to whatever is currently persisted and republishes the
/// whole three-field record in a single atomic rename — see this module's
/// own top-level doc comment for the full per-field-update rationale.
///
/// A no-op `update` (every axis `None`, i.e. "leave everything exactly as
/// it is") returns `Ok(())` immediately without even opening the library
/// root, let alone staging or renaming a file — a call that changes nothing
/// must have zero observable effect, not a redundant same-content rewrite.
///
/// Every axis actually present in `update` (`Some(Some(id))`) is validated
/// with [`validate_theme_selection_id`] *before* anything already persisted
/// is touched: if any one of them is invalid, the whole call is rejected
/// and every axis — including the ones the caller *did* ask to change
/// validly — is left exactly as it was, mirroring the prior single-axis
/// contract ("a rejected write leaves whatever was previously persisted
/// untouched").
///
/// If, after merging, every one of the three axes is `None`, the file is
/// removed outright (idempotent — removing an already-absent file is
/// success); otherwise the merged three-field record is staged and
/// published over [`SELECTION_FILE_NAME`] with the same portable,
/// overwrite-capable rename this domain's writer has always used.
pub(crate) fn write_selection(root: &Dir, update: SelectionUpdate<'_>) -> Result<(), CommandError> {
    if update.is_no_op() {
        return Ok(());
    }
    if let Some(Some(id)) = update.theme_id {
        validate_theme_selection_id(id)?;
    }
    if let Some(Some(id)) = update.file_icon_theme_id {
        validate_theme_selection_id(id)?;
    }
    if let Some(Some(id)) = update.product_icon_theme_id {
        validate_theme_selection_id(id)?;
    }

    let mut merged = read_selection(root);
    if let Some(value) = update.theme_id {
        merged.theme_id = value.map(str::to_owned);
    }
    if let Some(value) = update.file_icon_theme_id {
        merged.file_icon_theme_id = value.map(str::to_owned);
    }
    if let Some(value) = update.product_icon_theme_id {
        merged.product_icon_theme_id = value.map(str::to_owned);
    }

    if merged.theme_id.is_none()
        && merged.file_icon_theme_id.is_none()
        && merged.product_icon_theme_id.is_none()
    {
        return match root.remove_file(SELECTION_FILE_NAME) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(theme_io_failed()),
        };
    }

    let stored = StoredThemeSelection {
        theme_id: merged.theme_id,
        file_icon_theme_id: merged.file_icon_theme_id,
        product_icon_theme_id: merged.product_icon_theme_id,
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
/// kilobyte, even with all three axes populated) that it does not need that
/// type's streaming/hashed verification, so a plain read-back-and-compare is
/// enough in [`verify_stage`] below.
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
