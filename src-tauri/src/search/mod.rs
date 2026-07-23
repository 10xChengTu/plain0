//! Rust-only, capability-relative file search domain.
//!
//! This module never opens an ambient path and never mints its own root
//! authorization: every traversal starts from a [`crate::workspace::WorkspaceRootLease`]
//! that the workspace domain already validated for the current window, and
//! [`file_search::search_roots`] re-derives every directory handle from that
//! lease alone. `search` only implements the read-only bounded traversal,
//! `.gitignore` layering and glob exclusion, and a cheap case-insensitive
//! subsequence prefilter on top of those handles; fuzzy scoring and ranking
//! stay in the TypeScript Workbench (`AnythingQuickAccessProvider` reuses its
//! own upstream scorer against whatever candidate set Rust returns).
//!
//! Scope for this slice (S2 of `docs/research/2026-07-23-search-quickopen.md`):
//! file search only. Text search (`ITextQuery`) is not implemented here; the
//! provider in `app/features/search/plain-search-service.ts` still resolves
//! `textSearch` to an empty result until F040 S3.

pub(crate) mod commands;
pub mod dto;
pub(crate) mod file_search;
