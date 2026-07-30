//! Rust-side SVG "sanitization" that upstream never performs at all — see
//! ADR 0002 and the `F060` research doc's own note that Code OSS's SVG/font
//! resource handling has zero content-level safety checks (a different
//! trust model: upstream trusts every installed extension's assets
//! completely). Plain imports and renders an SVG image (an icon theme's
//! `iconPath`, or a `format: "svg"` icon font glyph source) inside its own
//! WebView, so an unsanitized SVG is a live script-injection surface, not
//! merely inert static data the way a `.tmTheme` property list is
//! (`theme_json`'s own `validate_tmtheme_structure` doc comment explains
//! that distinction).
//!
//! This is a **string-scan-level** sanitizer, not a real XML/SVG parser —
//! the same "minimal structural check, not full parsing" tradeoff
//! `theme_json::validate_tmtheme_structure` already documents for
//! `.tmTheme`, for the same reason: pulling in a full XML parser buys
//! nothing this import-time gate needs, since the goal is "reject every
//! byte sequence that could plausibly execute or reach outside the
//! package", not "produce a faithful DOM". Every check below is
//! deliberately over-inclusive rather than under-inclusive where the two
//! trade off — a false-positive rejection of an unusual-but-safe SVG is an
//! inconvenience; a false-negative is a script-injection or
//! data-exfiltration hole.
//!
//! Rejected, case-insensitively (the whole document is lowercased once up
//! front — every check below only needs to match ASCII keywords, so this
//! never corrupts a multi-byte UTF-8 sequence) and tolerant of the
//! whitespace variants an attacker could insert to dodge a naive
//! literal-substring check:
//! - `<script` (including a namespaced spelling like `<svg:script`, and a
//!   closing `</script`).
//! - An `on[a-z]+\s*=` event-handler attribute (`onload=`, `onclick =`, ...),
//!   requiring the `on` to begin a fresh token so ordinary words that merely
//!   contain "on" (`beacon=`, `action=`, `data-on-hover=`) never
//!   false-positive.
//! - `<foreignObject` (an HTML/script escape hatch inside SVG).
//! - `<!DOCTYPE`/`<!ENTITY` (XML external entity / DTD surface).
//! - An `href`/`xlink:href` value (searching for the `href` suffix catches
//!   both spellings) that is not a same-document `#fragment` or a plain
//!   relative path: `http:`, `https:`, `//`, `javascript:` and **every**
//!   `data:` URI are all rejected. Upstream extensions do sometimes inline a
//!   small raster fallback as `href="data:image/png;base64,..."`; Plain
//!   deliberately does not special-case `image/*` data URIs as an allowed
//!   exception — collapsing the whole `data:` scheme to one rejected prefix
//!   keeps this scanner's one most-attacker-friendly branch trivially
//!   auditable, and no icon theme in Plain's own fixture matrix needs the
//!   exception.
//! - `@import`, anywhere in the document (never legitimate in an SVG this
//!   domain serves), and any `url(...)` reference whose target is not a
//!   same-document `#fragment`. This is checked document-wide rather than
//!   scoped to `<style>` elements/`style=` attributes specifically, since a
//!   presentation attribute like `fill="url(http://evil/x.png)"` is exactly
//!   as unsafe as the same reference inside a `<style>` block, and upstream's
//!   own schema draws no such distinction either — a deliberate widening
//!   beyond the letter of the original plan, reported alongside the `data:`
//!   narrowing above. A same-document `url(#gradientId)` (the common,
//!   legitimate way an SVG references its own
//!   `<linearGradient>`/`<clipPath>`/`<filter>` definitions) is unaffected.

use crate::error::CommandError;

use super::theme_svg_unsafe;

pub(crate) fn sanitize_svg_bytes(bytes: &[u8]) -> Result<(), CommandError> {
    let text = std::str::from_utf8(bytes).map_err(|_| theme_svg_unsafe())?;
    let lower = text.to_ascii_lowercase();

    if has_script_tag(&lower)
        || has_event_handler_attribute(&lower)
        || lower.contains("<foreignobject")
        || lower.contains("<!doctype")
        || lower.contains("<!entity")
        || has_unsafe_href(&lower)
        || has_unsafe_import_or_url(&lower)
    {
        return Err(theme_svg_unsafe());
    }
    Ok(())
}

