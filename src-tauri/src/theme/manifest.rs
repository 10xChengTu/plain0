//! Parses and validates `extension/package.json` (JSONC) out of a still-open
//! `theme::unpack::Staging` session — the manifest half of `F050` S2's
//! staging → validated → semantically identified loop (see `theme::import`).
//!
//! Scope, matching the frozen S2 plan exactly:
//! - `name`, `publisher`, `version` are required, individually charset/length
//!   whitelisted, and together derive the package's semantic identity
//!   `publisher.name@version`.
//! - `engines` is tolerated (present or not, any shape) and never inspected.
//! - `contributes.themes[]`, if present, has each entry's `uiTheme`
//!   validated against one of the four upstream values and `path` resolved
//!   to a file actually present in this import's unpack manifest.
//! - `contributes.iconThemes[]`/`contributes.productIconThemes[]` (`F060`
//!   S1, this slice): each entry is validated structurally too — upstream's
//!   own two extension points (`registerFileIconThemeExtensionPoint`/
//!   `registerProductIconThemeExtensionPoint` in `themeExtensionPoints.ts`)
//!   share the identical `{ id, label?, path }` shape, requiring `id` where
//!   `contributes.themes[]` does not. `path` is resolved and checked exactly
//!   like a color theme contribution's; what the referenced document
//!   actually *contains* is `icon_theme_json`/`product_icon_theme_json`'s
//!   job (invoked later, from `theme::import`), not this module's.
//! - **Broadened "no themes" rejection** (`F060`): a package is only
//!   rejected as declaring no theme-family contribution
//!   (`THEME_PACKAGE_NO_THEMES`) when `themes`, `iconThemes` and
//!   `productIconThemes` are *all* empty or absent — previously (F050) an
//!   empty/absent `contributes.themes` alone was rejected outright. A
//!   package that declares only `iconThemes` (no `themes` at all) is now
//!   accepted; see [`parse_and_validate`]'s own aggregate check for exactly
//!   where this is decided. Any field present but not a JSON array (e.g.
//!   `"themes": "nope"`) collapses to "this axis contributes nothing",
//!   exactly like an absent field — never a separate hard failure — but a
//!   structurally malformed *entry inside* an array that IS present still
//!   hard-fails the whole import, unchanged from F050.
//! - `main`/`browser`/`activationEvents` are never read beyond a bare
//!   presence check (`containsCode` in the stored record) — their *values*
//!   are never parsed as anything, let alone executed.
//! - A contribution's `label`, including an NLS placeholder like
//!   `"%displayName%"`, is stored completely verbatim: Plain's Rust layer
//!   never resolves `package.nls.json` substitutions (the frontend already
//!   does this for its own theme picker).

use std::collections::BTreeSet;
use std::io::Read;
use std::path::Path;

use jsonc_parser::{parse_to_value, JsonObject, JsonValue};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::relative_path::resolve_theme_relative;
use super::selection::MAX_THEME_SELECTION_ID_BYTES;
use super::unpack::Staging;
use super::{
    theme_contribution_invalid, theme_contribution_path_invalid, theme_manifest_field_invalid,
    theme_manifest_invalid, theme_manifest_missing, theme_package_no_themes, JSONC_PARSE_OPTIONS,
};

/// The manifest's fixed location at the package root, mirroring VSIX's own
/// `extension/package.json` (already stripped of its `extension/` prefix by
/// `unpack`).
pub(crate) const MANIFEST_FILE_NAME: &str = "package.json";

const MAX_IDENTIFIER_BYTES: usize = 128;
const MAX_VERSION_BYTES: usize = 64;

/// The four upstream `ThemeTypeSelector` values a `uiTheme` field may name;
/// anything else is a malformed contribution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum UiTheme {
    #[serde(rename = "vs")]
    Light,
    #[serde(rename = "vs-dark")]
    Dark,
    #[serde(rename = "hc-black")]
    HighContrastDark,
    #[serde(rename = "hc-light")]
    HighContrastLight,
}

