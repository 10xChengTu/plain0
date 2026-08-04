//! Capture-group replacement expansion — F200 S2 of
//! `docs/research/2026-08-04-complete-search.md`'s "架构裁定 2".
//!
//! `workspace_search_expand_replacements` never touches the filesystem and
//! needs no `rootId`: it is a pure, bounded computation over a batch of
//! previously-produced text-search match strings (`expectedTexts`) plus one
//! replacement template. For each entry it anchored-re-matches `pattern`
//! (built through [`super::text_search::build_regex_matcher`], the exact
//! same regex pipeline the original search used — never a second,
//! independently-implemented matcher) against the *entire* `expectedText`
//! and, only on a full-string match, expands the template's `$0`…`$n`/
//! `$name`/`$$` references using that match's own capture groups.
//!
//! # Anchored re-match, not upstream `Captures::interpolate`
//!
//! `grep_matcher::Matcher::captures_at` finds the first match *anywhere at or
//! after* a given offset — it is not itself anchored to the start of the
//! haystack, let alone required to consume the whole thing. This module
//! therefore explicitly checks that the reported match's `start`/`end` cover
//! the entire `expectedText` (`0..expectedText.len()`); anything short of
//! that — no match at all, or a match that only covers part of the string —
//! is reported as [`no_match_item`], not silently accepted as a
//! partial/prefix match.
//!
//! Template expansion itself is **not** done via `grep_matcher::Captures::
//! interpolate` (the trait's own default implementation): that method
//! silently substitutes an empty string for a `$N`/`$name` reference that
//! does not resolve to a real capture group, and its underlying free
//! function (`grep_matcher::interpolate::interpolate`) is a private
//! implementation detail of that crate — not reachable from outside it even
//! if this module wanted to supply its own resolution callback. The frozen
//! decision explicitly forbids that "silently empty" semantic for an
//! out-of-range group reference (fail-closed, not silent), so this module
//! implements its own small template scanner ([`tokenize_template`]) and
//! resolves each reference itself, failing that one entry closed
//! ([`invalid_group_item`]) the moment a numbered reference is `>=` the
//! pattern's own capture count or a named reference does not resolve via
//! [`grep_matcher::Matcher::capture_index`]. A capture group that is
//! in-range but simply did not participate in this particular match (e.g. an
//! unmatched alternation branch) is *not* "out of range" — that still
//! expands to an empty string, matching ordinary regex-replace semantics
//! (VS Code, `sed`, JavaScript's `String.prototype.replace`, ...).
//!
//! # Per-entry output bound
//!
//! A template that repeats a reference (`"$1$1$1...$1"`) can multiply one
//! `expectedText` into an output many times its own length. Independent of
//! the three whole-command-rejection ceilings in `search::dto`
//! (`expectedTexts` list length, one entry's byte length, the template's
//! byte length), [`MAX_REPLACE_EXPAND_OUTPUT_BYTES`] bounds one entry's
//! *expanded* byte length; it is enforced incrementally as the output is
//! built (see [`push_bounded`]) so an adversarial entry's CPU/memory cost is
//! also capped at that value rather than the full, unbounded product before
//! the check ever runs. Exceeding it fails just that one entry closed
//! ([`too_large_item`]) — it can never fail the whole command.

use grep_matcher::{Captures, Matcher};
use grep_regex::{RegexCaptures, RegexMatcher};

use crate::error::CommandError;

use super::dto::{
    WorkspaceSearchExpandReplacementItem, WorkspaceSearchExpandReplacementsQuery,
    WorkspaceSearchExpandReplacementsResult, MAX_REPLACE_EXPAND_OUTPUT_BYTES,
};
use super::text_search::build_regex_matcher;

