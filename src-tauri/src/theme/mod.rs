//! Rust-authoritative theme package domain.
//!
//! `F050` S1 scope: safely unpack a VSIX (zip) or an already-unpacked
//! directory into the theme package library, enforcing bounded entry
//! count/size/name limits and rejecting zip-slip and symlink entries.
//!
//! `F050` S2 scope (this slice): close the "staging → validated →
//! semantically identified" loop. `manifest` parses and validates
//! `extension/package.json` (JSONC), `theme_json` validates each
//! `contributes.themes[].path` document (JSON include chains and `.tmTheme`
//! structural checks), `record` defines the on-disk stored manifest and the
//! library-enumeration function, and `import` ties unpack + manifest +
//! theme_json + record together into one staging session per import: the
//! staged tree is renamed directly into its final `publisher.name@version`
//! identity only once every check has passed, and is dropped (via the same
//! `Staging` guard `unpack` already uses) otherwise — never a separate
//! "publish under a placeholder id, then maybe delete a whole tree" step.
//! `F050` S3 scope: close the import UX loop. `picker` adds a `FilePicker`
//! abstraction (mirroring `workspace::picker`'s injectable `DirectoryPicker`)
//! for the VSIX file dialog, plus a theme-domain directory picker for the
//! unpacked-folder path; `service` wraps a single process-wide
//! [`library::ThemeLibrary`] with the Tauri-facing orchestration (picker →
//! import pipeline → library, or library → whitelisted resource read, or
//! library → bounded removal); `dto` is the camelCase wire contract; and
//! `commands` registers the five `theme_*` Tauri commands `lib.rs` exposes.
//!
//! `F050` S4 scope (this slice): cross-session persistence of *which* theme
//! is selected. `selection` stores an opaque `settingsId` string (or its
//! absence) at `<library root>/selection.plain.json`, behind the same
//! `ThemeLibrary` gate every other mutation already uses; `theme_get_
//! selection`/`theme_set_selection` are the two new `theme_*` commands this
//! adds. The frontend owns matching a stored id back against its own theme
//! registry — this domain never resolves, imports, or validates a
//! `settingsId` against any actual theme document, it only stores and
//! returns the opaque string.
//!
//! Nothing in this domain was reachable from a Tauri command before S3 —
//! that was S1/S2's deliberate scope boundary. It is now, so the
//! whole-module `dead_code` allowance those slices needed is gone.
//!
//! `F060` S1 scope: `manifest`'s `contributes.iconThemes[]`/
//! `contributes.productIconThemes[]` handling moves from an unvalidated
//! passthrough (F050's deliberate scope boundary — see that field's own doc
//! comment) to structured validation, mirroring `contributes.themes[]`'s own
//! `{ path, uiTheme }` shape with `{ id, label?, path }` instead. Two new
//! document validators, `icon_theme_json` and `product_icon_theme_json`,
//! are `theme_json`'s icon-family counterparts: same staging session, same
//! JSONC dialect, same `resources` out-parameter contract, but no `include`
//! chain and upstream's own well-documented per-entry leniency for anything
//! that is a pure display/association concern. Two more new modules,
//! `svg_sanitize` and `font_check`, are content-level safety checks upstream
//! never performs at all (a different trust model — see ADR 0002): every
//! `.svg` resource (an `iconPath`, or a `fonts[].src[].path` declaring
//! `format: "svg"`) is string-scan sanitized, and every other font format is
//! checked against a closed set of magic byte signatures. This whole slice
//! is pure Rust — no Tauri command, DTO, or frontend surface changes; that
//! is `F060` S2's scope.

pub(crate) mod commands;
pub(crate) mod dto;
#[cfg(test)]
pub(crate) mod fixtures;
pub(crate) mod font_check;
pub(crate) mod icon_theme_json;
pub(crate) mod import;
pub(crate) mod library;
pub(crate) mod manifest;
pub(crate) mod picker;
pub(crate) mod product_icon_theme_json;
pub(crate) mod record;
pub(crate) mod relative_path;
pub(crate) mod resource;
pub(crate) mod selection;
pub(crate) mod service;
pub(crate) mod svg_sanitize;
pub(crate) mod theme_json;
pub(crate) mod unpack;

/// Maximum number of entries a single theme package (VSIX central
/// directory, or ambient directory tree) may contain. Applied structurally
/// up front for VSIX (`ZipArchive::len()`) and incrementally while walking
/// an ambient directory tree.
pub(crate) const MAX_THEME_PACKAGE_ENTRIES: usize = 2_000;