impl UiTheme {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "vs" => Some(Self::Light),
            "vs-dark" => Some(Self::Dark),
            "hc-black" => Some(Self::HighContrastDark),
            "hc-light" => Some(Self::HighContrastLight),
            _ => None,
        }
    }
}

/// One validated `contributes.themes[]` entry.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ThemeContribution {
    /// Stored exactly as written, including an unresolved `%key%` NLS
    /// placeholder — Plain's Rust layer never translates it.
    pub(crate) label: Option<String>,
    pub(crate) ui_theme: UiTheme,
    /// Already validated: resolved against the package root, confirmed
    /// present in this import's unpack manifest.
    pub(crate) path: RelativePath,
}

/// One validated `contributes.iconThemes[]`/`contributes.
/// productIconThemes[]` entry. Reused verbatim for both extension points:
/// upstream's own two JSON schemas (`registerFileIconThemeExtensionPoint`/
/// `registerProductIconThemeExtensionPoint` in `themeExtensionPoints.ts`)
/// declare the exact same shape, `{ id, label?, path }` — only the *document*
/// each `path` points at differs (owned by `icon_theme_json`/`product_icon_
/// theme_json`, not this module).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct IconThemeContribution {
    pub(crate) id: String,
    /// Stored exactly as written, including an unresolved `%key%` NLS
    /// placeholder — same rationale as [`ThemeContribution::label`].
    pub(crate) label: Option<String>,
    /// Already validated: resolved against the package root, confirmed
    /// present in this import's unpack manifest.
    pub(crate) path: RelativePath,
}

/// A fully validated `package.json`, ready for `theme_json`/`icon_theme_
/// json`/`product_icon_theme_json` to walk each contribution's document
/// and, if every one passes, for `theme::import` to finalize the package
/// under [`ValidatedManifest::semantic_id`].
#[derive(Debug)]
pub(crate) struct ValidatedManifest {
    pub(crate) publisher: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) themes: Vec<ThemeContribution>,
    pub(crate) icon_themes: Vec<IconThemeContribution>,
    pub(crate) product_icon_themes: Vec<IconThemeContribution>,
    pub(crate) contains_code: bool,
}

impl ValidatedManifest {
    /// The package's on-disk semantic identity: `publisher.name@version`.
    /// Already confirmed filesystem-name-safe by [`parse_and_validate`] (it
    /// runs this exact string through `RelativePath::parse_wire` before
    /// returning).
    pub(crate) fn semantic_id(&self) -> String {
        format!("{}.{}@{}", self.publisher, self.name, self.version)
    }
}

/// Reads `package.json` out of `staged`, parses it as JSONC, and validates
/// every field this domain cares about. `files` is this import's full
/// unpack manifest (every extracted file's package-relative wire path),
/// used to reject a `contributes.themes[].path` that is well-formed but
/// does not actually name a file this import extracted.
pub(crate) fn parse_and_validate(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
) -> Result<ValidatedManifest, CommandError> {
    let mut file = staged
        .open_file_read(Path::new(MANIFEST_FILE_NAME))
        .map_err(|_| theme_manifest_missing())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|_| theme_manifest_invalid())?;

    let value = parse_to_value(&text, &JSONC_PARSE_OPTIONS)
        .map_err(|_| theme_manifest_invalid())?
        .ok_or_else(theme_manifest_invalid)?;
    let JsonValue::Object(root) = value else {
        return Err(theme_manifest_invalid());
    };

    let publisher = required_identifier(&root, "publisher")?;
    let name = required_identifier(&root, "name")?;
    let version = required_version(&root, "version")?;
    let semantic_id = format!("{publisher}.{name}@{version}");
    // Belt-and-suspenders: the per-field charset whitelists below already
    // keep every individual field filesystem-safe, but the *composed*
    // directory name is what actually gets renamed into place, so it goes
    // through the exact same single-segment validator every other
    // capability-relative rename in this codebase trusts.
    RelativePath::parse_wire(&semantic_id).map_err(|_| theme_manifest_field_invalid())?;

    let contains_code = root.get("main").is_some()
        || root.get("browser").is_some()
        || root.get("activationEvents").is_some();

    let contributes = match root.get("contributes") {
        Some(JsonValue::Object(contributes)) => Some(contributes),
        _ => None,
    };

    let themes = parse_theme_array(contributes, files)?;
    let icon_themes = parse_icon_theme_array(contributes, "iconThemes", files)?;
    let product_icon_themes = parse_icon_theme_array(contributes, "productIconThemes", files)?;

    if themes.is_empty() && icon_themes.is_empty() && product_icon_themes.is_empty() {
        return Err(theme_package_no_themes());
    }

    Ok(ValidatedManifest {
        publisher,
        name,
        version,
        themes,
        icon_themes,
        product_icon_themes,
        contains_code,
    })
}

