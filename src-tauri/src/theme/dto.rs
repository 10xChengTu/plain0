//! `F050` S3's camelCase Tauri IPC contract for the theme domain. Kept
//! entirely separate from `theme::record`'s internal, snake-case-serialized
//! `StoredThemePackageManifest` (which is a private on-disk file format, not
//! a wire contract) — the same separation `workspace::dto` keeps from that
//! domain's own internal types.

use serde::{Deserialize, Serialize};

use crate::path_policy::RelativePath;

use super::manifest::UiTheme;
use super::record::StoredThemePackageManifest;

/// Every `theme_*` command that takes no meaningful input still accepts an
/// explicit `{}` request body (mirroring `WorkspaceCapabilitiesRequest`),
/// rejecting any stray field a hostile or buggy caller might send.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeEmptyRequest {}

impl ThemeEmptyRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContributionSummary {
    label: Option<String>,
    ui_theme: UiTheme,
    path: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePackageSummary {
    id: String,
    publisher: String,
    name: String,
    version: String,
    themes: Vec<ThemeContributionSummary>,
    /// The exact whitelist `theme_read_resource` checks a `relativePath`
    /// against for this package — see
    /// [`super::record::StoredThemePackageManifest::resources`]'s own doc
    /// comment. Exposed so the frontend knows every resource file it needs
    /// to fetch and `registerFileUrl` (main theme document, `include`
    /// chain, `tokenColors` `.tmTheme` target) without having to re-walk
    /// each theme document itself to discover them.
    resources: Vec<String>,
    contains_code: bool,
}

impl From<StoredThemePackageManifest> for ThemePackageSummary {
    fn from(manifest: StoredThemePackageManifest) -> Self {
        Self {
            id: manifest.id,
            publisher: manifest.publisher,
            name: manifest.name,
            version: manifest.version,
            themes: manifest
                .themes
                .into_iter()
                .map(|contribution| ThemeContributionSummary {
                    label: contribution.label,
                    ui_theme: contribution.ui_theme,
                    path: contribution.path,
                })
                .collect(),
            resources: manifest.resources,
            contains_code: manifest.contains_code,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeImportStatus {
    Imported,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeImportResult {
    status: ThemeImportStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    package: Option<ThemePackageSummary>,
}

impl ThemeImportResult {
    pub(crate) fn imported(package: ThemePackageSummary) -> Self {
        Self {
            status: ThemeImportStatus::Imported,
            package: Some(package),
        }
    }

    pub(crate) fn cancelled() -> Self {
        Self {
            status: ThemeImportStatus::Cancelled,
            package: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeListResult {
    packages: Vec<ThemePackageSummary>,
    skipped: usize,
}

impl ThemeListResult {
    pub(crate) fn new(packages: Vec<ThemePackageSummary>, skipped: usize) -> Self {
        Self { packages, skipped }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeReadResourceRequest {
    package_id: String,
    relative_path: RelativePath,
}

impl ThemeReadResourceRequest {
    pub(crate) fn into_parts(self) -> (String, RelativePath) {
        (self.package_id, self.relative_path)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeRemoveRequest {
    package_id: String,
}

impl ThemeRemoveRequest {
    pub(crate) fn into_package_id(self) -> String {
        self.package_id
    }
}

/// `theme_get_selection`'s result: the persisted `settingsId`, or `null` if
/// none is stored (never imported one, explicitly cleared, or the stored
/// file was corrupt/invalid — see `theme::selection::read_selection`'s own
/// doc comment for why all three collapse to the same `null`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSelectionResult {
    theme_id: Option<String>,
}

impl ThemeSelectionResult {
    pub(crate) fn new(theme_id: Option<String>) -> Self {
        Self { theme_id }
    }
}

/// `theme_set_selection`'s request: `themeId: null` clears the persisted
/// selection (falling back to Plain's default theme on next boot); a
/// non-null value replaces whatever was previously persisted, subject to
/// `theme::selection::validate_theme_selection_id`'s charset/length check.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeSetSelectionRequest {
    theme_id: Option<String>,
}

impl ThemeSetSelectionRequest {
    pub(crate) fn into_theme_id(self) -> Option<String> {
        self.theme_id
    }
}

#[cfg(test)]
mod tests;
