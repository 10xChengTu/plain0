pub(crate) mod commands;
pub(crate) mod dto;

const MAIN_WINDOW_LABEL: &str = "main";
const SECONDARY_WINDOW_LABEL_PREFIX: &str = "plain-window-";

/// Only the one static startup window may consume the process-wide recent
/// workspace pointer. Every Rust-created secondary window starts empty and
/// can opt into a workspace only through an explicit user action.
pub(crate) fn should_restore_last_workspace(window_label: &str) -> bool {
    window_label == MAIN_WINDOW_LABEL
}

#[cfg(test)]
mod tests;