/// Parses `contributes.themes[]`. Absent, or present but not a JSON array,
/// both collapse to "this package declares zero color theme contributions"
/// — mirrored exactly by [`parse_icon_theme_array`] for the other two
/// extension points — rather than a hard parse failure; the only case that
/// hard-fails the whole import is a *structurally malformed entry inside*
/// an array that IS present (see [`parse_theme_contribution`]). Whether
/// zero contributions across all three axes is itself acceptable is decided
/// once, after all three have been parsed, by [`parse_and_validate`]'s own
/// aggregate check.
fn parse_theme_array(
    contributes: Option<&JsonObject<'_>>,
    files: &BTreeSet<String>,
) -> Result<Vec<ThemeContribution>, CommandError> {
    let Some(JsonValue::Array(array)) = contributes.and_then(|object| object.get("themes")) else {
        return Ok(Vec::new());
    };
    let mut result = Vec::with_capacity(array.len());
    for entry in array.iter() {
        result.push(parse_theme_contribution(entry, files)?);
    }
    Ok(result)
}

/// Parses `contributes.iconThemes[]`/`contributes.productIconThemes[]` —
/// see [`parse_theme_array`]'s own doc comment for the "absent or
/// non-array collapses to empty, a malformed *entry* still hard-fails"
/// contract this mirrors exactly.
fn parse_icon_theme_array(
    contributes: Option<&JsonObject<'_>>,
    field: &'static str,
    files: &BTreeSet<String>,
) -> Result<Vec<IconThemeContribution>, CommandError> {
    let Some(JsonValue::Array(array)) = contributes.and_then(|object| object.get(field)) else {
        return Ok(Vec::new());
    };
    let mut result = Vec::with_capacity(array.len());
    for entry in array.iter() {
        result.push(parse_icon_theme_contribution(entry, files)?);
    }
    Ok(result)
}

fn parse_theme_contribution(
    entry: &JsonValue<'_>,
    files: &BTreeSet<String>,
) -> Result<ThemeContribution, CommandError> {
    let JsonValue::Object(object) = entry else {
        return Err(theme_contribution_invalid());
    };

    let ui_theme = match object.get("uiTheme") {
        Some(JsonValue::String(value)) => {
            UiTheme::parse(value).ok_or_else(theme_contribution_invalid)?
        }
        _ => return Err(theme_contribution_invalid()),
    };

    let path_value = match object.get("path") {
        Some(JsonValue::String(value)) => value.as_ref(),
        _ => return Err(theme_contribution_invalid()),
    };
    let path = resolve_theme_relative(Path::new(""), path_value)
        .map_err(|_| theme_contribution_path_invalid())?;
    if !files.contains(path.as_wire()) {
        return Err(theme_contribution_path_invalid());
    }

    let label = match object.get("label") {
        None => None,
        Some(JsonValue::String(value)) => Some(value.as_ref().to_owned()),
        Some(_) => return Err(theme_contribution_invalid()),
    };

    Ok(ThemeContribution {
        label,
        ui_theme,
        path,
    })
}

