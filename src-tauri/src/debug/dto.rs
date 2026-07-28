//! Forward-declared wire/interface shape for the `debug` domain's spawn
//! primitive (`F100` S0). Declared `pub mod dto` in `debug/mod.rs` —
//! deliberately not `pub(crate)` like every other submodule in this domain
//! — for the same reason `git::dto` was already `pub` before every DTO in it
//! had a real Tauri-command consumer: this sidesteps Rust's dead-code lint
//! for a type that is a genuine forward-declared interface shape, not yet
//! consumed by any caller outside this domain's own tests. `plain` compiles
//! with `crate-type = ["staticlib", "cdylib", "rlib"]`, so a `pub` item is
//! part of the library's external surface and exempt from the same
//! `#[allow(dead_code)]` bookkeeping `exec`/`framing`'s `pub(crate)` items
//! need.
//!
//! [`AdapterSpawnDescriptor`] is the minimal, real, non-trivial type
//! [`super::exec::spawn_adapter`]/[`super::exec::spawn_adapter_sync`]
//! actually consume as a function parameter today — not a decorative
//! placeholder. `F100` S1 is expected to be the first real producer of one
//! (parsed from `.plain/debug-adapters.json`'s registry entries or
//! `.vscode/launch.json`'s inline `plainAdapter` block — see
//! `commands`'s own module doc), which is why `command`/`args` already carry
//! `#[serde(...)]` attributes matching this codebase's usual wire-DTO
//! convention (camelCase, `deny_unknown_fields`) even though nothing decodes
//! one from the Tauri IPC boundary yet.

use serde::Deserialize;

/// `command` is always an absolute executable path the adapter-config format
/// hands over verbatim — never `PATH`-resolved, never combined with `args`
/// into a single string — per the frozen research doc's "决策 1" (the config
/// format's own `command` field). `args` is the adapter's own argv, passed
/// through unchanged. See [`super::exec`]'s module doc for the full spawn
/// hardening this descriptor feeds into.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct AdapterSpawnDescriptor {
    pub command: String,
    pub args: Vec<String>,
}
