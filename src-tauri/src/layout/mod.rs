//! Rust-owned persistence for Plain's bounded Workbench layout state.
//!
//! This domain deliberately does not expose a generic key/value store. Only
//! the audited layout/view keys accepted by [`dto::LayoutStorageEntry`] can
//! cross IPC, and workspace-scoped state is keyed by the Rust-only stable
//! root-set identity rather than the WebView's process-local workspace id.

pub mod commands;
pub mod dto;
pub mod service;

use crate::error::CommandError;

pub(crate) fn layout_invalid() -> CommandError {
    CommandError::new(
        "LAYOUT_INVALID",
        "The Workbench layout snapshot is invalid.",
    )
}

pub(crate) fn layout_too_large() -> CommandError {
    CommandError::new(
        "LAYOUT_TOO_LARGE",
        "The Workbench layout snapshot exceeds its supported size limit.",
    )
}

pub(crate) fn layout_unavailable() -> CommandError {
    CommandError::new(
        "LAYOUT_UNAVAILABLE",
        "The Workbench layout store is unavailable.",
    )
}
