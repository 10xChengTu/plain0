use std::fmt;

use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::{Uuid, Variant};

use crate::error::CommandError;
use crate::workspace::RootId;

/// Defensive upper bound on how many roots a single search request may name.
/// Matches the workspace topology contract's 256-root ceiling.
const MAX_SEARCH_ROOTS: usize = 256;
const MAX_SEARCH_PATTERN_BYTES: usize = 4_096;
const MAX_SEARCH_EXCLUDE_GLOBS: usize = 64;
const MAX_SEARCH_EXCLUDE_GLOB_BYTES: usize = 1_024;
/// Hard ceiling Rust enforces regardless of what the caller requests; the
/// Workbench client already caps its own request at 512 (upstream Quick
/// Open's `MAX_RESULTS`), this is a second, independent backstop.
pub(crate) const MAX_SEARCH_RESULTS_HARD_CAP: u32 = 2_048;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSearchFilesRequest {
    roots: Vec<RootId>,
    file_pattern: String,
    exclude_globs: Vec<String>,
    max_results: u32,
}

/// A [`WorkspaceSearchFilesRequest`] after wire validation: every field is
/// still exactly what the caller sent (this slice fixes `.gitignore`
/// handling to "always respect it" and does not expose an `includeGlobs` or
/// `useIgnoreFiles` toggle — see the frozen decision in
/// `docs/research/2026-07-23-search-quickopen.md`), except `maxResults`,
/// which is clamped to a safe, always-satisfiable range.
#[derive(Debug)]
pub struct WorkspaceSearchFilesQuery {
    pub(crate) roots: Vec<RootId>,
    pub(crate) file_pattern: String,
    pub(crate) exclude_globs: Vec<String>,
    pub(crate) max_results: usize,
}

impl WorkspaceSearchFilesRequest {
    pub fn into_parts(self) -> Result<WorkspaceSearchFilesQuery, CommandError> {
        if self.roots.is_empty() || self.roots.len() > MAX_SEARCH_ROOTS {
            return Err(invalid_search_request());
        }
        if self.file_pattern.len() > MAX_SEARCH_PATTERN_BYTES {
            return Err(invalid_search_request());
        }
        if self.exclude_globs.len() > MAX_SEARCH_EXCLUDE_GLOBS {
            return Err(invalid_search_request());
        }
        for glob in &self.exclude_globs {
            if glob.is_empty() || glob.len() > MAX_SEARCH_EXCLUDE_GLOB_BYTES {
                return Err(invalid_search_request());
            }
        }
        let max_results = self.max_results.clamp(1, MAX_SEARCH_RESULTS_HARD_CAP) as usize;
        Ok(WorkspaceSearchFilesQuery {
            roots: self.roots,
            file_pattern: self.file_pattern,
            exclude_globs: self.exclude_globs,
            max_results,
        })
    }
}

/// One file-search hit. `path` is relative to the exact authorized `root_id`
/// that produced it; the pair is indivisible so duplicate relative paths in
/// different workspace roots never collapse onto the first root.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchFileEntry {
    root_id: RootId,
    path: String,
}

impl WorkspaceSearchFileEntry {
    pub(crate) const fn new(root_id: RootId, path: String) -> Self {
        Self { root_id, path }
    }

    #[cfg(test)]
    pub(crate) const fn root_id(&self) -> RootId {
        self.root_id
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &str {
        &self.path
    }
}

/// Response for `workspace_search_files`. Every entry retains the root
/// identity leased before traversal; no consumer has to infer it from request
/// order.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchFilesResult {
    entries: Vec<WorkspaceSearchFileEntry>,
    limit_hit: bool,
}

impl WorkspaceSearchFilesResult {
    pub(crate) fn new(entries: Vec<WorkspaceSearchFileEntry>, limit_hit: bool) -> Self {
        Self { entries, limit_hit }
    }

