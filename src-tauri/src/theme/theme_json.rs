//! Validates one `contributes.themes[].path` document (and everything it
//! transitively pulls in) out of a still-open `theme::unpack::Staging`
//! session — the theme-document half of `F050` S2's staging → validated →
//! semantically identified loop (see `theme::import`).
//!
//! Two document kinds, dispatched purely by file extension (`.tmTheme`,
//! case-insensitive, is the only marker the format itself gives us):
//!
//! - **JSON color theme**: JSONC (comments + trailing commas only, same
//!   dialect as the manifest). `colors`, if present, must be an object whose
//!   values are all strings (colors themselves are never format-checked —
//!   upstream is equally permissive). `tokenColors`, if present, must be
//!   either an array (its element shape is never inspected — only *this*
//!   layer's job is to gate malformed containers, not TextMate rule
//!   internals) or a string naming a `.tmTheme` file. `semanticTokenColors`,
//!   if present, must be an object (contents never inspected). `include`, if
//!   present, must be a string naming another JSON document reachable from
//!   this one's own directory — walked recursively with cycle detection, a
//!   depth cap, and a whole-import file-count budget (see the constants in
//!   `theme::mod`).
//! - **`.tmTheme`**: a deliberately minimal *structural* sanity check, not a
//!   real plist parser — see [`validate_tmtheme_structure`] for the
//!   rationale. The bytes are never otherwise interpreted or executed here;
//!   an actual TextMate/plist consumer (Monaco, in a later slice) owns real
//!   parsing.
//!
//! Cycle detection (`visited`) is scoped to *one* `contributes.themes[]`
//! entry's own include chain — reset for every entry — so two unrelated
//! entries that both legitimately `include` the same shared file (a common
//! upstream pattern, e.g. two variants both including a shared base) never
//! collide. The file-count budget is the opposite: it is a single counter
//! threaded across *every* entry in one package import, because it exists to
//! bound total parse work for the whole import, not any one chain.

use std::collections::{BTreeSet, HashSet};
use std::io::Read;
use std::path::Path;

use jsonc_parser::{parse_to_value, JsonValue};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::relative_path::resolve_theme_relative;
use super::unpack::Staging;
use super::{
    theme_include_cycle, theme_include_invalid, theme_include_too_deep, theme_include_too_many,
    theme_json_invalid, theme_tmtheme_invalid, JSONC_PARSE_OPTIONS, MAX_INCLUDE_CHAIN_DEPTH,
};

/// Validates the document a single `contributes.themes[]` entry points at,
/// plus its full transitive `include`/`tokenColors` closure. `budget` is
/// shared across every entry in the same package import (see module docs);
/// callers create ONE `let mut budget = MAX_INCLUDE_CHAIN_FILES;` for the
/// whole import and pass `&mut budget` to this function once per entry.
pub(crate) fn validate_theme_contribution_document(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
    path: &RelativePath,
    budget: &mut usize,
) -> Result<(), CommandError> {
    if is_tmtheme_path(path.as_wire()) {
        take_budget(budget)?;
        return validate_tmtheme_file(staged, path);
    }
    let mut visited = HashSet::new();
    validate_json_document(staged, files, path, &mut visited, 1, budget)
}

fn validate_json_document(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
    path: &RelativePath,
    visited: &mut HashSet<RelativePath>,
    depth: usize,
    budget: &mut usize,
) -> Result<(), CommandError> {
    if depth > MAX_INCLUDE_CHAIN_DEPTH {
        return Err(theme_include_too_deep());
    }
    if !visited.insert(path.clone()) {
        return Err(theme_include_cycle());
    }
    take_budget(budget)?;

    let text = read_staged_text(staged, path)?;
    let value = parse_json_document(&text)?;
    let JsonValue::Object(object) = value else {
        return Err(theme_json_invalid());
    };

    if let Some(colors) = object.get("colors") {
        validate_colors_object(colors)?;
    }
    if let Some(token_colors) = object.get("tokenColors") {
        validate_token_colors(staged, files, path, token_colors, budget)?;
    }
    if let Some(semantic) = object.get("semanticTokenColors") {
        if !matches!(semantic, JsonValue::Object(_)) {
            return Err(theme_json_invalid());
        }
    }

    match object.get("include") {
        None => Ok(()),
        Some(JsonValue::String(include)) => {
            let base_dir = path.as_path().parent().unwrap_or(Path::new(""));
            let include_path =
                resolve_theme_relative(base_dir, include).map_err(|_| theme_include_invalid())?;
            if !files.contains(include_path.as_wire()) {
                return Err(theme_include_invalid());
            }
            validate_json_document(staged, files, &include_path, visited, depth + 1, budget)
        }
        Some(_) => Err(theme_json_invalid()),
    }
}

