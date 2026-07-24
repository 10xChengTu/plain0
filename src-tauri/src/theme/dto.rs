//! `F050` S3's camelCase Tauri IPC contract for the theme domain. Kept
//! entirely separate from `theme::record`'s internal, snake-case-serialized
//! `StoredThemePackageManifest` (which is a private on-disk file format, not
//! a wire contract) — the same separation `workspace::dto` keeps from that
//! domain's own internal types.

use serde::{Deserialize, Deserializer, Serialize};

use crate::path_policy::RelativePath;

use super::manifest::UiTheme;
use super::record::{StoredIconThemeContribution, StoredThemePackageManifest};
use super::selection::{PersistedThemeSelection, SelectionUpdate};

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

/// `F060` S3: the wire projection of one `contributes.iconThemes[]`/
/// `contributes.productIconThemes[]` entry — mirrors
/// [`super::record::StoredIconThemeContribution`] verbatim (`id`/`label`/
/// `path`), the same one-to-one field mapping [`ThemeContributionSummary`]
/// already does for its own `contributes.themes[]` twin. Closing the S2 gap
/// this fixes: `theme::record::StoredThemePackageManifest` has carried
/// structurally-validated `icon_themes`/`product_icon_themes` since `F060`
/// S1, but neither `theme_list` nor a successful `theme_import_*` response
/// ever put them on the wire until now, so an imported package's icon
/// themes were validated and stored but functionally undiscoverable by the
/// frontend.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconThemeContributionSummary {
    id: String,
    label: Option<String>,
    path: String,
}

impl From<StoredIconThemeContribution> for IconThemeContributionSummary {
    fn from(contribution: StoredIconThemeContribution) -> Self {
        Self {
            id: contribution.id,
            label: contribution.label,
            path: contribution.path,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePackageSummary {
    id: String,
    publisher: String,
    name: String,
    version: String,
    themes: Vec<ThemeContributionSummary>,
    /// `F060` S3: see [`IconThemeContributionSummary`]'s own doc comment for
    /// why this field now exists at all.
    icon_themes: Vec<IconThemeContributionSummary>,
    product_icon_themes: Vec<IconThemeContributionSummary>,
    /// The exact whitelist `theme_read_resource` checks a `relativePath`
    /// against for this package — see
    /// [`super::record::StoredThemePackageManifest::resources`]'s own doc
    /// comment. Exposed so the frontend knows every resource file it needs
    /// to fetch and `registerFileUrl` (main theme document, `include`
    /// chain, `tokenColors` `.tmTheme` target, icon `iconPath`/font `src`)
    /// without having to re-walk each theme document itself to discover
    /// them.
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
            icon_themes: manifest
                .icon_themes
                .into_iter()
                .map(IconThemeContributionSummary::from)
                .collect(),
            product_icon_themes: manifest
                .product_icon_themes
                .into_iter()
                .map(IconThemeContributionSummary::from)
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

/// `theme_get_selection`'s result: the persisted `settingsId` for each of
/// Plain's three theme axes (color, file icon, product icon — `F060` S3
/// extends this from the single `themeId` field `F050` S4 introduced), or
/// `null` for an axis with nothing stored (never selected on that axis,
/// explicitly cleared, or the stored value was corrupt/invalid — see
/// `theme::selection::read_selection`'s own doc comment for why all three
/// reasons collapse to the same `null`, independently per axis).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSelectionResult {
    theme_id: Option<String>,
    file_icon_theme_id: Option<String>,
    product_icon_theme_id: Option<String>,
}

impl ThemeSelectionResult {
    pub(crate) fn new(selection: PersistedThemeSelection) -> Self {
        Self {
            theme_id: selection.theme_id,
            file_icon_theme_id: selection.file_icon_theme_id,
            product_icon_theme_id: selection.product_icon_theme_id,
        }
    }
}

/// Distinguishes "this field was omitted from the JSON request body" (maps
/// to `None`, via `#[serde(default)]` on the field itself) from "this field
/// was present with an explicit JSON `null`" (maps to `Some(None)`) — the
/// well-known "double option" pattern serde's own blanket `Option<T>`
/// deserialize impl cannot express on its own, because it maps a present
/// `null` to plain `None` exactly like an absent key. Applied via
/// `#[serde(default, deserialize_with = "deserialize_present_field")]` on
/// each of [`ThemeSetSelectionRequest`]'s three fields — see that struct's
/// own doc comment, and `theme::selection`'s module doc comment, for why
/// `theme_set_selection` needs this three-way "leave/clear/set" distinction
/// per axis rather than plain presence-or-absence.
fn deserialize_present_field<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(Some)
}

/// `theme_set_selection`'s request: `F060` S3 extends this from a single
/// `themeId` field to three independent, all-optional axes (`themeId`,
/// `fileIconThemeId`, `productIconThemeId`). Per field: omitting it from
/// the request body leaves that axis's persisted value completely
/// untouched; an explicit `null` clears it; a non-null string replaces it,
/// subject to `theme::selection::validate_theme_selection_id`'s
/// charset/length check. See `theme::selection`'s module doc comment for
/// the full rationale behind this per-field (rather than whole-record-
/// replace) update design, and [`SelectionUpdate`] for how this request is
/// translated into the library's own update type.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeSetSelectionRequest {
    #[serde(default, deserialize_with = "deserialize_present_field")]
    theme_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_field")]
    file_icon_theme_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_field")]
    product_icon_theme_id: Option<Option<String>>,
}

impl ThemeSetSelectionRequest {
    /// Borrows `self` into the library's own `SelectionUpdate` shape —
    /// borrowed rather than owned so applying an update never has to clone a
    /// value it received on the wire only to hand it straight to
    /// `serde_json::to_vec` again a few calls later.
    pub(crate) fn as_update(&self) -> SelectionUpdate<'_> {
        SelectionUpdate {
            theme_id: self.theme_id.as_ref().map(|value| value.as_deref()),
            file_icon_theme_id: self
                .file_icon_theme_id
                .as_ref()
                .map(|value| value.as_deref()),
            product_icon_theme_id: self
                .product_icon_theme_id
                .as_ref()
                .map(|value| value.as_deref()),
        }
    }
}

#[cfg(test)]
mod tests;