    #[cfg(test)]
    pub(crate) fn entries(&self) -> Vec<&str> {
        self.entries
            .iter()
            .map(WorkspaceSearchFileEntry::path)
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn entry_records(&self) -> &[WorkspaceSearchFileEntry] {
        &self.entries
    }

    #[cfg(test)]
    pub(crate) fn limit_hit(&self) -> bool {
        self.limit_hit
    }
}

fn invalid_search_request() -> CommandError {
    CommandError::new(
        "INVALID_SEARCH_REQUEST",
        "The workspace file search request is invalid.",
    )
}

// --- Streaming text search (F040 S3) ---------------------------------------

/// Defensive upper bound on how many roots a single text search request may
/// name. Same rationale as [`MAX_SEARCH_ROOTS`].
const MAX_TEXT_SEARCH_ROOTS: usize = 256;
const MAX_TEXT_SEARCH_PATTERN_BYTES: usize = 4_096;
const MAX_TEXT_SEARCH_EXCLUDE_GLOBS: usize = 64;
const MAX_TEXT_SEARCH_EXCLUDE_GLOB_BYTES: usize = 1_024;
/// Hard ceiling Rust enforces regardless of what the caller requests. This
/// mirrors upstream's own `search.maxResults` default (20000): Plain treats
/// that value as both the default *and* the absolute hard cap, rather than
/// having a separate, larger defensive ceiling the way file search does
/// (file search's Quick Open client already caps its own request at 512, so
/// its independent Rust-side ceiling of 2048 is only ever a hostile-input
/// backstop; text search's UI has no smaller client-side cap of its own, so
/// this constant is the real, user-visible limit).
pub(crate) const MAX_TEXT_SEARCH_RESULTS_HARD_CAP: u32 = 20_000;
/// Default per-file size ceiling when `maxFileSize` is omitted: matches the
/// existing 8 MiB bound already used by `workspace_read_file` and file
/// search's `.gitignore` reader.
const DEFAULT_TEXT_SEARCH_MAX_FILE_SIZE: u64 = 8 * 1_024 * 1_024;
/// Absolute ceiling on a caller-requested `maxFileSize`, regardless of what is
/// asked for: defense against a request trying to force Rust to buffer an
/// unreasonably large file per candidate.
const MAX_TEXT_SEARCH_MAX_FILE_SIZE_HARD_CAP: u64 = 64 * 1_024 * 1_024;

/// An opaque, window-bound identity for one streaming text search task.
/// Validated the same strict way `workspace::dto::DeleteConfirmationId` is
/// (exact-length, version-4, RFC4122 hyphenated string), but redacted in
/// `Debug` so it never leaks into a log line by accident.
#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct SearchId(Uuid);

impl SearchId {
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

impl fmt::Debug for SearchId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("search id")
            .field(&"<redacted>")
            .finish()
    }
}

impl Serialize for SearchId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for SearchId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        let value = Uuid::parse_str(&wire).map_err(|_| D::Error::custom("invalid search id"))?;
        if value.get_version_num() != 4
            || value.get_variant() != Variant::RFC4122
            || value.hyphenated().to_string() != wire
        {
            return Err(D::Error::custom("invalid search id"));
        }
        Ok(Self(value))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSearchTextStartRequest {
    roots: Vec<RootId>,
    pattern: String,
    is_reg_exp: bool,
    is_case_sensitive: bool,
    is_word_match: bool,
    exclude_globs: Vec<String>,
    max_results: u32,
    max_file_size: Option<u64>,
}

/// A [`WorkspaceSearchTextStartRequest`] after wire-shape validation. Every
/// field is still exactly what the caller sent except `maxResults`/
/// `maxFileSize`, which are clamped to a safe, always-satisfiable range; the
/// pattern itself is not yet compiled into a matcher (that happens in
/// `search::text_search::compile_query`, which reports a syntax error as
/// `INVALID_SEARCH_REGEX` rather than a generic wire-shape rejection).
#[derive(Debug)]
pub struct WorkspaceSearchTextQuery {
    pub(crate) roots: Vec<RootId>,
    pub(crate) pattern: String,
    pub(crate) is_reg_exp: bool,
    pub(crate) is_case_sensitive: bool,
    pub(crate) is_word_match: bool,
    pub(crate) exclude_globs: Vec<String>,
    pub(crate) max_results: usize,
    pub(crate) max_file_size: u64,
}

