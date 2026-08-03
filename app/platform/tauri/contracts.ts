export const RUNTIME_READY_EVENT = "plain://runtime-ready" as const;
export const WORKSPACE_WATCH_WAKE_EVENT =
	"plain://workspace-watch-wake" as const;
export const WORKSPACE_SEARCH_TEXT_WAKE_EVENT =
	"plain://workspace-search-text-wake" as const;
/** F070 "IPC 改造": streamed render-state frames — see `TerminalDataEvent`'s
 * doc comment. */
export const TERMINAL_DATA_EVENT = "plain://terminal-data" as const;
/** One-shot session exit notification — see `TerminalExitEvent`. */
export const TERMINAL_EXIT_EVENT = "plain://terminal-exit" as const;
/** `F100` S2/S3: every live debug session's streamed DAP events (and Plain's
 * own `plain/`-prefixed synthetic notifications) in this window — see
 * `DebugEventPayload`'s own doc comment. Mirrors
 * `src-tauri/src/debug/commands.rs`'s `DEBUG_EVENT` constant. */
export const DEBUG_EVENT = "plain://debug-event" as const;
export const NATIVE_CLOSE_REQUEST_EVENT = "plain://close-requested" as const;
export const USER_DATA_CHANGED_EVENT = "plain://user-data-changed" as const;

export interface NativeCloseRequest {
	readonly requestId: string;
	readonly reason: "close" | "quit";
	readonly timeoutMs: 5_000;
}

export interface RuntimeInfo {
	application: "Plain";
	ipcVersion: 1;
	runtime: "tauri" | "browser-mock";
}

export type UserDataResource = "settings" | "keybindings";

export interface UserDataResult {
	readonly resource: UserDataResource;
	readonly revision: number;
	readonly content: string;
}

export interface UserDataChangedEvent {
	readonly resource: UserDataResource;
	readonly revision: number;
}

export interface CommandError {
	readonly code: string;
	readonly message: string;
	readonly details?: unknown;
}

export interface WorkspaceCapabilities {
	readonly create: boolean;
	readonly renameNoReplace: boolean;
	readonly copyMove: boolean;
	readonly delete: boolean;
	readonly versionedWrite: boolean;
}

export interface WorkspaceRoot {
	readonly rootId: string;
	readonly displayName: string;
	readonly uri: string;
}

export interface WorkspaceSnapshot {
	readonly workspaceId: string;
	readonly revision: number;
	readonly roots: readonly WorkspaceRoot[];
}

export interface WorkspaceWatchWakeEvent {
	readonly workspaceId: string;
}

export interface WorkspaceWatchSyncRootRequest {
	readonly rootId: string;
	readonly acknowledgedGeneration: number | null;
}

export interface WorkspaceWatchSyncRequest {
	readonly roots: readonly WorkspaceWatchSyncRootRequest[];
}

export interface WorkspaceWatchPendingRoot {
	readonly rootId: string;
	readonly generation: number;
	readonly rescanRequired: boolean;
}

export interface WorkspaceWatchSyncResult {
	readonly workspaceId: string;
	readonly roots: readonly WorkspaceWatchPendingRoot[];
}

export interface WorkspacePickResult {
	readonly status: "selected" | "cancelled";
	readonly snapshot: WorkspaceSnapshot;
}

export interface WorkspaceOpenFileTarget {
	readonly rootId: string;
	readonly relativePath: string;
}

export interface WorkspaceOpenFilesResult {
	readonly status: "selected" | "cancelled";
	readonly snapshot: WorkspaceSnapshot;
	readonly files: readonly WorkspaceOpenFileTarget[];
}

export interface WorkspaceSaveTarget {
	readonly rootId: string;
	readonly relativePath: string;
	/**
	 * A version-bearing receipt from the same native selection transaction when
	 * the target already exists; `null` means the picker observed no target and
	 * the caller may use the no-replace publication command.
	 */
	readonly existingStat: WorkspaceEntryStat | null;
}

export interface WorkspacePickSaveTargetResult {
	readonly status: "selected" | "cancelled";
	readonly snapshot: WorkspaceSnapshot;
	readonly target: WorkspaceSaveTarget | null;
}

export type WorkspaceRestoreStatus = "pending" | "none" | "restored" | "failed";

export interface WorkspaceRecentEntry {
	readonly recentId: string;
	readonly label: string;
	readonly rootLabels: readonly string[];
}

export interface WorkspaceRecentListResult {
	readonly revision: number;
	readonly restoreStatus: WorkspaceRestoreStatus;
	readonly entries: readonly WorkspaceRecentEntry[];
}

export type WorkspacePickMode = "replace" | "add";

export type WorkspaceEntryKind =
	| "file"
	| "directory"
	| "symlink"
	| "symlinkFile"
	| "symlinkDirectory"
	| "other";

export interface WorkspaceEntryStat {
	readonly kind: WorkspaceEntryKind;
	readonly size: number;
	readonly mtime: number;
	readonly ctime: number;
	readonly version: string | null;
}

export interface WorkspaceDirectoryEntry {
	readonly name: string;
	readonly kind: WorkspaceEntryKind;
}

export interface WorkspaceReadDirectoryResult {
	readonly entries: readonly WorkspaceDirectoryEntry[];
}

export interface WorkspaceCopyRequest {
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly targetRootId: string;
	readonly targetPath: string;
}

export interface WorkspaceMoveRequest {
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly targetRootId: string;
	readonly targetPath: string;
}

export type WorkspaceMoveIncompleteReason =
	| "sourceChanged"
	| "targetChanged"
	| "sourceUnverifiable"
	| "targetUnverifiable"
	| "deleteFailed";

export type WorkspaceMoveResult =
	| Readonly<{ status: "moved" }>
	| Readonly<{
			status: "targetPublishedSourceRetained";
			reason: WorkspaceMoveIncompleteReason;
	  }>
	| Readonly<{
			status: "targetPublishedSourcePartiallyDeleted";
			reason: WorkspaceMoveIncompleteReason;
			removedEntries: number;
	  }>;

export interface WorkspaceDeleteEntryRequest {
	readonly rootId: string;
	readonly relativePath: string;
	readonly recursive: boolean;
}

export interface WorkspacePrepareDeleteRequest {
	readonly entries: readonly WorkspaceDeleteEntryRequest[];
}

export type WorkspaceDeleteEntryKind = "file" | "directory" | "symlink";

export interface WorkspaceDeleteBatchPlanEntry {
	readonly entryId: string;
	readonly kind: WorkspaceDeleteEntryKind;
	readonly descendantEntries: number;
}

export interface WorkspaceDeleteBatchPlan {
	readonly confirmationId: string;
	readonly entries: readonly WorkspaceDeleteBatchPlanEntry[];
}

export interface WorkspaceDeleteBatchRequest {
	readonly confirmationId: string;
}

export interface WorkspaceCommitDeleteEntryRequest extends WorkspaceDeleteEntryRequest {
	readonly confirmationId: string;
	readonly entryId: string;
}

export type WorkspaceDeleteIncompleteReason =
	"entryChanged" | "entryUnverifiable" | "deleteFailed";

export type WorkspaceDeleteResult =
	| Readonly<{ status: "deleted" }>
	| Readonly<{
			status: "entryRetained";
			reason: WorkspaceDeleteIncompleteReason;
	  }>
	| Readonly<{
			status: "entryPartiallyDeleted";
			reason: WorkspaceDeleteIncompleteReason;
			removedEntries: number;
	  }>;

/**
 * Immutable file payload. The backing bytes are closure-private; each call to
 * copy returns a new Uint8Array that the caller may mutate independently.
 */
export interface WorkspaceFileData {
	readonly byteLength: number;
	readonly copy: () => Uint8Array;
}

/**
 * One stable native read receipt. The stat and bytes originate from the same
 * opened file handle and must never be split into independent IPC requests.
 */
export interface WorkspaceReadFileResult {
	readonly stat: WorkspaceEntryStat;
	readonly value: WorkspaceFileData;
}

export type WorkspaceWritePublicationEvidence =
	"renameReportedSuccess" | "targetObservedWritten";

export type WorkspaceWriteResult =
	| Readonly<{
			status: "written";
			stat: WorkspaceEntryStat;
	  }>
	| Readonly<{
			status: "targetPublished";
			publicationEvidence: "targetObservedWritten";
			rename: "reportedSuccess";
			directorySync: "failed";
			target: "matchesWritten";
	  }>
	| Readonly<{
			status: "targetPublished";
			publicationEvidence: "renameReportedSuccess";
			rename: "reportedSuccess";
			directorySync: "synced" | "failed";
			target: "changed" | "unverifiable";
	  }>
	| Readonly<{
			status: "targetPublished";
			publicationEvidence: "targetObservedWritten";
			rename: "reportedFailure";
			directorySync: "synced" | "failed";
			target: "matchesWritten" | "changed" | "unverifiable";
	  }>
	| Readonly<{
			status: "outcomeUnknown";
			observation: "native";
			rename: "reportedFailure";
			directorySync: "notAttempted";
			target: "ambiguous";
	  }>
	| Readonly<{
			status: "outcomeUnknown";
			observation: "responseUnavailable";
			rename: "unobserved";
			directorySync: "unobserved";
			target: "ambiguous";
	  }>;

/** One file-search result, bound to the exact authorized root that produced it. */
export interface WorkspaceSearchFileEntry {
	readonly rootId: string;
	readonly path: string;
}

/**
 * Result of a bounded, `.gitignore`-respecting file-name search rooted at
 * one or more workspace roots. Duplicate relative paths remain distinct
 * because every entry carries its producing root identity.
 */
export interface WorkspaceSearchFilesResult {
	readonly entries: readonly WorkspaceSearchFileEntry[];
	readonly limitHit: boolean;
}

/**
 * Request shape for `workspace_search_text_start` (F040 S3 streaming text
 * search). `maxFileSize` is optional; omitting it (or passing `null`) uses
 * Rust's own 8 MiB default.
 */
export interface WorkspaceSearchTextStartRequest {
	readonly roots: readonly string[];
	readonly pattern: string;
	readonly isRegExp: boolean;
	readonly isCaseSensitive: boolean;
	readonly isWordMatch: boolean;
	readonly excludeGlobs: readonly string[];
	readonly maxResults: number;
	readonly maxFileSize: number | null;
}

export interface WorkspaceSearchTextStartResult {
	readonly searchId: string;
}

/**
 * `column` is preview-relative (valid only for indexing into this same
 * match's `previewText`); `absoluteColumn` is the same match's UTF-16
 * column (1-indexed) within the actual, full source line, independent of
 * any preview-window truncation/rebasing — see
 * `src-tauri/src/search/dto.rs`'s `WorkspaceSearchTextMatch` doc comment.
 * Building a precise edit range (F040 S4 replace) or a real editor jump
 * target must use `absoluteColumn`, never `column`.
 */
export interface WorkspaceSearchTextMatch {
	readonly line: number;
	readonly column: number;
	readonly length: number;
	readonly previewText: string;
	readonly absoluteColumn: number;
}

export interface WorkspaceSearchTextBatch {
	readonly rootId: string;
	readonly path: string;
	readonly matches: readonly WorkspaceSearchTextMatch[];
}

export interface WorkspaceSearchTextSkipped {
	readonly binary: number;
	readonly oversize: number;
}

export interface WorkspaceSearchTextPollResult {
	readonly batches: readonly WorkspaceSearchTextBatch[];
	readonly nextCursor: number;
	readonly done: boolean;
	readonly limitHit: boolean;
	readonly skipped: WorkspaceSearchTextSkipped;
}

export interface WorkspaceSearchTextWakeEvent {
	readonly searchId: string;
}

// --- Terminal (F070 "IPC 改造": render-state frames + structured input) -----

