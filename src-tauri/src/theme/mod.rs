//! Rust-authoritative theme package domain.
//!
//! `F050` S1 scope: safely unpack a VSIX (zip) or an already-unpacked
//! directory into the theme package library, enforcing bounded entry
//! count/size/name limits and rejecting zip-slip and symlink entries. This
//! module intentionally stops at "safe bytes landed in a package
//! directory" — `contributes.themes`/JSONC/include-chain validation is
//! `F050` S2, and import UX/registration is S3. No Tauri command is
//! exposed yet: everything here is a plain library function driven by Rust
//! tests, matching the S1 slice's frozen design (see
//! `docs/research/2026-07-24-theme-compatibility.md`).
//!
//! Nothing in this domain is reachable from a Tauri command yet — that is
//! this slice's deliberate scope boundary, driven entirely by the Rust test
//! suite below. `dead_code` is allowed for the whole module accordingly;
//! remove this once S3 registers the first `theme_import_*` command and
//! wires it to `lib.rs`.
#![allow(dead_code)]

pub(crate) mod library;
pub(crate) mod unpack;

/// Maximum number of entries a single theme package (VSIX central
/// directory, or ambient directory tree) may contain. Applied structurally
/// up front for VSIX (`ZipArchive::len()`) and incrementally while walking
/// an ambient directory tree.
pub(crate) const MAX_THEME_PACKAGE_ENTRIES: usize = 2_000;

/// Maximum decompressed/copied byte length of a single package member,
/// enforced against the actual bytes read from the (de)compression stream —
/// never against a declared/attacker-controlled size field alone.
pub(crate) const MAX_THEME_ENTRY_BYTES: u64 = 8 * 1_024 * 1_024;

/// Maximum cumulative decompressed/copied bytes across every member of a
/// single package. This is the zip-bomb backstop: a high compression ratio
/// cannot buy an importer more than this many real bytes on disk.
pub(crate) const MAX_THEME_PACKAGE_BYTES: u64 = 64 * 1_024 * 1_024;

/// Maximum byte length of a single path segment (filename or directory
/// name) inside a package member's relative path.
pub(crate) const MAX_THEME_ENTRY_NAME_BYTES: usize = 255;

/// The only prefix a VSIX zip entry is extracted under; every other entry
/// (README, changelog, `.vsixmanifest`, etc.) is silently ignored rather
/// than rejected.
const EXTENSION_PREFIX: &str = "extension/";

const STAGE_PREFIX: &str = ".plain-theme-";
const MAX_STAGING_ATTEMPTS: usize = 16;

use crate::error::CommandError;

pub(crate) fn theme_unavailable() -> CommandError {
    CommandError::new(
        "THEME_UNAVAILABLE",
        "The theme package library is not available.",
    )
}

pub(crate) fn theme_package_corrupt() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_CORRUPT",
        "The theme package could not be read as a valid archive.",
    )
}

pub(crate) fn theme_package_unsafe_path() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_UNSAFE_PATH",
        "The theme package contains an unsafe or malformed path.",
    )
}

pub(crate) fn theme_package_too_large() -> CommandError {
    CommandError::new(
        "THEME_PACKAGE_TOO_LARGE",
        "The theme package exceeds the supported unpack limits.",
    )
}

pub(crate) fn theme_io_failed() -> CommandError {
    CommandError::new(
        "THEME_IO_FAILED",
        "The theme package could not be processed.",
    )
}

pub(crate) fn theme_stage_cleanup_failed() -> CommandError {
    CommandError::new(
        "THEME_STAGE_CLEANUP_FAILED",
        "The theme import staging area could not be cleaned up.",
    )
}