/// Parses one `contributes.iconThemes[]`/`contributes.productIconThemes[]`
/// entry — the shared shape [`IconThemeContribution`]'s own doc comment
/// describes. `id` is required and charset/length-checked by
/// [`is_valid_icon_theme_id`]; `path` is resolved and existence-checked
/// exactly like [`parse_theme_contribution`]'s own `path` handling; `label`,
/// if present, must be a string.
fn parse_icon_theme_contribution(
    entry: &JsonValue<'_>,
    files: &BTreeSet<String>,
) -> Result<IconThemeContribution, CommandError> {
    let JsonValue::Object(object) = entry else {
        return Err(theme_contribution_invalid());
    };

    let id = match object.get("id") {
        Some(JsonValue::String(value)) if is_valid_icon_theme_id(value) => {
            value.as_ref().to_owned()
        }
        _ => return Err(theme_contribution_invalid()),
    };

    let path_value = match object.get("path") {
        Some(JsonValue::String(value)) => value.as_ref(),
        _ => return Err(theme_contribution_invalid()),
    };
    let path = resolve_theme_relative(Path::new(""), path_value)
        .map_err(|_| theme_contribution_path_invalid())?;
    if !files.contains(path.as_wire()) {
        return Err(theme_contribution_path_invalid());
    }

    let label = match object.get("label") {
        None => None,
        Some(JsonValue::String(value)) => Some(value.as_ref().to_owned()),
        Some(_) => return Err(theme_contribution_invalid()),
    };

    Ok(IconThemeContribution { id, label, path })
}

/// Upstream's own JSON schema (`registerFileIconThemeExtensionPoint`/
/// `registerProductIconThemeExtensionPoint` in `themeExtensionPoints.ts`)
/// places no charset constraint on this id beyond "non-empty string" —
/// unlike `fontIdRegex` (`^[\w_-]+$`), which upstream only applies to a
/// *font's own* `id` inside an icon theme JSON document (a value embedded
/// verbatim in a generated CSS `font-family`), never to the icon/product-icon
/// theme's own `id` (see `icon_theme_json::validate_font_entry`'s own
/// charset check for that one). Since this id is never used as a
/// filesystem path segment (unlike `name`/`publisher`, which name the
/// package's own directory) and, like a persisted theme selection id, is
/// purely an opaque string the frontend will later compare against a
/// settings value, Plain reuses exactly the same permissive charset
/// `selection::validate_theme_selection_id` already established for that
/// shape: non-empty, bounded length, no control characters.
fn is_valid_icon_theme_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_THEME_SELECTION_ID_BYTES
        && !value.chars().any(char::is_control)
}

fn required_identifier(root: &JsonObject<'_>, field: &'static str) -> Result<String, CommandError> {
    match root.get(field) {
        Some(JsonValue::String(value)) if is_valid_identifier(value) => {
            Ok(value.as_ref().to_owned())
        }
        _ => Err(theme_manifest_field_invalid()),
    }
}

fn required_version(root: &JsonObject<'_>, field: &'static str) -> Result<String, CommandError> {
    match root.get(field) {
        Some(JsonValue::String(value)) if is_valid_version(value) => Ok(value.as_ref().to_owned()),
        _ => Err(theme_manifest_field_invalid()),
    }
}

/// `name`/`publisher` charset: ASCII alphanumeric, `-` and `_`, starting
/// with an alphanumeric character. Deliberately excludes `.` and `@` — the
/// two characters `semantic_id()` uses as separators — so the composed
/// identity is always unambiguous, and excludes anything that would need
/// percent-style escaping on any target filesystem.
fn is_valid_identifier(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_IDENTIFIER_BYTES {
        return false;
    }
    let bytes = value.as_bytes();
    bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|&byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// `version` charset: ASCII alphanumeric, `.`, `-` and `+` (loosely
/// semver-shaped), starting and ending with an alphanumeric character.
fn is_valid_version(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_VERSION_BYTES {
        return false;
    }
    let bytes = value.as_bytes();
    bytes[0].is_ascii_alphanumeric()
        && bytes[bytes.len() - 1].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|&byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
}

#[cfg(test)]
mod tests;
