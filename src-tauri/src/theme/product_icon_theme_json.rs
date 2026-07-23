//! Validates a `contributes.productIconThemes[].path` document — upstream's
//! `productIconThemeSchema.ts`/`_loadProductIconThemeDocument` shape — out of
//! a still-open `theme::unpack::Staging` session. `F060` S1's second
//! icon-family document validator, sharing [`super::icon_theme_json::
//! validate_font_entry`] verbatim with the file icon theme validator (see
//! that function's own doc comment for why: identical `fonts[]` shape,
//! identical resource-safety contract).
//!
//! The one hard structural requirement upstream itself enforces at the
//! whole-document level (`_loadProductIconThemeDocument`: `!contentValue.
//! iconDefinitions || !Array.isArray(contentValue.fonts) || !contentValue.
//! fonts.length` rejects the whole load) is mirrored exactly here: `fonts`
//! must be a non-empty array and `iconDefinitions` must be a JSON object, or
//! the whole document is rejected (Plain requires `iconDefinitions` to
//! actually be object-shaped rather than merely present/truthy — a
//! deliberate tightening of upstream's own looser JS truthiness check, which
//! would also accept a non-object-but-truthy value like a non-empty
//! string).
//!
//! Everything *inside* those two required fields — an individual malformed
//! font, an icon definition missing `fontCharacter`, an unknown `fontId` —
//! is upstream's own well-documented per-entry leniency (skip, never reject
//! the whole file), which Plain mirrors for the same reason
//! `icon_theme_json` does: none of that is a filesystem-safety concern, and
//! this slice does not consume `iconDefinitions` entries for anything
//! (no CSS-generation-equivalent exists yet — that is `F060` S2's job).
//! `iconDefinitions` entries here never carry an `iconPath` at all (unlike a
//! file icon theme's) — upstream's own `IconDefinition` shape for a product
//! icon theme is `{ fontCharacter, fontId? }` only — so there is nothing to
//! resolve or sanitize there; only `fonts[].src[]` ever names a resource.
//! [`crate::theme::MAX_ICON_ASSOCIATIONS`] still bounds `iconDefinitions`'
//! own entry count here, for the same defense-in-depth reason
//! `icon_theme_json` bounds its own association maps.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::Path;

use jsonc_parser::{parse_to_value, JsonValue};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::icon_theme_json::validate_font_entry;
use super::unpack::Staging;
use super::{
    theme_icon_too_many_associations, theme_product_icon_json_invalid, JSONC_PARSE_OPTIONS,
    MAX_ICON_ASSOCIATIONS,
};

/// Validates the document a single `contributes.productIconThemes[]` entry
/// points at. `resources` accumulates every file this call actually opened
/// and judged safe — the document itself, plus every `fonts[].src[].path`
/// it references — shared across every entry in one package import, same
/// as `icon_theme_json::validate_icon_theme_document`.
pub(crate) fn validate_product_icon_theme_document(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
    path: &RelativePath,
    resources: &mut BTreeSet<String>,
) -> Result<(), CommandError> {
    resources.insert(path.as_wire().to_owned());

    let text = read_staged_text(staged, path)?;
    let value = parse_to_value(&text, &JSONC_PARSE_OPTIONS)
        .map_err(|_| theme_product_icon_json_invalid())?
        .ok_or_else(theme_product_icon_json_invalid)?;
    let JsonValue::Object(root) = value else {
        return Err(theme_product_icon_json_invalid());
    };

    let Some(JsonValue::Array(fonts)) = root.get("fonts") else {
        return Err(theme_product_icon_json_invalid());
    };
    if fonts.is_empty() {
        return Err(theme_product_icon_json_invalid());
    }
    let Some(JsonValue::Object(icon_definitions)) = root.get("iconDefinitions") else {
        return Err(theme_product_icon_json_invalid());
    };
    if icon_definitions.len() > MAX_ICON_ASSOCIATIONS {
        return Err(theme_icon_too_many_associations());
    }

    let base_dir = path.as_path().parent().unwrap_or(Path::new(""));
    for font in fonts.iter() {
        validate_font_entry(staged, files, base_dir, font, resources)?;
    }

    Ok(())
}

fn read_staged_text(staged: &Staging<'_>, path: &RelativePath) -> Result<String, CommandError> {
    let mut file = staged
        .open_file_read(path.as_path())
        .map_err(|_| theme_product_icon_json_invalid())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|_| theme_product_icon_json_invalid())?;
    Ok(text)
}

#[cfg(test)]
mod tests;
