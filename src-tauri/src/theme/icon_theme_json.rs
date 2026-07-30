//! Validates one `contributes.iconThemes[].path` document — a "file icon
//! theme" JSON, in upstream's own terminology (`fileIconThemeSchema.ts`) —
//! out of a still-open `theme::unpack::Staging` session. This is `F060`
//! S1's icon-family counterpart to `theme_json`'s color-theme document
//! validator: same staging session, same JSONC dialect, same `resources`
//! out-parameter contract (every file this validation pass judged safe to
//! open gets its wire path inserted, later folded into the stored record's
//! own whitelist `theme_read_resource` checks against).
//!
//! Two structural differences from a color theme document, both read
//! straight off the real upstream loader (`fileIconThemeData.ts`'s
//! `FileIconThemeLoader.processIconThemeDocument`), not guessed:
//!
//! - **No `include` chain.** A file icon theme JSON is flat — there is
//!   nothing here that resembles `theme_json`'s recursive
//!   include/cycle/depth machinery.
//! - **Runtime leniency, not parse-time rejection, for malformed
//!   *associations*.** Upstream never fails to load a whole icon theme
//!   document over a single bad `iconDefinitions` entry, an unrecognized
//!   font format, or a missing font id — it silently skips just that one
//!   piece (occasionally logging a warning) and keeps going. Plain mirrors
//!   this exactly for anything that is *purely* a display/association
//!   concern. The one place Plain is deliberately stricter than upstream
//!   (which performs **no** sanitization at all — see ADR 0002) is any
//!   field that resolves to an actual file this import will serve back to
//!   the frontend later: an `iconPath` or a `fonts[].src[].path`. Once a
//!   JSON value is well-typed enough to be treated as one of those two
//!   things, its resolved path must both exist in this import's unpack
//!   manifest and pass [`super::svg_sanitize`]/[`super::font_check`] — any
//!   failure there is a hard, whole-package rejection, never a skip.
//!
//! [`MAX_ICON_ASSOCIATIONS`] bounds the total number of icon associations
//! (every `iconDefinitions` entry, plus every key in the seven map-shaped
//! association fields — `fileExtensions`, `fileNames`, `folderNames`,
//! `folderNamesExpanded`, `languageIds`, `rootFolderNames`,
//! `rootFolderNamesExpanded` — across the top-level document and its
//! optional `light`/`highContrast` overrides) a single document may
//! declare; see that constant's own doc comment for the exact rationale.
//!
//! [`validate_font_entry`] is `pub(crate)`, not private: `product_icon_
//! theme_json` reuses it verbatim, since a product icon theme's own
//! `fonts[]` array has the exact same shape and the exact same
//! resource-safety contract as a file icon theme's — `F060` S1 keeps one
//! implementation rather than two.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::Path;

use jsonc_parser::{parse_to_value, JsonObject, JsonValue};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::font_check;
use super::relative_path::resolve_theme_relative;
use super::svg_sanitize::sanitize_svg_bytes;
use super::unpack::Staging;
use super::{
    theme_icon_json_invalid, theme_icon_resource_invalid, theme_icon_too_many_associations,
    JSONC_PARSE_OPTIONS, MAX_ICON_ASSOCIATIONS,
};

/// The seven map-shaped `IconsAssociation` fields (`fileIconThemeSchema.ts`)
/// whose entry counts are summed toward [`MAX_ICON_ASSOCIATIONS`]. The five
/// singular string fields (`file`, `folder`, `folderExpanded`, `rootFolder`,
/// `rootFolderExpanded`) are excluded: each can only ever contribute one
/// association per block, never a proliferating map an attacker could pad.
const ASSOCIATION_MAP_FIELDS: [&str; 7] = [
    "fileExtensions",
    "fileNames",
    "folderNames",
    "folderNamesExpanded",
    "languageIds",
    "rootFolderNames",
    "rootFolderNamesExpanded",
];

