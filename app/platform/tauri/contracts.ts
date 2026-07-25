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

export interface RuntimeInfo {
	application: "Plain";
	ipcVersion: 1;
	runtime: "tauri" | "browser-mock";
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

/**
 * Result of a bounded, `.gitignore`-respecting file-name search rooted at
 * one or more workspace roots. `entries` are root-relative wire paths (see
 * `frozenWorkspaceEntryRequest`'s `relativePath` convention) — this slice
 * does not pair each entry with its root id because Plain currently
 * authorizes exactly one workspace root at a time (see
 * `WorkspaceSearchFilesRequest`'s own doc comment).
 */
export interface WorkspaceSearchFilesResult {
	readonly entries: readonly string[];
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

/**
 * One recovered backup entry. `bytes` is a freshly allocated snapshot: it
 * shares no backing storage with the bridge/mock and the caller may freely
 * mutate it.
 */
export interface BackupEntry {
	readonly key: string;
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

export type Unlisten = () => void | Promise<void>;

export interface PlainBridge {
	runtimeInfo(): Promise<RuntimeInfo>;
	onRuntimeReady(listener: (payload: RuntimeInfo) => void): Promise<Unlisten>;
	workspaceCapabilities(): Promise<WorkspaceCapabilities>;
	workspaceSnapshot(): Promise<WorkspaceSnapshot>;
	workspaceReconcileWatchRoots(rootIds: readonly string[]): void;
	workspaceWatch(rootId: string, listener: () => void): Unlisten;
	workspacePickRoots(mode: WorkspacePickMode): Promise<WorkspacePickResult>;
	workspaceRemoveRoot(rootId: string): Promise<WorkspaceSnapshot>;
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
	backupWrite(key: string, bytes: Uint8Array): Promise<void>;
	backupReadAll(): Promise<readonly BackupEntry[]>;
	backupDiscard(key: string): Promise<void>;
	backupDiscardAll(): Promise<void>;
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
	/** Starts a new interactive terminal session. `cwd: null` uses the
	 * current workspace's first authorized root — see
	 * `src-tauri/src/terminal/service.rs`'s `resolve_cwd`. Rejects with
	 * `WORKSPACE_NOT_TRUSTED` if the current workspace has not been granted
	 * execution trust (see `workspaceTrustGrant`). */
	terminalStart(
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
	gitStatus(): Promise<GitStatusResult>;
	/** Lists file-level diff entries (`cached: true` for the index-vs-HEAD
	 * diff, `false` for the worktree-vs-index diff) — see
	 * `src-tauri/src/git/diff.rs`'s `diff_files` doc comment for the
	 * two-invocation-join caveat. Same trust/repository rejections as
	 * `gitStatus`. */
	gitDiffFiles(cached: boolean): Promise<GitDiffFilesResult>;
	/** Reads one version of `path` (repository-toplevel-relative). Same
	 * trust/repository rejections as `gitStatus`; a missing version of an
	 * otherwise-valid path is `{ content: null }`, not a rejection. */
	gitShowBlob(rev: GitBlobRev, path: string): Promise<GitShowBlobResult>;
}
