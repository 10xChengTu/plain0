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

use serde::{Deserialize, Serialize};

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

impl AdapterSpawnDescriptor {
    /// Builds the exact [`AdapterConfirmationSubject`] the first-run
    /// confirmation gate (`F100` S1) checks/records for this descriptor under
    /// `transport` — the sole place this crate constructs one from a spawn
    /// descriptor, so [`super::exec::spawn_adapter`]/[`super::tcp::connect_adapter`]
    /// both call this rather than each hand-assembling the three fields
    /// themselves.
    pub(crate) fn confirmation_subject(
        &self,
        transport: AdapterTransportKind,
    ) -> AdapterConfirmationSubject {
        AdapterConfirmationSubject {
            command: self.command.clone(),
            args: self.args.clone(),
            transport,
        }
    }
}

/// A TCP `host:port` to connect to for a `"tcp"`-transport adapter (`F100`
/// S1) — see `docs/research/2026-07-28-generic-dap.md`'s "主导会话裁定" item 3:
/// v1 only ever *connects out* to this address (`TcpStream::connect`), never
/// listens for an incoming connection. Deliberately **not** part of
/// [`AdapterConfirmationSubject`]'s three-field identity — the frozen
/// decision's dedup key is exactly `(command, args, transport)`, not
/// `host`/`port`: many real adapters bind an ephemeral port per run (`--port
/// 0`), and folding a value that legitimately changes every launch into the
/// confirmation key would force a fresh confirmation dialog on every single
/// debug session, defeating the point of "first-run" confirmation.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct TcpConnectDescriptor {
    pub host: String,
    pub port: u16,
}

/// Which byte-transport an adapter descriptor uses — `"stdio"` (the process's
/// own stdin/stdout pipes, [`super::exec::spawn_adapter`]) or `"tcp"` (a
/// [`TcpConnectDescriptor`], [`super::tcp::connect_adapter`]). Serializes as
/// the bare lowercase word on the wire (`"stdio"`/`"tcp"`), matching the
/// adapter-config format's own `transport` field
/// (`docs/research/2026-07-28-generic-dap.md`'s "决策 1").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AdapterTransportKind {
    Stdio,
    Tcp,
}

/// The exact, precise identity the first-run confirmation gate is keyed on —
/// "主导会话裁定" item 2's `(command 绝对路径, args 数组, transport)` triple,
/// verbatim. Two subjects that differ in *any single field* are two distinct,
/// independently-confirmable identities — this is the whole safety property
/// [`super::confirm::ConfirmationService`] exists to provide (a silently
/// edited `command` must never inherit an earlier confirmation).
///
/// Deliberately excludes `host`/`port` — see [`TcpConnectDescriptor`]'s own
/// doc comment for why. This is also the wire shape the three
/// `debug_adapter_confirmation_*` Tauri commands accept as their request body
/// (camelCase, unknown fields rejected — the frontend confirmation resolver
/// in `app/features/debug/plain-debug-adapter-confirmation.ts` sends exactly
/// this shape).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct AdapterConfirmationSubject {
    pub command: String,
    pub args: Vec<String>,
    pub transport: AdapterTransportKind,
}