export interface TerminalStartResult {
	readonly sessionId: string;
}

/** Wire projection of `libghostty_vt::style::RgbColor`. */
export interface TerminalRgb {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

/** Wire projection of `libghostty_vt::style::Underline`. */
export type TerminalUnderline =
	"none" | "single" | "double" | "curly" | "dotted" | "dashed";

/**
 * Wire projection of `libghostty_vt::style::Style`'s boolean attribute flags
 * plus `underline`. Deliberately omits `fg_color`/`bg_color`/
 * `underline_color` — see `TerminalCell.fg`/`bg` (already-resolved RGB) and
 * `src-tauri/src/terminal/dto.rs`'s `TerminalStyle` doc comment.
 */
export interface TerminalStyle {
	readonly bold: boolean;
	readonly italic: boolean;
	readonly faint: boolean;
	readonly blink: boolean;
	readonly inverse: boolean;
	readonly invisible: boolean;
	readonly strikethrough: boolean;
	readonly overline: boolean;
	readonly underline: TerminalUnderline;
}

/**
 * Wire projection of one `terminal::vt::DirtyCell`. `graphemes` is the
 * cell's base codepoint plus any combining marks, already joined into a
 * single string by Rust. `fg`/`bg` are already-resolved RGB (`null` means
 * "use the frame's `colors.foreground`/`background` default", not "no
 * color") — never a palette index a decoder here would need to resolve.
 */
export interface TerminalCell {
	readonly graphemes: string;
	readonly fg: TerminalRgb | null;
	readonly bg: TerminalRgb | null;
	readonly style: TerminalStyle;
}

/** Wire projection of one `terminal::vt::DirtyRow`. */
export interface TerminalRow {
	readonly rowIndex: number;
	readonly cells: readonly TerminalCell[];
}

/** Wire projection of `libghostty_vt::render::CursorViewport`. */
export interface TerminalCursorViewport {
	readonly x: number;
	readonly y: number;
	readonly atWideTail: boolean;
}

/** Wire projection of `libghostty_vt::render::CursorVisualStyle`. */
export type TerminalCursorStyle = "bar" | "block" | "underline" | "blockHollow";

/** Wire projection of a `terminal::vt::DirtyFrame`'s cursor fields. */
export interface TerminalCursor {
	readonly visible: boolean;
	readonly blinking: boolean;
	readonly viewport: TerminalCursorViewport | null;
	readonly style: TerminalCursorStyle;
}

/**
 * Wire projection of `libghostty_vt::render::Colors`. Deliberately omits the
 * full 256-entry palette — every cell's `fg`/`bg` is already fully resolved
 * (see `TerminalCell`'s doc comment), so a renderer only ever needs these
 * three as the frame-level defaults for cells with no explicit color.
 */
export interface TerminalColors {
	readonly background: TerminalRgb;
	readonly foreground: TerminalRgb;
	readonly cursor: TerminalRgb | null;
}

/** Wire projection of `libghostty_vt::render::Dirty`. */
export type TerminalDirty = "clean" | "partial" | "full";

/**
 * Wire projection of a `terminal::vt::DirtyFrame` — `plain://terminal-data`'s
 * payload (F070 "IPC 改造", replacing S2's raw-byte placeholder). `rowsData`
 * lists only the rows that actually changed since the last frame this
 * session emitted (or, when `dirty` is `"full"`, every row) — a renderer
 * must apply these incrementally onto its own retained grid, not treat a
 * frame as a complete screen snapshot by itself. See
 * `src-tauri/src/terminal/dto.rs`'s `TerminalFrame` doc comment for why this
 * is structured JSON rather than a packed binary frame.
 */
export interface TerminalFrame {
	readonly dirty: TerminalDirty;
	readonly cols: number;
	readonly rows: number;
	readonly cursor: TerminalCursor;
	readonly colors: TerminalColors;
	readonly rowsData: readonly TerminalRow[];
}

/**
 * Decoded `plain://terminal-data` event payload: one emitted [`TerminalFrame`],
 * in the exact order and with the exact `sequence`
 * `src-tauri/src/terminal/service.rs`'s vt thread assigned it — monotonic
 * per session, incremented once per *emitted* frame (content coalesced
 * while emission credit was exhausted does not get its own sequence
 * number — see that module's "VT → frontend frame delivery backpressure"
 * doc section).
 */
export interface TerminalDataEvent {
	readonly sessionId: string;
	readonly sequence: number;
	readonly frame: TerminalFrame;
}

/**
 * Decoded `plain://terminal-exit` event payload. Arriving `sessionId` may
 * name a session that has already been (or is concurrently being) killed
 * from this side — that races against the process actually exiting on its
 * own — so a listener that already forgot about `sessionId` should simply
 * ignore the event, not treat it as a contract violation. See
 * `terminal-stream.ts`'s doc comment for why this event is *not* proof that
 * no further `TerminalDataEvent` for the same session will arrive.
 */
export interface TerminalExitEvent {
	readonly sessionId: string;
	readonly exitCode: number;
}

/** Wire projection of one `terminal::vt::ScrollbackCell` — lighter than
 * `TerminalCell`: no resolved `fg`/`bg` (see
 * `src-tauri/src/terminal/vt.rs`'s `VtSession::scrollback_rows` doc). */
export interface TerminalScrollbackCell {
	readonly graphemes: string;
	readonly style: TerminalStyle;
}

/** Wire projection of one `terminal::vt::ScrollbackRow`. */
export interface TerminalScrollbackRow {
	readonly rowIndex: number;
	readonly cells: readonly TerminalScrollbackCell[];
}

/** `terminal_scrollback` response. */
export interface TerminalScrollbackResult {
	readonly rows: readonly TerminalScrollbackRow[];
}

/** Response shape shared by `workspace_trust_state`/`workspace_trust_grant`
 * — see `src-tauri/src/trust/commands.rs`'s `WorkspaceTrustState` doc
 * comment for why grant always reports `trusted: true` on success. */
export interface WorkspaceTrustState {
	readonly trusted: boolean;
}

/** `F100` S1's first-run confirmation gate identity — the exact
 * `(command, args, transport)` triple `src-tauri/src/debug/dto.rs`'s
 * `AdapterConfirmationSubject` locks (deliberately excludes `host`/`port` —
 * see that type's own doc comment for why). */
export interface DebugAdapterConfirmationSubject {
	readonly command: string;
	readonly args: readonly string[];
	readonly transport: "stdio" | "tcp";
}

/** Response shape for `debug_adapter_confirmation_state` — mirrors
 * `WorkspaceTrustState`'s identical "read a persisted yes/no fact" shape. */
export interface DebugAdapterConfirmationState {
	readonly confirmed: boolean;
}

// ---------------------------------------------------------------------
// `F100` S3 — the real session-lifecycle and interactive-debugging wire
// shapes (`debug_launch`/`debug_attach`/`debug_disconnect`/
// `debug_set_breakpoints`/`debug_stack_trace`/`debug_scopes`/
// `debug_variables`/`debug_evaluate`). Mirrors `src-tauri/src/debug/dto.rs`'s
// own S2/S3 wire shapes.
// ---------------------------------------------------------------------

/** How a `debug_launch`/`debug_attach` call reaches an adapter — a
 * discriminated union rather than an optional `host`/`port` pair, so an
 * invalid combination (a `"tcp"` request missing `port`, a `"stdio"` request
 * carrying one) is unrepresentable at the type level, not merely rejected at
 * runtime — `src-tauri/src/debug/dto.rs`'s `SessionTransportRequest` enum has
 * the identical shape once past its own `into_parts` validation. */
export type DebugAdapterTarget =
	| Readonly<{
			readonly transport: "stdio";
			readonly command: string;
			readonly args: readonly string[];
	  }>
	| Readonly<{
			readonly transport: "tcp";
			readonly command: string;
			readonly args: readonly string[];
			readonly host: string;
			readonly port: number;
	  }>;

/** `debug_launch`/`debug_attach`'s response — the new session's id plus its
 * negotiated `Capabilities`, exposed as a raw object rather than a fixed,
 * enumerated shape (mirrors
 * `src-tauri/src/debug/protocol.rs`'s `Capabilities::as_value` doc comment:
 * two real captured adapters report almost entirely disjoint `supportsXxx`
 * sets). Callers query a specific capability with plain property access
 * (`capabilities.supportsConditionalBreakpoints === true`) — absence and an
 * explicit `false` are both "not supported", matching the Rust side's own
 * `Capabilities::supports` contract. */
export interface DebugSessionStartResult {
	readonly sessionId: string;
	readonly capabilities: Readonly<Record<string, unknown>>;
}

/** One line breakpoint sent to `debugSetBreakpoints` — `condition`/
 * `logMessage` are sent regardless of whether the adapter actually
 * advertised `supportsConditionalBreakpoints`/`supportsLogPoints` (the Rust
 * side does not gate this — see `SourceBreakpointsRequest`'s own doc
 * comment); the frontend's own breakpoint-editing UI is what must consult
 * `DebugSessionStartResult.capabilities` before ever *offering* the
 * condition/log-message input, per this feature's own acceptance criteria. */
export interface DebugBreakpointRequest {
	readonly line: number;
	readonly condition: string | null;
	readonly logMessage: string | null;
}

/** One DAP `Breakpoint` reply entry — `verified`/`line` may legitimately
 * differ from what was requested: a real adapter may reject a line
 * (`verified: false`, often with `message`) or silently relocate a verified
 * one to the nearest executable line. Callers must always render this
 * reported `line`, never the one they asked for. */
export interface DebugBreakpointResult {
	readonly verified: boolean;
	readonly line: number | null;
	readonly id: number | null;
	readonly message: string | null;
}

export interface DebugSetBreakpointsResult {
	readonly breakpoints: readonly DebugBreakpointResult[];
}

/** One DAP `StackFrame` — `sourcePath`/`sourceName` are both `null` for a
 * frame with no resolvable source (e.g. deep in a native/library call). */
export interface DebugStackFrame {
	readonly id: number;
	readonly name: string;
	readonly line: number;
	readonly column: number;
	readonly sourcePath: string | null;
	readonly sourceName: string | null;
}

/** `debug_stack_trace`'s response — `totalFrames` (when the adapter reports
 * it) is the *full* call stack's depth, letting a caller build a "there are N
 * more frames" affordance even when this particular page only returned a
 * handful. */
export interface DebugStackTraceResult {
	readonly stackFrames: readonly DebugStackFrame[];
	readonly totalFrames: number | null;
}

/** One DAP `Scope` — `variablesReference` is the handle a follow-up
 * `debugVariables` call expands. */
export interface DebugScope {
	readonly name: string;
	readonly variablesReference: number;
	readonly namedVariables: number | null;
	readonly indexedVariables: number | null;
	readonly expensive: boolean;
}

/** `debug_scopes`'s response — an empty `scopes` array (a frame with no
 * local state at all) is a normal, successful result, not an error. */
export interface DebugScopesResult {
	readonly scopes: readonly DebugScope[];
}

/** DAP's own `VariablesArguments.filter` enum — which slice of a
 * `variablesReference`'s children to fetch (`null`/omitted means "both"). */
export type DebugVariablesFilter = "indexed" | "named";

/** One DAP `Variable` — `variablesReference` is `0` for a leaf value (the
 * tree-expansion sentinel: no further children), non-zero for a
 * further-expandable value a follow-up `debugVariables` call should target. */
export interface DebugVariable {
	readonly name: string;
	readonly value: string;
	readonly type: string | null;
	readonly variablesReference: number;
	readonly namedVariables: number | null;
	readonly indexedVariables: number | null;
}

export interface DebugVariablesResult {
	readonly variables: readonly DebugVariable[];
}

/** DAP's own `EvaluateArguments.context` enum, narrowed to the five
 * documented values — `F100` S3 only ever sends `"watch"` (the Watch view's
 * sole data source); `"repl"` is modeled now because it is part of the same
 * closed spec enum, for `F100` S4's Debug Console to use later. */
export type DebugEvaluateContext =
	"watch" | "repl" | "hover" | "clipboard" | "variables";

export interface DebugEvaluateResult {
	readonly result: string;
	readonly type: string | null;
	readonly variablesReference: number;
	readonly namedVariables: number | null;
	readonly indexedVariables: number | null;
}

/** `F100` S4's `debugContinue` response — `allThreadsContinued` defaults to
 * `true` when the adapter's own response omits it (per spec: "If this
 * attribute is missing a value of `true` is assumed for backward
 * compatibility"), matching `src-tauri/src/debug/dto.rs`'s
 * `parse_continue_response` exactly. */
export interface DebugContinueResult {
	readonly allThreadsContinued: boolean;
}

/** `plain://debug-event`'s decoded payload — covers both real DAP events
 * (`event` is the bare DAP event name, e.g. `"stopped"`) and Plain's own
 * `plain/`-prefixed synthetic notifications (`"plain/sessionEnded"`,
 * `"plain/reverseRequest/…"`, `"plain/protocolError"`) under the same single
 * channel — see `src-tauri/src/debug/session.rs`'s module doc for why.
 *
 * `F100` S5 additions, both still carried inside `body` (this envelope
 * itself is unchanged) — see `src-tauri/src/debug/output_gate.rs`'s own
 * module doc for the full backpressure design:
 * - Every real `event === "output"` delivery's `body` now also carries a
 *   `sequence: number` field (monotonic per session, assigned only to
 *   events this gate actually emits — content merged while gated never gets
 *   its own sequence number) that a consumer must pass to
 *   `PlainBridge.debugOutputAck` once it has finished handling the event.
 * - `event === "plain/outputElided"` is a new synthetic notification (never
 *   gated/acked itself), `body: { category: string, elidedBytes: number,
 *   elidedLines: number }` — emitted immediately before a merged `output`
 *   flush whose content actually had to be truncated, so a consumer can
 *   honestly tell the user some output was dropped rather than silently
 *   showing a gap. */
export interface DebugEventPayload {
	readonly sessionId: string;
	readonly event: string;
	readonly body: unknown;
}

/**
 * One recovered backup entry. `bytes` is a freshly allocated snapshot: it
 * shares no backing storage with the bridge/mock and the caller may freely
 * mutate it.
 */
export interface BackupEntry {
	/** Current-session id of the exact authorized root that owns this entry. */
	readonly rootId: string;
	readonly key: string;
	readonly bytes: Uint8Array;
}

export interface ScratchCreateResult {
	readonly scratchId: string;
}

/** One Rust-owned Untitled recovery entry. */
export interface ScratchEntry {
	readonly scratchId: string;
	readonly bytes: Uint8Array;
}

/** The four upstream `ThemeTypeSelector` values a `contributes.themes[]`
 * entry's `uiTheme` may name — see `src-tauri/src/theme/manifest.rs`'s
 * `UiTheme` enum, whose `serde` renames these exact wire strings. */
export type ThemeUiTheme = "vs" | "vs-dark" | "hc-black" | "hc-light";

export interface ThemeContribution {
	readonly label: string | null;
	readonly uiTheme: ThemeUiTheme;
	/** Package-relative wire path, e.g. `"themes/dark.json"`. */
	readonly path: string;
}

/**
 * One `contributes.iconThemes[]`/`contributes.productIconThemes[]` entry —
 * the `F060` S3 wire projection of `src-tauri/src/theme/dto.rs`'s
 * `IconThemeContributionSummary`. Unlike `ThemeContribution`, `id` is
 * always present and is always this axis's `settingsId` verbatim (no
 * `label` fallback — see `plain-theme-registry.ts`'s own doc comment on
 * `PlainFileIconThemeRegistryEntry`/`PlainProductIconThemeRegistryEntry`
 * for why upstream's `ThemeRegistry` for these two axes is `idRequired`).
 */
export interface ThemeIconContribution {
	readonly id: string;
	readonly label: string | null;
	/** Package-relative wire path, e.g. `"fileicons/icons.json"`. */
	readonly path: string;
}

/**
 * One imported theme package's validated summary. `resources` is the exact
 * whitelist `theme_read_resource` checks a `relativePath` against for this
 * package (main document, `include` chain, `tokenColors` `.tmTheme`
 * target, icon `iconPath`/font `src`) — every file the frontend needs to
 * fetch and `registerFileUrl` to make the package's themes actually
 * loadable. `iconThemes`/`productIconThemes` (`F060` S3) are always
 * present, empty arrays when the package contributes none of that axis —
 * never omitted.
 */
export interface ThemePackageSummary {
	readonly id: string;
	readonly publisher: string;
	readonly name: string;
	readonly version: string;
	readonly themes: readonly ThemeContribution[];
	readonly iconThemes: readonly ThemeIconContribution[];
	readonly productIconThemes: readonly ThemeIconContribution[];
	readonly resources: readonly string[];
	readonly containsCode: boolean;
}

export type ThemeImportResult =
	| Readonly<{ status: "imported"; package: ThemePackageSummary }>
	| Readonly<{ status: "cancelled" }>;

export interface ThemeListResult {
	readonly packages: readonly ThemePackageSummary[];
	readonly skipped: number;
}

/** `theme_get_selection`'s result: the persisted `settingsId` for each of
 * Plain's three theme axes — color (`ColorThemeData`), file icon
 * (`FileIconThemeData`) and product icon (`ProductIconThemeData`), `F060`
 * S3 extending this from the single `themeId` field `F050` S4 introduced —
 * or `null` per axis if nothing is stored for it (never set, explicitly
 * cleared, or the stored value was corrupt/invalid — Rust collapses all
 * three reasons to `null`, independently per axis, see
 * `src-tauri/src/theme/selection.rs`). */
export interface ThemeSelectionResult {
	readonly themeId: string | null;
	readonly fileIconThemeId: string | null;
	readonly productIconThemeId: string | null;
}

// --- Git (F080 S1: status/diff parsing + DTO + IPC) -------------------------

/** Wire projection of `git::status::SubmoduleState`'s four independent
 * `<sub>` field axes — see `src-tauri/src/git/status.rs`'s own doc comment. */
export interface GitSubmoduleState {
	readonly isSubmodule: boolean;
	readonly commitChanged: boolean;
	readonly trackedChanged: boolean;
	readonly untrackedChanged: boolean;
}

export interface GitBranchUpstream {
	readonly name: string;
	readonly ahead: number;
	readonly behind: number;
}

/**
 * `oid`/`head` are git's own literal tokens (`"(initial)"`/`"(detached)"`)
 * verbatim when there is no commit yet / HEAD is detached, rather than a
 * separate boolean flag — see `src-tauri/src/git/dto.rs`'s `GitBranchWire`
 * doc comment for why this flat encoding is unambiguous (neither token can
 * collide with a real oid or branch name).
 */
export interface GitBranch {
	readonly oid: string;
	readonly head: string;
	readonly upstream: GitBranchUpstream | null;
}

export type GitRenameOrCopyKind = "rename" | "copy";

/**
 * Wire projection of `git::status::StatusEntry` — a discriminated union
 * tagged by `type`, matching `git::dto::GitStatusEntryWire`'s exact
 * `#[serde(tag = "type")]` shape. `indexStatus`/`worktreeStatus` are the raw
 * single-character porcelain-v2 `XY` codes (e.g. `"M"`, `"."`, `"D"`, `"U"`),
 * not decoded further — see `docs/research/2026-07-25-core-git.md`'s S1
 * section for the full format.
 */
export type GitStatusEntry =
	| Readonly<{
			type: "ordinary";
			indexStatus: string;
			worktreeStatus: string;
			submodule: GitSubmoduleState;
			modeHead: string;
			modeIndex: string;
			modeWorktree: string;
			hashHead: string;
			hashIndex: string;
			path: string;
	  }>
	| Readonly<{
			type: "renameOrCopy";
			indexStatus: string;
			worktreeStatus: string;
			submodule: GitSubmoduleState;
			modeHead: string;
			modeIndex: string;
			modeWorktree: string;
			hashHead: string;
			hashIndex: string;
			renameOrCopyKind: GitRenameOrCopyKind;
			similarity: number;
			path: string;
			origPath: string;
	  }>
	| Readonly<{
			type: "unmerged";
			indexStatus: string;
			worktreeStatus: string;
			submodule: GitSubmoduleState;
			modeStage1: string;
			modeStage2: string;
			modeStage3: string;
			modeWorktree: string;
			hashStage1: string;
			hashStage2: string;
			hashStage3: string;
			path: string;
	  }>
	| Readonly<{ type: "untracked"; path: string }>
	| Readonly<{ type: "ignored"; path: string }>;

export interface GitStatusResult {
	readonly branch: GitBranch;
	readonly entries: readonly GitStatusEntry[];
}

export type GitDiffStatusKind =
	| "added"
	| "copied"
	| "deleted"
	| "modified"
	| "renamed"
	| "typeChanged"
	| "unmerged"
	| "unknown";

/**
 * Wire projection of one `git::diff::DiffFileEntry`, joined from a separate
 * `--name-status`/`--numstat` invocation pair server-side (see
 * `src-tauri/src/git/diff.rs`'s `merge_diff_files` doc comment) —
 * `added`/`deleted` are `null` exactly when `binary` is `true`.
 */
export interface GitDiffFileEntry {
	readonly kind: GitDiffStatusKind;
	readonly similarity: number | null;
	readonly path: string;
	readonly origPath: string | null;
	readonly added: number | null;
	readonly deleted: number | null;
	readonly binary: boolean;
}

export interface GitDiffFilesResult {
	readonly entries: readonly GitDiffFileEntry[];
}

/** The closed set of revisions `git_show_blob` accepts — never an arbitrary
 * revision string (that would turn the command into a general-purpose
 * `git_run`, exactly what ADR 0003 forbids). */
export type GitBlobRev = "head" | "index";

/**
 * `content` is `null` exactly when git reported (via one of three
 * distinguishable stderr messages) that no such version of the path exists
 * — an expected, common outcome (e.g. a new untracked file has no `HEAD`
 * version), not an error. See `src-tauri/src/git/diff.rs`'s `show_blob` doc
 * comment.
 */
export interface GitShowBlobResult {
	readonly content: Uint8Array | null;
}

// --- Git network (F080 S4: fetch/pull/push preview + confirm) ---------------

/** Which network operation a [`GitNetworkPreviewResult`] is being computed
 * for — only `"fetch"` tolerates a missing upstream (a bare `git fetch`
 * genuinely still works without one); `"pull"`/`"push"` reject instead. See
 * `src-tauri/src/git/network.rs`'s own module doc comment. */
export type GitNetworkOperation = "fetch" | "pull" | "push";

/**
 * The ahead/behind preview a confirmation dialog must show before ever
 * calling `gitFetch`/`gitPull`/`gitPush` — acceptance criterion 5's "预览影响"
 * half for this domain's network operations, mirroring `gitDiscardPaths`'s
 * own confirm-before-call discipline (`app/features/scm/plain-scm-network.ts`).
 * `upstream`/`ahead`/`behind` are all `null` together only for a `"fetch"`
 * preview against a branch with no upstream configured — there is nothing
 * local to compare against. Reflects the *last known* remote-tracking state
 * (as of the last fetch), not necessarily the shared remote's true current
 * state — see `src-tauri/src/git/network.rs`'s `preview` doc comment.
 */
export interface GitNetworkPreviewResult {
	readonly upstream: string | null;
	readonly ahead: number | null;
	readonly behind: number | null;
}

// --- Git blame (F090 S0: blame core + age heatmap) --------------------------

/** A 1-based, inclusive `-L<start>,<end>` viewport range for [`gitBlameFile`]
 * — omit entirely for whole-file blame. See
 * `src-tauri/src/git/blame.rs`'s `BlameLineRange` doc comment. */
export interface GitBlameLineRange {
	readonly start: number;
	readonly end: number;
}

/** Wire projection of `git::blame::BlameCommitHeader` — the fields
 * `--line-porcelain` repeats for every line of a given commit, deduplicated
 * server-side into [`GitBlameFileResult.commits`] keyed by sha.
 * `summary` is the message's first line only; a hover wanting the full body
 * must call `gitBlameCommitMessages` with this commit's sha. */
export interface GitBlameCommitHeader {
	readonly author: string;
	readonly authorMail: string;
	/** Unix seconds — the `age` half of the age heatmap. */
	readonly authorTime: number;
	readonly authorTz: string;
	readonly committer: string;
	readonly committerMail: string;
	readonly committerTime: number;
	readonly committerTz: string;
	readonly summary: string;
}

export interface GitBlamePrevious {
	readonly sha: string;
	readonly path: string;
}

/**
 * Wire projection of one `git::blame::BlameLineEntry`. `filename` (and
 * `previous`'s path) are kept per line rather than folded into
 * `GitBlameCommitHeader`: a rename-and-edit commit's own lines can
 * legitimately report two different `filename` values within one blame
 * response (pre-rename lines show the old path, the commit's own new lines
 * show the new path) — see `src-tauri/src/git/blame.rs`'s `BlameLineEntry`
 * doc comment. `isUncommitted` is `true` exactly when this line reflects an
 * uncommitted working-tree change (`commitSha` is then a git-internal
 * all-zero sentinel the server already hides behind this boolean — never
 * compare `commitSha` against a literal sentinel string in frontend code).
 */
export interface GitBlameLineEntry {
	readonly commitSha: string;
	readonly isUncommitted: boolean;
	readonly origLine: number;
	readonly finalLine: number;
	readonly isBoundary: boolean;
	readonly filename: string;
	readonly previous: GitBlamePrevious | null;
}

export interface GitBlameFileResult {
	readonly entries: readonly GitBlameLineEntry[];
	readonly commits: Readonly<Record<string, GitBlameCommitHeader>>;
}

/** Keyed by commit sha; a sha not present in the map (e.g. because the
 * caller mistakenly included the uncommitted sentinel, which `gitStatus`'s
 * own `GitBlameLineEntry.isUncommitted` already lets callers filter out
 * before calling) simply never appears — never a partial/placeholder entry. */
export interface GitBlameCommitMessagesResult {
	readonly messages: Readonly<Record<string, string>>;
}

// --- Git file/line history (F090 S1: `git::log`) ----------------------------

/** A 1-based, inclusive line range for [`gitLineHistoryList`]/
 * [`gitLineHistoryDetail`] — unlike [`GitBlameLineRange`] (optional,
 * `null` means whole-file), this is always required: line history has no
 * "whole file" mode (that is [`gitFileHistory`]). Kept as its own
 * independent type, not a reuse of `GitBlameLineRange`, mirroring
 * `src-tauri/src/git/log.rs`'s own `LineRange` (a separate type from
 * `blame::BlameLineRange`, same shape, different meaning). */
export interface GitLogLineRange {
	readonly start: number;
	readonly end: number;
}

/** One commit's `sha` + full message body (`%B`) — deliberately *not* an
 * author/date-bearing type: see `src-tauri/src/git/log.rs`'s own module doc
 * comment for why this domain's list-producing commands never fetch a
 * second free-text field (author name) alongside the message body in one
 * `%x1f`-delimited `git log --format` record (only one such field can ever
 * be safely last). A caller wanting the message's first line for a compact
 * row derives it itself (e.g. `message.split("\n")[0]`). */
export interface GitHistoryEntry {
	readonly sha: string;
	readonly message: string;
}

/** Result shape shared by [`gitFileHistory`] and [`gitLineHistoryList`] —
 * both are "ordered commit list" queries against the same underlying
 * sha+full-body format, differing only in which `git log` invocation
 * produced them. `truncated` is `true` when more commits actually matched
 * than were returned (a defensive response-size ceiling, not a git limit —
 * see `src-tauri/src/git/log.rs`'s `MAX_HISTORY_ENTRIES`). */
export interface GitHistoryListResult {
	readonly entries: readonly GitHistoryEntry[];
	readonly truncated: boolean;
}

/** The raw, human-readable `git log -p`-style text (commit header, author,
 * date, message, and the unified diff hunk) for one [`gitLineHistoryList`]
 * entry, drilled into via [`gitLineHistoryDetail`] — deliberately
 * preformatted display text, never field-parsed by this domain (see that
 * method's own doc comment for why). */
export interface GitLineHistoryDetail {
	readonly sha: string;
	readonly diffText: string;
}

// --- Git commit detail (F090 S2: `git::show_commit`) ------------------------

/**
 * Wire projection of `git::show_commit::ShowCommitResult` — `files` reuses
 * [`GitDiffFileEntry`] verbatim (the exact same shape [`GitDiffFilesResult`]
 * already exposes): `show_commit`'s file list is built from the identical
 * `git::diff::DiffFileEntry` domain type `gitDiffFiles` produces, just from a
 * different pair of `git diff` invocations server-side — see
 * `src-tauri/src/git/show_commit.rs`'s own module doc comment for why this
 * never runs `git show` at all despite the name. `parentSha` is `null` only
 * for a root commit (zero parents); every file in that case is inherently
 * `kind: "added"` (the diff ran against git's own empty-tree object), so a
 * caller never needs a distinct "no parent" branch when deciding whether a
 * file's original side exists.
 */
export interface GitShowCommitResult {
	readonly sha: string;
	readonly parentSha: string | null;
	readonly files: readonly GitDiffFileEntry[];
}

// --- Git graph + refs (F090 S3: `git::log::log_graph` + `git::refs`) --------

/** One `git log --topo-order --branches --tags --remotes` DAG node —
 * `parents` is empty for a root commit, one element for an ordinary commit,
 * two for a normal merge, or three-or-more for an octopus merge. `subject`
 * is the commit message's first line only (see
 * `src-tauri/src/git/log.rs`'s own module doc comment for why this command
 * never fetches the full body alongside `sha`/`parents` in the same
 * `%x1f`-delimited record — a caller wanting the full message already has
 * `gitBlameCommitMessages` for an on-demand batch fetch). This command
 * deliberately never asks git for ref/branch/tag decoration (`%d`/`%D`) —
 * a caller wanting to badge a node with the refs pointing at it joins this
 * result against a separately-fetched [`gitRefsList`] result by comparing
 * `sha` against that result's own `targetSha`/`peeledSha`, entirely
 * client-side (see `plain-git-graph-layout.ts`'s own `buildRefBadgesBySha`). */
export interface GitGraphNode {
	readonly sha: string;
	readonly parents: readonly string[];
	readonly subject: string;
}

/** `truncated` is `true` when more commits actually matched the caller's own
 * requested `maxCount` than were returned — the same "capped, not
 * exhaustive" meaning [`GitHistoryListResult.truncated`] already carries for
 * this domain. */
export interface GitLogGraphResult {
	readonly nodes: readonly GitGraphNode[];
	readonly truncated: boolean;
}

/** Which of the three requested namespaces a [`GitRefEntry`] came from —
 * mirrors `src-tauri/src/git/refs.rs`'s own `RefGroupKind`. */
export type GitRefKind = "branch" | "remoteBranch" | "tag";

/** One `for-each-ref` record. `peeledSha`/`isAnnotatedTag` are only ever
 * meaningfully paired together: an annotated tag has `isAnnotatedTag: true`
 * and `peeledSha` set to the commit it ultimately points at; a lightweight
 * tag (or a branch/remote-tracking ref) has `isAnnotatedTag: false` and
 * `peeledSha: null` — never a same-commit sentinel. `upstream` is `null` for
 * both "no upstream configured" and "not a local branch at all" (a caller
 * already knows `kind` for the latter) — see
 * `src-tauri/src/git/refs.rs`'s own `RefEntry` doc comment for the full
 * rationale, including why ref names are plain `string` here rather than
 * needing the byte-safe modeling this domain's *path* fields use (git's own
 * ref-name grammar forbids every ASCII control byte, so a ref name can
 * never contain anything the wire boundary's UTF-8 requirement would need
 * to lossily project away — unlike a Linux path, which can). */
export interface GitRefEntry {
	readonly kind: GitRefKind;
	readonly fullName: string;
	readonly shortName: string;
	readonly targetSha: string;
	readonly isAnnotatedTag: boolean;
	readonly peeledSha: string | null;
	readonly upstream: string | null;
	readonly isHead: boolean;
}

export interface GitRefsListResult {
	readonly entries: readonly GitRefEntry[];
	readonly truncated: boolean;
}

// --- Git stash (F090 S4: `git::stash`) ---------------------------------------

/**
 * One `git stash list` entry. `index` is the entry's own `stash@{N}` position
 * at the moment it was listed — display-only (e.g. rendering `"#0"`); no
 * stash write command in this domain ever accepts it back as an input (see
 * `src-tauri/src/git/stash.rs`'s own module doc comment for why: dropping an
 * entry shifts every later entry's own index, so every write here is
 * addressed by `sha` instead, which never shifts). `message` is the full
 * commit body (`%B`), mirroring `GitHistoryEntry.message`'s identical
 * "full body, not just the first line" convention.
 */
export interface GitStashEntry {
	readonly index: number;
	readonly sha: string;
	readonly committerTime: number;
	readonly message: string;
}

export interface GitStashListResult {
	readonly entries: readonly GitStashEntry[];
	readonly truncated: boolean;
}

/**
 * `files` reuses [`GitDiffFileEntry`] verbatim — the exact same shape
 * [`GitDiffFilesResult`]/[`GitShowCommitResult`] already expose (see
 * `src-tauri/src/git/stash.rs`'s own module doc comment for why
 * `gitStashShow`'s file list is built from the identical `DiffFileEntry`
 * domain type). `parentSha` is `null` only when the stash's own base commit
 * is itself a root commit (zero parents) — mirrors `GitShowCommitResult`'s
 * identical convention.
 */
export interface GitStashShowResult {
	readonly sha: string;
	readonly parentSha: string | null;
	readonly files: readonly GitDiffFileEntry[];
}

/** `"noLocalChanges"` is `git stash push`'s own documented "nothing to save"
 * outcome (an untracked-only tree pushed without `includeUntracked`) — not
 * an error, and not distinguishable from a real push by exit code alone; see
 * `src-tauri/src/git/stash.rs`'s own module doc comment for why `--quiet`
 * could not be used here (it silently swallows this exact outcome's own
 * stdout text, the only way this domain can detect it at all). */
export type GitStashPushOutcome = "created" | "noLocalChanges";

/**
 * Shared result shape for [`gitStashApply`]/[`gitStashPop`] — mirrors
 * `stash::StashApplyOutcome`'s own "shared, since the conflict/success shape
 * is identical" rationale server-side. `conflictedPaths` is read back from a
 * fresh `git status` (never parsed out of apply/pop's own free-text conflict
 * output) — see that Rust type's own doc comment. Whether the underlying
 * stash *entry* was itself removed afterward is not encoded here (implied
 * entirely by which method was called: `gitStashApply` never removes it,
 * `gitStashPop` removes it only on `"applied"`, never on `"conflict"` — the
 * stash entry is deliberately kept on a conflicting pop, mirroring `git
 * stash pop`'s own documented behavior).
 */
export type GitStashApplyOutcome =
	| Readonly<{ kind: "applied" }>
	| Readonly<{ kind: "conflict"; conflictedPaths: readonly string[] }>;

// --- Git worktree (F090 S5: `git::worktree`) --------------------------------

/** Which of an attached branch, a detached commit, or a bare repository's own
 * administrative worktree a [`GitWorktreeEntry`] currently has checked out —
 * mirrors `src-tauri/src/git/worktree.rs`'s `WorktreeHeadState` verbatim. */
export type GitWorktreeHeadState =
	| Readonly<{ kind: "branch"; refName: string }>
	| Readonly<{ kind: "detached" }>
	| Readonly<{ kind: "bare" }>;

/**
 * One `git worktree list --porcelain -z` block. `headSha` is `null` only for
 * a genuinely unborn `HEAD` or for `headState.kind === "bare"` (no `HEAD`
 * line at all) — see `src-tauri/src/git/worktree.rs`'s own doc comment.
 * `lockReason`/`prunableReason` are `null` for "not locked"/"not prunable"
 * and a string (possibly empty, when git itself recorded no reason text)
 * when they are. `isMain` is `true` for exactly the one entry git always
 * lists first (confirmed empirically, `worktree.rs`'s own doc comment) —
 * `worktree add`'s destination is always a *new* linked worktree, and this
 * feature's own UI never offers the main entry itself for removal.
 */
export interface GitWorktreeEntry {
	readonly path: string;
	readonly headSha: string | null;
	readonly headState: GitWorktreeHeadState;
	readonly lockReason: string | null;
	readonly prunableReason: string | null;
	readonly isMain: boolean;
}

export interface GitWorktreeListResult {
	readonly entries: readonly GitWorktreeEntry[];
	readonly truncated: boolean;
}

/**
 * `gitWorktreeAdd`'s own result — `"pickerCancelled"` when the native folder
 * picker this call always invokes server-side was dismissed without a
 * selection (not an error: mirrors `WorkspacePickResult`'s own cancellation
 * modeling for the identical real user gesture); `"added"` carries the new
 * worktree's own full, absolute filesystem path.
 */
export type GitWorktreeAddOutcome =
	| Readonly<{ kind: "added"; path: string }>
	| Readonly<{ kind: "pickerCancelled" }>;

/** `gitWorktreeRemove`'s own result — see `src-tauri/src/git/worktree.rs`'s
 * own doc comment for the full three-way clean/dirty/locked outcome split
 * this feature implements: `"needsForce"` is not an error (a clean worktree
 * is `"removed"` immediately; a dirty one reports `"needsForce"` so the
 * caller can confirm before ever retrying with `force: true`), while a
 * locked, main, or unregistered-path worktree instead rejects the call
 * entirely (see `gitWorktreeRemove`'s own doc comment below). */
export type GitWorktreeRemoveOutcome = "removed" | "needsForce";

export type Unlisten = () => void | Promise<void>;

export interface PlainBridge {
	runtimeInfo(): Promise<RuntimeInfo>;
	windowCreate(): Promise<void>;
	onRuntimeReady(listener: (payload: RuntimeInfo) => void): Promise<Unlisten>;
	onNativeCloseRequested(
		listener: (request: NativeCloseRequest) => void,
	): Promise<Unlisten>;
	lifecycleCompleteClose(
		requestId: string,
		outcome: "allow" | "veto",
	): Promise<void>;
	lifecycleRequestClose(): Promise<void>;
	userDataRead(resource: UserDataResource): Promise<UserDataResult>;
	userDataWrite(
		resource: UserDataResource,
		expectedRevision: number,
		content: string,
	): Promise<UserDataResult>;
	onUserDataChanged(
		listener: (event: UserDataChangedEvent) => void,
	): Promise<Unlisten>;
	workspaceCapabilities(): Promise<WorkspaceCapabilities>;
	workspaceSnapshot(): Promise<WorkspaceSnapshot>;
	workspaceReconcileWatchRoots(rootIds: readonly string[]): void;
	workspaceWatch(rootId: string, listener: () => void): Unlisten;
	workspacePickRoots(mode: WorkspacePickMode): Promise<WorkspacePickResult>;
	workspaceOpenFiles(): Promise<WorkspaceOpenFilesResult>;
	workspacePickSaveTarget(
		suggestedName: string,
	): Promise<WorkspacePickSaveTargetResult>;
	workspaceRecentList(): Promise<WorkspaceRecentListResult>;
	workspaceOpenRecent(recentId: string): Promise<WorkspaceSnapshot>;
	workspaceRemoveRecent(recentId: string): Promise<void>;
	workspaceClearRecent(): Promise<void>;
	workspaceRemoveRoot(rootId: string): Promise<WorkspaceSnapshot>;
	workspaceCloseFolder(): Promise<WorkspaceSnapshot>;
	workspaceCreateFile(
		rootId: string,
		relativePath: string,
	): Promise<WorkspaceEntryStat>;
	workspaceCreateDirectory(
		rootId: string,
		relativePath: string,
	): Promise<WorkspaceEntryStat>;
	workspaceRename(
		rootId: string,
		sourcePath: string,
		targetPath: string,
	): Promise<void>;
	workspaceCopy(
		sourceRootId: string,
		sourcePath: string,
		targetRootId: string,
		targetPath: string,
	): Promise<void>;
	workspaceMove(
		sourceRootId: string,
		sourcePath: string,
		targetRootId: string,
		targetPath: string,
	): Promise<WorkspaceMoveResult>;
	workspacePrepareDelete(
		entries: readonly WorkspaceDeleteEntryRequest[],
	): Promise<WorkspaceDeleteBatchPlan>;
	workspaceCancelDelete(confirmationId: string): Promise<void>;
	workspaceBeginDelete(confirmationId: string): Promise<void>;
	workspaceCommitDeleteEntry(
		confirmationId: string,
		entryId: string,
		rootId: string,
		relativePath: string,
		recursive: boolean,
	): Promise<WorkspaceDeleteResult>;
	workspaceStat(
		rootId: string,
		relativePath: string,
	): Promise<WorkspaceEntryStat>;
	workspaceReadDirectory(
		rootId: string,
		relativePath: string,
	): Promise<WorkspaceReadDirectoryResult>;
	workspaceReadFile(
		rootId: string,
		relativePath: string,
	): Promise<WorkspaceReadFileResult>;
	/**
	 * Bounded, read-only file-name search across `roots`. `filePattern` is a
	 * plain (non-glob) fuzzy-search string, empty meaning "list everything";
	 * `excludeGlobs` are extra glob patterns to prune (this slice always
	 * respects `.gitignore` and does not expose an `includeGlobs`/
	 * `useIgnoreFiles` toggle — see `docs/research/2026-07-23-search-quickopen.md`).
	 * `maxResults` is clamped server-side to a safe range regardless of what
	 * is requested.
	 */
	workspaceSearchFiles(
		roots: readonly string[],
		filePattern: string,
		excludeGlobs: readonly string[],
		maxResults: number,
	): Promise<WorkspaceSearchFilesResult>;
	/**
	 * Starts one streaming full-text search (F040 S3). Starting a new one for
	 * the same window supersedes whatever search (active or lingering-done)
	 * that window already had — the caller does not need to cancel the old
	 * one first. Listen for `workspaceSearchTextWatch`'s wake hints and call
	 * `workspaceSearchTextPoll` to pull results.
	 */
	workspaceSearchTextStart(
		request: WorkspaceSearchTextStartRequest,
	): Promise<WorkspaceSearchTextStartResult>;
	/**
	 * Drains whatever batches `searchId` has produced since `cursor` (never
	 * blocks). `cursor` must equal the last `nextCursor` this search
	 * returned (0 for the first call).
	 */
	workspaceSearchTextPoll(
		searchId: string,
		cursor: number,
	): Promise<WorkspaceSearchTextPollResult>;
	/** Idempotent-to-call, but not idempotent in outcome: cancelling an
	 * already-cancelled/unknown/expired search rejects. */
	workspaceSearchTextCancel(searchId: string): Promise<void>;
	/**
	 * Registers a listener for the fire-and-forget wake hint that a search
	 * has new batches ready to poll. The listener receives the searchId the
	 * hint belongs to; a caller that only cares about its own current search
	 * must compare it itself (a hint for a superseded search may still
	 * arrive after the fact).
	 */
	workspaceSearchTextWatch(listener: (searchId: string) => void): Unlisten;
	workspaceWriteFile(
		rootId: string,
		relativePath: string,
		expectedVersion: string,
		content: Uint8Array,
	): Promise<WorkspaceWriteResult>;
	workspacePublishFile(
		rootId: string,
		relativePath: string,
		content: Uint8Array,
	): Promise<WorkspaceWriteResult>;
	backupWrite(rootId: string, key: string, bytes: Uint8Array): Promise<void>;
	backupReadAll(): Promise<readonly BackupEntry[]>;
	backupDiscard(rootId: string, key: string): Promise<void>;
	backupDiscardAll(): Promise<void>;
	scratchCreate(): Promise<ScratchCreateResult>;
	scratchWrite(scratchId: string, bytes: Uint8Array): Promise<void>;
	scratchReadAll(): Promise<readonly ScratchEntry[]>;
	scratchDiscard(scratchId: string): Promise<void>;
	scratchDiscardAll(): Promise<void>;
	/** Prompts for a `.vsix` file via a native dialog and imports it. The
	 * file dialog only ever opens from this explicit, user-triggered call —
	 * never from startup or any implicit path. */
	themeImportVsix(): Promise<ThemeImportResult>;
	/** Prompts for an already-unpacked theme package directory via a native
	 * dialog and imports it. */
	themeImportDirectory(): Promise<ThemeImportResult>;
	themeList(): Promise<ThemeListResult>;
	/** Reads one resource's bytes out of an imported package, whitelisted
	 * against that exact package's own `resources` (see
	 * `ThemePackageSummary`'s doc comment). */
	themeReadResource(
		packageId: string,
		relativePath: string,
	): Promise<Uint8Array>;
	/** Removes an imported package by id. Idempotent — removing an unknown
	 * or already-removed id succeeds without error. */
	themeRemove(packageId: string): Promise<void>;
	/** Reads the persisted color theme selection (`{ themeId: null }` if none
	 * is stored). Never throws for "nothing is stored" — that is exactly
	 * `themeId: null`, not a rejection. */
	themeGetSelection(): Promise<ThemeSelectionResult>;
	/** Persists (a non-null `themeId`) or clears (`null`) the color theme
	 * selection, leaving the file icon/product icon axes exactly as they
	 * were (each of the three `themeSet*Selection` methods below sends only
	 * its own field on the wire — see `theme::selection`'s own module doc
	 * comment for why `theme_set_selection`'s per-field update semantics
	 * make that safe). A non-null id that fails Rust's charset/length check
	 * rejects with `THEME_SELECTION_INVALID` and leaves whatever was
	 * previously persisted untouched. */
	themeSetSelection(themeId: string | null): Promise<void>;
	/** Persists (a non-null `fileIconThemeId`) or clears (`null`) the file
	 * icon theme selection, leaving the color/product icon axes untouched.
	 * Same validation/rejection contract as `themeSetSelection`. */
	themeSetFileIconThemeSelection(fileIconThemeId: string | null): Promise<void>;
	/** Persists (a non-null `productIconThemeId`) or clears (`null`) the
	 * product icon theme selection, leaving the color/file icon axes
	 * untouched. Same validation/rejection contract as
	 * `themeSetSelection`. */
	themeSetProductIconThemeSelection(
		productIconThemeId: string | null,
	): Promise<void>;
	/** Starts a new interactive terminal session bound to one exact authorized
	 * root. `cwd: null` uses that root itself; a non-null cwd must resolve
	 * inside the same root — see `src-tauri/src/terminal/service.rs`'s
	 * `resolve_cwd`. Rejects with
	 * `WORKSPACE_NOT_TRUSTED` if the current workspace has not been granted
	 * execution trust (see `workspaceTrustGrant`). */
	terminalStart(
		rootId: string,
		cwd: string | null,
		cols: number,
		rows: number,
	): Promise<TerminalStartResult>;
	/** Writes `text` (an IME composition commit, or a pasted block) to the
	 * session's pty as its own UTF-8 bytes — no key encoding involved,
	 * unlike `terminalInputKey`. */
	terminalInputText(sessionId: string, text: string): Promise<void>;
	/** Encodes one structured key event through `libghostty-vt`'s own key
	 * encoder and writes the resulting bytes to the session's pty. `action`/
	 * `key` are the literal `libghostty_vt::key::{Action,Key}` `#[repr(u32)]`
	 * enum discriminant values; `mods` is a strict `libghostty_vt::key::Mods`
	 * bitmask (unknown bits rejected) — see
	 * `src-tauri/src/terminal/dto.rs`'s `TerminalInputKeyRequest` doc comment
	 * for why this is not a hand-maintained name lookup. */
	terminalInputKey(
		sessionId: string,
		action: number,
		key: number,
		mods: number,
		utf8: string | null,
	): Promise<void>;
	/** Reports a focus gained/lost transition. Writes the encoded focus
	 * escape sequence to the pty only if the session's live terminal
	 * currently has focus-reporting mode (DEC 1004) enabled; otherwise a
	 * silent no-op. */
	terminalFocus(sessionId: string, focused: boolean): Promise<void>;
	terminalResize(sessionId: string, cols: number, rows: number): Promise<void>;
	/** Acknowledges every `plain://terminal-data` frame up through
	 * `sequence` (**not** a byte count — see
	 * `src-tauri/src/terminal/dto.rs`'s `TerminalAckRequest` doc comment),
	 * freeing the vt thread's single-frame-in-flight emission credit —
	 * see `terminal-stream.ts`'s doc comment for the backpressure
	 * contract. */
	terminalAck(sessionId: string, sequence: number): Promise<void>;
	/** Pulls up to `count` scrollback rows starting at history row `start`
	 * (`0` = oldest retained line). A `start` past the end of retained
	 * scrollback is not an error — it simply yields fewer, possibly zero,
	 * rows; see `src-tauri/src/terminal/vt.rs`'s `VtSession::scrollback_rows`
	 * doc comment for why retained history may be considerably less than
	 * the configured cap for wide/richly-styled content. */
	terminalScrollback(
		sessionId: string,
		start: number,
		count: number,
	): Promise<TerminalScrollbackResult>;
	/** `immediate: true` waits for full teardown before resolving;
	 * `immediate: false` still signals the kill immediately but does not
	 * wait — see `TerminalService::kill`'s doc comment. */
	terminalKill(sessionId: string, immediate: boolean): Promise<void>;
	/** Registers a listener for every terminal session's streamed
	 * render-state frames in this window. The listener receives the full
	 * decoded event (including `sessionId`) and must filter for the
	 * session(s) it cares about itself — mirrors
	 * `workspaceSearchTextWatch`'s own single-listener-for-every-id
	 * precedent. Prefer `terminal-stream.ts`'s per-session wrapper over
	 * calling this directly. */
	terminalWatchData(listener: (event: TerminalDataEvent) => void): Unlisten;
	/** Registers a listener for every terminal session's exit notification in
	 * this window. Same all-sessions-in-one-listener shape as
	 * `terminalWatchData`. */
	terminalWatchExit(listener: (event: TerminalExitEvent) => void): Unlisten;
	/** Reads whether the current workspace currently has execution trust
	 * granted (`false`, never a rejection, for the `EMPTY` workspace). */
	workspaceTrustState(): Promise<WorkspaceTrustState>;
	/** Grants execution trust to the current workspace's exact root set.
	 * Rejects with `TRUST_UNAVAILABLE` for the `EMPTY` workspace (nothing to
	 * grant trust to). */
	workspaceTrustGrant(): Promise<WorkspaceTrustState>;
	/** Revokes execution trust for the current workspace. Idempotent:
	 * revoking an already-untrusted workspace succeeds silently. Rejects
	 * with `TRUST_UNAVAILABLE` for the `EMPTY` workspace, same as
	 * `workspaceTrustGrant`. */
	workspaceTrustRevoke(): Promise<void>;
	/** Resolves the current window's single authorized workspace root as a
	 * Git repository (via `git rev-parse --show-toplevel`) and runs `git
	 * status --porcelain=v2 -z --branch --ignored`. Rejects with
	 * `WORKSPACE_NOT_TRUSTED` if the workspace has not been granted execution
	 * trust, or `GIT_NO_REPOSITORY` if the trusted root is not a Git working
	 * tree. */
	gitStatus(rootId?: string): Promise<GitStatusResult>;
	/** Lists file-level diff entries (`cached: true` for the index-vs-HEAD
	 * diff, `false` for the worktree-vs-index diff) — see
	 * `src-tauri/src/git/diff.rs`'s `diff_files` doc comment for the
	 * two-invocation-join caveat. Same trust/repository rejections as
	 * `gitStatus`. */
	gitDiffFiles(cached: boolean, rootId?: string): Promise<GitDiffFilesResult>;
	/** Reads one version of `path` (repository-toplevel-relative). Same
	 * trust/repository rejections as `gitStatus`; a missing version of an
	 * otherwise-valid path is `{ content: null }`, not a rejection. */
	gitShowBlob(
		rev: GitBlobRev,
		path: string,
		rootId?: string,
	): Promise<GitShowBlobResult>;
	/** `F080` S3: `git add -A -- <paths...>` — stages every kind of
	 * working-tree change (modified/added/deleted) for exactly the given
	 * repository-toplevel-relative paths. Same trust/repository rejections as
	 * `gitStatus`; rejects with `GIT_MUTATE_PATHS_INVALID_REQUEST` for an
	 * empty list or an invalid (absolute, `..`-traversing, or oversized)
	 * path. */
	gitStagePaths(paths: readonly string[], rootId?: string): Promise<void>;
	/** `F080` S3: `git reset -q -- <paths...>` — unstages exactly the given
	 * paths, leaving working-tree content untouched. Same
	 * rejections as `gitStagePaths`. */
	gitUnstagePaths(paths: readonly string[], rootId?: string): Promise<void>;
	/** `F080` S3 hunk-level stage: hashes `content` (the file's complete new
	 * content after applying one or more selected hunks — computed by the
	 * frontend's Monaco diff engine, never a unified-diff patch) into the
	 * object database and writes it into the index at `path`, without
	 * touching the working tree. See `src-tauri/src/git/stage.rs`'s
	 * `stage_blob` doc comment for the exact `hash-object`/`update-index`
	 * mechanics and mode-resolution rule. Rejects with
	 * `GIT_STAGE_BLOB_CONTENT_TOO_LARGE` above 8 MiB, or
	 * `GIT_STAGE_BLOB_INVALID_PATH` for an invalid path. */
	gitStageBlob(
		path: string,
		content: Uint8Array,
		rootId?: string,
	): Promise<void>;
	/** `F080` S3: `git -c user.useConfigOnly=true commit --quiet --file -
	 * [--amend]` — `message` travels over stdin, never a command-line
	 * argument. Rejects with `GIT_COMMIT_EMPTY_MESSAGE` for an empty/
	 * whitespace-only message, `GIT_COMMIT_NOTHING_TO_COMMIT` when nothing is
	 * staged, or `GIT_COMMIT_FAILED` for any other failure (including a
	 * blocking `pre-commit`/`commit-msg` hook — hooks are *not* suppressed
	 * for this user-initiated write, unlike `gitStatus`'s background read).
	 */
	gitCommit(message: string, amend: boolean, rootId?: string): Promise<void>;
	/** `F080` S3, **destructive**: `git checkout -q -- <paths...>` — restores
	 * exactly the given paths' working-tree content to the index's version,
	 * discarding unstaged edits. This call performs the discard
	 * unconditionally; the caller must have already confirmed with the user
	 * (see `IDialogService.confirm` in `app/features/scm/plain-scm-view.ts`)
	 * before invoking it. Empirically all-or-nothing: if any path in the
	 * batch cannot be resolved (e.g. an untracked path), the whole call
	 * rejects with `GIT_DISCARD_FAILED` and none of the paths are touched.
	 * Same path-list validation rejections as `gitStagePaths`. */
	gitDiscardPaths(paths: readonly string[], rootId?: string): Promise<void>;
	/** `F080` S4: computes the ahead/behind preview for `operation` — never
	 * spawns a network subprocess itself (both underlying git invocations are
	 * pure local-ref/local-object-database reads). Same trust/repository
	 * rejections as `gitStatus`; rejects with `GIT_NETWORK_NO_UPSTREAM` for
	 * `operation: "pull"` or `"push"` when the current branch has no upstream
	 * configured (`"fetch"` instead resolves to `{ upstream: null, ahead:
	 * null, behind: null }` in that case — see `GitNetworkPreviewResult`'s own
	 * doc comment). Callers must always call this and route its result
	 * through a confirmation dialog before ever calling `gitFetch`/`gitPull`/
	 * `gitPush` — see `app/features/scm/plain-scm-network.ts`. */
	gitNetworkPreview(
		operation: GitNetworkOperation,
		rootId?: string,
	): Promise<GitNetworkPreviewResult>;
	/** `F080` S4: `git fetch --quiet` (no explicit remote — resolves to the
	 * current branch's configured remote, or `origin`, exactly like a bare
	 * `git fetch` typed at a real terminal). Rejects with `GIT_FETCH_FAILED`
	 * on any other failure. Never called without a preceding, user-confirmed
	 * `gitNetworkPreview("fetch")` call. */
	gitFetch(rootId?: string): Promise<void>;
	/** `F080` S4: `git pull --quiet` against the current branch's configured
	 * upstream. Rejects with `GIT_NETWORK_NO_UPSTREAM` if none is configured,
	 * `GIT_PULL_NEEDS_STRATEGY` if the branches have diverged and no
	 * merge/rebase/fast-forward-only reconcile strategy is configured (this
	 * domain never auto-configures one on the caller's behalf — ADR 0003), or
	 * `GIT_PULL_FAILED` for any other failure. Never called without a
	 * preceding, user-confirmed `gitNetworkPreview("pull")` call. */
	gitPull(rootId?: string): Promise<void>;
	/** `F080` S4, **network-destructive when `force` is true**: `git push
	 * --quiet` (or, with `force: true`, `git push --quiet --force-with-lease`
	 * — never bare `--force`, see `src-tauri/src/git/network.rs`'s own module
	 * doc comment) against the current branch's configured upstream. Rejects
	 * with `GIT_NETWORK_NO_UPSTREAM` if none is configured, `GIT_PUSH_REJECTED`
	 * if the remote has commits this branch does not (a stale
	 * `--force-with-lease` "lease" included), or `GIT_PUSH_FAILED` for any
	 * other failure. Never called without a preceding, user-confirmed
	 * `gitNetworkPreview("push")` call — `force: true` requires its own,
	 * separately-worded confirmation (see
	 * `app/features/scm/plain-scm-network.ts`'s `"forcePush"` kind). */
	gitPush(force: boolean, rootId?: string): Promise<void>;
	/** `F080` S4: best-effort, idempotent request to cancel whatever
	 * `gitFetch`/`gitPull`/`gitPush` call is currently in flight for this
	 * window and selected root (a no-op if none is) — the user-reachable half of this domain's
	 * cooperative network-exec cancellation (`GitExecMode::Network`'s longer
	 * timeout means a stuck fetch/pull/push needs a real way to abort early).
	 * Never rejects. */
	gitNetworkCancel(rootId?: string): Promise<void>;
	/** `F090` S0: `git blame --line-porcelain --root -c core.quotePath=false
	 * [-L<range>] -- <path>` — `path` is repository-toplevel-relative, `range`
	 * omitted means whole-file blame. Same trust/repository rejections as
	 * `gitStatus`; rejects with `GIT_BLAME_PATH_NOT_FOUND` for a path absent
	 * from both the working tree and the repository's history,
	 * `GIT_BLAME_INVALID_RANGE` for a structurally invalid range (`start` `<
	 * 1` or `end < start`), or `GIT_BLAME_RANGE_OUT_OF_BOUNDS` when `range`
	 * exceeds the file's current line count. */
	gitBlameFile(
		path: string,
		range: GitBlameLineRange | null,
		rootId?: string,
	): Promise<GitBlameFileResult>;
	/** `F090` S0: batch `git log --no-walk` fetch of each requested commit's
	 * full message body (blame's own `summary` is only the first line) — for
	 * the inline-blame hover feature. Every sha must be a real, exactly
	 * 40-lowercase-hex commit id; never the `isUncommitted` sentinel a
	 * `gitBlameFile` line may report (callers must filter that out first —
	 * there is no commit object to look up for it). Rejects with
	 * `GIT_BLAME_COMMIT_MESSAGES_INVALID_REQUEST` for an empty-after-filter
	 * malformed entry, an oversized batch, or the sentinel; an empty `shas`
	 * array itself is valid and simply resolves to `{ messages: {} }`. */
	gitBlameCommitMessages(
		shas: readonly string[],
		rootId?: string,
	): Promise<GitBlameCommitMessagesResult>;
	/** `F090` S1: `git log -z --format=%H%x1f%B --no-patch --follow -- <path>`
	 * — the whole-file commit list, newest first. `--follow` is git's own
	 * documented *heuristic* rename tracker, not a guarantee (see
	 * `src-tauri/src/git/log.rs`'s own module doc comment). A path with no
	 * history at all (never committed, or never existed) is **not** a
	 * rejection — it resolves to `{ entries: [], truncated: false }`. Same
	 * trust/repository rejections as `gitStatus`. */
	gitFileHistory(path: string, rootId?: string): Promise<GitHistoryListResult>;
	/** `F090` S1: `git log -z --format=%H%x1f%B --no-patch -L<range>:<path>` —
	 * the commit list touching one specific line range, newest first (this
	 * already crosses a rename on its own, by default, for the tracked line —
	 * seeing both the commit that last changed it *and* the earlier commit
	 * that introduced it). Same trust/repository rejections as `gitStatus`;
	 * rejects with `GIT_LOG_INVALID_RANGE` for a structurally invalid range,
	 * `GIT_LINE_HISTORY_PATH_NOT_FOUND` for a path absent at the current
	 * revision, or `GIT_LINE_HISTORY_RANGE_OUT_OF_BOUNDS` when `range` exceeds
	 * the file's current line count. */
	gitLineHistoryList(
		path: string,
		range: GitLogLineRange,
		rootId?: string,
	): Promise<GitHistoryListResult>;
	/** `F090` S1: drills into one `gitLineHistoryList(path, range)` entry's
	 * actual diff hunk. `skip` is the zero-based position of the desired entry
	 * within that *same* call's own result order (`entries[skip]`) —
	 * **not** an arbitrary commit-ish; see `src-tauri/src/git/log.rs`'s own
	 * module doc comment for why a bare `<sha>` positional does not work
	 * across a rename, and why this re-walks the identical `-L` query instead,
	 * narrowed to one record via `--skip`/`--max-count=1`. `expectedSha` must
	 * be `entries[skip].sha` from that same list call; rejects with
	 * `GIT_LINE_HISTORY_DETAIL_STALE_INDEX` if the underlying history shifted
	 * between the list fetch and this call (a new commit landing on the same
	 * line), rather than silently showing the wrong commit's diff, or
	 * `GIT_LINE_HISTORY_DETAIL_NOT_FOUND` if no entry exists at `skip` at all
	 * (e.g. a stale, now-out-of-range position). Same range/path rejections as
	 * `gitLineHistoryList`. */
	gitLineHistoryDetail(
		path: string,
		range: GitLogLineRange,
		skip: number,
		expectedSha: string,
		rootId?: string,
	): Promise<GitLineHistoryDetail>;
	/** `F090` S2: resolves `sha`'s file-level change list against its first
	 * parent (or git's own well-known empty-tree object for a root commit) —
	 * see `src-tauri/src/git/show_commit.rs`'s own module doc comment for why
	 * this never runs `git show`'s combined-diff default (which is misleading
	 * empty for a clean merge commit) despite the name. `sha` must be a real,
	 * exactly 40-lowercase-hex commit id. Same trust/repository rejections as
	 * `gitStatus`; rejects with `GIT_SHOW_COMMIT_INVALID_SHA` for a malformed
	 * sha, or `GIT_SHOW_COMMIT_NOT_FOUND` for a sha that does not resolve to a
	 * real commit object (including a syntactically valid sha naming a real
	 * blob/tree instead). */
	gitShowCommit(sha: string, rootId?: string): Promise<GitShowCommitResult>;
	/** `F090` S2: reads one version of `path` at an arbitrary, already-
	 * validated commit `sha` — the multi-diff resolver's own content-fetch
	 * primitive for each changed file's original/modified side (the commit
	 * itself for the modified side, its resolved `GitShowCommitResult.
	 * parentSha` for the original side). Same shape and not-found semantics as
	 * `gitShowBlob` (`{ content: null }`, not a rejection, when the path does
	 * not exist at that revision) — reuses that exact result type rather than
	 * a near-duplicate one. */
	gitShowCommitBlob(
		sha: string,
		path: string,
		rootId?: string,
	): Promise<GitShowBlobResult>;
	/** `F090` S3: `git log -z --format=%H%x1f%P%x1f%s --no-patch --topo-order
	 * --branches --tags --remotes --max-count=<maxCount+1>` — the graph
	 * view's own DAG source. `maxCount` must be a positive integer (the
	 * caller's own display window); rejects with
	 * `GIT_LOG_GRAPH_INVALID_REQUEST` for zero or an excessive value. Same
	 * trust/repository rejections as `gitStatus`. */
	gitLogGraph(maxCount: number, rootId?: string): Promise<GitLogGraphResult>;
	/** `F090` S3: `git for-each-ref --format=... refs/heads refs/tags
	 * refs/remotes` — the refs sidebar's own data source, and the graph
	 * view's own ref-badge join source (see `GitGraphNode`'s own doc
	 * comment). Takes no parameters. Same trust/repository rejections as
	 * `gitStatus`. */
	gitRefsList(rootId?: string): Promise<GitRefsListResult>;
	/** `F090` S4: `git stash list -z --format=%gd%x1f%H%x1f%ct%x1f%B` — the
	 * stash panel's own data source, newest first. Takes no parameters. Same
	 * trust/repository rejections as `gitStatus`. */
	gitStashList(rootId?: string): Promise<GitStashListResult>;
	/** `F090` S4: `git stash show --name-status/--numstat -z -u -M -C
	 * --find-copies-harder <sha>` — one stash entry's own file-level change
	 * list. `sha` must be a real, exactly 40-lowercase-hex commit id
	 * belonging to a real stash-like entry. Same trust/repository rejections
	 * as `gitStatus`; rejects with `GIT_STASH_NOT_FOUND` for a malformed or
	 * nonexistent sha (including a syntactically valid sha naming a real
	 * commit that is not itself a stash entry). */
	gitStashShow(sha: string, rootId?: string): Promise<GitStashShowResult>;
	/** `F090` S4: `git stash push -m <message> [--include-untracked] -- .` —
	 * moves the current working tree's uncommitted changes into a new stash
	 * entry. This is a low-severity write per this feature's own frozen plan
	 * (nothing is lost — the change is only ever *moved*, never discarded) so
	 * this call has no confirmation gate of its own; the caller's own UI
	 * still shows a static, non-blocking notice before the button is pressed
	 * (see `plain-scm-stash.ts`'s own module doc comment for why only
	 * `gitStashPop`/`gitStashDrop` get a real confirmation dialog). Rejects
	 * with `GIT_STASH_PUSH_EMPTY_MESSAGE`/`GIT_STASH_PUSH_MESSAGE_TOO_LARGE`
	 * for a malformed `message`, or `GIT_STASH_PUSH_NO_INITIAL_COMMIT` when
	 * the repository has no commits yet to base a stash on. Same trust/
	 * repository rejections as `gitStatus`. */
	gitStashPush(
		message: string,
		includeUntracked: boolean,
		rootId?: string,
	): Promise<GitStashPushOutcome>;
	/** `F090` S4: `git stash apply [--index] <sha>` — applies a stash entry's
	 * changes without removing it from the list. Unlike `gitStashPop`, `sha`
	 * may be passed straight through to git (confirmed empirically that
	 * `apply` accepts any commit that looks like a stash entry, unlike `pop`/
	 * `drop`) — see `src-tauri/src/git/stash.rs`'s own module doc comment.
	 * Never confirmed by this call itself (see `gitStashPush`'s own doc
	 * comment for the same "low severity per the frozen plan" reasoning —
	 * applying never removes the entry, so at worst it can be re-applied or
	 * dropped afterward); a conflict is reported as data (`{ kind: "conflict",
	 * ... }`), not an error. Rejects with `GIT_STASH_NOT_FOUND` for a
	 * malformed or nonexistent sha, or `GIT_STASH_APPLY_WOULD_OVERWRITE` when
	 * uncommitted local changes to the same paths would be silently
	 * clobbered (a different, preemptive failure mode from a true content
	 * conflict — git detects this before ever attempting a merge). Same
	 * trust/repository rejections as `gitStatus`. */
	gitStashApply(
		sha: string,
		useIndex: boolean,
		rootId?: string,
	): Promise<GitStashApplyOutcome>;
	/** `F090` S4: `git stash pop [--index] stash@{N}` — applies a stash
	 * entry's changes and, only on success, removes it from the list. `sha`
	 * is re-resolved to a fresh `stash@{N}` server-side immediately before
	 * acting (git's own grammar rejects a bare sha for `pop`, unlike `apply` —
	 * see `src-tauri/src/git/stash.rs`'s own module doc comment for the full
	 * rationale, including why this is *safer* than passing a caller-tracked
	 * index directly). This call performs the pop unconditionally; the caller
	 * must have already confirmed with the user via
	 * `resolveStashConfirmation(dialogService, { kind: "pop", ... })` (see
	 * `plain-scm-stash.ts`) — this mirrors `gitDiscardPaths`'s own "confirm
	 * first, this call never re-confirms" contract for this codebase's other
	 * irreversible writes. A conflict is reported as data (`{ kind:
	 * "conflict", ... }`, the stash entry deliberately *kept* — see
	 * `GitStashApplyOutcome`'s own doc comment), not an error. Rejects with
	 * `GIT_STASH_NOT_FOUND` when no entry with this sha currently exists (the
	 * disclosed, narrow race this domain accepts: dropped/popped by another
	 * process between the caller's last list and this call), or
	 * `GIT_STASH_POP_WOULD_OVERWRITE` for the same preemptive-failure case
	 * `gitStashApply` documents. Same trust/repository rejections as
	 * `gitStatus`. */
	gitStashPop(
		sha: string,
		useIndex: boolean,
		rootId?: string,
	): Promise<GitStashApplyOutcome>;
	/** `F090` S4: `git stash drop stash@{N}` — permanently, irreversibly
	 * discards a stash entry (unlike `gitStashPop`, there is no successful
	 * "applied" outcome at all: this call either drops the entry or rejects).
	 * `sha` is re-resolved to a fresh `stash@{N}` immediately before acting,
	 * exactly like `gitStashPop` (same rationale, same doc comment). This
	 * call performs the drop unconditionally; the caller must have already
	 * confirmed with the user via `resolveStashConfirmation(dialogService, {
	 * kind: "drop", ... })` — the same "confirm first, this call never
	 * re-confirms" contract `gitStashPop`/`gitDiscardPaths` already establish.
	 * Rejects with `GIT_STASH_NOT_FOUND` when no entry with this sha
	 * currently exists. Same trust/repository rejections as `gitStatus`. */
	gitStashDrop(sha: string, rootId?: string): Promise<void>;
	/** `F090` S5: `git worktree list --porcelain -z` — the worktree panel's own
	 * data source; the main worktree is always `entries[0]`. Takes no
	 * parameters. Same trust/repository rejections as `gitStatus`. */
	gitWorktreeList(rootId?: string): Promise<GitWorktreeListResult>;
	/** `F090` S5: `git worktree add [--detach] -- <path> [<commitIsh>]` —
	 * creates a new linked worktree. `childSegment` must be a single,
	 * non-empty path segment (no `/`) naming the new worktree's own leaf
	 * directory; this call always pops a native folder-picker dialog
	 * server-side first and joins that picked, already-authorized parent
	 * directory with `childSegment` — the caller never supplies (and this
	 * bridge method never accepts) a raw parent path (see
	 * `src-tauri/src/git/worktree.rs`'s own module doc comment for the full
	 * destination-authorization model). `commitIsh`, when given, must not be
	 * empty or begin with `-`. Never confirmed by this call itself (a low-
	 * severity write per this feature's own frozen plan — the native picker
	 * is itself this action's own explicit gesture; see
	 * `plain-git-worktree-view.ts`'s own module doc comment). Rejects with
	 * `GIT_WORKTREE_ADD_INVALID_CHILD_SEGMENT`/`GIT_WORKTREE_ADD_INVALID_COMMIT_ISH`
	 * for a malformed `childSegment`/`commitIsh`,
	 * `GIT_WORKTREE_ADD_PARENT_UNAVAILABLE` when the picked folder cannot be
	 * opened, `GIT_WORKTREE_ADD_TARGET_EXISTS` when the target already exists
	 * as a non-empty directory or a file, `GIT_WORKTREE_ADD_BRANCH_IN_USE`
	 * when `commitIsh` names a branch already checked out elsewhere, or
	 * `GIT_WORKTREE_ADD_INVALID_REFERENCE` when `commitIsh` does not resolve
	 * to a real commit. Same trust/repository rejections as `gitStatus`. */
	gitWorktreeAdd(
		childSegment: string,
		detach: boolean,
		commitIsh: string | null,
		rootId?: string,
	): Promise<GitWorktreeAddOutcome>;
	/** `F090` S5: `git worktree remove [--force] -- <path>` — removes a linked
	 * worktree. This call performs the removal unconditionally for whatever
	 * `force` the caller passes; the caller must always try `force: false`
	 * first and only retry with `force: true` after `resolveWorktreeConfirmation`
	 * (`plain-scm-worktree.ts`) reports `"confirmed"` in response to a first
	 * call reporting `"needsForce"` back — this mirrors `gitStashPop`'s own
	 * "confirm first, this call never re-confirms" contract, applied here to
	 * the *second* of two calls rather than the only one. Rejects with
	 * `GIT_WORKTREE_REMOVE_LOCKED` when the worktree is locked (this feature
	 * deliberately never auto-escalates to a second `--force`; see
	 * `worktree.rs`'s own doc comment), `GIT_WORKTREE_REMOVE_IS_MAIN_WORKTREE`
	 * when `path` names the repository's own main worktree, or
	 * `GIT_WORKTREE_REMOVE_NOT_FOUND` when `path` does not name any worktree
	 * registered to this repository (git's own safety net — an arbitrary
	 * path can never destroy unrelated data, see `worktree.rs`'s own doc
	 * comment). Same trust/repository rejections as `gitStatus`. */
	gitWorktreeRemove(
		path: string,
		force: boolean,
		rootId?: string,
	): Promise<GitWorktreeRemoveOutcome>;
	/** `F100` S1: reads whether the exact `(command, args, transport)` triple
	 * has already been confirmed for the current workspace — see
	 * `src-tauri/src/debug/confirm.rs`'s module doc and
	 * `app/features/debug/plain-debug-adapter-confirmation.ts`'s
	 * `resolveDebugAdapterConfirmation`. `false`, never a rejection, for the
	 * `EMPTY` workspace. */
	debugAdapterConfirmationState(
		descriptor: DebugAdapterConfirmationSubject,
	): Promise<DebugAdapterConfirmationState>;
	/** Persists confirmation for the exact triple, scoped to the current
	 * workspace's stable roots identity. Rejects with
	 * `DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE` for the `EMPTY` workspace. */
	debugAdapterConfirmationGrant(
		descriptor: DebugAdapterConfirmationSubject,
	): Promise<void>;
	/** Revokes a previously granted confirmation for the exact triple.
	 * Idempotent — revoking a triple that was never (or no longer) confirmed
	 * succeeds silently. */
	debugAdapterConfirmationRevoke(
		descriptor: DebugAdapterConfirmationSubject,
	): Promise<void>;
	/** `F100` S3: starts a new debug session by sending DAP's `launch` request
	 * against `target`, with `adapterId` becoming `initialize`'s
	 * `arguments.adapterID` and `launchArguments` forwarded verbatim as the
	 * opaque, adapter-specific `launch` payload (ADR 0003's "adapter-specific
	 * 配置透明透传"). Never sends any breakpoint at session-start time — see
	 * `plain-debug-session.ts`'s own doc comment for why every breakpoint,
	 * whether set before or after the session starts, always goes through
	 * `debugSetBreakpoints` instead. Rejects with `WORKSPACE_NOT_TRUSTED` for
	 * an untrusted workspace, `DEBUG_ADAPTER_NOT_CONFIRMED` for an
	 * unconfirmed `(command, args, transport)` triple (see
	 * `resolveDebugAdapterConfirmation`, which must always run first), or
	 * `DEBUG_HANDSHAKE_FAILED` if the adapter itself rejects any handshake
	 * step. */
	debugLaunch(
		rootId: string,
		target: DebugAdapterTarget,
		adapterId: string,
		launchArguments: Readonly<Record<string, unknown>>,
	): Promise<DebugSessionStartResult>;
	/** Identical contract to `debugLaunch`, sending DAP's `attach` request
	 * instead of `launch`. */
	debugAttach(
		rootId: string,
		target: DebugAdapterTarget,
		adapterId: string,
		launchArguments: Readonly<Record<string, unknown>>,
	): Promise<DebugSessionStartResult>;
	/** Tears down a live debug session. Rejects with
	 * `DEBUG_SESSION_NOT_FOUND` for a session id that never existed, already
	 * ended on its own, or was already disconnected. */
	debugDisconnect(sessionId: string): Promise<void>;
	/** Runtime `setBreakpoints` for `path` — always the *complete* current
	 * breakpoint set for that file (DAP's `setBreakpoints` request replaces,
	 * never incrementally adds/removes), so a caller toggling one breakpoint
	 * must resend every remaining one for the same path, not just the
	 * changed entry. See `DebugBreakpointResult`'s own doc comment for why
	 * the response's `verified`/`line` must always be trusted over what was
	 * requested. */
	debugSetBreakpoints(
		sessionId: string,
		rootId: string,
		path: string,
		breakpoints: readonly DebugBreakpointRequest[],
	): Promise<DebugSetBreakpointsResult>;
	/** Fetches (a page of) `threadId`'s call stack. `startFrame`/`levels`
	 * (either or both `null` meaning "from the top"/"every remaining frame")
	 * are DAP's own `StackTraceArguments` pagination fields. */
	debugStackTrace(
		sessionId: string,
		threadId: number,
		startFrame: number | null,
		levels: number | null,
	): Promise<DebugStackTraceResult>;
	/** Fetches the variable scopes available at stack frame `frameId` (a
	 * `DebugStackFrame.id` a prior `debugStackTrace` response returned). */
	debugScopes(sessionId: string, frameId: number): Promise<DebugScopesResult>;
	/** Expands one `variablesReference` (a `DebugScope`'s or a previous
	 * `DebugVariable`'s own reference handle — never `0`, which means "no
	 * children" and should never reach this call). `start`/`count`/`filter`
	 * (any or all `null`) are DAP's own pagination fields — the **lazy
	 * expansion and pagination** contract this feature's acceptance criteria
	 * require: a large indexed collection (e.g. a big array) should be
	 * fetched one page at a time via `start`/`count`, not all at once. */
	debugVariables(
		sessionId: string,
		variablesReference: number,
		start: number | null,
		count: number | null,
		filter: DebugVariablesFilter | null,
	): Promise<DebugVariablesResult>;
	/** Evaluates `expression` under `context` (the Watch view always sends
	 * `"watch"`), optionally scoped to `frameId`'s lexical context. */
	debugEvaluate(
		sessionId: string,
		expression: string,
		frameId: number | null,
		context: DebugEvaluateContext,
	): Promise<DebugEvaluateResult>;
	/** `F100` S4: resumes execution of `threadId` (DAP's own default, absent a
	 * `singleThread` override this domain never sends, is "every thread"; see
	 * `DebugContinueResult.allThreadsContinued`'s own doc comment for the
	 * exact default this implements). */
	debugContinue(
		sessionId: string,
		threadId: number,
	): Promise<DebugContinueResult>;
	/** Steps over the current line ("step over"/`next` in DAP terms). */
	debugNext(sessionId: string, threadId: number): Promise<void>;
	/** Steps into the current line's call ("step into"/`stepIn` in DAP
	 * terms). Never sends a `targetId` — the `stepInTargets` target picker
	 * (gated by `Capabilities.supportsStepInTargetsRequest`) is out of scope;
	 * see `plain-debug-call-stack-view.ts`'s own module doc for the full
	 * reasoning. */
	debugStepIn(sessionId: string, threadId: number): Promise<void>;
	/** Steps out of the current function ("step out"/`stepOut` in DAP
	 * terms). */
	debugStepOut(sessionId: string, threadId: number): Promise<void>;
	/** Interrupts a running thread. */
	debugPause(sessionId: string, threadId: number): Promise<void>;
	/** `F100` S5 — acknowledges a gated `output` event through `sequence`,
	 * freeing emission credit in `src-tauri/src/debug/output_gate.rs`'s
	 * backpressure gate — see `DebugEventPayload`'s own doc comment for the
	 * `sequence` field this acks against, and
	 * `plain-debug-console-view.ts`'s own module doc for the one production
	 * caller (acks immediately after rendering each `output` line it
	 * receives). Tolerant of a stale/duplicate/out-of-order `sequence` and of
	 * a `sessionId` that no longer names a live session (mirrors
	 * `terminalAck`'s identical tolerant contract for the same kind of race). */
	debugOutputAck(sessionId: string, sequence: number): Promise<void>;
	/** Registers a listener for every live debug session's streamed
	 * `plain://debug-event` deliveries in this window — mirrors
	 * `terminalWatchData`'s own all-sessions-in-one-listener shape; the
	 * listener receives the full decoded event (including `sessionId`) and
	 * must filter for the session(s) it cares about itself. */
	debugWatchEvent(listener: (event: DebugEventPayload) => void): Unlisten;
}