/// Maximum decompressed/copied byte length of a single package member,
/// enforced against the actual bytes read from the (de)compression stream —
/// never against a declared/attacker-controlled size field alone.
pub(crate) const MAX_THEME_ENTRY_BYTES: u64 = 8 * 1_024 * 1_024;

/// Maximum cumulative decompressed/copied bytes across every member of a
/// single package. This is the zip-bomb backstop: a high compression ratio
/// cannot buy an importer more than this many real bytes on disk.
pub(crate) const MAX_THEME_PACKAGE_BYTES: u64 = 64 * 1_024 * 1_024;

/// Maximum byte length of a single path segment (filename or directory
/// name) inside a package member's relative path.
pub(crate) const MAX_THEME_ENTRY_NAME_BYTES: usize = 255;

/// The only prefix a VSIX zip entry is extracted under; every other entry
/// (README, changelog, `.vsixmanifest`, etc.) is silently ignored rather
/// than rejected.
const EXTENSION_PREFIX: &str = "extension/";

const STAGE_PREFIX: &str = ".plain-theme-";
const MAX_STAGING_ATTEMPTS: usize = 16;

/// Maximum `include` chain recursion depth for a single
/// `contributes.themes[]` document (the top-level document itself counts as
/// depth `1`). Mirrors the zip-slip precedent: upstream `_loadColorTheme` is
/// a bare recursive loader with no cycle or depth guard at all, so Plain
/// enforces both before ever handing a parsed document to anything else.
pub(crate) const MAX_INCLUDE_CHAIN_DEPTH: usize = 32;

/// Maximum number of distinct files (JSON theme documents walked via
/// `include`, plus `.tmTheme` leaves reached via a top-level `path` or a
/// `tokenColors` string reference) opened across a *whole package import* —
/// every `contributes.themes[]` entry shares one counter. This is
/// deliberately independent from [`MAX_INCLUDE_CHAIN_DEPTH`]: depth bounds
/// any single chain's recursion, this bounds total parse work across a
/// package that might declare many theme entries, each with a modest chain.
pub(crate) const MAX_INCLUDE_CHAIN_FILES: usize = 64;

/// Maximum total number of icon associations a single `contributes.
/// iconThemes[].path`/`contributes.productIconThemes[].path` JSON document
/// may declare: every `iconDefinitions` entry, plus every key across the
/// seven map-shaped `IconsAssociation` fields (`fileExtensions`, `fileNames`,
/// `folderNames`, `folderNamesExpanded`, `languageIds`, `rootFolderNames`,
/// `rootFolderNamesExpanded`), summed across the top-level document and its
/// optional `light`/`highContrast` overrides (see `icon_theme_json`'s own
/// module docs for the exact accounting). This is independent of
/// [`MAX_INCLUDE_CHAIN_FILES`] (which bounds files opened across a color
/// theme's `include` chain, not entries inside one icon document) and of
/// [`MAX_THEME_PACKAGE_ENTRIES`]/[`MAX_THEME_PACKAGE_BYTES`] (which bound the
/// whole package, not one document) — upstream has no equivalent cap at all,
/// this is Plain's own defense-in-depth ceiling against a single icon
/// document crafted to make future CSS-generation-equivalent work
/// unboundedly expensive.
pub(crate) const MAX_ICON_ASSOCIATIONS: usize = 4096;

/// The exact JSONC dialect Plain accepts for `package.json` and every theme
/// JSON document: comments and trailing commas only — never the rest of the
/// upstream parser's much looser JSON5-adjacent surface (single-quoted
/// strings, hex/unary-plus numbers, loose property names, missing commas).
pub(crate) const JSONC_PARSE_OPTIONS: jsonc_parser::ParseOptions = jsonc_parser::ParseOptions {
    allow_comments: true,
    allow_trailing_commas: true,
    allow_loose_object_property_names: false,
    allow_missing_commas: false,
    allow_single_quoted_strings: false,
    allow_hexadecimal_numbers: false,
    allow_unary_plus_numbers: false,
};

// Compile-time (not merely test-time) proof that `JSONC_PARSE_OPTIONS` is
// exactly comments + trailing commas and nothing else from the upstream
// parser's much looser JSON5-adjacent surface: a `const` block fails the
// build itself if any field ever drifts, which is a strictly stronger
// guarantee than a runtime assertion over the same already-`const` value.
const _: () = {
    assert!(JSONC_PARSE_OPTIONS.allow_comments);
    assert!(JSONC_PARSE_OPTIONS.allow_trailing_commas);
    assert!(!JSONC_PARSE_OPTIONS.allow_loose_object_property_names);
    assert!(!JSONC_PARSE_OPTIONS.allow_missing_commas);
    assert!(!JSONC_PARSE_OPTIONS.allow_single_quoted_strings);
    assert!(!JSONC_PARSE_OPTIONS.allow_hexadecimal_numbers);
    assert!(!JSONC_PARSE_OPTIONS.allow_unary_plus_numbers);
};

