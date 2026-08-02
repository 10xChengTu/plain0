//! Bounded, capability-relative file-enumeration for Quick Open.
//!
//! Every directory is opened `nofollow` from the previous frame's already-open
//! handle; nothing here calls an ambient `std::fs` function or reopens a path
//! from a string. Symlinks are never followed and never reported as matches:
//! classifying a symlink's target would require dereferencing it, which is
//! exactly what "capability-relative, nofollow" (AGENTS.md's native-service
//! rules) forbids during traversal. This is a documented scope limitation,
//! not an oversight — a symlinked file will not appear in Quick Open results.

use std::io::Read;
use std::path::Path;

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match;

use crate::error::CommandError;
use crate::workspace::WorkspaceRootLease;

use super::dto::{WorkspaceSearchFileEntry, WorkspaceSearchFilesQuery, WorkspaceSearchFilesResult};

/// Total directory entries (files, directories, symlinks and other node
/// types combined) a single search request may visit across every requested
/// root before it safely truncates. Exceeding this stops the whole search
/// (not just the current subtree) and sets `limitHit`; it never fails the
/// request.
pub(crate) const MAX_SEARCH_TREE_ENTRIES: usize = 50_000;
/// Maximum directory nesting depth below any requested root. Exceeding this
/// also stops the whole search and sets `limitHit`.
pub(crate) const MAX_SEARCH_TREE_DEPTH: usize = 256;
pub(crate) const MAX_SEARCH_ENTRY_NAME_BYTES: usize = 1_024;
/// `.gitignore` files larger than this are skipped entirely (treated as if
/// absent) rather than failing the search; they still count once against
/// [`MAX_SEARCH_TREE_ENTRIES`] like any other directory entry.
const MAX_SEARCH_GITIGNORE_BYTES: usize = 8 * 1_024 * 1_024;
const GITIGNORE_FILE_NAME: &str = ".gitignore";

/// Shared with `search::text_search`, which reuses this module's bounded
/// traversal (budgets, gitignore layering, exclude globs, name validation) to
/// enumerate candidate files, rather than re-implementing it — see that
/// module's doc comment for why the outer per-file action differs (streaming
/// grep vs. name collection) even though the walk itself is one
/// implementation.
#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

struct ScanFrame {
    directory: Dir,
    wire: String,
    depth: usize,
    gitignores: Vec<Gitignore>,
    names: std::vec::IntoIter<(String, EntryKind)>,
}

pub(crate) struct BudgetExceeded;

/// Runs one file-search query against already-leased roots. Read-only: never
/// creates, writes, renames or deletes anything, and never re-derives a path
/// from a string once inside a root — every recursive step opens the next
/// component from the previous frame's live `Dir` handle.
pub(crate) fn search_roots(
    leases: &[WorkspaceRootLease],
    query: &WorkspaceSearchFilesQuery,
) -> Result<WorkspaceSearchFilesResult, CommandError> {
    let exclude_set = compile_exclude_globs(&query.exclude_globs)?;
    let pattern_lower = query.file_pattern.to_lowercase();
    let mut entries: Vec<WorkspaceSearchFileEntry> = Vec::new();
    let mut limit_hit = false;
    let mut visited = 0_usize;

    for lease in leases {
        let root_id = lease.root_id();
        let Ok(root) = lease.directory().try_clone() else {
            continue;
        };
        let root_is_dir = root
            .dir_metadata()
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false);
        if !root_is_dir {
            continue;
        }

        let root_gitignore = read_gitignore(&root, "");
        let names = match collect_entries(&root, &mut visited) {
            Ok(names) => names,
            Err(BudgetExceeded) => {
                limit_hit = true;
                break;
            }
        };
        let mut frames = vec![ScanFrame {
            directory: root,
            wire: String::new(),
            depth: 0,
            gitignores: vec![root_gitignore],
            names: names.into_iter(),
        }];

        'frames: while let Some(frame) = frames.last_mut() {
            let Some((name, kind)) = frame.names.next() else {
                frames.pop();
                continue;
            };
            let child_wire = if frame.wire.is_empty() {
                name.clone()
            } else {
                format!("{}/{name}", frame.wire)
            };
            let is_dir = kind == EntryKind::Directory;
            let excluded = exclude_set.is_match(&child_wire)
                || matched_gitignore(&frame.gitignores, &child_wire, is_dir);

            match kind {
                EntryKind::Directory => {
                    if excluded {
                        continue;
                    }
                    let depth = frame.depth + 1;
                    if depth > MAX_SEARCH_TREE_DEPTH {
                        // Depth overflow is local to this one branch: prune
                        // it (do not descend) but keep visiting this
                        // directory's remaining, still-in-budget siblings.
                        // Unlike the entries-visited budget below, this must
                        // not abort the whole search — a shallow sibling
                        // file must not be dropped just because an unrelated
                        // deep excursion happened to be explored first.
                        limit_hit = true;
                        continue;
                    }
                    let Ok(child) = frame.directory.open_dir_nofollow(Path::new(&name)) else {
                        continue;
                    };
                    let child_gitignore = read_gitignore(&child, &child_wire);
                    let child_names = match collect_entries(&child, &mut visited) {
                        Ok(names) => names,
                        Err(BudgetExceeded) => {
                            limit_hit = true;
                            break 'frames;
                        }
                    };
                    let mut gitignores = frame.gitignores.clone();
                    gitignores.push(child_gitignore);
                    frames.push(ScanFrame {
                        directory: child,
                        wire: child_wire,
                        depth,
                        gitignores,
                        names: child_names.into_iter(),
                    });
                }
                EntryKind::File => {
                    if excluded {
                        continue;
                    }
                    if !pattern_lower.is_empty()
                        && !is_subsequence(&pattern_lower, &child_wire.to_lowercase())
                    {
                        continue;
                    }
                    entries.push(WorkspaceSearchFileEntry::new(root_id, child_wire));
                    if entries.len() >= query.max_results {
                        limit_hit = true;
                        break 'frames;
                    }
                }
                EntryKind::Symlink | EntryKind::Other => {
                    // Never followed and never reported; see module doc.
                }
            }
        }

        if limit_hit {
            break;
        }
    }

    Ok(WorkspaceSearchFilesResult::new(entries, limit_hit))
}

