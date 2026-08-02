pub(crate) mod commands;
pub(crate) mod dto;
pub(crate) mod service;

use crate::error::CommandError;

pub(crate) const CLOSE_REQUEST_EVENT: &str = "plain://close-requested";

pub(crate) fn invalid_close_request() -> CommandError {
    CommandError::new(
        "INVALID_CLOSE_REQUEST",
        "The native close request is invalid or no longer active.",
    )
}

pub(crate) fn close_request_expired() -> CommandError {
    CommandError::new(
        "CLOSE_REQUEST_EXPIRED",
        "The native close request expired before it was completed.",
    )
}

pub(crate) fn close_failed() -> CommandError {
    CommandError::new(
        "CLOSE_FAILED",
        "The application window could not be closed.",
    )
}