use crate::error::CommandError;

pub(crate) fn theme_unavailable() -> CommandError {
    CommandError::new(
        "THEME_UNAVAILABLE",
        "The theme package library is not available.",
    )
}

pub(crate) fn theme_package_corrupt() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_CORRUPT",
        "The theme package could not be read as a valid archive.",
    )
}

pub(crate) fn theme_package_unsafe_path() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_UNSAFE_PATH",
        "The theme package contains an unsafe or malformed path.",
    )
}

pub(crate) fn theme_package_too_large() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_TOO_LARGE",
        "The theme package exceeds the supported unpack limits.",
    )
}

pub(crate) fn theme_io_failed() -> CommandError {
    CommandError::new(
        "THEME_IO_FAILED",
        "The theme package could not be processed.",
    )
}

pub(crate) fn theme_stage_cleanup_failed() -> CommandError {
    CommandError::new(
        "THEME_STAGE_CLEANUP_FAILED",
        "The theme import staging area could not be cleaned up.",
    )
}

pub(crate) fn theme_manifest_missing() -> CommandError {
    CommandError::new(
        "THEME_MANIFEST_MISSING",
        "The theme package does not contain an extension/package.json manifest.",
    )
}

pub(crate) fn theme_manifest_invalid() -> CommandError {
    CommandError::new(
        "THEME_MANIFEST_INVALID",
        "The theme package manifest is not a valid JSONC object.",
    )
}

pub(crate) fn theme_manifest_field_invalid() -> CommandError {
    CommandError::new(
        "THEME_MANIFEST_FIELD_INVALID",
        "The theme package manifest is missing a required field or the field \
         does not match the allowed character set.",
    )
}

/// `F060` broadens this from "no `contributes.themes` entries" to "no
/// theme-family contribution at all": a package that declares only
/// `contributes.iconThemes`/`contributes.productIconThemes` (and an empty or
/// absent `contributes.themes`) is no longer rejected on this ground — this
/// error now only fires when `themes`, `iconThemes` and `productIconThemes`
/// are *all* empty or absent. See `manifest::parse_and_validate`'s own
/// aggregate check for exactly where this is decided.
pub(crate) fn theme_package_no_themes() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_NO_THEMES",
        "The theme package does not declare any themes, iconThemes or \
         productIconThemes contribution.",
    )
}

pub(crate) fn theme_contribution_invalid() -> CommandError {
    CommandError::new(
        "THEME_CONTRIBUTION_INVALID",
        "A contributes.themes entry is malformed.",
    )
}

pub(crate) fn theme_contribution_path_invalid() -> CommandError {
    CommandError::new(
        "THEME_CONTRIBUTION_PATH_INVALID",
        "A contributes.themes entry's path escapes the package or is not \
         present in the unpacked package.",
    )
}

pub(crate) fn theme_json_invalid() -> CommandError {
    CommandError::new(
        "THEME_JSON_INVALID",
        "A theme JSON document is not valid JSONC or has a malformed \
         colors/tokenColors/semanticTokenColors/include shape.",
    )
}

pub(crate) fn theme_include_cycle() -> CommandError {
    CommandError::new(
        "THEME_INCLUDE_CYCLE",
        "A theme document's include chain refers back to a document already \
         visited in this chain.",
    )
}

pub(crate) fn theme_include_too_deep() -> CommandError {
    CommandError::new(
        "THEME_INCLUDE_TOO_DEEP",
        "A theme document's include chain exceeds the supported nesting depth.",
    )
}

pub(crate) fn theme_include_too_many() -> CommandError {
    CommandError::new(
        "THEME_INCLUDE_TOO_MANY",
        "Validating this package's theme documents would open more files \
         than the supported budget.",
    )
}

pub(crate) fn theme_include_invalid() -> CommandError {
    CommandError::new(
        "THEME_INCLUDE_INVALID",
        "A theme document's include or tokenColors reference escapes the \
         package or is not present in the unpacked package.",
    )
}

pub(crate) fn theme_tmtheme_invalid() -> CommandError {
    CommandError::new(
        "THEME_TMTHEME_INVALID",
        "A .tmTheme file is not a structurally valid property list.",
    )
}

pub(crate) fn theme_package_already_imported() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_ALREADY_IMPORTED",
        "A theme package with the same publisher, name and version is \
         already imported.",
    )
}