/// Validates the document a single `contributes.iconThemes[]` entry points
/// at. `resources` accumulates every file this call actually opened and
/// judged safe — the document itself, plus every `iconPath`/font `src` path
/// it references — shared (like `theme_json`'s own `resources` parameter)
/// across every entry in one package import.
pub(crate) fn validate_icon_theme_document(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
    path: &RelativePath,
    resources: &mut BTreeSet<String>,
) -> Result<(), CommandError> {
    resources.insert(path.as_wire().to_owned());

    let text = read_staged_text(staged, path)?;
    let value = parse_to_value(&text, &JSONC_PARSE_OPTIONS)
        .map_err(|_| theme_icon_json_invalid())?
        .ok_or_else(theme_icon_json_invalid)?;
    let JsonValue::Object(root) = value else {
        return Err(theme_icon_json_invalid());
    };

    if count_associations(&root) > MAX_ICON_ASSOCIATIONS {
        return Err(theme_icon_too_many_associations());
    }

    let base_dir = path.as_path().parent().unwrap_or(Path::new(""));

    if let Some(JsonValue::Object(icon_definitions)) = root.get("iconDefinitions") {
        for (_, definition) in icon_definitions.clone().into_iter() {
            validate_icon_definition(staged, files, base_dir, &definition, resources)?;
        }
    }

    if let Some(JsonValue::Array(fonts)) = root.get("fonts") {
        for font in fonts.iter() {
            validate_font_entry(staged, files, base_dir, font, resources)?;
        }
    }

    Ok(())
}

fn count_associations(root: &JsonObject<'_>) -> usize {
    let mut total = 0_usize;
    if let Some(JsonValue::Object(icon_definitions)) = root.get("iconDefinitions") {
        total += icon_definitions.len();
    }
    total += count_association_maps(root);
    if let Some(JsonValue::Object(light)) = root.get("light") {
        total += count_association_maps(light);
    }
    if let Some(JsonValue::Object(high_contrast)) = root.get("highContrast") {
        total += count_association_maps(high_contrast);
    }
    total
}

fn count_association_maps(block: &JsonObject<'_>) -> usize {
    ASSOCIATION_MAP_FIELDS
        .iter()
        .map(|field| match block.get(field) {
            Some(JsonValue::Object(map)) => map.len(),
            _ => 0,
        })
        .sum()
}

/// A single `iconDefinitions` entry. Anything that is not an object at all,
/// or has no `iconPath` string, is silently ignored (lenient, matches
/// upstream: an absent/malformed definition simply never generates any CSS
/// for whatever referenced it). `iconPath`, when present as a JSON string,
/// is the one field here with a filesystem-safety consequence: it must
/// resolve inside the package, exist in this import's unpack manifest, and
/// pass sanitization if it is (by extension) an SVG — all hard,
/// whole-package-rejecting checks, never a skip. Every other field
/// (`fontCharacter`, `fontColor`, `fontSize`, `fontId`) is a pure display
/// concern with no filesystem reach, so it is never inspected here at all.
fn validate_icon_definition(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
    base_dir: &Path,
    definition: &JsonValue<'_>,
    resources: &mut BTreeSet<String>,
) -> Result<(), CommandError> {
    let JsonValue::Object(definition) = definition else {
        return Ok(());
    };
    let Some(JsonValue::String(icon_path)) = definition.get("iconPath") else {
        return Ok(());
    };
    let (resolved_path, bytes) =
        resolve_and_read_resource(staged, files, base_dir, icon_path, resources)?;
    if is_svg_path(resolved_path.as_wire()) {
        sanitize_svg_bytes(&bytes)?;
    }
    Ok(())
}

