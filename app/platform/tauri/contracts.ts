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
	/** `F080` S3: `git add -A -- <paths...>` — stages every kind of
	 * working-tree change (modified/added/deleted) for exactly the given
	 * repository-toplevel-relative paths. Same trust/repository rejections as
	 * `gitStatus`; rejects with `GIT_MUTATE_PATHS_INVALID_REQUEST` for an
	 * empty list or an invalid (absolute, `..`-traversing, or oversized)
	 * path. */
	gitStagePaths(paths: readonly string[]): Promise<void>;
	/** `F080` S3: `git reset -q -- <paths...>` — unstages exactly the given
	 * paths, leaving working-tree content untouched. Same
	 * rejections as `gitStagePaths`. */
	gitUnstagePaths(paths: readonly string[]): Promise<void>;
	/** `F080` S3 hunk-level stage: hashes `content` (the file's complete new
	 * content after applying one or more selected hunks — computed by the
	 * frontend's Monaco diff engine, never a unified-diff patch) into the
	 * object database and writes it into the index at `path`, without
	 * touching the working tree. See `src-tauri/src/git/stage.rs`'s
	 * `stage_blob` doc comment for the exact `hash-object`/`update-index`
	 * mechanics and mode-resolution rule. Rejects with
	 * `GIT_STAGE_BLOB_CONTENT_TOO_LARGE` above 8 MiB, or
	 * `GIT_STAGE_BLOB_INVALID_PATH` for an invalid path. */
	gitStageBlob(path: string, content: Uint8Array): Promise<void>;
	/** `F080` S3: `git -c user.useConfigOnly=true commit --quiet --file -
	 * [--amend]` — `message` travels over stdin, never a command-line
	 * argument. Rejects with `GIT_COMMIT_EMPTY_MESSAGE` for an empty/
	 * whitespace-only message, `GIT_COMMIT_NOTHING_TO_COMMIT` when nothing is
	 * staged, or `GIT_COMMIT_FAILED` for any other failure (including a
	 * blocking `pre-commit`/`commit-msg` hook — hooks are *not* suppressed
	 * for this user-initiated write, unlike `gitStatus`'s background read).
	 */
	gitCommit(message: string, amend: boolean): Promise<void>;
	/** `F080` S3, **destructive**: `git checkout -q -- <paths...>` — restores
	 * exactly the given paths' working-tree content to the index's version,
	 * discarding unstaged edits. This call performs the discard
	 * unconditionally; the caller must have already confirmed with the user
	 * (see `IDialogService.confirm` in `app/features/scm/plain-scm-view.ts`)
	 * before invoking it. Empirically all-or-nothing: if any path in the
	 * batch cannot be resolved (e.g. an untracked path), the whole call
	 * rejects with `GIT_DISCARD_FAILED` and none of the paths are touched.
	 * Same path-list validation rejections as `gitStagePaths`. */
	gitDiscardPaths(paths: readonly string[]): Promise<void>;
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
	): Promise<GitNetworkPreviewResult>;
	/** `F080` S4: `git fetch --quiet` (no explicit remote — resolves to the
	 * current branch's configured remote, or `origin`, exactly like a bare
	 * `git fetch` typed at a real terminal). Rejects with `GIT_FETCH_FAILED`
	 * on any other failure. Never called without a preceding, user-confirmed
	 * `gitNetworkPreview("fetch")` call. */
	gitFetch(): Promise<void>;
	/** `F080` S4: `git pull --quiet` against the current branch's configured
	 * upstream. Rejects with `GIT_NETWORK_NO_UPSTREAM` if none is configured,
	 * `GIT_PULL_NEEDS_STRATEGY` if the branches have diverged and no
	 * merge/rebase/fast-forward-only reconcile strategy is configured (this
	 * domain never auto-configures one on the caller's behalf — ADR 0003), or
	 * `GIT_PULL_FAILED` for any other failure. Never called without a
	 * preceding, user-confirmed `gitNetworkPreview("pull")` call. */
	gitPull(): Promise<void>;
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
	gitPush(force: boolean): Promise<void>;
	/** `F080` S4: best-effort, idempotent request to cancel whatever
	 * `gitFetch`/`gitPull`/`gitPush` call is currently in flight for this
	 * window (a no-op if none is) — the user-reachable half of this domain's
	 * cooperative network-exec cancellation (`GitExecMode::Network`'s longer
	 * timeout means a stuck fetch/pull/push needs a real way to abort early).
	 * Never rejects. */
	gitNetworkCancel(): Promise<void>;
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
	): Promise<GitBlameCommitMessagesResult>;
	/** `F090` S1: `git log -z --format=%H%x1f%B --no-patch --follow -- <path>`
	 * — the whole-file commit list, newest first. `--follow` is git's own
	 * documented *heuristic* rename tracker, not a guarantee (see
	 * `src-tauri/src/git/log.rs`'s own module doc comment). A path with no
	 * history at all (never committed, or never existed) is **not** a
	 * rejection — it resolves to `{ entries: [], truncated: false }`. Same
	 * trust/repository rejections as `gitStatus`. */
	gitFileHistory(path: string): Promise<GitHistoryListResult>;
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
	gitShowCommit(sha: string): Promise<GitShowCommitResult>;
	/** `F090` S2: reads one version of `path` at an arbitrary, already-
	 * validated commit `sha` — the multi-diff resolver's own content-fetch
	 * primitive for each changed file's original/modified side (the commit
	 * itself for the modified side, its resolved `GitShowCommitResult.
	 * parentSha` for the original side). Same shape and not-found semantics as
	 * `gitShowBlob` (`{ content: null }`, not a rejection, when the path does
	 * not exist at that revision) — reuses that exact result type rather than
	 * a near-duplicate one. */
	gitShowCommitBlob(sha: string, path: string): Promise<GitShowBlobResult>;
	/** `F090` S3: `git log -z --format=%H%x1f%P%x1f%s --no-patch --topo-order
	 * --branches --tags --remotes --max-count=<maxCount+1>` — the graph
	 * view's own DAG source. `maxCount` must be a positive integer (the
	 * caller's own display window); rejects with
	 * `GIT_LOG_GRAPH_INVALID_REQUEST` for zero or an excessive value. Same
	 * trust/repository rejections as `gitStatus`. */
	gitLogGraph(maxCount: number): Promise<GitLogGraphResult>;
	/** `F090` S3: `git for-each-ref --format=... refs/heads refs/tags
	 * refs/remotes` — the refs sidebar's own data source, and the graph
	 * view's own ref-badge join source (see `GitGraphNode`'s own doc
	 * comment). Takes no parameters. Same trust/repository rejections as
	 * `gitStatus`. */
	gitRefsList(): Promise<GitRefsListResult>;
	/** `F090` S4: `git stash list -z --format=%gd%x1f%H%x1f%ct%x1f%B` — the
	 * stash panel's own data source, newest first. Takes no parameters. Same
	 * trust/repository rejections as `gitStatus`. */
	gitStashList(): Promise<GitStashListResult>;
	/** `F090` S4: `git stash show --name-status/--numstat -z -u -M -C
	 * --find-copies-harder <sha>` — one stash entry's own file-level change
	 * list. `sha` must be a real, exactly 40-lowercase-hex commit id
	 * belonging to a real stash-like entry. Same trust/repository rejections
	 * as `gitStatus`; rejects with `GIT_STASH_NOT_FOUND` for a malformed or
	 * nonexistent sha (including a syntactically valid sha naming a real
	 * commit that is not itself a stash entry). */
	gitStashShow(sha: string): Promise<GitStashShowResult>;
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
	gitStashApply(sha: string, useIndex: boolean): Promise<GitStashApplyOutcome>;
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
	gitStashPop(sha: string, useIndex: boolean): Promise<GitStashApplyOutcome>;
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
	gitStashDrop(sha: string): Promise<void>;
}