pub(crate) fn theme_pick_failed() -> CommandError {
    CommandError::new(
        "THEME_PICK_FAILED",
        "The theme import file or folder picker could not be completed.",
    )
}

pub(crate) fn theme_pick_path_unavailable() -> CommandError {
    CommandError::new(
        "THEME_PICK_PATH_UNAVAILABLE",
        "The selected theme package source is unavailable.",
    )
}

/// Covers both "no package exists at this id" and "the id argument itself is
/// malformed" — deliberately the same code for both, rather than letting a
/// caller distinguish a hostile/malformed selector from a merely-absent one.
pub(crate) fn theme_package_not_found() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_NOT_FOUND",
        "No imported theme package matches the given id.",
    )
}

/// Covers both "this relative path is not in the package's validated
/// resource whitelist" and "the whitelisted file is missing or unreadable on
/// disk" — deliberately the same code for both, matching
/// [`theme_package_not_found`]'s fail-closed, non-distinguishing rationale.
pub(crate) fn theme_resource_not_found() -> CommandError {
    CommandError::new(
        "THEME_RESOURCE_NOT_FOUND",
        "The requested theme package resource is not available.",
    )
}

/// A `theme_set_selection` request's non-null `themeId` failed
/// [`selection::validate_theme_selection_id`]'s charset/length check — empty,
/// over [`selection::MAX_THEME_SELECTION_ID_BYTES`], or containing a control
/// character.
pub(crate) fn theme_selection_invalid() -> CommandError {
    CommandError::new(
        "THEME_SELECTION_INVALID",
        "The theme selection id is empty, too long, or contains a control \
         character.",
    )
}

/// `F060` S1: a `contributes.iconThemes[].path`/`contributes.
/// productIconThemes[].path` file icon theme JSON document is not valid
/// JSONC, or does not parse to a JSON object at all. Covers only the
/// document-shape failure — a missing/unsafe *resource* it references gets
/// [`theme_icon_resource_invalid`] instead, and an over-budget document gets
/// [`theme_icon_too_many_associations`].
pub(crate) fn theme_icon_json_invalid() -> CommandError {
    CommandError::new(
        "THEME_ICON_JSON_INVALID",
        "A file icon theme JSON document is not a valid JSONC object.",
    )
}

/// `F060` S1: an icon theme document's `iconDefinitions[].iconPath` or
/// `fonts[].src[].path` (file icon or product icon theme, both share this
/// code) resolves outside the package, or does not name a file actually
/// present in this import's unpack manifest. Deliberately a hard,
/// whole-package-rejecting failure — unlike a structurally malformed
/// association entry, which `icon_theme_json`/`product_icon_theme_json`
/// skip leniently — because once a JSON value is well-typed enough to be
/// treated as a resource reference, its safety is a security boundary, never
/// a leniency boundary. See those two modules' own doc comments.
pub(crate) fn theme_icon_resource_invalid() -> CommandError {
    CommandError::new(
        "THEME_ICON_RESOURCE_INVALID",
        "An icon theme's iconPath or font source path escapes the package \
         or is not present in the unpacked package.",
    )
}

/// `F060` S1: an icon theme JSON document's total association count (every
/// `iconDefinitions` entry plus every map-shaped association key, see
/// [`MAX_ICON_ASSOCIATIONS`]'s own doc comment for the exact accounting)
/// exceeds the supported budget.
pub(crate) fn theme_icon_too_many_associations() -> CommandError {
    CommandError::new(
        "THEME_ICON_TOO_MANY_ASSOCIATIONS",
        "An icon theme JSON document exceeds the supported icon association \
         budget.",
    )
}

/// `F060` S1: a `contributes.productIconThemes[].path` document is not valid
/// JSONC, does not parse to a JSON object, or is missing its required
/// `fonts`/`iconDefinitions` fields — mirrors upstream's own
/// `_loadProductIconThemeDocument` hard rejection for all three (see
/// `product_icon_theme_json`'s own doc comment).
pub(crate) fn theme_product_icon_json_invalid() -> CommandError {
    CommandError::new(
        "THEME_PRODUCT_ICON_JSON_INVALID",
        "A product icon theme JSON document is not a valid JSONC object, or \
         is missing its required fonts/iconDefinitions fields.",
    )
}

