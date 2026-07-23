//! Magic-byte-only structural check for a font resource's declared
//! `fonts[].src[].format` against its actual file bytes — the font-family
//! counterpart to `theme_json::validate_tmtheme_structure`'s "minimal
//! structural sanity check, not a real parser" tradeoff, for the exact same
//! reason: a real font parser (`ttf-parser`/`fontdue`/...) would let Plain
//! *fully* parse attacker-controlled font tables it still never acts on
//! (Plain never rasterizes glyphs itself; the WebView's own font engine
//! does), in exchange for a new dependency this import-time gate does not
//! need. A handful of magic-byte prefix checks already catches the
//! actually-interesting failure mode: a file whose declared `format` does
//! not match what it actually is (the classic "rename an SVG/script payload
//! to `.woff`" trick a hostile theme package could otherwise use to smuggle
//! unexpected content past whatever a later consumer assumes a
//! `.woff`-declared resource is).
//!
//! The closed set of recognized magic signatures, and which of upstream's
//! six `fontFormatRegex` values (`iconRegistry.ts`) each maps to:
//! - `woff` → `wOFF`.
//! - `woff2` → `wOF2`.
//! - `truetype` → `\x00\x01\x00\x00` (sfnt version 1, the common case), or
//!   `true` (the legacy Apple/old-style tag), or `ttcf` (a TrueType
//!   Collection container header).
//! - `opentype` → `OTTO` (the CFF-flavored OpenType signature).
//! - `embedded-opentype` (EOT) has **no** recognized signature in this
//!   closed set at all — EOT has no simple fixed magic the way the other
//!   five formats do (its header leads with a variable-length field, not a
//!   stable tag), so Plain cannot cheaply attest one. Any resource declaring
//!   this format is therefore always rejected — a deliberate, reported
//!   narrowing: upstream's own schema still lists `embedded-opentype` as a
//!   legal enum value, but Plain's import pipeline cannot in practice import
//!   a usable EOT font. No real-world icon theme needs EOT to satisfy
//!   `F060`'s three acceptance criteria — it is a legacy Internet
//!   Explorer-only format essentially absent from modern icon font
//!   packaging.
//! - `svg` is not magic-checked at all here — a `format: "svg"` font source
//!   is literal SVG/XML text, so [`validate_font_bytes`] dispatches it to
//!   [`super::svg_sanitize::sanitize_svg_bytes`] instead.

use crate::error::CommandError;

use super::theme_font_invalid;

/// The exact closed set of `fonts[].src[].format` values this domain
/// recognizes — the same six values as upstream's own `fontFormatRegex`
/// (`/^woff|woff2|truetype|opentype|embedded-opentype|svg$/` in
/// `iconRegistry.ts`).
const FONT_FORMATS: [&str; 6] = [
    "woff",
    "woff2",
    "truetype",
    "opentype",
    "embedded-opentype",
    "svg",
];

pub(crate) const WOFF_MAGIC: &[u8] = b"wOFF";
pub(crate) const WOFF2_MAGIC: &[u8] = b"wOF2";
pub(crate) const OPENTYPE_MAGIC: &[u8] = b"OTTO";
pub(crate) const TRUETYPE_SFNT_MAGIC: &[u8] = &[0x00, 0x01, 0x00, 0x00];
pub(crate) const TRUETYPE_TRUE_MAGIC: &[u8] = b"true";
pub(crate) const TRUETYPE_COLLECTION_MAGIC: &[u8] = b"ttcf";

/// Whether `format` is one of the six values upstream's own
/// `fontFormatRegex` recognizes. Every caller in this domain checks this
/// before treating a `fonts[].src[]` entry as declaring a real resource —
/// an unrecognized format is a lenient per-entry skip (matches upstream:
/// "Invalid font source... Ignoring source"), never a hard import failure.
pub(crate) fn is_known_font_format(format: &str) -> bool {
    FONT_FORMATS.contains(&format)
}

/// Validates `bytes` against `format`. `format` must already have passed
/// [`is_known_font_format`] — every caller in this domain checks that
/// first, so the fallback arm here is only ever a defensive backstop, never
/// reachable in practice.
pub(crate) fn validate_font_bytes(format: &str, bytes: &[u8]) -> Result<(), CommandError> {
    match format {
        "svg" => super::svg_sanitize::sanitize_svg_bytes(bytes),
        "woff" => require_magic(bytes, &[WOFF_MAGIC]),
        "woff2" => require_magic(bytes, &[WOFF2_MAGIC]),
        "truetype" => require_magic(
            bytes,
            &[
                TRUETYPE_SFNT_MAGIC,
                TRUETYPE_TRUE_MAGIC,
                TRUETYPE_COLLECTION_MAGIC,
            ],
        ),
        "opentype" => require_magic(bytes, &[OPENTYPE_MAGIC]),
        // `embedded-opentype` (no recognized magic at all, see this
        // module's own doc comment) and anything else fall through here.
        _ => Err(theme_font_invalid()),
    }
}

fn require_magic(bytes: &[u8], candidates: &[&[u8]]) -> Result<(), CommandError> {
    if candidates.iter().any(|magic| bytes.starts_with(magic)) {
        Ok(())
    } else {
        Err(theme_font_invalid())
    }
}

#[cfg(test)]
mod tests;