/// One reference parsed out of a replacement template by
/// [`tokenize_template`]: either a numbered group (`$0`, `$1`, `${12}`, ...)
/// or a named one (`$name`, `${name}`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TemplateRef<'a> {
    Number(usize),
    Name(&'a str),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TemplateToken<'a> {
    Literal(&'a [u8]),
    Ref(TemplateRef<'a>),
}

fn is_template_ref_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// Parses one reference starting at `rest[0] == b'$'` (already established by
/// the caller, and `rest[1]` already known not to be a second `$`). Returns
/// the parsed reference plus how many bytes it consumed, or `None` if `rest`
/// does not actually hold a valid reference (e.g. `$` at the end of the
/// template, or an empty/unterminated `${...}`) — the caller treats that `$`
/// as a literal character in that case, mirroring how every other
/// `$name`-style template syntax (VS Code included) handles a bare `$`.
fn parse_template_ref(rest: &[u8]) -> Option<(TemplateRef<'_>, usize)> {
    let braced = rest.get(1) == Some(&b'{');
    let name_start = 1 + usize::from(braced);
    let mut cursor = name_start;
    while rest
        .get(cursor)
        .is_some_and(|byte| is_template_ref_byte(*byte))
    {
        cursor += 1;
    }
    if cursor == name_start {
        return None;
    }
    let name_end = cursor;
    if braced {
        if rest.get(cursor) != Some(&b'}') {
            return None;
        }
        cursor += 1;
    }
    // `name_start..name_end` was just verified to contain only ASCII
    // alphanumerics/underscore, so this is always valid UTF-8.
    let name = std::str::from_utf8(&rest[name_start..name_end])
        .expect("template reference bytes are ASCII alphanumeric/underscore");
    let reference = match name.parse::<usize>() {
        Ok(number) => TemplateRef::Number(number),
        Err(_) => TemplateRef::Name(name),
    };
    Some((reference, cursor))
}

/// Tokenizes a replacement template into literal runs and `$`-references.
/// `$$` unescapes to one literal `$`; a bare `$` that is not followed by a
/// valid reference (or `$$`) is kept as a literal `$` and scanning resumes
/// from the next byte. Computed once per [`expand_replacements`] call (the
/// template is the same for every entry in the batch) rather than once per
/// entry.
fn tokenize_template(template: &[u8]) -> Vec<TemplateToken<'_>> {
    let mut tokens = Vec::new();
    let mut rest = template;
    while !rest.is_empty() {
        match rest.iter().position(|&byte| byte == b'$') {
            None => {
                tokens.push(TemplateToken::Literal(rest));
                break;
            }
            Some(0) => {
                if rest.get(1) == Some(&b'$') {
                    tokens.push(TemplateToken::Literal(&rest[..1]));
                    rest = &rest[2..];
                    continue;
                }
                match parse_template_ref(rest) {
                    Some((reference, consumed)) => {
                        tokens.push(TemplateToken::Ref(reference));
                        rest = &rest[consumed..];
                    }
                    None => {
                        tokens.push(TemplateToken::Literal(&rest[..1]));
                        rest = &rest[1..];
                    }
                }
            }
            Some(position) => {
                tokens.push(TemplateToken::Literal(&rest[..position]));
                rest = &rest[position..];
            }
        }
    }
    tokens
}

/// Appends `bytes` to `dst` unless doing so would push `dst` past
/// [`MAX_REPLACE_EXPAND_OUTPUT_BYTES`], in which case it appends nothing and
/// returns `false` (the caller fails that entry closed immediately, so an
/// adversarial template's CPU cost is bounded by the cap rather than by
/// whatever it was trying to build).
fn push_bounded(dst: &mut Vec<u8>, bytes: &[u8]) -> bool {
    if dst.len() + bytes.len() > MAX_REPLACE_EXPAND_OUTPUT_BYTES {
        return false;
    }
    dst.extend_from_slice(bytes);
    true
}

fn no_match_item() -> WorkspaceSearchExpandReplacementItem {
    WorkspaceSearchExpandReplacementItem::error(
        "SEARCH_REPLACE_EXPAND_NO_MATCH",
        "The recorded match text no longer matches the search pattern.",
    )
}

fn invalid_group_item() -> WorkspaceSearchExpandReplacementItem {
    WorkspaceSearchExpandReplacementItem::error(
        "SEARCH_REPLACE_EXPAND_INVALID_GROUP",
        "The replacement template references a capture group the pattern does not have.",
    )
}

fn too_large_item() -> WorkspaceSearchExpandReplacementItem {
    WorkspaceSearchExpandReplacementItem::error(
        "SEARCH_REPLACE_EXPAND_TOO_LARGE",
        "The expanded replacement text is too large.",
    )
}

fn invalid_utf8_item() -> WorkspaceSearchExpandReplacementItem {
    WorkspaceSearchExpandReplacementItem::error(
        "SEARCH_REPLACE_EXPAND_INVALID_UTF8",
        "The expanded replacement text is not valid UTF-8.",
    )
}

/// Expands `tokens` against `expected_text` using `matcher`/`caps`'s regex
/// pipeline. `caps` is reused across every entry in the batch (each call
/// re-populates it fresh via `captures_at`, discarding whatever the previous
/// entry left in it).
fn expand_one(
    matcher: &RegexMatcher,
    caps: &mut RegexCaptures,
    capture_count: usize,
    expected_text: &str,
    tokens: &[TemplateToken<'_>],
) -> WorkspaceSearchExpandReplacementItem {
    let haystack = expected_text.as_bytes();
    let matched = matcher.captures_at(haystack, 0, caps).unwrap_or(false);
    if !matched {
        return no_match_item();
    }
    let Some(overall) = caps.get(0) else {
        return no_match_item();
    };
    if overall.start() != 0 || overall.end() != haystack.len() {
        // A real match exists somewhere in/around the text, but it does not
        // cover the whole recorded match — an anchored full-string match is
        // required, not merely "some match exists".
        return no_match_item();
    }

    let mut dst: Vec<u8> = Vec::new();
    for token in tokens {
        match *token {
            TemplateToken::Literal(bytes) => {
                if !push_bounded(&mut dst, bytes) {
                    return too_large_item();
                }
            }
            TemplateToken::Ref(reference) => {
                let index = match reference {
                    TemplateRef::Number(number) => Some(number),
                    TemplateRef::Name(name) => matcher.capture_index(name),
                };
                let Some(index) = index.filter(|&index| index < capture_count) else {
                    return invalid_group_item();
                };
                if let Some(range) = caps.get(index) {
                    if !push_bounded(&mut dst, &haystack[range]) {
                        return too_large_item();
                    }
                }
            }
        }
    }
    match String::from_utf8(dst) {
        Ok(replacement) => WorkspaceSearchExpandReplacementItem::ok(replacement),
        Err(_) => invalid_utf8_item(),
    }
}

/// Expands every entry of `query.expected_texts` against
/// `query.replacement_template`, returning exactly one
/// [`WorkspaceSearchExpandReplacementItem`] per entry in the same order. The
/// only whole-command failure is an invalid `pattern` (`INVALID_SEARCH_REGEX`
/// — wire-shape validation of every other field already happened in
/// [`super::dto::WorkspaceSearchExpandReplacementsRequest::into_parts`]);
/// every other failure mode is scoped to one entry.
pub(crate) fn expand_replacements(
    query: WorkspaceSearchExpandReplacementsQuery,
) -> Result<WorkspaceSearchExpandReplacementsResult, CommandError> {
    let matcher = build_regex_matcher(
        &query.pattern,
        true,
        query.is_case_sensitive,
        query.is_word_match,
    )?;
    let capture_count = matcher.capture_count();
    let tokens = tokenize_template(query.replacement_template.as_bytes());
    let mut caps = matcher
        .new_captures()
        .expect("RegexMatcher::new_captures is infallible (grep_matcher::NoError)");

    let items = query
        .expected_texts
        .iter()
        .map(|expected_text| expand_one(&matcher, &mut caps, capture_count, expected_text, &tokens))
        .collect();
    Ok(WorkspaceSearchExpandReplacementsResult::new(items))
}

#[cfg(test)]
mod tests;