/// `F060` S1: an SVG resource (an `iconPath`/`fonts[].src[].path` ending in
/// `.svg`, or any font source declaring `format: "svg"`) failed
/// [`svg_sanitize::sanitize_svg_bytes`] — it contains a disallowed script
/// element, event-handler attribute, `<foreignObject>`, DOCTYPE/entity
/// declaration, external `href`/`xlink:href` reference, or an unsafe
/// `@import`/`url()` reference. See that module's own doc comment for the
/// exact closed set of checks.
pub(crate) fn theme_svg_unsafe() -> CommandError {
    CommandError::new(
        "THEME_SVG_UNSAFE",
        "An SVG resource contains a disallowed script, event handler, \
         external reference, or unsafe markup construct.",
    )
}

/// `F060` S1: a non-SVG font resource's declared `fonts[].src[].format`
/// does not match its actual file signature (see
/// [`font_check::validate_font_bytes`]'s own doc comment for the exact
/// closed set of recognized magic bytes per format).
pub(crate) fn theme_font_invalid() -> CommandError {
    CommandError::new(
        "THEME_FONT_INVALID",
        "A font resource's declared format does not match its actual file \
         signature.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exhaustive, closed set of theme-domain error codes. Any new
    /// error constructor added to this module must be added here too, or
    /// this test fails — the same "closed set" discipline other domains
    /// apply to their own error codes.
    #[test]
    fn error_codes_are_the_exact_closed_set() {
        let mut codes: Vec<&'static str> = vec![
            theme_unavailable().code(),
            theme_package_corrupt().code(),
            theme_package_unsafe_path().code(),
            theme_package_too_large().code(),
            theme_io_failed().code(),
            theme_stage_cleanup_failed().code(),
            theme_manifest_missing().code(),
            theme_manifest_invalid().code(),
            theme_manifest_field_invalid().code(),
            theme_package_no_themes().code(),
            theme_contribution_invalid().code(),
            theme_contribution_path_invalid().code(),
            theme_json_invalid().code(),
            theme_include_cycle().code(),
            theme_include_too_deep().code(),
            theme_include_too_many().code(),
            theme_include_invalid().code(),
            theme_tmtheme_invalid().code(),
            theme_package_already_imported().code(),
            theme_pick_failed().code(),
            theme_pick_path_unavailable().code(),
            theme_package_not_found().code(),
            theme_resource_not_found().code(),
            theme_selection_invalid().code(),
            theme_icon_json_invalid().code(),
            theme_icon_resource_invalid().code(),
            theme_icon_too_many_associations().code(),
            theme_product_icon_json_invalid().code(),
            theme_svg_unsafe().code(),
            theme_font_invalid().code(),
        ];
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(
            codes,
            vec![
                "THEME_CONTRIBUTION_INVALID",
                "THEME_CONTRIBUTION_PATH_INVALID",
                "THEME_FONT_INVALID",
                "THEME_ICON_JSON_INVALID",
                "THEME_ICON_RESOURCE_INVALID",
                "THEME_ICON_TOO_MANY_ASSOCIATIONS",
                "THEME_INCLUDE_CYCLE",
                "THEME_INCLUDE_INVALID",
                "THEME_INCLUDE_TOO_DEEP",
                "THEME_INCLUDE_TOO_MANY",
                "THEME_IO_FAILED",
                "THEME_JSON_INVALID",
                "THEME_MANIFEST_FIELD_INVALID",
                "THEME_MANIFEST_INVALID",
                "THEME_MANIFEST_MISSING",
                "THEME_PACKAGE_ALREADY_IMPORTED",
                "THEME_PACKAGE_CORRUPT",
                "THEME_PACKAGE_NOT_FOUND",
                "THEME_PACKAGE_NO_THEMES",
                "THEME_PACKAGE_TOO_LARGE",
                "THEME_PACKAGE_UNSAFE_PATH",
                "THEME_PICK_FAILED",
                "THEME_PICK_PATH_UNAVAILABLE",
                "THEME_PRODUCT_ICON_JSON_INVALID",
                "THEME_RESOURCE_NOT_FOUND",
                "THEME_SELECTION_INVALID",
                "THEME_STAGE_CLEANUP_FAILED",
                "THEME_SVG_UNSAFE",
                "THEME_TMTHEME_INVALID",
                "THEME_UNAVAILABLE",
            ],
            "every theme error code must be declared exactly once in this closed set \
             (30 codes: 6 from S1 + 13 from S2 + 4 from S3 + 1 from S4 + 6 new in F060 S1)"
        );
    }

    #[test]
    fn budget_constants_are_exactly_pinned() {
        assert_eq!(MAX_INCLUDE_CHAIN_DEPTH, 32);
        assert_eq!(MAX_INCLUDE_CHAIN_FILES, 64);
        assert_eq!(MAX_ICON_ASSOCIATIONS, 4096);
    }
}
