//! Rust-owned persistence for Plain's two local user-data resources.
//!
//! The WebView sees the ordinary `vscode-userdata:/User/settings.json` and
//! `vscode-userdata:/User/keybindings.json` URIs through a narrow provider,
//! but it never receives this domain's app-local-data path or an ambient file
//! API. Every other profile/user-data resource remains unsupported.

pub mod commands;
pub mod dto;
pub mod service;

use crate::error::CommandError;

pub const USER_DATA_CHANGED_EVENT: &str = "plain://user-data-changed";

pub(crate) fn user_data_conflict() -> CommandError {
    CommandError::new(
        "USER_DATA_CONFLICT",
        "The local user-data resource changed before it could be written.",
    )
}

pub(crate) fn user_data_invalid() -> CommandError {
    CommandError::new(
        "USER_DATA_INVALID",
        "The local user-data resource is not valid JSONC for its resource type.",
    )
}

pub(crate) fn user_data_too_large() -> CommandError {
    CommandError::new(
        "USER_DATA_TOO_LARGE",
        "The local user-data resource exceeds its supported size limit.",
    )
}

pub(crate) fn user_data_unavailable() -> CommandError {
    CommandError::new(
        "USER_DATA_UNAVAILABLE",
        "The local user-data store is unavailable.",
    )
}
