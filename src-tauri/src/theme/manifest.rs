//! Parses and validates `extension/package.json` (JSONC) out of a still-open
//! `theme::unpack::Staging` session — the manifest half of `F050` S2's
//! staging → validated → semantically identified loop (see `theme::import`).
//!
//! Scope, matching the frozen S2 plan exactly:
//! - `name`, `publisher`, `version` are required, individually charset/length
//!   whitelisted, and together derive the package's semantic identity
//!   `publisher.name@version`.
//! - `engines` is tolerated (present or not, any shape) and never inspected.
//! - `contributes.themes[]` is required and non-empty (an import with none
//!   is rejected outright: `THEME_PACKAGE_NO_THEMES`); each entry's
//!   `uiTheme` must be one of the four upstream values and `path` must
//!   resolve to a file actually present in this import's unpack manifest.
//! - `contributes.iconThemes`/`contributes.productIconThemes`, if present,
//!   are carried through into the stored record completely unvalidated —
//!   `F050` F060 handles them; this slice never inspects their shape or
//!   resources.
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
use std::str::FromStr;

use jsonc_parser::{parse_to_value, JsonObject, JsonValue};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::relative_path::resolve_theme_relative;
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

/// A fully validated `package.json`, ready for `theme_json` to walk each
/// contribution's document and, if every one passes, for `theme::import` to
/// finalize the package under [`ValidatedManifest::semantic_id`].
#[derive(Debug)]
pub(crate) struct ValidatedManifest {
    pub(crate) publisher: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) themes: Vec<ThemeContribution>,
    pub(crate) icon_themes: Option<serde_json::Value>,
    pub(crate) product_icon_themes: Option<serde_json::Value>,
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

    let Some(JsonValue::Object(contributes)) = root.get("contributes") else {
        return Err(theme_package_no_themes());
    };
    let Some(JsonValue::Array(themes_value)) = contributes.get("themes") else {
        return Err(theme_package_no_themes());
    };
    if themes_value.is_empty() {
        return Err(theme_package_no_themes());
    }

    let mut themes = Vec::with_capacity(themes_value.len());
    for entry in themes_value.iter() {
        themes.push(parse_theme_contribution(entry, files)?);
    }

    let icon_themes = contributes.get("iconThemes").map(json_to_serde);
    let product_icon_themes = contributes.get("productIconThemes").map(json_to_serde);

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

/// Converts a parsed `jsonc_parser::JsonValue` into a `serde_json::Value`,
/// used only to carry `iconThemes`/`productIconThemes` through into the
/// stored record completely unexamined (`F050` F060 owns validating them).
fn json_to_serde(value: &JsonValue<'_>) -> serde_json::Value {
    match value {
        JsonValue::Null => serde_json::Value::Null,
        JsonValue::Boolean(boolean) => serde_json::Value::Bool(*boolean),
        JsonValue::Number(number) => serde_json::Number::from_str(number)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        JsonValue::String(value) => serde_json::Value::String(value.as_ref().to_owned()),
        JsonValue::Array(array) => {
            serde_json::Value::Array(array.iter().map(json_to_serde).collect())
        }
        JsonValue::Object(object) => {
            let mut map = serde_json::Map::new();
            for (key, entry_value) in object.clone().into_iter() {
                map.insert(key.into_owned(), json_to_serde(&entry_value));
            }
            serde_json::Value::Object(map)
        }
    }
}

#[cfg(test)]
mod tests;
