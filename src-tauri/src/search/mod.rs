//! Rust-only, capability-relative file/text search domain.
//!
//! This module never opens an ambient path and never mints its own root
//! authorization: every traversal starts from a [`crate::workspace::WorkspaceRootLease`]
//! that the workspace domain already validated for the current window, and
//! [`file_search::search_roots`]/[`text_search::start`] re-derive every
//! directory handle from that lease alone. `search` only implements the
//! read-only bounded traversal, `.gitignore` layering and glob exclusion, a
//! cheap case-insensitive subsequence prefilter for file search, and a
//! streaming `grep-searcher`/`grep-regex` line matcher for text search;
//! fuzzy scoring/ranking for file search stays in the TypeScript Workbench
//! (`AnythingQuickAccessProvider` reuses its own upstream scorer against
//! whatever candidate set Rust returns).
//!
//! Scope: S2 of `docs/research/2026-07-23-search-quickopen.md` added file
//! search (`workspace_search_files`, single request/response, no streaming).
//! S3 adds streaming full-text search (`workspace_search_text_start/poll/
//! cancel`, see [`text_search`]'s module doc for the streaming protocol,
//! backpressure and cancellation design). Replace (`ITextQuery`'s
//! `IPatternInfo`'s replace string) is out of scope until S4.

pub(crate) mod commands;
pub mod dto;
pub(crate) mod file_search;
pub(crate) mod text_search;
