//! `F100` S0 deliberately ships this file with zero `#[tauri::command]`
//! functions — this is a scope boundary, not an oversight, so read this
//! comment before adding anything here.
//!
//! The frozen research doc (`docs/research/2026-07-28-generic-dap.md`,
//! "决策 1"/"切片拆分") assigns two prerequisites this file's real commands
//! will depend on to later slices:
//!
//! - **S1**: parsing `.plain/debug-adapters.json`/`.vscode/launch.json`'s
//!   inline `plainAdapter` block into a real
//!   [`super::dto::AdapterSpawnDescriptor`] (that parsing happens in the
//!   frontend, per the frozen doc's decision 1 — "读取这两份配置完全复用既有
//!   的 `workspace_read_file` 能力" — so no new Rust FS surface is needed for
//!   it), and the first-run confirmation gate keyed on the exact
//!   `(command, args, transport)` triple (per "主导会话裁定" item 2).
//! - **S2**: the real session lifecycle — handshake orchestration
//!   (`initialize` → `initialized` event → `setBreakpoints` series →
//!   `configurationDone` → only then is `launch`/`attach`'s own response
//!   allowed to land), request/response correlation by `request_seq`, and
//!   `plain://debug-event` event delivery to the frontend.
//!
//! Exposing a real `debug_launch`/`debug_attach`-style command in this slice,
//! ahead of either prerequisite, would let a frontend reach
//! [`super::exec::spawn_adapter`] before anything has actually gated it on
//! user confirmation — the one thing ADR 0003 explicitly requires ("首次执行
//! adapter 时要求确认"). So this file stays empty until S1 lands both
//! prerequisites; nothing here is registered in `lib.rs`'s
//! `generate_handler!` for this reason.
//!
//! Per the frozen doc's "IPC 层面的高层设计" section, the commands S1/S2
//! eventually add here are expected to be specific, strongly-typed
//! operations — `debug_launch`/`debug_attach`/`debug_set_breakpoints`/
//! `debug_stack_trace`/`debug_scopes`/`debug_variables`/`debug_evaluate`/
//! `debug_continue`/`debug_next`/`debug_step_in`/`debug_step_out`/
//! `debug_pause`/`debug_disconnect` — never a generic "send an arbitrary DAP
//! request" escape hatch, mirroring `git::commands`'s existing "no generic
//! `git_run`" discipline. The sole deliberate exception (also per the frozen
//! doc) is the `launch`/`attach` commands' own `arguments` field, which ADR
//! 0003 requires passing through transparently as an opaque JSON payload —
//! that field is DAP's own already-open protocol surface, not a new escape
//! hatch this domain invents.