impl WorkspaceSearchTextStartRequest {
    pub fn into_parts(self) -> Result<WorkspaceSearchTextQuery, CommandError> {
        if self.roots.is_empty() || self.roots.len() > MAX_TEXT_SEARCH_ROOTS {
            return Err(invalid_search_text_request());
        }
        if self.pattern.is_empty() || self.pattern.len() > MAX_TEXT_SEARCH_PATTERN_BYTES {
            return Err(invalid_search_text_request());
        }
        if self.exclude_globs.len() > MAX_TEXT_SEARCH_EXCLUDE_GLOBS {
            return Err(invalid_search_text_request());
        }
        for glob in &self.exclude_globs {
            if glob.is_empty() || glob.len() > MAX_TEXT_SEARCH_EXCLUDE_GLOB_BYTES {
                return Err(invalid_search_text_request());
            }
        }
        let max_results = self.max_results.clamp(1, MAX_TEXT_SEARCH_RESULTS_HARD_CAP) as usize;
        let max_file_size = self
            .max_file_size
            .unwrap_or(DEFAULT_TEXT_SEARCH_MAX_FILE_SIZE)
            .clamp(1, MAX_TEXT_SEARCH_MAX_FILE_SIZE_HARD_CAP);
        Ok(WorkspaceSearchTextQuery {
            roots: self.roots,
            pattern: self.pattern,
            is_reg_exp: self.is_reg_exp,
            is_case_sensitive: self.is_case_sensitive,
            is_word_match: self.is_word_match,
            exclude_globs: self.exclude_globs,
            max_results,
            max_file_size,
        })
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchTextStartResult {
    search_id: SearchId,
}

impl WorkspaceSearchTextStartResult {
    pub(crate) const fn new(search_id: SearchId) -> Self {
        Self { search_id }
    }

    #[cfg(test)]
    pub(crate) const fn search_id(self) -> SearchId {
        self.search_id
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSearchTextPollRequest {
    search_id: SearchId,
    cursor: u64,
}

impl WorkspaceSearchTextPollRequest {
    /// `cursor` is a wire `u64`, so every value that can deserialize at all
    /// is already in range; further validity (whether it matches what this
    /// search has actually delivered so far) is checked by
    /// `TextSearchHandle::poll`, which is the only place with the state to
    /// know.
    pub fn into_parts(self) -> Result<(SearchId, u64), CommandError> {
        Ok((self.search_id, self.cursor))
    }
}

/// Preview text is truncated to at most this many UTF-16 code units (Monaco's
/// own column unit): a defense-in-depth payload-size bound, independent of
/// the upstream `ITextSearchPreviewOptions.charsPerLine` windowing the
/// Workbench applies on top of whatever Rust returns. See
/// `search::text_search`'s module doc for how `column`/`length` stay valid
/// within this bound even when the real match sits far into a very long
/// line.
pub(crate) const TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS: usize = 256;

/// One matched range within one searched file.
///
/// `column` is a **preview-relative** UTF-16 column (1-indexed, matching
/// Monaco's own column unit): valid only for indexing into this same match's
/// `previewText`, per the module doc's "Preview windowing" section. For a
/// line short enough that the preview window starts at column 1, `column`
/// and `absolute_column` coincide; for a match far into a line longer than
/// [`TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS`], the preview window is rebased to
/// start at the match itself, and `column` no longer reflects the match's
/// real position in the file.
///
/// `absolute_column` is the same match's UTF-16 column (1-indexed) within
/// the **actual, full source line**, independent of any preview-window
/// truncation or rebasing — this is what a caller must use to build a
/// precise edit `Range` (F040 S4 replace) or to jump a real editor selection
/// to the match, regardless of how long the line is. `length` (in UTF-16
/// code units) is identical either way, since window rebasing only shifts
/// the reported start, never the match's own extent.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchTextMatch {
    line: u32,
    column: u32,
    length: u32,
    preview_text: String,
    absolute_column: u32,
}

impl WorkspaceSearchTextMatch {
    pub(crate) const fn new(
        line: u32,
        column: u32,
        length: u32,
        preview_text: String,
        absolute_column: u32,
    ) -> Self {
        Self {
            line,
            column,
            length,
            preview_text,
            absolute_column,
        }
    }

    #[cfg(test)]
    pub(crate) const fn line(&self) -> u32 {
        self.line
    }

    #[cfg(test)]
    pub(crate) const fn column(&self) -> u32 {
        self.column
    }

    #[cfg(test)]
    pub(crate) const fn length(&self) -> u32 {
        self.length
    }

    #[cfg(test)]
    pub(crate) fn preview_text(&self) -> &str {
        &self.preview_text
    }

    #[cfg(test)]
    pub(crate) const fn absolute_column(&self) -> u32 {
        self.absolute_column
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchTextBatch {
    root_id: RootId,
    path: String,
    matches: Vec<WorkspaceSearchTextMatch>,
}

impl WorkspaceSearchTextBatch {
    pub(crate) const fn new(
        root_id: RootId,
        path: String,
        matches: Vec<WorkspaceSearchTextMatch>,
    ) -> Self {
        Self {
            root_id,
            path,
            matches,
        }
    }

    #[cfg(test)]
    pub(crate) const fn root_id(&self) -> RootId {
        self.root_id
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &str {
        &self.path
    }

    #[cfg(test)]
    pub(crate) fn matches(&self) -> &[WorkspaceSearchTextMatch] {
        &self.matches
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchTextSkipped {
    binary: u32,
    oversize: u32,
}

impl WorkspaceSearchTextSkipped {
    pub(crate) const fn new(binary: u32, oversize: u32) -> Self {
        Self { binary, oversize }
    }

    #[cfg(test)]
    pub(crate) const fn binary(self) -> u32 {
        self.binary
    }

    #[cfg(test)]
    pub(crate) const fn oversize(self) -> u32 {
        self.oversize
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchTextPollResult {
    batches: Vec<WorkspaceSearchTextBatch>,
    next_cursor: u64,
    done: bool,
    limit_hit: bool,
    skipped: WorkspaceSearchTextSkipped,
}

impl WorkspaceSearchTextPollResult {
    pub(crate) const fn new(
        batches: Vec<WorkspaceSearchTextBatch>,
        next_cursor: u64,
        done: bool,
        limit_hit: bool,
        skipped: WorkspaceSearchTextSkipped,
    ) -> Self {
        Self {
            batches,
            next_cursor,
            done,
            limit_hit,
            skipped,
        }
    }

    #[cfg(test)]
    pub(crate) fn batches(&self) -> &[WorkspaceSearchTextBatch] {
        &self.batches
    }

    #[cfg(test)]
    pub(crate) const fn next_cursor(&self) -> u64 {
        self.next_cursor
    }

    #[cfg(test)]
    pub(crate) const fn done(&self) -> bool {
        self.done
    }

    #[cfg(test)]
    pub(crate) const fn limit_hit(&self) -> bool {
        self.limit_hit
    }

    #[cfg(test)]
    pub(crate) const fn skipped(&self) -> WorkspaceSearchTextSkipped {
        self.skipped
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSearchTextCancelRequest {
    search_id: SearchId,
}

impl WorkspaceSearchTextCancelRequest {
    pub const fn search_id(self) -> SearchId {
        self.search_id
    }
}

/// Window-targeted wake hint for one active text search, mirroring
/// `workspace::dto::WorkspaceWatchWakeEvent`'s own precedent of carrying an
/// identity field rather than being strictly payload-less: a window can have
/// at most one active search, but a wake for a search the frontend already
/// superseded (by starting a new one) must be identifiable and ignorable.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchTextWakeEvent {
    search_id: SearchId,
}

impl WorkspaceSearchTextWakeEvent {
    pub(crate) const fn new(search_id: SearchId) -> Self {
        Self { search_id }
    }
}

pub(crate) fn invalid_search_text_request() -> CommandError {
    CommandError::new(
        "INVALID_SEARCH_REQUEST",
        "The workspace text search request is invalid.",
    )
}

pub(crate) fn search_not_found() -> CommandError {
    CommandError::new(
        "WORKSPACE_SEARCH_NOT_FOUND",
        "The workspace text search is no longer available.",
    )
}

pub(crate) fn invalid_search_regex(message: impl Into<String>) -> CommandError {
    CommandError::new("INVALID_SEARCH_REGEX", message)
}

// --- Capture-group replacement expansion (F200 S2) --------------------------

/// Reuses `MAX_TEXT_SEARCH_PATTERN_BYTES` for `pattern`: it is the exact same
/// field, produced by the exact same search this batch's `expectedTexts`
/// came from.
///
/// `replacementTemplate` gets its own, separate bound (rather than also
/// reusing `MAX_TEXT_SEARCH_PATTERN_BYTES`) because it is a conceptually
/// different field the caller types into a different input box; the two
/// happening to share a numeric value today is coincidence, not a promise.
const MAX_REPLACE_EXPAND_TEMPLATE_BYTES: usize = 4_096;
/// Real usage bounds one `expectedText` far below this: it is always a slice
/// of a Rust-produced `previewText`
/// ([`TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS`], 256 UTF-16 units), or, for the
/// vendor open-editor-substitution fallback documented on
/// `plain-search-view.ts`'s `ResolvedMatchLocation`, one match's slice of a
/// live Monaco model's own bounded preview text. This ceiling is generous
/// headroom over both, not a real-world limit.
const MAX_REPLACE_EXPAND_EXPECTED_TEXT_BYTES: usize = 4_096;
/// Aligns with [`MAX_TEXT_SEARCH_RESULTS_HARD_CAP`]: a "Replace All" can
/// legitimately name as many entries as one text search can ever return.
const MAX_REPLACE_EXPAND_ENTRIES: usize = 20_000;
/// Per-entry cap on the fully-expanded replacement text's byte length —
/// independent of, and much smaller than, the three "reject the whole
/// command" ceilings above. A template that repeats `$1` many times over
/// (e.g. `"$1$1$1...$1"`) can multiply one `expectedText` far past its own
/// length; without this bound that multiplication is checked incrementally
/// while [`super::replace::expand_replacements`] builds the output (so an
/// adversarial entry's CPU/memory cost is also capped at this value, not the
/// full unbounded product), and the entry fails closed as one more
/// [`WorkspaceSearchExpandReplacementItem::Error`] rather than growing an
/// unbounded `String`.
pub(crate) const MAX_REPLACE_EXPAND_OUTPUT_BYTES: usize = 8_192;

/// Wire request for `workspace_search_expand_replacements` (F200 S2): expands
/// `replacementTemplate`'s `$1`…`$n`/`$0`/`$$`/`$name` capture-group
/// references against each entry of `expectedTexts` by anchored re-matching
/// with the exact same regex pipeline `workspace_search_text_start` uses
/// (via [`super::text_search::build_regex_matcher`], not a second, drifting
/// implementation). `isRegExp` must be `true` — this command only ever makes
/// sense for a regex-mode search (see this module's own architecture note in
/// `docs/research/2026-08-04-complete-search.md`'s "架构裁定 2"); the
/// frontend never issues it for a literal-mode search, and a request
/// claiming otherwise is rejected outright by [`Self::into_parts`] rather
/// than silently honored.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSearchExpandReplacementsRequest {
    pattern: String,
    is_reg_exp: bool,
    is_case_sensitive: bool,
    is_word_match: bool,
    replacement_template: String,
    expected_texts: Vec<String>,
}

/// A [`WorkspaceSearchExpandReplacementsRequest`] after wire-shape
/// validation: every field is still exactly what the caller sent (`isRegExp`
/// itself is dropped since [`Self`] only ever exists once it is known to be
/// `true`).
#[derive(Debug)]
pub struct WorkspaceSearchExpandReplacementsQuery {
    pub(crate) pattern: String,
    pub(crate) is_case_sensitive: bool,
    pub(crate) is_word_match: bool,
    pub(crate) replacement_template: String,
    pub(crate) expected_texts: Vec<String>,
}

impl WorkspaceSearchExpandReplacementsRequest {
    pub fn into_parts(self) -> Result<WorkspaceSearchExpandReplacementsQuery, CommandError> {
        if !self.is_reg_exp {
            return Err(invalid_search_replace_request());
        }
        if self.pattern.is_empty() || self.pattern.len() > MAX_TEXT_SEARCH_PATTERN_BYTES {
            return Err(invalid_search_replace_request());
        }
        if self.replacement_template.len() > MAX_REPLACE_EXPAND_TEMPLATE_BYTES {
            return Err(invalid_search_replace_request());
        }
        if self.expected_texts.is_empty() || self.expected_texts.len() > MAX_REPLACE_EXPAND_ENTRIES
        {
            return Err(invalid_search_replace_request());
        }
        for text in &self.expected_texts {
            if text.len() > MAX_REPLACE_EXPAND_EXPECTED_TEXT_BYTES {
                return Err(invalid_search_replace_request());
            }
        }
        Ok(WorkspaceSearchExpandReplacementsQuery {
            pattern: self.pattern,
            is_case_sensitive: self.is_case_sensitive,
            is_word_match: self.is_word_match,
            replacement_template: self.replacement_template,
            expected_texts: self.expected_texts,
        })
    }
}

/// One `expectedTexts` entry's expansion outcome. `Error` never fails the
/// whole command — see [`WorkspaceSearchExpandReplacementsResult`] — the
/// frontend coordinator treats that one entry's owning resource as a save
/// conflict and writes nothing to it (frozen decision, not a stopgap: see
/// `docs/research/2026-08-04-complete-search.md`'s "架构裁定 2").
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceSearchExpandReplacementItem {
    Ok { replacement: String },
    Error { code: String, message: String },
}

impl WorkspaceSearchExpandReplacementItem {
    pub(crate) fn ok(replacement: String) -> Self {
        Self::Ok { replacement }
    }

    pub(crate) fn error(code: &'static str, message: impl Into<String>) -> Self {
        Self::Error {
            code: code.to_owned(),
            message: message.into(),
        }
    }

    #[cfg(test)]
    pub(crate) fn as_ok(&self) -> Option<&str> {
        match self {
            Self::Ok { replacement } => Some(replacement.as_str()),
            Self::Error { .. } => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn as_error_code(&self) -> Option<&str> {
        match self {
            Self::Error { code, .. } => Some(code.as_str()),
            Self::Ok { .. } => None,
        }
    }
}

/// Response for `workspace_search_expand_replacements`: exactly one
/// [`WorkspaceSearchExpandReplacementItem`] per entry of the request's
/// `expectedTexts`, in the same order.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchExpandReplacementsResult {
    items: Vec<WorkspaceSearchExpandReplacementItem>,
}

impl WorkspaceSearchExpandReplacementsResult {
    pub(crate) fn new(items: Vec<WorkspaceSearchExpandReplacementItem>) -> Self {
        Self { items }
    }

    #[cfg(test)]
    pub(crate) fn items(&self) -> &[WorkspaceSearchExpandReplacementItem] {
        &self.items
    }
}

pub(crate) fn invalid_search_replace_request() -> CommandError {
    CommandError::new(
        "INVALID_SEARCH_REQUEST",
        "The workspace search replace expansion request is invalid.",
    )
}

#[cfg(test)]
mod tests;