fn validate_token_colors(
    staged: &Staging<'_>,
    files: &BTreeSet<String>,
    current: &RelativePath,
    value: &JsonValue<'_>,
    budget: &mut usize,
) -> Result<(), CommandError> {
    match value {
        JsonValue::Array(_) => Ok(()),
        JsonValue::String(reference) => {
            let base_dir = current.as_path().parent().unwrap_or(Path::new(""));
            let target =
                resolve_theme_relative(base_dir, reference).map_err(|_| theme_include_invalid())?;
            if !files.contains(target.as_wire()) {
                return Err(theme_include_invalid());
            }
            take_budget(budget)?;
            validate_tmtheme_file(staged, &target)
        }
        _ => Err(theme_json_invalid()),
    }
}

fn validate_colors_object(value: &JsonValue<'_>) -> Result<(), CommandError> {
    let JsonValue::Object(object) = value else {
        return Err(theme_json_invalid());
    };
    for (_, entry_value) in object.clone().into_iter() {
        if !matches!(entry_value, JsonValue::String(_)) {
            return Err(theme_json_invalid());
        }
    }
    Ok(())
}

fn validate_tmtheme_file(staged: &Staging<'_>, path: &RelativePath) -> Result<(), CommandError> {
    let mut file = staged
        .open_file_read(path.as_path())
        .map_err(|_| theme_tmtheme_invalid())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| theme_tmtheme_invalid())?;
    validate_tmtheme_structure(&bytes)
}

/// A deliberately minimal *structural* sanity check for a `.tmTheme` file:
/// an XML declaration, a `<plist` element and a `<dict` element must all be
/// present. This is not a real plist/XML parser — no well-formedness,
/// entity, or nesting validation at all — by design:
///
/// - The bytes are never executed or otherwise interpreted by Plain's Rust
///   layer; a `.tmTheme` file is inert static data, same as any other theme
///   resource. Real structural fidelity only matters once an actual
///   TextMate/plist consumer (Monaco, in a later slice) reads it, and that
///   consumer does its own real parsing.
/// - Pulling in a full `plist` crate (itself further depending on an XML
///   parser) buys nothing this slice needs: it would let us *fully* parse
///   attacker-controlled XML we still don't act on, in exchange for a new
///   transitive dependency surface. A handful of substring/prefix checks
///   already reject the actually-interesting failure modes (empty file,
///   HTML, JSON, random binary) that matter at import time.
/// - The file was already bounded to 8 MiB by S1's unpack limits before it
///   ever reaches this check.
fn validate_tmtheme_structure(bytes: &[u8]) -> Result<(), CommandError> {
    let text = std::str::from_utf8(bytes).map_err(|_| theme_tmtheme_invalid())?;
    if !text.trim_start().starts_with("<?xml") {
        return Err(theme_tmtheme_invalid());
    }
    if !text.contains("<plist") || !text.contains("<dict") {
        return Err(theme_tmtheme_invalid());
    }
    Ok(())
}

fn read_staged_text(staged: &Staging<'_>, path: &RelativePath) -> Result<String, CommandError> {
    let mut file = staged
        .open_file_read(path.as_path())
        .map_err(|_| theme_json_invalid())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|_| theme_json_invalid())?;
    Ok(text)
}

fn parse_json_document(text: &str) -> Result<JsonValue<'_>, CommandError> {
    parse_to_value(text, &JSONC_PARSE_OPTIONS)
        .map_err(|_| theme_json_invalid())?
        .ok_or_else(theme_json_invalid)
}

fn take_budget(budget: &mut usize) -> Result<(), CommandError> {
    if *budget == 0 {
        return Err(theme_include_too_many());
    }
    *budget -= 1;
    Ok(())
}

fn is_tmtheme_path(wire: &str) -> bool {
    wire.to_ascii_lowercase().ends_with(".tmtheme")
}

#[cfg(test)]
mod tests;