/// Matches `<script`, `</script` and a namespaced spelling like
/// `<svg:script` — anything after `<` (skipping an optional `/` and an
/// optional `namespace:` prefix) whose tag-name-shaped token is exactly
/// `script`.
fn has_script_tag(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    let mut search_from = 0;
    while let Some(offset) = lower[search_from..].find('<') {
        let mut cursor = search_from + offset + 1;
        if bytes.get(cursor) == Some(&b'/') {
            cursor += 1;
        }
        let name_start = cursor;
        while bytes
            .get(cursor)
            .is_some_and(|&byte| is_tag_name_byte(byte))
        {
            cursor += 1;
        }
        let candidate = &lower[name_start..cursor];
        let local_name = candidate.rsplit(':').next().unwrap_or(candidate);
        if local_name == "script" {
            return true;
        }
        search_from = name_start;
    }
    false
}

fn is_tag_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':')
}

/// Matches `on[a-z]+\s*=`, requiring the `on` to begin a fresh token (not
/// preceded by a letter/digit/`_`/`-`/`:`) so ordinary words containing
/// "on" never false-positive.
fn has_event_handler_attribute(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    let mut search_from = 0;
    while let Some(offset) = lower[search_from..].find("on") {
        let start = search_from + offset;
        let token_start_ok = start == 0 || !is_word_joining_byte(bytes[start - 1]);

        let mut cursor = start + 2;
        let mut saw_letter = false;
        while bytes
            .get(cursor)
            .is_some_and(|&byte| byte.is_ascii_lowercase())
        {
            cursor += 1;
            saw_letter = true;
        }

        if token_start_ok && saw_letter {
            let mut whitespace_end = cursor;
            while bytes
                .get(whitespace_end)
                .is_some_and(|&byte| byte.is_ascii_whitespace())
            {
                whitespace_end += 1;
            }
            if bytes.get(whitespace_end) == Some(&b'=') {
                return true;
            }
        }
        search_from = start + 2;
    }
    false
}

fn is_word_joining_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b':')
}

/// Matches `href`/`xlink:href` (searching for the `href` suffix catches
/// both spellings) followed — after optional whitespace — by `=`, an
/// optional matching quote, then a value whose prefix is checked by
/// [`is_unsafe_reference`].
fn has_unsafe_href(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    let mut search_from = 0;
    while let Some(offset) = lower[search_from..].find("href") {
        let start = search_from + offset;
        let mut cursor = start + 4;
        while bytes
            .get(cursor)
            .is_some_and(|&byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'=') {
            cursor += 1;
            while bytes
                .get(cursor)
                .is_some_and(|&byte| byte.is_ascii_whitespace())
            {
                cursor += 1;
            }
            let quote = bytes.get(cursor).copied();
            if quote == Some(b'"') || quote == Some(b'\'') {
                let quote_byte = quote.expect("checked Some above");
                cursor += 1;
                let value_start = cursor;
                while bytes.get(cursor).is_some_and(|&byte| byte != quote_byte) {
                    cursor += 1;
                }
                let value_end = cursor.min(lower.len());
                let value = lower[value_start..value_end].trim_start();
                if is_unsafe_reference(value) {
                    return true;
                }
            }
        }
        search_from = start + 4;
    }
    false
}

fn is_unsafe_reference(value: &str) -> bool {
    value.starts_with("http:")
        || value.starts_with("https:")
        || value.starts_with("//")
        || value.starts_with("javascript:")
        || value.starts_with("data:")
}

/// `@import` is always rejected (never legitimate in an SVG). `url(...)` is
/// rejected unless its target — after skipping optional whitespace and one
/// optional quote — is a same-document `#fragment` reference.
fn has_unsafe_import_or_url(lower: &str) -> bool {
    if lower.contains("@import") {
        return true;
    }
    let bytes = lower.as_bytes();
    let mut search_from = 0;
    while let Some(offset) = lower[search_from..].find("url(") {
        let start = search_from + offset + 4;
        let mut cursor = start;
        while bytes
            .get(cursor)
            .is_some_and(|&byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if matches!(bytes.get(cursor), Some(b'"') | Some(b'\'')) {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'#') {
            return true;
        }
        search_from = start;
    }
    false
}

#[cfg(test)]
mod tests;
