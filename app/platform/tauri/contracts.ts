export const RUNTIME_READY_EVENT = "plain://runtime-ready" as const;
export const WORKSPACE_WATCH_WAKE_EVENT =
	"plain://workspace-watch-wake" as const;
export const WORKSPACE_SEARCH_TEXT_WAKE_EVENT =
	"plain://workspace-search-text-wake" as const;

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
 * One imported theme package's validated summary. `resources` is the exact
 * whitelist `theme_read_resource` checks a `relativePath` against for this
 * package (main document, `include` chain, `tokenColors` `.tmTheme`
 * target) — every file the frontend needs to fetch and `registerFileUrl`
 * to make the package's themes actually loadable.
 */
export interface ThemePackageSummary {
	readonly id: string;
	readonly publisher: string;
	readonly name: string;
	readonly version: string;
	readonly themes: readonly ThemeContribution[];
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

/** `theme_get_selection`'s result: the persisted `ColorThemeData#settingsId`,
 * or `null` if none is stored (never set, explicitly cleared, or the stored
 * file was corrupt/invalid — Rust collapses all three to `null` rather than
 * distinguishing them, see `src-tauri/src/theme/selection.rs`). */
export interface ThemeSelectionResult {
	readonly themeId: string | null;
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
	 * selection. A non-null id that fails Rust's charset/length check
	 * rejects with `THEME_SELECTION_INVALID` and leaves whatever was
	 * previously persisted untouched. */
	themeSetSelection(themeId: string | null): Promise<void>;
}