pub(crate) fn collect_entries(
    directory: &Dir,
    visited: &mut usize,
) -> Result<Vec<(String, EntryKind)>, BudgetExceeded> {
    let mut names = Vec::new();
    let Ok(read_dir) = directory.entries() else {
        return Ok(names);
    };
    for entry in read_dir {
        let Ok(entry) = entry else {
            continue;
        };
        *visited = visited
            .checked_add(1)
            .filter(|count| *count <= MAX_SEARCH_TREE_ENTRIES)
            .ok_or(BudgetExceeded)?;
        let Ok(name) = entry.file_name().into_string() else {
            // Non-UTF-8 names are skipped rather than failing the whole
            // search: one unrepresentable descendant must not hide every
            // sibling from Quick Open.
            continue;
        };
        if name.is_empty() || name.len() > MAX_SEARCH_ENTRY_NAME_BYTES {
            continue;
        }
        let Ok(metadata) = directory.symlink_metadata(Path::new(&name)) else {
            continue;
        };
        let kind = if metadata.file_type().is_symlink() {
            EntryKind::Symlink
        } else if metadata.is_dir() {
            EntryKind::Directory
        } else if metadata.is_file() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        names.push((name, kind));
    }
    names.sort_unstable_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    Ok(names)
}

pub(crate) fn compile_exclude_globs(patterns: &[String]) -> Result<GlobSet, CommandError> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        let glob = GlobBuilder::new(pattern)
            .literal_separator(true)
            .build()
            .map_err(|_| invalid_exclude_glob())?;
        builder.add(glob);
    }
    builder.build().map_err(|_| invalid_exclude_glob())
}

/// Builds the `.gitignore` matcher for exactly one directory (`wire_root` is
/// that directory's own root-relative wire path, `""` for the search root
/// itself). Matching a descendant strips this directory's own prefix before
/// testing patterns, so callers always pass the full root-relative wire path
/// of the candidate — never a path relative to this one directory.
pub(crate) fn read_gitignore(directory: &Dir, wire_root: &str) -> Gitignore {
    let mut builder = GitignoreBuilder::new(wire_root);
    if let Some(bytes) = read_gitignore_bytes(directory) {
        if let Ok(text) = std::str::from_utf8(&bytes) {
            for line in text.lines() {
                let _ = builder.add_line(None, line);
            }
        }
        // A non-UTF-8 .gitignore is treated as absent: best-effort parsing,
        // consistent with skipping other unrepresentable descendants.
    }
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

fn read_gitignore_bytes(directory: &Dir) -> Option<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = directory
        .open_with(Path::new(GITIGNORE_FILE_NAME), &options)
        .ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_SEARCH_GITIGNORE_BYTES as u64 {
        return None;
    }
    let mut buffer = Vec::new();
    let cap = (MAX_SEARCH_GITIGNORE_BYTES as u64).saturating_add(1);
    let mut limited = file.take(cap);
    limited.read_to_end(&mut buffer).ok()?;
    if buffer.len() > MAX_SEARCH_GITIGNORE_BYTES {
        return None;
    }
    Some(buffer)
}

/// Walks the directory's `.gitignore` chain from most specific (this
/// directory) to least specific (the search root), returning the first
/// opinion found — matching `git`'s own precedence, where a closer
/// `.gitignore` (including a `!` re-include) overrides a more distant one.
pub(crate) fn matched_gitignore(chain: &[Gitignore], wire: &str, is_dir: bool) -> bool {
    for gitignore in chain.iter().rev() {
        match gitignore.matched(wire, is_dir) {
            Match::None => continue,
            Match::Ignore(_) => return true,
            Match::Whitelist(_) => return false,
        }
    }
    false
}

/// Cheap, non-scoring case-insensitive subsequence test: every character of
/// `pattern` (already lowercased by the caller) must appear in `haystack`
/// (already lowercased by the caller) in order, not necessarily contiguous.
/// This is a prefilter only; ranking/highlighting stays in the upstream
/// TypeScript fuzzy scorer that already runs over whatever Rust returns.
fn is_subsequence(pattern: &str, haystack: &str) -> bool {
    let mut haystack_chars = haystack.chars();
    'outer: for pattern_char in pattern.chars() {
        for haystack_char in haystack_chars.by_ref() {
            if haystack_char == pattern_char {
                continue 'outer;
            }
        }
        return false;
    }
    true
}

fn invalid_exclude_glob() -> CommandError {
    CommandError::new(
        "INVALID_SEARCH_REQUEST",
        "The workspace search exclude pattern is invalid.",
    )
}

#[cfg(test)]
mod tests;
