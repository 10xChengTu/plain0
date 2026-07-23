use serde::{Deserialize, Serialize};

use crate::error::CommandError;
use crate::workspace::RootId;

/// Defensive upper bound on how many roots a single search request may name.
/// Plain currently authorizes a single workspace root, so this is a
/// hostile-input ceiling, not an expected value.
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

/// Response for `workspace_search_files`. `entries` are root-relative wire
/// paths (see [`crate::path_policy::RelativePath`]); this slice returns bare
/// paths rather than `{ rootId, path }` pairs because Plain currently
/// authorizes exactly one workspace root at a time (add-root/replace stay
/// disabled per `progress.md`'s single-directory stage), so a request naming
/// more than one root is defensively accepted but not expected, and a
/// hypothetical future multi-root caller would need this contract revisited.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchFilesResult {
    entries: Vec<String>,
    limit_hit: bool,
}

impl WorkspaceSearchFilesResult {
    pub(crate) fn new(entries: Vec<String>, limit_hit: bool) -> Self {
        Self { entries, limit_hit }
    }

    #[cfg(test)]
    pub(crate) fn entries(&self) -> &[String] {
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

#[cfg(test)]
mod tests;
