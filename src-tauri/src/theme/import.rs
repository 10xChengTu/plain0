//! Ties `unpack` + `manifest` + `theme_json` + `record` together into
//! `F050` S2's whole "staging → validated → semantically identified" loop —
//! the first place in this domain that actually drives a
//! [`crate::theme::library::ThemeLibrary`].
//!
//! Exactly one [`unpack::Staging`] session lives across the entire import:
//! it is built by `unpack::stage_vsix`/`stage_directory` (safe bytes only,
//! S1's scope), read from (never mutated) by `manifest::parse_and_validate`
//! and `theme_json::validate_theme_contribution_document`, and only once
//! every one of those checks has passed is the stored record written into
//! it and the whole tree renamed directly into its final
//! `publisher.name@version` identity via [`unpack::Staging::publish_as`].
//! Any failure at any point — corrupt manifest, a missing theme, a bad
//! include chain, a duplicate `publisher.name@version` already in the
//! library — drops the still-`active` `Staging`, which cleans up every byte
//! this import wrote via the exact same tracked-entry `Drop` guard `unpack`
//! already relies on. There is no intermediate "publish under a placeholder
//! id, then maybe delete a whole tree" step to get this guarantee.
//!
//! No Tauri command calls this yet — `F050` S3's scope — so every entry
//! point here is exercised purely by this module's own Rust tests.
//!
//! `F060` S1 addition: `finalize` also walks `validated.icon_themes`/
//! `validated.product_icon_themes` through `icon_theme_json`/
//! `product_icon_theme_json`, folding their resources into the exact same
//! shared `resources` accumulator used for `validated.themes` — one
//! whitelist per package, not one per theme family.

use std::collections::BTreeSet;
use std::path::Path;

use cap_std::fs::File;

use crate::error::CommandError;

use super::icon_theme_json;
use super::library::ThemeLibrary;
use super::manifest;
use super::product_icon_theme_json;
use super::record::{
    StoredIconThemeContribution, StoredThemeContribution, StoredThemePackageManifest,
    RECORD_FILE_NAME,
};
use super::theme_io_failed;
use super::theme_json;
use super::unpack::{self, Staging};
use super::MAX_INCLUDE_CHAIN_FILES;

/// The outcome of a successful import: the fully validated, now-persisted
/// stored record (identical to what `record::list_theme_packages` would
/// read back for this package).
#[derive(Debug)]
pub(crate) struct ImportedThemePackage {
    pub(crate) manifest: StoredThemePackageManifest,
}

/// Imports an already-opened VSIX (zip) file into `library`, running the
/// whole staging → validate → finalize loop under `library`'s single
/// process-wide import gate.
pub(crate) fn import_vsix(
    library: &ThemeLibrary,
    source: File,
) -> Result<ImportedThemePackage, CommandError> {
    let _guard = library.lock()?;
    let root = library.ensure_root()?;
    let (staged, files) = unpack::stage_vsix(&root, source)?;
    finalize(staged, files)
}

/// Imports an already-unpacked source directory into `library`. Shares
/// every check and the staging/finalize machinery with [`import_vsix`];
/// only the input enumeration differs (delegated to
/// `unpack::stage_directory`).
pub(crate) fn import_directory(
    library: &ThemeLibrary,
    source_path: &Path,
) -> Result<ImportedThemePackage, CommandError> {
    let _guard = library.lock()?;
    let root = library.ensure_root()?;
    let (staged, files) = unpack::stage_directory(&root, source_path)?;
    finalize(staged, files)
}

fn finalize(staged: Staging<'_>, files: Vec<String>) -> Result<ImportedThemePackage, CommandError> {
    let file_set: BTreeSet<String> = files.into_iter().collect();

    let validated = manifest::parse_and_validate(&staged, &file_set)?;

    // Shared across every `contributes.themes[]` entry in this one import —
    // see `theme_json`'s module docs for why this is deliberately not reset
    // per entry the way include-chain cycle detection is. `resources`
    // accumulates the exact same way, becoming the stored record's read
    // whitelist for `F050` S3's `theme_read_resource`. `F060` S1 folds
    // `contributes.iconThemes[]`/`contributes.productIconThemes[]`
    // validation into the exact same shared `resources` accumulator —
    // there is one whitelist per package, not one per theme family.
    let mut budget = MAX_INCLUDE_CHAIN_FILES;
    let mut resources = BTreeSet::new();
    for theme in &validated.themes {
        theme_json::validate_theme_contribution_document(
            &staged,
            &file_set,
            &theme.path,
            &mut budget,
            &mut resources,
        )?;
    }
    for icon_theme in &validated.icon_themes {
        icon_theme_json::validate_icon_theme_document(
            &staged,
            &file_set,
            &icon_theme.path,
            &mut resources,
        )?;
    }
    for product_icon_theme in &validated.product_icon_themes {
        product_icon_theme_json::validate_product_icon_theme_document(
            &staged,
            &file_set,
            &product_icon_theme.path,
            &mut resources,
        )?;
    }

    let id = validated.semantic_id();
    let record = StoredThemePackageManifest {
        id: id.clone(),
        publisher: validated.publisher.clone(),
        name: validated.name.clone(),
        version: validated.version.clone(),
        themes: validated
            .themes
            .iter()
            .map(|contribution| StoredThemeContribution {
                label: contribution.label.clone(),
                ui_theme: contribution.ui_theme,
                path: contribution.path.as_wire().to_owned(),
            })
            .collect(),
        icon_themes: validated
            .icon_themes
            .iter()
            .map(|contribution| StoredIconThemeContribution {
                id: contribution.id.clone(),
                label: contribution.label.clone(),
                path: contribution.path.as_wire().to_owned(),
            })
            .collect(),
        product_icon_themes: validated
            .product_icon_themes
            .iter()
            .map(|contribution| StoredIconThemeContribution {
                id: contribution.id.clone(),
                label: contribution.label.clone(),
                path: contribution.path.as_wire().to_owned(),
            })
            .collect(),
        contains_code: validated.contains_code,
        resources: resources.into_iter().collect(),
    };
    let bytes = serde_json::to_vec(&record).map_err(|_| theme_io_failed())?;

    let mut staged = staged;
    staged.write_new_file(Path::new(RECORD_FILE_NAME), &bytes)?;
    staged.publish_as(&id)?;

    Ok(ImportedThemePackage { manifest: record })
}

#[cfg(test)]
mod tests;