/// A single `fonts[]` entry, shared verbatim by `product_icon_theme_json`
/// (see this module's own doc comment for why). Anything that is not an
/// object, has no usable `id`, or has no `src` array at all is silently
/// skipped — matching upstream's own "Missing or invalid font id...
/// Skipping font definition" leniency in both `fileIconThemeData.ts` and
/// `productIconThemeData.ts`. Each `src[]` item is checked independently:
/// one with an unrecognized `format` (outside the closed
/// woff/woff2/truetype/opentype/embedded-opentype/svg set) or a non-string
/// `path` is skipped on its own (upstream: "Invalid font source... Ignoring
/// source"), but once both are well-typed the resolved path is a hard,
/// whole-package-rejecting resource check exactly like an `iconPath` above —
/// including running the actual bytes through [`super::svg_sanitize`] (for
/// `format: "svg"`) or [`super::font_check`] (every other recognized
/// format) and rejecting a mismatch.
pub(crate) fn validate_font_entry(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
    base_dir: &Path,
    font: &JsonValue<'_>,
    resources: &mut BTreeSet<String>,
) -> Result<(), CommandError> {
    let JsonValue::Object(font) = font else {
        return Ok(());
    };
    let Some(JsonValue::String(id)) = font.get("id") else {
        return Ok(());
    };
    if !is_valid_font_id(id) {
        return Ok(());
    }
    let Some(JsonValue::Array(src)) = font.get("src") else {
        return Ok(());
    };

    for entry in src.iter() {
        let JsonValue::Object(entry) = entry else {
            continue;
        };
        let Some(JsonValue::String(path_value)) = entry.get("path") else {
            continue;
        };
        let Some(JsonValue::String(format)) = entry.get("format") else {
            continue;
        };
        if !font_check::is_known_font_format(format) {
            continue;
        }
        let (_resolved, bytes) =
            resolve_and_read_resource(staged, files, base_dir, path_value, resources)?;
        font_check::validate_font_bytes(format, &bytes)?;
    }
    Ok(())
}

/// `^[\w_-]+$` (upstream's `fontIdRegex` in `iconRegistry.ts`) — unlike an
/// icon/product-icon theme's own `id` (see
/// `manifest::is_valid_icon_theme_id` for why that one is deliberately more
/// permissive), this id is embedded verbatim as a generated CSS
/// `font-family` value in a later slice, and upstream itself enforces this
/// exact charset via a JSON schema `pattern`.
fn is_valid_font_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// Resolves `path_value` relative to `base_dir` (the icon theme document's
/// own directory — matches upstream's `resources.joinPath(iconThemeDocument
/// LocationDirname, path)`), confirms it is present in this import's unpack
/// manifest, reads its full bytes, and records its wire path in
/// `resources`. Every failure here — an unresolvable/escaping path, or one
/// missing from `files` — is [`theme_icon_resource_invalid`], a hard,
/// whole-package-rejecting failure (see this module's own doc comment for
/// why this is never a lenient skip once a path string is well-typed).
pub(crate) fn resolve_and_read_resource(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
    base_dir: &Path,
    path_value: &str,
    resources: &mut BTreeSet<String>,
) -> Result<(RelativePath, Vec<u8>), CommandError> {
    let resolved =
        resolve_theme_relative(base_dir, path_value).map_err(|_| theme_icon_resource_invalid())?;
    if !files.contains(resolved.as_wire()) {
        return Err(theme_icon_resource_invalid());
    }
    let mut file = staged
        .open_file_read(resolved.as_path())
        .map_err(|_| theme_icon_resource_invalid())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| theme_icon_resource_invalid())?;
    resources.insert(resolved.as_wire().to_owned());
    Ok((resolved, bytes))
}

fn is_svg_path(wire: &str) -> bool {
    wire.to_ascii_lowercase().ends_with(".svg")
}

fn read_staged_text(staged: &Staging<'_>, path: &RelativePath) -> Result<String, CommandError> {
    let mut file = staged
        .open_file_read(path.as_path())
        .map_err(|_| theme_icon_json_invalid())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|_| theme_icon_json_invalid())?;
    Ok(text)
}

#[cfg(test)]
mod tests;
